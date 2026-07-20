package cloudworkspace

import "context"

// Repository is SQL-neutral. The approved PostgreSQL implementation can map
// these explicit transaction boundaries to a real transaction later.
type Repository interface {
	View(context.Context, func(Reader) error) error
	Transact(context.Context, func(Transaction) error) error
}

type Reader interface {
	Organization(string) (Organization, bool)
	Organizations() []Organization
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
	ProviderMappings(string) []ProviderProductMapping
	AuditEvents(string) []AuditEvent
}

type Transaction interface {
	Reader
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
	DeleteProductGrant(string, string)
	SaveProviderMapping(ProviderProductMapping)
	SaveAuditEvent(AuditEvent)
}
