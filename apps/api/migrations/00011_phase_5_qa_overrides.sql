-- +goose Up
CREATE TABLE placement_qa_overrides (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    placement_id text NOT NULL,
    selector_digest bytea NOT NULL CHECK (octet_length(selector_digest) = 32),
    token_digest bytea NOT NULL CHECK (octet_length(token_digest) = 32),
    safe_label text NOT NULL CHECK (char_length(safe_label) BETWEEN 1 AND 80),
    outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
    status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
    created_by_actor_id text NOT NULL,
    revoked_by_actor_id text,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    UNIQUE (id, project_id, environment_id),
    FOREIGN KEY (environment_id, project_id) REFERENCES environments(id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((revoked_at IS NULL) = (revoked_by_actor_id IS NULL))
);
CREATE UNIQUE INDEX placement_qa_overrides_active_selector_idx
    ON placement_qa_overrides(environment_id, placement_id, selector_digest)
    WHERE status = 'active';
CREATE INDEX placement_qa_overrides_active_expiry_idx
    ON placement_qa_overrides(environment_id, expires_at) WHERE status = 'active';

-- The Environment mode is checked transactionally by the service and again here.
-- +goose StatementBegin
CREATE FUNCTION reject_production_qa_override() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM environments WHERE id=NEW.environment_id AND mode='production') THEN
        RAISE EXCEPTION 'production QA overrides are unsupported' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER placement_qa_override_nonproduction BEFORE INSERT OR UPDATE ON placement_qa_overrides
FOR EACH ROW EXECUTE FUNCTION reject_production_qa_override();

-- +goose Down
DROP TRIGGER placement_qa_override_nonproduction ON placement_qa_overrides;
DROP FUNCTION reject_production_qa_override();
DROP TABLE placement_qa_overrides;
