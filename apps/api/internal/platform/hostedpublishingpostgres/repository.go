// Package hostedpublishingpostgres implements Phase 3B publishing persistence with pgx.
package hostedpublishingpostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
)

type Repository struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) View(ctx context.Context, fn func(hostedpublishing.Reader) error) error {
	state := &readState{ctx: ctx, q: r.pool}
	callbackErr := fn(reader{state})
	if state.err != nil {
		return fmt.Errorf("read hosted publishing: %w", state.err)
	}
	return callbackErr
}

func (r *Repository) Transact(ctx context.Context, fn func(hostedpublishing.Transaction) error) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin hosted publishing transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	state := &readState{ctx: ctx, q: tx}
	transaction := &transaction{reader: reader{state}, tx: tx}
	callbackErr := fn(transaction)
	if state.err != nil {
		return persistenceError(state.err)
	}
	if callbackErr != nil {
		return callbackErr
	}
	if err := tx.Commit(ctx); err != nil {
		return persistenceError(err)
	}
	return nil
}

type querier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type readState struct {
	ctx context.Context
	q   querier
	err error
}

type reader struct{ *readState }

func utc(value time.Time) time.Time { return value.UTC() }

func utcPtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	normalized := value.UTC()
	return &normalized
}

func (r reader) fail(err error) {
	if err != nil && r.err == nil {
		r.err = err
	}
}

