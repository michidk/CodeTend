import type { ReasoningEffort } from '@/lib/agent-execution'

/**
 * Registry of specialized scanners. Adding a scanner means appending an entry
 * here: the scan pipeline, scoring, UI and fix prompts all iterate this list.
 * The `prompt` describes the dimension the scanner reviews; the shared
 * analysis contract (tools, language-agnostic reasoning, output schema) is
 * provided by the Eve scanner subagent instructions.
 */
export interface ScannerDefinition {
  readonly id: string
  readonly name: string
  /** Agent scanners review source; dependency-audit is produced by OSV. */
  readonly kind?: 'agent' | 'dependency-audit'
  /** Independent review and priority enrichment for source security findings. */
  readonly securityReview?: 'application' | 'ci'
  /** Short label for compact UI such as chart legends. */
  readonly shortName: string
  readonly description: string
  /** Relative weight when combining scanner scores into the overall score. */
  readonly weight: number
  readonly enabled: boolean
  /** Optional model override; null inherits the global scan profile. */
  readonly model?: string | null
  /** Optional reasoning override; null inherits the global scan profile. */
  readonly effort?: ReasoningEffort | null
  /** Custom scanners are operator-defined and can be removed. */
  readonly custom?: boolean
  /** Dimension-specific review instructions handed to the scanner agent. */
  readonly prompt: string
  /** Title of the aggregated coding-agent prompt, e.g. "Fix Architecture Issues". */
  readonly fixPromptTitle: string
  /**
   * Dimension-specific handling rules appended to the fix prompt, for
   * findings whose naive fix is wrong or harmful (e.g. deleting a committed
   * secret without rotating it).
   */
  readonly fixGuidance?: string
}

