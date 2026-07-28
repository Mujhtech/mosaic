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
	// ErrValidationBusy reports that another worker holds a live lease on the
	// input a caller asked to revalidate. It is a "come back later" signal, not
	// a failure: the caller leaves its own job queued rather than running a
	// second validation concurrently with the one already in flight.
	ErrValidationBusy = errors.New("the input is already being validated")
	// ErrCredentialsStillActive blocks disabling Mosaic Billing while a Store
	// Server Credential is still active. Disabling with credentials in place
	// would mean Apple keeps posting notifications Mosaic refuses to record,
	// silently spending a five-attempt retry budget that is never re-issued;
	// revoking the credential first is what actually stops the store.
	ErrCredentialsStillActive = errors.New("active Store Server Credentials must be revoked before Mosaic Billing can be disabled")
	// ErrCredentialUnusable covers a revoked or undecryptable Store Server
	// Credential — one that exists but cannot be used. It never carries the
	// underlying cryptographic error.
	ErrCredentialUnusable = errors.New("store server credential is unusable")
	// ErrCredentialMissing is distinct from ErrCredentialUnusable: the tenant
	// scope has no active Store Server Credential for the provider at all.
	//
	// The two are separated because the operator action is different and the
	// severity is different. An unusable credential is a broken secret, and the
	// fix is rotation. A missing credential means Mosaic was asked to validate
	// against a store it has never been connected to, and the fix is to connect
	// it. Reporting the second as the first sends an operator to rotate a
	// credential that does not exist.
	ErrCredentialMissing = errors.New("no store server credential is configured for this environment")
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
