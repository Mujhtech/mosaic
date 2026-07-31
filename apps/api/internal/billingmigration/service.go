package billingmigration

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

const migrationCredentialClass = "revenuecat_migration_api_key"

type Service struct {
	repository Repository
	evidence   EvidenceRepository
	cutover    CutoverRepository
	cipher     providercredential.SubjectCipher
	assessor   RevenueCatAssessor
	now        func() time.Time
	random     io.Reader
	tracer     trace.Tracer
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	return func(service *Service) {
		if now != nil {
			service.now = now
		}
	}
}

func WithRandom(random io.Reader) Option {
	return func(service *Service) {
		if random != nil {
			service.random = random
		}
	}
}

func NewService(repository Repository, cipher providercredential.SubjectCipher, assessor RevenueCatAssessor, options ...Option) *Service {
	service := &Service{
		repository: repository,
		cipher:     cipher,
		assessor:   assessor,
		now:        func() time.Time { return time.Now().UTC() },
		random:     rand.Reader,
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingmigration"),
	}
	service.evidence, _ = repository.(EvidenceRepository)
	service.cutover, _ = repository.(CutoverRepository)
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) PromoteReady(ctx context.Context, actor Actor, input PromoteReadyInput) (AuthoritativeReadiness, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.ExpectedStateVersion < 1 {
		return AuthoritativeReadiness{}, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityAssessReadiness); err != nil {
		return AuthoritativeReadiness{}, err
	}
	return s.cutover.PromoteReady(ctx, input.ProjectID, input.ProgramID, input.ExpectedStateVersion, actor.ID, s.now())
}

func (s *Service) ProposeCutover(ctx context.Context, actor Actor, input ProposeCutoverInput) (CutoverProposal, bool, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.Command != "cutover" || input.ExpectedStateVersion < 1 || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || !validText(input.Reason, 500) {
		return CutoverProposal{}, false, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityProposeCutover); err != nil {
		return CutoverProposal{}, false, err
	}
	digests, err := input.ExpectedDigests.Parse()
	if err != nil {
		return CutoverProposal{}, false, err
	}
	now := s.now()
	if !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(24*time.Hour)) {
		return CutoverProposal{}, false, ErrInvalid
	}
	id, err := s.newID("mcp")
	if err != nil {
		return CutoverProposal{}, false, ErrUnavailable
	}
	proposal := CutoverProposal{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, ProposalID: id, Command: input.Command, ProposerActorID: actor.ID, Reason: input.Reason, Digests: input.ExpectedDigests, Status: "pending", ProposedAt: now, ExpiresAt: input.ExpiresAt.UTC()}
	proposalRaw := digest(struct {
		ProgramID, Command, Proposer, Reason string
		StateVersion                         int64
		Digests                              PreApprovalDigests
		ExpiresAt                            time.Time
	}{input.ProgramID, input.Command, actor.ID, input.Reason, input.ExpectedStateVersion, input.ExpectedDigests, proposal.ExpiresAt})
	proposal.ProposalDigest = FormatDigest(proposalRaw)
	return s.cutover.CreateProposal(ctx, ProposalWrite{Proposal: proposal, ProjectID: input.ProjectID, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), Digests: digests, ProposalDigest: proposalRaw})
}

func (s *Service) ProposeRollback(ctx context.Context, actor Actor, input ProposeRollbackInput) (CutoverProposal, bool, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.CheckpointID == "" || input.ExpectedStateVersion < 1 || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 || !validText(input.Reason, 500) {
		return CutoverProposal{}, false, ErrInvalid
	}
	for _, value := range []string{input.ExpectedCheckpointDigest, input.ExpectedAuthorityDigest, input.ExpectedRollbackPrerequisitesDigest} {
		if _, err := ParseDigest(value); err != nil {
			return CutoverProposal{}, false, ErrInvalid
		}
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityProposeCutover); err != nil {
		return CutoverProposal{}, false, err
	}
	now := s.now()
	if !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(24*time.Hour)) {
		return CutoverProposal{}, false, ErrInvalid
	}
	id, err := s.newID("mcp")
	if err != nil {
		return CutoverProposal{}, false, ErrUnavailable
	}
	proposal := CutoverProposal{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, ProposalID: id, Command: "rollback", ProposerActorID: actor.ID, Reason: input.Reason, Status: "pending", ProposedAt: now, ExpiresAt: input.ExpiresAt.UTC()}
	raw := digest(input)
	proposal.ProposalDigest = FormatDigest(raw)
	expected := &RollbackExpectedBinding{CheckpointID: input.CheckpointID, CheckpointDigest: input.ExpectedCheckpointDigest, AuthorityDigest: input.ExpectedAuthorityDigest, RollbackPrerequisitesDigest: input.ExpectedRollbackPrerequisitesDigest}
	return s.cutover.CreateProposal(ctx, ProposalWrite{Proposal: proposal, ProjectID: input.ProjectID, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), ProposalDigest: raw, ExpectedRollback: expected})
}

