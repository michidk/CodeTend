# GitNexus Engineering Plan

> Task: Make vulnerable-dependency priority reflect an agent-verified practical attack path in the scanned repository.
> Evidence verified at commit 67cc5d36e1e0f2f4d2db5e575cdacd904f4e1e63; GitNexus index refreshed this session with `gitnexus analyze --index-only --pdg`.
> Evidence provenance schema 2; global dirty digest 0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd; cited-path manifest 9 sorted entries; exact generated plan path excluded.

## 1. Objective

Require CodeTend's scanner agent to inspect each OSV dependency candidate in repository context and establish a realistic attacker-controlled source, reachable vulnerable behavior, and meaningful impact before CVSS/EPSS/KEV can produce high contextual priority. Preserve the published advisory severity independently.

## 2. Current Behaviour

- [verified] `run_scan.execute` independently reviews Security Hygiene findings after discovery, but writes the raw dependency audit without an equivalent review (`eve/agent/tools/run_scan.ts:300-369`).
- [verified] `dependencyFindingsFromMatches` derives dependency priority directly from CVSS, EPSS, KEV, and fix availability, and does not accept exploitability evidence (`src/lib/vulnerabilities.ts:177-299`, `348-385`).
- [verified] Server ingestion enriches OSV matches only after Eve has written the result, so the application currently receives no agent assessment to join to those matches (`src/lib/server/scan-result-ingestion.server.ts:519-560`).
- [verified] The existing source-security review already defaults unconfirmed attack paths to low contextual priority while retaining severity (`eve/agent/lib/security-review.ts:50-149`, `src/lib/vulnerabilities.ts:387-430`).

## 3. Relevant Architecture

- [verified] Eve owns repository checkout, security-profile context, GitNexus access, and agent execution; the app owns OSV parsing, public threat-intelligence enrichment, persistence, and scoring.
- [inferred] The smallest stable boundary is an additive dependency-impact assessment in `dependencyAudit`: Eve can inspect source and emit repository-grounded evidence, while server enrichment can deterministically match it to OSV package/advisory groups.
- [verified] `scanResultSchema` is the shared durable contract and already defaults older dependency-audit results, so the new assessment array can remain rolling-deployment compatible (`src/lib/eve-protocol.ts:70-75`, `200-213`).

## 4. GitNexus Findings

- [graph] `impact(dependencyFindingsFromMatches, upstream, maxDepth:2)` reports two direct dependents: `src/lib/vulnerabilities.test.ts` and `enrichDependencyAudit`; risk HIGH because four persistence/enrichment flows consume it.
- [graph] `impact(enrichDependencyAudit, upstream, maxDepth:2)` reports direct caller `persistDependencyAudit`, which must forward the assessment collection.
- [graph] `impact(exploitabilityReviewMessage, upstream, maxDepth:2)` reports direct dependents `run_scan.execute` and `eve/tests/security-review.test.ts`, establishing the existing review pattern to mirror without changing its source-finding contract.
- [graph] `impact(dependencyAuditResultSchema, upstream, maxDepth:2)` resolves no callers because schema composition is not modeled; source search confirms `scanResultSchema` embeds it directly.

## 5. Statement-Level PDG Findings

- [graph] `pdg_query(flows, dependencyFindingsFromMatches, variable: priority)` shows the priority definition flows directly into returned `priority`, `priorityScore`, and `priorityReasons` at `src/lib/vulnerabilities.ts:294-296`; exploitability must gate the derivation before that return object is built.
- [graph] `pdg_query(controls, dependencyFindingsFromMatches)` reports no control-dependence edges; the current map applies the same unconditional scoring path to every OSV match.
- [graph] `explain(dependencyFindingsFromMatches)` reports no persisted taint findings. This does not establish safety; dependency applicability requires repository/advisory inspection that the agent review will perform.

## 6. Proposed Changes

