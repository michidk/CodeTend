# Configuration reference

Deployment settings are environment variables. `.env.example` documents a
working local layout; Docker Compose maps the same names into the `app` and
`eve` services. The app validates its variables on startup with Zod and
reports the affected names. The default repository scheduling mode, enabled
state, and cooldown between queued repositories are stored in PostgreSQL and
edited on the Settings page. Cron mode queues every inherited repository at
once; distributed mode rotates through them. One scan per day runs at 03:00
UTC; higher frequencies use evenly spaced intervals. Manual scans do not move
the automatic schedule. Individual repositories can override either default with their own cron
or disable scheduled runs; five-field cron day-of-week expressions support
weekday and weekly schedules. Scanner enablement and custom scanner definitions
are also stored in PostgreSQL and managed on the Scanners page. A running scan
keeps the definitions it started with.

The `TECDEBT_*` prefix is retained for configuration compatibility after the
project was renamed to CodeTend.

## Database and storage

| Variable           | Default  | Purpose                                                                                                                                    |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`     | –        | PostgreSQL connection string (required)                                                                                                    |
| `TECDEBT_DATA_DIR` | `./data` | Shared directory for scan requests/results, checkouts, usage records and GitNexus indexes. Must be the same directory for the app and Eve. |

## Network boundary and clone access

The app has no login of its own; put a login-gating reverse proxy (for
example [Hodor](https://github.com/michidk/hodor)) or another trusted network
boundary in front of it.

| Variable                                  | Default      | Purpose                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TECDEBT_ALLOWED_GIT_HOSTS`               | `github.com` | Comma-separated exact clone-host allowlist                                                                                                                                                                                                                                                                                         |
| `TECDEBT_ALLOW_LOCAL_REPOSITORIES`        | `false`      | Allow `file://` URLs and absolute paths (development only)                                                                                                                                                                                                                                                                         |
| `TECDEBT_ALLOW_INSECURE_GIT`              | `false`      | Allow plaintext `http://` clones (development only)                                                                                                                                                                                                                                                                                |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | –            | Optional GitHub App credentials for browsing repositories and cloning private HTTPS repositories. CodeTend resolves the installation per repository, then mints and caches its own installation tokens; both are required together and take precedence over `GITHUB_TOKEN`. See [GitHub App permissions](#github-app-permissions). |
| `GITHUB_TOKEN`                            | –            | Optional plain short-lived token for browsing and cloning repositories when no GitHub App credentials are configured                                                                                                                                                                                                               |
| `MCP_ALLOWED_HOSTS`                       | –            | Extra comma-separated hostnames accepted in the `Host` header of MCP requests, on top of `localhost`, `127.0.0.1` and `[::1]`                                                                                                                                                                                                      |
| `MCP_ALLOWED_ORIGINS`                     | –            | Extra comma-separated hostnames (or origin URLs) accepted in the `Origin` header; native clients send none                                                                                                                                                                                                                         |

### GitHub App permissions

Install the App on every repository CodeTend scans. GitHub grants Metadata
read access automatically; configure the remaining repository permissions as
follows:

| Repository permission | Required access | Used for                                                                           |
| --------------------- | --------------- | ---------------------------------------------------------------------------------- |
| Contents              | Read-only       | Clone private repositories for scans and disposable patch generation               |
| Metadata              | Read-only       | Resolve the installation and repository metadata (granted automatically by GitHub) |

No organization or account permissions are required. Do not grant
Administration, Actions, Workflows, Secrets, or Members access. After changing
an existing App's permissions, an installation owner must approve the pending
permission request before newly minted installation tokens receive the updated
permissions.

### MCP

CodeTend serves MCP at `/api/mcp` as stateless Streamable HTTP using protocol
revision 2026-07-28 (2025-era clients are answered statelessly too). **The
endpoint has no authentication**: anyone who can reach it can call every tool
you leave enabled on **Settings → AI access (MCP)**, including the write tools.
Security therefore rests on two layers:

1. **Network restriction.** Keep the port on loopback (Compose publishes
   `127.0.0.1` only), behind a firewall, or on a private VPN. In Helm,
   `mcp.enabled` adds a private `<release>-mcp` ClusterIP Service (never in the
   Ingress) and a NetworkPolicy rule limited to `mcp.allowedCidrs` and
   `mcp.allowedNamespaces`. Those sources reach the app port directly, which
   also has no login, so list only trusted ranges.
2. **Host and Origin validation** on every request against loopback plus
   `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS`; anything else gets `403`. This
   blocks DNS-rebinding from browsers. No CORS headers are sent.

Connect Codex (no login step; use the loopback, VPN or in-cluster URL):

```bash
codex mcp add codetend --url http://127.0.0.1:3000/api/mcp
```

The owner can pause MCP and hide individual tools from the CodeTend Settings
page. Disabling the write tools (register, scan, triage) is the only way to
make the endpoint read-only; read tools cannot spend model budget.

## Cost and concurrency guardrails

The Settings page persists separate FIFO concurrency limits and default
model/reasoning-effort profiles for scans and fix agents. Each scanner can
override the scan profile from the Scanners page. Changes affect newly queued
work; a queued job keeps the profile it was created with.

| Variable                               | Default   | Purpose                                                                                                                                                                       |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS` | `60`      | Per-repository cooldown between manual scans                                                                                                                                  |
| `TECDEBT_SCANNER_CONCURRENCY`          | `4`       | How many scanner subagents run at once inside one scan                                                                                                                        |
| `TECDEBT_MAX_INPUT_TOKENS_PER_SESSION` | unlimited | Cumulative input-token ceiling per knowledge, scanner or fixer session. A session that reaches it parks the scan until an operator approves more budget; prefer the USD caps. |

The UTC-day AI cost limit and default per-scan cost limit are persisted and
managed from the application Settings page. They default to unlimited.

## Isolated validation

| Variable                     | Default                 | Purpose                                                                                                                    |
| ---------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `TECDEBT_VALIDATION_ENABLED` | `false`                 | Run model-proposed reproducers in disposable containers. Requires Eve to have Docker access; never falls back to the host. |
| `TECDEBT_VALIDATION_RUNNER`  | `auto`                  | `auto`, `docker` or `disabled`                                                                                             |
| `TECDEBT_VALIDATION_IMAGE`   | `node:26-bookworm-slim` | Image used for validation containers                                                                                       |

## Eve runtime and models

| Variable                              | Default                             | Purpose                                                                                                      |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `EVE_URL`                             | `http://127.0.0.1:2000`             | Eve runtime endpoint as seen from the app                                                                    |
| `EVE_USERNAME`, `EVE_PASSWORD`        | –                                   | HTTP Basic credentials shared between app and Eve                                                            |
| `SCHEDULER_INTERVAL_SECONDS`          | `30`                                | How often the app checks the global schedule and its repository queue                                        |
| `OPENAI_API_KEY`                      | –                                   | API key for the OpenAI-compatible endpoint (required by Eve)                                                 |
| `OPENAI_BASE_URL`                     | OpenAI                              | Point at a gateway such as OpenRouter to run other vendors' models                                           |
| `TECDEBT_MODEL`                       | `gpt-5.6-sol`                       | Eve fallback model for sessions started outside CodeTend; CodeTend jobs use their persisted Settings profile |
| `TECDEBT_EFFORT`                      | `medium` for GPT, `high` for Claude | Eve fallback reasoning effort for sessions started outside CodeTend                                          |
| `TECDEBT_MODEL_CONTEXT_WINDOW_TOKENS` | `1050000`                           | Context window of the configured model                                                                       |

## Optional tooling

| Variable            | Default | Purpose                                                                                                                       |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GITNEXUS_ENABLED`  | `false` | Index each checkout with GitNexus and expose its MCP tools to agents                                                          |
| `GITNEXUS_MCP_PORT` | `3907`  | Port of the per-scan GitNexus MCP server                                                                                      |
| `GITNEXUS_BIN`      | auto    | Path to the `gitnexus` binary; otherwise `.tools/node_modules/.bin`, `~/.local/bin`, `/usr/local/bin` and `PATH` are searched |
| `GITNEXUS_MCP_URL`  | derived | Eve-side URL of the GitNexus MCP server (set automatically by the start scripts and Compose)                                  |
| `OSV_SCANNER_BIN`   | auto    | Path to Google's OSV Scanner for local Eve runs; the Docker image includes a pinned build                                     |
| `TECDEBT_DEVTOOLS`  | `false` | Enable the TanStack devtools overlay in `vite dev`                                                                            |
