// Package cloudworkspacememory provides the deterministic Phase 3A adapter.
// It is runnable evidence, not a production persistence substitute.
package cloudworkspacememory

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

type Repository struct {
	mu    sync.RWMutex
	state *state
}

type state struct {
	sequence      map[string]uint64
	organizations map[string]cloudworkspace.Organization
	memberships   map[string]cloudworkspace.Membership
	projects      map[string]cloudworkspace.Project
	applications  map[string]cloudworkspace.Application
	environments  map[string]cloudworkspace.Environment
	apiKeys       map[string]cloudworkspace.APIKeyRecord
	plans         map[string]cloudworkspace.Plan
	products      map[string]cloudworkspace.Product
	entitlements  map[string]cloudworkspace.Entitlement
	planProducts  map[string]cloudworkspace.PlanProduct
	productGrants map[string]cloudworkspace.ProductEntitlementGrant
	replacements  []cloudworkspace.ProductReplacementHistory
	mappings      map[string]cloudworkspace.ProviderProductMapping
	auditEvents   map[string]cloudworkspace.AuditEvent
}

func New() *Repository {
	return &Repository{state: newState()}
}

func newState() *state {
	return &state{
		sequence:      make(map[string]uint64),
		organizations: make(map[string]cloudworkspace.Organization),
		memberships:   make(map[string]cloudworkspace.Membership),
		projects:      make(map[string]cloudworkspace.Project),
		applications:  make(map[string]cloudworkspace.Application),
		environments:  make(map[string]cloudworkspace.Environment),
		apiKeys:       make(map[string]cloudworkspace.APIKeyRecord),
		plans:         make(map[string]cloudworkspace.Plan),
		products:      make(map[string]cloudworkspace.Product),
		entitlements:  make(map[string]cloudworkspace.Entitlement),
		planProducts:  make(map[string]cloudworkspace.PlanProduct),
		productGrants: make(map[string]cloudworkspace.ProductEntitlementGrant),
		mappings:      make(map[string]cloudworkspace.ProviderProductMapping),
		auditEvents:   make(map[string]cloudworkspace.AuditEvent),
	}
}

func (r *Repository) View(ctx context.Context, fn func(cloudworkspace.Reader) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return fn(reader{state: r.state})
}

func (r *Repository) Transact(ctx context.Context, fn func(cloudworkspace.Transaction) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	next := r.state.clone()
	if err := fn(transaction{reader: reader{state: next}}); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	r.state = next
	return nil
}

func (s *state) clone() *state {
	cloned := newState()
	copyMap(cloned.sequence, s.sequence)
	copyMap(cloned.organizations, s.organizations)
	copyMap(cloned.memberships, s.memberships)
	copyMap(cloned.projects, s.projects)
	copyMap(cloned.applications, s.applications)
	copyMap(cloned.environments, s.environments)
	copyMap(cloned.apiKeys, s.apiKeys)
	copyMap(cloned.plans, s.plans)
	copyMap(cloned.products, s.products)
	copyMap(cloned.entitlements, s.entitlements)
	copyMap(cloned.planProducts, s.planProducts)
	copyMap(cloned.productGrants, s.productGrants)
	cloned.replacements = append(cloned.replacements, s.replacements...)
	copyMap(cloned.mappings, s.mappings)
	for key, event := range s.auditEvents {
		event.Metadata = cloneMetadata(event.Metadata)
		cloned.auditEvents[key] = event
	}
	return cloned
}

func copyMap[K comparable, V any](destination map[K]V, source map[K]V) {
	for key, value := range source {
		destination[key] = value
	}
}

type reader struct{ state *state }

func (r reader) Organization(id string) (cloudworkspace.Organization, bool) {
	value, ok := r.state.organizations[id]
	return value, ok
}

func (r reader) Organizations() []cloudworkspace.Organization {
	return sortedValues(r.state.organizations, func(value cloudworkspace.Organization) string { return value.ID })
}

func membershipKey(organizationID, actorID string) string { return organizationID + "\x00" + actorID }

func (r reader) Membership(organizationID, actorID string) (cloudworkspace.Membership, bool) {
	value, ok := r.state.memberships[membershipKey(organizationID, actorID)]
	return value, ok
}

