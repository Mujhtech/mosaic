# Installation

Installing Mosaic on a single host with Docker Compose — the supported v1
deployment profile (Profile A). Every step below was executed during the
Phase 8 GA installation drill (Drill 1 and the pass-two drills recorded in
[`docs/reviews/phase-8-drill-evidence.md`](../reviews/phase-8-drill-evidence.md));
steps that were **not** drill-validated are labelled as such.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker Engine 24+ with the Compose v2 plugin | The drills ran on Engine 29 / Compose v5; 24+/v2 is the supported floor |
| CPU architecture | amd64 or arm64 |
| Free ports on the host | `8080` (API), `3000` (dashboard), `8443` (local TLS edge). The `debug` profile additionally publishes `5432` (PostgreSQL) and `9001` (MinIO console) |
| ~2 GiB free RAM for the containers | PostgreSQL 17, MinIO, API, worker, dashboard, Caddy |

Nothing else is required on the host: PostgreSQL 17 and MinIO run inside
Compose. Outbound DNS is **not** required — administrator email addresses are
format-validated only, so internal-only mail domains work.

The dashboard must be reached over **HTTPS, or on `localhost`**: the session
cookie is `Secure` and clipboard access requires a secure context, so serving
it over plain `http://` on any other host produces a sign-in loop.

## 1. Clone and configure

```bash
git clone <your-mosaic-remote> mosaic
cd mosaic
cp .env.example .env
```

`.env.example` documents **every** variable the API and worker read, with the
default next to each. The Compose file passes your `.env` through to the API
and worker, so editing it is how you operate Mosaic.

Variables you **must** change before any non-development use
(`MOSAIC_ENVIRONMENT` set to anything other than `development` or `test`
activates production guards that reject the shipped defaults):

| Variable | Why |
| --- | --- |
| `POSTGRES_PASSWORD` | The shipped value is a development default |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Production validation rejects default MinIO credentials |
| `MOSAIC_CORS_ALLOWED_ORIGINS` | Must be your dashboard's exact `https://` origin; wildcard and plain `http://` origins are rejected in production |
| `MOSAIC_SESSION_COOKIE_SECURE` | Must be `true` outside development and test |
| `MOSAIC_PUBLIC_ASSET_BASE_URL` | Must be the absolute HTTPS URL your devices will fetch Assets from |
| `MOSAIC_TRUSTED_PROXY_CIDRS` | Set to exactly your proxy/edge addresses when Mosaic runs behind one; empty means forwarded headers are never trusted |
| `MOSAIC_DASHBOARD_API_BASE_URL` | Read server-side by the dashboard and injected into the browser at runtime; must be the public API origin your operators' browsers can reach |
| `MOSAIC_PROVIDER_CREDENTIAL_KEYRING` | Only if you enable server-connected commerce providers (`MOSAIC_PROVIDER_INTEGRATIONS_ENABLED=true`); see [key rotation](../backend/operations/key-rotation.md) for the format |

Safe to leave at their defaults for a first installation: all rate limits,
timeouts, pool sizes, log settings, worker intervals, and upload ceilings.

Startup validates the whole configuration at once and fails with a structured
list naming **every** problem (never any secret value), so a misconfiguration
is a single fix-and-restart, not a loop.

## 2. Start the stack

```bash
docker compose up --build -d
```

Compose brings the services up in dependency order:

1. `postgres` — waits for its own healthcheck.
2. `minio`, then `minio-init` — one-shot bucket creation.
3. `migrate` — one-shot `migrate up`. The API **never** migrates at startup;
   this step is the only thing that changes schema.
4. `api` and `worker` — both wait for the migrate and minio-init steps.
5. `dashboard` and `local-edge` (Caddy TLS on `8443`).

The worker is part of every installation (analytics aggregation, retention,
privacy jobs, and Experiment scheduling run through it); it is not optional
and not profile-gated.

## 3. Verify

```bash
curl -s http://localhost:8080/health/live    # 200 {"data":{"status":"ok","version":...}}
curl -s http://localhost:8080/health/ready   # 200 {"data":{"status":"ready",...}}
docker compose ps                            # every service running / healthy
```

The worker serves the same endpoints on `:8081` **inside** its container (the
port is deliberately not published to the host):

```bash
docker compose exec worker /usr/local/bin/healthcheck http://127.0.0.1:8081/health/ready
```

Confirm the schema:

```bash
docker compose run --rm --entrypoint /usr/local/bin/migrate api status
# 21 applied, 0 pending migration(s)  (counts grow with future releases)
```

