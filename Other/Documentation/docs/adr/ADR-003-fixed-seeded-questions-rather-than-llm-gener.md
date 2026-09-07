# ADR-003: Fixed, seeded questions rather than LLM-generated ones

## Context

biz2code's thesis is that LLMs cannot reliably infer which analysis a given business idea
requires. Letting the LLM invent the questions would reproduce the failure the product exists to
prevent.

## Decision

All questions are fixed in `question-bank.json`. The LLM generates documents only, never
questions.

## Alternative

LLM-generated questions adapt per idea, but are non-deterministic, can fail live, and contradict
the product thesis. A gatekeeper that changes its own gates is not a gatekeeper.

## Consequences

- The demo cannot go off-script; questions are reviewable and version-controlled.
- Adding a vertical means authoring questions by hand.
- Conditional branching is deferred; `dependsOnQuestionId` is reserved but unused.
