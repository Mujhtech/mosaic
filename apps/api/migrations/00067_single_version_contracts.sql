-- Single-version contracts (ADR-0028): a Configuration Release carries exactly
-- one stored representation — its own payload, in the one Configuration
-- Delivery contract version (v3, re-pinned to carry Paywall Protocol 0.4).
--
-- The representations table existed only to hold the projections of a Release
-- into older Delivery versions (v2 -> v1, v3 -> v2/v1). Those versions were
-- deleted with the machinery that targeted them, so nothing writes or reads
-- these rows any more. Dropping the table removes the last place a dead-version
-- payload could look maintained.
--
-- Existing configuration_releases rows at delivery_contract_version '1' or '2'
-- are deliberately left in place: they are immutable history. Per ADR-0028 a
-- record at a deleted version is unreadable rather than degraded — delivery
-- withholds it (the SDK keeps its last accepted configuration, then bundled
-- fallback) until the Environment republishes, which creates a v3 Release.

-- +goose Up
DROP TABLE configuration_release_representations;

-- +goose Down
CREATE TABLE configuration_release_representations (
    release_id text NOT NULL,
    environment_id text NOT NULL,
    delivery_contract_version text NOT NULL CHECK (delivery_contract_version IN ('1', '2', '3')),
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
SELECT id, environment_id, delivery_contract_version, payload, payload_bytes, content_hash, published_at
FROM configuration_releases;
-- Restore the immutability trigger 00010 created on this table, so a full
-- down cycle finds the exact state 00010's down expects to tear down.
CREATE TRIGGER immutable_configuration_release_representations
BEFORE UPDATE OR DELETE ON configuration_release_representations
FOR EACH ROW EXECUTE FUNCTION reject_placement_decision_version_change();
