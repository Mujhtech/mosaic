# Phase 4A RevenueCat Provider Integrations

Phase 4A adds a production server-connected RevenueCat adapter while preserving
Mosaic's platform-neutral Commerce Provider and Commerce Configuration
contracts. RevenueCat OAuth is intentionally deferred. The supported
authorization boundary is a least-privilege RevenueCat REST API v2 secret key.

## Security boundary

RevenueCat credentials are accepted only by provider-connection create,
credential rotation, and reconnect requests. They must begin with `sk_`, are
encrypted with AES-256-GCM before persistence, and are never returned. Public
connection responses expose only credential class, keyed fingerprint, key ID,
envelope version, and rotation/revocation timestamps.

Mosaic never logs authorization headers, credential plaintext, credential
ciphertext, provider response bodies, or complete import request bodies.
Persisted catalog observations are normalized safe metadata rather than raw
RevenueCat payloads.

Create one RevenueCat secret key limited to the selected RevenueCat Project and
these read-only permissions:

- `project_configuration:apps:read`
- `project_configuration:products:read`
- `project_configuration:offerings:read`
- `project_configuration:packages:read`
- `project_configuration:entitlements:read`

Do not grant write, customer, entitlement-grant, purchase, webhook, or
financial permissions.

## Runtime configuration

Server-connected provider operations are disabled by default. When enabled,
both API and worker require the same credential keyring.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOSAIC_PROVIDER_INTEGRATIONS_ENABLED` | `false` | Enables encrypted provider credentials and live provider operations. |
| `MOSAIC_PROVIDER_CREDENTIAL_KEYRING` | none | Strict JSON keyring containing one active AES-256 key and any retained decrypt-only keys. |
| `MOSAIC_REVENUECAT_BASE_URL` | `https://api.revenuecat.com/v2` | RevenueCat v2 origin. Production requires HTTPS. |
| `MOSAIC_PROVIDER_REQUEST_TIMEOUT` | `8s` | Timeout for each provider HTTP attempt. |
| `MOSAIC_PROVIDER_OPERATION_TIMEOUT` | `60s` | Deadline shared by the complete catalog operation, including pagination, package expansion, rate-limit waits, and retries. Must be at least the request timeout and no more than `5m`. |
| `MOSAIC_PROVIDER_CONNECT_TIMEOUT` | `3s` | Provider connection/TLS timeout. |
| `MOSAIC_PROVIDER_MAX_RESPONSE_BYTES` | `2097152` | Maximum decoded provider response bytes. |
| `MOSAIC_PROVIDER_MAX_ATTEMPTS` | `3` | Bounded retry attempts; maximum is 5. |
| `MOSAIC_PROVIDER_SNAPSHOT_TTL` | `24h` | Freshness interval for normalized provider metadata. |
| `MOSAIC_PROVIDER_WORKER_POLL_INTERVAL` | `1s` | Poll interval when no synchronization job is available. |
| `MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH` | canonical repository path | Commerce Provider v1 schema used during startup. |
| `MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH` | canonical repository path | Commerce Configuration v1 schema used during startup and publishing. |

A valid keyring has this shape:

```json
{
  "version": 1,
  "activeKeyId": "provider-key-2026-07",
  "keys": {
    "provider-key-2026-07": "<base64url-without-padding 32-byte key>"
  }
}
```

Generate the key material with a cryptographically secure source. Treat the
complete JSON document as a deployment secret, not an application `.env`
value committed to source control.

For local Compose:

```bash
export MOSAIC_PROVIDER_INTEGRATIONS_ENABLED=true
export MOSAIC_PROVIDER_CREDENTIAL_KEYRING='{"version":1,"activeKeyId":"local-provider-key","keys":{"local-provider-key":"<base64url-32-byte-key>"}}'
docker compose --profile providers up --build
```

The API and worker fail startup when provider operations are enabled without a
valid keyring or when PostgreSQL is unavailable. Neither process falls back to
in-memory persistence. Schema changes remain an explicit `cmd/migrate up`
deployment step.

## Connection and import workflow

1. Create a RevenueCat connection with its v2 Project resource ID, one-time
   secret, mode, Environment scopes, and Application scopes.
2. Test the connection. A successful test marks it healthy and confirms the
   credential can read the normalized catalog.
3. Preview the catalog, select Products and optional Entitlements, and submit an
   idempotent import.
