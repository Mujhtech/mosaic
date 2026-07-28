-- Phase 9B review correction I-14.2: reconstruct EACH historical grant→remove
-- cycle as its own grant version.
--
-- Migration 00033 backfilled removed Product-to-Entitlement pairs from
-- `audit_events` using DISTINCT ON to take the earliest `product.entitlement_granted`
-- and a LATERAL to take the latest `product.entitlement_removed`. That collapses
-- every cycle a pair went through into ONE interval [first grant, last removal].
-- A pair granted in January, removed in February, granted again in June and
-- removed in July backfills as a single interval covering January to July — so a
-- purchase made in April, when the Entitlement was not granted at all, selects
-- that version and is entitled. Backdated access is exactly what OD-8's
-- prospective-plus-additive-superset rule exists to prevent, and the backfill
-- was granting it.
--
-- The reconstruction here walks the audit stream pairwise. Consecutive
-- same-kind events are collapsed first (a grant while a grant is already open
-- opens nothing new; a removal while nothing is open closes nothing), which
-- leaves a strictly alternating grant/remove sequence per pair. Each grant is
-- then paired with the removal that immediately follows it, producing one closed
-- interval per cycle. The intervals are non-overlapping by construction, which
-- is what the table's no-overlap invariant requires, and are numbered
-- chronologically from 1 to satisfy UNIQUE (product_id, entitlement_id, version).
--
-- Scope is deliberately identical to 00033's: pairs with NO live
-- `product_entitlement_grants` row. A pair that is live already holds version 1
-- from 00033's exact live backfill, and reconstructing its earlier cycles would
-- renumber a version that has already been published and possibly cited. That
-- gap is stated rather than closed here.
--
-- Degenerate intervals (grant and removal at the same instant) are dropped: the
-- table's CHECK requires effective_end > effective_start, and an interval of
-- zero length grants nothing anyway.

-- +goose Up

-- A collapsed row that a projection has already cited cannot be removed without
-- rewriting the entitlement source that cites it, and entitlement_sources is
-- append-only evidence. Fail loudly instead of silently leaving the wrong
-- interval in place: the operator's recovery is to replay the affected scopes so
-- the citing snapshots are superseded, then re-run this migration.
-- +goose StatementBegin
DO $$
DECLARE
    citing bigint;
BEGIN
    SELECT count(*) INTO citing
    FROM entitlement_sources s
    JOIN product_entitlement_grant_versions v ON v.id = s.grant_version_id
    WHERE v.reason = 'backfill: reconstructed from audit history';
    IF citing > 0 THEN
        RAISE EXCEPTION
            'cannot correct the 00033 grant backfill: % entitlement source(s) cite a collapsed grant version; replay those scopes first', citing
            USING ERRCODE = '55000';
    END IF;
END;
$$;
-- +goose StatementEnd

-- Grant versions are append-only; the trigger is lifted only for the length of
-- the correction, exactly as 00026's down path lifts the quarantine audit
-- trigger. What is being removed is a reconstruction Mosaic itself computed and
-- got wrong, not a provider statement or an operator action.
ALTER TABLE product_entitlement_grant_versions
    DISABLE TRIGGER product_entitlement_grant_versions_append_only;

DELETE FROM product_entitlement_grant_versions
    WHERE reason = 'backfill: reconstructed from audit history';

INSERT INTO product_entitlement_grant_versions (
    id, project_id, product_id, entitlement_id, version, effective_start, effective_end,
    created_at, reason)
