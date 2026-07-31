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

Commerce Provider Contract `1` is a separate provider-neutral contract for
capabilities, verified Product resolution, localized commerce metadata,
purchase and restore outcomes, active Entitlement lookup, freshness, and safe
diagnostics. It does not add provider data to Paywall Protocol `0.2` or
Configuration Delivery `1`.

Canonical Commerce artifacts live under:

```text
protocol/
├── schema/commerce-provider/v1/
├── compatibility/commerce-provider/v1.json
├── fixtures/commerce-provider/v1/
└── commerce/CHANGELOG.md
```

## Generate and validate

From the repository root:

```bash
npm --prefix protocol ci
npm --prefix protocol run generate
npm --prefix protocol run validate
npm --prefix protocol test
```

Generation refreshes the browser declarations from the canonical `0.2`
schemas. Validation checks the current paywall and Local Preview schemas,
fixtures, capability/reference invariants, message flow, runtime reset, and
browser generation drift.

See:

- `docs/protocol/v0.2.md`
- `docs/protocol/local-preview-v0.2.md`
- `docs/protocol/versioning.md`
- `docs/protocol/configuration-delivery-v1.md`
- `docs/protocol/commerce-provider-v1.md`
