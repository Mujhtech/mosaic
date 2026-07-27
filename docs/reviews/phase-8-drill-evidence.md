# Phase 8 Stage 4 — GA Drill Evidence

Operator: mosaic-backend agent
Date: 2026-07-27
Branch: `phase/8-operational-hardening`
Scope: Drills 1–10 and 12–14 (API side). Drill 11 (SDK cache rendering) is owned
by the SDK agents; its API-side contract is recorded under Drill 8.

**Honesty rule applied throughout.** Every section states exactly what was run.
A step that was not executed, or was executed in a reduced form, is recorded as
such and never presented as a pass. No secret values appear in this document:
keys, passwords, session tokens, and keyring material are redacted to a shape
description or an identifier.

## Environment

| Item | Value |
| --- | --- |
| Host | Apple Silicon macOS (Darwin 25.5.0), arch `arm64` |
| Docker Engine | 29.4.0 (build 9d7ad9f) |
| Docker Compose | v5.1.2 |
| Go toolchain | go1.26.2 darwin/arm64 |
| PostgreSQL | `postgres:17-alpine` (Compose) |
| Object storage | `minio/minio:RELEASE.2025-07-23T15-54-02Z`, `minio/mc:RELEASE.2025-07-21T05-28-08Z` |
| Compose project | `mosaic-drill` (isolated) |
| Published ports | api 18080, dashboard 13000, TLS edge 18443, postgres 15432 (debug), MinIO console 19001 (debug) |
| Data | Seeded through the API during the drills. **No production data exists or was used.** |
| Version stamp | `MOSAIC_VERSION=drill-phase8` |

### Isolation

`compose.yaml` pins explicit `name:` values on all four named volumes, which
defeats `-p` project isolation on its own — `docker volume ls` confirmed
`mosaic_postgres_data`, `mosaic_minio_data`, `mosaic_caddy_data`, and
`mosaic_caddy_config` already existed from ordinary development. A drill-only
override file therefore renamed each volume:

```yaml
# scratchpad/drill/compose.drill.yaml
volumes:
  mosaic_postgres_data:  { name: mosaic_drill_postgres_data }
  mosaic_minio_data:     { name: mosaic_drill_minio_data }
  mosaic_caddy_data:     { name: mosaic_drill_caddy_data }
  mosaic_caddy_config:   { name: mosaic_drill_caddy_config }
```

All drill commands ran through a wrapper equivalent to:

```bash
COMPOSE_PROJECT_NAME=mosaic-drill \
COMPOSE_FILE=compose.yaml:scratchpad/drill/compose.drill.yaml \
COMPOSE_ENV_FILES=scratchpad/drill/drill.env \
  docker compose "$@"
```

`apps/api/.env` was neither read nor copied. The drill `.env` was created by
copying `.env.example` and appending dev-safe values (distinct passwords, high
ports, a freshly generated 32-byte keyring, `MOSAIC_ENVIRONMENT=development`).

---

## Drill 1 — Clean installation

- Start: 2026-07-27T12:39:12Z
- End: 2026-07-27T12:55:30Z
- Result: **PASS, after fixing two drill-blocking defects found during the run**

### Commands and results

```bash
cp .env.example scratchpad/drill/drill.env    # + dev-safe overrides
docker compose -p mosaic-drill … build api dashboard      # exit 0
docker compose -p mosaic-drill … up -d                    # exit 0
```

Every service reached its own healthcheck on the first `up`:

```
api        running healthy
dashboard  running healthy
local-edge running
minio      running healthy
postgres   running healthy
worker     running healthy
```

Health endpoints:

```
GET  /health/live   -> 200  {"data":{"status":"ok","version":"drill-phase8"}}
GET  /health/ready  -> 200  {"data":{"status":"ready","version":"drill-phase8"}}
worker /health/ready (in-container healthcheck binary) -> ready
GET  http://localhost:13000/  -> 307   (dashboard responds; redirect to sign-in)
```

Migrations: `migrate status` reported 21 applied, `0 pending migration(s)`, ids
`00001`–`00021`.

### Administrator, workspace, and publish workflow

| Step | Endpoint | Result |
| --- | --- | --- |
| Create administrator | `POST /v1/auth/signup` | 201, `user_0f91d9bb…` |
| Session | `GET /v1/auth/session` | 200 |
| Organization | `POST /v1/organizations` | 201, `org_000001` |
| Project | `POST /v1/projects` | 201, `project_000001` (key `drill-a`) |
| Environments | `GET /v1/projects/{id}/environments` | 200 — `env_000001` development, `env_000002` staging, `env_000003` production, auto-seeded by project creation |
| Application | `POST /v1/projects/{id}/applications` | 201, `app_000001` (ios) |
| Paywall | `POST /v1/projects/{id}/paywalls` | 201, `paywall_000001` |
| Draft | `POST …/paywalls/{id}/drafts` | 201, `draft_000001` revision 1 |
| Validate draft | `POST …/drafts/{id}/validate` | 200 `{"errors":[],"warnings":[]}` |
| Placement | `POST /v1/projects/{id}/placements` | 201, `placement_000001` |
| Bind placement | `PUT …/placements/{id}/binding` | 200 |
| Publish | `POST …/environments/{id}/publish` | 201, `release_000001`, `contentHash 6264b08dbc980ee233f2d29fc551d4f5199276372c408cad52dfde4a7fd7bc6e`, `warnings: []` |
| Public SDK key | `POST /v1/environments/{id}/api-keys` | 201, `key_000001` kind `public_sdk` (secret returned once; redacted) |

The Paywall document was `protocol/fixtures/v0.2/navigation-only.json` with its
`id` rewritten to the created Paywall id.

### Configuration delivery with the SDK key

```
GET /v1/sdk/configuration
  Authorization: Bearer <public SDK key, redacted>
  Mosaic-SDK-Platform: ios      Mosaic-SDK-Version: 1.0.0
  Mosaic-Configuration-Versions: 3,2,1
  Mosaic-Paywall-Protocol-Versions: 0.2
  Mosaic-Paywall-Capabilities: <13 v0.2 capabilities>
-> HTTP 200
   Content-Type:  application/vnd.mosaic.configuration+json;version=1
   ETag:          "sha256-6264b08dbc980ee233f2d29fc551d4f5199276372c408cad52dfde4a7fd7bc6e"
   Cache-Control: private, max-age=60, stale-if-error=86400
   Vary:          Authorization, Accept-Encoding, Mosaic-SDK-* (15 headers)
```

**Delivered release digest:** ETag
`sha256-6264b08dbc980ee233f2d29fc551d4f5199276372c408cad52dfde4a7fd7bc6e`,
equal to the `contentHash` returned by the publish call and by
`GET …/releases`. The payload additionally carries
`release.contentDigest = sha256:8b78de55a3b48f845d68bdfe3e2eda575f71339742f619a0f625f15dd4d0de7e`,
which is the digest of the negotiated representation rather than of the Release —
two different values by design, but easy to confuse in a runbook (see follow-ups).

Negotiation selected delivery contract **v1** even though the request advertised
`3,2,1`, because the request advertised no Placement-decision, bucketing, or
Experiment headers. This is the documented negotiation rule, not a defect; v3 is
exercised in Drill 14.

### Defects found

**D1-1 (fixed, drill-blocking). Signup and login performed a live DNS MX lookup
on the submitted email domain.**
`apps/api/internal/transport/browserauth/handler.go` validated both addresses
with ozzo's `is.Email`, which is `govalidator.IsExistingEmail`:

```go
// govalidator
if _, err := net.LookupMX(host); err != nil {
    if _, err := net.LookupIP(host); err != nil { return false }
}
```

Observed: `admin@mosaic-drill.internal`, `admin@drill.test`,
`admin@studio.example`, `admin@b.local`, `admin@deep.subdomain.example.com` all
returned `422 {"email":["must be a valid email address"]}`, while
`admin@example.com` was accepted — `example.com` and `localhost` are hard-coded
exceptions inside govalidator. The first administrator therefore could not be
created on a self-hosted installation whose operators use an internal-only mail
domain, and could not be created at all without outbound DNS from the API
container. That is release-blocker category 16 (installation failure in the
supported deployment profile). It also placed an unbounded, uncancellable
network call inside two unauthenticated handlers and leaked the operator's mail
domain to DNS on every login attempt.

Fix: validate format only (`is.EmailFormat`), with the reasoning recorded at the
call site. Verified: `POST /v1/auth/signup` with `admin@mosaic-drill.internal`
returned 201.

**D1-2 (fixed, drill-blocking). Placement, Placement alias, and Placement
attribute keys were validated by length alone, so a hyphenated key became an
unexplained 500 — and the cause was never logged.**

`POST /v1/projects/project_000001/placements` with `{"key":"drill-onboarding"}`
returned `500 internal_error`. PostgreSQL enforces
`CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$')` on `placements.key`,
`placement_aliases.key`, and `placement_attribute_definitions.key` — the only
keys in the schema that forbid hyphens — while the transport structs checked
only `validation.Length`. `openapi.yaml` already documented the pattern for
aliases, so the runtime validator disagreed with the published contract.

The 500 was undiagnosable: the only trace in `docker compose logs api` was the
access-log line

```json
{"level":"info","request_id":"…-000022","http_method":"POST",
 "http_path":"/v1/projects/project_000001/placements","http_status":500,
 "http_route":"/v1/projects/{projectId}/placements","message":"http request completed"}
```

with no error entry at all. `response.Error` built an `APIError{Cause: err}` and
then discarded `Cause` for every 5xx. Every runbook step that says "check
`docker compose logs api`" was unable to explain a 500.

Fixes: a shared `requestvalidation.PlacementKey()` rule mirroring the CHECK
constraint, applied to all three request structs; and `response.Error` now emits
a zerolog error entry (status, method, route pattern, request id, cause) for any
5xx while keeping the response body at `internal_error` + request id. OpenAPI
gained the missing `pattern` on `CreatePlacementRequest.key` and
`CreatePlacementAttributeRequest.key`.

Verified after rebuild:

```
POST …/placements {"key":"drill-onboarding"}  -> 422
  {"code":"validation_failed","fields":{"key":["must start with a lowercase letter
    and contain only lowercase letters, digits, and underscores"]}}
POST …/placements {"key":"drill_onboarding"}  -> 201 placement_000001
```

### Installation-documentation gaps found by running it

Steps the drill needed that the installation path does not state:

1. **The Paywall document's `id` must equal the created Paywall's id.** The first
   draft creation failed with `422 document_paywall_id_mismatch`. Nothing in the
   publishing documentation says the caller must rewrite `document.id`.
2. **Publishing requires at least one Placement bound to the Paywall.**
   Publishing with zero Placements returned `409 placement_unpublished`
   ("Every active Placement binding must resolve to a published Paywall"), which
   reads as though a binding exists and is stale. A first-run installation has no
   Placements at all, so the very first publish always hits this.
3. **There is no environment-creation endpoint.** Environments are seeded by
   `POST /v1/projects`; the workflow must list them.
4. **Placement keys cannot contain hyphens** while Project and Product keys can.
   Now enforced at the boundary, but the asymmetry is undocumented.
5. **`scripts/*.sh` all invoke bare `docker compose`**, so they only ever act on
   the default project. Running them against a non-default installation requires
   `COMPOSE_PROJECT_NAME` / `COMPOSE_FILE` / `COMPOSE_ENV_FILES` in the
   environment; the backup, restore, and upgrade documents do not mention this.