export const SCANNERS: readonly ScannerDefinition[] = [
  {
    id: 'architecture',
    name: 'Architecture & Modularity',
    shortName: 'Architecture',
    description:
      'Boundaries, responsibilities, coupling, cohesion, dependency direction and structural maintainability.',
    weight: 1.5,
    enabled: true,
    fixPromptTitle: 'Fix Architecture Issues',
    prompt: `Review the repository's architecture and modularity: how the code is divided into modules and subsystems and whether those divisions hold.
Infer the intended layering and module boundaries from the directory structure, entry points, build/manifest files, contributor docs and imports, then judge how well the code honors them.
Look for: modules that know too much about each other, cycles or source dependencies that violate the established boundaries, god modules/files that concentrate unrelated responsibilities, infrastructure concerns (database, HTTP, framework) leaking into domain logic, missing or inconsistent boundaries between subsystems, "generic" layers that secretly branch on specific implementations, and structures that make the most common kinds of change ripple across many files.
Distinguish source dependency direction from runtime call direction. Infrastructure implementing domain-owned ports is legitimate dependency inversion, not a layering violation. Require a concrete change scenario and the imports that make it unnecessarily cross boundaries.
Yours is the shape of the module graph: which module depends on which, and who owns which responsibility. Not yours: the design of an individual interface or type (Domain & API Design), the internals of one long function (Complexity), copies of the same logic (Duplication), or implementation conventions that do not violate module boundaries (Consistency).
Calibrate: a structure is a finding when a realistic change incurs demonstrable cross-module cost, not when it merely differs from a layout you prefer. Name the boundary that is violated and the concrete imports or calls that violate it.`,
  },
  {
    id: 'duplication',
    name: 'Duplication & Abstraction',
    shortName: 'Duplication',
    description:
      'Semantic duplication, parallel implementations, unnamed recurring concepts, and abstractions that do not earn their place.',
    weight: 1.25,
    enabled: true,
    fixPromptTitle: 'Reduce Duplication & Improve Abstractions',
    prompt: `Find meaningful semantic duplication in the repository and judge whether its abstractions earn their existence. Look for rules that must evolve together but are maintained independently. Similar code in independent domains need not be unified.
Duplication: the same logic implemented more than once where no shared implementation exists, so that the copies must evolve together. Focus on duplicated business rules, validation logic, data models/DTOs that describe the same thing, parallel implementations of the same behavior (two clients for the same service, two parsers for the same format, two ways to compute the same value), copy-pasted procedures, and concepts that recur in several *different* shapes so that no single extraction would name them. Highlight where the copies have already drifted or where drift would be dangerous. Ignore trivial textual repetition, boilerplate required by the language or framework, and test-fixture repetition unless it hides real drift.
Abstraction: layers that demonstrably scatter a routine change, hide behavior, or force callers to depend on implementation details. Single-implementation interfaces, factories, adapters and one-off helpers are not findings by themselves: check whether they provide an architectural port, external compatibility, test seam, or meaningful name. Name the actual maintenance cost before recommending removal.
Not yours: call sites that skip an existing shared helper and inline their own version (Consistency owns bypassed conventions), two competing designs for the same domain entity or public contract (Domain & API Design), the module dependency graph and layering (Architecture), the size and control flow of a single function (Complexity), or statement-level padding such as narrating comments, redundant checks and single-use variables that never form a layer (AI Slop & Noise).
Calibrate: use search aggressively (identical identifiers, similar function names, repeated string literals and error messages, similar shapes) to confirm duplication rather than guessing from one file. One finding per duplicated or misplaced concept, with every copy or layer listed as a location; state clearly why the locations are the same logic, name the concept that should exist or be removed, and do not propose abstractions for variation that does not exist yet.`,
  },
  {
    id: 'dead-code',
    name: 'Dead & Obsolete Code',
    shortName: 'Dead code',
    description:
      'Unused, unreachable, obsolete or superseded code, configuration and concepts.',
    weight: 0.75,
    enabled: true,
    fixPromptTitle: 'Remove Dead Code',
    prompt: `Find dead, unreachable, obsolete or superseded code and concepts.
Look for: exported functions, classes, types, components, modules, scripts, configuration keys, feature flags, database columns, environment variables that have no consumers; code paths guarded by conditions that can never be true; deprecated or "legacy"/"old"/"v1" implementations that have a successor still in use; TODO-marked temporary code that became permanent; commented-out blocks with real logic; assets with no remaining consumers.
Verify each candidate with repository-wide search (including string references used by reflection, dependency injection, routing tables, templates, configuration and CI) before reporting it. Exclude legitimate entry points such as route files, CLI commands, plugin registrations, framework conventions, test helpers and the public API of a library. Protect historical migrations needed to recreate or upgrade a database, compatibility paths, serialization contracts and externally consumed interfaces. A legacy name or old TODO is not evidence of non-use. If the repository already runs an unused-code tool (for example knip, ts-prune, vulture, deadcode, cargo's warnings) treat its configuration and ignore lists as evidence of intent and only report what escapes it.
Not yours: unused third-party dependencies (Dependencies & Build Health), code that is used but obsolete in design (Architecture or Consistency), missing or inaccurate documentation (Documentation), or code that is referenced and runs but adds nothing, such as redundant guards, pass-through wrappers and narrating comments (AI Slop & Noise).
Calibrate: prove either absence of consumers after searching all applicable entry points, or unreachability from the controlling conditions even when the code is referenced. Explain the searches or control-flow proof and disclose external consumers you cannot establish. Group many small dead items of the same kind (for example six unused exports in one module) into one finding.`,
  },
  {
    id: 'complexity',
    name: 'Complexity & Maintainability',
    shortName: 'Complexity',
    description:
      'Overly complex, fragile or difficult-to-change code and misplaced responsibilities.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Reduce Complexity',
    prompt: `Review the internal complexity of functions, files and modules: how hard the code is to read, reason about and change safely.
Look for: functions or files that are far longer or more deeply nested than the repository norm, tangled control flow with many interacting flags and early exits, hidden temporal coupling (things that must be called in a certain order), pervasive mutable shared state, interacting responsibilities within a function that obscure its invariants, and control flow that makes a specific change or failure path difficult to reason about. A documented algorithm or a necessary explanatory comment is not evidence of excess complexity.
Not yours: the shape of function signatures, parameter lists and public contracts (Domain & API Design), responsibility placement across modules and the module dependency graph (Architecture), copies of logic (Duplication), missing tests for complex code (Tests & Testability), or line-level padding such as narrating comments and redundant guards that inflates a function without tangling it (AI Slop & Noise).
Calibrate: quantify where possible (approximate line counts, nesting depth, number of branches, number of responsibilities) and compare against the repository's own norm, not an absolute limit. Prioritize the hot spots most likely to change; a long but linear, well-named function is not a finding.`,
  },
  {
    id: 'tests',
    name: 'Tests & Testability',
    shortName: 'Tests',
    description:
      'Important test gaps, brittle tests, missing failure cases and poor testability.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Improve Tests',
    prompt: `Review tests and testability.
First discover how this repository tests itself (frameworks, directories, naming conventions, fixtures, CI configuration and which test commands CI actually runs). Then look for: important behavior with no tests at all (core domain rules, money/time/permission logic, data migrations, destructive operations, error paths), tests that only cover the happy path, brittle tests (asserting on incidental details, heavy mocking that mirrors the implementation, order or time dependence, sleeps), disabled or skipped tests, tests that cannot fail, tests that exist but are never run by CI, and domain rules unnecessarily coupled to infrastructure or global state so focused tests cannot isolate them. Database and network dependencies are appropriate for integration tests; flag a concrete testing obstacle, not the dependency itself.
Not yours: an observed defect itself (its owning scanner includes the regression test in its remediation), or the design of the code under test beyond what blocks testing it.
Calibrate: judge gaps by risk, not by coverage percentage; one untested critical write path outweighs many untested getters. If the repository has no tests, report that once as a single finding rather than one finding per module. Cite inspected tests and the searches, test discovery configuration and CI selection used to establish the gap. When no tests exist, cite the searched locations and manifests rather than inventing a test-file anchor. Security test gaps without an observed vulnerability belong here too.`,
  },
  {
    id: 'reliability',
    name: 'Reliability & Error Handling',
    shortName: 'Reliability',
    description:
      'Validation, error handling, partial states, async/concurrent behavior, retries and silent failures.',
    weight: 1.25,
    enabled: true,
    fixPromptTitle: 'Improve Reliability',
    prompt: `Review reliability and error handling: correct results on valid inputs as well as behavior when dependencies fail or timing is unlucky. Include rounding, dates and time zones, boundary conditions, and invalid state transitions.
Look for: swallowed or logged-and-ignored errors, catch-all handlers that hide failures, missing validation or unchecked assumptions at trust boundaries (user input, external APIs, files, environment) that lead to crashes or wrong behavior, operations that can leave partial state (multi-step writes without transactions or compensation), unhandled promise/async paths and fire-and-forget calls, race conditions and unsafe concurrent access, missing timeouts and cancellation that is not propagated, retries without backoff or idempotency, resources that are never released, and behavior that silently degrades instead of failing clearly.
Yours is incorrect computation, state transitions, concurrency, resource lifetime and failure handling. Not yours: a failure whose root cause is an untruthful data contract or missing boundary validation (Type Safety & Data Contracts), a failure with a supported security consequence (Security Hygiene or CI & GitHub Actions Security), missing tests for failure paths (Tests & Testability), inconsistent error-response formats that do not change behavior (Domain & API Design), or error wrappers and guards that are merely redundant without changing what happens on failure (AI Slop & Noise).
Calibrate: trace at least one concrete failure scenario per finding (what input or event triggers it, what the user or operator observes, what state is left behind) instead of listing generic best practices. Reserve critical for severe data loss, broad outages or comparable consequences reachable with realistic input; ordinary reproducible bugs are not automatically critical.`,
  },
  {
    id: 'documentation',
    name: 'Documentation & Understandability',
    shortName: 'Docs',
    description:
      'Setup, architecture, domain and non-obvious implementation documentation.',
    weight: 0.5,
    enabled: true,
    fixPromptTitle: 'Improve Documentation',
    prompt: `Review documentation and understandability: whether a competent new contributor can set up, run, navigate and safely change the repository from what is written down.
Look for: missing or outdated setup and run instructions, README or contributor-doc claims that contradict the code (commands, options, defaults, directory layout, capabilities), undocumented architecture decisions and module responsibilities, domain terms used without definition, configuration/environment variables with no description, public APIs or complex algorithms with no explanation of intent or invariants, misleading names and comments, and generated or stale docs that no longer match the implementation.
Not yours: the code defect behind a doc/code mismatch when the code is what is wrong (report the mismatch as documentation only when the documentation should change; if the documented behavior is the intended one and the code fails to deliver it, leave it to Reliability or Consistency), or requests for comments on self-explanatory code.
Calibrate: report only documentation whose absence or inaccuracy would realistically cost a contributor significant time or lead them to do the wrong thing. For a mismatch, cite both the documentation and the authoritative code. For missing documentation, cite the undocumented behavior and the documentation locations and searches you checked. Documentation owns incorrect or missing setup/build instructions when the commands work as intended; broken commands, toolchains or CI configuration belong to Dependencies & Build Health.`,
  },
  {
    id: 'domain-api',
    name: 'Domain & API Design',
    shortName: 'Domain & API',
    description:
      'Domain models, interfaces, contracts, naming, consistency and responsibility boundaries.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Improve Domain & API Design',
    prompt: `Review domain modeling and the design of interfaces: the types, function signatures, endpoints and messages through which parts of the system talk to each other and to the outside.
Look for: domain concepts that are modeled inconsistently (the same entity with different shapes, names or units in different places), one concept split across several independently settable fields, models that permit contradictory states or force callers to reconstruct domain rules, functions and endpoints with surprising or inconsistent contracts (different error shapes, pagination styles, naming, nullability, units), long same-typed positional parameter lists, boolean-parameter and flag-driven APIs, and interfaces that expose internals callers should not depend on.
Yours is the shape of the contract as seen by its callers. Not yours: the module dependency graph (Architecture), the internals of a function behind a fine signature (Complexity), whether a contract is enforced at runtime or lies about its data (Type Safety & Data Contracts), or implementation patterns that do not surface in any contract (Consistency).
Calibrate: ground findings in the repository's own vocabulary and conventions; the goal is one coherent model, not a textbook design. Name the canonical shape you recommend and which call sites would change. Plain data models, primitive identifiers and boolean parameters are not defects by themselves; show an ambiguous call, invalid representable state or repeated caller-side workaround.`,
  },
  {
    id: 'type-safety',
    name: 'Type Safety & Data Contracts',
    shortName: 'Type safety',
    description:
      'Safety of data contracts and runtime assumptions, appropriate to the target language.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Strengthen Type Safety & Data Contracts',
    prompt: `Review type safety and data contracts in a way appropriate for the languages used: whether the declared types and schemas tell the truth about the data and whether that truth is enforced where data enters.
For statically typed languages look for escape hatches (any/unknown casts, unchecked casts, raw types, unsafe/nullable misuse, suppressions and lint disables), lies in type declarations (a type claims more than the code guarantees), and types that fail to encode real invariants (strings for identifiers, numbers for units, optional fields that are always present). For dynamically typed languages look for implicit shape assumptions, duck-typed contracts that are not documented or checked, and inconsistent handling of null/undefined/None.
Validated casts, sound narrowing and types that intentionally represent unknown input are not findings. Inspect the upstream runtime validation before calling a contract untruthful.
For every language: data crossing boundaries (HTTP, database, files, queues, config) that is assigned a type or shape without validation, serialization/deserialization that can silently produce wrong values, enums/strings compared without exhaustiveness, and version drift between producer and consumer contracts.
Yours is an untruthful schema/type or missing boundary validation, including concrete failures caused by it; stronger evidence does not transfer ownership to Reliability. Not yours: incorrect computation, retries, concurrency or state transitions with truthful inputs (Reliability), supported security consequences (Security Hygiene or CI & GitHub Actions Security), the choice of domain types and API shapes (Domain & API Design), or configuration and documentation mismatches (Documentation, Consistency).
Calibrate: do not demand types for their own sake; report where a weak or untruthful contract can cause a real defect and say which defect. Prefer one finding per contract, listing every site that relies on it.`,
  },
  {
    id: 'consistency',
    name: 'Consistency / Vibe Debt',
    shortName: 'Consistency',
    description:
      'Whether the repository feels like one coherent system built with shared conventions.',
    weight: 1.25,
    enabled: true,
    fixPromptTitle: 'Restore Consistency',
    prompt: `Review whether the repository feels like one coherent system built with shared conventions.
Identify the dominant convention within the relevant subsystem, language and package for each concern first (how data is fetched, how errors are handled, how components/modules/tests are structured, how configuration is accessed, how user-facing text is formatted, how logging is done, naming and file layout). Then look for: multiple patterns solving the same problem side by side, old and new approaches coexisting without a migration being finished, shared utilities or abstractions that exist but are bypassed in some places with local re-implementations, inconsistent terminology for the same domain object, and locally reasonable implementations that conflict with repository-wide conventions.
Yours is the deviation from an established convention and the fragmentation it causes. Not yours: copies of logic where no shared implementation exists (Duplication), inconsistent shapes in public or domain contracts (Domain & API Design), the module dependency structure (Architecture), the quality of an abstraction in isolation (Duplication & Abstraction), or padding that follows the conventions but adds nothing, such as narrating comments and redundant guards (AI Slop & Noise).
Different bounded contexts, languages or packages may legitimately have different conventions. Require a concrete integration or maintenance cost within the relevant scope.
Calibrate: one finding per fragmented concern, naming the dominant convention, the deviating sites and the direction to converge in (usually towards the dominant pattern, unless the repository is visibly migrating away from it). Never speculate about who or what wrote the code; judge only the code itself.`,
  },
  {
    id: 'slop',
    name: 'AI Slop & Noise',
    shortName: 'Slop',
    description:
      'Statement-level padding that adds reading cost without behavior: narrating comments, redundant guards, no-op error wrapping, placeholder code and noise.',
    weight: 0.75,
    enabled: true,
    fixPromptTitle: 'Remove Slop & Noise',
    fixGuidance: `- Prefer deletion over addition: the fix for slop is almost always removing lines, inlining or finishing a stub, never adding a layer, a helper or a comment.
- Preserve behavior. Before removing a guard, prove the invariant it checks is guaranteed upstream (by the type, by validation at the boundary, by the caller); when you cannot, leave it and say why. Never remove validation at a genuine trust boundary (request, CLI, environment, file, network or third-party input).
- Keep comments that encode a constraint, a workaround, an invariant or a pitfall the code cannot express; remove only comments a reader would not miss.
- Where a finding names placeholder or stub code, either implement the real behavior following the surrounding conventions or remove the stub and its callers; do not leave a "better" placeholder.
- Match the file's existing density, naming and error strategy rather than the examples in the findings; a fix in the repository's style beats a fix in the finding's style.
- Delete imports, variables and helpers that your removals made unused, and run the repository's checks so nothing silently changes.`,
    prompt: `Review the repository for slop: locally reasonable-looking code that adds reading and maintenance cost without adding behavior. This is the noise pattern that accumulates in codebases written quickly, by any author or tool; you judge the pattern, never its provenance.
First establish the repository's own density and idioms (how sparse its comments are, whether it validates at boundaries or trusts types, how it logs, how it handles errors, how it names things) so that "noise" means "noise relative to this repository".
Look for: comments and docstrings that narrate the code, restate a name or signature, or record the change history that belongs in version control ("added X", "refactored to use Y"); defensive checks inside trusted code paths where runtime validation or a proven internal caller already guarantees the invariant, and the same check repeated at caller and callee; try/catch or error wrappers that only log-and-rethrow, rethrow unchanged or swallow with a comment, adding neither context, cleanup nor recovery; indirection whose removal demonstrably reduces reading cost without losing a meaningful name, boundary or test seam; logging that narrates control flow ("starting X", "finished X") or debug output left in production paths; speculative flexibility nobody uses (option flags with one value ever passed, configurability, generic parameters and extension points with a single caller); stray artifacts with evidence they are accidental or misleading. Generic names, single-use variables, Unicode, emoji and planning documents are not findings by themselves; show a concrete reading or maintenance cost. Security-relevant deceptive identifiers belong to Security Hygiene.
Compile-time types alone do not prove runtime input validity, especially for erased types or external callers. Reachable stubs that return incorrect results belong to Reliability, not this scanner.
Distinguish noise from care: a guard at a trust boundary (request, CLI, environment, file, network, third-party callback) is correct, a comment that explains a workaround, a constraint or a non-obvious invariant is valuable, and logging that a module's convention calls for is not noise. When in doubt, follow how the surrounding module handles the same situation.
Not yours: code that nothing references at all (Dead & Obsolete Code owns unused code; you own code that is used but pointless), abstractions that form a real layer such as interfaces with one implementation or factories without variation (Duplication & Abstraction), errors swallowed in a way that changes runtime behavior or hides real failures (Reliability), unsafe casts and type escape hatches (Type Safety & Data Contracts), a convention followed in most places and broken in a few (Consistency), tests that cannot fail (Tests & Testability), or a single function that is genuinely too long or tangled (Complexity).
Calibrate: report a pattern, not an instance. One narrating comment is nothing; a repository whose comments predominantly narrate is one finding with representative locations and an estimate of how widespread it is (search first, then count). Most noise is low or medium because its cost is reading friction; route functional failures from reachable placeholders to Reliability. Do not duplicate mechanical lint/format findings when the check actually runs and enforces them; a configured but unenforced check is not proof the issue is handled.`,
  },
  {
    id: 'dependencies',
    name: 'Dependencies & Build Health',
    shortName: 'Dependencies',
    description:
      'Third-party dependencies, lockfiles, build and CI configuration, toolchain and script hygiene.',
    weight: 0.75,
    enabled: true,
    fixPromptTitle: 'Fix Dependency & Build Issues',
    fixGuidance: `- Change dependencies with the repository's own package manager and commit the regenerated lockfile; never hand-edit a lockfile.
- Do not bump a major version or swap one library for another without reading its migration notes and running the full test suite; if the upgrade is not mechanical, stop and report what would need to change instead of half-migrating.
- When removing a dependency, search for indirect uses (string references, plugin registrations, build and CI configuration) before deleting it.
- Keep the fix scoped to the findings; do not upgrade unrelated packages "while you are there".`,
    prompt: `Review the repository's dependencies, build configuration and developer tooling as they are declared in the checkout: manifests, lockfiles, build scripts, task runners, CI and container definitions.
Look for: the same capability provided by several competing libraries (two HTTP clients, two date libraries, two test runners), multiple major versions of one package pulled in at once, dependencies declared but never imported or imported but never declared, unpinned or wildly ranged versions where the ecosystem expects pinning, a missing or out-of-sync lockfile, packages the repository itself establishes as deprecated, vendored or copied third-party code, build and CI configuration that executes broken or incompatible commands, duplicates build procedures, or fails to enforce configured checks (test selection belongs to Tests & Testability), toolchain versions declared inconsistently across files (engine fields, version files, container base images, CI matrices), and dependency scope mistakes (test or build tools shipped as runtime dependencies).
You cannot access the network, so do not claim a package is outdated or vulnerable unless the repository's own files say so (audit reports, renovate/dependabot configuration, changelogs, comments). Judge from structure and consistency, not from version numbers you would have to look up.
Multiple versions, vendoring and competing libraries are investigation leads, not defects: establish incompatible behavior, unnecessary shipped cost or conflicting ownership, and check monorepo and ecosystem constraints. A successor package is not grounds for migration.
Not yours: dead application code (Dead & Obsolete Code owns unused source; you own unused *dependencies*), incorrect or missing documentation including setup/build instructions when the commands themselves are correct (Documentation), test selection or absence (Tests & Testability), vulnerable versions (Vulnerable Dependencies), workflow trust failures (CI & GitHub Actions Security), or code-level inconsistency (Consistency).
Calibrate: group findings by concern (one finding for "competing HTTP clients", not one per import), name the canonical choice the repository should converge on, and reserve high severity for problems that break or silently change builds.`,
  },
  {
    id: 'vulnerabilities',
    name: 'Vulnerable Dependencies',
    shortName: 'Vulnerabilities',
    kind: 'dependency-audit',
    description:
      'Exact vulnerable package versions from OSV, enriched with CVSS, EPSS and CISA KEV.',
    weight: 1.5,
    enabled: true,
    fixPromptTitle: 'Remediate Vulnerable Dependencies',
    fixGuidance: `- Confirm the installed version and dependency path with the repository package manager before changing it.
- Prefer the smallest compatible upgrade that reaches a fixed version and regenerate the lockfile; do not hand-edit it.
- Run the affected package's tests and the full repository checks. If the package is transitive, update the direct dependency or resolution mechanism that controls it.
- When no fixed version exists, say so explicitly. Propose only source-grounded mitigations or removal of the affected use; never invent an upgrade, suppress the finding to make it disappear, or force an unrelated migration.
- CISA KEV means exploitation has been observed in the wild. Treat those findings as urgent even when raw CVSS is lower.`,
    prompt:
      'This scanner is deterministic and is populated by OSV Scanner; it is not handed to an agent.',
  },
  {
    id: 'ci-security',
    securityReview: 'ci',
    name: 'CI & GitHub Actions Security',
    shortName: 'CI security',
    description:
      'Workflow trust boundaries, token permissions, script injection, action supply chain and runner isolation.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Harden CI & GitHub Actions',
    fixGuidance: `- Preserve the workflow's intended triggers and release behavior while closing the specific trust-boundary failure. Do not disable a check, deployment or automation path merely to remove the finding.
- For actions and reusable workflows implicated by the finding, replace mutable references with a verified full 40-character commit SHA and retain the exact release tag in a comment so Dependabot can update it. Never invent a SHA or rewrite unrelated workflows.
- Default the workflow token to read-only and grant write or OIDC permissions only to the job that demonstrably needs them. Pass only the required secrets to reusable workflows; do not replace explicit secrets with \`secrets: inherit\`.
- Move attacker-controlled GitHub contexts and inputs out of \`run:\` or inline JavaScript and into step environment variables, then quote them in the receiving shell or program.
- Treat fork code, downloaded artifacts, caches and self-hosted runners as untrusted until the workflow proves a stronger boundary. Never validate a fix by exposing a real secret or executing an active exploit against external infrastructure.`,
    prompt: `Review the repository's CI/CD automation, with specific attention to GitHub Actions. Inventory workflows under .github/workflows, reusable workflows and local actions (action.yml/action.yaml and .github/actions). Prioritize privileged jobs and externally triggered paths; thoroughly trace the selected workflows and their called scripts and configuration. Record uninspected workflows as deferred rather than claiming exhaustive coverage. Build a trust map from each selected trigger through attacker-controlled inputs and checked-out code to token permissions, secrets, artifacts, caches, runners, deployments and releases.
Look for: pull_request_target, issue_comment, workflow_run or reusable-workflow paths that execute fork-controlled code with base-repository privileges; untrusted GitHub contexts, inputs, matrix values or step outputs interpolated into shell commands or inline JavaScript; comment commands and label gates without a reliable authorization check; artifacts or caches produced in a lower-trust workflow and consumed by a privileged job without binding them to the expected run and commit; public-repository pull requests reaching persistent self-hosted runners; broad or implicit GITHUB_TOKEN permissions, unnecessary id-token: write, long-lived credentials, secrets: inherit, or checkout credentials exposed to later untrusted steps; third-party actions and reusable workflows referenced by mutable tags, branches or short SHAs; local composite actions that pass untrusted inputs into a shell; and deployment or release jobs whose environment, approval or concurrency controls can be bypassed.
Verify the whole path before reporting. A dangerous-looking trigger alone is not a finding: pull_request_target can be safe when it handles metadata without checking out or executing fork code, and expressions in if:, with: or env: are not shell injection merely because they contain \`\${{ ... }}\`. Likewise, do not claim missing permissions are exploitable until you establish the effective privilege or explain precisely what repository setting remains unknown. Treat full commit-SHA pins as immutable at this repository boundary, while noting concrete transitive risk only when the checked-in files establish it.
Not yours: whether CI runs the documented build commands or uses consistent tool versions (Dependencies & Build Health), whether tests exist or are selected by CI (Tests & Testability), vulnerabilities in application source and runtime trust boundaries (Security Hygiene), vulnerable package versions (Vulnerable Dependencies), or ordinary flaky jobs and retry behavior without a security consequence (Reliability & Error Handling).
Calibrate: every finding must identify the workflow and trigger, the external actor or lower-trust producer, the controlled input or code, the missing or bypassed control, the privilege or secret that becomes reachable, and the concrete impact. Search all gates and called scripts before deciding. Report uncertain repository-setting assumptions explicitly and lower confidence; if you cannot construct a realistic attack or supply-chain failure path, do not report the issue. Never run an exploit, exfiltrate credentials or print secret values during review.`,
  },
  {
    id: 'security',
    securityReview: 'application',
    name: 'Security Hygiene',
    shortName: 'Security',
    description:
      'Secrets handling, insecure defaults, missing sanitization and dangerous constructs visible in the source.',
    weight: 1.25,
    enabled: true,
    fixPromptTitle: 'Fix Security Hygiene Issues',
    fixGuidance: `- Treat real credential material committed to the repository as compromised (documented nonfunctional dummy fixtures and public examples are not credentials), even after you remove it: it stays in git history. Remove it from the working tree, move the value to the repository's existing configuration or secret mechanism, and tell the user plainly that it must be rotated. Do not rewrite git history unless the user explicitly asks.
- Never print, log, echo or paste a secret value in your output, commit messages or summary; refer to it by kind and location only.
- Do not fix a finding by weakening a control: never disable TLS verification, authentication, authorization, escaping, validation or a security test to make something pass. If a check cannot be satisfied, say so and stop.
- When adding sanitization, validation or escaping, use the library or helper the repository already uses for that boundary rather than writing a new one, and add a test that exercises the malicious input the finding describes.
- If a finding turns out to be exploitable today in a deployed system, say so explicitly at the top of your summary so the user can act on it before the code change ships.`,
    prompt: `Review security hygiene as it is visible in the source: this is a code-health review of how the repository handles secrets and trust, not a penetration test or a vulnerability scan.
Look for: credentials, tokens, private keys or connection strings committed in code, configuration, fixtures or history-visible files; secrets that leak through logging, debug output, serialization or error messages (for example a config struct that derives a debug/serialize representation over a password); insecure defaults (debug mode, permissive CORS, disabled TLS verification, wildcard hosts, default passwords) that ship unless overridden; missing or inconsistent sanitization and escaping at trust boundaries (user input reaching shell commands, SQL, HTML, file paths, deserializers or redirects); dangerous constructs used casually (eval-style execution, unsafe deserialization, weak or home-grown cryptography, predictable randomness for security-relevant values); authentication and authorization checks that are applied inconsistently across similar entry points; and source-grounded authorization or trust failures. Missing security tests alone belong to Tests & Testability; include regression tests with a demonstrated vulnerability instead of reporting the same root cause twice.
Distinguish real credential material from documented dummy fixtures and public examples. Do not contact providers to test validity or claim a credential is live or deployed without evidence; describe unknown validity and exposure explicitly.
Never copy a secret value into a finding; refer to it by kind and location only. Do not report generic hardening advice that the repository's stated scope does not call for (a local CLI does not need rate limiting).
Not yours: workflow triggers, runner isolation, workflow token permissions and CI-controlled execution (CI & GitHub Actions Security), vulnerable locked packages (Vulnerable Dependencies), crashes or hangs that are not security-relevant (Reliability), type-level weaknesses without a security consequence (Type Safety & Data Contracts), or missing tests in general (Tests & Testability).
Calibrate: findings from this discovery pass are security hypotheses that an independent agent will review for practical exploitability. Trace the strongest realistic attack path you can support, distinguish observed code from assumptions, and do not inflate severity to compensate for uncertainty. Reserve critical for severe, source-grounded and realistically reachable exposures such as an unauthenticated destructive endpoint; do not infer live credentials or production deployment from a source string. Calibrate insecure defaults by their actual exposure and consequence.`,
  },
]

export const scannersById: ReadonlyMap<string, ScannerDefinition> = new Map(
  SCANNERS.map((scanner) => [scanner.id, scanner]),
)

export const enabledScanners: readonly ScannerDefinition[] = SCANNERS.filter(
  (scanner) => scanner.enabled,
)

export const agentScanners: readonly ScannerDefinition[] =
  enabledScanners.filter((scanner) => scanner.kind !== 'dependency-audit')

export function getScanner(id: string): ScannerDefinition | undefined {
  return scannersById.get(id)
}

/** Older requests and stored scanner snapshots inherit built-in capabilities. */
export function scannerSecurityReview(
  scanner: Pick<ScannerDefinition, 'id' | 'securityReview'>,
): ScannerDefinition['securityReview'] {
  return scanner.securityReview ?? getScanner(scanner.id)?.securityReview
}
