import { describe, expect, test } from 'bun:test'
import type { Finding } from '@/db/schema'
import type { EnrichedScannerFinding } from '@/lib/findings'
import {
  planFindingTransitions,
  type ReconciliationInput,
} from '@/lib/server/finding-reconciliation.server'

const freshFinding: EnrichedScannerFinding = {
  fingerprint: 'stable-fingerprint',
  title: 'Finding title',
  severity: 'high',
  confidence: 'high',
  description: 'A concrete problem in the repository.',
  whyItMatters: 'The behavior can fail in production.',
  recommendation: 'Make the transition atomic.',
  effort: 'medium',
  subject: { kind: 'file', path: 'src/example.ts' },
  evidence: [
    {
      kind: 'file',
      path: 'src/example.ts',
      startLine: 10,
      summary: 'The affected statement.',
    },
  ],
  locations: [{ path: 'src/example.ts', startLine: 10 }],
  priorityReasons: [],
}

function persistedFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 11,
    repositoryId: 3,
    scannerId: 'reliability',
    fingerprint: freshFinding.fingerprint,
    state: 'active',
    title: freshFinding.title,
    severity: freshFinding.severity,
    confidence: freshFinding.confidence,
    description: freshFinding.description,
    whyItMatters: freshFinding.whyItMatters,
    recommendation: freshFinding.recommendation,
    effort: freshFinding.effort,
    subject: freshFinding.subject,
    evidence: [...freshFinding.evidence],
    locations: [...freshFinding.locations],
    classification: null,
    securityContext: null,
    rootCause: null,
    codeEvidence: null,
    attackPath: null,
    validationPlan: null,
    remediationTests: null,
    preventiveControls: null,
    vulnerability: null,
    priority: null,
    priorityScore: null,
    priorityReasons: [],
    disposition: null,
    dispositionNote: null,
    triagedAt: null,
    firstSeenScanId: 1,
    lastSeenScanId: 1,
    resolvedScanId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

function input(
  findings: readonly EnrichedScannerFinding[],
  hypothesisVerdicts: readonly ReconciliationInput['result']['hypothesisVerdicts'][number][] = [],
  target: ReconciliationInput['target'] = { kind: 'repository' },
): ReconciliationInput {
  return {
    repositoryId: 3,
    scanId: 9,
    scannerId: 'reliability',
    target,
    result: {
      summary: 'Review complete.',
      findings: [...findings],
      hypothesisVerdicts: [...hypothesisVerdicts],
      investigation: {
        strategy: 'Inspect the relevant lifecycle paths.',
        focusAreas: [],
        evidence: [],
        blindSpots: [],
        confidence: 'high',
      },
      coverage: {
        completeness: 'complete',
        reviewed: [],
        deferred: [],
        excluded: [],
        openQuestions: [],
      },
    },
  }
}

describe('finding transition planning', () => {
  test('plans a complete detected transition for a new finding', () => {
    const [plan] = planFindingTransitions(input([freshFinding]), [])

    expect(plan).toMatchObject({
      kind: 'insert',
      state: 'new',
      eventKind: 'detected',
      countState: 'new',
      includeInResult: true,
    })
  })

  test('invalidates a disposition only on an explicit scanner verdict', () => {
    const previous = persistedFinding({
      disposition: 'accepted_risk',
      dispositionNote: 'Accepted for the old architecture.',
    })
    const [plan] = planFindingTransitions(
      input(
        [freshFinding],
        [
          {
            previousFindingId: previous.id,
            verdict: 'confirmed',
            note: 'The behavior remains.',
            dispositionStillApplies: false,
            dispositionAssessment: 'The trust boundary changed.',
          },
        ],
      ),
      [previous],
    )

    expect(plan).toMatchObject({
      state: 'regressed',
      updateMode: 'refresh-and-clear-disposition',
      eventKind: 'disposition_invalidated',
      eventDisposition: 'accepted_risk',
      note: 'The trust boundary changed.',
    })
  })

  test('carries an omitted finding forward without an explicit verdict', () => {
    const [plan] = planFindingTransitions(input([]), [persistedFinding()])

    expect(plan).toMatchObject({
      state: 'active',
      eventKind: 'carried_forward',
      countState: 'active',
    })
  })

  test('resolves an omitted finding only with a covered resolved verdict', () => {
    const previous = persistedFinding()
    const [plan] = planFindingTransitions(
      input(
        [],
        [
          {
            previousFindingId: previous.id,
            verdict: 'resolved',
            note: 'The old path no longer exists.',
          },
        ],
      ),
      [previous],
    )

    expect(plan).toMatchObject({
      state: 'resolved',
      eventKind: 'resolved',
      resolvedScan: 'set',
      countState: 'resolved',
      includeInResult: false,
    })
  })
})
