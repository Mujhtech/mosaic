# Mosaic Protocol

Protocol `0.1` is the first draft of Mosaic's platform-neutral paywall contract.
It intentionally covers only the semantics used by the Phase 0 canonical fixture.

## Structure

```text
protocol/
├── compatibility/
│   └── v0.1.json
├── fixtures/
│   └── v0.1/
│       └── minimal-paywall.json
├── schema/
│   └── v0.1/
│       ├── compatibility-manifest.schema.json
│       └── paywall.schema.json
└── tools/
    ├── validate.mjs
    ├── validation.mjs
    └── validation.test.mjs
```

The only canonical fixture is
`fixtures/v0.1/minimal-paywall.json`. Consumers must load or package that file
from its canonical location instead of maintaining a second copy.

## Install and validate

From this directory:

```bash
npm install
npm run validate
npm test
npm run check
```

After `package-lock.json` exists, use `npm ci` for a clean reproducible install.
From the repository root, the complete check is:

```bash
npm --prefix protocol ci
npm --prefix protocol run check
```

`npm run validate` compiles both JSON Schemas, validates the fixture and
compatibility manifest, verifies canonical JSON formatting, and checks the
cross-file capability and product-selection invariants. `npm test` covers the
valid fixture plus representative invalid schema versions, components,
properties, compatibility declarations, and product selections.

See `docs/protocol/v0.1.md` for the contract and
`docs/protocol/versioning.md` for version handling.