6. **The API-key creation response nests the key** as
   `data.apiKey` + `data.secret`; the paywall-draft response nests as
   `data.draft` + `data.document`. Both are correct per OpenAPI but neither is
   shown in a worked example.

### Recovery performed

None required beyond rebuilding the `api` image twice to pick up the two fixes
(`docker compose build api && docker compose up -d api worker`). No data was
lost; the release published before the second rebuild still served afterwards.

---

## Drill 7 — Dependency failure

- Start: 2026-07-27T12:57:42Z
- End: 2026-07-27T12:59:45Z
- Result: **PASS**

### PostgreSQL unavailable

```bash
docker compose -p mosaic-drill … stop postgres
curl -s http://localhost:18080/health/live   # 200 {"data":{"status":"ok","version":"drill-phase8"}}
curl -s http://localhost:18080/health/ready  # 503
```

```json
{"error":{"code":"not_ready","message":"A required dependency is unavailable.",
  "details":{"checks":["database_unavailable","migration_incompatible"]},
  "requestId":"…-000007"}}
```

The response carries safe diagnostic codes only — no host, port, user, database
name, or connection string. Restarting PostgreSQL restored readiness to 200
**without restarting the API**: `docker inspect … RestartCount = 0`.

Note: readiness reports both `database_unavailable` and
`migration_incompatible` when PostgreSQL is down, because the migration check
also needs the database. It is safe but slightly misleading — an operator could
chase a schema problem that does not exist. Recorded as a follow-up, not a
defect.

### Object storage unavailable

```bash
docker compose -p mosaic-drill … stop minio
curl -s http://localhost:18080/health/live   # 200
curl -s http://localhost:18080/health/ready  # 503
```

```json
{"error":{"code":"not_ready","details":{"checks":["object_storage_unavailable"]},…}}
```

Configuration delivery kept serving throughout (`GET /v1/sdk/configuration` →
200), which is the correct policy: the Release payload is in PostgreSQL and an
object-storage outage must not stop delivery. Restarting MinIO restored
readiness with `RestartCount = 0`.

### Telemetry failure

`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-does-not-exist.invalid:4318`, API
restarted:

```
/health/live  200
/health/ready 200
/v1/sdk/configuration 200 (5/5 requests)
```

Export failures were emitted repeatedly and the service was unaffected:

```
traces export: Post "http://otel-does-not-exist.invalid:4318/v1/traces":
  dial tcp: lookup otel-does-not-exist.invalid on 127.0.0.11:53: no such host
```

Follow-up: those lines come from the OpenTelemetry default error handler through
the standard library logger, so they are **plain text, not zerolog JSON**, unlike
every other line the API writes. A JSON log pipeline drops or mangles them.

### Secret scan

All container logs for the whole drill were scanned for the three configured
secrets and for session tokens:

```
occurrences of the configured PostgreSQL password in all container logs: 0
occurrences of the configured MinIO password in all container logs:      0
occurrences of the configured keyring key material in all container logs: 0
session-cookie tokens matching mosaic_session=<token>:                    0
```

The readiness *log* (not the response) does include the connection target, e.g.
`failed to connect to \`user=mosaic database=mosaic\`: 192.168.148.2:5432 …`.
No password appears; this is operator-log topology, which the health policy
permits, while the HTTP response carries only the code.

---

## Drill 8 — Configuration delivery recovery (API-side contract)

- Start: 2026-07-27T12:57:11Z
- End: 2026-07-27T12:57:30Z
- Result: **PASS** for the API-side contract. SDK cache rendering during an
  outage is an SDK-suite responsibility and was **not** exercised here; it is not
  claimed.

| Step | Result |
| --- | --- |
| `GET /v1/sdk/configuration` | 200, `ETag: "sha256-6264b08d…bc6e"`, `Cache-Control: private, max-age=60, stale-if-error=86400` |
| Same request with `If-None-Match: <that ETag>` | **304**, 0 bytes, same `ETag`, same `Cache-Control` |
| Same request with `If-None-Match: "sha256-0000"` | 200 (full body — a stale validator is not honoured) |
| API stopped, conditional GET | connection refused (curl exit 7) — expected; the SDK's own cache covers this window |
| API restarted, conditional GET with the original ETag | **304**, byte-identical `ETag` |

`stale-if-error=86400` is present on both the 200 and the 304, so an
intermediary is told it may serve the cached representation for 24 hours when the
origin errors.

---

## Drill 14 — Placement and Experiment conformance

- Start: 2026-07-27T13:00:10Z
- End: (see below)
- Result: **PASS on the zero-conversions blocker verification, after fixing two
  further drill-blocking defects that made Experiment publishing impossible.**

This is the drill the Phase 7 owner condition depends on. It is recorded step by
step because two of its steps failed the first time for real reasons.

### Setup

| Resource | Id |
| --- | --- |
| Entitlement | `entitlement_000001` (`pro`) |
| Products | `product_000001` (`monthly`), `product_000002` (`annual`) |
| Paywall A / version | `paywall_000001` / `version_000001` |
| Paywall B / version | `paywall_000002` / `version_000002` |
| Placement A | `placement_000001` (`drill_onboarding`), bound to Paywall A |
| Placement B | `placement_000002` (`drill_treatment_stage`), bound to Paywall B |
| Rule set | `ruleset_000001` → published `ruleset_version_000001` |
| Experiment | `experiment_000001` → `experiment_version_000001` |

### Placement rule set with a rule set and rollout

The published rule set carries a deterministic rollout rule:

```json
{"id":"rule_rollout_50_percent","priority":10,"enabled":true,
 "conditions":{"type":"condition","source":{"kind":"device.platform"},
   "operator":"equals","operand":{"type":"string","value":"ios"}},
 "rollout":{"algorithm":"sha256_length_prefixed_v1","thresholdBasisPoints":5000},
 "outcome":{"type":"paywall","paywallVersionId":"version_000001"}}
```

`POST …/rule-sets/{id}/publish` → `ruleset_version_000001`, validation
`{"valid":true,"issues":[]}`.

Workflow friction recorded (not defects, but undocumented):

- `POST …/rule-set` requires an `Idempotency-Key` header and returns
  `428 precondition_required` without one.
- `PUT …/rule-sets/{id}/draft` requires the **opaque ETag** in `If-Match`
  (`"ruleset-draft:ruleset_draft_000001:1"`); the bare revision number returns
  `412 draft_revision_conflict` whose `details.currentRevision` equals the
  revision you just sent, which reads as a bug in the caller's bookkeeping rather
  than a wrong `If-Match` format.
- The rule-set document must be the **server's** document with edits applied. A
  hand-built document with the same content but a client-chosen `ruleSet.id`
  fails `rule_set_identity_mismatch`.
- `docs/reviews/phase-5-demo-rule-set.json` — the Phase 5 demo artefact — is
  **not a valid rule set**: it omits the required `defaultOutcome`,
  `qaOverrides`, and `compatibility` members. Copying it produces
  `unsupported_outcome` at `defaultOutcome`. Reported to the Phase 5 evidence
  owner, not fixed here.

### Deterministic decision

Five consecutive `GET /v1/sdk/configuration` (v3) requests with identical inputs:

```
1 etag="sha256-51a1bd274098f8fc… decisions_sha=8affb1e9849218b1 assignments_sha=5bc1e6a396259475
2 etag="sha256-51a1bd274098f8fc… decisions_sha=8affb1e9849218b1 assignments_sha=5bc1e6a396259475
3 etag="sha256-51a1bd274098f8fc… decisions_sha=8affb1e9849218b1 assignments_sha=5bc1e6a396259475
4 etag="sha256-51a1bd274098f8fc… decisions_sha=8affb1e9849218b1 assignments_sha=5bc1e6a396259475
5 etag="sha256-51a1bd274098f8fc… decisions_sha=8affb1e9849218b1 assignments_sha=5bc1e6a396259475
```

Recomputing local assignments from three separate fetches produced identical
buckets and Variants:

```
[('drill_install_001', 8011, 'treatment'), ('drill_install_004', 5648, 'treatment'), ('drill_install_007', 4882, 'control')]
```

### Defects found in this drill

**D14-1 (fixed, drill-blocking, GA blocker). Experiment publish always failed:
the release-closure query selected a column that does not exist.**

`POST …/experiments/{id}/publish` returned `500 internal_error`. With the D1-2
logging fix in place the cause was immediately visible:

```json
{"message":"request failed with an unexpected error",
 "http_route":"/v1/projects/{projectId}/environments/{environmentId}/experiments/{experimentId}/publish",
 "error":"experiment persistence: ERROR: column a.url does not exist (SQLSTATE 42703)"}
```

`apps/api/internal/platform/experimentpostgres/repository.go` selected
`a.url` from `assets`; the column is `public_url`.

**D14-2 (fixed, drill-blocking, GA blocker). Experiment publish then failed on
two semicolon-joined parameterized statements.**

```
experiment persistence: ERROR: cannot insert multiple commands into a prepared
statement (SQLSTATE 42601)
```

`publishRelease` issued two `tx.Exec` calls whose SQL was several `INSERT`
statements joined by `;` **with bind parameters**. pgx speaks the extended
protocol, which permits exactly one statement per parameterized call, so both
always failed.

Together these two defects mean **no Experiment could ever reach a published
Version against PostgreSQL** — which is the mechanical explanation for the Phase 7
"zero conversions" symptom: there was never a published Experiment Version for
exposures to attribute to. Neither defect was reachable by the existing tests,
because the only tests touching this code are unit tests over in-memory
structures.

Fixes: `a.public_url`; the joined statements split into
`carryForwardReleaseMaterialStatements` and
`experimentVariantReleaseMaterialStatements`, executed one per `Exec`.

Verified: `POST …/publish` → 200 with `experiment_version_000001`, Control
allocation `[0,5000)`, Treatment `[5000,10000)`, bucketing
`experiment_sha256_length_prefixed_v1`, allocation version
`experiment_allocation_000001`, and the Experiment transitioned to `running`.
`release_000003` was created with `deliveryContractVersion: "3"`.

### Workflow limitation found (reported, not fixed)

An Experiment requires a **distinct** immutable Paywall Version per Variant
(`paywall_version_invalid` otherwise), but a Paywall Version can only be minted
by publishing that Paywall's draft, and publishing refuses unless the Paywall is
bound to a Placement in the Environment (`service_publish.go`, the
`if !publishedDraft` guard). A Placement holds one binding per Environment. So
minting a treatment Paywall Version requires creating a second, otherwise
pointless Placement purely as a staging slot — which is what this drill did
(`placement_000002` / `drill_treatment_stage`). Nothing documents this, and all
five failure conditions in that guard collapse into one `placement_unpublished`
code whose message ("Every active Placement binding must resolve to a published
Paywall") does not describe the case actually hit. Left for the owner: changing
publish semantics is a design decision, not a drill fix.

### v3 negotiation

Reaching `deliveryContractVersion: "3"` required advertising the exact known
feature vocabulary. Two attempts returned `406 unsupported_capability`:

- `mutual_exclusion.groups` — the accepted name is `group.mutual_exclusion`.
- The Release's `requiredFeatures` (`source.device.platform`,
  `source.identity.user_present`) had to be present in
  `Mosaic-Decision-Features`.

Successful request headers and result:

