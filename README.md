# tecdebt

**Continuous, language-agnostic health evaluation of entire source-code
repositories, performed by specialized LLM agents.**

tecdebt is not an autonomous pull-request-writing bot. It registers
repositories, and on a schedule, webhook, or on demand it makes a fresh
checkout of the configured branch. It runs specialized scanner agents over a
repository, selected paths, or a committed push/PR diff, turns their structured
findings into deterministic scores and grades, tracks
every finding across scans (new → active → improved → resolved → regressed),
and generates copy-pasteable fix prompts for coding agents.

> Proof of concept. See [Limitations](#limitations) before relying on it.

## How it works

```text
schedule / "Scan now" / signed GitHub push or pull-request webhook
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
        │   5. threat-model-aware candidate discovery   (parallel, structured output)
        │   6. bounded deep passes (deep mode only)     (convergence limited)
        │   7. isolated executable validation           (fail closed when unavailable)
        │   8. write data/results/scan-<id>.json        ("use step")
        ▼
 app enriches, prioritizes, reconciles, scores, persists and seals portable artifacts
```

| Layer | Choice |
| --- | --- |
| App | Bun, TanStack Start + Router, React 19, shadcn/ui (Base UI), Tailwind v4, Recharts |
| Persistence | PostgreSQL + Drizzle with automatic migrations (`bun run dev` applies pending migrations) |
| Agent runtime | [Eve](https://eve.dev) (`eve/`): durable workflow tool, declared subagents, just-bash sandbox, MCP connections, structured outputs |
| Models | Any OpenAI-compatible endpoint through the AI SDK provider (`TECDEBT_MODEL`, default `gpt-5.6-sol`; Claude and others via a gateway such as OpenRouter) |
| Code intelligence | [GitNexus](https://github.com/abhigyanpatwari/GitNexus) over MCP, optional |

## Quick start (local)

Prerequisites: Bun 1.4, Node 24 (for Eve), Git, PostgreSQL (Docker is fine),
an OpenAI API key, and [OSV Scanner](https://google.github.io/osv-scanner/installation/)
for dependency auditing. The Docker image includes OSV Scanner. Optionally GitNexus: `npm i -g gitnexus` or
`mkdir -p .tools && (cd .tools && npm i gitnexus)` (the app looks in both
places, or at `GITNEXUS_BIN`).

```bash
cp .env.example .env               # set OPENAI_API_KEY, passwords and DATABASE_URL
bun install && (cd eve && npm install)

docker compose up -d postgres      # or point DATABASE_URL at your own database
bun run eve:build && bun run eve:start   # terminal 1: Eve runtime on :2000
bun run dev                              # terminal 2: app on :3000, migrations applied automatically
```

`scripts/start-dev.sh` supervises both processes with `.env` loaded under one
managed VibePod preview; Eve is restarted in place when it exits so the Vite
dev server (and every open tab) survives Eve rebuilds. `scripts/start-eve.sh`
remains available when Eve is run separately.

For a preview that people look at rather than code against, serve the
production build instead: `scripts/start-preview.sh --build` builds the app,
applies migrations and runs `.output/server/index.mjs` next to Eve. Nothing
reloads the page when the server restarts and pages render in tens of
milliseconds instead of seconds. Set `TECDEBT_BASIC_AUTH_PASSWORD` in `.env`
first: the production server fails closed without it. Rebuild with
`bun run build` after changing the app. Set `TECDEBT_DEVTOOLS=true` to enable
the TanStack devtools overlay in `vite dev`.

## Quick start (Docker Compose)

```bash
cp .env.example .env               # replace every change-me value
docker compose up --build
```

Compose starts PostgreSQL, applies migrations, starts the Eve runtime and the
app on <http://localhost:3000>. Sign in with the configured HTTP Basic
credentials. The `scan_data` volume is shared between the app and Eve;
transient requests, results, usage records, checkouts and GitNexus indexes are
removed after each scan is persisted.

## Using it

1. **Add repository**: URL, branch, cron schedule (UTC), enabled switch.
2. **Scan now** on the repository page. Choose standard or bounded deep mode,
   whole-repository or selected-path scope, and an optional cost ceiling. You
   can also wait for `nextScanAt` or configure the signed GitHub webhook below.
3. Watch the scan phase update live (cloning → indexing → knowledge → scanning →
   reconciling).
4. The repository page shows the overall score and A–F grade, score delta,
   scanner scores, new/improved/resolved/regressed counts, active findings, scan
   history, token/cost usage and **change over time** charts. The global
   **Scans** page shows usage across every repository.
5. Each scanner page shows its score trend, findings with evidence and
   recommendations, and the aggregated **fix prompt** with a Copy button.
6. Security findings include root cause, role-tagged source/control/sink
   evidence, attack path, validation results and proof gaps, remediation tests,
   and preventive controls. Scan pages expose manifest, findings, coverage,
   Markdown and SARIF downloads.
7. Expand a finding to mark it **false positive** or **accepted risk** with a
   context note (required for accepted risks). Ignored findings are listed in
   their own section on the repository page where the context can be edited or
   the finding reopened. The disposition is never presented as a code fix.

## Scanners

Defined in [`src/lib/scanners.ts`](src/lib/scanners.ts). Every enabled scanner
runs on every scan as its own Eve subagent session with read-only filesystem
access (`bash`, `read_file`, `glob`, `grep`) and, when available, GitNexus MCP
tools.

Architecture & Modularity · Duplication & Abstraction · Dead & Obsolete Code ·
Complexity & Maintainability · Tests & Testability · Reliability & Error
Handling · Documentation & Understandability · Domain & API Design · Type
Safety & Data Contracts · Consistency / Vibe Debt · AI Slop & Noise ·
Dependencies & Build Health · Vulnerable Dependencies · Security Hygiene

Each scanner's `prompt` names what it owns, which neighbouring dimensions own
the adjacent concerns ("Not yours"), and how to calibrate severity, so the same
problem is not reported (and scored) by two scanners.

### Adding a scanner

Append an entry with `id`, `name`, `shortName`, `description`, `weight`,
`enabled`, `prompt` and `fixPromptTitle`. Nothing else changes: the pipeline,
scoring, charts, scanner pages and fix prompts iterate the registry. The
shared analysis contract (evidence-first, language-agnostic, structured
findings, hypothesis verification) lives in
[`eve/agent/subagents/scanner/instructions.md`](eve/agent/subagents/scanner/instructions.md).

Removing or merging a scanner needs a data migration as well, because findings
are keyed by `scanner_id`: re-parent the old scanner's rows onto the surviving
scanner (see `drizzle/0001_merge_abstraction_into_duplication.sql`) so they are
handed back as hypotheses instead of being orphaned.

## Scoring

[`src/lib/scoring.ts`](src/lib/scoring.ts): every scanner starts at 100 and
loses `SEVERITY_PENALTY[severity] × CONFIDENCE_FACTOR[confidence]` per open
finding (critical 30, high 16, medium 8, low 3; confidence high ×1, medium
×0.8, low ×0.5). The overall score is the weighted mean of scanner scores;
grades are A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else F. The model never proposes
numbers.

## Vulnerability enrichment and priority

The deterministic **Vulnerable Dependencies** scanner runs Google's OSV
Scanner over supported lockfiles and manifests. OSV supplies exact ecosystem,
package and version matches (plus purl when published), advisory aliases and
fixed versions. tecdebt calculates published CVSS 2.0, 3.0, 3.1 and 4.0
vectors locally, fetches FIRST EPSS probabilities, and joins the CISA Known
Exploited Vulnerabilities catalog. An unavailable EPSS or KEV feed is reported
in the scanner summary but never discards an OSV result.

Raw severity and contextual priority are deliberately separate. Dependency
priority combines CVSS, EPSS, KEV and fix availability; a KEV entry always
becomes critical priority. The Security Hygiene agent classifies source-code
findings with CWE/OWASP and records evidenced reachability, exposure and data
sensitivity, which drive their separate contextual priority. It never assigns
CVEs or CVSS to source findings. The dashboard retains exact match evidence and
snapshots all enrichment on each finding occurrence.

## Security review pipeline

Security Hygiene follows a staged review: editable repository security context
and threat model → candidate discovery → safe isolated validation → attack-path
and impact analysis → contextual ranking → coverage-aware lifecycle. Deep mode
uses a small configurable worker pool, a hard run ceiling, and convergence
stopping; it does not launch one agent per file.

Executable validation is fail closed. Commands run sequentially in a disposable
Docker container with no network, all capabilities dropped,
`no-new-privileges`, CPU/memory/PID limits, a read-only source mount, and a
throwaway writable copy. If isolation is unavailable, tecdebt records an
explicit proof gap and never executes repository code on the app or Eve host.
The bundled Compose topology deliberately has no Docker socket, so validation
is unavailable there unless Eve is deployed with a separate authorized
Docker-capable execution boundary.

Lifecycle resolution is coverage aware: an omitted finding is not marked fixed
unless its original path was inside a complete reviewed target. Path and diff
scans cannot silently resolve findings outside their scope. Manual dispositions
are durable: scanners receive the recorded context, default to keeping the
finding suppressed, and may reopen it as a regression only when they can cite a
concrete code change that contradicts that context. Disagreeing with the
operator's judgement is not enough.

For an active finding, **Generate patch** starts a separate one-finding fixer.
It works against the exact source revision in a disposable clone, returns a
text-only unified diff, and must pass path/symlink/binary restrictions plus
`git apply --check`. When the finding has an executable reproducer, the patched
clone is rerun through the same isolated validator; a patch is marked verified
only when the vulnerable behavior no longer reproduces. Reviewers explicitly
approve or reject the stored diff. Approval is an audit decision only: tecdebt
does not modify the registered checkout, push a branch, or open a pull request.

## Token and cost tracking

Eve hooks record the provider-reported input, output, cache-read and cache-write
tokens for root, knowledge, scanner and fixer steps. They append usage-only JSON
lines under `data/usage/`; prompts and model responses are never logged. After a
scan or patch settles, the app deduplicates and aggregates those records, stores
scan, per-scanner or patch totals in PostgreSQL, and removes the temporary file.

Costs are estimates based on the configured model's provider list price. A
provider-reported cost takes precedence when available. Unknown models still
show token counts and model calls, but their cost is shown as unavailable rather
than guessed. The UTC-day admission budget includes both scans and fixer jobs.

## Finding lifecycle

Findings are logical problems identified by a scanner-chosen stable
`fingerprint` (concept + area, never line numbers). On a rescan the open
findings are handed back to the relevant scanner as hypotheses; it must verify
each against the current code (`confirmed`, `improved`, `resolved`) and search
for new issues. [`finding-reconciliation.server.ts`](src/lib/server/finding-reconciliation.server.ts)
then derives states from *our persisted results* (never Git history):

| Situation | State |
| --- | --- |
| fingerprint not seen before | `new` |
| open finding returned again, same severity | `active` |
| open finding returned with lower severity or scanner verdict `improved` | `improved` |
| open finding returned with higher severity, or a resolved finding reappears | `regressed` |
| scanner verdict `resolved`, or the scanner verified every other hypothesis and omitted this one | `resolved` |
| open finding not mentioned at all by a scanner that did not verify the rest | `active` (carried forward, never silently resolved) |
| operator marks a finding false positive or accepted risk | `resolved` with a durable manual disposition; future matches stay suppressed |
| scanner cites a concrete change that contradicts the recorded disposition context | `regressed`; the disposition is cleared |
| operator reopens a manually triaged finding | `active`; the next scan resumes normal reconciliation |

Every observation is stored as a `finding_occurrences` row, which powers the
"active findings over time" chart. Every state change is additionally appended
to `finding_events` with the actor (scanner or operator), the scan, the
disposition involved and the reason. The finding card shows this as a history
log, and a finding whose ignore context the scanner invalidated is flagged
"reopened by scanner" with the scanner's assessment until someone acts on it.

## Repository knowledge

Inspired by [OpenWiki](https://github.com/langchain-ai/openwiki): a knowledge
subagent writes a compact, source-grounded overview (architecture, subsystems
and their responsibilities, domain concepts, workflows, conventions) plus a
structured summary, and lists the files it relied on. The app stores the
content hash of each of those files. On the next scan
[`eve/agent/lib/knowledge.ts`](eve/agent/lib/knowledge.ts) compares hashes with
the fresh checkout; knowledge is refreshed only when grounding files changed or
disappeared, new top-level areas appeared, or the file count drifted, and the
agent is told exactly which sections to re-verify. Source code is always
authoritative. Scanners receive the overview in their task message.

## Project layout

```text
src/routes/                TanStack Router file routes (dashboard, repository, scanner, scan, knowledge)
src/components/            UI (health/*: grade, severity, charts, finding cards)
src/lib/                   Shared pure logic: findings schema, scanner registry, scoring, fix prompts, schedule
src/lib/server/            Server functions and *.server.ts internals (pipeline, reconciliation, Eve client, scheduler)
src/db/                    Drizzle schema and connection
drizzle/                   Committed migrations
eve/agent/                 Eve agent: root instructions, run_scan workflow tool, sandbox, subagents, connections
scripts/                   migrate, dev migrations plugin, import-boundary check, start scripts, CLI
```

## Commands

```bash
bun run dev              # app with automatic migrations
bun run preview:serve    # production build + Eve, for a stable shared preview
bun run check            # Biome + import boundaries
bun run test             # focused pricing and usage-accounting tests
bun run test:database    # migrated-schema and active-scan constraint smoke test
bun run typecheck
bun run build
bun run verify           # format/lint, tests, types, build, Eve types and dead code
bun run eve:typecheck    # type-check the Eve agent
bun run eve:build        # compile the Eve agent
bun run eve:start        # serve the compiled Eve agent
bun run db:generate      # after editing src/db/schema.ts
bun run db:migrate
bun run scripts/cli.ts add <name> <url> [branch] [cron]   # scripting helpers
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `TECDEBT_DATA_DIR` | Shared directory for scan requests/results, checkouts and GitNexus indexes |
| `TECDEBT_BASIC_AUTH_USERNAME`, `TECDEBT_BASIC_AUTH_PASSWORD` | App HTTP Basic credentials; production fails closed without a password |
| `TECDEBT_ALLOWED_GIT_HOSTS` | Comma-separated exact clone-host allowlist (default `github.com`) |
| `TECDEBT_ALLOW_LOCAL_REPOSITORIES`, `TECDEBT_ALLOW_INSECURE_GIT` | Explicit development-only escape hatches, both off by default |
| `TECDEBT_MAX_ACTIVE_SCANS`, `TECDEBT_MAX_ACTIVE_PATCHES`, `TECDEBT_MAX_DAILY_COST_USD`, `TECDEBT_DEFAULT_SCAN_COST_USD` | Global scan/patch concurrency, UTC-day AI cost cap, and optional per-scan default |
| `TECDEBT_DEEP_WORKERS`, `TECDEBT_DEEP_MAX_RUNS`, `TECDEBT_DEEP_STOP_AFTER_NO_NEW` | Bounded deep-scan fan-out and convergence |
| `TECDEBT_VALIDATION_ENABLED`, `TECDEBT_VALIDATION_RUNNER`, `TECDEBT_VALIDATION_IMAGE` | Fail-closed isolated validation controls |
| `TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS` | Per-repository manual scan cooldown |
| `EVE_URL`, `EVE_USERNAME`, `EVE_PASSWORD` | Eve runtime endpoint and HTTP Basic credentials |
| `SCHEDULER_INTERVAL_SECONDS` | How often the app looks for due repositories |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `TECDEBT_MODEL`, `TECDEBT_EFFORT`, `TECDEBT_MODEL_CONTEXT_WINDOW_TOKENS` | OpenAI-compatible endpoint, model id, reasoning effort and context window for Eve agents |
| `TECDEBT_MAX_INPUT_TOKENS_PER_SESSION`, `TECDEBT_SCANNER_CONCURRENCY` | Per-session token ceiling and bounded scanner fan-out |
| `GITHUB_TOKEN` | Optional short-lived GitHub App installation token for private HTTPS clones |
| `GITHUB_WEBHOOK_SECRET` | Optional secret authenticating GitHub push and pull-request deliveries to `/api/webhooks/github` |
| `GITNEXUS_ENABLED`, `GITNEXUS_MCP_PORT` | Optional code-intelligence layer |
| `OSV_SCANNER_BIN` | Optional OSV Scanner path override for local Eve runs; Docker includes it |

## Repository access

Clone locations are checked against `TECDEBT_ALLOWED_GIT_HOSTS` before they
cross into the credentialed Eve runtime. Plain HTTP, embedded URL credentials,
`file://` URLs and absolute local paths are rejected by default. Public
repositories need no credential. Private GitHub HTTPS clones prefer the
short-lived token in `GITHUB_TOKEN` (for example a GitHub App installation
token), then local `gh auth git-credential`, then configured Git credential
helpers.

To scan GitHub pushes and pull requests, set a random
`GITHUB_WEBHOOK_SECRET`, restart the app, and configure a repository webhook targeting
`https://<your-host>/api/webhooks/github` with JSON content, that same secret,
and push plus pull-request events enabled. Pushes scan `before…after`; reviewable
pull requests scan base-to-head. Only enabled repositories whose GitHub
`owner/name` and configured base branch match are selected. SHA-256 signatures
are mandatory; delivery IDs are retained for 30 days to reject replays. The
webhook never writes comments or mutates GitHub.

## Operating and security

The built-in HTTP Basic boundary is intended for a private, single-tenant
deployment behind TLS. See [Operations](docs/OPERATIONS.md),
[Security policy](SECURITY.md), and [Data handling](PRIVACY.md) before exposing
the service. CI verifies the application, Eve runtime, migrations, production
dependency audits and both Docker targets on every proposed change.

## Limitations

- The built-in authentication boundary is single-tenant. A multi-customer SaaS
  still needs an external identity provider, organizations and repository-level
  authorization.
- GitHub App token generation and rotation belong to the hosting control plane;
  tecdebt accepts a short-lived installation token for clones.
- Running scans are re-attached after an app restart when Eve writes their
  result within the recovery window; older orphaned scans are failed cleanly.
- Executable finding validation is disabled by default. When enabled, Eve must
  have Docker access; commands run only in disposable, network-denied,
  capability-dropped containers and never fall back to the Eve host. The
  bundled Compose deployment deliberately does not mount the Docker socket.
- The sandbox is `just-bash` (virtual shell, no real toolchains, no network).
  Switch `eve/agent/sandbox/sandbox.ts` to `docker()` when scanners must run
  real language tooling. OSV runs as a separate trusted workflow step outside
  that agent sandbox and uses its public vulnerability service.
- Scanners sample large repositories; very large monorepos may exceed a single
  scan's context and should be split.
- GitNexus supports a fixed set of languages; other languages are analyzed
  from the filesystem only.
- The full LLM scan remains an external-service integration test; deterministic
  vulnerability parsing, priority, repository access, accounting and database
  invariants are covered without spending model credits.
