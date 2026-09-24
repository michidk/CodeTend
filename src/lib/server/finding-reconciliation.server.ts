import '@tanstack/react-start/server-only'

import { and, eq, sql } from 'drizzle-orm'
import { type DatabaseTransaction, db } from '@/db'
import {
  type Finding,
  type FindingCounts,
  findingOccurrences,
  findings,
  scannerRuns,
} from '@/db/schema'
import {
  type EnrichedScannerFinding,
  type FindingEventKind,
  type FindingState,
  OPEN_FINDING_STATES,
  type ScannerResult,
  SEVERITY_ORDER,
} from '@/lib/findings'
import type { ScanTarget } from '@/lib/security-scans'
import { investigationAllowsResolution } from '@/lib/security-scans'
import {
  type FindingEventInput,
  recordFindingEvent,
} from '@/lib/server/finding-events.server'

export interface ReconciledFinding {
  readonly id: number
  readonly state: FindingState
  readonly finding: EnrichedScannerFinding
}

export interface ReconciliationOutcome {
  readonly findings: readonly ReconciledFinding[]
  readonly counts: FindingCounts
}

const EMPTY_COUNTS: FindingCounts = {
  new: 0,
  active: 0,
  improved: 0,
  resolved: 0,
  regressed: 0,
}

/**
 * Reconciles one scanner's fresh result with the persisted logical findings
 * of the same repository and scanner. Matching happens by fingerprint (and by
 * `previousFindingId` when the scanner verified a hypothesis):
 *
 * - unmatched result           → new
 * - matched open finding       → active, improved (lower severity or scanner verdict) or regressed (higher severity)
 * - matched resolved finding   → regressed
 * - open finding not returned  → carried forward unless explicitly resolved
 *
 * This compares our own persisted results, never Git history.
 */
export interface ReconciliationInput {
  readonly repositoryId: number
  readonly scanId: number
  readonly scannerId: string
  readonly result: Omit<ScannerResult, 'findings'> & {
    readonly findings: readonly EnrichedScannerFinding[]
  }
  /** A deterministic complete inventory can positively resolve omitted rows. */
  readonly authoritative?: boolean
  readonly target?: ScanTarget
}

type FindingUpdateMode =
  | 'refresh'
  | 'refresh-and-clear-disposition'
  | 'state-only'
  | 'state-and-clear-disposition'

export interface FindingTransitionPlan {
  readonly kind: 'insert' | 'update'
  readonly previous: Finding | null
  readonly finding: EnrichedScannerFinding
  readonly fingerprint: string
  readonly state: FindingState
  readonly updateMode: FindingUpdateMode
  readonly updateLastSeen: boolean
  readonly resolvedScan: 'preserve' | 'clear' | 'set'
  readonly eventKind: FindingEventKind
  readonly eventDisposition?: FindingEventInput['disposition']
  readonly note: string | null
  readonly countState: keyof FindingCounts | null
  readonly includeInResult: boolean
}

export async function reconcileScannerFindings(
  input: ReconciliationInput,
): Promise<ReconciliationOutcome> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`
      select 1
      from ${scannerRuns}
      where ${scannerRuns.scanId} = ${input.scanId}
        and ${scannerRuns.scannerId} = ${input.scannerId}
      for update
    `)
    const persisted = await transaction
      .select({
        finding: findings,
        observedState: findingOccurrences.state,
      })
      .from(findingOccurrences)
      .innerJoin(findings, eq(findings.id, findingOccurrences.findingId))
      .where(
        and(
          eq(findingOccurrences.scanId, input.scanId),
          eq(findings.repositoryId, input.repositoryId),
          eq(findings.scannerId, input.scannerId),
        ),
      )
    if (persisted.length > 0) return outcomeFromPersistedOccurrences(persisted)

    const existing = await transaction.query.findings.findMany({
      where: and(
        eq(findings.repositoryId, input.repositoryId),
        eq(findings.scannerId, input.scannerId),
      ),
    })
    const plans = planFindingTransitions(input, existing)
    return executeFindingTransitionPlans(transaction, input, plans)
  })
}

function outcomeFromPersistedOccurrences(
  persisted: readonly {
    readonly finding: Finding
    readonly observedState: FindingState
  }[],
): ReconciliationOutcome {
  const counts = { ...EMPTY_COUNTS }
  for (const entry of persisted) counts[entry.observedState] += 1
  return {
    counts,
    findings: persisted.map((entry) => ({
      id: entry.finding.id,
      state: entry.observedState,
      finding: toScannerFinding(entry.finding),
    })),
  }
}

