# Phase 9B Stage 4 — Integrated demonstration evidence

Operator: mosaic-backend agent
Date: 2026-07-29
Branch: `phase/9b-subscription-state-entitlements`
Specification: `docs/plans/phase-9b-subscription-state-authoritative-entitlements.md` §19
(fourteen demonstrations, one-minute demonstration), §2 owner decisions,
orchestration prompt "Stage 4: Integrated Demonstration".

**Honesty rule applied throughout.** Every claim below is backed by an HTTP
response, a SQL result, or a signature check produced by the run recorded here.
Where a demonstration produced a result the plan did not intend, the actual
result is recorded and the defect is named. §9 lists **five defects, three of
them release-blocking**. Nothing is paraphrased into a stronger statement than
the output supports. No secret value appears in this document: the Apple intake
token, API key secrets, the webhook signing secret, and the Customer Access
Token are redacted at the point they are printed.

**No live store was reachable.** There is no App Store Connect account, no
Sandbox Apple Account, no Play Console application, and no Google Cloud project
in this environment. Phase 9A's accepted synthetic signed-vector precedent
applies (`docs/reviews/phase-9a-demo-evidence.md` §2). §2 below classifies every
synthetic element and §10 states exactly what only a live sandbox can prove.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Host | Apple Silicon macOS (Darwin 25.5.0), `arm64` |
| Go toolchain | go1.26.5 darwin/arm64 |
| PostgreSQL | `postgres:17-alpine` (Docker, container `mosaic-9b-demo-pg`, published port 5439) |
| Migrations | `go run ./cmd/migrate up` → 48/48 applied to an empty database; `migrate preflight` verdict `compatible` |
| Demo driver | `apps/api/cmd/billingdemo` (extended; new files `demo9b.go`, `demo9b_seed.go`, `demo9b_stubs.go`, `demo9b_vectors.go`, `demo9b_helpers.go`) |
| Run command | `DATABASE_URL=postgres://… go run -tags billingdemo ./cmd/billingdemo -phase 9b` |
| One-minute command | `DATABASE_URL=postgres://… go run -tags billingdemo ./cmd/billingdemo -phase oneminute` |
| Build tag | `//go:build billingdemo` on every file. `go list ./cmd/billingdemo` without the tag reports *"build constraints exclude all Go files"*. |
| Wall-clock | **34.0 s** and **48.6 s** for the two recorded consecutive full runs. The spread is one jittered webhook retry wait (23 s vs 37 s of real elapsed time); everything else is identical. |
| One-minute wall-clock | **1.042 s** |
| Tenant | `org_demo9b` / `proj_demo9b` / `env_demo9b` (mode `production`); application `app_demo9b_ios` (`com.mosaic.demo9b`) |
| Data | Created by this run only. No production data exists or was used. |

The driver is destructive to the tenant it owns (`proj_demo9b`) and touches
nothing else. It mints fresh identifiers each run, so the `bcu_…`, `bpl_…`,
`ces_…`, and `whe_…` values quoted below are from the recorded run.

---

## 2. What is real, and what is synthetic

Read this section before any evidence below.

### Real — exercised exactly as it would be in production

| Component | Evidence it was the real thing |
| --- | --- |
| PostgreSQL schema, every constraint, every append-only trigger | 48/48 migrations against an empty database; every write below went through them. The append-only triggers are disabled **only** for the pre-run tenant reset and are in place for the whole demonstration. |
| chi router with the full middleware stack | built by `httpserver.NewWithDependencies` and mounted on `httptest.NewServer` |
| Every Phase 9A and Phase 9B HTTP handler and its ozzo validation | every HTTP line below is a real handler response |
| Phase 9A intake, validation, product resolution, fact digests, ledger | demonstrations 1–13 all begin at `POST /v1/billing/apple/notifications/{intakeToken}` |
| `appstorejws` verifier — chain, `x5c`, ES256, `signedDate` window | §9 defect D-0 was found by it rejecting back-dated payloads |
| `appstoreserver.Client` (App Store Server API, ES256 request JWT) | the Apple stub's call log shows the real client's request paths |
| `billingcustomer` identity service, association resolver, conflict machinery | demonstration 12 |
| `billingprojection` ordering, subscription engine, one-time engine, grant selection, entitlement aggregation, checksums, checkpoints, replay | demonstrations 1–14 |
| `billinggrant` publish, immutability refusal, interval closure | stage 0 |
| `billingaccess` token issuance, SDK sync, trusted reads | demonstrations 1, 10, 11 |
| `billingwebhook` signing, SSRF policy, fan-out, delivery, retry, auto-disable | demonstrations 1, 13 |
| `billingrestore` submit and status surfaces, and `ProcessNextRestoreSync` | demonstration 10 (where it failed — §9 D-2) |
| `billingdiagnostics` replay and projection health | demonstration 14 |
| The worker job entry points `cmd/worker` schedules | `ProcessNextValidation`, `ProcessNextProjection`, `ProcessNextDelivery`, `ProcessNextRestoreSync` all invoked by name |
| **TLS on webhook delivery** | Not relaxed. The delivery policy is HTTPS-only, builds its own transport, sets no `InsecureSkipVerify`, and performs a real certificate verification. See the classification of the trust anchor below. |

### Synthetic — classified, with the reason it could not be otherwise

| Element | Classification | Why |
| --- | --- | --- |
| **Apple JWS signing chain** | **SYNTHETIC.** A three-certificate ECDSA P-256 chain generated per run carrying Apple's App Store extension OID `1.2.840.113635.100.6.2.1` on the intermediate, injected through `appstorejws.NewVerifier(appstorejws.WithRoot(…))` — the package's own documented option. Its validity window is widened to three years back (`demoChainBackdate`) because the verifier validates the chain **as of the payload's `signedDate`**, and these demonstrations replay months of subscription history. | Apple's signing key is not obtainable. **This proves the verifier accepts a chain it was told to trust; it does not prove Mosaic accepts Apple's real chain.** |
| **App Store Server API responses** | **LOCAL STUB.** `httptest` server speaking `/inApps/v1/transactions/{id}`. Mosaic's real client calls it and re-verifies the JWS it returns. | No Apple account. |
| **Credential material** | **SYNTHETIC.** A locally generated PKCS#8 P-256 key stands in for an Apple `.p8`. | Same reason. |
| **Webhook destination** | **LOCAL STUB** — an `httptest` TLS server on `127.0.0.1` standing in for a tenant's application backend. It verifies `Mosaic-Signature` with an **independent** implementation of the published rules (`packages/test-fixtures/src/webhook-signature-vectors.json`), deliberately not by calling `billingwebhook.Sign`: a verifier that reuses the producer's own function proves only that the function agrees with itself. |
| **Webhook TLS trust anchor** | **SYNTHETIC ROOT, real verification.** A CA and a leaf for `127.0.0.1` are minted per run and installed with `x509.SetFallbackRoots`, honoured because `demo9b_stubs.go` carries `//go:debug x509usefallbackroots=1`. That directive is the single strongest reason this driver must never be reachable from a release build, and it is why the file is build-tagged. Certificate verification, hostname/IP SAN matching, redirect refusal, resolve-and-pin, and the reserved-address screen all run unmodified. |
| **Webhook SSRF allowlist** | **CONFIGURATION, not a substitution.** `billingwebhook.WithSelfHostedAllowlist(true)` is the existing deployment flag (`MOSAIC_BILLING_WEBHOOK_ALLOW_PRIVATE_DESTINATIONS`) that permits a private destination address. HTTPS is still mandatory; the flag does not remove transport security. |
| **Dashboard principal resolver** | **SUBSTITUTED.** `authn.ResolverFunc` returning a fixed actor from an `X-Demo-Actor` header instead of validating a browser session cookie. **Authorization is not substituted:** owner/admin membership is still enforced by the real repository SQL against a real `organization_members` row. |
| **SDK clients** | **WIRE-LEVEL SIMULATION, classified.** The driver sends the ratified `entitlementSyncRequest` envelope and reads the response, which is exactly the wire the Flutter, iOS, and Android SDKs consume. It does **not** run those SDKs. Their decoders, acceptance gates, caches, and cache-state machines are proven by their own conformance suites against the shared fixtures; this driver re-runs none of them and claims nothing about them. Demonstration 11 is therefore explicitly a **wire-level** offline-cache demonstration. |
| **Time** | **DRIVEN BY EFFECTIVE TIMESTAMPS.** No clock is manipulated and nothing sleeps waiting for a period to elapse. Every state transition below is caused by a provider-stated effective time inside a signed payload — `purchaseDate`, `expiresDate`, `revocationDate`, `gracePeriodExpiresDate`, `signedDate` — expressed as an offset from one scenario baseline `T`. The **only** real waits in the run are the webhook retry backoffs in demonstration 13 (23–37 s), which are deliberately real. |
| **The 9A→9B bridge** | **SUBSTITUTION, and the most important line in this document.** Nothing in `cmd/api` or `cmd/worker` creates a `purchase_lineages` row, a `subscription_instances` row, a `one_time_purchase_instances` row, or a lineage→customer association. The driver performs that step itself, in the open, printing `SUBSTITUTION bridge:` every time. See §9 defect **D-1**. |
| **The customer-scoped reprojection** | **WORKAROUND, from demonstration 5 onward.** Every demonstration after 5 finishes with a direct `billingprojection.Service.Project` call on a customer-only scope, because the queued path drops sources. See §9 defect **D-4**. |

