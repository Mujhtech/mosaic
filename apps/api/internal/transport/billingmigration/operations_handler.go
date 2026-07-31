package billingmigrationhttp

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

func registerOperationalRoutes(programs chi.Router, h *Handler, expensive []func(http.Handler) http.Handler) {
	programs.Get("/{programId}/source-pulls", h.listSourcePulls)
	programs.Get("/{programId}/source-pulls/{sourcePullId}", h.getSourcePull)
	programs.With(expensive...).Post("/{programId}/source-pulls", h.queueSourcePull)
	programs.Post("/{programId}/promote-ready", h.promoteReady)
	programs.Post("/{programId}/cutover-proposals", h.proposeCutover)
	programs.Post("/{programId}/rollback-proposals", h.proposeRollback)
	programs.Post("/{programId}/proposals/{proposalId}/approvals", h.approveProposal)
	programs.Post("/{programId}/checkpoints", h.createCheckpoint)
	programs.With(expensive...).Post("/{programId}/cutover-executions", h.executeCutover)
	programs.With(expensive...).Post("/{programId}/rollback-executions", h.executeRollback)
	programs.Post("/{programId}/cases", h.createCase)
	programs.Post("/{programId}/cases/{caseId}/transitions", h.transitionCase)
	programs.With(expensive...).Post("/{programId}/repair-previews", h.previewRepair)
	programs.With(expensive...).Post("/{programId}/repair-executions", h.executeRepair)
	programs.Post("/{programId}/webhook-redeliveries", h.redeliverWebhook)
	programs.Post("/{programId}/credential-removals", h.removeCredential)
	programs.Post("/{programId}/legal-hold-proposals", h.proposeLegalHold)
	programs.Post("/{programId}/legal-hold-proposals/{proposalId}/approvals", h.approveLegalHold)
	programs.Get("/{programId}/completion", h.inspectCompletion)
	programs.Post("/{programId}/completion", h.completeMigration)
	registerOperationalReadRoutes(programs, h)
	registerStabilizationRoutes(programs, h)
}

func projectProgram(r *http.Request) (string, string) {
	return chi.URLParam(r, "projectId"), chi.URLParam(r, "programId")
}

func replayResponse(w http.ResponseWriter, r *http.Request, kind string, value any, replay bool, accepted bool) {
	record := record(kind, value)
	if replay {
		response.OK(w, r, record)
	} else if accepted {
		response.Accepted(w, r, record)
	} else {
		response.Created(w, r, record)
	}
}

type sourcePullRequest struct {
	Intent                  string `json:"intent"`
	StartingCursor          string `json:"startingCursor,omitempty"`
	StartingWatermark       string `json:"startingWatermark,omitempty"`
	StartingWatermarkDigest string `json:"startingWatermarkDigest,omitempty"`
	ExpectedStateVersion    int64  `json:"expectedStateVersion"`
}

func (v sourcePullRequest) Validate() error {
	return validation.ValidateStruct(&v,
		validation.Field(&v.Intent, validation.Required, validation.In("snapshot", "delta", "final_delta")),
		validation.Field(&v.StartingCursor, validation.Length(0, 512)),
		validation.Field(&v.StartingWatermark, validation.Length(0, 512)),
		validation.Field(&v.StartingWatermarkDigest, validation.When(v.StartingWatermarkDigest != "", validation.Match(sha256DigestPattern))),
		validation.Field(&v.ExpectedStateVersion, validation.Min(1)))
}

