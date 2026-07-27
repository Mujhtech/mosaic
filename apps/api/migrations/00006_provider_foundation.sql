-- +goose Up
ALTER TABLE environments ADD COLUMN mode text;
UPDATE environments
SET mode = CASE key
    WHEN 'production' THEN 'production'
    WHEN 'staging' THEN 'staging'
    ELSE 'development'
END;
ALTER TABLE environments ALTER COLUMN mode SET NOT NULL;
ALTER TABLE environments
    ADD CONSTRAINT environments_mode_check CHECK (mode IN ('development', 'staging', 'production'));

ALTER TABLE applications
    ADD CONSTRAINT applications_id_project_platform_key UNIQUE (id, project_id, platform);

CREATE TABLE provider_connections (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (btrim(name) <> ''),
    provider text NOT NULL CHECK (provider IN ('revenuecat', 'custom')),
    integration_mode text NOT NULL CHECK (integration_mode IN ('server_connected', 'sdk_only')),
    mode text NOT NULL CHECK (mode IN ('sandbox', 'production')),
    status text NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
    health_status text NOT NULL CHECK (health_status IN ('untested', 'healthy', 'degraded', 'unavailable', 'revoked')),
    external_project_id text,
    last_successful_test_at timestamptz,
    last_successful_sync_at timestamptz,
    last_error_code text,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, name),
    UNIQUE (id, project_id),
    UNIQUE (id, project_id, provider),
    CHECK (
        (provider = 'revenuecat' AND integration_mode = 'server_connected') OR
        (provider = 'custom' AND integration_mode = 'sdk_only')
    ),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((status = 'revoked') = (health_status = 'revoked')),
    CHECK (external_project_id IS NULL OR btrim(external_project_id) <> '')
);
CREATE INDEX provider_connections_project_idx ON provider_connections(project_id, id);

