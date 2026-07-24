-- +goose Up
ALTER TABLE active_provider_assignments
    ADD COLUMN provider text,
    ADD COLUMN activation_kind text;

UPDATE active_provider_assignments assignment
SET provider = connection.provider,
    activation_kind = 'provider_connection'
FROM provider_connections connection
WHERE connection.id = assignment.connection_id;

ALTER TABLE active_provider_assignments
    ALTER COLUMN provider SET NOT NULL,
    ALTER COLUMN activation_kind SET NOT NULL,
    ALTER COLUMN connection_id DROP NOT NULL,
    ADD CONSTRAINT active_provider_assignments_provider_check
        CHECK (provider IN ('revenuecat', 'app_store', 'google_play', 'custom')),
    ADD CONSTRAINT active_provider_assignments_activation_kind_check
        CHECK (activation_kind IN ('provider_connection', 'native_store')),
    ADD CONSTRAINT active_provider_assignments_activation_shape_check
        CHECK (
            (
                activation_kind = 'provider_connection' AND
                provider IN ('revenuecat', 'custom') AND
                connection_id IS NOT NULL
            ) OR
            (
                activation_kind = 'native_store' AND
                connection_id IS NULL AND
                (
                    (provider = 'app_store' AND platform = 'ios') OR
                    (provider = 'google_play' AND platform = 'android')
                )
            )
        ),
    ADD CONSTRAINT active_provider_assignments_connection_provider_fkey
        FOREIGN KEY (connection_id, project_id, provider)
        REFERENCES provider_connections(id, project_id, provider) ON DELETE RESTRICT;

DROP INDEX active_provider_assignments_connection_idx;
CREATE INDEX active_provider_assignments_connection_idx
    ON active_provider_assignments(connection_id, environment_id, application_id)
    WHERE connection_id IS NOT NULL;
