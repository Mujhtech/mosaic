package billingmigrationrepair

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

const applicationUserAliasPrefix = "application_user_id:"

type RepairStore interface {
	ProgramProject(ctx context.Context, programID string) (string, error)
	ProviderReference(ctx context.Context, programID, sourceRecordID string) (ProviderReferenceEvidence, error)
	QuarantinedSourceReference(ctx context.Context, programID, sourceRecordID string) (ProviderReferenceEvidence, error)
	MappingReplacement(ctx context.Context, programID, mappingSetID string) (MappingReplacementEvidence, error)
	ProvenAlias(ctx context.Context, programID, mappingEntryID string) (ProvenAliasEvidence, error)
	ActiveApplicationAliasCustomer(ctx context.Context, projectID string, digest []byte) (string, error)
	AttachApplicationAlias(ctx context.Context, executionID string, evidence ProvenAliasEvidence, digest []byte) ([]byte, error)
}

type ProviderReferenceEvidence struct {
	ProjectID string
	Reference billingmigration.KnownProviderReference
	Digest    []byte
}

type MappingReplacementEvidence struct {
	ProjectID        string
	CurrentMappingID string
	NextMappingID    string
	BeforeDigest     []byte
	AfterDigest      []byte
	AffectedCount    int
}

type ProvenAliasEvidence struct {
	ProjectID, MappingEntryID, BillingCustomerID, ApplicationUserID string
	Digest                                                          []byte
}

type ProviderEvidenceImporter interface {
	RevalidateKnownReferences(ctx context.Context, projectID, programID string, references []billingmigration.KnownProviderReference) (billingmigration.ProviderEvidenceResult, error)
}

type ProjectionReplayer interface {
	RunReplay(ctx context.Context, keys billingprojection.ReplayScopeKeys, replay billingprojection.Replay, scope billingprojection.ReplayScope, limit int) ([]billingprojection.ReplayResult, error)
}

type Production struct {
	Store      RepairStore
	Provider   ProviderEvidenceImporter
	Projection ProjectionReplayer
	ReplayKeys billingprojection.ReplayScopeKeys
}

func NewProductionExecutor(store RepairStore, provider ProviderEvidenceImporter, projection ProjectionReplayer, keys billingprojection.ReplayScopeKeys) Executor {
	production := &Production{
		Store: store, Provider: provider, Projection: projection, ReplayKeys: keys,
	}
	return Executor{
		Previewer:  production,
		Provider:   production,
		Facts:      production,
		Aliases:    production,
		Mappings:   production,
		Quarantine: production,
	}
}

func (p *Production) PreviewRepair(ctx context.Context, request billingmigration.RepairRequest) (billingmigration.RepairImpact, error) {
	command, err := validatedCommand(request, false)
	if err != nil {
		return billingmigration.RepairImpact{}, err
	}
	if p == nil || p.Store == nil {
		return billingmigration.RepairImpact{}, billingmigration.ErrUnavailable
	}
	switch request.Kind {
	case billingmigration.RepairRevalidateProviderReference:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairImpact{}, err
		}
		evidence, err := p.Store.ProviderReference(ctx, command.ProgramID, command.References[0])
		if err != nil {
			return billingmigration.RepairImpact{}, repairErr(err)
		}
		return billingmigration.RepairImpact{AffectedCount: 1, BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest}, nil
	case billingmigration.RepairReplayFactRange:
		before, err := p.factReplayDigest(ctx, command.References)
		if err != nil {
			return billingmigration.RepairImpact{}, err
		}
		return billingmigration.RepairImpact{AffectedCount: len(command.References), BeforeDigest: before, AfterDigest: before}, nil
	case billingmigration.RepairAttachProvenAlias:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairImpact{}, err
		}
		evidence, err := p.Store.ProvenAlias(ctx, command.ProgramID, command.References[0])
		if err != nil {
			return billingmigration.RepairImpact{}, repairErr(err)
		}
		return billingmigration.RepairImpact{AffectedCount: 1, BeforeDigest: evidence.Digest, AfterDigest: hashDigest("mosaic-migration-repair-alias-preview-v1", evidence.Digest)}, nil
	case billingmigration.RepairReplaceMappingSet:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairImpact{}, err
		}
		evidence, err := p.Store.MappingReplacement(ctx, command.ProgramID, command.References[0])
		if err != nil {
			return billingmigration.RepairImpact{}, repairErr(err)
		}
		return billingmigration.RepairImpact{AffectedCount: evidence.AffectedCount, BeforeDigest: evidence.BeforeDigest, AfterDigest: evidence.AfterDigest}, nil
	case billingmigration.RepairRetryQuarantinedRecord:
		if err := requireSingleReference(command); err != nil {
			return billingmigration.RepairImpact{}, err
		}
		evidence, err := p.Store.QuarantinedSourceReference(ctx, command.ProgramID, command.References[0])
		if err != nil {
			return billingmigration.RepairImpact{}, repairErr(err)
		}
		return billingmigration.RepairImpact{AffectedCount: 1, BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest}, nil
	default:
		return billingmigration.RepairImpact{}, fmt.Errorf("unsupported repair kind: %w", billingmigration.ErrInvalid)
	}
}

