package billingcustomer

import (
	"context"
	"time"
)

// Repository is the persistence port for billing identity. Authorization for
// operator-facing reads is enforced in SQL alongside the query, following the
// analytics and 9A billing precedent, so no caller can reach another tenant's
// customers by forgetting a check.
type Repository interface {
	// BillingEnabled reports whether the Project may hold billing identity.
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	// CreateCustomer inserts a new customer. It is called only from the two
	// lazy-creation paths (trusted identify, fact attachment).
	CreateCustomer(ctx context.Context, customer Customer) (Customer, error)
	Customer(ctx context.Context, actor Actor, projectID, customerID string) (Customer, error)
	// CustomerForAlias returns the customer an active alias resolves to.
	CustomerForAlias(ctx context.Context, projectID, aliasType string, digest []byte) (Customer, error)
	ListCustomers(ctx context.Context, actor Actor, projectID string, limit int, cursor string) ([]Customer, string, error)
	SetCustomerStatus(ctx context.Context, projectID, customerID, status string, now time.Time) error

	// AttachAlias records an alias, failing with ErrConflict when the digest
	// already has a live resolution to a different customer. The uniqueness is
	// enforced by a partial unique index, so a race loses at the database
	// rather than in application logic.
	AttachAlias(ctx context.Context, alias Alias) (Alias, error)
	RevokeAlias(ctx context.Context, actor Actor, projectID, aliasID string, now time.Time) error
	ListAliases(ctx context.Context, actor Actor, projectID, customerID string) ([]Alias, error)
	// ActiveAliasResolutions returns digest→customer for the supplied digests,
	// which is the lookup the pure resolver consumes.
	ActiveAliasResolutions(ctx context.Context, projectID string, digests [][]byte) (map[string]string, error)

	RecordEvidence(ctx context.Context, evidence Evidence) error
	// EvidenceForReference reads the association correlators parsed from raw
	// inputs that share a transaction reference digest. Fact provenance is
	// first-writer-wins and therefore not authoritative, so authority is
	// resolved by scanning inputs rather than by trusting the fact's own
	// source input.
	EvidenceForReference(ctx context.Context, projectID string, referenceDigest []byte) ([]Evidence, error)

	// LocateLineage finds or creates the lineage for a provider chain key.
	LocateLineage(ctx context.Context, lineage Lineage) (Lineage, bool, error)
	Lineage(ctx context.Context, projectID, lineageID string) (Lineage, error)
	AttachLineageCustomer(ctx context.Context, projectID, lineageID, customerID string, now time.Time) error
	SetLineageSupersededBy(ctx context.Context, projectID, lineageID, supersededBy string, now time.Time) error
	SetLineageFrozen(ctx context.Context, projectID, lineageID string, frozen bool, diagnostic string, now time.Time) error

	// OpenConflict creates the single open conflict for a lineage, or returns
	// the existing one. Freezing the lineage happens in the same transaction:
	// a conflict that did not freeze would let the next projection grant
	// access to whichever candidate happened to be read first.
	// For an alias-scoped conflict there is no lineage to freeze; the customer
	// the caller tried to extend is frozen instead, which is what stops the
	// next request from quietly retrying the same reassignment.
	OpenConflict(ctx context.Context, conflict Conflict) (Conflict, error)
	Conflict(ctx context.Context, actor Actor, projectID, conflictID string) (Conflict, error)
	ListConflicts(ctx context.Context, actor Actor, projectID string, status string) ([]Conflict, error)
	ResolveConflict(ctx context.Context, actor Actor, projectID, conflictID, action, assignedCustomerID string, now time.Time) (Conflict, error)

	// RecordAudit writes an audit event in the caller's transaction scope.
	RecordAudit(ctx context.Context, actor Actor, projectID, action, resourceType, resourceID string, metadata map[string]string, now time.Time) error
}