### Process shape

The demonstration runs the real router on `httptest.NewServer` inside one
process and calls the worker job functions directly, rather than running
`cmd/api` and `cmd/worker`. The reason is the Apple root, exactly as in Phase
9A: both binaries call `appstorejws.NewVerifier()` with no options and pin
Apple's embedded root, so a separate API process could never verify the
synthetic chain. Everything between the socket and the database is identical to
the deployed path — **except** that the operator surface is mounted on a second
mux, because the deployed composition cannot start at all (§9 defect **D-3**).

---

## 3. Stage 0 — tenant, grant versions, destination, signature vectors

Seeded: organization, owner membership, project, production environment, one iOS
application, three Products (`pro-monthly` subscription, `pro-yearly`
subscription, `pro-lifetime` one-time non-consumable), one Entitlement
(`ent_demo9b_pro`, key `pro`), three provider Product mappings, one public SDK
key, one secret server key. **Nothing under `billing_*`, `purchase_lineages`,
`subscription_*`, `customer_entitlement_*`, `product_entitlement_grant_versions`,
or `webhook_*` is seeded** — every one of those rows below was produced during
the run by a handler, a service, or a worker job.

```text
HTTP PUT /v1/projects/{projectId}/billing/settings -> 200
{"data":{"billingEnabled":true}}
```

Three grant versions published through `POST /v1/projects/{projectId}/billing/grant-versions`:

```text
SQL: published grant versions (immutable, one open interval per pair)
  product_id         | version | grant_policy_version | grants_in_active | grants_in_trial | grants_in_grace | grants_in_billing_retry | grants_in_one_time_ownership | supported_purchase_types        | open
  -------------------+---------+----------------------+------------------+-----------------+-----------------+-------------------------+------------------------------+---------------------------------+-----
  prd_demo9b_lifetime| 1       | 1                    | true             | true            | true            | false                   | true                         | [non_consumable]                | true
  prd_demo9b_monthly | 1       | 1                    | true             | true            | true            | false                   | true                         | [auto_renewable_subscription]   | true
  prd_demo9b_yearly  | 1       | 1                    | true             | true            | true            | false                   | true                         | [auto_renewable_subscription]   | true
```

An in-place edit of a published version is refused with a specific code, not a
bare 405:

```text
HTTP PATCH /v1/projects/{projectId}/billing/grant-versions/{versionId} -> 409
{"error":{"code":"grant_version_immutable","message":"A published grant version cannot be edited. Publish a superseding version instead."}}
```

A prospective grant version must take effect now or later — a back-dated
`effectiveStart` without `retroactive: true` is refused (`422
validation_failed`). That was observed during driver development and is the
accepted OD-8 policy; the driver publishes prospectively and relies on the
documented backfill rule that a purchase predating every recorded version
selects the earliest one, which is what demonstrations 1–14 depend on.

Webhook destination registered (secret redacted; it is returned exactly once and
Mosaic keeps only the sealed form):

```text
HTTP POST .../billing/webhook-destinations -> 201
{"data":{"destination":{"id":"whd_…","url":"https://127.0.0.1:PORT/mosaic/webhooks","status":"active",
 "eventTypes":["customer.entitlements.changed"],"consecutiveFailureCount":0},"secret":"<REDACTED>","secretId":"whs_…"}}
```

Mosaic's signing function checked against the published cross-implementation
vectors (`packages/test-fixtures/src/webhook-signature-vectors.json`):

```text
note: vector canonical-event-primary-key      produced==published: true
note: vector canonical-event-rotation-key     produced==published: true
note: vector tampered-body-must-not-verify    produced==published: true
note: vector different-event-id-must-not-verify produced==published: true
note: vector different-timestamp-must-not-verify produced==published: true
note: vector minimal-body                     produced==published: true
note: vector non-ascii-body                   produced==published: true
note: vector non-ascii-secret                 produced==published: true
```

All eight published vectors agree, including the rotation key, non-ASCII bodies,
and a non-ASCII secret. The "must-not-verify" vectors are must-not-verify **for
the canonical body**;
the assertion here is that Mosaic reproduces the signature the vector file
publishes for the body the vector carries, which is what makes the negative
vectors usable by an SDK.

---

## 4. Demonstrations 1–4 — the subscription lifecycle

Scenario clock: baseline `T`. Initial period `[T-25d, T+5d]`; renewal period
`[T-3h, T+30d]`; cancellation effective `T-2h`; expiration effective `T-1h`.

### Demonstration 1 — initial subscription — **PASS**

1. **Billing Customer created** through the trusted identity API
   (`POST /v1/billing/identity/customers`, secret server key) → `201`,
   `bcu_…`, `status: active`, `currentProjectionVersion: 0`.
2. **Customer Access Token issued** (`POST /v1/billing/server/customer-tokens`,
   Customer Access Token Contract v1 envelope) → `201`. The token value is
   redacted in this document. Stored form:

   ```text
   SQL: the token is stored as a digest, never as a value
     audience | scopes                                | digest_bytes | bounded | live | ttl_seconds
     ---------+---------------------------------------+--------------+---------+------+------------
     sdk_sync | [entitlements.read entitlements.sync] | 32           | true    | true | 3600
   ```

3. **Validated Apple purchase** — synthetic signed `SUBSCRIBED`/`INITIAL_BUY`
   notification through the real intake endpoint (`202`), then the real
   validation worker, which re-read the transaction from the App Store Server
   API stub and re-verified its JWS:

   ```text
   SQL: the validated Transaction Fact
     fact_kind        | transaction_type            | resolution_state | mosaic_product_id  | period_start_at | period_end_at | renewal_expected | validator_version
     -----------------+-----------------------------+------------------+--------------------+-----------------+---------------+------------------+------------------
     initial_purchase | auto_renewable_subscription | active_mapping   | prd_demo9b_monthly | T-25d           | T+5d          | true             | 2
   ```

4. **Association via submission-context evidence** — the driver's bridge
   (SUBSTITUTION, §9 D-1) locates the lineage and runs the real association
   resolver with a `trusted_server_observation`:

   ```text
   SQL: purchase lineage and its association evidence
     provider  | lineage_type | projection_frozen | diagnostic_status | attached_to_customer | evidence
     ----------+--------------+-------------------+-------------------+----------------------+------------------------------------
     app_store | subscription | false             | none              | true                 | trusted_server_observation/resolved
   ```

5–7. **Subscription Snapshot, grant version applied, Customer Entitlement Snapshot:**

```text
SQL: current Subscription Snapshot
  projection_version | access_state | lifecycle_state | renewal_intent     | billing_state | uncertainty_reason | period_start_at | period_end_at | current_product_id
  -------------------+--------------+-----------------+--------------------+---------------+--------------------+-----------------+---------------+-------------------
  1                  | active       | active          | auto_renew_enabled | current       | none               | T-25d           | T+5d          | prd_demo9b_monthly

SQL: current Customer Entitlement Snapshot and its entries
  snapshot_version | change_reason        | entitlement_key | state  | end_known | source_count | uncertainty_reason | explanation_code
  -----------------+----------------------+-----------------+--------+-----------+--------------+--------------------+--------------------
  1                | entitlements_changed | pro             | active | true      | 1            | none               | subscription_active

SQL: the Entitlement Source names (lineage, product, grant version) — never a fact id
  source_type         | source_state | explanation_code    | is_test_source | has_grant_version | from_subscription
  --------------------+--------------+---------------------+----------------+-------------------+------------------
  active_subscription | active       | subscription_active | false          | true              | true
```

8. **Trusted server API** — `GET /v1/billing/server/customers/{id}/entitlements`
   → `200`, raw Authoritative Entitlement v1 record, `state: active`,
   `primaryExplanation.code: active_subscription_period`, `sourceCount: 1`,
   `projectionStatus.state: current`.

9. **SDK sync wire** — `POST /v1/sdk/billing/entitlements` with
   `recordType: entitlementSyncRequest`, `Authorization: Bearer mcat_…`,
   `Mosaic-SDK-Key: …` → `200`, the same `snapshotVersion: 1`, the same
   `entityTag`, the same single granting source, plus:

   ```text
   note: freshness headers: refresh-after=T+1h valid-until=T+7d stale-grace-seconds=86400 etag="ces.…"
   ```

   Classification: this is the wire the three SDKs consume. Their own
   conformance suites prove the client behaviour; this driver does not re-run
   them.

10. **Active entitlement with source explanation** — shown above.
11. **Signed webhook delivered**:

    ```text
    note: destination received event whe_… (answered 204); signature verified against key 0: true
    SQL: delivery outcomes recorded by Mosaic
      status    | attempt_count | outcome   | response_status
      ----------+---------------+-----------+----------------
      succeeded | 1             | delivered | 204
    ```

### Demonstration 2 — renewal — **PASS**