func (p *Production) RevalidateProviderReference(ctx context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	if p == nil || p.Store == nil || p.Provider == nil {
		return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
	}
	evidence, err := p.Store.ProviderReference(ctx, command.ProgramID, command.References[0])
	if err != nil {
		return billingmigration.RepairResult{}, repairErr(err)
	}
	return p.revalidate(ctx, command.ProgramID, evidence, "provider_validation_pending")
}

func (p *Production) RetryQuarantinedRecord(ctx context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	if p == nil || p.Store == nil || p.Provider == nil {
		return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
	}
	evidence, err := p.Store.QuarantinedSourceReference(ctx, command.ProgramID, command.References[0])
	if err != nil {
		return billingmigration.RepairResult{}, repairErr(err)
	}
	return p.revalidate(ctx, command.ProgramID, evidence, "source_record_validation_pending")
}

func (p *Production) revalidate(ctx context.Context, programID string, evidence ProviderReferenceEvidence, pendingCode string) (billingmigration.RepairResult, error) {
	result, err := p.Provider.RevalidateKnownReferences(ctx, evidence.ProjectID, programID, []billingmigration.KnownProviderReference{evidence.Reference})
	repair := billingmigration.RepairResult{BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest}
	if errors.Is(err, billingmigration.ErrValidationPending) {
		repair.ErrorCode = pendingCode
		return repair, err
	}
	if err != nil {
		repair.ErrorCode = "provider_revalidation_failed"
		return repair, repairErr(err)
	}
	if result.Validated+result.Quarantined != 1 || result.Accepted != 0 || len(result.EvidenceDigest) != sha256DigestBytes {
		repair.ErrorCode = "provider_revalidation_not_terminal"
		return repair, billingmigration.ErrUnavailable
	}
	repair.AfterDigest = result.EvidenceDigest
	return repair, nil
}

func (p *Production) ReplayImmutableFactRange(ctx context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	if p == nil || p.Store == nil || p.Projection == nil || p.ReplayKeys == nil {
		return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
	}
	before, err := p.factReplayDigest(ctx, command.References)
	if err != nil {
		return billingmigration.RepairResult{}, err
	}
	scopeKeys := make([]string, 0, len(command.References))
	for _, reference := range command.References {
		scope, err := p.replayScope(ctx, command.ProgramID, reference)
		if err != nil {
			return billingmigration.RepairResult{BeforeDigest: before, AfterDigest: before, ErrorCode: "unsupported_fact_replay_scope"}, err
		}
		results, replayErr := p.Projection.RunReplay(ctx, p.ReplayKeys, billingprojection.Replay{}, scope, 100)
		if replayErr != nil {
			return billingmigration.RepairResult{BeforeDigest: before, AfterDigest: before, ErrorCode: "fact_replay_failed"}, repairErr(replayErr)
		}
		for _, result := range results {
			scopeKeys = append(scopeKeys, result.ScopeKey)
		}
	}
	sort.Strings(scopeKeys)
	after := hashStrings("mosaic-migration-repair-fact-replay-terminal-v1", append([]string{command.ExecutionID}, scopeKeys...)...)
	return billingmigration.RepairResult{BeforeDigest: before, AfterDigest: after}, nil
}

func (p *Production) AttachProvenAlias(ctx context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	if p == nil || p.Store == nil {
		return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
	}
	evidence, err := p.Store.ProvenAlias(ctx, command.ProgramID, command.References[0])
	if err != nil {
		return billingmigration.RepairResult{}, repairErr(err)
	}
	digest := billing.AliasDigest(billingcustomer.AliasApplicationUser, evidence.ApplicationUserID)
	after, err := p.Store.AttachApplicationAlias(ctx, command.ExecutionID, evidence, digest)
	if err == nil {
		return billingmigration.RepairResult{BeforeDigest: evidence.Digest, AfterDigest: after}, nil
	}
	activeCustomer, lookupErr := p.Store.ActiveApplicationAliasCustomer(ctx, evidence.ProjectID, digest)
	if lookupErr != nil {
		return billingmigration.RepairResult{BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest, ErrorCode: "alias_lookup_failed"}, repairErr(lookupErr)
	}
	if activeCustomer == evidence.BillingCustomerID {
		return billingmigration.RepairResult{BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest}, nil
	}
	if activeCustomer != "" {
		return billingmigration.RepairResult{BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest, ErrorCode: "alias_resolves_elsewhere"}, billingmigration.ErrRollbackPrerequisite
	}
	return billingmigration.RepairResult{BeforeDigest: evidence.Digest, AfterDigest: evidence.Digest, ErrorCode: "alias_attach_failed"}, repairErr(err)
}

