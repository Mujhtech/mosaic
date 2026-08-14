# ADR 0028: One version per contract until GA

- Status: Accepted
- Date: 2026-08-13

## Context

By 2026-08 Mosaic carried nineteen contract versions across thirteen contracts.
Eight of those contracts had two or three versions live at once: Paywall
Protocol `0.3`/`0.4`, Local Preview `0.3`/`0.4`, Configuration Delivery
`1`/`2`/`3`, Analytics Event `1`/`2`, Commerce Provider `1`/`2`, Commerce
Configuration `1`/`2`, Authoritative Entitlement `1`/`2`, and Billing State
Webhook `1`/`2`.

Every one of those pairs bought machinery. Configuration Delivery v3 was
validated by projecting it back to v2 and v2 back to v1, so the meaning of the
current contract was defined in terms of two predecessors. Analytics Event v2's
manifest carried `olderContractVersion: "acceptAlongsideV2"`. The browser
runtime dispatched `parsePortablePaywallJson` and `validatePaywallDocument` on
`schemaVersion`, kept two schemas registered, and exported
`paywallSchemasByVersion`, `canonicalSchemasByVersion`, and
`previewMessageTypesByVersion`. Local Preview negotiated a two-entry preference
ladder. `MosaicAnyPaywallDocument` was a discriminated union that every caller
had to narrow. The Paywall `0.4` contract document specified a partial
projection back to `0.3`, a normative projectability rule, and a publish-time
check to enforce it — none of which was implemented.

None of that machinery had a beneficiary. Mosaic has not shipped. There are no
external readers, no published documents outside this repository, and every
consumer of every contract — three SDKs, Studio, the backend — is built here and
cuts over together. The cost was not hypothetical either: the 2026-08 fallback
audit found that the defect class it created reproduced across all six layers,
and the earlier RC-migrator work had already produced a schema-invalid document
with an empty diagnostics array from a migration path nothing exercised.

The structural cost was sharper still. Configuration Delivery pinned Paywall
`0.3` in a `const`, so an authored `0.4` document had no hosted delivery
representation at all: it could not be placed in a release and an SDK could not
ask for one. Local Preview was the only transport that carried `0.4` end to
end. The stated fix was "a new Configuration Delivery version", because widening
a `const` in a released contract would silently change what an existing reader
accepts — an argument that only holds when there are existing readers.

ADR-0026 had already settled the same question for one contract: Paywall `0.3`
replaced `0.2` outright, with no migration path and every `0.2` artifact
deleted. That decision was reasoned from Mosaic's pre-release position, not from
anything specific to the paywall contract, so it generalized.

## Decision

**While Mosaic has no production usage, every protocol contract carries exactly
one version: the latest. A contract change replaces its version rather than
adding one beside it. Parallel versions begin at GA.**

Deleting an old version deletes all of it — the schemas, fixtures, compatibility
manifests, validation tools, contract documents, migration guides, every
reference, every version-dispatch arm, every projection, and every version
fallback. A reader accepts one version, and a document claiming any other
version is rejected atomically through the existing `rejectDocument` policy,
resolving through last-accepted configuration, then bundled fallback, then
configuration unavailable.

Deleting a version does not delete product surface. Where a successor never
restated something its predecessor carried, the successor absorbs it. This is
ADR-0026's shape — "`0.3` is `0.2` carried forward unchanged plus the four new
components" — applied generally.

Applied today, this deletes:

| Contract | Kept | Deleted |
| --- | --- | --- |
| Paywall Protocol | `0.4` | `0.3` |
| Local Preview | `0.4` | `0.3` |
| Configuration Delivery | `3` | `1`, `2` |
| Analytics Event | `2` | `1` |
| Commerce Provider Contract | `2` | `1` |
| Commerce Configuration | `2` | `1` |
| Authoritative Entitlement | `2` | `1` |
| Billing State Webhook | `2` | `1` |

