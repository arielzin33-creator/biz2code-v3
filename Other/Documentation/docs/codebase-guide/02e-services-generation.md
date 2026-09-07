# 02e — Services: generation, the model, and rendering

Phase 3, backend, part 5. Eight files, **2,050 lines, 39 exports**:
`generation.service.ts` (394), `llm.service.ts` (404), `docx.service.ts` (260),
`chart.service.ts` (247), `prompts/context.ts` (244), `prompts/documents.ts` (336),
`prompts/figures.ts` (165), `prompts/budget.test.ts` (113).

Everything here sits at or across the trust boundary described in
[01-architecture.md](01-architecture.md) §2.6.

---

## `server/services/generation.service.ts` — 394 lines

**Purpose.** The pipeline: gather, derive, calculate, draft all three documents on one model,
render, store.

**Its own header (present):** `/* Orchestrates MRD -> PRD -> Business Plan, then renders DOCX. */`

**Related ADR:** ADR-007, ADR-009, ADR-010, ADR-014, ADR-015.

### 1.1 Types

| Name | Shape | Notes |
|---|---|---|
| `FieldProvenance` | `field, generatedBy, usedFallback, unvalidated, unvalidatedReason` | One per document field — 25 per run |
| `Provenance` | 10 fields | Written identically to all three `deliverables` rows |
| `UnvalidatedEntry` | `{ field, reason }` | **Per document**, unlike `Provenance` |
| `GenerationOutcome` | `version, documents[], unvalidated[], provenance` | The HTTP response body |
| `ProjectRow` *(private)* | 6 fields | A local subset — **not** the `ProjectRow` from `project.service` |
| `DocumentResult` *(private)* | 11 fields | |
| `DraftedDocument` *(private)* | `template, result, keyFigures` | Key Figures are built at draft time, before rendering |
| `DeliverableRow` | `id, doc_type, version, file_path, generated_at, unvalidated` | The list/download projection |

### 1.2 Functions

| Name | Signature | Inputs | Output | Side effects | Failure mode | Tested? | Calls |
|---|---|---|---|---|---|---|---|
| `assertAllPhasesApproved` *(private)* | `(projectId) => Promise<void>` | id | — | DB read | **`AppError(409)`** naming the count | via `qa-generation-probe` | `questionBank.getPhases` |
| `gatherExternal` *(private)* | `(answers, fallbackTerm) => Promise<{external, calls}>` | — | context + ledger | **network ×(3..5)** | never throws — every client is null-safe | live only | `resolveCountry`, `worldBankIndicator`, `competitorSearchTerms`, `itunesSearch` |
| `nextVersion` *(private)* | `(projectId) => Promise<number>` | id | `MAX(version) + 1` | DB read | returns 1 on an empty table | `DOC-NO-OVERWRITE` | — |
| `draftDocument` *(private)* | `(template, ctx, pinnedModel) => Promise<DraftedDocument>` | — | draft + key figures | **network (LLM)** | `result.ok === false`, never a throw | live only | `template.build`, `generateJson`, `keyFigureBlocks` |
| `renderDraft` *(private)* | `(draft, projectName, projectId, version, setModel, setUsedFallback) => Promise<DocumentResult>` | — | sections, fields, unvalidated | **file write** | propagates a filesystem error | `DOC-SECTIONS-*` | `renderDocument` |
| **`generateAll`** | `(projectId: number) => Promise<GenerationOutcome>` | id | the outcome | **network, files, DB** | 404 project; 409 phases; **no section failure aborts it** | 26 checks in `qa-generation-probe` | everything |
| `listDeliverables` | `(projectId) => Promise<DeliverableRow[]>` | id | version DESC, doc_type | DB read | none | `DOC-VERSION-ROWS` | — |
| `getDeliverable` | `(projectId, id) => Promise<DeliverableRow>` | ids | one row | DB read | `AppError(404)` | — | — |
| `GENERATION_ORDER`, `DocType` | re-exports from `prompts/documents` | — | — | — | — | — | — |

### 1.3 `gatherExternal` — three to five network calls

```
resolveCountry(p2q2 answer)            → 1 call (may hit 2 cache keys)
worldBankIndicator × 2                 → SP.POP.TOTL, IT.NET.USER.ZS
itunesSearch × |competitorSearchTerms| → 0..3 calls, or 1 fallback call
```

Every call appends to `calls: Provenance['externalCalls']` with `{source, detail, ok}` — including
failures, so the ledger records what was *attempted*, not only what succeeded.

**The fallback term** (line 112): `searchTerms = terms.length ? terms : [fallbackTerm]`, where
`fallbackTerm = project.name.slice(0, 40)`. So a project that names no competitors still searches
the store, using its own name. That is a deliberate degradation, but the resulting apps are
presented to the model as *"comparable apps already shipping"*
([context.ts:139](../../../../server/prompts/context.ts)) with no indication that the search term
was the project's own name.

**Deduplication is by `trackName` only** (lines 119-123). Nothing filters by publisher, which is
the mechanism behind Master Plan §10's *"Searching 'Google Maps, Waze' returns same-publisher
apps, so competitor-derived features cite Google Chrome and Google Earth."*

### 1.4 `generateAll` — the sequence