```
Mosaic-Configuration-Versions: 3,2,1
Mosaic-Paywall-Protocol-Versions: 0.2
Mosaic-Placement-Decision-Versions: 1
Mosaic-Bucketing-Algorithms: sha256_length_prefixed_v1
Mosaic-Experiment-Assignment-Versions: 1
Mosaic-Experiment-Features: allocation.ranges,assignment.installation,
  assignment.identified_user,assignment.identified_user_or_installation,
  fallback.normal_placement,group.mutual_exclusion,override.qa,
  schedule.trusted_server_time
Mosaic-Experiment-Bucketing-Algorithms: experiment_sha256_length_prefixed_v1
Mosaic-Experiment-Schedule-Policies: trusted_server_time_v1
-> 200  Content-Type: application/vnd.mosaic.configuration+json;version=3
        ETag: "sha256-51a1bd274098f8fca7e48c94547d3ee84a485982010cacd1bfda8955e7925804"
```

Follow-up (reported, not fixed): `406 unsupported_capability` names **nothing** —
not in the response, not in any log line. Diagnosing it required reading
`capability_request.go` and querying the Release compatibility block out of
PostgreSQL. An SDK integrator has no path from the error to the cause.

### SDK-side assignment simulation

The SDK was simulated with a stdlib-only script implementing the canonical
algorithm, which **self-verifies against the canonical protocol fixture before
being trusted**:

```
python3 assign.py …
selfcheck: PASS (2 assignment + 1 group vectors)
```

The self-check reproduces, for every vector in
`protocol/fixtures/experiment-assignment/v1/assignment-vectors.json`, the exact
`canonicalUtf8Hex`, `sha256`, `bucket`, and `variantId`. Only then were
assignments computed for the drill's Installations:

| Installation | bucket | Variant |
| --- | --- | --- |
| drill_install_001 | 8011 | treatment |
| drill_install_002 | 2388 | control |
| drill_install_003 | 3544 | control |
| drill_install_004 | 5648 | treatment |
| drill_install_005 | 9568 | treatment |
| drill_install_006 | 4489 | control |
| drill_install_007 | 4882 | control |
| drill_install_008 | 9181 | treatment |

### Ingestion through the real boundary

`POST /v1/sdk/events/batch` with the public SDK key, Analytics Event contract
`"2"`.

First attempt: `409 analytics_collection_disabled`. Analytics collection is
**off by default** for a new Environment (`collectionEnabled: false`,
`rawRetentionDays: 180`) and must be enabled with
`PUT …/analytics/settings`. This is the correct privacy-first default; it is not
documented in the analytics or installation path, and an SDK integrator's first
batch will always be rejected.

```bash
PUT …/analytics/settings {"collectionEnabled":true,"rawRetentionDays":90}   # 200
```

| Batch | Events | Result |
| --- | --- | --- |
| `drill_batch_journey` | 26 | 200, `accepted=26` |
| `drill_batch_fallback` | 15 | 200, `accepted=15` |

The journey batch is `experiment_assigned` ×8 → `experiment_exposed` ×6 →
(`product_selected` + `purchase_started` + `purchase_completed_client`) ×4, each
conversion carrying the full four-field tuple
(`experimentId`, `experimentVersionId`, `experimentVariantId`,
`experimentAllocationVersion`) taken from the locally computed assignment.
Installations 007 and 008 were assigned and **never presented**.

The fallback batch is `experiment_assigned` + `experiment_fallback_presented` +
**tuple-free** `product_selected` / `purchase_started` /
`purchase_completed_client` for three further Installations.

An intermediate honest note: the fallback batch was first rejected in full with
`permanently_rejected / occurred_at_too_far_future` (15/15) because the generated
timestamps were ~6 minutes ahead of server time. That is the ingestion boundary
working correctly; the batch was regenerated with past timestamps and accepted.

Stored rows:

```
experiment_assigned            = 11
experiment_exposed             =  6
experiment_fallback_presented  =  3
product_selected               =  7
purchase_started               =  7
purchase_completed_client      =  7
```

### Aggregation and results — the zero-conversions verification

The worker picked the aggregation jobs up on its own poll
(`{"job_family":"analytics","failed":false,"message":"background job finished"}`).

`GET …/experiments/{id}/results?from=2026-07-26T00:00:00Z&to=2026-07-28T00:00:00Z`:

```json
{"experimentId":"experiment_000001","experimentVersionId":"experiment_version_000001",
 "state":"running","interim":true,
 "variants":[
  {"variantId":"experiment_variant_000001","role":"control","allocationBasisPoints":5000,
   "uniqueExposures":3,"uniqueConversions":2,"estimate":0.667,
   "wilson95":{"lower":0.2077,"upper":0.9385},"rawExposureEvents":3,"fallbackPresentations":1},
  {"variantId":"experiment_variant_000002","role":"treatment","allocationBasisPoints":5000,
   "uniqueExposures":3,"uniqueConversions":2,"estimate":0.667,
   "wilson95":{"lower":0.2077,"upper":0.9385},"rawExposureEvents":3,"fallbackPresentations":2}],
 "lifts":[{"treatmentVariantId":"experiment_variant_000002","absoluteLift":0,
   "newcombe95":{"lower":-0.7308,"upper":0.7308},"relativeLift":0}],
 "srm":{"status":"insufficient_sample","severity":"none", …},
 "warnings":["minimum_variant_exposures","minimum_variant_exposures","minimum_total_conversions"]}
```

Every assertion the drill exists to make:

| Assertion | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| **Treatment conversions are non-zero** | > 0 | `uniqueConversions: 2` | **PASS** |
| Control conversions non-zero | > 0 | `uniqueConversions: 2` | PASS |
| Exposures match presented Installations | 3 control / 3 treatment | 3 / 3 | PASS |
| Conversions match the tuple-bearing journeys | 2 control (002, 003) / 2 treatment (001, 004) | 2 / 2 | PASS |
| **No exposure from assignment alone** | 6 exposures from 11 assignments | `uniqueExposures` 3+3 = 6 | PASS |
| **Fallback conversions do not increment Variant conversions** | conversions stay 2/2 despite 3 tuple-free purchases | 2/2; `fallbackPresentations` 1 control / 2 treatment recorded separately | PASS |
| Minimum-sample warnings present | yes | `minimum_variant_exposures` ×2, `minimum_total_conversions` | PASS |
| Guardrail metric reported | `purchase_failure@1` | `insufficient_data`, denominator 6, numerator 0 | PASS |

The fallback split (1 control, 2 treatment) exactly matches the locally computed
assignments of `drill_fallback_001..003`, so the fallback presentations were
attributed to the right Variants while their conversions were correctly excluded
from the Variant conversion counts. That is the Phase 8 blocker-12 behaviour
(fallback never counted as original exposure) demonstrated at runtime.

### Drill 14 steps NOT RUN

The following Drill 14 steps were prepared but **not executed**, because the
session's command-execution tooling became unavailable partway through (see
"Interrupted session" below). They are recorded as not demonstrated:

- Emergency stop → new Release published → delivery reflects the stop → history
  preserved.
- Raw Experiment export (`POST …/experiments/{id}/exports`) and environment
  analytics export (`POST …/analytics/exports`) returning data.
- Experiment `history` / `versions` comparison before and after the stop.

The ready-to-run script is `scratchpad/drill/s_d14_rest.sh` (not committed).

---

## Interrupted session

Execution stopped after Drill 14's aggregation verification. The command-execution
tooling for this session became unavailable and could not run any non-trivial
command thereafter, so the drills below were **not run at all**. Nothing about
them is claimed, in either direction.

| Drill | Status |
| --- | --- |
| D1 Clean installation | **PASS** (2 drill-blocking defects found and fixed) |
| D2 Upgrade from RC (down-level → preflight → apply → verify) | **NOT RUN** |
| D3 Failed-migration recovery / readiness on pending migrations | **NOT RUN** |
| D4 PostgreSQL backup and restore | **NOT RUN** |
| D5 Object-storage backup and restore | **NOT RUN** |
| D6 Process recovery (worker `kill -9`, API SIGTERM drain) | **NOT RUN** |
| D7 Dependency failure | **PASS** |
| D8 Configuration delivery recovery (API-side contract) | **PASS** |
| D9 Credential rotation | **NOT RUN** |
| D10 Cross-tenant authorization | **NOT RUN** |
| D12 Privacy operations | **PARTIAL** — only the analytics-collection default and toggle were observed (Drill 14); export, deletion, tenant isolation, and audit verification **NOT RUN** |
| D13 Commerce smoke (mock/custom provider) | **NOT RUN** |
| D14 Placement + Experiment conformance | **PASS on the zero-conversions blocker verification**; emergency stop and exports **NOT RUN** (2 further drill-blocking defects found and fixed) |
| Full integration suite (`go test -p 1 ./...`) | **NOT RUN** |
| Triage of the two pre-existing failures | Analysis only, no run — see below |
| Performance harness (`cmd/loadgen`) | **NOT RUN** — no numbers were measured, so nothing was recorded in `docs/backend/operations/performance.md` |

### Cleanup

`docker compose -p mosaic-drill down -v` **was executed successfully**. All eight
drill containers were removed and all four drill volumes
(`mosaic_drill_postgres_data`, `mosaic_drill_minio_data`,
`mosaic_drill_caddy_data`, `mosaic_drill_caddy_config`) plus the
`mosaic-drill_default` network were deleted. Because the drill used renamed
volumes, the pre-existing development volumes (`mosaic_postgres_data`,
`mosaic_minio_data`, `mosaic_caddy_data`, `mosaic_caddy_config`) were never
touched.

The `mosaic_test` database created inside the drill PostgreSQL for
`DATABASE_TEST_URL` runs, and the `debug`-profile `postgres-debug-ports` socat
container, went away with the teardown. All drill scratch files (env file, keys,
generated batches, helper scripts) live outside the repository in the session
scratchpad; nothing was left in the working tree except the fixes and this
document.

Consequence: the drills marked NOT RUN cannot be resumed from this environment —
a fresh `up -d` is required.

---

## Triage: the two pre-existing integration failures

Neither test was executed in this session, so this is **static analysis, not a
verified diagnosis**.

### `TestPhase3APersistenceRisks` — `repository_integration_test.go:350`

Line 350 is `t.Fatalf("persist provider connection: %v", err)`, reached from a
`CreateProviderConnection` call that passes:

```go
Name: "RevenueCat sandbox", Provider: cloudworkspace.ProviderRevenueCat,
IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
EnvironmentIDs: …, ApplicationIDs: …,
```

— with **no `ExternalProjectID` and no `Credential`**.

`cloudworkspace.CreateProviderConnection` (`service_provider.go:250-258`) rejects
exactly that:

```go
if input.Provider == ProviderRevenueCat &&
    (strings.TrimSpace(input.ExternalProjectID) == "" || … ) {
    return ErrProviderProjectInvalid
}
if input.Provider == ProviderRevenueCat && s.providerCatalog != nil {
    if input.Credential == "" { return ErrProviderCredentialInvalid }
}
```

Three independent sources agree the **validation is right and the test is
stale**:

1. `docs/backend/openapi.yaml` `CreateProviderConnectionRequest` declares
   `if provider == revenuecat then required: [externalProjectId, credential]`.
2. The in-memory service tests (`service_test.go:343`, `:352`, `:362`, `:505`)
   all pass `ExternalProjectID`.
3. The **same** integration test file constructs a second connection correctly at
   line ~743 with `ExternalProjectID: "proj_resource"` and
   `Credential: "sk_integration_secret_2"` — so the file was partially updated
   when the invariant landed and this earlier call site was missed.

