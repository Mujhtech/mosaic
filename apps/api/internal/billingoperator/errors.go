package billingoperator

import "errors"

// Stable domain errors, mapped onto HTTP in exactly one place by the handler.
var (
	ErrUnauthenticated = errors.New("an authenticated actor is required")
	ErrForbidden       = errors.New("the actor may not read this Project's billing state")
	ErrNotFound        = errors.New("the requested resource was not found")
	ErrInvalid         = errors.New("the request is not valid")
	ErrConflict        = errors.New("the resource is in a conflicting state")
	ErrBillingDisabled = errors.New("billing is not enabled for this Project")
	ErrUnavailable     = errors.New("billing operator state could not be read")
)
