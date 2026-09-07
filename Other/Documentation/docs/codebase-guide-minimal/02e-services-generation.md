# 02e — Generation, the model, and rendering (minimal)

Eight files, **2,050 lines, 39 exports**: `generation.service.ts` (394), `llm.service.ts` (404),
`docx.service.ts` (260), `chart.service.ts` (247), `prompts/context.ts` (244),
`prompts/documents.ts` (336), `prompts/figures.ts` (165), `prompts/budget.test.ts` (113).

---

# 1. `generation.service.ts` — 394 lines

## 1.1 Types

| Name | Shape |
|---|---|
| `FieldProvenance` | `field, generatedBy, usedFallback, unvalidated, unvalidatedReason` — 25 per run |
| `Provenance` | 10 fields, written identically to all three `deliverables` rows |
| `UnvalidatedEntry` | `{ field, reason }` — **per document** |
| `GenerationOutcome` | `version, documents[], unvalidated[], provenance` — the HTTP response body |
| `DraftedDocument` *(private)* | `template, result, keyFigures` |
| `DeliverableRow` | `id, doc_type, version, file_path, generated_at, unvalidated` |

`ProjectRow` here is a local 6-field subset — **not** `project.service`'s `ProjectRow`.

## 1.2 Exports

`generateAll(projectId)` · `listDeliverables(projectId)` · `getDeliverable(projectId, id)` ·
re-exports `GENERATION_ORDER`, `DocType`.
Private: `assertAllPhasesApproved` (409), `gatherExternal`, `nextVersion`, `draftDocument`,
`renderDraft`.

## 1.3 `gatherExternal` — three to five network calls

```
resolveCountry(p2q2 answer)            → 1 call (may hit 2 cache keys)
worldBankIndicator × 2                 → SP.POP.TOTL, IT.NET.USER.ZS
itunesSearch × |competitorSearchTerms| → 0..3 calls, or 1 fallback call
```

Every call appends `{source, detail, ok}` to the ledger — **including failures**, so it records
what was attempted.

**The fallback term:** `searchTerms = terms.length ? terms : [fallbackTerm]` where
`fallbackTerm = project.name.slice(0, 40)`. A project naming no competitors searches the store
using its own name, and the results are presented to the model as *"comparable apps already
shipping"* with no indication of that.

**Deduplication is by `trackName` only** — nothing filters by publisher, which is why searching
"Google Maps, Waze" returns same-publisher apps.

## 1.4 `generateAll` — the sequence

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
| 9 | 299-305 | the set-level model ladder |
| 10 | 309-313 | render each draft to disk |
| 11 | 315-341 | assemble `provenance` |
| 12 | 345-354 | one transaction, three INSERTs |

**The set-level ladder** — distinct from `llm.service`'s per-call ladder:

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

If any one document fails, **all three are redrafted** on the next model — ADR-010's one-voice
rule. Worst case: 3 models × 3 documents = 9 `generateJson` calls, each running its own 2-rung
pinned ladder — up to **18 provider requests**.

**If the last model also fails**, the run still completes, writes three `.docx` files and returns
200; every field renders `reason = 'Generation failed for this document. …'`. Nothing aborts.

**`priorDocuments` is built from the current attempt only** — `drafts` is reset at the start of
each `draftSet`, so a redraft on model 2 uses model 2's MRD and PRD.

## 1.5 `renderDraft` — where the `unvalidated` array is created

```ts
const modelFlagged = new Set(
  Array.isArray(content.unvalidated_fields)
    ? (content.unvalidated_fields as unknown[]).map(String) : []);
…
if (!result.ok)                       reason = `Generation failed for this document. ${…}`;
else if (!body)                       reason = 'The model returned no content for this field.';
else if (modelFlagged.has(field.key)) reason = 'The model reported that it could not fully source this field…';
```

**Three conditions, and the third is the model's own JSON key.** This is *not*
`benchmark.service`'s deterministic flag — the two share a name and nothing else (**D17**).

`body` is `typeof raw === 'string' && raw.trim() ? raw.trim() : null` — a non-string is
discarded, not coerced.

**Section 0 is always Key Figures**, with `body: null` and pre-computed `blocks`.

## 1.6 The provenance ledger

| Field | Source |
|---|---|
| `generatedAt` | `new Date().toISOString()` |
| `answersUsed` | all 23 on a complete project |
| `benchmarksUsed` | **9 entries** — the calculation layer's keys only |
| `externalCalls` | includes failures |
| `computed` | 14 figures with `inputs[]` |
| `fields` | 25 |
| `llmAttempts` | per document: model, outcome, ms, detail |
| `model` / `usedFallback` / `escalations` | the set-level ladder |

