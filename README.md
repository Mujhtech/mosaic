# Mosaic

Mosaic is an open-source, cross-platform paywall and monetization platform.
Create, publish, and update production-quality native paywalls across
Flutter, SwiftUI, and Jetpack Compose without releasing a new app version.

Mosaic covers the full monetization loop: visual paywall authoring in
Studio, remote configuration with immutable versioning and rollback,
placements with deterministic on-device targeting, publishing per
Environment, analytics, experiments with honest descriptive statistics, and
provider-independent commerce through RevenueCat, StoreKit 2, Google Play
Billing, or your own custom adapter.

The architecture is one platform-neutral protocol, three native renderers,
and one Studio. No WebView rendering, and no executable code in remote
configuration.

## Status

Mosaic is a **v1 release candidate**, self-hostable today.

- The server and dashboard version together and are preparing for a
  `v1.0.0` General Availability release
  ([draft release notes](docs/releases/v1.0.0-notes.md)).
- The SDKs are **pre-1.0 (`0.x-dev`) and not published to any package
  registry**; install them by pinning this repository at an exact tag or
  commit, or by local path
  ([SDK quickstarts](docs/guides/sdk-quickstarts.md)).
- Commerce adapters are implemented and contract-tested but **not
  live-verified** against the RevenueCat sandbox, Apple sandbox, or a Google
  Play test track.
- All documented limitations live in
  [docs/known-limitations.md](docs/known-limitations.md).

## Quickstart

```bash
cp .env.example .env
docker compose up --build
```

This starts a complete installation: PostgreSQL, MinIO, migrations, the API,
the worker, the dashboard, and a local TLS edge. Open the dashboard at
`http://localhost:3000`.

The local Studio needs no account and no backend: open
`http://localhost:3000/studio` (or run `npm run dev:studio` from
`apps/dashboard` for development with the device-preview relay).

## Supported matrix (v1)

| Area | Supported |
| --- | --- |
| PostgreSQL | 17 |
| Docker | Engine 24+ with Compose v2 |
| Browsers | Chrome/Edge 111+, Safari 16.4+, Firefox 128+ (Studio desktop-only, ≥768 px) |
| Go (build from source) | 1.26.x |
| Flutter SDK | Flutter 3.22+ / Dart 3.4+ |
| iOS SDK | iOS 15+, Swift 6 language mode, Xcode 16+ |
| Android SDK | API 24+ |

## Repository map

```text
apps/api/         Go API, worker binary, and CLI commands (migrate, keyring)
apps/dashboard/   dashboard and Studio (TanStack Start)
protocol/         canonical JSON Schemas, validators, and fixtures
sdk/flutter/      Flutter SDK        sdk/ios/  Swift SDK    sdk/android/  Kotlin SDK
packages/         design tokens and design system
examples/         example host apps for all three platforms
deploy/ scripts/  deployment profile and operational scripts
docs/             documentation
```

## Documentation

User guides:

- [Installation](docs/guides/installation.md)
- [Upgrade](docs/guides/upgrade.md)
- [Backup and restore](docs/guides/backup-restore.md)
- [Troubleshooting](docs/guides/troubleshooting.md)
- [Catalog: Products and Entitlements](docs/guides/catalog.md)
- [Commerce providers](docs/guides/providers.md)
- [Studio](docs/guides/studio.md)
- [Publishing](docs/guides/publishing.md)
- [Placements](docs/guides/placements.md)
- [Targeting](docs/guides/targeting.md)
- [Analytics](docs/guides/analytics.md)
- [Experiments](docs/guides/experiments.md)
- [Privacy](docs/guides/privacy.md)
- [SDK quickstarts](docs/guides/sdk-quickstarts.md) and the
  [SDK overview](docs/sdk/README.md)

Operations: [operator runbooks](docs/runbooks/README.md),
[backup and restore](docs/backend/operations/backup-restore.md),
[upgrade](docs/backend/operations/upgrade.md),
[key rotation](docs/backend/operations/key-rotation.md),
[observability](docs/backend/operations/observability.md),
[performance](docs/backend/operations/performance.md). The environment
reference is [`.env.example`](.env.example).

Reference: [protocol contracts](docs/protocol/),
[architecture overview](docs/architecture/overview.md),
[product roadmap](docs/product/roadmap.md),
[known limitations](docs/known-limitations.md),
[support policy](docs/support.md).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and — for vulnerabilities —
[SECURITY.md](SECURITY.md).

## License

Mosaic is licensed under the [Apache License 2.0](LICENSE).
