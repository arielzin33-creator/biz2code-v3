# ADR-014: `unvalidated` marks absent data, and nothing else

## Context

Seventeen of twenty-three document fields rendered `unvalidated`. Four did so because the prompt
instructed it — `documents.ts` said, of technical health, UX vitals and the tech-debt provision,
"mark this field unvalidated". Others inherited the marker from figures they merely mentioned.

The marker therefore meant four things at once: no source exists; this is a judgement; this
section summarises something unsourced; and the prompt told me to. This product's claim rests on
it meaning exactly one.

For technical health the instruction was also factually wrong. Google publishes exact thresholds
— user-perceived crash rate 1.09%, ANR rate 0.47%, per-device crash 8%.

## Decision

`unvalidated` marks one thing: a figure was stated for which no source was supplied.

It is not for a section that was hard to write, came out short, is a judgement clearly labelled
as one, or correctly reports a gap. Reporting a gap is not creating one. A summary does not
inherit its inputs' markers — only the field that first asserts a figure carries it.

Every "mark this field unvalidated" instruction was removed, and the response contract now states
the rule positively and negatively. The published Android vitals thresholds were added as
`primary`-tier benchmarks so that field validates on data rather than on an instruction.

## Trade-off

The old contract survived a prompt-injection probe by sheer volume: it flagged so aggressively
that seventeen markers remained even when injected text ordered their removal. The new contract
asks the model to exercise judgement, and judgement can be manipulated — the same probe now
leaves none, stable across two runs.

That is a real regression, recorded rather than hidden. The correct fix is for the marker not to
depend on the model's cooperation at all: `calculations` and `derivation` already know which
figures are absent, and a deterministic pass should set the marker from that, ignoring what the
model claims. Until that is built, the injection resistance of this marker is weaker than it was,
while the four substantive guardrails — no invented citation, no fabricated statistic, no adopted
suppression claim, no system-prompt disclosure — continue to hold.

## Consequences

- Unvalidated fields fell from 17 of 23 to 1 of 24: `prd.rice`, where Impact and Confidence are
  genuinely the model's judgement and nothing published supports them.
- A single honest marker can be explained as the guardrail working, which is what it now is.
- `GRD-MARKER-SURVIVES` in `qa-generation-probe.ts` fails, deliberately. It should be re-armed
  against the deterministic marker rather than the model's self-report, at which point it becomes
  a stronger test than it was.
