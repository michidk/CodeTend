# Data handling

tecdebt processes source repositories, file metadata, model-generated
repository knowledge and findings, Git commit identifiers, scan status, and
token/cost usage. Operators are responsible for having permission to process
every registered repository.

Repository content is cloned into a transient workspace and portions selected
by the agents are sent to the configured OpenAI-compatible endpoint. Supported
dependency manifests and lockfiles are inspected by OSV Scanner, which may use
Google's OSV service. CVE identifiers are queried against FIRST EPSS and the
CISA Known Exploited Vulnerabilities catalog. Review those providers' terms and
data policies for the endpoints you configure.

PostgreSQL retains repository configuration, editable security context,
findings, occurrences, proposed patch diffs, validation command output,
coverage, SHA-256-hashed scan exports, scan metadata and usage totals until the
repository is deleted. Patch diffs, validation output and fixer summaries can
include source excerpts or test output and should be handled like repository
content. Raw scan/patch request and result files, usage event files, checkouts,
disposable validation workspaces and GitNexus indexes are removed after
persistence. Deleting a repository cascades its database records and attempts
to remove any remaining transient files.
Database backups remain subject to the operator's own retention schedule.

Do not register repositories containing data that the configured model or
vulnerability providers are not permitted to process. Never include production
credentials in repository URLs; use the deployment's credential integration.
