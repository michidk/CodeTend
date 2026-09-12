# Contributing

Use Bun 1.4 and Node 24. Start from an up-to-date `main`, keep migrations in
sync with `src/db/schema.ts`, and use Conventional Commits.

```bash
bun install --frozen-lockfile
(cd eve && npm ci)
bun run verify
bun audit --production
(cd eve && npm audit --omit=dev)
```

Database changes also require a migrated PostgreSQL instance:

```bash
bun run db:migrate
bun run test:database
```

For UI changes, verify desktop and phone-width layouts in both color schemes.
Do not trigger an LLM scan merely to test UI.

When you add or change a scanner in `src/lib/scanners.ts`, revisit the
"Not yours" boundary clause of every neighbouring dimension so concerns stay
mutually exclusive; see [docs/architecture.md](docs/architecture.md). Model
list prices live in `src/lib/ai-pricing.ts`; check them against the provider
pricing pages before a release.

Pull requests should explain behavior changes, migration/rollback impact,
security implications and the checks performed; the pull-request template
asks for each. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
