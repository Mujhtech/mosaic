package billingaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// Service is the access application service. It owns every authorization
// decision on the read surfaces, the token lifecycle, and the freshness policy
// applied to a served snapshot. Handlers are thin wrappers over it.
type Service struct {
	repository Repository
	keys       KeyAuthenticator
	now        func() time.Time
	random     io.Reader
	tracer     trace.Tracer
	issuer     string
	freshness  Freshness

	tokensIssued  metric.Int64Counter
	tokenFailures metric.Int64Counter
	syncResults   metric.Int64Counter
	syncLatency   metric.Float64Histogram
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func WithRandom(random io.Reader) Option {
	return func(s *Service) {
		if random != nil {
			s.random = random
		}
	}
}

// WithIssuer names the Mosaic installation on issued token metadata. It is an
// operator diagnostic for self-hosted deployments and is never used to decide
// anything.
func WithIssuer(issuer string) Option {
	return func(s *Service) {
		if issuer = strings.TrimSpace(issuer); issuer != "" {
			s.issuer = issuer
		}
	}
}

func WithFreshness(freshness Freshness) Option {
	return func(s *Service) { s.freshness = freshness.Bounded() }
}

func NewService(repository Repository, keys KeyAuthenticator, options ...Option) *Service {
	meter := otel.Meter("mosaic/billingaccess")
	service := &Service{
		repository: repository,
		keys:       keys,
		now:        func() time.Time { return time.Now().UTC() },
		random:     rand.Reader,
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingaccess"),
		issuer:     "mosaic",
		freshness:  DefaultFreshness(),
	}
	service.tokensIssued, _ = meter.Int64Counter("mosaic.billing.token.issued")
	service.tokenFailures, _ = meter.Int64Counter("mosaic.billing.token.rejected")
	service.syncResults, _ = meter.Int64Counter("mosaic.billing.sync.results")
	service.syncLatency, _ = meter.Float64Histogram("mosaic.billing.sync.latency",
		metric.WithUnit("ms"))
	for _, option := range options {
		option(service)
	}
	return service
}

// ---------------------------------------------------------------------------
// Customer Access Tokens
// ---------------------------------------------------------------------------

// IssueToken mints a Customer Access Token for a customer the calling backend
// has already authenticated.
//
// The tenant comes entirely from the authenticated secret server key. The
// request carries no Project and no Environment, so a compromised or careless
// caller cannot mint a token into a tenant it does not own — the scope is read
// from the key, never from the body.
//
// The returned value is the only time the credential exists outside the
// caller's process. It is never logged, never stored, and never returned again.
func (s *Service) IssueToken(ctx context.Context, rawKey string, request IssuanceRequest) (IssuedToken, error) {
	ctx, span := s.tracer.Start(ctx, "billing.token.issue")
	defer span.End()

	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "issue_auth")))
		return IssuedToken{}, ErrUnauthenticated
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return IssuedToken{}, err
	}

	// `server_check` is declared by the contract and deliberately not issued in
	// Phase 9B: no server-facing audience exists yet, and minting a credential
	// for a surface that does not exist is a credential nobody can revoke on
	// purpose.
	if request.Audience != AudienceSDKSync {
		return IssuedToken{}, ErrInvalid
	}
	scopes, ok := normalizeScopes(request.Scopes)
	if !ok {
		return IssuedToken{}, ErrInvalid
	}

	customer, err := s.repository.Customer(ctx, scope.ProjectID, request.CustomerID)
	if err != nil {
		// A customer in another Project is reported as absent rather than
		// forbidden: a caller must not be able to probe for the existence of
		// another tenant's customers.
		return IssuedToken{}, ErrNotFound
	}

	value, digest, err := s.newTokenValue()
	if err != nil {
		return IssuedToken{}, err
	}
	id, err := s.newID("cat")
	if err != nil {
		return IssuedToken{}, err
	}

	issuedAt := s.now()
	token := Token{
		ID:               id,
		ProjectID:        scope.ProjectID,
		EnvironmentID:    scope.EnvironmentID,
		CustomerID:       customer.ID,
		Audience:         request.Audience,
		Scopes:           scopes,
		IssuedByAPIKeyID: scope.APIKeyID,
		IssuedAt:         issuedAt,
		ExpiresAt:        issuedAt.Add(clampTTL(request.RequestedTTLSecond)),
	}
	stored, err := s.repository.CreateToken(ctx, token, digest, scope.APIKeyID)
	if err != nil {
		return IssuedToken{}, err
	}

	s.tokensIssued.Add(ctx, 1)
	span.SetAttributes(
		attribute.String("mosaic.billing.token.id", stored.ID),
		attribute.String("mosaic.billing.token.audience", stored.Audience))
	// The token id is a public handle and safe to log. The value is not, and no
	// branch of this method can reach a logger with it.
	zerolog.Ctx(ctx).Info().
		Str("billing_token_id", stored.ID).
		Str("project_id", stored.ProjectID).
		Str("environment_id", stored.EnvironmentID).
		Str("billing_customer_id", stored.CustomerID).
		Msg("customer access token issued")

	return IssuedToken{Value: value, Metadata: stored}, nil
}