/** Pure lifecycle policy. Persistence is handled separately and atomically. */
export function planFindingTransitions(
  input: ReconciliationInput,
  existing: readonly Finding[],
): FindingTransitionPlan[] {
  const byFingerprint = new Map(
    existing.map((finding) => [finding.fingerprint, finding]),
  )
  const byId = new Map(existing.map((finding) => [finding.id, finding]))
  const verdictById = new Map(
    input.result.hypothesisVerdicts.map((verdict) => [
      verdict.previousFindingId,
      verdict,
    ]),
  )
  const touched = new Set<number>()
  const plans: FindingTransitionPlan[] = []

  for (const fresh of dedupeByFingerprint(input.result.findings)) {
    const previous =
      (fresh.previousFindingId
        ? byId.get(fresh.previousFindingId)
        : undefined) ?? byFingerprint.get(fresh.fingerprint)

    if (!previous || touched.has(previous.id)) {
      plans.push({
        kind: 'insert',
        previous: null,
        finding: fresh,
        fingerprint: touched.has(previous?.id ?? -1)
          ? `${fresh.fingerprint}-${input.scanId}`
          : fresh.fingerprint,
        state: 'new',
        updateMode: 'refresh',
        updateLastSeen: true,
        resolvedScan: 'preserve',
        eventKind: 'detected',
        note: null,
        countState: 'new',
        includeInResult: true,
      })
      continue
    }

    touched.add(previous.id)
    const dispositionVerdict = verdictById.get(previous.id)
    if (previous.disposition) {
      if (dispositionVerdict?.dispositionStillApplies === false) {
        const reason =
          dispositionVerdict.dispositionAssessment ??
          'The prior manual disposition no longer applies to the current code.'
        plans.push({
          kind: 'update',
          previous,
          finding: fresh,
          fingerprint: previous.fingerprint,
          state: 'regressed',
          updateMode: 'refresh-and-clear-disposition',
          updateLastSeen: true,
          resolvedScan: 'clear',
          eventKind: 'disposition_invalidated',
          eventDisposition: previous.disposition,
          note: reason,
          countState: 'regressed',
          includeInResult: true,
        })
      } else {
        plans.push({
          kind: 'update',
          previous,
          finding: fresh,
          fingerprint: previous.fingerprint,
          state: 'resolved',
          updateMode: 'refresh',
          updateLastSeen: true,
          resolvedScan: 'preserve',
          eventKind: 'disposition_retained',
          eventDisposition: previous.disposition,
          note: dispositionVerdict?.dispositionAssessment ?? null,
          countState: null,
          includeInResult: true,
        })
      }
      continue
    }

    const verdict = dispositionVerdict?.verdict
    const state = nextStateForMatch(previous, fresh, verdict)
    plans.push({
      kind: 'update',
      previous,
      finding: fresh,
      fingerprint: previous.fingerprint,
      state,
      updateMode: 'refresh',
      updateLastSeen: true,
      resolvedScan: 'clear',
      eventKind: matchEventKind(state),
      note: dispositionVerdict?.note ?? null,
      countState: state,
      includeInResult: true,
    })
  }

  for (const previous of existing) {
    if (touched.has(previous.id)) continue
    const verdict = verdictById.get(previous.id)
    if (
      previous.disposition !== null &&
      verdict?.dispositionStillApplies === false
    ) {
      touched.add(previous.id)
      plans.push({
        kind: 'update',
        previous,
        finding: toScannerFinding(previous),
        fingerprint: previous.fingerprint,
        state: 'regressed',
        updateMode: 'state-and-clear-disposition',
        updateLastSeen: true,
        resolvedScan: 'clear',
        eventKind: 'disposition_invalidated',
        eventDisposition: previous.disposition,
        note:
          verdict.dispositionAssessment ??
          'The prior manual disposition no longer applies to the current code.',
        countState: 'regressed',
        includeInResult: true,
      })
      continue
    }
    if (!OPEN_FINDING_STATES.includes(previous.state)) continue

    if (
      (verdict?.verdict === 'resolved' || input.authoritative === true) &&
      resolutionIsCovered(input, previous, verdict?.verdict === 'resolved')
    ) {
      plans.push({
        kind: 'update',
        previous,
        finding: toScannerFinding(previous),
        fingerprint: previous.fingerprint,
        state: 'resolved',
        updateMode: 'state-only',
        updateLastSeen: false,
        resolvedScan: 'set',
        eventKind: 'resolved',
        note:
          verdict?.note ??
          'Not reported by a scanner that verified every other hypothesis in a covered target.',
        countState: 'resolved',
        includeInResult: false,
      })
      continue
    }

    if (verdict?.verdict === 'confirmed' || verdict?.verdict === 'improved') {
      const state = verdict.verdict === 'improved' ? 'improved' : 'active'
      plans.push({
        kind: 'update',
        previous,
        finding: toScannerFinding(previous),
        fingerprint: previous.fingerprint,
        state,
        updateMode: 'state-only',
        updateLastSeen: true,
        resolvedScan: 'preserve',
        eventKind: verdict.verdict,
        note: verdict.note ?? null,
        countState: state,
        includeInResult: true,
      })
      continue
    }

    plans.push({
      kind: 'update',
      previous,
      finding: toScannerFinding(previous),
      fingerprint: previous.fingerprint,
      state: 'active',
      updateMode: 'state-only',
      updateLastSeen: false,
      resolvedScan: 'preserve',
      eventKind: 'carried_forward',
      note:
        verdict?.verdict === 'resolved'
          ? 'Carried forward: the resolved verdict was outside the configured target.'
          : 'Carried forward: this bounded investigation did not explicitly verify the finding.',
      countState: 'active',
      includeInResult: true,
    })
  }

  return plans
}

