# Mosaic Local Preview Contract 0.4

## Status and authority

Local Preview `0.4` is a **draft**, like the Paywall Protocol `0.4` it
accompanies. It carries no compatibility guarantee, nothing produces or
consumes it in production, and it may change without a version bump.
`protocol/compatibility/local-preview/v0.4.json` records `status: "draft"` and
carries no `releaseCandidate` label.

Local Preview `0.3` remains the release candidate, is unchanged by this work,
and remains correct for Paywall Protocol `0.3` drafts. Its schemas, manifest,
and fixtures are byte-identical to what they were before `0.4` existed.

Local Preview is version-locked to the paywall contract: the message schema
`$ref`s the paywall schema URN directly, so a paywall bump *is* a Local Preview
bump. `0.4` retargets that reference to
`urn:mosaic:protocol:schema:v0.4:paywall`.

Canonical artifacts:

- `protocol/schema/local-preview/v0.4/preview-message.schema.json`
- `protocol/schema/local-preview/v0.4/local-project.schema.json`
- `protocol/schema/local-preview/v0.4/compatibility-manifest.schema.json`
- `protocol/compatibility/local-preview/v0.4.json`
- `protocol/fixtures/local-preview/v0.4/session-flow.messages.json`
- `protocol/fixtures/local-preview/v0.4/local-project.json`
- `protocol/fixtures/local-preview/v0.4/accepted-revision-runtime-reset.json`
- `protocol/tools/preview-validation-v0.4.mjs`

## Connection contract

Every peer uses `mosaic.local-preview.v0.4`, and every envelope uses
`previewProtocolVersion: "0.4"`. A local project uses
`fileFormatVersion: "0.4"`. With no supported subprotocol, the relay rejects the
connection rather than translating or downgrading the document.

Negotiation offers `0.4` **ahead of** `0.3`
(`localPreviewVersionPreference` in `protocol/browser/index.js`). A client that
speaks only `0.3` is still served `0.3`: adding a draft version may not strand a
client that has not been rebuilt.

Before Studio sends a draft, the client capability report must:

- include `0.4` in `supportedSchemaVersions`;
- include every document capability at exact version `0.4`;
- include every Local Preview capability at exact version `0.4`; and
- declare a document byte limit large enough for the complete draft.

The Local Preview capability **names** are unchanged from `0.3`
(`preview.liveUpdate`, `preview.mockCommerce`, `preview.localeOverride`,
`preview.textScale`, `preview.diagnostics`). The version is the whole signal: a
client reporting the `0.3` generation of those names has not been rebuilt
against the `0.4` message schema, and the draft is withheld with
`preview.unsupportedPreviewCapability`.

The document capability set follows Paywall Protocol `0.4`: it drops
`style.productCardStates`, which `0.4` removed as a co-derived signal, and adds
`motion.appear`, `motion.selection`, and `motion.loop`. A report that still
advertises `style.productCardStates` is rejected by the validator — the paywall
validator's unused-capability rule cannot catch it, because a capability report
is not a document.

Missing or malformed capability reports withhold the draft atomically. The relay
never fetches media, expands design tokens, or rewrites presentation.

## The entrance-replay suppression rule

> **Normative.** An accepted revision does **not** replay appear motion for any
> screen listed in `motion.playedAppearScreens`.

This is the one behavioural rule `0.4` adds to Local Preview, and it exists
because Local Preview is the one place a paywall document is re-accepted dozens
of times a minute. Without it, a designer nudging padding is strobed once per
keystroke: every accepted revision would replay every entrance in the document.

The accepted-revision runtime state gains a sixth member:

```json
{
  "switches": { "<switchId>": true },
  "tabs": { "<tabsId>": "<tabId>" },
  "carousels": { "<carouselId>": 0 },
  "navigation": { "currentScreenId": "<screenId>", "history": ["<screenId>"] },
  "selectedProducts": { "<selectorId>": "<productCardId>" },
  "motion": { "playedAppearScreens": [] }
}
```

`playedAppearScreens` records which screens have already shown their entrance in
this preview **session**. `[]` is its value for the first accepted revision of a
session: nothing has appeared yet, so every entrance plays.

### Why this member alone survives acceptance

The five `0.3` members all reset from the accepted document, because the
document authors every one of them — a Switch's initial value, a Tabs' initial
tab, a Carousel's initial page, the initial screen, the initial Product Card.
Resetting them is how a preview shows what the *document* says.

`motion.playedAppearScreens` is different in kind: it is the only runtime member
the document does not author. It records what the session has already shown. A
document has no opinion about that and cannot supply one, so there is nothing to
reset it *to* except a lie. It is carried forward instead. The manifest records
this machine-readably as
`revisionPolicy.acceptedRevisionRuntime:
"resetNavigationCarouselSwitchAndSelectionRetainingPlayedAppearScreens"` and
`revisionPolicy.acceptedRevisionAppearMotion: "suppressReplayForPlayedScreens"`.

