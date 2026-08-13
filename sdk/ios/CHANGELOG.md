# Changelog

## Unreleased

### Single-version contracts (ADR-0028)

- **Paywall Protocol `0.4` is the only readable version.** `0.3` is gone: its
  decoder path, shape and semantic branches, capability catalog, fixtures,
  bundled resource, and goldens are deleted. `MosaicSchemaVersion` carries one
  case, and a document at any other version is rejected atomically with
  `unsupportedSchemaVersion`, resolving through cached configuration, then
  bundled fallback, then configuration unavailable.
- `mosaicProtocolVersion` is now `"0.4"`. `mosaicMotionProtocolVersion` and
  `mosaicLatestProtocolVersion` are removed as duplicates of it.
  `MosaicCapabilityCatalog.v03`/`.v04` collapse into `.current`, and
  `MosaicCapabilityName.productCardStates` is deleted — a document declaring
  `style.productCardStates` is now rejected as an unsupported capability.
- **Capability reporting is single-version.** `MosaicSDKCapabilityReport` no
  longer reports a set per contract. Entries keep their `version` because the
  Configuration Delivery and Local Preview handshakes put name/version pairs on
  the wire and a release's `requiredCapabilities` is compared against them.
- **Configuration Delivery accepts version `3` only,** carrying Paywall Protocol
  `0.4`. The v1 and v2 dispatch arms are deleted, and with them the projection
  chain that defined v3 by re-serializing it into a v2 envelope and v2 into a v1
  one. The shared rules survive under names that describe what they decode:
  `MosaicConfigurationReleaseDecoder` and
  `MosaicConfigurationReleaseMaterialDecoder`.
- **Local Preview negotiates `mosaic.local-preview.v0.4` only,** with
  `previewProtocolVersion: "0.4"`. `MosaicPreviewCapabilityReport.v03(clientId:)`
  becomes `.current(clientId:)`.
- **Authoritative Entitlement is version `2` only.** The `"1"` constant and the
  synthetic v1 envelope the authority codec used to project through are gone;
  `MosaicCustomerEntitlementCodec` now reads the current record directly.
  `mosaicAuthoritativeEntitlementAuthorityContractVersion` is removed —
  `mosaicAuthoritativeEntitlementContractVersion` is the single constant.
- **The reduced-motion video rule is unconditional.**
  `MosaicVideoBackgroundPresentation.resolve` no longer takes a `schemaVersion`:
  with one readable contract, every document is subject to ADR-0027 ruling 3, so
  a video background never plays under Reduce Motion.
- The packaged bundled fallback is synthesized as release *material* rather than
  as a versioned delivery envelope, and ships the `0.4` canonical document.

### Fixed

- **Configuration Delivery digests are computed over a canonical byte form
  again.** `DeliveryCanonicalJSON` no longer delegates to `JSONSerialization`,
  which writes a `Double` with 17 significant digits — `0.04` became
  `0.040000000000000001` — so any release embedding a paywall with fractional
  values (opacity, motion amplitude, line-height multipliers) failed its own
  content digest on Apple platforms alone. Numbers now use the shortest
  representation that round-trips, matching every other implementation.
- A release's placement table is derived from the placement decisions that name
  each paywall, so `paywall(forPlacement:)` and the public `resolve(placement:)`
  answer with the authored placement key instead of a positional placeholder.
- An unknown capability name is reported as `unsupportedCapability` rather than
  as a generic shape error, so diagnostics name the capability that was missing.

- Read Paywall Protocol `0.4`, "Motion", alongside `0.3`. Versions stay exact
  identifiers: the decoder dispatches on `schemaVersion`, a `0.3` document is
  held to the `0.3` rules and a `0.4` document to the `0.4` rules, and neither
  reads the other. `0.4` is validated by the same shape and semantic validators
  parameterized by version rather than by a forked copy, because "0.4 is 0.3 plus
  motion minus one capability" is the whole compatibility claim and two copies
  could drift while each stayed internally consistent.
- Add the `designSystem.motions` catalog, `motionToken` references and inline
  motions, and per-node `appear`, `selection`, and `loop` blocks, with the `0.4`
  semantic rules enforced: nested `appear` rejects the document, at most one
  `loop` per screen, a `loop` curve resolving below the 500 ms flash-safety floor
  rejects, every reference must resolve and the graph must be acyclic, and an
  **unused** motion token rejects — deliberately unlike the colour, background,
  and shadow catalogs, because a motion nothing references has never been checked
  against the safety rule that lives at its reference site.
