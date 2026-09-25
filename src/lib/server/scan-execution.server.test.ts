import { describe, expect, test } from 'bun:test'
import type { ScanResult } from '@/lib/eve-protocol'
import type { EveScanSession } from '@/lib/server/eve-client.server'
import { waitForScanSessionResult } from '@/lib/server/scan-execution.server'

const result: ScanResult = {
  scanId: 9,
  commitSha: 'abcdef0123456789abcdef0123456789abcdef01',
  fileCount: 1,
  gitnexusUsed: false,
  gitnexusIndex: null,
  knowledge: {
    refreshed: false,
    overview: '',
    summary: { languages: [], frameworks: [], subsystems: [], concepts: [] },
    sources: [],
    reason: 'Test fixture.',
    dependencyGraph: {
      edges: [],
      cycles: [],
      cycleStatus: 'unavailable',
      componentCount: null,
    },
  },
  securityProfile: {
    generated: false,
    profile: {
      projectOverview: '',
      assets: [],
      entryPoints: [],
      trustBoundaries: [],
      authAssumptions: [],
      sensitiveDataPaths: [],
      privilegedActions: [],
      securityInvariants: [],
      priorities: [],
      exclusions: [],
    },
  },
  dependencyAudit: {
    status: 'unavailable',
    error: 'Disabled in test.',
    exploitabilityAssessments: [],
  },
  scanners: [],
  investigation: {
    strategy: 'Exercise scan session supervision.',
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
  validations: [],
  finishedAt: '2026-09-24T00:00:00.000Z',
}

function session(settle: EveScanSession['settle']): EveScanSession {
  return { sessionId: 'scan-session-9', settle }
}

describe('scan session supervision', () => {
  test('accepts a durable result before the Eve stream settles', async () => {
    const received = await waitForScanSessionResult(
      9,
      session(async () => new Promise(() => {})),
      async () => undefined,
      {
        waitForResultWithCheckpoints: async () => null,
        waitForResult: async () => undefined,
        readResult: async () => result,
        cancelAndDrain: async () => undefined,
        onProgress: async () => undefined,
      },
    )

    expect(received).toEqual(result)
  })

  test('reports cancellation progress and drains a timed-out session', async () => {
    const cancelled: string[] = []
    const phases: string[] = []
    await expect(
      waitForScanSessionResult(
        9,
        session(async () => new Promise(() => {})),
        async () => undefined,
        {
          waitForResultWithCheckpoints: async () => {
            throw new Error('scan deadline')
          },
          waitForResult: async () => undefined,
          readResult: async () => null,
          cancelAndDrain: async (sessionId) => {
            cancelled.push(sessionId)
          },
          onProgress: async (_scanId, progress) => {
            phases.push(progress.phase)
          },
        },
      ),
    ).rejects.toThrow('scan deadline')
    expect(cancelled).toEqual(['scan-session-9'])
    expect(phases).toEqual(['cancelling'])
  })

  test('ingests a streamed checkpoint before reporting a missing result', async () => {
    let checkpoints = 0
    await expect(
      waitForScanSessionResult(
        9,
        session(async (onProgress) => {
          await onProgress({ phase: 'scanning', completed: 1, total: 2 })
          return {
            status: 'failed',
            message: undefined,
            failure: 'agent failed',
          }
        }),
        async () => {
          checkpoints += 1
        },
        {
          waitForResultWithCheckpoints: async () => new Promise(() => {}),
          waitForResult: async () => undefined,
          readResult: async () => null,
          cancelAndDrain: async () => undefined,
          onProgress: async () => undefined,
        },
      ),
    ).rejects.toThrow('agent failed')
    expect(checkpoints).toBe(1)
  })
})