| Step | Line | What |
|---|---|---|
| 1 | 249 | `SELECT * FROM projects WHERE id = $1` → 404 |
| 2 | 251 | `assertAllPhasesApproved` → 409 |
| 3 | 253 | `getAnswers(projectId)` |
| 4 | 256 | `gatherExternal` |
| 5 | 258-259 | `derive(await buildDerivationInputs(...))` |
| 6 | 260-265 | `calculate({ ...inputsFromAnswers, derivedPayers, derivedLifetimeMonths, derivedCac })` |
| 7 | 267 | `nextVersion` — **once**, before drafting |
| 8 | 268-275 | build `baseContext` |
| 9 | 299-305 | **the model ladder** — see below |
| 10 | 309-313 | render each draft to disk |
| 11 | 315-341 | assemble `provenance` |
| 12 | 345-354 | one transaction, three `INSERT`s |

**The set-level ladder** (lines 277-305) — distinct from `llm.service`'s per-call ladder:

```ts
const MODEL_LADDER = [MODELS.GROQ_MODEL, MODELS.GROQ_FALLBACK_MODEL, MODELS.GEMINI_MODEL];

for (const model of MODEL_LADDER) {
  setModel = model;
  drafts = await draftSet(model);
  const failed = drafts.filter((d) => !d.result.ok).map((d) => d.template.docType);
  if (failed.length === 0) break;
  escalations.push({ model, failed });
}
```

If any one document fails, **all three are redrafted** on the next model. That is ADR-010's
one-voice rule, and `GRD-ONE-MODEL` in
[qa-generation-probe.ts:115-119](../../../../server/scripts/qa-generation-probe.ts) asserts the
set shares a model.

**Cost of the worst case:** three models × three documents = up to 9 `generateJson` calls, each
of which runs its own 2-rung pinned ladder — up to 18 provider requests. `escalations` records
which model failed on which documents, and it is the only trace of a fallback, which is why
ADR-016 says *"When a whole set escalates, read the prompt size before anything else."*

**If the last model also fails**, the loop exits with `drafts` from Gemini and
`setModel = GEMINI_MODEL`. Every field then renders with
`reason = 'Generation failed for this document. …'` and the run still completes, writes three
`.docx` files, and returns 200. Nothing aborts — ADR-010 and the Gated Specification Method §4.5.

**`priorDocuments` is built from the current attempt only** (lines 282-289): `priorContent`
searches `drafts`, which is reset at the start of each `draftSet`. So a redraft on model 2 uses
model 2's MRD and PRD, never model 1's.

### 1.5 `renderDraft` — where the `unvalidated` array is created

```ts
const modelFlagged = new Set(
  Array.isArray(content.unvalidated_fields)
    ? (content.unvalidated_fields as unknown[]).map(String) : []);
…
if (!result.ok)                      reason = `Generation failed for this document. ${…}`;
else if (!body)                      reason = 'The model returned no content for this field.';
else if (modelFlagged.has(field.key)) reason = 'The model reported that it could not fully source this field…';
```

**Three conditions, and the third is the model's own JSON key.** This is the array
`GenerationOutcome.unvalidated` exposes and the `unvalidated` column stores. It is *not*
`benchmark.service`'s deterministic flag — the two share a name and nothing else. See
[01-architecture.md](01-architecture.md) §1.2 under ADR-014, and
[07-gaps-and-drift.md](07-gaps-and-drift.md) D17.

`body` is `typeof raw === 'string' && raw.trim() ? raw.trim() : null` (line 201) — a non-string
value for a field key is discarded, not coerced.

**Section 0 is always Key Figures** (lines 189-193), with `body: null` and the pre-computed
`blocks`. The model's fields follow. So every document opens with numbers the model never saw the
inside of.

### 1.6 The provenance ledger

| Field | Source | Note |
|---|---|---|
| `generatedAt` | `new Date().toISOString()` | |
| `answersUsed` | `answers.map(a => a.question_id)` | all 23 on a complete project |
| `benchmarksUsed` | `Object.entries(calculations.benchmarksUsed)` | **9 entries** — the calculation layer's `BENCHMARK_KEYS` only. The derivation's 7 keys are **not** recorded |
| `externalCalls` | `gatherExternal`'s `calls` | includes failures |
| `computed` | every `CalculationResult` field except `comparisons` and `benchmarksUsed` | 14 figures with `inputs[]` |
| `fields` | `results.flatMap(r => r.fields)` | 25 |
| `llmAttempts` | per document, the full `Attempt[]` | model, outcome, ms, detail |
| `model` / `usedFallback` / `escalations` | the set-level ladder | |

**The derivation's benchmarks are absent from the ledger.** `derivation.benchmarksUsed` exists on
the result object ([derivation.service.ts:584](../../../../server/services/derivation.service.ts))
and is never read. So a B2B run's `b2b_cac_usd` and `b2b_logo_churn_monthly_pct` — the two
figures the whole projection rests on — are not in the provenance record, while nine consumer
benchmarks it did not use are. Same root cause as ADR-013's "Known gap".

---

## `server/services/llm.service.ts` — 404 lines, 11 exports

**Purpose.** The provider clients, the token budget, the pacing, the escalation ladder, the
guardrail preamble, and JSON validation.

**Related ADR:** ADR-009, ADR-011, ADR-016.

### 2.1 Configuration

