package billingrestore

import (
	"context"
	"time"
)

// KeyScope is the tenant an API key authenticated into. It is a local copy of
// the ingestion package's scope so this package depends on an interface it
// declares rather than on the write path.
type KeyScope struct {
	APIKeyID        string
	OrganizationID  string
	ProjectID       string
	EnvironmentID   string
	EnvironmentMode string
	ApplicationID   string
}

// KeyAuthenticator authenticates an API key into a tenant.
//
// A public SDK key proves which Environment is asking and nothing more. It can
// never select a Billing Customer: on the restore surface identity is resolved
// from server-validated store lineage, never from anything the client asserts.
type KeyAuthenticator interface {
	AuthenticateServerKey(ctx context.Context, raw string) (KeyScope, error)
	AuthenticateSDKKey(ctx context.Context, raw string) (KeyScope, error)
}

// Repository is the persistence port for the restore chain.
//
// There is no method here that validates, projects, or resolves identity. This
// package reads where the chain got to and records the answer; every stage it
// observes is owned by the service that runs it, and a restore that could
// advance a stage itself would eventually disagree with the stage's owner.
type Repository interface {
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	// CreateJob records a restore and links the Raw Billing Inputs the named
	// observation submissions created, in one transaction. It returns the job
	// as stored, with ObservedTransactionCount set to the number of inputs
	// actually linked — never to the number the caller claimed.
	CreateJob(ctx context.Context, job Job, submissionIDs []string, now time.Time) (Job, error)

	// LeaseJob claims one due job with SELECT ... FOR UPDATE SKIP LOCKED.
	LeaseJob(ctx context.Context, workerID string, now, leaseUntil time.Time) (Job, bool, error)

	// LoadChain reads where the chain got to for one job.
	LoadChain(ctx context.Context, job Job) (ChainState, error)

	// AdoptBaseline records the customer and the snapshot version that existed
	// when identity first resolved. It is a no-op once a baseline is set: a
	// baseline that could move would let `restored` be proven against a version
	// chosen after the fact.
	AdoptBaseline(ctx context.Context, job Job, customerID string, baseline int64, now time.Time) error

	// CompleteJob writes a terminal outcome. Implementations must refuse a
	// decision whose Validate fails.
	CompleteJob(ctx context.Context, job Job, decision Decision, chain ChainState, now time.Time) error

	// RescheduleJob records progress on a non-terminal attempt and sets the next
	// availability. The outcome column stays null: the job has no answer yet,
	// and writing a provisional one would make an unfinished chain look decided.
	RescheduleJob(ctx context.Context, job Job, decision Decision, chain ChainState, availableAt, now time.Time) error

	// Job reads one restore for the status endpoint, scoped to its tenant.
	Job(ctx context.Context, projectID, environmentID, restoreID string) (Job, error)
}
