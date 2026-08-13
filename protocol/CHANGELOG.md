# Protocol changelog

All notable Mosaic protocol changes are recorded here. A contract's artifacts
become immutable when its `status` reaches `approved`; before that, its review
gate may still change them. Every Mosaic contract is `approved` as of v1 GA.

## One version per contract: Authoritative Entitlement v2, Billing State Webhook v2 - 2026-08-13

Status: breaking. Owner ruling, single-version contracts. See
[ADR-0028](../docs/architecture/decisions/0028-single-version-contracts.md).

Authoritative Entitlement and Billing State Webhook each carry exactly one
version, v2. The collapse absorbs everything v1 carried rather than deleting
product surface: v2 is the authority-aware contract plus the v1 surface v2 had
never restated.

### Carried forward into v2

- Authoritative Entitlement: the `entitlementCheckRequest`,
  `entitlementCheckResult`, `subscriptionSnapshot`, and `restoreResult` record
  types (never restated in v2) join the v2 envelope's `recordType` dispatch;
  the v1 snapshot/check/subscription/restore schemas move to
  `protocol/schema/authoritative-entitlement/v2/` under v2 URNs as
  `$defs`-only libraries; `requestedEntitlementKeys` returns to the sync
  request; the v1 snapshot scenario corpus is re-issued as authority-wrapped
  v2 fixtures; state axes, canonical serialization, limits, and the
  fail-closed reader policy (rejection resolves to `unknown`, never
  `inactive`) move into the v2 compatibility manifest.
- Billing State Webhook: the nine reserved v1 event types join the v2
  `eventType` vocabulary (fourteen members); `stateSummary`, `sourceReason`,
  `subscriptionInstanceId`, `projectionRuleVersion`, `isTestSource`, and
  `diagnostics` become optional event members; the delivery-attempt record is
  inlined into the v2 contract schema; signing, limits, producer policy, and
  the consumer obligations (signature-before-parsing, dedup by event ID,
  ordering, snapshot re-read) move into the v2 compatibility manifest. Event
  snapshot-version monotonicity is now scoped to one authority epoch, since a
  rollback opens a new epoch whose versions restart.

### Deleted

- `protocol/schema/authoritative-entitlement/v1/`,
  `protocol/fixtures/authoritative-entitlement/v1/`,
  `protocol/compatibility/authoritative-entitlement/v1.json`
- `protocol/schema/billing-state-webhook/v1/`,
  `protocol/fixtures/billing-state-webhook/v1/`,
  `protocol/compatibility/billing-state-webhook/v1.json`
- `protocol/tools/authoritative-entitlement-validation-v1.mjs` and
  `protocol/tools/billing-state-webhook-validation-v1.mjs` (+ tests); their
  semantics and guards relocate to the unsuffixed
  `authoritative-entitlement-validation.mjs` and
  `billing-state-webhook-validation.mjs`, consumed by
  `phase9c-contract-validation.mjs`
- `docs/protocol/authoritative-entitlement-v1.md`,
  `docs/protocol/billing-state-webhook-v1.md`
- Version fallbacks: `supportedContractVersions` no longer admits `"1"`, and
  the webhook manifest's v1-destination arms
  (`v1Destination`/`readiness`) are gone

## One version per contract: Paywall 0.4, Local Preview 0.4, Delivery v3 - 2026-08-13

Status: breaking. Owner ruling, single-version contracts. See
[ADR-0028](../docs/architecture/decisions/0028-single-version-contracts.md).

While Mosaic has no production usage, every protocol contract carries exactly
one version: the latest. A contract change replaces its version rather than
adding one beside it, and the replaced version is deleted outright along with
every reference, version-dispatch arm, projection, migration path, and version
fallback that named it. Parallel versions begin at GA.

The capability system and the `renderWithoutMotion` enhancement tier are
capability-level mechanisms rather than version debt, and are unchanged.

### Deleted

- `protocol/schema/v0.3/`, `protocol/fixtures/v0.3/`,
  `protocol/compatibility/v0.3.json`
- `protocol/schema/local-preview/v0.3/`,
  `protocol/fixtures/local-preview/v0.3/`,
  `protocol/compatibility/local-preview/v0.3.json`
- `protocol/schema/configuration-delivery/v1/` and `v2/`,
  `protocol/fixtures/configuration-delivery/v1/` and `v2/`,
  `protocol/compatibility/configuration-delivery/v1.json` and `v2.json`
- `protocol/tools/`: `validation-v0.3.mjs` (+ test),
  `preview-validation-v0.3.mjs`, `locale-resolution-v0.3.mjs` (+ test),
  `delivery-validation-v1.mjs` (+ test), `delivery-validation-v2.mjs` (+ test),
  `generate-delivery-fixtures-v1.mjs`, `generate-phase5-fixtures.mjs`
- `docs/protocol/v0.3.md`, `docs/protocol/local-preview-v0.3.md`,
  `docs/protocol/configuration-delivery-v1.md`,
  `docs/protocol/configuration-delivery-v2.md`,
  and the whole of `docs/protocol/migration/`
- The v2 -> v1 and v3 -> v2 Configuration Delivery projections, their fixtures,
  and the reader policy entries that described them.

### Relocated

- `protocol/tools/validation-v0.3.mjs` -> `paywall-document-rules.mjs`, with
  every `V03`/`v03` symbol renamed to an unsuffixed one. The module holds the
  rules the paywall contract carries at every version; `validation-v0.4.mjs`
  layers only what motion adds. The `style.productCardStates` derivation was
  removed and the motion derivation folded in, so there is one capability
  derivation rather than a base and a delta.
- `protocol/tools/locale-resolution-v0.3.mjs` -> `locale-resolution.mjs`.
- `protocol/tools/delivery-v1-common.mjs` -> `delivery-common.mjs`.
- `protocol/fixtures/v0.3/rating-announcement.json` and `locale-resolution.json`
  -> `protocol/fixtures/v0.4/`. Both are version-neutral cross-SDK corpora that
  0.4 consumes and never duplicated.
- The Local Preview negotiation and draft-delivery decision moved from
  `preview-validation-v0.3.mjs` into `preview-validation-v0.4.mjs`.

### Re-pinned

Configuration Delivery `3` now carries Paywall Protocol `0.4`:

- `paywallVersion.protocolVersion`: `const "0.3"` -> `const "0.4"`
- `protocolCompatibility.version`: `const "0.3"` -> `const "0.4"`
- `paywallVersion.document`: `$ref urn:mosaic:protocol:schema:v0.3:paywall` ->
  `urn:mosaic:protocol:schema:v0.4:paywall`
- capability request `supportedPaywallProtocol.version` and
  `supportedCapability.version`: `const "0.3"` -> `const "0.4"`, with the
  capability-name `$ref` following
- `compatibility/configuration-delivery/v3.json`: `supportedPaywallProtocols`
  `["0.3"]` -> `["0.4"]`; `legacyProjectionFixture` and
  `readerPolicy.legacyProjection` removed

The v3 release and capability-request schemas inlined the `$defs` they had been
borrowing from v1, so v3 is self-contained.

This is what makes `0.4` deliverable. The backend refusal gates that existed
only because delivery structurally pinned `0.3` are removable, and the
publish-time projectability check that Paywall `0.4` flagged as unimplemented is
no longer required at all.

