# Protocol changelog

All notable Mosaic protocol changes are recorded here. Versioned artifacts are
not immutable until their review gate is approved.

## Protocol and Local Preview 0.2 RC1 - 2026-07-17

Status: release candidate; SDK, Studio, and product-owner approval pending

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