4. Assign the connection to each intended Environment × Application pair.
5. Run synchronization and inspect run history or safe diagnostics.
6. Publish only after every referenced Product has exactly one active,
   available mapping with a non-expired immutable metadata snapshot.

Production connections may cover only production Environments. Sandbox
connections may not cover production Environments. Environment and Application
scopes cannot be removed while used by an assignment or non-archived mapping.

Imports accept RevenueCat v2 Product, Offering, Package, and Entitlement
resource IDs. Before persistence Mosaic resolves Offering, Package, and
Entitlement selections against the live catalog and stores their canonical SDK
lookup keys. The Commerce Configuration sidecar uses:

- the native App Store or Play Store product identifier as
  `providerProductReference`;
- the RevenueCat Offering and Package lookup keys for package selection;
- the RevenueCat Entitlement lookup key for active-entitlement matching.

RevenueCat v2 resource IDs are never sent to mobile SDK lookup APIs.

Entitlement mappings are unique within one provider connection, environment,
and application. To switch connections, archive the old Product mapping,
import the verified Product and entitlement mappings on the replacement
connection, then change the active assignment. Readiness and publishing select
only the active connection and require an exact active provider mapping for
every entitlement granted by every released Product.

Provider imports are idempotent per Project, connection, key, and normalized
request. An `in_progress` record older than 15 minutes is atomically expired to
a replayable `partial` result with its completed items preserved. It is never
re-executed under the same key, preventing duplicate Product or mapping
creation; operators may reconcile the returned items and submit only missing
items with a new idempotency key.

Trial and introductory-offer capability is reported as `conditional` with
reason code `provider.platformCapabilityVaries`. Mosaic does not claim
universal runtime support because SDK product metadata and eligibility signals
vary by platform.

## Synchronization and failure recovery

The worker leases queued jobs through PostgreSQL for two minutes. Completion is
fenced by job ID, worker ID, attempt number, and unexpired lease while holding
the job row lock, so an expired worker cannot overwrite a later attempt. Each
mapping result is recorded independently. Successful observations create a new
immutable metadata snapshot and atomically advance the mapping pointer. A
failed item preserves its previous snapshot pointer and records only a stable,
safe error code.

The adapter enforces the RevenueCat project-configuration rate domain locally,
limits one catalog operation to 200 total pages and 20 total retries, caps
`Retry-After` waits at five seconds and the operation's remaining time,
reconstructs pagination requests against the configured RevenueCat origin, and
never follows a provider-supplied pagination URL. RevenueCat `one_time`
products are importable only when the nested `one_time.is_consumable` value is
explicitly `false`; consumables and unsupported product kinds are excluded.

Recovery actions:

- `credentialInvalid`: rotate or reconnect with a valid scoped secret key.
- `permissionDenied`: add only the missing read permissions listed above.
- `rateLimited`: wait for `Retry-After`; the worker reschedules without a
  blocking sleep.
- `providerUnavailable` or `timeout`: retry after provider recovery.
- `mappingMissing` or `mappingAmbiguous`: import/replace the verified mapping or
  archive the obsolete mapping.
- `metadataStale`: enqueue synchronization. Existing immutable SDK
  configuration remains available until a newer Release is published.

## Credential key rotation

Keyring rotation and RevenueCat secret rotation are separate:

1. Add a new AES key to the keyring and make it `activeKeyId`, retaining the old
   key for decryption.
2. Deploy the identical expanded keyring to API and worker.
3. Rotate or reconnect each RevenueCat connection. The new provider secret is
   validated before its replacement envelope is committed.
4. Confirm no credential row uses the old `key_id`.
5. Remove the old AES key from both deployments.

Never remove an AES key while a credential row still references it. A failed
RevenueCat credential validation leaves the previous encrypted credential
unchanged.

## SDK sidecar delivery

`GET /v1/sdk/commerce-configuration?applicationId=<id>` uses the public SDK key
and requires the frozen Commerce Configuration v1 negotiation headers described
in `openapi.yaml`. The response is the raw immutable protocol envelope with:

- `Content-Type: application/vnd.mosaic.commerce-configuration+json;version=1`
- `ETag: "sha256:<content digest>"`
- `Mosaic-Configuration-Release-Id: <release id>`

Exact `If-None-Match` returns an empty `304` while retaining association, cache,
ETag, and `Vary` headers. An iOS request cannot receive an Android
Application's sidecar and vice versa. Releases with no commerce Products do not
create or require a sidecar.
