-- Phase 9B: Entitlement Sources and Customer Entitlement Snapshots
-- (plan §5, OD-3(b) Environment-scoped snapshots and pointers).
--
-- A Customer is Project-scoped, but everything that holds state is
-- Environment-scoped, so a customer has one monotonic snapshot sequence and
-- one current pointer PER (customer, environment). Without that, a sandbox
-- projection would advance the snapshot version a production SDK reads.
--
-- Entitlement Source identity is (purchase lineage, product, grant version) —
-- never a fact id — so multi-fact-per-purchase (mapping drift, validator
-- bumps) cannot double-grant.
--
-- The snapshot/pointer relationship is circular (a snapshot names the customer
-- and the customer's pointer names a snapshot), so the pointer's foreign key
-- is added in a second step after both tables exist.

-- +goose Up
CREATE TABLE customer_entitlement_snapshots (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    billing_customer_id text NOT NULL,
    -- Monotonic per (customer, environment). A no-change projection does not
    -- advance it (plan §3 snapshot versioning).
    snapshot_version bigint NOT NULL CHECK (snapshot_version >= 1),
    rule_version integer NOT NULL REFERENCES projection_rule_versions(version) ON DELETE RESTRICT,
    computed_at timestamptz NOT NULL,
    as_of timestamptz NOT NULL,
    previous_snapshot_id text,
    checksum bytea NOT NULL CHECK (octet_length(checksum) = 32),
    change_reason text NOT NULL CHECK (btrim(change_reason) <> '' AND length(change_reason) <= 64),
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (billing_customer_id, environment_id, snapshot_version),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (previous_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT,
    CHECK (previous_snapshot_id IS NULL OR previous_snapshot_id <> id)
);
CREATE INDEX customer_entitlement_snapshots_customer_idx
    ON customer_entitlement_snapshots(billing_customer_id, environment_id, snapshot_version DESC);

CREATE TRIGGER customer_entitlement_snapshots_append_only
BEFORE UPDATE OR DELETE ON customer_entitlement_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Entitlement Sources belong to one snapshot generation: they are the
-- explanation of why that snapshot said what it said.
CREATE TABLE entitlement_sources (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    customer_entitlement_snapshot_id text NOT NULL,
    billing_customer_id text NOT NULL,
    entitlement_id text NOT NULL,
    -- Source identity (plan §3): lineage + product + grant version.
    purchase_lineage_id text NOT NULL,
    product_id text NOT NULL,
    grant_version_id text NOT NULL,
    subscription_instance_id text,
    one_time_purchase_instance_id text,
    source_snapshot_id text,
    source_type text NOT NULL CHECK (source_type IN (
        'active_subscription', 'trial', 'verified_grace_period',
        'accepted_billing_retry', 'one_time_non_consumable', 'family_shared'
    )),
    source_state text NOT NULL CHECK (source_state IN ('active', 'inactive', 'unknown')),
    source_start timestamptz,
    source_end timestamptz,
    -- A permanent source (a valid non-consumable) has no finite end. The
    -- distinction between "no end known" and "no end exists" is what keeps a
    -- lifetime purchase from reporting a misleading expiry.
    end_known boolean NOT NULL DEFAULT true,
    uncertainty_reason text NOT NULL DEFAULT 'none',
    is_test_source boolean NOT NULL DEFAULT false,
    explanation_code text NOT NULL CHECK (btrim(explanation_code) <> '' AND length(explanation_code) <= 64),
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    -- One source per identity per snapshot generation: this is the structural
    -- guarantee against double-granting from two facts of one purchase.
    UNIQUE (customer_entitlement_snapshot_id, purchase_lineage_id, entitlement_id, grant_version_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_entitlement_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (entitlement_id, project_id)
        REFERENCES entitlements(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (purchase_lineage_id, project_id)
        REFERENCES purchase_lineages(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (grant_version_id, project_id)
        REFERENCES product_entitlement_grant_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (subscription_instance_id, project_id)
        REFERENCES subscription_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (one_time_purchase_instance_id, project_id)
        REFERENCES one_time_purchase_instances(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_snapshot_id, project_id)
        REFERENCES subscription_snapshots(id, project_id) ON DELETE RESTRICT,
    CHECK (end_known OR source_end IS NULL)
);
CREATE INDEX entitlement_sources_snapshot_idx
    ON entitlement_sources(customer_entitlement_snapshot_id, entitlement_id);

CREATE TRIGGER entitlement_sources_append_only
BEFORE UPDATE OR DELETE ON entitlement_sources
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

CREATE TABLE customer_entitlement_snapshot_entries (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    customer_entitlement_snapshot_id text NOT NULL,
    entitlement_id text NOT NULL,
    entitlement_key text NOT NULL CHECK (btrim(entitlement_key) <> ''),
    -- 'unavailable' is a read-time service state and is never persisted.
    state text NOT NULL CHECK (state IN ('active', 'inactive', 'unknown')),
    effective_start timestamptz,
    effective_end timestamptz,
    end_known boolean NOT NULL DEFAULT true,
    source_count integer NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    uncertainty_reason text NOT NULL DEFAULT 'none' CHECK (uncertainty_reason IN (
        'none', 'provider_unavailable', 'missing_fact', 'identity_unresolved',
        'product_unresolved', 'conflicting_facts', 'projection_failed',
        'stale_validation', 'unsupported_provider_state'
    )),
    is_test_source boolean NOT NULL DEFAULT false,
    explanation_code text NOT NULL CHECK (btrim(explanation_code) <> '' AND length(explanation_code) <= 64),
    UNIQUE (id, project_id),
    -- One entry per Entitlement per snapshot.
    UNIQUE (customer_entitlement_snapshot_id, entitlement_id),
    FOREIGN KEY (customer_entitlement_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (entitlement_id, project_id)
        REFERENCES entitlements(id, project_id) ON DELETE RESTRICT,
    CHECK (state <> 'unknown' OR uncertainty_reason <> 'none'),
    CHECK (end_known OR effective_end IS NULL)
);

CREATE TRIGGER customer_entitlement_snapshot_entries_append_only
BEFORE UPDATE OR DELETE ON customer_entitlement_snapshot_entries
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- Step two of the circular relationship: exactly one current pointer per
-- (customer, environment), updated atomically inside the projection
-- transaction. The pointer is mutable by design — it is the only mutable row
-- in the snapshot graph.
CREATE TABLE customer_entitlement_pointers (
    project_id text NOT NULL,
    environment_id text NOT NULL,
    billing_customer_id text NOT NULL,
    current_snapshot_id text NOT NULL,
    snapshot_version bigint NOT NULL CHECK (snapshot_version >= 1),
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (billing_customer_id, environment_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_snapshot_id, project_id)
        REFERENCES customer_entitlement_snapshots(id, project_id) ON DELETE RESTRICT
);

-- +goose Down
DROP TABLE customer_entitlement_pointers;
DROP TRIGGER customer_entitlement_snapshot_entries_append_only ON customer_entitlement_snapshot_entries;
DROP TABLE customer_entitlement_snapshot_entries;
DROP TRIGGER entitlement_sources_append_only ON entitlement_sources;
DROP TABLE entitlement_sources;
DROP TRIGGER customer_entitlement_snapshots_append_only ON customer_entitlement_snapshots;
DROP TABLE customer_entitlement_snapshots;