### Browser package

`parsePortablePaywallJson` and `validatePaywallDocument` accept `0.4` only; the
`schemaVersion` dispatch and `paywallDocumentVersion` are gone.
`MosaicAnyPaywallDocument` is the `0.4` type, `MosaicPaywallDocument` follows,
and `paywallRuntimeDiagnostics` now works on `0.4`. `paywallSchemasByVersion`,
`canonicalSchemasByVersion`, `previewMessageTypesByVersion`,
`paywallV04ContractVersion`, and `paywallV04CapabilityNames` are removed;
`paywallContractVersion` is `"0.4"` and `capabilityNames` is the `0.4` enum.
Local Preview negotiation offers exactly one subprotocol. Generated declarations
carry `MosaicPaywallV04*`, `MosaicPreviewV04*`, `MosaicConfigurationDeliveryV3*`,
`MosaicExperimentAssignmentV1*`, and the v2 commerce types only.

### Figma plugin

`packages/figma-plugin` emits `schemaVersion: "0.4"` with capabilities derived
at `version: "0.4"` and an empty `designSystem.motions` catalog. A Figma frame is
a static composition, so no motion is authored, which is valid.

## Commerce Provider, Commerce Configuration, and Analytics Event are v2-only - 2026-08-13

Status: breaking. Owner ruling, single-version contracts.

While Mosaic has no production usage, every protocol contract carries exactly
one version: the latest. Commerce Provider Contract `1`, Commerce Configuration
`1`, and Analytics Event Contract `1` are deleted outright, along with every
reference, version-dispatch arm, and reader fallback that accepted them beside
`2`. There is no migration path; a `1` document is an unknown version to a `2`
reader and is rejected atomically.

### Deleted

- `protocol/schema/{commerce-provider,commerce-configuration,analytics-event}/v1/`
- `protocol/fixtures/{commerce-provider,commerce-configuration,analytics-event}/v1/`
- `protocol/compatibility/{commerce-provider,commerce-configuration,analytics-event}/v1.json`
- `protocol/tools/{commerce-provider,commerce-configuration,analytics-event}-validation-v1.mjs` and their tests
- `protocol/tools/generate-phase7-contracts.mjs`, which derived the Analytics
  Event v2 schemas and manifest by patching the v1 ones. Those v2 artifacts are
  now canonical committed source rather than generated output, and
  `generate:phase7-contracts` is gone from `npm run generate`.
- `docs/protocol/{commerce-provider,commerce-configuration,analytics-event}-v1.md`
- `docs/protocol/migration/{commerce-provider,commerce-configuration}-v1-to-v2.md`,
  `docs/protocol/migration/analytics-event-v1-to-v2.md`

### Re-pinned

- Analytics Event v2 `$defs/context/configurationDeliveryVersion`: `["1","2","3"]` to `["3"]`.
- Analytics Event v2 `$defs/context/commerceProviderContractVersion`: `["1","2"]` to `["2"]`.
- Analytics Event v2 compatibility manifest: `readerPolicy.olderContractVersion`
  (`"acceptAlongsideV2"`) deleted from the manifest and from its schema's
  `properties` and `required`. Accepting `1` beside `2` is a version fallback.

### Moved

- The version-neutral Analytics Event reporting helpers (`describeSchemaError`,
  `schemaErrors`, `focusedEventSchemaErrors`) moved from
  `analytics-event-validation-v1.mjs` to the unsuffixed
  `protocol/tools/analytics-event-rules.mjs`.

## Paywall Protocol 0.3 replaces 0.2 - 2026-08-06

Status: release candidate (RC1). Breaking. Owner decision, recorded explicitly
in ADR-0026.

`0.3` is **not approved and not immutable**. The cross-platform
implementability gate cannot have passed: the Flutter, SwiftUI, and Jetpack
Compose renderers for the four new components are being written now, and Studio
cannot yet author them. Local Preview `0.3` is a release candidate for the same
reason -- it is version-locked to this contract. The outstanding approval gates
are enumerated in `docs/protocol/v0.3.md`. Narrowing corrections that the
renderer work surfaces are still permitted, and this is the only state in which
they are.

**Paywall Protocol `0.3` replaces `0.2` outright. `0.3` does not support `0.2`,
there is no migration path, and every `0.2` artifact is deleted from the tree.**

This is not a deprecation. `0.2` was not marked `deprecated` with a retirement
date, and no reader accepts both versions: a `0.2` document is an unknown
version to a `0.3` reader and is rejected atomically, resolving through
last-accepted, then bundled fallback, then configuration unavailable. Mosaic is
pre-release; a second live paywall contract would be redundant compatibility
code, and redundant compatibility code is a liability. This mirrors the earlier
decision to delete the RC-to-RC migrator rather than keep it.

### Deleted

- `protocol/schema/v0.2/` (paywall + compatibility manifest)
- `protocol/schema/local-preview/v0.2/`
- `protocol/compatibility/v0.2.json`, `protocol/compatibility/local-preview/v0.2.json`
- `protocol/fixtures/v0.2/`, `protocol/fixtures/local-preview/v0.2/`
- `docs/protocol/v0.2.md`, `docs/protocol/local-preview-v0.2.md`

### Renamed

`tools/validation-v0.2.mjs` -> `validation-v0.3.mjs`,
`tools/preview-validation-v0.2.mjs` -> `preview-validation-v0.3.mjs`,
`tools/locale-resolution-v0.2.mjs` -> `locale-resolution-v0.3.mjs`, with their
test files. Every `V02`/`v02` symbol in `protocol/browser/` and
`protocol/tools/` is now `V03`/`v03` (`validateProtocolV02` ->
`validateProtocolV03`, `MosaicPaywallV02Document` ->
`MosaicPaywallV03Document`, and so on). The browser contract and all derived
fixtures were regenerated.

Configuration Delivery `1`/`2`/`3` are **not** renumbered. They embed paywall
documents, so their `protocolVersion` / `paywallProtocols[].version` constants
and their `urn:mosaic:protocol:schema:v0.2:paywall` references now name `0.3`.
Collapsing or renumbering the delivery contracts themselves is a separate
decision nobody has made.

### Carried forward unchanged

Every `0.2` component, action, layout rule, design-token rule, localization
rule, locale-resolution behaviour, capability, reader policy, and normalized
outcome. `0.3` is `0.2` plus four components; nothing was removed or
re-specified. `releaseCandidate` restarts at `RC1` because `0.3` replaces `0.2`
rather than succeeding it.

### Added: four components

- **`tabs`** - N labelled panels, one visible at a time. Two through eight
  entries, each with an id, a localized label, and a content Stack. Required
  authored `initialTabId` (no positional default: reordering the array must not
  change which panel opens). Default/Selected styles use the same recursive
  overlay as Product Card, now expressed through neutral `selectionStyles` /
  `selectionStateStyle` / `selectionStateStyleOverride` definitions that
  `productCardStyles` aliases. `selectedLabelColor` is required rather than
  optional, so "the label colour deliberately does not change" and "the label
  colour was never authored" cannot share an encoding. Exposed as
  tablist/tab/tabpanel, with the tab label naming both its control and its
  panel.