| Constant | Value | Note |
|---|---|---|
| `GROQ_MODEL` | `'openai/gpt-oss-120b'` | |
| `GROQ_FALLBACK_MODEL` | `'openai/gpt-oss-20b'` | |
| `GEMINI_MODEL` | `'gemini-3.5-flash-lite'` | |
| `MAX_OUTPUT_TOKENS` | `4000` | Default; every template overrides it |
| `MAX_BUDGET_WAIT_MS` | **`60_000`** | ARCHITECTURE and WORK_PLAN both say *"waits up to 30 s"* — it is 60 |
| `REASONING_EFFORT` | `'low'` | Sent only when the model matches `/gpt-oss/` |
| `MIN_MS_BETWEEN_CALLS` | `2500` | |
| `TIMEOUT_MS` | `28_000` | |
| `TEMPERATURE` | `0.2` | |
| `GROQ_TOKENS_PER_MINUTE` | `8000` | |
| `GROQ_REFILL_PER_SECOND` | `133.33` | `8000 / 60` |

### 2.2 Budget and pacing

| Name | Signature | Inputs | Output | Side effects | Tested? |
|---|---|---|---|---|---|
| `remainingFor` *(private)* | `(model: string) => number` | — | refilled estimate, `Infinity` if unseen | reads module state | indirectly |
| `estimateCost` *(private)* | `(systemPrompt, userPrompt, maxTokens) => number` | — | `ceil(chars/4) + maxTokens` | none | the same formula is duplicated in `budget.test.ts` |
| `waitUntilAffordable` *(private)* | `(model, cost) => number` | — | ms to wait, 0 if affordable | none | indirectly |
| `paceCalls` | `(now?) => Promise<number>` | — | ms actually waited | **`setTimeout`**, mutates `lastGroqCallAt` | indirectly |
| `__setPacingForTests` | `(ms: number) => void` | — | — | mutates `pacingMs` | used by the test setup |
| `resetPacing` | `() => void` | — | — | clears `lastGroqCallAt`, `pacingMs`, `budget` | used by the test setup |
| `budgetSnapshot` | `() => Record<string, number>` | — | remaining for both Groq models | none | **no production caller** |

Budget state is a module-level `Map` updated from the response header
(line 172-173):

```ts
const remaining = Number(res.headers.get('x-ratelimit-remaining-tokens'));
if (Number.isFinite(remaining)) budget.set(model, { remaining, at: Date.now() });
```

and refilled linearly by elapsed time, capped at the per-minute ceiling. It is **per process** —
a restart resets it to `Infinity`, so the first call after a restart never waits.

`__setPacingForTests` is an exported test hook in production code. It is named to be
conspicuous; nothing outside the test file calls it.

### 2.3 The guardrail preamble

| Name | Signature | Output | Tested? |
|---|---|---|---|
| `buildGuardrailPreamble` | `(allowedCitations: string[]) => string` | the system-prompt block | **4 tests** |

Four instructions, in order (lines 102-123):

1. The allow-list, or — when empty — `(none — every figure in this section must be marked
   unvalidated)`.
2. An enumerated prohibition: *"figure, statistic, percentage, currency amount, market size,
   growth rate, company name, or published study … Not from memory, not as an illustration, not
   as a 'typical industry' figure, not rephrased."*
3. **What to do instead**, in three numbered steps — write the sentence without the number, add
   the path to `unvalidated_fields`, say plainly that no sourced figure was available. Asserted
   by `it('tells the model what to do INSTEAD of inventing, not merely what not to do')`.
4. *"Do not compute anything."* and *"carry that caveat into your prose"* — asserted by two
   further tests.

**Note the tension with ADR-014.** Instruction 2's step (2) *tells the model to populate
`unvalidated_fields`*, and `RESPONSE_RULES` in `documents.ts` then tells it not to when it is
merely reporting a gap. The two are reconcilable — step 2 fires only when the model *stated* a
figure — but they arrive from two different files and are the reason the marker's meaning is
hard to keep to one.

### 2.4 Provider clients

| Name | Signature | Returns | Failure classification |
|---|---|---|---|
| `callGroq` *(private)* | `(model, systemPrompt, userPrompt, maxTokens)` | `{ok, raw}` or `{ok:false, outcome, detail}` | **413 → `too_large`**, **429 → `rate_limited`** (with `retry-after`), other non-OK → `error`, `TimeoutError`/`AbortError` → `timeout` |
| `callGemini` *(private)* | `(systemPrompt, userPrompt, maxTokens)` | same | no key → `error` *"no Gemini key configured"*; 429 → `rate_limited` |

Differences between the two:

| | Groq | Gemini |
|---|---|---|
| Message shape | `messages: [system, user]` | one `user` part: `` `${systemPrompt}\n\n${userPrompt}` `` |
| JSON mode | `response_format: { type: 'json_object' }` | `responseMimeType: 'application/json'` |
| Output cap | `max_tokens: maxTokens` | `maxOutputTokens: Math.max(maxTokens * 2, 4000)` — **doubled** |
| Truncation signal | `finish_reason === 'length'` | `finishReason === 'MAX_TOKENS'` |
| Budget header | read and stored | not read |
| Pacing | `await paceCalls()` | **skipped** (line 348) |

Gemini gets double the output allowance because it has no shared prompt+output budget; the
constraint ADR-016 describes is Groq-specific.

### 2.5 The ladder