Open the dashboard at `http://localhost:3000` — `/` redirects to the local
Studio at `/studio`, which needs no account and no session. The hosted
workspace lives at `/workspace`; opening it while signed out redirects to the
sign-in page at `/login`, which guards every hosted route.
If readiness is 503 or the dashboard is blank, see the
[troubleshooting guide](troubleshooting.md).

### The debug profile

PostgreSQL and MinIO ports are not published to the host by default. When you
want `psql` or the MinIO console:

```bash
docker compose --profile debug up -d
```

This publishes PostgreSQL on `POSTGRES_PORT` (default 5432) and the MinIO
console on `MINIO_CONSOLE_PORT` (default 9001). Use it for diagnosis, not as a
permanent state.

## 4. Create the first administrator

Sign up through the dashboard sign-in page, or directly:

```bash
curl -s -X POST http://localhost:8080/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin-email>","password":"<password>","name":"<name>"}'
```

Returns `201` with the created user. The email address is **format-validated
only**: internal-only domains (e.g. `admin@mosaic.internal`) are accepted and
no outbound DNS lookup is performed.

### Restrict signup at the edge — operator responsibility

`POST /v1/auth/signup` is deliberately ungated in the application (owner
decision D9): **anyone who can reach the endpoint can create an account.**
After creating your accounts, block it at your reverse proxy or firewall.

A Caddy example, extending the shape of the shipped
[`deploy/local/Caddyfile`](../../deploy/local/Caddyfile):

```caddyfile
https://mosaic.example.com {
	@signup path /v1/auth/signup
	respond @signup "signup is disabled" 403
	reverse_proxy api:8080
}
```

*(This edge rule was not exercised in the GA drills; the shipped Caddyfile is
a plain TLS reverse proxy. Verify the block with a `curl` against your edge
after deploying it.)*

## 5. Bootstrap the workspace

Everything below can be done in the dashboard; the equivalent API calls are
the exact sequence executed and verified in Drill 1.

1. **Organization** — `POST /v1/organizations` → 201.
2. **Project** — `POST /v1/projects` → 201. Creating a Project
   **auto-seeds its three Environments** (development, staging, production).
   There is no environment-creation endpoint; list them with
   `GET /v1/projects/{projectId}/environments`.
3. **Application** — `POST /v1/projects/{projectId}/applications` (per
   platform, e.g. `ios`).

## 6. Publish a first Paywall

1. **Create the Paywall** — `POST /v1/projects/{projectId}/paywalls` → 201.
2. **Create a draft** — `POST .../paywalls/{paywallId}/drafts` with a Paywall
   document. **The document's `id` member must equal the created Paywall's
   id** — a mismatched id is rejected with `422 document_paywall_id_mismatch`.
   The draft response nests the draft and the document separately
   (`data.draft` + `data.document`).
3. **Validate** — `POST .../drafts/{draftId}/validate` →
   `{"errors":[],"warnings":[]}`.
4. **Create a Placement** — `POST /v1/projects/{projectId}/placements`.
   Placement keys (and Placement alias/attribute keys) must start with a
   lowercase letter and contain only lowercase letters, digits, and
   underscores — **no hyphens**, unlike Project and Product keys. An invalid
   key is a `422` field error.
5. **Bind it** — `PUT .../placements/{placementId}/binding` to the Paywall.
6. **Publish** — `POST .../environments/{environmentId}/publish` → 201 with a
   Release and its `contentHash`. Publish (and Placement rule-set publish)
   requires an **`Idempotency-Key` header** — any unique string such as
   `uuidgen` output; without it the API returns `428 precondition_required`.
   **The first publish requires at least one Placement bound to the
   Paywall**; publishing with none returns `409 placement_unpublished`.
7. **Create a public SDK key** —
   `POST /v1/environments/{environmentId}/api-keys` with kind `public_sdk`.
   The response nests `data.apiKey` (metadata) and `data.secret`; **the secret
   is returned exactly once.**

## 7. Fetch configuration through the SDK endpoint

This is the request every SDK makes; running it once proves the delivery path:

The endpoint also requires `Mosaic-Paywall-Capabilities` — the full Paywall
Protocol 0.2 capability list every SDK sends automatically. Without it a
hand-rolled request returns `406 unsupported_capability` naming the header;
that is negotiation working, not a fault. A complete request:

