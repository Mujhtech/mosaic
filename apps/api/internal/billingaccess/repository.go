package billingaccess

import (
	"context"
	"time"
)

// KeyAuthenticator authenticates an API key into a tenant. It is a port rather
// than a dependency on the ingestion service, because a read surface must not
// be able to reach the write path just to find out who is calling.
type KeyAuthenticator interface {
	// AuthenticateServerKey resolves a secret server key. This is the second
	// consumer of that authentication, after trusted-server observations.
	AuthenticateServerKey(ctx context.Context, raw string) (KeyScope, error)
	// AuthenticateSDKKey resolves a public SDK key. A public key proves which
	// Environment and Application are calling and nothing else: it can never,
	// by itself, select a customer.
	AuthenticateSDKKey(ctx context.Context, raw string) (KeyScope, error)
}

// Repository is the persistence port for the access surfaces.
//
// Every read here is a read of committed state. There is no method that
// projects, derives, or repairs: an access surface that could derive would
// eventually derive something different from the projection, and the two
// answers would both be authoritative.
type Repository interface {
	BillingEnabled(ctx context.Context, projectID string) (bool, error)

	// --- Customer Access Tokens ---------------------------------------------

	// CreateToken stores a token's digest and scope columns, and writes the
	// issuance audit event in the same transaction. The token value itself is
	// never passed here: the caller hands over its digest.
	CreateToken(ctx context.Context, token Token, digest []byte, actorReference string) (Token, error)
	// TokenByDigest resolves a presented token. It returns ErrUnauthenticated
	// for an unknown digest so a caller cannot distinguish "no such token" from
	// "wrong token".
	TokenByDigest(ctx context.Context, digest []byte) (Token, error)
	// TouchToken records last use. It is best-effort by design: a failure to
	// record a diagnostic must never fail an entitlement read.
	TouchToken(ctx context.Context, tokenID string, at time.Time) error
	RevokeToken(ctx context.Context, scope KeyScope, tokenID, reason, actorReference string, at time.Time) (Token, error)
	ListTokens(ctx context.Context, scope KeyScope, customerID string, limit int) ([]Token, error)

	// --- Committed projections ----------------------------------------------

	// CurrentSnapshot reads the customer's current committed snapshot in one
	// Environment, with its entries and sources. It returns ErrNotFound when the
	// customer has never been projected there — which is a different answer from
	// "has nothing", and the caller must keep it different.
	CurrentSnapshot(ctx context.Context, projectID, environmentID, customerID string) (SnapshotView, error)
	// ProjectionStatusFor reports projection health for one customer, including
	// how many validated facts are waiting.
	ProjectionStatusFor(ctx context.Context, projectID, environmentID, customerID string) (ProjectionStatus, error)

	Customer(ctx context.Context, projectID, customerID string) (CustomerView, error)
	// CreateOrGetCustomerForApplicationUser is the trusted identify path,
	// delegated to the identity service and exposed here so the access API has
	// one repository.
	Subscriptions(ctx context.Context, projectID, environmentID, customerID string, limit int, cursor string) ([]SubscriptionView, string, error)
	Subscription(ctx context.Context, projectID, instanceID string) (SubscriptionView, error)
	Timeline(ctx context.Context, projectID, instanceID string, limit int, cursor string) ([]TimelineEntry, string, error)

	// RecordAudit writes an audit event for a sensitive read or mutation.
	RecordAudit(ctx context.Context, projectID, environmentID, actorReference, action, resourceType, resourceID string, metadata map[string]string, at time.Time) error
}