async function executeFindingTransitionPlans(
  transaction: DatabaseTransaction,
  input: ReconciliationInput,
  plans: readonly FindingTransitionPlan[],
): Promise<ReconciliationOutcome> {
  const reconciled: ReconciledFinding[] = []
  const counts = { ...EMPTY_COUNTS }
  const now = new Date()

  for (const plan of plans) {
    let findingId: number
    if (plan.kind === 'insert') {
      const [inserted] = await transaction
        .insert(findings)
        .values({
          repositoryId: input.repositoryId,
          scannerId: input.scannerId,
          fingerprint: plan.fingerprint,
          state: plan.state,
          ...findingColumns(plan.finding),
          firstSeenScanId: input.scanId,
          lastSeenScanId: input.scanId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: findings.id })
      if (!inserted) continue
      findingId = inserted.id
    } else {
      const previous = plan.previous
      if (!previous) continue
      findingId = previous.id
      const values: Partial<typeof findings.$inferInsert> = {
        state: plan.state,
        updatedAt: now,
      }
      if (plan.updateMode.startsWith('refresh')) {
        Object.assign(values, findingColumns(plan.finding))
      }
      if (plan.updateMode.endsWith('clear-disposition')) {
        Object.assign(values, {
          disposition: null,
          dispositionNote: null,
          triagedAt: null,
        })
      }
      if (plan.updateLastSeen) values.lastSeenScanId = input.scanId
      if (plan.resolvedScan === 'clear') values.resolvedScanId = null
      if (plan.resolvedScan === 'set') values.resolvedScanId = input.scanId
      await transaction
        .update(findings)
        .set(values)
        .where(eq(findings.id, findingId))
    }

    await recordOccurrenceWithDatabase(
      transaction,
      findingId,
      input.scanId,
      plan.state,
      plan.finding,
      plan.note ?? undefined,
    )
    await recordFindingEvent(
      {
        findingId,
        scanId: input.scanId,
        kind: plan.eventKind,
        actor: 'scanner',
        fromState: plan.previous?.state ?? null,
        toState: plan.state,
        disposition: plan.eventDisposition,
        note: plan.note,
      },
      transaction,
    )
    if (plan.countState) counts[plan.countState] += 1
    if (plan.includeInResult) {
      reconciled.push({
        id: findingId,
        state: plan.state,
        finding: plan.finding,
      })
    }
  }

  return { findings: reconciled, counts }
}
function toScannerFinding(finding: Finding): EnrichedScannerFinding {
  return {
    fingerprint: finding.fingerprint,
    title: finding.title,
    severity: finding.severity,
    confidence: finding.confidence,
    description: finding.description,
    whyItMatters: finding.whyItMatters,
    recommendation: finding.recommendation,
    effort: finding.effort,
    subject: finding.subject ?? {
      kind: 'repository',
      aspect: 'legacy finding without a typed subject',
    },
    evidence: finding.evidence,
    locations: finding.locations,
    classification: finding.classification ?? undefined,
    securityContext: finding.securityContext ?? undefined,
    rootCause: finding.rootCause ?? undefined,
    codeEvidence: finding.codeEvidence ?? undefined,
    attackPath: finding.attackPath ?? undefined,
    validationPlan: finding.validationPlan ?? undefined,
    remediationTests: finding.remediationTests ?? undefined,
    preventiveControls: finding.preventiveControls ?? undefined,
    vulnerability: finding.vulnerability ?? undefined,
    priority: finding.priority ?? undefined,
    priorityScore: finding.priorityScore ?? undefined,
    priorityReasons: finding.priorityReasons,
    previousFindingId: finding.id,
  }
}

