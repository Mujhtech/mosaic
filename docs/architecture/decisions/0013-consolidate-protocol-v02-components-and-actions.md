# ADR-0013: Consolidate Protocol 0.2 Components and Actions

## Status

Accepted

## Date

2026-07-18

## Context

Mosaic Protocol `0.2` RC1 expanded styling and component coverage before the
version was approved. Cross-platform implementation planning exposed three
contract problems that were still safe to correct at the release-candidate
stage:

* one top-level layout could not express bounded native multi-step paywalls;
* separate Purchase, Restore, and Close component kinds duplicated layout,
  styling, loading, and accessibility behavior; and
* content and action semantics did not include a platform-neutral icon or safe
  links to external HTTPS destinations.

Solving these independently in Flutter, SwiftUI, Compose, or Studio would
create platform forks. Reusing framework widget, symbol, or navigation names
would also violate the platform-neutral protocol boundary.

Protocol `0.1` is already approved and immutable. Any consolidation therefore
must apply only to the unapproved `0.2` release candidate and must retain an
explicit deterministic `0.1` migration.

## Decision

Protocol `0.2` RC2 supersedes RC1 before approval.

RC2 replaces the top-level layout with `initialScreenId` and one through ten
closed screens. Screen IDs use their own namespace; component IDs remain
globally unique. All screens must be reachable from the initial screen and the
forward `navigateTo` graph must be acyclic. Navigation history is a renderer
runtime stack rooted at the initial screen and resets when an accepted revision
is applied.

RC2 defines one Button component with passive child content, one merged
accessibility target, a closed action, and optional Purchase/Restore loading
content. It removes the `0.2` Purchase Button, Restore Button, and Close Button
component kinds. The actions remain explicit and provider-neutral.

RC2 uses Text for all textual content, including migrated `0.1` Legal Text. It
adds an Icon component with a closed semantic name set; directional names
mirror in RTL and never expose platform resource identifiers.

The closed Button action set is Purchase, Restore, Close, Navigate To,
Navigate Back, and Open External URL. Product Selector and Switch references
resolve within the source screen. External URLs must be absolute HTTPS URLs,
must not contain credentials or control characters, and do not create a
presentation outcome. A root Navigate Back and a failed external open remain
safe, visible no-op paths with diagnostics.

The canonical JSON Schema, compatibility manifest, semantic validators,
migration, fixtures, Local Preview contract, browser declarations, and all
three native renderers must implement these semantics as one contract.
Protocol and Local Preview `0.1` artifacts remain byte-for-byte unchanged.

## Consequences

### Benefits

* bounded multi-step paywalls have one cross-platform navigation model;
* Button layout, loading, accessibility, styling, and actions no longer drift
  across specialized component kinds;
* icons and external links remain semantic and independent of native APIs;
* canonical fixtures can exercise the same interactions on all renderers; and
* strict reachability, acyclicity, reference, and URL validation fail safely
  before rendering.

### Trade-offs

* every `0.2` RC1 implementation and fixture must move to RC2 before approval;
* Button renderers must merge descendant semantics into one accessibility
  target while still laying out passive descendants natively;
* renderers must maintain a small navigation-history state machine; and
* Studio must enforce global component IDs and screen-local references.

## Alternatives Considered

### Approve RC1 and add screens in Protocol 0.3

Rejected because RC1 was not approved and would make Mosaic ship specialized
components known to require immediate replacement.

### Keep specialized action components alongside Button

Rejected because two authoring models for identical actions create migration,
styling, accessibility, and renderer ambiguity.

### Use platform icon or navigation identifiers

Rejected because SwiftUI, Jetpack Compose, and Flutter do not share stable
native resource names or navigation APIs.

### Permit arbitrary URLs or executable callbacks

Rejected because they weaken safe remote configuration. The contract remains
closed, declarative, HTTPS-only, and free of executable remote code.
