# Mosaic Local Preview Contract 0.2

Local Preview `0.2` is the local transport and project-file companion to
Paywall Protocol `0.2` RC4.

Canonical artifacts:

- `protocol/schema/local-preview/v0.2/preview-message.schema.json`
- `protocol/schema/local-preview/v0.2/local-project.schema.json`
- `protocol/fixtures/local-preview/v0.2/session-flow.messages.json`
- `protocol/fixtures/local-preview/v0.2/local-project.json`
- `protocol/fixtures/local-preview/v0.2/accepted-revision-runtime-reset.json`

## Connection contract

Every peer uses `mosaic.local-preview.v0.2`, and every envelope uses
`previewProtocolVersion: "0.2"`. A local project uses
`fileFormatVersion: "0.2"`. With no supported subprotocol, the relay rejects
the connection rather than translating or downgrading the document.

Before Studio sends a draft, the client capability report must:

- include `0.2` in `supportedSchemaVersions`;
- include every document capability at exact version `0.2`;
- include every Local Preview capability at exact version `0.2`; and
- declare a document byte limit large enough for the complete draft.

Missing or malformed capability reports withhold the draft atomically. The
relay never fetches media, expands design tokens, or rewrites presentation.

## Runtime behavior

Document and mock-commerce revisions are ordered independently. A rejected
revision never replaces the last accepted revision. Once a new document is
accepted, Screen/Sheet navigation, Carousel pages, Switch values, and Product
Selector selection reset from that document. Countdown time is recomputed from
the preview device clock.

The example applications show explicit connecting, waiting-for-design, and
cannot-connect states before the first accepted revision. They do not render a
bundled fallback during a Studio demo.

Portable import/export uses raw Protocol `0.2` JSON. Browser validation and all
native clients accept only the current exact version.
