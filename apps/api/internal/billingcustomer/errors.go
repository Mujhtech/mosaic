package billingcustomer

import "errors"

// Stable domain errors. Callers compare with errors.Is, never by message.
var (
	// ErrBillingDisabled is returned by every read and write when the Project
	// has billing turned off. It maps to `unavailable` on entitlement
	// surfaces, never to `inactive`: a disabled integration says nothing about
	// whether a customer paid.
	ErrBillingDisabled = errors.New("billing is not enabled for this Project")

	ErrNotFound      = errors.New("billing customer not found")
	ErrForbidden     = errors.New("actor may not access this Project")
	ErrUnavailable   = errors.New("billing identity storage is unavailable")
	ErrConflict      = errors.New("alias already resolves to another customer")
	ErrFrozen        = errors.New("customer identity is frozen by an open conflict")
	ErrInvalidAlias  = errors.New("alias value is not acceptable")
	ErrNotIdentified = errors.New("no customer could be resolved from the supplied evidence")
)
