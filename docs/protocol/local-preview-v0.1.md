# Mosaic Local Preview Contract 0.1

## Status and boundary

Local Preview `0.1` is the frozen Phase 2 integration contract for the local
Studio and native preview clients. It is separate from the approved and
immutable Mosaic Paywall Protocol `0.1` RC1.

The preview contract transports an unchanged Protocol `0.1` document, local
editor metadata, mock commerce state, acknowledgements, and safe diagnostics.
It does not add paywall components or change rendering semantics. It contains
no accounts, organizations, hosted projects, authentication, publishing,
analytics, experiments, real billing provider data, remote code, or platform-
specific fields.

Canonical artifacts:

- message schema:
  `protocol/schema/local-preview/v0.1/preview-message.schema.json`
- local project schema:
  `protocol/schema/local-preview/v0.1/local-project.schema.json`
- complete generated message flow:
  `protocol/fixtures/local-preview/v0.1/session-flow.messages.json`
- generated local project:
  `protocol/fixtures/local-preview/v0.1/local-project.json`

The schema identifier is
`urn:mosaic:protocol:schema:local-preview:v0.1:message`. The WebSocket
subprotocol is `mosaic.local-preview.v0.1`. Version identifiers are exact; a
peer that does not support `0.1` must not guess compatibility.

## Transport envelope

Every WebSocket text frame contains exactly one UTF-8 JSON object:

```json
{
  "previewProtocolVersion": "0.1",
  "messageId": "msg_000004",
  "sessionId": "session_phase2_demo",
  "sentAt": "2026-07-17T08:00:00Z",
  "type": "draftUpdated",
  "payload": {}
}
```

All six envelope fields are required. Every object is closed and rejects
unknown properties. `messageId` is unique within a session and is used only
for tracing and de-duplication. `sessionId` routes one local Studio session; it
is not an account, user identifier, credential, or authorization token.
`sentAt` is diagnostic metadata only. Clock time must never decide draft or
commerce ordering.

Implementations must:

- accept JSON text frames only and reject binary frames;
- use one message per frame;
- cap a frame at 2 MiB;
- default `maxDocumentBytes` to 1 MiB and obey a lower client-reported limit;
- reject malformed JSON, unknown versions, unknown types, and unknown fields;
- never execute data carried by a message; and
- keep the connection local-development-only.

## Message directions and payloads

| Type | Direction | Required payload |
| --- | --- | --- |
| `previewClientConnected` | client to server; relayed to Studio | `client` |
| `previewClientDisconnected` | client best effort or server synthesized; relayed to Studio | `clientId`, `reason` |
| `capabilityReport` | client to server; relayed to Studio | `clientId`, `supportedSchemaVersions`, `supportedCapabilities`, `previewCapabilities`, `limits` |
| `draftUpdated` | Studio/server to client | `editableDocumentId`, `revision`, `document`, `preview` |
| `draftAccepted` | client to server; relayed to Studio | `clientId`, `editableDocumentId`, `revision` |
| `draftRejected` | client to server; relayed to Studio | `clientId`, `editableDocumentId`, `revision`, `reason`, `diagnostics` |
| `validationError` | client to server; relayed to Studio | `clientId`, `editableDocumentId`, `revision`, `errors` |
| `renderWarning` | client to server; relayed to Studio | `clientId`, `editableDocumentId`, `revision`, `warnings` |
| `renderFailure` | client to server; relayed to Studio | `clientId`, `editableDocumentId`, `revision`, `failure` |
| `mockCommerceStateChanged` | Studio/server to client | `editableDocumentId`, `stateRevision`, `state` |
| `previewHeartbeat` | bidirectional | `clientId`, `kind`, `sequence` |

The JSON Schema is normative for exact enums, bounds, identifier patterns,
and nested fields.

## Connection sequence

1. The native client opens a socket using `mosaic.local-preview.v0.1`.
2. Its first application message is `previewClientConnected`.
3. It immediately sends `capabilityReport`.
4. The server does not send a draft until it has a valid capability report.
5. The server sends the latest mock commerce state and latest draft.
6. The client validates the draft and its compatibility before rendering.
7. The client sends `draftAccepted` only after the revision is live on screen.
8. On validation or compatibility failure it sends the detailed diagnostic
   message followed by `draftRejected`.
9. On a rendering failure it sends `renderFailure` followed by
   `draftRejected` with reason `renderFailed`.

Warnings may accompany an accepted revision. A blocking compatibility warning
must reject the revision. Rejection or rendering failure preserves the last
accepted draft on screen; a failed update must not blank or partially mutate
the preview.

The detailed `validationError` or `renderFailure` and its terminal
`draftRejected` share `clientId`, editable document, local revision, and
diagnostic code. Studio correlates those fields and presents one error, not two.
The detailed event is authoritative for copy, location, fallback, and recovery;
the rejection is authoritative for terminal revision status. When a rejection
repeats diagnostics, its recovery action and message must match the detailed
event.