func (p *Production) ReplaceMappingSetAndInvalidate(ctx context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	if p == nil || p.Store == nil {
		return billingmigration.RepairResult{}, billingmigration.ErrUnavailable
	}
	evidence, err := p.Store.MappingReplacement(ctx, command.ProgramID, command.References[0])
	if err != nil {
		return billingmigration.RepairResult{}, repairErr(err)
	}
	if string(evidence.BeforeDigest) == string(evidence.AfterDigest) {
		return billingmigration.RepairResult{BeforeDigest: evidence.BeforeDigest, AfterDigest: evidence.AfterDigest}, nil
	}
	return billingmigration.RepairResult{BeforeDigest: evidence.BeforeDigest, AfterDigest: evidence.AfterDigest}, nil
}

func (p *Production) factReplayDigest(ctx context.Context, references []string) ([]byte, error) {
	if len(references) == 0 || len(references) > maxRepairScopeReferences {
		return nil, billingmigration.ErrInvalid
	}
	return hashStrings("mosaic-migration-repair-fact-replay-preview-v1", references...), nil
}

func (p *Production) replayScope(ctx context.Context, programID, reference string) (billingprojection.ReplayScope, error) {
	projectID, err := p.Store.ProgramProject(ctx, programID)
	if err != nil {
		return billingprojection.ReplayScope{}, repairErr(err)
	}
	switch {
	case strings.HasPrefix(reference, "customer:"):
		id := strings.TrimPrefix(reference, "customer:")
		if id == "" {
			return billingprojection.ReplayScope{}, billingmigration.ErrInvalid
		}
		return billingprojection.ReplayScope{ProjectID: projectID, CustomerID: id}, nil
	case strings.HasPrefix(reference, "subscription:"):
		id := strings.TrimPrefix(reference, "subscription:")
		if id == "" {
			return billingprojection.ReplayScope{}, billingmigration.ErrInvalid
		}
		return billingprojection.ReplayScope{ProjectID: projectID, SubscriptionInstanceID: id}, nil
	case strings.HasPrefix(reference, "project_window:"):
		payload := strings.TrimPrefix(reference, "project_window:")
		parts := strings.Split(payload, ",")
		if len(parts) != 2 {
			return billingprojection.ReplayScope{}, billingmigration.ErrInvalid
		}
		start, startErr := time.Parse(time.RFC3339Nano, parts[0])
		end, endErr := time.Parse(time.RFC3339Nano, parts[1])
		if startErr != nil || endErr != nil || !end.After(start) {
			return billingprojection.ReplayScope{}, billingmigration.ErrInvalid
		}
		return billingprojection.ReplayScope{ProjectID: projectID, WindowStart: &start, WindowEnd: &end}, nil
	default:
		return billingprojection.ReplayScope{}, billingmigration.ErrUnavailable
	}
}

func repairErr(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, billingmigration.ErrInvalid), errors.Is(err, billing.ErrInvalid):
		return billingmigration.ErrInvalid
	case errors.Is(err, billingmigration.ErrNotFound), errors.Is(err, billing.ErrNotFound):
		return billingmigration.ErrNotFound
	case errors.Is(err, billingmigration.ErrConflict), errors.Is(err, billing.ErrConflict):
		return billingmigration.ErrRollbackPrerequisite
	case errors.Is(err, billingmigration.ErrValidationPending):
		return err
	default:
		return billingmigration.ErrUnavailable
	}
}

func hashDigest(domain string, digest []byte) []byte {
	h := sha256.New()
	_, _ = h.Write([]byte(domain))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write(digest)
	return h.Sum(nil)
}

func hashStrings(domain string, values ...string) []byte {
	h := sha256.New()
	_, _ = h.Write([]byte(domain))
	for _, value := range values {
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(value))
	}
	return h.Sum(nil)
}

func deterministicID(prefix string, values ...string) string {
	sum := hashStrings("mosaic-id", values...)
	return prefix + "_" + hex.EncodeToString(sum[:12])
}
