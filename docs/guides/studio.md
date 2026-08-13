# Studio

Studio is the Paywall editor. It runs in two modes:

- **Local Studio** at `http://localhost:3000/studio`: account-free and
  local-first. It needs no session, no account, and no reachable backend.
  Work is autosaved to browser storage.
- **Hosted Studio**: opened from a Paywall Draft inside the dashboard. Same
  editor, backed by hosted Drafts with revision-checked saves.

Studio is desktop-only: displays narrower than 768 px get a safe fallback
screen instead of the editor (export still works there). Supported browsers
are Chrome/Edge 111+, Safari 16.4+, and Firefox 128+.

## Starting local Studio

```bash
cd apps/dashboard
npm run dev:studio
```

This starts the dashboard and the loopback preview relay
(`ws://127.0.0.1:4317/preview`) together. Open
`http://localhost:3000/studio`. In a Compose deployment the dashboard serves
`/studio` as well; the preview relay is a local-development tool.

## Templates

New documents start from a template:

- **Focused offer** — a concise subscription choice with a clear value
  proposition.
- **Benefits first** — leads with product benefits before asking someone to
  choose a plan.

## Canvas editing

The editor provides a component library, a component tree, a live preview
canvas, and a property inspector (layout, background, accessibility, and
product styles), plus a design-system panel and a command palette. Insertable
components:

- Layout: stack, carousel
- Controls: switch, countdown
- Content: text, image, icon, feature list
- Commerce: product selector, button

A mock-commerce panel supplies stand-in Products so you can design without a
connected catalog.

## Validation

The Validation panel checks the document against the canonical Protocol 0.3
schema continuously and lists issues; clicking an issue selects the offending
component. A valid document shows "ready to send to native previews or
export". Hosted publishing runs the same validation server-side.

## Preview on devices

Local Studio streams the document to the example apps over the Local Preview
0.3 relay (`ws://127.0.0.1:4317/preview`, subprotocol
`mosaic.local-preview.v0.3`). Each example app's README documents how to
connect. See [docs/protocol/local-preview-v0.3.md](../protocol/local-preview-v0.3.md).

## Export and import

The Export button downloads the Paywall as raw Protocol 0.3 JSON
(`<id>.mosaic.json`). Import accepts the same format. Exports are exact-version
documents; clients accept only the current protocol version. Local autosave
uses a separate local-project envelope in browser storage and is not the
export format.

## Import a Figma export bundle

The Mosaic Figma plugin exports a bundle file named `<name>.mosaic-figma.json`.
It wraps a Protocol 0.3 paywall document together with the plugin's conversion
report and the PNG bytes for every image layer it translated. Import it through
the same Import control as plain JSON: Studio reads the file's `format` field
and routes it. Plain protocol documents keep their 1 MB limit; bundles carry
image bytes and are allowed up to 20 MB.

Studio never applies a bundle straight away. It opens a review dialog first,
showing:

- **Converted with changes** — layers the plugin translated with a substitution.
- **Not converted** — layers with no Mosaic equivalent.
- **Images** — a preview, name, and pixel size for each image, with a checkbox
  per image. All readable images start selected; an image whose bytes cannot be
  decoded is shown as unreadable and cannot be selected.

What happens on import depends on where Studio is running:

- **Local Studio** imports the document only. There is no project to upload to,
  so the images are listed as not imported. Open a hosted Draft to import them.
- **Hosted Studio** uploads each selected image to the project's managed Assets,
  adds an `imageAsset` entry pointing at the returned HTTPS URL, and inserts an
  image node where the plugin recorded it. An image with an accessibility label
  keeps it; one without is imported as decorative.

Placements are best-effort against the document as it actually is. If the
recorded parent Stack has been removed, or now sits on a different screen, the
image is appended to that screen's root Stack; an out-of-range child index is
clamped. Every such adjustment, and every image that failed to upload, is
reported above the editor after the import is applied.

The document is validated twice: once when the bundle is read, and again after
the images are inserted. If insertion would produce a document that no longer
validates, nothing is applied and the diagnostics are shown in the dialog, so
the open paywall is never replaced by a broken one.

## Verification status

Editor behavior, validation, the sub-768 px fallback, and export are covered
by the dashboard test suite (`npm --prefix apps/dashboard run check`). Device
preview requires running an example app and is exercised manually.
