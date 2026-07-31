package billingwebhook

import "errors"

// Stable domain errors. Handlers map these in one place; nothing anywhere
// compares an error-message string.
var (
	// ErrUnauthenticated is a missing operator identity.
	ErrUnauthenticated = errors.New("the request could not be authenticated")
	// ErrForbidden is an authenticated Project member whose role is too low for
	// billing webhook management. Non-members remain ErrNotFound so this error
	// cannot be used to enumerate Projects outside the actor's organization.
	ErrForbidden = errors.New("the actor is not authorized to manage billing webhooks")
	// ErrNotFound covers both a genuinely absent destination and one owned by
	// another tenant. They are deliberately the same answer: distinguishing
	// them would let a caller enumerate another Project's destinations.
	ErrNotFound = errors.New("the requested resource was not found")
	ErrInvalid  = errors.New("the request is not valid")
	// ErrConflict is a state transition the resource does not permit, including
	// deleting a destination that still has delivery history.
	ErrConflict = errors.New("the resource is in a conflicting state")
	// ErrBillingDisabled is returned when the Project has asked Mosaic to hold
	// no billing state. It fails closed: an unreadable setting is treated as
	// disabled.
	ErrBillingDisabled = errors.New("billing is not enabled for this Project")
	// ErrUnavailable is a storage failure. It is never the destination's fault
	// and never reaches the destination.
	ErrUnavailable = errors.New("webhook storage is unavailable")

	// ErrDestinationRefused is an SSRF-policy refusal, returned to the operator
	// configuring the destination and recorded as a permanent delivery failure.
	// It deliberately does not say which rule refused: the resolved address is
	// information about Mosaic's own network position.
	ErrDestinationRefused = errors.New("the destination address is not allowed")
	// ErrSecretUnavailable means a signing secret could not be sealed or
	// opened. Delivery stops rather than sending an unsigned or wrongly signed
	// body, because an unsigned entitlement webhook is an unauthenticated
	// instruction to grant access.
	ErrSecretUnavailable = errors.New("the signing secret is unavailable")
)
