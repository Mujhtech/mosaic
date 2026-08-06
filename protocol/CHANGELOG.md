# Protocol changelog

All notable Mosaic protocol changes are recorded here. A contract's artifacts
become immutable when its `status` reaches `approved`; before that, its review
gate may still change them. Every Mosaic contract is `approved` as of v1 GA.

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
