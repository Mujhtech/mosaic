// Package cloudworkspacepostgres implements durable Phase 3A persistence with pgx.
package cloudworkspacepostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

type Repository struct{ pool *pgxpool.Pool }

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) View(ctx context.Context, fn func(cloudworkspace.Reader) error) error {
	state := &readState{ctx: ctx, q: r.pool}
	callbackErr := fn(reader{state})
	if state.err != nil {
		return fmt.Errorf("read cloud workspace: %w", state.err)
	}
	return callbackErr
}

func (r *Repository) Transact(ctx context.Context, fn func(cloudworkspace.Transaction) error) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin cloud workspace transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	state := &readState{ctx: ctx, q: tx}
	transaction := transaction{reader: reader{state}, tx: tx}
	callbackErr := fn(&transaction)
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

func scanOrganization(row pgx.Row) (cloudworkspace.Organization, error) {
	var v cloudworkspace.Organization
	err := row.Scan(&v.ID, &v.Name, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Organization(id string) (cloudworkspace.Organization, bool) {
	return one(r, `SELECT id,name,created_at,updated_at FROM organizations WHERE id=$1`, scanOrganization, id)
}
func (r reader) Organizations() []cloudworkspace.Organization {
	return many(r, `SELECT id,name,created_at,updated_at FROM organizations ORDER BY id`, scanOrganization)
}

// OrganizationsForActor joins membership in SQL so the cost of listing a user's
// Organizations is proportional to their memberships, not to every tenant in
// the installation.
func (r reader) OrganizationsForActor(actorID string) []cloudworkspace.Organization {
	return many(r, `SELECT o.id,o.name,o.created_at,o.updated_at
		FROM organizations o
		JOIN organization_members m ON m.organization_id = o.id
		WHERE m.actor_id = $1
		ORDER BY o.id`, scanOrganization, actorID)
}

func scanMembership(row pgx.Row) (cloudworkspace.Membership, error) {
	var v cloudworkspace.Membership
	err := row.Scan(&v.OrganizationID, &v.ActorID, &v.Role, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Membership(orgID, actorID string) (cloudworkspace.Membership, bool) {
	return one(r, `SELECT organization_id,actor_id,role,created_at,updated_at FROM organization_members WHERE organization_id=$1 AND actor_id=$2`, scanMembership, orgID, actorID)
}
func (r reader) Memberships(orgID string) []cloudworkspace.Membership {
	return many(r, `SELECT organization_id,actor_id,role,created_at,updated_at FROM organization_members WHERE organization_id=$1 ORDER BY actor_id`, scanMembership, orgID)
}

func scanProject(row pgx.Row) (cloudworkspace.Project, error) {
	var v cloudworkspace.Project
	err := row.Scan(&v.ID, &v.OrganizationID, &v.Key, &v.Name, &v.Status, &v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Project(id string) (cloudworkspace.Project, bool) {
	return one(r, `SELECT id,organization_id,key,name,status,archived_at,created_at,updated_at FROM projects WHERE id=$1`, scanProject, id)
}
func (r reader) Projects(orgID string) []cloudworkspace.Project {
	return many(r, `SELECT id,organization_id,key,name,status,archived_at,created_at,updated_at FROM projects WHERE organization_id=$1 ORDER BY id`, scanProject, orgID)
}

func scanApplication(row pgx.Row) (cloudworkspace.Application, error) {
	var v cloudworkspace.Application
	err := row.Scan(&v.ID, &v.ProjectID, &v.Name, &v.Platform, &v.Identifier, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Application(id string) (cloudworkspace.Application, bool) {
	return one(r, `SELECT id,project_id,name,platform,identifier,created_at,updated_at FROM applications WHERE id=$1`, scanApplication, id)
}
func (r reader) Applications(projectID string) []cloudworkspace.Application {
	return many(r, `SELECT id,project_id,name,platform,identifier,created_at,updated_at FROM applications WHERE project_id=$1 ORDER BY id`, scanApplication, projectID)
}

func scanEnvironment(row pgx.Row) (cloudworkspace.Environment, error) {
	var v cloudworkspace.Environment
	err := row.Scan(&v.ID, &v.ProjectID, &v.Key, &v.Name, &v.Mode, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Environment(id string) (cloudworkspace.Environment, bool) {
	return one(r, `SELECT id,project_id,key,name,mode,created_at,updated_at FROM environments WHERE id=$1`, scanEnvironment, id)
}
func (r reader) Environments(projectID string) []cloudworkspace.Environment {
	return many(r, `SELECT id,project_id,key,name,mode,created_at,updated_at FROM environments WHERE project_id=$1 ORDER BY key`, scanEnvironment, projectID)
}

func scanAPIKey(row pgx.Row) (cloudworkspace.APIKeyRecord, error) {
	var v cloudworkspace.APIKeyRecord
	var digest []byte
	err := row.Scan(&v.ID, &v.EnvironmentID, &v.ApplicationID, &v.ApplicationProjectID, &v.Kind, &v.Prefix, &v.CreatedByActorID, &v.CreatedAt, &v.RotatedAt, &v.RevokedAt, &v.LastUsedAt, &digest)
	if err == nil {
		if len(digest) != len(v.SecretDigest) {
			return v, fmt.Errorf("API key %s has invalid digest length", v.ID)
		}
		copy(v.SecretDigest[:], digest)
	}
	return v, err
}
func (r reader) APIKey(id string) (cloudworkspace.APIKeyRecord, bool) {
	return one(r, `SELECT id,environment_id,COALESCE(application_id,''),COALESCE(application_project_id,''),kind,prefix,created_by_actor_id,created_at,rotated_at,revoked_at,last_used_at,secret_digest FROM api_keys WHERE id=$1`, scanAPIKey, id)
}
func (r reader) APIKeys(environmentID string) []cloudworkspace.APIKeyRecord {
	return many(r, `SELECT id,environment_id,COALESCE(application_id,''),COALESCE(application_project_id,''),kind,prefix,created_by_actor_id,created_at,rotated_at,revoked_at,last_used_at,secret_digest FROM api_keys WHERE environment_id=$1 ORDER BY id`, scanAPIKey, environmentID)
}

func scanPlan(row pgx.Row) (cloudworkspace.Plan, error) {
	var v cloudworkspace.Plan
	err := row.Scan(&v.ID, &v.ProjectID, &v.Key, &v.Name, &v.Description, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Plan(id string) (cloudworkspace.Plan, bool) {
	return one(r, `SELECT id,project_id,key,name,description,created_at,updated_at FROM plans WHERE id=$1`, scanPlan, id)
}
func (r reader) Plans(projectID string) []cloudworkspace.Plan {
	return many(r, `SELECT id,project_id,key,name,description,created_at,updated_at FROM plans WHERE project_id=$1 ORDER BY id`, scanPlan, projectID)
}

func scanProduct(row pgx.Row) (cloudworkspace.Product, error) {
	var v cloudworkspace.Product
	var reasons []byte
	var replacement *string
	err := row.Scan(&v.ID, &v.ProjectID, &v.Key, &v.InternalName, &v.Description, &v.Type, &v.Status, &v.MetadataSource, &v.Readiness.Ready, &reasons, &replacement, &v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt)
	if err == nil {
		if replacement != nil {
			v.ReplacementProductID = *replacement
		}
		err = json.Unmarshal(reasons, &v.Readiness.Reasons)
		v.Readiness.MetadataSource = v.MetadataSource
	}
	return v, err
}

const productColumns = `id,project_id,key,internal_name,description,type,status,metadata_source,readiness_ready,readiness_reasons,replacement_product_id,archived_at,created_at,updated_at`

func (r reader) Product(id string) (cloudworkspace.Product, bool) {
	return one(r, `SELECT `+productColumns+` FROM products WHERE id=$1`, scanProduct, id)
}
func (r reader) Products(projectID string) []cloudworkspace.Product {
	return many(r, `SELECT `+productColumns+` FROM products WHERE project_id=$1 ORDER BY id`, scanProduct, projectID)
}

func scanEntitlement(row pgx.Row) (cloudworkspace.Entitlement, error) {
	var v cloudworkspace.Entitlement
	err := row.Scan(&v.ID, &v.ProjectID, &v.Key, &v.Name, &v.Description, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Entitlement(id string) (cloudworkspace.Entitlement, bool) {
	return one(r, `SELECT id,project_id,key,name,description,created_at,updated_at FROM entitlements WHERE id=$1`, scanEntitlement, id)
}
func (r reader) Entitlements(projectID string) []cloudworkspace.Entitlement {
	return many(r, `SELECT id,project_id,key,name,description,created_at,updated_at FROM entitlements WHERE project_id=$1 ORDER BY id`, scanEntitlement, projectID)
}

func scanPlanProduct(row pgx.Row) (cloudworkspace.PlanProduct, error) {
	var v cloudworkspace.PlanProduct
	err := row.Scan(&v.PlanID, &v.ProductID, &v.CreatedAt)
	return v, err
}
func (r reader) PlanProducts(planID string) []cloudworkspace.PlanProduct {
	return many(r, `SELECT plan_id,product_id,created_at FROM plan_products WHERE plan_id=$1 ORDER BY product_id`, scanPlanProduct, planID)
}
func scanGrant(row pgx.Row) (cloudworkspace.ProductEntitlementGrant, error) {
	var v cloudworkspace.ProductEntitlementGrant
	err := row.Scan(&v.ProductID, &v.EntitlementID, &v.CreatedAt)
	return v, err
}
func (r reader) ProductGrants(productID string) []cloudworkspace.ProductEntitlementGrant {
	return many(r, `SELECT product_id,entitlement_id,created_at FROM product_entitlement_grants WHERE product_id=$1 ORDER BY entitlement_id`, scanGrant, productID)
}
func scanReplacement(row pgx.Row) (cloudworkspace.ProductReplacementHistory, error) {
	var v cloudworkspace.ProductReplacementHistory
	err := row.Scan(&v.ProjectID, &v.ProductID, &v.ReplacementProductID, &v.ChangedAt)
	return v, err
}
func (r reader) ProductReplacementHistory(productID string) []cloudworkspace.ProductReplacementHistory {
	return many(r, `SELECT project_id,product_id,replacement_product_id,changed_at FROM product_replacement_history WHERE product_id=$1 OR replacement_product_id=$1 ORDER BY id`, scanReplacement, productID)
}

func scanProviderConnection(row pgx.Row) (cloudworkspace.ProviderConnection, error) {
	var v cloudworkspace.ProviderConnection
	var externalProjectID, lastErrorCode *string
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.Name, &v.Provider, &v.IntegrationMode, &v.Mode,
		&v.Status, &v.HealthStatus, &externalProjectID, &v.LastSuccessfulTestAt,
		&v.LastSuccessfulSyncAt, &lastErrorCode, &v.RevokedAt, &v.CreatedAt, &v.UpdatedAt,
	)
	if externalProjectID != nil {
		v.ExternalProjectID = *externalProjectID
	}
	if lastErrorCode != nil {
		v.LastErrorCode = cloudworkspace.ProviderErrorCode(*lastErrorCode)
	}
	return v, err
}

const providerConnectionColumns = `id,project_id,name,provider,integration_mode,mode,status,health_status,external_project_id,last_successful_test_at,last_successful_sync_at,last_error_code,revoked_at,created_at,updated_at`

func (r reader) ProviderConnection(id string) (cloudworkspace.ProviderConnection, bool) {
	return one(r, `SELECT `+providerConnectionColumns+` FROM provider_connections WHERE id=$1`, scanProviderConnection, id)
}
func (r reader) ProviderConnections(projectID string) []cloudworkspace.ProviderConnection {
	return many(r, `SELECT `+providerConnectionColumns+` FROM provider_connections WHERE project_id=$1 ORDER BY id`, scanProviderConnection, projectID)
}
func scanString(row pgx.Row) (string, error) {
	var value string
	err := row.Scan(&value)
	return value, err
}
func (r reader) ProviderConnectionEnvironmentIDs(connectionID string) []string {
	return many(r, `SELECT environment_id FROM provider_connection_environment_scopes WHERE connection_id=$1 ORDER BY environment_id`, scanString, connectionID)
}
func (r reader) ProviderConnectionApplicationIDs(connectionID string) []string {
	return many(r, `SELECT application_id FROM provider_connection_application_scopes WHERE connection_id=$1 ORDER BY application_id`, scanString, connectionID)
}

func scanProviderCredential(row pgx.Row) (cloudworkspace.ProviderCredentialRecord, error) {
	var v cloudworkspace.ProviderCredentialRecord
	err := row.Scan(
		&v.ConnectionID, &v.ProjectID, &v.OrganizationID, &v.Class, &v.Version,
		&v.Algorithm, &v.KeyID, &v.Nonce, &v.Ciphertext, &v.Fingerprint,
		&v.CreatedAt, &v.RotatedAt, &v.RevokedAt, &v.UpdatedAt,
	)
	return v, err
}
func (r reader) ProviderCredential(connectionID string) (cloudworkspace.ProviderCredentialRecord, bool) {
	return one(r, `SELECT connection_id,project_id,organization_id,credential_class,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_at,rotated_at,revoked_at,updated_at FROM provider_connection_credentials WHERE connection_id=$1`, scanProviderCredential, connectionID)
}

func scanProviderDiagnostic(row pgx.Row) (cloudworkspace.ProviderDiagnostic, error) {
	var v cloudworkspace.ProviderDiagnostic
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.ConnectionID, &v.Operation, &v.Code,
		&v.Retryable, &v.RetryAfterSeconds, &v.CorrelationID, &v.OccurredAt,
	)
	return v, err
}
func (r reader) ProviderDiagnostics(connectionID string) []cloudworkspace.ProviderDiagnostic {
	return many(r, `SELECT id,project_id,connection_id,operation,code,retryable,retry_after_seconds,correlation_id,occurred_at FROM provider_diagnostics WHERE connection_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 100`, scanProviderDiagnostic, connectionID)
}

func scanProviderAssignment(row pgx.Row) (cloudworkspace.ActiveProviderAssignment, error) {
	var v cloudworkspace.ActiveProviderAssignment
	var connectionID *string
	err := row.Scan(
		&v.ProjectID, &v.EnvironmentID, &v.ApplicationID, &v.Platform, &v.Provider,
		&v.ActivationKind, &connectionID,
		&v.ProductionConnectionUseAcknowledged, &v.CreatedByActorID, &v.CreatedAt, &v.UpdatedAt,
	)
	if connectionID != nil {
		v.ConnectionID = *connectionID
	}
	return v, err
}

const providerAssignmentColumns = `project_id,environment_id,application_id,platform,provider,activation_kind,connection_id,production_connection_use_acknowledged,created_by_actor_id,created_at,updated_at`

func (r reader) ActiveProviderAssignment(environmentID, applicationID string) (cloudworkspace.ActiveProviderAssignment, bool) {
	return one(r, `SELECT `+providerAssignmentColumns+` FROM active_provider_assignments WHERE environment_id=$1 AND application_id=$2`, scanProviderAssignment, environmentID, applicationID)
}
func (r reader) ProviderAssignments(connectionID string) []cloudworkspace.ActiveProviderAssignment {
	return many(r, `SELECT `+providerAssignmentColumns+` FROM active_provider_assignments WHERE connection_id=$1 ORDER BY environment_id,application_id`, scanProviderAssignment, connectionID)
}

func scanMapping(row pgx.Row) (cloudworkspace.ProviderProductMapping, error) {
	var v cloudworkspace.ProviderProductMapping
	var connectionID, environmentID, packageID, offeringID, expectedStoreID, basePlanID, offerID, replacesID, currentSnapshotID, lastErrorCode *string
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.ProductID, &connectionID, &environmentID, &v.ApplicationID,
		&v.Platform, &v.Provider, &v.ProviderProductIdentifier, &packageID, &offeringID,
		&expectedStoreID, &basePlanID, &offerID, &replacesID,
		&v.Status, &v.Availability, &v.SyncState, &currentSnapshotID,
		&lastErrorCode, &v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt,
	)
	if connectionID != nil {
		v.ConnectionID = *connectionID
	}
	if environmentID != nil {
		v.EnvironmentID = *environmentID
	}
	if packageID != nil {
		v.ProviderPackageIdentifier = *packageID
	}
	if offeringID != nil {
		v.ProviderOfferingIdentifier = *offeringID
	}
	if expectedStoreID != nil {
		v.ExpectedStoreProductID = *expectedStoreID
	}
	if basePlanID != nil {
		v.ProviderBasePlanIdentifier = *basePlanID
	}
	if offerID != nil {
		v.ProviderOfferIdentifier = *offerID
	}
	if replacesID != nil {
		v.ReplacesMappingID = *replacesID
	}
	if currentSnapshotID != nil {
		v.CurrentSnapshotID = *currentSnapshotID
	}
	if lastErrorCode != nil {
		v.LastErrorCode = cloudworkspace.ProviderErrorCode(*lastErrorCode)
	}
	return v, err
}

const providerMappingColumns = `id,project_id,product_id,connection_id,environment_id,application_id,platform,provider,provider_product_identifier,provider_package_identifier,provider_offering_identifier,expected_store_product_id,provider_base_plan_identifier,provider_offer_identifier,replaces_mapping_id,status,availability,sync_state,current_snapshot_id,last_error_code,archived_at,created_at,updated_at`

func (r reader) ProviderMapping(id string) (cloudworkspace.ProviderProductMapping, bool) {
	return one(r, `SELECT `+providerMappingColumns+` FROM provider_product_mappings WHERE id=$1`, scanMapping, id)
}
func (r reader) ProviderMappings(productID string) []cloudworkspace.ProviderProductMapping {
	return many(r, `SELECT `+providerMappingColumns+` FROM provider_product_mappings WHERE product_id=$1 ORDER BY id`, scanMapping, productID)
}
func (r reader) ProviderMappingsByConnection(connectionID string) []cloudworkspace.ProviderProductMapping {
	return many(r, `SELECT `+providerMappingColumns+` FROM provider_product_mappings WHERE connection_id=$1 ORDER BY id`, scanMapping, connectionID)
}
func (r reader) NativeProviderMappingByTarget(provider cloudworkspace.ProviderKind, environmentID, applicationID string, platform cloudworkspace.Platform, target string) (cloudworkspace.ProviderProductMapping, bool) {
	return one(r, `SELECT `+providerMappingColumns+` FROM provider_product_mappings
		WHERE connection_id IS NULL AND provider=$1 AND environment_id=$2 AND application_id=$3
		  AND platform=$4 AND provider_product_identifier=$5
		  AND status IN ('draft','active','attention_required')
		ORDER BY id LIMIT 1`,
		scanMapping, provider, environmentID, applicationID, platform, target,
	)
}

func scanProviderMetadataSnapshot(row pgx.Row) (cloudworkspace.ProviderProductMetadataSnapshot, error) {
	var v cloudworkspace.ProviderProductMetadataSnapshot
	var lastErrorCode *string
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.MappingID, &v.Source, &v.Digest, &v.Availability,
		&v.ObservedAt, &v.SyncedAt, &v.StaleAt, &v.ExpiresAt, &lastErrorCode,
		&v.Metadata, &v.CreatedAt,
	)
	if lastErrorCode != nil {
		v.LastErrorCode = cloudworkspace.ProviderErrorCode(*lastErrorCode)
	}
	return v, err
}
func (r reader) ProviderMetadataSnapshot(id string) (cloudworkspace.ProviderProductMetadataSnapshot, bool) {
	return one(r, `SELECT id,project_id,mapping_id,source,digest,availability,observed_at,synced_at,stale_at,expires_at,last_error_code,normalized_metadata,created_at FROM provider_product_metadata_snapshots WHERE id=$1`, scanProviderMetadataSnapshot, id)
}

func scanProviderMappingObservation(row pgx.Row) (cloudworkspace.ProviderMappingObservation, error) {
	var v cloudworkspace.ProviderMappingObservation
	var metadata []byte
	// diagnostic_code is written as SQL NULL for an observation that carries no
	// diagnostic -- that is, every successful one -- so scanning it into a
	// string failed with "cannot scan NULL into *string" and listing
	// observations broke as soon as one succeeded.
	var diagnosticCode *string
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.MappingID, &v.EnvironmentID, &v.ApplicationID,
		&v.Platform, &v.Provider, &v.AdapterVersion, &v.StoreContext, &v.Result,
		&diagnosticCode, &v.CorrelationID, &metadata, &v.ObservedAt,
		&v.ExpiresAt, &v.ReceivedAt, &v.CreatedByActorID,
	)
	if err == nil {
		if diagnosticCode != nil {
			v.DiagnosticCode = *diagnosticCode
		}
		err = json.Unmarshal(metadata, &v.Metadata)
	}
	return v, err
}

// decodeAuditMetadata reads stored audit metadata leniently.
//
// AuditEvent.Metadata is map[string]string, but the Experiment writers record
// map[string]any values including revision numbers and validation booleans.
// Decoding straight into map[string]string therefore failed with "cannot
// unmarshal number into Go value of type string", and because audit history is
// immutable, one Experiment action made
// GET /v1/organizations/{id}/audit-events return 500 for that Organization
// permanently -- the audit trail became unreadable exactly where it matters.
//
// Non-string scalars are rendered as their JSON text and structured values as
// compact JSON, so history written before this fix is readable and the public
// contract stays a string map.
func decodeAuditMetadata(raw []byte) (map[string]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return nil, nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		var text string
		if err := json.Unmarshal(value, &text); err == nil {
			result[key] = text
			continue
		}
		result[key] = string(value)
	}
	return result, nil
}

const providerMappingObservationColumns = `id,project_id,mapping_id,environment_id,application_id,platform,provider,adapter_version,store_context,result,diagnostic_code,correlation_id,metadata,observed_at,expires_at,received_at,created_by_actor_id`

func (r reader) ProviderMappingObservation(id string) (cloudworkspace.ProviderMappingObservation, bool) {
	return one(r, `SELECT `+providerMappingObservationColumns+` FROM provider_mapping_observations WHERE id=$1`, scanProviderMappingObservation, id)
}
func (r reader) ProviderMappingObservations(mappingID string) []cloudworkspace.ProviderMappingObservation {
	return many(r, `SELECT `+providerMappingObservationColumns+` FROM provider_mapping_observations WHERE mapping_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 100`, scanProviderMappingObservation, mappingID)
}

func scanProviderEntitlementMapping(row pgx.Row) (cloudworkspace.ProviderEntitlementMapping, error) {
	var v cloudworkspace.ProviderEntitlementMapping
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.EntitlementID, &v.ConnectionID, &v.EnvironmentID,
		&v.ApplicationID, &v.ProviderEntitlementIdentifier, &v.Status,
		&v.ArchivedAt, &v.CreatedAt, &v.UpdatedAt,
	)
	return v, err
}
func (r reader) ProviderEntitlementMappings(connectionID, environmentID, applicationID string) []cloudworkspace.ProviderEntitlementMapping {
	return many(r, `SELECT id,project_id,entitlement_id,connection_id,environment_id,application_id,provider_entitlement_identifier,status,archived_at,created_at,updated_at FROM provider_entitlement_mappings WHERE connection_id=$1 AND environment_id=$2 AND application_id=$3 ORDER BY id`, scanProviderEntitlementMapping, connectionID, environmentID, applicationID)
}

func scanProviderImport(row pgx.Row) (cloudworkspace.ProviderImportRequest, error) {
	var v cloudworkspace.ProviderImportRequest
	var keyHash, requestHash []byte
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.ConnectionID, &keyHash, &requestHash, &v.Status,
		&v.CreatedByActorID, &v.CreatedAt, &v.CompletedAt,
	)
	if err == nil && (len(keyHash) != len(v.IdempotencyKeyHash) || len(requestHash) != len(v.RequestHash)) {
		return v, errors.New("provider import has invalid digest length")
	}
	copy(v.IdempotencyKeyHash[:], keyHash)
	copy(v.RequestHash[:], requestHash)
	return v, err
}
func (r reader) ProviderImportByKeyHash(projectID string, keyHash [32]byte) (cloudworkspace.ProviderImportRequest, bool) {
	return one(r, `SELECT id,project_id,connection_id,idempotency_key_hash,request_hash,status,created_by_actor_id,created_at,completed_at FROM provider_import_requests WHERE project_id=$1 AND idempotency_key_hash=$2`, scanProviderImport, projectID, keyHash[:])
}

func scanProviderImportItem(row pgx.Row) (cloudworkspace.ProviderImportItem, error) {
	var v cloudworkspace.ProviderImportItem
	var productID, mappingID, errorCode *string
	err := row.Scan(
		&v.ImportID, &v.ProjectID, &v.ProviderProductIdentifier, &productID,
		&mappingID, &v.Status, &errorCode, &v.CreatedAt,
	)
	if productID != nil {
		v.MosaicProductID = *productID
	}
	if mappingID != nil {
		v.MappingID = *mappingID
	}
	if errorCode != nil {
		v.ErrorCode = cloudworkspace.ProviderErrorCode(*errorCode)
	}
	return v, err
}
func (r reader) ProviderImportItems(importID string) []cloudworkspace.ProviderImportItem {
	return many(r, `SELECT import_id,project_id,provider_product_identifier,mosaic_product_id,mapping_id,status,error_code,created_at FROM provider_import_items WHERE import_id=$1 ORDER BY provider_product_identifier`, scanProviderImportItem, importID)
}

func scanProviderSyncJob(row pgx.Row) (cloudworkspace.ProviderSyncJob, error) {
	var v cloudworkspace.ProviderSyncJob
	var leaseOwner *string
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.ConnectionID, &v.Status, &v.AttemptCount,
		&v.MaxAttempts, &v.AvailableAt, &leaseOwner, &v.LeaseExpiresAt,
		&v.RequestedByActorID, &v.CreatedAt, &v.UpdatedAt,
	)
	if leaseOwner != nil {
		v.LeaseOwner = *leaseOwner
	}
	return v, err
}

const providerSyncJobColumns = `id,project_id,connection_id,status,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,requested_by_actor_id,created_at,updated_at`
const leasedProviderSyncJobColumns = `job.id,job.project_id,job.connection_id,job.status,job.attempt_count,job.max_attempts,job.available_at,job.lease_owner,job.lease_expires_at,job.requested_by_actor_id,job.created_at,job.updated_at`

func (r reader) ProviderSyncJobs(connectionID string) []cloudworkspace.ProviderSyncJob {
	return many(r, `SELECT `+providerSyncJobColumns+` FROM provider_sync_jobs WHERE connection_id=$1 ORDER BY created_at DESC,id DESC`, scanProviderSyncJob, connectionID)
}

func scanProviderSyncRun(row pgx.Row) (cloudworkspace.ProviderSyncRun, error) {
	var v cloudworkspace.ProviderSyncRun
	err := row.Scan(
		&v.ID, &v.ProjectID, &v.ConnectionID, &v.JobID, &v.Status, &v.ItemCount,
		&v.SuccessCount, &v.FailureCount, &v.StartedAt, &v.CompletedAt, &v.CreatedAt,
	)
	return v, err
}
func (r reader) ProviderSyncRuns(connectionID string) []cloudworkspace.ProviderSyncRun {
	return many(r, `SELECT id,project_id,connection_id,job_id,status,item_count,success_count,failure_count,started_at,completed_at,created_at FROM provider_sync_runs WHERE connection_id=$1 ORDER BY started_at DESC,id DESC`, scanProviderSyncRun, connectionID)
}
func scanAudit(row pgx.Row) (cloudworkspace.AuditEvent, error) {
	var v cloudworkspace.AuditEvent
	var projectID, environmentID *string
	var metadata []byte
	err := row.Scan(&v.ID, &v.ActorID, &v.OrganizationID, &projectID, &environmentID, &v.Action, &v.ResourceType, &v.ResourceID, &metadata, &v.CreatedAt)
	if err == nil {
		if projectID != nil {
			v.ProjectID = *projectID
		}
		if environmentID != nil {
			v.EnvironmentID = *environmentID
		}
		v.Metadata, err = decodeAuditMetadata(metadata)
	}
	return v, err
}
func (r reader) AuditEvents(orgID string) []cloudworkspace.AuditEvent {
	return many(r, `SELECT id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at FROM audit_events WHERE organization_id=$1 ORDER BY id`, scanAudit, orgID)
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
func (t *transaction) SaveOrganization(v cloudworkspace.Organization) {
	t.exec(`INSERT INTO organizations(id,name,created_at,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`, v.ID, v.Name, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) SaveMembership(v cloudworkspace.Membership) {
	t.exec(`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,actor_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`, v.OrganizationID, v.ActorID, v.Role, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) DeleteMembership(orgID, actorID string) {
	t.exec(`DELETE FROM organization_members WHERE organization_id=$1 AND actor_id=$2`, orgID, actorID)
}
func (t *transaction) SaveProject(v cloudworkspace.Project) {
	t.exec(`INSERT INTO projects(id,organization_id,key,name,status,archived_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET key=excluded.key,name=excluded.name,status=excluded.status,archived_at=excluded.archived_at,updated_at=excluded.updated_at`, v.ID, v.OrganizationID, v.Key, v.Name, v.Status, v.ArchivedAt, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) SaveApplication(v cloudworkspace.Application) {
	t.exec(`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,identifier=excluded.identifier,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Name, v.Platform, v.Identifier, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) SaveEnvironment(v cloudworkspace.Environment) {
	t.exec(`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,mode=excluded.mode,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Key, v.Name, v.Mode, v.CreatedAt, v.UpdatedAt)
	// An Environment without an analytics settings row is not "collection
	// disabled" — the repository reports it as ErrNotFound, and every analytics
	// read and the overview surface degrade to an unavailable metric. Seeding it
	// in the same transaction as the Environment keeps that state unreachable
	// rather than merely unlikely, so the absent-row error stays honest.
	//
	// Migration 00012's AFTER INSERT trigger already inserts this row, and from
	// 00066 it does so enabled. This statement is deliberately redundant with the
	// trigger: it states the guarantee where the Environment is written, so a
	// future migration that retires the trigger cannot quietly take the
	// guarantee with it. `collection_enabled` is named explicitly for the same
	// reason; `raw_retention_days` is left to the column default so the
	// retention window is stated in one place.
	t.exec(`INSERT INTO analytics_environment_settings(environment_id,project_id,collection_enabled) VALUES($1,$2,true) ON CONFLICT(environment_id) DO NOTHING`, v.ID, v.ProjectID)
}
func (t *transaction) SaveAPIKey(v cloudworkspace.APIKeyRecord) {
	t.exec(`INSERT INTO api_keys(id,environment_id,application_id,application_project_id,kind,prefix,secret_digest,created_by_actor_id,created_at,rotated_at,revoked_at,last_used_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET secret_digest=excluded.secret_digest,rotated_at=excluded.rotated_at,revoked_at=COALESCE(api_keys.revoked_at,excluded.revoked_at),last_used_at=excluded.last_used_at`, v.ID, v.EnvironmentID, nullable(v.ApplicationID), nullable(v.ApplicationProjectID), v.Kind, v.Prefix, v.SecretDigest[:], v.CreatedByActorID, v.CreatedAt, v.RotatedAt, v.RevokedAt, v.LastUsedAt)
}
func (t *transaction) SavePlan(v cloudworkspace.Plan) {
	t.exec(`INSERT INTO plans(id,project_id,key,name,description,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET key=excluded.key,name=excluded.name,description=excluded.description,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Key, v.Name, v.Description, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) SaveProduct(v cloudworkspace.Product) {
	if t.err != nil {
		return
	}
	reasons, _ := json.Marshal(v.Readiness.Reasons)
	var replacement any
	if v.ReplacementProductID != "" {
		replacement = v.ReplacementProductID
	}
	t.exec(`INSERT INTO products(id,project_id,key,internal_name,description,type,status,metadata_source,readiness_ready,readiness_reasons,replacement_product_id,archived_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET key=excluded.key,internal_name=excluded.internal_name,description=excluded.description,type=excluded.type,status=excluded.status,metadata_source=excluded.metadata_source,readiness_ready=excluded.readiness_ready,readiness_reasons=excluded.readiness_reasons,replacement_product_id=excluded.replacement_product_id,archived_at=excluded.archived_at,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Key, v.InternalName, v.Description, v.Type, v.Status, v.MetadataSource, v.Readiness.Ready, reasons, replacement, v.ArchivedAt, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) DeleteProduct(id string) { t.exec(`DELETE FROM products WHERE id=$1`, id) }
func (t *transaction) SaveEntitlement(v cloudworkspace.Entitlement) {
	t.exec(`INSERT INTO entitlements(id,project_id,key,name,description,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET key=excluded.key,name=excluded.name,description=excluded.description,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Key, v.Name, v.Description, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) SavePlanProduct(v cloudworkspace.PlanProduct) {
	t.exec(`INSERT INTO plan_products(project_id,plan_id,product_id,created_at) SELECT p.project_id,$1,$2,$3 FROM plans p WHERE p.id=$1`, v.PlanID, v.ProductID, v.CreatedAt)
}
func (t *transaction) DeletePlanProduct(planID, productID string) {
	t.exec(`DELETE FROM plan_products WHERE plan_id=$1 AND product_id=$2`, planID, productID)
}
func (t *transaction) SaveProductGrant(v cloudworkspace.ProductEntitlementGrant) {
	t.exec(`INSERT INTO product_entitlement_grants(project_id,product_id,entitlement_id,created_at) SELECT p.project_id,$1,$2,$3 FROM products p WHERE p.id=$1`, v.ProductID, v.EntitlementID, v.CreatedAt)
}
func (t *transaction) SaveProductReplacement(v cloudworkspace.ProductReplacementHistory) {
	t.exec(`INSERT INTO product_replacement_history(project_id,product_id,replacement_product_id,changed_at) VALUES($1,$2,$3,$4)`, v.ProjectID, v.ProductID, v.ReplacementProductID, v.ChangedAt)
}
func (t *transaction) DeleteProductGrant(productID, entitlementID string) {
	t.exec(`DELETE FROM product_entitlement_grants WHERE product_id=$1 AND entitlement_id=$2`, productID, entitlementID)
}

// jsonObjectOrEmpty keeps a nil or empty JSON document out of a NOT NULL jsonb
// column. `provider_product_metadata_snapshots.normalized_metadata` is
// NOT NULL with a `{}` default and an "is an object" CHECK, but an explicit
// NULL overrides a column default, so a snapshot recorded for a provider
// Product that carries no normalized metadata failed the insert outright.
func jsonObjectOrEmpty(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}

func emptyStringAsNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func (t *transaction) SaveProviderConnection(v cloudworkspace.ProviderConnection) {
	t.exec(
		`INSERT INTO provider_connections(id,project_id,name,provider,integration_mode,mode,status,health_status,external_project_id,last_successful_test_at,last_successful_sync_at,last_error_code,revoked_at,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		 ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,health_status=excluded.health_status,external_project_id=excluded.external_project_id,last_successful_test_at=excluded.last_successful_test_at,last_successful_sync_at=excluded.last_successful_sync_at,last_error_code=excluded.last_error_code,revoked_at=excluded.revoked_at,updated_at=excluded.updated_at`,
		v.ID, v.ProjectID, v.Name, v.Provider, v.IntegrationMode, v.Mode, v.Status, v.HealthStatus,
		emptyStringAsNil(v.ExternalProjectID), v.LastSuccessfulTestAt, v.LastSuccessfulSyncAt,
		emptyStringAsNil(string(v.LastErrorCode)), v.RevokedAt, v.CreatedAt, v.UpdatedAt,
	)
}
func (t *transaction) SaveProviderCredential(v cloudworkspace.ProviderCredentialRecord) {
	t.exec(
		`INSERT INTO provider_connection_credentials(connection_id,project_id,organization_id,credential_class,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_at,rotated_at,revoked_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		 ON CONFLICT(connection_id) DO UPDATE SET credential_class=excluded.credential_class,envelope_version=excluded.envelope_version,algorithm=excluded.algorithm,key_id=excluded.key_id,nonce=excluded.nonce,ciphertext=excluded.ciphertext,fingerprint=excluded.fingerprint,rotated_at=excluded.rotated_at,revoked_at=excluded.revoked_at,updated_at=excluded.updated_at`,
		v.ConnectionID, v.ProjectID, v.OrganizationID, v.Class, v.Version, v.Algorithm,
		v.KeyID, v.Nonce, v.Ciphertext, v.Fingerprint, v.CreatedAt, v.RotatedAt,
		v.RevokedAt, v.UpdatedAt,
	)
}
func (t *transaction) SaveProviderDiagnostic(v cloudworkspace.ProviderDiagnostic) {
	t.exec(
		`INSERT INTO provider_diagnostics(id,project_id,connection_id,operation,code,retryable,retry_after_seconds,correlation_id,occurred_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		v.ID, v.ProjectID, v.ConnectionID, v.Operation, v.Code, v.Retryable,
		v.RetryAfterSeconds, v.CorrelationID, v.OccurredAt,
	)
}
func (t *transaction) ReplaceProviderConnectionScopes(connectionID, projectID string, environmentIDs, applicationIDs []string, createdAt time.Time) {
	t.exec(
		`DELETE FROM provider_connection_environment_scopes
		 WHERE connection_id=$1 AND NOT (environment_id = ANY($2::text[]))`,
		connectionID, environmentIDs,
	)
	t.exec(
		`DELETE FROM provider_connection_application_scopes
		 WHERE connection_id=$1 AND NOT (application_id = ANY($2::text[]))`,
		connectionID, applicationIDs,
	)
	t.exec(
		`INSERT INTO provider_connection_environment_scopes(project_id,connection_id,environment_id,created_at)
		 SELECT $1,$2,scope_id,$3 FROM unnest($4::text[]) AS scope_id
		 ON CONFLICT(connection_id,environment_id) DO NOTHING`,
		projectID, connectionID, createdAt, environmentIDs,
	)
	t.exec(
		`INSERT INTO provider_connection_application_scopes(project_id,connection_id,application_id,created_at)
		 SELECT $1,$2,scope_id,$3 FROM unnest($4::text[]) AS scope_id
		 ON CONFLICT(connection_id,application_id) DO NOTHING`,
		projectID, connectionID, createdAt, applicationIDs,
	)
}
func (t *transaction) SaveActiveProviderAssignment(v cloudworkspace.ActiveProviderAssignment) {
	t.exec(
		`INSERT INTO active_provider_assignments(project_id,environment_id,application_id,platform,provider,activation_kind,connection_id,production_connection_use_acknowledged,created_by_actor_id,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		 ON CONFLICT(environment_id,application_id) DO UPDATE SET provider=excluded.provider,activation_kind=excluded.activation_kind,connection_id=excluded.connection_id,platform=excluded.platform,production_connection_use_acknowledged=excluded.production_connection_use_acknowledged,created_by_actor_id=excluded.created_by_actor_id,updated_at=excluded.updated_at`,
		v.ProjectID, v.EnvironmentID, v.ApplicationID, v.Platform, v.Provider, v.ActivationKind,
		emptyStringAsNil(v.ConnectionID),
		v.ProductionConnectionUseAcknowledged, v.CreatedByActorID, v.CreatedAt, v.UpdatedAt,
	)
}
func (t *transaction) DeleteActiveProviderAssignment(environmentID, applicationID string) {
	t.exec(`DELETE FROM active_provider_assignments WHERE environment_id=$1 AND application_id=$2`, environmentID, applicationID)
}
func (t *transaction) SaveProviderMapping(v cloudworkspace.ProviderProductMapping) {
	t.exec(
		`INSERT INTO provider_product_mappings(id,project_id,product_id,connection_id,environment_id,application_id,platform,provider,provider_product_identifier,provider_package_identifier,provider_offering_identifier,expected_store_product_id,provider_base_plan_identifier,provider_offer_identifier,replaces_mapping_id,status,availability,sync_state,current_snapshot_id,last_error_code,archived_at,created_at,updated_at)
		 SELECT $1,p.project_id,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22 FROM products p WHERE p.id=$2
		 ON CONFLICT(id) DO UPDATE SET provider_product_identifier=excluded.provider_product_identifier,provider_package_identifier=excluded.provider_package_identifier,provider_offering_identifier=excluded.provider_offering_identifier,expected_store_product_id=excluded.expected_store_product_id,provider_base_plan_identifier=excluded.provider_base_plan_identifier,provider_offer_identifier=excluded.provider_offer_identifier,replaces_mapping_id=excluded.replaces_mapping_id,status=excluded.status,availability=excluded.availability,sync_state=excluded.sync_state,current_snapshot_id=excluded.current_snapshot_id,last_error_code=excluded.last_error_code,archived_at=excluded.archived_at,updated_at=excluded.updated_at`,
		v.ID, v.ProductID, emptyStringAsNil(v.ConnectionID), emptyStringAsNil(v.EnvironmentID),
		v.ApplicationID, emptyStringAsNil(string(v.Platform)), v.Provider, v.ProviderProductIdentifier,
		emptyStringAsNil(v.ProviderPackageIdentifier), emptyStringAsNil(v.ProviderOfferingIdentifier),
		emptyStringAsNil(v.ExpectedStoreProductID), emptyStringAsNil(v.ProviderBasePlanIdentifier),
		emptyStringAsNil(v.ProviderOfferIdentifier), emptyStringAsNil(v.ReplacesMappingID),
		v.Status, v.Availability, v.SyncState,
		emptyStringAsNil(v.CurrentSnapshotID), emptyStringAsNil(string(v.LastErrorCode)), v.ArchivedAt,
		v.CreatedAt, v.UpdatedAt,
	)
}
func (t *transaction) SaveProviderMappingObservation(v cloudworkspace.ProviderMappingObservation) {
	metadata, err := json.Marshal(v.Metadata)
	if err != nil {
		t.fail(err)
		return
	}
	t.exec(
		`INSERT INTO provider_mapping_observations(id,project_id,mapping_id,environment_id,application_id,platform,provider,adapter_version,store_context,result,diagnostic_code,correlation_id,metadata,observed_at,expires_at,received_at,created_by_actor_id)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		v.ID, v.ProjectID, v.MappingID, v.EnvironmentID, v.ApplicationID, v.Platform,
		v.Provider, v.AdapterVersion, v.StoreContext, v.Result,
		emptyStringAsNil(v.DiagnosticCode), v.CorrelationID, metadata,
		v.ObservedAt, v.ExpiresAt, v.ReceivedAt, v.CreatedByActorID,
	)
}
func (t *transaction) SaveProviderMetadataSnapshot(v cloudworkspace.ProviderProductMetadataSnapshot) {
	t.exec(
		`INSERT INTO provider_product_metadata_snapshots(id,project_id,mapping_id,source,digest,availability,observed_at,synced_at,stale_at,expires_at,last_error_code,normalized_metadata,created_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		v.ID, v.ProjectID, v.MappingID, v.Source, v.Digest, v.Availability, v.ObservedAt,
		v.SyncedAt, v.StaleAt, v.ExpiresAt, emptyStringAsNil(string(v.LastErrorCode)),
		jsonObjectOrEmpty(v.Metadata), v.CreatedAt,
	)
}
func (t *transaction) SaveProviderEntitlementMapping(v cloudworkspace.ProviderEntitlementMapping) {
	t.exec(
		`INSERT INTO provider_entitlement_mappings(id,project_id,entitlement_id,connection_id,environment_id,application_id,provider_entitlement_identifier,status,archived_at,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		 ON CONFLICT(id) DO UPDATE SET provider_entitlement_identifier=excluded.provider_entitlement_identifier,status=excluded.status,archived_at=excluded.archived_at,updated_at=excluded.updated_at`,
		v.ID, v.ProjectID, v.EntitlementID, v.ConnectionID, v.EnvironmentID,
		v.ApplicationID, v.ProviderEntitlementIdentifier, v.Status, v.ArchivedAt,
		v.CreatedAt, v.UpdatedAt,
	)
}
func (t *transaction) SaveProviderImport(v cloudworkspace.ProviderImportRequest) {
	t.exec(
		`INSERT INTO provider_import_requests(id,project_id,connection_id,idempotency_key_hash,request_hash,status,created_by_actor_id,created_at,completed_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT(id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at`,
		v.ID, v.ProjectID, v.ConnectionID, v.IdempotencyKeyHash[:], v.RequestHash[:],
		v.Status, v.CreatedByActorID, v.CreatedAt, v.CompletedAt,
	)
}
func (t *transaction) SaveProviderImportItem(v cloudworkspace.ProviderImportItem) {
	t.exec(
		`INSERT INTO provider_import_items(import_id,project_id,provider_product_identifier,mosaic_product_id,mapping_id,status,error_code,created_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8)
		 ON CONFLICT(import_id,provider_product_identifier) DO UPDATE SET mosaic_product_id=excluded.mosaic_product_id,mapping_id=excluded.mapping_id,status=excluded.status,error_code=excluded.error_code,created_at=excluded.created_at`,
		v.ImportID, v.ProjectID, v.ProviderProductIdentifier, emptyStringAsNil(v.MosaicProductID),
		emptyStringAsNil(v.MappingID), v.Status, emptyStringAsNil(string(v.ErrorCode)), v.CreatedAt,
	)
}
func (t *transaction) SaveProviderSyncJob(v cloudworkspace.ProviderSyncJob) {
	t.exec(
		`INSERT INTO provider_sync_jobs(id,project_id,connection_id,status,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,requested_by_actor_id,created_at,updated_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		 ON CONFLICT(id) DO UPDATE SET status=excluded.status,attempt_count=excluded.attempt_count,available_at=excluded.available_at,lease_owner=excluded.lease_owner,lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at`,
		v.ID, v.ProjectID, v.ConnectionID, v.Status, v.AttemptCount, v.MaxAttempts,
		v.AvailableAt, emptyStringAsNil(v.LeaseOwner), v.LeaseExpiresAt,
		v.RequestedByActorID, v.CreatedAt, v.UpdatedAt,
	)
}
func (t *transaction) LeaseProviderSyncJob(workerID string, now, leaseExpiresAt time.Time) (cloudworkspace.ProviderSyncJob, bool) {
	query := `WITH candidate AS (
	    SELECT id
	    FROM provider_sync_jobs
	    WHERE available_at <= $2
	      AND (status = 'queued' OR (status = 'leased' AND lease_expires_at <= $2))
	    ORDER BY available_at,created_at,id
	    FOR UPDATE SKIP LOCKED
	    LIMIT 1
	)
	UPDATE provider_sync_jobs job
	SET status='leased',attempt_count=attempt_count+1,lease_owner=$1,lease_expires_at=$3,updated_at=$2
	FROM candidate
	WHERE job.id=candidate.id
	RETURNING ` + leasedProviderSyncJobColumns
	return one(t.reader, query, scanProviderSyncJob, workerID, now, leaseExpiresAt)
}
func (t *transaction) OwnsProviderSyncJobLease(jobID, workerID string, attemptCount int, now time.Time) bool {
	var lockedJobID string
	err := t.tx.QueryRow(t.ctx, `SELECT id
		FROM provider_sync_jobs
		WHERE id=$1 AND status='leased' AND lease_owner=$2 AND attempt_count=$3 AND lease_expires_at>$4
		FOR UPDATE`, jobID, workerID, attemptCount, now).Scan(&lockedJobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		t.fail(err)
		return false
	}
	return lockedJobID == jobID
}
func (t *transaction) SaveProviderSyncRun(v cloudworkspace.ProviderSyncRun) {
	t.exec(
		`INSERT INTO provider_sync_runs(id,project_id,connection_id,job_id,status,item_count,success_count,failure_count,started_at,completed_at,created_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		 ON CONFLICT(id) DO UPDATE SET status=excluded.status,item_count=excluded.item_count,success_count=excluded.success_count,failure_count=excluded.failure_count,completed_at=excluded.completed_at`,
		v.ID, v.ProjectID, v.ConnectionID, v.JobID, v.Status, v.ItemCount,
		v.SuccessCount, v.FailureCount, v.StartedAt, v.CompletedAt, v.CreatedAt,
	)
}
func (t *transaction) SaveProviderSyncRunItem(v cloudworkspace.ProviderSyncRunItem) {
	t.exec(
		`INSERT INTO provider_sync_run_items(run_id,project_id,mapping_id,status,snapshot_id,error_code,completed_at)
		 VALUES($1,$2,$3,$4,$5,$6,$7)
		 ON CONFLICT(run_id,mapping_id) DO UPDATE SET status=excluded.status,snapshot_id=excluded.snapshot_id,error_code=excluded.error_code,completed_at=excluded.completed_at`,
		v.RunID, v.ProjectID, v.MappingID, v.Status, emptyStringAsNil(v.SnapshotID),
		emptyStringAsNil(string(v.ErrorCode)), v.CompletedAt,
	)
}
func (t *transaction) SaveAuditEvent(v cloudworkspace.AuditEvent) {
	metadata, _ := json.Marshal(v.Metadata)
	var project, environment any
	if v.ProjectID != "" {
		project = v.ProjectID
	}
	if v.EnvironmentID != "" {
		environment = v.EnvironmentID
	}
	t.exec(`INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, v.ID, v.ActorID, v.OrganizationID, project, environment, v.Action, v.ResourceType, v.ResourceID, metadata, v.CreatedAt)
}

var _ cloudworkspace.Repository = (*Repository)(nil)

func persistenceError(err error) error {
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		resource, field := "resource", "unique"
		switch pgError.ConstraintName {
		case "organization_members_pkey":
			resource, field = "membership", "actorId"
		case "projects_organization_id_key_key":
			resource, field = "project", "key"
		case "applications_project_id_platform_identifier_key":
			resource, field = "application", "identifier"
		case "environments_project_id_key_key":
			resource, field = "environment", "key"
		case "plans_project_id_key_key":
			resource, field = "plan", "key"
		case "products_project_id_key_key":
			resource, field = "product", "key"
		case "entitlements_project_id_key_key":
			resource, field = "entitlement", "key"
		case "plan_products_pkey":
			resource, field = "plan_product", "productId"
		case "product_entitlement_grants_pkey":
			resource, field = "product_entitlement", "entitlementId"
		case "provider_product_mappings_product_id_application_id_provider_key":
			resource, field = "provider_mapping", "applicationId"
		case "provider_product_mappings_placeholder_scope_key":
			resource, field = "provider_mapping", "applicationId"
		case "provider_product_mappings_current_scope_key", "provider_product_mappings_active_scope_key":
			resource, field = "provider_mapping", "scope"
		case "provider_connections_project_id_name_key":
			resource, field = "provider_connection", "name"
		case "active_provider_assignments_pkey":
			resource, field = "provider_assignment", "scope"
		}
		return &cloudworkspace.ConflictError{Resource: resource, Field: field}
	}
	return fmt.Errorf("execute cloud workspace transaction: %w", err)
}
