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