CREATE INDEX active_provider_assignments_native_idx
    ON active_provider_assignments(provider, environment_id, application_id)
    WHERE activation_kind = 'native_store';

ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_scope_shape_check,
    DROP CONSTRAINT provider_product_mappings_connection_provider_fkey,
    ADD COLUMN provider_base_plan_identifier text,
    ADD COLUMN provider_offer_identifier text,
    ADD COLUMN replaces_mapping_id text,
    ADD CONSTRAINT provider_product_mappings_native_fields_check
        CHECK (
            (provider_base_plan_identifier IS NULL OR btrim(provider_base_plan_identifier) <> '') AND
            (provider_offer_identifier IS NULL OR btrim(provider_offer_identifier) <> '') AND
            (
                provider = 'google_play' OR
                (provider_base_plan_identifier IS NULL AND provider_offer_identifier IS NULL)
            ) AND
            (provider_offer_identifier IS NULL OR provider_base_plan_identifier IS NOT NULL)
        ),
    ADD CONSTRAINT provider_product_mappings_scope_shape_check
        CHECK (
            (
                status = 'placeholder' AND
                connection_id IS NULL AND
                environment_id IS NULL
            ) OR
            (
                status <> 'placeholder' AND
                environment_id IS NOT NULL AND
                (
                    (provider IN ('revenuecat', 'custom') AND connection_id IS NOT NULL) OR
                    (provider IN ('app_store', 'google_play') AND connection_id IS NULL)
                )
            )
        ),
    ADD CONSTRAINT provider_product_mappings_native_platform_check
        CHECK (
            provider NOT IN ('app_store', 'google_play') OR
            (provider = 'app_store' AND platform = 'ios') OR
            (provider = 'google_play' AND platform = 'android')
        ),
    ADD CONSTRAINT provider_product_mappings_connection_provider_fkey
        FOREIGN KEY (connection_id, project_id, provider)
        REFERENCES provider_connections(id, project_id, provider) ON DELETE RESTRICT,
    ADD CONSTRAINT provider_product_mappings_environment_project_fkey
        FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT provider_product_mappings_replaces_fkey
        FOREIGN KEY (replaces_mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    ADD CONSTRAINT provider_product_mappings_replaces_unique UNIQUE (replaces_mapping_id);

DROP INDEX provider_product_mappings_active_scope_key;
DROP INDEX provider_product_mappings_current_scope_key;
CREATE UNIQUE INDEX provider_product_mappings_connected_current_scope_key
    ON provider_product_mappings(product_id, connection_id, environment_id, application_id, platform)
    WHERE connection_id IS NOT NULL AND status IN ('draft', 'active', 'attention_required');
CREATE UNIQUE INDEX provider_product_mappings_native_current_scope_key
    ON provider_product_mappings(product_id, provider, environment_id, application_id, platform)
    WHERE connection_id IS NULL AND environment_id IS NOT NULL
      AND status IN ('draft', 'active', 'attention_required');
CREATE UNIQUE INDEX provider_product_mappings_native_current_target_key
    ON provider_product_mappings(provider, environment_id, application_id, platform, provider_product_identifier)
    WHERE connection_id IS NULL AND environment_id IS NOT NULL
      AND status IN ('draft', 'active', 'attention_required');

CREATE TABLE provider_mapping_observations (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    mapping_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    adapter_version text NOT NULL CHECK (btrim(adapter_version) <> '' AND length(adapter_version) <= 64),
    store_context text NOT NULL CHECK (
        store_context IN ('storekitConfiguration', 'appleSandbox', 'googlePlayTest', 'production', 'unknown')
    ),
    result text NOT NULL CHECK (result IN ('available', 'unavailable', 'failed')),
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    correlation_id text NOT NULL CHECK (btrim(correlation_id) <> '' AND length(correlation_id) <= 128),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_at timestamptz NOT NULL,
    expires_at timestamptz,
    received_at timestamptz NOT NULL,
    created_by_actor_id text NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (mapping_id, project_id)
        REFERENCES provider_product_mappings(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id)
        REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id, platform)
        REFERENCES applications(id, project_id, platform) ON DELETE RESTRICT,
    CHECK ((provider = 'app_store' AND platform = 'ios') OR (provider = 'google_play' AND platform = 'android')),
    CHECK (expires_at IS NULL OR expires_at >= observed_at),
    CHECK (received_at >= observed_at - interval '5 minutes'),
    CONSTRAINT provider_mapping_observations_safe_metadata_check CHECK (
        jsonb_typeof(metadata) = 'object' AND
        octet_length(metadata::text) <= 1024 AND
        metadata - 'clientPlatform' - 'clientVersion' - 'applicationVersion' -
            'osVersion' - 'configurationSource' - 'storefrontCountryCode' -
            'testScenario' = '{}'::jsonb AND
        (NOT metadata ? 'clientPlatform' OR (
            jsonb_typeof(metadata->'clientPlatform') = 'string' AND
            metadata->>'clientPlatform' IN ('ios', 'android', 'flutter')
        )) AND
        (NOT metadata ? 'clientVersion' OR (
            jsonb_typeof(metadata->'clientVersion') = 'string' AND
            metadata->>'clientVersion' ~ '^[ -~]{0,64}$'
        )) AND
        (NOT metadata ? 'applicationVersion' OR (
            jsonb_typeof(metadata->'applicationVersion') = 'string' AND
            metadata->>'applicationVersion' ~ '^[ -~]{0,64}$'
        )) AND
        (NOT metadata ? 'osVersion' OR (
            jsonb_typeof(metadata->'osVersion') = 'string' AND
            metadata->>'osVersion' ~ '^[ -~]{0,64}$'
        )) AND
        (NOT metadata ? 'configurationSource' OR (
            jsonb_typeof(metadata->'configurationSource') = 'string' AND
            metadata->>'configurationSource' IN ('bundled', 'remote', 'local', 'unknown')
        )) AND
        (NOT metadata ? 'storefrontCountryCode' OR (
            jsonb_typeof(metadata->'storefrontCountryCode') = 'string' AND
            metadata->>'storefrontCountryCode' ~ '^[A-Z]{2}$'
        )) AND
        (NOT metadata ? 'testScenario' OR (
            jsonb_typeof(metadata->'testScenario') = 'string' AND
            metadata->>'testScenario' IN ('productLoad', 'configurationAcceptance', 'purchasePresentation', 'restore')
        )) AND
        lower(metadata::text) !~ '(receipt|token|credential|customer|account|authorization|secret|password|bearer)'
    )
);
CREATE INDEX provider_mapping_observations_mapping_history_idx
    ON provider_mapping_observations(mapping_id, observed_at DESC, id DESC);

