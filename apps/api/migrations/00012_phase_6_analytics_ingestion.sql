-- +goose Up
ALTER TABLE api_keys
    ADD COLUMN application_id text,
    ADD COLUMN application_project_id text,
    ADD CONSTRAINT api_keys_application_shape_check CHECK ((application_id IS NULL) = (application_project_id IS NULL)),
    ADD CONSTRAINT api_keys_application_project_fk FOREIGN KEY (application_id, application_project_id)
        REFERENCES applications(id, project_id) ON DELETE RESTRICT;

-- +goose StatementBegin
CREATE FUNCTION enforce_api_key_application_environment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.application_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM environments e WHERE e.id=NEW.environment_id AND e.project_id=NEW.application_project_id
    ) THEN
        RAISE EXCEPTION 'API key Application must belong to the Environment Project' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='secret_server' AND NEW.application_id IS NOT NULL THEN
        RAISE EXCEPTION 'secret server API keys are not Application-bound' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER api_keys_application_environment_scope
BEFORE INSERT OR UPDATE OF environment_id,kind,application_id,application_project_id ON api_keys
FOR EACH ROW EXECUTE FUNCTION enforce_api_key_application_environment_scope();

CREATE TABLE analytics_environment_settings (
    environment_id text PRIMARY KEY,
    project_id text NOT NULL,
    collection_enabled boolean NOT NULL DEFAULT false,
    raw_retention_days integer NOT NULL DEFAULT 180 CHECK (raw_retention_days BETWEEN 30 AND 730),
    updated_by_actor_id text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
INSERT INTO analytics_environment_settings(environment_id, project_id)
SELECT id, project_id FROM environments;

-- +goose StatementBegin
CREATE FUNCTION initialize_analytics_environment_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO analytics_environment_settings(environment_id, project_id)
    VALUES(NEW.id, NEW.project_id) ON CONFLICT(environment_id) DO NOTHING;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER initialize_analytics_environment_settings
AFTER INSERT ON environments FOR EACH ROW EXECUTE FUNCTION initialize_analytics_environment_settings();

CREATE TABLE analytics_subjects (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (kind IN ('installation', 'application_user')),
    created_at timestamptz NOT NULL,
    deleted_at timestamptz,
    UNIQUE (id, project_id)
);

CREATE TABLE analytics_installations (
    id text PRIMARY KEY,
    subject_id text NOT NULL,
    project_id text NOT NULL,
    application_id text NOT NULL,
    external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 256),
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    last_identity_generation bigint NOT NULL DEFAULT 0 CHECK (last_identity_generation >= 0),
    deleted_at timestamptz,
    UNIQUE (project_id, application_id, external_id),
    UNIQUE (id, project_id),
    FOREIGN KEY (subject_id, project_id) REFERENCES analytics_subjects(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id) REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE analytics_application_users (
    id text PRIMARY KEY,
    subject_id text NOT NULL,
    project_id text NOT NULL,
    external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 256),
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    deleted_at timestamptz,
    UNIQUE (project_id, external_id),
    UNIQUE (id, project_id),
    FOREIGN KEY (subject_id, project_id) REFERENCES analytics_subjects(id, project_id) ON DELETE RESTRICT,
    CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE analytics_identity_aliases (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    installation_id text NOT NULL,
    application_user_id text NOT NULL,
    identity_generation bigint NOT NULL CHECK (identity_generation >= 0),
    effective_at timestamptz NOT NULL,
    ended_at timestamptz,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (installation_id, project_id) REFERENCES analytics_installations(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_user_id, project_id) REFERENCES analytics_application_users(id, project_id) ON DELETE RESTRICT,
    CHECK (ended_at IS NULL OR ended_at >= effective_at)
);
CREATE UNIQUE INDEX analytics_identity_aliases_active_installation_idx
    ON analytics_identity_aliases(installation_id) WHERE ended_at IS NULL;
CREATE INDEX analytics_identity_aliases_user_idx
    ON analytics_identity_aliases(project_id, application_user_id, effective_at);

CREATE TABLE analytics_sessions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    client_session_id text NOT NULL CHECK (char_length(client_session_id) BETWEEN 1 AND 256),
    installation_id text NOT NULL,
    application_user_id text,
    identity_generation bigint NOT NULL CHECK (identity_generation >= 0),
    started_at timestamptz NOT NULL,
    last_occurred_at timestamptz NOT NULL,
    last_received_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (environment_id, client_session_id),
    UNIQUE (id, project_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id) REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (installation_id, project_id) REFERENCES analytics_installations(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_user_id, project_id) REFERENCES analytics_application_users(id, project_id) ON DELETE RESTRICT,
    CHECK (last_occurred_at >= started_at)
);
CREATE INDEX analytics_sessions_installation_idx ON analytics_sessions(project_id, installation_id);
CREATE INDEX analytics_sessions_user_idx ON analytics_sessions(project_id, application_user_id)
    WHERE application_user_id IS NOT NULL;