func (h *Handler) queueSourcePull(w http.ResponseWriter, r *http.Request) {
	if h.services.SourcePull == nil {
		writeError(w, r, billingmigration.ErrUnavailable)
		return
	}
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request sourcePullRequest
	if !decode(w, r, &request) {
		return
	}
	var watermarkDigest []byte
	if request.StartingWatermarkDigest != "" {
		var err error
		watermarkDigest, err = billingmigration.ParseDigest(request.StartingWatermarkDigest)
		if err != nil {
			writeError(w, r, billingmigration.ErrInvalid)
			return
		}
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.SourcePull.Queue(r.Context(), billingmigration.SourcePullCommand{Actor: actor(r), ProjectID: projectID, ProgramID: programID, Intent: request.Intent, StartingCursor: request.StartingCursor, StartingWatermark: request.StartingWatermark, StartingWatermarkDigest: watermarkDigest, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "sourcePullJob", item, replay, true)
}

func (h *Handler) promoteReady(w http.ResponseWriter, r *http.Request) {
	var request stateVersionRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, err := h.services.Program.PromoteReady(r.Context(), actor(r), billingmigration.PromoteReadyInput{ProjectID: projectID, ProgramID: programID, ExpectedStateVersion: request.ExpectedStateVersion})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record("authoritativeReadiness", item))
}

type digestSetRequest struct {
	Scope              string `json:"scope"`
	Manifest           string `json:"manifest"`
	Mapping            string `json:"mapping"`
	Policy             string `json:"policy"`
	Evidence           string `json:"evidence"`
	Readiness          string `json:"readiness"`
	FinalWatermark     string `json:"finalWatermark"`
	ApplicationVersion string `json:"applicationVersion"`
}

func (v digestSetRequest) Validate() error {
	return validation.ValidateStruct(&v,
		validation.Field(&v.Scope, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.Manifest, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.Mapping, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.Policy, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.Evidence, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.Readiness, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.FinalWatermark, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.ApplicationVersion, validation.Required, validation.Match(sha256DigestPattern)))
}

func (v digestSetRequest) domain() billingmigration.PreApprovalDigests {
	return billingmigration.PreApprovalDigests{Scope: v.Scope, Manifest: v.Manifest, Mapping: v.Mapping, Policy: v.Policy, Evidence: v.Evidence, Readiness: v.Readiness, FinalWatermark: v.FinalWatermark, ApplicationVersion: v.ApplicationVersion}
}

type cutoverProposalRequest struct {
	ExpectedStateVersion int64            `json:"expectedStateVersion"`
	ExpectedDigests      digestSetRequest `json:"expectedDigests"`
	Reason               string           `json:"reason"`
	ExpiresAt            time.Time        `json:"expiresAt"`
}

func (v cutoverProposalRequest) Validate() error {
	if err := validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.ExpiresAt, validation.Required)); err != nil {
		return err
	}
	return v.ExpectedDigests.Validate()
}

func (h *Handler) proposeCutover(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request cutoverProposalRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Program.ProposeCutover(r.Context(), actor(r), billingmigration.ProposeCutoverInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, Command: "cutover", ExpectedStateVersion: request.ExpectedStateVersion, ExpectedDigests: request.ExpectedDigests.domain(), Reason: request.Reason, ExpiresAt: request.ExpiresAt})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "cutoverProposal", item, replay, false)
}

type rollbackProposalRequest struct {
	CheckpointID                        string    `json:"checkpointId"`
	ExpectedStateVersion                int64     `json:"expectedStateVersion"`
	ExpectedCheckpointDigest            string    `json:"expectedCheckpointDigest"`
	ExpectedAuthorityDigest             string    `json:"expectedAuthorityDigest"`
	ExpectedRollbackPrerequisitesDigest string    `json:"expectedRollbackPrerequisitesDigest"`
	Reason                              string    `json:"reason"`
	ExpiresAt                           time.Time `json:"expiresAt"`
}

func (v rollbackProposalRequest) Validate() error {
	return validation.ValidateStruct(&v,
		validation.Field(&v.CheckpointID, validation.Required, validation.Length(1, 128)),
		validation.Field(&v.ExpectedStateVersion, validation.Min(1)),
		validation.Field(&v.ExpectedCheckpointDigest, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.ExpectedAuthorityDigest, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.ExpectedRollbackPrerequisitesDigest, validation.Required, validation.Match(sha256DigestPattern)),
		validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.ExpiresAt, validation.Required))
}

func (h *Handler) proposeRollback(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request rollbackProposalRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Program.ProposeRollback(r.Context(), actor(r), billingmigration.ProposeRollbackInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, CheckpointID: request.CheckpointID, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedCheckpointDigest: request.ExpectedCheckpointDigest, ExpectedAuthorityDigest: request.ExpectedAuthorityDigest, ExpectedRollbackPrerequisitesDigest: request.ExpectedRollbackPrerequisitesDigest, Reason: request.Reason, ExpiresAt: request.ExpiresAt})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "rollbackProposal", item, replay, false)
}

