// Package billingaccess owns Mosaic's authoritative access surfaces: Customer
// Access Tokens, the SDK entitlement sync endpoint, the trusted-server
// entitlement APIs, restore and sync jobs, and projection diagnostics.
//
// Everything in this package reads committed projections. Nothing here
// projects, derives access, or interprets a provider payload — that is
// billingprojection's job, and keeping the read side unable to derive is what
// makes "the API and the SDK see the same state" structural rather than
// aspirational.
package billingaccess

import "time"

// ContractVersion is the Authoritative Entitlement Contract version this build
// speaks. It appears on every record this package serializes.
const ContractVersion = "1"

// TokenContractVersion is the Customer Access Token Contract version.
const TokenContractVersion = "1"

// ---------------------------------------------------------------------------
// Customer Access Tokens
// ---------------------------------------------------------------------------

// TokenPrefix is the contract's fixed prefix. It is not a namespace to parse:
// it exists so a leaked credential is recognisable in a secret scanner.
const TokenPrefix = "mcat_"

// TokenRandomBytes is 256 bits, which base64url-encodes to the contract's
// exact 43 characters.
const TokenRandomBytes = 32

// Token audiences. `server_check` is declared by the contract and deliberately
// not issued in Phase 9B: declaring it now means adding the audience later
// costs no contract version, and refusing to mint it now means no token exists
// for a surface that has not been built.
const (
	AudienceSDKSync     = "sdk_sync"
	AudienceServerCheck = "server_check"
)

// Token scopes.
const (
	ScopeEntitlementsRead = "entitlements.read"
	ScopeEntitlementsSync = "entitlements.sync"
	ScopeRestoreRequest   = "restore.request"
)

// Token lifetimes. The default is one hour and the ceiling is one day; the
// schema enforces the ceiling independently, so a service bug cannot mint a
// long-lived credential.
const (
	DefaultTokenTTL = time.Hour
	MaxTokenTTL     = 24 * time.Hour
	MinTokenTTL     = time.Minute
)

// Token statuses.
const (
	TokenActive  = "active"
	TokenExpired = "expired"
	TokenRevoked = "revoked"
)

// Revocation reasons, closed per the contract.
const (
	RevokedCustomerSignedOut   = "customer_signed_out"
	RevokedIdentityChanged     = "identity_changed"
	RevokedOperator            = "operator_revoked"
	RevokedCustomerDeleted     = "customer_deleted"
	RevokedKeyRotated          = "key_rotated"
	RevokedSuspectedCompromise = "suspected_compromise"
	RevokedSuperseded          = "superseded_by_new_token"
)

// Token is the server-side metadata about one opaque credential. The credential
// itself is never a field here: it exists exactly once, in the issuance result,
// and Mosaic keeps only its digest.
type Token struct {
	ID               string
	ProjectID        string
	EnvironmentID    string
	CustomerID       string
	Audience         string
	Scopes           []string
	IssuedByAPIKeyID string
	IssuedAt         time.Time
	ExpiresAt        time.Time
	RevokedAt        *time.Time
	RevocationReason string
	LastUsedAt       *time.Time
}

// Status reports the token's contract status at an instant. Revocation wins
// over expiry: a token revoked before it expired is revoked, and reporting it
// as merely expired would hide an operator action.
func (t Token) Status(now time.Time) string {
	switch {
	case t.RevokedAt != nil:
		return TokenRevoked
	case !now.Before(t.ExpiresAt):
		return TokenExpired
	default:
		return TokenActive
	}
}

// HasScope reports whether the token carries a scope.
func (t Token) HasScope(scope string) bool {
	for _, held := range t.Scopes {
		if held == scope {
			return true
		}
	}
	return false
}

// IssuanceRequest is what a trusted server asks for. It carries no Project or
// Environment: tenant scope comes from the authenticated secret server key, so
// a careless caller cannot mint a token into a tenant it does not own.
type IssuanceRequest struct {
	CustomerID         string
	Audience           string
	Scopes             []string
	RequestedTTLSecond int
	CorrelationID      string
}

// IssuedToken is the only value that ever carries the credential.
type IssuedToken struct {
	// Value is returned to the caller exactly once and is never logged,
	// never persisted, and never returned again.
	Value    string
	Metadata Token
}

// KeyScope is the tenant an API key authenticated into. It is a local copy of
// the ingestion package's scope so this package does not depend on the
// ingestion service to authenticate a read.
type KeyScope struct {
	APIKeyID        string
	OrganizationID  string
	ProjectID       string
	EnvironmentID   string
	EnvironmentMode string
	ApplicationID   string
}

// Actor is the operator behind a trusted-server or dashboard call.
type Actor struct{ ID string }

// ---------------------------------------------------------------------------
// Freshness policy (OD-5)
// ---------------------------------------------------------------------------

// Freshness defaults. `refreshAfter` asks a reader to refresh; `validUntil`
// ends authoritative validity; `staleGraceSeconds` is the bounded window past
// validUntil in which a reader may keep serving previously active Entitlements
// while clearly marking them stale.
//
// The contract caps the combined horizon — (validUntil - issuedAt) plus the
// grace window — at thirty days. That ceiling is enforced in Go as well as
// documented, because it is the difference between a bounded offline grace and
// an entitlement that never expires on a device that never reconnects.
const (
	DefaultRefreshAfter     = time.Hour
	DefaultValidFor         = 7 * 24 * time.Hour
	DefaultStaleGraceWindow = 24 * time.Hour
	MaxCombinedHorizon      = 30 * 24 * time.Hour
)

// Freshness is the per-Environment freshness policy applied to a served
// snapshot.
type Freshness struct {
	RefreshAfter time.Duration
	ValidFor     time.Duration
	StaleGrace   time.Duration
}

// DefaultFreshness is the shipped policy.
func DefaultFreshness() Freshness {
	return Freshness{
		RefreshAfter: DefaultRefreshAfter,
		ValidFor:     DefaultValidFor,
		StaleGrace:   DefaultStaleGraceWindow,
	}
}

// Bounded clamps a policy into the contract's admissible range. It is applied
// on every serialization rather than only at configuration time, so a value
// that reached storage before a bound existed still cannot be served.
func (f Freshness) Bounded() Freshness {
	if f.RefreshAfter <= 0 {
		f.RefreshAfter = DefaultRefreshAfter
	}
	if f.ValidFor <= 0 {
		f.ValidFor = DefaultValidFor
	}
	if f.StaleGrace < 0 {
		f.StaleGrace = 0
	}
	if f.RefreshAfter > f.ValidFor {
		f.RefreshAfter = f.ValidFor
	}
	if f.ValidFor+f.StaleGrace > MaxCombinedHorizon {
		// The validity window is preserved and the grace window absorbs the
		// overflow: shortening validity would expire a snapshot a reader is
		// entitled to treat as authoritative, whereas shortening grace only
		// removes a degraded-mode allowance.
		f.StaleGrace = MaxCombinedHorizon - f.ValidFor
		if f.StaleGrace < 0 {
			f.ValidFor, f.StaleGrace = MaxCombinedHorizon, 0
		}
	}
	return f
}
