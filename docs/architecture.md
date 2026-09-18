# Architecture

## Scan flow

```text
schedule / "Scan now"
        │
        ▼
 app creates a scan row, writes data/requests/scan-<id>.json
        │  eve/client: "Run scan <id>."
        ▼
 Eve root agent ──► run_scan workflow tool (durable)
        │   1. fresh shallow clone of the branch      ("use step")
        │   2. optional GitNexus index                 ("use step")
        │   3. OSV lockfile dependency audit            (exact package versions)
        │   4. repository-knowledge refresh             (knowledge subagent, only if stale)
        │   5. subsystem dependency graph and cycles    (from the GitNexus index, optional)
        │   6. bounded file-sample review               (operator budget)
        │   7. threat-model-aware candidate discovery   (parallel, structured output)
        │   8. isolated executable validation           (fail closed when unavailable)
        │   9. write data/results/scan-<id>.json        ("use step")
        ▼
 app enriches, prioritizes, reconciles, scores, persists and seals portable artifacts
```

The app and the Eve runtime are separate processes that share only a data
directory (`TECDEBT_DATA_DIR`) and an authenticated HTTP connection. The app
owns PostgreSQL; Eve owns clones, sandboxes and model calls. Nothing in Eve
talks to the database and nothing in the app talks to a model.

Scheduled work supports two global modes configured on the Settings page. Cron
mode writes every enabled repository that inherits the default to a durable
queue when the cron is due. Distributed mode accepts a scans-per-day rate,
spaces slots evenly across each 24-hour period, and adds one inherited
repository per slot using a durable round-robin cursor. A repository can
disable scheduled runs or define its own cron override; overrides run
independently of either global mode and add only that repository to the same
queue. Standard five-field cron day-of-week values provide weekday and weekly
schedules. The scheduler admits due repositories in enqueue order, waiting for
the configured cooldown between repositories. Every admitted scan then enters
the durable execution queue, which dispatches FIFO up to the scan concurrency
configured in Settings. Manual scans use the same execution queue.

## Scanners

Built-in definitions live in
[`src/lib/scanners.ts`](../src/lib/scanners.ts). PostgreSQL stores global
enable overrides and operator-defined custom scanners; each scan copies its
active definitions into the scanner-run rows so an in-progress or historical
scan is unaffected by later settings changes. Every enabled agent scanner runs
as its own Eve subagent session with read-only filesystem access (`bash`,
`read_file`, `glob`, `grep`) and, when available, GitNexus MCP tools.

Architecture & Modularity · Duplication & Abstraction · Dead & Obsolete Code ·
Complexity & Maintainability · Tests & Testability · Reliability & Error
Handling · Documentation & Understandability · Domain & API Design · Type
Safety & Data Contracts · Consistency / Vibe Debt · AI Slop & Noise ·
Dependencies & Build Health · Vulnerable Dependencies · CI & GitHub Actions
Security · Security Hygiene

Each scanner's `prompt` names what it owns, which neighbouring dimensions own
the adjacent concerns ("Not yours"), and how to calibrate severity, so the same
problem is not reported (and scored) by two scanners.

### Adding a scanner

Operators can add an organization-specific agent scanner from the Scanners
page by supplying its identity, weight, review instructions and fix-prompt
guidance. Custom definitions apply globally, can be enabled or disabled, and
can be removed without deleting their existing findings or scan history.

To ship a scanner as a built-in, append an entry with `id`, `name`,
`shortName`, `description`, `weight`, `enabled`, `prompt` and
`fixPromptTitle`. The pipeline, scoring, charts, scanner pages and fix prompts
resolve the built-in registry together with persisted settings.

The shared analysis contract (evidence-first, language-agnostic, structured
findings, hypothesis verification) lives in
[`eve/agent/subagents/scanner/instructions.md`](../eve/agent/subagents/scanner/instructions.md).

When you add a dimension, revisit the "Not yours" clause of every neighbouring
scanner that could overlap with it; `src/lib/scanners.test.ts` checks that
boundary clauses only reference dimensions that exist.

Removing or merging a scanner needs a data migration as well, because findings
are keyed by `scanner_id`: re-parent the old scanner's rows onto the surviving
scanner (see `drizzle/0001_merge_abstraction_into_duplication.sql`) so they are
handed back as hypotheses instead of being orphaned.

## Scoring