Placement Decision `1`, Experiment Assignment `1`, Billing Ingestion `1`,
Billing Migration Operations `1`, and Customer Access Token `1` are untouched:
each already carried exactly one version.

Configuration Delivery `3` is **re-pinned to Paywall Protocol `0.4`**. Its
`paywallVersion.protocolVersion` and `protocolCompatibility.version` constants
are `"0.4"`, its `paywallVersion.document` `$ref`s
`urn:mosaic:protocol:schema:v0.4:paywall`, and its capability request negotiates
`0.4` on both sides. This is what makes `0.4` deliverable, and it is available
precisely because the argument against widening a released `const` — that it
changes what an existing reader accepts — has no existing reader to protect.

Two mechanisms explicitly **survive**, because neither is version debt:

- **The capability system.** Capability negotiation is orthogonal to version
  negotiation and remains exactly as specified. Selecting a version was never
  the same as satisfying it: a reader still declares the exact capabilities it
  supports, and a release requiring one it lacks is withheld rather than
  downgraded or stripped. That machinery is how a single contract version serves
  readers of differing ability, and with one version it carries more weight, not
  less.
- **The `renderWithoutMotion` enhancement tier.** The three `motion.*`
  capabilities degrade instead of rejecting because every animation's terminal
  state is byte-identical to the static rendering. That is a property of motion,
  not of versioning, and a validator still asserts that no other capability
  joins the tier.

**A surviving version suffix is a name, not debt.** Deleting a version deletes
the machinery that existed *because there were two*; it does not require
renaming everything that mentions a version. The rule is:

- A module that holds rules the contract carries **at every version** is
  **unsuffixed**. `validation-v0.3.mjs` became `paywall-document-rules.mjs`,
  `locale-resolution-v0.3.mjs` became `locale-resolution.mjs`, and
  `delivery-v1-common.mjs` became `delivery-common.mjs`, because each names a
  rule rather than a generation, and a version suffix on them would be a claim
  that a second generation exists.
- A module, type, or constant that is **about one specific version** keeps that
  version in its name. `delivery-validation-v3.mjs`, `validation-v0.4.mjs`,
  `MosaicPaywallV04Document`, and `commerce-provider-validation-v2.mjs` are
  correct as they stand: the suffix identifies *which* contract version the
  artifact defines, which is information that survives the policy and becomes
  load-bearing again at GA.

The test is whether the name would need to change if a parallel version were
added tomorrow. `paywall-document-rules.mjs` would not. `validation-v0.4.mjs`
would sit beside a `validation-v0.5.mjs`. Renaming the second category to strip
suffixes would destroy that distinction and would have to be undone at GA.

**Lifecycle statuses are provisional until GA.** A contract's `status` cannot
be stronger than the status of a contract it structurally depends on: an
`approved` manifest that embeds a `draft` schema promises a guarantee it cannot
keep. With one version per contract, dependencies are structural rather than
negotiated, so this propagates. Configuration Delivery `3` therefore moves from
`approved` to `draft` (2026-08-13), because it embeds Paywall Protocol `0.4`,
which is a draft.

This is the second documented exception to the forward-only lifecycle, and it
exists for the same reason as the first: pre-GA, a status describes an intention
rather than a promise anyone is relying on. Statuses harden at GA, and from that
point a status only moves forward.

Version identifiers also remain **exact**. A reader declaring `0.4` accepts only
`0.4` and must not infer support from numeric ordering. That rule outlives this
policy; it is what will keep parallel versions apart once they exist.

## Alternatives considered

**Keep the parallel versions and finish the machinery.** This is what the
deprecation policy prescribes, and it is the right answer after GA. Rejected
now because the runway it buys protects nobody, while the cost is paid every
day: every contract change must be reasoned about in two versions, every SDK
carries two decoders and two fixture corpora, and the untested half is where a
silent defect hides longest because nothing downstream is looking. The
Configuration Delivery projection chain is the clearest case — v3's correctness
was defined by projecting through two contracts that no longer had any other
purpose.

