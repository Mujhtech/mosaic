package billingrestore

import "errors"

// Stable domain errors. Transport maps these in one place and nothing compares
// an error message string.
var (
	// ErrBillingDisabled is a service state, never a statement about a customer.
	// A Project that turned billing off has not told Mosaic its customers lost
	// access — it has told Mosaic to stop answering.
	ErrBillingDisabled = errors.New("billing is not enabled for this Project")
	ErrUnauthenticated = errors.New("the request could not be authenticated")
	ErrNotFound        = errors.New("the requested restore was not found")
	ErrInvalid         = errors.New("the request is not valid")
	ErrUnavailable     = errors.New("restore state could not be read")

	// ErrUnprovenRestore is the refusal at the heart of this package: a
	// `restored` outcome was assembled without the accepted snapshot version
	// that demonstrates it. It is never returned to a caller — it is a
	// programming error caught before a row is written.
	ErrUnprovenRestore = errors.New("restored requires the accepted snapshot version that demonstrates it")
	// ErrInvalidOutcome is an outcome paired with an uncertainty reason the
	// contract and the schema do not allow together.
	ErrInvalidOutcome = errors.New("the restore outcome and uncertainty reason are not a valid pairing")
)
