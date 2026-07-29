package billingaccess

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// SyncRequest is the negotiated body of an entitlement sync.
type SyncRequest struct {
	// CustomerIDHint is a hint only. The server derives the customer from the
	// token and verifies this value against it; a mismatch is refused. A caller
	// can never select a customer by asserting an identifier.
	CustomerIDHint       string
	KnownSnapshotVersion int64
	EntityTag            string
	RequestedKeys        []string
	CorrelationID        string
}

// SyncResult is what the sync endpoint produced.
type SyncResult struct {
	// Unchanged is true when the caller's cached snapshot is still current. The
	// payload is then the snapshotUnchanged record and the transport answers
	// 304 with the freshness headers.
	Unchanged bool
	// Payload is the record body, already in the contract's canonical
	// serialization.
	Payload []byte
	// EntityTag is the strong validator for this representation.
	EntityTag string
	// RefreshAfter and ValidUntil accompany a 304, so a confirmed-current
	// snapshot does not expire merely because it was confirmed instead of
	// resent.
	RefreshAfter time.Time
	ValidUntil   time.Time
	StaleGrace   time.Duration
}

// Sync answers the SDK entitlement sync.
//
// Three properties are load-bearing:
//
//	The customer comes from the token. A body hint is verified against it and
//	never used to select. This is the whole reason the public SDK key alone is
//	not sufficient authentication for this surface.
//
//	Billing disabled is `unavailable`, never `inactive`. A Project that turned
//	billing off has not told Mosaic its customers lost access.
//
//	304 slides freshness. A confirmed-current snapshot gets a fresh
//	refreshAfter and validUntil, so a device that keeps confirming the same
//	version never falls out of validity while it is demonstrably in contact
//	with the server.
func (s *Service) Sync(ctx context.Context, authenticated AuthenticatedToken, request SyncRequest) (SyncResult, error) {
	ctx, span := s.tracer.Start(ctx, "billing.entitlement.sync")
	defer span.End()
	started := s.now()
	defer func() {
		s.syncLatency.Record(ctx, float64(s.now().Sub(started).Milliseconds()))
	}()

	token := authenticated.Token
	if request.CustomerIDHint != "" && request.CustomerIDHint != token.CustomerID {
		s.syncResults.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "customer_mismatch")))
		return SyncResult{}, ErrForbidden
	}
	if !token.HasScope(ScopeEntitlementsRead) && !token.HasScope(ScopeEntitlementsSync) {
		return SyncResult{}, ErrForbidden
	}
	if err := s.requireEnabled(ctx, token.ProjectID); err != nil {
		s.syncResults.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "unavailable")))
		return SyncResult{}, err
	}

	view, err := s.repository.CurrentSnapshot(ctx, token.ProjectID, token.EnvironmentID, token.CustomerID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// A customer who has never been projected in this Environment holds
			// no snapshot. That is `unknown`, not `inactive`, and it is reported
			// as an empty snapshot with a pending projection rather than as an
			// error the SDK would have to interpret.
			view = emptyView(token, s.now())
		} else {
			s.syncResults.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "error")))
			return SyncResult{}, err
		}
	} else {
		status, statusErr := s.repository.ProjectionStatusFor(ctx, token.ProjectID, token.EnvironmentID, token.CustomerID)
		if statusErr == nil {
			view.Projection = status
		}
	}

	issuedAt := s.now()
	entityTag := EntityTag(view)

	// The conditional answer requires both the version and the validator to
	// match. The version is the monotonicity key; the entity tag is an opaque
	// equality token. Matching on version alone would confirm a cache whose
	// contents were rebuilt under a new rule version at the same version
	// number.
	if request.KnownSnapshotVersion > 0 && request.KnownSnapshotVersion == view.SnapshotVersion &&
		(request.EntityTag == "" || request.EntityTag == entityTag) && view.SnapshotVersion > 0 {

		record := UnchangedRecord(view, issuedAt, s.freshness, request.CorrelationID)
		payload, encodeErr := CanonicalJSON(Envelope("snapshotUnchanged", record))
		if encodeErr != nil {
			return SyncResult{}, encodeErr
		}
		bounded := s.freshness.Bounded()
		s.syncResults.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "unchanged")))
		span.SetAttributes(attribute.Bool("mosaic.billing.sync.unchanged", true))
		return SyncResult{
			Unchanged: true, Payload: payload, EntityTag: entityTag,
			RefreshAfter: issuedAt.Add(bounded.RefreshAfter),
			ValidUntil:   issuedAt.Add(bounded.ValidFor),
			StaleGrace:   bounded.StaleGrace,
		}, nil
	}

	record, err := SnapshotRecord(view, issuedAt, s.freshness, request.CorrelationID, request.RequestedKeys)
	if err != nil {
		return SyncResult{}, err
	}
	payload, err := CanonicalJSON(Envelope("customerEntitlementSnapshot", record))
	if err != nil {
		return SyncResult{}, err
	}
	bounded := s.freshness.Bounded()
	s.syncResults.Add(ctx, 1, metric.WithAttributes(attribute.String("result", "snapshot")))
	span.SetAttributes(
		attribute.Bool("mosaic.billing.sync.unchanged", false),
		attribute.Int64("mosaic.billing.sync.version", view.SnapshotVersion))
	return SyncResult{
		Payload: payload, EntityTag: entityTag,
		RefreshAfter: issuedAt.Add(bounded.RefreshAfter),
		ValidUntil:   issuedAt.Add(bounded.ValidFor),
		StaleGrace:   bounded.StaleGrace,
	}, nil
}