**The derivation's benchmarks are absent.** `derivation.benchmarksUsed` exists and is never read,
so a B2B run's `b2b_cac_usd` and `b2b_logo_churn_monthly_pct` — the two figures the whole
projection rests on — are not in the record, while nine consumer benchmarks it did not use are.

---

# 2. `llm.service.ts` — 404 lines, 11 exports

## 2.1 Configuration

| Constant | Value | Note |
|---|---|---|
| `GROQ_MODEL` | `'openai/gpt-oss-120b'` | |
| `GROQ_FALLBACK_MODEL` | `'openai/gpt-oss-20b'` | |
| `GEMINI_MODEL` | `'gemini-3.5-flash-lite'` | |
| `MAX_OUTPUT_TOKENS` | `4000` | Every template overrides it |
| `MAX_BUDGET_WAIT_MS` | **`60_000`** | ARCHITECTURE and WORK_PLAN both say 30 s |
| `REASONING_EFFORT` | `'low'` | Sent only when the model matches `/gpt-oss/` |
| `MIN_MS_BETWEEN_CALLS` | `2500` | |
| `TIMEOUT_MS` | `28_000` | |
| `TEMPERATURE` | `0.2` | |
| `GROQ_TOKENS_PER_MINUTE` | `8000` | |
| `GROQ_REFILL_PER_SECOND` | `133.33` | |

## 2.2 Budget and pacing

`estimateCost = ceil(chars/4) + maxTokens` — the same formula duplicated in `budget.test.ts`.
Budget state is a module-level `Map` updated from the response header:

```ts
const remaining = Number(res.headers.get('x-ratelimit-remaining-tokens'));
if (Number.isFinite(remaining)) budget.set(model, { remaining, at: Date.now() });
```

Refilled linearly by elapsed time, capped at the per-minute ceiling. **Per process** — a restart
resets it to `Infinity`, so the first call after a restart never waits.

`__setPacingForTests` is an exported test hook in production code. `budgetSnapshot` has **no
production caller**.

## 2.3 The guardrail preamble

`buildGuardrailPreamble(allowedCitations)` — four instructions (102-123), **4 tests**:

1. The allow-list, or `(none — every figure in this section must be marked unvalidated)`
2. An enumerated prohibition: *"figure, statistic, percentage, currency amount, market size,
   growth rate, company name, or published study … Not from memory, not as an illustration, not
   as a 'typical industry' figure, not rephrased."*
3. **What to do instead**, in three numbered steps — write the sentence without the number, add
   the path to `unvalidated_fields`, say plainly that no sourced figure was available
4. *"Do not compute anything."* and *"carry that caveat into your prose"*

**Tension with ADR-014:** step 3 tells the model to populate `unvalidated_fields`, while
`RESPONSE_RULES` in `documents.ts` tells it not to when merely reporting a gap. Reconcilable, but
they arrive from two files.

## 2.4 Provider clients

| | Groq | Gemini |
|---|---|---|
| Message shape | `messages: [system, user]` | one `user` part, concatenated |
| JSON mode | `response_format: { type: 'json_object' }` | `responseMimeType: 'application/json'` |
| Output cap | `max_tokens: maxTokens` | `maxOutputTokens: max(maxTokens*2, 4000)` — **doubled** |
| Truncation signal | `finish_reason === 'length'` | `finishReason === 'MAX_TOKENS'` |
| Budget header | read and stored | not read |
| Pacing | `await paceCalls()` | **skipped** |

Failure classification: **413 → `too_large`**, **429 → `rate_limited`** (with `retry-after`),
other non-OK → `error`, `TimeoutError`/`AbortError` → `timeout`.

Gemini gets double the output allowance because it has no shared prompt+output budget — the
ADR-016 constraint is Groq-specific.

## 2.5 The ladder

`generateJson<T>(opts) => Promise<LlmResult<T>>` — **never throws**, **17 tests**.

**Pinned** (what `generation.service` always uses): `[ pinnedModel, pinnedModel (retry) ]`.
If both fail, the set-level ladder escalates the model.

**Unpinned** (no production caller; reachable only through `critiqueAnswers`):
`[ firstGroq, firstGroq (retry), secondGroq, gemini ]` with budget-aware reordering — the model
that can currently afford the call goes first, and after a refill wait the ladder may swap rungs
0 and 2. This is the "four-rung ladder" WORK_PLAN describes; it is intact and is **not** the path
generation takes.

