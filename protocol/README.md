# Mosaic Protocol

Protocol `0.2` RC4 is Mosaic's single pre-release native-paywall contract. It
is platform-neutral and contains declarative data only. Studio, Local Preview,
Flutter, SwiftUI, and Jetpack Compose all consume this exact version.

Canonical artifacts live under:

```text
protocol/
├── browser/                    # browser validator and generated declarations
├── compatibility/v0.2.json
├── fixtures/
│   ├── local-preview/v0.2/
│   └── v0.2/
├── schema/
│   ├── local-preview/v0.2/
│   └── v0.2/
└── tools/                      # current validation and browser generation
```

The complete fixture covers Screen and Sheet presentation, navigation,
composable Button content and actions, Icon, generalized Stack, Carousel,
Switch, Countdown, Product Selector with authored Product Cards and Badges,
product templates, design tokens, gradients, media backgrounds, shadows,
visibility, and two-axis sizing. SDKs may package generated copies but must not
maintain hand-edited platform forks.

Local Preview is also `0.2` only and uses the exact WebSocket subprotocol
`mosaic.local-preview.v0.2`. A client must report Protocol `0.2` and every
required capability before Studio sends a draft. Accepted revisions reset
navigation, Carousel, Switch, and Product Selector runtime state from the new
document.

Configuration Delivery `1` is a separate immutable hosted-release envelope
around accepted Protocol `0.2` documents. Its schemas, compatibility manifest,
fixtures, atomic validation rules, and fallback behavior are documented in
`docs/protocol/configuration-delivery-v1.md`.

Placement Decision `1` is the separate deterministic local-evaluation contract
for advanced Placement Rules. Configuration Delivery `2` atomically carries
those Rule Sets with exact unchanged Protocol `0.2` Paywall Versions and
Product/Entitlement references. Delivery `1` remains available only as a safe
projection of an explicit default Paywall.

Commerce Provider Contracts `1` and `2` are separate provider-neutral contracts for
capabilities, verified Product resolution, localized commerce metadata,
purchase and restore outcomes, active Entitlement lookup, freshness, and safe
diagnostics. Version `2` additionally freezes native recovery modes,
asynchronous commerce updates, and idempotent local acceptance before native
finalization. Neither adds provider data to Paywall Protocol `0.2` or
Configuration Delivery `1`.

Commerce Configurations `1` and `2` are immutable sidecars that associate
one accepted Configuration Delivery release with an exact Application and
platform, selects one provider, and carries verified Product and Entitlement
mappings. Version `2` adds credential-free native activation, exact StoreKit
and Google Product/base-plan/offer mappings, and immutable Product grants.
Version `1` supports both backend Provider Connections and equivalently
verified SDK-local custom-provider snapshots without placing credentials or
customer data in delivered configuration.

Canonical Commerce artifacts live under:

```text
protocol/
├── schema/commerce-configuration/v1/
├── schema/commerce-configuration/v2/
├── schema/commerce-provider/v1/
├── schema/commerce-provider/v2/
├── schema/placement-decision/v1/
├── schema/configuration-delivery/v2/
├── compatibility/commerce-configuration/v1.json
├── compatibility/commerce-configuration/v2.json
├── compatibility/commerce-provider/v1.json
├── compatibility/commerce-provider/v2.json
├── fixtures/commerce-configuration/v1/
├── fixtures/commerce-configuration/v2/
├── fixtures/commerce-provider/v1/
├── fixtures/commerce-provider/v2/
├── fixtures/placement-decision/v1/
├── fixtures/configuration-delivery/v2/
├── commerce-configuration/CHANGELOG.md
├── commerce/CHANGELOG.md
└── placement-decision/CHANGELOG.md
```

## Generate and validate

From the repository root:

```bash
npm --prefix protocol ci
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```

Generation refreshes browser declarations from the canonical schemas.
Validation checks the current paywall, Local Preview, Delivery, Commerce
Provider, and Commerce Configuration schemas, fixtures, semantic invariants,
canonical digests, and browser generation drift.

See:

- `docs/protocol/v0.2.md`
- `docs/protocol/local-preview-v0.2.md`
- `docs/protocol/versioning.md`
- `docs/protocol/configuration-delivery-v1.md`
- `docs/protocol/commerce-provider-v1.md`
- `docs/protocol/commerce-configuration-v1.md`
- `docs/protocol/commerce-provider-v2.md`
- `docs/protocol/commerce-configuration-v2.md`
- `docs/protocol/placement-decision-v1.md`
- `docs/protocol/configuration-delivery-v2.md`
