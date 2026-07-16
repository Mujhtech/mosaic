# SDK Conventions

## Native Rendering

Use:

- Flutter widgets
- SwiftUI
- Jetpack Compose

Do not use a WebView as the primary renderer.

## Shared Capabilities

Each SDK must provide:

- configuration
- caching
- bundled fallback
- placements
- rendering
- product loading
- purchasing
- restoration
- result types
- analytics batching
- diagnostics
- local preview
- capability reporting

## Product Data

Store product identifiers in configuration.

Resolve localized prices, periods, trials, and offers from the purchase provider at runtime.

## Failure Behaviour

SDK failures must:

- avoid crashing the host app
- expose diagnostics
- use cached or bundled fallback where possible
- avoid blocking purchases because events failed to send

## Public API

APIs should remain idiomatic to each language.

Conceptual behaviour should remain consistent even when method naming differs.

## Testing

Each SDK must run:

- decoding tests
- rendering tests
- snapshot or golden tests
- accessibility tests
- interaction tests
- fallback tests
- provider-adapter tests

---
