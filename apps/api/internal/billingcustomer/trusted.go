package billingcustomer

import (
	"context"
	"strings"

	"go.opentelemetry.io/otel/attribute"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// This file is the trusted-server application surface for billing identity
// (plan §11). Every method here starts by authenticating a secret server key
// and takes its tenant from that key alone — never from the request body.
//
// That is the whole of the impersonation defence. A caller cannot name a
// Project, an Environment, or an Application it does not hold a key for, so a
// careless or compromised backend can only damage its own tenant. It is also
// why there is no public-SDK-key path in this file: an application-user alias
// asserted by a public key would let any client claim any user.

// TrustedActor is how a server key appears in the audit trail. The API key
// identifier is a stable handle an operator can revoke; the key itself never
// travels past the authenticator.
func trustedActor(scope KeyScope) Actor { return Actor{ID: "apikey:" + scope.APIKeyID} }

func (s *Service) authenticate(ctx context.Context, rawKey string) (KeyScope, error) {
	if s.keys == nil {
		return KeyScope{}, ErrUnauthenticated
	}
	scope, err := s.keys.AuthenticateServerKey(ctx, strings.TrimSpace(rawKey))
	if err != nil {
		return KeyScope{}, ErrUnauthenticated
	}
	if scope.ProjectID == "" {
		return KeyScope{}, ErrUnauthenticated
	}
	return scope, nil
}

// IdentifyCustomer is the trusted create-or-get path of plan §5a rule 1.
//
// It is one of exactly two ways a Billing Customer comes into existence. SDK
// initialization and installation registration reach nothing here, and there is
// no variant of this call that accepts an installation identifier: the only
// alias this method will act on is an application user id asserted by the
// backend that owns the user.
func (s *Service) IdentifyCustomer(ctx context.Context, rawKey, applicationUserID string) (Customer, bool, error) {
	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return Customer{}, false, err
	}
	return s.CreateOrGetForApplicationUser(ctx, scope.ProjectID, applicationUserID)
}

// AttachAliasForServer attaches an application-user alias to an existing
// customer. Login attaches; it never merges (plan §5a rule 3). When the alias
// already resolves elsewhere the call fails with ErrIdentityConflict and an
// operator-resolvable conflict has been opened.
func (s *Service) AttachAliasForServer(ctx context.Context, rawKey, customerID, applicationUserID string) (Alias, error) {
	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return Alias{}, err
	}
	return s.AttachApplicationUserAlias(ctx, trustedActor(scope), scope.ProjectID, customerID, applicationUserID)
}

// RevokeAliasForServer ends an alias's active resolution. Nothing is deleted:
// the alias row is end-dated, so the history of who was linked when survives a
// sign-out.
func (s *Service) RevokeAliasForServer(ctx context.Context, rawKey, aliasID string) error {
	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return err
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return err
	}
	actor := trustedActor(scope)
	if err := s.repository.RevokeAlias(ctx, actor, scope.ProjectID, strings.TrimSpace(aliasID), s.now()); err != nil {
		return err
	}
	return s.repository.RecordAudit(ctx, actor, scope.ProjectID, "billing.customer.alias_revoked",
		"billing_customer_alias", aliasID, nil, s.now())
}

// ListAliasesForServer returns a customer's alias history. Digests are not part
// of the returned shape and no caller can ask for them.
func (s *Service) ListAliasesForServer(ctx context.Context, rawKey, customerID string) ([]Alias, error) {
	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return nil, err
	}
	return s.ListAliases(ctx, trustedActor(scope), scope.ProjectID, customerID)
}

// ListConflictsForServer lists identity conflicts awaiting resolution.
func (s *Service) ListConflictsForServer(ctx context.Context, rawKey, status string) ([]Conflict, error) {
	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return nil, err
	}
	switch status {
	case "", "open", "resolved":
	default:
		return nil, ErrInvalidAlias
	}
	return s.ListConflicts(ctx, trustedActor(scope), scope.ProjectID, status)
}

// ConflictDetailForServer returns one conflict with the lineage it disputes,
// which is what an operator needs before choosing a resolution action.
func (s *Service) ConflictDetailForServer(ctx context.Context, rawKey, conflictID string) (ConflictDetail, error) {
	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return ConflictDetail{}, err
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return ConflictDetail{}, err
	}
	conflict, err := s.repository.Conflict(ctx, trustedActor(scope), scope.ProjectID, strings.TrimSpace(conflictID))
	if err != nil {
		return ConflictDetail{}, err
	}
	detail := ConflictDetail{Conflict: conflict}
	if conflict.Scope != ConflictScopeAlias && conflict.PurchaseLineageID != "" {
		lineage, lineageErr := s.repository.Lineage(ctx, scope.ProjectID, conflict.PurchaseLineageID)
		if lineageErr != nil {
			// The conflict is still worth returning without it; an operator can
			// act on the customer identifiers alone.
			return detail, nil
		}
		detail.Lineage = &lineage
	}
	return detail, nil
}

// RequestSync enqueues a manual recomputation of one customer's entitlement
// aggregate and returns the handle the projection queue coalesces on.
//
// It computes nothing itself. A support-facing "sync now" that derived its own
// answer would produce a second authoritative result alongside the projection's,
// so this schedules the same job every other trigger schedules and reports where
// to watch it.
func (s *Service) RequestSync(ctx context.Context, rawKey, customerID string) (SyncRequest, error) {
	ctx, span := s.tracer.Start(ctx, "billing.customer.request_sync")
	defer span.End()

	scope, err := s.authenticate(ctx, rawKey)
	if err != nil {
		return SyncRequest{}, err
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return SyncRequest{}, err
	}
	if scope.EnvironmentID == "" {
		// A projection is Environment-scoped. A key that names no Environment
		// cannot say what to recompute, and guessing one would recompute the
		// wrong Environment's state.
		return SyncRequest{}, ErrInvalidAlias
	}
	actor := trustedActor(scope)
	customer, err := s.repository.Customer(ctx, actor, scope.ProjectID, strings.TrimSpace(customerID))
	if err != nil {
		return SyncRequest{}, err
	}

	projectionScope := billingprojection.Scope{
		ProjectID: scope.ProjectID, EnvironmentID: scope.EnvironmentID, CustomerID: customer.ID,
	}
	if s.reprojector == nil {
		return SyncRequest{}, ErrUnavailable
	}
	if err := s.reprojector.Enqueue(ctx, projectionScope, billingprojection.KindManualSync); err != nil {
		return SyncRequest{}, ErrUnavailable
	}

	now := s.now()
	_ = s.repository.RecordAudit(ctx, actor, scope.ProjectID, "billing.customer.sync_requested",
		"billing_customer", customer.ID, map[string]string{
			"environmentId": scope.EnvironmentID, "triggerKind": billingprojection.KindManualSync,
		}, now)
	span.SetAttributes(
		attribute.String("mosaic.billing.customer.id", customer.ID),
		attribute.String("mosaic.billing.projection.scope_key", projectionScope.Key()))
	logSafely(ctx, "billing customer projection requested manually", map[string]string{
		"project_id": scope.ProjectID, "environment_id": scope.EnvironmentID,
		"billing_customer_id": customer.ID,
	})

	return SyncRequest{
		ProjectID: scope.ProjectID, EnvironmentID: scope.EnvironmentID,
		BillingCustomerID: customer.ID, ScopeKey: projectionScope.Key(),
		Kind: billingprojection.KindManualSync, RequestedAt: now,
	}, nil
}