CREATE TABLE analytics_ingestion_batches (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    api_key_id text NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
    client_batch_id text NOT NULL CHECK (char_length(client_batch_id) BETWEEN 1 AND 256),
    event_count integer NOT NULL CHECK (event_count BETWEEN 1 AND 100),
    received_at timestamptz NOT NULL,
    UNIQUE (environment_id, client_batch_id),
    UNIQUE (id, environment_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);

CREATE TABLE analytics_events (
    row_id bigserial PRIMARY KEY,
    event_id text NOT NULL CHECK (char_length(event_id) BETWEEN 1 AND 256),
    project_id text NOT NULL,
    environment_id text NOT NULL,
    application_id text NOT NULL,
    ingestion_batch_id text NOT NULL,
    api_key_id text NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
    event_schema_version text NOT NULL CHECK (event_schema_version = '1'),
    event_name text NOT NULL,
    authority text NOT NULL CHECK (authority IN ('client_observed', 'trusted_server', 'provider_confirmed')),
    occurred_at timestamptz NOT NULL,
    queued_at timestamptz NOT NULL,
    sent_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    installation_id text NOT NULL,
    application_user_id text,
    subject_id text NOT NULL,
    session_id text NOT NULL,
    identity_generation bigint NOT NULL CHECK (identity_generation >= 0),
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    sdk_version text NOT NULL,
    operating_system_version text,
    application_version text,
    locale text,
    configuration_release_id text,
    placement_id text,
    placement_rule_set_id text,
    placement_rule_set_version bigint,
    winning_rule_id text,
    paywall_id text,
    paywall_version_id text,
    product_id text,
    plan_id text,
    provider text,
    provider_mapping_id text,
    placement_request_id text,
    paywall_presentation_id text,
    product_load_attempt_id text,
    purchase_attempt_id text,
    restore_attempt_id text,
    provider_operation_id text,
    provider_update_id text,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    canonical_digest bytea NOT NULL CHECK (octet_length(canonical_digest) = 32),
    UNIQUE (environment_id, event_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, project_id) REFERENCES applications(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (ingestion_batch_id, environment_id) REFERENCES analytics_ingestion_batches(id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (installation_id, project_id) REFERENCES analytics_installations(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_user_id, project_id) REFERENCES analytics_application_users(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (subject_id, project_id) REFERENCES analytics_subjects(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (session_id, project_id) REFERENCES analytics_sessions(id, project_id) ON DELETE RESTRICT,
    CHECK (expires_at >= received_at)
);
CREATE INDEX analytics_events_environment_time_idx
    ON analytics_events(environment_id, occurred_at, event_name);
CREATE INDEX analytics_events_retention_idx
    ON analytics_events(environment_id, received_at, row_id);
CREATE INDEX analytics_events_installation_idx
    ON analytics_events(project_id, installation_id, occurred_at);
CREATE INDEX analytics_events_user_idx
    ON analytics_events(project_id, application_user_id, occurred_at)
    WHERE application_user_id IS NOT NULL;
CREATE INDEX analytics_events_presentation_idx
    ON analytics_events(environment_id, paywall_presentation_id, event_name)
    WHERE paywall_presentation_id IS NOT NULL;
CREATE INDEX analytics_events_purchase_attempt_idx
    ON analytics_events(environment_id, purchase_attempt_id, event_name)
    WHERE purchase_attempt_id IS NOT NULL;

-- Raw events are update-immutable. Retention and privacy deletion are the only delete paths.
-- +goose StatementBegin
CREATE FUNCTION reject_analytics_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'analytics events are append-only' USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER analytics_events_no_update BEFORE UPDATE ON analytics_events
FOR EACH ROW EXECUTE FUNCTION reject_analytics_event_update();

-- +goose Down
DROP TRIGGER analytics_events_no_update ON analytics_events;
DROP FUNCTION reject_analytics_event_update();
DROP TABLE analytics_events;
DROP TABLE analytics_ingestion_batches;
DROP TABLE analytics_sessions;
DROP TABLE analytics_identity_aliases;
DROP TABLE analytics_application_users;
DROP TABLE analytics_installations;
DROP TABLE analytics_subjects;
DROP TRIGGER initialize_analytics_environment_settings ON environments;
DROP FUNCTION initialize_analytics_environment_settings();
DROP TABLE analytics_environment_settings;
DROP TRIGGER api_keys_application_environment_scope ON api_keys;
DROP FUNCTION enforce_api_key_application_environment_scope();
ALTER TABLE api_keys DROP CONSTRAINT api_keys_application_project_fk;
ALTER TABLE api_keys DROP CONSTRAINT api_keys_application_shape_check;
ALTER TABLE api_keys DROP COLUMN application_project_id;
ALTER TABLE api_keys DROP COLUMN application_id;
