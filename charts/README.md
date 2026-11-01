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

| Value                                                                                  | Purpose                                                                       |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `secrets.existingSecret`                                                               | Secret with `EVE_PASSWORD`, `OPENAI_API_KEY` and optionally `OPENAI_BASE_URL` |
| `hodor.existingSecret`                                                                 | Secret with Hodor's `PASSWORD` and session `SECRET`                           |
| `hodor.image.tag` or `hodor.image.digest`                                              | Pinned Hodor image                                                            |
| `postgresql.existingSecret` or `postgresql.external.host` + `postgresql.auth.password` | Database access                                                               |

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

## MCP

MCP is stateless Streamable HTTP with **no authentication**, so the chart never
routes it through the Ingress or Hodor. Set `mcp.enabled=true` to create a
private `<release>-mcp` ClusterIP Service plus a NetworkPolicy rule admitting
only `mcp.allowedCidrs` (for example a VPN range) and `mcp.allowedNamespaces`;
at least one is required and `networkPolicy.enabled` must stay on. Those sources
reach the app port directly, which has no login, so list only trusted ranges.
The app additionally rejects any Host/Origin outside `localhost`, the Service
names, `mcp.allowedHosts` and `mcp.allowedOrigins`.

```yaml
mcp:
  enabled: true
  allowedCidrs: ["100.64.0.0/10"] # tailnet / VPN
  allowedNamespaces: []
  allowedHosts: [] # extra VPN DNS names
  allowedOrigins: [] # browser clients only; native clients omit Origin
```

Connect with `codex mcp add codetend --url http://<release>-mcp.<namespace>.svc/api/mcp`
(or the VPN-reachable name); there is no login step. Tool availability is
managed on CodeTend's Settings page.
