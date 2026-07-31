// Package billingmigrationrepair exposes only the five Phase 9C repair seams.
// It deliberately has no generic SQL, fact mutation, snapshot mutation, or
// authority-pointer mutation escape hatch.
package billingmigrationrepair

import (
	"context"
	"fmt"
	"unicode/utf8"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

const (
	maxRepairScopeReferences = 100
	maxRepairAffectedCount   = 1000
	sha256DigestBytes        = 32
)

// RepairCommand is the fully validated command passed to the concrete repair
// seam. It carries the immutable case/execution context required for audit.
type RepairCommand struct {
	ExecutionID string
	ProgramID   string
	CaseID      string
	References  []string
}

type ProviderRevalidator interface {
	RevalidateProviderReference(context.Context, RepairCommand) (billingmigration.RepairResult, error)
}
type FactRangeReplayer interface {
	ReplayImmutableFactRange(context.Context, RepairCommand) (billingmigration.RepairResult, error)
}
type ProvenAliasAttacher interface {
	AttachProvenAlias(context.Context, RepairCommand) (billingmigration.RepairResult, error)
}
type MappingSetReplacer interface {
	ReplaceMappingSetAndInvalidate(context.Context, RepairCommand) (billingmigration.RepairResult, error)
}
type QuarantinedRecordRetrier interface {
	RetryQuarantinedRecord(context.Context, RepairCommand) (billingmigration.RepairResult, error)
}
type ImpactPreviewer interface {
	PreviewRepair(context.Context, billingmigration.RepairRequest) (billingmigration.RepairImpact, error)
}

type Executor struct {
	Previewer  ImpactPreviewer
	Provider   ProviderRevalidator
	Facts      FactRangeReplayer
	Aliases    ProvenAliasAttacher
	Mappings   MappingSetReplacer
	Quarantine QuarantinedRecordRetrier
}

var _ billingmigration.RepairExecutor = Executor{}

func (e Executor) Preview(ctx context.Context, request billingmigration.RepairRequest) (billingmigration.RepairImpact, error) {
	if _, err := validatedCommand(request, false); err != nil {
		return billingmigration.RepairImpact{}, err
	}
	if e.Previewer == nil {
		return billingmigration.RepairImpact{}, billingmigration.ErrUnavailable
	}
	impact, err := e.Previewer.PreviewRepair(ctx, request)
	if err != nil {
		return billingmigration.RepairImpact{}, err
	}
	if err := validateImpact(impact); err != nil {
		return billingmigration.RepairImpact{}, err
	}
	return impact, nil
}

func (e Executor) Execute(ctx context.Context, request billingmigration.RepairRequest) (billingmigration.RepairResult, error) {
	command, err := validatedCommand(request, true)
	if err != nil {
		return billingmigration.RepairResult{}, err
	}
	switch request.Kind {
	case billingmigration.RepairRevalidateProviderReference:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairResult{}, err
		}
		if e.Provider == nil {
			return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
		}
		return validatedResult(e.Provider.RevalidateProviderReference(ctx, command))
	case billingmigration.RepairReplayFactRange:
		if e.Facts == nil {
			return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
		}
		return validatedResult(e.Facts.ReplayImmutableFactRange(ctx, command))
	case billingmigration.RepairAttachProvenAlias:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairResult{}, err
		}
		if e.Aliases == nil {
			return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
		}
		return validatedResult(e.Aliases.AttachProvenAlias(ctx, command))
	case billingmigration.RepairReplaceMappingSet:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairResult{}, err
		}
		if e.Mappings == nil {
			return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
		}
		return validatedResult(e.Mappings.ReplaceMappingSetAndInvalidate(ctx, command))
	case billingmigration.RepairRetryQuarantinedRecord:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairResult{}, err
		}
		if e.Quarantine == nil {
			return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
		}
		return validatedResult(e.Quarantine.RetryQuarantinedRecord(ctx, command))
	default:
		return billingmigration.RepairResult{}, fmt.Errorf("unsupported repair kind: %w", billingmigration.ErrInvalid)
	}
}

func validatedCommand(request billingmigration.RepairRequest, requireExecutionID bool) (RepairCommand, error) {
	if !validIdentifier(request.ProgramID) || !validIdentifier(request.CaseID) {
		return RepairCommand{}, billingmigration.ErrInvalid
	}
	if requireExecutionID && !validIdentifier(request.ExecutionID) {
		return RepairCommand{}, billingmigration.ErrInvalid
	}
	if len(request.ScopeReferences) == 0 || len(request.ScopeReferences) > maxRepairScopeReferences {
		return RepairCommand{}, billingmigration.ErrInvalid
	}
	seen := make(map[string]struct{}, len(request.ScopeReferences))
	references := make([]string, len(request.ScopeReferences))
	for i, reference := range request.ScopeReferences {
		if !validReference(reference) {
			return RepairCommand{}, billingmigration.ErrInvalid
		}
		if _, exists := seen[reference]; exists {
			return RepairCommand{}, billingmigration.ErrInvalid
		}
		seen[reference] = struct{}{}
		references[i] = reference
	}
	return RepairCommand{
		ExecutionID: request.ExecutionID,
		ProgramID:   request.ProgramID,
		CaseID:      request.CaseID,
		References:  references,
	}, nil
}

func requireSingleReference(command RepairCommand) error {
	if len(command.References) != 1 {
		return billingmigration.ErrInvalid
	}
	return nil
}

func validatedResult(result billingmigration.RepairResult, err error) (billingmigration.RepairResult, error) {
	if err != nil {
		return result, err
	}
	if !validDigest(result.BeforeDigest) || !validDigest(result.AfterDigest) {
		return billingmigration.RepairResult{}, billingmigration.ErrInvalid
	}
	for _, invalidation := range result.Invalidations {
		if !validReference(invalidation.Kind) || !validReference(invalidation.ReferenceID) || !validDigest(invalidation.Digest) {
			return billingmigration.RepairResult{}, billingmigration.ErrInvalid
		}
	}
	return result, nil
}

func validateImpact(impact billingmigration.RepairImpact) error {
	if impact.AffectedCount < 0 || impact.AffectedCount > maxRepairAffectedCount {
		return billingmigration.ErrInvalid
	}
	if !validDigest(impact.BeforeDigest) || !validDigest(impact.AfterDigest) {
		return billingmigration.ErrInvalid
	}
	return nil
}

func validDigest(digest []byte) bool {
	return len(digest) == sha256DigestBytes
}

func validIdentifier(value string) bool {
	return value != "" && len(value) <= 128 && utf8.ValidString(value) && !containsControl(value)
}

func validReference(value string) bool {
	return value != "" && len(value) <= 512 && utf8.ValidString(value) && !containsControl(value)
}

func containsControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}
