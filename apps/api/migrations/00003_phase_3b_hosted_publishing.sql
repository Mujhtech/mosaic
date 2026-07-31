-- +goose Up
CREATE TABLE paywalls (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    archived_at timestamptz,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX paywalls_project_idx ON paywalls(project_id, id);

CREATE TABLE paywall_drafts (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    paywall_id text NOT NULL,
    environment_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'published', 'archived')),
    current_revision bigint NOT NULL CHECK (current_revision > 0),
    source_version_id text,
    current_protocol_version text NOT NULL,
    validation_status text NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
    validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_summary) = 'object'),
    created_by_actor_id text NOT NULL,
    updated_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (id, paywall_id),
    FOREIGN KEY (paywall_id, project_id) REFERENCES paywalls(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX paywall_drafts_one_active_idx
    ON paywall_drafts(paywall_id, environment_id) WHERE status = 'active';
CREATE INDEX paywall_drafts_paywall_idx ON paywall_drafts(paywall_id, environment_id, id);

CREATE TABLE paywall_draft_revisions (
    draft_id text NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    project_id text NOT NULL,
    protocol_version text NOT NULL,
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    validation_status text NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
    validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_summary) = 'object'),
    mutation_key_hash text NOT NULL CHECK (mutation_key_hash ~ '^[0-9a-f]{64}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (draft_id, revision),
    UNIQUE (draft_id, mutation_key_hash),
    FOREIGN KEY (draft_id, project_id) REFERENCES paywall_drafts(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX paywall_draft_revisions_created_idx ON paywall_draft_revisions(draft_id, created_at);

CREATE TABLE paywall_versions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    paywall_id text NOT NULL,
    environment_id text NOT NULL,
    version_number bigint NOT NULL CHECK (version_number > 0),
    source_draft_id text NOT NULL,
    source_revision bigint NOT NULL,
    protocol_version text NOT NULL,
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    validation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_metadata) = 'object'),
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (id, project_id),
    UNIQUE (id, paywall_id),
    UNIQUE (paywall_id, environment_id, version_number),
    FOREIGN KEY (paywall_id, project_id) REFERENCES paywalls(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_draft_id, source_revision) REFERENCES paywall_draft_revisions(draft_id, revision) ON DELETE RESTRICT
);
CREATE INDEX paywall_versions_history_idx
    ON paywall_versions(paywall_id, environment_id, version_number DESC);
ALTER TABLE paywall_drafts
    ADD CONSTRAINT paywall_drafts_source_version_fk
    FOREIGN KEY (source_version_id, paywall_id) REFERENCES paywall_versions(id, paywall_id) ON DELETE RESTRICT;