[`src/lib/scoring.ts`](../src/lib/scoring.ts): every scanner starts at 100 and
loses `SEVERITY_PENALTY[severity] × CONFIDENCE_FACTOR[confidence]` per open
finding (critical 30, high 16, medium 8, low 3; confidence high ×1, medium
×0.8, low ×0.5). The overall score is the weighted mean of scanner scores;
grades are A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F. The model never proposes
numbers.

## Finding lifecycle

Findings are logical problems identified by a scanner-chosen stable
`fingerprint` (concept + area, never line numbers). On a rescan the open
findings are handed back to the relevant scanner as hypotheses; it must verify
each against the current code (`confirmed`, `improved`, `resolved`) and search
for new issues.
[`finding-reconciliation.server.ts`](../src/lib/server/finding-reconciliation.server.ts)
then derives states from *our persisted results* (never Git history):

| Situation | State |
| --- | --- |
| fingerprint not seen before | `new` |
| open finding returned again, same severity | `active` |
| open finding returned with lower severity or scanner verdict `improved` | `improved` |
| open finding returned with higher severity, or a resolved finding reappears | `regressed` |
| scanner explicitly re-verifies the finding and returns `resolved` | `resolved` |
| open finding not mentioned at all by a scanner that did not verify the rest | `active` (carried forward, never silently resolved) |
| operator marks a finding fixed and records what changed | `resolved` without a disposition; a future match becomes `regressed` |
| operator marks a finding false positive or accepted risk | `resolved` with a durable manual disposition; future matches stay suppressed |
| scanner cites a concrete change that contradicts the recorded disposition context | `regressed`; the disposition is cleared |
| operator reopens a manually triaged finding | `active`; the next scan resumes normal reconciliation |

Every observation is stored as a `finding_occurrences` row, which powers the
"active findings over time" chart. Every state change is additionally appended
to `finding_events` with the actor (scanner or operator), the scan, the
disposition involved and the reason. The finding card shows this as a history
log, and a finding whose ignore context the scanner invalidated is flagged
"reopened by scanner" with the scanner's assessment until someone acts on it.

Lifecycle resolution is evidence aware: an omitted finding is never marked
fixed by a bounded investigation. Resolution requires an explicit verdict, and
path scans cannot resolve repository-level findings outside their scope. Manual dispositions
are durable: scanners receive the recorded context, default to keeping the
finding suppressed, and may reopen it as a regression only when they can cite a
concrete code change that contradicts that context. Disagreeing with the
operator's judgement is not enough.

An operator-reported fix is intentionally not a disposition. Its history event
records the claimed change, while the next applicable scan independently
verifies the current code. If the same fingerprint is found again, normal
reconciliation marks it regressed instead of suppressing it.

## Vulnerability enrichment and priority

The deterministic **Vulnerable Dependencies** scanner runs Google's OSV
Scanner over supported lockfiles and manifests. OSV supplies exact ecosystem,
package and version matches (plus purl when published), advisory aliases and
fixed versions. CodeTend calculates published CVSS 2.0, 3.0, 3.1 and 4.0
vectors locally, fetches FIRST EPSS probabilities, and joins the CISA Known
Exploited Vulnerabilities catalog. An unavailable EPSS or KEV feed is reported
in the scanner summary but never discards an OSV result.

Raw severity and contextual priority are deliberately separate. Dependency
priority combines CVSS, EPSS, KEV and fix availability; a KEV entry always
becomes critical priority. The Security Hygiene discovery agent classifies
source-code findings with CWE/OWASP and records evidenced reachability,
exposure and data sensitivity. After isolated validation, a second agent
independently checks each proposed attack path against the source and validation
result. Source findings remain low priority unless that review confirms a
practical attack path; confirmed findings use severity, reachability, exposure
and data sensitivity to derive contextual priority. Source findings never
receive CVEs or CVSS. The dashboard retains exact match evidence and snapshots
all enrichment on each finding occurrence.

## Security review pipeline

Security Hygiene follows a staged review: durable repository security context,
refined by the knowledge agent and operator → scanner-directed investigation →
safe isolated validation → attack-path and impact analysis → contextual ranking
→ explicit-verdict lifecycle. Operators set a cumulative input-token budget per
scan. That budget is divided evenly across the enabled model-backed scanners and
controls investigation effort only; orchestration, knowledge refresh, validation,
and post-processing may continue beyond it without making the scan partial. Each
scanner orients from the repository tree, manifests, prior attention, findings,
and graph intelligence, then selects representative evidence for its own
dimension. Scan success never implies whole-repository coverage.

