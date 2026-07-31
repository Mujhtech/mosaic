// Package cloudworkspacepostgres implements durable Phase 3A persistence with pgx.
package cloudworkspacepostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

type Repository struct{ pool *pgxpool.Pool }

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
	err := row.Scan(&v.ID, &v.ProjectID, &v.Key, &v.Name, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) Environment(id string) (cloudworkspace.Environment, bool) {
	return one(r, `SELECT id,project_id,key,name,created_at,updated_at FROM environments WHERE id=$1`, scanEnvironment, id)
}
func (r reader) Environments(projectID string) []cloudworkspace.Environment {
	return many(r, `SELECT id,project_id,key,name,created_at,updated_at FROM environments WHERE project_id=$1 ORDER BY key`, scanEnvironment, projectID)
}

func scanAPIKey(row pgx.Row) (cloudworkspace.APIKeyRecord, error) {
	var v cloudworkspace.APIKeyRecord
	var digest []byte
	err := row.Scan(&v.ID, &v.EnvironmentID, &v.Kind, &v.Prefix, &v.CreatedByActorID, &v.CreatedAt, &v.RotatedAt, &v.RevokedAt, &v.LastUsedAt, &digest)
	if err == nil {
		if len(digest) != len(v.SecretDigest) {
			return v, fmt.Errorf("API key %s has invalid digest length", v.ID)
		}
		copy(v.SecretDigest[:], digest)
	}
	return v, err
}
func (r reader) APIKey(id string) (cloudworkspace.APIKeyRecord, bool) {
	return one(r, `SELECT id,environment_id,kind,prefix,created_by_actor_id,created_at,rotated_at,revoked_at,last_used_at,secret_digest FROM api_keys WHERE id=$1`, scanAPIKey, id)
}
func (r reader) APIKeys(environmentID string) []cloudworkspace.APIKeyRecord {
	return many(r, `SELECT id,environment_id,kind,prefix,created_by_actor_id,created_at,rotated_at,revoked_at,last_used_at,secret_digest FROM api_keys WHERE environment_id=$1 ORDER BY id`, scanAPIKey, environmentID)
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
func scanMapping(row pgx.Row) (cloudworkspace.ProviderProductMapping, error) {
	var v cloudworkspace.ProviderProductMapping
	err := row.Scan(&v.ID, &v.ProductID, &v.ApplicationID, &v.Provider, &v.ProviderProductIdentifier, &v.Status, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r reader) ProviderMappings(productID string) []cloudworkspace.ProviderProductMapping {
	return many(r, `SELECT id,product_id,application_id,provider,provider_product_identifier,status,created_at,updated_at FROM provider_product_mappings WHERE product_id=$1 ORDER BY id`, scanMapping, productID)
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
		err = json.Unmarshal(metadata, &v.Metadata)
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
	t.exec(`INSERT INTO environments(id,project_id,key,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`, v.ID, v.ProjectID, v.Key, v.Name, v.CreatedAt, v.UpdatedAt)
}
func (t *transaction) SaveAPIKey(v cloudworkspace.APIKeyRecord) {
	t.exec(`INSERT INTO api_keys(id,environment_id,kind,prefix,secret_digest,created_by_actor_id,created_at,rotated_at,revoked_at,last_used_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET secret_digest=excluded.secret_digest,rotated_at=excluded.rotated_at,revoked_at=COALESCE(api_keys.revoked_at,excluded.revoked_at),last_used_at=excluded.last_used_at`, v.ID, v.EnvironmentID, v.Kind, v.Prefix, v.SecretDigest[:], v.CreatedByActorID, v.CreatedAt, v.RotatedAt, v.RevokedAt, v.LastUsedAt)
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
func (t *transaction) SaveProviderMapping(v cloudworkspace.ProviderProductMapping) {
	t.exec(`INSERT INTO provider_product_mappings(id,project_id,product_id,application_id,provider,provider_product_identifier,status,created_at,updated_at) SELECT $1,p.project_id,$2,$3,$4,$5,$6,$7,$8 FROM products p WHERE p.id=$2 ON CONFLICT(id) DO UPDATE SET provider_product_identifier=excluded.provider_product_identifier,status=excluded.status,updated_at=excluded.updated_at`, v.ID, v.ProductID, v.ApplicationID, v.Provider, v.ProviderProductIdentifier, v.Status, v.CreatedAt, v.UpdatedAt)
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
		}
		return &cloudworkspace.ConflictError{Resource: resource, Field: field}
	}
	return fmt.Errorf("execute cloud workspace transaction: %w", err)
}
