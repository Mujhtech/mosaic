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

## Verification status

Editor behavior, validation, the sub-768 px fallback, and export are covered
by the dashboard test suite (`npm --prefix apps/dashboard run check`). Device
preview requires running an example app and is exercised manually.
