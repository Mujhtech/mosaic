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
	ErrProviderReadiness       = errors.New("provider readiness unavailable")
	ErrPlacementUnpublished    = errors.New("placement has no published paywall")
	ErrAssetStorageUnavailable = errors.New("hosted asset storage unavailable")
	ErrAssetInvalid            = errors.New("asset is invalid")
	ErrAssetNotReady           = errors.New("asset is not ready")
	ErrAssetReferenced         = errors.New("asset is referenced")
	ErrAssetStorage            = errors.New("asset storage operation failed")
	// ErrAssetObjectMissing means the Asset row exists but its immutable bytes
	// are absent from object storage -- the state a failed or partial restore
	// leaves behind. It is a 404, not a 500: the request named something that
	// is not there, and an SDK must be able to tell that from "Mosaic is
	// broken" so it can fall back to its bundled Asset.
	ErrAssetObjectMissing    = errors.New("asset object is missing from storage")
	ErrNoCurrentRelease      = errors.New("no current release")
	ErrUnsupportedCapability = errors.New("unsupported capability")
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

type ProviderReadinessError struct {
	Blockers []ProviderPublicationIssue
}

func (e *ProviderReadinessError) Error() string {
	return fmt.Sprintf("provider readiness unavailable: %v", e.Blockers)
}
func (e *ProviderReadinessError) Unwrap() error { return ErrProviderReadiness }
