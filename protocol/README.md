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

## Generate and validate

From the repository root:

```bash
npm --prefix protocol ci
npm --prefix protocol run generate
npm --prefix protocol run validate
```

Generation refreshes the browser declarations from the canonical `0.2`
schemas. Validation checks the current paywall and Local Preview schemas,
fixtures, capability/reference invariants, message flow, runtime reset, and
browser generation drift.

See:

- `docs/protocol/v0.2.md`
- `docs/protocol/local-preview-v0.2.md`
- `docs/protocol/versioning.md`
