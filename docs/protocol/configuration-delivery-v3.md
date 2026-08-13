# Configuration Delivery Contract v3

Configuration Delivery `3` is the **only** Configuration Delivery contract.
Delivery `1` and `2` were deleted under the single-version policy in
[ADR-0028](../architecture/decisions/0028-single-version-contracts.md), and v3
was re-pinned to carry **Paywall Protocol `0.4`**: `paywallVersion.protocolVersion`
and `protocolCompatibility.version` are `const "0.4"`, the embedded document
`$ref`s `urn:mosaic:protocol:schema:v0.4:paywall`, and the capability request
negotiates `0.4` on both sides. That re-pin is what makes a `0.4` document
deliverable.

v3 carries an immutable Environment release: atomic Placement Decision `1` Rule
Sets, exact Product and Entitlement references, accepted Paywall Protocol `0.4`
documents, and Experiment Assignment Contract `1` definitions.

Canonical artifacts are under
`protocol/schema/configuration-delivery/v3/`,
`protocol/compatibility/configuration-delivery/v3.json`, and
`protocol/fixtures/configuration-delivery/v3/`.

## Atomic release

Beyond the Placement, Paywall, Product, Entitlement, and Asset material, the
release carries:

- `release.experimentAssignments`, containing immutable Assignment v1 roots;
- `release.compatibility.experimentAssignmentContracts`, containing the exact
  union of required Assignment features, bucketing algorithms, and schedule
  policies.

Each Assignment must match release Project/Environment, reference one included
Placement, and reference only included immutable Paywall Versions. Experiment
and Experiment Version IDs are unique. When an Assignment selects a mutual-
exclusion Group Version, its stable Experiment ID must appear in that Group
Version's complete `members` snapshot. Group members never point at Experiment
Version IDs; the enclosing delivered Assignments pin those exact immutable
Versions. Repeated snapshots of the same Group Version must match exactly. QA
material rejects in production.

Every Assignment has an inclusive `schedule.startsAt`; an immediate start uses
the authoritative publication/start time. `schedule.endsAt` is optional and,
when absent, manual lifecycle releases control completion. Trusted server-time
capture and unreliable-time fallback remain unchanged.
`release.contentDigest` covers all release material except the digest field
itself.

Unsupported contract/features/algorithms/schedule policy, malformed allocation,
invalid references, non-exact compatibility, or a bad digest rejects the whole
candidate. The reader retains its last accepted release, then tries a bundled
release, then reports configuration unavailable. A release is accepted whole or
rejected whole; it never accepts new Placement material with old Experiment
material or vice versa.

## Capability negotiation

The capability request declares:

- `supportedConfigurationDeliveryVersions`;
- `supportedPaywallProtocols`, at exact version `0.4` with exact capabilities;
- `supportedPlacementDecisionContracts`, `supportedDecisionFeatures`, and
  `supportedBucketingAlgorithms`;
- `supportedExperimentAssignmentContracts`;
- `supportedExperimentFeatures`;
- `supportedExperimentBucketingAlgorithms`;
- `supportedExperimentSchedulePolicies`.

The server withholds the release when any required capability is absent.

### There is one representation, and no projections

**Normative.** A Configuration Release carries exactly one stored representation.
There is one Delivery version, so there is nothing to project to and nothing to
carry forward: the v2 → v1 and v3 → v2 projection machinery was deleted with the
versions it targeted.

An SDK that advertises a Delivery version Mosaic no longer carries receives
nothing new and retains its last accepted release, then its bundled fallback,
then reports configuration unavailable. It is never served a narrower
representation it did not ask for, and a Variant is never turned into an
unconditional Placement binding — the defect class the old projection rules
existed to prevent is now prevented structurally.

The historical projection defects and their verification are recorded in
[`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md);
they describe machinery that no longer exists.

Delivery contains definitions and stable references only. Results, customer
values, raw identity, event history, provider secrets, Drafts, audit state, and
executable code are excluded.
