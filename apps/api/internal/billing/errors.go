package billing

import "errors"

// Application-level sentinels. Handlers map these to HTTP status codes in one
// place; nothing else in the package compares error strings.
var (
	ErrUnauthenticated = errors.New("billing request is unauthenticated")
	ErrForbidden       = errors.New("billing request is not permitted")
	ErrNotFound        = errors.New("billing resource was not found")
	ErrConflict        = errors.New("billing request conflicts with current state")
	ErrInvalid         = errors.New("billing request is invalid")
	ErrRateLimited     = errors.New("billing request is rate limited")
	ErrBillingDisabled = errors.New("Mosaic Billing is not enabled for this Project")
	// ErrUnavailable is the only condition an intake endpoint answers non-2xx
	// for: Mosaic genuinely could not durably record the input.
	ErrUnavailable = errors.New("billing storage is temporarily unavailable")
	// ErrCredentialUnusable covers a missing, revoked, or undecryptable Store
	// Server Credential. It never carries the underlying cryptographic error.
	ErrCredentialUnusable = errors.New("store server credential is unusable")
)

// SafeError wraps a failure so that a 5xx response never carries the cause into
// the operator log through response.Error's cause-logging path.
//
// response.Error logs the cause behind every 5xx. That is correct for ordinary
// routes and wrong for billing: a provider transport error, a JSON decode
// error, or a database error on this path can quote a fragment of a signed
// payload, a purchase token, or an Authorization header. SafeError keeps the
// stable code and drops everything else, following the same reasoning as the
// authn resolver redaction in platform/authn/principal.go.
type SafeError struct {
	Code string
	// Kind is the Go type name of the original error, retained for triage. It
	// is a type name only and can never contain a value.
	Kind string
}

func (e *SafeError) Error() string { return "billing operation failed: " + e.Code }
