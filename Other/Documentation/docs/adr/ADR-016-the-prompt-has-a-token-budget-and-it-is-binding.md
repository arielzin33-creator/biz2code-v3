# ADR-016: The prompt has a token budget, and it is binding

## Context

Groq allows 8,000 tokens per minute per model on this account, and weighs requested output against
the same budget — an oversized `max_tokens` is rejected with 413 before a token is generated.
ADR-009's amendment recorded this once, when a Business Plan prompt carrying two whole prior
documents forced that call onto the fallback provider.

It happened again, and worse. Adding the derivation block, competitor store listings and a raised
`max_tokens` put every call over the ceiling on its own:

mrd  8,974      prd  10,281      business_plan  11,095

Both Groq rungs failed on all three documents and the whole set landed on Gemini. Nothing alerted
anyone; the only trace was the escalation list in the deliverable's provenance.

The single largest cause was caveat duplication. A caveat on a benchmark propagates into every
figure derived from it, so one 320-character PROXY warning appeared eight times in a single
prompt — roughly 2,500 characters of the same sentence.

## Decision

Prompt size is a budgeted resource, not a consequence.

1. Each distinct caveat is written once and referred to by number afterwards. The first
   occurrence still prints in full beside the figure it qualifies.
2. An explanation belongs where the thing is explained. The description of how SOM was derived
   was attached to `somPayers` as a caveat, so it propagated everywhere; it moved into the
   derivation block.
3. Nothing rendered deterministically into the document is repeated in the prompt.
4. `max_tokens` reflects what sections actually run to. Twelve sections averaging 500 characters
   do not need 3,600 tokens.

Result: 7,221 / 7,728 / 7,880 — all three inside the ceiling, verified back on
`openai/gpt-oss-20b` with no Gemini fallback.

## Trade-off

Numbered caveat references are marginally weaker than repeating the text. Against that, the
previous behaviour meant no caveats reached the document from Groq at all, because Groq never
ran.

## Consequences

- The Business Plan has roughly 120 tokens of headroom and the PRD 272. Another section or a
  longer competitor list will start failing rung 1 again.
- `prompts/budget.test.ts` guards it. It builds each template against a realistic worst case — a
  24-month horizon, every benchmark resolving, and for the Business Plan the prior-document
  digest attached — and fails above 7,900. The alarm sits 100 tokens below the real ceiling
  because a template that merely fits today breaks on the next benchmark that gains a caveat, and
  the failure is silent. Both previous regressions would have been caught by it.
- A fallback to Gemini is a symptom, not a routine event. When a whole set escalates, read the
  prompt size before anything else.
