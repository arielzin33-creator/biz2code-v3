# ADR-011: Silent LLM by default, with a scaffolded feedback mode

## Context

The owner wants a simple demo, but may later want the model to critique answers before approval.

## Decision

By default the LLM emits document content only. A feedback path exists behind a config flag, off
by default, returning a short critique of answers at a gate.

## Alternative

Feedback always on makes a richer gate but adds another live failure surface. Building the seam
now costs little; enabling it during demo week costs a rehearsal.

## Consequences

- One code path is exercised in the demo.
- A disabled path risks rotting; it needs at least one unit test.
- If enabled later, gate latency roughly doubles.