type approvalRequest struct {
	ExpectedStateVersion int64 `json:"expectedStateVersion"`
}

func (v approvalRequest) Validate() error {
	return validation.Validate(&v.ExpectedStateVersion, validation.Min(1))
}

func (h *Handler) approveProposal(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request approvalRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Program.ApproveCutover(r.Context(), actor(r), billingmigration.ApproveCutoverInput{ProjectID: projectID, ProgramID: programID, ProposalID: chi.URLParam(r, "proposalId"), IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "migrationApproval", item, replay, false)
}

type checkpointRequest struct {
	ApprovalID           string           `json:"approvalId"`
	ExpectedStateVersion int64            `json:"expectedStateVersion"`
	ExpectedDigests      digestSetRequest `json:"expectedDigests"`
	ApprovalDigest       string           `json:"approvalDigest"`
	CohortDigest         string           `json:"cohortDigest"`
}

func (v checkpointRequest) Validate() error {
	if err := validation.ValidateStruct(&v, validation.Field(&v.ApprovalID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ApprovalDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.CohortDigest, validation.Required, validation.Match(sha256DigestPattern))); err != nil {
		return err
	}
	return v.ExpectedDigests.Validate()
}

func (h *Handler) createCheckpoint(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request checkpointRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Program.CreateCheckpoint(r.Context(), actor(r), billingmigration.CreateCheckpointInput{ProjectID: projectID, ProgramID: programID, ApprovalID: request.ApprovalID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedDigests: request.ExpectedDigests.domain(), ApprovalDigest: request.ApprovalDigest, CohortDigest: request.CohortDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "migrationCheckpoint", item, replay, false)
}

type executionScopeRequest struct {
	EnvironmentID string         `json:"environmentId"`
	Applications  []scopeRequest `json:"applications"`
}

func (v executionScopeRequest) domain(projectID string) billingmigration.Scope {
	items := make([]billingmigration.ScopeItem, 0, len(v.Applications))
	for _, item := range v.Applications {
		items = append(items, billingmigration.ScopeItem{ApplicationID: item.ApplicationID, Platform: item.Platform})
	}
	return billingmigration.Scope{ProjectID: projectID, EnvironmentID: v.EnvironmentID, Applications: items}
}

func (v executionScopeRequest) Validate() error {
	if err := validation.ValidateStruct(&v, validation.Field(&v.EnvironmentID, validation.Required, validation.Length(1, 128)), validation.Field(&v.Applications, validation.Required, validation.Length(1, 100))); err != nil {
		return err
	}
	for _, item := range v.Applications {
		if err := validation.ValidateStruct(&item, validation.Field(&item.ApplicationID, validation.Required, validation.Length(1, 128)), validation.Field(&item.Platform, validation.Required, validation.In("ios", "android"))); err != nil {
			return err
		}
	}
	return nil
}

type cutoverExecutionRequest struct {
	ExpectedStateVersion   int64                 `json:"expectedStateVersion"`
	ExpectedDigests        digestSetRequest      `json:"expectedDigests"`
	ApprovalDigest         string                `json:"approvalDigest"`
	Reason                 string                `json:"reason"`
	Scope                  executionScopeRequest `json:"scope"`
	CheckpointID           string                `json:"checkpointId"`
	ApprovalID             string                `json:"approvalId"`
	ExpectedAuthorityEpoch int64                 `json:"expectedAuthorityEpoch"`
}

func (v cutoverExecutionRequest) Validate() error {
	if err := validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ApprovalDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.CheckpointID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ApprovalID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ExpectedAuthorityEpoch, validation.Min(0))); err != nil {
		return err
	}
	if err := v.ExpectedDigests.Validate(); err != nil {
		return err
	}
	return v.Scope.Validate()
}

