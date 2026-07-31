-- Phase 9B: Product-to-Entitlement Grant Versions and Entitlement lifecycle
-- (plan §5, §7; OD-8 prospective + replacement + additive-superset, backfill
-- option (ii)).
--
-- `product_entitlement_grants` is unversioned and hard-deletable — a
-- one-DELETE mass-revocation path. This migration makes grant meaning
-- versioned and immutable, backfills version 1 from each live pair's
-- created_at, reconstructs closed intervals for pairs that were granted and
-- later removed (from the audit events those operations always write), and
-- blocks hard DELETE on the legacy table once versions exist.
--
-- No-overlap of grant intervals for one (product, entitlement) is enforced by
-- the application under the grant advisory lock rather than by a btree_gist
-- exclusion constraint: requiring an extension changes the deployment
-- contract for every operator, and the write path is already serialized. A
-- partial unique index still guarantees at most one open-ended version per
-- pair, which is the case an application bug would most plausibly produce.

-- +goose Up
CREATE TABLE product_entitlement_grant_versions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    product_id text NOT NULL,
    entitlement_id text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    grant_policy_version integer NOT NULL DEFAULT 1 CHECK (grant_policy_version >= 1),
    effective_start timestamptz NOT NULL,
    effective_end timestamptz,
    supported_purchase_types text[] NOT NULL DEFAULT ARRAY['auto_renewable_subscription','non_consumable']::text[],
    -- Access policy per subscription state (plan §7, policy version 1).
    grants_in_active boolean NOT NULL DEFAULT true,
    grants_in_trial boolean NOT NULL DEFAULT true,
    grants_in_grace boolean NOT NULL DEFAULT true,
    -- Enabling billing-retry access contradicts both providers' documentation
    -- and requires explicit owner approval; the default is closed.
    grants_in_billing_retry boolean NOT NULL DEFAULT false,
    -- Pause is fixed at no-access with no override (plan §7).
    grants_in_paused boolean NOT NULL DEFAULT false,
    grants_in_one_time_ownership boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    created_by_actor_id text,
    reason text NOT NULL DEFAULT '',
    UNIQUE (id, project_id),
    UNIQUE (product_id, entitlement_id, version),
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (entitlement_id, project_id) REFERENCES entitlements(id, project_id) ON DELETE RESTRICT,
    CHECK (effective_end IS NULL OR effective_end > effective_start),
    CHECK (grants_in_paused = false)
);
-- At most one open-ended (current) version per pair.
CREATE UNIQUE INDEX product_entitlement_grant_versions_open_idx
    ON product_entitlement_grant_versions(product_id, entitlement_id)
    WHERE effective_end IS NULL;
CREATE INDEX product_entitlement_grant_versions_selection_idx
    ON product_entitlement_grant_versions(product_id, entitlement_id, effective_start DESC);

CREATE TRIGGER product_entitlement_grant_versions_append_only
BEFORE UPDATE OR DELETE ON product_entitlement_grant_versions
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Backfill per OD-8(ii). Version 1 of every live pair is effective from the
-- grant row's own created_at: exact, because the grant row records when the
-- pair started granting.
INSERT INTO product_entitlement_grant_versions (
    id, project_id, product_id, entitlement_id, version, effective_start, created_at, reason)
SELECT
    'pegv_' || md5(g.product_id || ':' || g.entitlement_id || ':1'),
    g.project_id, g.product_id, g.entitlement_id, 1, g.created_at, g.created_at,
    'backfill: live grant at 9B migration'
FROM product_entitlement_grants g;

-- Pairs that were granted and later removed leave no grant row, but every
-- grant and removal is a discrete audited operation, so the closed interval is
-- reconstructable. Only removals whose grant is not currently live are
-- reconstructed (a re-granted pair is covered by the row above).
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

-- Once versions exist, a hard DELETE on the legacy grant table would strand
-- the version history and silently change historical access meaning. Removing
-- a grant now means closing the current version, which the application does.
-- +goose StatementBegin
CREATE FUNCTION reject_versioned_grant_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM product_entitlement_grant_versions v
        WHERE v.product_id = OLD.product_id AND v.entitlement_id = OLD.entitlement_id
    ) THEN
        RAISE EXCEPTION 'product_entitlement_grants is versioned; close the current grant version instead of deleting'
            USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER product_entitlement_grants_versioned_delete
BEFORE DELETE ON product_entitlement_grants
FOR EACH ROW EXECUTE FUNCTION reject_versioned_grant_delete();

-- Entitlement lifecycle columns. Archiving an Entitlement preserves its
-- historical meaning; nothing is deleted.
ALTER TABLE entitlements
    ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active'
        CHECK (lifecycle_state IN ('active', 'archived')),
    ADD COLUMN archived_at timestamptz,
    ADD CONSTRAINT entitlements_lifecycle_shape_check
        CHECK ((lifecycle_state = 'archived') = (archived_at IS NOT NULL));

-- +goose Down
ALTER TABLE entitlements
    DROP CONSTRAINT entitlements_lifecycle_shape_check,
    DROP COLUMN archived_at,
    DROP COLUMN lifecycle_state;
DROP TRIGGER product_entitlement_grants_versioned_delete ON product_entitlement_grants;
DROP FUNCTION reject_versioned_grant_delete();
DROP TRIGGER product_entitlement_grant_versions_append_only ON product_entitlement_grant_versions;
DROP TABLE product_entitlement_grant_versions;
