package experiment

import "errors"

var (
	ErrUnauthenticated      = errors.New("unauthenticated")
	ErrForbidden            = errors.New("forbidden")
	ErrNotFound             = errors.New("not found")
	ErrConflict             = errors.New("conflict")
	ErrInvalid              = errors.New("invalid experiment")
	ErrPreconditionRequired = errors.New("precondition required")
	ErrIdempotencyConflict  = errors.New("idempotency conflict")
	ErrMappingProtected     = errors.New("active experiment mapping protected")
)

type ConflictError struct {
	Revision int64
	ETag     string
}

func (e *ConflictError) Error() string { return "experiment draft revision conflict" }

type ValidationError struct{ Result ValidationResult }

func (e *ValidationError) Error() string { return "experiment validation failed" }

// ErrPlacementDecisionRequired means the Environment's current Configuration
// Release carries no Placement Decision (Delivery v2) representation, so no
// Delivery v3 Release can be produced from it. An Experiment cannot be
// published until a Placement rule set has been published in that Environment.
// It has its own code because it is a prerequisite an operator can act on, not
// a malformed request.
var ErrPlacementDecisionRequired = errors.New("environment has no Placement Decision release")

// InvalidError names why an Experiment request was rejected.
//
// Fifteen distinct publish preconditions all returned a bare ErrInvalid, so the
// API answered every one of them with `422 experiment_invalid` and no detail,
// in the response or in any log line. An operator or Studio user had no path
// from the refusal to the cause. Reason is a stable machine-readable code drawn
// from a closed vocabulary; it never carries tenant data or SQL.
type InvalidError struct {
	Reason string
}

func (e *InvalidError) Error() string { return "experiment invalid: " + e.Reason }

// Unwrap keeps errors.Is(err, ErrInvalid) true for every existing caller.
func (e *InvalidError) Unwrap() error { return ErrInvalid }

// Invalid builds a rejection carrying its reason.
func Invalid(reason string) error { return &InvalidError{Reason: reason} }

// InvalidReason extracts the reason from an error, if it carries one.
func InvalidReason(err error) (string, bool) {
	var invalid *InvalidError
	if errors.As(err, &invalid) {
		return invalid.Reason, true
	}
	return "", false
}