func (s *Service) ApproveCutover(ctx context.Context, actor Actor, input ApproveCutoverInput) (MigrationApproval, bool, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.ProposalID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 {
		return MigrationApproval{}, false, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityApproveCutover); err != nil {
		return MigrationApproval{}, false, err
	}
	proposal, err := s.cutover.Proposal(ctx, input.ProjectID, input.ProgramID, input.ProposalID)
	if err != nil {
		return MigrationApproval{}, false, err
	}
	if proposal.StateVersion != input.ExpectedStateVersion {
		return MigrationApproval{}, false, ErrConflict
	}
	now := s.now()
	id, err := s.newID("map")
	if err != nil {
		return MigrationApproval{}, false, ErrUnavailable
	}
	approval := MigrationApproval{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, ApprovalID: id, Command: proposal.Command, ProposerActorID: proposal.ProposerActorID, ApproverActorID: actor.ID, ApprovedAt: now, ExpiresAt: proposal.ExpiresAt}
	raw := digest(struct {
		Approval        MigrationApproval
		ProposalID      string
		Digests         PreApprovalDigests
		RollbackBinding *RollbackProposalBinding
	}{approval, proposal.ProposalID, proposal.Digests, proposal.RollbackBinding})
	approval.ApprovalDigest = FormatDigest(raw)
	return s.cutover.ApproveProposal(ctx, ApprovalWrite{Approval: approval, ProjectID: input.ProjectID, ProposalID: input.ProposalID, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), ApprovalDigest: raw})
}

func (s *Service) CreateCheckpoint(ctx context.Context, actor Actor, input CreateCheckpointInput) (MigrationCheckpoint, bool, error) {
	if s.cutover == nil || input.ProjectID == "" || input.ProgramID == "" || input.ApprovalID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 {
		return MigrationCheckpoint{}, false, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityApproveCutover); err != nil {
		return MigrationCheckpoint{}, false, err
	}
	digests, err := input.ExpectedDigests.Parse()
	if err != nil {
		return MigrationCheckpoint{}, false, err
	}
	approvalRaw, err := ParseDigest(input.ApprovalDigest)
	if err != nil {
		return MigrationCheckpoint{}, false, ErrInvalid
	}
	cohortRaw, err := ParseDigest(input.CohortDigest)
	if err != nil {
		return MigrationCheckpoint{}, false, ErrInvalid
	}
	id, err := s.newID("mck")
	if err != nil {
		return MigrationCheckpoint{}, false, ErrUnavailable
	}
	now := s.now()
	checkpoint := MigrationCheckpoint{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, CheckpointID: id, ManifestDigest: input.ExpectedDigests.Manifest, MappingDigest: input.ExpectedDigests.Mapping, PolicyDigest: input.ExpectedDigests.Policy, ReadinessDigest: input.ExpectedDigests.Readiness, CohortDigest: input.CohortDigest, CreatedAt: now}
	raw := digest(struct {
		Input CreateCheckpointInput
		ID    string
		At    time.Time
	}{input, id, now})
	checkpoint.CheckpointDigest = FormatDigest(raw)
	return s.cutover.CreateCheckpoint(ctx, CheckpointWrite{Checkpoint: checkpoint, ProjectID: input.ProjectID, ApprovalID: input.ApprovalID, IdempotencyKey: input.IdempotencyKey, RequestDigest: digest(input), Digests: digests, ApprovalDigest: approvalRaw, CheckpointDigest: raw, CohortDigest: cohortRaw})
}

func validText(value string, max int) bool {
	if strings.TrimSpace(value) == "" || len(value) > max {
		return false
	}
	for _, character := range value {
		if character <= 0x1f || character == 0x7f {
			return false
		}
	}
	return true
}

func (s *Service) ListManifests(ctx context.Context, actor Actor, projectID, programID string, limit int) ([]SourceManifest, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return nil, err
	}
	limit, err := boundedLimit(limit)
	if err != nil {
		return nil, err
	}
	return s.evidence.ListManifests(ctx, projectID, programID, limit)
}

