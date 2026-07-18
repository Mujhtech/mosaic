# Protocol changelog

All notable Mosaic protocol changes are recorded here. Versioned artifacts are
not immutable until their review gate is approved.

## Protocol and Local Preview 0.2 RC4 - 2026-07-18

Status: release candidate; SDK, Studio, quality, and product-owner approval pending

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