// emptyView is the representation of a customer with no committed projection in
// an Environment. Version 0 with no entries is deliberate: version 0 is the
// "no snapshot has ever been committed" sentinel, and real snapshots start at 1
// (writeCustomerSnapshot increments from 0). Numbering the placeholder 1 would
// make the first genuine projection collide with it, so a device that cached
// the placeholder would treat the first real snapshot as not newer and keep an
// empty entitlement set. The snapshot is still structurally valid, carries a
// pending projection status, and says nothing about access — which is exactly
// the truth.
func emptyView(token Token, at time.Time) SnapshotView {
	return SnapshotView{
		SnapshotID:      "pending." + token.CustomerID,
		ProjectID:       token.ProjectID,
		EnvironmentID:   token.EnvironmentID,
		CustomerID:      token.CustomerID,
		SnapshotVersion: 0,
		RuleVersion:     1,
		ComputedAt:      at,
		AsOf:            at,
		ChangeReason:    "initial_projection",
		Projection: ProjectionStatus{
			State: ProjectionPending, LastProjectedAt: at, PendingFactCount: 0,
		},
	}
}

// Check answers the trusted-server multi-key access question.
//
// The answer is never a bare boolean. Every key carries a state, an
// explanation, and the snapshot version and as-of instant it was derived from,
// so a caller that acts on it can say afterwards which state it acted on.
func (s *Service) Check(ctx context.Context, rawKey string, environmentID string, request CheckRequest) ([]byte, error) {
	ctx, span := s.tracer.Start(ctx, "billing.entitlement.check")
	defer span.End()

	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return nil, ErrUnauthenticated
	}
	if environmentID == "" {
		environmentID = scope.EnvironmentID
	}
	if environmentID != scope.EnvironmentID {
		return nil, ErrForbidden
	}
	if len(request.EntitlementKeys) == 0 || len(request.EntitlementKeys) > 64 {
		return nil, ErrInvalid
	}
	issuedAt := s.now()

	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		// Billing disabled is reported through the contract, not as an HTTP
		// error: the caller asked a question Mosaic declines to answer, and
		// every key comes back `unavailable` with the reason attached.
		record := CheckResultRecord(request.CustomerID, scope.ProjectID, environmentID, nil,
			request.EntitlementKeys, issuedAt, request.CorrelationID,
			"provider_unavailable", "billing_disabled")
		return CanonicalJSON(Envelope("entitlementCheckResult", record))
	}

	if _, err := s.repository.Customer(ctx, scope.ProjectID, request.CustomerID); err != nil {
		return nil, ErrNotFound
	}

	view, err := s.repository.CurrentSnapshot(ctx, scope.ProjectID, environmentID, request.CustomerID)
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		// Never projected here. Not an error and not `inactive`: Mosaic has no
		// answer yet.
		record := CheckResultRecord(request.CustomerID, scope.ProjectID, environmentID, nil,
			request.EntitlementKeys, issuedAt, request.CorrelationID,
			"missing_fact", "no_qualifying_source")
		return CanonicalJSON(Envelope("entitlementCheckResult", record))
	}
	if status, statusErr := s.repository.ProjectionStatusFor(ctx, scope.ProjectID, environmentID, request.CustomerID); statusErr == nil {
		view.Projection = status
	}

	span.SetAttributes(attribute.Int64("mosaic.billing.check.version", view.SnapshotVersion))
	record := CheckResultRecord(request.CustomerID, scope.ProjectID, environmentID, &view,
		request.EntitlementKeys, issuedAt, request.CorrelationID, "", "")
	return CanonicalJSON(Envelope("entitlementCheckResult", record))
}

