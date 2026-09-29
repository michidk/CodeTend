import { describe, expect, test } from 'bun:test'
import { scannerResultSchema } from '@/lib/findings'
import type { ScannerOutcome, ScanRequestScanner } from '../agent/lib/contract'
import {
  applyDuplicateReviews,
  type DuplicateReview,
  duplicateReviewBatches,
} from '../agent/lib/finding-deduplication'
import { securityValidationCandidates } from '../agent/lib/security-review'

const scanners: ScanRequestScanner[] = [
  'reliability',
  'type-safety',
  'security',
  'ci-security',
].map((id) => ({
  id,
  name: id,
  prompt: '',
  attentionHistory: [],
  hypotheses: [],
}))
function outcome(
  scannerId: string,
  fingerprint: string,
  path = 'src/input.ts',
  previousFindingId?: number,
): ScannerOutcome {
  return {
    scannerId,
    status: 'completed',
    startedAt: '',
    finishedAt: '',
    result: scannerResultSchema.parse({
      summary: 'Review result',
      hypothesisVerdicts: previousFindingId
        ? [{ previousFindingId, verdict: 'confirmed' }]
        : [],
      investigation: {
        strategy: 'Inspect the input validation boundary.',
        confidence: 'high',
      },
      findings: [
        {
          fingerprint,
          title: 'Unchecked input',
          severity: 'high',
          confidence: 'high',
          description: 'An unchecked external field reaches the application.',
          whyItMatters: 'Invalid input produces incorrect behavior.',
          recommendation: 'Validate the input at the boundary.',
          effort: 'small',
          locations: [{ path }],
          previousFindingId,
          subject: { kind: 'file', path },
          evidence: [{ kind: 'file', path, summary: 'No runtime validation.' }],
        },
      ],
    }),
  }
}
const review: DuplicateReview = {
  duplicates: [
    {
      duplicate: { scannerId: 'reliability', fingerprint: 'crash' },
      canonical: { scannerId: 'type-safety', fingerprint: 'contract' },
      reason: 'Both identify the same unchecked external field and validator.',
      inspectedEvidence: [
        {
          path: 'src/input.ts',
          summary:
            'Both cited expressions consume the same unchecked parsed value.',
        },
      ],
    },
  ],
}

describe('cross-scanner duplicate adjudication', () => {
  test('requires adjudication, not just shared file locations', () => {
    const outcomes = [
      outcome('reliability', 'crash'),
      outcome('type-safety', 'contract'),
    ]
    expect(duplicateReviewBatches(outcomes, scanners).batches).toHaveLength(1)
    expect(
      applyDuplicateReviews(outcomes, scanners, [], ['src/input.ts']).flatMap(
        (o) => o.result?.findings ?? [],
      ),
    ).toHaveLength(2)
    expect(
      applyDuplicateReviews(
        outcomes,
        scanners,
        [review],
        ['src/input.ts'],
      ).flatMap((o) => o.result?.findings ?? []),
    ).toHaveLength(1)
  })
  test('resolves an existing duplicate with an explicit link and preserves the canonical fingerprint', () => {
    const inputs = [
      outcome('reliability', 'crash', undefined, 7),
      outcome('type-safety', 'contract', undefined, 4),
    ]
    const configured = scanners.map((s) => ({
      ...s,
      hypotheses:
        s.id === 'reliability'
          ? [
              {
                findingId: 7,
                fingerprint: 'crash',
                title: 'Crash',
                severity: 'high',
                description: '',
                locations: [],
              },
            ]
          : [],
    }))
    const result = applyDuplicateReviews(
      inputs,
      configured,
      [review],
      ['src/input.ts'],
    )
    expect(result[0]?.result?.hypothesisVerdicts[0]).toMatchObject({
      previousFindingId: 7,
      verdict: 'resolved',
      resolutionReason: 'duplicate',
      duplicateOfScannerId: 'type-safety',
      duplicateOfFingerprint: 'contract',
    })
    expect(result[1]?.result?.findings[0]?.fingerprint).toBe('contract')
  })
  test('rejects invented references and unrelated evidence', () => {
    const outcomes = [
      outcome('reliability', 'crash'),
      outcome('type-safety', 'contract', 'other.ts'),
    ]
    expect(duplicateReviewBatches(outcomes, scanners).batches).toEqual([])
    expect(
      applyDuplicateReviews(
        outcomes,
        scanners,
        [review],
        ['src/input.ts'],
      ).flatMap((o) => o.result?.findings ?? []),
    ).toHaveLength(2)
    expect(
      applyDuplicateReviews(
        [outcome('reliability', 'crash')],
        scanners,
        [review],
        ['src/input.ts'],
      )[0]?.result?.findings,
    ).toHaveLength(1)
  })
  test('rejects cycles and conflicting ownership decisions', () => {
    const outcomes = [
      outcome('reliability', 'crash'),
      outcome('type-safety', 'contract'),
    ]
    const decision = review.duplicates[0]
    if (!decision) throw new Error('Missing fixture')
    const cycle = {
      duplicates: [
        decision,
        {
          ...decision,
          duplicate: decision.canonical,
          canonical: decision.duplicate,
        },
      ],
    }
    expect(
      applyDuplicateReviews(
        outcomes,
        scanners,
        [cycle],
        ['src/input.ts'],
      ).flatMap((o) => o.result?.findings ?? []),
    ).toHaveLength(2)
  })
  test('cannot transfer security findings to a non-security owner', () => {
    const outcomes = [
      outcome('security', 'crash'),
      outcome('type-safety', 'contract'),
    ]
    const decision = review.duplicates[0]
    if (!decision) throw new Error('Missing fixture')
    expect(
      applyDuplicateReviews(
        outcomes,
        scanners,
        [
          {
            duplicates: [
              {
                ...decision,
                duplicate: { scannerId: 'security', fingerprint: 'crash' },
              },
            ],
          },
        ],
        ['src/input.ts'],
      ).flatMap((o) => o.result?.findings ?? []),
    ).toHaveLength(2)
  })
  test('retains severity when a duplicate carries a stronger consequence', () => {
    const severe = outcome('reliability', 'crash')
    if (!severe.result?.findings[0]) throw new Error('Missing fixture')
    severe.result.findings[0].severity = 'critical'
    expect(
      applyDuplicateReviews(
        [severe, outcome('type-safety', 'contract')],
        scanners,
        [review],
        ['src/input.ts'],
      )[1]?.result?.findings[0]?.severity,
    ).toBe('critical')
  })
})