```text
note: prior snapshot version 1, prior effective end T+5d

SQL: current Subscription Snapshot
  projection_version | access_state | lifecycle_state | renewal_intent     | billing_state | period_start_at | period_end_at
  -------------------+--------------+-----------------+--------------------+---------------+-----------------+--------------
  2                  | active       | active          | auto_renew_enabled | current       | T-3h            | T+30d

SQL: prior Subscription Snapshots are preserved, never rewritten
  projection_version | access_state | lifecycle_state | period_end_at | is_current
  -------------------+--------------+-----------------+---------------+-----------
  1                  | active       | active          | T+5d          | false
  2                  | active       | active          | T+30d         | true
```

Effective end extended `T+5d → T+30d`; the prior snapshot row is intact;
`subscription_snapshots` carries an append-only trigger.

Webhook policy: the renewal changed **which period** the customer is in but not
**which Entitlements** they hold, so the customer aggregate was a no-change
projection — no customer snapshot minted, no version advance, and no
`customer.entitlements.changed` event. That is the accepted policy (plan §9) and
is the reason an SDK cache is not churned by every renewal.

### Demonstration 3 — cancellation without immediate revocation — **PASS**

```text
SQL: renewal intent is off, access is still active, and the scheduled expiration is visible
  access_state | renewal_intent      | billing_state | cancellation_effective_at | scheduled_expiration
  -------------+---------------------+---------------+---------------------------+---------------------
  active       | auto_renew_disabled | current       | T-2h                      | T+30d
```

`billing_state` is `current`, not `failed`: the subscription is ending because
the customer chose to, which is the distinction plan §6 requires. The Customer
Entitlement Snapshot did not change and no access-change webhook was emitted —
the event vocabulary is deliberately about access, not about provider intent.

### Demonstration 4 — expiration — **PASS**

Driven by the provider's `expiresDate: T-1h`; no wall-clock wait.

```text
SQL: current Subscription Snapshot
  access_state | lifecycle_state | renewal_intent      | billing_state | period_end_at | expiration_effective_at
  -------------+-----------------+---------------------+---------------+---------------+------------------------
  inactive     | expired         | auto_renew_disabled | current       | T-1h          | T-1h

SQL: current Customer Entitlement Snapshot and its entries
  snapshot_version | change_reason        | entitlement_key | state    | source_count | explanation_code
  -----------------+----------------------+-----------------+----------+--------------+-----------------
  3                | entitlements_changed | pro             | inactive | 1            | no_active_source

SQL: the subscription Entitlement Source is no longer granting
  source_type         | source_state | explanation_code     | source_end
  --------------------+--------------+----------------------+-----------
  active_subscription | inactive     | subscription_expired | T-1h
```

Access-change webhook delivered and signature-verified; the SDK wire returned
`state: inactive`, `primaryExplanation.code: no_qualifying_source`.

---

## 5. Demonstrations 5–9 — sources, refunds, grace, ordering, upgrade

### Demonstration 5 — multiple sources — **FAIL on the queued path (defect D-4); PASS on the projection engine**

Step 1 adds a resubscribe (`[T-30m, T+30d]`) and a lifetime one-time purchase,
both granting `pro`. Three sources, entitlement active via the permanent source:

```text
snapshot_version 4 | pro | active | source_count 3 | explanation_code permanent_source_active
  active_subscription     | inactive | subscription_expired    | T-3h  → T-1h
  active_subscription     | active   | subscription_active     | T-30m → T+30d
  one_time_non_consumable | active   | one_time_purchase_owned | T-20m → (none)
```

Step 2 expires the resubscribe. **This is where the demonstration failed.** What
a deployed worker produces:

```text
snapshot_version 5 | pro | inactive | source_count 1 | explanation_code no_active_source
  active_subscription | inactive | subscription_expired | T-30m → T-10m
```

The lifetime source and the earlier subscription source are gone from the
customer aggregate, and `pro` reads `inactive` while a valid, unrefunded
lifetime purchase is recorded and its instance still reads `validity_state:
owned`. Nothing revoked it.

Step 3 runs the identical projection command with **no lineage restriction**:

```text
snapshot_version 6 | pro | active | source_count 3 | explanation_code permanent_source_active
  active_subscription     | inactive | subscription_expired    | T-3h  → T-1h
  active_subscription     | inactive | subscription_expired    | T-30m → T-10m
  one_time_non_consumable | active   | one_time_purchase_owned | T-20m → (none)

SQL: the job the worker actually ran, and what it was scoped to
  kind           | scope_key      | lineage_in_detail | status
  ---------------+----------------+-------------------+----------
  fact_committed | customer:bcu_… | bpl_…             | completed
  fact_committed | customer:bcu_… |                   | completed
  fact_committed | customer:bcu_… | bpl_…             | completed
```

The projection engine is correct. The job scoping is not. Full analysis: §9 D-4.

With the workaround applied, the demonstration's acceptance point holds: the
Entitlement remains active through the lifetime source after the subscription
expires, and both source histories remain inspectable.

### Demonstration 6 — refund or revocation — **PASS**

An Apple `REFUND` with `revocationDate: T-5m` on the lifetime lineage only:

```text
SQL: the refunded source, and the unrelated sources beside it
  lineage_type | state    | refund_effective_at | revocation_effective_at
  -------------+----------+---------------------+------------------------
  subscription | inactive | -                   | -
  subscription | inactive | -                   | -
  one_time     | refunded | T-5m                | -

SQL: history is intact: every fact for the refunded lineage is still recorded
  fact_kind         | occurred_at | refunded_at | revoked_at | refund_type
  ------------------+-------------+-------------+------------+------------
  one_time_purchase | T-20m       | NULL        | NULL       | -
  refund            | T-20m       | T-5m        | T-5m       | -
```

The two subscription lineages are untouched. The Entitlement went `inactive`,
the change was delivered as a signed webhook, and the SDK wire reported
`state: inactive`. Note that Apple's `revocationDate` populates **both**
`revoked_at` and `refunded_at` — that is the 9A normalization decision, and it
is what makes the refund invalidating (`refundInvalidates` requires
`revoked_at`).

### Demonstration 7 — grace and recovery — **PASS**

Apple emits no grace notification; grace arrives as `DID_FAIL_TO_RENEW` carrying
`gracePeriodExpiresDate` in the renewal info. Period `[T-40d, T-10d]`, grace end
`T+5d`:

```text
SQL: grace is active, access is granted by the approved policy, and the grace end is recorded
  access_state | lifecycle_state | billing_state | grace_period_end_at
  -------------+-----------------+---------------+--------------------
  active       | grace_period    | grace         | T+5d

snapshot_version 6 | pro | active | source_count 4 | explanation_code verified_grace_period
```

Recovery (`DID_RENEW`, new period `[T-2m, T+28d]`):

```text
  access_state | lifecycle_state | billing_state | grace_period_end_at | period_end_at
  -------------+-----------------+---------------+---------------------+--------------
  active       | active          | current       | NULL                | T+28d

SQL: Subscription Timeline (append-only)
  entry_type            | effective_at | explanation_code           | rule_version
  ----------------------+--------------+----------------------------+-------------
  purchase_validated    | T-40d        | initial_purchase_validated | 1
  billing_retry_started | T-10d        | billing_retry_started      | 1
  renewal_validated     | T-2m         | renewal_validated          | 1
```

The timeline is preserved across the recovery; nothing was rewritten.

### Demonstration 8 — out-of-order fact — **PASS**

Lineage projected with `SUBSCRIBED [T-60d, T-30d]` then `DID_RENEW [T-30d, T+30d]`:

```text
SQL: checkpoint before the late fact
  high_watermark                                    | facts_projected | valid | checksum
  v1|…|030|3000000900000013!…|btf_…                 | 2               | true  | 154027…ca52
```

A late `EXPIRED` for the earlier period arrives with effective time `T-45d`,
strictly before the watermark:

```text
SQL: the checkpoint was invalidated and the lineage was reprojected from zero
  high_watermark                                    | facts_projected | invalidated | checksum
  v1|…|030|3000000900000013!…|btf_…                 | 3               | true        | 154027…ca52

SQL: every Subscription Snapshot for this lineage — priors are preserved
  projection_version | access_state | lifecycle_state | period_start_at | period_end_at | is_current
  -------------------+--------------+-----------------+-----------------+---------------+-----------
  1                  | active       | active          | T-30d           | T+30d         | true
```

The out-of-order fact was detected, the checkpoint was invalidated, and the
lineage was reprojected from zero over three facts. The renewal at `T-30d` still
sorts last in canonical order, so the deterministic result is **byte-identical**
to the pre-invalidation snapshot: the checksum did not move and no new snapshot
was minted. Expected access — active — is confirmed. This is the strongest form
of the determinism claim: the checkpoint is an optimization and never a source
of truth.

Minor observation (not a defect, recorded for the reviewer): the checkpoint's
`invalidated` flag remains `true` after the successful reprojection. It reads as
a historical marker rather than a live state, but nothing clears it, so a
projection-health surface that ever counted "invalidated checkpoints" would
count it forever.

### Demonstration 9 — upgrade with supersession — **PASS**