- **`timeline`** - two through twelve ordered entries, vertical only
  (`orientation` is a required `"vertical"` constant, following the Scroll
  Container `axis` precedent). Closed three-arm marker union: `dot`, `ordinal`,
  `icon` over the existing icon vocabulary. Required `connector` with colour,
  width, and `solid`/`dashed` style.
- **`award`** - localized title, optional subtitle (mutually
  `dependentRequired` with `subtitleTypography`), optional emblem as a closed
  union over the existing image-asset and icon vocabularies. The emblem is
  always decorative because the title carries the meaning.
- **`socialProof`** - required localized quote and attribution, optional
  integer-only bounded rating, optional avatar image asset. `value` counts
  steps rather than points against a `whole`/`half` `step` and a `1...10`
  `maximum`, with a semantic rule rejecting `value > maximum x stepsPerPoint`;
  integers throughout so four runtimes cannot round a fraction four ways.
  Aggregate statistics ("2M+ users") are deliberately **not** a variant here -
  they are Text. `docs/protocol/v0.3.md` argues both decisions.

`featureList` was reviewed and deliberately left unchanged; the assessment and
the two deferred gaps are recorded in `docs/protocol/v0.3.md`.

### Added: tab selection as runtime state

Runtime state gains a `tabs` map alongside `switches`, `carousels`,
`navigation`, and `selectedProducts`:

```json
{ "tabs": { "<tabsComponentId>": "<selectedTabId>" } }
```

`visibility` gains a third conditional mode:

```json
{ "mode": "tab", "tabsId": "billing-tabs", "equals": "billing-tabs-annual" }
```

with the same remove-from-layout-accessibility-and-focus semantics as a false
Switch condition. Four rules reject atomically: the Tabs component must be on
the same screen, the tab must be one it declares, the referencing node must not
be the Tabs component, and the referencing node must not be a descendant of it.
The last has no Switch analogue - inside a panel the condition is already
decided, so it is either vacuously true or unsatisfiable, and both are dead
layout.

`evaluateVisibility` / `evaluateV03Visibility` now take a
`{ switches, tabs }` selection state rather than a bare switch map, and
**throw** when a condition names a controller the supplied state does not
carry. Resolving it instead would read back as `false`, which is a component
that silently disappears rather than a caller that is told it has a bug.

### Added: five capabilities

`component.tabs`, `component.timeline`, `component.award`,
`component.socialProof`, `condition.tabVisibility`. All exact-version,
`fallback: "rejectDocument"`, and derived only when the corresponding feature
occurs.

### Narrowing corrections after Android adoption (2026-08-06)

Two gaps that Android's first `0.3` adoption exposed, corrected under the RC
narrowing doctrine before approval. Both were visible cross-renderer divergence,
and iOS and Flutter were mid-implementation.

**The Social Proof rating announcement was specified incorrectly.** The contract
document said to announce "*value* out of *maximum*", but `value` counts steps
and `maximum` counts points, so a four-and-a-half-of-five rating
(`value: 9, maximum: 5, step: "half"`) announced as "9 out of 5". Corrected:

- the announced quantity is `value / (step === "half" ? 2 : 1)`, exact and never
  rounded;
- the phrasing comes from a new **reserved localization key**
  `mosaic.a11y.rating` with the closed placeholders `{{ rating.value }}` and
  `{{ rating.maximum }}`, each required exactly once per translation. A renderer
  must not compose "out of" or any other connective in any language;
- substituted numerals are locale-independent (ASCII digits, `.` separator, no
  grouping, one fraction digit only for a half step) so that three renderers
  produce identical bytes. Locale-aware numerals are deferred;
- `protocol/fixtures/v0.3/rating-announcement.json` pins the complete expected
  string for ten cases and is reconciled by `npm run validate` against a
  declared floor.

**Reserved accessibility strings are now a protocol concept.** This also settles
the `accessibility.inProgress` question the fallback audit left open. Two keys,
`mosaic.a11y.rating` and `mosaic.a11y.in_progress`, are consumed by the protocol
rather than referenced by a component; each is required exactly when the
document contains the feature that announces it and forbidden otherwise, and
both directions are enforced. They exist because the audit found hardcoded
English shipping to production on two platforms. New capability
`accessibility.reservedStrings`.

**Timeline connector geometry at the sequence ends is now specified.** The
connector is one continuous run in a leading gutter, drawn first with markers
over it — which is why an absent interior marker leaves it unbroken without a
special case. At each end independently: a terminal entry **with** a marker
starts or ends the connector at that marker's centre; a terminal entry
**without** one starts or ends it at that entry's content-box edge. Top and
bottom are physical and never mirror under RTL.

### Rulings from Studio adoption (2026-08-06)

**The capability-derivation surface is now exported rather than mirrored.**
Studio was hand-maintaining copies of the capability ordering, the colour-field
table, and the reserved-key table across a package boundary — the same drift
class already found between the validator and the browser capability tables, and
one that surfaces as a delivery rejection rather than a type error.
`protocol/browser/index.js` now exports `expectedDocumentCapabilities`,
`requiredCapabilitiesFor`, `capabilityNames`, `capabilityByComponentType`,
`colorFieldNames`, `usesColor`, and `paywallContractVersion`, alongside the
already-exported `reservedAccessibilityKeys`, `ratingPoints`,
`ratingMaximumPoints`, and `resolveRatingAnnouncement`. All are declared in the
generated `browser/index.d.ts`. The internal derivation consumes the exported
values, and a test pins each export against the code that reads it: an exported
colour field the predicate does not consult, or an ordering that diverges from
the schema enum, fails the gate.

**Tabs requires no style capability for its two states.** `styles` is required
on `tabs`, so `component.tabs` already means "can render authored Default and
Selected tab appearance" — a `style.tabStates` capability would be present in
exactly the documents where `component.tabs` is present, and a negotiation
signal that can never vary independently carries no information. A renderer
supporting Product Card states but not Tab states is distinguished by declaring
`component.productCard` and omitting `component.tabs`. Sharing the
`selectionStyles` definitions states that the components have the same style
contract, not that they share a capability.

`style.productCardStates` is, by the same reasoning, a legacy signal exactly
co-derived with `component.productSelector` / `component.productCard` /
`component.productBadge`. It is retained rather than removed, because removing
it would churn four teams mid-implementation for no behavioural gain, and a test
now pins its exact co-derivation so it cannot quietly acquire a second meaning.
It is a candidate for removal in `0.4`.

### Accessibility composition rulings (2026-08-06)

Flutter's adoption surfaced two more instances of the under-specified-composition
class. The earlier sweep missed them because they are about how renderers
**combine** strings, not about the strings themselves.

**Announced segments are never joined.** Flutter joined a component's segments
with `". "`; Android and iOS were about to pick differently. `". "` is
renderer-invented punctuation in exactly the way a hardcoded "out of" is a
renderer-invented word, and it is wrong outside Latin script — Chinese ends
sentences with `。`, Arabic uses `،`, Thai uses no mark, Devanagari uses `।`.
Ruled: each announced segment is its own accessibility element inside a
container labelled by the component's authored `accessibility.label`, in a fixed
order, with the platform supplying any pause. `separator` is `null` by contract.
Order is `rating`/`quote`/`attribution` for Social Proof, `title`/`subtitle` for
Award, and per-entry `title`/`description` list items for Timeline. An absent
optional segment produces no element at all, never an empty one. Avatars,
emblems, markers, and connectors are decorative and never announced.

