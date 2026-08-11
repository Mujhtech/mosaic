# Mosaic Local Preview Contract 0.3

Local Preview `0.3` is the local transport and project-file companion to
Paywall Protocol `0.3`. The two versions move in lockstep: the preview message
schema pins `previewProtocolVersion` to the paywall contract version, so a
paywall-contract bump is a Local Preview bump. Local Preview `0.2` was deleted
with Paywall Protocol `0.2`; there is no negotiation path back to it.

Canonical artifacts:

- `protocol/schema/local-preview/v0.3/preview-message.schema.json`
- `protocol/schema/local-preview/v0.3/local-project.schema.json`
- `protocol/fixtures/local-preview/v0.3/session-flow.messages.json`
- `protocol/fixtures/local-preview/v0.3/local-project.json`
- `protocol/fixtures/local-preview/v0.3/accepted-revision-runtime-reset.json`

## Connection contract

Every peer uses `mosaic.local-preview.v0.3`, and every envelope uses
`previewProtocolVersion: "0.3"`. A local project uses
`fileFormatVersion: "0.3"`. With no supported subprotocol, the relay rejects
the connection rather than translating or downgrading the document.

Before Studio sends a draft, the client capability report must:

- include `0.3` in `supportedSchemaVersions`;
- include every document capability at exact version `0.3`;
- include every Local Preview capability at exact version `0.3`; and
- declare a document byte limit large enough for the complete draft.

Missing or malformed capability reports withhold the draft atomically. The
relay never fetches media, expands design tokens, or rewrites presentation.

## Runtime behavior

Document and mock-commerce revisions are ordered independently. A rejected
revision never replaces the last accepted revision. Once a new document is
accepted, Screen/Sheet navigation, Carousel pages, Switch values, **Tabs
selection**, and Product Selector selection reset from that document.
`accepted-revision-runtime-reset.json` pins the complete reset shape:

```json
{
  "switches": { "<switchId>": true },
  "tabs": { "<tabsId>": "<tabId>" },
  "carousels": { "<carouselId>": 0 },
  "navigation": { "currentScreenId": "<screenId>", "history": ["<screenId>"] },
  "selectedProducts": { "<selectorId>": "<productCardId>" }
}
```

`tabs` maps each Tabs component id to its authored `initialTabId`. It is a
separate map from `switches` because tab selection is an identifier, not a
Boolean, and because a visibility condition names which map it reads. Countdown time is recomputed from
the preview device clock.

The example applications show explicit connecting, waiting-for-design, and
cannot-connect states before the first accepted revision. They do not render a
bundled fallback during a Studio demo.

## Compatibility diagnostics and the fallback vocabulary

A preview client reports what it could not render exactly as authored through a
compatibility diagnostic. `fallback` names *what the viewer is actually looking
at* while the diagnostic stands, so Studio can describe the discrepancy instead
of implying the preview is faithful. The vocabulary is closed and pinned by
`preview-message.schema.json` (`$defs.compatibilityWarning.fallback`):

| `fallback` | What the preview is showing |
| --- | --- |
| `keepLastAcceptedDraft` | The revision was rejected; the previous accepted draft is still on screen. Paired with `blocking`. |
| `useDeclaredAssetFallback` | An asset could not be resolved, so the document's own declared asset fallback is rendered. |
| `useSelectorFallback` | A Product Selector could not resolve its authored binding, so its declared fallback selection is shown. |
| `nativeApproximation` | The client rendered the component with the closest native equivalent it has. Geometry, typography, or motion may differ from the authored intent. |

`nativeApproximation` is the honest arm of the set, and the reason it exists:
without it a client that partially supported a component would have to choose
between claiming success and blocking the draft. It is a *declared* compatibility
fallback, not a rendering failure — the preview is usable, but it is an
approximation, and Studio must label it as one. All three SDKs implement the
full vocabulary (`MosaicPreviewCompatibilityFallback` on iOS,
`MosaicPreviewFallback` on Android, `MosaicPreviewCompatibilityFallback` on
Flutter), and Flutter's renderer emits `nativeApproximation` for any non-product
render warning it raises.

`recovery` is required on every compatibility warning, so an approximation
always tells the author what to change. The schema also makes
`nativeApproximation` warning-severity by construction: `severity: "blocking"`
constrains `fallback` to `keepLastAcceptedDraft`, so a client that cannot
approximate at all must reject the revision rather than silently draw nothing.

Portable import/export uses raw Protocol `0.3` JSON. Browser validation and all
native clients accept only the current exact version.
