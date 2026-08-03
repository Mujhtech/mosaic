-- Adds the App Store Connect API as a second server-connected provider kind.
--
-- app_store_connect is deliberately distinct from app_store. app_store is the
-- native, SDK-side StoreKit mapping and always has connection_id IS NULL;
-- app_store_connect is a server connection Mosaic reads Apple's catalog
-- through, and every mapping it creates carries that connection.

-- +goose Up
ALTER TABLE provider_connections
    DROP CONSTRAINT provider_connections_provider_check,
    ADD CONSTRAINT provider_connections_provider_check
        CHECK (provider IN ('revenuecat', 'app_store_connect', 'custom')),
    -- provider_connections_check is the unnamed integration-mode pairing check
    -- created by migration 00006. It is replaced with an explicitly named one so
    -- a future widening does not have to depend on PostgreSQL's ordinal naming.
    DROP CONSTRAINT provider_connections_check,
    ADD CONSTRAINT provider_connections_integration_pairing_check
        CHECK (
            (provider = 'revenuecat' AND integration_mode = 'server_connected') OR
            (provider = 'app_store_connect' AND integration_mode = 'server_connected') OR
            (provider = 'custom' AND integration_mode = 'sdk_only')
        );

ALTER TABLE active_provider_assignments
    DROP CONSTRAINT active_provider_assignments_provider_check,
    ADD CONSTRAINT active_provider_assignments_provider_check
        CHECK (provider IN ('revenuecat', 'app_store', 'app_store_connect', 'google_play', 'custom')),
    DROP CONSTRAINT active_provider_assignments_activation_shape_check,
    ADD CONSTRAINT active_provider_assignments_activation_shape_check
        CHECK (
            (
                activation_kind = 'provider_connection' AND
                provider IN ('revenuecat', 'app_store_connect', 'custom') AND
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
        );

ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_provider_check,
    ADD CONSTRAINT provider_product_mappings_provider_check
        CHECK (provider IN ('revenuecat', 'app_store', 'app_store_connect', 'google_play', 'custom')),
    -- An App Store Connect mapping must carry its connection. Reusing the
    -- native branch would let an imported mapping lose the credential it was
    -- verified through and become indistinguishable from a hand-entered
    -- StoreKit mapping.
    DROP CONSTRAINT provider_product_mappings_scope_shape_check,
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
                    (provider IN ('revenuecat', 'app_store_connect', 'custom') AND connection_id IS NOT NULL) OR
                    (provider IN ('app_store', 'google_play') AND connection_id IS NULL)
                )
            )
        ),
    -- Subscription groups are imported as Offerings with one Package each, so
    -- the offering/package pair is now valid for two providers rather than one.
    DROP CONSTRAINT provider_product_mappings_revenuecat_metadata_pair_check,
    ADD CONSTRAINT provider_product_mappings_connected_metadata_pair_check
        CHECK (
            (provider_package_identifier IS NULL AND provider_offering_identifier IS NULL) OR
            (
                provider IN ('revenuecat', 'app_store_connect') AND
                provider_package_identifier IS NOT NULL AND
                provider_offering_identifier IS NOT NULL
            )
        );

-- +goose Down
-- Rolling back would have to delete every App Store Connect connection and the
-- Product mappings, credentials, and metadata snapshots hanging off it. Refuse
-- instead of silently discarding commerce configuration.
-- +goose StatementBegin
DO $$
DECLARE connected bigint;
BEGIN
  SELECT count(*) INTO connected FROM provider_connections WHERE provider = 'app_store_connect';
  IF connected > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format('migration 00065 cannot be rolled back: %s App Store Connect provider connection(s) would be orphaned', connected),
      HINT = 'Revoke and delete the App Store Connect connections first, or restore from a backup taken before the upgrade: see docs/backend/operations/backup-restore.md';
  END IF;
END
$$;
-- +goose StatementEnd

ALTER TABLE provider_product_mappings
    DROP CONSTRAINT provider_product_mappings_connected_metadata_pair_check,
    ADD CONSTRAINT provider_product_mappings_revenuecat_metadata_pair_check
        CHECK (
            (provider_package_identifier IS NULL AND provider_offering_identifier IS NULL) OR
            (
                provider = 'revenuecat' AND
                provider_package_identifier IS NOT NULL AND
                provider_offering_identifier IS NOT NULL
            )
        ),
    DROP CONSTRAINT provider_product_mappings_scope_shape_check,
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
    DROP CONSTRAINT provider_product_mappings_provider_check,
    ADD CONSTRAINT provider_product_mappings_provider_check
        CHECK (provider IN ('revenuecat', 'app_store', 'google_play', 'custom'));

ALTER TABLE active_provider_assignments
    DROP CONSTRAINT active_provider_assignments_activation_shape_check,
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
    DROP CONSTRAINT active_provider_assignments_provider_check,
    ADD CONSTRAINT active_provider_assignments_provider_check
        CHECK (provider IN ('revenuecat', 'app_store', 'google_play', 'custom'));

ALTER TABLE provider_connections
    DROP CONSTRAINT provider_connections_integration_pairing_check,
    ADD CONSTRAINT provider_connections_check
        CHECK (
            (provider = 'revenuecat' AND integration_mode = 'server_connected') OR
            (provider = 'custom' AND integration_mode = 'sdk_only')
        ),
    DROP CONSTRAINT provider_connections_provider_check,
    ADD CONSTRAINT provider_connections_provider_check
        CHECK (provider IN ('revenuecat', 'custom'));