// RevokeToken invalidates a token immediately. Revocation is one row update,
// which is the practical advantage of an opaque credential over a signed one:
// there is nothing to wait out.
func (s *Service) RevokeToken(ctx context.Context, rawKey, tokenID, reason string) (Token, error) {
	ctx, span := s.tracer.Start(ctx, "billing.token.revoke")
	defer span.End()

	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return Token{}, ErrUnauthenticated
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return Token{}, err
	}
	if !validRevocationReason(reason) {
		return Token{}, ErrInvalid
	}
	return s.repository.RevokeToken(ctx, scope, tokenID, reason, scope.APIKeyID, s.now())
}

// ListTokens reports token metadata for one customer. It never returns a token
// value, because Mosaic does not have one to return.
func (s *Service) ListTokens(ctx context.Context, rawKey, customerID string, limit int) ([]Token, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return nil, ErrUnauthenticated
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, err
	}
	return s.repository.ListTokens(ctx, scope, customerID, boundedLimit(limit))
}

// AuthenticatedToken is a validated presentation of a Customer Access Token.
type AuthenticatedToken struct {
	Token Token
	// SDKKey is the tenant the accompanying public SDK key resolved to. It must
	// agree with the token's own scope.
	SDKKey KeyScope
}

// AuthenticateCustomerTokenForTenant validates a presented token against a
// tenant the caller has already authenticated by some other credential.
//
// It exists for the observation intake surfaces, where the accompanying
// credential is an API key that the ingestion module has already resolved to a
// Project and Environment — a public SDK key on the client endpoint, a secret
// server key on the trusted one. Routing those through
// AuthenticateCustomerToken would mean re-authenticating a key that is already
// authenticated, and would refuse the trusted endpoint outright, because a
// secret server key is not an SDK key.
//
// Every other check is the same one and for the same reason: expiry,
// revocation, and audience are re-validated on every presentation because the
// token is opaque and has no cached claim to go stale, and a token whose scope
// disagrees with the caller's is refused rather than answered, because that is
// either a misconfiguration or an attempt to write across the isolation
// boundary.
func (s *Service) AuthenticateCustomerTokenForTenant(ctx context.Context, rawToken, projectID, environmentID string) (Token, error) {
	if !validTokenShape(rawToken) {
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "shape")))
		return Token{}, ErrUnauthenticated
	}
	sum := sha256.Sum256([]byte(rawToken))
	token, err := s.repository.TokenByDigest(ctx, sum[:])
	if err != nil {
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "lookup")))
		return Token{}, ErrUnauthenticated
	}
	now := s.now()
	switch {
	case token.Status(now) != TokenActive:
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(
			attribute.String("stage", "status"), attribute.String("status", token.Status(now))))
		return Token{}, ErrUnauthenticated
	case token.Audience != AudienceSDKSync:
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "audience")))
		return Token{}, ErrUnauthenticated
	case token.ProjectID != projectID || token.EnvironmentID != environmentID:
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "tenant_mismatch")))
		zerolog.Ctx(ctx).Warn().
			Str("billing_token_id", token.ID).
			Str("token_environment_id", token.EnvironmentID).
			Str("key_environment_id", environmentID).
			Msg("customer access token presented with a key from another Environment")
		return Token{}, ErrForbidden
	}
	return token, nil
}

