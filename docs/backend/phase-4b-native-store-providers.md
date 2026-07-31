# Phase 4B: Native Store Providers

Phase 4B adds credential-free StoreKit and Google Play configuration. It does
not connect Mosaic to store consoles, accept store credentials, validate
transactions, or determine customer access.

## Activation and mappings

An active provider assignment is one of two explicit shapes:

- `provider_connection` references an existing RevenueCat or custom connection.
- `native_store` has no connection and pairs `app_store` with iOS or
  `google_play` with Android.

Native mappings are application- and environment-specific. StoreKit mappings
identify a Product. Google Play subscription mappings additionally require a
base plan and may select an offer. Non-consumable Products cannot carry base
plan or offer identifiers. One current Google Product ID may map to only one
Mosaic Product in an Environment and Android Application, even if that Google
Product has several base plans. Client-only owned-purchase recovery cannot
authoritatively distinguish those base plans; supporting that shape is deferred
until Mosaic owns an approved authoritative recovery contract.

Native mappings become active when created because there is no server-side
provider verification step. Replacing a mapping archives the prior row and
creates a new row whose `replacesMappingId` records the immutable lineage.

Relevant endpoints are:

- `PUT /v1/environments/{environmentId}/applications/{applicationId}/active-provider`
- `POST /v1/products/{productId}/provider-mappings`
- `POST /v1/provider-mappings/{mappingId}/replace`
- `GET /v1/provider-mappings/{mappingId}/usage`
- `GET /v1/native-providers/{provider}/profile?platform=ios|android`

## Browser-session observations

The API accepts bounded observations produced by an authenticated Mosaic
browser session:

- `POST /v1/provider-mappings/{mappingId}/observations`
- `GET /v1/provider-mappings/{mappingId}/observations`

Observations are append-only and are tied to the mapping's Project,
Environment, Application, platform, and provider. Optional metadata is a
closed object containing only client platform/version, application version,
OS version, configuration source, storefront country code, and test scenario.
Unknown keys, wrong types, oversized values, and receipt-, token-, credential-,
customer-, account-, authorization-, password-, bearer-, or secret-like
material are rejected in both the service and database. The API rejects future
timestamps beyond a five-minute allowance and invalid provider/store-context
combinations. Observation rows cannot be updated or deleted.

Observations are diagnostic evidence, not store authority. An available,
unexpired test observation raises readiness from `configured` to
`verifiedInTest`. Missing or expired evidence is a warning. An unavailable or
failed latest observation is a blocker.

## Publishing and delivery

Publishing partitions readiness into blockers and warnings. Missing mappings,
invalid Google Play base plans, failed observations, and conflicting mappings
block publication. Missing or stale successful observations warn but do not
block. Rejected production publication attempts produce a safe audit event
without recording secrets or request bodies.

Native assignments produce immutable Commerce Configuration v2 sidecars. The
sidecar contains:

- the native provider identity and adapter capabilities;
- exact store Product, base-plan, and offer mappings;
- Product types and entitlement grants;
- freshness derived only from accepted native observations;
- an explicit active-provider recovery mode.

RevenueCat assignments continue to produce Commerce Configuration v1
sidecars. Delivery through
`GET /v1/sdk/commerce-configuration?applicationId=<id>` is version-negotiated:
a v2 sidecar is returned only when the SDK includes `2` in both
`Mosaic-Commerce-Configuration-Versions` and
`Mosaic-Commerce-Provider-Contract-Versions`. The response content type carries
the delivered version. Existing v1-only clients continue receiving v1
sidecars.

## Persistence and configuration

Migration `00008_native_store_providers.sql` adds the assignment union,
connectionless native mappings, replacement lineage, and immutable observation
history. Composite foreign keys keep Environment and Application scope within
the mapping Project, and connected mappings continue to require declared
connection scopes. A partial unique index prevents one current native store
Product reference from mapping to multiple Mosaic Products in the same scope.
Archived mappings and accepted observations are immutable at the database
boundary. Normal API startup never runs migrations.

Native provider profiles and v2 sidecars contain the complete frozen
19-capability catalog exactly once. Unsupported capabilities, including
`deferredPurchases`, are explicit and carry stable reason codes.

The API compiles all four Commerce schemas at startup:

- `MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH`
- `MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH`
- `MOSAIC_COMMERCE_PROVIDER_V2_SCHEMA_PATH`
- `MOSAIC_COMMERCE_CONFIGURATION_V2_SCHEMA_PATH`

The defaults point at the canonical repository schemas. Startup fails when a
configured schema is missing or invalid.
