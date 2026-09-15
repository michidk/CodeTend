import '@tanstack/react-start/server-only'

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  type Finding,
  type FindingCounts,
  findingOccurrences,
  findings,
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
import { recordFindingEvent } from '@/lib/server/finding-events.server'

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
export async function reconcileScannerFindings(input: {
  repositoryId: number
  scanId: number
  scannerId: string
  result: Omit<ScannerResult, 'findings'> & {
    readonly findings: readonly EnrichedScannerFinding[]
  }
  /** A deterministic complete inventory can positively resolve omitted rows. */
  authoritative?: boolean
  target?: ScanTarget
}): Promise<ReconciliationOutcome> {
  const existing = await db.query.findings.findMany({
    where: and(
      eq(findings.repositoryId, input.repositoryId),
      eq(findings.scannerId, input.scannerId),
    ),
  })
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

  const reconciled: ReconciledFinding[] = []
  const touched = new Set<number>()
  const counts = { ...EMPTY_COUNTS }
  const now = new Date()

  for (const fresh of dedupeByFingerprint(input.result.findings)) {
    const previous =
      (fresh.previousFindingId
        ? byId.get(fresh.previousFindingId)
        : undefined) ?? byFingerprint.get(fresh.fingerprint)

    if (!previous || touched.has(previous.id)) {
      const [inserted] = await db
        .insert(findings)
        .values({
          repositoryId: input.repositoryId,
          scannerId: input.scannerId,
          fingerprint: touched.has(previous?.id ?? -1)
            ? `${fresh.fingerprint}-${input.scanId}`
            : fresh.fingerprint,
          state: 'new',
          ...findingColumns(fresh),
          firstSeenScanId: input.scanId,
          lastSeenScanId: input.scanId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: findings.id })
      if (!inserted) continue
      touched.add(inserted.id)
      await recordOccurrence(inserted.id, input.scanId, 'new', fresh)
      await recordFindingEvent({
        findingId: inserted.id,
        scanId: input.scanId,
        kind: 'detected',
        actor: 'scanner',
        fromState: null,
        toState: 'new',
      })
      counts.new += 1
      reconciled.push({ id: inserted.id, state: 'new', finding: fresh })
      continue
    }

    touched.add(previous.id)
    if (previous.disposition) {
      const dispositionVerdict = verdictById.get(previous.id)
      if (dispositionVerdict?.dispositionStillApplies === false) {
        await db
          .update(findings)
          .set({
            state: 'regressed',
            disposition: null,
            dispositionNote: null,
            triagedAt: null,
            ...findingColumns(fresh),
            lastSeenScanId: input.scanId,
            resolvedScanId: null,
            updatedAt: now,
          })
          .where(eq(findings.id, previous.id))
        const reason =
          dispositionVerdict.dispositionAssessment ??
          'The prior manual disposition no longer applies to the current code.'
        await recordOccurrence(
          previous.id,
          input.scanId,
          'regressed',
          fresh,
          reason,
        )
        await recordFindingEvent({
          findingId: previous.id,
          scanId: input.scanId,
          kind: 'disposition_invalidated',
          actor: 'scanner',
          fromState: previous.state,
          toState: 'regressed',
          disposition: previous.disposition,
          note: reason,
        })
        counts.regressed += 1
        reconciled.push({ id: previous.id, state: 'regressed', finding: fresh })
        continue
      }
      await db
        .update(findings)
        .set({
          state: 'resolved',
          ...findingColumns(fresh),
          lastSeenScanId: input.scanId,
          updatedAt: now,
        })
        .where(eq(findings.id, previous.id))
      await recordOccurrence(
        previous.id,
        input.scanId,
        'resolved',
        fresh,
        `Suppressed by manual disposition: ${previous.disposition}.`,
      )
      await recordFindingEvent({
        findingId: previous.id,
        scanId: input.scanId,
        kind: 'disposition_retained',
        actor: 'scanner',
        fromState: previous.state,
        toState: 'resolved',
        disposition: previous.disposition,
        note: dispositionVerdict?.dispositionAssessment ?? null,
      })
      reconciled.push({ id: previous.id, state: 'resolved', finding: fresh })
      continue
    }

    const verdict = verdictById.get(previous.id)?.verdict
    const state = nextStateForMatch(previous, fresh, verdict)
    await db
      .update(findings)
      .set({
        state,
        ...findingColumns(fresh),
        lastSeenScanId: input.scanId,
        resolvedScanId: null,
        updatedAt: now,
      })
      .where(eq(findings.id, previous.id))
    await recordOccurrence(
      previous.id,
      input.scanId,
      state,
      fresh,
      verdictById.get(previous.id)?.note,
    )
    await recordFindingEvent({
      findingId: previous.id,
      scanId: input.scanId,
      kind: matchEventKind(state),
      actor: 'scanner',
      fromState: previous.state,
      toState: state,
      note: verdictById.get(previous.id)?.note ?? null,
    })
    counts[state] += 1
    reconciled.push({ id: previous.id, state, finding: fresh })
  }

  // A manual disposition is durable, but scanners can explicitly prove that
  // its original rationale no longer matches the current code even when they
  // cannot produce a replacement finding payload.
  const invalidatedDispositions = existing.filter(
    (finding) =>
      !touched.has(finding.id) &&
      finding.disposition !== null &&
      verdictById.get(finding.id)?.dispositionStillApplies === false,
  )
  for (const finding of invalidatedDispositions) {
    touched.add(finding.id)
    await db
      .update(findings)
      .set({
        state: 'regressed',
        disposition: null,
        dispositionNote: null,
        triagedAt: null,
        lastSeenScanId: input.scanId,
        resolvedScanId: null,
        updatedAt: now,
      })
      .where(eq(findings.id, finding.id))
    const previous = toScannerFinding(finding)
    const reason =
      verdictById.get(finding.id)?.dispositionAssessment ??
      'The prior manual disposition no longer applies to the current code.'
    await recordOccurrence(
      finding.id,
      input.scanId,
      'regressed',
      previous,
      reason,
    )
    await recordFindingEvent({
      findingId: finding.id,
      scanId: input.scanId,
      kind: 'disposition_invalidated',
      actor: 'scanner',
      fromState: finding.state,
      toState: 'regressed',
      disposition: finding.disposition,
      note: reason,
    })
    counts.regressed += 1
    reconciled.push({ id: finding.id, state: 'regressed', finding: previous })
  }

  // Open findings the scanner neither returned nor explicitly resolved.
  // Resolving them needs positive evidence: either a `resolved` verdict, or a
  // scanner that verified every other hypothesis and therefore demonstrably
  // worked through the list. Otherwise the finding is carried forward as
  // `active` so a truncated or partial scanner output never fakes progress.
  const untouchedOpen = existing.filter(
    (finding) =>
      !touched.has(finding.id) && OPEN_FINDING_STATES.includes(finding.state),
  )
  const resolvedIds: number[] = []
  const carriedIds: number[] = []
  for (const finding of untouchedOpen) {
    const verdict = verdictById.get(finding.id)?.verdict
    if (
      (verdict === 'resolved' || input.authoritative === true) &&
      resolutionIsCovered(input, finding, verdict === 'resolved')
    ) {
      resolvedIds.push(finding.id)
    } else if (verdict === 'confirmed' || verdict === 'improved') {
      // Verified but no updated finding returned: keep the previous content.
      touched.add(finding.id)
      await db
        .update(findings)
        .set({
          state: verdict === 'improved' ? 'improved' : 'active',
          lastSeenScanId: input.scanId,
          updatedAt: now,
        })
        .where(eq(findings.id, finding.id))
      await db
        .insert(findingOccurrences)
        .values({
          findingId: finding.id,
          scanId: input.scanId,
          state: verdict === 'improved' ? 'improved' : 'active',
          severity: finding.severity,
          confidence: finding.confidence,
          classification: finding.classification,
          securityContext: finding.securityContext,
          rootCause: finding.rootCause,
          codeEvidence: finding.codeEvidence,
          attackPath: finding.attackPath,
          validationPlan: finding.validationPlan,
          vulnerability: finding.vulnerability,
          priority: finding.priority,
          priorityScore: finding.priorityScore,
          priorityReasons: finding.priorityReasons,
          note: verdictById.get(finding.id)?.note ?? null,
        })
        .onConflictDoNothing()
      await recordFindingEvent({
        findingId: finding.id,
        scanId: input.scanId,
        kind: verdict,
        actor: 'scanner',
        fromState: finding.state,
        toState: verdict === 'improved' ? 'improved' : 'active',
        note: verdictById.get(finding.id)?.note ?? null,
      })
      counts[verdict === 'improved' ? 'improved' : 'active'] += 1
      reconciled.push({
        id: finding.id,
        state: verdict === 'improved' ? 'improved' : 'active',
        finding: toScannerFinding(finding),
      })
    } else {
      carriedIds.push(finding.id)
    }
  }

  if (resolvedIds.length > 0) {
    await db
      .update(findings)
      .set({ state: 'resolved', resolvedScanId: input.scanId, updatedAt: now })
      .where(inArray(findings.id, resolvedIds))
    for (const id of resolvedIds) {
      const previous = byId.get(id)
      if (!previous) continue
      await db.insert(findingOccurrences).values({
        findingId: id,
        scanId: input.scanId,
        state: 'resolved',
        severity: previous.severity,
        confidence: previous.confidence,
        classification: previous.classification,
        securityContext: previous.securityContext,
        rootCause: previous.rootCause,
        codeEvidence: previous.codeEvidence,
        attackPath: previous.attackPath,
        validationPlan: previous.validationPlan,
        vulnerability: previous.vulnerability,
        priority: previous.priority,
        priorityScore: previous.priorityScore,
        priorityReasons: previous.priorityReasons,
        note: verdictById.get(id)?.note ?? null,
      })
      await recordFindingEvent({
        findingId: id,
        scanId: input.scanId,
        kind: 'resolved',
        actor: 'scanner',
        fromState: previous.state,
        toState: 'resolved',
        note:
          verdictById.get(id)?.note ??
          'Not reported by a scanner that verified every other hypothesis in a covered target.',
      })
    }
    counts.resolved += resolvedIds.length
  }

  for (const id of carriedIds) {
    const previous = byId.get(id)
    if (!previous) continue
    const carryNote =
      verdictById.get(id)?.verdict === 'resolved'
        ? 'Carried forward: the resolved verdict was outside the configured target.'
        : 'Carried forward: this bounded investigation did not explicitly verify the finding.'
    await db
      .update(findings)
      .set({ state: 'active', updatedAt: now })
      .where(eq(findings.id, id))
    await db
      .insert(findingOccurrences)
      .values({
        findingId: id,
        scanId: input.scanId,
        state: 'active',
        severity: previous.severity,
        confidence: previous.confidence,
        classification: previous.classification,
        securityContext: previous.securityContext,
        rootCause: previous.rootCause,
        codeEvidence: previous.codeEvidence,
        attackPath: previous.attackPath,
        validationPlan: previous.validationPlan,
        vulnerability: previous.vulnerability,
        priority: previous.priority,
        priorityScore: previous.priorityScore,
        priorityReasons: previous.priorityReasons,
        note: carryNote,
      })
      .onConflictDoNothing()
    await recordFindingEvent({
      findingId: id,
      scanId: input.scanId,
      kind: 'carried_forward',
      actor: 'scanner',
      fromState: previous.state,
      toState: 'active',
      note: carryNote,
    })
    counts.active += 1
    reconciled.push({
      id,
      state: 'active',
      finding: toScannerFinding(previous),
    })
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

async function recordOccurrence(
  findingId: number,
  scanId: number,
  state: FindingState,
  fresh: EnrichedScannerFinding,
  note?: string,
) {
  await db
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
