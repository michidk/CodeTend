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
  readonly classification?: {
    readonly cwes: readonly string[]
    readonly owasp: readonly string[]
  } | null
  readonly securityContext?: {
    readonly reachability: string
    readonly exposure: string
    readonly dataSensitivity: string
  } | null
  readonly disposition?: 'false_positive' | 'accepted_risk' | null
  readonly dispositionNote?: string | null
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
  /** Commit analyzed by the previous completed scan, if any. */
  readonly previousCommitSha: string | null
  readonly target:
    | { readonly kind: 'repository' }
    | { readonly kind: 'paths'; readonly paths: readonly string[] }
    | { readonly kind: 'diff'; readonly base: string; readonly head: string }
  readonly maxCostUsd: number | null
  /** Maximum source files the model-backed steps may inspect. */
  readonly maxFiles?: number
  /** Glob applied to target paths before the model-backed file budget. */
  readonly fileGlob?: string
  readonly securityProfile: SecurityProfile | null
  readonly validation: {
    readonly enabled: boolean
    readonly runner: 'auto' | 'docker' | 'disabled'
    readonly image: string
  }
  readonly scanners: readonly ScanRequestScanner[]
  readonly outputSchema: Record<string, unknown>
}

export interface SecurityProfile {
  readonly projectOverview: string
  readonly assets: readonly string[]
  readonly entryPoints: readonly string[]
  readonly trustBoundaries: readonly string[]
  readonly authAssumptions: readonly string[]
  readonly sensitiveDataPaths: readonly string[]
  readonly privilegedActions: readonly string[]
  readonly securityInvariants: readonly string[]
  readonly priorities: readonly string[]
  readonly exclusions: readonly string[]
}

export interface WorkspaceManifest {
  readonly name: string
  readonly hostPath: string
  readonly commitSha: string
  readonly fileCount: number
  readonly files: readonly { path: string; hash: string; size: number }[]
  readonly topLevel: readonly string[]
}

export interface SubsystemDependencyEdge {
  readonly source: string
  readonly target: string
  readonly weight: number
}

export interface SubsystemDependencyCycle {
  readonly files: string[]
  readonly subsystems: string[]
}

export interface SubsystemDependencyGraph {
  readonly edges: SubsystemDependencyEdge[]
  readonly cycles: SubsystemDependencyCycle[]
  readonly cycleStatus: 'clean' | 'cycles_found' | 'unavailable'
  readonly componentCount: number | null
}

export interface KnowledgeResult {
  readonly refreshed: boolean
  readonly overview: string
  readonly summary: KnowledgeSummary
  readonly sources: readonly { path: string; hash: string }[]
  readonly reason: string
  readonly dependencyGraph: SubsystemDependencyGraph
}

export interface ScannerOutcome {
  readonly scannerId: string
  readonly status: 'completed' | 'failed'
  readonly result?: unknown
  readonly error?: string
  readonly startedAt: string
  readonly finishedAt: string
}

export interface DependencyAuditResult {
  readonly status: 'completed' | 'unavailable' | 'failed'
  readonly report?: unknown
  readonly error?: string
  readonly toolVersion?: string
}

export interface ScanResult {
  readonly scanId: number
  readonly commitSha: string
  readonly fileCount: number
  readonly gitnexusUsed: boolean
  readonly knowledge: KnowledgeResult
  readonly securityProfile: {
    readonly profile: SecurityProfile
    readonly generated: boolean
  }
  readonly dependencyAudit: DependencyAuditResult
  readonly scanners: readonly ScannerOutcome[]
  readonly coverage: ScanCoverage
  readonly validations: readonly CandidateValidation[]
  readonly targetFiles: readonly string[]
  readonly targetFileCount: number
  readonly finishedAt: string
}

export interface ScanCoverage {
  readonly completeness: 'complete' | 'partial' | 'unknown'
  readonly reviewed: readonly string[]
  readonly deferred: readonly { path: string; reason: string }[]
  readonly excluded: readonly { path: string; reason: string }[]
  readonly openQuestions: readonly string[]
}

export interface CandidateValidation {
  readonly scannerId: string
  readonly fingerprint: string
  readonly status:
    | 'not_run'
    | 'confirmed'
    | 'not_reproduced'
    | 'inconclusive'
    | 'unavailable'
    | 'error'
  readonly method: string
  readonly summary: string
  readonly commands: readonly {
    command: string
    purpose: string
    timeoutSeconds: number
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
    durationMs: number
  }[]
  readonly proofGaps: readonly string[]
  readonly runner: string
  readonly validatedAt: string
}

export interface PatchRequest {
  readonly patchId: number
  readonly repositoryId: number
  readonly repositoryName: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly revision: string
  readonly finding: {
    readonly id: number
    readonly title: string
    readonly severity: string
    readonly description: string
    readonly rootCause: string | null
    readonly whyItMatters: string
    readonly recommendation: string
    readonly locations: readonly {
      readonly path: string
      readonly startLine?: number
      readonly endLine?: number
      readonly symbol?: string
    }[]
    readonly codeEvidence:
      | readonly {
          readonly path: string
          readonly startLine?: number
          readonly endLine?: number
          readonly symbol?: string
          readonly role: string
          readonly excerpt?: string
        }[]
      | null
    readonly validationPlan: {
      readonly method: string
      readonly commands: readonly {
        readonly command: string
        readonly purpose: string
        readonly timeoutSeconds: number
      }[]
    } | null
    readonly remediationTests: readonly string[] | null
    readonly preventiveControls: readonly string[] | null
  }
  readonly validation: ScanRequest['validation']
}

export interface PatchResult {
  readonly patchId: number
  readonly status: 'proposed' | 'verified' | 'failed'
  readonly summary: string
  readonly diff: string
  readonly changedFiles: readonly string[]
  readonly testRecommendations: readonly string[]
  readonly verification: CandidateValidation | null
  readonly error?: string
  readonly finishedAt: string
}
