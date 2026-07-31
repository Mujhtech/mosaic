package billinggrant

import "errors"

// Stable domain errors, mapped onto HTTP in exactly one place by the handler.
var (
	ErrUnauthenticated = errors.New("an authenticated actor is required")
	ErrForbidden       = errors.New("the actor may not manage this Project's grant versions")
	ErrNotFound        = errors.New("the Product, Entitlement, or grant version was not found")
	// ErrInvalid is a request that is well-formed but not a permitted grant
	// change: a start that is not prospective, a paused-access override, an
	// unsupported purchase type.
	ErrInvalid = errors.New("the proposed grant version is not permitted")
	// ErrOverlap is a proposed interval that would overlap a recorded one.
	// Overlapping intervals make grant selection ambiguous, which turns a
	// customer's access into a function of row order.
	ErrOverlap = errors.New("the proposed interval overlaps a recorded grant version")
	// ErrNotAdditiveSuperset is a retroactive change that would remove or narrow
	// access. Retroactive change is the one operation that can take access from
	// a customer who did nothing wrong, so the only retroactive shape accepted
	// is the one that cannot.
	ErrNotAdditiveSuperset = errors.New("a retroactive grant version must be an additive superset")
	// ErrImmutable is an attempt to edit a published version in place.
	ErrImmutable = errors.New("a published grant version cannot be edited")
	// ErrConflict is a lost race: another publish for the same pair committed
	// while this one was being validated.
	ErrConflict        = errors.New("the pair's grant history changed underneath this publish")
	ErrBillingDisabled = errors.New("Mosaic Billing is not enabled for this Project")
	ErrUnavailable     = errors.New("grant versions could not be read")
)