func (r reader) Memberships(organizationID string) []cloudworkspace.Membership {
	values := make([]cloudworkspace.Membership, 0)
	for _, value := range r.state.memberships {
		if value.OrganizationID == organizationID {
			values = append(values, value)
		}
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ActorID < values[j].ActorID })
	return values
}

func (r reader) Project(id string) (cloudworkspace.Project, bool) {
	value, ok := r.state.projects[id]
	return value, ok
}
func (r reader) Projects(organizationID string) []cloudworkspace.Project {
	return filteredSorted(r.state.projects, func(value cloudworkspace.Project) bool { return value.OrganizationID == organizationID }, func(value cloudworkspace.Project) string { return value.ID })
}
func (r reader) Application(id string) (cloudworkspace.Application, bool) {
	value, ok := r.state.applications[id]
	return value, ok
}
func (r reader) Applications(projectID string) []cloudworkspace.Application {
	return filteredSorted(r.state.applications, func(value cloudworkspace.Application) bool { return value.ProjectID == projectID }, func(value cloudworkspace.Application) string { return value.ID })
}
func (r reader) Environment(id string) (cloudworkspace.Environment, bool) {
	value, ok := r.state.environments[id]
	return value, ok
}
func (r reader) Environments(projectID string) []cloudworkspace.Environment {
	return filteredSorted(r.state.environments, func(value cloudworkspace.Environment) bool { return value.ProjectID == projectID }, func(value cloudworkspace.Environment) string { return value.Key })
}
func (r reader) APIKey(id string) (cloudworkspace.APIKeyRecord, bool) {
	value, ok := r.state.apiKeys[id]
	return value, ok
}
func (r reader) APIKeys(environmentID string) []cloudworkspace.APIKeyRecord {
	return filteredSorted(r.state.apiKeys, func(value cloudworkspace.APIKeyRecord) bool { return value.EnvironmentID == environmentID }, func(value cloudworkspace.APIKeyRecord) string { return value.ID })
}
func (r reader) Plan(id string) (cloudworkspace.Plan, bool) {
	value, ok := r.state.plans[id]
	return value, ok
}
func (r reader) Plans(projectID string) []cloudworkspace.Plan {
	return filteredSorted(r.state.plans, func(value cloudworkspace.Plan) bool { return value.ProjectID == projectID }, func(value cloudworkspace.Plan) string { return value.ID })
}
func (r reader) Product(id string) (cloudworkspace.Product, bool) {
	value, ok := r.state.products[id]
	return value, ok
}
func (r reader) Products(projectID string) []cloudworkspace.Product {
	return filteredSorted(r.state.products, func(value cloudworkspace.Product) bool { return value.ProjectID == projectID }, func(value cloudworkspace.Product) string { return value.ID })
}
func (r reader) Entitlement(id string) (cloudworkspace.Entitlement, bool) {
	value, ok := r.state.entitlements[id]
	return value, ok
}
func (r reader) Entitlements(projectID string) []cloudworkspace.Entitlement {
	return filteredSorted(r.state.entitlements, func(value cloudworkspace.Entitlement) bool { return value.ProjectID == projectID }, func(value cloudworkspace.Entitlement) string { return value.ID })
}
func (r reader) PlanProducts(planID string) []cloudworkspace.PlanProduct {
	return filteredSorted(r.state.planProducts, func(value cloudworkspace.PlanProduct) bool { return value.PlanID == planID }, func(value cloudworkspace.PlanProduct) string { return value.ProductID })
}
func (r reader) ProductGrants(productID string) []cloudworkspace.ProductEntitlementGrant {
	return filteredSorted(r.state.productGrants, func(value cloudworkspace.ProductEntitlementGrant) bool { return value.ProductID == productID }, func(value cloudworkspace.ProductEntitlementGrant) string { return value.EntitlementID })
}
func (r reader) ProductReplacementHistory(productID string) []cloudworkspace.ProductReplacementHistory {
	values := make([]cloudworkspace.ProductReplacementHistory, 0)
	for _, value := range r.state.replacements {
		if value.ProductID == productID || value.ReplacementProductID == productID {
			values = append(values, value)
		}
	}
	return values
}
func (r reader) ProviderMappings(productID string) []cloudworkspace.ProviderProductMapping {
	return filteredSorted(r.state.mappings, func(value cloudworkspace.ProviderProductMapping) bool { return value.ProductID == productID }, func(value cloudworkspace.ProviderProductMapping) string { return value.ID })
}
func (r reader) AuditEvents(organizationID string) []cloudworkspace.AuditEvent {
	values := filteredSorted(r.state.auditEvents, func(value cloudworkspace.AuditEvent) bool { return value.OrganizationID == organizationID }, func(value cloudworkspace.AuditEvent) string { return value.ID })
	for index := range values {
		values[index].Metadata = cloneMetadata(values[index].Metadata)
	}
	return values
}