- Add `MosaicMotionDriver`, an injected enabled flag and elapsed-time source that
  mirrors the existing clock injection. The Countdown's one-second repaint moved
  off `TimelineView(.periodic(from: .now, by: 1))` onto the driver's tick, so its
  cadence is now testable; its remaining-time rounding is deliberately unchanged,
  as that divergence is a separately tracked `0.3` defect. A disabled driver
  renders every node's terminal state, which is its static rendering, so existing
  goldens are unaffected.
- Render the three primitives from `MosaicMotionResolver`, the same code the
  published frame vectors are checked against: SwiftUI supplies a timeline —
  `Animation.timingCurve` with the contract's normative control points for the
  two one-shot primitives, a frame clock for the bounded pulse — and never
  supplies a value. Every animation's terminal state is byte-identical to the
  static rendering by construction: a terminal frame applies no modifier at all.
- Honour reduced motion as a signal injected at the renderer boundary, defaulting
  to `accessibilityReduceMotion`. `appear` becomes opacity-only with the
  transform dropped at every instant, `selection` applies instantly, `loop` is
  disabled at rest, and on a **`0.4` document a video background does not play**
  — the declared poster is drawn, and otherwise the declared fallback colour,
  with no frame shown, no control offered, and no player constructed at all.
  This is specified `0.4` behaviour rather than a `0.3` defect patch (ADR-0027,
  ruling 3), so a `0.3` document keeps `0.3`'s behaviour and the live exposure
  stays open until `0.4` is accepted. `UIAccessibility.isVideoAutoplayEnabled`
  is Apple's own, narrower switch rather than a protocol rule, and is honoured
  on every document version: a customer who turned it off meant it.
- A declared video source the host cannot resolve is reported whether or not it
  would have been allowed to play. Unavailability is a fact about the media, not
  about the viewer's preferences, and an operator must be able to see a broken
  asset without first ruling out every viewer's accessibility settings. The line
  is drawn at what is knowable without playing: a missing asset or a bundled key
  the host does not map is settled by lookup and reported on both paths, while a
  remote URL that would have failed to load is reported only by the player that
  actually tried — determining that under suppression would mean fetching, which
  is the playback the ruling forbids. Both paths record the same diagnostic code,
  so the wording never discloses which one ran.
- **`appear` and `loop` replay on genuine screen re-entry, and the pulse's
  authored cycle bound is spent per entry.** Navigating to another Paywall Screen
  and back re-enters the screen left behind, so both clocks restart from node
  entry. A Sheet is deliberately not an entry for the screen *underneath* it:
  this renderer builds that screen from one unconditional call site and presents
  the Sheet beside it, so it stays mounted and keeps its scroll position,
  selection, and Carousel page — replaying its entrances when the Sheet closed
  would animate content that never left. A Sheet's **own** content does enter on
  every presentation, including the second time the same Sheet is opened.
  Entry is recorded by `MosaicPaywallModel`, which owns navigation, and carried
  per presentation surface, so the Sheet and the screen beneath it measure from
  their own origins rather than sharing one.
- **Behaviour change on `0.3` documents:** a Feature List marker is now drawn at
  the component's `markerSize`, falling back to the list's own
  `typography.fontSize`, where it previously used the SF Symbol's inherited body
  font. A `0.3` paywall's checkmarks therefore render at the authored text size
  rather than the platform default — usually a small difference, and a visible
  one where the list's typography is far from 17 pt. The marker is also now the
  one the item actually declares: the Feature List had been drawing a hardcoded
  checkmark for every row, so a `0.4` ordinal came out as a tick and a "not
  included" row authored as `icon: close` came out claiming the opposite of what
  it said. Feature List and Timeline now share one glyph renderer.
- Add `markerSize` to Feature List, matching Timeline's field of the same name
  and bounded identically. It is optional, because a Feature List always declares
  a marker and so always has a size to fall back on; absent, the glyph is sized
  from the list's own `typography.fontSize` rather than from a renderer constant.
