# Changelog

## 0.1.0-dev.2

- Implement strict Protocol 0.1 RC1 models, recursive semantic validation, exact capability
  reporting, locale fallback resolution, and Arabic RTL direction.
- Generate the sole canonical fixture into the AAR as the Phase 1 bundled fallback without a
  committed Android fixture or schema copy.
- Add a native Jetpack Compose renderer for the complete Phase 1 component set, safe insets,
  direction-relative layout, font scaling, accessibility semantics, image placeholders, and a
  direction-relative scroll indicator.
- Add deterministic partial product loading, product selection fallback, configurable mock
  purchase/restore scenarios, busy states, safe diagnostics, interaction outcomes, and the exact
  normalized presentation result union.
- Add direct-fixture decoding, semantic rejection, localization, fallback, commerce, state,
  accessibility, RTL, placeholder, interaction, and screenshot baseline coverage.
- Add the standalone `examples/android-example` Compose app with scenario and locale controls.

## 0.1.0-dev.1

- Add the Phase 0 configuration API.
- Add strict protocol 0.1 models and canonical-fixture decoding tests.
- Enforce capability/content matching and product-selector cross-field constraints while decoding.
- Add conformance coverage for integral revision spellings, the canonical revision ceiling, and
  non-finite layout values.
- Add provider-neutral commerce result types and a deterministic mock provider.
- Configure the Android library for Jetpack Compose consumption; native paywall
  rendering remains out of scope until Phase 1.
