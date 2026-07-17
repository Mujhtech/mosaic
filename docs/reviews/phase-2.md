# Phase 2 Review Report

**Date:** 2026-07-17

**Gate:** Review Gate 2 — Studio and Local Preview

## Status

**Accepted with tracked follow-ups**

Phase 1 was accepted before Phase 2 began. The two prerequisite dashboard
findings were resolved first: the required `sidebar-07`, `login-05`, and
`signup-05` foundations were integrated using Base UI and Phosphor icons, and
the remaining Radix UI and Lucide application dependencies/imports were
removed. The updated Phase 1 report explicitly authorizes Phase 2.

Phase 2 now provides one constrained, account-free local Studio and three
native preview clients. An actual hydrated Studio browser session edited and
validated a paywall, sent it through the loopback WebSocket relay, received
exact post-render acknowledgements from running Flutter, SwiftUI, and Jetpack
Compose examples, recovered from a validation error, and exported a valid
Mosaic Protocol document.

The product review returned **Approve**. The final quality review returned
**Approve**, with no blocking or important correctness findings. No Phase 2.5
or Phase 3 feature was implemented.

## Completed deliverables

### Protocol

- Kept Mosaic Paywall Protocol `0.1` RC1 and its canonical fixture immutable.
- Added the separate, platform-neutral Local Preview `0.1` contract.
- Defined editable document IDs, local revisions, preview identities,
  capability reports, preview context, mock products, mock commerce state,
  compatibility warnings, safe diagnostics, and recovery actions.
- Defined all required WebSocket messages: client connected/disconnected,
  capability report, draft updated/accepted/rejected, validation error,
  render warning/failure, mock commerce changed, and heartbeat.
- Froze the exact WebSocket subprotocol as
  `mosaic.local-preview.v0.1` and the maximum frame/document bounds.
- Added canonical JSON Schemas, generated flow fixtures, local-project fixture,
  browser declarations, runtime validation, import/export validation, and
  compatibility tests.
- Preserved strict rejection and `keepLastAcceptedDraft` fallback semantics;
  the contract contains no platform-specific fields or executable payloads.

### Dashboard

- Added the `/studio` route and a feature-oriented paywall editor.
- Added template selection, the component tree, selection, insertion, removal,
  accessible reordering, property inspection, and inline localized text edits.
- Added constrained appearance/layout controls, locale selection, long German
  copy, Arabic RTL preview, device preview modes, and text scaling from
  `0.5×` through `3×`.
- Added mock product bindings, price/availability controls, purchase and restore
  outcomes, and mock entitlement state.
- Added component/property-addressed validation, compatibility warnings,
  connected-preview cards, acknowledgements, and expandable diagnostics.
- Added local autosave and recovery, undo/redo, keyboard shortcuts, raw JSON
  import/export, and the local-project file abstraction.
- Added a loopback-only WebSocket relay that enforces the preview subprotocol,
  message direction, client identity, capability-before-draft ordering, session
  isolation, and reconnect replay.
- Uses TanStack Start, Router, Query and Form, Tailwind CSS, shadcn/ui on Base
  UI, and `@phosphor-icons/react`. No Radix UI or Lucide application import or
  dependency remains.
- Added actual-browser and simultaneous-native demo harnesses. The browser
  harness drives the rendered Studio UI rather than bypassing the editor.

### Flutter

- Added local endpoint configuration and a local-only WebSocket transport.
- Added exact Local Preview `0.1` decoding/encoding, capability reporting,
  independent draft/commerce revision ordering, stale/conflict rejection,
  heartbeats, and bounded reconnect.
- Added live widget rerendering and post-render acknowledgement without an app
  rebuild.
- Added safe validation, compatibility, unsupported-component, warning, and
  rendering diagnostics while retaining the last accepted or bundled draft.
- Added mock product, purchase, restore, and entitlement updates.
- Added an example preview screen with connected, reconnecting, disconnected,
  invalid, unsupported, revision, locale, RTL, text-scale, and mock-commerce
  states.
- Added unit, widget, renderer, transport, protocol, commerce, accessibility,
  and real-relay tests.