Monthly `[T-20d, T+10d]`, then `DID_CHANGE_RENEWAL_PREF`/`UPGRADE` to yearly
with `isUpgraded: true` and period `[T-1m, T+365d]`:

```text
SQL: the new Product is current, the prior Product is preserved on the snapshot
  current_product_id | prior_product_id   | access_state | period_start_at | period_end_at | scheduled_product_identifier
  -------------------+--------------------+--------------+-----------------+---------------+-----------------------------
  prd_demo9b_yearly  | prd_demo9b_monthly | active       | T-1m            | T+365d        | com.mosaic.demo9b.pro.yearly

SQL: exactly one Entitlement Source per (lineage, entitlement, grant version) — no double grant
  purchase_lineage_id | entitlement_id | grant_version_id | sources
  --------------------+----------------+------------------+--------
  bpl_…               | ent_demo9b_pro | pegv_…           | 1

SQL: Subscription Timeline (append-only)
  entry_type         | effective_at | explanation_code           | rule_version
  -------------------+--------------+----------------------------+-------------
  purchase_validated | T-20d        | initial_purchase_validated | 1
  product_upgraded   | T-1m         | provider_reported_upgrade  | 1
```

The new Product's grants take effect at the transition's effective time; the old
Product's history is preserved on the snapshot and in `billing_product_resolutions`
(both provider Products resolved, mapping version recorded); the
`(snapshot, lineage, entitlement, grant version)` uniqueness makes a double
grant structurally impossible, and the count confirms one source.

---

## 6. Demonstrations 10–12 — restore, cache, identity

### Demonstration 10 — restore across devices — **FAIL (defect D-2)**

Device A submits a client observation → validated → projected → snapshot
version 9. Device B syncs the same customer and reads the same
`snapshotVersion: 9` and the same `ETag`.

Device C submits a **duplicate** observation for the same transaction, and
duplicate-safe validation holds:

```text
SQL: duplicate-safe validation: one fact for the restored transaction, however many devices submit it
  provider_transaction_id | facts | digests
  ------------------------+-------+--------
  3000000900000017        | 1     | 1
```

The restore request is accepted:

```text
HTTP POST /v1/sdk/billing/restores (device C) -> 202
{"recordType":"restoreResult","payload":{"outcome":"validation_pending","pendingValidationCount":2,
 "observedTransactionCount":2,"uncertainty":{"reason":"missing_fact","expectedResolution":"next_provider_notification"}}}
```

The restore then **never settles**:

```text
note: ProcessNextRestoreSync attempt 1 processed=true
note: ProcessNextRestoreSync attempt 2 processed=false
note: ProcessNextRestoreSync attempt 3 processed=false
note: ProcessNextRestoreSync attempt 4 processed=true
note: ProcessNextRestoreSync attempt 5 processed=false

PROBE: billingrestorepostgres stage-3 identity chain read (repository.go)
  FAILED: ERROR: column f.purchase_lineage_id does not exist (SQLSTATE 42703)
PROBE: billing_transaction_facts has no such column
  0

SQL: restore job state
  status | attempt_count | outcome | uncertainty_reason | observed_transaction_count | baseline_snapshot_version
  -------+---------------+---------+--------------------+----------------------------+--------------------------
  queued | 2             | -       | none               | 2                          | NULL
```

The job burns attempts and reports `validation_pending` forever. Analysis: §9 D-2.

### Demonstration 11 — offline cache, at the wire level — **PARTIAL (defect D-5)**

Classification restated in the transcript: client-side cache states are proven
by the three SDK conformance suites; this demonstrates the wire they consume.

```text
note: issuedAt=T+0 refreshAfter=T+1h validUntil=T+7d staleGraceSeconds=86400
note: contentDigest=sha256:… (the integrity value every SDK recomputes before accepting a snapshot)
note: headers carry the same window so a bodyless answer still slides it: T+1h / T+7d / 86400
```

Bounds are consistent with the OD-5 policy (refresh after 1 h, valid until 7 d,
24 h stale grace) and `refreshAfter < validUntil`.

The `snapshotUnchanged` slide works on the ratified POST form:

```text
HTTP POST /v1/sdk/billing/entitlements (knownSnapshotVersion set) -> 200
{"recordType":"snapshotUnchanged","payload":{"snapshotVersion":9,"entityTag":"ces.…",
 "issuedAt":"…","refreshAfter":"…","validUntil":"…","staleGraceSeconds":86400,
 "projectionStatus":{"state":"current"}}}
```

A stale `knownSnapshotVersion: 1` is answered with the **current** snapshot,
never the older one — the monotonicity property SDK caches depend on.

The conditional GET did **not** return 304:

```text
HTTP GET /v1/sdk/billing/entitlements (If-None-Match) -> 200
note: DEFECT D-5 — the documented 304 path is unreachable.
```

Analysis: §9 D-5.

### Demonstration 12 — identity conflict — **PASS**

Billing Customer B created. A lineage is associated with Customer A. Conflicting
trusted evidence then names Customer B:

```text
note: resolver outcome=conflicting customer=bcu_A conflictWith=bcu_B diagnostic=reassignment_requires_operator_resolution

SQL: the conflict is open, the lineage is frozen, and nothing was reassigned
  conflict_scope | status | diagnostic_code                           | first_is_a | second_is_b | projection_frozen | diagnostic_status | still_attached_to_a
  ---------------+--------+-------------------------------------------+------------+-------------+-------------------+-------------------+--------------------
  lineage        | open   | reassignment_requires_operator_resolution | true       | true        | true              | identity_conflict | true
```

Trusted-server evidence outranks the prior association (90 vs 70), so a naive
resolver would have moved the lineage. The reassignment downgrade refuses to:
the incumbent keeps the lineage, the challenger is recorded, a conflict is
opened, and the lineage is frozen. No double grant:

```text
SQL: no double grant: the disputed lineage appears under exactly one Billing Customer
  billing_customer_id | sources | states
  --------------------+---------+-------
  bcu_A               | 1       | 1
```

Last accepted authoritative state is preserved (pointer unchanged at version 11
for A; B has no pointer, having no purchases). Operator resolution:

```text
HTTP POST /v1/projects/{projectId}/billing/identity-conflicts/{conflictId}/resolution -> 200
{"data":{"status":"resolved","resolutionAction":"keep_existing",
 "resolutionReason":"Support ticket 4711: the store account belongs to customer A."}}

SQL: the resolution is audited with its reason and the actor who took it
  status   | resolution_action | resolved_by_actor_id | reason                                                        | projection_frozen | diagnostic_status
  ---------+-------------------+----------------------+---------------------------------------------------------------+-------------------+------------------
  resolved | assigned_first    | actor_demo9b_owner   | Support ticket 4711: the store account belongs to customer A. | false             | none
```

The lineage is unfrozen, both candidates are reprojected, and both pointers are
unchanged — which is the correct answer for `keep_existing`.

Note on the transcript: because a permanent one-time source still granted `pro`,
freezing the disputed lineage changed no Entitlement **state**, so no snapshot
was minted. That is the OD-10 requirement (preserve the last accepted state)
rather than an absence of behaviour. A frozen lineage that was the customer's
only source would instead surface as an `unknown` entry; this run did not
construct that case.

---

## 7. Demonstrations 13–14 — webhooks and replay

### Demonstration 13 — webhook retry — **PASS**

An entitlement change (a `REVOKE` on the conflict lineage) is committed while the
destination stub is configured to answer `503` once.

```text
SQL: the failed attempt is recorded and a retry is scheduled
  attempt_number | outcome           | response_status | error_code        | retry_scheduled
  ---------------+-------------------+-----------------+-------------------+----------------
  1              | retryable_failure | 503             | destination_error | true

SQL: the delivery is pending, not failed, and its state was never rolled back
  status  | attempt_count | max_attempts | scheduled_ahead
  --------+---------------+--------------+----------------
  pending | 1             | 8            | true

SQL: the entitlement state that produced the event is unchanged by the delivery failure
  snapshot_version | change_reason
  -----------------+---------------------
  10               | entitlements_changed
```

The destination recovers on its own; the driver waits for the real jittered
backoff (23–37 s across runs; no clock was manipulated):

```text
SQL: complete attempt history for the retried delivery
  attempt_number | outcome           | response_status | error_code
  ---------------+-------------------+-----------------+------------------
  1              | retryable_failure | 503             | destination_error
  2              | delivered         | 204             | -

note: event whe_… was delivered 2 times; body byte-identical across attempts: true
note: first attempt answered 503, last answered 204; signature verified each time: true/true
```

The event id is stable across attempts, the body is byte-identical (compared as
bytes by the destination stub, not re-serialized), the signature verified on both
attempts against the destination's own independent implementation, the attempt
history is complete and append-only, and the entitlement state was never rolled
back by the delivery failure.

### Demonstration 14 — replay and rule versions — **PASS**