CREATE TABLE paywall_version_products (
    version_id text NOT NULL,
    project_id text NOT NULL,
    product_id text NOT NULL,
    PRIMARY KEY (version_id, product_id),
    FOREIGN KEY (version_id, project_id) REFERENCES paywall_versions(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX paywall_version_products_product_idx ON paywall_version_products(product_id, version_id);

CREATE TABLE placements (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (btrim(key) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    archived_at timestamptz,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX placements_project_idx ON placements(project_id, id);

CREATE TABLE environment_placement_bindings (
    project_id text NOT NULL,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    paywall_id text NOT NULL,
    updated_by_actor_id text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (environment_id, placement_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (paywall_id, project_id) REFERENCES paywalls(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX environment_placement_bindings_paywall_idx
    ON environment_placement_bindings(paywall_id, environment_id);

CREATE TABLE configuration_releases (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    release_number bigint NOT NULL CHECK (release_number > 0),
    delivery_contract_version text NOT NULL CHECK (delivery_contract_version = '1'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_bytes bytea NOT NULL,
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    source_release_id text,
    rollback_source_release_id text,
    published_by_actor_id text NOT NULL,
    published_at timestamptz NOT NULL,
    UNIQUE (id, environment_id),
    UNIQUE (environment_id, release_number),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (rollback_source_release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT
);
CREATE INDEX configuration_releases_history_idx
    ON configuration_releases(environment_id, release_number DESC);

CREATE TABLE configuration_release_placements (
    release_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    placement_key text NOT NULL,
    paywall_version_id text NOT NULL,
    PRIMARY KEY (release_id, placement_id),
    UNIQUE (release_id, placement_key),
    FOREIGN KEY (release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (paywall_version_id, project_id) REFERENCES paywall_versions(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX configuration_release_placements_version_idx
    ON configuration_release_placements(paywall_version_id, release_id);

CREATE TABLE configuration_release_products (
    release_id text NOT NULL,
    environment_id text NOT NULL,
    project_id text NOT NULL,
    product_id text NOT NULL,
    PRIMARY KEY (release_id, product_id),
    FOREIGN KEY (release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id, project_id) REFERENCES products(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX configuration_release_products_product_idx
    ON configuration_release_products(product_id, release_id);

CREATE TABLE environment_release_state (
    environment_id text PRIMARY KEY,
    project_id text NOT NULL,
    current_release_id text,
    last_release_number bigint NOT NULL DEFAULT 0 CHECK (last_release_number >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT
);
INSERT INTO environment_release_state(environment_id, project_id)
SELECT id, project_id FROM environments;

-- +goose StatementBegin
CREATE FUNCTION initialize_environment_release_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO environment_release_state(environment_id, project_id)
    VALUES(NEW.id, NEW.project_id)
    ON CONFLICT(environment_id) DO NOTHING;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER initialize_environment_release_state
AFTER INSERT ON environments
FOR EACH ROW EXECUTE FUNCTION initialize_environment_release_state();

CREATE TABLE publication_requests (
    environment_id text NOT NULL,
    operation text NOT NULL CHECK (operation IN ('publish', 'rollback')),
    idempotency_key_hash text NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    result_release_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (environment_id, operation, idempotency_key_hash),
    FOREIGN KEY (result_release_id, environment_id) REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT
);

-- +goose StatementBegin
CREATE FUNCTION reject_immutable_publishing_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER immutable_paywall_draft_revisions
BEFORE UPDATE OR DELETE ON paywall_draft_revisions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();
CREATE TRIGGER immutable_paywall_versions
BEFORE UPDATE OR DELETE ON paywall_versions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();
CREATE TRIGGER immutable_configuration_releases
BEFORE UPDATE OR DELETE ON configuration_releases
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();
CREATE TRIGGER immutable_configuration_release_placements
BEFORE UPDATE OR DELETE ON configuration_release_placements
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();
CREATE TRIGGER immutable_configuration_release_products
BEFORE UPDATE OR DELETE ON configuration_release_products
FOR EACH ROW EXECUTE FUNCTION reject_immutable_publishing_change();

-- +goose Down
DROP TRIGGER immutable_configuration_release_products ON configuration_release_products;
DROP TRIGGER immutable_configuration_release_placements ON configuration_release_placements;
DROP TRIGGER immutable_configuration_releases ON configuration_releases;
DROP TRIGGER immutable_paywall_versions ON paywall_versions;
DROP TRIGGER immutable_paywall_draft_revisions ON paywall_draft_revisions;
DROP FUNCTION reject_immutable_publishing_change;
DROP TABLE publication_requests;
DROP TRIGGER initialize_environment_release_state ON environments;
DROP FUNCTION initialize_environment_release_state;
DROP TABLE environment_release_state;
DROP TABLE configuration_release_products;
DROP TABLE configuration_release_placements;
DROP TABLE configuration_releases;
DROP TABLE environment_placement_bindings;
DROP TABLE placements;
DROP TABLE paywall_version_products;
ALTER TABLE paywall_drafts DROP CONSTRAINT paywall_drafts_source_version_fk;
DROP TABLE paywall_versions;
DROP TABLE paywall_draft_revisions;
DROP TABLE paywall_drafts;
DROP TABLE paywalls;