WITH events AS (
    SELECT a.project_id,
           a.resource_id AS product_id,
           a.metadata->>'entitlementId' AS entitlement_id,
           CASE WHEN a.action = 'product.entitlement_granted' THEN 'grant' ELSE 'remove' END AS kind,
           a.created_at,
           a.id AS event_id
    FROM audit_events a
    WHERE a.action IN ('product.entitlement_granted', 'product.entitlement_removed')
      AND a.project_id IS NOT NULL
      AND a.resource_id IS NOT NULL
      AND a.metadata->>'entitlementId' IS NOT NULL
), deduplicated AS (
    -- Collapse runs of the same kind: only the first event of a run changes the
    -- open/closed state of the pair.
    SELECT e.*,
           lag(e.kind) OVER (
               PARTITION BY e.product_id, e.entitlement_id
               ORDER BY e.created_at, e.event_id) AS previous_kind
    FROM events e
), transitions AS (
    SELECT * FROM deduplicated WHERE previous_kind IS DISTINCT FROM kind
), intervals AS (
    SELECT t.project_id, t.product_id, t.entitlement_id, t.kind,
           t.created_at AS effective_start,
           lead(t.created_at) OVER (
               PARTITION BY t.product_id, t.entitlement_id
               ORDER BY t.created_at, t.event_id) AS effective_end
    FROM transitions t
), closed AS (
    SELECT i.project_id, i.product_id, i.entitlement_id, i.effective_start, i.effective_end,
           row_number() OVER (
               PARTITION BY i.product_id, i.entitlement_id
               ORDER BY i.effective_start) AS version
    FROM intervals i
    WHERE i.kind = 'grant'
      AND i.effective_end IS NOT NULL
      AND i.effective_end > i.effective_start
)
SELECT
    'pegv_' || md5(c.product_id || ':' || c.entitlement_id || ':historic:' || c.version),
    c.project_id, c.product_id, c.entitlement_id, c.version,
    c.effective_start, c.effective_end, c.effective_start,
    'backfill: reconstructed from audit history (pairwise)'
FROM closed c
WHERE NOT EXISTS (
    SELECT 1 FROM product_entitlement_grants g
    WHERE g.product_id = c.product_id AND g.entitlement_id = c.entitlement_id)
  AND EXISTS (
    SELECT 1 FROM products p WHERE p.id = c.product_id AND p.project_id = c.project_id)
  AND EXISTS (
    SELECT 1 FROM entitlements e WHERE e.id = c.entitlement_id AND e.project_id = c.project_id)
ON CONFLICT DO NOTHING;

ALTER TABLE product_entitlement_grant_versions
    ENABLE TRIGGER product_entitlement_grant_versions_append_only;

-- +goose Down
-- Restore 00033's collapsed reconstruction exactly as it was, so down→up is a
-- true round trip rather than an amputation.
ALTER TABLE product_entitlement_grant_versions
    DISABLE TRIGGER product_entitlement_grant_versions_append_only;

DELETE FROM product_entitlement_grant_versions
    WHERE reason = 'backfill: reconstructed from audit history (pairwise)';

INSERT INTO product_entitlement_grant_versions (
    id, project_id, product_id, entitlement_id, version, effective_start, effective_end,
    created_at, reason)
SELECT
    'pegv_' || md5(granted.resource_id || ':' || granted.entitlement_id || ':historic'),
    granted.project_id, granted.resource_id, granted.entitlement_id, 1,
    granted.created_at, removed.created_at, granted.created_at,
    'backfill: reconstructed from audit history'
FROM (
    SELECT DISTINCT ON (a.resource_id, a.metadata->>'entitlementId')
        a.project_id, a.resource_id, a.metadata->>'entitlementId' AS entitlement_id, a.created_at
    FROM audit_events a
    WHERE a.action = 'product.entitlement_granted' AND a.project_id IS NOT NULL
      AND a.metadata->>'entitlementId' IS NOT NULL
    ORDER BY a.resource_id, a.metadata->>'entitlementId', a.created_at
) granted
JOIN LATERAL (
    SELECT a.created_at
    FROM audit_events a
    WHERE a.action = 'product.entitlement_removed'
      AND a.resource_id = granted.resource_id
      AND a.metadata->>'entitlementId' = granted.entitlement_id
      AND a.created_at > granted.created_at
    ORDER BY a.created_at DESC LIMIT 1
) removed ON true
WHERE NOT EXISTS (
    SELECT 1 FROM product_entitlement_grants g
    WHERE g.product_id = granted.resource_id AND g.entitlement_id = granted.entitlement_id)
  AND EXISTS (
    SELECT 1 FROM products p WHERE p.id = granted.resource_id AND p.project_id = granted.project_id)
  AND EXISTS (
    SELECT 1 FROM entitlements e WHERE e.id = granted.entitlement_id AND e.project_id = granted.project_id)
ON CONFLICT DO NOTHING;

ALTER TABLE product_entitlement_grant_versions
    ENABLE TRIGGER product_entitlement_grant_versions_append_only;
