# GitNexus Engineering Plan

> Task: Persist and reuse one GitNexus index per repository across CodeTend scans, and record compact per-scan index metadata in PostgreSQL.
> Evidence verified at commit 91c255489c604318bdbcb755de6f71f27c980b35; GitNexus index refreshed this session (`--index-only --pdg`, CLI 1.6.11).
> Evidence provenance schema 2; global dirty digest `0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd`; cited-path manifest 14 sorted entries; exact generated plan path excluded.

## 1. Objective

Replace scan-scoped GitNexus indexes with a stable per-repository checkout and index that GitNexus can reuse on an unchanged commit or incrementally refresh on a changed commit. Preserve compact, queryable metadata on each scan while leaving the binary graph database on the shared persistent volume.

## 2. Current Behaviour

- [verified] `cloneRepository` creates a fresh shallow checkout named `repo-{repositoryId}-scan-{scanId}` for every scan (`eve/agent/lib/repository-workspaces.ts:63`).
- [verified] `indexWithGitNexus` analyzes that transient checkout under the same scan-scoped name and returns only `{ ok, detail }` (`eve/agent/lib/analysis-tools.ts:70`).
- [verified] `prepareScanWorkflow` runs indexing before the knowledge agent and passes the scan-scoped registry name to all agents (`eve/agent/tools/run_scan.ts:201`).
- [verified] checkpoints and final results carry only `gitnexusUsed`; ingestion persists only that boolean (`src/lib/eve-protocol.ts:228`, `src/lib/server/scan-result-ingestion.server.ts:61`).
- [verified] every terminal cleanup removes the scan-scoped registry entry and transient checkout (`src/lib/server/scan-recovery.server.ts:247`). Repository deletion repeats that cleanup for every historic scan (`src/lib/server/repositories.ts:280`).

## 3. Relevant Architecture

- [verified] Eve and the app share `TECDEBT_DATA_DIR`; Eve owns repository checkout/index preparation while the app owns lifecycle cleanup and database ingestion.
- [verified] the app's MCP server and Eve CLI share `GITNEXUS_HOME`, so a stable registry name remains queryable by launched agents (`src/lib/server/gitnexus.server.ts:20`, `eve/agent/lib/paths.ts:16`).
- [verified] scan result/checkpoint files are validated through shared Zod schemas before ingestion, providing the compatibility boundary for structured metadata (`src/lib/eve-protocol.ts:228`, `src/lib/server/scan-files.server.ts:76`).
- [verified] the database prevents more than one queued/running scan per repository, so a single per-repository index has one writer (`src/db/schema.ts:321`).
- [inferred] the binary LadybugDB index should remain on the persistent filesystem: the observed local index is about 91 MB, while PostgreSQL needs only identity, commit, refresh mode, version, capability, and statistics metadata.

## 4. GitNexus Findings

- [graph] `context/impact` for `indexWithGitNexus` found one direct production caller, `prepareScanWorkflow`, so its signature can change locally with low call-graph risk.
- [graph] `impact(repo=/home/vibepod/workspaces/codetend, target=cleanupScanFiles)` reported CRITICAL impact through `superviseScanExecution`, `adoptScan`, `cancelScanRecord`, and `failScan`; transient cleanup semantics must remain intact for all four paths.
- [graph] `query(repo=codetend, search_query="writeScanCheckpoint ScanCheckpoint persistence scan workflow")` located `runScannerBatches → readScanCheckpoint` and the ingestion process through `persistScanCheckpointUnlocked`, confirming metadata must be threaded through both checkpoint and final-result paths.
- [verified] GitNexus metadata includes `indexedAt`, `lastCommit`, `stats`, `capabilities`, and `runnerIdentity.cliVersion/schemaVersion`; these are sufficient for a compact scan record.

## 5. Statement-Level PDG Findings