```bash
CAPS="accessibility.metadata,action.close,action.navigateBack,action.navigateTo,action.openExternalUrl,action.purchase,action.restore,asset.bundledImage,asset.bundledVideo,asset.remoteImage,asset.remoteVideo,component.button,component.carousel,component.countdown,component.featureList,component.icon,component.image,component.productBadge,component.productCard,component.productSelector,component.switch,component.text,condition.switchVisibility,fallback.asset,fallback.product,layout.heightSizing,layout.outerInsets,layout.scrollContainer,layout.sizing,layout.stack,localization.catalogs,localization.productTemplate,localization.rtl,navigation.screens,navigation.sheets,outcome.normalized,product.references,style.box,style.clipping,style.colors,style.designTokens,style.gradientBackground,style.mediaBackground,style.productCardStates,style.shadow,style.typography,visibility.static"
curl -si http://localhost:8080/v1/sdk/configuration \
  -H "Authorization: Bearer <public SDK key secret>" \
  -H "Mosaic-SDK-Platform: ios" \
  -H "Mosaic-SDK-Version: 1.0.0" \
  -H "Mosaic-Configuration-Versions: 3,2,1" \
  -H "Mosaic-Paywall-Protocol-Versions: 0.2" \
  -H "Mosaic-Paywall-Capabilities: $CAPS"
```

Expect `200` with `Content-Type: application/vnd.mosaic.configuration+json`
and `Cache-Control: private, max-age=60, stale-if-error=86400`. The `ETag`
identifies the exact negotiated representation (a SHA-256 of its bytes) — it
is **not** the Release `contentHash` from the publish response, and different
negotiated contract versions produce different ETags for the same Release.
Negotiation selects the highest delivery contract both sides fully support —
a request advertising no Placement-decision or Experiment capability headers
is served contract v1 even when it lists `3,2,1`; that is the negotiation
rule, not an error. Real SDKs send the full capability set for you.

Two first-run behaviours worth knowing now:

- **Analytics collection is off by default** for every new Environment
  (privacy-first). The first SDK event batch returns
  `409 analytics_collection_disabled` until you enable it:
  `PUT .../environments/{environmentId}/analytics/settings`
  `{"collectionEnabled":true,"rawRetentionDays":90}`.
- After rotating an SDK key, the old secret stops working immediately.

Next steps: [Publishing](publishing.md), [Placements](placements.md),
[SDK quickstarts](sdk-quickstarts.md), [upgrade guide](upgrade.md),
[backup and restore](backup-restore.md).

## Profile B: managed PostgreSQL and S3 (documented variant)

**This profile was not exercised by the GA installation drill** (the drills
ran Profile A end to end; the direct-URL backup mode below exists for
Profile B but was validated in Compose mode). Treat this section as the
documented shape, and verify each step in your environment.

With externally managed PostgreSQL and S3-compatible storage plus your own
TLS edge, only the `api`, `worker`, and `dashboard` services run in Compose.
What changes in `.env`:

| Variable | Profile B value |
| --- | --- |
| `DATABASE_URL` | Your managed PostgreSQL URL. Production requires a verifying `sslmode` (`require`, `verify-ca`, or `verify-full`) unless `MOSAIC_DATABASE_ALLOW_INSECURE=true` on a trusted private network |
| `MOSAIC_OBJECT_STORAGE_ENDPOINT` | Your S3-compatible endpoint |
| `MOSAIC_OBJECT_STORAGE_ACCESS_KEY` / `_SECRET_KEY` | Credentials for that store |
| `MOSAIC_OBJECT_STORAGE_BUCKET` | An existing bucket (there is no `minio-init` to create it) |
| `MOSAIC_OBJECT_STORAGE_TLS` | `true` (production rejects plaintext object storage unless `MOSAIC_OBJECT_STORAGE_ALLOW_INSECURE=true`) |
| `POSTGRES_*`, `MINIO_*` | Unused |

Caveats:

- The shipped `compose.yaml` wires `api` and `worker` to the in-network
  `postgres`/`minio` services and depends on the `migrate` and `minio-init`
  one-shots. Profile B therefore needs a small Compose override that removes
  those `depends_on` entries and stops forcing the in-network
  `DATABASE_URL`/object-storage endpoints. No such override file ships in the
  repository.
- Run migrations against the managed database with the same `migrate` binary
  (`docker compose run --rm --entrypoint /usr/local/bin/migrate api up` with
  `DATABASE_URL` pointing at the managed instance).
- Backups use the scripts' direct-URL mode — see
  [backup and restore](backup-restore.md).
