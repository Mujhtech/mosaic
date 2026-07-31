package billingmigration

import (
	"context"
	"errors"
	"fmt"
)

var (
	ErrInvalid                    = errors.New("invalid billing migration request")
	ErrUnauthenticated            = errors.New("billing migration authentication required")
	ErrForbidden                  = errors.New("billing migration capability denied")
	ErrNotFound                   = errors.New("billing migration resource not found")
	ErrConflict                   = errors.New("billing migration state conflict")
	ErrUnavailable                = errors.New("billing migration dependency unavailable")
	ErrValidationPending          = errors.New("billing migration provider validation is pending")
	ErrStaleCheckpoint            = fmt.Errorf("stale migration checkpoint: %w", ErrConflict)
	ErrStaleAuthority             = fmt.Errorf("stale migration authority: %w", ErrConflict)
	ErrStaleRollbackPrerequisites = fmt.Errorf("stale rollback prerequisites: %w", ErrConflict)
	ErrIdempotencyConflict        = fmt.Errorf("billing migration idempotency conflict: %w", ErrConflict)
	ErrStaleState                 = fmt.Errorf("stale billing migration state: %w", ErrConflict)
	ErrStaleDigest                = fmt.Errorf("stale billing migration digest: %w", ErrConflict)
	ErrExpiredApproval            = fmt.Errorf("expired billing migration approval: %w", ErrConflict)
	ErrAuthorityEpoch             = fmt.Errorf("billing migration authority epoch conflict: %w", ErrConflict)
	ErrPointerCoverage            = fmt.Errorf("billing migration pointer coverage conflict: %w", ErrConflict)
	ErrRollbackWindow             = fmt.Errorf("billing migration rollback window closed: %w", ErrConflict)
	ErrRollbackPrerequisite       = fmt.Errorf("billing migration rollback prerequisite failed: %w", ErrConflict)
	ErrConcurrentTransition       = fmt.Errorf("concurrent billing migration transition: %w", ErrConflict)
)

type Repository interface {
	Authorize(ctx context.Context, actor Actor, projectID, capability string) (Authorization, error)
	Idempotency(ctx context.Context, projectID, key string) (StoredIdempotency, error)
	CreateProgram(ctx context.Context, command CreateProgramCommand) (ProgramDetail, error)
	ListPrograms(ctx context.Context, projectID string, limit int) ([]ProgramDetail, error)
	Program(ctx context.Context, projectID, programID string) (ProgramDetail, error)
}

type OperatorCapabilityRepository interface {
	AllowedCapabilities(ctx context.Context, actor Actor, projectID string) ([]string, error)
}

type CapabilityAssessmentRepository interface {
	AppendCapabilityAssessment(ctx context.Context, command CapabilityAssessmentAppend) (CapabilityAssessment, bool, error)
}

// RevenueCatAssessor performs read-only provider checks before persistence.
// Implementations must not retain or log Credential.
type RevenueCatAssessor interface {
	AssessMigration(ctx context.Context, externalProjectID string, credential []byte) (CapabilityResult, error)
}
