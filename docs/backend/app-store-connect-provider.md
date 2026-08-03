# App Store Connect Provider Connections

App Store Connect is Mosaic's second server-connected commerce provider. An
operator connects an App Store Connect API key once and Mosaic reads their
existing App Store catalog — apps, in-app purchases, subscription groups, and
subscriptions — so Products can be imported instead of retyped.

The adapter is read-only. It calls no endpoint that changes App Store state:
Mosaic imports an operator's catalog and never authors products on their behalf.

## `app_store_connect` is not `app_store`

The two provider kinds are deliberately separate and the database enforces the
difference.

| | `app_store` | `app_store_connect` |
| --- | --- | --- |
| Activation | native store, SDK-side | provider connection |
| `connection_id` | always `NULL` | always present |
| Metadata source | operator-declared, SDK-observed | read from Apple |
| Integration mode | n/a | `server_connected` |

A mapping created by an App Store Connect import therefore keeps the connection
it was verified through, and a native StoreKit mapping keeps none.

## Credential

The credential is a single JSON document, sealed as one opaque connection
credential using the same AES-256-GCM envelope and `serverSecret` class as
every other provider credential (ADR-0019). No schema change was needed to
store it.

```json
{
  "privateKey": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
  "keyId": "ABCDE12345",
  "issuerId": "57246542-96fe-1a63-e053-0824d011072a",
  "vendorNumber": "85200000"
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `privateKey` | yes | The `.p8` App Store Connect API key: PEM, PKCS#8, EC P-256. |
| `keyId` | yes | Exactly ten characters, `[0-9A-Z]`. |
| `issuerId` | yes | The team-wide issuer UUID from the Keys page. |
| `vendorNumber` | no | Digits only. **Not used by catalog import.** |

The vendor number identifies the payee for App Store Connect's Sales and Finance
reporting endpoints, which Mosaic does not call. It is captured now so a later
sales or finance feature does not require every operator to re-enter an
otherwise complete credential.

`externalProjectId` must be omitted. An App Store Connect API key is issued per
Apple team and already names every app it can read; a second project identifier
would persist configuration nothing reads and imply a scope the credential does
not have.

The credential document is validated before it is encrypted, so an unusable key
is refused at connect time rather than at the first background sync.

### Key access

App Store Connect grants access by team role and has no permission
introspection endpoint. The key must be able to read:

- Apps
- In-App Purchases (v2)
- Subscription Groups
- Subscriptions

Do not use an Admin key. `Developer` or `App Manager` is sufficient and neither
grants finance or user-management access.

## Authentication

Each request carries a freshly minted ES256 assertion, signed with the shared
Apple signer in `internal/platform/appstoreserver`:

- header `{ "alg": "ES256", "kid": <keyId>, "typ": "JWT" }`
- claims `{ "iss": <issuerId>, "iat": …, "exp": iat + 20m, "aud": "appstoreconnect-v1" }`

There is **no `bid` claim**. The App Store Server API requires one; the App
Store Connect API rejects a token that carries it. Tokens are never cached: a
cached token outlives the credential revocation that should have invalidated
it.

## Catalog mapping

| App Store Connect | Mosaic catalog |
| --- | --- |
| App | `App` with `platform: app_store`, `identifier` = bundle ID |
| In-app purchase, `NON_CONSUMABLE` | `Product` type `one_time_non_consumable` — importable |
| In-app purchase, `CONSUMABLE` | `Product` type `one_time_consumable` — listed, not importable |
| In-app purchase, `NON_RENEWING_SUBSCRIPTION` | `Product` type `non_renewing_subscription` — listed, not importable |
| Subscription | `Product` type `subscription` — importable |
| Subscription group | `Offering` with one `Package`, keyed by the group resource ID |
| — | `Entitlement` list is always empty |

`Product.storeIdentifier` is the App Store `productId`; `Product.id` is Apple's
opaque resource ID and is what a mapping records.

Only Apple's `APPROVED` state maps to `active`. Every other state is reported
verbatim in lower case so an operator sees the real reason a product is not
offered rather than an unexplained absence.

Consumables and non-renewing subscriptions are listed but refused by import.
Mosaic models neither, and importing one as a non-consumable would grant a
permanent entitlement for a purchase that is not permanent.

App Store Connect has no entitlement resource, so the reported
`activeEntitlementLookup` capability is `conditional` /
`host.implementationRequired` rather than supported. Mapping an Entitlement to
an Apple product remains a host decision.

## Delivery: import through Apple, activate the native store

App Store Connect supplies the catalog. It does not serve purchases: the API is
read-only and has no purchase, restore, or entitlement-lookup surface. Purchases
run through StoreKit, on the device, under the native `app_store` activation.

The operator journey is therefore three steps:

1. **Import** the catalog through the App Store Connect connection. Each
   imported mapping records `provider = app_store_connect`, its connection, the
   Apple resource ID, and the App Store `productId` in
   `expected_store_product_id`.
2. **Activate the native App Store** for the Environment and Application
   (`activationKind: native_store`, `provider: app_store`).
3. **Publish.** The Release's Commerce Configuration is built from the imported
   mappings.

Assigning the App Store Connect connection itself as the active provider is
refused at assignment time with `providerNativeActivationRequired` (422). It
used to be accepted and then fail during publishing as an unexplained readiness
error.

### What is emitted

The configuration is byte-shape-identical to one built from hand-created native
mappings, because Commerce Configuration v2 already requires exactly that for
iOS: `activeProvider.identity.id` is `app_store`,
`activeProvider.activation.source` is `nativeStore` with no connection ID, and
every `adapterMapping.kind` is `storeKitProduct`. No protocol change was
needed.

Two consequences follow from Apple's data model and are deliberate:

- `providerProductReference` is `expected_store_product_id`, not
  `provider_product_identifier`. StoreKit buys the App Store product ID; the
  resource ID is an App Store Connect API handle and cannot be purchased. An
  imported mapping with no recorded `productId` is skipped rather than shipped.
- The subscription group stored in the offering and package columns is import
  **provenance, not a purchase selector**, and is dropped from the emitted
  mapping. Emitting it as a `revenueCatPackage` adapter would be rejected by
  Commerce Configuration v2, which allows that kind only under the `revenuecat`
  identity.

### Precedence

A Product can carry both a hand-created `app_store` mapping and an
`app_store_connect` import for the same Environment, Application, and platform.

**The imported mapping wins.** It was read from Apple and is refreshed by the
synchronization worker, while the hand-created mapping is an unverified
transcription that nothing re-checks. The rule is applied identically by
provider readiness and by Commerce Configuration generation, so what the
dashboard reports and what ships are always the same mapping. Ties within one
provenance are broken by mapping ID, so the winner is deterministic.

### Freshness

An imported mapping cannot carry an SDK observation — observations are refused
for connection-backed mappings — so its provider-verified metadata snapshot is
the freshness evidence instead. Expired metadata blocks; merely stale metadata
blocks only in a production Environment. This is the same grading the
server-connected path applies, so the same staleness means the same thing
whichever activation delivers the Product.

Because a native `freshness.observation` describes an on-device product load,
none is emitted for an imported mapping, and the configuration's freshness
status stays `configured` rather than claiming an observation that never
happened.

Connection health is deliberately **not** required to publish an imported
mapping. A native activation makes no runtime call to App Store Connect, so a
credential that expired after the import does not invalidate the product
identifiers it produced. Staleness is reported through the metadata snapshot
rather than by silently dropping the mapping.

## Failure classification

| Status | Catalog error | Retryable |
| --- | --- | --- |
| 401 | `credentialInvalid` | no |
| 403 | `permissionDenied` | no |
| 429 | `rateLimited` (honours `Retry-After`, delta-seconds) | yes |
| 400, 404, 409, 422 | `invalidResponse` | no |
| 5xx and anything undocumented | `providerUnavailable` | yes |

An undocumented status is treated as unknown rather than permanent: calling it
permanent would quarantine a healthy connection the first time Apple returns
something unfamiliar.

`Retry-After` is parsed as RFC 7231 delta-seconds. This is **not** the App Store
Server API, which sends an absolute millisecond timestamp;
`appstoreserver.ParseRetryAfter` is deliberately not reused here.

Apple's `links.next` pagination is followed only when the link names the
configured host, so a spoofed response cannot redirect a signed Apple assertion
to another origin.

## Runtime configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOSAIC_APP_STORE_CONNECT_BASE_URL` | `https://api.appstoreconnect.apple.com` | App Store Connect API origin. Production requires HTTPS. |

Every other provider setting — enablement, credential keyring, timeouts, retry
budget, snapshot TTL — is shared with the RevenueCat adapter and documented in
`phase-4a-provider-integrations.md`.
