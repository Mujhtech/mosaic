# ADR-0020: Use Placement Decision v1 and Configuration Delivery v2

## Status

Accepted

## Date

2026-07-26

## Context

Configuration Delivery v1 maps every Placement directly to one immutable
Paywall Version. Its schema and all three SDK readers are closed and atomically
validated. It cannot represent ordered targeting Rules, `no_paywall`, explicit
fallbacks, assignment-key policy, deterministic rollout, or the compatibility
metadata required for local decision evaluation.

Adding those fields to v1 would change an accepted public contract and cause
strict readers to reject releases. Sending only part of an advanced Rule Set to
an older SDK could also show a Paywall to the wrong audience.

## Decision

Mosaic will define a separate, platform-neutral Placement Decision Contract v1
and carry it atomically in Configuration Delivery Contract v2.

Delivery v2 contains the immutable Paywall and Placement-decision snapshot for
one Environment release. SDK capability negotiation independently declares
supported Delivery versions, Placement Decision versions and features, and
deterministic bucketing algorithms. Readers reject unsupported decision
semantics atomically and retain their last accepted release.

Delivery v1 remains unchanged. Mosaic may compile a v1 representation for an
advanced release only when each Placement has an explicit safe default Paywall.
It must not project `no_paywall`, strip targeting conditions, or turn an
advanced Rule outcome into an unconditional legacy binding. When no safe v1
representation exists, the legacy SDK receives no compatible candidate and
uses its existing cache or bundled fallback.

Placement Decision v1 remains declarative and closed. It permits bounded
condition groups, typed values, explicit priority, versioned deterministic
rollout, explicit outcomes and fallbacks, and diagnostics-safe compatibility
metadata. It contains no executable code, customer attribute values, raw
identity values, provider credentials, analytics state, or authoritative
customer Entitlement state.

## Consequences

### Benefits

- Delivery v1 and Paywall Protocol 0.2 remain stable.
- Paywalls and their decision Rules are accepted or rejected as one immutable
  offline-capable release.
- Old SDK behavior is explicit and cannot partially interpret advanced Rules.
- Go, Dart, Swift, and Kotlin can share one versioned evaluator fixture corpus.
- Future decision features can use exact capability negotiation.

### Trade-offs

- The backend must store and serve multiple immutable representations of one
  logical Configuration Release.
- Every SDK needs a strict Delivery v2 reader and Placement Decision evaluator.
- Releases without a safe default Paywall cannot be consumed by Delivery v1
  SDKs.
- Compatibility and conformance testing span four evaluator implementations.

## Alternatives considered

### Extend Configuration Delivery v1 in place

Rejected because v1 is closed and strict readers would reject or misinterpret
the changed contract.

### Fetch a mutable decision resource separately

Rejected because separate acceptance can combine Paywalls and Rules from
different revisions and weakens offline atomicity.

### Request a server decision for every Placement presentation

Rejected because it violates Phase 5's offline and latency promise and creates
a new availability dependency in the presentation path.

### Compile only one unconditional Paywall per SDK request

Rejected because it would move identity and targeting to the server, require a
request per decision, and prevent deterministic local explanation.
