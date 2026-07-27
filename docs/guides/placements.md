# Placements

A Placement is a named point in your app where a paywall may appear
(`onboarding_complete`, `settings_upgrade`). The app asks the SDK to decide a
Placement; a published Rule Set decides which paywall — if any — to show.
Decisions are evaluated entirely on the device from the delivered
configuration, so they work offline and never wait on a network call.

## Where

Dashboard, per Environment:
`/organizations/{organizationId}/projects/{projectId}/monetization/{environmentId}/placements`,
with a detail page per Placement offering four tabs: Overview, Rules,
Simulator, and Test Overrides. API: placements under
`/v1/projects/{projectId}/placements`, rule sets under
`/v1/projects/{projectId}/environments/{environmentId}/placements/{placementId}/rule-set`.

## Rule Sets

Each Placement has at most one published Rule Set version per Environment.
A Rule Set is authored as a draft (revision-checked saves, like paywall
Drafts), validated, and published as an immutable version; publishing pins it
into the next Configuration Release. Editing means cloning a version back to a
draft and publishing again.

A Rule Set contains up to 100 rules plus a mandatory default outcome. Each
rule has:

- a unique priority (0–9,999) — evaluation order, lowest first
- a condition tree (`all` / `any` / `not` over condition leaves, up to 5
  levels and 64 leaves) — see the [targeting guide](targeting.md)
- an optional percentage rollout
- an outcome

## Deterministic first-match evaluation

Enabled rules are evaluated in priority order. The first rule whose condition
is true and whose rollout (if any) matches wins; rules evaluating false or
unknown are skipped. If no rule wins, the default outcome applies. Evaluation
is fully deterministic: the same inputs always produce the same decision, on
every platform, verified by a shared conformance corpus
(`protocol/fixtures/placement-decision/v1/`).

Outcomes are:

- `paywall` — present a pinned immutable Paywall Version (with an optional
  fallback if it is unavailable)
- `no_paywall` — a successful "show nothing"
- `fallback` — delegate to a named fallback (acyclic, resolved within 8 steps)
- `unavailable` — a safe terminal state with a reason

## Rollout

A rule may apply to only a percentage of traffic. Rollout uses basis points
(0–10,000) and a deterministic SHA-256 bucketing algorithm over a stable
assignment key, so the same installation or user consistently lands in or out.
Assignment policies: `installation` (default), `identified_user`, or
`identified_user_or_installation`. 0 never matches; 10,000 always matches.

## Deciding in the app

Each SDK evaluates from the accepted configuration snapshot without any
network request:

- Flutter: `Mosaic.instance.decidePlacement('placement_key', ...)`
- iOS: `mosaic.decide(placement:context:identity:)` (and
  `decideForPresentation`)
- Android: `client.decidePlacement(placement = ...)`

If no configuration has ever been accepted, the decision is a safe
`unavailable`. See each SDK README for the full decision result types.

## Simulator and test overrides

The Simulator tab (or `POST .../rule-sets/{ruleSetId}/simulate`) runs a
decision against inputs you supply and returns the winning rule, outcome,
fallback path, rollout bucket, and a bounded trace. Simulation inputs are
never logged or persisted. Test Overrides pin a decision for QA in development
and staging Environments only; they expire within 24 hours and their tokens
are shown once at creation.

## Verification status

Rule Set authoring, publication, delivery pinning, and evaluation are covered
by backend tests, the shared protocol conformance corpus consumed by all three
SDKs, and the GA drills. Contract reference:
[docs/protocol/placement-decision-v1.md](../protocol/placement-decision-v1.md);
backend detail:
[docs/backend/phase-5-placement-decisions.md](../backend/phase-5-placement-decisions.md).
