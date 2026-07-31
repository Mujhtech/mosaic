-- +goose Up
CREATE TABLE provider_connection_credentials (
    connection_id text PRIMARY KEY,
    project_id text NOT NULL,
    organization_id text NOT NULL,
    credential_class text NOT NULL CHECK (credential_class = 'serverSecret'),
    envelope_version integer NOT NULL CHECK (envelope_version = 1),
    algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
    key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 64 AND key_id ~ '^[ -~]+$'),
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
    ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) >= 16),
    fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
    created_at timestamptz NOT NULL,
    rotated_at timestamptz,
    revoked_at timestamptz,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (connection_id, project_id)
        REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    CHECK (rotated_at IS NULL OR rotated_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX provider_connection_credentials_key_rotation_idx
    ON provider_connection_credentials(key_id, connection_id)
    WHERE revoked_at IS NULL;

CREATE TABLE provider_diagnostics (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    connection_id text NOT NULL,
    operation text NOT NULL CHECK (operation IN ('test', 'preview', 'import', 'mapping_replace', 'sync')),
    code text NOT NULL CHECK (btrim(code) <> ''),
    retryable boolean NOT NULL,
    retry_after_seconds integer CHECK (retry_after_seconds IS NULL OR retry_after_seconds >= 0),
    correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
    occurred_at timestamptz NOT NULL,
    FOREIGN KEY (connection_id, project_id)
        REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX provider_diagnostics_connection_history_idx
    ON provider_diagnostics(connection_id, occurred_at DESC, id);

CREATE TABLE provider_entitlement_mappings (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    entitlement_id text NOT NULL,
    connection_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    provider_entitlement_identifier text NOT NULL CHECK (btrim(provider_entitlement_identifier) <> ''),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    archived_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (entitlement_id, project_id)
        REFERENCES entitlements(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (connection_id, project_id)
        REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, connection_id, environment_id)
        REFERENCES provider_connection_environment_scopes(project_id, connection_id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, connection_id, application_id)
        REFERENCES provider_connection_application_scopes(project_id, connection_id, application_id) ON DELETE RESTRICT,
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX provider_entitlement_mappings_active_scope_key
    ON provider_entitlement_mappings(entitlement_id, connection_id, environment_id, application_id)
    WHERE status = 'active';
CREATE UNIQUE INDEX provider_entitlement_mappings_active_provider_key
    ON provider_entitlement_mappings(provider_entitlement_identifier, connection_id, environment_id, application_id)
    WHERE status = 'active';
CREATE INDEX provider_entitlement_mappings_connection_scope_idx
    ON provider_entitlement_mappings(connection_id, environment_id, application_id)
    WHERE status = 'active';

CREATE TABLE provider_import_requests (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    connection_id text NOT NULL,
    idempotency_key_hash bytea NOT NULL CHECK (octet_length(idempotency_key_hash) = 32),
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'partial')),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    completed_at timestamptz,
    UNIQUE (project_id, idempotency_key_hash),
    UNIQUE (id, project_id),
    FOREIGN KEY (connection_id, project_id)
        REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'in_progress') = (completed_at IS NULL))
);
CREATE INDEX provider_import_requests_connection_history_idx
    ON provider_import_requests(connection_id, created_at DESC, id);

