package experiment

import (
	"encoding/json"
	"time"
)

const (
	AssignmentContractVersion = "1"
	BucketingAlgorithm        = "experiment_sha256_length_prefixed_v1"
	GroupBucketingAlgorithm   = "experiment_group_sha256_length_prefixed_v1"
)

type Actor struct{ ID string }

type Experiment struct {
	ID, ProjectID, EnvironmentID, PlacementID string
	Name, Hypothesis, State                   string
	CurrentDraftID, ActiveVersionID           string
	CreatedByActorID, UpdatedByActorID        string
	CreatedAt, UpdatedAt                      time.Time
	ArchivedAt                                *time.Time
}

type ExperimentResponse struct {
	ID            string           `json:"id"`
	ProjectID     string           `json:"projectId"`
	EnvironmentID string           `json:"environmentId"`
	PlacementID   string           `json:"placementId"`
	Name          string           `json:"name"`
	Hypothesis    string           `json:"hypothesis,omitempty"`
	State         string           `json:"state"`
	CurrentDraft  *DraftResource   `json:"currentDraft,omitempty"`
	ActiveVersion *VersionResponse `json:"activeVersion,omitempty"`
	Role          string           `json:"role"`
	Permissions   []string         `json:"permissions"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
	ArchivedAt    *time.Time       `json:"archivedAt,omitempty"`
}

type Draft struct {
	ID, ExperimentID, ProjectID, EnvironmentID string
	Revision                                   int64
	Status, UpdatedByActorID                   string
	CreatedAt, UpdatedAt                       time.Time
}

type VariantDraft struct {
	ID                    string `json:"id,omitempty"`
	Role                  string `json:"role"`
	Name                  string `json:"name"`
	PaywallID             string `json:"paywallId"`
	PaywallVersionID      string `json:"paywallVersionId"`
	AllocationBasisPoints int    `json:"allocationBasisPoints"`
}

type Schedule struct {
	StartsAt *time.Time `json:"startsAt,omitempty"`
	EndsAt   *time.Time `json:"endsAt,omitempty"`
}

type QAPolicy struct {
	Enabled bool `json:"enabled"`
}

type DraftDocument struct {
	Variants                      []VariantDraft `json:"variants"`
	AssignmentKeyPolicy           string         `json:"assignmentKeyPolicy"`
	PrimaryMetricVersionID        string         `json:"primaryMetricVersionId"`
	GuardrailMetricVersionIDs     []string       `json:"guardrailMetricVersionIds"`
	Schedule                      Schedule       `json:"schedule"`
	MutualExclusionGroupVersionID string         `json:"mutualExclusionGroupVersionId,omitempty"`
	QAPolicy                      QAPolicy       `json:"qaPolicy"`
}

type ValidationIssue struct {
	Code, Severity, Message, ResourceID, RecoveryAction string
}

func (i ValidationIssue) MarshalJSON() ([]byte, error) {
	type wire struct {
		Code           string `json:"code"`
		Severity       string `json:"severity"`
		Message        string `json:"message"`
		ResourceID     string `json:"resourceId,omitempty"`
		RecoveryAction string `json:"recoveryAction"`
	}
	return json.Marshal(wire{i.Code, i.Severity, i.Message, i.ResourceID, i.RecoveryAction})
}

type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Issues []ValidationIssue `json:"issues"`
}

type DraftResource struct {
	ID         string           `json:"id"`
	Revision   int64            `json:"revision"`
	Status     string           `json:"status"`
	Document   DraftDocument    `json:"document"`
	Validation ValidationResult `json:"validation"`
	UpdatedAt  time.Time        `json:"updatedAt"`
	ETag       string           `json:"-"`
}

type VersionResponse struct {
	ID, ExperimentID, PlacementID, AssignmentKeyPolicy, BucketingAlgorithm string
	VersionNumber, SourceRevision                                          int64
	AllocationVersion                                                      string
	Variants                                                               []VariantResponse
	PrimaryMetricVersionID                                                 string
	GuardrailMetricVersionIDs                                              []string
	Schedule                                                               Schedule
	MutualExclusionGroupVersionID                                          string
	PublishedAt                                                            time.Time
}

func (v VersionResponse) MarshalJSON() ([]byte, error) {
	type wire struct {
		ID                            string            `json:"id"`
		ExperimentID                  string            `json:"experimentId"`
		PlacementID                   string            `json:"placementId"`
		VersionNumber                 int64             `json:"versionNumber"`
		SourceRevision                int64             `json:"sourceRevision"`
		AssignmentKeyPolicy           string            `json:"assignmentKeyPolicy"`
		BucketingAlgorithm            string            `json:"bucketingAlgorithm"`
		AllocationVersion             string            `json:"allocationVersion"`
		Variants                      []VariantResponse `json:"variants"`
		PrimaryMetricVersionID        string            `json:"primaryMetricVersionId"`
		GuardrailMetricVersionIDs     []string          `json:"guardrailMetricVersionIds"`
		Schedule                      Schedule          `json:"schedule"`
		MutualExclusionGroupVersionID string            `json:"mutualExclusionGroupVersionId,omitempty"`
		PublishedAt                   time.Time         `json:"publishedAt"`
	}
	return json.Marshal(wire{v.ID, v.ExperimentID, v.PlacementID, v.VersionNumber, v.SourceRevision, v.AssignmentKeyPolicy, v.BucketingAlgorithm, v.AllocationVersion, v.Variants, v.PrimaryMetricVersionID, v.GuardrailMetricVersionIDs, v.Schedule, v.MutualExclusionGroupVersionID, v.PublishedAt})
}

type VariantResponse struct {
	ID               string `json:"id"`
	Role             string `json:"role"`
	Name             string `json:"name"`
	PaywallID        string `json:"paywallId"`
	PaywallVersionID string `json:"paywallVersionId"`
	AllocationStart  int    `json:"allocationStart"`
	AllocationEnd    int    `json:"allocationEnd"`
}

type MetricDefinition struct {
	ID                       string            `json:"id"`
	Version                  int               `json:"version"`
	Name                     string            `json:"name"`
	NumeratorEvent           string            `json:"numeratorEvent"`
	DenominatorEvent         string            `json:"denominatorEvent"`
	AssignmentUnit           string            `json:"assignmentUnit"`
	Authority                string            `json:"authority"`
	Availability             string            `json:"availability"`
	EventFilter              map[string]string `json:"eventFilter"`
	AttributionWindowSeconds int               `json:"attributionWindowSeconds"`
	FreshnessSeconds         int               `json:"freshnessSeconds"`
	Definition               string            `json:"definition"`
	PrimaryEligible          bool              `json:"primaryEligible"`
	GuardrailEligible        bool              `json:"guardrailEligible"`
}

type HistoryEntry struct {
	ID        string    `json:"id"`
	FromState string    `json:"fromState"`
	ToState   string    `json:"toState"`
	Reason    string    `json:"reason,omitempty"`
	ReleaseID string    `json:"releaseId,omitempty"`
	ActorID   string    `json:"actorId"`
	CreatedAt time.Time `json:"createdAt"`
}

type QAOverride struct {
	ID                  string     `json:"id"`
	ExperimentVersionID string     `json:"experimentVersionId"`
	VariantID           string     `json:"variantId"`
	IdentityType        string     `json:"identityType"`
	SafeLabel           string     `json:"safeLabel"`
	SelectorDigest      string     `json:"selectorDigest,omitempty"`
	Status              string     `json:"status"`
	CreatedAt           time.Time  `json:"createdAt"`
	ExpiresAt           time.Time  `json:"expiresAt"`
	RevokedAt           *time.Time `json:"revokedAt,omitempty"`
}
type QAOverrideCreated struct {
	Override QAOverride `json:"override"`
	Token    string     `json:"token"`
}

type VariantAggregate struct {
	VariantID                                                                    string
	Role                                                                         string
	AllocationBasisPoints                                                        int
	UniqueExposures, UniqueConversions, RawExposureEvents, FallbackPresentations int64
	LatestReceivedAt                                                             *time.Time
}
type Interval struct {
	Lower float64 `json:"lower"`
	Upper float64 `json:"upper"`
}
type VariantResult struct {
	VariantID             string   `json:"variantId"`
	Role                  string   `json:"role"`
	AllocationBasisPoints int      `json:"allocationBasisPoints"`
	UniqueExposures       int64    `json:"uniqueExposures"`
	UniqueConversions     int64    `json:"uniqueConversions"`
	Estimate              float64  `json:"estimate"`
	Wilson95              Interval `json:"wilson95"`
	RawExposureEvents     int64    `json:"rawExposureEvents"`
	FallbackPresentations int64    `json:"fallbackPresentations"`
}
type LiftResult struct {
	TreatmentVariantID string   `json:"treatmentVariantId"`
	AbsoluteLift       float64  `json:"absoluteLift"`
	Newcombe95         Interval `json:"newcombe95"`
	RelativeLift       *float64 `json:"relativeLift,omitempty"`
}
type SRMCell struct {
	VariantID     string  `json:"variantId"`
	Observed      int64   `json:"observed"`
	Expected      float64 `json:"expected"`
	ObservedShare float64 `json:"observedShare"`
	ExpectedShare float64 `json:"expectedShare"`
}
type SRMResult struct {
	Status             string    `json:"status"`
	Severity           string    `json:"severity"`
	Statistic          float64   `json:"statistic"`
	DegreesOfFreedom   int       `json:"degreesOfFreedom"`
	PValue             float64   `json:"pValue"`
	Cells              []SRMCell `json:"cells"`
	Exclusions         []string  `json:"exclusions"`
	Explanation        string    `json:"explanation"`
	InvestigationSteps []string  `json:"investigationSteps"`
}
type Results struct {
	ExperimentID        string            `json:"experimentId"`
	ExperimentVersionID string            `json:"experimentVersionId"`
	State               string            `json:"state"`
	Interim             bool              `json:"interim"`
	Variants            []VariantResult   `json:"variants"`
	Lifts               []LiftResult      `json:"lifts"`
	SRM                 SRMResult         `json:"srm"`
	Freshness           *time.Time        `json:"freshness,omitempty"`
	Warnings            []string          `json:"warnings"`
	Guardrails          []GuardrailResult `json:"guardrails"`
}

type GuardrailAggregate struct {
	Definition MetricDefinition
	Variants   []VariantAggregate
}

type GuardrailVariantResult struct {
	VariantID        string  `json:"variantId"`
	Role             string  `json:"role"`
	DenominatorCount int64   `json:"denominatorCount"`
	NumeratorCount   int64   `json:"numeratorCount"`
	Rate             float64 `json:"rate"`
}

type GuardrailMaturity struct {
	Status                    string `json:"status"`
	MinimumVariantDenominator int64  `json:"minimumVariantDenominator"`
	AttributionWindowClosed   bool   `json:"attributionWindowClosed"`
}

type GuardrailResult struct {
	MetricVersionID  string                   `json:"metricVersionId"`
	Name             string                   `json:"name"`
	Status           string                   `json:"status"`
	DenominatorCount int64                    `json:"denominatorCount"`
	NumeratorCount   int64                    `json:"numeratorCount"`
	Rate             float64                  `json:"rate"`
	Maturity         GuardrailMaturity        `json:"maturity"`
	Freshness        *time.Time               `json:"freshness,omitempty"`
	Variants         []GuardrailVariantResult `json:"variants"`
}

type Group struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Status          string    `json:"status"`
	ActiveVersionID string    `json:"activeVersionId,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}
type GroupMemberInput struct {
	ExperimentID          string `json:"experimentId"`
	AllocationBasisPoints int    `json:"allocationBasisPoints"`
}
type CreateGroupInput struct {
	Name                string             `json:"name"`
	AssignmentKeyPolicy string             `json:"assignmentKeyPolicy"`
	Members             []GroupMemberInput `json:"members"`
	HoldoutBasisPoints  int                `json:"holdoutBasisPoints"`
}
type GroupVersion struct {
	ID                  string             `json:"id"`
	GroupID             string             `json:"groupId"`
	VersionNumber       int                `json:"versionNumber"`
	AssignmentKeyPolicy string             `json:"assignmentKeyPolicy"`
	BucketingAlgorithm  string             `json:"bucketingAlgorithm"`
	Members             []GroupMemberInput `json:"members"`
	HoldoutBasisPoints  int                `json:"holdoutBasisPoints"`
	CreatedAt           time.Time          `json:"createdAt"`
}
type GroupCreated struct {
	Group   Group        `json:"group"`
	Version GroupVersion `json:"version"`
}
type ExportRequest struct {
	Format          string `json:"format"`
	IncludeIdentity bool   `json:"includeIdentity"`
}
type ScheduleJob struct {
	ID, ExperimentID, ProjectID, EnvironmentID, Action, ActorID string
	// AttemptCount is the attempt this lease represents (1 on first lease) and
	// MaxAttempts is the retry budget before the job is terminally failed.
	AttemptCount, MaxAttempts int
}
