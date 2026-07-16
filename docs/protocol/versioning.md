# Mosaic Protocol Versioning

## Exact versions during the draft period

`schemaVersion` is an exact protocol identifier, not an implied compatibility
range. A reader that declares support for `0.1` accepts `0.1` only. It must not
infer support for another version from numeric ordering.

Capability versions are also exact. A component capability at `0.1` is
supported only when the reader explicitly declares that name and version.

This conservative rule avoids assuming a compatibility policy before the
Protocol review gate approves one. A future range or migration policy is a
public-contract decision and must not be introduced by one implementation.

## Artifact lifecycle

The compatibility manifest records one of these states:

- `draft`: may change during its active review cycle;
- `approved`: frozen for consumers and immutable;
- `deprecated`: still readable where supported, but not recommended for new
  documents.

Once a version becomes approved, its schema, manifest, and canonical fixtures
must not be edited in place. A contract change creates a new version directory
and changelog entry. Corrections that would alter whether any document validates
also require a new version.

## Change requirements

Every protocol change requires:

1. a versioned schema update;
2. canonical fixture changes or additions;
3. invalid-input coverage where applicable;
4. compatibility and fallback review;
5. documentation and changelog updates; and
6. decoding support or a defined safe failure across all supported readers.

The protocol remains platform-neutral. A single reader's implementation
convenience is not sufficient reason to change the shared contract.

## Current review gate

Protocol `0.1` remains `draft` until the product owner reviews its component
semantics, strict rejection policy, exact-version policy, localization fallback,
and deferred design-token/style model. Approval should change only the manifest
status and changelog status after all first-party fixture decode checks pass.
