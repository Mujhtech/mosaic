# Mosaic Protocol

Protocol `0.1` RC1 is Mosaic's Phase 1 platform-neutral native-paywall
contract. The product owner accepted the unchanged RC1 bytes on 2026-07-17,
so this version is now the approved and immutable Protocol `0.1` baseline.

## Canonical artifacts

```text
protocol/
├── browser/
│   ├── generated/
│   │   └── contract-types.d.ts
│   ├── index.d.ts
│   └── index.js
├── compatibility/
│   └── v0.1.json
├── fixtures/
│   ├── local-preview/
│   │   └── v0.1/
│   │       ├── local-project.json
│   │       └── session-flow.messages.json
│   └── v0.1/
│       └── complete-paywall.json
├── schema/
│   ├── local-preview/
│   │   └── v0.1/
│   │       ├── local-project.schema.json
│   │       └── preview-message.schema.json
│   └── v0.1/
│       ├── compatibility-manifest.schema.json
│       └── paywall.schema.json
└── tools/
    ├── browser-contract-validation.mjs
    ├── browser-contract.test.mjs
    ├── generate-browser-contract.mjs
    ├── generate-local-preview-fixtures.mjs
    ├── preview-validation.mjs
    ├── preview-validation.test.mjs
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

The paywall schema contains declarative data only. It has no remote fetch,
executable content, arbitrary styling language, analytics, Studio metadata, or
real billing contract.

Local Preview `0.1` is a separate Phase 2 transport and local-project
contract. It carries the immutable paywall document without changing its
meaning and adds only local editor identity, ordered revisions, capability
reports, mock commerce, acknowledgements, and safe diagnostics. Its generated
fixtures derive their embedded paywall bytes from the single canonical RC1
fixture; they are not alternate paywall sources.

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
locales, products, and catalog invariants. It also compiles both Local Preview
schemas, validates all generated preview messages and local-project state, and
checks mock commerce and acknowledgement correlation. `npm test` covers the
valid RC1 and Local Preview contracts plus invalid input and fallback policy.

`browser/index.js` is the browser-safe canonical validation entry used by
Studio. It compiles the canonical schemas directly, enforces the same semantic
invariants as the Node validator, and returns structured diagnostics that can
select an affected component and property. Its adjacent declarations are
generated from the schemas; dashboard code must import these types and
validators instead of copying protocol interfaces or redefining validation.

Regenerate browser declarations after intentionally changing a canonical
schema:

```bash
npm run generate:browser-contract
```

Regenerate Local Preview fixtures after intentionally changing their source:

```bash
npm run generate:preview-fixtures
```

See `docs/protocol/v0.1.md` for normative semantics and
`docs/protocol/local-preview-v0.1.md` for the local editing, WebSocket,
diagnostic, import, and export contract. See `docs/protocol/versioning.md` for
candidate and approval handling.