func (s *Service) CreateMappingSet(ctx context.Context, actor Actor, input CreateMappingSetInput) (MappingSet, error) {
	if s.evidence == nil || input.ProjectID == "" || input.ProgramID == "" || input.ExpectedStateVersion < 1 || input.Version < 1 || len(input.Entries) == 0 || len(input.Entries) > 10000 {
		return MappingSet{}, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityManageMappings); err != nil {
		return MappingSet{}, err
	}
	entries := append([]MappingEntry(nil), input.Entries...)
	for _, e := range entries {
		if !validSourceIdentifier(e.SourceIdentifier) || e.TargetID == "" ||
			(e.SourceKind != "customer_id" && e.SourceKind != "original_customer_id" && e.SourceKind != "audited_alias" && e.SourceKind != "product" && e.SourceKind != "entitlement") ||
			(e.MatchKind != "exact" && e.MatchKind != "audited_alias") {
			return MappingSet{}, ErrInvalid
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].SourceKind == entries[j].SourceKind {
			return entries[i].SourceIdentifier < entries[j].SourceIdentifier
		}
		return entries[i].SourceKind < entries[j].SourceKind
	})
	id, err := s.newID("mms")
	if err != nil {
		return MappingSet{}, ErrUnavailable
	}
	raw := digest(entries)
	mapping := MappingSet{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, MappingSetID: id, Version: input.Version, Status: "draft", Entries: entries, MappingDigest: FormatDigest(raw)}
	err = s.evidence.CreateMappingSet(ctx, input.ExpectedStateVersion, MappingSetWrite{MappingSet: mapping, ProjectID: input.ProjectID, MappingDigest: raw, ActorID: actor.ID, CreatedAt: s.now()})
	return mapping, err
}

func (s *Service) FreezeMappingSet(ctx context.Context, actor Actor, projectID, programID, mappingSetID string, expected int64) error {
	if expected < 1 {
		return ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityManageMappings); err != nil {
		return err
	}
	return s.evidence.FreezeMappingSet(ctx, projectID, programID, mappingSetID, expected, s.now())
}
func (s *Service) ListMappingSets(ctx context.Context, actor Actor, projectID, programID string, limit int) ([]MappingSet, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return nil, err
	}
	limit, err := boundedLimit(limit)
	if err != nil {
		return nil, err
	}
	return s.evidence.ListMappingSets(ctx, projectID, programID, limit)
}

func (s *Service) CreateImportBatch(ctx context.Context, actor Actor, input CreateImportBatchInput) (ImportBatch, bool, error) {
	if input.ExpectedStateVersion < 1 || input.RecordCount < 0 || input.RecordCount > 1000 || input.ManifestID == "" || input.MappingSetID == "" || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 {
		return ImportBatch{}, false, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityRunImport); err != nil {
		return ImportBatch{}, false, err
	}
	id, err := s.newID("mib")
	if err != nil {
		return ImportBatch{}, false, ErrUnavailable
	}
	requestDigest := digest(input)
	batch := ImportBatch{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, BatchID: id, IdempotencyKey: input.IdempotencyKey, Status: "pending", RecordCount: input.RecordCount}
	replay, err := s.evidence.CreateImportBatch(ctx, input.ExpectedStateVersion, ImportBatchWrite{Batch: batch, ProjectID: input.ProjectID, ManifestID: input.ManifestID, MappingSetID: input.MappingSetID, RequestDigest: requestDigest, CursorBefore: input.CursorBefore, CreatedAt: s.now()})
	if replay && err == nil {
		item, readErr := s.evidence.ImportBatchByIdempotency(ctx, input.ProjectID, input.ProgramID, input.IdempotencyKey)
		return item, true, readErr
	}
	return batch, replay, err
}
func (s *Service) ListImportBatches(ctx context.Context, actor Actor, projectID, programID string, limit int) ([]ImportBatch, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return nil, err
	}
	limit, err := boundedLimit(limit)
	if err != nil {
		return nil, err
	}
	return s.evidence.ListImportBatches(ctx, projectID, programID, limit)
}
func (s *Service) ImportBatch(ctx context.Context, actor Actor, projectID, programID, batchID string) (ImportBatch, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return ImportBatch{}, err
	}
	return s.evidence.ImportBatch(ctx, projectID, programID, batchID)
}

