# ADR-015: The document's figures and chart are rendered in code, not by the model

## Context

Every section of every document is written by the model from supplied figures. That is right for
prose and wrong for a summary table, whose entire value is being exactly right: a model that
rounds 5,306 to "about 5,300" under a heading saying Key Figures has broken the only promise that
section makes.

The projection had the same problem in reverse. Twelve rows of numbers do not communicate a curve
flattening, and the flattening is the finding — cohorts accumulate while earlier ones decay, so
more months alone do not close the gap.

## Decision

Two parts of every document are built deterministically and never pass through the model.

**Key Figures** — six Word tables: market, acquisition, revenue, costs, unit economics, and the
founder's objectives against the evidence. Each carries a title, one sentence on what it is for,
and three columns: Figure, Value, Basis. The Basis column carries provenance and caveats; an
absent figure renders in the warning colour.

**The projection chart** — a PNG bar chart drawn from scratch and embedded in all three
documents: bars per month, `MONTH` on the x-axis, `NET REVENUE (USD)` rotated on the y-axis,
round tick values, hairline gridlines.

## Alternatives

A markdown table from the model is the least work, but correctness cannot be guaranteed and the
failure mode is a plausible wrong number in the one place a reader trusts. A charting library is
quick to write but every option needs a native canvas or a headless browser, contradicting
ADR-002. Drawing it — an RGBA buffer, a 5×7 bitmap font and a PNG encoder over `node:zlib` — is
~300 lines with no dependencies.

A hand-rolled 5×7 font will never match a real typeface; rendering at 2× and displaying at half
size closes most of the gap. Two defects here were found by looking at the rendered image rather
than trusting it: the y-axis title came out mirrored and reversed, and the tick values read $1.9K
/ $5.6K because rounding the peak to a nice number rarely divides nicely by four. Rounding the
step and multiplying back fixes it.

## Consequences

- Numbers in the summary cannot drift from the arithmetic, because they are the arithmetic.
- Space-padded, aligned text was removed; it only lines up at the exact font it was padded for.
- Repeated Basis text collapses to "As above." TAM and SAM share every caveat, and printing the
  same four-line paragraph twice trains a reader to skip the column.
- `RenderedSection` carries typed `blocks` — prose, table, image — rather than only a string.
- The full month-by-month table was removed from the prompt: it is rendered into the document
  either way, and repeating it cost tokens against a binding budget (ADR-016).
