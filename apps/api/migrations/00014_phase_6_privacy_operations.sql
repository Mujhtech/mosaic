-- +goose Up
CREATE TABLE analytics_export_jobs (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text,
    kind text NOT NULL CHECK (kind IN ('events', 'application_user', 'installation')),
    identity_digest bytea CHECK (identity_digest IS NULL OR octet_length(identity_digest) = 32),
    identity_reference_id text,
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed', 'expired')),
    format text NOT NULL CHECK (format IN ('ndjson', 'csv')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    object_key text,
    media_type text,
    byte_length bigint CHECK (byte_length IS NULL OR byte_length >= 0),
    row_count bigint CHECK (row_count IS NULL OR row_count >= 0),
    expires_at timestamptz,
    last_error_code text,
    requested_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status IN ('completed', 'expired')) = (object_key IS NOT NULL))
);
CREATE INDEX analytics_export_jobs_lease_idx ON analytics_export_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');

CREATE TABLE analytics_deletion_jobs (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    project_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('application_user', 'installation')),
    identity_digest bytea NOT NULL CHECK (octet_length(identity_digest) = 32),
    identity_reference_id text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'recomputing', 'completed', 'failed')),
    affected_event_count bigint NOT NULL DEFAULT 0 CHECK (affected_event_count >= 0),
    affected_session_count bigint NOT NULL DEFAULT 0 CHECK (affected_session_count >= 0),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text,
    requested_by_actor_id text NOT NULL,
    confirmed_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    completed_at timestamptz,
    UNIQUE (id, project_id),
    FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX analytics_deletion_jobs_lease_idx ON analytics_deletion_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased', 'recomputing');

CREATE TABLE analytics_retention_runs (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
    cutoff_at timestamptz NOT NULL,
    deleted_event_count bigint NOT NULL DEFAULT 0 CHECK (deleted_event_count >= 0),
    cursor_received_at timestamptz,
    cursor_row_id bigint,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    available_at timestamptz NOT NULL,
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (environment_id, cutoff_at),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((cursor_received_at IS NULL) = (cursor_row_id IS NULL))
);
CREATE INDEX analytics_retention_runs_lease_idx ON analytics_retention_runs(available_at, created_at, id)
    WHERE status IN ('queued', 'leased');

CREATE TABLE analytics_privacy_audit_events (
    id text PRIMARY KEY,
    organization_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text,
    actor_id text NOT NULL,
    action text NOT NULL,
    job_id text,
    request_digest bytea CHECK (request_digest IS NULL OR octet_length(request_digest) = 32),
    affected_event_count bigint CHECK (affected_event_count IS NULL OR affected_event_count >= 0),
    affected_session_count bigint CHECK (affected_session_count IS NULL OR affected_session_count >= 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    CHECK (expires_at >= created_at)
);
CREATE INDEX analytics_privacy_audit_project_idx
    ON analytics_privacy_audit_events(project_id, created_at DESC, id);
CREATE INDEX analytics_privacy_audit_expiry_idx ON analytics_privacy_audit_events(expires_at, id);

-- +goose StatementBegin
CREATE FUNCTION reject_analytics_privacy_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'analytics privacy audit events are append-only' USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER analytics_privacy_audit_no_update BEFORE UPDATE OR DELETE ON analytics_privacy_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_analytics_privacy_audit_change();

-- +goose Down
DROP TRIGGER analytics_privacy_audit_no_update ON analytics_privacy_audit_events;
DROP FUNCTION reject_analytics_privacy_audit_change();
DROP TABLE analytics_privacy_audit_events;
DROP TABLE analytics_retention_runs;
DROP TABLE analytics_deletion_jobs;
DROP TABLE analytics_export_jobs;