- **Breaking (pre-release):** `MosaicMotionAccessibility.permitsVideoPlayback` is
  removed. Whether a video may play now depends on the document's
  `schemaVersion` as well as the two accessibility signals, and a public helper
  answering that question without asking which contract it answers for is one a
  caller would reasonably believe.
  `MosaicMotionAccessibility.systemAllowsVideoAutoplay` is now main-actor
  isolated, matching `UIAccessibility`.
- **Breaking (pre-release):** `MosaicPaywall.init(model:…)` no longer takes a
  `motionDriver`; the driver belongs to `MosaicPaywallModel`, which now accepts
  one and exposes it. Entry origins are recorded as navigation happens, and
  navigation is the model's, so a driver held separately by the view could only
  disagree with it. `MosaicPaywall.init(document:…)` is unchanged and forwards
  its `motionDriver` into the model it builds.
- Report capabilities per contract: `MosaicSDKCapabilityReport.current` now
  advertises `0.3` and `0.4` with each version's own capability set, including
  `motion.appear`, `motion.selection`, and `motion.loop`. Configuration Delivery
  and Local Preview still negotiate `0.3` alone — `0.4` is a draft, and the
  backend capability partitioning and the Local Preview version bump it needs are
  separate, named work.
- **Breaking (pre-release):** `MosaicFeatureMarker` is removed. `0.4` consolidates
  Feature List and Timeline onto one `MosaicMarker` union of `dot`, `ordinal`, and
  `icon`, so a list can express a negated item, and an item may override the
  list's glyph. `MosaicTimelineMarker` is now an alias of it. A `0.3` document's
  bare `"checkmark"` string still decodes, to the same glyph it always drew.

- Adopt Paywall Protocol `0.3`, which replaces `0.2` outright. There is no `0.2`
  support, no migration, and no dual-version code: a `0.2` document is an
  unknown version to this reader and is rejected atomically, resolving through
  last accepted, then bundled fallback, then configuration unavailable. Every
  `0.2` artifact is gone from the SDK — the version constants, the `V02`
  validator symbols and their files, `MosaicCapabilityCatalog.v02`, the bundled
  `Resources/v0.2` fixture, and the Local Preview subprotocol are all `0.3`.
- Add the four `0.3` components. **Tabs** renders two through eight labelled
  panels with one visible at a time, selected from the required authored
  `initialTabId` rather than from array position, and resolves its Default and
  Selected control appearance through the neutral `selectionStyles` overlay that
  `productCardStyles` now aliases. **Timeline** renders two through twelve
  ordered vertical entries with a required connector and a closed
  `dot`/`ordinal`/`icon` marker union. **Award** renders a title with an optional
  subtitle and an always-decorative image or icon emblem. **Social Proof**
  renders a required quote and attribution with an optional avatar and an
  integer-only bounded rating whose symbol fills are computed with integer
  arithmetic, never a rounded fraction.
- Add tab selection to runtime state and `{ "mode": "tab" }` to `visibility`,
  with the same remove-from-layout-accessibility-and-focus semantics as a false
  Switch condition. Visibility evaluation now takes a `MosaicSelectionState` of
  `{ switches, tabs }` and **throws** when a condition names a controller that
  state does not carry. Resolving it to "hidden" instead would read back as a
  component that silently disappears rather than a caller that is told it has a
  bug.
- Enforce both directions of the `0.3` co-presence rules rather than only the
  missing-value direction: Timeline `markerColor`, `markerSize`, and
  `descriptionTypography` are required when an entry consumes them and rejected
  when none does, Award `subtitle` and `subtitleTypography` are mutually
  required, and a Social Proof `value` above `maximum × stepsPerPoint` rejects
  the document. A style nothing reads is how a stale field survives a redesign.
- Announce composed accessibility content as separate elements inside a
  labelled container rather than one joined string. Timeline titles and
  descriptions, Award titles and subtitles, and Social Proof ratings, quotes,
  and attributions are each their own element, in the authored order, and the
  platform supplies the pause. Joining them invented script-specific
  punctuation. An absent optional segment produces no element rather than an
  empty one, and the Social Proof avatar, Award emblem, Timeline markers, and
  Timeline connector are never announced or focusable.
- Announce a busy Button's progress state in the value slot, from the reserved
  `mosaic.a11y.in_progress` string, leaving the authored `accessibility.label`
  as the name in both states. The Button's children and in-progress children are
  never announced in either state. iOS previously announced no progress state at
  all for a composable Button, so a screen-reader user had no signal that a
  purchase or restore was running.
