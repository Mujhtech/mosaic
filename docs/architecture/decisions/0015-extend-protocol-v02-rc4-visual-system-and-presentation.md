# ADR 0015: Extend Protocol 0.2 RC4 with a visual system and presentation modes

- Status: Accepted
- Date: 2026-07-18

## Context

Protocol `0.2` RC3 remained an unapproved release candidate. It could describe
composable buttons and authored product cards, but production authoring still
lacked reusable design values, gradients, media backgrounds, shadows, uniform
height sizing, and an explicit distinction between full screens and sheets.

These concepts must have one platform-neutral meaning across Studio, Flutter,
SwiftUI, and Jetpack Compose.

## Decision

Protocol `0.2` RC4 supersedes the unapproved RC3 candidate without changing the
exact `schemaVersion` value. Local Preview `0.2` carries RC4, and an explicit
deterministic RC3-to-RC4 recovery path is provided for unapproved local documents.

Every document contains a document-scoped `designSystem` with named colour,
background, and shadow catalogs. Each catalog contains at most 256 values.
References are strict and cycles or missing tokens reject the complete document.
The protocol does not depend on a server-side or project-wide token library and
does not permit executable expressions.

Backgrounds are a discriminated union of colour, linear gradient, radial
gradient, image, video, or background-token reference. Gradients contain two to
eight strictly ordered stops. Linear angles use a physical canvas convention:
zero degrees is left-to-right, 90 degrees is top-to-bottom, rotation is
clockwise, and RTL does not mirror the angle. Image and video backgrounds refer to declared
assets and define fit or fill behavior plus a fallback colour. Video is always
decorative: muted, autoplaying, looping, and without controls. A video failure
uses its poster when available, then its fallback colour, and emits a safe
diagnostic. Remote assets require safe HTTPS URLs; bundled and remote source
kinds are explicit capabilities.

Eligible box components support one inline shadow or shadow-token reference.
RC4 does not introduce multiple shadows or spread. Product Card and Product
Badge default and selected appearances use the same background and shadow
semantics.

Eligible boxes share one optional `sizing` object. When present, both `width`
and `height` are required and independently use `fit`, `fill`, or a positive
fixed value. Fixed sizing clips visual overflow while preserving accessibility
semantics. Fill in an unbounded axis falls back to fit with a diagnostic. Scroll
Container is excluded from this sizing contract.

Every screen declares `presentation.type` as `screen` or `sheet`, and the
initial screen must use `screen`. A sheet uses the platform's native modal
surface over the most recent screen and participates in the existing navigation
history. `navigateBack` pops or dismisses it. Converting between the two changes
only `presentation`; identifiers, content, and navigation references remain
stable.

Capabilities are exact and are required only when a document uses the
corresponding feature. Readers validate the closed document and its semantic
references atomically before rendering.

## Consequences

- Studio and all native renderers receive one deterministic styling, sizing,
  asset, and presentation contract.
- Portable documents carry their design system and remain independent of
  project storage or a particular UI framework.
- Media failure, token failure, unbounded layout, and sheet history have defined
  cross-platform behavior instead of renderer-specific guesses.
- RC3 candidate documents require the explicit recovery transform before they
  satisfy the RC4 schema.
- Implementations must report exact capabilities and may not partially render
  unsupported RC4 documents.

## Deferred

RC4 does not include multiple fills, multiple shadows or effects, shadow spread,
video audio or controls, arbitrary animation, a freeform canvas, project/server
design libraries, sheet detents or handles, or custom navigation transitions.