type transaction struct{ reader }

// LockScope is a no-op because the in-memory repository already holds its
// process-wide write mutex for the complete application transaction.
func (tx transaction) LockScope(string) {}

func (tx transaction) NextID(prefix string) string {
	tx.state.sequence[prefix]++
	return fmt.Sprintf("%s_%06d", prefix, tx.state.sequence[prefix])
}
func (tx transaction) SaveOrganization(value cloudworkspace.Organization) {
	tx.state.organizations[value.ID] = value
}
func (tx transaction) SaveMembership(value cloudworkspace.Membership) {
	tx.state.memberships[membershipKey(value.OrganizationID, value.ActorID)] = value
}
func (tx transaction) DeleteMembership(organizationID, actorID string) {
	delete(tx.state.memberships, membershipKey(organizationID, actorID))
}
func (tx transaction) SaveProject(value cloudworkspace.Project) { tx.state.projects[value.ID] = value }
func (tx transaction) SaveApplication(value cloudworkspace.Application) {
	tx.state.applications[value.ID] = value
}
func (tx transaction) SaveEnvironment(value cloudworkspace.Environment) {
	tx.state.environments[value.ID] = value
}
func (tx transaction) SaveAPIKey(value cloudworkspace.APIKeyRecord) {
	tx.state.apiKeys[value.ID] = value
}
func (tx transaction) SavePlan(value cloudworkspace.Plan)       { tx.state.plans[value.ID] = value }
func (tx transaction) SaveProduct(value cloudworkspace.Product) { tx.state.products[value.ID] = value }
func (tx transaction) DeleteProduct(id string)                  { delete(tx.state.products, id) }
func (tx transaction) SaveEntitlement(value cloudworkspace.Entitlement) {
	tx.state.entitlements[value.ID] = value
}
func planProductKey(planID, productID string) string { return planID + "\x00" + productID }
func (tx transaction) SavePlanProduct(value cloudworkspace.PlanProduct) {
	tx.state.planProducts[planProductKey(value.PlanID, value.ProductID)] = value
}
func (tx transaction) DeletePlanProduct(planID, productID string) {
	delete(tx.state.planProducts, planProductKey(planID, productID))
}
func grantKey(productID, entitlementID string) string { return productID + "\x00" + entitlementID }
func (tx transaction) SaveProductGrant(value cloudworkspace.ProductEntitlementGrant) {
	tx.state.productGrants[grantKey(value.ProductID, value.EntitlementID)] = value
}
func (tx transaction) SaveProductReplacement(value cloudworkspace.ProductReplacementHistory) {
	tx.state.replacements = append(tx.state.replacements, value)
}
func (tx transaction) DeleteProductGrant(productID, entitlementID string) {
	delete(tx.state.productGrants, grantKey(productID, entitlementID))
}
func (tx transaction) SaveProviderMapping(value cloudworkspace.ProviderProductMapping) {
	tx.state.mappings[value.ID] = value
}
func (tx transaction) SaveAuditEvent(value cloudworkspace.AuditEvent) {
	value.Metadata = cloneMetadata(value.Metadata)
	tx.state.auditEvents[value.ID] = value
}

func sortedValues[V any](source map[string]V, key func(V) string) []V {
	return filteredSorted(source, func(V) bool { return true }, key)
}

func filteredSorted[V any](source map[string]V, include func(V) bool, key func(V) string) []V {
	values := make([]V, 0)
	for _, value := range source {
		if include(value) {
			values = append(values, value)
		}
	}
	sort.Slice(values, func(i, j int) bool { return key(values[i]) < key(values[j]) })
	return values
}

func cloneMetadata(source map[string]string) map[string]string {
	if len(source) == 0 {
		return map[string]string{}
	}
	cloned := make(map[string]string, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}
