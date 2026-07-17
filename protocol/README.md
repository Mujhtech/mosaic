# Mosaic Protocol

Protocol `0.1` is Mosaic's immutable Phase 1 native-paywall baseline. Protocol
`0.2` RC1 is the release-candidate constrained component-and-style expansion.
Both are exact, platform-neutral contracts; readers support versions
explicitly. Protocol `0.2` is not approved until all SDK and Studio conformance
gates pass.

Canonical versioned artifacts live under:

```text
protocol/
├── browser/                         # browser-safe validators and generated types
├── compatibility/
│   ├── v0.1.json
│   └── v0.2.json
├── fixtures/
│   ├── local-preview/{v0.1,v0.2}/
│   ├── v0.1/complete-paywall.json
│   └── v0.2/
│       ├── complete-paywall.json
│       ├── migrated-v0.1.json
│       ├── edge-cases.json
│       ├── expired-countdown.json
│       ├── hidden-purchase-target.json
│       └── invalid/noncanonical-color.json
├── schema/
│   ├── local-preview/{v0.1,v0.2}/
│   ├── v0.1/
│   └── v0.2/
└── tools/                           # generation, migration, validation, and tests
```

The 0.1 fixture remains the only complete canonical 0.1 paywall and its bytes
must not change. The 0.2 complete fixture is the cross-platform conformance
source for generalized Stack, Carousel, Switch, Countdown, constrained colors
and boxes, bounded typography, visibility, Product Selector direction, and
Product Card states. SDKs may
package generated copies but must not maintain hand-edited platform forks.

All versions contain declarative data only. Protocol 0.2 does not add CSS,
freeform position, rotation, multi-paint, project token catalogs, executable
code, Carousel autoplay/loop, or Countdown actions.

Local Preview is separately versioned. Local Preview 0.1 embeds only Protocol
0.1. Peers choose the highest mutually supported Local Preview subprotocol.
Local Preview 0.2 embeds only Protocol 0.2; a negotiated 0.1 connection must
withhold a 0.2 draft and keep its last accepted value. The browser entry
validates both exact versions and returns structured editor-addressable
diagnostics.

## Install, generate, and validate

From this directory:

```bash
npm ci
npm run check
```

From the repository root:

```bash
npm --prefix protocol ci
npm --prefix protocol run check
```

`npm run validate` compiles all Protocol and Local Preview schemas, checks
canonical, migrated, edge, and invalid fixtures, validates capability and
reference invariants, verifies generation drift, and checks Local Preview
message correlation, negotiation, recovery, and accepted-revision runtime
reset. `npm test` covers valid and invalid contract behavior, migration
determinism, browser/Node parity, and byte hashes for immutable 0.1 artifacts.

Regenerate repository-owned outputs with:

```bash
npm run generate:preview-fixtures
npm run generate:v0.2-fixtures
npm run generate:preview-v0.2-contract
npm run generate:browser-contract
```

Or run the complete deterministic sequence:

```bash
npm run generate
```

See:

- `docs/protocol/v0.1.md`
- `docs/protocol/v0.2.md`
- `docs/protocol/migration-v0.1-to-v0.2.md`
- `docs/protocol/local-preview-v0.1.md`
- `docs/protocol/local-preview-v0.2.md`
- `docs/protocol/versioning.md`
