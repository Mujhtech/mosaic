# Mosaic Protocol

Protocol `0.2` is Mosaic's single **approved** native-paywall contract, as of
Mosaic v1 GA. It is platform-neutral and contains declarative data only. Studio,
Local Preview, Flutter, SwiftUI, and Jetpack Compose all consume this exact
version.

Approved contracts are immutable: their behaviour is frozen and a behaviour
change requires a new contract version. See
[versioning](../docs/protocol/versioning.md), the
[compatibility policy](../docs/protocol/compatibility-policy.md), and the
[breaking-change process](../docs/protocol/breaking-change-process.md).

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

Analytics Event Contract `1` is a separate closed batch/event contract for
Placement, Paywall, Product, purchase, and restore observations. It uses
event-time identity snapshots, stable correlation, immutable attribution,
authentication-derived authority, and per-event partial-batch results. Public
events contain no tenant or Application IDs; ingestion derives that scope from
an SDK key bound to one Application. It does not modify delivery, decision,
Paywall, or commerce contracts.

Experiment Assignment Contract `1` is a separate immutable, deterministic,
offline Variant-selection contract. Configuration Delivery `3` retains the
complete Delivery `2` snapshot and atomically adds Assignment v1 definitions
with exact Experiment feature, algorithm, and trusted-time negotiation. SDKs
without Experiment support receive unchanged normal Placement behavior through
a safe Delivery `2` projection.

Analytics Event Contract `2` is a backward-compatible separate revision that
adds explicit Experiment assignment, successful-presentation exposure,
fallback-presentation, and assignment-failure events plus immutable Experiment
attribution on Product selection and purchase lifecycle observations. Event
Contract `1` remains unchanged and accepted beside v2.

Canonical Commerce artifacts live under:

```text
protocol/
├── schema/commerce-configuration/v1/
├── schema/commerce-configuration/v2/
├── schema/commerce-provider/v1/
├── schema/commerce-provider/v2/
├── schema/placement-decision/v1/
├── schema/configuration-delivery/v2/
├── schema/analytics-event/v1/
├── schema/analytics-event/v2/
├── schema/experiment-assignment/v1/
├── schema/configuration-delivery/v3/
├── compatibility/commerce-configuration/v1.json
├── compatibility/commerce-configuration/v2.json
├── compatibility/commerce-provider/v1.json
├── compatibility/commerce-provider/v2.json
├── compatibility/analytics-event/v1.json
├── compatibility/analytics-event/v2.json
├── compatibility/experiment-assignment/v1.json
├── compatibility/configuration-delivery/v3.json
├── fixtures/commerce-configuration/v1/
├── fixtures/commerce-configuration/v2/
├── fixtures/commerce-provider/v1/
├── fixtures/commerce-provider/v2/
├── fixtures/placement-decision/v1/
├── fixtures/configuration-delivery/v2/
├── fixtures/analytics-event/v1/
├── fixtures/analytics-event/v2/
├── fixtures/experiment-assignment/v1/
├── fixtures/configuration-delivery/v3/
├── commerce-configuration/CHANGELOG.md
├── commerce/CHANGELOG.md
├── placement-decision/CHANGELOG.md
├── analytics/CHANGELOG.md
└── experiment/CHANGELOG.md
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
- `docs/protocol/analytics-event-v1.md`
- `docs/protocol/experiment-assignment-v1.md`
- `docs/protocol/configuration-delivery-v3.md`
- `docs/protocol/analytics-event-v2.md`
