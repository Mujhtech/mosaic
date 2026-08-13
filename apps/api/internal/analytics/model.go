package analytics

import (
	"encoding/json"
	"time"
)

const (
	// ContractVersion is the only Analytics Event ingestion contract version
	// (ADR-0028: one version per contract until GA).
	ContractVersion = "2"
	// EventSchemaVersion is the only event schema version.
	EventSchemaVersion   = "2"
	MaxBatchEvents       = 100
	MaxBatchBytes        = 512 << 10
	MaxEventBytes        = 32 << 10
	EventExpiry          = 7 * 24 * time.Hour
	FutureSkew           = 5 * time.Minute
	AttributionWindow    = 24 * time.Hour
	DefaultRetentionDays = 180
	MinimumRetentionDays = 30
	MaximumRetentionDays = 730
	AggregateRetention   = 24 * 30 * 24 * time.Hour
	AuditRetention       = 24 * 30 * 24 * time.Hour
	ExportRetention      = 7 * 24 * time.Hour
)

type Actor struct{ ID string }

type Batch struct {
	ContractVersion string            `json:"analyticsEventContractVersion"`
	BatchID         string            `json:"batchId"`
	SentAt          string            `json:"sentAt"`
	Events          []json.RawMessage `json:"events"`
}

type Event struct {
	EventID            string          `json:"eventId"`
	EventSchemaVersion string          `json:"eventSchemaVersion"`
	EventName          string          `json:"eventName"`
	OccurredAt         string          `json:"occurredAt"`
	QueuedAt           string          `json:"queuedAt"`
	Authority          string          `json:"authority"`
	Identity           Identity        `json:"identity"`
	SessionID          string          `json:"sessionId"`
	Context            EventContext    `json:"context"`
	Correlation        Correlation     `json:"correlation"`
	Attribution        Attribution     `json:"attribution"`
	Payload            json.RawMessage `json:"payload"`
}

type Identity struct {
	InstallationID    string `json:"installationId"`
	ApplicationUserID string `json:"applicationUserId,omitempty"`
	Generation        int64  `json:"generation"`
}

type EventContext struct {
	Platform                        string `json:"platform"`
	SDKFamily                       string `json:"sdkFamily"`
	SDKVersion                      string `json:"sdkVersion"`
	OperatingSystemVersion          string `json:"operatingSystemVersion,omitempty"`
	ApplicationVersion              string `json:"applicationVersion"`
	Locale                          string `json:"locale"`
	ConfigurationDeliveryVersion    string `json:"configurationDeliveryVersion,omitempty"`
	CommerceProviderContractVersion string `json:"commerceProviderContractVersion,omitempty"`
}

type Correlation struct {
	PlacementRequestID    string `json:"placementRequestId,omitempty"`
	PaywallPresentationID string `json:"paywallPresentationId,omitempty"`
	ProductLoadAttemptID  string `json:"productLoadAttemptId,omitempty"`
	PurchaseAttemptID     string `json:"purchaseAttemptId,omitempty"`
	RestoreAttemptID      string `json:"restoreAttemptId,omitempty"`
	ProviderOperationID   string `json:"providerOperationId,omitempty"`
	ProviderUpdateID      string `json:"providerUpdateId,omitempty"`
}

type Attribution struct {
	ConfigurationReleaseID      string `json:"configurationReleaseId,omitempty"`
	PlacementID                 string `json:"placementId,omitempty"`
	PlacementRuleSetID          string `json:"placementRuleSetId,omitempty"`
	PlacementRuleSetVersion     int64  `json:"placementRuleSetVersion,omitempty"`
	WinningRuleID               string `json:"winningRuleId,omitempty"`
	PaywallID                   string `json:"paywallId,omitempty"`
	PaywallVersionID            string `json:"paywallVersionId,omitempty"`
	ProductID                   string `json:"mosaicProductId,omitempty"`
	PlanID                      string `json:"planId,omitempty"`
	Provider                    string `json:"providerId,omitempty"`
	ProviderMappingID           string `json:"providerProductMappingId,omitempty"`
	ExperimentID                string `json:"experimentId,omitempty"`
	ExperimentVersionID         string `json:"experimentVersionId,omitempty"`
	ExperimentVariantID         string `json:"experimentVariantId,omitempty"`
	ExperimentAllocationVersion string `json:"experimentAllocationVersion,omitempty"`
}

type Scope struct {
	APIKeyID, OrganizationID, ProjectID, EnvironmentID, EnvironmentMode, ApplicationID string
}

