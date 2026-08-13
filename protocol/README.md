# Mosaic Protocol

Paywall Protocol `0.4` is Mosaic's native-paywall contract, and is currently a
**draft**. It is platform-neutral and contains declarative data only. Studio,
Local Preview, Flutter, SwiftUI, and Jetpack Compose all consume this exact
version.

**Every Mosaic contract carries exactly one version.** Mosaic is pre-GA, so a
contract change replaces its version rather than adding one beside it, and the
replaced version is deleted outright — schemas, fixtures, manifest, tools, docs,
and every reference, version-dispatch arm, projection, and version fallback that
named it. Parallel versions begin at GA. See
[ADR-0028](../docs/architecture/decisions/0028-single-version-contracts.md).

Approved contracts are immutable: their behaviour is frozen and a behaviour
change requires replacing the version. A draft carries no compatibility
guarantee at all. See [versioning](../docs/protocol/versioning.md), the
[compatibility policy](../docs/protocol/compatibility-policy.md), and the
[breaking-change process](../docs/protocol/breaking-change-process.md).

The complete contract set:

| Contract | Version | Status |
| --- | --- | --- |
| Paywall Protocol | `0.4` | draft |
| Local Preview (development-only) | `0.4` | draft |
| Configuration Delivery | `3` | approved |
| Placement Decision | `1` | approved |
| Experiment Assignment | `1` | approved |
| Analytics Event | `2` | approved |
| Commerce Provider Contract | `2` | approved |
| Commerce Configuration | `2` | approved |
| Billing Ingestion | `1` | draft |
| Customer Access Token | `1` | draft |
| Authoritative Entitlement | `2` | draft |
| Billing State Webhook | `2` | draft |
| Billing Migration Operations | `1` | draft |

Canonical artifacts live under:

```text
protocol/
├── browser/                                  # browser validator and generated declarations
├── compatibility/
│   ├── v0.4.json
│   ├── local-preview/v0.4.json
│   ├── configuration-delivery/v3.json
│   ├── placement-decision/v1.json
│   ├── experiment-assignment/v1.json
│   ├── analytics-event/v2.json
│   ├── commerce-provider/v2.json
│   ├── commerce-configuration/v2.json
│   ├── billing-ingestion/v1.json
│   ├── customer-access-token/v1.json
│   ├── authoritative-entitlement/v2.json
│   ├── billing-state-webhook/v2.json
│   └── billing-migration-operations/v1.json
├── fixtures/                                 # one directory per contract, mirroring the above
├── schema/                                   # one directory per contract, mirroring the above
└── tools/                                    # validation, generation, and the shared paywall rules
```

`protocol/tools/paywall-document-rules.mjs` holds the rules the paywall contract
carries at every version — identifiers, design system, assets, product
references, localization, layout and runtime, announcements, locale resolution.
It carries no version suffix on purpose: there is one implementation of each
rule, and `validation-v0.4.mjs` layers only what motion adds.

The complete paywall fixture covers Screen and Sheet presentation, navigation,
composable Button content and actions, Icon, generalized Stack, Carousel,
Switch, Countdown, Tabs, Timeline, Award, Social Proof, Product Selector with
authored Product Cards and Badges, product templates, design tokens, gradients,
media backgrounds, shadows, visibility, two-axis sizing, and the three motion
primitives. SDKs may package generated copies but must not maintain hand-edited
platform forks.

Local Preview `0.4` uses the exact WebSocket subprotocol
`mosaic.local-preview.v0.4`, and negotiation offers exactly that one. A client
must report Protocol `0.4` and every required capability before Studio sends a
draft. Accepted revisions reset navigation, Carousel, Switch, Tabs, and Product
Selector runtime state from the new document, and carry forward only
`motion.playedAppearScreens`.

Configuration Delivery `3` is the immutable hosted-release envelope. It carries
accepted Paywall Protocol `0.4` documents, atomic Placement Decision `1` Rule
Sets, exact Product and Entitlement references, and exact Experiment Assignment
`1` definitions. A release is accepted whole or rejected whole; there are no
projections to a narrower representation.

Placement Decision `1` is the deterministic local-evaluation contract for
advanced Placement Rules. Experiment Assignment `1` is the immutable,
deterministic, offline Variant-selection contract.

Commerce Provider Contract `2` is the provider-neutral contract for
capabilities, verified Product resolution, localized commerce metadata, purchase
and restore outcomes, active Entitlement lookup, freshness, safe diagnostics,
native recovery modes, asynchronous commerce updates, and idempotent local
acceptance before native finalization. It adds no provider data to the Paywall
Protocol or Configuration Delivery.

Commerce Configuration `2` is the immutable sidecar that associates one accepted
Configuration Delivery release with an exact Application and platform, selects
one provider, and carries verified Product and Entitlement mappings, including
credential-free native activation, exact StoreKit and Google
Product/base-plan/offer mappings, and immutable Product grants. It supports both
backend Provider Connections and equivalently verified SDK-local custom-provider
snapshots without placing credentials or customer data in delivered
configuration.

Analytics Event Contract `2` is the closed batch/event contract for Placement,
Paywall, Product, purchase, restore, and Experiment observations. It uses
event-time identity snapshots, stable correlation, immutable attribution,
authentication-derived authority, and per-event partial-batch results. Public
events contain no tenant or Application IDs; ingestion derives that scope from an
SDK key bound to one Application.

Billing Ingestion Contract `1` is a **draft** server-facing contract for
observing, validating, and recording provider transactions. It proves a
transaction is authentic and associates it with a Mosaic Product; it decides no
customer access and contains no entitlement, subscription, or financial
vocabulary. Acceptance of an observation is explicitly not a validation claim,
and a client can never author a transaction fact. It is optional and is not
generated into the browser contract.

Billing Migration Operations `1`, Authoritative Entitlement `2`, Customer Access
Token `1`, and Billing State Webhook `2` are **draft**, server-facing contracts.
Migration Operations freezes the RevenueCat-first operator vocabulary and models
durable idempotent `sourcePull` jobs plus a closed server-returned operator
capability vocabulary — those capability strings are affordance evidence only,
never authorization. Entitlement carries an explicit application/platform
authority scope and a monotonic epoch; the Webhook contract carries matching
authority metadata and transition notifications. None of these are generated
into browser declarations.

## Generate and validate

From the repository root:

```bash
npm --prefix protocol ci
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```

Generation refreshes browser declarations from the canonical schemas.
Validation checks every contract's schemas, fixtures, semantic invariants,
canonical digests, rejection-layer metadata, and browser generation drift.

See:

- `docs/protocol/v0.4.md`
- `docs/protocol/local-preview-v0.4.md`
- `docs/protocol/versioning.md`
- `docs/protocol/compatibility-policy.md`
- `docs/protocol/configuration-delivery-v3.md`
- `docs/protocol/placement-decision-v1.md`
- `docs/protocol/experiment-assignment-v1.md`
- `docs/protocol/analytics-event-v2.md`
- `docs/protocol/commerce-provider-v2.md`
- `docs/protocol/commerce-configuration-v2.md`
- `docs/protocol/billing-ingestion-v1.md` (draft contract)
- `docs/protocol/billing-migration-operations-v1.md` (draft contract)
- `docs/protocol/authoritative-entitlement-v2.md` (draft contract)
- `docs/protocol/billing-state-webhook-v2.md` (draft contract)