| Name | Signature | Output | Tested? |
|---|---|---|---|
| `LlmResult<T>` / `Attempt` | interfaces | — | — |
| `GenerateOptions` *(private)* | `systemPrompt, userPrompt, requiredKeys?, label?, maxTokens?, pinnedModel?` | — | — |
| `generateJson<T>` | `(opts) => Promise<LlmResult<T>>` | `{ok, data?, failureReason?, model?, usedFallback?, attempts}` | **never throws** | **17 tests** |
| `runLadder` *(private)* | `(ladder, ctx) => Promise<LlmResult<T>>` | — | walks the rungs | via the above |
| `critiqueAnswers` | `(context, allowedCitations) => Promise<LlmResult<AnswerCritique>>` | — | disabled by flag | 1 test (the disabled path only) |
| `MODELS` | `const` | the three names + `TIMEOUT_MS` + `MAX_OUTPUT_TOKENS` | — | read by `generation.service` |

**Two ladder shapes.**

*Pinned* (lines 288-303) — what `generation.service` always uses:

```
[ pinnedModel, pinnedModel (retry) ]
```

Two rungs. If both fail, `generateJson` returns `ok: false` and the **set-level** ladder in
`generation.service` escalates the model.

*Unpinned* (lines 306-328) — no production caller; reachable only through `critiqueAnswers`:

```
[ firstGroq, firstGroq (retry), secondGroq, gemini ]
```

with a budget-aware reordering: the model that can currently afford the call goes first
(lines 307-310), and after waiting for a refill the ladder may swap rungs 0 and 2
(lines 322-325). This is the *"four-rung ladder"* WORK_PLAN Day 4 describes — it is intact, and
it is not the path generation takes.

**`evaluate` — five ways a response is malformed** (lines 274-283), each with its own message:
truncated at the token limit · unparseable JSON · empty body · JSON that is not an object ·
missing a required key. Each has a test.

**The retry-skip rule** (lines 355-356):

```ts
if ((called.outcome === 'too_large' || called.outcome === 'rate_limited')
    && ladder[i + 1]?.model.endsWith('(retry)')) i += 1;
```

An identical request cannot fit a budget it just failed. Two tests assert it, one per status.

`usedFallback` is computed as `baseModel(rung.model) !== intended`, where `intended` is the
**first rung's** model (line 342) — so under a pinned ladder `usedFallback` is always `false`,
and the set-level `setUsedFallback` in `generation.service` is the flag that actually matters.

**`GenerateOptions.label` is dead.** It is in the interface and both call sites pass it
(`label: template.docType`, `label: 'critique'`), but `generateJson` never destructures or reads
it (lines 269-272). Nothing consumes it.

**`critiqueAnswers` is unreachable.** Gated on `env.LLM_FEEDBACK_ENABLED`, and no route or
service calls it regardless. ADR-011's scaffold exists and is inert.

---

## `server/prompts/context.ts` — 244 lines, 9 exports

**Purpose.** Turn the computed objects into the exact text the model sees, and build the
citation allow-list.

**Its own header (present):** `/* Assembles the permitted context for a generation call, and the
allow-list of citable sources. */`

| Name | Signature | Output | Side effects | Tested? | Note |
|---|---|---|---|---|---|
| `ExternalContext`, `GenerationContext` | interfaces | — | — | — | `GenerationContext` has **no handle to anything** — no db, no fetch |
| `readAnswer` *(private)* | `(a: AnswerRow) => string` | one line | none | no test | see below |
| `renderAnswers` | `(answers) => string` | phase-grouped Q/A | none | no direct test | falls back to the raw id if `getQuestion` throws |
| `renderComputed` *(private)* | `(name, c, seen: Map) => string` | a figure + numbered caveats | mutates `seen` | no test | the ADR-016 de-duplication |
| `renderComparison` *(private)* | `(name, c: Comparison) => string` | one line | none | no test | |
| `renderCalculations` | `(calc) => string` | 14 figures + 3 comparisons | none | no direct test | |
| `renderBenchmarks` | `(used: Record<string, Resolved>) => string` | 9 rows + caveats | none | no direct test | |
| `renderExternal` | `(ext) => string` | market line + WB rows + up to 5 apps | none | no direct test | |
| `renderDerivation` | `(d) => string` | funnel, projection shape, verdict, levers | none | no direct test | |
| `allowedCitations` | `(ctx) => string[]` | the allow-list | none | no direct test | **at most 6 entries** |
| `renderSharedContext` | `(ctx) => string` | the whole user prompt body | none | via `budget.test.ts` | |

### 3.1 The caveat de-duplication — ADR-016's fix, in nine lines

```ts
for (const caveat of c.caveats) {
  const already = seen.get(caveat);
  if (already === undefined) {
    const n = seen.size + 1;
    seen.set(caveat, n);
    lines.push(`      caveat ${n}: ${caveat}`);
  } else {
    lines.push(`      caveat ${already} also applies`);
  }
}
```

The `seen` map is created once per `renderCalculations` call (line 78) and threaded through every
figure. A 320-character PROXY warning that propagates into eight derived figures now costs its
full length once and `caveat 3 also applies` seven times.