- [graph] `pdg_query(mode=controls,target=indexWithGitNexus)` shows nonzero CLI exit and thrown-process branches both return a failed optional-enrichment result; new checkout/metadata parsing failures must preserve this degradation policy.
- [graph] `pdg_query(mode=flows,target=indexWithGitNexus,variable=workspace)` shows the transient workspace currently flows directly into the analyze path/name; introduce the stable checkout before that use and keep the exact `workspace.commitSha` as its source of truth.
- [graph] `pdg_query(mode=controls,target=prepareScanWorkflow)` confirms all indexing and repository-name assignment are controlled by `request.gitnexus`, and agents only receive a name after successful indexing.
- [graph] `pdg_query(mode=controls,target=cleanupScanFiles)` shows two independent best-effort cleanup branches. Remove only the index-removal branch; preserve best-effort transient workspace/artifact cleanup.

## 6. Proposed Changes

- `eve/agent/lib/paths.ts`: add stable `gitnexusRepositoriesDir()` and `gitnexusRepositoryName(repositoryId)` helpers.
- `eve/agent/lib/repository-workspaces.ts`: add a step that initializes a persistent per-repository Git checkout, fetches the exact scan commit locally, force-checks it out, removes stale untracked files while preserving `.gitnexus`, and returns a stable manifest.
- `eve/agent/lib/analysis-tools.ts`: analyze the stable checkout without forcing rebuilds; inspect pre/post `.gitnexus/gitnexus.json`; return structured metadata with `built`, `reused`, or `refreshed` mode.
- `src/lib/eve-protocol.ts` and `eve/agent/tools/run_scan.ts`: define and thread GitNexus index metadata through prepared state, checkpoints, and final results while retaining `gitnexusUsed` for compatibility.
- `src/db/schema.ts`, `drizzle/0027_persistent_gitnexus_index.sql`, and generated Drizzle metadata: add nullable JSONB `scans.gitnexus_index`.
- `src/lib/server/scan-result-ingestion.server.ts`: persist metadata from checkpoints and final results.
- `src/lib/server/scan-recovery.server.ts`: stop deleting the stable index on per-scan terminal cleanup.
- `src/lib/server/scan-files.server.ts`, `src/lib/server/gitnexus.server.ts`, and `src/lib/server/repositories.ts`: delete the stable registry entry and checkout once when its repository is deleted.
- Tests: verify checkout reuse/preservation/stale-file removal and protocol compatibility/validation.

## 7. Implementation Sequence

1. Add the shared metadata schema/type and stable path/name helpers.
2. Implement and unit-test exact-commit synchronization of the persistent checkout, preserving `.gitnexus` while removing stale source files.
3. Update indexing to use the stable checkout and derive post-analysis metadata plus refresh mode.
4. Thread metadata through Eve workflow checkpoints/final results and add protocol tests.
5. Add the database column/migration and persist both checkpoint and final-result metadata.
6. Change lifecycle ownership: terminal scan cleanup remains transient-only; repository deletion removes the stable registry and checkout once.
7. Run focused tests, full checks/typechecks/build, refresh GitNexus, and review all changed-flow impact before commit.

## 8. Test Strategy

- `eve/tests/repository-workspaces.test.ts`: first preparation checks out the requested commit; a second changed commit reuses the directory, removes stale untracked source, and preserves a `.gitnexus` sentinel.
- `src/lib/eve-protocol.test.ts`: structured metadata parses; old results without metadata default to `null`; malformed modes/stats are rejected.
- Existing server execution tests must remain green, proving optional GitNexus failure and terminal cleanup orchestration are unaffected.
- Verification: `bun test eve/tests/repository-workspaces.test.ts src/lib/eve-protocol.test.ts`; `bun run check`; `bun run test`; `bun run typecheck`; `bun run eve:typecheck`; `bun run build`; `bun run lint:deadcode`.

## 9. Risk and Impact Analysis

