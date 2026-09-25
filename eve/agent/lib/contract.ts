import type {
  GitNexusIndexMetadata,
  PatchRequest,
  PatchResult,
  ScanCheckpoint,
  ScanRequest,
  ScanResult,
} from '../../../src/lib/eve-protocol'

export type {
  GitNexusIndexMetadata,
  PatchRequest,
  PatchResult,
  ScanCheckpoint,
  ScanRequest,
  ScanResult,
}

export type CandidateValidation = ScanResult['validations'][number]
export type DependencyAuditResult = ScanResult['dependencyAudit']
export type InvestigationReport = ScanResult['investigation']
export type KnowledgeResult = ScanResult['knowledge']
export type KnowledgeSummary = KnowledgeResult['summary']
export type PreviousKnowledge = NonNullable<ScanRequest['knowledge']>
export type ScanCoverage = ScanResult['coverage']
export type ScannerOutcome = ScanResult['scanners'][number]
export type ScanRequestScanner = ScanRequest['scanners'][number]
export type SecurityProfile = ScanResult['securityProfile']['profile']
export type SubsystemDependencyGraph = NonNullable<
  ScanResult['knowledge']['dependencyGraph']
>
export type SubsystemDependencyCycle =
  SubsystemDependencyGraph['cycles'][number]

/** Manifest for the disposable checkout; this is internal to Eve. */
export interface WorkspaceManifest {
  readonly name: string
  readonly hostPath: string
  readonly commitSha: string
  readonly fileCount: number
  readonly files: readonly { path: string; hash: string; size: number }[]
  readonly topLevel: readonly string[]
}
