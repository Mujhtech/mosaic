# Phase 9A Stage 4 — Integrated provider demonstration evidence

Operator: mosaic-backend agent
Date: 2026-07-28
Branch: `phase/9a-transaction-ingestion-validation`
Baseline commit: `715f9ac` (Stage 2/3 work, uncommitted demo driver on top)
Specification: `docs/plans/phase-9a-transaction-ingestion-validation.md` §15, §6–§8

**Honesty rule applied throughout.** Every claim below is backed by an HTTP
response or a SQL result produced by the run recorded here. Nothing is
paraphrased into a stronger statement than the output supports. Where a step
produced a result the plan did not intend, the actual result is recorded and the
defect is named — §9 lists three. No secret value appears in this document: the
Apple intake token, API key secrets, keyring material, and the Google purchase
token are redacted or reduced to a digest.

**No live store was reachable.** There is no App Store Connect account, no
Sandbox Apple Account, no Play Console application, and no Google Cloud project
in this environment. The plan authorises synthetic signed vectors in that case
(§15, final sentence). §2 classifies every synthetic element and §10 states
exactly what only a live sandbox can prove.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Host | Apple Silicon macOS (Darwin 25.5.0), `arm64` |
| Go toolchain | go1.26.x darwin/arm64 |
| PostgreSQL | `postgres:17` (Docker, container `mosaic-9a-demo`, published port 55447) |
| Migrations | `go run ./cmd/migrate up` → 25/25 applied to an empty database |
| Demo driver | `apps/api/cmd/billingdemo` (new; see §8) |
| Run command | `DATABASE_URL=postgres://demo:demo@127.0.0.1:55447/mosaic_demo?sslmode=disable go run ./cmd/billingdemo` |
| Wall-clock | **26.965 s** for the complete eight-stage sequence, including a real 26 s retry backoff wait |
| Tenant | `org_demo9a` / `proj_demo9a` / `env_demo9a` (mode `production`); applications `app_demo9a_ios` (ios, `com.mosaic.demo`) and `app_demo9a_android` (android, `com.mosaic.demo.android`) |
| Data | Created by this run only. No production data exists or was used. |
| Cleanup | Container removed after the run (§11) |

The container is torn down at the end, so the row identifiers quoted below
(`ssc_…`, `bri_…`, `bqr_…`) are from this run and are not re-derivable; the
driver is deterministic in shape but mints fresh identifiers each run.

---

## 2. What is real, and what is synthetic

This is the most important section in the document. Read it before any
evidence below.

### Real — exercised exactly as it would be in production

| Component | Evidence it was the real thing |
| --- | --- |
| PostgreSQL schema, constraints, append-only triggers | `cmd/migrate up`, 25/25 migrations; every write below went through them |
| chi router with the full middleware stack | built by `httpserver.NewWithDependencies` and mounted on `httptest.NewServer`; the notification POSTs carry no `Origin` header and pass `trustedMutationOrigins` |
| Every billing HTTP handler and its ozzo validation | all HTTP lines below are real handler responses |
| `billing.Service` — intake, observations, workers, operations | called directly for the worker jobs, via HTTP for everything else |
| AES-256-GCM envelope encryption (`providercredential`) | §3 step 2 shows ciphertext on disk |
| Idempotency keys, fact digests, product resolver, retry classifier | §3–§7 |
| `appstoreserver.Client` (App Store Server API client, ES256 request JWT) | the Apple stub's call log shows the real client's request paths |
| `googleplay.Client` including the real RS256 JWT-bearer OAuth exchange | `oauth exchanges=1`; the client performed a real HTTPS token exchange |
| The five worker job entry points `cmd/worker` schedules | `ProcessNextValidation`, `ProcessNextRTDN`, `ProcessNextReconciliation`, `ProcessNextReplay` all invoked by name |

### Synthetic — classified, with the reason it could not be otherwise

| Element | Classification | Why |
| --- | --- | --- |
| **Apple JWS signing chain** | **SYNTHETIC.** A three-certificate ECDSA P-256 chain generated per run, carrying Apple's App Store extension OID `1.2.840.113635.100.6.2.1` on the intermediate. Injected via `appstorejws.NewVerifier(appstorejws.WithRoot(...))` — the package's own documented option, the same seam its unit tests use. | Apple's signing key is not obtainable. A recorded real payload would expire and would then fail on a date rather than on a defect. **This proves the verifier accepts a chain it was told to trust; it does not prove Mosaic accepts Apple's real chain.** |
| **App Store Server API responses** | **LOCAL STUB.** `httptest` server speaking the documented `/inApps/v1/transactions/{id}` and `/inApps/v1/notifications/history` shapes. | No Apple account. |
| **Play Developer API responses** | **LOCAL STUB.** `httptest` server speaking `purchases.subscriptionsv2.get`, `purchases.products.get`, `orders.get`. | No Play Console application. |
| **Pub/Sub pull and acknowledge** | **LOCAL STUB.** `httptest` server speaking `:pull` and `:acknowledge`. | No Google Cloud project. |
| **Google OAuth token endpoint** | **LOCAL TLS STUB reached through a loopback CONNECT proxy.** `googleplay.ParseServiceAccount` pins `token_uri` to `https://oauth2.googleapis.com/token` and rejects any other value — a deliberate control against a doctored key file. Rather than weaken it, the driver installs a `Proxy` on `http.DefaultTransport` that tunnels only that host to a local TLS server. The client's assertion signing and the HTTPS exchange are real; only the host is local. | No Google credentials. The pinning control was deliberately left intact. |
| **Credential material** | **SYNTHETIC.** A locally generated PKCS#8 P-256 key stands in for an Apple `.p8`; a locally generated RSA-2048 key inside a real-shaped service-account JSON stands in for a Play key. | Same reason. |
| **Dashboard principal resolver** | **SUBSTITUTED.** `authn.ResolverFunc` returning a fixed actor from a header instead of validating a browser session cookie. **Authorization is not substituted:** owner/admin membership is still enforced by the real `requireRole` SQL against a real `organization_members` row. | Standing up the magic-link browser-auth flow adds nothing to a billing demonstration. |
| **Provider base URLs** | Not a substitution — `MOSAIC_APPLE_STOREKIT_BASE_URL`, `MOSAIC_GOOGLE_PLAY_BASE_URL`, and `MOSAIC_GOOGLE_PUBSUB_BASE_URL` are existing production configuration knobs. The clients are unmodified. | — |