// Snapshot reads a customer's current snapshot for a trusted server. The read is
// audited: an operator credential reading a named customer's entitlement state
// is exactly the access a later investigation needs to be able to reconstruct.
func (s *Service) Snapshot(ctx context.Context, rawKey, environmentID, customerID, correlationID string) ([]byte, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return nil, ErrUnauthenticated
	}
	if environmentID == "" {
		environmentID = scope.EnvironmentID
	}
	if environmentID != scope.EnvironmentID {
		return nil, ErrForbidden
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, err
	}
	view, err := s.repository.CurrentSnapshot(ctx, scope.ProjectID, environmentID, customerID)
	if err != nil {
		return nil, err
	}
	if status, statusErr := s.repository.ProjectionStatusFor(ctx, scope.ProjectID, environmentID, customerID); statusErr == nil {
		view.Projection = status
	}
	_ = s.repository.RecordAudit(ctx, scope.ProjectID, environmentID, scope.APIKeyID,
		"billing.entitlement.snapshot_read", "billing_customer", customerID, nil, s.now())

	record, err := SnapshotRecord(view, s.now(), s.freshness, correlationID, nil)
	if err != nil {
		return nil, err
	}
	return CanonicalJSON(Envelope("customerEntitlementSnapshot", record))
}

// Customer reads one Billing Customer directly.
func (s *Service) Customer(ctx context.Context, rawKey, customerID string) (CustomerView, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return CustomerView{}, ErrUnauthenticated
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return CustomerView{}, err
	}
	return s.repository.Customer(ctx, scope.ProjectID, customerID)
}

// Subscriptions lists a customer's projected subscriptions, keyset-paginated.
func (s *Service) Subscriptions(ctx context.Context, rawKey, environmentID, customerID string, limit int, cursor string) ([]SubscriptionView, string, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return nil, "", ErrUnauthenticated
	}
	if environmentID == "" {
		environmentID = scope.EnvironmentID
	}
	if environmentID != scope.EnvironmentID {
		return nil, "", ErrForbidden
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, "", err
	}
	return s.repository.Subscriptions(ctx, scope.ProjectID, environmentID, customerID, boundedLimit(limit), cursor)
}

// Subscription reads one projected Subscription Instance as a contract record.
func (s *Service) Subscription(ctx context.Context, rawKey, instanceID, correlationID string) ([]byte, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return nil, ErrUnauthenticated
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, err
	}
	view, err := s.repository.Subscription(ctx, scope.ProjectID, instanceID)
	if err != nil {
		return nil, err
	}
	if view.EnvironmentID != scope.EnvironmentID {
		return nil, ErrNotFound
	}
	record, err := SubscriptionRecord(view, correlationID)
	if err != nil {
		return nil, err
	}
	return CanonicalJSON(Envelope("subscriptionSnapshot", record))
}

// Timeline reads one Subscription Instance's append-only explanation history.
func (s *Service) Timeline(ctx context.Context, rawKey, instanceID string, limit int, cursor string) ([]TimelineEntry, string, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return nil, "", ErrUnauthenticated
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, "", err
	}
	view, err := s.repository.Subscription(ctx, scope.ProjectID, instanceID)
	if err != nil {
		return nil, "", err
	}
	if view.EnvironmentID != scope.EnvironmentID {
		return nil, "", ErrNotFound
	}
	return s.repository.Timeline(ctx, scope.ProjectID, instanceID, boundedLimit(limit), cursor)
}
