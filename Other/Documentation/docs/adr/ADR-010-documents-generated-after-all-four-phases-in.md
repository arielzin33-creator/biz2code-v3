# ADR-010: Documents generated after all four phases, in dependency order

## Context

The Business Plan's "Product Weaknesses" field synthesises MRD gaps and PRD constraints, so it
cannot be produced before those documents exist. An earlier phase-to-document mapping ignored
this.

## Decision

All four phases are answered and approved first. Generation then runs MRD, then PRD, then
Business Plan.

## Alternative

Per-phase generation gives feedback sooner, but the Business Plan would be built in two halves
around the other two documents, requiring partial-document state and a merge step — for feedback
the silent-mode MVP does not surface anyway.

## Consequences

- No partial documents; one generation pipeline.
- The user sees no output until all four gates pass. Mitigated by the seed project.
- A hidden feedback-loop mode is scaffolded but disabled (ADR-011).
