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
  /** Short label for compact UI such as chart legends. */
  readonly shortName: string
  readonly description: string
  /** Relative weight when combining scanner scores into the overall score. */
  readonly weight: number
  readonly enabled: boolean
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
Look for: modules that know too much about each other, circular or inverted dependencies (low-level code depending on high-level policy), god modules/files that concentrate unrelated responsibilities, infrastructure concerns (database, HTTP, framework) leaking into domain logic, missing or inconsistent boundaries between subsystems, "generic" layers that secretly branch on specific implementations, and structures that make the most common kinds of change ripple across many files.
Yours is the shape of the module graph: which module depends on which, and who owns which responsibility. Not yours: the design of an individual interface or type (Domain & API Design), the internals of one long function (Complexity), copies of the same logic (Duplication), or a convention followed in most places and broken in a few (Consistency).
Calibrate: a structure is a finding when it will hurt the next ten changes, not when it merely differs from a layout you prefer. Name the boundary that is violated and the concrete imports or calls that violate it.`,
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
    prompt: `Find meaningful semantic duplication in the repository and judge whether its abstractions earn their existence. These are two sides of one question: is each concept expressed exactly once, under a name that fits?
Duplication: the same logic implemented more than once where no shared implementation exists, so that the copies must evolve together. Focus on duplicated business rules, validation logic, data models/DTOs that describe the same thing, parallel implementations of the same behavior (two clients for the same service, two parsers for the same format, two ways to compute the same value), copy-pasted procedures, and concepts that recur in several *different* shapes so that no single extraction would name them. Highlight where the copies have already drifted or where drift would be dangerous. Ignore trivial textual repetition, boilerplate required by the language or framework, and test-fixture repetition unless it hides real drift.
Abstraction: over-abstraction (interfaces with one implementation, factories/strategies/plugins with no variation, deep inheritance or generic layers that only forward calls), unnecessary indirection (wrappers, adapters and helpers that add nothing over what they wrap), leaky abstractions (callers must know implementation details to use them correctly), and competing abstractions (two or more abstractions for the same concept that coexist).
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
Look for: exported functions, classes, types, components, modules, scripts, configuration keys, feature flags, database columns, environment variables and dependencies that nothing references; code paths guarded by conditions that can never be true; deprecated or "legacy"/"old"/"v1" implementations that have a successor still in use; TODO-marked temporary code that became permanent; commented-out blocks with real logic; assets, migrations and docs describing removed behavior.
Verify each candidate with repository-wide search (including string references used by reflection, dependency injection, routing tables, templates, configuration and CI) before reporting it. Exclude legitimate entry points such as route files, CLI commands, plugin registrations, framework conventions, test helpers and the public API of a library. If the repository already runs an unused-code tool (for example knip, ts-prune, vulture, deadcode, cargo's warnings) treat its configuration and ignore lists as evidence of intent and only report what escapes it.
Not yours: code that is used but obsolete in design (Architecture or Consistency), documentation that is stale but describes live behavior (Documentation), or code that is referenced and runs but adds nothing, such as redundant guards, pass-through wrappers and narrating comments (AI Slop & Noise).
Calibrate: report only candidates you could not find a reference to and explain how you checked. Group many small dead items of the same kind (for example six unused exports in one module) into one finding.`,
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
Look for: functions or files that are far longer or more deeply nested than the repository norm, tangled control flow with many interacting flags and early exits, hidden temporal coupling (things that must be called in a certain order), pervasive mutable shared state, logic placed where it does not belong (business rules in UI handlers, formatting in data access code), clever code that needs a comment to be understood, and hot spots that mix many responsibilities so any change is risky.
Not yours: the shape of function signatures, parameter lists and public contracts (Domain & API Design), the module dependency graph (Architecture), copies of logic (Duplication), missing tests for complex code (Tests & Testability), or line-level padding such as narrating comments and redundant guards that inflates a function without tangling it (AI Slop & Noise).
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
First discover how this repository tests itself (frameworks, directories, naming conventions, fixtures, CI configuration and which test commands CI actually runs). Then look for: important behavior with no tests at all (core domain rules, money/time/permission logic, data migrations, destructive operations, error paths), tests that only cover the happy path, brittle tests (asserting on incidental details, heavy mocking that mirrors the implementation, order or time dependence, sleeps), disabled or skipped tests, tests that cannot fail, tests that exist but are never run by CI, and code structured so it cannot be tested without a network, database or global state.
Not yours: the defects themselves that missing tests would have caught (Reliability), or the design of the code under test beyond what blocks testing it.
Calibrate: judge gaps by risk, not by coverage percentage; one untested critical write path outweighs many untested getters. If the repository has no tests, report that once as a single finding rather than one finding per module. Cite the test files you inspected so the absence of a test is verifiable.`,
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
    prompt: `Review reliability and error handling: how the code behaves when inputs are bad, dependencies fail or timing is unlucky.
Look for: swallowed or logged-and-ignored errors, catch-all handlers that hide failures, missing validation or unchecked assumptions at trust boundaries (user input, external APIs, files, environment) that lead to crashes or wrong behavior, operations that can leave partial state (multi-step writes without transactions or compensation), unhandled promise/async paths and fire-and-forget calls, race conditions and unsafe concurrent access, missing timeouts and cancellation that is not propagated, retries without backoff or idempotency, resources that are never released, and behavior that silently degrades instead of failing clearly.
Yours is any realistic runtime failure mode and its handling. Not yours: type declarations or schemas that misrepresent data without a concrete runtime failure you can trace (Type Safety & Data Contracts), missing tests for failure paths (Tests & Testability), inconsistent error-response formats that do not change behavior (Domain & API Design), or error wrappers and guards that are merely redundant without changing what happens on failure (AI Slop & Noise).
Calibrate: trace at least one concrete failure scenario per finding (what input or event triggers it, what the user or operator observes, what state is left behind) instead of listing generic best practices. Reserve critical for defects reachable today with realistic input.`,
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
Calibrate: report only documentation whose absence or inaccuracy would realistically cost a contributor significant time or lead them to do the wrong thing. Cite the documentation location and the code location that contradicts it.`,
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
Look for: domain concepts that are modeled inconsistently (the same entity with different shapes, names or units in different places), one concept split across several independently settable fields, anemic or overloaded models, primitive obsession where a meaningful type is warranted, functions and endpoints with surprising or inconsistent contracts (different error shapes, pagination styles, naming, nullability, units), long same-typed positional parameter lists, boolean-parameter and flag-driven APIs, and interfaces that expose internals callers should not depend on.
Yours is the shape of the contract as seen by its callers. Not yours: the module dependency graph (Architecture), the internals of a function behind a fine signature (Complexity), whether a contract is enforced at runtime or lies about its data (Type Safety & Data Contracts), or implementation patterns that do not surface in any contract (Consistency).
Calibrate: ground findings in the repository's own vocabulary and conventions; the goal is one coherent model, not a textbook design. Name the canonical shape you recommend and which call sites would change.`,
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
For every language: data crossing boundaries (HTTP, database, files, queues, config) that is assigned a type or shape without validation, serialization/deserialization that can silently produce wrong values, enums/strings compared without exhaustiveness, and version drift between producer and consumer contracts.
Not yours: a concrete runtime crash or failure you can trace from a realistic input (Reliability owns failure modes; you own the contract weakness that lets them exist only when no such concrete failure is the headline), the choice of domain types and API shapes (Domain & API Design), or configuration and documentation mismatches (Documentation, Consistency).
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
Identify the dominant convention for each concern first (how data is fetched, how errors are handled, how components/modules/tests are structured, how configuration is accessed, how user-facing text is formatted, how logging is done, naming and file layout). Then look for: multiple patterns solving the same problem side by side, old and new approaches coexisting without a migration being finished, shared utilities or abstractions that exist but are bypassed in some places with local re-implementations, inconsistent terminology for the same domain object, and locally reasonable implementations that conflict with repository-wide conventions.
Yours is the deviation from an established convention and the fragmentation it causes. Not yours: copies of logic where no shared implementation exists (Duplication), inconsistent shapes in public or domain contracts (Domain & API Design), the module dependency structure (Architecture), the quality of an abstraction in isolation (Duplication & Abstraction), or padding that follows the conventions but adds nothing, such as narrating comments and redundant guards (AI Slop & Noise).
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
Look for: comments and docstrings that narrate the code, restate a name or signature, or record the change history that belongs in version control ("added X", "refactored to use Y"); defensive checks inside trusted code paths where the type system, upstream validation or the caller already guarantees the invariant, and the same check repeated at caller and callee; try/catch or error wrappers that only log-and-rethrow, rethrow unchanged or swallow with a comment, adding neither context, cleanup nor recovery; single-use variables, one-off helpers and pass-through wrappers that exist only to give a name to one expression; logging that narrates control flow ("starting X", "finished X") or debug output left in production paths; placeholder and stub code presented as complete (empty handlers, functions that return a canned value or hardcoded success, "not implemented" bodies that are reachable, generic "TODO: handle edge cases" notes with no ticket, owner or concrete action); speculative flexibility nobody uses (option flags with one value ever passed, configurability, generic parameters and extension points with a single caller); generic names that describe a type rather than a meaning (data, result, temp, helper, handleClick) where the repository otherwise names by intent; and stray artifacts such as leftover scratch files, plan or scratch markdown that was never meant to ship, emoji or decorative Unicode in code, and invisible or homoglyph characters in identifiers and configuration.
Distinguish noise from care: a guard at a trust boundary (request, CLI, environment, file, network, third-party callback) is correct, a comment that explains a workaround, a constraint or a non-obvious invariant is valuable, and logging that a module's convention calls for is not noise. When in doubt, follow how the surrounding module handles the same situation.
Not yours: code that nothing references at all (Dead & Obsolete Code owns unused code; you own code that is used but pointless), abstractions that form a real layer such as interfaces with one implementation or factories without variation (Duplication & Abstraction), errors swallowed in a way that changes runtime behavior or hides real failures (Reliability), unsafe casts and type escape hatches (Type Safety & Data Contracts), a convention followed in most places and broken in a few (Consistency), tests that cannot fail (Tests & Testability), or a single function that is genuinely too long or tangled (Complexity).
Calibrate: report a pattern, not an instance. One narrating comment is nothing; a repository whose comments predominantly narrate is one finding with representative locations and an estimate of how widespread it is (search first, then count). Reserve high severity for placeholder code presented as complete on a path that runs, because it lies about what the system does; most other slop is low or medium because its cost is diffuse reading friction. Never report what the repository's own configured linter or formatter would already flag under its current settings.`,
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
Look for: the same capability provided by several competing libraries (two HTTP clients, two date libraries, two test runners), multiple major versions of one package pulled in at once, dependencies declared but never imported or imported but never declared, unpinned or wildly ranged versions where the ecosystem expects pinning, a missing or out-of-sync lockfile, packages the repository itself marks as deprecated or that have a well-known successor, vendored or copied third-party code, build and CI steps that disagree with each other or with the documented workflow (CI runs different commands than the contributor docs, scripts that duplicate one another, checks configured but not enforced), toolchain versions declared inconsistently across files (engine fields, version files, container base images, CI matrices), and dependency scope mistakes (test or build tools shipped as runtime dependencies).
You cannot access the network, so do not claim a package is outdated or vulnerable unless the repository's own files say so (audit reports, renovate/dependabot configuration, changelogs, comments). Judge from structure and consistency, not from version numbers you would have to look up.
Not yours: dead application code (Dead & Obsolete Code owns unused source; you own unused *dependencies*), documentation that is stale but unrelated to setup and build (Documentation), or code-level inconsistency (Consistency).
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
- CISA KEV means exploitation has been observed in the wild. Treat those findings as urgent even when raw CVSS is lower.`,
    prompt:
      'This scanner is deterministic and is populated by OSV Scanner; it is not handed to an agent.',
  },
  {
    id: 'security',
    name: 'Security Hygiene',
    shortName: 'Security',
    description:
      'Secrets handling, insecure defaults, missing sanitization and dangerous constructs visible in the source.',
    weight: 1.25,
    enabled: true,
    fixPromptTitle: 'Fix Security Hygiene Issues',
    fixGuidance: `- Treat any credential, token or key that was committed to the repository as compromised, even after you remove it: it stays in git history. Remove it from the working tree, move the value to the repository's existing configuration or secret mechanism, and tell the user plainly that it must be rotated. Do not rewrite git history unless the user explicitly asks.
- Never print, log, echo or paste a secret value in your output, commit messages or summary; refer to it by kind and location only.
- Do not fix a finding by weakening a control: never disable TLS verification, authentication, authorization, escaping, validation or a security test to make something pass. If a check cannot be satisfied, say so and stop.
- When adding sanitization, validation or escaping, use the library or helper the repository already uses for that boundary rather than writing a new one, and add a test that exercises the malicious input the finding describes.
- If a finding turns out to be exploitable today in a deployed system, say so explicitly at the top of your summary so the user can act on it before the code change ships.`,
    prompt: `Review security hygiene as it is visible in the source: this is a code-health review of how the repository handles secrets and trust, not a penetration test or a vulnerability scan.
Look for: credentials, tokens, private keys or connection strings committed in code, configuration, fixtures or history-visible files; secrets that leak through logging, debug output, serialization or error messages (for example a config struct that derives a debug/serialize representation over a password); insecure defaults (debug mode, permissive CORS, disabled TLS verification, wildcard hosts, default passwords) that ship unless overridden; missing or inconsistent sanitization and escaping at trust boundaries (user input reaching shell commands, SQL, HTML, file paths, deserializers or redirects); dangerous constructs used casually (eval-style execution, unsafe deserialization, weak or home-grown cryptography, predictable randomness for security-relevant values); authentication and authorization checks that are applied inconsistently across similar entry points; and security-relevant behavior that is implemented but not covered by any test.
Never copy a secret value into a finding; refer to it by kind and location only. Do not report generic hardening advice that the repository's stated scope does not call for (a local CLI does not need rate limiting).
Not yours: crashes or hangs that are not security-relevant (Reliability), type-level weaknesses without a security consequence (Type Safety & Data Contracts), or missing tests in general (Tests & Testability).
Calibrate: trace how an attacker or an accident would exploit each finding and what they would gain; reserve critical for exposures reachable today (a live secret in the repository, an unauthenticated destructive endpoint) and high for insecure defaults that will bite on the first real deployment.`,
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
