# Mosaic protocol release approval process

How a contract version moves from `draft` to `approved`. Approval is a one-way
door: an approved contract is immutable, so everything that must be true about it
must be true before the flip.

## States and gates

| From | To | Gate |
| --- | --- | --- |
| — | `draft` | Product-owner-accepted scope, normally an ADR. |
| `draft` | `releaseCandidate` | Canonical artifacts complete and internally coherent. |
| `releaseCandidate` | `approved` | Every checklist item below, plus product-owner approval. |
| `approved` | `deprecated` | [Deprecation policy](deprecation-policy.md#approved--deprecated). |
| `deprecated` | `retired` | [Deprecation policy](deprecation-policy.md#deprecated--retired). |

## Entering `draft`

- Scope accepted by the product owner; a new contract or a contract version
  normally requires an ADR under `docs/architecture/decisions/`.
- Confirmation the change belongs in the protocol at all — framework
  convenience, native resource names, billing-provider models, and platform-only
  view behaviour are not reasons to change the shared schema.

Draft contracts carry no compatibility guarantee and may change freely.

## Entering `releaseCandidate`

- Canonical schemas exist and are self-consistent.
- A compatibility manifest and manifest schema exist, and the manifest validates.
- Canonical valid fixtures exist and pass.
- Invalid fixtures exist for each closed rule and are rejected.
- Semantic validation exists for every rule JSON Schema cannot express.
- `docs/protocol/<contract>-<version>.md` describes the contract.
- `npm --prefix protocol run generate && npm --prefix protocol run validate &&
  npm --prefix protocol test` all green, zero generation drift.

A release candidate is coherent and implementable but not yet immutable.
Narrowing corrections are still permitted here — this is the **only** state in
which they are (see the [narrowing
doctrine](breaking-change-process.md#the-narrowing-pre-approval-doctrine)).

## Approval checklist

All of the following before `status` becomes `approved`.

### Contract completeness

- [ ] Manifest `status`, reader policy, capabilities, limits, and declared paths
      are complete and every referenced path exists.
- [ ] `readerPolicy` covers the **full** fallback chain: candidate rejection, no
      accepted release, and bundled-release rejection. A prose-only fallback rule
      is not complete — Configuration Delivery `3` reached RC with two fallback
      keys missing from its manifest.
- [ ] Manifest schema expresses the full lifecycle enumeration including
      `retired`, and accepts an optional `deprecation` block. **Adding these
      after approval is impossible without versioning the contract.**
- [ ] Every closed enumeration is exhaustive and every unknown value fails
      closed.
- [ ] No platform-specific widget, view, or modifier names anywhere in the
      contract.
- [ ] No executable code and no remote code references.

### Layer agreement

- [ ] The canonical schema and the semantic validator agree about validity, or
      every divergence is a rule JSON Schema genuinely cannot express.
- [ ] Rejection-layer metadata is generated and reconciles
      ([fixture lifecycle](fixture-lifecycle.md)).
- [ ] The API runtime validation path agrees with both. Disagreement among the
      three is a release-blocker category.
- [ ] Any narrowing correction is applied **now**, before the flip, with fixture
      evidence.

### Cross-platform implementability

- [ ] Implemented, or an explicit declared fallback, in Flutter, SwiftUI, and
      Jetpack Compose.
- [ ] Studio produces and validates the contract.
- [ ] Backend produces, validates, and negotiates the contract.
- [ ] Capability negotiation delivers the version only to readers that declared
      exact support.
- [ ] Where SDK emission is required for a downstream feature to work at all,
      that requirement is stated normatively — not left as a schema-optional
      field an SDK may reasonably omit.

### Fixtures and evidence

- [ ] Coverage obligations met (`docs/architecture/conventions/protocol.md`).
- [ ] Invalid fixtures exist for every closed rule and are demonstrably rejected.
- [ ] Fixtures the SDKs consume are actually consumed by them, or the gap is
      recorded in `docs/known-limitations.md`.
- [ ] `npm --prefix protocol run generate` produces zero drift;
      `npm --prefix protocol run validate` and `npm --prefix protocol test` green.

### Documentation

- [ ] Contract document written and accurate. Verify claims against the
      artifacts rather than restating intent — the v2 analytics document asserted
      a `mosaic_` export prefix that nothing in Mosaic produced.
- [ ] `protocol/CHANGELOG.md` entry with the approval date.
- [ ] The contract's own changelog (`protocol/<contract>/CHANGELOG.md`) carries a
      status line for **every** version entry that matches that version's
      manifest `status`. Per-contract changelogs are the copy readers reach for
      first, and they drifted at v1 GA: entries still read `release candidate`
      after the manifests were flipped to `approved`. Use the root changelog's
      pattern — `Status: approved at v1 GA (<approval date>); released as a
      candidate on <original date>.` — and remove `release candidate` from the
      entry heading itself.
- [ ] [Versioning](versioning.md) and the [compatibility
      policy](compatibility-policy.md) updated.
- [ ] A migration guide under `docs/protocol/migration/` if the version has an
      approved predecessor.

### Review gates

- [ ] Protocol owner review.
- [ ] Quality review.
- [ ] Product review.
- [ ] UX review where the contract affects authored or rendered experience.
- [ ] **Product-owner approval recorded.**

## Performing the flip

1. Complete every checklist item, including pre-flip schema widening and any
   narrowing corrections. Run the full protocol gate.
2. Set `"status": "approved"` in the compatibility manifest.
3. Update any test asserting the previous status.
4. Update the contract document, `versioning.md`, `protocol/README.md`,
   `protocol/CHANGELOG.md`, and the contract's own
   `protocol/<contract>/CHANGELOG.md` status lines.
5. Re-run `generate` (zero drift), `validate`, and `test`.
6. Record the approval in the phase review.

## What approval means

- The contract's behaviour is **frozen**. Behaviour changes require a new
  version.
- Its fixtures are **frozen** ([fixture lifecycle](fixture-lifecycle.md)).
- Readers may rely on the published schema exactly as published — which is why
  narrowing is no longer permitted.
- The version enters the [deprecation policy](deprecation-policy.md) runway: its
  eventual successor must be approved 6 months before this version may be
  deprecated.

## Related documents

- [Compatibility policy](compatibility-policy.md)
- [Breaking-change process](breaking-change-process.md)
- [Deprecation policy](deprecation-policy.md)
- [Fixture lifecycle](fixture-lifecycle.md)
- [Versioning](versioning.md)