func (h *Handler) executeCutover(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request cutoverExecutionRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	d := request.ExpectedDigests
	item, replay, err := h.services.Program.ExecuteCutover(r.Context(), actor(r), billingmigration.ExecuteCutoverInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedDigests: billingmigration.CutoverCommandDigests{Scope: d.Scope, Manifest: d.Manifest, Mapping: d.Mapping, Policy: d.Policy, Evidence: d.Evidence, Readiness: d.Readiness, FinalWatermark: d.FinalWatermark, ApplicationVersion: d.ApplicationVersion, Approval: request.ApprovalDigest}, Reason: request.Reason, Scope: request.Scope.domain(projectID), CheckpointID: request.CheckpointID, ApprovalID: request.ApprovalID, ExpectedAuthorityEpoch: request.ExpectedAuthorityEpoch})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "authorityExecution", item, replay, false)
}

type rollbackExecutionRequest struct {
	ExpectedStateVersion                int64                 `json:"expectedStateVersion"`
	ExpectedCheckpointDigest            string                `json:"expectedCheckpointDigest"`
	ExpectedAuthorityDigest             string                `json:"expectedAuthorityDigest"`
	ExpectedRollbackPrerequisitesDigest string                `json:"expectedRollbackPrerequisitesDigest"`
	ExpectedApprovalDigest              string                `json:"expectedApprovalDigest"`
	Reason                              string                `json:"reason"`
	Scope                               executionScopeRequest `json:"scope"`
	CheckpointID                        string                `json:"checkpointId"`
	ApprovalID                          string                `json:"approvalId"`
	ExpectedAuthorityEpoch              int64                 `json:"expectedAuthorityEpoch"`
}

func (v rollbackExecutionRequest) Validate() error {
	if err := validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedCheckpointDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedAuthorityDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedRollbackPrerequisitesDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedApprovalDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.CheckpointID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ApprovalID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ExpectedAuthorityEpoch, validation.Min(1))); err != nil {
		return err
	}
	return v.Scope.Validate()
}
func (h *Handler) executeRollback(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request rollbackExecutionRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Program.ExecuteRollback(r.Context(), actor(r), billingmigration.ExecuteRollbackInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedDigests: billingmigration.RollbackCommandDigests{Checkpoint: request.ExpectedCheckpointDigest, Authority: request.ExpectedAuthorityDigest, RollbackPrerequisites: request.ExpectedRollbackPrerequisitesDigest, Approval: request.ExpectedApprovalDigest}, Reason: request.Reason, Scope: request.Scope.domain(projectID), CheckpointID: request.CheckpointID, ApprovalID: request.ApprovalID, ExpectedAuthorityEpoch: request.ExpectedAuthorityEpoch})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "authorityExecution", item, replay, false)
}

type caseRequest struct {
	ExpectedStateVersion int64  `json:"expectedStateVersion"`
	Classification       string `json:"classification"`
	Reason               string `json:"reason"`
	LinkedDivergenceID   string `json:"linkedDivergenceId,omitempty"`
	LinkedSourceRecordID string `json:"linkedSourceRecordId,omitempty"`
}

func (v caseRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.Classification, validation.Required, validation.In("critical", "blocking", "warning")), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.LinkedDivergenceID, validation.Length(0, 128)), validation.Field(&v.LinkedSourceRecordID, validation.Length(0, 128)))
}
func (h *Handler) createCase(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request caseRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.CreateCase(r.Context(), actor(r), billingmigration.CreateCaseInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, Classification: request.Classification, Reason: request.Reason, ExpectedStateVersion: request.ExpectedStateVersion, LinkedDivergenceID: request.LinkedDivergenceID, LinkedSourceRecordID: request.LinkedSourceRecordID})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "migrationCase", item, replay, false)
}

type caseTransitionRequest struct {
	ExpectedStateVersion int64  `json:"expectedStateVersion"`
	ExpectedCaseDigest   string `json:"expectedCaseDigest"`
	Status               string `json:"status"`
	Reason               string `json:"reason"`
}

func (v caseTransitionRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedCaseDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.Status, validation.Required, validation.In("in_progress", "resolved", "dismissed")), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)))
}
func (h *Handler) transitionCase(w http.ResponseWriter, r *http.Request) {
	var request caseTransitionRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, err := h.services.Operations.TransitionCase(r.Context(), actor(r), billingmigration.TransitionCaseInput{ProjectID: projectID, ProgramID: programID, CaseID: chi.URLParam(r, "caseId"), Status: request.Status, Reason: request.Reason, ExpectedCaseDigest: request.ExpectedCaseDigest, ExpectedStateVersion: request.ExpectedStateVersion})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record("migrationCase", item))
}

