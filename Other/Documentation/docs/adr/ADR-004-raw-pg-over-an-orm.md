# ADR-004: Raw pg over an ORM


## Context

The schema is five tables. The developer was taught SQL and Knex, not Prisma, and is using
TypeScript during the build.

## Decision

Use the `pg` driver directly behind a thin typed query wrapper (~30 lines). Migrations are
hand-written numbered `.sql` files.

## Alternatives

Prisma gives generated types and migration tooling, but is a new tool to learn mid-build. Knex
was taught in the course but is still an abstraction over SQL that would otherwise be visible.

Hand-written SQL is defensible at five tables and keeps the query logic legible to an assessor.
The cost is real: no migration tooling and no generated types. The wrapper recovers typing at the
call site.

## Consequences

- SQL is explicit and reviewable; no ORM to learn.
- No automatic migrations; every schema change is a manual file.
- Without the typed wrapper every row is `any`, which would undercut the reason for using
  TypeScript at all.
