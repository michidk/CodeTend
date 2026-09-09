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
  /** Short label for compact UI such as chart legends. */
  readonly shortName: string
  readonly description: string
  /** Relative weight when combining scanner scores into the overall score. */
  readonly weight: number
  readonly enabled: boolean
  /** Dimension-specific review instructions handed to the scanner agent. */
  readonly prompt: string
  /** Title of the aggregated coding-agent prompt, e.g. "Fix Architecture Issues". */
  readonly fixPromptTitle: string
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
    id: 'abstraction',
    name: 'Abstraction Quality',
    shortName: 'Abstraction',
    description:
      'Over-abstraction, under-abstraction, unnecessary indirection, leaky and competing abstractions.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Improve Abstractions',
    prompt: `Review the quality of the abstractions in the repository: whether the named concepts (interfaces, base classes, generic layers, helpers, wrappers, plugins) earn their existence and whether important concepts that recur in many shapes still lack a name.
Look for: over-abstraction (interfaces with one implementation, factories/strategies/plugins with no variation, deep inheritance or generic layers that only forward calls), unnecessary indirection (wrappers, adapters and helpers that add nothing over what they wrap), leaky abstractions (callers must know implementation details to use them correctly, or the abstraction exposes its dependencies), competing abstractions (two or more abstractions for the same concept that coexist), and under-abstraction only when a concept appears in several *different* shapes across the codebase so that no single extraction of copies would name it.
Not yours: two or more near-identical copies of the same code (Duplication owns anything whose fix is "extract the copies into one function"), an existing shared helper that some call sites bypass (Consistency), the naming and contracts of domain types and public APIs (Domain & API Design), or the size and control flow of a function (Complexity).
Calibrate: for every finding, name the concept that should exist or be removed and where it is currently expressed. Do not propose abstractions for variation that does not exist yet.`,
  },
  {
    id: 'duplication',
    name: 'DRY & Duplication',
    shortName: 'Duplication',
    description:
      'Semantic duplication, repeated business logic, validation, models and parallel implementations.',
    weight: 1,
    enabled: true,
    fixPromptTitle: 'Reduce Duplication',
    prompt: `Find meaningful semantic duplication in the repository: the same logic implemented more than once where no shared implementation exists, so that the copies must evolve together.
Focus on duplicated business rules, validation logic, data models/DTOs that describe the same thing, parallel implementations of the same behavior (two clients for the same service, two parsers for the same format, two ways to compute the same value), and copy-pasted procedures. Highlight where the copies have already drifted or where drift would be dangerous.
Ignore trivial textual repetition, boilerplate required by the language or framework, and test-fixture repetition unless it hides real drift.
Not yours: call sites that skip an existing shared helper and inline their own version (Consistency owns bypassed conventions), a concept that recurs in genuinely different shapes and needs a new abstraction rather than a merge of copies (Abstraction), or two competing designs for the same domain entity (Domain & API Design).
Calibrate: use search aggressively (identical identifiers, similar function names, repeated string literals and error messages, similar shapes) to confirm duplication rather than guessing from one file. One finding per duplicated concept, with every copy listed as a location; state clearly why the locations are the same logic.`,
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
Not yours: code that is used but obsolete in design (Architecture or Consistency), or documentation that is stale but describes live behavior (Documentation).
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
Not yours: the shape of function signatures, parameter lists and public contracts (Domain & API Design), the module dependency graph (Architecture), copies of logic (Duplication), or missing tests for complex code (Tests & Testability).
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
Yours is any realistic runtime failure mode and its handling. Not yours: type declarations or schemas that misrepresent data without a concrete runtime failure you can trace (Type Safety & Data Contracts), missing tests for failure paths (Tests & Testability), or inconsistent error-response formats that do not change behavior (Domain & API Design).
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
Yours is the deviation from an established convention and the fragmentation it causes. Not yours: copies of logic where no shared implementation exists (Duplication), inconsistent shapes in public or domain contracts (Domain & API Design), the module dependency structure (Architecture), or the quality of an abstraction in isolation (Abstraction).
Calibrate: one finding per fragmented concern, naming the dominant convention, the deviating sites and the direction to converge in (usually towards the dominant pattern, unless the repository is visibly migrating away from it). Never speculate about who or what wrote the code; judge only the code itself.`,
  },
]

export const scannersById: ReadonlyMap<string, ScannerDefinition> = new Map(
  SCANNERS.map((scanner) => [scanner.id, scanner]),
)

export const enabledScanners: readonly ScannerDefinition[] = SCANNERS.filter(
  (scanner) => scanner.enabled,
)

export function getScanner(id: string): ScannerDefinition | undefined {
  return scannersById.get(id)
}
