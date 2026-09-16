# GitNexus Engineering Plan

> Task: Add an operator “Mark as fixed” action in the finding UI and MCP API.
> Evidence verified at commit 00df7d903a4aa6d50d1876997e5dac2b18426f4b; GitNexus index current at the same commit.
> Evidence provenance schema 2; global dirty digest 0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd; cited-path manifest 10 sorted entries; exact generated plan path excluded.

## Objective (§1)

Allow an operator or authorized MCP client to resolve a present finding as fixed, with required context, without assigning a false-positive or accepted-risk disposition. A later scan that rediscovers it must follow the existing resolved-to-regressed lifecycle.

## Current Behaviour (§2–3)

- [verified] `updateFindingDisposition` resolves ignored findings and reopens manually triaged findings, deliberately keeping dispositions distinct from code fixes (`src/lib/server/finding-triage.ts:28-97`).
- [verified] `FindingTriageControls` offers only False positive and Accept risk for findings without a disposition (`src/components/health/finding-triage-controls.tsx:162-190`).
- [verified] MCP exposes those two disposition actions plus reopening through a catalog-driven allowlist (`src/lib/mcp/catalog.ts:85-105`, `src/lib/server/mcp/tools.server.ts:519-572`).
- [verified] `resolved` already exists as a lifecycle event and renders as “Resolved”; no schema or migration is needed (`src/lib/findings.ts:24-45`, `src/components/health/finding-history.tsx:7-19`).

## Findings (§4–5)

- [graph] GitNexus `impact(updateFindingDisposition, upstream, maxDepth:2)` reports LOW risk and four direct callers: the UI server function and three MCP disposition/reopen loaders.
- [graph] GitNexus `impact(FindingTriageControls, upstream, maxDepth:2)` reports LOW risk with `FindingDetailPanel` as its sole direct caller.
- [graph] GitNexus `impact(createCodeTendMcpServer, upstream, maxDepth:2)` reports LOW risk with the HTTP protocol handler and MCP tests as direct dependents.
- [inferred] The fixed action should use a separate mutation so durable ignore behavior and fix reporting cannot be conflated.

## Proposed Changes (§6)

- Add a shared `markFindingFixed` server-only mutation and UI server function in `src/lib/server/finding-triage.ts`; require a meaningful note, set state `resolved`, clear disposition/triage metadata, and append an operator `resolved` event.
- Extend `FindingTriageControls` with a primary “Mark as fixed” action and confirmation dialog explaining that the next scan verifies the claim.
- Add `mark_finding_fixed` to the MCP catalog, loader contract/default implementation, registration, and focused MCP tests.
- Update lifecycle and MCP documentation to distinguish operator-reported fixes from scanner-verified resolutions.

## Implementation Sequence (§7)

1. Implement and test the shared operator resolution mutation and UI action; preserve existing disposition and reopen behavior.
2. Register and test `mark_finding_fixed` in the catalog-driven MCP surface.
3. Update architecture/README wording, run the full verification suite, then review all changes through GitNexus.

## Test Strategy (§8)

- MCP tool listing/call: write scope discovers `mark_finding_fixed`; a call returns a resolved finding with null disposition.
- Validation: a too-short fix note is rejected by the tool schema.
- Existing suite: `bun test`, static checks, typecheck, build, Eve typecheck, and dead-code checks through `bun run verify`.

## Implementation Context (§11)