**A busy Button carries its state as a value, not in its name.** Flutter
announced `mosaic.a11y.in_progress` as the semantic value leading the visible
in-progress content; Android read it as the state description; iOS was
unspecified. Ruled: a Button is one accessibility element whose name is its
authored `accessibility.label` and **does not change** when it becomes busy — a
control whose name changes mid-operation is disorienting and breaks automation
that located it by name. The busy state is the control's value
(`accessibilityValue` on iOS, `stateDescription` on Compose, `Semantics(value:)`
on Flutter). `children` and `inProgressChildren` are never announced separately.
Because the state occupies a distinct property rather than being concatenated,
the leading-or-trailing question disappears.

`protocol/fixtures/v0.3/accessibility-announcement.json` pins eleven cases
covering all four components, both Button states, both sides of every optional
segment, and three catalogs including RTL, reconciled against the reference
implementation with a declared floor. New exports:
`accessibilityAnnouncement` and `resolvedCatalogStrings`.

### A mechanical check for guards that cannot fail (2026-08-06)

Five sightings of one defect class on one branch: conformance corpora reporting
success over zero cases; the validator and browser capability tables drifting
apart; Flutter's `x !== V && x !== V` left behind by a collapsed version alias;
a corpus-floor test asserting `cases.length >= FLOOR` against the constant the
implementation already compares, so lowering the floor satisfied both. Manual
review missed all of them.

`tools/check-guard-vacuity.mjs`, wired into `npm run validate` and available as
`npm run check:guards`, is the mechanical part. Three narrow textual rules over
`protocol/`'s own JavaScript: a condition whose operands repeat; an exported
`validate*` function that walks a corpus without ever comparing its size; and a
test asserting a corpus length against a floor constant, which cannot fail while
the implementation enforcing the same inequality is green.

**It found a fifth instance on its first run.**
`validateCommerceProviderV1Artifacts` and its v2 twin reported zero errors over
an emptied fixture array — a corpus that failed to load read as perfect
conformance. Both now declare a floor and carry a shrink-the-corpus test.

Its own test writes probe files and asserts each rule both fires and stays quiet
on correct code, because a lint that stops firing is the class it exists to
catch. Two false-positive shapes are pinned deliberately: distinct
single-character literal comparisons (`c === "(" || c === "["`), and a corpus
count captured into a variable before being compared.

**Not covered**, and documented in the script rather than implied: cross-file
table duplication is not textually detectable and is prevented structurally
instead, by exporting the derivation surface from one place with a test pinning
each export against the code that reads it; whether a floor is set to a number
that *means* anything stays a human judgement; and none of this extends to
Kotlin, Swift, Dart, or Go, which have their own linters.

### No-fallback discipline

Every new optional field states what its absence means, and no absence is a
masked default. Timeline `markerColor`, `markerSize`, and
`descriptionTypography` are required when an entry consumes them and
**forbidden** when none does - both directions enforced, so a value nothing
reads cannot survive a redesign. The Social Proof rating bound, the Timeline
co-presence rules, and the new corpus floor were each verified by breaking them
and watching the suite fail.

`validateRejectionLayers` now enforces a declared per-corpus case-count floor
(`fixtures/v0.3/invalid` declares 12) and fails any registered corpus that holds
zero fixtures. A corpus that has silently emptied reconciles perfectly against a
recorded map of zero fixtures and reports success over nothing; that is the
defect the 2026-08-05 entry above found in the analytics and decision corpora,
and it does not get to recur in a new one.


## Corpus floors and strict localization in the references - 2026-08-05

Status: housekeeping

No schema, manifest, or fixture changed. An adversarial re-read of the
fallback-audit remediation found the same defect class inside the remediation
itself, in the tooling that is supposed to prove the rulings hold:

- **Every cross-SDK corpus loop reported perfect conformance over zero cases.**
  `validateDecisionV1Artifacts` and `validateLocaleResolutionV02Artifacts` both
  iterate their corpora and return no errors, so a corpus that was truncated,
  emptied, or renamed out from under the loop was indistinguishable from one
  that passes. Both now declare a case-count floor (34 evaluator cases, 3
  rollout vectors, 9 invalid fixtures, 13 locale-resolution cases) and require
  unique case names, so shrinking a corpus has to be a deliberate edit rather
  than a silent pass.
- **`resolveLocaleCatalogV02` defaulted a malformed `localization.locales` to
  `{}`.** A document that never passed schema validation therefore got the same
  answer as a well-formed document requesting an undeclared locale — "no
  candidate resolves" — and the chain's terminal guarantee that the default
  locale always resolves was silently gone. The reference now raises a typed
  `LocaleResolutionError` (`invalid_localization`, `no_declared_catalogs`,
  `missing_terminal_locale`), matching the `DecisionEvaluationError` posture the
  Placement evaluator already takes for unvalidated documents.
- The two reference normalizers are documented as sharing one rule but are two
  implementations in two files. A test now pins their agreement across the
  runtime input shapes, so neither can be corrected while the other is left
  behind and targeting and catalog lookup quietly diverge.

## Presence and unusable-value rulings, third round - 2026-08-05

Status: housekeeping

No schema or compatibility manifest changed. Three more unfixtured Placement
Decision `1` divergences were ruled and pinned, all in the same hazard class:
an evaluator that answers "no" where it should answer "cannot decide" produces a
positive match under negation.

- **`context.country` now follows the uniform presence rule.** An unrecognized
  country is present with unknown comparisons instead of absent. The asymmetry
  was not deliberate: closedness of a value set does not imply absence anywhere
  else in this contract — an out-of-set `device.platform` has always been
  present with unknown comparisons — so country was the sole outlier against a
  rule the contract already applies to locale, both version sources, and
  platform. Reference change in `tools/placement-decision-validation-v1.mjs`;
  4 rules and 6 cases pin invalid and absent country against `exists`,
  `does_not_exist`, `equals`, and `not_equals`.
- **An out-of-set closed-vocabulary value compares unknown, never false.** The
  reference already behaved this way; it is now pinned under both a direct and a
  negated condition, which is the case that distinguishes unknown from false.
- **An authored locale operand with no canonical form makes `equals`,
  `not_equals`, `in`, and `not_in` unknown**, extending the `locale_matches`
  ruling to the direct-comparison operators. A single unusable list member makes
  the whole `in`/`not_in` condition unknown even when another member matches: the
  list is a defective authored value, and partial evaluation would decide a Rule
  on half of what its author wrote.

## Locale-semantics clarifications, second round - 2026-08-05

Status: housekeeping

No schema or compatibility manifest changed.

- Both reference normalizers (Placement Decision `1` and Paywall Protocol `0.2`
  catalog lookup) now cut the value at the first `@`, `.`, or `#` before
  canonicalizing, so the ICU identifier shapes hosts actually report —
  `en_US@rg=gbzzzz`, `en_US.UTF-8`, and Java `Locale.toString`'s
  `en_US_#u-rg-gbzzzz` — denote `en-US` instead of failing the subtag grammar.
  This is the same runtime-input clarification as the singleton truncation, and
  the SDK helpers already behaved this way; the reference was the strict one.