type repairPreviewRequest struct {
	CaseID               string    `json:"caseId"`
	RepairKind           string    `json:"repairKind"`
	ScopeKind            string    `json:"scopeKind"`
	ScopeReferences      []string  `json:"scopeReferences"`
	ExpectedStateVersion int64     `json:"expectedStateVersion"`
	ExpectedCaseDigest   string    `json:"expectedCaseDigest"`
	ExpectedPolicyDigest string    `json:"expectedPolicyDigest"`
	ExpectedScopeDigest  string    `json:"expectedScopeDigest"`
	Reason               string    `json:"reason"`
	ExpiresAt            time.Time `json:"expiresAt"`
}

func (v repairPreviewRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.CaseID, validation.Required, validation.Length(1, 128)), validation.Field(&v.RepairKind, validation.Required), validation.Field(&v.ScopeKind, validation.Required), validation.Field(&v.ScopeReferences, validation.Required, validation.Length(1, 100)), validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedCaseDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedPolicyDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedScopeDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.ExpiresAt, validation.Required))
}
func (h *Handler) previewRepair(w http.ResponseWriter, r *http.Request) {
	if !h.services.RepairOnline {
		writeError(w, r, billingmigration.ErrUnavailable)
		return
	}
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request repairPreviewRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.PreviewRepair(r.Context(), actor(r), billingmigration.PreviewRepairInput{ProjectID: projectID, ProgramID: programID, CaseID: request.CaseID, IdempotencyKey: key, RepairKind: request.RepairKind, ScopeKind: request.ScopeKind, Reason: request.Reason, ScopeReferences: request.ScopeReferences, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedCaseDigest: request.ExpectedCaseDigest, ExpectedPolicyDigest: request.ExpectedPolicyDigest, ExpectedScopeDigest: request.ExpectedScopeDigest, ExpiresAt: request.ExpiresAt})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "repairPreview", item, replay, false)
}

type repairExecutionRequest struct {
	PreviewID             string `json:"previewId"`
	ExpectedStateVersion  int64  `json:"expectedStateVersion"`
	ExpectedPreviewDigest string `json:"expectedPreviewDigest"`
	ExpectedCaseDigest    string `json:"expectedCaseDigest"`
	ExpectedPolicyDigest  string `json:"expectedPolicyDigest"`
	ExpectedScopeDigest   string `json:"expectedScopeDigest"`
}

func (v repairExecutionRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.PreviewID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedPreviewDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedCaseDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedPolicyDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedScopeDigest, validation.Required, validation.Match(sha256DigestPattern)))
}
func (h *Handler) executeRepair(w http.ResponseWriter, r *http.Request) {
	if !h.services.RepairOnline {
		writeError(w, r, billingmigration.ErrUnavailable)
		return
	}
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request repairExecutionRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.ExecuteRepair(r.Context(), actor(r), billingmigration.ExecuteRepairInput{ProjectID: projectID, ProgramID: programID, PreviewID: request.PreviewID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedPreviewDigest: request.ExpectedPreviewDigest, ExpectedCaseDigest: request.ExpectedCaseDigest, ExpectedPolicyDigest: request.ExpectedPolicyDigest, ExpectedScopeDigest: request.ExpectedScopeDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	result := record("repairExecution", item)
	if item.Status == "pending" {
		response.Accepted(w, r, result)
	} else if replay {
		response.OK(w, r, result)
	} else {
		response.Created(w, r, result)
	}
}

type redeliveryRequest struct {
	EventID              string `json:"eventId"`
	DestinationID        string `json:"destinationId"`
	ExpectedEventDigest  string `json:"expectedEventDigest"`
	ExpectedStateVersion int64  `json:"expectedStateVersion"`
	Reason               string `json:"reason"`
}

func (v redeliveryRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.EventID, validation.Required, validation.Length(1, 128)), validation.Field(&v.DestinationID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ExpectedEventDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)))
}
func (h *Handler) redeliverWebhook(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request redeliveryRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Redelivery.Redeliver(r.Context(), actor(r), billingmigration.RedeliveryInput{ProjectID: projectID, ProgramID: programID, EventID: request.EventID, DestinationID: request.DestinationID, IdempotencyKey: key, ExpectedEventDigest: request.ExpectedEventDigest, Reason: request.Reason, ExpectedStateVersion: request.ExpectedStateVersion})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "webhookRedelivery", item, replay, true)
}