```text
note: before the replay: 13 customer snapshots, 13 webhook events, current checksum d610155f…248f

HTTP POST .../billing/projection-replays -> 200
{"data":{"projectionRuleVersion":1,"scopesReplayed":1,"scopesChanged":0,
 "outcomes":[{"projectionScopeKey":"customer:bcu_…","comparison":"unchanged","materialized":false}]}}

note: after the replay: 13 customer snapshots, 13 webhook events, current checksum d610155f…248f
note: identical checksum: true; no new snapshot: true; no new webhook: true

SQL: the replay recorded an attempt even though it wrote no snapshot
  outcome   | error_code | rule_version | scope_key
  ----------+------------+--------------+----------------
  no_change | -          | 1            | customer:bcu_…
```

Deterministic checksum, no new snapshot, no webhook, and the attempt is still
recorded — a replay that leaves no trace would be unauditable.

An unimplemented rule version is refused cleanly:

```text
HTTP POST .../billing/projection-replays (projectionRuleVersion=2) -> 422
{"error":{"code":"validation_failed",
 "message":"The replay must be bounded and must name a rule version this build derives under."}}

SQL: one rule version exists and it is active
  version | status | description
  --------+--------+------------------------------------------------------------------------
  1       | active | Phase 9B initial projection semantics (plan §6/§7, ordering version 1)
```

**Shadow projection is deferred per OD-11(a)** and is not demonstrated. Rule
versions are recorded on every snapshot, timeline entry, and checkpoint from day
one, and replay-plus-checksum comparison ships in 9B; the diff engine waits for
a second implemented rule version to diff against. A request for one is refused
rather than silently recomputed under the active semantics, which is the
property that makes the deferral safe.

Projection health closes the run:

```text
HTTP GET .../billing/projection-health -> 200
{"data":{"billingEnabled":true,"activeProjectionRuleVersion":1,"projectionQueueDepth":0,
 "projectionFailedJobs":0,"staleCustomers":0,"neverProjectedCustomers":0,"openIdentityConflicts":0,
 "frozenLineages":0,"unresolvedLineages":0,"unknownEntitlementEntries":0,
 "restoreBacklog":1,"webhookDeliveryBacklog":0,"webhookDeliveriesExhausted":0,"activeWebhookDestinations":1}}
```

`restoreBacklog: 1` is defect D-2 showing up on an operator surface, which is at
least the system reporting its own failure honestly.

---

## 8. The one-minute demonstration — **PASS**

`-phase oneminute`, **1.042 s**:

```text
Validated purchase → authoritative Pro Entitlement
→ cancellation keeps access through period end
→ expiration removes the subscription source
→ lifetime source keeps access active
→ the SDK wire returns the same snapshot
→ signed webhook reports the change
```

Final state:

```text
snapshot_version 4 | pro | active | source_count 2 | explanation_code permanent_source_active
  active_subscription     | inactive | subscription_expired    | T-50m → T-10m
  one_time_non_consumable | active   | one_time_purchase_owned | T-20m → (none)

SDK wire: "state":"active","primaryExplanation":{"code":"permanent_one_time_purchase"},"sourceCount":2
note: destination received event whe_… (answered 204); signature verified against key 0: true
```

The prompt's one-minute script says "all three SDKs synchronize the same
Snapshot". This run demonstrates the **wire** those SDKs consume, once. It does
not run three clients, and no claim is made that it did.

---

## 9. Defects found

The demonstrations found five defects. Three are release-blocking. Finding them
is the demonstration working as intended.

None of these were fixed here: this deliverable is demo-driver-only, and fixes
go through the orchestrator.

### D-1 — the Phase 9A → 9B seam is not wired at all (**critical**)

**Symptom.** In a deployed API and worker, a validated Transaction Fact produces
no Purchase Lineage, no Subscription Instance, no customer association, and
therefore no projection, no Subscription Snapshot, no Customer Entitlement
Snapshot, no webhook, and nothing on any SDK or trusted surface. The entire
Phase 9B read model is unreachable from a purchase.

**Evidence.**

- The only `INSERT INTO purchase_lineages` in the repository is
  `apps/api/internal/platform/billingcustomerpostgres/lineages.go:57`, reached
  only through `billingcustomer.Service.LocateLineage`
  (`apps/api/internal/billingcustomer/service.go:373`). That method has **zero
  production callers** — only `service_test.go` and
  `identity_integration_test.go`.
- `billingcustomer.Service.ResolveLineageCustomer` (`service.go:238`) — the only
  path that attaches a lineage to a customer or writes
  `billing_association_evidence` — likewise has **zero production callers**.
- `billingcustomer.Service.RecordSupersession` (`service.go:403`) and
  `billingcustomer.Repository.EvidenceForReference`
  (`apps/api/internal/platform/billingcustomerpostgres/repository.go:486`) also
  have zero production callers.
- **Nothing anywhere** inserts `subscription_instances` or
  `one_time_purchase_instances` outside integration-test fixtures, and
  `billingprojectionpostgres` `loadLineages` joins to them for the instance id
  every commit needs.
- `enqueueProjectionForFact`
  (`apps/api/internal/platform/billingpostgres/jobs.go:339`) reads
  `purchase_lineages` and, per its own comment, treats a missing lineage as
  silence: `pgx.ErrNoRows → return nil`.

**Repro.** Run `cmd/api` and `cmd/worker` with billing enabled (after D-3 is
fixed), deliver a valid store notification, and observe `purchase_lineages`
stays empty, `projection_jobs` stays empty, and every entitlement surface reports
`pending`/404 forever.

**Driver stand-in.** `demo9b.go` `bridge()` performs the missing step through
the real services and prints `SUBSTITUTION bridge:` each time.

**Related design gap.** `billingcustomer.LineageKey(provider, storeEnvironment,
root)` (`apps/api/internal/billingcustomer/lineage.go:16`) digests under domain
`mosaic-billing-lineage-v1`, while `billing_transaction_facts.purchase_chain_digest`
is `billing.AppleTransactionKey` (domain `mosaic-billing-apple-transaction-v1`)
or `billing.TokenDigest` (plain SHA-256). A lineage keyed with the package's own
helper can therefore **never** join to any fact, because every fact→lineage join
in the codebase compares `purchase_chain_digest` to `lineage_key_digest`. The
driver sets the lineage key from the fact's own `purchase_chain_digest`, which is
the only value that works. Whoever wires D-1 must resolve this.

### D-2 — restore-sync reads a column that does not exist (**critical**)

**Symptom.** Every restore-sync job that reaches stage 3 fails, is silently
rescheduled with backoff, burns its twelve attempts, and never produces an
outcome. Every restore reports `validation_pending` forever.

**Location.** `apps/api/internal/platform/billingrestorepostgres/repository.go:306`:

```sql
JOIN purchase_lineages l ON l.id = f.purchase_lineage_id
```

`billing_transaction_facts` has no `purchase_lineage_id` column. No migration
adds one — `00031` adds that column to `billing_association_evidence` only. Every
other fact→lineage join in the codebase uses
`purchase_chain_digest ↔ lineage_key_digest`.

**Repro (in this run).**

```text
PROBE: billingrestorepostgres stage-3 identity chain read (repository.go)
  FAILED: ERROR: column f.purchase_lineage_id does not exist (SQLSTATE 42703)
PROBE: billing_transaction_facts has no such column
  0
```

Or directly: `SELECT 1 FROM billing_transaction_facts f JOIN purchase_lineages l
ON l.id = f.purchase_lineage_id;`

**Aggravating factor.** `ProcessNextRestoreSync` returns `(true, nil)` on a
`LoadChain` error — the job is rescheduled and the error is logged, so the
failure is invisible to the `(processed, error)` contract the worker loop reads.
`restoreFailedJobs` stays `0` on the projection-health surface while every
restore is broken; only `restoreBacklog` rises.

### D-3 — the router panics whenever billing is enabled (**critical, startup**)

**Symptom.** `cmd/api` panics during router construction whenever
`MOSAIC_BILLING_ENABLED` is set. The process never serves a request.

```text
panic: chi: attempting to Mount() a handler on an existing path, '/environments/{environmentId}/billing'
  …/transport/billingoperator.RegisterProjectRoutes(handler.go:67)
  …/platform/httpserver.NewWithDependencies(router.go:256)
  …/cmd/api/main.go
```

**Location.** Two modules mount the same chi path on the same Project subrouter:

- `apps/api/internal/transport/billing/handler.go:87` —
  `router.Route("/environments/{environmentId}/billing", …)`
- `apps/api/internal/transport/billingoperator/handler.go:67` — the same
  pattern.

`cmd/api/main.go` sets both `Billing` and `BillingOperator` under the same
`cfg.Billing.Enabled` branch, so they are always registered together.

**Worse:** the collision cannot be avoided by disabling one. `httpserver.NewWithDependencies`
gates the `/v1` subtree and the authenticated `/projects/{projectId}` subtree on
`Billing != nil` (`router.go:187`, `router.go:193`), so `BillingOperator` cannot
be registered **at all** without the module it collides with. The entire Phase 9B
dashboard operator surface — customer list, customer lookup, customer detail,
entitlements, subscriptions, timeline, manual sync, restore jobs, identity
conflicts, and conflict resolution — is unreachable in every valid composition.

**Repro.** `httpserver.NewWithDependencies(cfg, logger, Dependencies{Billing: b,
BillingOperator: o, PrincipalResolver: r})`. `router_test.go` never constructs
that combination, which is why nothing caught it.