Proposed minimal, test-side fix (**not applied**, because it must be verified by
running the suite, which this session could not do): add
`ExternalProjectID: "proj_phase3a"` to the line-344 input, plus
`Credential: "sk_integration_secret_1"` **if and only if** that test's service is
constructed with a non-nil `providerCatalog` — when the catalog is nil, a
non-empty `Credential` is itself rejected with `ErrProviderUnsupported`, so the
correct input depends on the fixture. That branch was not confirmed.

### `TestPhase4AProviderPersistenceRisks` — `repository_integration_test.go:777`

Line 777 is the failure branch of

```go
readiness, err := service.ProviderReadiness(ctx, actor, …MosaicProductID, development.ID, application.ID)
if err != nil || readiness.ConnectionID != secondConnection.ID || len(readiness.Blockers) != 0 {
```

The assertion is that after switching the active provider assignment to a
replacement connection, readiness resolves to that connection with **zero**
blockers. **This was not triaged.** The message interpolates `readiness` and
`err`, so the actual failing sub-condition (wrong `ConnectionID`, a non-empty
`Blockers` list, or a returned error) is only visible in a real run, and it is not
safe to guess between "the readiness rule tightened and the assertion is stale"
and "readiness genuinely regresses across a connection replacement". The second
possibility is release-blocker category 8 (incorrect commerce Product
resolution), so this needs the suite run before any conclusion is recorded.

---

## Defect summary

### Found and fixed (all in `apps/api`, all drill-blocking)

| Id | Defect | Files |
| --- | --- | --- |
| D1-1 | Signup/login email validation performed a live DNS MX lookup, blocking administrator bootstrap on isolated or internal-domain installations | `apps/api/internal/transport/browserauth/handler.go`, `handler_test.go` |
| D1-2a | Placement / alias / attribute keys validated by length only; the DB forbids hyphens, so a valid-looking key returned 500 | `apps/api/internal/platform/requestvalidation/requestvalidation.go` (+ test), `apps/api/internal/transport/hostedpublishing/handler.go`, `apps/api/internal/transport/placementdecision/handler.go`, `docs/backend/openapi.yaml` |
| D1-2b | Every 5xx discarded its cause: no error log line at all, making all "API returned 500" runbooks unusable | `apps/api/internal/platform/httpserver/response/response.go` (+ tests) |
| D14-1 | Experiment publish selected `assets.url`; the column is `public_url` | `apps/api/internal/platform/experimentpostgres/repository.go` (+ integration test) |
| D14-2 | Experiment publish issued semicolon-joined parameterized statements, which pgx's extended protocol rejects | `apps/api/internal/platform/experimentpostgres/repository.go` (+ integration test) |

D14-1 and D14-2 together made it impossible for any Experiment to reach a
published Version against PostgreSQL, which is the mechanical cause of the
Phase 7 "zero conversions" symptom.

### Found, not fixed (reported)

| Defect | Owner | Why not fixed here |
| --- | --- | --- |
| `406 unsupported_capability` identifies no missing capability, in the response or any log | mosaic-backend + mosaic-protocol | Adding detail to a protocol error response is a contract decision |
| Publishing an Experiment treatment Paywall Version requires creating a throwaway Placement; five distinct failures share one `placement_unpublished` code and a message that does not describe most of them | mosaic-backend (owner ruling needed) | Changing publish semantics under feature freeze is a design decision |
| Readiness reports `migration_incompatible` alongside `database_unavailable` when PostgreSQL is simply down | mosaic-backend | Cosmetic; would change readiness diagnostics |
| OpenTelemetry export failures are plain-text stdlib log lines, not zerolog JSON, unlike every other API log line | mosaic-backend | Needs an OTel error-handler wiring decision |
| Worker job logs carry `job_family` and `worker_id` but not job id, tenant id, or trace id, which the Phase 8 plan requires | mosaic-backend | Not drill-blocking; observed, not investigated |
| `docs/reviews/phase-5-demo-rule-set.json` is not a valid rule set (missing `defaultOutcome`, `qaOverrides`, `compatibility`) | Phase 5 evidence owner | Historical review artefact |
| `scripts/backup-postgres.sh`, `restore-*.sh`, `backup-objects.sh`, and `upgrade.sh` all call bare `docker compose`, so they only ever act on the default Compose project; the operations docs do not mention `COMPOSE_PROJECT_NAME` / `COMPOSE_FILE` / `COMPOSE_ENV_FILES` | mosaic-backend | Documentation, Stage 5 scope |
| `compose.yaml` pins explicit volume `name:` values, so `-p` does not isolate data between two installations on one host | mosaic-backend (owner ruling needed) | Intentional for the single-host profile; worth an explicit note either way |
| Undocumented first-run requirements: Paywall document `id` must equal the Paywall id; the first publish needs a Placement bound to the Paywall; analytics collection is off by default so the first SDK batch is always rejected; rule-set drafts need the opaque ETag in `If-Match` | mosaic-backend / mosaic-dashboard docs | Stage 5 documentation scope |

## Verification state of the committed changes

Every Go change was formatted, built, vetted, and the touched packages' tests run
before the session was interrupted:

```
gofmt -l internal cmd                                  # clean
go build ./...                                          # OK
go vet ./internal/transport/... ./internal/platform/httpserver/... \
       ./internal/platform/requestvalidation/ ./internal/platform/experimentpostgres/   # OK
go test ./internal/transport/browserauth/               # ok
go test ./internal/platform/requestvalidation/          # ok
go test ./internal/transport/hostedpublishing/          # ok
go test ./internal/transport/placementdecision/         # ok
go test ./internal/platform/httpserver/...              # ok
go test ./internal/platform/experimentpostgres/ -run TestReleaseClosureStatementsMatchTheSchema
                                                        # ok (with DATABASE_TEST_URL)
```

The new `TestReleaseClosureStatementsMatchTheSchema` was verified to **fail**
before the fix and pass after it:

```
--- FAIL: TestReleaseClosureStatementsMatchTheSchema
    release-closure statement 2 does not match the schema:
      ERROR: column a.url does not exist (SQLSTATE 42703)
```

The **full** suite (`go test -p 1 ./...`) was not run.

## Tests added, and the risk each one protects

| Test | Risk it protects |
| --- | --- |
| `TestEmailValidationDoesNotDependOnDomainResolution` (`internal/transport/browserauth`) | Administrator bootstrap must not depend on outbound DNS or on the operator's mail domain being publicly resolvable. Asserts internal-only and RFC 2606 domains are accepted and malformed addresses still rejected. |
| `TestPlacementKeyMatchesDatabaseConstraint` (`internal/platform/requestvalidation`) | Transport validation must not be weaker than the PostgreSQL CHECK constraint, or an invalid key becomes a 500 instead of a field error. Pins the pattern to migrations 00009/00011. |
| `TestUnexpectedErrorIsLoggedForOperators` (`internal/platform/httpserver/response`) | A 5xx must be diagnosable: the cause reaches the operator log with the request id, and never reaches the response body. |
| `TestClientErrorIsNotLoggedAsUnexpected` (same package) | The above must not flood the error log with ordinary 4xx validation traffic, which would bury the signal it exists to create. |
| `TestReleaseClosureStatementsMatchTheSchema` (`internal/platform/experimentpostgres`) | The Experiment publish SQL must match the real schema and pgx's one-statement-per-parameterized-call rule. This path had no test and carried both defects that made Experiment publishing impossible. |

No new test suite, test framework, or test dependency was introduced.
</content>

---

# Phase 8 Stage 4 — GA Drill Evidence, pass two

Operator: mosaic-backend agent
Date: 2026-07-27
Branch: `phase/8-operational-hardening`
Scope: the drills pass one left NOT RUN (D2–D6, D9, D10, D12, D13, the D14
remainder), the full integration suite, the two triage items, and the
performance measurements. Pass one's D1/D7/D8/D14-blocker results stand
unchanged above.

**Honesty rule applied throughout.** Every section states exactly what was run.
Steps that were not executed are recorded as not demonstrated and never
presented as a pass. No secret values appear here: keys, passwords, and keyring
material are reduced to a shape description or an identifier.

## Environment

| Item | Value |
| --- | --- |
| Host | Apple Silicon macOS (Darwin 25.5.0), arm64, 12 CPU, 16 GiB |
| Docker Engine | 29.4.0; 12 CPU / 7.8 GiB allocated |
| Go toolchain | go1.26.2 darwin/arm64 |
| PostgreSQL | `postgres:17-alpine` (17.10) |
| Object storage | `minio/minio:RELEASE.2025-07-23T15-54-02Z`, `minio/mc:RELEASE.2025-07-21T05-28-08Z` |
| Compose project | `mosaic-drill2` (isolated) |
| Published ports | api 28080, dashboard 23000, TLS edge 28443, postgres 25432 (debug), MinIO console 29001 (debug) |
| Version stamp | `MOSAIC_VERSION=drill2-phase8` |
| Data | Created through the API during the drills. **No production data exists or was used.** |

### Isolation

Pass one reported that `compose.yaml` pinned explicit `name:` values on all four
named volumes, which defeats `-p` isolation. **That is now fixed** (defect A
below), so this pass needed no override file:

```
docker compose --env-file .env.example config
  name: mosaic
  volumes: mosaic_postgres_data, mosaic_minio_data, mosaic_caddy_data, mosaic_caddy_config

docker compose -p mosaic-drill2 --env-file <drill env> config
  name: mosaic-drill2
  volumes: mosaic-drill2_postgres_data, mosaic-drill2_minio_data,
           mosaic-drill2_caddy_data, mosaic-drill2_caddy_config
```

The default project's resolved volume names are byte-identical to the previous
pinned names, so an existing installation keeps its data.

`apps/api/.env` was neither read nor copied. The drill env file was created by
copying `.env.example` and appending dev-safe values (distinct random passwords,
high ports, a freshly generated 32-byte keyring, `MOSAIC_ENVIRONMENT=development`).

---

## Pass-one operational defects fixed first

### A. `compose.yaml` volume `name:` pinning defeated `-p` isolation

Volume keys renamed to `postgres_data` / `minio_data` / `caddy_data` /
`caddy_config`, the `name:` pins removed, and a top-level `name: mosaic` added so
the default project name no longer depends on the checkout directory. Verified
above: default resolves to the historical names, `-p` isolates.

### B. `scripts/*.sh` called bare `docker compose`

New `scripts/lib/compose.sh` provides `mosaic_compose`, honouring `-p/--project`,
`--compose-file`, `--env-file`, and the `MOSAIC_COMPOSE_*` environment
equivalents; `upgrade.sh` exports the selection to the backup scripts it calls.
All five scripts route through it and print the installation they are about to
act on. Verified by every backup, restore, and object-storage command in D2–D5,
each of which named `project=mosaic-drill2`.

One bug was caught while writing it: the first version returned the consumed-arg
count via `echo`, so callers read it through `$( )` — a subshell — and silently
discarded the parsed project. The count is now a global, with the reason recorded
at the definition.

### C. Readiness reported `migration_incompatible` when PostgreSQL was merely down

`health.Check` gained `DependsOn`. A check whose prerequisite already failed is
skipped and not reported; readiness still fails, on the dependency that actually
broke. Both directions demonstrated at runtime:

```
postgres stopped:
  GET /health/live   200 {"data":{"status":"ok","version":"drill2-phase8"}}
  GET /health/ready  503 {"error":{"code":"not_ready",
      "details":{"checks":["database_unavailable"]}}}      <- migration_incompatible gone
postgres restarted:  GET /health/ready 200, api RestartCount = 0

schema rolled back one step while the API kept running (PostgreSQL healthy):
  GET /health/live   200
  GET /health/ready  503 {"details":{"checks":["migration_incompatible"]}}
schema rolled forward: GET /health/ready 200
```