- Read the invalid-fixture corpus from the canonical directory with a declared
  case-count floor instead of from a list copied into the test file. The list
  had drifted to eight of the twelve fixtures, and a loop over a list can report
  success over cases it never saw. The `rating-announcement` and
  `accessibility-announcement` corpora are consumed the same way, byte-exact,
  with their own floors — without them nothing forces this SDK to read the
  reserved keys instead of composing its own string, and a composed string reads
  as correct under inspection.
- Delete the retired Protocol `0.1` node types the branch still carried:
  `verticalStack`, `purchaseButton`, `restoreButton`, `closeButton`, and
  `legalText`, their `MosaicLayoutNodeKind` and `MosaicNode` cases, their
  capability names (`layout.verticalStack`, `component.purchaseButton`,
  `component.restoreButton`, `component.closeButton`, `component.legalText`),
  their component models and SwiftUI views, the `MosaicPaywallModel` methods and
  busy-button state that only they used, the `MosaicVerticalStack` alias, and
  the `MosaicStack` decoder branch that read a `verticalStack`'s `spacing` and
  `horizontalAlignment`. The `0.3` schema names none of them in its node union
  or its capability enum, and the single decode path runs shape validation
  first, which rejects every one of them as an unsupported component — so no
  accepted document could contain one. Roughly two dozen exhaustive-switch arms
  existed only to satisfy the compiler, including two that threw
  `protocol_0_1_node_in_0_3_document` for a case the reader can never construct.

- Apply the contract's uniform presence rule to every host-supplied targeting
  source. An unrecognized `context.country` is now present with unknown
  comparisons instead of absent, so a "no country reported" Rule no longer fires
  on a device that reported one, and an out-of-set `device.platform` compares
  unknown instead of false, so `not (platform equals "ios")` no longer matches a
  platform the Rule was never written for.
- Canonicalize the authored side of a locale comparison, not only the host side,
  for `equals`, `not_equals`, `in`, and `not_in`. An operand with no canonical
  form makes the condition unknown rather than false, and one unusable member
  makes a whole `in`/`not_in` list unknown even when another member matches.
- Accept a released Rule whose locale operand has no canonical form. Only a
  `locale_matches` range is bound by the authored grammar; rejecting the others
  discarded whole releases the contract considers valid.
- Treat a host-supplied locale that cannot be normalized as present rather than
  absent in Placement targeting: `exists` is true, every comparison is unknown,
  and an authored range that cannot be normalized makes `locale_matches`
  unknown rather than false. A `does_not_exist` Rule no longer matches users who
  do have a locale.
- Cut a locale at the first `@`, `.`, or `#` before canonicalizing, so the ICU
  keyword, POSIX charset, and Java `Locale.toString` forms (`en_US@rg=gbzzzz`,
  `en_US.UTF-8`, `en_US_#u-rg-gbzzzz`) all denote `en-US`. Catalog lookup also
  recovers the leading language subtag when the whole tag cannot be
  canonicalized; targeting deliberately does not, because recovery there would
  change which users match a Rule.
- Omit the analytics context locale entirely when the device reports nothing
  representable, instead of substituting `en`.
- Canonicalize every locale through one shared rule, per the Protocol 0.3
  locale-resolution rulings. Catalog lookup canonicalizes the requested tag
  before an exact match (`_`→`-`, empty subtags dropped, truncation at the first
  singleton subtag, lowercase language, title-case script, uppercase alpha-2 or
  numeric-3 region), and `application.locale` targeting applies the identical
  rule, so the two subsystems cannot disagree about what "the same locale" is.
  A host that passes the platform's own identifier (`en_US`, `PT_br`, or
  `en-US-u-rg-gbzzzz` under a region override) previously matched no catalog key
  and silently rendered the document's default language; an RTL request in that
  form also fell through to an LTR default and mirrored the layout. A tag that
  canonicalizes to nothing contributes no candidate rather than matching
  anything. `0.3` still defines no language+region reduction: `zh-Hans-CN`
  reduces to `zh`, never to `zh-CN`.