**Driver stand-in.** The operator surface is mounted on a second minimal mux in
`wire()` with the real handler, service, repository, and authorization; only the
mux and middleware stack are the demo's. Demonstration 12's conflict resolution
runs against it.

### D-4 — a fact on one lineage recomputes the customer aggregate from that lineage alone (**critical — accidental revocation**)

**Symptom.** When a customer holds more than one purchase lineage, committing a
fact on one of them rewrites the customer's authoritative Entitlement Snapshot
using **only that lineage**. Every other Entitlement Source disappears from the
snapshot and any Entitlement that depended on them flips to `inactive`. No
refund, no revocation, no expiry — the sources are simply not loaded.

**Evidence (demonstration 5, reproduced on every run).** Before: three sources,
`pro` active via a lifetime purchase. After expiring one *subscription*: one
source, `pro` inactive, lifetime purchase still `validity_state: owned`. The
identical projection command with no lineage restriction restores all three
sources and `pro` to active.

**Mechanism.**

1. `enqueueProjectionForFact` (`billingpostgres/jobs.go:339–360`) writes
   `scope_key = "customer:" + customerID` but stores
   `detail = {"customerId": …, "lineageId": …}` with **both** populated.
2. `Job.Scope()` (`billingprojection/repository.go:224`) restores both onto
   `Scope`.
3. `loadLineages` (`billingprojectionpostgres/repository.go:209`) filters
   `AND ($4::text = '' OR l.id = $4)` — one lineage.
4. `Compute` (`billingprojection/service.go:312`) branches on
   `input.Scope.CustomerID == ""`. It is not empty, so a **full customer
   aggregate** is computed and committed from that one lineage's sources.

**Aggravating factor — the coalescer hides the fix.** The partial unique index
`projection_jobs_scope_coalesce_idx ON projection_jobs(scope_key) WHERE status =
'queued'` (migration `00039`) keys only on `scope_key`. A correct customer-wide
trigger enqueued while a lineage-restricted `fact_committed` job is queued under
the same `customer:…` key is absorbed by it and never runs. Observed directly:
`billingprojection.Service.Enqueue` with an empty `LineageID` was silently
dropped in demonstrations 5 and 12.

**Suggested direction (not applied).** Either clear `LineageID` when
`CustomerID` is present in `Job.Scope()`/`enqueueProjectionForFact`, or make
`Scope.Key()` and the coalescing index distinguish a lineage-restricted job from
a customer-wide one. The former is smaller and matches `Scope.Key()`'s existing
"customer wins" rule; the latter is what the index name implies. This is an
orchestrator decision, not a demo one.

**Driver workaround.** From demonstration 5 onward `project()` finishes with a
direct customer-scoped `Project` call, so the later demonstrations reason about
the state the engine actually derives. The engine is not being worked around; the
job scoping is.

### D-5 — the conditional GET can never return 304 (**medium**)

**Symptom.** `GET /v1/sdk/billing/entitlements` with `If-None-Match` always
returns `200` and a full snapshot. The 304 path the handler documents and the
transport implements is unreachable.

**Mechanism.** `billingaccess.Service.Sync`
(`apps/api/internal/billingaccess/sync.go:106`) requires
`request.KnownSnapshotVersion > 0 && == view.SnapshotVersion` as a precondition
of `Unchanged`. On the GET form there is no request body, so
`KnownSnapshotVersion` is always `0` and the precondition can never hold. The
transport's 304 branch (`transport/billingaccess/handler.go:337`) is dead code on
that verb.

**Impact.** Bounded: the ratified cross-SDK flow is the POST form, which works
correctly and is what all three SDKs use. The cost is that the conditional-GET
bandwidth saving the surface advertises does not exist, and any third-party
integrator following ordinary HTTP conventions gets a full snapshot every poll on
the highest-QPS authenticated surface Mosaic serves.

**Suggested direction (not applied).** Either accept `If-None-Match` alone as
sufficient on GET (dropping the monotonicity precondition for that verb, with the
entity tag already covering rule-version changes because it is derived from the
snapshot checksum), or document the GET form as non-conditional and remove the
dead branch. Contract-visible either way, so it needs the protocol owner.

### D-0 — driver bug, recorded for completeness (fixed in the driver)

The first driver run silently lost seven of eighteen notifications: they were
accepted with `202`, produced no Raw Billing Input, and collapsed into a single
hour-bucketed `signature_invalid`/`intake_attribution_failed` quarantine row.
The cause was the driver's synthetic certificate chain being valid for only 24
hours while the demonstrations sign payloads with `signedDate` values months in
the past — `appstorejws` correctly validates the chain **as of the payload's
signedDate**. Mosaic behaved correctly; the driver did not. Fixed by widening the
synthetic chain's validity (`demoChainBackdate`).

Worth noting for the reviewer regardless: an operator whose intake starts
rejecting notifications sees **one** quarantine row per credential per reason per
hour, with the notification UUIDs unrecoverable. That is the deliberate 9A
unbounded-growth control, and it is the right trade — but it means a systematic
signing failure is very hard to diagnose from the quarantine surface alone.

---

## 10. Limitations — what only a live sandbox can prove

Unchanged from the Phase 9A position (OD-12(b) makes live verification a named
blocking pre-production follow-up), plus what is specific to 9B:

1. **That Mosaic accepts Apple's real signing chain.** The synthetic chain
   proves the verifier accepts a root it was told to trust.
2. **Real provider transition semantics.** Every fact here was synthesized to a
   documented shape. Grace, billing retry, account hold, pause, refund,
   revocation, `REFUND_REVERSED`, prorated refunds, and Family Sharing were
   normalized from documentation, not observed. This is exactly the OD-12(b)
   list.
3. **Google Play end-to-end.** Phase 9A's demonstration covers Google ingestion;
   this one is Apple-only, because Apple's payload shape is the one that lets a
   driver control every effective timestamp a Phase 9B projection reads. Google's
   `occurred_at` is lineage-constant by design and its state is re-queried live,
   so a synthetic Google lifecycle would be testing the stub's state machine
   rather than Mosaic's. Google projection paths (`cancellation_scheduled`,
   `paused`, `resumed`, `grace_period_start`, `linkedPurchaseToken`
   supersession) are therefore **not demonstrated here**.
4. **The three SDK clients.** Wire-level only, as classified in §2.
5. **Real webhook receivers.** The destination is a loopback stub. Real DNS,
   real TLS chains, real intermediary behaviour, and real receiver semantics are
   not exercised.
6. **Concurrency.** Every job here was drained serially by one worker. Advisory
   lock serialization, the compare-and-swap on `current_projection_version`, and
   the coalescing index under genuine contention are covered by unit and
   integration tests, not by this demonstration.
7. **Performance.** No SLO is claimed. The only figures produced are the run
   wall-clocks in §1.

---

## 11. Reproduction, artifacts, and checks

### The driver

`apps/api/cmd/billingdemo`, extended with:

| File | Contents |
| --- | --- |
| `demo9b.go` | the fourteen demonstrations, the one-minute demonstration, the 9A→9B bridge substitution, and the projection/webhook drivers |
| `demo9b_seed.go` | the `proj_demo9b` tenant and its idempotent reset |
| `demo9b_stubs.go` | the demonstration trust anchor (`//go:debug x509usefallbackroots=1`), the webhook destination stub and its independent signature verifier, the shared-vector loader |
| `demo9b_vectors.go` | typed Apple transaction / renewal / notification vectors |
| `demo9b_helpers.go` | HTTP helpers per surface, shared reads, transcript helpers, redaction |
| `main.go` | `-phase 9a｜9b｜all｜oneminute`, the Phase 9B composition, the second operator mux (D-3) |
| `vectors.go` | `demoChainBackdate` (D-0) |

Every file carries `//go:build billingdemo`. Verified excluded from default
builds:

```text
$ go list -f '{{.GoFiles}}' ./cmd/billingdemo
package …/cmd/billingdemo: build constraints exclude all Go files in …/cmd/billingdemo
```

### Reproducing

```bash
docker run -d --name mosaic-9b-demo-pg \
  -e POSTGRES_DB=mosaic -e POSTGRES_USER=mosaic -e POSTGRES_PASSWORD=mosaic_dev \
  -p 5439:5432 postgres:17-alpine

cd apps/api
export DATABASE_URL="postgres://mosaic:mosaic_dev@127.0.0.1:5439/mosaic?sslmode=disable"
go run ./cmd/migrate up
go run -tags billingdemo ./cmd/billingdemo -phase 9b          # fourteen demonstrations
go run -tags billingdemo ./cmd/billingdemo -phase oneminute   # the one-minute demonstration
go run -tags billingdemo ./cmd/billingdemo -phase all         # 9A followed by 9B
```

**Local-DB note.** Migration `00041` is a reserved no-op. A local database
already past version 42 from an earlier branch state must be recreated rather
than migrated forward.

### Determinism

Two consecutive full runs against the same database were compared after
normalizing generated identifiers, timestamps, digests, and the ephemeral stub
port. The complete diff is:

```text
563c563
<     note: retry became available after 37s of real elapsed time; no clock was manipulated
---
>     note: retry became available after 23s of real elapsed time; no clock was manipulated
606c606
< === demonstration complete in 48.611s ===
---
> === demonstration complete in 34.024s ===
```