**`evaluate` — five ways a response is malformed**, each with its own message and test:
truncated at the token limit · unparseable JSON · empty body · JSON that is not an object ·
missing a required key.

**The retry-skip rule:**

```ts
if ((called.outcome === 'too_large' || called.outcome === 'rate_limited')
    && ladder[i + 1]?.model.endsWith('(retry)')) i += 1;
```

An identical request cannot fit a budget it just failed.

`usedFallback` compares against the **first rung's** model, so under a pinned ladder it is always
`false` — the set-level `setUsedFallback` is the flag that matters.

**`GenerateOptions.label` is dead** — both call sites pass it; `generateJson` never reads it.
**`critiqueAnswers` is unreachable** — gated on a flag, and no route or service calls it anyway.

---

# 3. `prompts/context.ts` — 244 lines, 9 exports

`GenerationContext` has **no handle to anything** — no db, no fetch.

Exports: `renderAnswers` · `renderCalculations` · `renderBenchmarks` · `renderExternal` ·
`renderDerivation` · `allowedCitations` · `renderSharedContext` + two interfaces.
Private: `readAnswer`, `renderComputed`, `renderComparison`.

## 3.1 The caveat de-duplication — ADR-016's fix, in nine lines

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

`seen` is created once per `renderCalculations` call and threaded through every figure. A
320-character PROXY warning propagating into eight derived figures now costs its full length once.

**The map does not span sections** — `renderDerivation` has its own inline `fig` helper printing
every caveat in full. De-duplication is per-block, not per-prompt.

## 3.2 The allow-list — at most six entries

```ts
out.add("The founder's own answers, as given in this document's ANSWERS section");
out.add("The pre-computed figures in this document's COMPUTED FIGURES section");
for (const m of Object.values(ctx.calculations.benchmarksUsed))
  if (sourced) out.add(`${publisher} — ${url}`);
if (ctx.external.worldBank.length)  out.add('World Bank World Development Indicators API');
if (!tam.unvalidated && tam.unit === 'venues') { out.add('OpenStreetMap via the Overpass API — …');
                                                 out.add('Wikidata — …'); }
if (ctx.external.itunes.length)     out.add('Apple iTunes Search API');
```

**The venue sources are gated on `tam.unit === 'venues'`** — the B2B branch. A consumer project
can never cite Overpass or Wikidata even if `countVenues` had run.

## 3.3 Two statements in the prompt that are no longer true

- `fig('Expected customer lifetime (the founder answered this)', calc.expectedLifetimeMonths)` —
  the figure is derived since ADR-012 retired `p4q6`.
- The comparison label *"Assumed lifetime vs published retention"* and `lifetimeDivergence`'s
  *"You expect a paying customer to stay N months."* — same root cause.

## 3.4 `readAnswer`'s range handling — D19

```ts
if (a.value_json) return Array.isArray(a.value_json) ? a.value_json.join(', ') : String(a.value_json);
```

For a `range` answer `value_json` is `{min, max}` — not an array — so `String({min,max})` produces
**`[object Object]`**. The revenue band reaches the ANSWERS block of every prompt as
`A: [object Object]`.

The same `String()`-on-an-object trap the client fixed in `QuestionField`. Masked because the
band's real values reach the model via `renderDerivation`'s verdict prose and the Key Figures
table — but the ANSWERS section, which the MRD and PRD are told to ground their claims in, shows
the founder's revenue objective as `[object Object]`.

---

# 4. `prompts/documents.ts` — 336 lines, 8 exports

`DocType` · `DocField {path, key, heading, instruction}` ·
`DocTemplate {docType, title, fileStem, fields, maxTokens, build}` · `MRD` (5 fields, 2000) ·
`PRD` (8 fields, 2200) · `BUSINESS_PLAN` (12 fields, 2000) · `TEMPLATES` · `GENERATION_ORDER`.

**25 model-written fields + 1 Key Figures section = 26.**

## 4.1 `build` — one prompt shape for all three

```ts
systemPrompt = `${ROLE}\n\n${buildGuardrailPreamble(allowedCitations(ctx))}`;
userPrompt   = [`Draft the ${title}.`, '', renderSharedContext(ctx), extra(ctx),
                RESPONSE_RULES(fields)].join('\n');
requiredKeys = [...fields.map(f => f.key), 'unvalidated_fields'];
```

`requiredKeys` is enforced by `evaluate`, so a response missing any field key — or
`unvalidated_fields` — is malformed and the rung is retried.