type removalRequest struct {
	ExpectedStateVersion     int64  `json:"expectedStateVersion"`
	Reason                   string `json:"reason"`
	IrreversibleAcknowledged bool   `json:"irreversibleAcknowledged"`
}

func (v removalRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.IrreversibleAcknowledged, validation.In(true)))
}
func (h *Handler) removeCredential(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request removalRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.RemoveMigrationCredential(r.Context(), actor(r), billingmigration.RemoveCredentialInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, Reason: request.Reason, ExpectedStateVersion: request.ExpectedStateVersion, IrreversibleAcknowledged: request.IrreversibleAcknowledged})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "credentialRemoval", item, replay, false)
}

type legalHoldProposalRequest struct {
	Command                       string    `json:"command"`
	Reason                        string    `json:"reason"`
	ExternalComplianceReference   string    `json:"externalComplianceReference"`
	ExpectedPreviousCommandDigest string    `json:"expectedPreviousCommandDigest,omitempty"`
	ExpiresAt                     time.Time `json:"expiresAt"`
}

func (v legalHoldProposalRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.Command, validation.Required, validation.In("set", "release")), validation.Field(&v.Reason, validation.Required, validation.Length(1, 500)), validation.Field(&v.ExternalComplianceReference, validation.Required, validation.Length(1, 256)), validation.Field(&v.ExpectedPreviousCommandDigest, validation.When(v.ExpectedPreviousCommandDigest != "", validation.Match(sha256DigestPattern))), validation.Field(&v.ExpiresAt, validation.Required))
}
func (h *Handler) proposeLegalHold(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request legalHoldProposalRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.ProposeLegalHold(r.Context(), actor(r), billingmigration.ProposeLegalHoldInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, Command: request.Command, Reason: request.Reason, ExternalComplianceReference: request.ExternalComplianceReference, ExpectedPreviousCommandDigest: request.ExpectedPreviousCommandDigest, ExpiresAt: request.ExpiresAt})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "legalHoldProposal", item, replay, false)
}

type legalHoldApprovalRequest struct {
	ExpectedProposalDigest string `json:"expectedProposalDigest"`
}

func (v legalHoldApprovalRequest) Validate() error {
	return validation.Validate(&v.ExpectedProposalDigest, validation.Required, validation.Match(sha256DigestPattern))
}
func (h *Handler) approveLegalHold(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request legalHoldApprovalRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.ApproveLegalHold(r.Context(), actor(r), billingmigration.ApproveLegalHoldInput{ProjectID: projectID, ProgramID: programID, ProposalID: chi.URLParam(r, "proposalId"), IdempotencyKey: key, ExpectedProposalDigest: request.ExpectedProposalDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "legalHold", item, replay, false)
}

func (h *Handler) inspectCompletion(w http.ResponseWriter, r *http.Request) {
	projectID, programID := projectProgram(r)
	item, err := h.services.Operations.InspectCompletion(r.Context(), actor(r), projectID, programID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record("completionPrerequisites", item))
}

type completionRequest struct {
	ExpectedStateVersion            int64  `json:"expectedStateVersion"`
	ExpectedPolicyDigest            string `json:"expectedPolicyDigest"`
	ExpectedAuthorityDigest         string `json:"expectedAuthorityDigest"`
	ExpectedStabilityEvidenceDigest string `json:"expectedStabilityEvidenceDigest"`
}

func (v completionRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedPolicyDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedAuthorityDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&v.ExpectedStabilityEvidenceDigest, validation.Required, validation.Match(sha256DigestPattern)))
}
func (h *Handler) completeMigration(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request completionRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Operations.CompleteMigration(r.Context(), actor(r), billingmigration.CompleteMigrationInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedPolicyDigest: request.ExpectedPolicyDigest, ExpectedAuthorityDigest: request.ExpectedAuthorityDigest, ExpectedStabilityEvidenceDigest: request.ExpectedStabilityEvidenceDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "completionReport", item, replay, false)
}
