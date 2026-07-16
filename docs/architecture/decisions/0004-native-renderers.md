# ADR-0004: Use Native Renderers

## Status

Accepted

## Date

2026-07-16

## Context

Mosaic must render paywalls on Flutter, iOS, and Android while preserving accessibility, performance, design-system integration, and platform behaviour.

## Decision

Use:

- Flutter widgets for Flutter
- SwiftUI for iOS
- Jetpack Compose for Android

Do not use a WebView as the primary paywall renderer.

## Consequences

### Benefits

- native accessibility
- native performance
- custom native components
- platform-appropriate behaviour
- better application integration

### Trade-offs

- three renderers must be maintained
- conformance testing is required
- visual output will not be pixel-identical

## Alternatives Considered

- shared WebView renderer
- React Native renderer for every platform
- generated static native code

---