1. Add a bounded dependency-impact review module in Eve that extracts compact package/advisory candidates from the OSV report, prompts a scanner agent to inspect actual repository usage and deployment context, validates cited repository files, and returns one confirmed/not-confirmed assessment per candidate.
2. Extend `dependencyAuditResultSchema` additively with defaulted exploitability assessments containing package identity, advisory IDs, rationale, and inspected evidence.
3. Add a dependency-review phase to `run_scan.execute` after repository knowledge/security context exists; failures or omitted candidates remain explicitly not confirmed, and scan progress accounting includes the phase.
4. Forward assessments through `persistDependencyAudit` and `enrichDependencyAudit`; match them deterministically by ecosystem, package, version, and advisory IDs.
5. Attach the assessment and inspected evidence to dependency findings. Gate `deriveDependencyPriority` on a confirmed practical attack path, using the established low-priority fallback for unconfirmed candidates while preserving CVSS-derived severity and threat metadata.

## 7. Implementation Sequence

1. Extend the protocol and add the isolated Eve dependency-review module plus tests for candidate extraction, prompt requirements, evidence validation, missing assessments, and confirmed source/sink paths.
2. Integrate the review phase into `run_scan.execute`, including progress totals and graceful failure behavior.
3. Thread assessments through ingestion/enrichment and update dependency scoring/finding construction with regression tests for confirmed and unconfirmed impact.
4. Run the full verification suite, inspect the resulting graph diff, commit atomically, and push according to repository policy.

## 8. Test Strategy

- New `eve/tests/dependency-security-review.test.ts`: compact OSV candidate extraction; prompt requires code/manifest inspection and distinguishes runtime from trusted build/test use; invalid or invented evidence cannot confirm; missing assessments produce not-confirmed results.
- Update `src/lib/eve-protocol.test.ts`: old dependency audit payload remains accepted and new assessments round-trip.
- Update `src/lib/vulnerabilities.test.ts`: a high-CVSS/EPSS/KEV match without confirmed exploitability stays low priority and retains severity; the same match with a valid confirmed assessment retains threat-driven priority and includes review rationale/evidence.
- Verification: `bun test`, `bun run typecheck`, `bun run eve:typecheck`, then `bun run verify`.

## 9. Risk and Impact Analysis