The carried set is **filtered through the accepted document's screens** and
emitted in that document's screen order:

- a screen the new revision no longer declares cannot have played its entrance
  in it, so it is dropped; and
- deriving the order from the document rather than from the previous runtime
  keeps the answer independent of the order a client happened to record it in,
  which is what makes the fixture comparable byte-for-byte.

The reference implementation is `runtimeStateForAcceptedV04Revision` in
`protocol/tools/validation-v0.4.mjs`. It is a pure function of the accepted
document and the previous runtime, and
`fixtures/local-preview/v0.4/accepted-revision-runtime-reset.json` pins all
three answers: the state before acceptance, the state after it, and the state a
first acceptance produces. The validator additionally refuses a fixture that
would satisfy the rule vacuously — the fixture must carry at least one played
screen the revision keeps and at least one it removed, or the rule has never
been exercised at all.

### What suppression does not change

Suppression is about *replay*, not about what motion means. It does not touch
the terminal-state rule, the reduced-motion contract, or the accessibility tree.
A screen whose entrance is suppressed is drawn in its terminal state, which
Paywall Protocol `0.4` guarantees is byte-identical to the static rendering. A
screen reached for the first time in a session animates normally. `selection`
and `loop` motion are unaffected: neither is a once-per-entry effect, so neither
has anything to suppress.

## Runtime behavior

Document and mock-commerce revisions are ordered independently. A rejected
revision never replaces the last accepted revision. Countdown time is recomputed
from the preview device clock.

The example applications show explicit connecting, waiting-for-design, and
cannot-connect states before the first accepted revision. They do not render a
bundled fallback during a Studio demo.

## Compatibility diagnostics

The message taxonomy, the compatibility-warning `fallback` vocabulary
(`keepLastAcceptedDraft`, `useDeclaredAssetFallback`, `useSelectorFallback`,
`nativeApproximation`), the `recovery` requirement, and the eight structured
delivery diagnostic codes are **unchanged** from `0.3`. See
[Local Preview 0.3](local-preview-v0.3.md#compatibility-diagnostics-and-the-fallback-vocabulary)
for the full table; `0.4` does not restate it, and
`preview-validation-v0.4.mjs` aliases the `0.3` diagnostic-code list rather than
copying it, so the two cannot drift apart while each stays internally
consistent.

One deliberate rename: the manifest's `readerPolicy.portableExchange` is
`rawProtocol04Json`. The `0.3` manifest still spells this value
`rawProtocol02Json`, a name left behind by the `0.2` deletion. `0.4` names the
version it actually exchanges rather than inheriting the misnomer; `0.3` is not
edited, because a released contract is not corrected in place.

## Browser runtime support

`protocol/browser/index.js` reads both generations. The entry points dispatch on
the version a value claims:

| Entry point | Dispatches on |
| --- | --- |
| `validatePaywallDocument`, `parsePortablePaywallJson`, `serializePortablePaywallJson` | `schemaVersion` |
| `validatePreviewMessage` | `previewProtocolVersion` |
| `validateLocalProject` | `fileFormatVersion` |

Anything that is not an explicit `0.4` claim is read as `0.3`, so a value with a
missing, malformed, or unknown version produces exactly the `0.3` diagnostics it
produced before `0.4` existed. `paywallDocumentVersion(value)` exposes the same
decision to callers that need to branch.

`MosaicAnyPaywallDocument`, `MosaicAnyPreviewMessage`, and
`MosaicAnyLocalProject` are unions of both generations, because the reader entry
points genuinely return either. `MosaicPaywallDocument` stays `0.3` and is the
narrow name for callers that want exactly the release candidate.

**Deferred to the Studio preview wave, deliberately:** the browser runtime's
`runtimeStateForAcceptedRevision` does not yet emit the `motion.playedAppearScreens`
member and `paywallRuntimeDiagnostics` still refuses anything that is not a `0.3`
document. Both are runtime-state surfaces consumed by a live preview client, and
Studio's live-preview surface is a later wave; the reference implementation of
the suppression rule is `runtimeStateForAcceptedV04Revision` in
`protocol/tools/validation-v0.4.mjs`, which is what the fixture pins and what
that wave will mirror into the browser runtime. This is an intentional gap, not
an omission: nothing consumes those two entry points on `0.4` yet, and adding a
motion member no client reads would be an unexercised second implementation of a
rule the validator already owns.

## Related documents

- [Protocol 0.4](v0.4.md) — the paywall contract this accompanies.
- [Local Preview 0.3](local-preview-v0.3.md) — the contract `0.4` supersets.
- [versioning.md](versioning.md), [compatibility
  policy](compatibility-policy.md), [fixture
  lifecycle](fixture-lifecycle.md).