- Normalize the device locale to a strict BCP-47 tag before it reaches the
  analytics event context or the Placement decision context. `Locale.current`
  reports an ICU identifier, so a region override (`en_US@rg=gbzzzz`) or a
  non-Gregorian calendar (`zh_Hans_CN@calendar=chinese`) previously produced a
  context the closed event codec rejects: every event on those devices was
  dropped as invalid, and `application.locale` rules evaluated to unknown. Both
  contexts now share one normalization, which drops Unicode extension subtags
  and falls back to the language subtag rather than emitting a rejected value.
- Enable analytics collection by default. A hosted client now queues Mosaic's
  own product events without the host calling `setAnalyticsCollection`, matching
  the Flutter SDK and the Environment's server-side default. Hosts opt out
  explicitly with `setAnalyticsCollection(hostEnabled: false)`, whose
  `environmentEnabled` argument now defaults to `true`. The Environment's
  server-side collection setting still gates ingestion regardless, and the host
  application remains responsible for whatever end-user consent its jurisdiction
  requires. Transaction observations remain opt-in and are unaffected. A queue
  state persisted by an earlier build keeps the gates it recorded.

- Diagnose every style-resolution failure instead of rendering transparently.
  Unresolved colour tokens and malformed colour literals now recover by role:
  content colours fall back to the primary content colour so authored text stays
  legible, decoration stays transparent, and both record a rendering diagnostic
  once per subject. One unresolvable gradient stop no longer erases the whole
  background; the gradient renders with its resolvable stops.
- Resolve design tokens in legacy Product Cards. They previously rendered
  through a document-less resolution path, so no authored token could resolve.
- Distinguish a malformed countdown `endsAt` from a completed countdown. A date
  outside the canonical protocol form renders nothing and records
  `countdown_ends_at_invalid` rather than presenting the localized completed
  text. The renderer now shares the semantic validator's single definition of a
  parseable `endsAt`, so the two cannot disagree about what a valid countdown
  is.
- Reject a document whose `initialScreenId` references no declared screen at
  decode time, matching the `invalidReference` reader policy, instead of falling
  back to the first screen.
- Guard the macOS Carousel page index instead of subscripting it directly.
- Record `product_selection_default_substituted` when an unavailable authored
  default product is replaced by the first available option.
- Record `placement_analytics_metadata_unavailable` when a Placement resolves
  without analytics metadata and therefore renders untracked, and make the
  Placement-unavailable placeholder copy host-overridable through
  `MosaicPlacementUnavailableCopy`.
- Resolve layout direction through the requested, fallback, and default locale
  chain and record `localization_direction_unresolved` when it is exhausted,
  instead of defaulting an RTL document to left to right.
- Record diagnostics on component-image fallback paths, matching the existing
  media-background behaviour.
- Report Placement decision-context provider capabilities from the installed
  provider's declared Experiment capabilities instead of assuming availability.
- Classify StoreKit purchase and restore errors into cancelled, pending,
  product-unavailable, retryable provider-unavailable, and failed, matching the
  RevenueCat adapter, instead of flattening everything to one non-retryable
  code.
- Omit a subscription period whose unit the SDK cannot name in both native-store
  adapters and record `commerce.unsupportedSubscriptionPeriod`, instead of
  presenting it as daily. RevenueCat records
  `commerce.unsupportedIntroductoryOffer` for an unclassifiable offer type.
- Throw `MosaicStoreKitAcceptanceStoreError.durableStorageUnavailable` rather
  than storing StoreKit purchase-acceptance state in the purgeable temporary
  directory.

- Add Authoritative Entitlement v2 support with automatic Application,
  platform, app-version, SDK-version, and capability reporting. The SDK accepts
  server-directed authority epochs before snapshot versions, atomically binds
  v2 caches to authority scope and digest, rejects legacy authority-less caches
  as `authority_unknown`, and exposes a bounded replaying authority stream.
- Keep Customer Access Tokens opaque and memory-only while rebinding their
  local generation to authority epochs. Pending and stabilizing transitions
  schedule one coalesced urgent sync and refresh before Configuration Delivery;
  there is no automatic purchase retry or background-execution integration.
- Make Placement targeting read only the authoritative Mosaic snapshot after
  Mosaic cutover. StoreKit and RevenueCat stay installed for Product loading,
  purchasing, restoration, transaction observation, and provider diagnostics;
  provider-observed access is never unioned into Mosaic-authoritative access.
