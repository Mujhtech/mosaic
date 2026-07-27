-- +goose Up
ALTER TABLE configuration_releases DROP CONSTRAINT configuration_releases_delivery_contract_version_check;
ALTER TABLE configuration_releases ADD CONSTRAINT configuration_releases_delivery_contract_version_check CHECK (delivery_contract_version IN ('1','2'));

CREATE TABLE configuration_release_representations (
    release_id text NOT NULL,
    environment_id text NOT NULL,
    delivery_contract_version text NOT NULL CHECK (delivery_contract_version IN ('1', '2')),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_bytes bytea NOT NULL,
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (release_id, delivery_contract_version),
    FOREIGN KEY (release_id, environment_id)
        REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT
);
INSERT INTO configuration_release_representations(
    release_id, environment_id, delivery_contract_version, payload, payload_bytes, content_hash, created_at
)
SELECT id, environment_id, '1', payload, payload_bytes, content_hash, published_at
FROM configuration_releases;

CREATE TABLE configuration_release_rule_set_versions (
    release_id text NOT NULL,
    environment_id text NOT NULL,
    project_id text NOT NULL,
    rule_set_version_id text NOT NULL,
    placement_id text NOT NULL,
    PRIMARY KEY (release_id, placement_id),
    FOREIGN KEY (release_id, environment_id)
        REFERENCES configuration_releases(id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (rule_set_version_id, project_id, environment_id)
        REFERENCES placement_rule_set_versions(id, project_id, environment_id) ON DELETE RESTRICT,
    FOREIGN KEY (placement_id, project_id) REFERENCES placements(id, project_id) ON DELETE RESTRICT
);
CREATE INDEX configuration_release_rule_sets_version_idx
    ON configuration_release_rule_set_versions(rule_set_version_id, release_id);

CREATE TRIGGER immutable_configuration_release_representations
BEFORE UPDATE OR DELETE ON configuration_release_representations
FOR EACH ROW EXECUTE FUNCTION reject_placement_decision_version_change();
CREATE TRIGGER immutable_configuration_release_rule_set_versions
BEFORE UPDATE OR DELETE ON configuration_release_rule_set_versions
FOR EACH ROW EXECUTE FUNCTION reject_placement_decision_version_change();

-- +goose Down
DROP TRIGGER immutable_configuration_release_rule_set_versions ON configuration_release_rule_set_versions;
DROP TRIGGER immutable_configuration_release_representations ON configuration_release_representations;
DROP TABLE configuration_release_rule_set_versions;
DROP TABLE configuration_release_representations;
-- Rewriting a published v2 Release to claim contract version 1 would corrupt an
-- immutable Configuration Release. Refuse instead; recovery is restore-from-backup.
-- +goose StatementBegin
DO $$
DECLARE v2_releases bigint;
BEGIN
  SELECT count(*) INTO v2_releases FROM configuration_releases WHERE delivery_contract_version = '2';
  IF v2_releases > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('migration 00010 cannot be rolled back: %s Delivery v2 Configuration Release(s) exist', v2_releases),
      HINT = 'Restore from a backup taken before the upgrade: see docs/backend/operations/backup-restore.md';
  END IF;
END
$$;
-- +goose StatementEnd
ALTER TABLE configuration_releases DROP CONSTRAINT configuration_releases_delivery_contract_version_check;
ALTER TABLE configuration_releases ADD CONSTRAINT configuration_releases_delivery_contract_version_check CHECK (delivery_contract_version='1');
