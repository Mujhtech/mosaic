# Phase 9A Stage 4 — Integrated provider demonstration evidence

Operator: mosaic-backend agent
Date: 2026-07-28
Branch: `phase/9a-transaction-ingestion-validation`
Baseline commit: `9c311ac` (first demonstration run and driver). The three
defects this run found were fixed and committed as `8aeffef` (replay attempts,
Google re-query, observation credential resolution) and `3397ea4` (dashboard
support for the missing-credential quarantine reason).
Specification: `docs/plans/phase-9a-transaction-ingestion-validation.md` §15, §6–§8

**This document records two runs.** The first run (commit `9c311ac`) found three
blocking defects. They were fixed, the minimum tests that catch each were added,
and the driver was re-run against a fresh container. Every evidence block below
is from the **second, post-fix run** unless it is explicitly labelled
"before the fix". §9 records each defect as found → fixed → re-verified.

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
| Migrations | `go run ./cmd/migrate up` → 26/26 applied to an empty database (00026 is the fix migration, §9 defect 3) |
| Demo driver | `apps/api/cmd/billingdemo` (new; see §8) |
| Run command | `DATABASE_URL=postgres://demo:demo@127.0.0.1:55447/mosaic_demo?sslmode=disable go run ./cmd/billingdemo` |
| Wall-clock | **37.046 s** for the complete eight-stage sequence, including a real retry backoff wait (26.965 s on the pre-fix run) |
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
| PostgreSQL schema, constraints, append-only triggers | `cmd/migrate up`, 26/26 migrations; every write below went through them |
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
2            | 2     | 2    | 2
```

Broken down by source — this is the row that answers "did the redelivery
duplicate anything?":

```
source             | inputs | jobs | facts
-------------------+--------+------+------
apple_notification | 1      | 1    | 1
client_observation | 1      | 1    | 1
```

The notification produced **exactly one input, one job, and one fact across both
deliveries**. The second Apple input and the second fact belong to the *client
observation* from step 1.3, which is now validated in its own right (see §9
defect 3 — before the fix it quarantined). The two facts describe the same
transaction but are not identical statements; §9's "second observation" explains
why and why that is deliberate rather than a duplication bug.

Ledger:

```
entry_type               | count
-------------------------+------
fact_recorded            | 2
input_duplicate_detected | 1     <-- the redelivery
input_received           | 2
product_resolved         | 2
validation_started       | 2
validation_succeeded     | 2
```

The redelivery produced an `input_duplicate_detected` ledger entry, no second
input, no second job, and no second fact. No `validation_failed` and no
`input_quarantined` entry appears any more — both were the observation failing,
and both are gone.

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

### Step 2.6 — Observations resolve their credential from the Environment scope

An observation's tenancy comes from an API key, which proves organization,
Project, Environment, and Application, but names no store connection. The
credential is therefore resolved at validation time from
`(project_id, provider, environment_id)` — UNIQUE by migration 00022.

```
provider    | provider_event_id | input_credential_id | resolved_credential_id     | outcome     | diagnostic_code
------------+-------------------+---------------------+----------------------------+-------------+---------------------------
app_store   | sub_demo_apple_1  | (none on input)     | ssc_uGGRAsWaxfM2jqXvLQKnQg | validated   |
google_play | sub_demo_google_1 | (none on input)     | ssc_g3zxAllOWzJgL0-cPgx6ig | quarantined | purchase_token_unavailable
```

Both inputs carried no credential of their own; both attempts resolved one and
recorded it as provenance. The Apple observation validated end to end and
produced its own fact:

```
provider  | provider_transaction_id | provider_product_identifier | resolution_state | mosaic_product_id  | renewal_expected | fact_digest
----------+-------------------------+-----------------------------+------------------+--------------------+------------------+-----------------------------------------------------------------
app_store | 2000000512345671        | com.mosaic.demo.pro.monthly | active_mapping   | prd_demo9a_monthly | NULL             | cc06f6a9660a055d8ff258e548f10499e0b7ab3d656dfc37c246e0c6a85efe07
```

This is plan §6's "Get Transaction Info lookup where the input is a bare
reference", working: the observation carried only the decimal transaction id,
and the App Store Server API supplied everything else.

The Google observation still quarantines, and correctly so: it carries a token
*digest*, a digest cannot be reversed into the token the Play API requires, and
the honest answer is `purchase_token_unavailable`. That is the documented,
accepted limitation from the Stage 2 report (Addendum 1) — not the credential
failure it used to report.

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

### Step 5.5 — The other wired strategy: `google_token_requery`

```
POST .../billing/reconciliation-runs (google_token_requery)   -> 202
```

```
strategy             | status    | examined_count | discovered_count | duplicate_count | failure_count
---------------------+-----------+----------------+------------------+-----------------+--------------
google_token_requery | completed | 1              | 0                | 1               | 0
```

Re-verified after the Stage 5 fix pass. The run summary is unchanged; the API
response now additionally carries `conflictCount`, which is `0` here because the
provider's answer agreed with the fact already on record. A run whose provider
answer *contradicted* a recorded fact would report a non-zero `conflictCount`,
land `partial` rather than `completed`, and open a `replay_conflict` quarantine
record — the "conflicting state" half of the Gate 9A criterion, which this run
does not exercise because nothing in the demonstration contradicts itself.

```
validation attempts before the run: 9; after: 10 (+1)
Play API calls before the run: 1; after: 2 (+1)
```

The run genuinely re-read the Play API (+1 call) and appended a real validation
attempt (+1). The provider answer was unchanged, so the recomputed fact digest
matched the one on record and the item is reported as a duplicate rather than a
discovery — a comparison the run performed rather than assumed.

`examined_count = 1` is the provider and source filter working. The Environment
holds seven inputs inside the window; exactly one of them — the RTDN — carries a
purchase token this strategy can re-query:

```
provider    | source                     | attempts
------------+----------------------------+---------
app_store   | apple_notification         | 5
app_store   | apple_notification_history | 1
app_store   | client_observation         | 1
google_play | client_observation         | 1     <-- untouched: carries a digest, not a token
google_play | google_rtdn                | 2     <-- the reconciliation appended this one
```

Before the fix this run reported `examined=7, duplicate=7, completed` with zero
Play API calls and zero attempts. See §9 defect 2.

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

The replay really re-read the store — the Apple stub's cumulative call count
rises during this step — and appended an attempt:

```
attempts | facts | facts_total
---------+-------+------------
2        | 1     | 7            <-- after replay: one more attempt, no new fact
```

```
attempt_number | outcome   | validator_version | started_at
---------------+-----------+-------------------+-------------------------
1              | validated | 1                 | 2026-07-28T07:24:25.801Z
2              | validated | 1                 | 2026-07-28T07:25:02.523Z
```

The recomputed fact digest matched the one already on record, so the unique
constraint absorbed the write and exactly one fact remains:

```
fact_digest                                                      | resolution_state | mosaic_product_id  | recorded_at
-----------------------------------------------------------------+------------------+--------------------+-------------------------
d65b1306783317d373c0127fe0b86778b3e6e1685d306201c44d5ccea1a4db4d | active_mapping   | prd_demo9a_monthly | 2026-07-28T07:24:25.808Z
```

The deduplication is recorded rather than silent, so the ledger shows the
pipeline ran and found nothing new:

```
entry_type               | count
-------------------------+------
fact_deduplicated        | 1     <-- the replay's recomputed fact, absorbed
fact_recorded            | 1     <-- the original
input_duplicate_detected | 1
input_received           | 1
product_resolved         | 2     <-- resolution ran on both attempts
validation_started       | 2
validation_succeeded     | 2
```

This satisfies plan §8 in full: new Validation Attempts are appended, prior
attempts and facts are preserved, the normalized output is compared, facts are
never duplicated, and no customer access can change (§8 step 6.2). The
`comparison_result: identical` is now a verdict computed by comparing the
recomputed digest against the recorded baseline — the changed-answer branch,
which cannot be produced by this fixed-response stub, is pinned by
`TestReplayAppendsAttemptAndComparesAgainstRecordedFacts` (§9).

Before the fix this step appended no attempt at all while still reporting
`identical`. See §9 defect 1.

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

## 9. Defects: found → fixed → re-verified

The first run (commit `9c311ac`) found three blocking defects. All three are now
fixed, each has a test that fails against the reintroduced bug, and the
demonstration has been re-run against a fresh container. **The fixes are
committed as `8aeffef` and `3397ea4`.**

Every test below was checked by reintroducing its defect and confirming the test
fails — a test that has never seen the bug it claims to catch is a decoration.
The exact failure each produced is quoted.

### Defect 1 — Replay never appended a Validation Attempt (high) — FIXED

**Found.** `ProcessNextReplay` completed with
`examined=1, unchanged=1, comparison_result=identical`, yet the input's attempt
count stayed at 1 and no validation ran.

**Root cause.** Replay re-enqueued by calling
`Repository.PersistRawInput(ctx, input, /*enqueue=*/true, now)` on an input that
already existed. In `billingpostgres.PersistRawInput` the `ON CONFLICT DO
NOTHING` insert affects zero rows, the duplicate branch writes an
`input_duplicate_detected` ledger entry, and it **returns before reaching the
`if enqueue` block**. Nothing was ever queued. Worse, the job reported a
comparison it had never performed.

**Fixed.** A new repository method `LeaseValidationJobFor` creates — or takes
over — the validation job for one named input and returns it **already leased**
to the caller. Writing it as `queued` would have let the ordinary validation
worker claim it in between, so the replay would attribute an outcome it did not
produce; taking the lease in the same statement makes that handover impossible.
A new `Service.revalidate` helper then runs the *identical* pipeline the worker
runs (`runValidation` + `CompleteAttempt`), so determinism still lives in exactly
one place. The comparison is now real: `FactDigestsForInput` reads the digests
already on record **before** the attempt runs, and the recomputed digest is
compared against that baseline. An outcome that is neither `validated` nor
`recorded_no_fact` counts as a conflict rather than as "unchanged", because a
quarantine or a provider outage means the replay could not confirm the earlier
answer.

**Re-verified.** §8 step 6.1: attempt 2 appended, one fact retained, a
`fact_deduplicated` ledger entry written, `comparison_result: identical`
computed.

**Test.** `TestReplayAppendsAttemptAndComparesAgainstRecordedFacts`. It replays
twice: once with an unchanged provider answer (must report `identical`,
`unchanged=1`, one fact) and once after moving the subscription's expiry, which
moves the fact digest (must report `new_facts`, `new=1`, two facts). The second
half is what proves the `identical` verdict is computed rather than assumed —
without it, a hard-coded "identical" would pass. Against the reintroduced bug it
fails with:

```
1 attempts after replay, want 2 — the replay appended no attempt
```

### Defect 2 — `google_token_requery` reconciliation performed no re-query (high) — FIXED

**Found.** `examined=7, duplicate=7, status=completed`, with zero Play API calls
and zero new validation attempts. It also examined all seven inputs in the
window, including the Apple ones, none of which has a purchase token.

**Root cause.** Two independent problems. The same early return as defect 1, and
`Repository.ReplayInputs` filtered only on project, environment, `body_state`,
and the window.

**Fixed.** `reconcileGoogleTokens` now goes through `Service.revalidate`, so each
candidate is genuinely re-read from the Play API. `ReplayInputs` gained an
`InputFilter` with a provider and a source list. The reconciliation passes
`{Provider: google_play, Sources: [google_rtdn, google_token_requery]}`; replay
passes the zero filter, because replaying a window deliberately covers
everything in it.

The **source** half of the filter is not redundant with the provider half, and
the first fix attempt got this wrong: filtering by provider alone still pulled in
the Google *client observation*, which carries a token digest rather than a
token. That can never be re-queried, so the run reported `partial` with
`failure_count=1` — an alarm that would fire on every reconciliation forever and
therefore never be believed. Restricting to token-bearing sources is what makes
`completed` mean something.

**Checked for the same gap elsewhere.** `reconcileAppleNotifications` does not
use `ReplayInputs` at all: its candidates come from Apple's Get Notification
History and are constrained by the credential's own Application scope, so it has
no equivalent filter gap. `ProcessNextReplay` is the only other caller and
deliberately passes an empty filter.

**Re-verified.** §7 step 5.5: `examined=1, duplicate=1, failure=0, completed`,
Play API calls +1, validation attempts +1, and the per-source table showing the
digest-only observation untouched.

**Test.** `TestGoogleReconciliationRequeriesOnlyGoogleInputs` asserts all three
halves in one place, because fixing one without the others still produces a run
that lies: the recorded Play API call count must rise by exactly one, the Google
RTDN input must gain an attempt, and neither the Apple input nor the digest-only
Google observation may gain one. Against the reintroduced filter bug it fails
with:

```
the Apple input gained 1 attempts from a Google reconciliation
```

### Defect 3 — Every observation quarantined as `credential_unusable` (high) — FIXED

**Found.**

```
provider    | provider_event_id | credential_id | outcome     | diagnostic_code
------------+-------------------+---------------+-------------+--------------------
app_store   | sub_demo_apple_1  | (none)        | quarantined | credential_unusable
google_play | sub_demo_google_1 | (none)        | quarantined | credential_unusable
```

**Root cause.** `Service.submitObservation` builds its `RawInput` from an
`ObservationScope` derived from the API key, which carries organization,
Project, Environment, Application, and platform — but **no `credential_id`**.
Both `appleCredential` and `googleCredential` began
`if input.CredentialID == "" { return ErrCredentialUnusable }`, so every
observation failed before its reference was read. The entire SDK-facing surface
was inert while the endpoint kept answering `accepted_for_validation`.

**Fixed.** Four parts:

1. A new repository method `CredentialForEnvironment(projectID, provider,
   environmentID)`. Migration 00022's `UNIQUE (project_id, provider,
   environment_id)` is what makes this answer unambiguous by schema rather than
   by a "pick the first" rule an application defect could get wrong. The Project
   is in the predicate as well as the Environment, so a mismatched pair returns
   nothing rather than another tenant's credential.
2. `Service.credentialIDFor` uses the input's own credential when it has one and
   falls back to the scope lookup when it does not. The resolved id is stamped
   onto the attempt, so provenance is recorded even for a failure — and it is
   what `ApplicationForIdentifier` now receives, which was the second blocker
   behind the first.
3. A new sentinel `ErrCredentialMissing`, distinct from `ErrCredentialUnusable`,
   and a new quarantine reason `missing_validation_credential` (migration
   00026). The two failures have different causes and different fixes: an
   unusable credential is a broken secret and the answer is rotation; a missing
   one means Mosaic was asked to validate against a store it has never been
   connected to. Reporting the second as the first sends an operator to rotate a
   credential that does not exist.
4. A fourth defect found while fixing this one: when the body carried no
   `packageName` — which is every observation, since only an RTDN carries one —
   `validateGoogle` fell back to the credential's **Pub/Sub project id**, which
   is not a package name and can never match an Application scope. It now falls
   back to the credential's first scoped Application identifier, the same
   convention the Apple path already uses for `bid`, and quarantines explicitly
   if the credential has no scoped Application at all.

**Re-verified.** §4 step 2.6: both observations resolve a credential from their
Environment scope and record it; the Apple observation validates end to end and
produces its own fact from a bare transaction id, which is plan §6's
"Get Transaction Info lookup where the input is a bare reference". The Google
observation now reports `purchase_token_unavailable` — the documented, accepted
limitation — instead of a credential failure.

**Test.** `TestObservationValidatesAgainstEnvironmentScopedCredential` asserts
the positive case (an observation with no credential of its own validates
against the Environment's credential, records that credential on the attempt,
produces a fact, and actually called the provider) and the negative case (an
Environment with no credential quarantines as `missing_validation_credential`).
Against the reintroduced bug it fails with:

```
observation attempt outcome "quarantined" (credential_unusable), want validated
— the credential gate still blocks observations
```

### Second observation: one transaction, two facts, by design

With defect 3 fixed, the Apple transaction `2000000512345671` now carries **two**
Transaction Facts — one from the notification, one from the client observation:

| Source | `renewal_expected` | Fact digest |
| --- | --- | --- |
| `apple_notification` | `true` | `d65b1306…` |
| `client_observation` | `NULL` | `cc06f6a9…` |

They differ in exactly one field. Apple's notification carries `signedRenewalInfo`
and Get Transaction Info does not, so the observation genuinely knows less.
`FactDigest` covers `renewal_expected`, so the two are different statements and
both are recorded.

This is **not** a duplication defect — duplicate *delivery* of the same
notification still produces one fact (§3 step 1.6), and replaying the same input
still produces none (§8 step 6.1). But it does mean the number of facts for a
transaction depends on how many independent routes told Mosaic about it, which an
analytics consumer in a later phase must not read as a count of purchases. It is
raised here as a design question for the 9A review — should `renewal_expected`
participate in fact identity, or should it be a projection over facts? — and
deliberately not changed, because altering `FactDigest` semantics is a
correctness decision with ledger-wide consequences and is outside the fix scope
the coordinator set.

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
    /v1/billing/server/observations`) was not exercised in either run. It shares
    the observation validation path that §9 defect 3 fixed, so it is expected to
    behave as the client endpoint now does — but expectation is not evidence, and
    it is listed here so the omission is not mistaken for a pass.
