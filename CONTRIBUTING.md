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

For UI changes, reuse the managed preview and verify desktop and phone-width
layouts in both color schemes. Do not trigger an LLM scan merely to test UI.
Pull requests should explain behavior changes, migration/rollback impact,
security implications and the checks performed.
