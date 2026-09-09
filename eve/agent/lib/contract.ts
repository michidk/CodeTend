/**
 * File-based contract between the app and the Eve runtime. The app writes
 * `requests/scan-<id>.json`, Eve writes `results/scan-<id>.json`. Keeping the
 * payloads out of the model conversation makes the root turn trivial ("run
 * scan 42") and the results size-independent.
 */
export interface ScanRequestScanner {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly hypotheses: readonly ScanHypothesis[]
}

export interface ScanHypothesis {
  readonly findingId: number
  readonly fingerprint: string
  readonly title: string
  readonly severity: string
  readonly description: string
  readonly locations: readonly {
    path: string
    startLine?: number
    endLine?: number
    symbol?: string
  }[]
}

export interface PreviousKnowledge {
  readonly overview: string
  readonly summary: KnowledgeSummary
  readonly sources: readonly { path: string; hash: string }[]
  readonly fileCount: number | null
}

export interface KnowledgeSummary {
  readonly languages: string[]
  readonly frameworks: string[]
  readonly subsystems: {
    name: string
    paths: string[]
    responsibility: string
  }[]
  readonly concepts: string[]
}

export interface ScanRequest {
  readonly scanId: number
  readonly repositoryId: number
  readonly repositoryName: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly gitnexus: boolean
  readonly knowledge: PreviousKnowledge | null
  readonly scanners: readonly ScanRequestScanner[]
  readonly outputSchema: Record<string, unknown>
}

export interface WorkspaceManifest {
  readonly name: string
  readonly hostPath: string
  readonly commitSha: string
  readonly fileCount: number
  readonly files: readonly { path: string; hash: string; size: number }[]
  readonly topLevel: readonly string[]
}

export interface KnowledgeResult {
  readonly refreshed: boolean
  readonly overview: string
  readonly summary: KnowledgeSummary
  readonly sources: readonly { path: string; hash: string }[]
  readonly reason: string
}

export interface ScannerOutcome {
  readonly scannerId: string
  readonly status: 'completed' | 'failed'
  readonly result?: unknown
  readonly error?: string
  readonly startedAt: string
  readonly finishedAt: string
}

export interface ScanResult {
  readonly scanId: number
  readonly commitSha: string
  readonly fileCount: number
  readonly gitnexusUsed: boolean
  readonly knowledge: KnowledgeResult
  readonly scanners: readonly ScannerOutcome[]
  readonly finishedAt: string
}