CREATE TABLE provider_import_items (
    import_id text NOT NULL,
    project_id text NOT NULL,
    provider_product_identifier text NOT NULL CHECK (btrim(provider_product_identifier) <> ''),
    mosaic_product_id text,
    mapping_id text,
    status text NOT NULL CHECK (status IN ('imported', 'failed')),
    error_code text,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (import_id, provider_product_identifier),
    FOREIGN KEY (import_id, project_id)
        REFERENCES provider_import_requests(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mosaic_product_id, project_id)
        REFERENCES products(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    CHECK (
        (status = 'imported' AND mosaic_product_id IS NOT NULL AND mapping_id IS NOT NULL AND error_code IS NULL) OR
        (status = 'failed' AND error_code IS NOT NULL)
    )
);

CREATE TABLE provider_sync_jobs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    connection_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    requested_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (connection_id, project_id)
        REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT,
    CHECK (
        (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
        (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    )
);
CREATE INDEX provider_sync_jobs_lease_idx
    ON provider_sync_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');
CREATE UNIQUE INDEX provider_sync_jobs_one_open_connection_key
    ON provider_sync_jobs(connection_id)
    WHERE status IN ('queued', 'leased');

CREATE TABLE provider_sync_runs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    connection_id text NOT NULL,
    job_id text NOT NULL UNIQUE REFERENCES provider_sync_jobs(id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (connection_id, project_id)
        REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT,
    CHECK (success_count + failure_count <= item_count),
    CHECK ((status = 'running') = (completed_at IS NULL))
);
CREATE INDEX provider_sync_runs_connection_history_idx
    ON provider_sync_runs(connection_id, started_at DESC, id);

CREATE TABLE provider_sync_run_items (
    run_id text NOT NULL,
    project_id text NOT NULL,
    mapping_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('synchronized', 'failed')),
    snapshot_id text,
    error_code text,
    completed_at timestamptz NOT NULL,
    PRIMARY KEY (run_id, mapping_id),
    FOREIGN KEY (run_id, project_id)
        REFERENCES provider_sync_runs(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (snapshot_id, project_id)
        REFERENCES provider_product_metadata_snapshots(id, project_id) ON DELETE RESTRICT,
    CHECK (
        (status = 'synchronized' AND snapshot_id IS NOT NULL AND error_code IS NULL) OR
        (status = 'failed' AND snapshot_id IS NULL AND error_code IS NOT NULL)
    )
);

-- Migration 00006 makes metadata snapshots immutable. Temporarily remove only
-- that trigger while this migration backfills the new freshness boundary in
-- the same transaction, then restore it before accepting application traffic.
DROP TRIGGER provider_metadata_snapshots_immutable ON provider_product_metadata_snapshots;

ALTER TABLE provider_product_metadata_snapshots
    ADD COLUMN normalized_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(normalized_metadata) = 'object'),
    ADD COLUMN stale_at timestamptz;
UPDATE provider_product_metadata_snapshots SET stale_at = expires_at;
UPDATE provider_product_metadata_snapshots SET stale_at = synced_at WHERE stale_at IS NULL;
ALTER TABLE provider_product_metadata_snapshots
    ALTER COLUMN stale_at SET NOT NULL,
    ADD CONSTRAINT provider_product_metadata_snapshots_stale_order_check
        CHECK (stale_at >= observed_at),
    ADD CONSTRAINT provider_product_metadata_snapshots_expiry_order_check
        CHECK (expires_at IS NULL OR expires_at >= stale_at);

CREATE TRIGGER provider_metadata_snapshots_immutable
BEFORE UPDATE OR DELETE ON provider_product_metadata_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_provider_metadata_snapshot_mutation();

CREATE TABLE commerce_configuration_snapshots (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    store_platform text NOT NULL CHECK (store_platform IN ('ios', 'android')),
    configuration_release_id text NOT NULL,
    configuration_release_digest text NOT NULL CHECK (configuration_release_digest ~ '^sha256:[0-9a-f]{64}$'),
    content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL,
    UNIQUE (configuration_release_id, application_id, store_platform),
    UNIQUE (id, environment_id),
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id, store_platform)
        REFERENCES applications(id, project_id, platform) ON DELETE RESTRICT,
    FOREIGN KEY (configuration_release_id, environment_id)
        REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT
);
CREATE INDEX commerce_configuration_delivery_idx
    ON commerce_configuration_snapshots(environment_id, application_id, configuration_release_id);

-- +goose StatementBegin
CREATE FUNCTION reject_commerce_configuration_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'commerce configuration snapshots are immutable';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER commerce_configuration_snapshots_immutable
BEFORE UPDATE OR DELETE ON commerce_configuration_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_commerce_configuration_snapshot_mutation();

-- +goose Down
DROP TRIGGER commerce_configuration_snapshots_immutable ON commerce_configuration_snapshots;
DROP FUNCTION reject_commerce_configuration_snapshot_mutation();
DROP TABLE commerce_configuration_snapshots;
ALTER TABLE provider_product_metadata_snapshots
    DROP CONSTRAINT provider_product_metadata_snapshots_expiry_order_check,
    DROP CONSTRAINT provider_product_metadata_snapshots_stale_order_check,
    DROP COLUMN stale_at,
    DROP COLUMN normalized_metadata;
DROP TABLE provider_sync_run_items;
DROP TABLE provider_sync_runs;
DROP TABLE provider_sync_jobs;
DROP TABLE provider_import_items;
DROP TABLE provider_import_requests;
DROP TABLE provider_entitlement_mappings;
DROP TABLE provider_diagnostics;
DROP TABLE provider_connection_credentials;
