# Runbook: Publishing Failure

## Symptoms

`POST .../environments/{environmentId}/publish` (or the dashboard Publish
action) fails. Publishing is deliberate and low-frequency, so **any** publish
failure is actionable.

## Impact

The Environment keeps serving its current Release — delivery is unaffected.
Only the new version is blocked.

## Diagnosis

Publishing errors are diagnosable by code:

- **`409 placement_unpublished`** — "Every active Placement binding must
  resolve to a published Paywall". On a first publish this almost always
  means **no Placement is bound to the Paywall at all**: publishing requires
  at least one (drill-verified first-run trap). Create a Placement, bind it
  (`PUT .../placements/{placementId}/binding`), retry. Note this one code
  covers several distinct conditions (known limitation).
- **`409 release_protocol_mixed`** — the Release would carry Paywalls on more
  than one Paywall Protocol version (for example one Placement resolving to a
  0.3 Paywall and another to a 0.4 Paywall). The Configuration Delivery
  contracts advertise exactly one protocol version per Release, so a mixed
  Release is refused rather than published as a payload no SDK can decode.
  `details.paywallIdsByProtocolVersion` lists which Paywalls are on which
  version; republish the outdated Paywalls so every bound Paywall's latest
  Version declares the same protocol version, then retry.
- **`422 document_paywall_id_mismatch`** — the draft document's `id` must
  equal the Paywall id.
- **Draft validation errors** — run
  `POST .../drafts/{draftId}/validate` and fix each reported error.
- **`409 experiment_placement_decision_required`** — the Environment's
  current Configuration Release carries no Placement Decision representation:
  publish a Placement rule set in this Environment before publishing an
  Experiment. Other Experiment publish preconditions fail as
  `422 experiment_invalid` with a machine-readable `details.reason`.
- **500** — look up the `requestId` in the operator log:
  `docker compose logs api | grep '<requestId>'` (every 5xx logs its cause).

## Recovery

Fix the named condition and re-publish. Publishing is idempotent in effect: a
failed publish leaves no partial Release (Releases are immutable and appear
only on success — `GET .../environments/{environmentId}/releases` shows what
exists).

## Verification

The publish returns 201 with a `contentHash`; delivery reflects it:

```bash
curl -si http://localhost:8080/v1/sdk/configuration -H "Authorization: Bearer <sdk-key>" ...
# ETag == "sha256-<the new contentHash>"
```

## Escalation

A publish failing with a 500 whose logged cause names Mosaic internals (not
your configuration) — capture the request id, the log line, and the draft
validation output; file per [docs/support.md](../support.md).

## Prevention

Validate drafts before publishing; alert on the publish-failure signal
(`paywall.publish` span outcome —
[observability](../backend/operations/observability.md)).