**The map does not span sections.** `renderDerivation` has its own inline `fig` helper
(lines 153-156) that prints every caveat in full, with no numbering. So a caveat shared between
the calculation block and the derivation block is still printed twice. In practice the two blocks
draw from different `Computed` objects, so the overlap is small — but the de-duplication is
per-block, not per-prompt.

### 3.2 The allow-list — at most six entries

```ts
out.add("The founder's own answers, as given in this document's ANSWERS section");
out.add("The pre-computed figures in this document's COMPUTED FIGURES section");
for (const m of Object.values(ctx.calculations.benchmarksUsed))
  if (sourced) out.add(`${publisher} — ${url}`);
if (ctx.external.worldBank.length)                        out.add('World Bank World Development Indicators API');
if (!tam.unvalidated && tam.unit === 'venues') { out.add('OpenStreetMap via the Overpass API — …');
                                                 out.add('Wikidata — …'); }
if (ctx.external.itunes.length)                           out.add('Apple iTunes Search API');
```

Two fixed entries, one per sourced benchmark publisher, and up to four external sources — the
same four that are reachable from the pipeline ([02d](02d-services-data-sources.md) §3.5).

**The venue sources are gated on `tam.unit === 'venues'`** (line 218), i.e. on the B2B branch
having produced a TAM. A consumer project can never cite Overpass or Wikidata even if
`countVenues` had run.

### 3.3 Two statements in the prompt that are no longer true

**`renderCalculations` line 91:**

```ts
fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths),
```

Since ADR-012 retired `p4q6`, that figure is derived — see
[02c-services-numbers.md](02c-services-numbers.md) §1.7. The model is told a derived figure is an
answer.

**`renderCalculations` line 100** labels the comparison *"Assumed lifetime vs published
retention"*, and `lifetimeDivergence`'s prose opens *"You expect a paying customer to stay N
months."* Same root cause.

### 3.4 `readAnswer`'s range handling

```ts
if (a.value_json) return Array.isArray(a.value_json) ? a.value_json.join(', ') : String(a.value_json);
```

For a `range` answer, `value_json` is `{min, max}` — not an array — so `String({min,max})`
produces **`[object Object]`**. The revenue band the founder typed reaches the ANSWERS block of
every prompt as `A: [object Object]`.

This is the same `String()`-on-an-object trap that Master Plan §7 records as *"A range field that
could never save"* in `QuestionField`. That one was fixed; this one was not. It is masked
because the band's real values reach the model twice by other routes — through
`renderDerivation`'s verdict prose and through the Key Figures table — so the document is still
correct. But the ANSWERS section, which the MRD and PRD are told to ground their claims in, shows
the founder's revenue objective as `[object Object]`.

Tracked as **D19** in [07-gaps-and-drift.md](07-gaps-and-drift.md).

---

## `server/prompts/documents.ts` — 336 lines, 8 exports

**Purpose.** One template per document: its fields, headings, per-field instructions, JSON
contract and output size.

**Its own header (present):** `/* One prompt template per document. Each declares its own fields
and the JSON shape it must return. */`

| Name | Signature | Output | Tested? |
|---|---|---|---|
| `DocType` | `'mrd' \| 'prd' \| 'business_plan'` | — | — |
| `DocField` | `{ path, key, heading, instruction }` | — | — |
| `DocTemplate` | `{ docType, title, fileStem, fields, maxTokens, build }` | — | — |
| `RESPONSE_RULES` *(private)* | `(fields) => string` | the JSON contract | via `budget.test.ts` |
| `ROLE` *(private)* | `const string` | the persona | — |
| `build` *(private)* | `(template, extra) => DocTemplate` | attaches `build()` | — |
| `MRD` | `DocTemplate`, 5 fields, `maxTokens: 2000` | — | budget test |
| `PRD` | `DocTemplate`, 8 fields, `maxTokens: 2200` | — | budget test |
| `BUSINESS_PLAN` | `DocTemplate`, 12 fields, `maxTokens: 2000` | — | 2 budget tests |
| `TEMPLATES` | `Record<DocType, DocTemplate>` | — | — |
| `GENERATION_ORDER` | `['mrd','prd','business_plan']` | — | — |

**25 model-written fields + 1 Key Figures section = 26**, matching Master Plan §3.

### 4.1 `build` — one prompt shape for all three

```ts
systemPrompt = `${ROLE}\n\n${buildGuardrailPreamble(allowedCitations(ctx))}`;
userPrompt   = [`Draft the ${title}.`, '', renderSharedContext(ctx), extra(ctx),
                RESPONSE_RULES(fields)].join('\n');
requiredKeys = [...fields.map(f => f.key), 'unvalidated_fields'];
```

`requiredKeys` is enforced by `generateJson`'s `evaluate`, so a response missing any field key —
or `unvalidated_fields` — is treated as malformed and the rung is retried.

### 4.2 The orphaned instruction

[documents.ts:32-50](../../../../server/prompts/documents.ts) — `RESPONSE_RULES`, verbatim:

```
  "unvalidated_fields": array of strings — the key names above where YOU stated a
    figure that no supplied source backs. That is the only thing this list is for.

    Flag a field when: you asserted a number, rate or total that was not given to you.

    Do NOT flag a field when:
      - you correctly reported that a figure was unavailable. …
      - the section is a judgement, a recommendation or a verdict …
      - a section you summarise contains an unvalidated figure. …

    If every figure you used came from the supplied context, return an empty array.
    The key names above whose content you
      could not fully source. Include a key here whenever you had to write around
      a missing figure. An empty array claims everything is sourced, so use it
      only when that is true.
```

