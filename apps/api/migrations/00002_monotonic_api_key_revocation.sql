-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION preserve_api_key_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
        NEW.revoked_at := OLD.revoked_at;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
DROP TRIGGER IF EXISTS preserve_api_key_revocation ON api_keys;
CREATE TRIGGER preserve_api_key_revocation
BEFORE UPDATE ON api_keys
FOR EACH ROW EXECUTE FUNCTION preserve_api_key_revocation();

-- +goose Down
DROP TRIGGER IF EXISTS preserve_api_key_revocation ON api_keys;
DROP FUNCTION IF EXISTS preserve_api_key_revocation;
