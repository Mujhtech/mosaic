# Support

Mosaic is community-supported open source. Support is best-effort through
GitHub issues on this repository; there is no SLA, paid support tier, or
guaranteed response time.

## Support policy

- File questions, bug reports, and feature requests as GitHub issues.
- Security vulnerabilities are the exception: never open a public issue —
  follow [SECURITY.md](../SECURITY.md).
- Fixes land on the latest minor release only. Older minors do not receive
  patches; the upgrade path is documented in
  [docs/backend/operations/upgrade.md](backend/operations/upgrade.md).
- SDKs version independently; each SDK minor is supported for 12 months per
  the deprecation policy in
  [docs/protocol/deprecation-policy.md](protocol/deprecation-policy.md).

## Filing a good bug report

Include:

1. **Versions**: server version and commit (from `GET /health/live` or the
   dashboard Diagnostics page), SDK name and exact version, and your
   platform/toolchain versions.
2. **Deployment shape**: Docker Compose profile A/B or source build, and
   anything nonstandard.
3. **Steps to reproduce**, expected behavior, and actual behavior.
4. **The correlation ID**: every API error response carries a `requestId`
   (also the `X-Request-ID` response header). Quote it — it lets a log search
   find the exact failing request.
5. **Relevant diagnostics** (below), with secrets and credentials removed.

## Where to find diagnostics

- **Dashboard `/diagnostics`**: dashboard version, commit, build time,
  resolved API base URL, preview relay URL, session state, and an on-demand
  API liveness probe. When a health or session error carries a correlation
  ID, this page shows it with a copy button. The dashboard sends no browser
  errors anywhere by design — quote these values yourself when reporting.
- **API health endpoints**: `GET /health/live` (process up, version, commit,
  build time) and `GET /health/ready` (PostgreSQL, object storage, migration
  compatibility, and encryption-configuration checks with safe per-check
  codes; 503 while draining). The worker serves the same probes on its own
  port (`MOSAIC_WORKER_HEALTH_ADDRESS`, default `:8081`).
- **Correlation IDs**: the API tags every request with `X-Request-ID` and
  includes it in error envelopes; structured logs carry the same ID, so one
  ID connects a user report to server logs and traces.
- **Migration state**: `migrate status` and `migrate preflight` report the
  current and pending schema state.
- **Observability**: with `OTEL_EXPORTER_OTLP_ENDPOINT` set, the API and
  worker export traces and metrics; see
  [docs/backend/operations/observability.md](backend/operations/observability.md).

## Known limitations

Before filing, check [docs/known-limitations.md](known-limitations.md) — the
owner-accepted register of documented v1 limitations, each with a workaround.
