# Troubleshooting

Symptom-first diagnosis for a self-hosted Mosaic installation. Every failure
mode here was either observed directly in the Phase 8 GA drills
([`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md))
or comes from the operator references under
[`docs/backend/operations/`](../backend/operations/) and
[`docs/dashboard/operations.md`](../dashboard/operations.md). For step-by-step
incident procedures, see the [runbooks](../runbooks/README.md).

## The API container exits at startup

```bash
docker compose logs api
```

The API validates **all** configuration before listening and fails closed.
Read the log from the last `api stopped` line upward:

- **Configuration errors** print as one structured multi-problem list naming
  every offending variable at once — fix them all, restart once. Values are
  never printed. Production mode (`MOSAIC_ENVIRONMENT` other than
  `development`/`test`) rejects unsafe defaults: wildcard or `http://` CORS
  origins, default MinIO credentials, plaintext object storage, a
  `DATABASE_URL` without a verifying `sslmode`, insecure session cookies.
- **`verify migration compatibility: database schema is behind the expected
  migration version`** — migrations are pending. The API does **not** serve a
  degraded 503 in this state; it fails startup and crash-loops
  (`docker compose ps` shows `restarting`), by design. Run the migrate step:
  see the [upgrade guide](upgrade.md) and the
  [api-will-not-start runbook](../runbooks/api-will-not-start.md).
- **`initialize object storage`** — the bucket is unreachable or absent.
  Check the `minio` service and `MOSAIC_OBJECT_STORAGE_*`.
- **`configure provider credential encryption` / keyring validation errors**
  — the keyring is structurally invalid. The error names the rule violated,
  never the value. See [key rotation](../backend/operations/key-rotation.md).

## `/health/ready` returns 503

Liveness (`/health/live`) staying 200 while readiness is 503 means the
process is up but a dependency is not. The response carries safe per-check
codes only — never hosts, ports, or credentials:

| Code | Meaning | Where to go |
| --- | --- | --- |
| `database_unavailable` | PostgreSQL ping failed | [postgres-unavailable runbook](../runbooks/postgres-unavailable.md) |
| `object_storage_unavailable` | Bucket check failed. Configuration delivery **keeps serving** during this (verified in the drill) — only Asset upload/serving is degraded | [object-storage-unavailable runbook](../runbooks/object-storage-unavailable.md) |
| `migration_incompatible` | The applied schema does not match the running binary. Reachable when schema drifts under a running API; a *pending* migration at startup crash-loops instead (above) | [migration-failed runbook](../runbooks/migration-failed.md) |
| `encryption_misconfigured` | Provider integrations enabled with an unusable keyring | [keyring-loss-rotation runbook](../runbooks/keyring-loss-rotation.md) |
| `draining` | The process is shutting down | Expected during deploys |

Checks are dependency-aware: when PostgreSQL is down you see only
`database_unavailable`, not a spurious `migration_incompatible` (the
migration check is skipped when its prerequisite already failed).

Readiness recovers on its own when the dependency returns — the drill
verified 503 → 200 with zero API restarts.

On SIGTERM the API is intended to
serve `503 draining` for `MOSAIC_HTTP_DRAIN_DELAY` (default 5s) before
closing the listener, so load balancers observe the drain. As drilled, the
listener closed immediately (readiness went 200 → connection refused);
in-flight requests still completed.

## A migration failed

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api status      # exactly what applied
docker compose run --rm --entrypoint /usr/local/bin/migrate api preflight   # pending list, dirty flag, verdict
```

- Most migrations run in a transaction: a failure usually leaves nothing
  applied. Fix the cause, re-run `migrate up`.
- Migration `00019` builds an index `CONCURRENTLY` (no transaction); a failed
  run can leave an invalid index — see the
  [migration-failed runbook](../runbooks/migration-failed.md) for the
  cleanup.
- A second concurrent `migrate` waits on the advisory lock instead of
  interleaving. A `migrate` that seems hung may be waiting on that lock.
- **`down` / `down-to` refuse without `--confirm`.** With `--confirm`,
  irreversible migrations (`00006`, `00010`, `00018`) still refuse when
  affected data exists, naming the exact rows a rollback would destroy. That
  refusal is final: the recovery is
  [restore from backup](backup-restore.md), never forcing the rollback.

## The API returned 500

Every 500 response body carries a `requestId` and nothing else — the cause is
in the operator log, tied to the same id:

```bash
docker compose logs api | grep '<the requestId>'
```

You will find the access-log line and an error entry with the status, method,
route, and cause (verified in the drills: an undiagnosable 500 is treated as
a defect). Notes:

- Deliberate upstream-failure statuses are **preserved**, not collapsed to
  500: a provider outage is `503 providerUnavailable`, a bad provider
  response `502 providerInvalidResponse`, and so on. A genuine
  `500 internal_error` means Mosaic itself hit something unexpected.
- An SDK Asset request whose object
  is missing from the bucket is intended to answer a distinct 404 rather than
  `500 internal_error`. As drilled it answered 500 (the operator log named
  the missing key precisely).

## 422 validation errors

`422 validation_failed` carries a `fields` map naming each offending field
and why. Cases worth knowing:

- **Placement, Placement alias, and Placement attribute keys**: must start
  with a lowercase letter; lowercase letters, digits, underscores only — no
  hyphens (unlike Project/Product keys).
- **`document_paywall_id_mismatch`** on draft creation: the Paywall
  document's `id` must equal the Paywall you are attaching it to.
- **`422 experiment_invalid`** carries a machine-readable `details.reason`
  naming which publish precondition failed — for example
  `environment_release_has_no_placement_decision_contract`: an Experiment can
  only publish into an Environment whose current Release already carries a
  Placement rule set (Delivery v2). Publishing without one returns
  `409 experiment_placement_decision_required` naming the required action:
  publish a Placement rule set there first.
- Analytics query endpoints (`analytics/overview` etc.) require `timezone`
  and `metricBasis`; as drilled, their 422 does not yet name the missing
  parameter in `fields`.

## 406 on `/v1/sdk/configuration`

`406 unsupported_capability` means negotiation found no delivery
representation the client fully supports. The response `details` names the
failed requirement, the offending value, and a reason (`unavailable`,
`malformed`, …) — for example a misspelled Experiment feature
(`group.mutual_exclusion` is the accepted name) or a Release
`requiredFeatures` entry missing from `Mosaic-Decision-Features`.

Once an Experiment is published,
the Environment's Release is intended to retain a Delivery v1 representation
so v1-only SDKs keep fetching. As drilled, such Releases had only v2/v3 and a
v1-only SDK received 406 (the SDK fails safe on its cached configuration).

## Dashboard problems

From [`docs/dashboard/operations.md`](../dashboard/operations.md):

- **Blank page** — check the browser console for a module load failure
  (stale HTML after a deploy: hard-reload); confirm the container is healthy
  (`docker compose ps`); `jsxDEV is not a function` in the server log means
  the image was built with a development `NODE_ENV` — rebuild.
- **Sign-in loop (repeated 401)** — the dashboard is served over plain
  `http://` on a non-`localhost` host (the session cookie is `Secure` and the
  browser drops it); or the API and dashboard are on different sites and
  `SameSite` blocks the cookie — serve both behind one origin; or the API
  base URL points at a different API than the one that issued the session
  (check `/diagnostics`).
- **CORS errors in the console** — the API must list the dashboard's exact
  origin in `MOSAIC_CORS_ALLOWED_ORIGINS` and allow credentials; a wildcard
  origin cannot be combined with credentials. Fix the API configuration, not
  the dashboard.
- **Cookie never set** — confirm `Set-Cookie` is present, the connection is
  HTTPS or `localhost`, the cookie domain covers the dashboard host, and no
  extension blocks it.
- **Wrong API URL** — `/diagnostics` shows the resolved value;
  `MOSAIC_DASHBOARD_API_BASE_URL` is read by the dashboard **server**
  process and must be an absolute `http(s)` URL, else it falls back to the
  default.
- Every dashboard error surfaces an `X-Request-ID` correlation identifier —
  search the API logs for it, exactly as in the 500 section above.

## The worker is not processing jobs

The worker runs in every installation (it is not profile-gated) and handles
analytics aggregation, exports, deletions, retention, and Experiment
scheduling.

```bash
docker compose ps worker
docker compose exec worker /usr/local/bin/healthcheck http://127.0.0.1:8081/health/ready
docker compose logs worker
```

Each finished job logs one line with `job_family`, `job_id`, `job_kind`,
`project_id`, `duration`, `failed`, and (where a span exists) `trace_id`. Via
OTLP, watch `mosaic.worker.queue.depth`,
`mosaic.worker.queue.oldest_age_seconds` (a busy queue drains; a stuck one
ages), and `mosaic.worker.queue.dead_lettered` (a job exhausted its retry
budget — its `last_error_code` says why). A worker killed mid-job strands a
lease that is reclaimed automatically after expiry (verified with `kill -9`
in the drill). See the [worker-backlog runbook](../runbooks/worker-backlog.md).

## 429 Too Many Requests

Limits are per surface (`auth`, `delivery`, `ingestion`, `api`, `decision`),
not one global limit; each is tunable in `.env`
(`MOSAIC_*_REQUESTS_PER_MINUTE` / `_BURST`). Responses carry `Retry-After`.
Rejections are observable as `mosaic.http.rate_limit.rejections` by surface.

If **all** clients behind a proxy hit limits together: forwarded client IPs
are ignored unless the proxy is listed in `MOSAIC_TRUSTED_PROXY_CIDRS`, so
every request keys on the proxy's address. Set the CIDRs to exactly your edge
(too broad makes client IPs spoofable).

## The SDK cannot fetch configuration

- **401 `unauthenticated`** — wrong or rotated key. Public SDK keys are
  scoped to one Environment; a key for the wrong Environment, a revoked key,
  or a pre-rotation secret all fail (rotation invalidates the old secret
  immediately — verified in the drill).
- **406** — see the capability section above.
- **304 is success**, not failure: a conditional request with the current
  `ETag` returns 304 with no body; the SDK serves its cache. Only a stale
  validator gets a full 200 body.
- **Mosaic down entirely** — SDKs serve their cached configuration;
  `Cache-Control: private, max-age=60, stale-if-error=86400` also tells
  intermediaries they may serve stale for 24h on origin errors.
- **Events rejected** rather than configuration: a first batch answering
  `409 analytics_collection_disabled` means analytics collection is off (the
  default for every new Environment) — enable it with
  `PUT .../analytics/settings`. Batches with far-future timestamps are
  permanently rejected (`occurred_at_too_far_future`) — check device clock
  handling.