- Ruled that catalog lookup recovers the leading language subtag when the whole
  tag cannot be canonicalized (`en-US-verylongsubtag` → `en`), and that
  Placement targeting does **not**. The asymmetry is deliberate and documented:
  recovery in targeting would change which users match a Rule, while in lookup
  the chain would otherwise fall through to the document's own fallback.
- Ruled three previously unfixtured Placement evaluator semantics and pinned
  each with conformance cases: a host-supplied locale that cannot be normalized
  is **present** (`exists` true) and compares unknown; an authored range that
  cannot be normalized makes `locale_matches` **unknown**, never false (pinned
  under both a direct and a negated condition, which is what distinguishes
  unknown from false); and the range grammar has **no `*` wildcard**, so no
  implementation should carry a wildcard branch.
- Stated that the locale-resolution corpus's `expectedCandidates` is normative
  for lookup order only, not for public API shape, so bindings that expose the
  full ordered list and bindings that expose only the declared subset are both
  conformant.
- **Declined**: a Studio-side authoring warning for a locale operand carrying a
  singleton subtag. `warningPolicy` in
  `compatibility/placement-decision/v1.json` is a closed object whose schema
  (`additionalProperties: false`) declares exactly two warning kinds, both
  pinned to `warn`. Emitting a third kind would make the validator's behaviour
  undescribed by the approved manifest clients negotiate against, which is a
  manifest change and therefore a version bump. The authoring guidance is
  better placed in Studio's own client-side lint, which needs no contract
  change, and the underlying semantics are harmless: an authored singleton now
  compares on its core exactly as a runtime tag does.

## Locale-semantics clarifications from the cross-SDK defect sweep - 2026-08-05

Status: housekeeping

No schema or compatibility manifest changed. Three questions raised by the
cross-SDK locale sweep were ruled on, and the two rulings that are
clarifications were implemented reference-side:

- Placement Decision `1`: `application.locale` normalization now drops empty
  subtags and truncates at the first singleton subtag, so a host-supplied
  `en-US-u-rg-gbzzzz` evaluates `equals`/`in`/`locale_matches` as `en-US`
  instead of matching nothing. This is a runtime-input clarification, not an
  authored-grammar change: the comparable identity of a locale was always its
  language-script-region core, extension subtags were never described by the
  normalization rule, and the evaluator now agrees with the normalization every
  SDK already applies at its locale boundary. Four cases were added to
  `fixtures/placement-decision/v1/evaluator-conformance.json`.
- Paywall Protocol `0.2`: requested-locale matching against localization catalog
  keys is case-insensitive — a renderer canonicalizes the requested tag to the
  authored grammar's casing (and to the same canonical form Placement targeting
  uses) before an exact lookup. Added a reference implementation
  (`tools/locale-resolution-v0.2.mjs`), a cross-SDK corpus
  (`fixtures/v0.2/locale-resolution.json`), and the localization section of
  `docs/protocol/v0.2.md`.
- Paywall Protocol `0.2`: adding a language+region reduction step to the
  candidate chain (`zh-Hans-CN` → `zh-CN` before `zh`) was **rejected** for
  `0.2`. It changes a step the contract already defines and would silently move
  shipped devices between two declared catalogs. Recorded under "Protocol" in
  `docs/known-limitations.md` and deferred to the next Paywall Protocol version,
  where it belongs together with script-aware catalog keys.

## Fallback-audit remediation in validators and tools - 2026-08-03

Status: housekeeping

No schema, manifest, or fixture changed. Six silent-fallback defects found by
the 2026-08-02 fallback audit were closed in the validation tools, where the
guard belongs:

- Authoritative Entitlement `1`: an absent, renamed, or empty `readerPolicy` now
  fails validation instead of defaulting to `{}` and letting the "no reader
  policy may resolve to inactive" invariant hold over nothing. The invariant's
  string check is also camel-case aware, so a spelling such as
  `resolveWheneverInactive` no longer passes on the `never` lookbehind.
- Billing State Webhook `1` and `2`: the consumer's `ignore` arms are the only
  tolerant reader policy in the protocol, and are safe solely because the
  consumer re-reads the authoritative snapshot. The validators now pin
  `consumerTolerance.authoritativeState` / `consumerPolicy.authoritativeState`
  exactly, and both contract documents state the consumer conformance rules
  normatively.
- Placement Decision `1`: a rule set that declares QA override windows now
  requires `context.now` (typed `DecisionEvaluationError`, code `now_required`)
  rather than assuming the Unix epoch and silently closing every window. An
  unresolvable fallback key raises `unknown_fallback_key` naming the key instead
  of a bare `TypeError`.
- Paywall Protocol `0.2`: an unparsable countdown `endsAt` now throws on both
  the Node and browser copies, matching the invalid-clock branch, instead of
  returning `completed: false` with `NaN` remaining. An opaque colour literal
  that cannot be parsed raises `productCard.contrastNotEvaluated` rather than
  skipping the contrast check silently; semantic tokens and translucent literals
  remain legitimate skips.
- Local Preview `0.2`: the `nativeApproximation` compatibility fallback is
  documented. It is a declared schema value implemented by all three SDKs, not
  dead vocabulary.

## Removed retired RC candidate migrators - 2026-08-02

Status: housekeeping

The candidate-to-candidate recovery tools `migrate-v0.2-rc2-to-rc3` and
`migrate-v0.2-rc3-to-rc4`, their browser-runtime twins
(`migrateV02RC2CandidateToRC3` / `migrateV02RC3CandidateToRC4`), the generated
RC candidate types, and the dashboard's legacy-import recovery path were
removed. RC4 is the sole in-tree Paywall Protocol `0.2` candidate; documents
that do not match the current contract are rejected rather than migrated. This
also removes the migrator defect where an unmatched
`initiallySelectedProductReferenceId` silently produced a schema-invalid
document with an absent required `initialProductCardId` and empty diagnostics.

## Phase 9C: durable source pulls and operator affordances - 2026-07-29

Status: draft

Billing Migration Operations `1` remains draft and gains two additive record
types before approval:

- `sourcePullJob` freezes the durable `sourcePull` command, snapshot/delta/final
  delta intent, idempotency and expected-state preconditions, exact delta
  cursor/watermark binding, closed lifecycle, and digest-bound result
  references. Final-delta evaluation is automatically queued when its
  provider-validation import completes; no separate public command exists.
- `operatorCapabilities` returns the closed command-specific affordance set for
  an actor and program state. Backend authorization remains authoritative.

Canonical valid/invalid fixtures and source-pull compatibility vectors pin the
conditional requirements and forbid unknown capability strings.

The draft repair contract is also aligned with its execution semantics. Repair
kinds use the canonical `provider_revalidate`, `projection_replay`,
`attach_proven_alias`, `replace_mapping_set`, and
`retry_quarantined_record` vocabulary. Execution status is closed to `pending`
and `completed`; pending keeps the durable reservation unsettled and cannot
claim a result or `afterDigest`, while completed execution carries exactly one
of the terminal `succeeded`, `failed`, or `no_change` results.

## Phase 9B: three draft contracts for authoritative entitlements - 2026-07-28

Status: draft

