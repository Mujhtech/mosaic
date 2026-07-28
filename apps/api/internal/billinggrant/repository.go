package billinggrant

import (
	"context"
	"time"
)

// Repository is the persistence port.
type Repository interface {
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	// Role resolves the actor's organization role for the Project. It returns
	// ErrNotFound rather than ErrForbidden for a non-member, matching every
	// other Mosaic surface: telling a caller that a Project exists but is not
	// theirs is an existence oracle over other tenants' Projects.
	Role(ctx context.Context, actor Actor, projectID string) (string, error)

	// ListVersions reads a pair's recorded history, newest version first.
	ListVersions(ctx context.Context, projectID string, filter ListFilter) ([]Version, error)

	// CurrentVersion reads the open-ended version for one pair. The second
	// return is false when the pair currently grants nothing, which is a normal
	// state and not an error.
	CurrentVersion(ctx context.Context, projectID, productID, entitlementID string) (Version, bool, error)

	// Impact counts what a change to one pair would touch, from committed state
	// only. It writes nothing, including no audit event: a preview an operator
	// runs five times while deciding must not leave five entries suggesting five
	// changes were considered and four abandoned.
	Impact(ctx context.Context, projectID, productID, entitlementID string) (Impact, error)

	// Publish applies one validated proposal atomically.
	//
	// The repository takes the pair's advisory lock, reads the recorded history
	// inside the transaction, and hands it to `plan` — the caller's pure
	// decision function — so the decision is made against a history that cannot
	// move before the write. It then closes the superseded version, inserts the
	// new one, writes the audit event, and enqueues a reprojection for every
	// affected customer, all in the same transaction. Either the new meaning and
	// the work to apply it both exist, or neither does.
	Publish(ctx context.Context, actor Actor, projectID string, input PublishInput,
		plan func(existing []Version, at time.Time) (Plan, error), now time.Time) (Version, error)
}
