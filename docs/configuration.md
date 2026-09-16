# Configuration reference

Deployment settings are environment variables. `.env.example` documents a
working local layout; Docker Compose maps the same names into the `app` and
`eve` services. The app validates its variables on startup with Zod and
reports the affected names. The global repository cron, enabled state, and
cooldown between queued repositories are stored in PostgreSQL and edited on
the Settings page. Scanner enablement and custom scanner definitions are also
stored in PostgreSQL and managed on the Scanners page. These settings apply to
every repository; a running scan keeps the definitions it started with.

The `TECDEBT_*` prefix is retained for configuration compatibility after the
project was renamed to CodeTend.

## Database and storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | – | PostgreSQL connection string (required) |
| `TECDEBT_DATA_DIR` | `./data` | Shared directory for scan requests/results, checkouts, usage records and GitNexus indexes. Must be the same directory for the app and Eve. |

## Network boundary and clone access

The app has no login of its own; put a login-gating reverse proxy (for
example [Hodor](https://github.com/michidk/hodor)) or another trusted network
boundary in front of it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TECDEBT_ALLOWED_GIT_HOSTS` | `github.com` | Comma-separated exact clone-host allowlist |
| `TECDEBT_ALLOW_LOCAL_REPOSITORIES` | `false` | Allow `file://` URLs and absolute paths (development only) |
| `TECDEBT_ALLOW_INSECURE_GIT` | `false` | Allow plaintext `http://` clones (development only) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | – | Optional GitHub App credentials for browsing repositories, cloning private HTTPS repositories, and publishing automated fix pull requests. CodeTend resolves the installation per repository, then mints and caches its own installation tokens; both are required together and take precedence over `GITHUB_TOKEN`. Automated fixes require repository contents and pull-request write permissions. |
| `GITHUB_TOKEN` | – | Optional plain short-lived token for browsing and cloning repositories when no GitHub App credentials are configured |
| `HODOR_SECRET` | – | Enables the first-party OAuth-protected MCP endpoint using the same 32+ character secret configured as Hodor `SECRET`; the app derives a separate OAuth signing key |
| `MCP_ALLOWED_ORIGINS` | – | Comma-separated allowlist for browser MCP clients; native clients omit `Origin` |

### OAuth-protected MCP

CodeTend serves MCP at `/api/mcp` on its normal public origin. It includes
OAuth 2.1 discovery, dynamic client registration, PKCE authorization, refresh
token rotation, revocation, owner-selectable tool policy, and audit events.
The Helm chart wires the machine-facing paths around Hodor's login form while
keeping `/oauth/authorize` owner-authenticated. Enable it with `mcp.enabled`;
do not expose the app port or MCP paths around Hodor through another proxy.

Connect Codex after deployment:

```bash
codex mcp add codetend --url https://codetend.example.com/api/mcp
codex mcp login codetend
```

The owner can pause MCP, hide individual tools, and revoke clients from the
CodeTend Settings page. The `codetend:write` scope controls scan-trigger and
scan-cancellation tools; read access alone cannot spend model budget.

## Cost and concurrency guardrails

| Variable | Default | Purpose |
| --- | --- | --- |
| `TECDEBT_MAX_ACTIVE_SCANS` | `2` | Global concurrent scan limit |
| `TECDEBT_MAX_ACTIVE_PATCHES` | `1` | Global concurrent fixer-job limit |
| `TECDEBT_MAX_DAILY_COST_USD` | unlimited | UTC-day estimated AI spend across scans and patches; new work is refused once reached |
| `TECDEBT_DEFAULT_SCAN_COST_USD` | – | Optional per-scan budget suggestion; flags scans whose final estimate exceeds it |
| `TECDEBT_MANUAL_SCAN_COOLDOWN_SECONDS` | `60` | Per-repository cooldown between manual scans |
| `TECDEBT_SCANNER_CONCURRENCY` | `4` | How many scanner subagents run at once inside one scan |
| `TECDEBT_MAX_INPUT_TOKENS_PER_SESSION` | unlimited | Cumulative input-token ceiling per knowledge, scanner or fixer session. A session that reaches it parks the scan until an operator approves more budget; prefer the USD caps. |

## Isolated validation

| Variable | Default | Purpose |
| --- | --- | --- |
| `TECDEBT_VALIDATION_ENABLED` | `false` | Run model-proposed reproducers in disposable containers. Requires Eve to have Docker access; never falls back to the host. |
| `TECDEBT_VALIDATION_RUNNER` | `auto` | `auto`, `docker` or `disabled` |
| `TECDEBT_VALIDATION_IMAGE` | `node:26-bookworm-slim` | Image used for validation containers |

## Eve runtime and models

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVE_URL` | `http://127.0.0.1:2000` | Eve runtime endpoint as seen from the app |
| `EVE_USERNAME`, `EVE_PASSWORD` | – | HTTP Basic credentials shared between app and Eve |
| `SCHEDULER_INTERVAL_SECONDS` | `30` | How often the app checks the global schedule and its repository queue |
| `OPENAI_API_KEY` | – | API key for the OpenAI-compatible endpoint (required by Eve) |
| `OPENAI_BASE_URL` | OpenAI | Point at a gateway such as OpenRouter to run other vendors' models |
| `TECDEBT_MODEL` | `gpt-5.6-sol` | Model id passed to the endpoint, for example `anthropic/claude-opus-5` through a gateway |
| `TECDEBT_EFFORT` | `medium` for GPT, `high` for Claude | Reasoning effort: `low`, `medium`, `high`, `xhigh` or `max` |
| `TECDEBT_MODEL_CONTEXT_WINDOW_TOKENS` | `1050000` | Context window of the configured model |

## Optional tooling

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITNEXUS_ENABLED` | `false` | Index each checkout with GitNexus and expose its MCP tools to agents |
| `GITNEXUS_MCP_PORT` | `3907` | Port of the per-scan GitNexus MCP server |
| `GITNEXUS_BIN` | auto | Path to the `gitnexus` binary; otherwise `.tools/node_modules/.bin`, `~/.local/bin`, `/usr/local/bin` and `PATH` are searched |
| `GITNEXUS_MCP_URL` | derived | Eve-side URL of the GitNexus MCP server (set automatically by the start scripts and Compose) |
| `OSV_SCANNER_BIN` | auto | Path to Google's OSV Scanner for local Eve runs; the Docker image includes a pinned build |
| `TECDEBT_DEVTOOLS` | `false` | Enable the TanStack devtools overlay in `vite dev` |
