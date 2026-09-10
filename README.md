# tecdebt

**Continuous, language-agnostic health evaluation of entire source-code
repositories, performed by specialized LLM agents.**

tecdebt is not a pull-request review bot. It registers repositories, and on a
schedule (or on demand) it makes a fresh checkout of the configured branch,
runs a registry of specialized scanner agents over the *whole* repository,
turns their structured findings into deterministic scores and grades, tracks
every finding across scans (new → active → improved → resolved → regressed),
and generates copy-pasteable fix prompts for coding agents.

> Proof of concept. See [Limitations](#limitations) before relying on it.

## How it works

```text
schedule / "Scan now" / (future) webhook
        │
        ▼
 app creates a scan row, writes data/requests/scan-<id>.json
        │  eve/client: "Run scan <id>."
        ▼
 Eve root agent ──► run_scan workflow tool (durable)
        │   1. fresh shallow clone of the branch      ("use step")
        │   2. optional GitNexus index                 ("use step")
        │   3. repository-knowledge refresh            (knowledge subagent, only if stale)
        │   4. one scanner subagent per scanner        (parallel, structured output)
        │   5. write data/results/scan-<id>.json       ("use step")
        ▼
 app reconciles findings, scores, aggregates provider usage, persists, updates UI
```

| Layer | Choice |
| --- | --- |
| App | Bun, TanStack Start + Router, React 19, shadcn/ui (Base UI), Tailwind v4, Recharts |
| Persistence | PostgreSQL + Drizzle with automatic migrations (`bun run dev` applies pending migrations) |
| Agent runtime | [Eve](https://eve.dev) (`eve/`): durable workflow tool, declared subagents, just-bash sandbox, MCP connections, structured outputs |
| Models | OpenAI through the AI SDK provider (`TECDEBT_MODEL`, default `gpt-5.6-sol`) |
| Code intelligence | [GitNexus](https://github.com/abhigyanpatwari/GitNexus) over MCP, optional |

## Quick start (local)

Prerequisites: Bun 1.4, Node 24 (for Eve), Git, PostgreSQL (Docker is fine),
an OpenAI API key. Optionally GitNexus: `npm i -g gitnexus` or
`mkdir -p .tools && (cd .tools && npm i gitnexus)` (the app looks in both
places, or at `GITNEXUS_BIN`).

```bash
cp .env.example .env               # set ANTHROPIC_API_KEY, EVE_PASSWORD, DATABASE_URL
bun install && (cd eve && npm install)

docker compose up -d postgres      # or point DATABASE_URL at your own database
bun run eve:build && bun run eve:start   # terminal 1: Eve runtime on :2000
bun run dev                              # terminal 2: app on :3000, migrations applied automatically
```

`scripts/start-dev.sh` supervises both processes with `.env` loaded under one
managed VibePod preview. `scripts/start-eve.sh` remains available when Eve is
run separately.

## Quick start (Docker Compose)

```bash
cp .env.example .env               # set ANTHROPIC_API_KEY and EVE_PASSWORD
docker compose up --build
```

Compose starts PostgreSQL, applies migrations, starts the Eve runtime and the
app on <http://localhost:3000>. The `scan_data` volume is shared between the app
(requests/results/usage) and Eve (checkouts).

## Using it

1. **Add repository**: URL, branch, cron schedule (UTC), enabled switch.
2. **Scan now** on the dashboard or repository page, or wait for `nextScanAt`.
3. Watch the scan phase update live (cloning → indexing → knowledge → scanning →
   reconciling).
4. The repository page shows the overall score and A–F grade, score delta,
   scanner scores, new/improved/resolved/regressed counts, active findings, scan
   history, token/cost usage and **change over time** charts. The global
   **Scans** page shows usage across every repository.
5. Each scanner page shows its score trend, findings with evidence and
   recommendations, and the aggregated **fix prompt** with a Copy button.

## Scanners

Defined in [`src/lib/scanners.ts`](src/lib/scanners.ts). Every enabled scanner
runs on every scan as its own Eve subagent session with read-only filesystem
access (`bash`, `read_file`, `glob`, `grep`) and, when available, GitNexus MCP
tools.

Architecture & Modularity · Duplication & Abstraction · Dead & Obsolete Code ·
Complexity & Maintainability · Tests & Testability · Reliability & Error
Handling · Documentation & Understandability · Domain & API Design · Type
Safety & Data Contracts · Consistency / Vibe Debt · Dependencies & Build Health
· Security Hygiene

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

## Token and cost tracking

Eve hooks record the provider-reported input, output, cache-read and cache-write
tokens for the root agent, knowledge agent and every scanner step. They append
usage-only JSON lines under `data/usage/`; prompts and model responses are never
logged. After a scan settles, the app deduplicates and aggregates those records,
stores scan and per-scanner totals in PostgreSQL, and removes the temporary file.

Costs are estimates based on the configured model's provider list price. A
provider-reported cost takes precedence when available. Unknown models still
show token counts and model calls, but their cost is shown as unavailable rather
than guessed.

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

Every observation is stored as a `finding_occurrences` row, which powers the
"active findings over time" chart.

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
bun run check            # Biome + import boundaries
bun run test             # focused pricing and usage-accounting tests
bun run typecheck
bun run build
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
| `EVE_URL`, `EVE_USERNAME`, `EVE_PASSWORD` | Eve runtime endpoint and HTTP Basic credentials |
| `SCHEDULER_INTERVAL_SECONDS` | How often the app looks for due repositories |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `TECDEBT_MODEL` | Model access for the Eve agents |
| `GITNEXUS_ENABLED`, `GITNEXUS_MCP_PORT` | Optional code-intelligence layer |

## Repository access

The PoC clones with the credentials already available on the host that runs
the Eve runtime. For `github.com` URLs it asks the local **GitHub CLI**
(`gh auth git-credential`) when `gh auth status` succeeds; otherwise it falls
back to the Git credential helpers configured on the host. Public repositories
need nothing. The logic lives in a single function,
[`eve/agent/lib/git-auth.ts`](eve/agent/lib/git-auth.ts), so a later version
can swap in GitHub App installation tokens (per-repository `x-access-token`
credentials) without changing the clone step. That is also where the future
GitHub push webhook trigger will plug into `startScan(repositoryId, 'webhook')`.

## Limitations

- Repository access uses local `gh`/Git credentials; a GitHub App integration
  is planned but not part of the PoC.
- Scans interrupted by an app restart are marked failed even though Eve's
  durable session may finish; results are not re-attached.
- The sandbox is `just-bash` (virtual shell, no real toolchains, no network).
  Switch `eve/agent/sandbox/sandbox.ts` to `docker()` when scanners must run
  real language tooling.
- Scanners sample large repositories; very large monorepos may exceed a single
  scan's context and should be split.
- GitNexus supports a fixed set of languages; other languages are analyzed
  from the filesystem only.
- No authentication in front of the app. Put a proxy in front for anything
  beyond local use.
- The automated suite currently covers pricing and usage accounting; the wider
  scan and reconciliation pipeline still relies on integration verification.
