-- Phase 9B: Purchase Lineages and projection instances (plan §5).
--
-- A Purchase Lineage groups validated facts describing one provider purchase
-- chain: the Apple original-transaction chain (lineage key = digest of
-- originalTransactionId) or the Google token chain root (walked through
-- linkedPurchaseToken). Lineages are Environment-scoped and never merged by
-- Product or customer similarity; supersession is an explicit edge.

-- +goose Up
CREATE TABLE purchase_lineages (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    environment_mode text NOT NULL CHECK (environment_mode IN ('development', 'staging', 'production')),
    application_id text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    store_environment text NOT NULL CHECK (store_environment IN ('sandbox', 'production')),
    -- Digest of the provider lineage key (Apple originalTransactionId key,
    -- Google purchase-token chain root digest). Never a raw token.
    lineage_key_digest bytea NOT NULL CHECK (octet_length(lineage_key_digest) = 32),
    lineage_type text NOT NULL CHECK (lineage_type IN ('subscription', 'one_time')),
    billing_customer_id text,
    superseded_by_lineage_id text REFERENCES purchase_lineages(id) ON DELETE RESTRICT,
    -- Set while an identity conflict is open for this lineage (OD-10): the
    -- projector skips a frozen lineage and preserves the last committed state.
    projection_frozen boolean NOT NULL DEFAULT false,
    diagnostic_status text NOT NULL DEFAULT 'none' CHECK (diagnostic_status IN (
        'none', 'identity_unresolved', 'identity_conflict', 'product_unresolved'
    )),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (environment_id, provider, lineage_key_digest),
    FOREIGN KEY (environment_id, project_id, environment_mode)
        REFERENCES environments(id, project_id, mode) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    CHECK (superseded_by_lineage_id IS NULL OR superseded_by_lineage_id <> id),
    -- Sandbox and production never mix (same alignment CHECK as the facts).
    CONSTRAINT purchase_lineages_environment_alignment_check CHECK (
        (environment_mode = 'production') = (store_environment = 'production')
    )
);
CREATE INDEX purchase_lineages_customer_idx
    ON purchase_lineages(billing_customer_id, created_at DESC)
    WHERE billing_customer_id IS NOT NULL;
CREATE INDEX purchase_lineages_environment_idx
    ON purchase_lineages(environment_id, created_at DESC, id);

-- Now that lineages exist, link the identity tables created in 00030.
ALTER TABLE billing_association_evidence
    ADD COLUMN purchase_lineage_id text,
    ADD CONSTRAINT billing_association_evidence_lineage_fkey
        FOREIGN KEY (purchase_lineage_id, project_id)
        REFERENCES purchase_lineages(id, project_id) ON DELETE RESTRICT;
ALTER TABLE billing_identity_conflicts
    ADD CONSTRAINT billing_identity_conflicts_lineage_fkey
        FOREIGN KEY (purchase_lineage_id, project_id)
        REFERENCES purchase_lineages(id, project_id) ON DELETE RESTRICT;

-- Subscription Instance: the authoritative projection unit for one recurring
-- lineage (1:1). The current-snapshot pointer column is added in 00032, after
-- subscription_snapshots exists.
CREATE TABLE subscription_instances (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    purchase_lineage_id text NOT NULL,
    billing_customer_id text,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    current_mosaic_product_id text,
    current_provider_product_identifier text,
    subscription_group_identifier text,
    current_projection_version bigint NOT NULL DEFAULT 0 CHECK (current_projection_version >= 0),
    terminal_at timestamptz,
    diagnostic_status text NOT NULL DEFAULT 'none' CHECK (diagnostic_status IN (
        'none', 'identity_unresolved', 'product_unresolved', 'projection_failed'
    )),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (purchase_lineage_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (purchase_lineage_id, project_id)
        REFERENCES purchase_lineages(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_mosaic_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX subscription_instances_customer_idx
    ON subscription_instances(billing_customer_id, created_at DESC)
    WHERE billing_customer_id IS NOT NULL;
CREATE INDEX subscription_instances_environment_idx
    ON subscription_instances(environment_id, created_at DESC, id);

-- One-Time Purchase Instance: validated ownership of a non-consumable.
-- Consumables remain excluded.
CREATE TABLE one_time_purchase_instances (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    purchase_lineage_id text NOT NULL,
    billing_customer_id text,
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    mosaic_product_id text,
    provider_product_identifier text,
    acquired_at timestamptz NOT NULL,
    validity_state text NOT NULL DEFAULT 'owned' CHECK (validity_state IN (
        'owned', 'refunded', 'revoked', 'unknown'
    )),
    refund_effective_at timestamptz,
    revocation_effective_at timestamptz,
    current_projection_version bigint NOT NULL DEFAULT 0 CHECK (current_projection_version >= 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (purchase_lineage_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (purchase_lineage_id, project_id)
        REFERENCES purchase_lineages(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mosaic_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    CHECK (validity_state <> 'refunded' OR refund_effective_at IS NOT NULL),
    CHECK (validity_state <> 'revoked' OR revocation_effective_at IS NOT NULL)
);
CREATE INDEX one_time_purchase_instances_customer_idx
    ON one_time_purchase_instances(billing_customer_id, acquired_at DESC)
    WHERE billing_customer_id IS NOT NULL;

-- +goose Down
DROP TABLE one_time_purchase_instances;
DROP TABLE subscription_instances;
ALTER TABLE billing_identity_conflicts
    DROP CONSTRAINT billing_identity_conflicts_lineage_fkey;
ALTER TABLE billing_association_evidence
    DROP CONSTRAINT billing_association_evidence_lineage_fkey,
    DROP COLUMN purchase_lineage_id;
DROP TABLE purchase_lineages;