### D. `406 unsupported_capability` named nothing

New `hostedpublishing.CapabilityError` carries `Requirement`, `Name`, `Version`,
and a closed `Reason` vocabulary, wraps `ErrUnsupportedCapability` so every
existing status mapping is unchanged, and is surfaced in `details`. Every
negotiation refusal in `capability_request.go`, plus the transport-side header
parsing failures, now names its term. Live:

```
Mosaic-Configuration-Versions: 1   ->  406
  details {"requirement":"configurationDeliveryVersion","version":"1","reason":"unavailable",
           "detail":"configurationDeliveryVersion 1 has no representation this
                     Configuration Release can serve"}

Mosaic-Configuration-Versions: 2   ->  406
  details {"requirement":"placementDecisionContractVersion","reason":"malformed",
           "detail":"placementDecisionContractVersion was missing, empty, malformed,
                     or advertised too many values"}
```

### E. Worker logs lacked job, tenant, and trace identity

New `internal/platform/jobtelemetry`; each job family annotates the context
logger once it knows what it leased, and the worker writes its completion and
failure lines through the logger read back out of the job context. Live:

```json
{"job_family":"experiment_schedule","worker_id":"419b22415e47",
 "job_id":"drill2_stranded","job_kind":"experiment_schedule_complete",
 "project_id":"project_000001","environment_id":"env_000001",
 "resource_id":"experiment_000001","duration":79.96,"failed":false,
 "message":"background job finished"}

{"job_family":"analytics","job_id":"analytics_delete_000001","job_kind":"deletion",
 "project_id":"project_000001","trace_id":"0076badf6276de1602ecd996db9ea98b",
 "failed":false,"message":"background job finished"}
```

`trace_id` appears on the analytics family, which runs inside a span; the
Experiment schedule path has no span, so it is absent there — "where available",
as specified.

---

## Drill 2 — Upgrade from the RC schema

- Start 2026-07-27T15:41Z, end 2026-07-27T16:35Z
- Result: **PASS**

### How the RC-era installation was built

The API fails startup on a pending migration, so an RC-schema installation
cannot be populated through the API, and building the `v1.0.0-rc.1` binary was
not available (no git operations). The dataset was therefore created through the
real API at the current schema, captured as a data-only dump, and restored onto a
freshly migrated schema-18 database:

```bash
docker compose -p mosaic-drill2 exec -T postgres \
  pg_dump -U mosaic -d mosaic --data-only --no-owner --no-privileges --disable-triggers > rc-data.sql
# strip the three columns migration 00020 adds, and the two tables the
# migrations own (experiment_metric_definitions, goose_db_version)
migrate up-to 18            # 18 applied, 19/20/21 pending
psql -v ON_ERROR_STOP=1 < rc-data-18.sql
```

Honest note on the harness: the first restore attempt aborted mid-file on a
`goose_db_version` primary-key conflict under `ON_ERROR_STOP=1`, leaving
`id_sequences` empty, which surfaced later as a duplicate-key failure on ingest.
That was a flaw in this drill's harness, not in Mosaic; the dump was corrected
and D2 was rerun from a clean schema-18 database. Both the failure and the rerun
are recorded rather than the rerun alone.

Seeded dataset (created through the API): 1 Organization, 1 Project, 3
Environments, 1 Application, 2 Products, 1 Entitlement, 2 Paywalls, 3 Paywall
Versions, 2 Placements, 1 published Placement rule set, 5 Configuration Releases
(8 representations), 1 Experiment with 2 Variants and a published Version, 45
Analytics Events (v2, ingested through `POST /v1/sdk/events/batch`), 31 audit
events.

### The upgrade

```bash
scripts/backup-postgres.sh -p mosaic-drill2 -o <dir>
  ==> Compose installation: project=mosaic-drill2 ...
  migrationVersion "18", postgresVersion "17.10", sha256 a405a878a07a…
  occurrences of the configured PostgreSQL password in the artifacts: 0
  occurrences of the configured MinIO password in the artifacts:      0

migrate preflight
  current version:  18
  expected version: 21
  pending:          [19 20 21]
  dirty:            false
  verdict:          upgrade required
  exit code 3

migrate up
  applied 19 00019_experiment_analysis_index_concurrent.sql
  applied 20 00020_experiment_schedule_job_reliability.sql
  applied 21 00021_experiment_version_environment_integrity.sql

migrate preflight
  current 21, expected 21, pending [], dirty false, verdict compatible, exit 0
```

### Verification after the upgrade

| Assertion | Result |
| --- | --- |
| Readiness | `GET /health/ready` 200 |
| Data intact | Full fingerprint (22 entity counts + per-Release content hashes) **byte-identical** to the pre-upgrade capture; only `migration_version` changed 18 → 21 |
| Configuration Release digests | all five unchanged; `release_representation_digest_mismatches = 0` |
| Delivery digest unchanged | `ETag "sha256-4e78b671255bd8c14de2873c9c32f8a3a38aeaa38f1901cd2558541d4b52be29"`, identical before and after, `Content-Type: application/vnd.mosaic.configuration+json;version=3` |
| Ingestion works | `POST /v1/sdk/events/batch` → 200 `[{"eventId":"postupgrade_exposed_2","status":"accepted"}]` |

---

## Drill 3 — Failed-migration recovery

- Start 2026-07-27T16:36Z, end 2026-07-27T16:45Z
- Result: **PASS**, with one expectation corrected and one follow-up

### Readiness against an incompatible schema

The drill brief expected "start API with pending migrations → ready 503, live
200". **That is not what happens, and the difference is recorded rather than
smoothed over.** The API *fails startup* and crash-loops:

```
docker inspect mosaic-drill2-api-1 -> state=restarting restarts=7
{"level":"error","error":"verify migration compatibility: database schema is
 behind the expected migration version: applied 18, expected 21",
 "message":"api stopped"}
```

This matches the plan's Startup Model ("fail closed if pending; never
auto-migrate") and is the safer behaviour — a load balancer never sees an
instance that cannot serve — but it means the readiness code
`migration_incompatible` is unreachable in the pending-migration case. It *is*
reachable when the schema drifts under a running API, which was demonstrated
separately (defect C above).

### Irreversible rollback

```bash
migrate down-to 17            # without --confirm
  migration failed: down-to rolls the schema back and can be refused by
  irreversible migrations; pass --confirm to proceed. Rollback is not a
  substitute for restore-from-backup

migrate down-to 17 --confirm
  migration failed: apply migrations: partial migration error (type:sql,version:18):
  ERROR: migration 00018 cannot be rolled back: 2 Delivery v3 Release(s),
  46 Analytics Event v2 row(s), and 2 Release-to-Experiment link(s) would be
  destroyed (SQLSTATE 55000)
migrate version -> 18
```

The refusal is clean, names the exact affected data, and stops at the
irreversible boundary having rolled back only the three reversible migrations.

Follow-up (reported, not fixed): the irreversible refusal itself does not name
the restore path. The guard message shown without `--confirm` does; the message
an operator actually hits, at the moment of failure, does not.

### Restore and integrity

```bash
scripts/restore-postgres.sh -p mosaic-drill2 -f <dump> -d mosaic_restore_check
  checksum matches a405a878a07a…
  migration_version=18, organizations=1, projects=1, products=2, entitlements=1,
  paywalls=2, paywall_versions=3, configuration_releases=5, placements=2,
  analytics_events=45, experiments=1, experiment_versions=1, audit_events=31
  release_representation_digest_mismatches=0
```

Full fingerprint of the restored database: **identical to the source dataset.**
`id_sequences` restored with all 29 rows, so identifier allocation continues
correctly (the property the harness bug above proved matters).

The live installation was then recovered the documented way — API and worker
stopped, `restore-postgres.sh … -d mosaic --force`, `migrate up`, restart — and
its fingerprint returned to exactly the pre-rollback state.

---

## Drill 4 — PostgreSQL backup and restore

- Result: **PASS**

Backup, checksum, and isolated restore are covered under D2/D3 above. Additional
D4-specific evidence:

- The restored database was migrated to 21 and served by a **second API process**
  on port 28081 (`DATABASE_URL` pointed at `mosaic_restore_check`), which reached
  `GET /health/ready` 200.
- **Delivery digest from the restored database is identical to the live one**:
  `"sha256-4e78b671255bd8c14de2873c9c32f8a3a38aeaa38f1901cd2558541d4b52be29"`.
- Critical workflows spot-checked against the restored database — 22 endpoints,
  **all 200**: organizations, projects, environments, applications, products,
  entitlements, paywalls, paywall versions, placements, releases, API keys,
  provider connections, assets, placement rule set, experiments, experiment
  versions, experiment history, experiment results, analytics settings, analytics
  overview, analytics funnel, audit history.

Two failures were found on the first pass of that sweep and are recorded because
they were real:

- `GET /v1/organizations/{id}/audit-events` returned **500** —
  `json: cannot unmarshal number into Go value of type string`. Fixed (defect 3
  below); the endpoint now returns 25 audit events.
- `GET …/analytics/overview` returned 422 — `timezone` and `metricBasis` are
  required parameters and the sweep omitted them. Correct behaviour; the sweep
  was wrong. Recorded as a diagnosability follow-up because the 422 carried no
  `fields` naming which parameters were missing.

---

## Drill 5 — Object-storage backup and restore

- Start 2026-07-27T16:45Z, end 2026-07-27T16:46Z
- Result: **PASS**, with one reported defect

| Step | Result |
| --- | --- |
| Publish an Asset | `POST /v1/projects/{id}/assets` → 201, `asset_000001`, `contentDigest sha256:afdc1edd…648c` |
| Serve it through the SDK path | `GET /v1/sdk/assets/asset_000001/sha256:afdc1edd…` → 200, 79 bytes |
| `scripts/backup-objects.sh -p mosaic-drill2` | 1 object mirrored; the mirrored file is **named by its content digest**, and its sha256 equals that digest |
| Wipe the bucket | `mc rm --recursive --force` — object removed |
| Detection | `scripts/restore-objects.sh -p mosaic-drill2 -c` → `missing from the bucket: 1`, names the key, "treat this as a failed restore", **exit code 1** |
| `scripts/restore-objects.sh -p mosaic-drill2 -m <mirror>` | mirrored back; `missing 0, orphaned 0`, "verification passed" |
| Serve after restore | 200, 79 bytes, served sha256 `afdc1edd…648c` **equals** the stored `contentDigest` |
| Wrong digest | 404 — a digest that does not match does not resolve |

Reported (not fixed): while the object was missing, the delivery endpoint
answered **500 `internal_error`** rather than a distinct, safe code. The operator
log was precise (`stat object: The specified key does not exist`), but an SDK
receives an indistinguishable "Mosaic is broken" signal for a recoverable
missing-asset condition.

---

## Drill 6 — Process recovery

- Start 2026-07-27T16:46Z, end 2026-07-27T17:14Z
- Result: **PASS on worker recovery and state integrity; the API drain
  assertion FAILED and is reported as a defect**

### Worker `kill -9`

```
docker kill -s KILL mosaic-drill2-worker-1
  worker: state=exited exit=137 oomkilled=false
docker compose -p mosaic-drill2 up -d worker
  worker: state=running health=healthy; in-container readiness probe -> ready
```

A lease stranded exactly as a killed worker leaves one (status `leased`, dead
owner, lease still in the future) was reclaimed after expiry, retried, and
completed:

