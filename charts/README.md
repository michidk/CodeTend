# CodeTend Helm chart

Deploys CodeTend as one Pod with three containers: the web app, the Eve
scanner runtime and a Hodor login gate. The Service targets Hodor, so the app
port is never reachable from outside the Pod, and the Eve port (2000) is
neither exposed through the Service nor admitted by the NetworkPolicy; the app
reaches it over the Pod's loopback. A Helm hook Job runs database migrations
before each install and upgrade.

PostgreSQL is external. Point `postgresql.existingSecret` at a Secret holding
the connection URL, or set `postgresql.external.host` and `postgresql.auth.*`
and let the chart assemble it. The app and Eve share a `ReadWriteOnce` claim
for scan exchange data (transient) and Eve keeps its durable workflow state on
a second claim, so the Deployment runs one replica with `Recreate`.

## Required values

| Value | Purpose |
| --- | --- |
| `secrets.existingSecret` | Secret with `EVE_PASSWORD`, `OPENAI_API_KEY` and optionally `OPENAI_BASE_URL` |
| `hodor.existingSecret` | Secret with Hodor's `PASSWORD` and session `SECRET` |
| `hodor.image.tag` or `hodor.image.digest` | Pinned Hodor image |
| `postgresql.existingSecret` or `postgresql.external.host` + `postgresql.auth.password` | Database access |

`github.appAuth.existingSecret` is optional; it enables private-repository
clones through a GitHub App whose installation tokens CodeTend mints itself
after resolving every installation (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`).
Install the App on every scanned repository with **Contents: Read-only** so
scans and disposable patch generation can clone private repositories. GitHub
grants the required Metadata read access
automatically; no organization or account permissions are needed.

## Example

```bash
helm install codetend ./charts \
  --set image.tag=latest \
  --set eve.image.tag=latest \
  --set hodor.image.tag=0.3.1 \
  --set hodor.existingSecret=codetend-hodor \
  --set secrets.existingSecret=codetend-secrets \
  --set github.appAuth.existingSecret=codetend-github-app \
  --set postgresql.existingSecret=codetend-database
```

Executable finding validation needs Docker inside the Eve container and is
disabled in this chart; findings that would need it are recorded as
`unavailable`. GitNexus code intelligence is likewise off.

## OAuth-protected MCP

Set `mcp.enabled=true` to expose CodeTend's first-party MCP endpoint at
`https://<host>/api/mcp`. The chart reuses the Hodor session secret for a
derived OAuth signing key, preserves the public Host header, and bypasses the
login form only for MCP protocol/discovery/token paths. Owner consent remains
behind Hodor at `/oauth/authorize`.

```yaml
mcp:
  enabled: true
  allowedOrigins: [] # add browser clients only; native clients omit Origin
```

After deployment, connect with `codex mcp add codetend --url
https://<host>/api/mcp` and `codex mcp login codetend`. Tool availability,
connected clients, and revocation are managed on CodeTend's Settings page.
