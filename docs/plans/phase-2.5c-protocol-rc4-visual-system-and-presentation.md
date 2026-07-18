# Phase 2.5C: Protocol 0.2 RC4 visual system and presentation

Status: frozen implementation contract; product-owner acceptance remains a gate

## Purpose

Phase 2.5C extends the unapproved Protocol `0.2` candidate with the visual,
layout, asset, and multi-frame presentation semantics required to finish the
Phase 2.5 editor. It is additive to the Phase 2.5A and 2.5B authoring work and
does not reopen approved Protocol or Local Preview `0.1` artifacts.

## Frozen contract

- required document-scoped colour, background, and shadow token catalogs;
- colour, linear-gradient, radial-gradient, image, video, and token backgrounds;
- physical, non-RTL-mirrored linear angles where 0° is left-to-right and rotation is clockwise;
- declared bundled or safe remote image/video assets and deterministic media
  fallback;
- one inline or token-referenced shadow for eligible boxes;
- uniform fit, fill, or fixed sizing on both width and height;
- explicit Screen or Sheet presentation on every screen;
- exact, use-derived RC4 capabilities and atomic rejection; and
- direct `0.1` migration plus explicit RC3 candidate recovery to RC4.

The normative details and fallback rules live in `docs/protocol/v0.2.md` and
ADR 0015.

## Delivery sequence

1. Freeze the schema, manifest, validators, generators, fixtures, browser
   runtime/declarations, compatibility policy, migration, and documentation.
2. Implement Studio design-system authoring, colour/token selection, background,
   shadow, and two-axis sizing controls using Mosaic's design language.
3. Render each authored Screen or Sheet as its own connected editor frame, add
   Screen/Sheet creation and conversion, and preserve navigation relationships.
4. Implement exact RC4 decoding, validation, rendering, fallbacks, diagnostics,
   and navigation behavior in Flutter, SwiftUI, and Jetpack Compose.
5. Run protocol, Local Preview, Studio interaction, native renderer, fixture,
   accessibility, and regression checks before owner review.

## Acceptance criteria

- Protocol generation and validation are deterministic and all Protocol `0.1`
  immutability checks pass.
- The canonical RC4 fixture exercises tokens, both gradient kinds, image and
  video backgrounds, poster/colour fallback, shadows, height sizing, and Screen
  plus Sheet presentation.
- Studio can create, edit, reference, and detach supported document design
  values and exposes those values in relevant colour/background controls.
- Studio supports fit, fill, and fixed width and height, with fixed values only
  when fixed is selected.
- Adding a Screen or Sheet creates a separate device frame; navigation edges
  connect relevant frames; conversion preserves content and references.
- Flutter, SwiftUI, and Compose consume the same canonical fixtures and agree on
  media fallback, token resolution, unbounded fill, fixed clipping, and sheet
  history.
- Existing layer reordering, canvas selection/editing, contextual actions,
  product-card layout, and Protocol `0.2` component behavior do not regress.
- The product owner reviews the integrated Studio and all three native renderers
  before Phase 2.5C or Protocol `0.2` is described as accepted or approved.

## Explicit exclusions

Multiple fills/effects, multiple shadows, spread, video audio/controls,
arbitrary animation, freeform canvas positioning, project/server design-system
libraries, sheet detents/handles, and custom transitions remain deferred.
