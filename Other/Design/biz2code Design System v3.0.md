# biz2code Design System v3.0

## 1. The core rule

A colour is only usable against a stated background. Each brand colour is legible against
exactly one of the two surfaces this product renders onto:

cyan-500 `#13A8E2` scores 6.95:1 on the dark UI (`#0f1115`), passing AA for body text, and
2.72:1 on a white document page, which fails. navy-500 `#154F6B` is the mirror image: 2.13:1 on
the dark UI, 8.89:1 on white, passing AAA.

One brand, two legible halves. Everything below follows from this.

## 2. Ramps

Sampled from the logo. The 500 step of each ramp is the exact sampled pixel; the other steps
are interpolated from it.

### Cyan

- 300 `#68CCF2` — gradient stop
- 400 `#39BCEE` — hover and emphasis on dark
- 500 `#13A8E2` — the app's `--accent`, and the cap on every chart bar
- 600 `#0F85B3` — smallest step usable for bold text on white (4.18:1)
- 700 `#0B6284` — `info.text` on light surfaces
- 800 `#08465E` — deep fills

### Navy

- 300 `#4CADDC` — gradient stop
- 500 `#154F6B` — DOCX headings, table header text, chart bars
- 700 `#0E3648` — 12.81:1 on white, when navy-500 is not dark enough
- 800 `#09232F` — body text on light surfaces, and the app sidebar ground

### Neutral

`#F9FAFA` `#F1F3F4` `#E3E6E8` `#C7CED1` `#94A1A8` `#6A7981` `#4E5A5F` `#373F43` `#252A2D` `#151819`

`neutral-600` `#4E5A5F` is secondary body text on light surfaces, and what the documents use
for footers, captions and the Basis column.

## 3. Logo

`client/src/assets/brand/biz2code-logo.png` — 895 × 297, RGBA, transparent. The mark alone is
`biz2code-mark.png`, used as the favicon.

In the app sidebar it is 78 px tall, rendering 235 px wide in a 288 px rail. On the login page it
is 90 px tall, rendering 271 px wide in a 380 px column. The favicon is the mark alone, at
whatever size the browser asks for.

The lockup is 3.01:1, so at 78 px tall it needs 235 px of width — hence the sidebar widening
from 232 px to 288 px. Both placements carry `width: auto; max-width: 100%`.

The sidebar is navy-800 `#09232F` and the logo's navy half is navy-500 `#154F6B`, so the pill
reads as a distinct shape rather than disappearing into the rail. The asset must stay
transparent; an opaque one shows a white box.

## 4. Document tables

The Key Figures block is six Word tables (ADR-015), replacing space-padded text.

- Header row fill `#F1F5F7` — a tint, not a block.
- Header text in navy-500 bold — 8.89:1 on that tint.
- All borders `#D6DEE1` at 2 eighth-points, a hairline. Word's default weight makes six tables
  look like a form.
- Body text 9.5 pt, one step below prose.
- Basis column in neutral-600 at 8.5 pt, subordinate to the figure it explains.
- An absent value in `#A32D2D`, so gaps are visible while scanning, not only on reading.
- Column widths 34 / 22 / 44 %. Basis is widest because it carries the provenance.

Each table carries a title and one italic sentence in neutral-600 saying what the group is
for. Repeated Basis text collapses to "As above." — TAM and SAM share every caveat.

## 5. Chart

A PNG bar chart drawn by the product itself: an RGBA buffer, a 5×7 bitmap font and a PNG
encoder over `node:zlib`. No dependency — every charting library needs a native canvas or a
headless browser, and ADR-002 says the demo runs on a laptop with nothing installed.

Bars are navy-500 `#154F6B` with a 3 px cyan-500 `#13A8E2` cap. Gridlines are `#DCE3E6` and the
baseline `#6B7A80`, which is also the colour of the tick and month labels. Axis titles and the
chart title are `#1B2A30`. The ground is white.

Drawn at 2× and displayed at half size — a 5×7 font reads as blocky at final size. Bars occupy
62% of their slot.

Two implementation rules:

1. Round the step, not the peak. A nice ceiling rarely divides nicely by four, so rounding the
   peak gives ticks like $1.9K and $5.6K. Rounding the step and multiplying back gives
   $0 / $2K / $4K / $6K / $8K.
2. A quarter turn anticlockwise is `(col, row) → (row, W−1−col)` in screen coordinates.
   Backwards renders the axis title mirrored and reversed.

## 6. The unvalidated badge

Three kinds, not one. A proxy is a real published measurement of something adjacent, which is
more useful than either hiding it or condemning it.

- `unvalidated`, labelled UNVALIDATED, `#ffb4b8` on `rgba(242,84,91,.12)` — no sourced figure
  exists.
- `proxy`, labelled PROXY, `#ffd98a` on `rgba(240,180,41,.12)` — a real figure, borrowed from an
  adjacent vertical.
- `conflict`, labelled SOURCES DISAGREE, `#c9b6ff` on `rgba(150,120,255,.14)` — published sources
  contradict each other.

In the `.docx` the same idea renders as a left-bordered block: `A32D2D` text on an `FCEBEB`
tint, with the reason beside it. Rendered, never omitted.

v3.0 changed how often it appears, not how it looks. The marker now means one thing only — a
figure was stated for which no source was supplied (ADR-014) — so it went from seventeen fields
to one.

## 7. Typography

Display type is Poppins at 700 and 800, for H1 and hero. UI type is Inter, 400–700, for
everything else. Mono is JetBrains Mono at 400 and 500, for IDs, timestamps, code and literals.

As shipped: the app uses a system font stack rather than loading Inter, the documents use
Calibri, and the chart uses its own 5×7 bitmap face. A web font is a network dependency on a
page that must render during a live demo; Calibri is what Word opens without substitution
anywhere; the chart cannot load a font without a native dependency.

## 8. Shape and motion

`radius.pill` is `999px` for badges and chips, `radius.card` is `14px` for cards in print
collateral, and `radius.control` is `10px` for buttons and inputs. As shipped, the app uses one
radius throughout: `--radius: 8px`.

One animation exists: `b2c-slide`, the indeterminate bar during document generation.
Generation takes 120–200 seconds and a static screen that long reads as a hang.

## 9. Usage rules

1. Never set text in cyan-500 on white (2.72:1). Use navy-500, or cyan-600 for bold text at
   14 px and above.
2. Never set text in navy-500 on the dark UI (2.13:1).
3. The accent is not a semantic colour. Approve is green, revise is amber, refusal is red.
4. The unvalidated badge is never styled down.
5. Contrast is measured, not judged. Every pairing here carries its ratio.
6. A missing figure is coloured, not blank.

## 10. Changes from v2.0

- The logo asset went from 772 × 262 to 895 × 297, RGBA transparent.
- In the app it went from 26 px in the sidebar and 30 px on login, to 78 px and 90 px.
- The sidebar widened from 232 px to 288 px.
- Document tables replaced space-padded text with six Word tables.
- Charts did not exist; there is now a PNG bar chart drawn in-product.
- The badge appeared on 17 of 23 document fields; it now appears on 1 of 25.

Machine-readable tokens: `design-tokens.v3.json`. v1.0 and v2.0 artefacts are in `Old/`.
