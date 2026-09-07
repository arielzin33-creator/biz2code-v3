# ADR-006: Question bank and benchmarks live in JSON files, not the database

## Context

Questions and benchmarks are authored content, reviewed like code.

## Decision

`question-bank.json` and `benchmarks/*.json` ship in the repository. The database stores answers
and generated output, referencing `question_id` and `vertical_id` as opaque strings.

## Alternative

Seeded database tables would need an admin UI or SQL to inspect, and would not show up in a diff.
The benchmark file is a guardrail you can point at; that argument is weaker if the data is hidden
in a table. The cost is referential integrity — a `question_id` typo is caught by a validator,
not a foreign key.

## Consequences

- Content changes are pull requests; validators run in CI.
- No FK enforcement between `answers.question_id` and the bank; the validator must cover it.
- `answers` rows can outlive a question that is later removed — the validator flags orphans.
