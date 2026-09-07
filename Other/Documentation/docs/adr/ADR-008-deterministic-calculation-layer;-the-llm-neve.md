# ADR-008: Deterministic calculation layer; the LLM never does arithmetic

## Context

The Business Plan requires LTV:CAC, payback period, TCO and a revenue projection. LLMs are
unreliable at multi-step arithmetic and cannot be audited when they get it wrong.

## Decision

Eleven formulas run in TypeScript over numeric answers and benchmark constants. Results are
passed to the LLM as pre-computed facts to narrate. The prompt forbids recalculation.

## Alternative

Letting the LLM compute inline costs no code but is unverifiable and non-reproducible. Numbers in
a business plan must be reproducible; a figure that changes between runs is worse than no figure.

## Consequences

- Unit tests cover the maths; the same inputs always give the same outputs.
- Prompts must be written to stop the model helpfully recomputing.
- Any formula touching a placeholder benchmark returns null and renders unvalidated.
