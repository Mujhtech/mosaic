-- +goose Up
ALTER TABLE placements
    ADD CONSTRAINT placements_key_format_check CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$');

CREATE TABLE placement_aliases (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    placement_id text NOT NULL,
    key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    created_by_actor_id text NOT NULL,
    archived_by_actor_id text,
    created_at timestamptz NOT NULL,
    archived_at timestamptz,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id),
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CHECK ((archived_at IS NULL) = (archived_by_actor_id IS NULL))
);
CREATE INDEX placement_aliases_placement_idx ON placement_aliases(placement_id, status);

CREATE TABLE placement_rule_sets (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    contract_version text NOT NULL CHECK (contract_version = '1'),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    current_draft_id text,
    current_published_version_id text,
    created_by_actor_id text NOT NULL,
    archived_by_actor_id text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    archived_at timestamptz,
    UNIQUE (placement_id, environment_id),
    UNIQUE (id, project_id, environment_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CHECK ((archived_at IS NULL) = (archived_by_actor_id IS NULL))
);
CREATE INDEX placement_rule_sets_environment_idx ON placement_rule_sets(environment_id, placement_id);

CREATE TABLE placement_rule_set_drafts (
    id text PRIMARY KEY,
    rule_set_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'published', 'superseded')),
    current_revision bigint NOT NULL CHECK (current_revision > 0),
    source_version_id text,
    created_by_actor_id text NOT NULL,
    updated_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, rule_set_id),
    UNIQUE (id, project_id, environment_id),
    FOREIGN KEY (rule_set_id, project_id, environment_id)
        REFERENCES placement_rule_sets(id, project_id, environment_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX placement_rule_set_one_active_draft_idx
    ON placement_rule_set_drafts(rule_set_id) WHERE status = 'active';

CREATE TABLE placement_rule_set_draft_revisions (
    draft_id text NOT NULL,
    rule_set_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    document_bytes bytea NOT NULL CHECK (octet_length(document_bytes) <= 262144),
    document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    validation jsonb NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
    mutation_key_hash text NOT NULL CHECK (mutation_key_hash ~ '^[0-9a-f]{64}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (draft_id, revision),
    UNIQUE (draft_id, mutation_key_hash),
    FOREIGN KEY (draft_id, rule_set_id) REFERENCES placement_rule_set_drafts(id, rule_set_id) ON DELETE RESTRICT,
    FOREIGN KEY (rule_set_id, project_id, environment_id)
        REFERENCES placement_rule_sets(id, project_id, environment_id) ON DELETE RESTRICT
);

CREATE TABLE placement_rule_set_versions (
    id text PRIMARY KEY,
    rule_set_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    version_number bigint NOT NULL CHECK (version_number > 0),
    source_draft_id text NOT NULL,
    source_revision bigint NOT NULL CHECK (source_revision > 0),
    contract_version text NOT NULL CHECK (contract_version = '1'),
    document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    document_bytes bytea NOT NULL CHECK (octet_length(document_bytes) <= 262144),
    document_hash text NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    validation jsonb NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
    published_by_actor_id text NOT NULL,
    published_at timestamptz NOT NULL,
    UNIQUE (rule_set_id, version_number),
    UNIQUE (id, project_id, environment_id),
    FOREIGN KEY (rule_set_id, project_id, environment_id)
        REFERENCES placement_rule_sets(id, project_id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_draft_id, source_revision)
        REFERENCES placement_rule_set_draft_revisions(draft_id, revision) ON DELETE RESTRICT
);
CREATE INDEX placement_rule_set_versions_history_idx
    ON placement_rule_set_versions(rule_set_id, version_number DESC);

ALTER TABLE placement_rule_sets
    ADD CONSTRAINT placement_rule_sets_current_draft_fk
        FOREIGN KEY (current_draft_id, id) REFERENCES placement_rule_set_drafts(id, rule_set_id) ON DELETE RESTRICT,
    ADD CONSTRAINT placement_rule_sets_current_version_fk
        FOREIGN KEY (current_published_version_id, project_id, environment_id)
        REFERENCES placement_rule_set_versions(id, project_id, environment_id) ON DELETE RESTRICT;
ALTER TABLE placement_rule_set_drafts
    ADD CONSTRAINT placement_rule_set_drafts_source_version_fk
        FOREIGN KEY (source_version_id, project_id, environment_id)
        REFERENCES placement_rule_set_versions(id, project_id, environment_id) ON DELETE RESTRICT;

CREATE TABLE placement_rule_version_rules (
    rule_set_version_id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    rule_id text NOT NULL,
    priority integer NOT NULL CHECK (priority BETWEEN 0 AND 9999),
    enabled boolean NOT NULL,
    condition_tree jsonb NOT NULL CHECK (jsonb_typeof(condition_tree) = 'object'),
    outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
    rollout jsonb CHECK (rollout IS NULL OR jsonb_typeof(rollout) = 'object'),
    PRIMARY KEY (rule_set_version_id, rule_id),
    UNIQUE (rule_set_version_id, priority),
    FOREIGN KEY (rule_set_version_id, project_id, environment_id)
        REFERENCES placement_rule_set_versions(id, project_id, environment_id) ON DELETE RESTRICT
);

CREATE TABLE placement_attribute_definitions (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
    value_type text NOT NULL CHECK (value_type IN ('string', 'boolean', 'number', 'timestamp', 'semantic_version', 'string_list')),
    description text NOT NULL DEFAULT '',
    allowed_operators text[] NOT NULL CHECK (cardinality(allowed_operators) BETWEEN 1 AND 13),
    sensitivity text NOT NULL CHECK (sensitivity IN ('standard', 'sensitive')),
    status text NOT NULL CHECK (status IN ('active', 'archived')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by_actor_id text NOT NULL,
    updated_by_actor_id text NOT NULL,
    archived_by_actor_id text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    archived_at timestamptz,
    UNIQUE (project_id, key),
    UNIQUE (id, project_id),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CHECK ((archived_at IS NULL) = (archived_by_actor_id IS NULL))
);
CREATE INDEX placement_attribute_definitions_project_idx
    ON placement_attribute_definitions(project_id, status, key);

-- +goose StatementBegin
CREATE FUNCTION reject_placement_decision_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER immutable_placement_rule_set_draft_revisions
BEFORE UPDATE OR DELETE ON placement_rule_set_draft_revisions
FOR EACH ROW EXECUTE FUNCTION reject_placement_decision_version_change();
CREATE TRIGGER immutable_placement_rule_set_versions
BEFORE UPDATE OR DELETE ON placement_rule_set_versions
FOR EACH ROW EXECUTE FUNCTION reject_placement_decision_version_change();
CREATE TRIGGER immutable_placement_rule_version_rules
BEFORE UPDATE OR DELETE ON placement_rule_version_rules
FOR EACH ROW EXECUTE FUNCTION reject_placement_decision_version_change();

-- +goose StatementBegin
CREATE FUNCTION enforce_placement_key_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'placements' THEN
        IF EXISTS (SELECT 1 FROM placement_aliases WHERE project_id=NEW.project_id AND key=NEW.key) THEN
            RAISE EXCEPTION 'placement key conflicts with alias' USING ERRCODE='23505';
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM placements WHERE project_id=NEW.project_id AND key=NEW.key) THEN
            RAISE EXCEPTION 'placement alias conflicts with canonical key' USING ERRCODE='23505';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER placements_key_namespace BEFORE INSERT OR UPDATE OF key ON placements
FOR EACH ROW EXECUTE FUNCTION enforce_placement_key_namespace();
CREATE TRIGGER placement_aliases_key_namespace BEFORE INSERT OR UPDATE OF key ON placement_aliases
FOR EACH ROW EXECUTE FUNCTION enforce_placement_key_namespace();

-- +goose StatementBegin
CREATE FUNCTION reject_archived_placement_rule_set() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM placements WHERE id=NEW.placement_id AND status='archived') THEN
        RAISE EXCEPTION 'archived placement cannot receive a rule set' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER placement_rule_set_active_placement BEFORE INSERT ON placement_rule_sets
FOR EACH ROW EXECUTE FUNCTION reject_archived_placement_rule_set();

-- +goose Down
DROP TRIGGER placement_rule_set_active_placement ON placement_rule_sets;
DROP FUNCTION reject_archived_placement_rule_set();
DROP TRIGGER placement_aliases_key_namespace ON placement_aliases;
DROP TRIGGER placements_key_namespace ON placements;
DROP FUNCTION enforce_placement_key_namespace();
DROP TRIGGER immutable_placement_rule_version_rules ON placement_rule_version_rules;
DROP TRIGGER immutable_placement_rule_set_versions ON placement_rule_set_versions;
DROP TRIGGER immutable_placement_rule_set_draft_revisions ON placement_rule_set_draft_revisions;
DROP FUNCTION reject_placement_decision_version_change();
DROP TABLE placement_attribute_definitions;
DROP TABLE placement_rule_version_rules;
ALTER TABLE placement_rule_set_drafts DROP CONSTRAINT placement_rule_set_drafts_source_version_fk;
ALTER TABLE placement_rule_sets DROP CONSTRAINT placement_rule_sets_current_version_fk;
ALTER TABLE placement_rule_sets DROP CONSTRAINT placement_rule_sets_current_draft_fk;
DROP TABLE placement_rule_set_versions;
DROP TABLE placement_rule_set_draft_revisions;
DROP TABLE placement_rule_set_drafts;
DROP TABLE placement_rule_sets;
DROP TABLE placement_aliases;
ALTER TABLE placements DROP CONSTRAINT placements_key_format_check;
