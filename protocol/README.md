# Mosaic Protocol

Protocol `0.3` is Mosaic's single native-paywall contract, and is currently a
**release candidate**. It is platform-neutral and contains declarative data
only. Studio, Local Preview, Flutter, SwiftUI, and Jetpack Compose all consume
this exact version.

`0.3` replaced approved Protocol `0.2` outright: `0.2` was deleted rather than
deprecated, and there is no migration path. See ADR-0026. `0.3` stays a
candidate until the renderers, Studio, and the backend implement its four new
components — the outstanding gates are listed in
[the contract document](../docs/protocol/v0.3.md#what-must-pass-before-03-can-be-marked-approved).

Approved contracts are immutable: their behaviour is frozen and a behaviour
change requires a new contract version. A release candidate is not yet frozen
and may still take narrowing corrections. See
[versioning](../docs/protocol/versioning.md), the
[compatibility policy](../docs/protocol/compatibility-policy.md), and the
[breaking-change process](../docs/protocol/breaking-change-process.md).

Canonical artifacts live under:

```text
protocol/
├── browser/                    # browser validator and generated declarations
├── compatibility/v0.3.json
├── fixtures/
│   ├── local-preview/v0.3/
│   └── v0.3/
├── schema/
│   ├── local-preview/v0.3/
│   └── v0.3/
└── tools/                      # current validation and browser generation
```

The complete fixture covers Screen and Sheet presentation, navigation,
composable Button content and actions, Icon, generalized Stack, Carousel,
Switch, Countdown, Product Selector with authored Product Cards and Badges,
product templates, design tokens, gradients, media backgrounds, shadows,
visibility, and two-axis sizing. SDKs may package generated copies but must not
maintain hand-edited platform forks.

Local Preview is also `0.3` only and uses the exact WebSocket subprotocol
`mosaic.local-preview.v0.3`. A client must report Protocol `0.3` and every
required capability before Studio sends a draft. Accepted revisions reset
navigation, Carousel, Switch, and Product Selector runtime state from the new
document.

Configuration Delivery `1` is a separate immutable hosted-release envelope
around accepted Protocol `0.3` documents. Its schemas, compatibility manifest,
fixtures, atomic validation rules, and fallback behavior are documented in
`docs/protocol/configuration-delivery-v1.md`.

Placement Decision `1` is the separate deterministic local-evaluation contract
for advanced Placement Rules. Configuration Delivery `2` atomically carries
those Rule Sets with exact unchanged Protocol `0.3` Paywall Versions and
Product/Entitlement references. Delivery `1` remains available only as a safe
projection of an explicit default Paywall.

Commerce Provider Contracts `1` and `2` are separate provider-neutral contracts for
capabilities, verified Product resolution, localized commerce metadata,
purchase and restore outcomes, active Entitlement lookup, freshness, and safe
diagnostics. Version `2` additionally freezes native recovery modes,
asynchronous commerce updates, and idempotent local acceptance before native
finalization. Neither adds provider data to Paywall Protocol `0.3` or
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

Billing Ingestion Contract `1` is a separate **draft** server-facing contract
for observing, validating, and recording provider transactions. It proves a
transaction is authentic and associates it with a Mosaic Product; it decides no
customer access and contains no entitlement, subscription, or financial
vocabulary. Acceptance of an observation is explicitly not a validation claim,
and a client can never author a transaction fact. It is optional, adds nothing
to any existing contract, and is not generated into the browser contract.

Phase 9C adds three separate **draft**, server-facing contracts: Billing
Migration Operations `1`, Authoritative Entitlement `2`, and Billing State
Webhook `2`. Migration Operations freezes the RevenueCat-first operator
vocabulary. Entitlement v2 wraps the unchanged v1 snapshot body with explicit
application/platform authority scope and a monotonic epoch. Webhook v2 carries
matching authority metadata and transition notifications while preserving v1
delivery and signing. Customer Access Token `1`, Configuration Delivery `3`,
Commerce Provider, and Billing Ingestion `1` remain unchanged. These contracts
are not generated into browser declarations. Migration Operations also models
durable idempotent `sourcePull` jobs and a closed server-returned operator
capability vocabulary; those capability strings are affordance evidence only,
never authorization.

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
├── schema/billing-ingestion/v1/
├── compatibility/commerce-configuration/v1.json
├── compatibility/commerce-configuration/v2.json
├── compatibility/commerce-provider/v1.json
├── compatibility/commerce-provider/v2.json
├── compatibility/analytics-event/v1.json
├── compatibility/analytics-event/v2.json
├── compatibility/experiment-assignment/v1.json
├── compatibility/configuration-delivery/v3.json
├── compatibility/billing-ingestion/v1.json
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
├── fixtures/billing-ingestion/v1/
├── commerce-configuration/CHANGELOG.md
├── commerce/CHANGELOG.md
├── placement-decision/CHANGELOG.md
├── analytics/CHANGELOG.md
├── experiment/CHANGELOG.md
└── billing/CHANGELOG.md
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

- `docs/protocol/v0.3.md`
- `docs/protocol/local-preview-v0.3.md`
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
- `docs/protocol/billing-ingestion-v1.md` (draft contract)
- `docs/protocol/billing-migration-operations-v1.md` (draft contract)
- `docs/protocol/authoritative-entitlement-v2.md` (draft contract)
- `docs/protocol/billing-state-webhook-v2.md` (draft contract)