No change to any approved contract. Three new contracts, each born `draft` per
owner decision OD-15, each carrying no compatibility guarantee, and none of them
adding a required reference to anything in the approved v1 GA set.

- **Authoritative Entitlement `1`** — what access a Billing Customer has and
  why. Five schemas, seven record types, four state axes plus uncertainty, a
  pinned canonical serialization with content digests that bind a snapshot to one
  customer, Project, and Environment, bounded-grace freshness, and the normative
  reader rule that **any rejection yields `accessState: unknown` and preserves
  the cache, never `inactive`**. 37 canonical fixtures, 27 invalid.
  [Contract changelog](authoritative-entitlement/CHANGELOG.md) ·
  [documentation](../docs/protocol/authoritative-entitlement-v1.md).
- **Customer Access Token `1`** — how an SDK proves it may read one customer's
  entitlements. Opaque `mcat_` tokens stored as SHA-256 digests, an
  owner-approved deviation from the orchestration prompt's "signed" wording
  (OD-14), with the header names finalized as contract-owned: the customer token
  in `Authorization: Bearer`, the public SDK key in `Mosaic-SDK-Key`. 6 canonical
  fixtures, 9 invalid. [Contract changelog](customer-access-token/CHANGELOG.md) ·
  [documentation](../docs/protocol/customer-access-token-v1.md).
- **Billing State Webhook `1`** — the minimal slice approved as OD-1(b): ten
  event types declared, one emitted, HMAC-SHA256 signing over
  `signingVersion.timestamp.eventId.rawBody`, at-least-once delivery, and
  operator-facing attempt history that is never transmitted. 13 canonical
  fixtures, 8 invalid.
  [Contract changelog](billing-state-webhook/CHANGELOG.md) ·
  [documentation](../docs/protocol/billing-state-webhook-v1.md).

Supporting changes:

- Four new cross-implementation reference-vector families in
  `packages/test-fixtures/src/`: snapshot digest, cache decision, freshness, and
  webhook signature. Digests and signatures are computed by build scripts and
  never hand-edited; drift against the canonical fixtures and against the
  manifests' pinned limits is checked by the protocol test suite.
- `docs/protocol/compatibility-policy.md` records two new normative sections:
  "Unknown access is never inactive", and the owner-approved producer/consumer
  tolerance asymmetry for webhooks (OD-16) as an **explicit documented
  exception** to the repo-wide fail-closed doctrine.
- `tools/generate-rejection-layers.mjs` gains a reusable union-probe helper and
  registers the three new `invalid/` directories.
- `tools/validate.mjs` registers the three new load/validate pairs.
  `generate-browser-contract.mjs` is untouched: these contracts are server- and
  SDK-facing and are deliberately not generated into the browser contract.

## v1 General Availability: all contracts approved - 2026-07-27

Status: approved

Contract approval (D2). No wire-format change to any accepted document; every
contract identifier is unchanged.

- Flipped all 13 compatibility manifests to `status: "approved"`: Paywall
  Protocol `0.2`, Local Preview `0.2`, Configuration Delivery `1`/`2`/`3`,
  Placement Decision `1`, Experiment Assignment `1`, Analytics Event `1`/`2`,
  Commerce Provider `1`/`2`, and Commerce Configuration `1`/`2`. Approved
  contracts are immutable; behaviour changes now require a new contract version.
- Widened every manifest schema, **before** the approval flip, so the lifecycle
  is expressible after the one-way door closes: `status` gains `retired`, and an
  optional `deprecation` block records `deprecatedAt`, `retiresAt`,
  `supersededBy`, and `migrationGuide`. The two Analytics Event manifest schemas
  that hard-coded `status` as a `releaseCandidate` const now use the full
  lifecycle enumeration.
- Added the Local Preview `0.2` compatibility manifest and its schema
  (`audience: "developmentOnly"`), completing the manifest family. Local Preview
  had canonical schemas and fixtures but no manifest, so its reader rules,
  message taxonomy, capability set, and draft-delivery diagnostic codes were
  documented in prose only and could drift from the tools unchecked.
- Retained `releaseCandidate: "RC4"` in the Paywall `0.2` manifest, redefined as
  an approved-lineage record naming the candidate the approved contract was cut
  from. It is not a lifecycle state.

Corrections made before approval, permitted because they only narrow schemas to
reject what the semantic validators already rejected (see
`docs/protocol/breaking-change-process.md`):

- Encoded analytics minimization in the canonical Analytics Event `1` and `2`
  schemas: per-event correlation and attribution allow-lists, plus
  `dependentRequired` atomicity for Rule Set pairing, the Experiment tuple (v2),
  and the Placement rollout tuple. Previously these rules existed only in the
  semantic validators and the API runtime path, so the canonical schema accepted
  documents Mosaic rejected — the Phase 6 defect class, and a release-blocker
  category in its own right. Four invalid fixtures that the schema previously
  accepted are now schema-rejected. All canonical valid fixtures are unaffected.
- The allow-lists are generated from the semantic validators' own tables
  (`npm run generate:analytics-minimization`) and reconciled by `npm run
  validate`, so schema/validator divergence now fails CI instead of shipping.
- Completed the Configuration Delivery `3` manifest `readerPolicy`, which was
  missing `noAcceptedRelease` and `bundledReleaseRejected`. The documented
  fallback chain — retain last accepted release, then bundled release, then
  report configuration unavailable — was prose-only at v3 while v2 declared it
  in metadata.

Also:

- Recorded, per invalid fixture, which layer rejects it (`schema` or `semantic`)
  in a generated `rejection-layers.json` in each `invalid/` directory. No
  fixtures were moved. See `docs/protocol/fixture-lifecycle.md`.
- Added Analytics Event v2 negative fixtures for correlation and attribution
  allow-list violations.
- Corrected the false claim in `docs/protocol/analytics-event-v2.md` that
  public/export names add a `mosaic_` prefix. Canonical names are unprefixed and
  Mosaic's own exports emit them verbatim; `mosaic_*` is a recommended
  convention for third-party downstream destinations. Added
  `docs/protocol/analytics-export-names.md` with the complete mapping and the
  reserved `rc_*`/`af_*` provider namespaces.
- Added the compatibility, deprecation, breaking-change, fixture-lifecycle, and
  release-approval policies, plus per-contract migration guides, under
  `docs/protocol/`.
- Improved analytics schema diagnostics: rejections now name the offending field
  and report only the branch matching the document's own `eventName`, instead of
  emitting every `oneOf` branch's failures.

## Experiment Assignment v1, Configuration Delivery v3, and Analytics Event v2 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on this date

- Added deterministic offline Experiment assignment with exact Control and Treatment Paywall Versions, immutable allocation ranges, identity policies, trusted scheduling, mutual exclusion, QA metadata, and normal-Placement fallback.
- Added Configuration Delivery `3` as the atomic complete Delivery `2` snapshot plus exact Experiment Assignment `1` definitions and capability negotiation.
- Added backward-compatible Analytics Event `2`, four closed Experiment events, all-or-none immutable Experiment attribution, and explicit exposure versus fallback presentation semantics while preserving v1 ingestion.
- Added shared assignment/group hash vectors, minimal valid and invalid fixtures, exact manifests, semantic validation, tests, documentation, and ADR-0021.
- Preserved Paywall Protocol `0.2`, Placement Decision `1`, Delivery `1`/`2`, Analytics Event `1`, and all Commerce contracts unchanged.
- Corrected mutual-exclusion publication ordering by making immutable Group Version members reference stable Experiment IDs while Delivery Assignments separately pin exact Experiment Version IDs.
- Made `schedule.endsAt` optional for immediate/manual-completion Experiments;
  `startsAt` remains required and a present end remains exclusive.