func one[T any](r reader, query string, scan func(pgx.Row) (T, error), args ...any) (T, bool) {
	var zero T
	value, err := scan(r.q.QueryRow(r.ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return zero, false
	}
	if err != nil {
		r.fail(err)
		return zero, false
	}
	return value, true
}

func many[T any](r reader, query string, scan func(pgx.Row) (T, error), args ...any) []T {
	rows, err := r.q.Query(r.ctx, query, args...)
	if err != nil {
		r.fail(err)
		return nil
	}
	defer rows.Close()
	values := make([]T, 0)
	for rows.Next() {
		value, err := scan(rows)
		if err != nil {
			r.fail(err)
			return nil
		}
		values = append(values, value)
	}
	r.fail(rows.Err())
	return values
}

func (r reader) Project(id string) (hostedpublishing.Project, bool) {
	return one(r, `SELECT id,organization_id,status FROM projects WHERE id=$1`, func(row pgx.Row) (hostedpublishing.Project, error) {
		var value hostedpublishing.Project
		err := row.Scan(&value.ID, &value.OrganizationID, &value.Status)
		return value, err
	}, id)
}

func (r reader) Role(organizationID, actorID string) (string, bool) {
	return one(r, `SELECT role FROM organization_members WHERE organization_id=$1 AND actor_id=$2`, func(row pgx.Row) (string, error) {
		var role string
		err := row.Scan(&role)
		return role, err
	}, organizationID, actorID)
}

func (r reader) Environment(id string) (hostedpublishing.Environment, bool) {
	return one(r, `SELECT id,project_id,key,mode FROM environments WHERE id=$1`, func(row pgx.Row) (hostedpublishing.Environment, error) {
		var value hostedpublishing.Environment
		err := row.Scan(&value.ID, &value.ProjectID, &value.Key, &value.Mode)
		return value, err
	}, id)
}

func (r reader) Applications(projectID string) []hostedpublishing.Application {
	return many(r, `SELECT id,project_id,platform FROM applications WHERE project_id=$1 ORDER BY id`, func(row pgx.Row) (hostedpublishing.Application, error) {
		var value hostedpublishing.Application
		err := row.Scan(&value.ID, &value.ProjectID, &value.Platform)
		return value, err
	}, projectID)
}

func (r reader) Product(id string) (hostedpublishing.Product, bool) {
	return one(r, `SELECT id,project_id,type,status,metadata_source,internal_name FROM products WHERE id=$1`, func(row pgx.Row) (hostedpublishing.Product, error) {
		var value hostedpublishing.Product
		err := row.Scan(&value.ID, &value.ProjectID, &value.Type, &value.Status, &value.MetadataSource, &value.InternalName)
		return value, err
	}, id)
}

func (r reader) ProviderMappingCount(productID string) int {
	var count int
	err := r.q.QueryRow(r.ctx, `SELECT count(*) FROM provider_product_mappings WHERE product_id=$1`, productID).Scan(&count)
	r.fail(err)
	return count
}

func (r reader) ProductGrantCount(productID string) int {
	var count int
	err := r.q.QueryRow(r.ctx, `SELECT count(*) FROM product_entitlement_grants WHERE product_id=$1`, productID).Scan(&count)
	r.fail(err)
	return count
}

func (r reader) ProviderAssignment(environmentID, applicationID string) (hostedpublishing.ProviderAssignment, bool) {
	return one(r, `SELECT connection_id FROM active_provider_assignments WHERE environment_id=$1 AND application_id=$2`, func(row pgx.Row) (hostedpublishing.ProviderAssignment, error) {
		var value hostedpublishing.ProviderAssignment
		err := row.Scan(&value.ConnectionID)
		return value, err
	}, environmentID, applicationID)
}

func (r reader) ProviderConnection(id string) (hostedpublishing.ProviderConnection, bool) {
	return one(r, `SELECT id,project_id,provider,mode,status,health_status FROM provider_connections WHERE id=$1`, func(row pgx.Row) (hostedpublishing.ProviderConnection, error) {
		var value hostedpublishing.ProviderConnection
		err := row.Scan(&value.ID, &value.ProjectID, &value.Provider, &value.Mode, &value.Status, &value.HealthStatus)
		return value, err
	}, id)
}

func (r reader) ProviderConnectionEnvironmentScoped(connectionID, environmentID string) bool {
	var scoped bool
	err := r.q.QueryRow(r.ctx, `SELECT EXISTS(
		SELECT 1 FROM provider_connection_environment_scopes
		WHERE connection_id=$1 AND environment_id=$2
	)`, connectionID, environmentID).Scan(&scoped)
	r.fail(err)
	return scoped
}

func (r reader) ProviderConnectionApplicationScoped(connectionID, applicationID string) bool {
	var scoped bool
	err := r.q.QueryRow(r.ctx, `SELECT EXISTS(
		SELECT 1 FROM provider_connection_application_scopes
		WHERE connection_id=$1 AND application_id=$2
	)`, connectionID, applicationID).Scan(&scoped)
	r.fail(err)
	return scoped
}

func (r reader) ProviderMappingsForReadiness(productID, connectionID, environmentID, applicationID, platform string) []hostedpublishing.ProviderMappingReadiness {
	return many(r, `SELECT id,availability,sync_state,current_snapshot_id
		FROM provider_product_mappings
		WHERE product_id=$1 AND connection_id=$2 AND environment_id=$3 AND application_id=$4
		  AND platform=$5 AND status='active'
		ORDER BY id`, func(row pgx.Row) (hostedpublishing.ProviderMappingReadiness, error) {
		var value hostedpublishing.ProviderMappingReadiness
		var currentSnapshotID *string
		err := row.Scan(&value.ID, &value.Availability, &value.SyncState, &currentSnapshotID)
		if currentSnapshotID != nil {
			value.CurrentSnapshotID = *currentSnapshotID
		}
		return value, err
	}, productID, connectionID, environmentID, applicationID, platform)
}

func (r reader) ProviderMappingsForCommerce(connectionID, environmentID, applicationID, platform string, productIDs []string) []hostedpublishing.CommerceProductMapping {
	return many(r, `SELECT id,product_id,provider_product_identifier,provider_package_identifier,provider_offering_identifier,expected_store_product_id,current_snapshot_id
		FROM provider_product_mappings
		WHERE connection_id=$1 AND environment_id=$2 AND application_id=$3 AND platform=$4
		  AND product_id=ANY($5::text[]) AND status='active'
		ORDER BY product_id,id`, func(row pgx.Row) (hostedpublishing.CommerceProductMapping, error) {
		var value hostedpublishing.CommerceProductMapping
		var packageID, offeringID, storeID, snapshotID *string
		err := row.Scan(
			&value.ID, &value.ProductID, &value.ProviderProductIdentifier,
			&packageID, &offeringID, &storeID, &snapshotID,
		)
		if packageID != nil {
			value.ProviderPackageIdentifier = *packageID
		}
		if offeringID != nil {
			value.ProviderOfferingIdentifier = *offeringID
		}
		if storeID != nil {
			value.ExpectedStoreProductID = *storeID
		}
		if snapshotID != nil {
			value.CurrentSnapshotID = *snapshotID
		}
		return value, err
	}, connectionID, environmentID, applicationID, platform, productIDs)
}

func (r reader) ProviderEntitlementMappingsForCommerce(connectionID, environmentID, applicationID string, productIDs []string) []hostedpublishing.CommerceEntitlementMapping {
	return many(r, `SELECT entitlement.id,entitlement.key,mapping.provider_entitlement_identifier
		FROM provider_entitlement_mappings mapping
		JOIN entitlements entitlement ON entitlement.id=mapping.entitlement_id
		WHERE mapping.connection_id=$1 AND mapping.environment_id=$2 AND mapping.application_id=$3
		  AND mapping.status='active'
		  AND EXISTS (
		      SELECT 1 FROM product_entitlement_grants grant_row
		      WHERE grant_row.entitlement_id=mapping.entitlement_id
		        AND grant_row.product_id=ANY($4::text[])
		  )
		ORDER BY entitlement.key,mapping.provider_entitlement_identifier`, func(row pgx.Row) (hostedpublishing.CommerceEntitlementMapping, error) {
		var value hostedpublishing.CommerceEntitlementMapping
		err := row.Scan(&value.EntitlementID, &value.EntitlementKey, &value.ProviderEntitlementIdentifier)
		return value, err
	}, connectionID, environmentID, applicationID, productIDs)
}

func (r reader) ProviderMetadataSnapshot(id string) (hostedpublishing.ProviderMetadataSnapshot, bool) {
	return one(r, `SELECT id,observed_at,synced_at,stale_at,expires_at FROM provider_product_metadata_snapshots WHERE id=$1`, func(row pgx.Row) (hostedpublishing.ProviderMetadataSnapshot, error) {
		var value hostedpublishing.ProviderMetadataSnapshot
		err := row.Scan(&value.ID, &value.ObservedAt, &value.SyncedAt, &value.StaleAt, &value.ExpiresAt)
		value.ObservedAt, value.SyncedAt, value.StaleAt = utc(value.ObservedAt), utc(value.SyncedAt), utc(value.StaleAt)
		value.ExpiresAt = utcPtr(value.ExpiresAt)
		return value, err
	}, id)
}

func scanAsset(row pgx.Row) (hostedpublishing.Asset, error) {
	var value hostedpublishing.Asset
	err := row.Scan(&value.ID, &value.ProjectID, &value.Kind, &value.OriginalFilename, &value.MediaType, &value.ByteLength, &value.ContentDigest, &value.StorageKey, &value.URL, &value.Status, &value.CreatedByActorID, &value.ArchivedAt, &value.CreatedAt, &value.UpdatedAt)
	value.ArchivedAt = utcPtr(value.ArchivedAt)
	value.CreatedAt, value.UpdatedAt = utc(value.CreatedAt), utc(value.UpdatedAt)
	return value, err
}

const assetColumns = `id,project_id,kind,original_filename,media_type,byte_length,content_digest,storage_key,public_url,status,created_by_actor_id,archived_at,created_at,updated_at`

func (r reader) Asset(id string) (hostedpublishing.Asset, bool) {
	return one(r, `SELECT `+assetColumns+` FROM assets WHERE id=$1`, scanAsset, id)
}

func (r reader) Assets(projectID string) []hostedpublishing.Asset {
	return many(r, `SELECT `+assetColumns+` FROM assets WHERE project_id=$1 AND status<>'deleted' ORDER BY id`, scanAsset, projectID)
}

func (r reader) AssetUsage(assetID string) hostedpublishing.AssetUsage {
	var value hostedpublishing.AssetUsage
	err := r.q.QueryRow(r.ctx, `SELECT
		(SELECT count(*) FROM paywall_draft_revisions d WHERE d.document::text LIKE '%' || (SELECT public_url FROM assets WHERE id=$1) || '%'),
		(SELECT count(*) FROM paywall_version_assets WHERE asset_id=$1),
		(SELECT count(*) FROM configuration_release_assets WHERE asset_id=$1)`, assetID).Scan(&value.DraftReferences, &value.VersionReferences, &value.ReleaseReferences)
	r.fail(err)
	return value
}

func scanPaywall(row pgx.Row) (hostedpublishing.Paywall, error) {
	var value hostedpublishing.Paywall
	err := row.Scan(&value.ID, &value.ProjectID, &value.Key, &value.Name, &value.Status, &value.ArchivedAt, &value.CreatedByActorID, &value.CreatedAt, &value.UpdatedAt)
	value.ArchivedAt = utcPtr(value.ArchivedAt)
	value.CreatedAt, value.UpdatedAt = utc(value.CreatedAt), utc(value.UpdatedAt)
	return value, err
}

const paywallColumns = `id,project_id,key,name,status,archived_at,created_by_actor_id,created_at,updated_at`

func (r reader) Paywall(id string) (hostedpublishing.Paywall, bool) {
	return one(r, `SELECT `+paywallColumns+` FROM paywalls WHERE id=$1`, scanPaywall, id)
}

func (r reader) Paywalls(projectID string) []hostedpublishing.Paywall {
	return many(r, `SELECT `+paywallColumns+` FROM paywalls WHERE project_id=$1 ORDER BY id`, scanPaywall, projectID)
}

func scanSummary(raw []byte) (hostedpublishing.ValidationSummary, error) {
	var summary hostedpublishing.ValidationSummary
	if err := json.Unmarshal(raw, &summary); err != nil {
		return summary, err
	}
	if summary.Errors == nil {
		summary.Errors = []string{}
	}
	if summary.Warnings == nil {
		summary.Warnings = []string{}
	}
	return summary, nil
}

func scanDraft(row pgx.Row) (hostedpublishing.Draft, error) {
	var value hostedpublishing.Draft
	var sourceVersionID *string
	var summary []byte
	err := row.Scan(&value.ID, &value.ProjectID, &value.PaywallID, &value.EnvironmentID, &value.Status, &value.CurrentRevision, &sourceVersionID, &value.CurrentProtocolVersion, &value.ValidationStatus, &summary, &value.CreatedByActorID, &value.UpdatedByActorID, &value.CreatedAt, &value.UpdatedAt)
	if err != nil {
		return value, err
	}
	if sourceVersionID != nil {
		value.SourceVersionID = *sourceVersionID
	}
	value.CreatedAt, value.UpdatedAt = utc(value.CreatedAt), utc(value.UpdatedAt)
	value.ValidationSummary, err = scanSummary(summary)
	return value, err
}

const draftColumns = `id,project_id,paywall_id,environment_id,status,current_revision,source_version_id,current_protocol_version,validation_status,validation_summary,created_by_actor_id,updated_by_actor_id,created_at,updated_at`

func (r reader) ActiveDraft(paywallID, environmentID string) (hostedpublishing.Draft, bool) {
	return one(r, `SELECT `+draftColumns+` FROM paywall_drafts WHERE paywall_id=$1 AND environment_id=$2 AND status='active'`, scanDraft, paywallID, environmentID)
}

func (r reader) Draft(id string) (hostedpublishing.Draft, bool) {
	return one(r, `SELECT `+draftColumns+` FROM paywall_drafts WHERE id=$1`, scanDraft, id)
}

func scanDraftRevision(row pgx.Row) (hostedpublishing.DraftRevision, error) {
	var value hostedpublishing.DraftRevision
	var document, summary []byte
	err := row.Scan(&value.DraftID, &value.Revision, &value.ProjectID, &value.ProtocolVersion, &document, &value.DocumentHash, &value.ValidationStatus, &summary, &value.MutationKeyHash, &value.RequestHash, &value.ActorID, &value.CreatedAt)
	if err != nil {
		return value, err
	}
	value.Document = append(json.RawMessage(nil), document...)
	value.CreatedAt = utc(value.CreatedAt)
	value.ValidationSummary, err = scanSummary(summary)
	return value, err
}

const revisionColumns = `draft_id,revision,project_id,protocol_version,document,document_hash,validation_status,validation_summary,mutation_key_hash,request_hash,actor_id,created_at`

func (r reader) DraftRevision(draftID string, revision int64) (hostedpublishing.DraftRevision, bool) {
	return one(r, `SELECT `+revisionColumns+` FROM paywall_draft_revisions WHERE draft_id=$1 AND revision=$2`, scanDraftRevision, draftID, revision)
}

func (r reader) DraftRevisionByMutation(draftID, mutationKeyHash string) (hostedpublishing.DraftRevision, bool) {
	return one(r, `SELECT `+revisionColumns+` FROM paywall_draft_revisions WHERE draft_id=$1 AND mutation_key_hash=$2`, scanDraftRevision, draftID, mutationKeyHash)
}

func scanVersion(row pgx.Row) (hostedpublishing.PaywallVersion, error) {
	var value hostedpublishing.PaywallVersion
	var document, summary []byte
	err := row.Scan(&value.ID, &value.ProjectID, &value.PaywallID, &value.EnvironmentID, &value.VersionNumber, &value.SourceDraftID, &value.SourceRevision, &value.ProtocolVersion, &document, &value.DocumentHash, &summary, &value.CreatedByActorID, &value.CreatedAt)
	if err != nil {
		return value, err
	}
	value.Document = append(json.RawMessage(nil), document...)
	value.CreatedAt = utc(value.CreatedAt)
	value.ValidationMetadata, err = scanSummary(summary)
	return value, err
}

const versionColumns = `id,project_id,paywall_id,environment_id,version_number,source_draft_id,source_revision,protocol_version,document,document_hash,validation_metadata,created_by_actor_id,created_at`

func (r reader) PaywallVersion(id string) (hostedpublishing.PaywallVersion, bool) {
	return one(r, `SELECT `+versionColumns+` FROM paywall_versions WHERE id=$1`, scanVersion, id)
}

func (r reader) PaywallVersions(paywallID string) []hostedpublishing.PaywallVersion {
	return many(r, `SELECT `+versionColumns+` FROM paywall_versions WHERE paywall_id=$1 ORDER BY environment_id,version_number DESC`, scanVersion, paywallID)
}

func (r reader) LatestPaywallVersion(paywallID, environmentID string) (hostedpublishing.PaywallVersion, bool) {
	return one(r, `SELECT `+versionColumns+` FROM paywall_versions WHERE paywall_id=$1 AND environment_id=$2 ORDER BY version_number DESC LIMIT 1`, scanVersion, paywallID, environmentID)
}

func (r reader) VersionProducts(versionID string) []string {
	return many(r, `SELECT product_id FROM paywall_version_products WHERE version_id=$1 ORDER BY product_id`, func(row pgx.Row) (string, error) {
		var id string
		err := row.Scan(&id)
		return id, err
	}, versionID)
}

func (r reader) VersionAssets(versionID string) []hostedpublishing.VersionAsset {
	return many(r, `SELECT version_id,project_id,asset_id,document_asset_id FROM paywall_version_assets WHERE version_id=$1 ORDER BY document_asset_id`, func(row pgx.Row) (hostedpublishing.VersionAsset, error) {
		var value hostedpublishing.VersionAsset
		err := row.Scan(&value.VersionID, &value.ProjectID, &value.AssetID, &value.DocumentAssetID)
		return value, err
	}, versionID)
}

func scanPlacement(row pgx.Row) (hostedpublishing.Placement, error) {
	var value hostedpublishing.Placement
	err := row.Scan(&value.ID, &value.ProjectID, &value.Key, &value.Name, &value.Description, &value.Status, &value.ArchivedAt, &value.CreatedByActorID, &value.CreatedAt, &value.UpdatedAt)
	value.ArchivedAt = utcPtr(value.ArchivedAt)
	value.CreatedAt, value.UpdatedAt = utc(value.CreatedAt), utc(value.UpdatedAt)
	return value, err
}

const placementColumns = `id,project_id,key,name,description,status,archived_at,created_by_actor_id,created_at,updated_at`

func (r reader) Placement(id string) (hostedpublishing.Placement, bool) {
	return one(r, `SELECT `+placementColumns+` FROM placements WHERE id=$1`, scanPlacement, id)
}

func (r reader) Placements(projectID string) []hostedpublishing.Placement {
	return many(r, `SELECT `+placementColumns+` FROM placements WHERE project_id=$1 ORDER BY id`, scanPlacement, projectID)
}

func scanBinding(row pgx.Row) (hostedpublishing.PlacementBinding, error) {
	var value hostedpublishing.PlacementBinding
	err := row.Scan(&value.ProjectID, &value.EnvironmentID, &value.PlacementID, &value.PaywallID, &value.UpdatedByActorID, &value.UpdatedAt)
	value.UpdatedAt = utc(value.UpdatedAt)
	return value, err
}

const bindingColumns = `project_id,environment_id,placement_id,paywall_id,updated_by_actor_id,updated_at`

func (r reader) PlacementBinding(environmentID, placementID string) (hostedpublishing.PlacementBinding, bool) {
	return one(r, `SELECT `+bindingColumns+` FROM environment_placement_bindings WHERE environment_id=$1 AND placement_id=$2`, scanBinding, environmentID, placementID)
}

func (r reader) PlacementBindings(environmentID string) []hostedpublishing.PlacementBinding {
	return many(r, `SELECT `+bindingColumns+` FROM environment_placement_bindings WHERE environment_id=$1 ORDER BY placement_id`, scanBinding, environmentID)
}

func scanRelease(row pgx.Row) (hostedpublishing.Release, error) {
	var value hostedpublishing.Release
	var source, rollback *string
	var payload []byte
	err := row.Scan(&value.ID, &value.ProjectID, &value.EnvironmentID, &value.ReleaseNumber, &value.DeliveryContractVersion, &payload, &value.ContentHash, &source, &rollback, &value.PublishedByActorID, &value.PublishedAt)
	if err != nil {
		return value, err
	}
	value.Payload = append(json.RawMessage(nil), payload...)
	if source != nil {
		value.SourceReleaseID = *source
	}
	if rollback != nil {
		value.RollbackSourceReleaseID = *rollback
	}
	value.PublishedAt = utc(value.PublishedAt)
	return value, nil
}

const releaseColumns = `id,project_id,environment_id,release_number,delivery_contract_version,payload_bytes,content_hash,source_release_id,rollback_source_release_id,published_by_actor_id,published_at`

func (r reader) Release(id string) (hostedpublishing.Release, bool) {
	return one(r, `SELECT `+releaseColumns+` FROM configuration_releases WHERE id=$1`, scanRelease, id)
}

func (r reader) Releases(environmentID string) []hostedpublishing.Release {
	return many(r, `SELECT `+releaseColumns+` FROM configuration_releases WHERE environment_id=$1 ORDER BY release_number DESC`, scanRelease, environmentID)
}

func scanReleasePlacement(row pgx.Row) (hostedpublishing.ReleasePlacement, error) {
	var value hostedpublishing.ReleasePlacement
	err := row.Scan(&value.ReleaseID, &value.ProjectID, &value.EnvironmentID, &value.PlacementID, &value.PlacementKey, &value.PaywallVersionID)
	return value, err
}

func (r reader) ReleasePlacements(releaseID string) []hostedpublishing.ReleasePlacement {
	return many(r, `SELECT release_id,project_id,environment_id,placement_id,placement_key,paywall_version_id FROM configuration_release_placements WHERE release_id=$1 ORDER BY placement_key`, scanReleasePlacement, releaseID)
}

func (r reader) ReleaseProducts(releaseID string) []string {
	return many(r, `SELECT product_id FROM configuration_release_products WHERE release_id=$1 ORDER BY product_id`, func(row pgx.Row) (string, error) {
		var id string
		err := row.Scan(&id)
		return id, err
	}, releaseID)
}

func (r reader) ReleaseAssets(releaseID string) []string {
	return many(r, `SELECT asset_id FROM configuration_release_assets WHERE release_id=$1 ORDER BY asset_id`, func(row pgx.Row) (string, error) {
		var id string
		err := row.Scan(&id)
		return id, err
	}, releaseID)
}

func (r reader) ReleaseState(environmentID string) (hostedpublishing.ReleaseState, bool) {
	return one(r, `SELECT environment_id,project_id,current_release_id,last_release_number,updated_at FROM environment_release_state WHERE environment_id=$1`, func(row pgx.Row) (hostedpublishing.ReleaseState, error) {
		var value hostedpublishing.ReleaseState
		var current *string
		err := row.Scan(&value.EnvironmentID, &value.ProjectID, &current, &value.LastReleaseNumber, &value.UpdatedAt)
		if current != nil {
			value.CurrentReleaseID = *current
		}
		value.UpdatedAt = utc(value.UpdatedAt)
		return value, err
	}, environmentID)
}

func (r reader) PublicationRequest(environmentID, operation, keyHash string) (hostedpublishing.PublicationRequest, bool) {
	return one(r, `SELECT environment_id,operation,idempotency_key_hash,request_hash,result_release_id,created_at FROM publication_requests WHERE environment_id=$1 AND operation=$2 AND idempotency_key_hash=$3`, func(row pgx.Row) (hostedpublishing.PublicationRequest, error) {
		var value hostedpublishing.PublicationRequest
		err := row.Scan(&value.EnvironmentID, &value.Operation, &value.IdempotencyKeyHash, &value.RequestHash, &value.ResultReleaseID, &value.CreatedAt)
		value.CreatedAt = utc(value.CreatedAt)
		return value, err
	}, environmentID, operation, keyHash)
}

func (r reader) APIKeyByPrefix(prefix string) (hostedpublishing.APIKeyRecord, bool) {
	return one(r, `SELECT id,environment_id,kind,prefix,secret_digest,revoked_at FROM api_keys WHERE prefix=$1`, func(row pgx.Row) (hostedpublishing.APIKeyRecord, error) {
		var value hostedpublishing.APIKeyRecord
		err := row.Scan(&value.ID, &value.EnvironmentID, &value.Kind, &value.Prefix, &value.SecretDigest, &value.RevokedAt)
		value.RevokedAt = utcPtr(value.RevokedAt)
		return value, err
	}, prefix)
}

func scanCommerceConfiguration(row pgx.Row) (hostedpublishing.CommerceConfigurationSnapshot, error) {
	var value hostedpublishing.CommerceConfigurationSnapshot
	var payload []byte
	err := row.Scan(
		&value.ID, &value.ProjectID, &value.EnvironmentID, &value.ApplicationID,
		&value.StorePlatform, &value.ConfigurationReleaseID,
		&value.ConfigurationReleaseDigest, &value.ContentDigest, &payload, &value.CreatedAt,
	)
	value.Payload = append(json.RawMessage(nil), payload...)
	value.CreatedAt = utc(value.CreatedAt)
	return value, err
}

func (r reader) CommerceConfiguration(releaseID, applicationID string) (hostedpublishing.CommerceConfigurationSnapshot, bool) {
	return one(r, `SELECT id,project_id,environment_id,application_id,store_platform,configuration_release_id,configuration_release_digest,content_digest,payload::text::bytea,created_at FROM commerce_configuration_snapshots WHERE configuration_release_id=$1 AND application_id=$2`, scanCommerceConfiguration, releaseID, applicationID)
}

type transaction struct {
	reader
	tx pgx.Tx
}

func (t *transaction) LockScope(scope string) {
	t.exec(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, scope)
}

func (t *transaction) exec(query string, args ...any) {
	if t.err != nil {
		return
	}
	_, err := t.tx.Exec(t.ctx, query, args...)
	t.fail(err)
}

func (t *transaction) NextID(prefix string) string {
	if t.err != nil {
		return ""
	}
	var value int64
	err := t.tx.QueryRow(t.ctx, `INSERT INTO id_sequences(prefix,value) VALUES($1,1) ON CONFLICT(prefix) DO UPDATE SET value=id_sequences.value+1 RETURNING value`, prefix).Scan(&value)
	t.fail(err)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s_%06d", prefix, value)
}

func summaryJSON(value hostedpublishing.ValidationSummary) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (t *transaction) SavePaywall(value hostedpublishing.Paywall) {
	t.exec(`INSERT INTO paywalls(id,project_id,key,name,status,archived_at,created_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,archived_at=excluded.archived_at,updated_at=excluded.updated_at`, value.ID, value.ProjectID, value.Key, value.Name, value.Status, value.ArchivedAt, value.CreatedByActorID, value.CreatedAt, value.UpdatedAt)
}

func (t *transaction) SaveAsset(value hostedpublishing.Asset) {
	t.exec(`INSERT INTO assets(id,project_id,kind,original_filename,media_type,byte_length,content_digest,storage_key,public_url,status,created_by_actor_id,archived_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET status=excluded.status,archived_at=excluded.archived_at,updated_at=excluded.updated_at`, value.ID, value.ProjectID, value.Kind, value.OriginalFilename, value.MediaType, value.ByteLength, value.ContentDigest, value.StorageKey, value.URL, value.Status, value.CreatedByActorID, value.ArchivedAt, value.CreatedAt, value.UpdatedAt)
}

func (t *transaction) SaveDraft(value hostedpublishing.Draft) {
	t.exec(`INSERT INTO paywall_drafts(id,project_id,paywall_id,environment_id,status,current_revision,source_version_id,current_protocol_version,validation_status,validation_summary,created_by_actor_id,updated_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_revision=excluded.current_revision,current_protocol_version=excluded.current_protocol_version,validation_status=excluded.validation_status,validation_summary=excluded.validation_summary,updated_by_actor_id=excluded.updated_by_actor_id,updated_at=excluded.updated_at`, value.ID, value.ProjectID, value.PaywallID, value.EnvironmentID, value.Status, value.CurrentRevision, nullable(value.SourceVersionID), value.CurrentProtocolVersion, value.ValidationStatus, summaryJSON(value.ValidationSummary), value.CreatedByActorID, value.UpdatedByActorID, value.CreatedAt, value.UpdatedAt)
}

func (t *transaction) SaveDraftRevision(value hostedpublishing.DraftRevision) {
	t.exec(`INSERT INTO paywall_draft_revisions(draft_id,revision,project_id,protocol_version,document,document_hash,validation_status,validation_summary,mutation_key_hash,request_hash,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, value.DraftID, value.Revision, value.ProjectID, value.ProtocolVersion, value.Document, value.DocumentHash, value.ValidationStatus, summaryJSON(value.ValidationSummary), value.MutationKeyHash, value.RequestHash, value.ActorID, value.CreatedAt)
}

func (t *transaction) SavePaywallVersion(value hostedpublishing.PaywallVersion) {
	t.exec(`INSERT INTO paywall_versions(id,project_id,paywall_id,environment_id,version_number,source_draft_id,source_revision,protocol_version,document,document_hash,validation_metadata,created_by_actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, value.ID, value.ProjectID, value.PaywallID, value.EnvironmentID, value.VersionNumber, value.SourceDraftID, value.SourceRevision, value.ProtocolVersion, value.Document, value.DocumentHash, summaryJSON(value.ValidationMetadata), value.CreatedByActorID, value.CreatedAt)
}

func (t *transaction) SaveVersionProduct(versionID, projectID, productID string) {
	t.exec(`INSERT INTO paywall_version_products(version_id,project_id,product_id) VALUES($1,$2,$3)`, versionID, projectID, productID)
}

func (t *transaction) SaveVersionAsset(value hostedpublishing.VersionAsset) {
	t.exec(`INSERT INTO paywall_version_assets(version_id,project_id,asset_id,document_asset_id) VALUES($1,$2,$3,$4)`, value.VersionID, value.ProjectID, value.AssetID, value.DocumentAssetID)
}

func (t *transaction) SavePlacement(value hostedpublishing.Placement) {
	t.exec(`INSERT INTO placements(id,project_id,key,name,description,status,archived_at,created_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,status=excluded.status,archived_at=excluded.archived_at,updated_at=excluded.updated_at`, value.ID, value.ProjectID, value.Key, value.Name, value.Description, value.Status, value.ArchivedAt, value.CreatedByActorID, value.CreatedAt, value.UpdatedAt)
}

func (t *transaction) SavePlacementBinding(value hostedpublishing.PlacementBinding) {
	t.exec(`INSERT INTO environment_placement_bindings(project_id,environment_id,placement_id,paywall_id,updated_by_actor_id,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(environment_id,placement_id) DO UPDATE SET paywall_id=excluded.paywall_id,updated_by_actor_id=excluded.updated_by_actor_id,updated_at=excluded.updated_at`, value.ProjectID, value.EnvironmentID, value.PlacementID, value.PaywallID, value.UpdatedByActorID, value.UpdatedAt)
}

func (t *transaction) SaveRelease(value hostedpublishing.Release) {
	t.exec(`INSERT INTO configuration_releases(id,project_id,environment_id,release_number,delivery_contract_version,payload,payload_bytes,content_hash,source_release_id,rollback_source_release_id,published_by_actor_id,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, value.ID, value.ProjectID, value.EnvironmentID, value.ReleaseNumber, value.DeliveryContractVersion, value.Payload, []byte(value.Payload), value.ContentHash, nullable(value.SourceReleaseID), nullable(value.RollbackSourceReleaseID), value.PublishedByActorID, value.PublishedAt)
}

func (t *transaction) SaveReleasePlacement(value hostedpublishing.ReleasePlacement) {
	t.exec(`INSERT INTO configuration_release_placements(release_id,project_id,environment_id,placement_id,placement_key,paywall_version_id) VALUES($1,$2,$3,$4,$5,$6)`, value.ReleaseID, value.ProjectID, value.EnvironmentID, value.PlacementID, value.PlacementKey, value.PaywallVersionID)
}

func (t *transaction) SaveReleaseProduct(releaseID, environmentID, projectID, productID string) {
	t.exec(`INSERT INTO configuration_release_products(release_id,environment_id,project_id,product_id) VALUES($1,$2,$3,$4)`, releaseID, environmentID, projectID, productID)
}

func (t *transaction) SaveReleaseAsset(releaseID, environmentID, projectID, assetID string) {
	t.exec(`INSERT INTO configuration_release_assets(release_id,environment_id,project_id,asset_id) VALUES($1,$2,$3,$4)`, releaseID, environmentID, projectID, assetID)
}

func (t *transaction) SaveCommerceConfiguration(value hostedpublishing.CommerceConfigurationSnapshot) {
	t.exec(`INSERT INTO commerce_configuration_snapshots(id,project_id,environment_id,application_id,store_platform,configuration_release_id,configuration_release_digest,content_digest,payload,created_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		value.ID, value.ProjectID, value.EnvironmentID, value.ApplicationID,
		value.StorePlatform, value.ConfigurationReleaseID, value.ConfigurationReleaseDigest,
		value.ContentDigest, value.Payload, value.CreatedAt,
	)
}

func (t *transaction) SaveReleaseState(value hostedpublishing.ReleaseState) {
	t.exec(`UPDATE environment_release_state SET current_release_id=$2,last_release_number=$3,updated_at=$4 WHERE environment_id=$1`, value.EnvironmentID, nullable(value.CurrentReleaseID), value.LastReleaseNumber, value.UpdatedAt)
}

func (t *transaction) SavePublicationRequest(value hostedpublishing.PublicationRequest) {
	t.exec(`INSERT INTO publication_requests(environment_id,operation,idempotency_key_hash,request_hash,result_release_id,created_at) VALUES($1,$2,$3,$4,$5,$6)`, value.EnvironmentID, value.Operation, value.IdempotencyKeyHash, value.RequestHash, value.ResultReleaseID, value.CreatedAt)
}

func (t *transaction) SaveAuditEvent(value hostedpublishing.AuditEvent) {
	metadata, _ := json.Marshal(value.Metadata)
	t.exec(`INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, value.ID, value.ActorID, value.OrganizationID, nullable(value.ProjectID), nullable(value.EnvironmentID), value.Action, value.ResourceType, value.ResourceID, metadata, value.CreatedAt)
}

func (t *transaction) TouchAPIKey(id string) {
	t.exec(`UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now()-interval '15 minutes')`, id)
}

func persistenceError(err error) error {
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) {
		switch pgError.Code {
		case "23505":
			return hostedpublishing.ErrConflict
		case "23503":
			return hostedpublishing.ErrNotFound
		}
	}
	return fmt.Errorf("execute hosted publishing transaction: %w", err)
}

var _ hostedpublishing.Repository = (*Repository)(nil)