### Process shape

The demonstration runs the **real router mounted on `httptest.NewServer`** inside
one process, not the `cmd/api` binary, and calls the **worker job functions
directly** rather than running `cmd/worker`. The reason is specific and is the
Apple root: `cmd/api` and `cmd/worker` both call `appstorejws.NewVerifier()` with
no options, pinning Apple's real embedded root, and there is no environment
variable that overrides it (correctly — a root override in production
configuration would be a vulnerability). A separate API process could therefore
never verify the synthetic chain. Everything between the socket and the database
is identical to the deployed path.

---

## 3. Demonstration 1 — Apple flow

### Step 1.0 — Mosaic Billing is off by default and must be enabled

```
PUT /v1/projects/proj_demo9a/billing/settings   -> 200
{"data":{"billingEnabled":true}}
```

### Step 1.1 — Create the Apple Store Server Credential

```
POST /v1/projects/proj_demo9a/billing/store-credentials   -> 201
{"data":{"id":"ssc_myNFb3o4Abq1soIc0r4fvA","projectId":"proj_demo9a",
 "environmentId":"env_demo9a","provider":"app_store","storeEnvironment":"production",
 "name":"Demo Apple team key","status":"active","healthStatus":"untested",
 "appleIssuerId":"57246542-96fe-1a63-e053-0824d011072a","appleKeyId":"2X9R4HXF34",
 "applications":[{"applicationId":"app_demo9a_ios","platform":"ios",
                  "providerApplicationIdentifier":"com.mosaic.demo"}],
 "notificationEndpointUrl":
   "https://billing.demo.mosaic.local/v1/billing/apple/notifications/<INTAKE-TOKEN-REDACTED>"}}
```

The endpoint URL is returned exactly once, on create (and once more on rotate).
The token in it is redacted here because it is an unauthenticated bearer value
in a URL path.

### Step 1.2 — The secret is ciphertext at rest

```sql
SELECT id, provider, store_environment, status, algorithm, key_id,
       octet_length(ciphertext)                              AS ciphertext_bytes,
       encode(substring(ciphertext from 1 for 16),'hex')     AS ciphertext_head,
       (encode(ciphertext,'escape') LIKE '%PRIVATE KEY%')    AS contains_pem_marker,
       (intake_token_digest IS NOT NULL)                     AS has_intake_token_digest,
       octet_length(intake_token_digest)                     AS intake_digest_bytes
FROM store_server_credentials WHERE id = 'ssc_myNFb3o4Abq1soIc0r4fvA';
```

```
id                         | provider  | store_environment | status | algorithm   | key_id       | ciphertext_bytes | ciphertext_head                  | contains_pem_marker | has_intake_token_digest | intake_digest_bytes
---------------------------+-----------+-------------------+--------+-------------+--------------+------------------+----------------------------------+---------------------+-------------------------+--------------------
ssc_myNFb3o4Abq1soIc0r4fvA | app_store | production        | active | AES-256-GCM | demo-2026-07 | 257              | ff3b4db80279fcd405c7986dd629d0c2 | false               | true                    | 32
```

The posted body contained a `-----BEGIN PRIVATE KEY-----` PEM.
`contains_pem_marker = false` shows the stored bytes are not it. The full column
list of the table was also dumped and contains **no plaintext token column** —
only `intake_token_digest` (32 bytes):

```
id, project_id, organization_id, environment_id, environment_mode, provider, store_environment,
name, status, health_status, credential_class, envelope_version, algorithm, key_id, nonce,
ciphertext, fingerprint, apple_issuer_id, apple_key_id, google_client_email,
google_pubsub_project_id, google_pubsub_subscription_id, intake_token_digest,
intake_token_rotated_at, last_error_code, last_tested_at, created_by_actor_id, created_at,
rotated_at, revoked_at, updated_at
```

### Step 1.3 — Client observation (contract envelope in, contract record out)

Request (Billing Ingestion Contract v1 `clientTransactionObservation`):

```json
{"billingIngestionContractVersion":"1","recordType":"clientTransactionObservation",
 "payload":{"observationId":"obs_demo_apple_1","submissionId":"sub_demo_apple_1",
   "providerId":"apple_app_store","storePlatform":"apple_app_store",
   "transactionReference":{"referenceKind":"app_store_transaction_id","value":"2000000512345671"},
   "observedAt":"2026-07-28T06:29:30Z","sourceAuthority":"client_observation",
   "context":{"platform":"ios","sdkFamily":"mosaic-ios","sdkVersion":"1.0.0"}}}
```