That is the jittered webhook retry backoff and the total wall-clock. Every one of
the other 604 transcript lines — every state, every checksum comparison, every
row count, every source set, every signature verification — is identical.

### Checks run

| Check | Result |
| --- | --- |
| `gofmt -l apps/api` | clean |
| `go build ./...` (default tags) | clean; driver excluded |
| `go vet ./...` | clean |
| `go vet -tags billingdemo ./...` | clean |
| `go test ./...` (unit) | pass |
| `DATABASE_TEST_URL=… go test -p 1 -count=1 ./internal/platform/...` (integration, incl. billing, projection, grant, operator, customer, webhook, migrations) | pass |
| `go run ./cmd/migrate up` on an empty database | 48/48 applied |
| `go run ./cmd/migrate preflight` | `verdict: compatible` |
| Full driver run, `-phase 9b` | green, twice |
| Driver run, `-phase oneminute` | green |

Note: the integration suite must be run with `-p 1`. Several packages apply the
full migration set to the same database, and running them in parallel produces
spurious `duplicate key … pg_type_typname_nsp_index` failures that are an
artifact of the harness, not of the schema.

### Cleanup

```bash
docker rm -f mosaic-9b-demo-pg mosaic-9b-it-pg
```

---

## 12. Stage 4 verdict

The fourteen demonstrations and the one-minute demonstration were executed
end-to-end against a real API surface, real application services, real worker job
functions, and real PostgreSQL, twice, deterministically.

| # | Demonstration | Verdict |
| --- | --- | --- |
| 1 | Initial subscription | PASS, through production wiring (was a bridge substitution, D-1) |
| 2 | Renewal | PASS |
| 3 | Cancellation without immediate revocation | PASS |
| 4 | Expiration | PASS |
| 5 | Multiple sources | **FAIL** on the queued path (D-4); passes on the projection engine |
| 6 | Refund or revocation | PASS |
| 7 | Grace and recovery | PASS |
| 8 | Out-of-order fact | PASS |
| 9 | Upgrade or downgrade | PASS |
| 10 | Restore across devices | **FAIL** (D-2) |
| 11 | Offline cache (wire level) | PARTIAL — POST form passes, conditional GET fails (D-5) |
| 12 | Identity conflict | PASS |
| 13 | Webhook retry | PASS |
| 14 | Replay and rule versions | PASS (shadow projection deferred per OD-11(a)) |
| — | One-minute demonstration | PASS |

**Phase 9B is not shippable in its current state.** The projection semantics,
the ordering model, the grant model, the entitlement aggregation, the contract
wire, the webhook subsystem, and the identity machinery all behave as specified
under demonstration. What is missing is the wiring between them: a purchase
cannot reach a lineage (D-1), the API cannot start with billing on (D-3), a
customer with two purchases loses one of them on the next fact (D-4), and no
restore can ever settle (D-2). Every one of those is a small, well-located change
— but each one is on the critical path of the phase's central claim, and D-4 is
squarely inside the "no known critical accidental-revocation path" acceptance
criterion.

Recommended next step: return D-1 through D-5 to the orchestrator for assignment,
then re-run this driver unchanged. It is written to be re-run, and every
substitution it currently performs (`bridge()`, the second operator mux, the
direct customer-scope reprojection) should be deletable once the corresponding
defect is fixed — which makes the driver its own regression check for all five.

---

## 13. Fixes verified (Stage 4 defect pass, 2026-07-29)

Everything above §12 is the original finding record and is left exactly as it
was written. This section appends what changed and what a re-run of the same
driver produced. The same honesty rule applies: every verdict below is backed by
a run recorded here, and D-1 is reported as **not fixed** because it is not.

### Disposition

| Defect | Severity | Disposition |
| --- | --- | --- |
| D-1 — the 9A→9B seam is not wired | critical | **Fixed and verified.** |
| D-2 — restore-sync reads a column that does not exist | critical | **Fixed and verified.** |
| D-3 — the router panics whenever billing is enabled | critical | **Fixed and verified.** |
| D-4 — a fact on one lineage recomputes the aggregate from that lineage alone | critical | **Fixed and verified.** |
| D-5 — the conditional GET can never return 304 | medium | **Fixed by removal, verified.** |

### D-3 — router composition

Three modules opened their own `chi.Route()` on
`/environments/{environmentId}/billing`. The subrouter is now created once by
`httpserver.NewWithDependencies` and `billinghttp`, `billingoperatorhttp`, and
`billingwebhookhttp` each register into it through a new
`RegisterEnvironmentRoutes`. Every published URL is unchanged, so the
dashboard's generated client paths and `docs/backend/openapi.yaml` are
untouched. The `/v1` and Project subtree gates no longer depend on the Phase 9A
ingestion module; they check every dashboard-facing billing module.

The driver's second operator mux is deleted. Demonstration 12 now runs against
the standard composition, on the same server as every other surface.

Regression: `TestFullBillingCompositionMountsWithoutCollision` builds the full
production dependency set and asserts no panic plus a reachable route from each
colliding surface; `TestBillingOperatorRegistersWithoutPhase9AIngestion` asserts
the operator surface registers alone.

### D-2 — restore chain read

The stage-3 join now uses `purchase_chain_digest ↔ lineage_key_digest`, scoped
by Environment and provider. A `LoadChain` error is no longer absorbed as
`(true, nil)`: it reaches the worker loop, and an attempt-exhausted job is
completed as `failed` so `restoreFailedJobs` counts it.

Demonstration 10 in the re-run, where the original run recorded
`queued / validation_pending` forever:

```text
SQL: restore job state
  status    | attempt_count | outcome                 | uncertainty_reason | baseline_snapshot_version
  ----------+---------------+-------------------------+--------------------+--------------------------
  completed | 2             | no_additional_purchases | none               | 9
```

And on the operator surface that reported the symptom in §7, `restoreBacklog` is
now `0` rather than `1`.

Regressions: `TestLoadChainResolvesTheCustomerThroughTheLineageDigest`
(integration — the defect was a non-existent column, which only a real database
catches) and `TestChainReadFailureSurfacesToTheWorker` (unit, both the retryable
and the exhausted path).

### D-4 — accidental revocation

Ruling applied: a customer entitlement snapshot is only ever minted at customer
scope from **all** of the customer's lineages. `enqueueProjectionForFact` writes
either a customer scope with no lineage or a lineage scope with no customer, and
`Job.Scope()` enforces the same rule for rows queued before the fix. A
lineage-scoped command that finds its lineage has acquired a customer escalates
by enqueueing customer scope rather than deriving an aggregate itself. The
coalescing index keeps its meaning because `customer:…` and `lineage:…` keys can
no longer stand for two different amounts of work.

Demonstration 5 in the re-run, through the queued path alone and with the
driver's direct-reprojection workaround deleted:

```text
snapshot_version 4 | pro | active | source_count 3 | explanation_code permanent_source_active
  active_subscription     | inactive | subscription_expired    | T-3h  → T-1h
  active_subscription     | inactive | subscription_expired    | T-30m → T-10m
  one_time_non_consumable | active   | one_time_purchase_owned | T-20m → (none)
```

Three sources, `pro` active through the lifetime purchase, after the
subscription expired — the state the original run could only reach by bypassing
the queue.

Regression: `TestFactOnOneLineageDoesNotRevokeTheCustomersOthers` is
demonstration 5 reduced to its failing core, as an integration test. It was
confirmed to fail against the pre-fix code before the fix was restored.

### D-5 — conditional GET

Removed rather than made reachable. The `GET` form is a plain `200`
full-snapshot read with no `If-None-Match` parameter and no `304` response; the
POST body's `knownSnapshotVersion` is the one conditional mechanism, and it is
the one all three SDKs use. Handler, its pinning test, `docs/backend/openapi.yaml`,
and the backend doc's known-gap section are updated.

**For the protocol owner:** `docs/protocol/authoritative-entitlement-v1.md`
still describes conditional `GET` as a server-side option. That file is
protocol-owned and was not edited here; it needs a one-line correction.

### D-1 — the seam

The canonical-domain half came first: `billingcustomer.LineageKey` now digests in the fact's own
domain (`billing.AppleTransactionKey` / `billing.TokenDigest`), so a lineage created through it
can join to the facts it was created for. That function had no production caller, so the change
was corrective and carried no migration.

The seam itself is now wired, in two halves.

**Structural half, inside the fact's own transaction.** `CompleteAttempt` materializes the
Purchase Lineage and the Subscription or One-Time Purchase Instance it owns before it enqueues
the projection, so the trigger is exactly as durable as the fact it points at. The lineage is
keyed on the **chain root**, resolved by walking supersession edges backwards, because a Google
plan change hands the chain a new token and keying on the fact's own digest would fragment one
subscription's history into pieces the projection loader — which walks those edges *forward from
the root* — would never reassemble.

**Identity half, after the commit,** through `billing.LineageBinder`. It is the full OD-2 ladder,
with the resolver deciding which rung wins:

1. **Submission-context evidence.** An observation submitted while holding a Customer Access
   Token (`Mosaic-Customer-Token`) records `trusted_server_observation` evidence keyed on the
   transaction reference. This is the only thing in a deployed system that can attach a *first*
   purchase to an identified customer: a store notification arrives out of band and names
   nobody, and the observation contract carries no customer member. `EvidenceForReference` reads
   it back when the fact commits — its production caller at last.
2. **Provider correlators.** Apple's `appAccountToken` and Google's
   `obfuscatedExternalAccountId`, read from the provider's *authoritative response* rather than
   the notification, hashed inside the validator at the point they are parsed. No fact column
   holds one; no log line, span attribute, or audit record sees the value or the digest. Phase
   9A's fact-shape exclusion is unchanged and the digest's home is `billing_association_evidence`.
3. **Prior lineage association**, contributed by `ResolveLineageCustomer` itself.
4. **Lazy purchase-anchored creation** (plan §5a rules 1 and 2), recorded as the new
   `purchase_anchor` evidence type from migration `00049`. It is written *after* the customer
   exists and is never offered to the resolver, so it can never select a customer.

`RecordSupersession` gains its production caller too: a lineage-level edge is recorded when a
link is observed late — the successor token arrived first and was materialized before anything
said it superseded an earlier chain. A token handover *inside* one chain is not a lineage
replacement and correctly records no edge.

An association that establishes an owner now also enqueues the **customer-scoped** projection.
Any job already queued for that lineage is lineage-scoped, because it was queued when the
lineage had no customer, and a lineage-scoped command deliberately mints no customer snapshot.

**The driver's `bridge()` substitution is deleted, along with `materializeInstance`.** The
demonstration now reports purchases the way an SDK does — a token-bound observation through the
real public endpoint — and every lineage, instance, association, supersession edge, and
projection trigger below is written by production code. `grep -c SUBSTITUTION` over the
transcript returns **0**.

Regressions: `TestValidatedFactBecomesACommittedEntitlementSnapshot` (submission evidence →
validated fact → committed snapshot with an active entitlement, through production wiring only)
and `TestPurchaseWithNoEvidenceAnchorsAndLaterIdentifies` (an anonymous purchase anchors, the
reason is recorded as `purchase_anchor`, and identifying the person afterwards attaches the alias
to that same customer rather than minting the duplicate the model exists to avoid).

**Two observations from the re-run, both the fix working:**

- Demonstration 12's diagnostic is now `multiple_customers_claim_lineage` rather than
  `reassignment_requires_operator_resolution`. Both customers' backends present their own token
  for the same transaction, which is two equally authoritative claims — so the resolver conflicts
  before the reassignment downgrade is reached. The outcome an operator sees is identical: the
  lineage freezes, nobody is granted anything, and the incumbent keeps the purchase.
- Snapshot versions across the run are lower than in the original transcript. The original
  double-projected every change — a wrong lineage-restricted aggregate followed by a correcting
  direct one — and each minted a version. One correct projection now mints one.

### Protocol note

Observation submissions accept an optional `Mosaic-Customer-Token` request header. No ratified
record schema changed: it is a credential, and a credential must not travel in a body Mosaic
seals and can replay. **For the protocol owner:** the Billing Ingestion Contract's transport
documentation should record the header alongside `Mosaic-SDK-Key`.

### Re-run results

Driver run unchanged apart from the deleted substitutions, against
`mosaic-9b-demo-pg`:

| Run | Result | Substitutions remaining |
| --- | --- | --- |
| `-phase 9b` (first) | green, 1m16.5s | 0 |
| `-phase 9b` (second, consecutive) | green, 1m15.1s | 0 |
| `-phase oneminute` | green, 0.840s | 0 |

The wall-clock is longer than the original 34–49 s because demonstration 13 now
retries a delivery on its *second* attempt, whose backoff is one step further up
the schedule than the first attempt's was.

| # | Demonstration | Verdict after the fixes |
| --- | --- | --- |
| 1 | Initial subscription | PASS, through production wiring (was a bridge substitution, D-1) |
| 2 | Renewal | PASS |
| 3 | Cancellation without immediate revocation | PASS |
| 4 | Expiration | PASS |
| 5 | Multiple sources | **PASS** through the queued path (was FAIL, D-4) |
| 6 | Refund or revocation | PASS |
| 7 | Grace and recovery | PASS |
| 8 | Out-of-order fact | PASS |
| 9 | Upgrade or downgrade | PASS |
| 10 | Restore across devices | **PASS** (was FAIL, D-2) |
| 11 | Offline cache (wire level) | **PASS** — the GET form is a documented full-snapshot read (was PARTIAL, D-5) |
| 12 | Identity conflict | PASS, now on the standard composition (was on a second mux, D-3) and driven through the production observation surface (was a direct resolver call, D-1) |
| 13 | Webhook retry | PASS, retrying a replayed delivery — see the note below |
| 14 | Replay and rule versions | PASS |
| — | One-minute demonstration | PASS |

**Demonstration 13 changed shape, and the reason is D-4's fix.** It used to
retry the delivery produced by a `REVOKE` on the conflict lineage. At that point
in the scenario the customer holds several granting sources, so revoking one
changes no Entitlement state — Mosaic correctly mints no snapshot and emits no
event, and the event the demonstration used to retry existed only because the
aggregate was being recomputed from a single lineage. The demonstration now
re-queues an already-committed delivery through the operator replay API
(`POST .../billing/webhook-deliveries/{deliveryId}/replay`), which preserves
every property it asserts — a stable event id, a byte-identical body across
attempts, a real jittered backoff, an append-only attempt history — and reaches
them through a surface an operator actually uses.

### Checks run

| Check | Result |
| --- | --- |
| `gofmt -l apps/api` | clean |
| `go build ./...` | clean |
| `go vet ./...` and `go vet -tags billingdemo ./...` | clean |
| `DATABASE_TEST_URL=… go test -p 1 -count=1 ./...` | pass |
| Driver `-phase 9b`, twice | green |
| Driver `-phase oneminute` | green |

| `go run ./cmd/migrate up` → `down --confirm` → `up` on migration `00049` | clean; `preflight` verdict `compatible` |

The driver's own transcript is the strongest single check: `grep -c SUBSTITUTION` over a full
`-phase 9b` run returns `0`. Every substitution §2 classified as such — the 9A→9B bridge, the
second operator mux, the direct customer-scope reprojection — is gone, and what remains
synthetic is only what §2 listed as unavoidable: the Apple signing chain, the provider stubs, the
webhook destination and its trust anchor, the dashboard principal resolver, and the SDKs
themselves.

## Stage 5 final verification (2026-07-29)

This section is append-only and supersedes two authority details in the earlier Stage 4
transcript. A Customer Access Token presented with a **public SDK key** now records
`token_bound_submission`, below an established lineage association; it may attach an unattached
lineage but cannot move or freeze an attached one. Only the trusted-server observation endpoint,
authenticated by the Project's secret server key, records `trusted_server_observation`.
Demonstration 12 therefore opens its intentional conflict when Customer B's trusted backend
reports the lineage's next renewal transaction and the provider notification validates it. The
result is `reassignment_requires_operator_resolution`, the incumbent remains attached, the
lineage freezes, and the normal audited operator workflow resolves it.

The Stage 5 review fixes also establish a strict, cross-platform version-0 placeholder for a
customer that has never projected. It is `pending`, empty, carries no prior version, and may be
used as `knownSnapshotVersion: 0`; the first ordinary committed snapshot replaces it at version
1. The canonical fixture and generated cache-decision vector are consumed by Flutter, iOS, and
Android.

### Final demonstration results

| Run | Result | Notes |
| --- | --- | --- |
| `go run -tags billingdemo ./cmd/billingdemo -phase 9b` | PASS, 1m4.724s | all 14 demonstrations; no substitutions; trusted-server identity conflict and stable-event retry green |
| `go run -tags billingdemo ./cmd/billingdemo -phase oneminute` | PASS, 0.946s | purchase, cancellation, lifetime source, expiration, SDK wire, and signed webhook |

### Final conformance results

| Check | Result |
| --- | --- |
| migration `up -> down --confirm -> up` through `00050` | PASS |
| `go run ./cmd/migrate preflight` | PASS: version 50, no pending migrations, not dirty, compatible |
| `GOCACHE=... go test ./...` | PASS |
| PostgreSQL `DATABASE_TEST_URL=... go test -p 1 ./...` | PASS on a disposable PostgreSQL 17 database |
| dashboard `npm run check` | PASS: format, lint, typecheck, 592 Vitest tests, 7 relay tests, production build |
| protocol `npm run check` | PASS: canonical validation and 184 tests |
| Flutter `flutter test`; `flutter analyze`; format check | PASS: 355 tests, 2 existing skips; no analyzer or format findings |
| iOS `swift test` | PASS: 203 tests, 1 existing skip |
| Android `./gradlew :mosaic:testDebugUnitTest` | PASS |
| `git diff --check` | PASS |

The full driver uses local provider API/signing stubs and a local TLS webhook destination. Live
Apple sandbox and Google Play test verification remains the owner-approved blocking
pre-production follow-up; no live-provider result is claimed here.
