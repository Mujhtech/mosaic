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
