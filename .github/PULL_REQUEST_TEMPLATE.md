## What changes

<!-- Behavior change from the operator's or reviewer's point of view. -->

## Why

<!-- Link the issue or describe the debt/risk this addresses. -->

## Migration and rollback

<!-- New migrations under drizzle/? Are they forward-only? What happens to
     existing findings, scanner ids or knowledge rows? Write "none" if nothing
     touches the schema. -->

## Security implications

<!-- New network egress, credential handling, sandbox or clone-boundary
     changes, new inputs reaching the LLM or the shell. Write "none" if not
     applicable. -->

## Checks performed

- [ ] `bun run verify`
- [ ] `bun run db:migrate && bun run test:database` (when the schema changed)
- [ ] UI verified at desktop and phone width in light and dark mode (when UI changed)
- [ ] Scanner prompt changes keep every neighbouring "Not yours" boundary consistent (when prompts changed)
