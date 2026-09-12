# Security policy

## Supported version

Security fixes are made on `main`. This project is still a proof of concept;
operators should deploy a reviewed commit rather than an unpinned image tag.

## Reporting a vulnerability

Report vulnerabilities privately through a
[GitHub security advisory](https://github.com/michidk/tecdebt/security/advisories/new).
If that channel is unavailable, email <michael@lohr.dev>. Do not open a public
issue containing credentials, private source, exploit details or customer data.

Include the affected commit, deployment assumptions, reproduction steps and
impact. Remove secret values and personal data from logs. The maintainer will
acknowledge the report, assess severity, coordinate a fix and publish credit
only with the reporter's consent.

## Deployment boundary

- Terminate TLS before tecdebt and configure a strong
  `TECDEBT_BASIC_AUTH_PASSWORD`.
- Keep PostgreSQL and Eve on private networks. Never publish their ports.
- Use short-lived, least-privilege GitHub App installation tokens for private
  clones. Restrict `TECDEBT_ALLOWED_GIT_HOSTS` to required hosts.
- Leave local repositories and plaintext Git transport disabled in hosted
  deployments.
- Treat scanned repositories as untrusted input. The LLM sandboxes are
  read-only and networkless; OSV Scanner is the only repository analysis step
  that intentionally uses its public vulnerability service.
- Review [PRIVACY.md](PRIVACY.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md)
  before accepting private repositories.