## Analytics Event Contract v1 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on this date

- Added a separate closed Analytics Event `1` contract with typed Placement,
  Paywall, Product, purchase, and restore observations.
- Added stable correlation, immutable attribution, timestamp and authority
  rules, bounded batch delivery, idempotency, and partial-batch results.
- Added compatibility metadata, canonical journey/authority/response fixtures,
  semantic validation, documentation, and a dedicated analytics changelog.
- Closed correlation and attribution per event family and added shared
  no-Paywall, fallback, failure, and unmapped-outcome conformance cases.
- Preserved all Paywall, Placement Decision, Configuration Delivery, and
  Commerce contract semantics.

## Placement Decision v1 and Configuration Delivery v2 - 2026-07-26

Status: approved at v1 GA (2026-07-27); released as a candidate on this date

- Added a separate Placement Decision `1` contract for deterministic local targeting, three-state evaluation, explicit outcomes/fallbacks, assignment policy, rollout, compatibility, and privacy-safe diagnostics.
- Added Configuration Delivery `2` as an atomic envelope containing exact Decision v1 Rule Sets, Paywall Protocol `0.2` Versions, and Product/Entitlement references.
- Added shared evaluator and rollout conformance fixtures, focused atomic-rejection fixtures, semantic validators, generated browser declarations, documentation, and changelogs.
- Preserved Configuration Delivery `1`, Paywall Protocol `0.2`, and Commerce contract semantics.
- Added evaluator conformance for canonical locale equality/membership and unknown malformed application versions without changing Placement Decision v1 wire syntax.

## Commerce Provider and Configuration v2 - 2026-07-24

Status: approved at v1 GA (2026-07-27); released as a candidate on this date

- Added parallel v2 Commerce contracts without changing v1, Configuration
  Delivery `1`, or Paywall Protocol `0.2`.
- Froze credential-free native activation, exact StoreKit and Google
  Product/base-plan/optional-offer mappings, immutable Product Entitlement
  grants, and configured-versus-observed native freshness.
- Added explicit recovery modes, asynchronous commerce updates, and idempotent
  local acceptance before StoreKit finish or Google acknowledgement.
- Added exact v1/v2 negotiation, atomic rejection, retain-last-accepted or
  bundled fallback, fixtures, validation, and browser declarations.
- Stage 5 review bound update revisions to the sidecar content digest,
  aligned both native fixtures to the complete stable Product set, required
  non-empty grants and purchased-update access, rejected duplicate native
  Product targets, and froze complete native capability matrices.

## Commerce Configuration v1 - 2026-07-23

Status: approved at v1 GA (2026-07-27); released as a candidate on this date

- Added a separate immutable release-associated sidecar binding exact
  Environment, Application, store platform, Configuration Release ID, and
  Configuration Release digest.
- Added one active provider, its capabilities, verified Product and Entitlement
  mappings, direct-Product and RevenueCat Package/Offering adapter detail, and
  equivalent SDK-local custom-provider snapshots.
- Added canonical whole-sidecar digest semantics, freshness, safe diagnostics,
  credential exclusions, minimum fixtures, semantic validation, generated
  browser declarations, and documentation.
- Preserved Paywall Protocol `0.2`, Local Preview `0.2`, Configuration Delivery
  `1`, and Commerce Provider Contract `1` semantics.

## Commerce Provider Contract v1 - 2026-07-23

Status: approved at v1 GA (2026-07-27); released as a candidate on this date

- Added a separately versioned provider-neutral commerce contract for explicit
  capabilities, stable Mosaic Product resolution, localized metadata,
  availability, periods, trials, introductory offers, freshness, safe
  diagnostics, purchase, restore, and active Entitlement outcomes.
- Preserved Paywall Protocol `0.2`, Local Preview `0.2`, and Configuration
  Delivery `1` semantics.
- Added minimum cross-platform fixtures, semantic validation, generated
  browser declarations, documentation, and a dedicated commerce changelog.

## Protocol 0.1 retirement test alignment - 2026-07-22

Status: accepted by ADR-0016

- Removed validation suites whose only subject was the retired Protocol and
  Local Preview `0.1` schemas, fixtures, and migration path.
- Re-anchored browser, Local Preview, component-semantic, and recovery tests to
  the sole Protocol `0.2` and Local Preview `0.2` contracts.
- Retained deterministic recovery coverage between the still-relevant `0.2`
  release candidates and kept Configuration Delivery `1` validation unchanged.

## Protocol and Local Preview 0.2 RC4 - 2026-07-18

Status: approved at v1 GA (2026-07-27); this entry records the RC4 candidate the approved contract was cut from

- Preserved every approved Protocol and Local Preview `0.1` artifact
  byte-for-byte. RC4 supersedes the unapproved `0.2` RC3 candidate.
- Added document-scoped, named colour, background, and shadow design-token
  catalogs with strict category references, missing-reference rejection, and
  cycle-safe validation.
- Replaced solid background values with a closed discriminated model covering
  colour, ordered linear/radial gradients, decorative image, decorative video,
  and background-token references.
- Added bundled and absolute safe-HTTPS remote image/video sources. Decorative
  video is always muted, autoplaying, looping, and control-free; failure uses
  its declared poster image when available, then its declared fallback colour,
  and emits a safe diagnostic.
- Added one inline or token-referenced shadow per eligible authored box. Product
  Card and Product Badge Default/Selected styles may carry the same shadow.
- Unified every eligible authored box on `sizing.width` and `sizing.height`
  with Fit, Fill, or a positive Fixed value. Renamed candidate `content` to
  `fit`; migrated Image to the same sizing object while retaining optional
  intrinsic `aspectRatio` guidance. Unbounded Fill safely uses Fit and diagnoses.
- Added required Screen/Sheet presentation. The initial route must be Screen;
  Sheet uses native modal presentation and the existing navigation history.
- Added exact design-token, gradient, media-background, shadow, height-sizing,
  sheet, remote-image, and bundled/remote-video capabilities derived only when
  used.
- Updated the canonical fixture, Local Preview `0.2`, browser runtime and
  generated declarations, semantic validation, fallback helpers, migration,
  documentation, and conformance coverage for RC4.
- Added explicit deterministic RC3-to-RC4 Node/browser recovery. The `0.1`
  migrator emits RC4 directly, and RC2 recovery chains through RC4 without
  discarding its review-required diagnostics.

## Protocol and Local Preview 0.2 RC3 - 2026-07-18

Status: superseded before approval by RC4

- Preserved every approved Protocol and Local Preview `0.1` artifact
  byte-for-byte. RC3 supersedes the unapproved `0.2` RC2 candidate.
- Replaced selector-generated visual options with ordered, structural Product
  Card children that own their product binding, passive content, layout, and
  complete Default plus recursively partial Selected box styles.
