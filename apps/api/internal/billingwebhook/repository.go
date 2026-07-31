package billingwebhook

import (
	"context"
	"time"
)

// Repository is the persistence port for destinations, secrets, and delivery.
//
// Every method that reads or writes a tenant-owned row takes projectID
// explicitly and filters on it. Tenant isolation is a property of the query
// rather than of the caller remembering to check, because a read surface that
// depends on the caller checking eventually meets a caller that did not.
type Repository interface {
	// BillingEnabled reports the Project's billing setting. It fails closed:
	// the service treats an unreadable setting as disabled.
	BillingEnabled(ctx context.Context, projectID string) (bool, error)
	// OrganizationForProject resolves the organization that owns a Project. The
	// organization is part of the envelope's additional authenticated data, so
	// it must be known before a secret is sealed rather than discovered during
	// the insert.
	OrganizationForProject(ctx context.Context, projectID string) (string, error)

	// --- Destinations --------------------------------------------------------

	// CreateDestination writes the destination, its first signing secret, and
	// the audit event in one transaction. A destination that exists without a
	// secret could never sign a delivery, so the two are never separate
	// commits.
	CreateDestination(ctx context.Context, destination Destination, secret SealedSecret, actorID string, now time.Time) (Destination, error)
	ListDestinations(ctx context.Context, projectID, environmentID string) ([]Destination, error)
	Destination(ctx context.Context, projectID, destinationID string) (Destination, error)
	UpdateDestination(ctx context.Context, projectID, destinationID string, update DestinationUpdate, actorID string, now time.Time) (Destination, error)
	// SetDestinationStatus is the operator-driven transition. reason is free
	// text an operator supplied and is stored separately from the Mosaic-owned
	// auto-disable code.
	SetDestinationStatus(ctx context.Context, projectID, destinationID, status, reason, actorID string, now time.Time) (Destination, error)
	// AutoDisableDestination is the automatic transition. It sets the
	// Mosaic-owned reason code and writes its own audit event, because a
	// destination that stops receiving events without a recorded cause is an
	// outage an operator cannot explain.
	AutoDisableDestination(ctx context.Context, projectID, destinationID, reason string, now time.Time) error
	// DeleteDestination removes a destination that has no delivery history.
	// Delivery rows reference it with ON DELETE RESTRICT, so history is the
	// guard: an operator disables a destination they are finished with, and
	// deleting one would erase the record of what it was sent.
	DeleteDestination(ctx context.Context, projectID, destinationID, actorID string, now time.Time) error

	// --- Signing secrets -----------------------------------------------------

	// RotateSecret adds a new active secret and retires every previously active
	// one with honoredUntil set, so the superseded secrets keep signing through
	// the overlap window. It is one transaction: a rotation that added the new
	// secret and failed to schedule the old one's retirement would leave two
	// permanently active secrets.
	RotateSecret(ctx context.Context, projectID, destinationID string, secret SealedSecret, honoredUntil time.Time, actorID string, now time.Time) (SecretMetadata, error)
	ListSecrets(ctx context.Context, projectID, destinationID string) ([]SecretMetadata, error)
	// RetireSecret ends a secret's life immediately, ignoring any remaining
	// overlap. This is the action taken after a suspected compromise, and it is
	// audited.
	RetireSecret(ctx context.Context, projectID, destinationID, secretID, actorID string, now time.Time) (SecretMetadata, error)

	// --- Delivery ------------------------------------------------------------

	// FanOut expands committed events that have never been expanded into one
	// delivery per destination, recording a skipped delivery for a destination
	// that is not eligible. It returns how many events were expanded.
	FanOut(ctx context.Context, now time.Time, limit int) (int, error)
	// LeaseDelivery claims one due delivery with SELECT ... FOR UPDATE SKIP
	// LOCKED and commits the claim before returning. The transaction is closed
	// by the time the caller makes an HTTP request: no lock is ever held across
	// the network.
	LeaseDelivery(ctx context.Context, workerID string, now, leaseUntil time.Time) (LeasedDelivery, bool, error)
	// CompleteAttempt appends the attempt and applies the resulting delivery
	// state in one transaction, and returns the destination's consecutive
	// failure count afterwards so the caller can apply the auto-disable policy.
	CompleteAttempt(ctx context.Context, result AttemptResult) (int, error)

	ListDeliveries(ctx context.Context, projectID string, filter DeliveryFilter) ([]Delivery, error)
	Delivery(ctx context.Context, projectID, deliveryID string) (Delivery, error)
	ListAttempts(ctx context.Context, projectID, deliveryID string) ([]Attempt, error)
	// ReplayDelivery returns a terminal delivery to the queue with a fresh
	// attempt budget. The event id is unchanged, so a receiver deduplicating on
	// it sees the change once however many times an operator replays.
	ReplayDelivery(ctx context.Context, projectID, deliveryID, actorID string, now time.Time) (Delivery, error)

	// RecordAudit writes an audit event for a sensitive mutation.
	RecordAudit(ctx context.Context, projectID, environmentID, actorID, action, resourceID string, metadata map[string]string, at time.Time) error
}
