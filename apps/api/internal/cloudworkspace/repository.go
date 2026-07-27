package cloudworkspace

import (
	"context"
	"time"
)

// Repository is SQL-neutral. The approved PostgreSQL implementation can map
// these explicit transaction boundaries to a real transaction later.
type Repository interface {
	View(context.Context, func(Reader) error) error
	Transact(context.Context, func(Transaction) error) error
}

type Reader interface {
	Organization(string) (Organization, bool)
	Organizations() []Organization
	// OrganizationsForActor returns only the Organizations the actor belongs to.
	// Listing every Organization and filtering in the service leaked an
	// all-tenants scan into a per-user request.
	OrganizationsForActor(string) []Organization
	Membership(string, string) (Membership, bool)
	Memberships(string) []Membership
	Project(string) (Project, bool)
	Projects(string) []Project
	Application(string) (Application, bool)
	Applications(string) []Application
	Environment(string) (Environment, bool)
	Environments(string) []Environment
	APIKey(string) (APIKeyRecord, bool)
	APIKeys(string) []APIKeyRecord
	Plan(string) (Plan, bool)
	Plans(string) []Plan
	Product(string) (Product, bool)
	Products(string) []Product
	Entitlement(string) (Entitlement, bool)
	Entitlements(string) []Entitlement
	PlanProducts(string) []PlanProduct
	ProductGrants(string) []ProductEntitlementGrant
	ProductReplacementHistory(string) []ProductReplacementHistory
	ProviderConnection(string) (ProviderConnection, bool)
	ProviderConnections(string) []ProviderConnection
	ProviderConnectionEnvironmentIDs(string) []string
	ProviderConnectionApplicationIDs(string) []string
	ProviderCredential(string) (ProviderCredentialRecord, bool)
	ProviderDiagnostics(string) []ProviderDiagnostic
	ActiveProviderAssignment(string, string) (ActiveProviderAssignment, bool)
	ProviderAssignments(string) []ActiveProviderAssignment
	ProviderMapping(string) (ProviderProductMapping, bool)
	ProviderMappings(string) []ProviderProductMapping
	ProviderMappingsByConnection(string) []ProviderProductMapping
	NativeProviderMappingByTarget(ProviderKind, string, string, Platform, string) (ProviderProductMapping, bool)
	ProviderMetadataSnapshot(string) (ProviderProductMetadataSnapshot, bool)
	ProviderMappingObservation(string) (ProviderMappingObservation, bool)
	ProviderMappingObservations(string) []ProviderMappingObservation
	ProviderEntitlementMappings(string, string, string) []ProviderEntitlementMapping
	ProviderImportByKeyHash(string, [32]byte) (ProviderImportRequest, bool)
	ProviderImportItems(string) []ProviderImportItem
	ProviderSyncJobs(string) []ProviderSyncJob
	ProviderSyncRuns(string) []ProviderSyncRun
	AuditEvents(string) []AuditEvent
}

type Transaction interface {
	Reader
	LockScope(string)
	NextID(string) string
	SaveOrganization(Organization)
	SaveMembership(Membership)
	DeleteMembership(string, string)
	SaveProject(Project)
	SaveApplication(Application)
	SaveEnvironment(Environment)
	SaveAPIKey(APIKeyRecord)
	SavePlan(Plan)
	SaveProduct(Product)
	DeleteProduct(string)
	SaveEntitlement(Entitlement)
	SavePlanProduct(PlanProduct)
	DeletePlanProduct(string, string)
	SaveProductGrant(ProductEntitlementGrant)
	SaveProductReplacement(ProductReplacementHistory)
	DeleteProductGrant(string, string)
	SaveProviderConnection(ProviderConnection)
	ReplaceProviderConnectionScopes(string, string, []string, []string, time.Time)
	SaveProviderCredential(ProviderCredentialRecord)
	SaveProviderDiagnostic(ProviderDiagnostic)
	SaveActiveProviderAssignment(ActiveProviderAssignment)
	DeleteActiveProviderAssignment(string, string)
	SaveProviderMapping(ProviderProductMapping)
	SaveProviderMetadataSnapshot(ProviderProductMetadataSnapshot)
	SaveProviderMappingObservation(ProviderMappingObservation)
	SaveProviderEntitlementMapping(ProviderEntitlementMapping)
	SaveProviderImport(ProviderImportRequest)
	SaveProviderImportItem(ProviderImportItem)
	SaveProviderSyncJob(ProviderSyncJob)
	LeaseProviderSyncJob(string, time.Time, time.Time) (ProviderSyncJob, bool)
	OwnsProviderSyncJobLease(string, string, int, time.Time) bool
	SaveProviderSyncRun(ProviderSyncRun)
	SaveProviderSyncRunItem(ProviderSyncRunItem)
	SaveAuditEvent(AuditEvent)
}