- Treat targeting authority as unknown until an epoch is accepted, strictly
  validate unchanged snapshot confirmations, and publish accepted authority
  state only after its atomic cache write succeeds.
- Send the optional known snapshot-authority digest only with the exact retained
  customer/scope/epoch cache binding, and fail closed on `policy_unavailable`
  responses whose minimum-support policy is deliberately omitted.
- Persist `policy_unavailable` as an atomic cache tombstone before publishing
  unavailable state, including the exact canonical malformed form with its
  forbidden support placeholder. Failed marker writes gate bootstrap and sync
  until retry succeeds; valid full snapshots recover by replacing the marker.
- Keep direct host Entitlement checks unavailable under accepted `source` and
  `source_rollback` authority; only Placement targeting delegates to providers.
- Add the optional Apple transaction-observation handoff, off by default
  (`Mosaic.configure(transactionObservations:)`). When enabled,
  `MosaicStoreKitProvider.attachTransactionObservationSink(_:)` hands each
  locally accepted transaction to a persistent, duplicate-safe queue that
  submits the canonical Billing Ingestion Contract 1
  `clientTransactionObservation` record — deterministic `observationId` and
  `submissionId`, `providerId`, `storePlatform`, a `transactionReference` of
  `app_store_transaction_id` plus the raw decimal `Transaction.id` as a string,
  `observedAt`, `sourceAuthority: client_observation`, SDK context, and
  optional correlation — to `POST /v1/sdk/billing/observations`. A client never
  asserts a Store Environment; the server classifies it during validation.
  `Transaction.environment` is read on iOS 16 and later only to suppress
  Xcode StoreKit-testing transactions. Nothing else is submitted;
  `jwsRepresentation`, `deviceVerification`, `appAccountToken`, and
  `appTransactionID` are never read.
- The handoff never blocks a purchase, never changes a purchase or restore
  result, and never re-labels a local purchase as server-validated:
  `serverConfirmedTransactions` remains `unsupported` and the submission
  outcome vocabulary has no validated member. Submission results are decoded
  as Billing Ingestion Contract 1 `observationSubmissionResult` records; an
  unrecognized envelope, contract version, or status is retryable and can never
  become acceptance. Phase 9A adds no background-execution machinery. New: `transactionObservationSink()`,
  `flushTransactionObservations()`, `transactionObservationDiagnostics()`.

## 0.1.0-dev.6 — 2026-07-27

Operational hardening. The SDK remains pre-1.0; see
`docs/known-limitations.md`.

- Restore the declared iOS 15 floor. Trusted-time evaluation now reads
  `CLOCK_MONOTONIC_RAW` directly instead of the iOS 16-only
  `ContinuousClock`, with no change to schedule or anchor semantics. A
  dedicated iOS 15 typecheck command guards the regression.
- Add `PrivacyInfo.xcprivacy` declaring the `SystemBootTime` API reason
  `35F9.1`, the host-supplied user ID, installation ID, user attributes, and
  Product/purchase interaction data types, `NSPrivacyTracking` false, and no
  tracking domains. It ships through both SwiftPM resources and the podspec
  resource bundle.
- `Mosaic.configure` no longer fails the host application's launch when
  Application Support is unreachable. Configuration cache, identity,
  assignment replay, and the analytics queue degrade to process-lifetime
  storage, the bundled fallback stays reachable, and the safe
  `delivery_persistence_unavailable` diagnostic is reported.
- Fix the packaged bundled fallback, which could never be accepted: its
  synthesized release digested an Asset URL as top-level JSON and was tagged
  with the advertised Configuration Delivery version rather than the v1 shape
  it actually builds.
- Replace three host-reachable trap paths with safe failures.
  `MosaicPreviewMessageCodec(protocolVersion:)` is now failable, unsupported
  Local Preview fallback versions are dropped instead of trapping, an
  unresolved background token rejects the document, and an unsupported
  RevenueCat product handle raises a sanitized purchase failure.
- Require an analytics acknowledgement to echo the contract version of the
  batch it acknowledges. A 200 response carrying a different version is now
  retried instead of applying one contract's result semantics to another's
  batch. The response codec still reads both versions.
- Report the exact artifact version. `mosaicSDKVersion` and the analytics
  context `sdkVersion` both equal the published podspec version, so the
  `Mosaic-SDK-Version` header no longer drifts from the artifact.
