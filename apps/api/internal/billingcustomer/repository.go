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
	// PurchaseAnchoredOnly reports whether a customer exists solely to hold a
	// purchase: it carries `purchase_anchor` evidence, nothing has ever
	// identified it, and it holds no aliases of any kind. It is the
	// precondition for adoption (plan §5a rule 3) — a customer that fails it
	// has a person behind it, and taking its purchase away is an operator
	// decision rather than a resolver one.
	PurchaseAnchoredOnly(ctx context.Context, projectID, customerID string) (bool, error)
	// LineageCountForCustomer counts the purchase lineages a customer still
	// holds, across every Environment.
	LineageCountForCustomer(ctx context.Context, projectID, customerID string) (int, error)

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
	// PriorLineageCustomers returns customers named by persisted prior-lineage
	// evidence for this lineage. It is the retry record for a move: if the
	// pointer commit succeeds but scheduling either aggregate fails, the next
	// identical resolution can still find and reproject the customer that lost
	// the purchase.
	PriorLineageCustomers(ctx context.Context, projectID, lineageID string) ([]string, error)
	AdoptionRecorded(ctx context.Context, projectID, lineageID, adopterID string) (bool, error)
	// EvidenceForReference reads the association correlators parsed from raw
	// inputs that share a transaction reference digest. Fact provenance is
	// first-writer-wins and therefore not authoritative, so authority is
	// resolved by scanning inputs rather than by trusting the fact's own
	// source input.
	EvidenceForReference(ctx context.Context, projectID string, referenceDigest []byte) ([]Evidence, error)

	Lineage(ctx context.Context, projectID, lineageID string) (Lineage, error)
	// LineageByKey reads the lineage for one provider chain key. It is the only
	// key-based lookup: the fact-commit transaction is the sole writer of
	// purchase lineages, so this module reads them and never creates them.
	LineageByKey(ctx context.Context, environmentID, provider string, keyDigest []byte) (Lineage, error)
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
	// ResolveConflict applies an operator's decision. `reason` is the operator's
	// stated justification and is required: a resolution moves a purchase between
	// two customers, and an investigation months later needs the why alongside
	// the what. It is stored on the conflict's existing detail document, so the
	// reason and the diagnostic that opened the conflict live in one place.
	ResolveConflict(ctx context.Context, actor Actor, projectID, conflictID, action, assignedCustomerID, reason string, now time.Time) (Conflict, error)

	// RecordAudit writes an audit event in the caller's transaction scope.
	RecordAudit(ctx context.Context, actor Actor, projectID, action, resourceType, resourceID string, metadata map[string]string, now time.Time) error
}