## 4.2 The orphaned instruction — D18

`RESPONSE_RULES` (32-50) ends with:

```
    If every figure you used came from the supplied context, return an empty array.
    The key names above whose content you
      could not fully source. Include a key here whenever you had to write around
      a missing figure. An empty array claims everything is sourced, so use it
      only when that is true.
```

The last four lines are a **fragment of the pre-ADR-014 contract**, beginning mid-sentence. Its
operative instruction directly contradicts the *"Do NOT flag"* rule four lines above.

## 4.3 Field inventory

**MRD — 5:** `market_requirements` (formal *"The user shall"* statements) ·
`market_validation_statistics` (name the publisher for every figure; carry PROXY/conflict
caveats) · `market_audience_sizing` (**"the reachable market the founder stated"** — a retired
concept) · `revenue_potential_by_segment` · `segmentation_personas` (personas are EXTRAPOLATED —
say so).

**PRD — 8:** `prioritization_rice`, `prioritization_dev_cost`,
`success_metrics_technical_health`, `success_metrics_growth`, `success_metrics_ux_vitals`,
`feature_roadmap`, `release_plan`, `product_recommendations`.
`prioritization_rice` is the field ADR-014 predicts will carry the marker. `feature_roadmap` is
the longest instruction — three labelled groups, group 3 requiring every entry to name the App
Store listing it came from, plus *"Do not invent a feature because it seems sensible."*

**Business Plan — 12:** `executive_summary`, `budget_engineering`, `budget_infrastructure`,
`budget_app_store_fees`, `budget_monthly_tco`, `revenue_unit_economics`, `revenue_extrapolation`,
`revenue_rpv`, `revenue_projected_growth`, `product_weaknesses`, `validation_verdict`,
`final_summary_outcome`.

Three instructions name a rule of thumb and forbid it — each matching a `placeholder` metric:

| Field | Forbidden |
|---|---|
| `budget_engineering` | the 30% technical-debt provision |
| `revenue_unit_economics` | the 3:1 LTV:CAC target |
| `revenue_projected_growth` | a k-factor or virality assumption |

## 4.4 The prior-document digest

```ts
const digest = (doc, limit) => Object.entries(doc)
  .filter(([k]) => k !== 'unvalidated_fields')
  .map(([k, v]) => `${k}: ${String(v).slice(0, limit)}`).join('\n');
```

260 characters per field — at most ~3,400 characters for 5 MRD + 8 PRD fields.

`flagged()` also passes each prior document's `unvalidated_fields` into the Business Plan prompt,
so `product_weaknesses` can name which sections were unsourced.

**The no-priors branch is explicit:** *"Do NOT mark the field unvalidated: that marker is reserved
for a figure with no source, not for a section written with less context than intended."*

---

# 5. `prompts/figures.ts` — 165 lines, 1 export

`keyFigureBlocks(calc, d) => SectionBlock[]` — 6 tables + 0-1 image. **No test.**

`format`'s unit-aware currency suffixes: `USD/month` → `/ month`, `USD/year` → `/ year`,
`USD/month/user` → `/ customer / month`. Values ≥ 100 rounded and locale-formatted; below 100
keep two decimals.

`rowBuilder`'s **"As above."** — the `seen` set is per `keyFigureBlocks` call, so it spans all six
tables: TAM and SAM sharing every caveat means SAM's Basis cell reads `As above.`

| Table | From `derivation` | From `calculations` |
|---|---|---|
| Market | `tam`, `sam`, `somPayers`, `marketCeiling` | — |
| Acquisition | `installsPerMonth`, `costPerPayingCustomer`, `impliedLifetimeMonths` | — |
| `Revenue at month N` | — | `payingUsers`, `grossMonthlyRevenue`, `storeCommission`, `netMonthlyRevenue`, `annualRecurringRevenue`, `arpuEffective` |
| Costs and profit | — | `monthlyTco`, `monthlyProfit` |
| Unit economics | — | `cacEstimate`, `ltvEstimate`, `ltvCacRatio`, `paybackPeriodMonths` |
| Your objectives against the evidence | `verdicts.*`, `derivedMonthlyRevenue` | — |

The Acquisition row label switches on the model: *"Customers won per month"* (B2B) vs
*"Installs bought per month"*.

**The Unit economics explanation hard-codes `1.5`** as "the sourced viability floor", while the
actual comparison reads `ltv_cac_min_threshold_ratio` from the corpus. Re-sourcing the benchmark
would make the sentence disagree with the verdict two rows below it.

