-- Phase 9A: Store Server Credentials and Product-mapping resolution hardening.
--
-- A Store Server Credential is a new first-class entity, deliberately not an
-- overload of provider_connections: a Provider Connection is a runtime commerce
-- provider (RevenueCat/custom) that can become an active assignment, while a
-- Store Server Credential is server-side proof material used only by the
-- billing ingestion pipeline and can never become a runtime provider.
--
-- Sandbox and production never mix. The credential carries both the Mosaic
-- Environment and the Store Environment, and the pair is constrained by a
-- composite foreign key onto the Environment's own mode, so the alignment is a
-- schema invariant rather than an application rule.

-- +goose Up

-- Environment mode becomes part of a unique key so downstream tables can carry
-- a denormalized mode and have PostgreSQL enforce that it matches.
ALTER TABLE environments
    ADD CONSTRAINT environments_id_project_mode_key UNIQUE (id, project_id, mode);

-- Mosaic Billing is per-Project opt-in and off by default.
CREATE TABLE billing_project_settings (
    project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
    billing_enabled boolean NOT NULL DEFAULT false,
    updated_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE store_server_credentials (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    organization_id text NOT NULL,
    environment_id text NOT NULL,
    environment_mode text NOT NULL CHECK (environment_mode IN ('development', 'staging', 'production')),
    provider text NOT NULL CHECK (provider IN ('app_store', 'google_play')),
    store_environment text NOT NULL CHECK (store_environment IN ('sandbox', 'production')),
    name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
    status text NOT NULL CHECK (status IN ('active', 'revoked')),
    health_status text NOT NULL CHECK (
        health_status IN ('untested', 'healthy', 'degraded', 'unavailable', 'revoked')
    ),
    credential_class text NOT NULL CHECK (
        credential_class IN ('appleInAppPurchaseKey', 'googleServiceAccountKey')
    ),
    -- Encrypted envelope, sealed under the Phase 9A AAD domain v2. The domain is
    -- distinct from the Provider Connection domain so a v1 envelope can never be
    -- opened as a v2 envelope even with the same keyring.
    envelope_version integer NOT NULL CHECK (envelope_version = 1),
    algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
    key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 64 AND key_id ~ '^[ -~]+$'),
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
    ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) >= 16),
    fingerprint bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
    -- Non-secret identifiers, kept in plaintext for display and lookup without
    -- decrypting the envelope. None of these is a bearer value.
    apple_issuer_id text CHECK (apple_issuer_id IS NULL OR (btrim(apple_issuer_id) <> '' AND length(apple_issuer_id) <= 128)),
    apple_key_id text CHECK (apple_key_id IS NULL OR (btrim(apple_key_id) <> '' AND length(apple_key_id) <= 64)),
    google_client_email text CHECK (google_client_email IS NULL OR (btrim(google_client_email) <> '' AND length(google_client_email) <= 254)),
    google_pubsub_project_id text CHECK (google_pubsub_project_id IS NULL OR (btrim(google_pubsub_project_id) <> '' AND length(google_pubsub_project_id) <= 128)),
    google_pubsub_subscription_id text CHECK (google_pubsub_subscription_id IS NULL OR (btrim(google_pubsub_subscription_id) <> '' AND length(google_pubsub_subscription_id) <= 128)),
    -- Apple notification intake identity. Presented once at create/rotate and
    -- stored only as SHA-256, matching the API-key posture.
    intake_token_digest bytea CHECK (intake_token_digest IS NULL OR octet_length(intake_token_digest) = 32),
    intake_token_rotated_at timestamptz,
    last_error_code text CHECK (last_error_code IS NULL OR (btrim(last_error_code) <> '' AND length(last_error_code) <= 128)),
    last_tested_at timestamptz,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    rotated_at timestamptz,
    revoked_at timestamptz,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (id, project_id, provider),
    -- One credential per store per Mosaic Environment. Because an Environment
    -- has exactly one mode, this yields the intended sandbox/production pair.
    UNIQUE (project_id, provider, environment_id),
    UNIQUE (intake_token_digest),
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id, environment_mode)
        REFERENCES environments(id, project_id, mode) ON DELETE RESTRICT,
    CONSTRAINT store_server_credentials_store_environment_alignment_check CHECK (
        (environment_mode = 'production') = (store_environment = 'production')
    ),
    CONSTRAINT store_server_credentials_apple_shape_check CHECK (
        provider <> 'app_store' OR (
            credential_class = 'appleInAppPurchaseKey' AND
            apple_issuer_id IS NOT NULL AND apple_key_id IS NOT NULL AND
            intake_token_digest IS NOT NULL AND
            google_client_email IS NULL AND google_pubsub_project_id IS NULL AND
            google_pubsub_subscription_id IS NULL
        )
    ),
    CONSTRAINT store_server_credentials_google_shape_check CHECK (
        provider <> 'google_play' OR (
            credential_class = 'googleServiceAccountKey' AND
            google_client_email IS NOT NULL AND google_pubsub_project_id IS NOT NULL AND
            google_pubsub_subscription_id IS NOT NULL AND
            apple_issuer_id IS NULL AND apple_key_id IS NULL AND
            intake_token_digest IS NULL AND intake_token_rotated_at IS NULL
        )
    ),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((status = 'revoked') = (health_status = 'revoked')),
    CHECK (rotated_at IS NULL OR rotated_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX store_server_credentials_project_idx
    ON store_server_credentials(project_id, provider, id);
-- Rotation pages over envelopes sealed under a retired key.
CREATE INDEX store_server_credentials_key_rotation_idx
    ON store_server_credentials(key_id, id)
    WHERE revoked_at IS NULL;

-- An Apple credential covers one Apple team and many Applications; the verified
-- `bid` selects the Application per request. A Google credential covers one
-- package name per Application.
CREATE TABLE store_server_credential_applications (
    project_id text NOT NULL,
    credential_id text NOT NULL,
    application_id text NOT NULL,
    platform text NOT NULL CHECK (platform IN ('ios', 'android')),
    provider_application_identifier text NOT NULL CHECK (
        btrim(provider_application_identifier) <> '' AND
        length(provider_application_identifier) <= 255 AND
        provider_application_identifier ~ '^[ -~]+$'
    ),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (credential_id, application_id),
    UNIQUE (project_id, credential_id, application_id),
    UNIQUE (credential_id, provider_application_identifier),
    FOREIGN KEY (credential_id, project_id)
        REFERENCES store_server_credentials(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (application_id, project_id, platform)
        REFERENCES applications(id, project_id, platform) ON DELETE RESTRICT
);
CREATE INDEX store_server_credential_applications_lookup_idx
    ON store_server_credential_applications(provider_application_identifier, credential_id);

-- Credential lifecycle audit. Kept append-only so a revocation cannot be edited
-- out of the record after an incident.
CREATE TABLE store_server_credential_events (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    credential_id text NOT NULL,
    action text NOT NULL CHECK (
        action IN ('created', 'rotated', 'revoked', 'tested', 'intake_token_rotated')
    ),
    outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
    diagnostic_code text CHECK (diagnostic_code IS NULL OR (btrim(diagnostic_code) <> '' AND length(diagnostic_code) <= 128)),
    actor_id text NOT NULL,
    occurred_at timestamptz NOT NULL,
    FOREIGN KEY (credential_id, project_id)
        REFERENCES store_server_credentials(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX store_server_credential_events_history_idx
    ON store_server_credential_events(credential_id, occurred_at DESC, id);

-- +goose StatementBegin
CREATE FUNCTION reject_store_server_credential_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'store server credential events are append-only' USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER store_server_credential_events_no_change
BEFORE UPDATE OR DELETE ON store_server_credential_events
FOR EACH ROW EXECUTE FUNCTION reject_store_server_credential_event_change();

-- Product-mapping hardening required before mapping history can be walked
-- safely by the resolution algorithm.
--
-- The existing UNIQUE (replaces_mapping_id) makes replacement chains linear but
-- does not stop a row from replacing itself, which would make the forward walk
-- non-terminating.
ALTER TABLE provider_product_mappings
    ADD CONSTRAINT provider_product_mappings_replaces_self_check
        CHECK (replaces_mapping_id IS NULL OR replaces_mapping_id <> id);

-- Resolution looks a mapping up in the opposite direction to every existing
-- index: it starts from the provider Product identifier observed on a
-- transaction and needs both current and archived candidates ordered by
-- archived_at. The existing partial unique indexes only cover current rows.
CREATE INDEX provider_product_mappings_resolution_idx
    ON provider_product_mappings(
        environment_id, provider, application_id, platform,
        provider_product_identifier, archived_at
    )
    WHERE connection_id IS NULL AND environment_id IS NOT NULL;

-- +goose Down
DROP INDEX provider_product_mappings_resolution_idx;
ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_replaces_self_check;
DROP TRIGGER store_server_credential_events_no_change ON store_server_credential_events;
DROP FUNCTION reject_store_server_credential_event_change();
DROP TABLE store_server_credential_events;
DROP TABLE store_server_credential_applications;
DROP TABLE store_server_credentials;
DROP TABLE billing_project_settings;
ALTER TABLE environments DROP CONSTRAINT environments_id_project_mode_key;