## Preview client identity

`previewClientConnected.payload.client` contains:

```json
{
  "clientId": "client_flutter_example",
  "displayName": "Flutter example preview",
  "renderer": {
    "id": "mosaic.flutter",
    "version": "0.1.0"
  },
  "application": {
    "id": "mosaic.flutter.example",
    "displayName": "Mosaic Flutter Example",
    "version": "0.1.0"
  },
  "device": {
    "displayName": "Local preview device",
    "systemName": "Example OS",
    "systemVersion": "1.0"
  }
}
```

The structure is renderer-neutral. Values can identify any implementation,
but no framework gets a dedicated field. `clientId` is stable for the lifetime
of one running application process, including socket reconnects. It must not be
derived from a hardware advertising identifier, user identity, or other
persistent personal identifier.

## Capability reports

`supportedSchemaVersions` lists exact Mosaic Paywall Protocol versions.
`supportedCapabilities` lists exact capability name/version pairs from the
paywall compatibility manifest plus any app-owned registered capability. A
first-party Phase 1 renderer reports every capability in
`protocol/compatibility/v0.1.json` at version `0.1`.

First-party Phase 2 preview clients report this full `previewCapabilities` set
at version `0.1`:

- `preview.liveUpdate`
- `preview.mockCommerce`
- `preview.localeOverride`
- `preview.textScale`
- `preview.diagnostics`

Studio compares the draft's exact schema and required capabilities with every
connected client. A missing schema version or required capability creates a
blocking compatibility warning with fallback `keepLastAcceptedDraft`. Studio
must not present an incompatible client as successfully updated.

## Editable documents and local revisions

`editableDocumentId` identifies one local editor document independently of the
paywall document's Protocol `id`. It contains no hosted project or account
meaning.

A local revision is:

```json
{
  "revisionId": "revision_000042",
  "sequence": 42
}
```

The sequence is the ordering authority for one `editableDocumentId` in one
preview session. `revisionId` uniquely identifies the mutation. The paywall
document's own `revision` is not used for WebSocket ordering and need not equal
the local sequence.

Each client tracks the highest seen sequence per editable document:

- a greater sequence is validated and may be applied;
- a lower sequence is rejected with reason `staleRevision`;
- the same sequence and same `revisionId` is an idempotent duplicate and the
  client repeats its prior acknowledgement without rerendering;
- the same sequence with a different `revisionId` is rejected with reason
  `revisionConflict`.

The highest-seen value advances even when validation or rendering rejects the
revision. Undo and redo create new increasing local revisions; they never
reuse the revision being restored. A reconnect to the same session retains
ordering state for the running client process. A new session starts fresh.

## Draft validation and acknowledgement

`draftUpdated.payload.document` is structurally constrained by the immutable
Protocol `0.1` paywall schema. Clients still perform all semantic validation,
including identifiers, references, localization catalogs, capabilities, and
size limits.

`preview` has exactly:

- `locale`: a requested Protocol locale; normal Protocol fallback and
  direction rules still apply; and
- `textScale`: a platform-neutral factor from `0.5` through `3`.

Choosing a long locale, an RTL locale, or an accessibility scale therefore
does not mutate the paywall document. There is no direction override: direction
continues to come from the selected locale catalog.

`draftAccepted` means the exact revision passed validation and is the live
rendered revision. Receipt, decoding, or queued work is not acceptance.

## Diagnostics and recovery

Validation diagnostics contain:

- stable machine `code`;
- bounded, single-line, user-safe `message`;
- `location.documentPath` as an RFC 6901 JSON Pointer;
- optional `location.componentId` and `location.property`; and
- required `recovery` with a closed action and safe message.

Compatibility warnings additionally contain `severity`, explicit `fallback`,
and an optional capability. Render failures always declare
`keepLastAcceptedDraft`.

Studio should use `componentId`, `property`, and `recovery.action` to select the
affected block and offer a direct fix. Machine codes, JSON Pointers, revisions,
and client details belong in expandable diagnostics, not primary error copy.

Diagnostic payloads must never include:

- credentials, tokens, API keys, or billing-provider payloads;
- user or account data;
- absolute file paths or local usernames;
- stack traces, exception dumps, SQL, or raw internal errors;
- complete source documents; or
- arbitrary executable recovery commands.

Implementations map internal errors to stable codes and sanitized messages
before transmission. If sanitization is uncertain, use a generic safe message.

## Compatibility and fallback behavior

The preview transport does not weaken Protocol `0.1` reader policy:

- an unknown schema, component, property, capability, or invalid reference
  rejects the whole incoming revision;
- an unsupported component is reported with its component ID, document path,
  missing capability, and a recovery action;
- the preview keeps the last accepted draft after rejection;
- a missing bundled asset uses its declared asset fallback and emits a warning;
- unavailable products use the selector fallback and emit a warning; and
- no client performs best-effort partial rendering of an invalid document.

