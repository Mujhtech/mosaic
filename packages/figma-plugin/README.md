# Mosaic Export (Figma plugin)

Maps a Figma frame into a **Mosaic Paywall Protocol 0.3** document and hands you
the JSON. You import that JSON into Mosaic Studio with its existing **Import**
button; the plugin never talks to the network and never touches the backend.

The mapping is **lossy and one-way**. It is a starting point for a paywall, not
a faithful reproduction of the design. Everything that could not cross is listed
in the export report before you import anything.

## Build

```sh
cd packages/figma-plugin
npm install
npm run build          # writes build/main.js and build/ui.html
npm run dev            # the same, in watch mode
npm test               # vitest, including validation against the real protocol
npm run typecheck
npm run check          # typecheck + test + build
```

## Load it in Figma

1. `npm run build` (Figma loads the built files, not the TypeScript).
2. In the Figma desktop app: **Plugins → Development → Import plugin from
   manifest…**
3. Choose `packages/figma-plugin/manifest.json`.
4. Select the top-level frame of a paywall and run **Plugins → Development →
   Mosaic Export**.

The plugin re-maps on every selection change, so you can keep it open while you
move around the file.

## Export and import

1. Select **exactly one** frame, component, or instance. Any other selection is
   an error in the plugin UI -- one frame becomes one screen.
2. Read the report: mapped node count, warnings, and skipped layers.
3. **Download JSON** (or **Copy to clipboard**).
4. In Mosaic Studio, create a draft with **Import** and choose the file.

Studio validates on import through `parseImportedJson` →
`validatePaywallDocument`. The plugin's own test suite runs that same validator
on every document its mapper can produce, so an export that reaches Studio
should never be rejected. If one is, the diagnostic Studio shows is the bug
report.

## What it maps

| Figma | Mosaic Protocol 0.3 |
| --- | --- |
| Selected frame | one screen `imported`, `scrollContainer` (vertical, safe-area respecting) wrapping the root stack |
| Auto-layout frame / component / instance | `stack` |
| `layoutMode` | `direction` |
| `itemSpacing` | `gap`, clamped to 0–4096 |
| `primaryAxisAlignItems` MIN / CENTER / MAX / SPACE_BETWEEN | `mainAxisDistribution` start / center / end / spaceBetween |
| `counterAxisAlignItems` MIN / CENTER / MAX / BASELINE | `crossAxisAlignment` start / center / end / **center** |
| `padding{Top,Right,Bottom,Left}` | `padding` `{top, end, bottom, start}` |
| Solid background fill | `appearance.background` as a literal colour |
| Corner radius | `appearance.cornerRadius` |
| Text layer | `text` component with `typography` and `accessibility.role: "text"` |
| Text characters | the localized default **and** a generated catalog key |
| Node + paint opacity | folded into the literal colour's alpha channel |

### Deliberate conversions

- **Figma auto spacing** (`SPACE_BETWEEN`) becomes `mainAxisDistribution:
  "spaceBetween"` with `gap: 0`. Figma still reports the last manual
  `itemSpacing` in that mode, and it is not what renders.
- **Left/right padding becomes start/end.** The emitted document is LTR; a
  mirrored RTL layout is a Studio-side decision, not something to bake in here.
- **Baseline alignment** has no protocol equivalent and maps to `center`, with a
  warning. Same for **justified** text alignment, which maps to `start`.
- **Colours are literal**, uppercase `#RRGGBBAA`. A Figma colour style or
  variable still exports as the literal value; the plugin emits no design
  tokens. A text layer with no solid fill falls back to the semantic
  `text.primary` rather than guessing black.

### The typography heuristic

Figma has no notion of a semantic text role, so `typography.style` is inferred,
in this order:

| Condition | Style |
| --- | --- |
| font size ≥ 32 | `display` |
| font size ≥ 24 | `title` |
| font size ≥ 18 | `heading` |
| all-caps, at least one letter, ≤ 40 characters | `label` |
| font size ≤ 12 | `caption` |
| otherwise | `body` |

All-caps is checked before the caption rule so that small shouted text ("MOST
POPULAR") becomes a label rather than a caption.

Font weight snaps to the nearest of regular (400), medium (500), semibold (600),
bold (700), with ties going to the lighter name. When Figma reports no numeric
weight the style name is parsed instead ("SemiBold" → semibold, "Extra Bold" →
bold).

Font size is clamped to 8–96 and line height to a 0.8–3 multiplier; Figma's AUTO
line height becomes 1.2, a percentage divides by 100, and pixels divide by the
resolved font size.

**These are guesses.** Correct them in Studio.

## Limitations

- **One frame, one screen.** Multi-screen paywalls, sheets, and navigation are
  built in Studio.
- **Images and vectors are skipped**, never invented. A protocol asset needs a
  bundled or remote source plus a fallback, and a plugin cannot upload one, so
  every export ships `assets: []` and `products: []`. Each skipped layer is
  listed in the report as "skipped: image/vector -- re-add in Studio". A
  *container* with children that also carries an image fill is kept; only the
  fill is dropped, with a warning.
- **Absolute layout is flattened, not reproduced.** A frame without auto-layout
  becomes a vertical stack of its children ordered top-to-bottom then
  left-to-right, with zeroed gap and padding and an
  `layout.absoluteFlattened` warning. The protocol has no absolute positioning
  and pretending otherwise would produce a document that renders wrong on three
  platforms rather than one.
- **Hidden layers and empty text layers are skipped**, and reported.
- **No products, buttons, actions, or product selectors.** The protocol's
  commerce components need product references the plugin has no source for.
  Nothing in an export is purchasable until you wire it up in Studio.
- **Layer names become ids and localization keys**, slugified and de-duplicated.
  Note the two alphabets differ: an id may contain hyphens
  (`hero-title`) and a localization key may not (`figma.hero_title`).
- A **horizontal or empty top-level frame** is wrapped in a synthetic vertical
  `imported-root` stack, because a screen's root content must be a vertical
  stack with at least one child. The original frame keeps its own direction one
  level down.

## Architecture

```
src/main.ts        Figma scene graph -> plain intermediate tree (the only file that uses the Figma API)
src/mapper/*       intermediate tree -> Mosaic document + export report (pure, no Figma, unit-tested)
src/ui/*           the report, Download JSON, Copy to clipboard
```

The seam is deliberate: everything that has to agree with the protocol lives in
`src/mapper`, which is plain TypeScript over plain JSON and therefore testable
in Node without Figma.

`src/mapper/capabilities.ts` re-derives `compatibility.requiredCapabilities`
rather than calling the protocol's `requiredCapabilitiesFor`, because that
module compiles schemas with Ajv and the Figma plugin sandbox has no `eval`.
`capabilities.test.ts` asserts the two agree exactly, for every document shape
the mapper can produce -- the protocol rejects an over-declared capability just
as hard as a missing one.