function nextStateForMatch(
  previous: Finding,
  fresh: EnrichedScannerFinding,
  verdict: 'confirmed' | 'improved' | 'resolved' | undefined,
): FindingState {
  const previousRank = SEVERITY_ORDER[previous.severity]
  const freshRank = SEVERITY_ORDER[fresh.severity]
  if (previous.state === 'resolved') return 'regressed'
  if (freshRank < previousRank) return 'regressed'
  if (verdict === 'improved' || freshRank > previousRank) return 'improved'
  return 'active'
}

function matchEventKind(state: FindingState): FindingEventKind {
  switch (state) {
    case 'improved':
    case 'regressed':
    case 'resolved':
      return state
    case 'new':
      return 'detected'
    default:
      return 'confirmed'
  }
}

function findingColumns(fresh: EnrichedScannerFinding) {
  return {
    title: fresh.title,
    severity: fresh.severity,
    confidence: fresh.confidence,
    description: fresh.description,
    whyItMatters: fresh.whyItMatters,
    recommendation: fresh.recommendation,
    effort: fresh.effort,
    subject: fresh.subject,
    evidence: [...fresh.evidence],
    locations: fresh.locations,
    classification: fresh.classification ?? null,
    securityContext: fresh.securityContext ?? null,
    rootCause: fresh.rootCause ?? null,
    codeEvidence: fresh.codeEvidence ?? null,
    attackPath: fresh.attackPath ?? null,
    validationPlan: fresh.validationPlan ?? null,
    remediationTests: fresh.remediationTests ?? null,
    preventiveControls: fresh.preventiveControls ?? null,
    vulnerability: fresh.vulnerability ?? null,
    priority: fresh.priority ?? null,
    priorityScore: fresh.priorityScore ?? null,
    priorityReasons: [...(fresh.priorityReasons ?? [])],
  }
}

async function recordOccurrenceWithDatabase(
  database: DatabaseTransaction,
  findingId: number,
  scanId: number,
  state: FindingState,
  fresh: EnrichedScannerFinding,
  note?: string,
) {
  await database
    .insert(findingOccurrences)
    .values({
      findingId,
      scanId,
      state,
      severity: fresh.severity,
      confidence: fresh.confidence,
      subject: fresh.subject,
      evidence: [...fresh.evidence],
      classification: fresh.classification ?? null,
      securityContext: fresh.securityContext ?? null,
      rootCause: fresh.rootCause ?? null,
      codeEvidence: fresh.codeEvidence ?? null,
      attackPath: fresh.attackPath ?? null,
      validationPlan: fresh.validationPlan ?? null,
      vulnerability: fresh.vulnerability ?? null,
      priority: fresh.priority ?? null,
      priorityScore: fresh.priorityScore ?? null,
      priorityReasons: [...(fresh.priorityReasons ?? [])],
      note: note ?? null,
    })
    .onConflictDoNothing()
}

function dedupeByFingerprint(
  list: readonly EnrichedScannerFinding[],
): EnrichedScannerFinding[] {
  const seen = new Map<string, EnrichedScannerFinding>()
  for (const finding of list) {
    const current = seen.get(finding.fingerprint)
    if (
      !current ||
      SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[current.severity]
    ) {
      seen.set(finding.fingerprint, finding)
    }
  }
  return [...seen.values()]
}

function resolutionIsCovered(
  input: {
    authoritative?: boolean
    target?: ScanTarget
  },
  finding: Finding,
  explicitVerdict: boolean,
): boolean {
  if (input.authoritative) return true
  return investigationAllowsResolution({
    target: input.target,
    findingPaths: finding.locations.map((location) => location.path),
    findingSubject: finding.subject,
    explicitVerdict,
  })
}

export function sumCounts(list: readonly FindingCounts[]): FindingCounts {
  return list.reduce<FindingCounts>(
    (total, counts) => ({
      new: total.new + counts.new,
      active: total.active + counts.active,
      improved: total.improved + counts.improved,
      resolved: total.resolved + counts.resolved,
      regressed: total.regressed + counts.regressed,
    }),
    EMPTY_COUNTS,
  )
}