The last four lines are a **fragment of the pre-ADR-014 contract left in place**. It begins
mid-sentence (*"The key names above whose content you could not fully source."*) and its
operative instruction — *"Include a key here whenever you had to write around a missing figure"*
— directly contradicts the *"Do NOT flag"* rule four lines above it. ADR-014 states that every
such instruction was removed; this one survived.

Tracked as **D18** in [07-gaps-and-drift.md](07-gaps-and-drift.md).

### 4.3 Field inventory

**MRD — 5 fields**

| `path` | `key` | Heading | Instruction summary |
|---|---|---|---|
| `mrd.market_requirements` | `market_requirements` | Market Requirements | Formal *"The user shall"* statements |
| `mrd.market_validation_statistics` | `market_validation_statistics` | Market Validation Statistics | Name the publisher for every figure; carry PROXY/conflict caveats |
| `mrd.market_audience_sizing` | `market_audience_sizing` | Market and Audience Sizing | **"the reachable market the founder stated"** — a retired concept |
| `mrd.revenue_potential_by_segment` | `revenue_potential_by_segment` | Revenue Potential by Segment | Supplied figures only |
| `mrd.segmentation_personas` | `segmentation_personas` | Segmentation and Personas | Personas are EXTRAPOLATED — say so |

**PRD — 8 fields:** `prioritization_rice`, `prioritization_dev_cost`,
`success_metrics_technical_health`, `success_metrics_growth`, `success_metrics_ux_vitals`,
`feature_roadmap`, `release_plan`, `product_recommendations`.

`prioritization_rice` is the one field ADR-014 predicts will carry the marker: *"Impact and
Confidence are YOUR estimates and are not sourced — say so explicitly."*

`feature_roadmap` is the longest instruction in the file (lines 171-179): three labelled groups,
with group 3 requiring every entry to name the App Store listing it came from, and an explicit
*"Do not invent a feature because it seems sensible."*

**Business Plan — 12 fields:** `executive_summary`, `budget_engineering`,
`budget_infrastructure`, `budget_app_store_fees`, `budget_monthly_tco`,
`revenue_unit_economics`, `revenue_extrapolation`, `revenue_rpv`, `revenue_projected_growth`,
`product_weaknesses`, `validation_verdict`, `final_summary_outcome`.

Three instructions name a specific rule of thumb and forbid it:

| Field | Forbidden |
|---|---|
| `budget_engineering` | the 30% technical-debt provision — *"a rule of thumb with no measured source"* |
| `revenue_unit_economics` | the 3:1 LTV:CAC target — *"Do not cite"* |
| `revenue_projected_growth` | a k-factor or virality assumption — *"none is sourced"* |

Each corresponds to a `placeholder` metric in the benchmark corpus, so the prohibition and the
data agree.

### 4.4 The prior-document digest

```ts
const digest = (doc, limit) => Object.entries(doc)
  .filter(([k]) => k !== 'unvalidated_fields')
  .map(([k, v]) => `${k}: ${String(v).slice(0, limit)}`).join('\n');
```

260 characters per field. With 5 MRD fields and 8 PRD fields that is at most ~3,400 characters —
the reason `budget.test.ts` has a fourth test for the Business Plan with priors attached.

`flagged()` (lines 308-311) additionally passes each prior document's `unvalidated_fields` list
into the Business Plan prompt, so `product_weaknesses` can name which sections were unsourced.

**The no-priors branch is explicit about the marker** (lines 295-300): *"Do NOT mark the field
unvalidated: that marker is reserved for a figure with no source, not for a section written with
less context than intended."* Exactly ADR-014's rule, stated where it could be misapplied.

---

## `server/prompts/figures.ts` — 165 lines, 1 export

**Purpose.** Build the six Key Figures tables and the chart, from the computed objects only.

**Its own header (present):** `/* The Key Figures block: every number the documents rest on, as
Word tables plus the projection chart. */`

**Related ADR:** ADR-015.

| Name | Signature | Output | Side effects | Tested? |
|---|---|---|---|---|
| `format` *(private)* | `(c: Computed) => string` | `'unvalidated'` or a formatted value | none | no test |
| `basis` *(private)* | `(c: Computed) => string \| null` | reason, or joined caveats, or `Confidence: X.` | none | no test |
| `rowBuilder` *(private)* | `() => (label, c) => Row` | a closure with a `seen` set | mutates `seen` | no test |
| `money` *(private)* | `(n: number \| null) => string` | `'not given'` or `$N / month` | none | no test |
| `keyFigureBlocks` | `(calc, d) => SectionBlock[]` | 6 tables + 0-1 image | **none** | **no test** |

**`format`'s unit-aware currency suffixes** (lines 16-21): `USD/month` → `/ month`,
`USD/year` → `/ year`, `USD/month/user` → `/ customer / month`. Values ≥ 100 are rounded and
locale-formatted; below 100 they keep two decimals.

**`rowBuilder`'s "As above."** (lines 31-39) — the ADR-015 fix. The `seen` set is per
`keyFigureBlocks` call, so it spans all six tables: TAM and SAM sharing every caveat means SAM's
Basis cell reads `As above.`