test('bounds adjudication cost and explicitly signals unfinished comparisons', () => {
  const many = Array.from({ length: 20 }, (_, index) =>
    outcome(index % 2 ? 'reliability' : 'type-safety', `finding-${index}`),
  )
  const batch = duplicateReviewBatches(many, scanners)
  expect(batch.batches).toHaveLength(8)
  expect(batch.complete).toBe(false)
})

test('unavailable inspected files cannot substantiate a duplicate merge', () => {
  const outcomes = [
    outcome('reliability', 'crash'),
    outcome('type-safety', 'contract'),
  ]
  expect(
    applyDuplicateReviews(outcomes, scanners, [review], []).flatMap(
      (o) => o.result?.findings ?? [],
    ),
  ).toHaveLength(2)
})

test('manual dispositions and deferred hypotheses are not adjudicated away', () => {
  const old = outcome('reliability', 'crash', undefined, 1)
  if (!old.result) throw new Error('Missing fixture')
  old.result.hypothesisVerdicts = [
    { previousFindingId: 1, verdict: 'deferred' },
  ]
  const configured = scanners.map((scanner) =>
    scanner.id === 'reliability'
      ? {
          ...scanner,
          hypotheses: [
            {
              findingId: 1,
              fingerprint: 'crash',
              title: 'Old finding',
              severity: 'high',
              description: '',
              locations: [],
              disposition: 'accepted_risk' as const,
            },
          ],
        }
      : scanner,
  )
  expect(
    duplicateReviewBatches(
      [old, outcome('type-safety', 'contract')],
      configured,
    ).batches,
  ).toEqual([])
  expect(
    applyDuplicateReviews(
      [old, outcome('type-safety', 'contract')],
      configured,
      [review],
      ['src/input.ts'],
    )[0]?.result?.findings,
  ).toHaveLength(1)
})

test('validation uses security capabilities for both built-ins and custom scanners', () => {
  const custom = {
    ...scanners[0],
    id: 'custom-security',
    name: 'Custom security',
    prompt: '',
    attentionHistory: [],
    hypotheses: [],
    securityReview: 'ci' as const,
  }
  const configured = [...scanners, custom]
  const outcomes = [
    outcome('security', 'app'),
    outcome('ci-security', 'workflow'),
    outcome('reliability', 'bug'),
    outcome('custom-security', 'custom'),
  ]
  expect(
    securityValidationCandidates(outcomes, configured).map(
      (candidate) => candidate.scannerId,
    ),
  ).toEqual(['security', 'ci-security', 'custom-security'])
  expect(
    securityValidationCandidates(
      [{ ...outcome('ci-security', 'failed'), status: 'failed' }],
      configured,
    ),
  ).toEqual([])
})