**Delete the old versions but keep the projections as a compatibility layer.**
Rejected. A projection with no target is unreachable code with a test suite,
which is the most expensive form of dead code: it looks maintained. The
Paywall `0.4` projectability rule is the sharpest example — a normative rule,
fully specified, governing a projection to a version that no longer exists.

**Deprecate rather than delete, per the deprecation policy.** The policy
requires a successor to be approved six months before its predecessor may be
deprecated, then a retirement window after that. Applying it here would keep
`0.3` alive well past any point at which it was useful, for readers that do not
exist. The policy is correct and is not being changed; it simply does not bind
before there is anyone to protect.

**Delete only the paywall versions, as ADR-0026 did.** Rejected as arbitrary.
The reasoning in ADR-0026 was about Mosaic's pre-release position, and every
other contract is in the same position. Leaving seven contracts multi-versioned
while the flagship contract is single-versioned would leave the repository
internally inconsistent for no stated reason.

## Consequences

- **Documents and records at a deleted version become unreadable, not
  degraded.** They are rejected atomically and resolve through the existing
  safe-failure chain. No partial acceptance, no best-effort interpretation.
- **Paywall `0.4` is deliverable.** The backend refusal gates that existed only
  because Configuration Delivery structurally pinned `0.3` are removable, and
  the publish-time projectability check that was flagged as unimplemented is no
  longer required at all.
- **`MosaicAnyPaywallDocument` and its siblings each name one type.** They are
  kept as names rather than collapsed into their targets, so that a later
  parallel version widens an alias instead of renaming a public symbol. Callers
  no longer narrow on `schemaVersion` at the reader entry points.
- **Local Preview negotiation offers exactly one subprotocol.** A peer that
  speaks only a deleted version is refused with `preview.noMutualVersion` and
  Studio keeps its last accepted draft. It is never served a version it did not
  offer.
- **Test and fixture counts fall.** That is the point: the removed tests
  exercised removed contracts. Nothing that protected a surviving contract was
  dropped — the shared rule implementations were relocated into unsuffixed
  modules and their suites re-pointed at the surviving corpus rather than
  deleted.
- **The forward-only lifecycle takes a documented exception again.** `approved →
  deleted` is not a transition the versioning model has, and neither is
  `approved → draft`. ADR-0026 took the first once and called it "not a
  precedent for any contract with external readers"; that qualifier still holds
  for both, and this ADR is the record of taking them deliberately for the rest
  of the pre-release set.
- **Every consuming layer must cut over at once.** The three SDKs, Studio, and
  the backend carry constants, symbols, and fixture paths for the deleted
  versions. Until they are purged the repository is internally inconsistent, and
  a partial cutover is worse than either end state.

## Revisit at GA

**This policy ends at v1 GA, and the trigger is external usage rather than a
date.** The condition is: the first contract version that is read by software
Mosaic does not build and cannot cut over — a published SDK release in a
third-party application, a self-hosted deployment on a pinned release, or a
documented external integration.

From that point the deprecation policy governs unchanged: a change to an
approved contract creates a new version beside the old one, the predecessor is
deprecated with a `deprecation` block naming `deprecatedAt`, `retiresAt`,
`supersededBy`, and a migration guide, and the retirement window runs its
course. Schemas and fixtures for a retired version remain in the repository
permanently so a historical document can always be interpreted.

Nothing in this ADR should be read as an argument that parallel versions are
unnecessary. They are necessary exactly when someone is depending on the older
one, and today nobody is.

## Related

- ADR-0026 — Paywall `0.3` replacing `0.2` outright; the precedent this
  generalizes.
- ADR-0016 — retirement of pre-release Protocol `0.1`.
- ADR-0027 — the Paywall `0.4` motion contract, whose projection and
  projectability sections this decision retires.
- `docs/protocol/versioning.md` — the pre-GA policy statement.
- `docs/protocol/deprecation-policy.md` — the regime that resumes at GA.
- `protocol/CHANGELOG.md` — the release entry.
