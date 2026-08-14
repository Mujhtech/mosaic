# Mosaic Local Preview Contract 0.4

## Status and authority

Local Preview `0.4` is a **draft**, like the Paywall Protocol `0.4` it
accompanies. It carries no compatibility guarantee, nothing produces or
consumes it in production, and it may change without a version bump.
`protocol/compatibility/local-preview/v0.4.json` records `status: "draft"` and
carries no `releaseCandidate` label.

`0.4` is the **only** Local Preview version. Local Preview is version-locked to
the paywall contract — the message schema `$ref`s the paywall schema URN
directly, so a paywall replacement *is* a Local Preview replacement — and `0.3`
was deleted alongside Paywall `0.3` under the single-version policy in
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md).

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

Negotiation offers exactly one subprotocol
(`localPreviewVersionPreference` in `protocol/browser/index.js` is `["0.4"]`). A
client that speaks anything else is refused with `preview.noMutualVersion` and
Studio keeps its last accepted draft; it is never served a version it did not
offer.

Before Studio sends a draft, the client capability report must:

- include `0.4` in `supportedSchemaVersions`;
- include every document capability at exact version `0.4`;
- include every Local Preview capability at exact version `0.4`; and
- declare a document byte limit large enough for the complete draft.

The five Local Preview capability names are `preview.liveUpdate`,
`preview.mockCommerce`, `preview.localeOverride`, `preview.textScale`, and
`preview.diagnostics`. The reported *version* is the whole signal: a client
reporting an older generation of those names has not been rebuilt against the
`0.4` message schema, and the draft is withheld with
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
>
> **Implementation status (2026-08-14): specified and pinned, not yet read by
> any client.** The reference implementation is
> `runtimeStateForAcceptedV04Revision` in `protocol/tools/validation-v0.4.mjs`
> and the fixture
> `protocol/fixtures/local-preview/v0.4/accepted-revision-runtime-reset.json`
> pins all three states — before, after, and first acceptance. No SDK preview
> reader implements the rule, and the browser runtime's
> `runtimeStateForAcceptedRevision` does not emit the member. A preview client
> built today therefore replays every entrance on every accepted revision. The
> rule states what a conforming reader must do; it does not assert that one
> exists. Tracked in
> [known limitations](../known-limitations.md#the-entrance-replay-suppression-rule-has-no-sdk-reader-implementation).

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
delivery diagnostic codes are **unchanged** from what `0.3` specified. See
[the compatibility policy](compatibility-policy.md) for the full table. The
eight codes are declared once, in `preview-validation-v0.4.mjs`, and the
compatibility manifest is asserted to declare exactly that set.

The manifest's `readerPolicy.portableExchange` is `rawProtocol04Json`. The `0.3`
manifest spelled it `rawProtocol02Json`, a name left behind by the `0.2`
deletion; `0.4` names the version it actually exchanges.

## Browser runtime support

`protocol/browser/index.js` reads exactly one generation. `validatePaywallDocument`,
`parsePortablePaywallJson`, `serializePortablePaywallJson`,
`validatePreviewMessage`, and `validateLocalProject` each validate against the
single registered schema; there is no version dispatch and no
`paywallDocumentVersion`. A value whose `schemaVersion`, `previewProtocolVersion`,
or `fileFormatVersion` is missing, malformed, or anything other than `0.4` is
refused by the schema's version `const`.

`MosaicAnyPaywallDocument`, `MosaicAnyPreviewMessage`, and
`MosaicAnyLocalProject` each name the `0.4` type. They are kept as names so that
a parallel version at GA widens an alias rather than renaming a public symbol.
`MosaicPaywallDocument` names the same type.

`paywallRuntimeDiagnostics` reads `0.4` documents.

**Still deferred to the Studio preview wave:** the browser runtime's
`runtimeStateForAcceptedRevision` does not emit the `motion.playedAppearScreens`
member. It is a runtime-state surface consumed by a live preview client, and
Studio's live-preview surface is a later wave; the reference implementation of
the suppression rule is `runtimeStateForAcceptedV04Revision` in
`protocol/tools/validation-v0.4.mjs`, which is what the fixture pins and what
that wave will mirror. This is an intentional gap, not an omission: nothing
consumes that member yet, and adding one no client reads would be an unexercised
second implementation of a rule the validator already owns.

## Related documents

- [Protocol 0.4](v0.4.md) — the paywall contract this accompanies.
- [versioning.md](versioning.md), [compatibility
  policy](compatibility-policy.md), [fixture
  lifecycle](fixture-lifecycle.md).