Executable validation is fail closed. Commands run sequentially in a disposable
Docker container with no network, all capabilities dropped,
`no-new-privileges`, CPU/memory/PID limits, a read-only source mount, and a
throwaway writable copy. If isolation is unavailable, CodeTend records an
explicit proof gap and never executes repository code on the app or Eve host.
The bundled Compose topology deliberately has no Docker socket, so validation
is unavailable there unless Eve is deployed with a separate authorized
Docker-capable execution boundary.

## Patch generation

For an active finding, **Generate patch** queues a separate one-finding fixer.
The durable fix queue dispatches FIFO up to its independent Settings-managed
concurrency limit.
It works against the exact source revision in a disposable clone, returns a
text-only unified diff, and must pass path/symlink/binary restrictions plus
`git apply --check`. When the finding has an executable reproducer, the patched
clone is rerun through the same isolated validator; a patch is marked verified
only when the vulnerable behavior no longer reproduces. Reviewers explicitly
approve or reject the stored diff. Approval is an audit decision only: CodeTend
does not modify the registered checkout or publish a branch. Approved diffs are
downloaded and applied through the repository owner's normal review and CI
process.

## Repository knowledge

Inspired by [OpenWiki](https://github.com/langchain-ai/openwiki): a knowledge
subagent writes a compact, source-grounded overview (architecture, subsystems
and their responsibilities, domain concepts, workflows, conventions) plus a
structured summary, and lists the files it relied on. The app stores the
content hash of each of those files. On the next scan
[`eve/agent/lib/knowledge.ts`](../eve/agent/lib/knowledge.ts) compares hashes
with the fresh checkout; knowledge is refreshed only when grounding files
changed or disappeared, new top-level areas appeared, or the file count
drifted, and the agent is told exactly which sections to re-verify. Source code
is always authoritative. Scanners receive the overview in their task message.

When GitNexus is enabled, a deterministic step maps its file-level import
edges onto the knowledge agent's subsystems and runs its circular-import check.
The knowledge page renders the resulting subsystem dependency graph and lists
cycles with the files involved. The step never fails a scan: without GitNexus
the graph is recorded as unavailable.

## Token and cost tracking

Eve hooks record the provider-reported input, output, cache-read and
cache-write tokens for root, knowledge, scanner and fixer steps. They append
usage-only JSON lines under `data/usage/`; prompts and model responses are
never logged. After a scan or patch settles, the app deduplicates and
aggregates those records, stores scan, per-scanner or patch totals in
PostgreSQL, and removes the temporary file.

Costs are estimates based on the configured model's provider list price in
[`src/lib/ai-pricing.ts`](../src/lib/ai-pricing.ts). A provider-reported cost
takes precedence when available. Unknown models still show token counts and
model calls, but their cost is shown as unavailable rather than guessed. The
UTC-day admission budget includes both scans and fixer jobs.

## Repository access

Clone locations are checked against `TECDEBT_ALLOWED_GIT_HOSTS` before they
cross into the credentialed Eve runtime. Plain HTTP, embedded URL credentials,
`file://` URLs and absolute local paths are rejected by default. Public
repositories need no credential. Private GitHub HTTPS clones prefer a GitHub
App installation token that [`eve/agent/lib/github-app-auth.ts`](../eve/agent/lib/github-app-auth.ts)
mints and caches from `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` after resolving
the repository's App installation, then a plain `GITHUB_TOKEN`, then local
`gh auth git-credential`, then configured Git credential helpers. The resolved credential is carried through
a dedicated environment variable on the spawned `git` process
(`TECDEBT_GIT_CREDENTIAL_TOKEN`, expanded by a `credential.helper` shell
function) rather than the clone command's arguments, so it never appears in
`ps` output or logs.

## Project layout

```text
src/routes/                TanStack Router file routes (dashboard, repository, scanner, scan, knowledge)
src/components/            UI (health/*: grade, severity, charts, finding cards; knowledge/*: dependency graph)
src/lib/                   Shared pure logic: findings schema, scanner registry, scoring, fix prompts, schedule
src/lib/server/            Server functions and *.server.ts internals (pipeline, reconciliation, Eve client, scheduler)
src/db/                    Drizzle schema and connection
drizzle/                   Committed migrations
eve/agent/                 Eve agent: root instructions, run_scan workflow tool, sandbox, subagents, connections
scripts/                   migrate, dev migrations plugin, import-boundary check, start scripts, CLI
```

`src/routeTree.gen.ts` is generated. Run `bun run generate-routes` instead of
editing it manually.