- Added at most one Product Badge direct child per Product Card, with nested or
  logical overlay placement, passive content, and independent state styles.
- Restricted safe product templates to `product.name` and `product.price` in
  Product Card Text content and card accessibility labels; malformed, unknown,
  or out-of-context templates reject the document.
- Defined deterministic initial/first-available selection, missing-price card
  unavailability, no-available-card fallback, disabled Purchase behavior, and
  per-selector `selectedProducts` runtime reset state.
- Updated deterministic `0.1` migration to emit RC3 directly and added an
  explicit RC2 candidate recovery helper with review-required diagnostics for
  selected-only content layout or text-color intent that cannot migrate
  losslessly, including a browser-safe Studio export with exact capability
  synchronization.
- Expanded canonical and invalid fixtures, Node/browser validation parity,
  runtime helpers, compatibility metadata, declarations, migration tests, and
  Local Preview `0.2` reset evidence for the frozen RC3 contract.

## Protocol and Local Preview 0.2 RC2 - 2026-07-18

Status: superseded before approval by RC3

- Preserved every approved Protocol and Local Preview `0.1` artifact
  byte-for-byte. RC2 supersedes the unapproved `0.2` RC1 candidate.
- Replaced the top-level `layout` with one through ten closed `screens` and an
  `initialScreenId`, including multi-screen accessibility labels, global
  component identifiers, screen-local product and Switch references, complete
  reachability, and an acyclic forward-navigation graph.
- Added presentation navigation history, deterministic accepted-revision
  navigation reset, and safe root `navigateBack` no-op diagnostics.
- Replaced the `0.2` Purchase, Restore, and Close component kinds with one
  composable Button whose passive descendants form a single accessibility
  target and whose loading content is limited to Purchase and Restore actions.
- Replaced `0.2` Legal Text with ordinary Text and added platform-neutral Icon
  semantics with a closed name set and direction-aware RTL mirroring.
- Added `navigateTo`, `navigateBack`, and absolute HTTPS-only
  `openExternalUrl` actions. External URL failures keep the paywall visible and
  do not add a presentation outcome.
- Updated deterministic `0.1` migration to create one screen, convert Legal
  Text and specialized Buttons, preserve authored copy and accessibility, and
  allocate collision-safe descendant identifiers.
- Added a two-screen conformance fixture with Text-plus-Icon Buttons, all six
  action kinds, and focused invalid fixtures for navigation cycles, interactive
  Button descendants, and unsafe external URLs.
- Updated semantic validation, Local Preview runtime-reset fixtures, browser
  runtime/declarations, compatibility metadata, migration tests, and normative
  documentation for the RC2 contract.

## Protocol and Local Preview 0.2 RC1 - 2026-07-17

Status: superseded before approval by RC2

- Preserved every approved Protocol and Local Preview 0.1 artifact
  byte-for-byte and added hash regression coverage.
- Replaced `verticalStack` in 0.2 with generalized vertical/horizontal `stack`
  semantics and deterministic 0.1-to-0.2 migration.
- Added vertical/horizontal Product Selector layout with `gap`, including
  deterministic vertical migration from 0.1 `itemSpacing`.
- Added horizontal paged Carousel with 2–20 stable, localized pages, an initial
  index, Stack content, largest-page height, manual snapping, no autoplay or
  loop, and no nested Carousel.
- Added Switch with off/on track and thumb colors plus static and single-Switch
  Boolean visibility that removes false subtrees from layout, accessibility,
  focus, and hit testing.
- Added absolute UTC Countdown with ordered largest/smallest units, controlled
  clock completion semantics, localized completed text, and no action.
- Added the frozen eight semantic colors and uppercase `#RRGGBBAA`, constrained
  box appearance, inside border, uniform radius, opacity, clipping, logical
  padding, safe sizing, separate outer insets, and line-height-multiplier
  typography with eligible maximum lines.
- Added Product Card complete Default styling plus recursively partial,
  per-leaf resettable Selected overrides, including empty `{}` full reset. No
  other authored card state exists.
- Added complete, migrated, 20-page edge, expired Countdown, hidden purchase
  target, and intentionally invalid fixtures; semantic validators; browser
  types/runtime validation; and exact 0.2 capability metadata.
- Added Local Preview 0.2 schemas and generated fixtures, highest-mutual 0.1/0.2
  subprotocol negotiation, explicit 0.1-only incompatibility recovery, exact
  capability gating, and accepted-revision Switch/Carousel runtime reset
  without changing Local Preview 0.1.
- Explicitly excluded CSS, freeform positioning, rotation, multi-paint,
  project-defined token catalogs, executable content, Carousel autoplay/loop,
  and Countdown actions.

## Local Preview 0.1 - 2026-07-17

Status: frozen Phase 2 integration contract; Phase 2 review pending

- Added a separate, platform-neutral Local Preview `0.1` WebSocket envelope
  without changing approved Paywall Protocol `0.1` RC1 semantics.
- Defined editable document identities, ordered local revisions, preview client
  identity, exact first-party preview capabilities, acknowledgements,
  heartbeats, validation errors, compatibility warnings, render failures, and
  bounded safe diagnostics with recovery actions.
- Defined local mock subscription and non-consumable products, availability,
  trials, introductory offers, deterministic purchase/restore outcomes, and
  mock entitlement state without introducing a real billing provider model.
- Added a closed local-project autosave schema and normative raw Protocol `0.1`
  JSON import/export rules.
- Added generated message and project fixtures plus validation, correlation,
  stale-revision, mock-commerce, safety, and import/export tests.
- Added a browser-safe canonical validation and generated TypeScript type
  surface for Studio, with browser/Node semantic-parity and generation-drift
  tests. This is an integration surface over the frozen schemas, not a schema
  or paywall-semantics change.

## 0.1 RC1 - 2026-07-16

Status: approved and immutable; product-owner approval recorded 2026-07-17

- Replaced the Phase 0 minimal decoder fixture with the single complete Phase
  1 fixture at `fixtures/v0.1/complete-paywall.json`.
- Added vertical scrolling, recursive vertical stacks, logical spacing,
  direction-relative alignment, safe-area behavior, and deterministic image
  aspect semantics.
- Finalized the RC1 component set: text, image, feature list, product selector,
  purchase button, restore button, close button, and legal text.
- Added document locale catalogs with exact, base-language, fallback-locale,
  default-locale, and inline-default resolution, including long German and
  Arabic RTL coverage.
- Added provider-neutral product references. Localized price, period, offer,
  and trial data remain purchase-provider runtime data.
- Added bundled logical image keys and mandatory localized placeholder
  fallback behavior; no remote asset retrieval is part of Phase 1.
- Added closed declarative purchase, restore, and close actions plus required
  component-specific accessibility metadata.
- Added exact capability metadata, reader/runtime fallback policies, normalized
  interaction outcomes, and normalized presentation outcomes.
- Added recursive capability derivation and semantic validation for duplicate
  IDs, asset/product/action references, locale catalogs, unused declarations,
  canonical fixture coverage, and canonical JSON.
- Expanded protocol validation to 63 valid and invalid contract tests.

## 0.1 Phase 0 draft - 2026-07-16

- Added the initial minimal paywall schema, compatibility manifest, vertical
  decoder fixture, validation tools, documentation, and numeric boundary rules.
