# Data handling

CodeTend is self-hosted, but a scan sends selected repository content and
repository-derived context to the OpenAI-compatible model provider configured
by the operator. Private source therefore crosses the deployment boundary
unless the configured provider runs inside that boundary.

## Data processed

CodeTend processes repository URLs, branches, commit metadata, source files,
dependency manifests and lockfiles, generated repository knowledge, security
profiles, findings, validation output, and model usage totals. Git credentials
are resolved in the Eve runtime and are not included in model prompts or
stored with findings.

## External services

- The configured Git host receives clone and fetch requests.
- The configured model provider receives the bounded source context and task
  instructions needed by knowledge, scanner, review, and fixer agents.
- OSV receives package ecosystem, name, and version queries for dependency
  vulnerability matching.
- GitNexus runs locally when enabled; CodeTend does not require a hosted
  GitNexus service.

Provider retention and training policies are controlled by the provider and
the operator's account. CodeTend cannot enforce those external policies.

## Stored data

PostgreSQL retains repository configuration, scan and finding history,
knowledge and security profiles, dependency results, usage totals, OAuth
records, and patch proposals. Usage records contain token and cost accounting,
not model prompt or response bodies.

Repository checkouts, request/result exchange files, validation artifacts,
and usage event files live under `TECDEBT_DATA_DIR`. CodeTend removes transient
scan and patch workspaces and exchange artifacts after terminal processing;
unexpected process or host failure can leave files behind until recovery or
operator cleanup. Database backups and persistent volume snapshots retain the
data included in them according to the operator's backup policy.

## Operator responsibilities

- Choose a model provider and retention policy suitable for the repositories.
- Restrict the GitHub App or token to the repositories CodeTend should read.
- Protect PostgreSQL, `TECDEBT_DATA_DIR`, backups, model credentials, Git
  credentials, Eve credentials, and the Hodor signing secret.
- Put an authentication proxy or trusted network boundary in front of the app;
  CodeTend does not implement multi-user authorization.
- Remove a repository from CodeTend and delete retained backups separately
  when its data must no longer be retained.

See [Architecture](docs/architecture.md),
[Configuration](docs/configuration.md), and [Operations](docs/OPERATIONS.md)
for the concrete trust boundaries and deployment controls.