```yaml
implementation_context:
  task_summary: "Add operator and MCP actions that mark a finding fixed without creating a manual disposition."
  evidence_provenance:
    schema_version: 2
    head_commit: "00df7d903a4aa6d50d1876997e5dac2b18426f4b"
    generated_plan_path: "docs/plans/2026-09-16-gitnexus-plan-mark-finding-fixed.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
    cited_path_manifest:
      - { path: "README.md", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:a4b0cb9d52b07c8056eaae4de0bec164fdf279b0d56d2efbe5fde5da1af5f450", index_digest: "sha256:a4b0cb9d52b07c8056eaae4de0bec164fdf279b0d56d2efbe5fde5da1af5f450", worktree_digest: "sha256:a4b0cb9d52b07c8056eaae4de0bec164fdf279b0d56d2efbe5fde5da1af5f450", untracked_digest: "absent" }
      - { path: "docs/architecture.md", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:f46c7700f358dc7b60670440c410b64cf5b620aa92667acb2b1491f04614a938", index_digest: "sha256:f46c7700f358dc7b60670440c410b64cf5b620aa92667acb2b1491f04614a938", worktree_digest: "sha256:f46c7700f358dc7b60670440c410b64cf5b620aa92667acb2b1491f04614a938", untracked_digest: "absent" }
      - { path: "package.json", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:9934429cfd2b8fa71796be3368409b8e2d1d839cf2e6041dbd0bfaaa8a95e457", index_digest: "sha256:9934429cfd2b8fa71796be3368409b8e2d1d839cf2e6041dbd0bfaaa8a95e457", worktree_digest: "sha256:9934429cfd2b8fa71796be3368409b8e2d1d839cf2e6041dbd0bfaaa8a95e457", untracked_digest: "absent" }
      - { path: "src/components/health/finding-history.tsx", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:8de21e305feae2ec97ee281d555b75d1455fc988b7cd235da4d590f32ea68deb", index_digest: "sha256:8de21e305feae2ec97ee281d555b75d1455fc988b7cd235da4d590f32ea68deb", worktree_digest: "sha256:8de21e305feae2ec97ee281d555b75d1455fc988b7cd235da4d590f32ea68deb", untracked_digest: "absent" }
      - { path: "src/components/health/finding-triage-controls.tsx", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:9edcb9839a6c4fa02666b97fbf96ed163c91b59b18d480fe254bb1cc429744c3", index_digest: "sha256:9edcb9839a6c4fa02666b97fbf96ed163c91b59b18d480fe254bb1cc429744c3", worktree_digest: "sha256:9edcb9839a6c4fa02666b97fbf96ed163c91b59b18d480fe254bb1cc429744c3", untracked_digest: "absent" }
      - { path: "src/lib/findings.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:e16090a8a4050fcc5496f24ae513bcf11b1f6389d30a4e3c8d89b503fb4e5019", index_digest: "sha256:e16090a8a4050fcc5496f24ae513bcf11b1f6389d30a4e3c8d89b503fb4e5019", worktree_digest: "sha256:e16090a8a4050fcc5496f24ae513bcf11b1f6389d30a4e3c8d89b503fb4e5019", untracked_digest: "absent" }
      - { path: "src/lib/mcp/catalog.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:f35149256fdb80d51e41981986bf73e1b29d8128bfef537e596948749c8e2e10", index_digest: "sha256:f35149256fdb80d51e41981986bf73e1b29d8128bfef537e596948749c8e2e10", worktree_digest: "sha256:f35149256fdb80d51e41981986bf73e1b29d8128bfef537e596948749c8e2e10", untracked_digest: "absent" }
      - { path: "src/lib/server/finding-triage.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:36475a64c115c664ce4461781324daab9480e4d94435745910d635d5ff0fb14d", index_digest: "sha256:36475a64c115c664ce4461781324daab9480e4d94435745910d635d5ff0fb14d", worktree_digest: "sha256:36475a64c115c664ce4461781324daab9480e4d94435745910d635d5ff0fb14d", untracked_digest: "absent" }
      - { path: "src/lib/server/mcp/tools.server.test.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:512c994f3ff04bda423410b4746ca54e34b91e396e8342bc750030803e9e36b3", index_digest: "sha256:512c994f3ff04bda423410b4746ca54e34b91e396e8342bc750030803e9e36b3", worktree_digest: "sha256:512c994f3ff04bda423410b4746ca54e34b91e396e8342bc750030803e9e36b3", untracked_digest: "absent" }
      - { path: "src/lib/server/mcp/tools.server.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:651dc944abab091c1ff37f3c8821ddffc456d6f1d4623d63c4f2eee0f66e5537", index_digest: "sha256:651dc944abab091c1ff37f3c8821ddffc456d6f1d4623d63c4f2eee0f66e5537", worktree_digest: "sha256:651dc944abab091c1ff37f3c8821ddffc456d6f1d4623d63c4f2eee0f66e5537", untracked_digest: "absent" }
  files_to_modify:
    - { file: "src/lib/server/finding-triage.ts", symbols: ["markFindingFixed"], intended_change: "Add validated operator resolution transaction and server function." }
    - { file: "src/components/health/finding-triage-controls.tsx", symbols: ["FindingTriageControls"], intended_change: "Add fixed action and confirmation dialog." }
    - { file: "src/lib/mcp/catalog.ts", symbols: ["MCP_TOOL_CATALOG"], intended_change: "Catalog mark_finding_fixed under write scope." }
    - { file: "src/lib/server/mcp/tools.server.ts", symbols: ["McpLoaders", "createCodeTendMcpServer"], intended_change: "Implement and register the MCP tool." }
    - { file: "src/lib/server/mcp/tools.server.test.ts", symbols: ["fakeLoaders", "CodeTend MCP tools"], intended_change: "Cover discovery, invocation, output, and validation." }
    - { file: "README.md", symbols: [], intended_change: "Document fixed action and MCP capability." }
    - { file: "docs/architecture.md", symbols: [], intended_change: "Document operator-reported resolution semantics." }
  tests:
    - file: "src/lib/server/mcp/tools.server.test.ts"
      scenarios:
        - "write-scoped tools/list -> mark_finding_fixed is visible"
        - "valid findingId and fix note -> resolved finding with null disposition"
        - "short fix note -> MCP input validation error"
  verification_commands:
    - "bun test src/lib/server/mcp/tools.server.test.ts"
    - "bun run verify"
  assumptions:
    - "Check before editing that FINDING_EVENT_KINDS still includes resolved and reconciliation still regresses rediscovered resolved findings."
    - "Check that no database constraint requires resolvedScanId for resolved state."
  open_questions: []
  avoid:
    - "Do not add fixed to FINDING_DISPOSITIONS."
    - "Do not give operator-reported fixes durable scanner suppression semantics."
    - "Do not add a database migration unless current constraints prove one necessary."
```

## Assumptions and Open Questions (§12)

- [assumed] A required note of at least five trimmed characters is sufficient operator evidence; verify against surrounding validation conventions before editing.
- No blocking open questions.

## Definition of Done (§13)

- UI and MCP can mark an eligible finding fixed with required context.
- The resulting finding is `resolved`, has no disposition, and records an operator `resolved` event.
- Existing disposition/reopen paths remain unchanged; MCP access controls include the new catalog entry.
- Focused tests and `bun run verify` pass; documentation describes next-scan verification/regression.