```
POST /v1/sdk/billing/observations   -> 202
{"billingIngestionContractVersion":"1","recordType":"observationSubmissionResult",
 "payload":{"submissionId":"sub_demo_apple_1","receivedAt":"2026-07-28T06:29:30.317Z",
            "status":"accepted_for_validation","estimatedValidationDelaySeconds":30}}
```

`accepted_for_validation` — the strongest thing the endpoint can honestly say.
There is no `validated` member in the status enum.

### Step 1.4 — Synthetic signed notification through the intake endpoint

```
POST /v1/billing/apple/notifications/<INTAKE-TOKEN-REDACTED>   -> 202
{"data":{"status":"accepted"}}
```

Body: 10 510 bytes of signed JWS (`{"signedPayload":"<JWS>"}`), not reproduced.
202 is inside Apple's 200–206 success range, so the notification is not retried,
and it says accepted rather than validated.

```sql
SELECT id, provider, source, source_authority, authentication_result, store_environment,
       notification_kind, notification_subtype, ingestion_status, body_state, algorithm,
       octet_length(ciphertext) AS ciphertext_bytes, provider_event_id
FROM billing_raw_inputs WHERE project_id='proj_demo9a' AND provider='app_store'
ORDER BY received_at;
```

```
id                         | source             | source_authority   | authentication_result  | store_environment | notification_kind | notification_subtype | ingestion_status | body_state | algorithm   | ciphertext_bytes | provider_event_id
---------------------------+--------------------+--------------------+------------------------+-------------------+-------------------+----------------------+------------------+------------+-------------+------------------+-------------------------------------
bri_ukjWcIDuJQRsZw-7GrALXg | client_observation | client_observation | unauthenticated_client | unclassified      | NULL              | NULL                 | accepted         | stored     | AES-256-GCM | 164              | sub_demo_apple_1
bri_krtp9le5pbBNtvjzrFdILA | apple_notification | store_notification | verified_signature     | production        | SUBSCRIBED        | INITIAL_BUY          | accepted         | stored     | AES-256-GCM | 10526            | 8f2c1a4e-1111-4a1b-9c11-demo00000001
```

The signature verified (`verified_signature`), the raw body is persisted
encrypted (`body_state=stored`, `AES-256-GCM`, 10 526 ciphertext bytes), and the
store environment came from the *verified payload*, not from the caller. The
client observation is correctly `unclassified` — a device may not classify its
own Store Environment.

Intake enqueued and did not validate inline:

```
status | attempt_count | max_attempts | available_now
-------+---------------+--------------+--------------
queued | 0             | 8            | true
queued | 0             | 8            | true
```

### Step 1.5 — Validation worker run

`billing.Service.ProcessNextValidation` — the exact function `cmd/worker`'s
`billing_validation` job family calls.

Apple stub call log (proves the real client made the authority call):
`[GET /inApps/v1/transactions/2000000512345671]`

```
provider  | store_environment | provider_transaction_id | provider_product_identifier | transaction_type            | fact_kind        | resolution_state | mosaic_product_id  | provider_product_mapping_id | is_test_transaction | fact_digest
----------+-------------------+-------------------------+-----------------------------+-----------------------------+------------------+------------------+--------------------+-----------------------------+---------------------+-----------------------------------------------------------------
app_store | production        | 2000000512345671        | com.mosaic.demo.pro.monthly | auto_renewable_subscription | initial_purchase | active_mapping   | prd_demo9a_monthly | ppm_demo9a_ios_monthly      | false               | 82b57ab47e4fcf91fba97540e4ee22bc80c14c9b1eb79cd3d4995e6e4329aa31
```

Resolution Snapshot, recording the exact mapping version used:

```
outcome  | resolution_state | candidate_count | provider_product_identifier | mosaic_product_id  | provider_product_mapping_id | matched_mapping_id     | mapping_version
---------+------------------+-----------------+-----------------------------+--------------------+-----------------------------+------------------------+----------------
resolved | active_mapping   | 1               | com.mosaic.demo.pro.monthly | prd_demo9a_monthly | ppm_demo9a_ios_monthly      | ppm_demo9a_ios_monthly | 1785220169954
```

`ppm_demo9a_ios_monthly` is a real `provider_product_mappings` row, seeded before
the run with `connection_id IS NULL`, `environment_id=env_demo9a`,
`platform=ios`, `provider=app_store`,
`provider_product_identifier=com.mosaic.demo.pro.monthly`, `status=active`,
pointing at Mosaic Product `prd_demo9a_monthly` (`type=subscription`).

### Step 1.6 — Duplicate delivery is idempotent

The byte-identical notification was POSTed again.

```
POST /v1/billing/apple/notifications/<INTAKE-TOKEN-REDACTED>   -> 202
{"data":{"status":"accepted"}}
```

```
apple_inputs | facts | jobs | attempts
-------------+-------+------+---------
2            | 1     | 2    | 2
```

Two Apple inputs and two jobs exist because the *client observation* is also an
Apple input with its own job; the notification itself produced exactly one input
and one job on both deliveries. One fact.

Ledger:

```
entry_type               | count
-------------------------+------
fact_recorded            | 1
input_duplicate_detected | 1     <-- the redelivery
input_quarantined        | 1     <-- the client observation, see §9 defect 3
input_received           | 2
product_resolved         | 1
validation_failed        | 1     <-- the client observation, see §9 defect 3
validation_started       | 2
validation_succeeded     | 1
```