```
seeded:        status=leased owner=dead_worker_from_kill9
after restart: status=completed owner=- attempts=2 error=-
```

The Experiment's scheduled `complete` action then really ran, transitioning the
Experiment to `completed` — end-to-end proof that migration 00020's lease,
retry, and backoff columns work at runtime.

The analytics job tables were exercised in the same window: four export jobs and
one deletion job leased, processed, and completed (see Drill 12). The earlier
scheduled `start` job dead-lettered correctly at `attempts=5/5` with
`last_error_code=experiment_state_conflict` after the Experiment had already been
started manually — the retry budget and terminal diagnostic both behaving as
designed.

Two synthetic edits were **rejected by the database** while setting this up, and
are recorded as evidence that the integrity constraints hold: an
`analytics_export_jobs` row forced back to `running` while retaining a completed
job's object key violated `analytics_export_jobs_check`.

### API SIGTERM

```
docker kill -s TERM mosaic-drill2-api-1
readiness poll (100 ms):  200 ready  ->  connection refused
in-flight request:        HTTP/1.1 422 (served to completion during the drain)
api: state=exited exit=0
{"message":"api shutdown requested"} {"message":"api stopped gracefully"}
```

In-flight work drained and the process exited cleanly, but **no client ever
observes the draining state**: readiness goes from 200 straight to connection
refused. See defect 8.

### Restart everything

`docker compose -p mosaic-drill2 up -d` → api, dashboard, local-edge, minio,
postgres, worker all running and healthy; readiness 200. All five original
Configuration Releases retained **byte-identical content hashes** across the
kill, the drain, the restore, and the upgrade. Remaining fingerprint differences
are fully explained by drill activity in between (an Asset uploaded, the privacy
deletion removing 4 events, the scheduled completion publishing a new Release,
extra audit rows).

---

## Drill 9 — Credential rotation

- Start 2026-07-27T17:46Z, end 2026-07-27T17:48Z
- Result: **PASS**. No secret values appear below; keys are described by prefix,
  length, and a truncated digest of the secret.

| Step | Result |
| --- | --- |
| Delivery with the old public SDK key, before rotation | 200 |
| `POST /v1/api-keys/{id}/rotate` | 200; same key id, new secret (`prefix=mos_public_sdk_key_000001 length=69 sha256[:8]=9d40fcf4`, was `0d30f523`) |
| Delivery with the **old** key after rotation | **401 `unauthenticated`** |
| Delivery with the **new** key after rotation | **200** |
| Create a secret server key | 201 (`prefix=mos_secret_server_key_000002 length=72`) |
| Rotate it | 200, new secret digest |
| Revoke it | 200 |
| Rotate a `custom` / `sdk_only` provider credential | 422 `providerIntegrationUnsupported` — correct: that integration mode stores no server-side credential |

Audit coverage, read from the database rather than the first page of the API
listing: `api_key.created` ×2, `api_key.rotated` ×2, `api_key.revoked` ×1,
`provider_connection.created` ×1. Rotation and revocation are auditable.

### Keyring rotation

A server-connected RevenueCat connection was created to produce a real encrypted
envelope, then `cmd/keyring` was exercised before and after rotation:

```
keyring validate     keyring is valid; active key id: key_drill_a; key ids: [key_drill_a]

keyring inspect      KEY ID        ENVELOPES  STATUS
                     key_drill_a   1          active
                     0 envelope(s) not under the active key

keyring rotate       rotated 1 envelope(s)
  (with the two-key keyring)
                     rotation complete: 1 envelope(s) now sealed under key_drill_b

keyring inspect      KEY ID        ENVELOPES  STATUS
                     key_drill_b   1          active
                     key_drill_a   0          unused
                     0 envelope(s) not under the active key
```

The API and worker were restarted with the rotated keyring and returned to
readiness 200. No key material was printed at any point.

---

## Drill 10 — Cross-tenant authorization

- Start 2026-07-27T17:48Z, end 2026-07-27T17:51Z
- Result: **PASS after fixing one masked authorization decision**

A second Organization (`org_000002`) with its own user and Project was created so
that every refusal below is an authorization decision rather than a missing
feature. It then attempted the first tenant's resources.

| Endpoint attempted with a foreign session | Status | Code |
| --- | --- | --- |
| `GET /v1/organizations/{id}` | 403 | forbidden |
| `GET /v1/organizations/{id}/audit-events` | 403 | forbidden |
| `GET /v1/projects/{id}` | 403 | forbidden |
| `GET /v1/projects/{id}/environments` | 403 | forbidden |
| `GET /v1/projects/{id}/paywalls` | 403 | forbidden |
| `GET …/paywalls/{id}/versions` | 403 | forbidden |
| `POST /v1/projects/{id}/paywalls` | 403 | forbidden |
| `GET …/environments/{id}/releases` | 403 | forbidden |
| `POST …/environments/{id}/publish` | 403 | forbidden |
| `GET /v1/projects/{id}/products` | 403 | forbidden |
| `GET /v1/products/{id}` | 403 | forbidden |
| `POST /v1/products/{id}/archive` | 403 | forbidden |
| `GET /v1/projects/{id}/entitlements` | 403 | forbidden |
| `GET /v1/projects/{id}/placements` | 403 | forbidden |
| `GET …/placements/{id}/rule-set` | 404 | not_found |
| `PUT …/placements/{id}/binding` | 403 | forbidden |
| `GET …/experiments` | 404 | experiment_not_found |
| `GET …/experiments/{id}` | 404 | experiment_not_found |
| `GET …/experiments/{id}/results` | 404 | experiment_not_found |
| `POST …/experiments/{id}/emergency-stop` | 404 | experiment_not_found |
| `POST …/experiments/{id}/exports` | 403 | forbidden |
| `GET …/analytics/overview` | 403 | forbidden |
| `POST …/analytics/exports` | 403 | forbidden |
| `POST …/analytics/privacy/exports` | 403 | forbidden |
| `GET /v1/projects/{id}/provider-connections` | 403 | forbidden |
| `GET /v1/environments/{id}/api-keys` | 403 | forbidden |
| `POST /v1/environments/{id}/api-keys` | 403 | forbidden |
| `POST /v1/api-keys/{id}/rotate` | 403 | forbidden |
| `POST /v1/api-keys/{id}/revoke` | 403 | forbidden |
| `GET /v1/projects/{id}/assets` | 403 | forbidden |
| `GET /v1/provider-connections/{id}` | 403 | forbidden |
| `POST /v1/provider-connections/{id}/test` | 403 | forbidden |
| `POST /v1/provider-connections/{id}/rotate-credential` | 403 | forbidden |

33 of 33 refused server-side.

On the first run, `POST /v1/provider-connections/{id}/test` answered **503
`providerUnavailable`** instead of 403: the authorization failure was being
rewritten into a provider error code. Verified that it caused **no cross-tenant
read or write** — the victim connection's diagnostics count and health were
unchanged, because the diagnostic write is itself scope-checked — but the
decision was invisible. Fixed (defect 6) and re-run: 403.

---

## Drill 12 — Privacy operations

- Result: **PASS**

| Step | Result |
| --- | --- |
| `POST …/analytics/exports` (environment events) | 202 → `analytics_export_000001`, completed, **45 rows / 45 425 bytes**, artifact `analytics-exports/project_000001/analytics_export_000001.ndjson` |
| `POST …/experiments/{id}/exports` (raw Experiment) | 202 → `analytics_export_000002`, completed, 45 rows / 40 070 bytes |
| `POST …/analytics/privacy/preview` | 200 — `affectedEvents 4`, `affectedSessions 1`, `affectedEnvironmentIds ["env_000001"]`, `requestDigest ca16f651…` |
| `POST …/analytics/privacy/exports` | 202 → completed, 4 rows / 4 052 bytes |
| `POST …/analytics/privacy/deletions` with a **self-computed** digest | **409 conflict** — correct: the deletion must confirm the digest the preview returned |
| Same with the preview's digest | 202 → `analytics_delete_000001`, processed to `recomputing`, `affected_event_count = 4` |
| Tenant scoping | The second tenant's attempts at both the analytics export and the privacy export were refused 403 (Drill 10) |
| Audit and job telemetry | Every job logged with `job_id`, `job_kind`, `project_id`, and `trace_id` |

---

## Drill 13 — Commerce smoke (mock / custom provider)

- Start 2026-07-27T17:15Z
- Result: **PASS for the custom-provider path.** RevenueCat, StoreKit 2, and
  Google Play Billing are **not live-verified** (owner decision D10) and nothing
  here claims otherwise.

| Step | Result |
| --- | --- |
| Create a `custom` / `sdk_only` connection | 201, `provider_connection_000001`, `status pending`, `healthStatus untested` |
| `POST /v1/provider-connections/{id}/test` | **503 `providerUnavailable`** (after defect 5 was fixed; it returned 500 before) |
| `GET …/health` | 200 — `degraded`, `lastErrorCode providerUnavailable` |
| `GET …/capabilities` | 200 — `productLoading: conditional`, `reasonCode host.implementationRequired` — correct for an SDK-only provider |
| `GET …/diagnostics` | 200 — diagnostic rows recorded with `operation test`, `code providerUnavailable`, retryable |
| Create a Product mapping | 201, `mapping_000001`, `status placeholder`, `availability unknown` |
| `GET /v1/products/{id}/provider-mappings` | 200, resolves the mapping |
| `GET /v1/products/{id}/provider-readiness` | 200 — `attentionRequired` with explicit `productUnavailable` blockers and `connectProduct` recovery actions |
| `GET /v1/products/{id}/readiness` | 200 — same, consistent |

The `custom` provider is host-implemented, so "test" legitimately reports the
provider as unavailable; the value demonstrated here is that the outcome is a
**documented, machine-readable, retryable** code with a diagnostic trail, not an
opaque failure.

---

## Drill 14 remainder — emergency stop and raw export

- Start 2026-07-27T17:52Z
- Result: **PASS**

A second Experiment (`experiment_000003`) was published and started on
`placement_000002`.

| Assertion | Observed | Verdict |
| --- | --- | --- |
| Delivery before the stop | 200, `ETag "sha256-e1073191…f45"`, 1 Experiment assignment for `experiment_000003` | — |
| `POST …/emergency-stop` | 200, Experiment state → `stopped` | PASS |
| A new Release is published by the stop | `release_000008` → **`release_000009`** | PASS |
| Delivery reflects the stop | 200, **new ETag** `"sha256-4a3e13d4…f0"`; the assignment now carries `"lifecycle": "stopped"` with `"fallback": "normal_placement"` | PASS |
| History preserved | 3 entries, including the stop with reason `drill two emergency stop` | PASS |
| Versions preserved | `experiment_version_000002` retained | PASS |
| Results preserved | 200, `state: "stopped"`, Variant rows intact | PASS |
| Raw Experiment export | 202 → `analytics_export_000005`, kind `experiment` | PASS |

