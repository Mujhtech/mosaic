-- Phase 9B: indexes for the operator (dashboard) surface.
--
-- No table, column, or constraint changes. Every index here exists because a
-- query the operator surface runs on every page load would otherwise be a
-- sequential scan on a table that grows with a Project's whole billing history.
--
-- 1. Installation lookup. The operator customer search resolves an
--    installation identifier through association evidence, because an
--    installation id is evidence and never an anchor (plan §5a rule 2a), so
--    there is no alias resolution to read. Migration 00030 indexed evidence by
--    transaction reference and by customer, but not by the correlator digest,
--    which is what a lookup matches on. Partial on the evidence type so the
--    index covers only the rows the lookup can match.
--
-- 2. Restore job listing. 00037 indexed the queue's lease path (available_at,
--    status); the operator list orders by requested_at within one Environment,
--    which shares no prefix with it.
--
-- 3. Entitlement pointer by Environment. The primary key is
--    (billing_customer_id, environment_id), so no index leads with
--    environment_id — and both the customer list's LEFT JOIN and the projection
--    health "stale pointers" count read exactly that way.

-- +goose Up
CREATE INDEX billing_association_evidence_installation_digest_idx
    ON billing_association_evidence(project_id, evidence_digest, observed_at DESC)
    WHERE evidence_type = 'installation_observation' AND evidence_digest IS NOT NULL;

CREATE INDEX restore_sync_jobs_environment_requested_idx
    ON restore_sync_jobs(environment_id, requested_at DESC, id);

CREATE INDEX customer_entitlement_pointers_environment_idx
    ON customer_entitlement_pointers(environment_id, updated_at DESC);

-- +goose Down
DROP INDEX customer_entitlement_pointers_environment_idx;
DROP INDEX restore_sync_jobs_environment_requested_idx;
DROP INDEX billing_association_evidence_installation_digest_idx;