func (s *Service) QueueRun(ctx context.Context, actor Actor, input QueueRunInput) (RunJob, bool, error) {
	if input.ExpectedStateVersion < 1 || (input.RunKind != "dry_run" && input.RunKind != "shadow") || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 {
		return RunJob{}, false, ErrInvalid
	}
	manifestDigest, err := ParseDigest(input.ManifestDigest)
	if err != nil {
		return RunJob{}, false, ErrInvalid
	}
	mappingDigest, err := ParseDigest(input.MappingDigest)
	if err != nil {
		return RunJob{}, false, ErrInvalid
	}
	if _, err = s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityRunImport); err != nil {
		return RunJob{}, false, err
	}
	program, err := s.repository.Program(ctx, input.ProjectID, input.ProgramID)
	if err != nil {
		return RunJob{}, false, err
	}
	policyDigest, err := ParseDigest(program.Program.PolicyDigest)
	if err != nil {
		return RunJob{}, false, ErrConflict
	}
	id, err := s.newID("mrj")
	if err != nil {
		return RunJob{}, false, ErrUnavailable
	}
	job := RunJob{ProgramID: input.ProgramID, StateVersion: input.ExpectedStateVersion, RunJobID: id, RunKind: input.RunKind, Status: "pending"}
	requestDigest := digest(input)
	replay, err := s.evidence.QueueRun(ctx, input.ExpectedStateVersion, RunJobWrite{Job: job, ProjectID: input.ProjectID, IdempotencyKey: input.IdempotencyKey, RequestDigest: requestDigest, ManifestDigest: manifestDigest, MappingDigest: mappingDigest, PolicyDigest: policyDigest, CreatedAt: s.now()})
	if replay && err == nil {
		item, readErr := s.evidence.RunJobByIdempotency(ctx, input.ProjectID, input.ProgramID, input.IdempotencyKey)
		return item, true, readErr
	}
	return job, replay, err
}
func (s *Service) RunJob(ctx context.Context, actor Actor, projectID, programID, jobID string) (RunJob, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return RunJob{}, err
	}
	return s.evidence.RunJob(ctx, projectID, programID, jobID)
}
func (s *Service) ListDivergences(ctx context.Context, actor Actor, projectID, programID string, limit int) ([]Divergence, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return nil, err
	}
	limit, err := boundedLimit(limit)
	if err != nil {
		return nil, err
	}
	return s.evidence.ListDivergences(ctx, projectID, programID, limit)
}
func (s *Service) AssessCurrentReadiness(ctx context.Context, actor Actor, projectID, programID string, expected int64) (ReadinessAssessment, error) {
	if expected < 1 {
		return ReadinessAssessment{}, ErrInvalid
	}
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityAssessReadiness); err != nil {
		return ReadinessAssessment{}, err
	}
	input, err := s.evidence.ReadinessInput(ctx, projectID, programID)
	if err != nil {
		return ReadinessAssessment{}, err
	}
	assessment, err := AssessReadiness(programID, expected, input)
	if err != nil {
		return assessment, err
	}
	raw, err := ParseDigest(assessment.ReadinessDigest)
	if err != nil {
		return assessment, ErrUnavailable
	}
	err = s.evidence.RecordReadiness(ctx, expected, ReadinessWrite{Assessment: assessment, ProjectID: projectID, ReadinessDigest: raw, AssessedAt: s.now()})
	if errors.Is(err, ErrConflict) {
		latest, readErr := s.evidence.LatestReadiness(ctx, projectID, programID)
		if readErr == nil && latest.ReadinessDigest == assessment.ReadinessDigest {
			return latest, nil
		}
	}
	return assessment, err
}
func (s *Service) LatestReadiness(ctx context.Context, actor Actor, projectID, programID string) (ReadinessAssessment, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return ReadinessAssessment{}, err
	}
	return s.evidence.LatestReadiness(ctx, projectID, programID)
}

func boundedLimit(limit int) (int, error) {
	if limit <= 0 {
		return 50, nil
	}
	if limit > 100 {
		return 0, ErrInvalid
	}
	return limit, nil
}