### iOS

- Added the SwiftUI Local Preview `0.1` client using URLSession WebSockets and
  exact subprotocol negotiation.
- Added process-scoped preview identity, capability reporting, draft/commerce
  ordering, stale/conflict protection, heartbeats, and bounded reconnect.
- Added native live rerendering and acknowledgement only after SwiftUI mounts
  the revision.
- Added safe validation, unsupported-component, render-warning/failure, and
  product-fallback diagnostics while preserving the last safe document.
- Added mock products, purchases, restores, and entitlement state.
- Added a SwiftUI preview-status surface and example integration for all
  required connection, error, locale, RTL, text-scale, and commerce states.
- Removed a contradictory stale connection message from the active Connected
  status while retaining diagnostic history; a focused regression test covers
  the behavior.
- Added codec, commerce, lifecycle, renderer, accessibility, Simulator, and
  isolated real-relay tests.

### Android

- Added the Jetpack Compose Local Preview `0.1` client and emulator/host local
  endpoint configuration.
- Added exact message handling, capability reporting, independent revision
  ordering, stale/conflict rejection, heartbeat routing, and bounded reconnect.
- Added Compose live rerendering and post-render acknowledgement.
- Added validation, compatibility, unsupported-component, render, and commerce
  diagnostics with last-accepted/bundled fallback behavior.
- Added mock products, purchases, restores, and entitlement state.
- Added a native preview-status screen and example app covering connection,
  revision, invalid, unsupported, locale, RTL, text scale, and commerce states.
- Added JVM protocol/transport/state tests and Compose instrumentation tests,
  including accessibility and pixel-baseline coverage.

## UX review

### Dead ends

No blocking dead end remains:

- Template selection leads directly into the single editor workspace.
- A valid or recoverable autosave offers a clear resume action; a corrupt
  autosave explains how to continue safely.
- Invalid import leaves the open paywall unchanged and explains the next step.
- Invalid export selects the affected component and moves focus to the
  validation panel instead of silently failing.
- Validation issues name the affected property and provide a recovery action.
- Disconnect states expose reconnect information while preserving the draft.
- Unsupported native content retains the last accepted preview and explains
  the fallback and recovery.

### Terminology findings

- Primary UI language uses **paywall**, **content**, **preview**, **product**,
  and **local draft**, keeping protocol internals out of the main workflow.
- **Paywall order** is clearer than exposing the recursive protocol layout
  hierarchy.
- **Preview context** groups locale, direction, device, and text size without
  asking users to understand renderer implementations.
- Revisions, session IDs, capability IDs, JSON pointers, and machine codes are
  secondary diagnostic details rather than primary labels.
- No unresolved naming problem blocks the Phase 2 workflow.

### Click-reduction opportunities

- Template choice opens the editor directly with an initial selection.
- Selecting a block updates the inspector in place; editing does not navigate
  away from the preview.
- Move, remove, add, mock commerce, validation, and preview status remain on
  the same screen.
- Inline text editing avoids a separate localization screen for the common
  headline workflow.
- Undo, redo, reordering, and removal have keyboard shortcuts.
- The first validation issue is directly focusable from Export.

### Unresolved workflow issues

- Production drag-and-drop is deferred. Explicit up/down controls and keyboard
  reordering are accessible and satisfy Phase 2 component reordering.
- The `mosaic dev` convenience CLI is deferred. `npm run dev:studio` starts the
  same local Studio and relay and is the documented Phase 2 entry point.
- Phase 2 appearance controls intentionally expose only Protocol `0.1` layout
  properties. A broader color, typography, and token system belongs to the
  Phase 2.5 design-system freeze.

### Phase 2 UX acceptance criteria

- A first-time user can choose a template and begin editing without an account
  or external documentation.
- The editor preserves selection and context during edits and validation.
- Add, remove, reorder, edit, product binding, localization, mock commerce,
  import/export, undo/redo, and preview status remain discoverable on one
  workspace.
- Invalid, disconnected, unsupported, import, and autosave states all provide
  a safe recovery path.
