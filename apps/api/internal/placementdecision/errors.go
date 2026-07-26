package placementdecision

import (
	"errors"
	"time"
)

var (
	ErrUnauthenticated      = errors.New("unauthenticated")
	ErrForbidden            = errors.New("forbidden")
	ErrNotFound             = errors.New("not found")
	ErrConflict             = errors.New("conflict")
	ErrArchived             = errors.New("archived")
	ErrPreconditionRequired = errors.New("precondition required")
	ErrRevisionConflict     = errors.New("revision conflict")
	ErrIdempotencyConflict  = errors.New("idempotency conflict")
	ErrValidation           = errors.New("validation failed")
	ErrProductionOverride   = errors.New("production override forbidden")
)

type ConflictError struct {
	Revision  int64
	ETag      string
	UpdatedAt time.Time
	ActorID   string
}

func (e *ConflictError) Error() string { return "rule set Draft has a newer revision" }
func (e *ConflictError) Unwrap() error { return ErrRevisionConflict }

type ValidationError struct{ Result ValidationResult }

func (e *ValidationError) Error() string { return "placement decision validation failed" }
func (e *ValidationError) Unwrap() error { return ErrValidation }