func (s *Service) CreateProgram(ctx context.Context, actor Actor, input CreateProgramInput) (ProgramDetail, bool, error) {
	ctx, span := s.tracer.Start(ctx, "billing.migration.program.create")
	defer span.End()
	if err := normalizeCreateInput(&input); err != nil {
		return ProgramDetail{}, false, err
	}
	authorization, err := s.repository.Authorize(ctx, actor, input.ProjectID, CapabilityManageSource)
	if err != nil {
		return ProgramDetail{}, false, err
	}
	requestDigest := digest(struct {
		ProjectID, EnvironmentID, ExternalProjectID string
		Applications                                []ScopeItem
		CredentialDigest                            [32]byte
		StabilizationDays, RollbackWindowDays       int
	}{input.ProjectID, input.EnvironmentID, input.ExternalProjectID, input.Applications,
		sha256.Sum256(input.Credential), input.StabilizationDays, input.RollbackWindowDays})
	existing, err := s.repository.Idempotency(ctx, input.ProjectID, input.IdempotencyKey)
	if err == nil {
		if !bytes.Equal(existing.RequestDigest, requestDigest) {
			return ProgramDetail{}, false, ErrConflict
		}
		program, readErr := s.repository.Program(ctx, input.ProjectID, existing.ProgramID)
		if readErr == nil {
			readErr = s.attachOperatorCapabilities(ctx, actor, input.ProjectID, &program)
		}
		return program, true, readErr
	}
	if err != nil && err != ErrNotFound {
		return ProgramDetail{}, false, err
	}
	if s.cipher == nil || s.assessor == nil {
		return ProgramDetail{}, false, ErrUnavailable
	}
	// Provider I/O happens before CreateProgram opens its transaction.
	assessment, err := s.assessor.AssessMigration(ctx, input.ExternalProjectID, input.Credential)
	if errors.Is(err, ErrInvalid) {
		return ProgramDetail{}, false, ErrInvalid
	}
	if err != nil || len(assessment.Capabilities) == 0 {
		return ProgramDetail{}, false, ErrUnavailable
	}
	sort.Strings(assessment.Capabilities)
	programID, err := s.newID("mig")
	if err != nil {
		return ProgramDetail{}, false, ErrUnavailable
	}
	credentialID, err := s.newID("mgc")
	if err != nil {
		return ProgramDetail{}, false, ErrUnavailable
	}
	assessmentID, err := s.newID("mga")
	if err != nil {
		return ProgramDetail{}, false, ErrUnavailable
	}
	now := s.now()
	envelope, err := s.cipher.EncryptSubject(input.Credential, providercredential.SubjectScope{
		OrganizationID:  authorization.OrganizationID,
		ProjectID:       input.ProjectID,
		SubjectKind:     providercredential.SubjectBillingMigrationCredential,
		SubjectID:       credentialID,
		CredentialClass: migrationCredentialClass,
	})
	if err != nil {
		return ProgramDetail{}, false, ErrUnavailable
	}
	scope := Scope{ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID, Applications: input.Applications}
	scopeDigest := digest(scope)
	policyDigest := digest(struct{ StabilizationDays, RollbackWindowDays int }{input.StabilizationDays, input.RollbackWindowDays})
	capability := CapabilityAssessment{
		ProgramID: programID, StateVersion: 1, Adapter: AdapterRevenueCat,
		ProviderAPIVersion: assessment.ProviderAPIVersion,
		Capabilities:       assessment.Capabilities, AssessedAt: assessment.AssessedAt.UTC(),
	}
	if capability.AssessedAt.IsZero() {
		capability.AssessedAt = now
	}
	program := Program{
		ProgramID: programID, StateVersion: 1, State: StateMapping, Scope: scope,
		Source:               Source{Adapter: AdapterRevenueCat, AdapterVersion: AdapterVersion, CredentialReference: credentialID},
		AuthorityEpochBefore: 0, StabilizationDays: input.StabilizationDays,
		RollbackWindowDays: input.RollbackWindowDays,
		ScopeDigest:        FormatDigest(scopeDigest), PolicyDigest: FormatDigest(policyDigest),
		CreatedAt: now, UpdatedAt: now,
	}
	created, err := s.repository.CreateProgram(ctx, CreateProgramCommand{
		OrganizationID: authorization.OrganizationID,
		Program:        program,
		Credential: SealedCredential{ID: credentialID, ProjectID: input.ProjectID,
			ExternalProjectID: input.ExternalProjectID, EnvelopeVersion: envelope.Version,
			Algorithm: envelope.Algorithm, KeyID: envelope.KeyID, Nonce: envelope.Nonce,
			Ciphertext: envelope.Ciphertext, Fingerprint: envelope.Fingerprint,
			CreatedByActorID: actor.ID, CreatedAt: now},
		AssessmentID: assessmentID, Assessment: capability, AssessmentDigest: digest(capability),
		RequestDigest: requestDigest, ScopeDigest: scopeDigest, PolicyDigest: policyDigest,
		ActorID: actor.ID, IdempotencyKey: input.IdempotencyKey, Now: now,
	})
	if errors.Is(err, ErrConflict) {
		stored, replayErr := s.repository.Idempotency(ctx, input.ProjectID, input.IdempotencyKey)
		if replayErr == nil && bytes.Equal(stored.RequestDigest, requestDigest) {
			program, readErr := s.repository.Program(ctx, input.ProjectID, stored.ProgramID)
			if readErr == nil {
				readErr = s.attachOperatorCapabilities(ctx, actor, input.ProjectID, &program)
			}
			return program, true, readErr
		}
	}
	if err != nil {
		return ProgramDetail{}, false, err
	}
	span.SetAttributes(attribute.String("mosaic.billing.migration.program.id", programID))
	if err := s.attachOperatorCapabilities(ctx, actor, input.ProjectID, &created); err != nil {
		return ProgramDetail{}, false, err
	}
	return created, false, nil
}