CREATE TABLE provider_connection_environment_scopes (
    project_id text NOT NULL,
    connection_id text NOT NULL,
    environment_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (connection_id, environment_id),
    UNIQUE (project_id, connection_id, environment_id),
    FOREIGN KEY (connection_id, project_id) REFERENCES provider_connections(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX provider_connection_environment_scopes_environment_idx
    ON provider_connection_environment_scopes(environment_id, connection_id);

CREATE TABLE provider_connection_application_scopes (
    project_id text NOT NULL,
    connection_id text NOT NULL,
    application_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (connection_id, application_id),
    UNIQUE (project_id, connection_id, application_id),
    FOREIGN KEY (connection_id, project_id) REFERENCES provider_connections(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (application_id, project_id) REFERENCES applications(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX provider_connection_application_scopes_application_idx
    ON provider_connection_application_scopes(application_id, connection_id);

CREATE TABLE active_provider_assignments (
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    connection_id text NOT NULL,
    production_connection_use_acknowledged boolean NOT NULL DEFAULT false,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (environment_id, application_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id, platform) REFERENCES applications(id, project_id, platform) ON DELETE RESTRICT,
    FOREIGN KEY (connection_id, project_id) REFERENCES provider_connections(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, connection_id, environment_id)
        REFERENCES provider_connection_environment_scopes(project_id, connection_id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id, connection_id, application_id)
        REFERENCES provider_connection_application_scopes(project_id, connection_id, application_id) ON DELETE RESTRICT
);
CREATE INDEX active_provider_assignments_connection_idx
    ON active_provider_assignments(connection_id, environment_id, application_id);

ALTER TABLE provider_product_mappings
    DROP CONSTRAINT IF EXISTS provider_product_mappings_product_id_application_id_provide_key;
ALTER TABLE provider_product_mappings
    DROP CONSTRAINT IF EXISTS provider_product_mappings_product_id_application_id_provider_ke;
ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_status_check;
ALTER TABLE provider_product_mappings
    ADD COLUMN connection_id text,
    ADD COLUMN environment_id text,
    ADD COLUMN platform text,
    ADD COLUMN provider_package_identifier text,
    ADD COLUMN provider_offering_identifier text,
    ADD COLUMN expected_store_product_id text,
    ADD COLUMN availability text NOT NULL DEFAULT 'unknown',
    ADD COLUMN sync_state text NOT NULL DEFAULT 'never_synced',
    ADD COLUMN current_snapshot_id text,
    ADD COLUMN last_error_code text,
    ADD COLUMN archived_at timestamptz;

UPDATE provider_product_mappings mapping
SET platform = application.platform
FROM applications application
WHERE application.id = mapping.application_id;

ALTER TABLE provider_product_mappings
    ALTER COLUMN platform SET NOT NULL,
    ADD CONSTRAINT provider_product_mappings_status_check
        CHECK (status IN ('placeholder', 'draft', 'active', 'attention_required', 'archived')),
    ADD CONSTRAINT provider_product_mappings_availability_check
        CHECK (availability IN ('unknown', 'available', 'unavailable')),
    ADD CONSTRAINT provider_product_mappings_sync_state_check
        CHECK (sync_state IN ('never_synced', 'current', 'stale', 'failed')),
    ADD CONSTRAINT provider_product_mappings_platform_check
        CHECK (platform IN ('ios', 'android')),
    ADD CONSTRAINT provider_product_mappings_target_reference_check
        CHECK (btrim(provider_product_identifier) <> ''),
    ADD CONSTRAINT provider_product_mappings_target_metadata_text_check
        CHECK (
            (provider_package_identifier IS NULL OR btrim(provider_package_identifier) <> '') AND
            (provider_offering_identifier IS NULL OR btrim(provider_offering_identifier) <> '') AND
            (expected_store_product_id IS NULL OR btrim(expected_store_product_id) <> '')
        ),
    ADD CONSTRAINT provider_product_mappings_revenuecat_metadata_pair_check
        CHECK (
            (provider_package_identifier IS NULL AND provider_offering_identifier IS NULL) OR
            (
                provider = 'revenuecat' AND
                provider_package_identifier IS NOT NULL AND
                provider_offering_identifier IS NOT NULL
            )
        ),
    ADD CONSTRAINT provider_product_mappings_scope_shape_check
        CHECK (
            (status = 'placeholder' AND connection_id IS NULL AND environment_id IS NULL) OR
            (status <> 'placeholder' AND connection_id IS NOT NULL AND environment_id IS NOT NULL)
        ),
    ADD CONSTRAINT provider_product_mappings_archive_shape_check
        CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    ADD CONSTRAINT provider_product_mappings_id_project_key UNIQUE (id, project_id),
    ADD CONSTRAINT provider_product_mappings_application_platform_fkey
        FOREIGN KEY (application_id, project_id, platform)
        REFERENCES applications(id, project_id, platform) ON DELETE RESTRICT,
    ADD CONSTRAINT provider_product_mappings_connection_provider_fkey
        FOREIGN KEY (connection_id, project_id, provider)
        REFERENCES provider_connections(id, project_id, provider) ON DELETE RESTRICT,
    ADD CONSTRAINT provider_product_mappings_environment_scope_fkey
        FOREIGN KEY (project_id, connection_id, environment_id)
        REFERENCES provider_connection_environment_scopes(project_id, connection_id, environment_id) ON DELETE RESTRICT,
    ADD CONSTRAINT provider_product_mappings_application_scope_fkey
        FOREIGN KEY (project_id, connection_id, application_id)
        REFERENCES provider_connection_application_scopes(project_id, connection_id, application_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX provider_product_mappings_current_scope_key
    ON provider_product_mappings(product_id, connection_id, environment_id, application_id)
    WHERE status IN ('draft', 'active', 'attention_required');
CREATE UNIQUE INDEX provider_product_mappings_placeholder_scope_key
    ON provider_product_mappings(product_id, application_id, provider)
    WHERE status = 'placeholder';
CREATE UNIQUE INDEX provider_product_mappings_active_scope_key
    ON provider_product_mappings(product_id, environment_id, application_id, platform)
    WHERE status = 'active';
CREATE INDEX provider_product_mappings_connection_idx
    ON provider_product_mappings(connection_id, environment_id, application_id)
    WHERE connection_id IS NOT NULL;

CREATE TABLE provider_product_metadata_snapshots (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    mapping_id text NOT NULL,
    source text NOT NULL CHECK (source IN ('provider', 'sdk_snapshot', 'manual')),
    digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    availability text NOT NULL CHECK (availability IN ('unknown', 'available', 'unavailable')),
    observed_at timestamptz NOT NULL,
    synced_at timestamptz NOT NULL,
    expires_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    CHECK (expires_at IS NULL OR expires_at >= observed_at)
);
CREATE INDEX provider_product_metadata_snapshots_mapping_idx
    ON provider_product_metadata_snapshots(mapping_id, observed_at DESC, id);

ALTER TABLE provider_product_mappings
    ADD CONSTRAINT provider_product_mappings_current_snapshot_fkey
    FOREIGN KEY (current_snapshot_id, project_id)
    REFERENCES provider_product_metadata_snapshots(id, project_id) ON DELETE RESTRICT;

-- +goose StatementBegin
CREATE FUNCTION reject_provider_metadata_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'provider product metadata snapshots are immutable';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER provider_metadata_snapshots_immutable
BEFORE UPDATE OR DELETE ON provider_product_metadata_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_provider_metadata_snapshot_mutation();

-- Provider credentials are intentionally absent. ADR-0019 approves the cipher
-- boundary, but RevenueCat OAuth-vs-secret authorization is still an owner gate.

-- +goose Down
DROP TRIGGER provider_metadata_snapshots_immutable ON provider_product_metadata_snapshots;
DROP FUNCTION reject_provider_metadata_snapshot_mutation();
ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_current_snapshot_fkey;
DROP TABLE provider_product_metadata_snapshots;
DROP INDEX provider_product_mappings_connection_idx;
DROP INDEX provider_product_mappings_active_scope_key;
DROP INDEX provider_product_mappings_placeholder_scope_key;
DROP INDEX provider_product_mappings_current_scope_key;

-- The Phase 3A placeholder schema cannot represent real provider mappings, so a
-- rollback would have to delete them. Refuse instead of silently discarding
-- commerce configuration; recovery is restore-from-backup.
-- +goose StatementBegin
DO $$
DECLARE real_mappings bigint;
BEGIN
  SELECT count(*) INTO real_mappings FROM provider_product_mappings WHERE status <> 'placeholder';
  IF real_mappings > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('migration 00006 cannot be rolled back: %s non-placeholder provider Product mapping(s) would be deleted', real_mappings),
      HINT = 'Restore from a backup taken before the upgrade: see docs/backend/operations/backup-restore.md';
  END IF;
END
$$;
-- +goose StatementEnd

ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_application_scope_fkey,
    DROP CONSTRAINT provider_product_mappings_environment_scope_fkey,
    DROP CONSTRAINT provider_product_mappings_connection_provider_fkey,
    DROP CONSTRAINT provider_product_mappings_application_platform_fkey,
    DROP CONSTRAINT provider_product_mappings_id_project_key,
    DROP CONSTRAINT provider_product_mappings_archive_shape_check,
    DROP CONSTRAINT provider_product_mappings_scope_shape_check,
    DROP CONSTRAINT provider_product_mappings_platform_check,
    DROP CONSTRAINT provider_product_mappings_revenuecat_metadata_pair_check,
    DROP CONSTRAINT provider_product_mappings_target_metadata_text_check,
    DROP CONSTRAINT provider_product_mappings_target_reference_check,
    DROP CONSTRAINT provider_product_mappings_sync_state_check,
    DROP CONSTRAINT provider_product_mappings_availability_check,
    DROP CONSTRAINT provider_product_mappings_status_check,
    DROP COLUMN archived_at,
    DROP COLUMN last_error_code,
    DROP COLUMN current_snapshot_id,
    DROP COLUMN sync_state,
    DROP COLUMN availability,
    DROP COLUMN expected_store_product_id,
    DROP COLUMN provider_offering_identifier,
    DROP COLUMN provider_package_identifier,
    DROP COLUMN platform,
    DROP COLUMN environment_id,
    DROP COLUMN connection_id,
    ADD CONSTRAINT provider_product_mappings_status_check CHECK (status = 'placeholder'),
    ADD CONSTRAINT provider_product_mappings_product_id_application_id_provide_key
        UNIQUE (product_id, application_id, provider);

DROP TABLE active_provider_assignments;
DROP TABLE provider_connection_application_scopes;
DROP TABLE provider_connection_environment_scopes;
DROP TABLE provider_connections;
ALTER TABLE applications DROP CONSTRAINT applications_id_project_platform_key;
ALTER TABLE environments DROP CONSTRAINT environments_mode_check;
ALTER TABLE environments DROP COLUMN mode;