- The scoring change intentionally lowers existing dependency priorities on the next scan unless the agent establishes applicability; advisory severity, package match, CVSS, EPSS, and KEV remain visible.
- Agent output is untrusted. Confirmation must require repository-present source and sink evidence; parse failures and omissions fail closed to not-confirmed.
- Candidate identity must be deterministic across Eve's raw OSV report and the server's normalized matches; tests must cover alias ordering and multiple advisories.
- One additional agent review increases scan cost and duration. Use compact candidates and one bounded review call rather than one call per CVE.
- Direct dependents from GitNexus are explicitly covered: vulnerability tests and `enrichDependencyAudit`; its direct caller `persistDependencyAudit` receives the additive input.

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `src/lib/eve-protocol.ts` | `dependencyAuditResultSchema` | Persist validated dependency impact assessments. |
| `eve/agent/lib/dependency-security-review.ts` | new review schemas/helpers | Extract candidates, prompt the agent, and validate evidence. |
| `eve/agent/tools/run_scan.ts` | `execute`, `totalScanSteps` | Run and persist the dependency review phase. |
| `eve/tests/dependency-security-review.test.ts` | new tests | Pin review behavior and fail-closed evidence handling. |
| `src/lib/eve-protocol.test.ts` | protocol tests | Preserve backward compatibility. |
| `src/lib/server/scan-result-ingestion.server.ts` | `persistDependencyAudit` | Forward assessments into enrichment. |
| `src/lib/server/vulnerability-enrichment.server.ts` | `enrichDependencyAudit` | Join agent assessments to parsed matches. |
| `src/lib/vulnerabilities.ts` | `dependencyFindingsFromMatches`, `deriveDependencyPriority` | Gate contextual priority on confirmed impact and attach evidence. |
| `src/lib/vulnerabilities.test.ts` | dependency priority tests | Cover confirmed and unconfirmed applicability. |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: "Require an agent-confirmed practical attack path before vulnerable dependencies receive elevated contextual priority."
  acceptance_criteria:
    - "Every OSV package/advisory candidate is reviewed against repository source, manifests, deployment context, and attacker-controlled inputs."
    - "Only a review citing repository-present source and sink evidence can confirm practical exploitability."
    - "Unconfirmed or unavailable reviews remain low contextual priority while raw advisory severity and intelligence remain visible."
    - "Runtime-reachable dependencies can still receive high/critical priority from CVSS, EPSS, and KEV."
    - "Older scan-result payloads remain parseable."
  evidence_provenance:
    schema_version: 2
    head_commit: "67cc5d36e1e0f2f4d2db5e575cdacd904f4e1e63"
    generated_plan_path: "docs/plans/2026-09-17-gitnexus-plan-dependency-impact-review.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
    cited_path_manifest:
      - { path: "eve/agent/lib/security-review.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:b1fa661dea5b538c25d09d792b90923c52e07ff5e6f9a66cae1c51c302c6cbd6", index_digest: "sha256:b1fa661dea5b538c25d09d792b90923c52e07ff5e6f9a66cae1c51c302c6cbd6", worktree_digest: "sha256:b1fa661dea5b538c25d09d792b90923c52e07ff5e6f9a66cae1c51c302c6cbd6", untracked_digest: "absent" }
      - { path: "eve/agent/tools/run_scan.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:3c8702b6da74e940e4fd3b9b111afeb6e5d4b8dc108142953cb04c4f07073eb9", index_digest: "sha256:3c8702b6da74e940e4fd3b9b111afeb6e5d4b8dc108142953cb04c4f07073eb9", worktree_digest: "sha256:3c8702b6da74e940e4fd3b9b111afeb6e5d4b8dc108142953cb04c4f07073eb9", untracked_digest: "absent" }
      - { path: "eve/tests/security-review.test.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:f2d442646741fd6c4c32f8968643b07182a8e144267ed088f8b86d01ae30b606", index_digest: "sha256:f2d442646741fd6c4c32f8968643b07182a8e144267ed088f8b86d01ae30b606", worktree_digest: "sha256:f2d442646741fd6c4c32f8968643b07182a8e144267ed088f8b86d01ae30b606", untracked_digest: "absent" }
      - { path: "package.json", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:9934429cfd2b8fa71796be3368409b8e2d1d839cf2e6041dbd0bfaaa8a95e457", index_digest: "sha256:9934429cfd2b8fa71796be3368409b8e2d1d839cf2e6041dbd0bfaaa8a95e457", worktree_digest: "sha256:9934429cfd2b8fa71796be3368409b8e2d1d839cf2e6041dbd0bfaaa8a95e457", untracked_digest: "absent" }
      - { path: "src/lib/eve-protocol.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:d8fae1024cc17178b0ae7d1edf2cf67d9d502bd66095499eaef184e288cc1f24", index_digest: "sha256:d8fae1024cc17178b0ae7d1edf2cf67d9d502bd66095499eaef184e288cc1f24", worktree_digest: "sha256:d8fae1024cc17178b0ae7d1edf2cf67d9d502bd66095499eaef184e288cc1f24", untracked_digest: "absent" }
      - { path: "src/lib/server/scan-result-ingestion.server.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:a931784967e6125c9e6a1d2801a3624649fefa2767db408aab252fc719f3f729", index_digest: "sha256:a931784967e6125c9e6a1d2801a3624649fefa2767db408aab252fc719f3f729", worktree_digest: "sha256:a931784967e6125c9e6a1d2801a3624649fefa2767db408aab252fc719f3f729", untracked_digest: "absent" }
      - { path: "src/lib/server/vulnerability-enrichment.server.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:97a8b54d2967f05328dcd5941b7d773ccbc599d37d6c62c56ff45b5649a20759", index_digest: "sha256:97a8b54d2967f05328dcd5941b7d773ccbc599d37d6c62c56ff45b5649a20759", worktree_digest: "sha256:97a8b54d2967f05328dcd5941b7d773ccbc599d37d6c62c56ff45b5649a20759", untracked_digest: "absent" }
      - { path: "src/lib/vulnerabilities.test.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:598ccc79b1ac098cb0302e252ab6f33d752bd5e6b2a86defed7907769dade1b9", index_digest: "sha256:598ccc79b1ac098cb0302e252ab6f33d752bd5e6b2a86defed7907769dade1b9", worktree_digest: "sha256:598ccc79b1ac098cb0302e252ab6f33d752bd5e6b2a86defed7907769dade1b9", untracked_digest: "absent" }
      - { path: "src/lib/vulnerabilities.ts", object_kind: { head: "regular", index: "regular", worktree: "regular", untracked: "absent" }, state: "clean", rename_from: null, rename_to: null, head_digest: "sha256:04afacb89b488476b761be70dbb2bdff0c1ede8ce76b160926576d746bc76721", index_digest: "sha256:04afacb89b488476b761be70dbb2bdff0c1ede8ce76b160926576d746bc76721", worktree_digest: "sha256:04afacb89b488476b761be70dbb2bdff0c1ede8ce76b160926576d746bc76721", untracked_digest: "absent" }
  primary_symbols:
    - { symbol: "run_scan.execute", file: "eve/agent/tools/run_scan.ts", lines: "300-369", role: "Runs repository-aware exploitability reviews and emits the durable result." }
    - { symbol: "dependencyFindingsFromMatches", file: "src/lib/vulnerabilities.ts", lines: "177-299", role: "Constructs and contextually scores dependency findings." }
    - { symbol: "dependencyAuditResultSchema", file: "src/lib/eve-protocol.ts", lines: "70-75", role: "Durable Eve-to-app dependency audit contract." }
  related_symbols:
    - { symbol: "exploitabilityReviewMessage/applyExploitabilityReview", relationship: "architectural pattern", relevance: "Existing fail-closed, source-and-sink-evidence review flow." }
    - { symbol: "enrichDependencyAudit", relationship: "CALLS dependencyFindingsFromMatches", relevance: "Joins OSV matches to threat intelligence and new assessments." }
    - { symbol: "persistDependencyAudit", relationship: "CALLS enrichDependencyAudit", relevance: "Passes the durable audit payload into enrichment." }
  execution_path:
    - "OSV emits exact locked package/advisory matches."
    - "Eve extracts compact candidates after repository knowledge and security context are available."
    - "A scanner agent inspects package paths, code usage, attacker inputs, controls, and vulnerable behavior."
    - "Eve validates cited files and stores confirmed/not-confirmed assessments in dependencyAudit."
    - "Server enrichment joins assessments to OSV matches, then scores priority only after confirmed practical exploitability."
  pdg_constraints:
    - description: "Priority is defined once per OSV match and flows directly into the returned finding."
      affected_statements: ["src/lib/vulnerabilities.ts:216-222", "src/lib/vulnerabilities.ts:294-296"]
      implementation_consequence: "Resolve and validate the matching assessment before calling deriveDependencyPriority."
  architectural_patterns:
    - pattern: "Independent fail-closed exploitability review"
      example_location: "eve/agent/lib/security-review.ts:50-149"
      usage_guidance: "Treat candidate prose as untrusted, require repository-present source and sink evidence, and default omissions/errors to not-confirmed."
  files_to_modify:
    - { file: "src/lib/eve-protocol.ts", symbols: ["dependencyAuditResultSchema"], intended_change: "Add defaulted impact assessment records." }
    - { file: "eve/agent/lib/dependency-security-review.ts", symbols: ["new review helpers"], intended_change: "Extract candidates, prompt review, and validate evidence." }
    - { file: "eve/agent/tools/run_scan.ts", symbols: ["execute", "totalScanSteps"], intended_change: "Run dependency impact review and persist results." }
    - { file: "src/lib/server/scan-result-ingestion.server.ts", symbols: ["persistDependencyAudit"], intended_change: "Forward assessments." }
    - { file: "src/lib/server/vulnerability-enrichment.server.ts", symbols: ["enrichDependencyAudit"], intended_change: "Join assessments to matches." }
    - { file: "src/lib/vulnerabilities.ts", symbols: ["dependencyFindingsFromMatches", "deriveDependencyPriority"], intended_change: "Gate priority and attach assessment evidence." }
    - { file: "eve/tests/dependency-security-review.test.ts", symbols: ["new tests"], intended_change: "Test review behavior." }
    - { file: "src/lib/eve-protocol.test.ts", symbols: ["protocol tests"], intended_change: "Test compatibility." }
    - { file: "src/lib/vulnerabilities.test.ts", symbols: ["dependency tests"], intended_change: "Test contextual scoring." }
  tests:
    - file: "eve/tests/dependency-security-review.test.ts"
      scenarios:
        - "Raw OSV report -> extract stable compact candidates -> preserve package/advisory identity."
        - "Build/dev-only path with no attacker source -> review -> not-confirmed with repository evidence."
        - "Runtime attacker source reaches vulnerable package behavior -> valid source and sink evidence -> confirmed."
        - "Invented or missing evidence path -> attempted confirmation -> not-confirmed."
    - file: "src/lib/eve-protocol.test.ts"
      scenarios: ["Legacy audit without assessments -> parse -> empty default", "New audit assessment -> parse -> preserved"]
    - file: "src/lib/vulnerabilities.test.ts"
      scenarios: ["Unconfirmed critical OSV match -> score -> low priority with severity retained", "Confirmed critical match -> score -> threat-driven priority retained"]
  verification_commands:
    - "bun test"
    - "bun run typecheck"
    - "bun run eve:typecheck"
    - "bun run verify"
  risks:
    - "Next scans intentionally reclassify unconfirmed CVEs, which can materially change repository scores."
    - "Agent review adds scan cost and duration."
    - "OSV alias/group identity must match deterministically across process boundaries."
  assumptions:
    - "Check `dependencyAudit.report` still contains OSV package groups and vulnerability details before implementing candidate extraction."
    - "Check scanner agent structured output supports at least 100 bounded assessments; otherwise batch deterministically."
  open_questions: []
  avoid:
    - "Do not infer applicability solely from dependency or devDependency labels."
    - "Do not lower raw advisory severity when practical exploitability is unconfirmed."
    - "Do not let review failure or missing evidence confirm a finding."
    - "Do not perform one agent call per CVE."
```

## 12. Assumptions and Open Questions

- [assumed] A single bounded scanner-agent response can carry up to 100 compact assessments; verify against the generated JSON schema and batch deterministically if the model/runtime limit is lower.
- [verified] The raw OSV report includes package groups, aliases, summaries/details, and exact package versions needed to form review candidates.
- Deferred: exposing dependency usage class (runtime/build/development) as a separate UI badge is useful but not required to fix priority correctness; the rationale and evidence remain visible through finding details.

## 13. Definition of Done

- Dependency findings cannot receive elevated contextual priority without a validated agent confirmation of a practical attack path.
- The review explicitly distinguishes shipped/runtime paths from trusted build, test, and tooling-only paths through inspected evidence rather than package-name heuristics.
- Published severity and threat intelligence remain unchanged and visible.
- Assessment omissions, malformed responses, invented paths, and agent failures fail closed.
- Existing and new unit/protocol tests pass, followed by the repository's complete `bun run verify` suite.
