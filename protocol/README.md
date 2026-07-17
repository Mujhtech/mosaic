# Mosaic Protocol

Protocol `0.1` RC1 is Mosaic's Phase 1 platform-neutral native-paywall
contract. It is a release candidate at the Protocol review gate, not an
approved or immutable version.

## Canonical artifacts

```text
protocol/
├── compatibility/
│   └── v0.1.json
├── fixtures/
│   └── v0.1/
│       └── complete-paywall.json
├── schema/
│   └── v0.1/
│       ├── compatibility-manifest.schema.json
│       └── paywall.schema.json
└── tools/
    ├── validate.mjs
    ├── validation.mjs
    └── validation.test.mjs
```

`fixtures/v0.1/complete-paywall.json` is the only complete canonical RC1
paywall. It exercises the entire Phase 1 component set, nested layout,
provider-neutral products, a bundled image key and placeholder, English,
long German, Arabic RTL, accessibility metadata, product selection, purchase,
restore, close, and normalized outcomes. SDKs must consume or package that
file from its canonical path and must not maintain platform copies.

The schema contains declarative data only. It has no remote fetch, executable
content, arbitrary styling language, analytics, Studio, or real billing
contract.

## Install and validate

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

`npm run validate` compiles both JSON Schemas, validates the canonical fixture
and manifest, checks canonical JSON formatting, derives capabilities through
the recursive layout, and enforces cross-field IDs, references, actions,
locales, products, and catalog invariants. `npm test` covers the valid RC1
contract and invalid input for every Phase 1 contract area and fallback policy.

See `docs/protocol/v0.1.md` for normative semantics and
`docs/protocol/versioning.md` for candidate and approval handling.
