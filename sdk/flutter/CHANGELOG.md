# Changelog

## 0.1.0-dev.2

- Implement the strict Protocol 0.1 RC1 decoder and recursive semantic/capability validation.
- Add exact localization fallback and document-declared RTL direction resolution.
- Add native scroll, stack, text, image, feature, product, purchase, restore, close, and legal renderers.
- Add host-supplied logical bundled-image resolution with localized same-frame placeholders.
- Add product availability fallback, selection, runtime price/period display, and busy/disabled states.
- Add the exact sealed terminal presentation outcomes and interaction-only restore outcomes.
- Add deterministic mock purchase and restore scenarios, safe diagnostics, and capability reporting.
- Add local candidate-to-bundled fallback loading without remote or cached configuration.
- Add direct canonical-fixture, validation, localization, interaction, accessibility, asset, fallback,
  and true Flutter golden coverage.
- Add a top-level native Flutter example with generated canonical fallback and scenario controls.

## 0.1.0-dev.1

- Add the Phase 0 configuration API.
- Add strict protocol 0.1 models and canonical-fixture decoding tests.
- Enforce capability/content matching and product-selector cross-field constraints while decoding.
- Align numeric decoding with the canonical contract by accepting integral JSON revision values in
  the supported range and rejecting non-finite layout values.
- Add provider-neutral commerce result types and a deterministic mock provider.
- Add a configuration-only Flutter example; native paywall rendering remains out
  of scope until Phase 1.