- Relax the optional RevenueCat adapter's `purchases-ios` dependency from
  `exact: "5.81.2"` to `.upToNextMajor(from: "5.81.2")`; `Package.resolved`
  still records the verified version.
- Document CocoaPods as local-path-only until release artifacts are
  published, and state that background analytics delivery is best effort and
  `refresh()` is not cancellable.
- Bind bucketing tests to the canonical assignment-vector fixture and pin a
  repository-root `.swift-format` configuration.
- Attach the Experiment attribution tuple to conversion events only when the
  presentation actually records a statistical exposure. Fallback presentations
  and QA-override presentations emit no exposure, so their tuple-carrying
  `product_selected` could displace the Variant's legitimate denominator row in
  `product_selection_purchase_start`. Tuple attachment and exposure emission
  now share one predicate so they cannot drift apart. Only the tuple is
  removed; the events remain on Event Schema v2, and
  `experiment_fallback_presented` still carries the tuple as a diagnostic.
- Add conformance coverage proving the closed codec rejects all six canonical
  negative analytics fixtures across v1 and v2, and proving conversion events
  are emitted on Event Schema v2 with the complete immutable Experiment tuple
  whenever a presentation exposes an assigned Variant.
- Consolidate the two full-paywall SwiftUI goldens into one. Both rendered the
  same canonical Protocol 0.2 document and produced byte-identical output; the
  removed baseline was a stale Protocol 0.1-era recording. The remaining
  baseline was re-recorded after visual review on Xcode 26.5 / iOS 26.5.
- Add strict Configuration Delivery v3 and Experiment Assignment v1 decoding,
  exact compatibility derivation, trusted schedule evaluation, stable
  assignment/group bucketing, mutual exclusion, and non-production QA override
  handling while retaining Delivery v2/v1 readers.
- Add bounded backup-excluded assignment replay diagnostics, identity-aware
  clearing, completion retention, pre-presentation reauthorization, foreground
  refresh, selected-variant commerce capability checks, and safe normal-Placement
  fallback.
- Add Analytics Event v2 experiment assignment, exposure, and fallback events
  with immutable all-or-none experiment attribution on eligible Product and
  purchase lifecycle events, while preserving queued v1 decoding.
- Add strict Configuration Delivery v2 and Placement Decision v1 acceptance.
- Add offline deterministic targeting, exact rollout bucketing, explicit
  no-Paywall/fallback decision results, and privacy-safe bounded traces.
- Add actor-isolated app-install identity persistence, identify/reset APIs, and
  atomic typed user attributes.
- Add provider-neutral Commerce Configuration v2 decoding, `2,1`
  negotiation, exact native-store mappings, Product-to-Entitlement grants,
  recovery modes, and asynchronous local-delivery types while retaining v1.
- Add the optional `MosaicStoreKit` package with exact Product loading,
  verified purchase/restore/current-Entitlement handling, durable idempotent
  acceptance before finish, transaction update recovery, and safe diagnostics.

## 0.1.0-dev.5

- Add version-matched CocoaPods specifications for `MosaicSDK` and the optional
  `MosaicStoreKit` adapter, including CocoaPods-compatible fallback resources.
- Add strict Commerce Configuration v1 decoding, canonical digest validation,
  exact Configuration Release association, atomic last-known-valid caching,
  bundled fallback, safe diagnostics, and the frozen hosted sidecar wire
  contract.
- Add the core `MosaicCommerceProvider` boundary, installable provider router,
  direct and Offering/Package mappings, mapped Entitlements, and explicit
  pending, deferred, provider-unavailable, and restore-cancelled outcomes.
- Add an optional `MosaicRevenueCat` package pinned to purchases-ios 5.81.2.
  The host owns `Purchases.configure`; the adapter resolves exact native
  purchase handles and sanitizes typed purchase, restore, and lookup failures.
- Add canonical sidecar, hosted request, cache recovery, app-owned provider,
  RevenueCat mapping, result, and failure tests.
- Invalidate provider-native purchase handles whenever Commerce Configuration
  is installed or replaced, reject stale in-flight RevenueCat loads, and
  require an exact-mapping product reload before purchase.
- Align Commerce Provider v1 restore and active-Entitlement results: restore
  existing access as `restored`, and distinguish available, unknown,
  provider-unavailable, and failed lookup outcomes without treating failures
  as inactive.
