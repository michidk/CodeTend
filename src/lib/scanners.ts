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
    prompt: `Review the repository's architecture and modularity.
Infer the intended layering and module boundaries from the directory structure, entry points, build/manifest files and imports, then judge how well the code honors them.
Look for: modules that know too much about each other, circular or inverted dependencies (low-level code depending on high-level policy), god modules/files that concentrate unrelated responsibilities, leaking of infrastructure concerns (database, HTTP, framework) into domain logic, missing or inconsistent boundaries between subsystems, and structures that make the most common kinds of change ripple across many files.
Prefer findings about structure that will hurt the next ten changes over cosmetic organization preferences.`,
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
    prompt: `Review the quality of the abstractions in the repository.
Look for: over-abstraction (interfaces with one implementation, factories/strategies/plugins with no variation, deep inheritance or generic layers that only forward calls), under-abstraction (the same concept re-expressed inline in many places without a name), unnecessary indirection (wrappers, adapters and helpers that add nothing), leaky abstractions (callers must know implementation details to use them correctly), and competing abstractions (two or more ways to express the same concept that coexist).
For every finding, name the concept that should exist (or be removed) and where it is currently expressed.`,
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
    prompt: `Find meaningful semantic duplication in the repository.
Focus on duplicated business rules, validation logic, data models/DTOs that describe the same thing, parallel implementations of the same behavior (two clients for the same service, two parsers for the same format, two ways to compute the same value), and copy-pasted procedures that must evolve together.
Ignore trivial textual repetition, boilerplate required by the language or framework, and test-fixture repetition unless it hides real drift.
Use search aggressively (identical identifiers, similar function names, repeated string literals and error messages, similar shapes) to confirm duplication rather than guessing from one file. State clearly why each pair of locations is the same logic and where drift between the copies already exists or would be dangerous.`,
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
Look for: exported functions, classes, types, components, modules, scripts, configuration keys, feature flags, database columns, environment variables and dependencies that nothing references; code paths guarded by conditions that can never be true; deprecated or "legacy"/"old"/"v1" implementations that have a successor still in use; TODO-marked temporary code that became permanent; commented-out blocks with real logic; assets and docs describing removed behavior.
Verify each candidate with repository-wide search before reporting it (exclude legitimate entry points such as route files, CLI commands, plugin registrations, framework conventions and public library APIs). Report only candidates you could not find a reference to and explain how you checked.`,
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
    prompt: `Review code complexity and maintainability.
Look for: functions or files that are far longer or more deeply nested than the repository norm, tangled control flow with many interacting flags and early exits, long parameter lists and option bags whose combinations are unclear, hidden temporal coupling (things that must be called in a certain order), pervasive mutable shared state, logic placed where it does not belong (business rules in UI handlers, formatting in data access code), and hot spots that mix many responsibilities so any change is risky.
Quantify where possible (approximate line counts, nesting depth, number of branches) and prioritize the hot spots most likely to change.`,
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
First discover how this repository tests itself (frameworks, directories, naming conventions, CI configuration). Then look for: important behavior with no tests at all (core domain rules, money/time/permission logic, data migrations, error paths), tests that only cover the happy path, brittle tests (asserting on incidental details, heavy mocking that mirrors the implementation, order or time dependence, sleeps), disabled or skipped tests, tests that cannot fail, and code structured so it cannot be tested without a network, database or global state.
Judge gaps by risk, not by coverage percentage. If the repository has no tests, report that once as a single finding rather than one finding per module.`,
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
    prompt: `Review reliability and error handling.
Look for: swallowed or logged-and-ignored errors, catch-all handlers that hide failures, missing validation at trust boundaries (user input, external APIs, files, environment), operations that can leave partial state (multi-step writes without transactions or compensation), unhandled promise/async paths and fire-and-forget calls, race conditions and unsafe concurrent access, missing timeouts, retries without backoff or idempotency, resources that are never released, and behavior that silently degrades instead of failing clearly.
Trace at least one real failure scenario per finding (what input or event triggers it, what the user or operator observes) instead of listing generic best practices.`,
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
    prompt: `Review documentation and understandability.
Look for: missing or outdated setup and run instructions, README claims that contradict the code, undocumented architecture decisions and module responsibilities, domain terms used without definition, configuration/environment variables with no description, public APIs or complex algorithms with no explanation of intent or invariants, misleading names and comments, and generated or stale docs that no longer match the implementation.
Only report documentation whose absence would realistically cost a competent new contributor significant time; do not ask for comments on self-explanatory code.`,
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
    prompt: `Review domain modeling and API/interface design.
Look for: domain concepts that are modeled inconsistently (the same entity with different shapes or names in different places), anemic or overloaded models, primitive obsession where a meaningful type is warranted, functions and endpoints with surprising or inconsistent contracts (different error shapes, pagination styles, naming, nullability, units), boolean-parameter and flag-driven APIs, responsibilities that live in the wrong layer, and interfaces that expose internals callers should not depend on.
Ground findings in the repository's own vocabulary and conventions; the goal is one coherent model, not a textbook design.`,
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
    prompt: `Review type safety and data contracts in a way appropriate for the languages used.
For statically typed languages look for escape hatches (any/unknown casts, unchecked casts, raw types, unsafe/nullable misuse, suppressions), lies in type declarations, and types that do not encode real invariants. For dynamically typed languages look for missing runtime validation at boundaries, implicit shape assumptions, duck-typed contracts that are not documented or checked, and inconsistent handling of null/undefined/None.
For every language: data crossing boundaries (HTTP, database, files, queues, config) without schema validation, serialization/deserialization that can silently produce wrong values, enums/strings that are compared without exhaustiveness, and version drift between producer and consumer contracts.
Do not demand types for their own sake; report where a weak contract can cause a real defect.`,
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
    prompt: `Review whether the repository feels like one coherent system.
Look especially for: multiple patterns solving the same problem (several ways to fetch data, handle errors, define components, structure modules, write tests), duplicated concepts under different names, inconsistent terminology for the same domain object, old and new approaches coexisting without a migration being finished, unnecessary local helpers and wrappers that duplicate shared utilities or library features, abstractions that exist but are bypassed in some places, and locally reasonable implementations that conflict with repository-wide conventions (naming, file layout, formatting of user-facing text, logging, configuration access).
Identify the dominant convention first, then report deviations from it and the fragmentation they cause. Never speculate about who or what wrote the code; judge only the code itself.`,
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