// AuthenticateCustomerToken validates a presented token against the public SDK
// key that accompanies it.
//
// Both credentials are required and both are checked. The token decides *which*
// customer is being read — a public SDK key can never select one — and the SDK
// key decides which Environment is asking. If they disagree, the request is
// refused: a token minted for one Environment presented alongside another
// Environment's key is either a misconfiguration or an attempt to read across
// the isolation boundary, and neither deserves an answer.
//
// Expiry, revocation, and audience are re-checked on every request rather than
// at issuance only. That is the entire reason the token is opaque: there is no
// cached claim to go stale.
func (s *Service) AuthenticateCustomerToken(ctx context.Context, rawToken, rawSDKKey string) (AuthenticatedToken, error) {
	sdkScope, err := s.keys.AuthenticateSDKKey(ctx, rawSDKKey)
	if err != nil {
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "sdk_key")))
		return AuthenticatedToken{}, ErrUnauthenticated
	}
	if !validTokenShape(rawToken) {
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "shape")))
		return AuthenticatedToken{}, ErrUnauthenticated
	}
	sum := sha256.Sum256([]byte(rawToken))
	token, err := s.repository.TokenByDigest(ctx, sum[:])
	if err != nil {
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "lookup")))
		return AuthenticatedToken{}, ErrUnauthenticated
	}

	now := s.now()
	switch {
	case token.Status(now) != TokenActive:
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(
			attribute.String("stage", "status"), attribute.String("status", token.Status(now))))
		return AuthenticatedToken{}, ErrUnauthenticated
	case token.Audience != AudienceSDKSync:
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "audience")))
		return AuthenticatedToken{}, ErrUnauthenticated
	case token.ProjectID != sdkScope.ProjectID || token.EnvironmentID != sdkScope.EnvironmentID:
		// Cross-tenant presentation. Counted separately because a rise in this
		// number is a security signal, not a client bug.
		s.tokenFailures.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "tenant_mismatch")))
		zerolog.Ctx(ctx).Warn().
			Str("billing_token_id", token.ID).
			Str("token_environment_id", token.EnvironmentID).
			Str("key_environment_id", sdkScope.EnvironmentID).
			Msg("customer access token presented with a key from another Environment")
		return AuthenticatedToken{}, ErrForbidden
	}

	// Best-effort: a diagnostic write must never fail an entitlement read.
	if err := s.repository.TouchToken(ctx, token.ID, now); err != nil {
		zerolog.Ctx(ctx).Debug().Str("billing_token_id", token.ID).Msg("token last-use not recorded")
	}
	return AuthenticatedToken{Token: token, SDKKey: sdkScope}, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newTokenValue produces the opaque credential and its digest. The value has no
// internal structure: nothing may be inferred from it, and Mosaic keeps only
// the digest, so a database compromise yields no usable credential.
func (s *Service) newTokenValue() (string, []byte, error) {
	buffer := make([]byte, TokenRandomBytes)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", nil, fmt.Errorf("generate customer access token: %w", err)
	}
	value := TokenPrefix + base64.RawURLEncoding.EncodeToString(buffer)
	digest := sha256.Sum256([]byte(value))
	return value, digest[:], nil
}

func (s *Service) newID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", fmt.Errorf("generate billing access identifier: %w", err)
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

// validTokenShape rejects a malformed presentation before it reaches the
// database. It is a cheap filter, not a security boundary: the digest lookup is
// the boundary.
func validTokenShape(value string) bool {
	if len(value) != len(TokenPrefix)+43 || !strings.HasPrefix(value, TokenPrefix) {
		return false
	}
	for _, char := range value[len(TokenPrefix):] {
		switch {
		case char >= 'A' && char <= 'Z', char >= 'a' && char <= 'z',
			char >= '0' && char <= '9', char == '-', char == '_':
		default:
			return false
		}
	}
	return true
}

// clampTTL applies the contract's ceiling. A caller may shorten a token's life
// and can never lengthen it past the maximum; the schema enforces the same
// bound independently.
func clampTTL(requestedSeconds int) time.Duration {
	if requestedSeconds <= 0 {
		return DefaultTokenTTL
	}
	requested := time.Duration(requestedSeconds) * time.Second
	if requested < MinTokenTTL {
		return MinTokenTTL
	}
	if requested > MaxTokenTTL {
		return MaxTokenTTL
	}
	return requested
}

// normalizeScopes validates and canonicalizes the requested scopes. An empty
// request gets the least a token can carry.
func normalizeScopes(requested []string) ([]string, bool) {
	if len(requested) == 0 {
		return []string{ScopeEntitlementsRead}, true
	}
	if len(requested) > 3 {
		return nil, false
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(requested))
	for _, scope := range requested {
		switch scope {
		case ScopeEntitlementsRead, ScopeEntitlementsSync, ScopeRestoreRequest:
		default:
			return nil, false
		}
		if seen[scope] {
			return nil, false
		}
		seen[scope] = true
		result = append(result, scope)
	}
	return result, true
}

func validRevocationReason(reason string) bool {
	switch reason {
	case RevokedCustomerSignedOut, RevokedIdentityChanged, RevokedOperator,
		RevokedCustomerDeleted, RevokedKeyRotated, RevokedSuspectedCompromise,
		RevokedSuperseded:
		return true
	default:
		return false
	}
}

func boundedLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}

// requireEnabled fails closed, matching the ingestion and projection paths: an
// unreadable setting is treated as disabled, so a transient database error
// cannot quietly re-enable a Project that asked Mosaic to hold no billing state.
func (s *Service) requireEnabled(ctx context.Context, projectID string) error {
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("billing_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; treating the Project as disabled")
		return ErrBillingDisabled
	}
	if !enabled {
		return ErrBillingDisabled
	}
	return nil
}