- `cleanupScanFiles` is CRITICAL-impact: all four direct terminal-path callers still need transient workspace/artifact cleanup; only index deletion moves to repository ownership.
- Exact-commit correctness: persistent source must be reset/cleaned before analysis so removed or untracked files cannot leak between scans.
- Failure compatibility: GitNexus remains optional; sync/analyze/metadata failures produce no metadata and scanners continue without graph tools.
- Concurrency: the existing unique active-scan index serializes writers per repository; different repositories use different directories/names.
- Migration: nullable JSONB is backward compatible and historic scans remain valid.
- Storage: indexes now intentionally accumulate per configured repository until repository deletion; no graph bytes enter PostgreSQL.
- Durable retries: rerunning the step at the same commit is idempotent and GitNexus can report/reuse the already-current index.

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `eve/agent/lib/paths.ts` | path/name helpers | Stable per-repository location and identity |
| `eve/agent/lib/repository-workspaces.ts` | persistent checkout preparation | Synchronize exact scan commit safely |
| `eve/agent/lib/analysis-tools.ts` | `indexWithGitNexus` | Reuse index and return metadata |
| `eve/agent/tools/run_scan.ts` | prepared/checkpoint/final workflow state | Carry stable name and metadata |
| `eve/tests/repository-workspaces.test.ts` | new tests | Checkout reuse regression coverage |
| `src/lib/eve-protocol.ts` | result/checkpoint schemas | Shared metadata contract |
| `src/lib/eve-protocol.test.ts` | protocol tests | Compatibility and validation |
| `src/db/schema.ts` | `scans` | Nullable JSONB metadata column |
| `drizzle/0027_persistent_gitnexus_index.sql` + metadata | migration | Deploy schema change |
| `src/lib/server/scan-result-ingestion.server.ts` | checkpoint/result persistence | Save metadata |
| `src/lib/server/scan-recovery.server.ts` | `cleanupScanFiles` | Retain stable indexes across scans |
| `src/lib/server/scan-files.server.ts` | stable checkout cleanup | Filesystem repository deletion |
| `src/lib/server/gitnexus.server.ts` | cleanup documentation | Repository-scoped registry semantics |
| `src/lib/server/repositories.ts` | `deleteRepository` | Delete stable index exactly once |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: 'Persist and incrementally reuse one GitNexus index per repository; store compact per-scan metadata in PostgreSQL.'
  acceptance_criteria:
    - 'Same-commit scans retain and reuse the existing index.'
    - 'Changed-commit scans synchronize exact source and let GitNexus incrementally refresh.'
    - 'Per-scan cleanup does not delete the stable index; repository deletion does.'
    - 'Checkpoints and final scan rows contain nullable structured index metadata.'
  evidence_provenance:
    schema_version: 2
    head_commit: '91c255489c604318bdbcb755de6f71f27c980b35'
    generated_plan_path: 'docs/plans/2026-09-25-gitnexus-plan-persistent-index-reuse.md'
    global_dirty_digest:
      algorithm: 'sha256'
      canonicalization: 'gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records'
      value: '0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd'
    cited_path_manifest:
      - { path: 'drizzle/0027_persistent_gitnexus_index.sql', object_kind: { head: absent, index: absent, worktree: absent, untracked: absent }, state: absent, rename_from: null, rename_to: null, head_digest: absent, index_digest: absent, worktree_digest: absent, untracked_digest: absent }
      - { path: 'eve/agent/lib/analysis-tools.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:66f94307224ca38fffd7e02d0d2f8f592bd04a50d4e6210d988c3cea8a1f7143', index_digest: 'sha256:66f94307224ca38fffd7e02d0d2f8f592bd04a50d4e6210d988c3cea8a1f7143', worktree_digest: 'sha256:66f94307224ca38fffd7e02d0d2f8f592bd04a50d4e6210d988c3cea8a1f7143', untracked_digest: absent }
      - { path: 'eve/agent/lib/paths.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:8bff1dc6fac6686412e2138a5fabc6da71b7d4069eec71ab44362b0db29c6dd2', index_digest: 'sha256:8bff1dc6fac6686412e2138a5fabc6da71b7d4069eec71ab44362b0db29c6dd2', worktree_digest: 'sha256:8bff1dc6fac6686412e2138a5fabc6da71b7d4069eec71ab44362b0db29c6dd2', untracked_digest: absent }
      - { path: 'eve/agent/lib/repository-workspaces.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:408483988f0a36b082f7016a30f3c6a79a81c2e3affda981637313ce9f862465', index_digest: 'sha256:408483988f0a36b082f7016a30f3c6a79a81c2e3affda981637313ce9f862465', worktree_digest: 'sha256:408483988f0a36b082f7016a30f3c6a79a81c2e3affda981637313ce9f862465', untracked_digest: absent }
      - { path: 'eve/agent/tools/run_scan.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:2b3665a1f97ff83fb6db5008e865051b9661b45661c3afc7100bc47ce6486970', index_digest: 'sha256:2b3665a1f97ff83fb6db5008e865051b9661b45661c3afc7100bc47ce6486970', worktree_digest: 'sha256:2b3665a1f97ff83fb6db5008e865051b9661b45661c3afc7100bc47ce6486970', untracked_digest: absent }
      - { path: 'eve/tests/repository-workspaces.test.ts', object_kind: { head: absent, index: absent, worktree: absent, untracked: absent }, state: absent, rename_from: null, rename_to: null, head_digest: absent, index_digest: absent, worktree_digest: absent, untracked_digest: absent }
      - { path: 'src/db/schema.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:c80ec22ee2ba0a40e7c250469c18fd7c1a16f205c35e165d92664f508bff5e7a', index_digest: 'sha256:c80ec22ee2ba0a40e7c250469c18fd7c1a16f205c35e165d92664f508bff5e7a', worktree_digest: 'sha256:c80ec22ee2ba0a40e7c250469c18fd7c1a16f205c35e165d92664f508bff5e7a', untracked_digest: absent }
      - { path: 'src/lib/eve-protocol.test.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:e41ff9636501cda86d04eb3c2d1b54b1c2a338780825b63bd54153652b2e86d1', index_digest: 'sha256:e41ff9636501cda86d04eb3c2d1b54b1c2a338780825b63bd54153652b2e86d1', worktree_digest: 'sha256:e41ff9636501cda86d04eb3c2d1b54b1c2a338780825b63bd54153652b2e86d1', untracked_digest: absent }
      - { path: 'src/lib/eve-protocol.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:db53df581b09537a39e6c7063c3be71e6530635e8bba8e1e5187ae9ed37625f3', index_digest: 'sha256:db53df581b09537a39e6c7063c3be71e6530635e8bba8e1e5187ae9ed37625f3', worktree_digest: 'sha256:db53df581b09537a39e6c7063c3be71e6530635e8bba8e1e5187ae9ed37625f3', untracked_digest: absent }
      - { path: 'src/lib/server/gitnexus.server.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:cbaa4ca76b18e85ed96831e553854ff64860939ccc8cd58b4712cd72e3f883f5', index_digest: 'sha256:cbaa4ca76b18e85ed96831e553854ff64860939ccc8cd58b4712cd72e3f883f5', worktree_digest: 'sha256:cbaa4ca76b18e85ed96831e553854ff64860939ccc8cd58b4712cd72e3f883f5', untracked_digest: absent }
      - { path: 'src/lib/server/repositories.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:fceffd02b12147d79d0601c343e7113650179b1b93372f3b641d72952d641089', index_digest: 'sha256:fceffd02b12147d79d0601c343e7113650179b1b93372f3b641d72952d641089', worktree_digest: 'sha256:fceffd02b12147d79d0601c343e7113650179b1b93372f3b641d72952d641089', untracked_digest: absent }
      - { path: 'src/lib/server/scan-files.server.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:9a65d8e5abf06c1aee9c8f74abf68a50c912f1547452dccb8ecffb8b38f925af', index_digest: 'sha256:9a65d8e5abf06c1aee9c8f74abf68a50c912f1547452dccb8ecffb8b38f925af', worktree_digest: 'sha256:9a65d8e5abf06c1aee9c8f74abf68a50c912f1547452dccb8ecffb8b38f925af', untracked_digest: absent }
      - { path: 'src/lib/server/scan-recovery.server.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:d010abe569875d93a26d31326b9ffc6cb5a942775c7da800127361276fbd70f4', index_digest: 'sha256:d010abe569875d93a26d31326b9ffc6cb5a942775c7da800127361276fbd70f4', worktree_digest: 'sha256:d010abe569875d93a26d31326b9ffc6cb5a942775c7da800127361276fbd70f4', untracked_digest: absent }
      - { path: 'src/lib/server/scan-result-ingestion.server.ts', object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: 'sha256:45ce7eb6a7191567820abcac85bcb5002d0b43600cfd2cce1b78b288472ad245', index_digest: 'sha256:45ce7eb6a7191567820abcac85bcb5002d0b43600cfd2cce1b78b288472ad245', worktree_digest: 'sha256:45ce7eb6a7191567820abcac85bcb5002d0b43600cfd2cce1b78b288472ad245', untracked_digest: absent }
  primary_symbols:
    - { symbol: indexWithGitNexus, file: eve/agent/lib/analysis-tools.ts, lines: '70-122', role: 'Stable analysis and metadata producer' }
    - { symbol: prepareScanWorkflow, file: eve/agent/tools/run_scan.ts, lines: '201-321', role: 'Index lifecycle orchestration' }
    - { symbol: cleanupScanFiles, file: src/lib/server/scan-recovery.server.ts, lines: '247-267', role: 'Terminal scan cleanup boundary' }
  related_symbols:
    - { symbol: cloneRepository, relationship: CALLS, relevance: 'Produces authoritative exact-commit transient checkout' }
    - { symbol: persistScanCheckpointUnlocked, relationship: persistence, relevance: 'Stores incremental scan state' }
    - { symbol: persistScanResultUnlocked, relationship: persistence, relevance: 'Stores terminal scan state' }
    - { symbol: deleteRepository, relationship: ownership, relevance: 'Final stable-index cleanup owner' }
  execution_path:
    - 'Clone transient exact-commit scan workspace.'
    - 'Synchronize stable per-repository checkout from transient workspace.'
    - 'Analyze stable checkout; GitNexus reuses, incrementally refreshes, or rebuilds as needed.'
    - 'Pass stable registry name to knowledge/scanner agents.'
    - 'Persist metadata in checkpoints/final result and scans.gitnexus_index.'
    - 'Delete transient scan files; retain index until repository deletion.'
  pdg_constraints:
    - { description: 'Indexing remains request.gitnexus-gated and failure tolerant.', affected_statements: ['eve/agent/tools/run_scan.ts:255', 'eve/agent/lib/analysis-tools.ts:104'], implementation_consequence: 'Never fail the scan solely because index preparation or analysis fails.' }
    - { description: 'Terminal cleanup has independent best-effort behavior.', affected_statements: ['src/lib/server/scan-recovery.server.ts:247'], implementation_consequence: 'Remove only stable-index deletion; preserve transient cleanup and warning behavior.' }
  architectural_patterns:
    - { pattern: 'Shared-volume Eve/app boundary', example_location: 'eve/agent/lib/paths.ts and src/lib/server/scan-files.server.ts', usage_guidance: 'Mirror deterministic directory naming in both runtimes.' }
    - { pattern: 'Zod-validated file protocol', example_location: 'src/lib/eve-protocol.ts', usage_guidance: 'Define metadata once and infer TypeScript types.' }
  files_to_modify:
    - { file: eve/agent/lib/paths.ts, symbols: [gitnexusRepositoriesDir, gitnexusRepositoryName], intended_change: 'Stable paths and names.' }
    - { file: eve/agent/lib/repository-workspaces.ts, symbols: [prepareGitNexusRepository], intended_change: 'Exact-commit persistent checkout sync.' }
    - { file: eve/agent/lib/analysis-tools.ts, symbols: [indexWithGitNexus], intended_change: 'Analyze stable checkout and return metadata.' }
    - { file: eve/agent/tools/run_scan.ts, symbols: [prepareScanWorkflow, runScannerBatches, finalizeScanWorkflow], intended_change: 'Thread metadata.' }
    - { file: src/lib/eve-protocol.ts, symbols: [gitnexusIndexMetadataSchema, scanResultSchema, scanCheckpointSchema], intended_change: 'Protocol contract.' }
    - { file: src/db/schema.ts, symbols: [scans], intended_change: 'JSONB column.' }
    - { file: src/lib/server/scan-result-ingestion.server.ts, symbols: [persistScanCheckpointUnlocked, persistScanResultUnlocked], intended_change: 'Persist metadata.' }
    - { file: src/lib/server/scan-recovery.server.ts, symbols: [cleanupScanFiles], intended_change: 'Retain stable index.' }
    - { file: src/lib/server/repositories.ts, symbols: [deleteRepository], intended_change: 'Repository-owned cleanup.' }
  tests:
    - { file: eve/tests/repository-workspaces.test.ts, scenarios: ['first sync → exact commit', 'second sync → same directory and new commit', 'stale untracked source → removed', '.gitnexus sentinel → preserved'] }
    - { file: src/lib/eve-protocol.test.ts, scenarios: ['structured metadata → parsed', 'legacy omission → null', 'invalid refresh mode → rejected'] }
  verification_commands:
    - 'bun test eve/tests/repository-workspaces.test.ts src/lib/eve-protocol.test.ts'
    - 'bun run check'
    - 'bun run test'
    - 'bun run typecheck'
    - 'bun run eve:typecheck'
    - 'bun run build'
    - 'bun run lint:deadcode'
  risks:
    - 'CRITICAL cleanup symbol serves four terminal scan paths.'
    - 'Persistent checkout must not retain stale untracked source.'
    - 'Repository deletion must clean registry and filesystem even if either fails.'
  assumptions:
    - 'Verify `git fetch <transient-path> <sha>` works with the shallow transient checkout using the new integration test.'
    - 'Verify Drizzle generates migration 0027 with the planned name before citing it in the implementation commit.'
  open_questions: []
  avoid:
    - 'Do not store LadybugDB graph bytes in PostgreSQL.'
    - 'Do not delete the stable index during scan completion, failure, cancellation, or adoption.'
    - 'Do not broaden GitNexus failure into scan failure.'
    - 'Do not touch repository-local tool-state directories except the runtime-owned target repositories during scans.'
```

## 12. Assumptions and Open Questions

- [assumed] local SHA fetch from a shallow transient checkout is supported by the installed Git; the integration test will verify it before relying on it.
- [assumed] Drizzle accepts the requested migration name `0027_persistent_gitnexus_index`; generation will verify and the plan citation will be adjusted only through the skill workflow if it differs.
- No product choice remains open: indexes live on the existing persistent shared volume and metadata lives in PostgreSQL.

## 13. Definition of Done

- Repeated scans of the same repository use stable `repo-{repositoryId}` GitNexus identity and filesystem location.
- Same commits report `reused`; changed commits report `refreshed`; first successful indexes report `built`.
- Agents receive the stable registry name only after successful analysis.
- Scan checkpoint/result JSON and `scans.gitnexus_index` retain validated metadata while legacy results remain readable.
- All terminal scan paths remove transient files without removing the stable index.
- Repository deletion best-effort removes both the stable registry entry and persistent checkout.
- Focused and full verification commands pass, GitNexus change detection is reviewed, changes are committed and pushed to `main`.
