# ADR-0014: Author Product Selector Cards as Protocol Structure

## Status

Accepted

## Date

2026-07-18

## Context

Protocol `0.2` RC2 represented a Product Selector as an ordered list of Product
Reference IDs plus one selector-owned generated-card style. That made every
option share the same generated name, price, badge, content layout, and visual
structure. Studio could style a state, but could not author structurally
different options or show the card and badge hierarchy in Layers.

Generating divergent card content independently in Flutter, SwiftUI, Compose,
and Studio would create four implicit document models. Moving native view or
billing-provider types into the protocol would violate Mosaic's
platform-neutral boundary. Allowing arbitrary interpolation or expressions
would also introduce unsafe executable-like remote behavior.

Protocol `0.1` is approved and immutable. Protocol `0.2` is still an
unapproved release candidate, so the product structure may be corrected before
approval while retaining explicit migration and recovery paths.

## Decision

Protocol `0.2` RC3 supersedes RC2 before approval.

Product Selector owns one through twenty ordered Product Card children and an
initial Product Card ID. Each Product Card owns one Product Reference binding,
passive content, bounded layout, optional localized accessibility copy, and
complete Default plus recursively partial Selected box styles. Product Card is
valid only below Product Selector and is a first-class Studio Layer.

A Product Card may contain at most one direct Product Badge. Product Badge owns
passive content, bounded layout, independent Default/Selected box styles, and
either nested placement or a logical-corner overlay with bounded logical
insets. It is invalid outside a Product Card. Overlay anchors use start/end so
they mirror in RTL; the contract exposes no arbitrary coordinates or z-index.

Card and badge content is passive and bounded: interactive descendants are
invalid, a card has at most twenty descendants, and nested Stack depth is at
most four. Content, typography, layout, and placement do not change by state;
only the declared box-style leaves may vary between Default and Selected.

Product Reference retains provider-neutral identity and label metadata only.
Visual badge copy moves into Product Badge content. Runtime product text is
limited to `product.name` and `product.price`, with optional whitespace, in
Text below a Product Card or the card's localized accessibility label. The
renderer substitutes values after locale selection without evaluating code.
Unknown, malformed, or out-of-context template syntax rejects the document.

Selection is deterministic. The initial available card is selected; otherwise
the first available card in source order is selected. A missing localized
price makes a price-dependent card unavailable. When no card is available,
the selector displays its fallback, has no selection, and disables Purchase
safely. Runtime state is keyed by selector ID and stores the selected Product
Card ID.

The canonical `0.1` migrator emits RC3 directly. A separate RC2-candidate
recovery helper converts generated styles to authored structure and emits
review-required diagnostics for selected-only layout or text-color intent that
cannot be represented losslessly. Protocol and Local Preview `0.1` artifacts
remain byte-for-byte unchanged.

## Consequences

### Benefits

- Studio Layers and every native renderer consume the same explicit option
  structure;
- cards may differ in content and layout without platform-specific extensions;
- badges are reusable passive substructure with deterministic RTL behavior;
- the template surface is useful for commerce data while remaining closed and
  non-executable; and
- availability and selection fallback are identical across renderers.

### Trade-offs

- every RC2 candidate document must be recovered before RC3 validation;
- authors must create complete Default styles per card and badge;
- SDKs must track selection by Product Card ID rather than Product Reference
  ID; and
- selected-only content layout or text-color intent from RC2 requires manual
  review because RC3 keeps content structure state-independent.

## Alternatives Considered

### Keep selector-generated cards

Rejected because it cannot express differently composed options and leaves
Studio Layers disconnected from renderer structure.

### Put arbitrary component trees directly on Product Reference

Rejected because Product Reference is provider-neutral data reused by
commerce logic; visual structure belongs to the presenting selector.

### Add arbitrary interpolation or executable expressions

Rejected because remote executable behavior is outside Mosaic's architecture
and cannot be validated or implemented consistently across native renderers.

### Add absolute badge positioning

Rejected because logical-corner overlays cover the approved use case while
preserving bounded native layout and RTL semantics.
