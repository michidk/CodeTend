# Operations

## Deployment shape

Run one app replica, one Eve runtime and PostgreSQL with a shared `scan_data`
volume. The database enforces one active scan per repository and one active
proposal per finding; configured scan/patch capacity and the shared daily AI
cost limit provide additional admission control.
Terminate TLS at a trusted reverse proxy and keep the app bound to loopback or
a private network. The app has no login of its own — put a login-gating
proxy (for example Hodor) in front of it; do not expose it directly.

Replace every `change-me` value in `.env`. Keep the Eve password, database
password, OpenAI API key and the optional GitHub App private key (or plain
`GITHUB_TOKEN`) in the deployment secret store. Rotate them without
committing values to the repository; a GitHub App's installation token itself
needs no rotation since CodeTend mints and caches a fresh one from the App
credentials, but the private key backing it should still be rotated
periodically like any other long-lived credential.

## Isolated finding validation

Validation requires the Eve runtime itself to have an authorized Docker-capable
execution boundary. The shipped Compose service intentionally has neither a
Docker socket mount nor a nested daemon, so validation defaults to disabled in
Compose. Do not add `/var/run/docker.sock` to the container; use a separately
isolated Eve deployment when executable validation is required.

Validation containers have no network, drop every capability, enable
`no-new-privileges`, use PID/CPU/memory limits and a read-only root filesystem,
and receive source read-only before copying it into a disposable workspace.
Missing isolation is recorded as `unavailable`; repository commands never run
directly on the app or Eve host.

## Patch review boundary

Patch generation is limited to one finding and its exact last-seen revision.
The fixer sees a read-only checkout and returns a unified diff; a trusted
workflow applies it only inside a disposable clone after rejecting binary,
symlink, absolute-path and traversal changes. If an isolated reproducer exists,
the patched clone is checked again. Reviewers must approve or reject every
proposal in CodeTend. Approval never writes to GitHub or the registered source
repository; download the `.diff` and apply it through the organization's normal
review and CI process.

Fixer usage is recorded on the patch and included in the same UTC-day budget as
scan usage. `TECDEBT_MAX_ACTIVE_PATCHES` bounds concurrent fixer jobs (default
one); the per-session input-token ceiling also applies to both the root and
fixer sessions.

## Health and rollout

`GET /api/health` is intentionally unauthenticated for orchestration probes. It
returns ready only when PostgreSQL, all committed migrations and Eve are
available. Run migrations before switching traffic to a new app image:

```bash
docker compose run --rm migrate
docker compose up -d eve app
curl --fail http://127.0.0.1:3000/api/health
```

Use immutable image digests in a production deployment. Keep the previous app
and Eve images available for rollback; database migrations are forward-only,
so test upgrades against a restored backup before rollout.

## Backup and restore

Back up PostgreSQL before migrations and on a recurring schedule. Also back up
the deployment configuration; the shared scan volume is transient and does not
need durable backup.

```bash
docker compose exec -T postgres pg_dump -U tecdebt -d tecdebt -Fc > codetend.dump
```

Test restores in an isolated database. Never overwrite the production database
as a restore test.

## Monitoring

Alert when `/api/health` is non-200, a scan remains queued/running near its
three-hour timeout, scanner failures increase, disk usage grows unexpectedly,
or daily estimated cost approaches the limit configured on the Settings page.
Application and Eve logs go to stdout/stderr for collection by the container
platform.

The global review file glob in Settings defines which source-file paths are
eligible for model-backed work. The file review budget is applied to those
matches and bounds the per-repository sample.
Use the default scan cost limit in Settings to flag scans whose final estimated
usage exceeds the expected per-scan budget; it is an accounting threshold, not
a hard interruption point.

## Retention and deletion

Completed and failed scans remove transient request/result JSON, usage events,
checkouts and per-scan GitNexus indexes. Startup prunes stale exchange and usage
files while preserving recoverable active scans. Deleting a repository cascades
its PostgreSQL history and performs another artifact cleanup pass. Backup
retention is controlled separately by the operator.