Note on the delivered payload: the assignment entry is **not removed** from
Delivery v3 — it remains with `lifecycle: stopped` so an SDK deterministically
falls back to the normal Placement rather than silently losing the record. That
is the contract-defined behaviour ("emergency stop always targets the normal
Placement fallback"), and it is what "delivery reflects the removal" means here.

---

## Full integration suite

```bash
DATABASE_TEST_URL=postgres://mosaic:***@localhost:25432/mosaic_test?sslmode=disable
MOSAIC_OBJECT_STORAGE_ENDPOINT=localhost:29000  (+ access key, secret key, bucket, TLS=false)
go test -p 1 -count=1 ./...
  exit code 0
  30 packages ok, 17 with no test files, 0 skipped
```

No suite skipped for a missing `DATABASE_TEST_URL` or object-store configuration.

Three failures were found and resolved on the way to that result:

1. `TestEmbeddedSchemasMatchCanonicalProtocolFiles` — the API's **embedded**
   `analytics-event` v1 and v2 schemas had drifted from the canonical
   `protocol/schema/...` files. Resolved with the repository's own remedy,
   `go generate ./internal/platform/protocolschema`, which rewrites only the
   embedded copies under `apps/api`. The canonical protocol files were **not
   modified**; both now hash-match (`a82d88f3a920c054`, `298950c9976b5986`).
   This is release-blocker category 17 (canonical schema versus API runtime
   disagreeing) and was live in the tree before this pass.
2. `TestMiddlewareDistinguishesUnauthenticatedFromResolverFailure` — see
   defect 7; a genuine secret-in-logs regression from pass one's 5xx cause
   logging.
3. `TestValidateExperimentDeliveryPayloadRequiresExactClosure` — asserted the
   prose of an error message this pass replaced with a machine-readable reason.
   Retargeted to assert the reason code, which is the actual API contract.

---

## Triage of the two pre-existing failures

Both were run, diagnosed from real output, and resolved.

### `TestPhase3APersistenceRisks`

Pass one's static analysis was correct as far as it went, and the run confirmed
it — then revealed four more layers behind it:

```
repository_integration_test.go:350: persist provider connection: provider project identifier is invalid
  -> test-side: a server-connected RevenueCat connection requires ExternalProjectID. Added.
repository_integration_test.go:354: provider mode mismatch
  -> test-side: a sandbox connection may not be scoped to a production Environment.
     Scope changed to development + staging, with production kept as the
     genuinely-out-of-scope Environment for the integrity assertion below.
repository_integration_test.go:391: null value in column "normalized_metadata" ... violates not-null
  -> DOMAIN-side defect. Fixed (defect 9).
repository_integration_test.go:391: violates check constraint "..._stale_order_check"
  -> test-side: the fixture left StaleAt zero; stale_at is NOT NULL and must not
     precede observed_at. Set.
repository_integration_test.go:477: can't scan into dest[10] (col: diagnostic_code): cannot scan NULL
  -> DOMAIN-side defect. Fixed (defect 10).
```

Pass one proposed adding a `Credential`; the run showed none is needed — the
service rejects on `ExternalProjectID` first, and the test's stub catalog accepts
the connection without one. **Result: PASS.**

### `TestPhase4AProviderPersistenceRisks`

Pass one could not decide between "stale assertion" and "readiness genuinely
regresses". The real output settles it:

```
repository_integration_test.go:777: replacement-connection readiness =
  {State:"attentionRequired", ConnectionID:"provider_connection_000002",
   MappingID:"mapping_000002",
   Blockers:[{Code:"providerUnavailable", ResourceType:"provider_connection",
              RecoveryAction:"testOrReconnectProvider"}]}
```

Readiness resolved to the **correct** replacement connection. Its single blocker
is `connection.Status != active || HealthStatus != healthy`
(`service_provider.go:1019`) — the replacement connection had never been tested.
The rule is right and errs safe: declaring a never-tested connection ready is the
direction that would be release-blocker category 8. The **test** was stale, not
the domain: it created a replacement connection and asserted readiness without
performing the connection test the first connection performs. Added the
`TestProviderConnection` call the operator workflow requires. **Result: PASS**,
and the assertion still protects its original risk (readiness follows the active
assignment across a connection replacement).

---

## Performance

Measured, and recorded with full environment and dataset context, in
[`docs/backend/operations/performance.md`](../backend/operations/performance.md#results).
Summary, `mosaic-drill2` on the host above, zero error rate on all three runs:

| Path | Concurrency | Duration | Throughput | Median | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Configuration delivery (v3) | 8 | 45s | 2 279.8 req/s | 3.257 ms | 6.396 ms | 8.596 ms |
| Delivery 304 path | 8 | 45s | 2 377.7 req/s | 3.147 ms | 6.083 ms | 8.090 ms |
| Ingestion, 100-event batches | 4 | 45s | 55.1 req/s (~5 500 events/s) | 69.536 ms | 89.871 ms | 128.341 ms |

304 ratio on the conditional path: **1.0000**. The dataset is small (9 Releases,
41 Events, a 15 761-byte delivered representation) and the numbers must not be
read as capacity guidance for a production-sized Release.

Two defects had to be fixed before any number could be produced: `cmd/loadgen`
advertised no capabilities and was answered 406 for every delivery version, and
the Compose services never passed the rate-limit variables through, so raising a
limit for the measurement had no effect. Both are recorded below.

**Not measured, and not claimed:** cold-publish delivery, publish, Placement
evaluation, Experiment result queries, v3-versus-v2 payload cost, dashboard APIs,
the seeded 10 k-job worker backlog drain, pool gauges under load, and
`EXPLAIN (ANALYZE, BUFFERS)` plans.

---

## Defects found and fixed in this pass

Beyond the five assigned pass-one defects (A–E above):

| Id | Defect | Severity | Files |
| --- | --- | --- | --- |
| 1 | **Experiment publish always failed with 500** on any Experiment carrying a schedule: migration 00020 made `experiment_scheduling_jobs.available_at` NOT NULL and the insert never set it. No Experiment could be scheduled. | GA blocker | `internal/platform/experimentpostgres/repository.go` (+ integration test) |
| 2 | **Every deliberate 5xx was rewritten to `500 internal_error`.** `errorDetails` collapsed all statuses ≥ 500, so `503 providerUnavailable`, `503 asset_storage_failed`, `502 providerInvalidResponse` and every other documented upstream-failure code were unreachable, and an SDK could not tell a failed dependency from a broken Mosaic. Status and code are now preserved above 500; the free-text message is still replaced, because messages are where topology leaks. | GA blocker (API contract) | `internal/platform/httpserver/response/response.go` (+ tests) |
| 3 | **Audit history permanently unreadable after any Experiment action.** `AuditEvent.Metadata` is `map[string]string` but the Experiment writers store numbers and booleans, so `GET /v1/organizations/{id}/audit-events` returned 500 for the whole Organization, forever, over immutable rows. Decoding is now lenient, which repairs already-written history. | GA blocker | `internal/platform/cloudworkspacepostgres/repository.go` (+ test) |
| 4 | **`422 experiment_invalid` named nothing** — fifteen distinct publish preconditions shared one opaque code with no detail and no log line. Now carries a machine-readable `details.reason`. | Diagnosability | `internal/experiment/errors.go`, `service.go`, `internal/platform/experimentpostgres/repository.go`, `internal/transport/experiment/handler.go` |
| 5 | **`migrate down-to <version> --confirm` could never parse** — the documented failed-migration recovery command failed with "down-to requires a target version" because the version and the flag both landed in the positional list. | Blocks a documented recovery path | `cmd/migrate/main.go` (+ test) |
| 6 | **Authorization refusals masked as provider outages.** A cross-tenant provider-connection test answered 503 `providerUnavailable` instead of 403. No cross-tenant read or write occurred, but the decision was invisible. | Security diagnosability | `internal/cloudworkspace/service_provider_operations.go` (+ test) |
| 7 | **Secret material could reach the operator log.** Pass one's 5xx cause logging is valuable, but the authentication middleware deliberately reduces a resolver error to its type — and then handed the raw error, which may carry a connection string or credential fragment, to the logger that prints causes. | Blocker category 2 (secret exposure in logs) | `internal/platform/authn/principal.go` |
| 8 | **Compose passed none of the operator configuration.** 59 variables documented in `.env.example` as "every variable the API and worker read" had no effect in the supported deployment profile — every rate limit, timeout, log level, session lifetime, upload ceiling, and worker interval. | Blocker category 16 (configuration in the supported profile does nothing) | `compose.yaml` |
| 9 | Provider metadata snapshots could not be written when a Product carried no normalized metadata: an explicit NULL overrides the column default on a NOT NULL jsonb column. | Data-path defect | `internal/platform/cloudworkspacepostgres/repository.go` |
| 10 | Provider mapping observations could not be **read back** once a successful one existed: `diagnostic_code` is NULL for a successful observation and was scanned into a `string`. | Data-path defect | `internal/platform/cloudworkspacepostgres/repository.go` |
| 11 | `cmd/loadgen` advertised no capabilities, so both delivery scenarios were answered 406 and had never measured a Configuration Release. | Measurement harness | `cmd/loadgen/main.go` |
| 12 | The API's embedded `analytics-event` v1/v2 schemas had drifted from the canonical protocol files (regenerated; canonical files untouched). | Blocker category 17 | `internal/platform/protocolschema/schemas/` |

## Defects found, reported and NOT fixed

| Defect | Why not fixed here | Owner |
| --- | --- | --- |
| **The API never serves a 503 while draining.** `readiness.StartDraining()` is followed immediately by `server.Shutdown()`, which closes the listener, so a load balancer polling readiness gets connection-refused rather than the clean 503 the Startup/Shutdown Model promises. In-flight requests do complete. The fix needs a deliberate pre-shutdown delay and a default value, which is a deployment-policy decision. | Needs an owner ruling on the default | mosaic-backend + owner |
| **Once an Experiment is published, the Environment's Release has no Delivery v1 representation** (only v2 and v3), so a v1-only SDK receives 406 and cannot fetch configuration at all. The plan states legacy v1/v2 negotiation is preserved. The SDK fails safe on its cache, so it is not a crash, but the compatibility claim is not currently true. | Emitting a v1 view of a v3 Release is a contract decision | mosaic-backend + mosaic-protocol + owner |
| **Experiment publish requires the Environment's current Release to already carry a Delivery v2 representation**, i.e. a Placement rule set must have been published there first. Nothing documents this. Now at least diagnosable (`reason: environment_release_has_no_placement_decision_contract`) rather than a bare `emitted_delivery_invalid`. | Auto-upgrading a v1 Release is a design decision | mosaic-backend + owner |
| A missing object answers `500 internal_error` on the SDK asset path instead of a distinct safe code. | Adding a delivery error code is a contract decision | mosaic-backend + mosaic-protocol |
| The irreversible-migration refusal names the data that would be destroyed but not the restore path. | One-line message change, but it belongs with the Stage 5 runbook wording | mosaic-backend |
| `422 validation_failed` on the analytics query endpoints carries no `fields` naming the missing parameter. | Same class as the errors fixed above; not drill-blocking | mosaic-backend |
| Throwaway-Placement-for-treatment-Versions workflow, and `docs/reviews/phase-5-demo-rule-set.json` being an invalid rule set. | Carried forward from pass one, unchanged | owner / Phase 5 evidence owner |

## Drill status after pass two

| Drill | Status |
| --- | --- |
| D1 Clean installation | **PASS** (pass one) |
| D2 Upgrade from the RC schema | **PASS** |
| D3 Failed-migration recovery | **PASS** (readiness-on-pending expectation corrected: the API fails startup instead) |
| D4 PostgreSQL backup and restore | **PASS** |
| D5 Object-storage backup and restore | **PASS** |
| D6 Process recovery | **PASS** on worker recovery and state integrity; the observable drain FAILED here and is **PASS** after the authorised fix (see the fix pass below) |
| D7 Dependency failure | **PASS** (pass one; re-verified with the readiness fix) |
| D8 Configuration delivery recovery | **PASS** (pass one) |
| D9 Credential rotation | **PASS** |
| D10 Cross-tenant authorization | **PASS** (33/33 refused, after fixing one masked decision) |
| D11 SDK cache rendering | **NOT RUN** — owned by the SDK agents |
| D12 Privacy operations | **PASS** |
| D13 Commerce smoke (mock/custom) | **PASS**; RevenueCat / StoreKit / Play **not live-verified** |
| D14 Placement + Experiment conformance | **PASS** including emergency stop and raw export |
| Full integration suite | **PASS** — `go test -p 1 ./...` exit 0 |
| Triage of the two pre-existing failures | **RESOLVED** — both run, both now pass; two domain defects found behind them |
| Performance harness | **MEASURED** — delivery, delivery-etag, ingest; recorded in `performance.md` |

## Cleanup

`docker compose -p mosaic-drill2 down -v` removed all drill containers, the four
`mosaic-drill2_*` volumes, and the `mosaic-drill2_default` network. The
pre-existing development volumes (`mosaic_postgres_data`, `mosaic_minio_data`,
`mosaic_caddy_data`, `mosaic_caddy_config`) were never attached to this project
and were not touched. The `mosaic_test` and `mosaic_restore_check` databases went
away with the teardown. All drill scratch files — env files, keyring material,
generated batches, helper scripts, backup artifacts — live outside the repository
in the session scratchpad and were removed; nothing was left in the working tree
except the fixes and this document.

---

## Owner-authorised fix pass (2026-07-27, after the pass-two drills)

The orchestrator ruled the four reported items release-blocking/compatibility
fixes and authorised a writer/schema sweep. All five are implemented, tested,
and — where observable — re-verified against a rebuilt isolated installation
(`mosaic-drill2`, `MOSAIC_VERSION=drill2-verify`).

### 1. Pre-shutdown drain delay — Drill 6 drain assertion is now PASS

`MOSAIC_HTTP_DRAIN_DELAY` (default `5s`, `0` disables, negative rejected at
startup). Shutdown is now: `StartDraining()` → readiness answers 503 → wait the
delay → `server.Shutdown()`.

Re-verified by polling readiness at 100 ms while sending SIGTERM:

```
 -1.00s  status=200      {"data":{"status":"ready","version":"drill2-verify"}}
 +0.38s  status=503      {"error":{"code":"draining","message":"The instance is shutting down…"}}
 +5.40s  status=refused  connection refused
observable draining window: 4.90s
api: state=exited exit=0
```

Pass two recorded this as **FAIL** (200 → connection refused, no observable
draining state). It is now **PASS**: a load balancer polling readiness gets a
clean 503 for the full configured window before the listener closes, and the
process still exits 0. The Drill 6 row in the pass-two status table should be
read together with this section.

Files: `internal/platform/config/config.go` (+ test), `cmd/api/main.go`,
`.env.example`.

### 2. A v1-only SDK is served again after an Experiment publishes

Experiment publish wrote only v2 and v3 representations, so once an Experiment
was published every v1-only SDK was answered `406` and could not fetch
configuration at all. Publish now also stores a v1 representation.

The first implementation projected v1 from the v2 envelope and produced a v1
payload with **no Placements** — `placements` is v1-only vocabulary (v2 replaces
it with `placementDecisions`), so the projection served a technically valid but
useless document. Recorded because the drill caught it before it shipped:

```
v1 of release_000007 (projected)                 placements: []
v1 of release_000005 (ordinary publish)          placements: ["verify_main","verify_stage"]
```

The publisher now carries the preceding Release's v1 representation forward and
restamps its identity — an Experiment publish does not change Placement
bindings — falling back to the projection only when there is no previous v1.

Re-verified against a Release carrying an active Experiment:

```
advertises "1"      -> 200  application/vnd.mosaic.configuration+json;version=1
   members: assetReferences, compatibility, contentDigest, environment, id,
            number, paywallVersions, placements, productReferences, publishedAt
   placements delivered: ["verify_main", "verify_stage"]
advertises "2"      -> 200  …;version=2
advertises "3,2,1"  -> 200  …;version=3
advertises "3"      -> 200  …;version=3
```

Honest note: the `"2"` case first returned 406. The named detail added earlier in
this pass explained it immediately —
`decisionFeature outcome.paywall is required by this Configuration Release but
was not advertised by the SDK` — and the fault was the drill client's header
set, not the server. The verification client and `cmd/loadgen` now advertise the
outcome features a real SDK sends. This is negotiation behaving correctly.

Files: `internal/platform/experimentpostgres/repository.go` (+
`delivery_v1_projection_test.go`), `cmd/loadgen/main.go`.

### 3. The Experiment prerequisite has its own code and states the action

```
POST …/experiments/{id}/publish   (no Placement rule set published yet)
-> 409 {"code":"experiment_placement_decision_required",
        "message":"Publish a Placement rule set in this Environment before
                   publishing an Experiment: the current Configuration Release
                   carries no Placement Decision representation for an
                   Experiment release to build on."}
```

Previously a generic `422 experiment_invalid`, which sent operators to inspect
the Experiment rather than the Environment.

Files: `internal/experiment/errors.go`,
`internal/platform/experimentpostgres/repository.go`,
`internal/transport/experiment/handler.go` (+ `handler_error_test.go`).

### 4. A missing Asset object is a safe 404

```
GET /v1/sdk/assets/{id}/{digest}   (row present, object wiped from the bucket)
-> 404 {"code":"asset_object_missing",
        "message":"The Asset's stored bytes are not available."}
GET …/{wrong digest}  -> 404 not_found          (unchanged)
```

The operator log still records the integrity problem in full
(`asset object is referenced by the database but missing from object storage`,
with `asset_id` and `storage_key`), so the diagnosis an operator needs is
preserved while the SDK gets a signal it can act on. Object storage that is
genuinely failing remains a retryable `503 asset_storage_failed`; the two are
now distinguishable, which they were not when both were `500 internal_error`.

Files: `internal/platform/objectstoreminio/store.go` (+
`missing_object_test.go`), `internal/hostedpublishing/errors.go`,
`internal/hostedpublishing/service_assets.go`,
`internal/transport/hostedpublishing/handler.go` (+ test).

### 5. Writer/schema drift sweep

**Why.** Four defects of one shape were found during these drills: a migration
requires a column, the repository write does not supply it, and nothing fails
until a specific runtime path is exercised. Compilation proves nothing, because
the column list is a string literal.

**Method.** `scripts/check-writer-schema-drift.py` parses every migration's Up
section, applies `CREATE TABLE`, `ADD COLUMN`, `ALTER COLUMN SET/DROP NOT NULL`,
and `DROP COLUMN` in order to derive, per table, the columns that are NOT NULL
with no default; extracts the column list of every literal `INSERT INTO <table>(…)`
in the Go repositories; and reports any required column a writer omits. Run:

```bash
python3 scripts/check-writer-schema-drift.py [--verbose]   # exit 1 on drift
```

**Self-test.** The checker was validated by reintroducing the known
`available_at` defect, which it caught:

```
DRIFT (1):
  experiment_scheduling_jobs  apps/api/internal/platform/experimentpostgres/repository.go:827
    omits required column(s): available_at
```

**Result.**

```
tables with literal INSERT writers: 88
writes not analysed (dynamic SQL):  4
DRIFT: none
```

All 88 tables are clean, covering 1–5 writers each and 1–22 required columns
each (full per-table listing available from `--verbose`; the largest are
`analytics_events` 22, `experiment_versions` 17, `experiment_daily_unique_units`
15, `placement_rule_set_versions` 14, `provider_mapping_observations` 13,
`placement_rule_set_draft_revisions` 13, `assets` 12, `analytics_deletion_jobs`
12). The four writes the sweep does not analyse are the
`INSERT INTO … SELECT …` carry-forwards in
`experimentpostgres/repository.go:812-815`, which have no explicit column list;
they select from the same table they insert into, so column order is consistent
by construction, and they are already covered at prepare time by
`TestReleaseClosureStatementsMatchTheSchema`.

**Two further drift classes the column sweep cannot see were audited separately.**

*Class B — the column is written but the bound Go value can be nil.* This is the
`normalized_metadata` defect. All 39 NOT NULL `jsonb`/`bytea` columns without a
default, across 20 tables, were enumerated and their writers inspected. Every
one binds a literal (`'{}'`), an explicit conversion (`string(...)`,
`[]byte(...)`), a helper that cannot return nil (`documentBytes`,
`validationBytes`, `jsonObjectOrEmpty`), or a field the canonical protocol
schema marks required — `analytics_events.payload` is required in both
Analytics Event v1 and v2, so an accepted event always carries it. No further
hits.

*Class C — a nullable column read into a non-pointer target.* This is the
`diagnostic_code` defect. 98 `SELECT`/`Scan` pairs were matched against derived
per-column nullability; after excluding primary keys and pointer targets, 12
candidates remained and each was inspected by hand. All 12 are safe: nine scan
into `*time.Time`/pointer fields declared in another package (which the
heuristic could not see), and three are guarded by an `IS NOT NULL` predicate or
a status predicate in the query itself
(`analytics/queries.go:261,477`, `analytics/jobs.go:82`,
`experimentpostgres/repository.go:562`). One residual is benign but worth
recording: `environment_release_state.current_release_id` is scanned into a
`string`, so a NULL produces a scan error rather than an empty value — the
existing `if e != nil || oldID == ""` branch handles both identically.

No further drift was found. The two defects already fixed in this pass
(`normalized_metadata`, `diagnostic_code`) remain the only members of classes B
and C.

### Validation for this fix pass

```
gofmt -l internal cmd                       clean
go vet ./...                                clean
go build ./...                              OK
go test -p 1 -count=1 ./...                 exit 0, 31 packages ok, 0 skipped
  (DATABASE_TEST_URL + object-store vars pointed at the drill services)
python3 scripts/check-writer-schema-drift.py   DRIFT: none (exit 0)
```

### Tests added in this fix pass

| Test | Risk it protects |
| --- | --- |
| `TestDrainDelayDefaultsToAnObservableWindow` (`platform/config`) | A zero default would silently restore the traffic-shedding behaviour this fix exists to remove. Pins a non-zero default that fits inside the shutdown timeout, keeps `0` as a deliberate opt-out, and rejects a negative value instead of ignoring it. |
| `TestDeliveryV1ProjectionKeepsLegacyClientsServed` (`experimentpostgres`) | A v1-only SDK must keep receiving a usable Release after an Experiment publishes. Asserts the members a v1 client renders survive (including `placements`, whose loss made the first implementation useless), that non-v1 vocabulary does not leak, that the digest is recomputed over the projection, and that the result passes the publisher's own v1 validation. |
| `TestPlacementDecisionPrerequisiteIsNamedAndActionable` (`transport/experiment`) | The prerequisite must not regress to a generic code. Asserts the dedicated code and that the message names the action, not just the failure. |
| `TestMissingObjectIsDistinguishedFromStorageFailure` (`objectstoreminio`) | The 404-versus-503 decision depends entirely on this classification. Pins absent key/bucket as missing, access-denied and transport failures as not, unwrapping, and the `ObjectNotFound()` contract callers use without importing the package. |
| `TestMissingAssetObjectIsNotFoundAndFailingStorageIsRetryable` (`transport/hostedpublishing`) | An SDK must be able to tell "these bytes are gone, use the bundled Asset" from "storage is down, retry". Asserts both mappings together so neither can drift into the other. |

No new test suite, framework, or dependency was introduced.
