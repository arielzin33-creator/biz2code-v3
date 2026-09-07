# ADR-007: Immutable versioned deliverables

## Context

Revising an answer must not silently destroy the previously generated document.

## Decision

Every generation writes a new `deliverables` row with an incremented version and its own file
(`MRD_v1.docx`, `MRD_v2.docx`). Nothing is overwritten.

## Alternative

Overwriting in place is cheaper on disk but destroys the evidence a gatekeeper exists to produce.
An approval workflow whose outputs can be silently mutated is not an approval workflow.

## Consequences

- History is free; comparing v1 to v2 demonstrates the revise loop live.
- Disk grows; no pruning in the MVP.
- Re-downloading old versions is out of MVP scope, though the data supports it.