The redelivery produced an `input_duplicate_detected` ledger entry, no second
input, no second job, and no second fact.

---

## 4. Demonstration 2 — Google flow

### Step 2.1 — Create the Google Store Server Credential

```
POST /v1/projects/proj_demo9a/billing/store-credentials   -> 201
{"data":{"id":"ssc_5Y56KlTKQ9B1srq39gYMnQ","provider":"google_play",
 "storeEnvironment":"production","status":"active","healthStatus":"untested",
 "googleClientEmail":"mosaic-rtdn@mosaic-demo-play.iam.gserviceaccount.com",
 "googlePubSubProjectId":"mosaic-demo-play","googlePubSubSubscriptionId":"mosaic-rtdn-sub",
 "applications":[{"applicationId":"app_demo9a_android","platform":"android",
                  "providerApplicationIdentifier":"com.mosaic.demo.android"}]}}
```

`notificationEndpointUrl` is absent — Google RTDN is pulled, not pushed, so no
public endpoint is issued. The service-account JSON is sealed under the same
AES-256-GCM envelope shown in §3 step 2.

### Step 2.2 — Client observation carrying only a token digest

```
POST /v1/sdk/billing/observations   -> 202
{"billingIngestionContractVersion":"1","recordType":"observationSubmissionResult",
 "payload":{"submissionId":"sub_demo_google_1","receivedAt":"2026-07-28T06:29:30.454Z",
            "status":"accepted_for_validation","estimatedValidationDelaySeconds":30}}
```

The reference was the 64-character lowercase-hex SHA-256 of the purchase token.
The token itself is structurally impossible to carry across this boundary.

### Step 2.3 — RTDN through the pull consumer

`billing.Service.ProcessNextRTDN` — `cmd/worker`'s `billing_rtdn` job family.

```
ProcessNextRTDN processed=true; pub/sub pulls=1 acknowledged=[ack-demo-1]; oauth exchanges=1
```

`oauth exchanges=1` is the real `googleplay.Client` performing a real RS256
JWT-bearer assertion and a real HTTPS token exchange against the local TLS stub.

```
id                         | source             | source_authority   | authentication_result  | store_environment | notification_kind | ingestion_status | body_state | algorithm   | ciphertext_bytes | token_digest
---------------------------+--------------------+--------------------+------------------------+-------------------+-------------------+------------------+------------+-------------+------------------+-----------------------------------------------------------------
bri_lwFfxO3vtMUKrWQ_EC6GQg | client_observation | client_observation | unauthenticated_client | unclassified      | NULL              | accepted         | stored     | AES-256-GCM | 212              | 7a5e7eee59da1c95a862f6d9024aed9b1e2ef53b2080eaba1b64a7273b58732d
bri_-n7cZxUne9P2e-3wTJALXw | google_rtdn        | store_notification | verified_transport     | production        | subscription_4    | accepted         | stored     | AES-256-GCM | 278              | 7a5e7eee59da1c95a862f6d9024aed9b1e2ef53b2080eaba1b64a7273b58732d
```

Two independent paths — an untrusted client digest and a server-side RTDN
carrying the real token — produced the **same** `transaction_reference_digest`.
That is the attribution join, and it demonstrates the cross-SDK token-digest
contract holds end to end. The purchase token itself appears only inside the
encrypted body.

### Step 2.4 — Authoritative Play API lookup and validation

Play stub call log:
`[GET /androidpublisher/v3/applications/com.mosaic.demo.android/purchases/subscriptionsv2/tokens/<TOKEN-REDACTED>]`

```
provider    | store_environment | provider_transaction_id  | provider_product_identifier | provider_base_plan_identifier | transaction_type            | fact_kind | resolution_state | mosaic_product_id          | provider_product_mapping_id | is_test_transaction
------------+-------------------+--------------------------+-----------------------------+-------------------------------+-----------------------------+-----------+------------------+----------------------------+-----------------------------+--------------------
google_play | production        | GPA.0000-0000-0000-00001 | sub.pro.monthly             | monthly                       | auto_renewable_subscription | renewal   | active_mapping   | prd_demo9a_android_monthly | ppm_demo9a_android_monthly  | false
```

The mapping `ppm_demo9a_android_monthly` declares
`provider_base_plan_identifier='monthly'`, so the base-plan scope was actually
exercised: a transaction on a different base plan would not have matched it.

No `acknowledge`, `consume`, or `refund` call was made — the Play stub log
contains exactly one read.

### Step 2.5 — Duplicate RTDN is idempotent

The byte-identical Pub/Sub message was re-enqueued under a new `ackId`
(`ack-demo-2`), which is exactly how Pub/Sub redelivers.

```
acknowledged ack ids: [ack-demo-1 ack-demo-2]
```

```
rtdn_inputs | google_facts | rtdn_duplicate_entries
------------+--------------+-----------------------
1           | 1            | 1
```

One RTDN input, one fact, one `input_duplicate_detected` entry. The redelivery
was acknowledged (so Pub/Sub stops redelivering) without re-ingesting.

---

## 5. Demonstration 3 — Quarantine and repair

### Step 3.1 — An authentic transaction for an unmapped provider Product

A correctly signed notification for `com.mosaic.demo.pro.yearly` was delivered.
No mapping existed for that identifier (see §3 step 1.5 — only the monthly
mapping was seeded).

```
POST /v1/billing/apple/notifications/<INTAKE-TOKEN-REDACTED>   -> 202
```

Authenticity verified; resolution failed:

