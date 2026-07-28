-- Phase 9B: Billing Customers, aliases, association evidence, and identity
-- conflicts (plan §5, §5a; OD-2(b), OD-3(b), OD-4(a), OD-7(a), OD-10(a)).
--
-- A Billing Customer is Project-scoped identity; everything that holds state
-- (lineages, instances, snapshots, pointers, tokens) is Environment-scoped in
-- later migrations. Customers are created lazily — by a trusted backend
-- identify or by a validated fact that needs somewhere to attach — never by
-- SDK init or installation registration.
--
-- Aliases are the erasable PII surface (the person-to-purchase link): values
-- are SHA-256 digests under the domain separation 'mosaic-billing-alias-v1',
-- never raw. There is deliberately NO foreign key into any analytics identity
-- table: the Phase 6 deletion job hard-deletes analytics identity rows, and a
-- RESTRICT here would break accepted deletion behaviour while a CASCADE would
-- silently revoke entitlements (OD-7 hard constraint).

-- +goose Up
CREATE TABLE billing_customers (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'anonymized')),
    -- Projection bookkeeping. The version is the CAS belt worn alongside the
    -- advisory-lock braces; a no-change projection advances last_projected_at
    -- without minting a snapshot version.
    current_projection_version bigint NOT NULL DEFAULT 0 CHECK (current_projection_version >= 0),
    last_projected_at timestamptz,
    diagnostics_status text NOT NULL DEFAULT 'none' CHECK (diagnostics_status IN (
        'none', 'identity_conflict', 'projection_stale', 'projection_failed'
    )),
    anonymized_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    CHECK ((status = 'anonymized') = (anonymized_at IS NOT NULL))
);
CREATE INDEX billing_customers_project_idx ON billing_customers(project_id, created_at DESC, id);

CREATE TABLE billing_customer_aliases (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    billing_customer_id text NOT NULL,
    alias_type text NOT NULL CHECK (alias_type IN (
        'application_user_id', 'installation_id',
        'apple_app_account_token', 'google_obfuscated_account_id'
    )),
    -- SHA-256 digest of the raw value under 'mosaic-billing-alias-v1' domain
    -- separation. The raw value is never stored anywhere in this schema.
    alias_digest bytea NOT NULL CHECK (octet_length(alias_digest) = 32),
    source_authority text NOT NULL CHECK (source_authority IN (
        'trusted_server', 'sdk_installation', 'provider_payload', 'operator', 'restore'
    )),
    verification_status text NOT NULL DEFAULT 'asserted' CHECK (verification_status IN ('asserted', 'verified')),
    effective_start timestamptz NOT NULL,
    -- End-dated history: a revoked or superseded alias keeps its row with
    -- effective_end set. Only one active resolution may exist per
    -- (project, type, digest) at a time.
    effective_end timestamptz,
    revoked_by_actor_id text,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);
CREATE UNIQUE INDEX billing_customer_aliases_active_resolution_idx
    ON billing_customer_aliases(project_id, alias_type, alias_digest)
    WHERE effective_end IS NULL;
CREATE INDEX billing_customer_aliases_customer_idx
    ON billing_customer_aliases(billing_customer_id, alias_type, effective_start DESC);

-- Association evidence is append-only forensic history: every observation the
-- resolver considered, with its outcome. The purchase-lineage linkage column
-- is added in migration 00031, after purchase_lineages exists.
CREATE TABLE billing_association_evidence (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text,
    evidence_type text NOT NULL CHECK (evidence_type IN (
        'app_account_token', 'obfuscated_external_account_id',
        'trusted_server_observation', 'prior_lineage_association',
        'restore_link', 'operator_repair', 'installation_observation'
    )),
    -- Digest of the correlator value (same alias domain separation). Nullable:
    -- prior_lineage_association carries no correlator value of its own.
    evidence_digest bytea CHECK (evidence_digest IS NULL OR octet_length(evidence_digest) = 32),
    raw_input_id text,
    transaction_reference_digest bytea CHECK (
        transaction_reference_digest IS NULL OR octet_length(transaction_reference_digest) = 32
    ),
    billing_customer_id text,
    resolver_version integer NOT NULL CHECK (resolver_version >= 1),
    outcome text NOT NULL CHECK (outcome IN ('resolved', 'unresolved', 'conflicting', 'unsupported')),
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    observed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (raw_input_id, project_id)
        REFERENCES billing_raw_inputs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (billing_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX billing_association_evidence_reference_idx
    ON billing_association_evidence(transaction_reference_digest)
    WHERE transaction_reference_digest IS NOT NULL;
CREATE INDEX billing_association_evidence_customer_idx
    ON billing_association_evidence(billing_customer_id, observed_at DESC)
    WHERE billing_customer_id IS NOT NULL;

CREATE TRIGGER billing_association_evidence_append_only
BEFORE UPDATE OR DELETE ON billing_association_evidence
FOR EACH ROW EXECUTE FUNCTION reject_billing_append_only_change();

-- One open conflict per disputed lineage (OD-10(a)): projection freezes, the
-- last committed state is preserved, and resolution is an explicit audited
-- operator action. The lineage FK is added in 00031.
CREATE TABLE billing_identity_conflicts (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    purchase_lineage_id text NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    first_customer_id text NOT NULL,
    second_customer_id text NOT NULL,
    detected_by_evidence_id text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
        jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048
    ),
    opened_at timestamptz NOT NULL,
    resolved_at timestamptz,
    resolved_by_actor_id text,
    resolution_action text CHECK (resolution_action IS NULL OR resolution_action IN (
        'assigned_first', 'assigned_second', 'detached_both'
    )),
    UNIQUE (id, project_id),
    FOREIGN KEY (first_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (second_customer_id, project_id)
        REFERENCES billing_customers(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (detected_by_evidence_id, project_id)
        REFERENCES billing_association_evidence(id, project_id) ON DELETE RESTRICT,
    CHECK (first_customer_id <> second_customer_id),
    CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
    CHECK ((status = 'resolved') = (resolution_action IS NOT NULL))
);
CREATE UNIQUE INDEX billing_identity_conflicts_open_idx
    ON billing_identity_conflicts(purchase_lineage_id)
    WHERE status = 'open';

-- +goose Down
DROP TABLE billing_identity_conflicts;
DROP TRIGGER billing_association_evidence_append_only ON billing_association_evidence;
DROP TABLE billing_association_evidence;
DROP TABLE billing_customer_aliases;
DROP TABLE billing_customers;
