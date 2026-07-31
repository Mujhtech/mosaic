package billingoperator

import (
	"context"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// Repository is the operator read model.
//
// Every method on it is a SELECT. There is deliberately no insert, no update,
// and no create-or-get anywhere on this port: the lookup surface must be
// structurally incapable of minting a Billing Customer, and the absence of a
// method is what makes that true rather than a check a later edit could remove.
type Repository interface {
	// Authorize checks the actor's organization role for the Project and that
	// the Environment belongs to it. Absent membership is reported as
	// ErrNotFound, matching every other Mosaic surface: telling a caller a
	// Project exists but is not theirs is an existence oracle.
	Authorize(ctx context.Context, actor Actor, projectID, environmentID string) error
	// AuthorizeProject is the same check without an Environment, for the
	// Project-scoped identity-conflict surface.
	AuthorizeProject(ctx context.Context, actor Actor, projectID string) error
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	// CustomerIDForAliasDigest resolves an active alias digest to a customer.
	// It returns ErrNotFound for a miss and never creates anything.
	CustomerIDForAliasDigest(ctx context.Context, projectID, aliasType string, digest []byte) (string, error)
	// CustomerIDForInstallationDigest resolves an installation identifier
	// through association evidence rather than through an alias resolution.
	// An installation id is evidence and never an anchor (plan §5a rule 2a), so
	// there is no alias row to read: the evidence table is where a client-
	// generated identifier is allowed to appear, and reading it backwards for a
	// support lookup is a read of history, not a selection rule.
	CustomerIDForInstallationDigest(ctx context.Context, projectID string, digest []byte) (string, error)

	CustomerSummary(ctx context.Context, projectID, environmentID, customerID string) (CustomerSummary, error)
	ListCustomers(ctx context.Context, projectID, environmentID string, filter CustomerFilter,
		limit int, cursor string) ([]CustomerSummary, string, error)

	Lineages(ctx context.Context, projectID, environmentID, customerID string) ([]LineageView, error)
	OneTimePurchases(ctx context.Context, projectID, environmentID, customerID string) ([]OneTimePurchaseView, error)
	CustomerConflicts(ctx context.Context, projectID, customerID string) ([]ConflictView, error)

	ListRestoreJobs(ctx context.Context, projectID, environmentID, customerID string,
		limit int, cursor string) ([]RestoreJobView, string, error)
	RestoreJob(ctx context.Context, projectID, environmentID, restoreID string) (RestoreJobView, error)
}

// Entitlements is the committed-projection read port.
//
// It is satisfied by the same repository the trusted-server access API reads
// through, so the dashboard and an application backend see one answer derived
// once. A second query path here would eventually disagree with that one, and
// both would look authoritative.
type Entitlements interface {
	CurrentSnapshot(ctx context.Context, projectID, environmentID, customerID string) (billingaccess.SnapshotView, error)
	ProjectionStatusFor(ctx context.Context, projectID, environmentID, customerID string) (billingaccess.ProjectionStatus, error)
	Subscriptions(ctx context.Context, projectID, environmentID, customerID string, limit int, cursor string) ([]billingaccess.SubscriptionView, string, error)
	Subscription(ctx context.Context, projectID, instanceID string) (billingaccess.SubscriptionView, error)
	Timeline(ctx context.Context, projectID, instanceID string, limit int, cursor string) ([]billingaccess.TimelineEntry, string, error)
}

// Identity is the port onto billing identity, satisfied by
// *billingcustomer.Service.
//
// Conflict resolution goes through it rather than through SQL of this package's
// own, because resolving a conflict is not one UPDATE: it applies the
// assignment, unfreezes the disputed subject, audits, and reprojects *both*
// candidates so the loser's committed snapshot stops granting a purchase it no
// longer holds. That sequence already exists and already has the transaction
// boundary right; duplicating it is how the two copies come to disagree.
type Identity interface {
	ListAliases(ctx context.Context, actor billingcustomer.Actor, projectID, customerID string) ([]billingcustomer.Alias, error)
	ListConflicts(ctx context.Context, actor billingcustomer.Actor, projectID, status string) ([]billingcustomer.Conflict, error)
	ConflictDetail(ctx context.Context, actor billingcustomer.Actor, projectID, conflictID string) (billingcustomer.ConflictDetail, error)
	ResolveConflict(ctx context.Context, actor billingcustomer.Actor, projectID, conflictID, action, assignedCustomerID, reason string) (billingcustomer.Conflict, error)
	RequestSyncForOperator(ctx context.Context, actor billingcustomer.Actor, projectID, environmentID, customerID string) (billingcustomer.SyncRequest, error)
}
