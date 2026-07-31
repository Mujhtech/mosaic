# Operator Runbooks

Incident procedures for a self-hosted Mosaic v1 installation (single-host
Docker Compose, Profile A). Each runbook is Symptoms → Impact → Diagnosis →
Recovery → Verification → Escalation → Prevention, and defers to the guides
for full procedures:
[installation](../guides/installation.md) ·
[upgrade](../guides/upgrade.md) ·
[backup and restore](../guides/backup-restore.md) ·
[troubleshooting](../guides/troubleshooting.md) ·
[observability](../backend/operations/observability.md) ·
[key rotation](../backend/operations/key-rotation.md).

The procedures reflect what the Phase 8 GA drills demonstrated
([drill evidence](../reviews/phase-8-drill-evidence.md)); steps not
demonstrated by a drill are labelled inside each runbook.

Compose commands act on the default project. On a host with more than one
Mosaic installation, add `-p <project>` to `docker compose` and to every
`scripts/*.sh` invocation.

## Availability

- [API will not start](api-will-not-start.md)
- [Readiness failing](readiness-failing.md)
- [PostgreSQL unavailable](postgres-unavailable.md)
- [Object storage unavailable](object-storage-unavailable.md)

## Schema and releases

- [Migration failed](migration-failed.md)
- [Rollback after a bad release](rollback-after-bad-release.md)

## Publishing and delivery

- [Publishing failure](publishing-failure.md)
- [Configuration delivery failure](delivery-failure.md)

## Workers and analytics

- [Worker backlog](worker-backlog.md)
- [Analytics ingestion failure](analytics-ingestion-failure.md)
- [Aggregation backlog](aggregation-backlog.md)
- [Failed data export](failed-data-export.md)
- [Failed data deletion](failed-data-deletion.md)

## Commerce and experiments

- [Provider connection failure](provider-connection-failure.md)
- [Experiment emergency stop](experiment-emergency-stop.md)

## Credentials

- [Compromised public SDK key](compromised-public-sdk-key.md)
- [Compromised secret API key](compromised-secret-api-key.md)
- [Compromised provider credential](compromised-provider-credential.md)
- [Keyring loss and rotation](keyring-loss-rotation.md)

## Backup and restore

- [Failed backup](failed-backup.md)
- [Failed restore](failed-restore.md)

There is deliberately **no Redis runbook**: Mosaic v1 does not use Redis.
