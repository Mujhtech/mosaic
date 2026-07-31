# Phase 9C stabilization and rollback readiness

Work Packages 17–18 add program-scoped stabilization observations and rollback-readiness checkpoints. They observe the existing authority state and do not change authority or execute rollback.

## Frozen monitoring policy

Each stabilizing program freezes one immutable threshold policy. It covers authority mismatches, access API errors, SDK sync failures, unresolved divergences, validation backlog, source delta lag, webhook failure and freshness, quarantine, support cases, old application versions, and unhealthy workers.

Observations use PostgreSQL's clock and derive values from persisted tenant-scoped state:

- exact program authority scopes and epoch;
- trusted internal access-API signal windows;
- v2 SDK sync observations;
- unresolved migration divergences and incomplete import/validation work, where a terminal validation binding counts only for the exact provider reference, reference kind, application, environment, and frozen product mapping;
- the latest final delta source watermark;
- webhook delivery outcomes and last success for every relevant active v2 destination × exact program scope pair;
- billing and source-normalization quarantine;
- open migration cases and unsupported application-version evidence;
- failed or expired migration worker leases.

Access API signal windows are a narrow internal telemetry ingestion seam. They are append-only and are not accepted through the operator service. Missing access telemetry, source delta evidence, or webhook success evidence is recorded as an explicit `*_unknown` breach and can never be interpreted as healthy.

The production trusted-server entitlement-check service records one PII-free window after every
authenticated check. A window contains only Project/Environment scope, PostgreSQL-bounded timing,
request count, error count, and a digest with a random nonce; it never contains a customer ID,
entitlement key, API key, correlation ID, or request/response body. Evidence persistence is
best-effort for the caller so monitoring can never change an access decision. Stabilization sums all
fresh immutable windows across API instances, so a later successful instance cannot mask another
instance's error. Evidence older than two minutes is not trustworthy current-health evidence; when
no fresh request window exists, `access_api_unknown` blocks health. Recording is synchronous and
request-scoped with a one-second write budget that survives client cancellation, so there is no
buffered evidence, background goroutine, or shutdown flush to lose.

## Rollback readiness

An assessment accepts only identifiers, expected state/authority values, idempotency, and the expected latest stabilization evidence digest. PostgreSQL derives:

- active, non-removed source credentials;
- the latest source capability assessment, including customer, subscription, alias, and incremental-delta reads, bound to the unchanged active program credential; the exact completed final pull supplies freshness because equal capability sets intentionally do not append another assessment;
- the exact latest completed final-delta source pull and its manifest;
- the latest final delta and current-access record digest set;
- customer impact from the persisted final source pull;
- accepted current-epoch SDK evidence for every exact program scope;
- the same frozen application-version, traffic, contract-v2, and required authority-capability policy used by cutover readiness;
- source and stabilization limitations.

Unknown or unsupported source access always produces `ready=false`. A failed assessment remains immutable evidence but creates no checkpoint. A healthy assessment creates an immutable checkpoint binding the current authority set, frozen monitoring policy, observation, and readiness digest.

PostgreSQL also enforces that a checkpoint can reference only a ready assessment from the same program and project. This invariant does not rely solely on the repository implementation.

The checkpoint precedes rollback proposal and approval. It does not create a second authority path: the existing rollback proposal, two-person approval, and atomic rollback execution remain responsible for authorization and transition.

Migration `00061` refuses rollback when any policy, trusted signal, observation, assessment, or checkpoint evidence exists.