```
attempt_number | outcome     | failure_category | diagnostic_code                 | store_environment
---------------+-------------+------------------+---------------------------------+------------------
1              | quarantined | resolution       | no_mapping_for_provider_product | production
```

```
id                           | reason_code     | severity | status | diagnostic_code                 | scopes
-----------------------------+-----------------+----------+--------+---------------------------------+---------------------------
bqr_0bc2443e9bb3d63dea1c9891 | product_unknown | warning  | open   | no_mapping_for_provider_product | [provider_product_mapping]
```

The fact was still recorded, explicitly unresolved — the store confirmed a real
purchase of something Mosaic does not recognise, and that is evidence, not noise:

```
provider_product_identifier | resolution_state | mosaic_product_id
----------------------------+------------------+------------------
com.mosaic.demo.pro.yearly  | unresolved       | (none)
```

### Step 3.2 — Operator repair

`ppm_demo9a_ios_yearly` → `prd_demo9a_yearly` inserted into
`provider_product_mappings`.

### Step 3.3 — Re-run resolution through the API

```
POST /v1/projects/proj_demo9a/billing/quarantine/bqr_0bc2443e9bb3d63dea1c9891/retry   -> 202
{"data":{"id":"bqr_0bc2443e9bb3d63dea1c9891","rawInputId":"bri_kfqOYt37OsE6r7hl8y2yWA",
 "reasonCode":"product_unknown","status":"retrying","attemptCount":1,
 "diagnosticCode":"no_mapping_for_provider_product"}}
```

Attempt history — the failed attempt is preserved, not replaced:

```
attempt_number | outcome     | diagnostic_code
---------------+-------------+--------------------------------
1              | quarantined | no_mapping_for_provider_product
2              | validated   |
```

The original Raw Billing Input is untouched and still holds its encrypted body:

```
id                         | ingestion_status | body_state | algorithm   | ciphertext_bytes | received_at              | envelope_rotated_at
---------------------------+------------------+------------+-------------+------------------+--------------------------+--------------------
bri_kfqOYt37OsE6r7hl8y2yWA | accepted         | stored     | AES-256-GCM | 10520            | 2026-07-28T06:29:30.528Z | NULL
```

Facts for that transaction, before and after the repair:

```
resolution_state | mosaic_product_id | mapping_id            | recorded_at
-----------------+-------------------+-----------------------+-------------------------
unresolved       | (none)            | (none)                | 2026-07-28T06:29:30.545Z
active_mapping   | prd_demo9a_yearly | ppm_demo9a_ios_yearly | 2026-07-28T06:29:30.577Z
```

**Two facts, deliberately.** `FactDigest` covers `resolution_state`,
`mosaic_product_id`, `provider_product_mapping_id`, and the mapping version, so a
repaired resolution is a genuinely different statement and is appended beside the
original rather than overwriting it. The ledger never claims retroactively that
Mosaic always knew the Product.

Quarantine closure and its audit trail:

```
status               | reason_code     | closing_attempt_id         | actions
---------------------+-----------------+----------------------------+--------------------------
closed_after_success | product_unknown | bva_NyBTEzm2VGrh_cFiCwxnVA | retry_validation/accepted
```

Closure required a `closing_attempt_id`. There is no endpoint that marks a
quarantined input valid.

---

## 6. Demonstration 4 — Retry

### Step 4.1 — Provider outage

The Apple stub was switched to answer `503` with Apple error code `5000000`, and
a new notification was delivered and validated once.

```
attempt_number | outcome           | retryable | failure_category | diagnostic_code    | provider_http_status | provider_code
---------------+-------------------+-----------+------------------+--------------------+----------------------+--------------
1              | retryable_failure | true      | transient        | apple_server_error | 503                  | 5000000
```

```
status | attempt_count | scheduled_in_future | seconds_until_available
-------+---------------+---------------------+------------------------
queued | 1             | true                | 26
```

Classified retryable, requeued with backoff (26 s — the 30 s attempt-2 step with
jitter applied), not failed, and no fact was written.

### Step 4.2 — Recovery

The stub was restored and the driver waited on the wall clock. **No clock was
manipulated and no time was mocked** — the run really slept.

```
retry became available after 26s of real elapsed time
```

```
attempt_number | outcome           | diagnostic_code    | latency_ms
---------------+-------------------+--------------------+-----------
1              | retryable_failure | apple_server_error | 2
2              | validated         |                    | 16
```

```
provider_transaction_id | resolution_state | mosaic_product_id  | fact_kind
------------------------+------------------+--------------------+-----------------
2000000512345673        | active_mapping   | prd_demo9a_monthly | initial_purchase
```

The earlier failed attempt is still present. Attempts are append-only in the
schema, so this is a structural guarantee rather than a convention.

---

## 7. Demonstration 5 — Reconciliation

`apple_transaction_history` remains unimplemented (Stage 2 report §7.7), so the
wired `apple_notification_history` strategy was used, as instructed.

### Step 5.1 — A notification Mosaic never received

A valid notification was built and deliberately **not** delivered to the intake
endpoint. It was placed only in the Apple stub's notification history, reported
with `sendAttemptResult: TIMED_OUT`.

```
inputs
------
0
```

### Step 5.2–5.3 — Run

```
POST .../environments/env_demo9a/billing/reconciliation-runs   -> 202
{"data":{"id":"brr_pJRWVz6eLlF_2UuyG_cHlA","strategy":"apple_notification_history",
 "trigger":"manual","status":"queued","provider":"app_store", ... }}
```