func (s *Service) ListPrograms(ctx context.Context, actor Actor, projectID string, limit int) ([]ProgramDetail, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		return nil, ErrInvalid
	}
	items, err := s.repository.ListPrograms(ctx, projectID, limit)
	if err != nil {
		return nil, err
	}
	capabilities, err := s.allowedOperatorCapabilities(ctx, actor, projectID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		items[index].OperatorCapabilities = append([]string(nil), capabilities...)
	}
	return items, nil
}

func (s *Service) Program(ctx context.Context, actor Actor, projectID, programID string) (ProgramDetail, error) {
	if _, err := s.repository.Authorize(ctx, actor, projectID, CapabilityView); err != nil {
		return ProgramDetail{}, err
	}
	detail, err := s.repository.Program(ctx, projectID, programID)
	if err == nil {
		err = s.attachOperatorCapabilities(ctx, actor, projectID, &detail)
	}
	return detail, err
}

func (s *Service) allowedOperatorCapabilities(ctx context.Context, actor Actor, projectID string) ([]string, error) {
	repository, ok := s.repository.(OperatorCapabilityRepository)
	if !ok {
		return nil, ErrUnavailable
	}
	return repository.AllowedCapabilities(ctx, actor, projectID)
}
func (s *Service) attachOperatorCapabilities(ctx context.Context, actor Actor, projectID string, detail *ProgramDetail) error {
	capabilities, err := s.allowedOperatorCapabilities(ctx, actor, projectID)
	if err != nil {
		return err
	}
	detail.OperatorCapabilities = append([]string(nil), capabilities...)
	return nil
}

func normalizeCreateInput(input *CreateProgramInput) error {
	if strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.EnvironmentID) == "" ||
		input.ExternalProjectID == "" || len(input.ExternalProjectID) > 256 || len(input.Credential) == 0 ||
		len(input.Credential) > 4096 || strings.TrimSpace(input.IdempotencyKey) == "" ||
		len(input.IdempotencyKey) > 128 || len(input.Applications) == 0 || len(input.Applications) > 100 {
		return ErrInvalid
	}
	if input.StabilizationDays == 0 {
		input.StabilizationDays = 7
	}
	if input.RollbackWindowDays == 0 {
		input.RollbackWindowDays = 7
	}
	if input.StabilizationDays < 1 || input.StabilizationDays > 30 || input.RollbackWindowDays < 1 || input.RollbackWindowDays > 30 {
		return ErrInvalid
	}
	seen := make(map[string]struct{}, len(input.Applications))
	for _, item := range input.Applications {
		if strings.TrimSpace(item.ApplicationID) == "" || item.Platform != "ios" && item.Platform != "android" {
			return ErrInvalid
		}
		key := item.ApplicationID + "\x00" + item.Platform
		if _, duplicate := seen[key]; duplicate {
			return ErrInvalid
		}
		seen[key] = struct{}{}
	}
	sort.Slice(input.Applications, func(i, j int) bool {
		if input.Applications[i].ApplicationID == input.Applications[j].ApplicationID {
			return input.Applications[i].Platform < input.Applications[j].Platform
		}
		return input.Applications[i].ApplicationID < input.Applications[j].ApplicationID
	})
	return nil
}

func digest(value any) []byte {
	encoded, _ := json.Marshal(value)
	sum := sha256.Sum256(encoded)
	return sum[:]
}

func (s *Service) newID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", err
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}