## Mock commerce

Mock commerce is local preview data, not part of a portable paywall and not a
real billing-provider contract. Each state contains:

- exactly one mock product for each document product reference;
- deterministic purchase and restore outcomes; and
- initial mock entitlement state.

Available products are either subscriptions with billing period or
non-consumables. A subscription can include a free-trial period and a
constrained introductory offer. Unavailable products declare a safe reason and
no price data. Prices are display-only mock strings; no purchase credential,
receipt, transaction, entitlement service, or provider object may be included.

Product reference IDs are unique and must resolve to the current document.
An active mock entitlement also resolves to a declared product. Commerce
revision ordering follows the same greater/stale/idempotent/conflict rules as
document revisions, but in a separate sequence. A commerce change does not
change the document revision.

## Heartbeats and reconnect

An idle peer sends `previewHeartbeat` with `kind: "ping"` every 5 seconds. The
receiver answers with `pong` using the same heartbeat sequence. After 15
seconds without a valid message, the server marks the client timed out and
emits `previewClientDisconnected`.

Clients reconnect with bounded exponential backoff starting at 250 ms and
capped at 5 seconds; jitter may be at most 20 percent. A successful capability
report resets the delay. The preview UI distinguishes connected,
reconnecting, and disconnected states. Reconnect never relaxes revision
ordering or replays a stale revision over a newer one.

## Local project, import, and export

The local project file is an autosave container with:

- exact `fileFormatVersion: "0.1"`;
- local editable document identity and revision;
- one unchanged Protocol `0.1` paywall document;
- locale and text-scale preview context; and
- revisioned mock commerce state.

It is local state, not a published Mosaic configuration. UI selection, hover,
undo stack, connection state, accounts, and filesystem paths are deliberately
absent. Editor UI state may be stored separately under a dashboard-owned local
key.

The recommended local filename suffix is `.mosaic-project.json`. Portable raw
paywall import and export use `.mosaic.json`; file suffixes are hints and never
replace content validation.

Portable JSON import and export use the raw Protocol `0.1` paywall document,
not the local-project wrapper. Import must:

1. enforce the byte limit and parse JSON without executing it;
2. validate the exact schema and all semantic references;
3. report every affected path/component/property with recovery;
4. preserve the paywall `id` and `revision`; and
5. create a new local editable ID and first local revision.

Export is allowed only when schema and semantic validation have no errors. It
emits only the raw paywall document as UTF-8 JSON, formatted with two-space
indentation and one trailing newline. It excludes local revisions, preview
settings, mock commerce, diagnostics, autosave state, and connection data.
Compatibility warnings may accompany a valid local export but cannot be
silently discarded in Studio.

Local autosave writes the entire validated local-project wrapper atomically.
Recovery validates it before replacing in-memory editor state. A corrupt or
unsupported autosave never overwrites the last usable in-memory document and
must offer import, retry, or start-from-template recovery.

## Canonical browser integration

Studio consumes the browser-safe protocol surface at
`protocol/browser/index.js`. It must use this surface as the authoritative gate
for template loading, edits, import, export, autosave recovery, and outbound
preview messages:

```ts
import {
  parsePortablePaywallJson,
  serializePortablePaywallJson,
  validateLocalProject,
  validatePaywallDocument,
  validatePreviewMessage,
} from "../../../../protocol/browser/index.js";
import type {
  MosaicLocalProject,
  MosaicPaywallDocument,
  MosaicPreviewMessage,
} from "../../../../protocol/browser/index.js";
```

The exact relative path depends on the importing dashboard file. The public
runtime API is:

- `validatePaywallDocument(value)`;
- `validatePreviewMessage(value, { document? })`;
- `validateLocalProject(value)`;
- `parsePortablePaywallJson(source, { maxDocumentBytes? })`;
- `serializePortablePaywallJson(value)`; and
- schema-derived constants `canonicalSchemas`, `previewMessageTypes`,
  `requiredPreviewCapabilities`, `localPreviewContractVersion`, and
  `localPreviewWebSocketProtocol`.

Each operation returns a discriminated result: success has
`{ ok: true, value, diagnostics: [] }`; failure has
`{ ok: false, value: null, diagnostics }`. Diagnostics use the contract's safe,
structured location and recovery model. The adjacent `.d.ts` files are
generated from the canonical JSON Schemas by
`npm run generate:browser-contract` and must not be edited manually.

Editor-only checks may add guidance, such as whether deleting a selected block
will disrupt a workflow. They cannot replace, weaken, or contradict canonical
schema and semantic validation, and dashboard code must not redeclare protocol
fields locally.

## Scope note on editing controls

Phase 2 Studio controls may edit only properties already defined by Protocol
`0.1`. This preview contract does not introduce a color, typography, theme, or
new component payload. Any control that would change native rendering beyond
the approved Protocol `0.1` semantics requires a future paywall protocol
version and cross-platform compatibility review.
