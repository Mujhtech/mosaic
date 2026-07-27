# Publishing

Publishing turns editable Drafts into immutable configuration your apps
receive. The chain is:

```text
Draft (editable)
→ Paywall Version (immutable)
→ Configuration Release (immutable, per Environment)
→ delivered to SDKs
```

Nothing published is ever edited in place. Every change — including rollback —
creates a new immutable record.

## Where

Dashboard, per Environment:
`/organizations/{organizationId}/projects/{projectId}/monetization/{environmentId}/paywalls`
and `.../releases`. The API endpoints below live under `/v1/projects/{projectId}`.

## Drafts

Create a paywall (`POST .../paywalls`), then a Draft
(`POST .../paywalls/{paywallId}/drafts`). Drafts are edited in Studio and
saved with optimistic concurrency: every save sends `If-Match` (the Draft
revision ETag) and an `Idempotency-Key`. A stale revision returns
`412 draft_revision_conflict`; missing preconditions return `428`. Validate a
Draft any time with `POST .../drafts/{draftId}/validate`.

## Publish

`POST /v1/projects/{projectId}/environments/{environmentId}/publish` with the
Draft ID and expected revision (and an `Idempotency-Key`). Publishing:

1. Validates the Draft against the canonical protocol schema and publishing
   eligibility (for example, referenced Products must have an active, current
   provider mapping — see the [catalog guide](catalog.md)).
2. Creates an immutable Paywall Version from the Draft.
3. Creates a new Configuration Release for the Environment containing the
   complete delivered configuration (paywalls, placements, pinned rule-set
   versions, assets, commerce configuration).

Versions have no update or delete endpoints. To iterate on a published
version, clone it back into a Draft
(`POST .../versions/{versionId}/drafts`) and publish again.

## Releases and delivery

Each Environment has one current Release. SDKs fetch it from
`GET /v1/sdk/configuration` using a public SDK key; delivery uses strong ETags
and 304 responses, and clients keep the last accepted configuration when the
backend is unreachable. Release history is visible under `.../releases` and
`GET .../environments/{environmentId}/releases`.

## Rollback

`POST .../environments/{environmentId}/releases/{releaseId}/rollback`
(dashboard: the release history page). Rollback does not delete or mutate
anything: it creates a new Release whose payload is a copy of the target
Release's stored immutable snapshot, with a new release number and publication
time. Mutable Drafts, Products, and Assets are never consulted, so a rollback
reproduces exactly what was delivered before. The audit history records the
rollback source.

## Verification status

Draft concurrency, publish, immutability, rollback, and delivery (including
ETag/304 behavior and byte-identical release payloads after restore) are
covered by the backend integration suites and the GA drills. See
[docs/backend/phase-3b-hosted-publishing.md](../backend/phase-3b-hosted-publishing.md)
for the full contract.
