package billingaccess

import "errors"

// Stable domain errors. Handlers map these in one place; nothing compares an
// error message string.
var (
	// ErrBillingDisabled maps to `unavailable` on every entitlement surface,
	// never to `inactive`. A Project that turned billing off has not told
	// Mosaic that its customers lost access — it has told Mosaic to stop
	// answering, and those are different answers.
	ErrBillingDisabled = errors.New("billing is not enabled for this Project")
	// ErrUnauthenticated covers a missing, malformed, expired, revoked, or
	// wrong-audience credential. It is deliberately one error: distinguishing
	// them on the wire would tell an attacker which half of a guess was right.
	ErrUnauthenticated = errors.New("the request could not be authenticated")
	ErrForbidden       = errors.New("the credential does not cover this resource")
	ErrNotFound        = errors.New("the requested resource was not found")
	ErrInvalid         = errors.New("the request is not valid")
	ErrConflict        = errors.New("the resource is in a conflicting state")
	ErrUnavailable     = errors.New("billing storage is unavailable")
	// ErrDestinationRefused is an SSRF-policy refusal. It is returned to the
	// operator configuring the destination, never to the destination.
	ErrDestinationRefused = errors.New("the destination address is not allowed")
)