`billing.Service.ProcessNextReconciliation` → run summary recorded:

```
strategy                   | trigger | status    | examined_count | discovered_count | duplicate_count | failure_count | last_error_code | started | completed
---------------------------+---------+-----------+----------------+------------------+-----------------+---------------+-----------------+---------+----------
apple_notification_history | manual  | completed | 1              | 1                | 0               | 0             |                 | true    | true
```

The discovered item entered the **same** pipeline, with provenance recorded:

```
id                         | source                     | source_authority     | authentication_result | ingestion_status | body_state | correlation_id
---------------------------+----------------------------+----------------------+-----------------------+------------------+------------+-------------------------------------
bri_DPa17nmAMA7FACZ2P6aeaQ | apple_notification_history | store_reconciliation | verified_signature    | accepted         | stored     | reconcile:brr_pJRWVz6eLlF_2UuyG_cHlA
```

Its signature was re-verified on discovery (`verified_signature`), it was
enqueued like a live delivery, and validation produced a fact:

```
provider_transaction_id | resolution_state | mosaic_product_id  | fact_kind
------------------------+------------------+--------------------+-----------------
2000000512345674        | active_mapping   | prd_demo9a_monthly | initial_purchase
```

### Step 5.4 — Idempotent re-run

A second run over the same window:

```
status    | examined_count | discovered_count | duplicate_count
----------+----------------+------------------+----------------
completed | 1              | 1                | 0     <-- first run
completed | 1              | 0                | 1     <-- second run
```

```
inputs | facts
-------+------
1      | 1
```

The recovered notification collapses onto the same idempotency key a live
delivery would have produced (`AppleNotificationKey(notificationUUID)`), so
re-running reconciliation writes nothing.

### Step 5.5 — The other wired strategy did not do what it claims

```
POST .../billing/reconciliation-runs (google_token_requery)   -> 202
```

```
strategy             | status    | examined_count | discovered_count | duplicate_count | failure_count
---------------------+-----------+----------------+------------------+-----------------+--------------
google_token_requery | completed | 7              | 0                | 7               | 0
```

```
validation attempts before the run: 9; after: 9
Play API calls so far: 1; Pub/Sub pulls so far: 2
```

The run reports `completed` with 7 examined, but **the Play API was never called
and no validation attempt was created**. See §9 defect 2.

---

## 8. Demonstration 6 — Replay, and the absence of access state

### Step 6.1 — Replay a prior Raw Billing Input

The stage-1 Apple notification input was selected.

```
attempts | facts | facts_total
---------+-------+------------
1        | 1     | 6            <-- before replay
```

```
POST .../environments/env_demo9a/billing/replay-jobs   -> 202
{"data":{"id":"brp_…","kind":"revalidation","rawInputId":"bri_krtp9le5pbBNtvjzrFdILA",
 "validatorVersion":1,"status":"queued"}}
```

`billing.Service.ProcessNextReplay` → job summary:

```
kind         | status    | validator_version | examined_count | unchanged_count | new_fact_count | conflict_count | comparison_result
-------------+-----------+-------------------+----------------+-----------------+----------------+----------------+------------------
revalidation | completed | 1                 | 1              | 1               | 0              | 0              | identical
```

Validation queue state after the replay job ran, and state after draining
validation:

```
status    | attempt_count | available_now
----------+---------------+--------------
completed | 1             | true
```

```
attempts | facts | facts_total
---------+-------+------------
1        | 1     | 6            <-- after replay: unchanged
```

```
attempt_number | outcome   | validator_version | started_at
---------------+-----------+-------------------+-------------------------
1              | validated | 1                 | 2026-07-28T06:27:52.047Z
```

**No fact was duplicated and prior attempts were preserved — but no new
Validation Attempt was appended either, and the `comparison_result: identical`
was not computed from a re-validation.** The job never re-queued the input. See
§9 defect 1. The parts of the plan's §8 replay contract this demonstration *did*
satisfy — facts never duplicated, prior attempts and facts preserved, no
customer access can change — are satisfied; the part it did not satisfy is
"new Validation Attempts are appended … normalized output compared".

### Step 6.2 — No customer-access or entitlement state exists anywhere

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND (
   table_name ILIKE '%customer%'          OR table_name ILIKE '%subscriber%' OR
   table_name ILIKE '%access_grant%'      OR table_name ILIKE '%entitlement_state%' OR
   table_name ILIKE '%subscription_state%' OR table_name ILIKE '%user_entitlement%' OR
   table_name ILIKE '%revenuecat_migration%');
```

```
(no rows)
```

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name LIKE 'billing_%' AND (
   column_name ILIKE '%customer%' OR column_name ILIKE '%subscriber%' OR
   column_name ILIKE '%user_id%'  OR column_name ILIKE '%account_token%' OR
   column_name ILIKE '%price%'    OR column_name ILIKE '%currency%' OR
   column_name ILIKE '%amount%'   OR column_name ILIKE '%email%');
```

```
(no rows)
```

Three tables carry `entitlement` in their name. All three predate Phase 9A and
are **catalog definitions, not per-customer state** — their full column lists
contain no subject identity:

```
table_name                    | columns
------------------------------+---------------------------------------------------------------------------------
entitlements                  | id, project_id, key, name, description, created_at, updated_at
product_entitlement_grants    | project_id, product_id, entitlement_id, created_at
provider_entitlement_mappings | id, project_id, entitlement_id, connection_id, environment_id, application_id,
                              | provider_entitlement_identifier, status, archived_at, created_at, updated_at
```