-- +goose StatementBegin
CREATE FUNCTION reject_provider_mapping_observation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'provider mapping observations are immutable';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER provider_mapping_observations_immutable
BEFORE UPDATE OR DELETE ON provider_mapping_observations
FOR EACH ROW EXECUTE FUNCTION reject_provider_mapping_observation_mutation();

-- +goose StatementBegin
CREATE FUNCTION reject_archived_provider_mapping_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'archived' THEN
        RAISE EXCEPTION 'archived provider mappings are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER provider_product_mappings_archived_immutable
BEFORE UPDATE OR DELETE ON provider_product_mappings
FOR EACH ROW EXECUTE FUNCTION reject_archived_provider_mapping_mutation();

-- +goose Down
DROP TRIGGER provider_product_mappings_archived_immutable ON provider_product_mappings;
DROP FUNCTION reject_archived_provider_mapping_mutation();
DROP TRIGGER provider_mapping_observations_immutable ON provider_mapping_observations;
DROP FUNCTION reject_provider_mapping_observation_mutation();
DROP TABLE provider_mapping_observations;
DROP INDEX provider_product_mappings_native_current_target_key;
DROP INDEX provider_product_mappings_native_current_scope_key;
DROP INDEX provider_product_mappings_connected_current_scope_key;
CREATE UNIQUE INDEX provider_product_mappings_active_scope_key
    ON provider_product_mappings(product_id, environment_id, application_id, platform)
    WHERE status = 'active';
CREATE UNIQUE INDEX provider_product_mappings_current_scope_key
    ON provider_product_mappings(product_id, connection_id, environment_id, application_id)
    WHERE status IN ('draft', 'active', 'attention_required');

ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_replaces_unique,
    DROP CONSTRAINT provider_product_mappings_replaces_fkey,
    DROP CONSTRAINT provider_product_mappings_environment_project_fkey,
    DROP CONSTRAINT provider_product_mappings_connection_provider_fkey,
    DROP CONSTRAINT provider_product_mappings_native_platform_check,
    DROP CONSTRAINT provider_product_mappings_scope_shape_check,
    DROP CONSTRAINT provider_product_mappings_native_fields_check,
    DROP COLUMN replaces_mapping_id,
    DROP COLUMN provider_offer_identifier,
    DROP COLUMN provider_base_plan_identifier,
    ADD CONSTRAINT provider_product_mappings_scope_shape_check
        CHECK (
            (status = 'placeholder' AND connection_id IS NULL AND environment_id IS NULL) OR
            (status <> 'placeholder' AND connection_id IS NOT NULL AND environment_id IS NOT NULL)
        ),
    ADD CONSTRAINT provider_product_mappings_connection_provider_fkey
        FOREIGN KEY (connection_id, project_id, provider)
        REFERENCES provider_connections(id, project_id, provider) ON DELETE RESTRICT;

DROP INDEX active_provider_assignments_native_idx;
DROP INDEX active_provider_assignments_connection_idx;
CREATE INDEX active_provider_assignments_connection_idx
    ON active_provider_assignments(connection_id, environment_id, application_id);

ALTER TABLE active_provider_assignments
    DROP CONSTRAINT active_provider_assignments_connection_provider_fkey,
    DROP CONSTRAINT active_provider_assignments_activation_shape_check,
    DROP CONSTRAINT active_provider_assignments_activation_kind_check,
    DROP CONSTRAINT active_provider_assignments_provider_check,
    ALTER COLUMN connection_id SET NOT NULL,
    DROP COLUMN activation_kind,
    DROP COLUMN provider;