The last table mixes computed rows with three hand-built literal ones (floor, target, adoption
goal — the founder's inputs, not `Computed` values), plus a `Verdict` row putting the headline in
Value and the detail in Basis.

---

# 6. `docx.service.ts` — 260 lines, 7 exports

`OUTPUT_ROOT` · `SectionBlock` (discriminated union `prose | table | image`) · `RenderedSection` ·
`DocumentMeta` · `RenderRequest` · `renderDocument(req) => Promise<string>` ·
`absolutePathFor(relative)`.

**Brand constants:** `accent '154F6B'` (navy-500), `warning 'A32D2D'`, `muted '4E5A5F'`. The
documents render on white, the UI on dark, with different accents deliberately.

**The unvalidated block** — a shaded paragraph with an 18-twip left border in the warning colour,
opening with a bold literal `UNVALIDATED` followed by the reason. Emitted **before** the body, so
a reader meets the marker before the prose it qualifies.

**A section with neither body nor blocks** gets an explicit italic muted sentence: *"No content
was generated for this section."* — never a blank.

**Paragraph splitting:** the model's prose is split on `/\n\s*\n/`, so blank-line-separated
paragraphs survive into Word. A single newline does not create a paragraph.

**The file path is normalised for the web:**
`join('outputs', String(projectId), fileName).replace(/\\/g, '/')` — a Windows separator never
reaches the database or `Content-Disposition`.

**The footer carries provenance:** brand, title, version, UTC timestamp, model name, and
`(fallback)` when applicable — that footer is how the QA sweep noticed a run had silently used
the fallback provider.

---

# 7. `chart.service.ts` — 247 lines, 3 exports

`renderProjectionChart(points, title, valueAxisTitle) => ChartImage | null` — **`null` for an
empty array**. Imports only `node:zlib`. **No test.**

Internals: RGBA `Canvas` + `fillRect` · `FONT` — **44 glyphs**, 5×7 · `drawText` (upper-cases
input) · `drawTextVertical` · `CRC_TABLE` IIFE + `crc32`/`chunk`/`encodePng` · `niceCeiling` ·
`compact` (`1.9K`, `2.3M`).

**The font covers exactly what the chart needs:** `0-9`, `A-Z`, `$`, `,`, `.`, `-`, `(`, `)`,
space. Any other character silently renders as a space — a caption with a colon or slash would
lose it.

**`drawTextVertical`'s rotation** (the ADR-015 fix — the first attempt was mirrored and reversed):

```ts
fillRect(c, x + row * scale, cy + (GLYPH_W - 1 - col) * scale, scale, scale, rgb);
```

with `cy` **decreasing** per character.

**`niceCeiling` rounds the step, not the peak** — the fix for `$1.9K / $5.6K` ticks:

```ts
const rough = max / ticks;
const mag = 10 ** Math.floor(Math.log10(rough));
const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= rough) ?? 10;
return step * mag * ticks;
```

**Rendered at 2x, displayed at half:** `const S = 2`; `widthPt: W / S`. A 1800x920 PNG placed at
900x460 points.

`encodePng` assumes a zero byte offset — correct for a freshly allocated `Uint8Array`, the only
way a `Canvas` is created.

---

# 8. `prompts/budget.test.ts` — 113 lines

4 tests, all passing. The fixture supplies an empty external context, understating a real prompt
by ~500 tokens and letting the Business-Plan-with-priors case pass at 7,603 when the real figure
is **8,105** — over Groq's ceiling. See [01-architecture.md](01-architecture.md) §2 ADR-016.

---

## Coverage

| File | Lines | Exports | Tests | Gaps |
|---|---:|---:|---:|---|
| `llm.service.ts` | 404 | 11 | **30** | `budgetSnapshot`, `critiqueAnswers`'s enabled path |
| `prompts/documents.ts` | 336 | 8 | **4** (budget only) | no test asserts a field set or instruction |
| `prompts/context.ts` | 244 | 9 | 0 direct | all 9 renderers |
| `generation.service.ts` | 394 | 10 | **0** | the whole pipeline — `qa:generation` needs a live model |
| `docx.service.ts` | 260 | 7 | **0** | `qa:generation` unzip checks only |
| `chart.service.ts` | 247 | 3 | **0** | `niceCeiling`/`compact` are pure but not exported |
| `prompts/figures.ts` | 165 | 1 | **0** | six tables, no offline assertion |

**1,066 lines of the deterministic rendering path have zero offline test coverage** — the largest
untested region of the codebase, and the half of the output ADR-015 argues must be exactly right.