Every table Phase 9A created:

```
billing_ledger_entries              billing_quarantine_records     billing_replay_jobs
billing_product_resolutions         billing_raw_inputs             billing_transaction_facts
billing_project_settings            billing_reconciliation_runs    billing_validation_attempts
billing_quarantine_actions                                         billing_validation_jobs
store_server_credentials            store_server_credential_applications
                                    store_server_credential_events
```

None of them models access, entitlement grants, subscription state, a customer,
or money. Replay cannot change customer access because there is no customer
access to change — structurally, not by policy.

---

## 9. Defects the demonstration uncovered

All three are new findings. None was fixed during the demonstration: fixing them
would have invalidated the evidence captured here, and two of them are design
decisions that belong to the Phase 9A review rather than to a demo run.

### Defect 1 — Replay never appends a Validation Attempt (high)

**Observed:** §8 step 6.1. `ProcessNextReplay` completed with
`examined=1, unchanged=1, comparison_result=identical`, yet the input's attempt
count stayed at 1 and no validation ran.

**Root cause:** `Service.ProcessNextReplay` re-enqueues by calling
`Repository.PersistRawInput(ctx, input, /*enqueue=*/true, now)` on an input that
already exists. In `billingpostgres.PersistRawInput`, the `ON CONFLICT DO
NOTHING` insert affects zero rows, the duplicate branch writes an
`input_duplicate_detected` ledger entry, and it **returns before reaching the
`if enqueue` block**. Nothing is ever queued.

**Consequence:** replay and revalidation are inert. Worse, the job reports
`comparison_result: identical`, which is a comparison that was never performed —
an operator reading the dashboard would conclude the ledger had been
re-verified. Plan §8 requires "new Validation Attempts are appended; prior
attempts and facts preserved; normalized output compared".

**Suggested fix:** replay should not go through the duplicate-suppressing intake
path at all. It should insert the validation job directly, as
`Repository.RequeueValidation` already does correctly for the quarantine-retry
path (that path *is* demonstrated working, §5 step 3.3).

### Defect 2 — `google_token_requery` reconciliation performs no re-query (high)

**Observed:** §7 step 5.5. `examined=7, duplicate=7, status=completed`, zero Play
API calls, zero new validation attempts.

**Root cause:** identical to defect 1 — `Service.reconcileGoogleTokens` calls
`PersistRawInput(..., true, ...)` on existing inputs and hits the same early
return. Secondarily, its candidate set comes from `Repository.ReplayInputs`,
which filters only on project, environment, `body_state='stored'`, and the time
window — so it examined all 7 inputs in the window including the Apple ones,
none of which has a Google purchase token.

**Consequence:** the Google half of reconciliation is a counter that always
reports success. An operator using it to close a suspected ingestion gap after a
Play outage would be told everything reconciled while nothing was re-read.

### Defect 3 — Every observation-sourced input quarantines as `credential_unusable` (high)

**Observed:** §4 step 2.5.

```
provider    | provider_event_id | credential_id | outcome     | failure_category | diagnostic_code
------------+-------------------+---------------+-------------+------------------+--------------------
app_store   | sub_demo_apple_1  | (none)        | quarantined | configuration    | credential_unusable
google_play | sub_demo_google_1 | (none)        | quarantined | configuration    | credential_unusable
```

**Root cause:** `Service.submitObservation` builds its `RawInput` from an
`ObservationScope` derived from the API key, which carries organization,
project, environment, application, and platform — but **no `credential_id`**.
Both `Service.appleCredential` and `Service.googleCredential` begin
`if input.CredentialID == "" { return ErrCredentialUnusable }`. Every
observation therefore fails at the first step of validation, before any
reference is even read.

**Consequence:** the entire SDK-facing surface is inert. The four SDK teams have
shipped the contract envelope; the server accepts it with
`accepted_for_validation` and then quarantines it 100 % of the time. For Apple
this contradicts plan §6 directly ("Get Transaction Info lookup where the input
is a bare reference"). For Google it is partly masked by the known and accepted
`purchase_token_unavailable` limitation (Stage 2 report, Addendum 1), but the
failure occurs earlier and for a different reason, so that limitation is not the
explanation.

**Suggested fix:** resolve the credential at validation time from
`(project_id, provider, environment_id)` — which is unique by the migration-00022
constraint — whenever the input carries none. This is a small change in
`appleCredential`/`googleCredential` and needs no schema change. It also removes
the multi-Application `bid` bootstrapping awkwardness noted in Stage 2 §7.5 for
the observation path.

### Non-defect worth recording

The quarantine-repair flow (§5) produces **two** Transaction Facts for one
transaction — one `unresolved`, one `active_mapping`. This is correct and
intentional: `FactDigest` covers the resolution outcome, so a repaired
resolution is a new statement rather than a rewrite of the old one. It is called
out here only because a reader counting facts against transactions will notice
it.

---

## 10. Limitations — what only a live sandbox can prove

Every item below is **unavailable, not passing**.

1. **Real Apple signatures.** The verifier has still never seen an authentic
   Apple JWS. An undocumented deviation in Apple's `x5c` ordering, intermediate
   extension placement, certificate lifetime, or `alg` header would not have
   been caught by a chain Mosaic generated for itself. The embedded
   `AppleRootCA-G3.cer` fingerprint also remains cross-checked against only one
   source (Stage 2 report §8).
2. **Real App Store Server API behaviour.** Apple's actual error codes,
   `Retry-After` values, rate limits (production and the sandbox's 10 % of
   production), pagination of Get Notification History, and the real
   `signedTransactionInfo` field set are all modelled from documentation, not
   observed.
3. **Real Pub/Sub delivery.** Google's real ack deadlines, message ordering,
   redelivery timing under load, dead-letter behaviour, and flow control were not
   exercised. The stub redelivers only when the driver tells it to.
4. **Real Google OAuth.** The assertion was signed for real, but Google never
   validated it. A wrong `aud`, `scope`, clock skew tolerance, or key-format
   assumption would surface only against `oauth2.googleapis.com`.
5. **Real store purchases.** No StoreKit sandbox purchase, no Play license-test
   purchase, no renewal, refund, revocation, grace period, upgrade, downgrade,
   pause, or voided purchase was ever made. Every fact in this document
   originates from a payload Mosaic constructed.
6. **Provider notification retry behaviour.** Apple's five-retry budget (and its
   absence in sandbox), and Pub/Sub's redelivery on a slow or failing consumer,
   were not exercised. The intake path's central design constraint — never 429,
   never validate inline — is demonstrated structurally (the route is outside
   every limiter family, and intake made zero outbound calls) but not under real
   provider pressure.
