package billingmigration

import (
	"context"
	"sort"
	"time"
)

type StabilizationThresholds struct {
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

func (t StabilizationThresholds) Valid() bool {
	return t.AuthorityMismatchMax >= 0 && t.AccessAPIErrorMax >= 0 && t.SDKSyncFailureMax >= 0 && t.DivergenceMax >= 0 &&
		t.ValidationBacklogMax >= 0 && t.SourceDeltaLagMaxSeconds > 0 && t.WebhookFailureMax >= 0 &&
		t.WebhookFreshnessMaxSeconds > 0 && t.QuarantineMax >= 0 && t.SupportCaseMax >= 0 && t.OldAppVersionMax >= 0 && t.WorkerUnhealthyMax >= 0
}

type StabilizationPolicy struct {
	ID              string                  `json:"policyId"`
	ProgramID       string                  `json:"programId"`
	ProjectID       string                  `json:"-"`
	PolicyDigest    string                  `json:"policyDigest"`
	FrozenByActorID string                  `json:"-"`
	StateVersion    int64                   `json:"stateVersion"`
	Thresholds      StabilizationThresholds `json:"thresholds"`
	FrozenAt        time.Time               `json:"frozenAt"`
}

type FreezeStabilizationPolicyInput struct {
	ProjectID, ProgramID, IdempotencyKey string
	ExpectedStateVersion                 int64
	Thresholds                           StabilizationThresholds
}

type StabilizationMetrics struct {
	AuthorityMismatches   int64 `json:"authorityMismatches"`
	AccessAPIErrors       int64 `json:"accessApiErrors"`
	SDKSyncFailures       int64 `json:"sdkSyncFailures"`
	Divergences           int64 `json:"divergences"`
	ValidationBacklog     int64 `json:"validationBacklog"`
	SourceDeltaLagSeconds int64 `json:"sourceDeltaLagSeconds"`
	WebhookFailures       int64 `json:"webhookFailures"`
	WebhookAgeSeconds     int64 `json:"webhookAgeSeconds"`
	QuarantinedRecords    int64 `json:"quarantinedRecords"`
	SupportCases          int64 `json:"supportCases"`
	OldAppVersions        int64 `json:"oldAppVersions"`
	UnhealthyWorkers      int64 `json:"unhealthyWorkers"`
}

func (m StabilizationMetrics) Valid() bool {
	return m.AuthorityMismatches >= 0 && m.AccessAPIErrors >= 0 && m.SDKSyncFailures >= 0 && m.Divergences >= 0 &&
		m.ValidationBacklog >= 0 && m.SourceDeltaLagSeconds >= 0 && m.WebhookFailures >= 0 && m.WebhookAgeSeconds >= 0 &&
		m.QuarantinedRecords >= 0 && m.SupportCases >= 0 && m.OldAppVersions >= 0 && m.UnhealthyWorkers >= 0
}

func StabilizationBreaches(t StabilizationThresholds, m StabilizationMetrics) []string {
	pairs := []struct {
		code           string
		value, maximum int64
	}{
		{"authority", m.AuthorityMismatches, t.AuthorityMismatchMax}, {"access_api", m.AccessAPIErrors, t.AccessAPIErrorMax},
		{"sdk_sync", m.SDKSyncFailures, t.SDKSyncFailureMax}, {"divergence", m.Divergences, t.DivergenceMax},
		{"validation_backlog", m.ValidationBacklog, t.ValidationBacklogMax}, {"source_delta_lag", m.SourceDeltaLagSeconds, t.SourceDeltaLagMaxSeconds},
		{"webhook_failures", m.WebhookFailures, t.WebhookFailureMax}, {"webhook_freshness", m.WebhookAgeSeconds, t.WebhookFreshnessMaxSeconds},
		{"quarantine", m.QuarantinedRecords, t.QuarantineMax}, {"support_cases", m.SupportCases, t.SupportCaseMax},
		{"old_app_versions", m.OldAppVersions, t.OldAppVersionMax}, {"worker_health", m.UnhealthyWorkers, t.WorkerUnhealthyMax},
	}
	var out []string
	for _, pair := range pairs {
		if pair.value > pair.maximum {
			out = append(out, pair.code)
		}
	}
	sort.Strings(out)
	return out
}

type RecordStabilizationInput struct {
	ProjectID, ProgramID, IdempotencyKey, ExpectedPolicyDigest string
	ExpectedStateVersion, ExpectedAuthorityEpoch               int64
}

type StabilizationObservation struct {
	ID                   string               `json:"observationId"`
	ProgramID            string               `json:"programId"`
	ProjectID            string               `json:"-"`
	PolicyID             string               `json:"policyId"`
	PolicyDigest         string               `json:"policyDigest"`
	EvidenceDigest       string               `json:"evidenceDigest"`
	StateVersion         int64                `json:"stateVersion"`
	AuthorityEpoch       int64                `json:"authorityEpoch"`
	Metrics              StabilizationMetrics `json:"metrics"`
	SourceWatermark      time.Time            `json:"sourceWatermark"`
	WebhookLastSuccessAt time.Time            `json:"webhookLastSuccessAt"`
	ObservedAt           time.Time            `json:"observedAt"`
	BreachCodes          []string             `json:"breachCodes"`
	Healthy              bool                 `json:"healthy"`
}

type StabilizationRepository interface {
	FreezeStabilizationPolicy(context.Context, FreezeStabilizationPolicyCommand) (StabilizationPolicy, bool, error)
	RecordStabilization(context.Context, RecordStabilizationCommand) (StabilizationObservation, bool, error)
	RecordTrustedAccessAPISignal(context.Context, TrustedAccessAPISignal) error
}
type FreezeStabilizationPolicyCommand struct {
	Input         FreezeStabilizationPolicyInput
	ActorID       string
	RequestDigest []byte
}
type RecordStabilizationCommand struct {
	Input                               RecordStabilizationInput
	ActorID                             string
	RequestDigest, ExpectedPolicyDigest []byte
}

// TrustedAccessAPISignal is ingested only by an internal telemetry boundary.
// It is deliberately absent from the operator-facing service.
type TrustedAccessAPISignal struct {
	ID, ProgramID, ProjectID       string
	WindowStartedAt, WindowEndedAt time.Time
	RequestCount, ErrorCount       int64
	EvidenceDigest                 []byte
}

type StabilizationService struct {
	auth Repository
	repo StabilizationRepository
}

func NewStabilizationService(auth Repository, repo StabilizationRepository) *StabilizationService {
	return &StabilizationService{auth: auth, repo: repo}
}

func (s *StabilizationService) FreezePolicy(ctx context.Context, actor Actor, input FreezeStabilizationPolicyInput) (StabilizationPolicy, bool, error) {
	if s == nil || s.auth == nil || s.repo == nil || input.ProjectID == "" || input.ProgramID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 || !input.Thresholds.Valid() {
		return StabilizationPolicy{}, false, ErrInvalid
	}
	if _, err := s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityAssessReadiness); err != nil {
		return StabilizationPolicy{}, false, err
	}
	return s.repo.FreezeStabilizationPolicy(ctx, FreezeStabilizationPolicyCommand{Input: input, ActorID: actor.ID, RequestDigest: digest(input)})
}

func (s *StabilizationService) Observe(ctx context.Context, actor Actor, input RecordStabilizationInput) (StabilizationObservation, bool, error) {
	if s == nil || s.auth == nil || s.repo == nil || input.ProjectID == "" || input.ProgramID == "" || input.IdempotencyKey == "" || input.ExpectedStateVersion < 1 || input.ExpectedAuthorityEpoch < 1 {
		return StabilizationObservation{}, false, ErrInvalid
	}
	policy, err := ParseDigest(input.ExpectedPolicyDigest)
	if err != nil {
		return StabilizationObservation{}, false, ErrInvalid
	}
	if _, err = s.auth.Authorize(ctx, actor, input.ProjectID, CapabilityAssessReadiness); err != nil {
		return StabilizationObservation{}, false, err
	}
	return s.repo.RecordStabilization(ctx, RecordStabilizationCommand{Input: input, ActorID: actor.ID, RequestDigest: digest(input), ExpectedPolicyDigest: policy})
}
