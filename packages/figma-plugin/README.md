# Mosaic Export (Figma plugin)

Maps a Figma frame into a **Mosaic Paywall Protocol 0.4** document and hands you
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

1. Select **one or more** frames, components, or instances. Each becomes one
   screen. Anything else in the selection is an error in the plugin UI.
2. Read the report: mapped node count, warnings, and skipped layers. **Every
   row is clickable** -- clicking selects that layer in Figma and scrolls it
   into view, so a warning about "Frame 9" is one click from the thing it means.
3. Download one of two files:
   - **Download for Studio (with images)** -- a `.mosaic-figma.json` bundle
     carrying the protocol document *plus* the rendered pixels of every image
     and vector layer the document itself cannot reference. See
     [The export bundle](#the-export-bundle). Images are rendered on demand, so
     the first click on this button takes a moment.
   - **Download document only** -- the plain protocol JSON, exactly as before.
4. In Mosaic Studio, create a draft with **Import** and choose the file.

Studio validates on import through `parseImportedJson` →
`validatePaywallDocument`. The plugin's own test suite runs that same validator
on every document its mapper can produce, so an export that reaches Studio
should never be rejected. If one is, the diagnostic Studio shows is the bug
report.

## What it maps

| Figma | Mosaic Protocol 0.4 |
| --- | --- |
| Selected frame | one screen, `scrollContainer` (vertical, safe-area respecting) wrapping the root stack |
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
| `fontName.style` / `fontWeight` | `typography.weight`, snapped to four names |
| `textAlignHorizontal` LEFT / CENTER / RIGHT / JUSTIFIED | `typography.alignment` start / center / end / **start** |
| Painted frame + rounded corners + one label | `button` with a placeholder action |
| Childless rectangle/ellipse with a solid fill | empty `stack` with a background and an explicit `sizing` |
| Frame without auto-layout | `stack` with **inferred** rows, gap, padding, and alignment |
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

Font weight snaps onto the protocol's four names at cut points midway between
the canonical stops, inclusive of the lighter one:

| Numeric weight | Weight |
| --- | --- |
| ≤ 450 | `regular` |
| ≤ 550 | `medium` |
| ≤ 650 | `semibold` |
| otherwise | `bold` |

So 450 is regular and 451 is medium. Thin, light, and book all land on regular,
and extrabold, heavy, and black all land on bold, because the protocol has
nowhere lighter or heavier to put them.

When Figma reports no numeric weight, the style name is parsed instead:
thin/light/regular/book → regular, medium → medium, semi/demi (including
SemiBold and DemiBold) → semibold, bold/heavy/black → bold. Longer spellings are
matched first, so "SemiLight" still reads as light rather than as semibold, and
"Bold Italic" reads as bold.

**Mixed styling.** When a text layer styles its characters differently, Figma
reports `figma.mixed` for the size, font, and weight. Rather than fall back to a
default, the plugin reads the *first character's* styling back with
`getRangeFontSize` / `getRangeFontName` / `getRangeFontWeight` -- it is what the
layer opens with, and usually the whole layer bar one styled word -- and raises
a `text.mixedStyling` warning saying so.

**Alignment** maps onto `#/$defs/textAlignment`, whose enum is exactly
`start` / `center` / `end`: LEFT → start, CENTER → center, RIGHT → end,
JUSTIFIED → start with a warning. A test reads that enum out of the schema, so
the mapping cannot drift from it.

Font size is clamped to 8–96 and line height to a 0.8–3 multiplier; Figma's AUTO
line height becomes 1.2, a percentage divides by 100, and pixels divide by the
resolved font size.

**These are guesses.** Correct them in Studio.

### Layout inference for frames without auto-layout

A frame that was never given auto-layout carries its structure only in pixel
coordinates. Flattening it to a zero-gap, zero-padding vertical stack is honest
but useless -- the real export that motivated this produced all-zero spacing for
a three-card paywall -- so the geometry is read back out of the children's
`absoluteBoundingBox`es instead:

- **Rows.** Children whose vertical ranges overlap substantially -- the midpoint
  of one falling inside the other's range -- are grouped into a horizontal
  sub-stack ordered by `x`. Rows themselves are ordered by `y`. A row with a
  single surviving child stays a direct child rather than gaining a wrapper.
- **Gap.** The median inter-sibling spacing: `next.top − prev.bottom` down the
  vertical stack, `next.left − prev.right` inside a row. The median rather than
  the mean, so one floating badge does not drag the whole screen's rhythm.
  Overlapping siblings contribute `0` rather than a negative number, and the
  result is clamped to 0–4096.
- **Padding.** The smallest offset any child leaves at each edge, clamped to ≥ 0,
  becomes `edgeInsets`. Anything larger would clip a child; anything smaller is
  not padding.
- **Alignment.** Against the content box (the frame minus the inferred padding),
  the smallest of three scores wins: the largest leading offset (`start`), the
  largest trailing offset (`end`), or the largest deviation of a child's centre
  from the content centre (`center`). Children that span ≥ 90% of the container
  win outright as `stretch`. When nothing lines up within tolerance the answer is
  `start`, which together with the inferred padding still reproduces the first
  child exactly. A row narrower than the content box carries its own placement in
  `mainAxisDistribution`, because one padding value cannot describe every row.

Rows are measured from the children that *survived* the mapping, so a skipped
image between two paragraphs does not leave a phantom gap.

Two things this does not attempt: absolute overlap, and nested columns. A
full-height element beside a column of short ones -- a sidebar, a tall divider --
swallows whichever of them its midpoint reaches, because rows are flat. The
`layout.absoluteFlattened` warning names the frame and tells you the fix: select
it in Figma, press <kbd>Shift</kbd>+<kbd>A</kbd>, re-export.

If Figma reports no bounding box for the frame or any of its children, the
plugin falls back to the old behaviour -- reading order, zero spacing -- and the
warning says that instead.

### Button detection

A frame becomes a `button` when it wraps **exactly one** non-empty, visible text
layer and either:

- carries a solid fill *and* a corner radius greater than zero, or
- is named with `button`, `btn`, or `cta` as a whole word.

A frame with an icon beside its label stays a stack: the protocol's button would
accept the icon, but the plugin has no asset to put there, so it would ship a
button missing half its content.

`#/$defs/buttonComponent` requires an `action`, and the plugin cannot know which
one -- a purchase needs a product selector to bind to, a navigation needs a
target screen. `{"type": "close"}` is the only member of `#/$defs/buttonAction`
with no field to invent, so it is the placeholder, and every detected button gets
a report entry: *"detected as button with placeholder action -- set the real
action in Studio"*. Capability derivation follows the protocol exactly:
`component.button`, `action.close`, `outcome.normalized`, and
`accessibility.metadata`.

The label doubles as the control's accessible name -- the same localized value,
not a second catalog entry. Note that a button has **no `padding` field** in the
schema; auto-layout padding goes to `appearance.padding`, which
`#/$defs/boxAppearance` does have.

### Plan-card detection (a suggestion, not a conversion)

Two or more sibling frames that share a structural fingerprint and each contain
price-shaped text (`/[$€£]\s?\d|\d+[.,]\d{2}/`) raise a
`component.productCardCandidate` warning listing their layer paths: *"these look
like plan cards -- consider converting to a product selector in Studio"*.

**The emitted document is unchanged.** A `productSelector` needs `products[]`
entries -- store product identifiers the plugin has no source for -- and a
fabricated product reference is a paywall that charges nothing.

### Solid-fill shapes

`#/$defs/stack` allows `children: []`, and the semantic validator only requires a
*screen root* to be non-empty, so a childless rectangle or ellipse with a solid
fill is no longer skipped. It becomes an empty stack carrying the background, the
corner radius, and an explicit `sizing`, which pulls in the `layout.sizing` and
`layout.heightSizing` capabilities. Two cases avoid one entirely:

- A shape covering ≥ 90% of its parent on both axes **merges into that parent's
  background** (unless the parent already has one), with a
  `style.backgroundMerged` warning. Smaller and more faithful than nesting a
  full-bleed sibling.
- A shape with no usable bounding box is **skipped**, because a colour block
  needs an explicit width and height and an unsized empty stack renders as
  nothing. The report says exactly that.

An ellipse is approximated with a corner radius of half its shorter side, with a
`style.shapeApproximated` warning: a circle survives exactly, a wide ellipse
becomes a pill.

Image-filled and vector layers are still skipped from the document -- but their
pixels now travel in the export bundle.

### Multi-frame export

Select several frames and each becomes a screen, in canvas reading order (`x`
first, then `y`); the first is `initialScreenId`. Screen ids come from the
slugified frame names and are de-duplicated (`paywall`, `paywall-2`, …).

Localization keys are namespaced per screen -- `figma.<screen>.<layer>` -- so two
frames with a "Title" layer cannot collide. Screen ids never contain an
underscore, so the derived key segments stay as distinct as the ids they come
from. A **single**-frame export is unchanged: screen id `imported`, flat
`figma.<layer>` keys.

**The protocol requires every screen to be reachable from the initial one**, and
the only edge that exists is a button's `navigateTo`. So each screen's *last*
detected button is repointed from its `close` placeholder at the next screen,
with a `navigation.threaded` warning saying so. Where a frame has no button, the
flow stops: the frames after it are **not exported**, and the report says which
frame ended the flow and what to do about it. Fabricating a navigation button
would put UI in the design that the designer did not draw -- and one that could
not be deleted in Studio without invalidating the document.

## The export bundle

**Download for Studio (with images)** produces `<id>.mosaic-figma.json`. The
document inside is byte-identical to the plain export; the bundle adds the report
and the rendered pixels of every layer the document could not reference.

**This shape is a frozen contract.** A Studio-side importer is written against
it. Any change is a new `formatVersion`, not an edit.

```json
{
  "format": "mosaic.figma-export",
  "formatVersion": 1,
  "document": "<valid protocol 0.4 document, exactly as the plain export>",
  "report": {
    "warnings": [{ "code": "string", "message": "string", "layerPath": "string" }],
    "skipped": [{ "kind": "string", "message": "string", "layerPath": "string" }]
  },
  "images": [
    {
      "id": "<unique identifier-grammar asset id derived from layer name>",
      "name": "<original layer name>",
      "mimeType": "image/png",
      "width": 800,
      "height": 400,
      "scale": 2,
      "bytesBase64": "<PNG bytes, base64, no data: prefix>",
      "placement": {
        "screenId": "string",
        "parentStackId": "string",
        "childIndex": 0
      },
      "accessibilityLabel": "<layer name, trimmed>"
    }
  ]
}
```

Notes on the contract:

- `report.skipped` entries use **`kind`**, which is the mapper's skip reason.
  The report the plugin UI shows carries a Figma node id on every entry too; the
  bundle's projection deliberately does not, because a node id means nothing
  outside the file it came from.
- `images` holds every layer skipped as image or vector, plus every image fill
  dropped from a frame that was otherwise kept. For a dropped fill the placement
  is the frame itself at `childIndex: 0`.
- `placement.parentStackId` / `childIndex` describe where the image node *would*
  have been in reading order, so Studio can insert it there. Indices count only
  the children that were actually emitted.
- Pixels are exported with
  `node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } })`.
  `width` and `height` are the PNG's own pixel dimensions, read out of its IHDR
  chunk rather than multiplied out of the layer's logical size, and `scale` tells
  you how to get back to logical points.
- **Caps.** 4 MB per image and 20 MB per bundle. An image over either is dropped
  from the array and reported as `bundle.imageDropped`. The total is measured on
  the serialised JSON -- including the drop warnings themselves -- so the cap is
  a promise about the file rather than an estimate of it.
- Base64 is encoded by hand. The Figma sandbox has no `Buffer` and does not offer
  `btoa`.

Assembly is pure and unit-tested with injected bytes; only `exportAsync` lives in
`src/main.ts`. Because rendering costs one `exportAsync` per image, it happens
only when you click the button, not on every selection change.

One caveat worth knowing: a frame's dropped *image fill* is rendered by exporting
that frame, which captures its children too. Studio inserting it at `childIndex:
0` will therefore show the frame's own content behind its live content. Re-adding
the fill in Studio is the cleaner fix; the bundle carries it so nothing is lost.

## Limitations

- **Images and vectors are never referenced by the document.** A protocol asset
  needs a bundled or remote source plus a fallback, and a plugin cannot upload
  one, so every export ships `assets: []`. Each such layer is listed in the
  report, and its pixels travel in the [export bundle](#the-export-bundle) with
  the placement Studio needs to insert it. A *container* with children that also
  carries an image fill is kept; only the fill is dropped, with a warning.
- **No products or product selectors.** The protocol's commerce components need
  product references the plugin has no source for, so `products: []` always.
  Plan cards are suggested in the report, never converted. Nothing in an export
  is purchasable until you wire it up in Studio.
- **Every action is a placeholder.** A detected button gets `close`, or
  `navigateTo` when it is threading a multi-frame flow. Neither is a claim about
  what the button should do.
- **Absolute layout is inferred, not reproduced.** The protocol has no absolute
  positioning; rows, gaps, padding, and alignment are read back out of the
  bounding boxes, and overlapping or nested-column layouts do not survive.
  Auto-layout in Figma is always the better input, and the report says so.
- **Hidden layers and empty text layers are skipped**, and reported.
- **Layer names become ids and localization keys**, slugified and de-duplicated.
  Note the two alphabets differ: an id may contain hyphens
  (`hero-title`) and a localization key may not (`figma.hero_title`).
- A **horizontal or empty top-level frame, or one that is itself a button**, is
  wrapped in a synthetic vertical `<screen>-root` stack, because a screen's root
  content must be a vertical stack with at least one child. The original frame
  keeps its own direction one level down.
- **Strokes, effects, blend modes, constraints, and per-corner radii do not
  cross.** Per-corner radii are reported; the rest are silently outside the
  emitted subset.

## Architecture

```
src/main.ts        Figma scene graph -> plain intermediate tree; exportAsync; select-and-reveal
                   (the only file that uses the Figma API)
src/mapper/*       intermediate tree -> Mosaic document + export report (pure, no Figma, unit-tested)
  layout-inference.ts   rows, medians, padding, alignment -- arithmetic over bounding boxes
  detect.ts             button, price, and plan-card heuristics
  capabilities.ts       requiredCapabilities, re-derived for the sandbox
src/bundle.ts      document + report + injected bytes -> the frozen export bundle (pure)
src/base64.ts      Uint8Array -> base64, because the sandbox has neither Buffer nor btoa
src/ui/*           the report as clickable rows, two downloads, Copy to clipboard
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
