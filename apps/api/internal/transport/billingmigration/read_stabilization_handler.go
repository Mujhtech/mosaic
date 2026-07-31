package billingmigrationhttp

import (
	"net/http"

	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type stabilizationThresholdsRequest struct {
	AuthorityMismatchMax       int64 `json:"authorityMismatchMax"`
	AccessAPIErrorMax          int64 `json:"accessApiErrorMax"`
	SDKSyncFailureMax          int64 `json:"sdkSyncFailureMax"`
	DivergenceMax              int64 `json:"divergenceMax"`
	ValidationBacklogMax       int64 `json:"validationBacklogMax"`
	SourceDeltaLagMaxSeconds   int64 `json:"sourceDeltaLagMaxSeconds"`
	WebhookFailureMax          int64 `json:"webhookFailureMax"`
	WebhookFreshnessMaxSeconds int64 `json:"webhookFreshnessMaxSeconds"`
	QuarantineMax              int64 `json:"quarantineMax"`
	SupportCaseMax             int64 `json:"supportCaseMax"`
	OldAppVersionMax           int64 `json:"oldAppVersionMax"`
	WorkerUnhealthyMax         int64 `json:"workerUnhealthyMax"`
}

func (v stabilizationThresholdsRequest) domain() billingmigration.StabilizationThresholds {
	return billingmigration.StabilizationThresholds{AuthorityMismatchMax: v.AuthorityMismatchMax, AccessAPIErrorMax: v.AccessAPIErrorMax, SDKSyncFailureMax: v.SDKSyncFailureMax, DivergenceMax: v.DivergenceMax, ValidationBacklogMax: v.ValidationBacklogMax, SourceDeltaLagMaxSeconds: v.SourceDeltaLagMaxSeconds, WebhookFailureMax: v.WebhookFailureMax, WebhookFreshnessMaxSeconds: v.WebhookFreshnessMaxSeconds, QuarantineMax: v.QuarantineMax, SupportCaseMax: v.SupportCaseMax, OldAppVersionMax: v.OldAppVersionMax, WorkerUnhealthyMax: v.WorkerUnhealthyMax}
}

type freezePolicyRequest struct {
	ExpectedStateVersion int64                          `json:"expectedStateVersion"`
	Thresholds           stabilizationThresholdsRequest `json:"thresholds"`
}

func (v freezePolicyRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.Thresholds, validation.By(func(any) error {
		if !v.Thresholds.domain().Valid() {
			return validation.NewError("validation_invalid", "contains invalid thresholds")
		}
		return nil
	})))
}

func (h *Handler) freezeStabilizationPolicy(w http.ResponseWriter, r *http.Request) {
	if h.services.Stabilization == nil {
		writeError(w, r, billingmigration.ErrUnavailable)
		return
	}
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request freezePolicyRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Stabilization.FreezePolicy(r.Context(), actor(r), billingmigration.FreezeStabilizationPolicyInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, Thresholds: request.Thresholds.domain()})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "stabilizationPolicy", item, replay, false)
}

type stabilizationObservationRequest struct {
	ExpectedStateVersion   int64  `json:"expectedStateVersion"`
	ExpectedAuthorityEpoch int64  `json:"expectedAuthorityEpoch"`
	ExpectedPolicyDigest   string `json:"expectedPolicyDigest"`
}

func (v stabilizationObservationRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedAuthorityEpoch, validation.Min(1)), validation.Field(&v.ExpectedPolicyDigest, validation.Required, validation.Match(sha256DigestPattern)))
}

func (h *Handler) observeStabilization(w http.ResponseWriter, r *http.Request) {
	if h.services.Stabilization == nil {
		writeError(w, r, billingmigration.ErrUnavailable)
		return
	}
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request stabilizationObservationRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	item, replay, err := h.services.Stabilization.Observe(r.Context(), actor(r), billingmigration.RecordStabilizationInput{ProjectID: projectID, ProgramID: programID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedAuthorityEpoch: request.ExpectedAuthorityEpoch, ExpectedPolicyDigest: request.ExpectedPolicyDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "stabilizationObservation", item, replay, false)
}

type rollbackReadinessRequest struct {
	ObservationID             string `json:"observationId"`
	ExpectedStateVersion      int64  `json:"expectedStateVersion"`
	ExpectedAuthorityEpoch    int64  `json:"expectedAuthorityEpoch"`
	ExpectedObservationDigest string `json:"expectedObservationDigest"`
}

func (v rollbackReadinessRequest) Validate() error {
	return validation.ValidateStruct(&v, validation.Field(&v.ObservationID, validation.Required, validation.Length(1, 128)), validation.Field(&v.ExpectedStateVersion, validation.Min(1)), validation.Field(&v.ExpectedAuthorityEpoch, validation.Min(1)), validation.Field(&v.ExpectedObservationDigest, validation.Required, validation.Match(sha256DigestPattern)))
}

func (h *Handler) assessRollbackReadiness(w http.ResponseWriter, r *http.Request) {
	if h.services.RollbackReadiness == nil {
		writeError(w, r, billingmigration.ErrUnavailable)
		return
	}
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request rollbackReadinessRequest
	if !decode(w, r, &request) {
		return
	}
	projectID, programID := projectProgram(r)
	assessment, checkpoint, replay, err := h.services.RollbackReadiness.Assess(r.Context(), actor(r), billingmigration.AssessRollbackReadinessInput{ProjectID: projectID, ProgramID: programID, ObservationID: request.ObservationID, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ExpectedAuthorityEpoch: request.ExpectedAuthorityEpoch, ExpectedObservationDigest: request.ExpectedObservationDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	replayResponse(w, r, "rollbackReadinessResult", map[string]any{"assessment": assessment, "checkpoint": checkpoint}, replay, false)
}
