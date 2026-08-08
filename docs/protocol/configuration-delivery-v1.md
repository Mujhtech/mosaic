# Mosaic Configuration Delivery Contract v1

## Purpose

Configuration Delivery `1` is the immutable, Environment-scoped release envelope fetched by Mosaic
SDKs. It wraps complete Paywall Protocol `0.3` documents without changing their component, layout,
action, localization, accessibility, Product, Asset, compatibility, or fallback semantics.

Canonical artifacts:

- `protocol/schema/configuration-delivery/v1/release.schema.json`
- `protocol/schema/configuration-delivery/v1/capability-request.schema.json`
- `protocol/schema/configuration-delivery/v1/compatibility-manifest.schema.json`
- `protocol/compatibility/configuration-delivery/v1.json`
- `protocol/fixtures/configuration-delivery/v1/`

The contract is declarative and platform-neutral. It contains no executable code.

## Release envelope

Every response contains exactly:

```text
configurationDeliveryVersion = "1"
release
  id
  number
  environment { id, key }
  publishedAt
  contentDigest
  compatibility
  placements
  paywallVersions
  productReferences
  assetReferences
```

The Environment is identified only by a safe opaque ID and stable key. The SDK authentication key
selects the Environment at the HTTP boundary and is never serialized into the release.

Release numbers increase within one Environment. IDs and numbers are diagnostic identity, not an
ordering mechanism across Environments.

## Atomic acceptance

An SDK validates the complete candidate before replacing its last accepted release. Validation
includes:

1. exact Delivery version and closed JSON Schema validation;
2. every embedded Paywall Protocol `0.3` schema and semantic rule;
3. exact Paywall capability compatibility;
4. Placement-to-Paywall-Version references;
5. Paywall-Version-to-Product and Asset references;
6. complete Product and hosted Asset record sets; and
7. document and release digests.

Any failure rejects the complete candidate. A client must not retain recognized Placements or
Paywalls from a rejected release.

Every included Paywall Version is referenced by at least one Placement. Every included Product and
hosted Asset is referenced by at least one included Paywall Version. Duplicate, dangling, missing,
or unused records reject the release.

## Immutable Paywall Versions

A Paywall Version record contains:

- stable Version and logical Paywall IDs;
- exact `protocolVersion: "0.3"`;
- canonical document digest;
- the complete immutable Protocol `0.3` document;
- the exact stable Mosaic Product IDs used by that document; and
- bindings from each remote document Asset ID to a hosted Asset reference.

The record excludes Draft revisions, unpublished content, validation internals, creators, audit
history, and rollback provenance. Editing or rollback creates later immutable backend records; it
does not mutate a delivered Version.

`paywallId` must equal the embedded document `id`, `protocolVersion` must equal `schemaVersion`, and
`productReferenceIds` must equal the document's Product IDs.

## Products

Release Product records contain only:

- stable Mosaic Product ID;
- provider-neutral type (`subscription` or `one_time_non_consumable`); and
- bounded fallback display name.

They contain no provider Product identifier, price, offer, credential, connection state, or
authoritative customer Entitlement state. Protocol `0.3` continues to own visible Product labels
and safe runtime Product interpolation.

## Assets

Bundled Assets remain inside the host application and have no hosted Asset record.

Every remote Protocol `0.3` Asset has exactly one Version binding to a release Asset record. The
record contains stable Mosaic Asset ID, image/video kind, media type, byte length, SHA-256 digest,
and immutable HTTPS URL. The record kind and URL must equal the embedded document Asset.

URLs contain no bucket key, embedded credential, or expiring signature. Runtime media failure uses
the fallback already declared by Protocol `0.3` and emits a safe diagnostic; it does not partially
rewrite the release.

## Digests and ETags

`documentDigest` is SHA-256 over the RFC 8785 JSON Canonicalization Scheme representation of the
complete embedded Paywall document.

`release.contentDigest` is SHA-256 over the RFC 8785 canonical representation of the `release`
object with its `contentDigest` member omitted. Canonicalization recursively orders object keys,
preserves array order, and uses the standard deterministic JSON string and number serialization.

The HTTP strong ETag is transport metadata derived from the stored immutable representation. It is
not a substitute for the content digest and is not embedded in the release.

## Capability request

The semantic SDK request metadata is:

```json
{
  "platform": "flutter",
  "sdkVersion": "0.2.0-dev.5",
  "supportedConfigurationDeliveryVersions": ["1"],
  "supportedPaywallProtocols": [
    {
      "version": "0.3",
      "capabilities": [
        { "name": "component.text", "version": "0.3" }
      ]
    }
  ],
  "applicationVersion": "1.0.0"
}
```

`applicationVersion` is optional. The backend OpenAPI contract maps this semantic model to bounded
HTTP headers. Public SDK keys remain authentication transport and never enter this metadata.

Delivery v1 uses these exact headers:

```text
Mosaic-SDK-Platform: flutter
Mosaic-SDK-Version: 0.2.0-dev.5
Mosaic-Configuration-Versions: 1
Mosaic-Paywall-Protocol-Versions: 0.3
Mosaic-Paywall-Capabilities: component.text@0.3,layout.stack@0.3
Mosaic-App-Version: 1.0.0 # optional
```

`Mosaic-Paywall-Capabilities` contains unique comma-separated `name@version` pairs from the closed
Protocol `0.3` capability catalog, with at most 128 pairs and a 16 KiB header bound. The backend
rejects malformed, duplicate, unknown, or incomplete reports atomically with
`406 unsupported_capability`; it never returns a partially compatible Release.

## Unknown versions and fields

Delivery and Paywall versions are exact identifiers, not numeric ranges:

- an unknown `configurationDeliveryVersion` rejects the release;
- an unsupported Paywall Protocol or exact capability rejects the release;
- every schema is closed, so an unknown field rejects the release;
- unknown record variants and malformed or inconsistent references reject the release; and
- a future additive field requires a reviewed later Delivery version unless explicitly introduced
  by a compatible version policy.

Capability requests are also closed. Invalid request metadata is rejected by the server and never
causes an SDK to discard its current cached release.

## Fallback and diagnostics

Resolution order is:

```text
Valid newly fetched Release
-> last-known-valid cached Release
-> bundled Delivery v1 Release
-> configurationUnavailable
```

`304 Not Modified`, timeout, transport failure, server failure, invalid JSON, unsupported content,
or an integrity failure preserves the last accepted release. An unknown requested Placement returns
`placementUnavailable` without invalidating a valid release.

SDK diagnostics may include only the failure code and safe identifiers already in the envelope:
Delivery version, Release ID/number, Environment ID/key, Placement key, Paywall Version ID, Asset ID,
and chosen fallback. Diagnostics must not contain API keys, authorization headers, provider data,
storage keys, raw documents, internal errors, audit actors, or stack traces.

## Explicit exclusions

Delivery v1 contains no secrets, Drafts, unpublished Versions, internal audit or validation data,
targeting, rollout rules, user attributes, analytics state, experiments, provider credentials,
provider Product mappings, receipt data, or authoritative customer Entitlement state.

Local Preview `0.3` remains a separate WebSocket development contract and is unchanged.