**The six tables and their sources:**

| Table | Rows from `derivation` | Rows from `calculations` |
|---|---|---|
| Market | `tam`, `sam`, `somPayers`, `marketCeiling` | — |
| Acquisition | `installsPerMonth`, `costPerPayingCustomer`, `impliedLifetimeMonths` | — |
| `Revenue at month N` | — | `payingUsers`, `grossMonthlyRevenue`, `storeCommission`, `netMonthlyRevenue`, `annualRecurringRevenue`, `arpuEffective` |
| Costs and profit | — | `monthlyTco`, `monthlyProfit` |
| Unit economics | — | `cacEstimate`, `ltvEstimate`, `ltvCacRatio`, `paybackPeriodMonths` |
| Your objectives against the evidence | `verdicts.*`, `derivedMonthlyRevenue` | — |

The Acquisition row label switches on the model (line 69): *"Customers won per month"* for B2B,
*"Installs bought per month"* otherwise.

**The Unit economics explanation hard-codes a benchmark value** (lines 105-106):

> *"LTV:CAC below the sourced viability floor of **1.5** means acquisition costs more than it
> returns."*

`1.5` is a literal in the explanation string, while the actual comparison reads
`ltv_cac_min_threshold_ratio` from the corpus
([calculation.service.ts:407](../../../../server/services/calculation.service.ts)). If the
benchmark were re-sourced to a different value, the table's own explanatory sentence would
disagree with the verdict printed two rows below it.

**The last table mixes computed rows with hand-built ones** (lines 121-142): three rows are
literal objects (the floor, the target, the adoption goal) because they are the founder's inputs,
not `Computed` values, and a fourth (`Verdict`) puts the headline in the Value column and the
detail in Basis.

**`keyFigureBlocks` has no unit test.** It is the deterministic half of every document — six
tables and a chart — and its only coverage is `DOC-MARKER-RENDERED` and the OOXML checks in
`qa-generation-probe`, which need a live model call.

---

## `server/services/docx.service.ts` — 260 lines, 7 exports

**Purpose.** Render `RenderedSection[]` into an OOXML file on disk.

**Its own header (present):** `/* Renders generated sections into MRD_v1.docx / PRD_v1.docx /
BusinessPlan_v1.docx. */`

| Name | Signature | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|
| `OUTPUT_ROOT` | `const string` | absolute path to `outputs/` | — | — | — |
| `SectionBlock` | discriminated union `prose \| table \| image` | — | — | — | — |
| `RenderedSection` | `{ heading, body, blocks?, unvalidatedReason? }` | — | — | — | — |
| `DocumentMeta` | `{ projectName, version, generatedAt, model, usedFallback }` | — | — | — | — |
| `RenderRequest` | `{ template, sections, meta, projectId }` | — | — | — | — |
| `text` *(private)* | `(value, opts?) => TextRun` | Calibri run | — | — | — |
| `coverPage` *(private)* | `(template, meta) => Paragraph[]` | 7 paragraphs + page break | — | — | — |
| `unvalidatedBlock` *(private)* | `(reason) => Paragraph` | shaded warning block | — | — | `DOC-MARKER-RENDERED` |
| `cell`, `cellText` *(private)* | — | table primitives | — | — | — |
| `figureTable` *(private)* | `(block) => (Paragraph \| Table)[]` | title + explanation + table | — | — | — |
| `chartBlock` *(private)* | `(block) => Paragraph[]` | centred image + caption | — | — | — |
| `sectionParagraphs` *(private)* | `(section) => (Paragraph \| Table)[]` | heading, marker, prose, blocks | — | — | — |
| `renderDocument` | `(req) => Promise<string>` | repo-relative path | **`mkdir` + `writeFile`** | propagates fs errors | `DOC-OOXML-*` ×3 |
| `absolutePathFor` | `(relative) => string` | absolute path | none | — | used by download and 3 scripts |

**Brand constants** (lines 17-23): `accent '154F6B'` (navy-500), `warning 'A32D2D'`,
`muted '4E5A5F'`. The Design System doc records navy as the on-white accent at 8.89:1 contrast —
the documents render on white, the UI on dark, and the two use different accents deliberately.

**The unvalidated block** (lines 79-91) is a shaded paragraph with a 18-twip left border in the
warning colour, opening with a bold literal `UNVALIDATED` followed by the reason. It is emitted
**before** the body (line 181), so a reader meets the marker before the prose it qualifies.

**A section with neither body nor blocks gets an explicit sentence** (lines 190-194):
*"No content was generated for this section."* — italic and muted. So a failed field renders both
the marker and a statement, never a blank.

**Paragraph splitting** (line 184): the model's prose is split on `/\n\s*\n/`, so blank-line-
separated paragraphs survive into Word. A single newline does not create a paragraph.

**The file path is normalised for the web** (line 256):
`join('outputs', String(projectId), fileName).replace(/\\/g, '/')` — so a Windows path separator
never reaches the database or the `Content-Disposition` header.

**The footer carries provenance** (lines 224-227): brand, title, version, UTC timestamp, model
name, and `(fallback)` when applicable. That footer string is how the QA sweep noticed a run had
silently used the fallback provider.

---

## `server/services/chart.service.ts` — 247 lines, 3 exports

**Purpose.** Draw the projection as a PNG with no dependencies beyond `node:zlib`.

