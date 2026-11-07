# Repository controls implementation plan

**Goal:** Expose automatic scanning and archive controls directly in the UI.
**Architecture:** Persist archived on repositories, reuse scheduleEnabled, and share a controls component across dashboard and details.
**Tech stack:** React, TanStack Start, Drizzle, PostgreSQL, Bun.
**Spec:** docs/superpowers/specs/2026-11-07-repository-controls-design.md

## Constraints

Preserve history. Archived repositories cannot schedule scans. Restore keeps automatic scanning off.

## Review focus

Queued scheduled work must be cleared. Existing edit forms must reject enabling archived repositories. Global scheduling off must not misrepresent the repository preference. Requests must disable controls while saving. An all-archived dashboard must still show the archive section.

- [x] Add archived database column and migration; implement transactional settings mutations and scheduling guards.
- [x] Add shared controls to dashboard cards and details; split archived cards into a collapsed section.
- [x] Run formatting, tests, type checking and build; inspect diagnostics and final diff.

Validation: 204 Bun tests passed; type checking, production build, import boundaries and dead-code checks passed. PostgreSQL smoke checks passed with all 33 migrations, including archive, restore, scheduling guards, queue removal and history preservation. LSP diagnostics contain no errors or warnings for changed code.