- Long localization, RTL, and accessibility text scaling are directly
  previewable.

## Product review

### Phase fit

The work solves the approved Phase 2 problem: build a local native paywall
quickly, edit it safely, and see changes immediately on all three supported
renderers. Studio remains a constrained Protocol `0.1` block editor rather
than becoming a freeform design tool.

The primary workflow reduces time-to-first-paywall to template selection plus
direct editing. Acceptance criteria are observable through tests and the live
browser-to-native demo.

### Deferred scope

The following remain outside Phase 2:

- user accounts and authentication behavior beyond existing visual scaffolds;
- organizations, hosted projects, cloud storage, and cloud assets;
- remote publishing, releases, CDN delivery, and rollback;
- hosted analytics, experiments, and event infrastructure;
- real RevenueCat, StoreKit, or Google Play Billing integration;
- remote configuration fetching and placement evaluation;
- Phase 2.5 design tokens and Phase 3 hosted configuration work.

### Owner decisions

- Protocol `0.1` RC1 remains the immutable paywall meaning; Local Preview
  `0.1` is a separate transport contract.
- Portable import/export uses raw Protocol `0.1` JSON. Local editor metadata
  and mock commerce remain in the local autosave wrapper.
- Accessible up/down and keyboard movement is accepted for Phase 2; richer
  drag-and-drop remains a tracked follow-up.
- `npm run dev:studio` is accepted as the local entry point for this phase; the
  `mosaic dev` wrapper remains deferred.
- Product review result: **Approve**.
- Quality review result: **Approve**.

## Engineering review

### Agent coordination and ownership

The mandated two waves were used, with exactly four agents per wave and no
more than four concurrent subagents:

| Wave | Agent | Owned scope | Result |
| --- | --- | --- | --- |
| A | `mosaic_protocol` | protocol, fixtures, protocol docs | Complete |
| A | `mosaic_dashboard` | dashboard and frontend docs | Complete |
| A | `mosaic_flutter` | Flutter SDK/example/docs | Complete |
| A | `mosaic_ux` | read-only UX review | Complete |
| B | `mosaic_ios` | iOS SDK/example/docs | Complete |
| B | `mosaic_android` | Android SDK/example/docs | Complete |
| B | `mosaic_product` | read-only product review | Approve |
| B | `mosaic_quality` | read-only integration review | Approve |

Agent summaries and changed paths were reviewed after each wave. No agent
implemented another platform's SDK or redefined the canonical protocol in a
dashboard or SDK path. Small cross-cutting integration fixes were made by the
orchestrator only after the wave reports.

### Tests run

| Area | Check | Result |
| --- | --- | --- |
| Protocol | schema/fixture/browser validation and compatibility suite | Pass, 108/108 |
| Dashboard | Prettier, ESLint, TypeScript | Pass |
| Dashboard | editor, import/export, autosave, undo/redo, validation, connection tests | Pass, 50/50 |
| Dashboard relay | handshake, routing, identity, direction, cache and isolation tests | Pass, 6/6 |
| Dashboard build | TanStack Start client and SSR production builds | Pass |
| Browser workflow | hydrated `/studio` UI through headless Chromium/CDP | Pass |
| Flutter SDK | Dart format and `flutter analyze --no-pub` | Pass |
| Flutter SDK | full unit/widget/golden/accessibility suite with real relay enabled | Pass, 83/83 |
| Flutter example | analyzer and widget test | Pass, 1/1 |
| Flutter example | iOS Simulator debug build | Pass |
| iOS SDK | strict Swift formatting | Pass |
| iOS SDK | full Swift package suite with real relay enabled | Pass, 59/59 |
| iOS example | iPhone 17 Pro Simulator build, install and launch | Pass |
| iOS Simulator | renderer, status, large-text and example integration suite | Pass, 6/6 |
| Android SDK | debug AAR, instrumentation APK and lint | Pass |
| Android SDK | JVM protocol, transport, commerce and state tests | Pass, 52/52 |
| Android emulator | Compose instrumentation suite on Pixel 3a API 34 | Pass, 7/7 |
| Android example | debug APK build and live launch | Pass |
| API regression | `go test ./...` and `go vet ./...` | Pass |
| Repository | `git diff --check` | Pass |
| Repository | canonical Protocol `0.1` schema/fixture immutability | Pass |
| Repository | Radix UI and Lucide dependency/import scan | Pass, none found |
| Repository | non-dependency `.DS_Store` scan | Pass, none found |