**Its own header (present):** `/* Draws the revenue projection as a PNG bar chart, with no
dependencies. */`

**Related ADR:** ADR-015, ADR-002 (no browser binary).

| Name | Signature | Output | Side effects | Failure mode | Tested? |
|---|---|---|---|---|---|
| `Canvas` *(private)* | `{ w, h, px: Uint8Array }` | RGBA buffer | — | — | — |
| `canvas` *(private)* | `(w, h, bg) => Canvas` | filled buffer | allocates `w*h*4` bytes | — | — |
| `fillRect` *(private)* | `(c, x, y, w, h, rgb) => void` | — | mutates `c.px` | clamps to bounds | — |
| `FONT` *(private)* | `Record<string, number[]>` | **44 glyphs**, 5×7 | — | unknown chars → space | — |
| `textWidth` *(private)* | `(s, scale) => number` | pixels | — | — | — |
| `drawText` *(private)* | `(c, s, x, y, scale, rgb) => void` | — | mutates | upper-cases input | — |
| `drawTextVertical` *(private)* | same | — | mutates | rotates 90° anticlockwise | — |
| `CRC_TABLE` *(private)* | IIFE `Int32Array(256)` | — | computed at import | — | — |
| `crc32`, `chunk`, `encodePng` *(private)* | — | PNG bytes | — | — | — |
| `niceCeiling` *(private)* | `(max, ticks) => number` | a round axis top | none | `max <= 0` → `ticks` | — |
| `compact` *(private)* | `(n) => string` | `1.9K`, `2.3M` | none | — | — |
| `ChartPoint`, `ChartImage` | interfaces | — | — | — | — |
| `renderProjectionChart` | `(points, title, valueAxisTitle) => ChartImage \| null` | PNG + point dimensions | none | **`null` for an empty array** | **no test** |

**The font covers exactly what the chart needs:** `0-9`, `A-Z`, `$`, `,`, `.`, `-`, `(`, `)`,
space. Any other character silently renders as a space. Since axis labels are generated by
`compact()` and the titles are hard-coded English constants, that is sufficient — but a caption
containing a colon or slash would lose it.

**`drawTextVertical`'s rotation** (line 112):

```ts
fillRect(c, x + row * scale, cy + (GLYPH_W - 1 - col) * scale, scale, scale, rgb);
```

with `cy` **decreasing** per character (line 115). ADR-015 records that this was mirrored and
reversed in the first attempt; both the column flip and the downward-to-upward advance are the
fix.

**`niceCeiling` rounds the step, not the peak** (lines 183-189):

```ts
const rough = max / ticks;
const mag = 10 ** Math.floor(Math.log10(rough));
const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= rough) ?? 10;
return step * mag * ticks;
```

This is the ADR-015 fix for `$1.9K / $5.6K` ticks: the returned ceiling is always exactly
`ticks × a round step`, so every gridline label is round.

**Rendered at 2×, displayed at half** (lines 202, 246): `const S = 2`; `widthPt: W / S`. A 1800×920
PNG placed at 900×460 points.

**`encodePng` assumes a zero byte offset** (line 151):
`Buffer.from(c.px.buffer, y * c.w * 4, c.w * 4)` — correct for a freshly allocated `Uint8Array`,
which is the only way a `Canvas` is created.

**No test file.** Two of the project's recorded bugs lived here and were found by looking at the
rendered image. `renderProjectionChart` returning a `Buffer` makes it awkward to assert, but the
two pure helpers — `niceCeiling` and `compact` — are exactly the kind of function a unit test
would pin, and neither is exported.

---

## `server/prompts/budget.test.ts` — 113 lines

Covered in detail under ADR-016 in [01-architecture.md](01-architecture.md) §1.2 and in
[06-testing.md](06-testing.md). Summary: 4 tests, all passing, and the fixture supplies an empty
external context, which understates a real prompt by ~500 tokens and lets the Business-Plan-with-
priors case pass at 7,603 when the real figure is **8,105** — over Groq's ceiling.

---

## Coverage summary for this section

| File | Lines | Exports | Unit tests | Notable gaps |
|---|---|---|---|---|
| `llm.service.ts` | 404 | 11 | **30** | `budgetSnapshot`, `critiqueAnswers`'s enabled path |
| `prompts/documents.ts` | 336 | 8 | **4** (budget only) | no test asserts a template's field set or an instruction |
| `prompts/context.ts` | 244 | 9 | 0 direct | all 9 renderers — exercised only through `budget.test.ts`'s length assertion |
| `generation.service.ts` | 394 | 10 | **0** | the whole pipeline. Covered by `qa:generation` (26 checks, needs a live model) |
| `docx.service.ts` | 260 | 7 | **0** | covered by `qa:generation`'s unzip checks |
| `chart.service.ts` | 247 | 3 | **0** | `niceCeiling` and `compact` are pure and untestable as written (not exported) |
| `prompts/figures.ts` | 165 | 1 | **0** | the six tables have no assertion outside a live run |

**1,066 lines of the deterministic rendering path — `generation.service`, `docx.service`,
`chart.service`, `figures.ts` — have zero offline test coverage.** That is the largest untested
region of the codebase, and it is the half of the output ADR-015 argues must be exactly right.

---

*Next: [03a-frontend-structure.md](03a-frontend-structure.md).*