7. **Multi-Application Apple `bid` selection** (Stage 2 report §7.5) remains
   unverified: the demonstration used a single-Application credential.
8. **Concurrency.** One worker, one process. `FOR UPDATE SKIP LOCKED` was not
   exercised under contention.
9. **`apple_transaction_history` reconciliation** is still unimplemented and was
   therefore not demonstrated (Stage 2 report §7.7).
10. **The trusted server observation endpoint** (`POST
    /v1/billing/server/observations`) was not exercised in this run. Given
    defect 3 it would have quarantined identically; it is listed here so the
    omission is not mistaken for a pass.
11. **`cmd/api` and `cmd/worker` as processes.** See §2 — the real router and the
    real job functions ran, but not inside the deployed binaries, because those
    binaries pin Apple's real root with no override.

### On the plan's "one-minute demo path"

The Stage 4 brief refers to a one-minute demo path in "§15 last block". **Plan
§15 contains no such block** — it is twelve lines ending with the sentence about
synthetic vectors. Rather than invent one, the whole demonstration was built as a
single scripted sequence, which is the property such a path would be asserting:

```
DATABASE_URL=… go run ./cmd/billingdemo
…
=== demonstration complete in 26.965s ===
```

One command, no manual steps, 27 seconds — of which 26 seconds is the real retry
backoff wait in §6.

---

## 11. Reproduction, artifacts, and cleanup

### The driver

`apps/api/cmd/billingdemo/` — kept, not throwaway. It lives beside `cmd/keyring`,
`cmd/migrate`, and `cmd/loadgen`, which is where backend dev tooling lives in
this repository.

| File | Contents |
| --- | --- |
| `main.go` | composition root, the eight stages, evidence printing |
| `seed.go` | tenant seeding and reset; writes only pre-9A tables |
| `stubs.go` | Apple, Play, Pub/Sub, and OAuth stubs plus the CONNECT proxy |
| `vectors.go` | synthetic certificate chain, JWS signing, credential material, RTDN encoding |

It writes no `billing_*` row itself: every billing row in this document was
produced by the API, the service, or a worker job function.

### Reproducing

```bash
docker run -d --name mosaic-9a-demo \
  -e POSTGRES_PASSWORD=demo -e POSTGRES_USER=demo -e POSTGRES_DB=mosaic_demo \
  -p 55447:5432 postgres:17
export DATABASE_URL='postgres://demo:demo@127.0.0.1:55447/mosaic_demo?sslmode=disable'
cd apps/api && go run ./cmd/migrate up && go run ./cmd/billingdemo
docker rm -f mosaic-9a-demo
```

### Checks run

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `gofmt -l ./cmd/billingdemo` | clean |
| Static analysis | `go vet ./cmd/billingdemo` | clean |
| Build | `go build ./...` | ok |
| Migrations | `go run ./cmd/migrate up` on empty `postgres:17` | 25/25 applied |
| Demonstration | `go run ./cmd/billingdemo` | exit 0, 26.965 s |

### Cleanup

The `mosaic-9a-demo` container and its volume were removed after the run. Port
55441 was avoided because an unrelated local process already held it; 55447 was
used instead.

---

## 12. Stage 4 verdict

**Demonstrations 1, 2, 3, 4, and 5 (Apple notification-history strategy) pass**
against synthetic vectors and local provider stubs, with every synthetic element
classified in §2 and every live-store gap recorded in §10.

**Demonstration 6 (replay) fails**: it duplicated no fact and preserved all prior
attempts, but it appended no new Validation Attempt and reported a comparison it
never performed (§9 defect 1).

**Demonstration 5 is partial**: the Apple notification-history strategy works
end to end; the `google_token_requery` strategy is inert (§9 defect 2).

**A third defect outside the six demonstrations** makes the entire SDK
observation surface inert (§9 defect 3).

Under the Phase 9A plan, Stage 4 therefore cannot be recorded as a clean pass.
The three defects are all in application-service wiring rather than in the
schema, the contract, the security boundary, or the resolver — the parts that
would have been expensive to get wrong — and all three have small, local fixes.
Recommendation: fix defects 1–3, re-run this driver, and re-record §8 step 6.1,
§7 step 5.5, and §4 step 2.5.