The browser workflow reported three connected native clients and three exact
post-render acknowledgements. Compose UI inspection and a rebuilt SwiftUI
Simulator app visibly showed the browser-edited headline and yearly product;
the simultaneous native run also captured Flutter rendering and acknowledgement.

### Unavailable checks

- Physical-device builds, signing, and local-network preview were not run;
  Simulator/emulator loopback paths were used.
- Manual VoiceOver and TalkBack sessions on physical hardware were not run;
  automated native accessibility, large-text, semantics, and target-size tests
  passed.
- No Kotlin formatting task is configured. Android lint and compilation passed.
- Real store-provider checks were intentionally unavailable because real
  billing is explicitly excluded from Phase 2.

### Compatibility matrix

| Behavior | Flutter | SwiftUI | Compose |
| --- | --- | --- | --- |
| Immutable Protocol `0.1` document decode | Pass | Pass | Pass |
| `mosaic.local-preview.v0.1` negotiation | Pass | Pass | Pass |
| Client identity and capability report | Pass | Pass | Pass |
| Draft and commerce revision ordering | Pass | Pass | Pass |
| Stale/conflicting revision protection | Pass | Pass | Pass |
| Live native rerender without rebuild | Pass | Pass | Pass |
| Exact post-render `draftAccepted` | Pass | Pass | Pass |
| Bounded reconnect and heartbeat | Pass | Pass | Pass |
| Validation and unsupported diagnostics | Pass | Pass | Pass |
| Last-accepted/bundled fallback | Pass | Pass | Pass |
| Mock products, purchase, restore, entitlement | Pass | Pass | Pass |
| Long locale, RTL, and text scale | Pass | Pass | Pass |
| Simultaneous real Studio revision | Pass | Pass | Pass |

### Known defects

No known defect blocks Phase 2 acceptance.

- The example applications deliberately demonstrate missing-asset fallback;
  an associated safe render warning is expected, not a failed revision.
- Physical-device networking can differ from emulator/simulator loopback and
  remains a release-matrix follow-up.

### Technical debt

- Optimize Studio's approximately 129 kB gzip browser bundle, much of which is
  canonical browser-side schema validation.
- Move simultaneous native real-relay and physical-device accessibility checks
  into the future CI/release matrix.
- Add a multi-error regression before broadening the component-wide canonical
  diagnostic suppression in `collectEditorValidation`.
- Implement production drag-and-drop and the `mosaic dev` convenience wrapper
  only in an explicitly approved later scope.

## Demo review

**The one-minute demo succeeds.**

The final automated proof exercised the actual Studio UI in this order:

1. Started local Studio and the loopback relay.
2. Selected the **Focused offer** paywall template.
3. Changed the headline to **Edit once, preview natively everywhere**.
4. Moved the headline after the subtitle.
5. Changed product selection through monthly and then yearly.
6. Selected mock purchase success and observed Flutter, SwiftUI, and Compose
   report capabilities, render the revision, and each show **Updated**.
7. Emptied the headline and observed exactly one actionable
   **Visible text cannot be empty** validation issue.
8. Fixed the issue without leaving the editor and returned to **Ready** with
   three of three previews updated.
9. Exported `focused-offer.mosaic.json` and validated it as raw Protocol `0.1`
   JSON with the edited headline, reordered content, and yearly selection.

The deterministic browser run completed in 2.01 seconds. More importantly,
every required user-visible step fits comfortably inside a human-paced minute.

## Decision

**Proceed to Phase 2.5**

This is the Phase 2 gate decision only. No Phase 2.5 or Phase 3 implementation
has started, and new work still requires explicit product-owner approval.