- Require installed commerce adapters to report their runtime capabilities,
  reject identity, Mosaic adapter-version, or declared-capability drift before
  accepting mappings, and keep RevenueCat's Mosaic adapter version `1.0.0`
  separate from the pinned purchases-ios version.
- Carry one complete bounded diagnostic on every purchase, restore, and active
  Entitlement provider failure. The configured boundary repairs unsafe custom
  values while renderer outcomes continue exposing only stable safe codes.

## 0.1.0-dev.4

- Add strict Protocol 0.2 decoding while preserving the approved Protocol 0.1
  path without implicit migration.
- Render Stack, Carousel, Switch, Countdown, expanded styling and visibility,
  and inherited Product Card Default/Selected states with native SwiftUI.
- Conform to Protocol 0.2 RC2 multi-screen navigation, semantic Icon, unified
  container Button, async progress content, and safe external HTTPS actions;
  retain the separate approved Protocol 0.1 reader and renderer behavior.
- Conform to Protocol 0.2 RC3 authored Product Cards and Product Badges,
  card-identity selection, localized safe product templates, unavailable-card
  fallback, recursive selected styles, RTL overlay anchors, and merged native
  selectable accessibility semantics.
- Conform to Protocol 0.2 RC4 document design tokens, colour/gradient/media
  backgrounds, one box shadow, bundled and HTTPS image/video assets, uniform
  two-axis sizing, and explicit Screen/Sheet presentation.
- Render decorative video with muted autoplaying `AVPlayerLooper`, native
  poster/colour fallback and diagnostics; present Sheet destinations with
  SwiftUI while retaining the most recent Screen and shared navigation state.
- Add exact RC4 capability reporting, atomic invalid-token/media rejection,
  unbounded-Fill fallback, fixed clipping, physical gradient geometry, and
  Simulator coverage for native sheets and horizontal Product Cards.
- Preserve component runtime state across forward/back navigation, reset the
  navigation history for accepted revisions, merge button descendants into one
  accessible target, and diagnose root-back no-ops and failed external opens.
- Add Local Preview 0.2 negotiation, capability reporting, draft gating, mock
  commerce, runtime-state reset, and structured last-accepted-draft recovery.
- Add Protocol 0.2 fixture, interaction, accessibility, RTL, large-text,
  SwiftUI consumer, and simulator golden coverage.
- Package the current Protocol 0.2 fallback so disconnected previews exercise
  horizontal Product Selector layout and the Phase 2.5 component set.

## 0.1.0-dev.3

- Add the platform-neutral Local Preview 0.1 WebSocket codec, SwiftUI client,
  capability report, heartbeat, and bounded reconnect behavior.
- Apply document and mock-commerce revisions independently with stale and
  conflict protection; acknowledge drafts only after native rendering begins.
- Add safe validation, compatibility, asset, product-fallback, and render
  diagnostics while preserving the last accepted or bundled paywall.
- Add Studio-driven mock products, purchase and restore outcomes,
  entitlements, locale, RTL, and accessibility text scaling.
- Add a connected Phase 2 example and canonical local-preview fixture,
  transport, state, commerce, SwiftUI, and accessibility tests.

## 0.1.0-dev.2

- Decode and semantically validate all Mosaic Protocol 0.1 RC1 components.
- Render the canonical complete paywall with native SwiftUI.
- Add locale fallback, long-copy wrapping, right-to-left layout, and protocol
  accessibility projection.
- Add deterministic mock product loading, selection, purchase, restore, close,
  and explicit normalized outcomes.
- Add safe local candidate and bundled canonical fallback resolution.
- Add conformance, state, accessibility, fallback, SwiftUI consumer, and iOS
  Simulator golden tests.
- Add a native example application covering the Phase 1 mock-commerce states.

## 0.1.0-dev.1

- Add the Phase 0 configuration API.
- Add strict protocol 0.1 models and canonical-fixture decoding tests.
- Enforce schema scalar constraints, capability/content matching, and product-selector relationships.
- Enforce the canonical revision ceiling and reject non-finite layout values consistently with the
  other first-party readers.
- Add provider-neutral commerce result types and an actor-based mock provider.
- Add a SwiftUI consumer compilation test; native paywall rendering remains out
  of scope until Phase 1.