12. **A replay whose provider answer changed** was not shown by the driver: the
    Apple stub returns a fixed transaction, so the demonstration can only exhibit
    the `identical` branch. The `new_facts` branch is covered by
    `TestReplayAppendsAttemptAndComparesAgainstRecordedFacts` against a mutated
    Play response (§9 defect 1), not by this document.
13. **The `missing_validation_credential` quarantine** does not appear in the
    demonstration, because the demo tenant always has a credential. It is covered
    by the negative half of
    `TestObservationValidatesAgainstEnvironmentScopedCredential`.
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
=== demonstration complete in 37.046s ===
```

One command, no manual steps, 37 seconds — of which roughly 26 seconds is the
real retry backoff wait in §6. (The pre-fix run took 26.965 s; the post-fix run
is longer because replay and Google reconciliation now do real work instead of
returning immediately.)

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

### Checks run (post-fix)

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `gofmt -l .` (apps/api) | clean |
| Static analysis | `go vet ./...` | clean |
| Build | `go build ./...` | ok |
| Full test suite | `go test -p 1 -count=1 ./...` with `DATABASE_TEST_URL` on a fresh `postgres:17` | all packages ok, 0 failures |
| Defect tests fail against the reintroduced bugs | each defect re-added in turn, single test run | all three fail with the messages quoted in §9 |
| Migrations up | `go run ./cmd/migrate up` on empty `postgres:17` | 26/26 applied |
| Migration 00026 rollback | `migrate down-to 25` with a `missing_validation_credential` row present, then `up` | the quarantine record and its action are removed, the Raw Billing Input survives, re-applies cleanly |
| Migrations full down/up | `migrate up` → `down-to 0 --confirm` → `up` on a **clean** database | rolled back to 0 and re-applied, `verdict: compatible` |
| Preflight | `go run ./cmd/migrate preflight` | `verdict: compatible`, not dirty |
| Demonstration | `go run ./cmd/billingdemo` on a fresh container | exit 0, 37.046 s |

One honest caveat on the full down/up: run against the **demonstration** database
it fails at migration 8 with
`check constraint "provider_product_mappings_scope_shape_check" is violated by
some row`. That is migration 8's own down path reacting to connection-less
Provider Product Mappings the demo seeds, not a regression from 00026 — the same
rollback succeeds on a clean database, and 00026's own down/up was verified
separately with a real row present. It is recorded here rather than omitted.

### Cleanup

The `mosaic-9a-demo`, `mosaic-9a-test`, `mosaic-9a-fix`, and `mosaic-9a-clean`
containers and their volumes were removed after the runs. Port 55441 was avoided
because an unrelated local process already held it; 55447, 55449, 55450, and
55451 were used instead.

---

## 12. Stage 4 verdict

**All six demonstrations pass**, against synthetic vectors and local provider
stubs, with every synthetic element classified in §2 and every live-store gap
recorded in §10.

| # | Demonstration | Verdict |
| --- | --- | --- |
| 1 | Apple: credential encrypted at rest → intake token → observation → signed notification → verify → persist → 2xx → worker → fact → resolution → duplicate idempotency | pass |
| 2 | Google: credential → RTDN via pull consumer → authoritative Play lookup → validate → resolve → fact → duplicate idempotency | pass |
| 3 | Quarantine: authentic transaction, unmapped Product → verified → resolution fails → quarantine → repair mapping → re-run → fact; original input and attempt history preserved | pass |
| 4 | Retry: provider 503 → retryable attempt → recovery → success; failed attempt preserved (real 26 s wall-clock wait, no clock mocking) | pass |
| 5 | Reconciliation: omitted notification → discovered → ingested idempotently → validated → resolved → run summary; `google_token_requery` re-queries for real | pass |
| 6 | Replay: new Validation Attempt appended, prior attempts and facts preserved, comparison computed, no fact duplicated | pass |
| — | No customer-access, entitlement, or subscription state exists anywhere | pass |

The three defects the first run found (§9) were all in application-service
wiring — not in the schema, the frozen contract, the security boundary, or the
product resolver, which are the parts that would have been expensive to get
wrong. All three are fixed, each is pinned by a test that fails against the
reintroduced bug, and the demonstration has been re-run end to end on a fresh
container.

**Two things this document does not establish, and which the 9A review still
owns:**

1. **Nothing here proves Mosaic works against a real store.** §10 lists eleven
   specific gaps. The most consequential is that the JWS verifier has never seen
   an authentic Apple signature. Live-sandbox confirmation of
   credential → purchase → notification → validation → fact remains an operator
   follow-up before GA.
2. **One transaction can carry more than one fact** when Mosaic learns about it
   by more than one route (§9, "Second observation"). That is deliberate under
   the current `FactDigest` definition, but it is a design decision a later phase
   will consume, and it should be confirmed explicitly rather than inherited.

Fix commit pending: the changes described in §9 are uncommitted at the time of
writing.
