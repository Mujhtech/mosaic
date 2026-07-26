# Placement decisions in the dashboard

Phase 5 keeps a Placement’s application-facing key stable while extending its
Environment-specific default Paywall binding into a deterministic decision
Draft.

## Information architecture

The Placement list shows the stable key and the compatible simple default
binding. Opening a Placement provides four task-focused tabs:

- **Overview** owns the default decision, rollout assignment policy, named
  fallbacks, aliases, observed usage, and Project attribute definitions.
- **Rules** owns explicit numeric priority, bounded condition groups, outcomes,
  unavailable fallback selection, and deterministic rollout traffic.
- **Simulator** sends ephemeral synthetic inputs as a non-cached mutation and
  renders the semantic decision trace.
- **Test Overrides** makes every active non-production QA override visible and
  supports audited creation and revocation.

Advanced Rules are optional. When no Rule wins, the exact default decision is
used. A legacy Environment Placement binding is represented as a default
Paywall decision and remains understandable without opening the Rules tab.
New Rules start disabled with `unavailable/no_safe_decision`; authors must
review the conditions and outcome before enabling them. The condition editor
offers only operators supported by the selected source and, for user
attributes, the selected allow-listed definition.

## Editing and recovery

Rule priority is a persisted number. The dashboard uses keyboard-accessible
move-up and move-down controls and rewrites the numeric sequence in one Draft
update. It does not make display order or drag state authoritative.

Draft saves carry the current revision and an idempotency key. A conflict keeps
the local form intact and offers two explicit recoveries: retry the local work
or load the server revision. Validation issues identify their Rule or condition;
publication blockers retain links to the affected Placement, Paywall, Product,
Access definition, provider, mapping, or attribute definition where the API
provides a recovery target.

Duplicate conditions and a later enabled Rule shadowed by an equivalent earlier
Rule appear as explicit warnings. Backend validation bounds these diagnostics at
64 warnings per validation response. A warning-only Draft remains valid and can
be published; errors continue to block publication.

A Placement with an active Rule Set cannot be archived. The dashboard provides
the required recovery action against the Rule Set archive endpoint, explains
that immutable published versions remain in history, and enables Placement
archive after active usage is cleared. Rule Set restore is not part of Phase 5.

`no_paywall` is presented as an intentional successful outcome. It never enters
a fallback. Product readiness and compatibility errors remain publication
guards; warning-only diagnostics stay visible without blocking. Mosaic never
substitutes another Product or a similar Paywall.

## Input and privacy boundaries

Attribute configuration stores allow-listed definitions only. Actual customer
attribute values remain SDK-local. The UI calls customer access “Access”; the
versioned contract continues using the domain term Entitlement.

Simulator values are local form state until submitted. They are not written to
URLs, TanStack Query keys or cache, browser storage, recovery state, or logs.
Clearing or leaving the form discards them. Country is labeled as explicit host
application input and is never inferred from locale. Sensitive attribute
simulation is deferred in Phase 5: sensitive definitions are excluded from the
dashboard simulator, and any sensitive values present in server traces are
redacted. There is no owner/admin sensitive-value input UI in this phase.

Test Overrides are unavailable in production. Development and staging
overrides require owner/admin permission, expire within 24 hours, use an opaque
one-time token, remain visibly active until expiry or revocation, and never
publish raw selector material.

## State ownership

TanStack Query owns Placement decision, attribute-definition, and Test Override
server state. TanStack Form owns editable Draft and simulator form state. Small
tab and disclosure interactions use local React state. No global store or drag
state was introduced.
