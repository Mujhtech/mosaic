# Mosaic protocol deprecation policy

How an approved contract version stops being current, and how long that takes.
Applies to every contract in the
[contract set](compatibility-policy.md#contract-set).

**This policy does not bind before GA.** While Mosaic has no production usage,
every contract carries exactly one version and a change replaces it rather than
deprecating it — see
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md). The
runway below begins the moment a contract version is read by software Mosaic
does not build. Nothing here is being relaxed; it is simply not yet load-bearing.

## The problem this solves

Mosaic contracts are read by applications Mosaic does not control and cannot
upgrade. A shipped application keeps reading the contract version it was built
against for as long as its users keep it installed. If Mosaic stops producing a
contract version too soon, those installations stop receiving configuration
updates through no fault of their own.

The runway below is therefore deliberately long, and the retirement rule is
deliberately conservative: retirement removes Mosaic's obligation to *produce* a
version, never its ability to *interpret* one.

## Lifecycle states

`draft → releaseCandidate → approved → deprecated → retired`, forward-only. Full
definitions are in [versioning.md](versioning.md#artifact-lifecycle).

## Runway requirements

### Approved → deprecated

A contract version may not be deprecated until:

1. its **successor has been `approved` for at least 6 months**; and
2. a migration guide for the successor exists under
   `docs/protocol/migration/`; and
3. the deprecation is approved by the product owner and recorded in
   `protocol/CHANGELOG.md`.

The 6-month wait exists because approval is when a successor becomes real to
integrators — not when it is drafted. Deprecating a version the moment its
successor is approved gives integrators no interval in which both versions are
current and either is a safe choice.

A version with **no approved successor is never deprecated.** There is nothing to
migrate to, and deprecation would communicate an upgrade path that does not
exist.

### Deprecated → retired

A deprecated version may not be retired until:

1. at least **12 further months** have elapsed since `deprecatedAt`; and
2. at least **two SDK minor releases** have shipped in which the successor was
   supported, on every platform Mosaic publishes an SDK for. Elapsed time is not
   a substitute: an integrator who cannot upgrade because no SDK release offers
   the successor has not had a real opportunity; and
3. the retirement is approved by the product owner and recorded in
   `protocol/CHANGELOG.md`.

**Minimum total runway from approval of the successor to retirement of the
predecessor: 18 months.**

Where the two conditions disagree, the later date wins. The runway is a floor,
never a target — there is no obligation to deprecate or retire anything on
schedule, and most versions should simply remain approved.

## Recording deprecation in the manifest

A deprecated or retired manifest carries a `deprecation` block. Every manifest
schema accepts it; the block is absent for `draft`, `releaseCandidate`, and
`approved` contracts.

```json
{
  "status": "deprecated",
  "deprecation": {
    "deprecatedAt": "2027-06-01",
    "retiresAt": "2028-06-01",
    "supersededBy": "3",
    "migrationGuide": "docs/protocol/migration/delivery-v3-to-v4.md"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `deprecatedAt` | yes | UTC calendar date the version was deprecated. Starts the 12-month retirement clock. |
| `retiresAt` | yes | Earliest UTC calendar date retirement is permitted. A *floor*, not a commitment — retirement still requires the two-SDK-minor condition and product-owner approval. |
| `supersededBy` | no | Identifier of the approved successor. Optional because a development-only contract may be retired without a successor; a production contract that reaches `deprecated` will always have one, since deprecation requires one. |
| `migrationGuide` | no | Repository-relative path to the migration guide. |

The fields are metadata for humans and tooling. A reader's behaviour is
determined by `status`, not by the dates: a deprecated contract is read exactly
as an approved one.

## What retirement does and does not do

**Retirement removes an obligation.** Mosaic stops producing the version and
readers stop being required to support it.

**Retired artifacts stay in the repository permanently.** Schemas, fixtures,
compatibility manifests, and documentation for retired versions are never
deleted. Reasons:

- a document produced under a retired version may still exist in a backup, an
  export, or a support ticket, and must remain interpretable;
- the fixtures are the only executable record of what the version meant; and
- deleting them would make the repository's own history unverifiable.

A retired manifest keeps `status: "retired"` and its `deprecation` block. This is
why `retired` was added to every manifest schema **before** the v1 approval flip:
approved schemas are immutable, so a lifecycle state absent at approval time
could never be added later without a new version of all 13 contracts.

## SDK-scoped deprecation

Distinct from contract deprecation and tracked separately:

- Each SDK **minor** release is supported for **12 months**.
- Upgrades are supported across **one minor version at a time**; skipping more
  than one minor is not a supported path.
- A migration guide accompanies the deprecation of any SDK minor.
- A public API break in an SDK requires release-blocking justification, a
  compatibility analysis, migration guidance, and owner approval.

An SDK minor going out of support does not retire a contract version, and
retiring a contract version does not end support for an SDK minor. The two
clocks are independent — but the two-SDK-minor condition on retirement is where
they meet.

## Local Preview is development-only

Local Preview `0.4` declares `audience: "developmentOnly"`. No shipped
application reads it: it is the Studio-to-preview-client authoring transport.
Its runway is bounded by tooling releases rather than by installed applications,
so the 6+12-month schedule does not apply. It may be deprecated and retired
alongside the Studio and preview-client releases that use it, and it may be
retired without a successor. Its artifacts still stay in-tree permanently.

## Related documents

- [Compatibility policy](compatibility-policy.md)
- [Breaking-change process](breaking-change-process.md)
- [Release approval process](release-approval-process.md)
- [Versioning](versioning.md)