type EventResult struct {
	EventID           string `json:"eventId"`
	Status            string `json:"status"`
	Code              string `json:"code,omitempty"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

type IngestionResponse struct {
	ContractVersion string        `json:"analyticsEventContractVersion"`
	BatchID         string        `json:"batchId"`
	ReceivedAt      string        `json:"receivedAt"`
	Results         []EventResult `json:"results"`
}

type Candidate struct {
	Event                                               Event
	Raw                                                 json.RawMessage
	Digest                                              [32]byte
	OccurredAt, QueuedAt, SentAt, ReceivedAt, ExpiresAt time.Time
}

type Settings struct {
	ProjectID         string    `json:"projectId"`
	EnvironmentID     string    `json:"environmentId"`
	CollectionEnabled bool      `json:"collectionEnabled"`
	RawRetentionDays  int       `json:"rawRetentionDays"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type Query struct {
	ProjectID, EnvironmentID                              string
	From, To                                              time.Time
	Timezone, Basis, Platform, Locale, ApplicationVersion string
}

type Freshness struct {
	LatestReceivedAt   *time.Time `json:"latestReceivedAt,omitempty"`
	LatestAggregatedAt *time.Time `json:"latestAggregatedAt,omitempty"`
	LateEventPolicy    string     `json:"lateEventPolicy"`
}

type Metric struct {
	ID                string            `json:"id"`
	Value             *float64          `json:"value,omitempty"`
	Numerator         int64             `json:"numerator"`
	Denominator       *int64            `json:"denominator,omitempty"`
	Basis             string            `json:"basis"`
	Authority         string            `json:"authority"`
	AttributionWindow string            `json:"attributionWindow"`
	Timezone          string            `json:"timezone"`
	Definition        string            `json:"definition"`
	Warnings          []string          `json:"warnings,omitempty"`
	Dimensions        map[string]string `json:"dimensions,omitempty"`
}

type AnalyticsResult struct {
	Metrics   []Metric  `json:"metrics"`
	Freshness Freshness `json:"freshness"`
}

// DailyMetricPoint is one metric's completed UTC-day aggregate bucket.
//
// The numerator and denominator are carried rather than a computed value on
// purpose. A rate whose denominator is zero has no value at all, and only a
// caller holding both halves can tell that apart from a rate of zero; folding
// the division in here would force every consumer to read 0% as a measurement.
type DailyMetricPoint struct {
	// Date is the bucket's UTC midnight.
	Date        time.Time
	MetricID    string
	Numerator   int64
	Denominator *int64
}

// DailySeriesResult is the per-day read over completed daily buckets.
//
// It never falls back to raw events: the caller decides what to do about a day
// the aggregation job has not finished, because only the caller knows whether
// it wants a live partial reading or nothing at all.
type DailySeriesResult struct {
	Points    []DailyMetricPoint
	Freshness Freshness
}

type PrivacyPreview struct {
	Kind                   string   `json:"kind"`
	AffectedEvents         int64    `json:"affectedEvents"`
	AffectedSessions       int64    `json:"affectedSessions"`
	AffectedEnvironmentIDs []string `json:"affectedEnvironmentIds"`
	RequestDigest          string   `json:"requestDigest"`
}

type Job struct {
	ID, ProjectID, EnvironmentID, Kind, Status, Format             string
	IdentityKind                                                   string
	IdentityReferenceID                                            string
	IdentityDigest                                                 [32]byte
	ObjectKey, MediaType, LastErrorCode                            string
	ByteLength, RowCount, AffectedEventCount, AffectedSessionCount int64
	RequestedByActorID, ConfirmedByActorID                         string
	ExperimentVersionID                                            string
	IncludeIdentity                                                bool
	CreatedAt, UpdatedAt                                           time.Time
	BucketDate                                                     time.Time
	ExpiresAt, CompletedAt                                         *time.Time
}

type JobResponse struct {
	ID                   string     `json:"id"`
	Kind                 string     `json:"kind"`
	Status               string     `json:"status"`
	Format               string     `json:"format,omitempty"`
	RowCount             int64      `json:"rowCount,omitempty"`
	ByteLength           int64      `json:"byteLength,omitempty"`
	AffectedEventCount   int64      `json:"affectedEventCount,omitempty"`
	AffectedSessionCount int64      `json:"affectedSessionCount,omitempty"`
	ExpiresAt            *time.Time `json:"expiresAt,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

func (j Job) Response() JobResponse {
	return JobResponse{ID: j.ID, Kind: j.Kind, Status: j.Status, Format: j.Format, RowCount: j.RowCount, ByteLength: j.ByteLength, AffectedEventCount: j.AffectedEventCount, AffectedSessionCount: j.AffectedSessionCount, ExpiresAt: j.ExpiresAt, CreatedAt: j.CreatedAt, UpdatedAt: j.UpdatedAt}
}
