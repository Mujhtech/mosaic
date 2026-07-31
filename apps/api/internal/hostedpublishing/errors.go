package hostedpublishing

import (
	"errors"
	"fmt"
	"time"
)

var (
	ErrUnauthenticated         = errors.New("unauthenticated")
	ErrForbidden               = errors.New("forbidden")
	ErrNotFound                = errors.New("not found")
	ErrConflict                = errors.New("conflict")
	ErrArchived                = errors.New("resource archived")
	ErrPreconditionRequired    = errors.New("precondition required")
	ErrDraftRevisionConflict   = errors.New("draft revision conflict")
	ErrIdempotencyConflict     = errors.New("idempotency conflict")
	ErrValidationFailed        = errors.New("validation failed")
	ErrProductInvalid          = errors.New("product invalid")
	ErrPlacementUnpublished    = errors.New("placement has no published paywall")
	ErrAssetStorageUnavailable = errors.New("hosted asset storage unavailable")
	ErrAssetInvalid            = errors.New("asset is invalid")
	ErrAssetNotReady           = errors.New("asset is not ready")
	ErrAssetReferenced         = errors.New("asset is referenced")
	ErrAssetStorage            = errors.New("asset storage operation failed")
	ErrNoCurrentRelease        = errors.New("no current release")
	ErrUnsupportedCapability   = errors.New("unsupported capability")
)

type ConflictError struct {
	Revision  int64
	ETag      string
	UpdatedAt time.Time
	ActorID   string
}

func (e *ConflictError) Error() string { return "draft revision is stale" }
func (e *ConflictError) Unwrap() error { return ErrDraftRevisionConflict }

type ValidationError struct {
	Errors []string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("document validation failed: %v", e.Errors)
}
func (e *ValidationError) Unwrap() error { return ErrValidationFailed }
