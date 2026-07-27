# Commerce Providers

Mosaic is provider-independent: paywalls reference Mosaic Products, and a
provider integration resolves those Products to purchasable store items at
runtime. Four provider kinds exist:

| Provider | Integration shape | Status |
| --- | --- | --- |
| RevenueCat | Server-connected provider connection + SDK adapter | Implemented and contract-tested; not live-verified against the RevenueCat sandbox |
| Custom | App-owned provider connection + your own SDK adapter | Implemented and contract-tested; exercised by the GA drills |
| StoreKit 2 | Built-in native-store activation (no server connection) + SDK StoreKit package | Implemented and contract-tested; not live-verified against the Apple sandbox |
| Google Play Billing | Built-in native-store activation (no server connection) + SDK Google Play module | Implemented and contract-tested; not live-verified against a Play test track |

"Not live-verified" means no purchase has been demonstrated against the real
store or provider sandbox for v1 (owner decision D10). The adapters pass the
Commerce Provider contract fixtures and the mock/custom-provider purchase flow
runs in the GA demonstration. See [docs/known-limitations.md](../known-limitations.md).

## Enabling server-connected providers

Server-connected providers (RevenueCat, custom) are off by default. Set:

- `MOSAIC_PROVIDER_INTEGRATIONS_ENABLED=true`
- `MOSAIC_PROVIDER_CREDENTIAL_KEYRING` to a valid version-1 keyring

Without the flag, provider-connection credential operations and provider sync
return `503 providerFeatureDisabled`. Catalog CRUD and native-store mappings
are not gated by this flag. Startup fails if the flag is enabled without a
usable keyring.

## RevenueCat

Create a connection in the dashboard under
`/organizations/{organizationId}/projects/{projectId}/catalog/providers`
(Connect RevenueCat), or via
`POST /v1/projects/{projectId}/provider-connections`. You provide: a name,
mode (`sandbox` or `production`), the RevenueCat v2 Project ID, and a
RevenueCat secret API key (`sk_...`). The key needs only read scopes:
`project_configuration:apps:read`, `:products:read`, `:offerings:read`,
`:packages:read`, `:entitlements:read`.

Test a connection with `POST /v1/provider-connections/{connectionId}/test`,
then import the catalog (`POST /v1/projects/{projectId}/provider-imports`) to
create Product mappings. The worker keeps mapping metadata synchronized; sync
runs and health are visible on the connection detail page.

On the device, install the optional RevenueCat adapter for your SDK and pass
it to Mosaic. The host app owns `Purchases.configure` and identity. See the
"Commerce Configuration" sections of
[sdk/flutter/README.md](../../sdk/flutter/README.md),
[sdk/ios/README.md](../../sdk/ios/README.md), and
[sdk/android/README.md](../../sdk/android/README.md).

## Custom providers

A custom connection carries no credential; your app supplies its own provider
implementation through the SDK's provider factory/adapter API. This is the
path the GA demonstration uses for a test purchase. See the same SDK README
sections for the factory and adapter types per platform.

## StoreKit 2 and Google Play Billing

The native stores are built in and never require a server connection or store
credentials. You activate them per Environment and Application
(`PUT /v1/environments/{environmentId}/applications/{applicationId}/active-provider`),
create native-store mappings for each Product (product identifier; Google
Play subscriptions also need a base plan and optionally an offer), and install
the SDK-side package: the StoreKit package for iOS
(`sdk/ios/StoreKit`), the `:mosaic-google-play` module for Android, or the
`mosaic_native_store` package for Flutter. Mosaic does not connect to the
store consoles, accept store credentials, or validate transactions; see
[docs/backend/phase-4b-native-store-providers.md](../backend/phase-4b-native-store-providers.md).

## Credential encryption and rotation

Provider credentials are sealed in AES-256-GCM envelopes with scope-bound
associated data under a versioned multi-key keyring
([ADR 0019](../architecture/decisions/0019-encrypt-provider-credentials-with-aes-gcm-envelopes.md)).
API responses expose only a fingerprint and key metadata, never the secret.
Losing the keyring makes every stored credential permanently undecryptable;
back it up separately from PostgreSQL.

- Rotate the provider secret itself:
  `POST /v1/provider-connections/{connectionId}/rotate-credential` (or the
  dashboard connection detail page).
- Rotate the encryption keyring: the `keyring` command
  (`validate`, `inspect`, `rotate [--dry-run]`), documented in
  [docs/backend/operations/key-rotation.md](../backend/operations/key-rotation.md).

## Verification status

Connection lifecycle, catalog import, mapping sync, credential encryption,
keyring rotation, and the contract fixtures are covered by backend tests and
the GA drills using mock and custom providers. Live RevenueCat, Apple, and
Google Play purchases are not demonstrated for v1.
