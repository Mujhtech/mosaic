package placementdecision

import (
	"encoding/json"
	"time"
)

const (
	ContractVersion    = "1"
	DeliveryVersion    = "2"
	BucketingAlgorithm = "sha256_length_prefixed_v1"
)

type Actor struct{ ID string }

type Outcome struct {
	Type                   string `json:"type"`
	PaywallVersionID       string `json:"paywallVersionId,omitempty"`
	FallbackKey            string `json:"key,omitempty"`
	UnavailableFallbackKey string `json:"unavailableFallbackKey,omitempty"`
	ReasonCode             string `json:"reason,omitempty"`
}

type TypedValue struct {
	Type  string `json:"type"`
	Value any    `json:"value,omitempty"`
}

type Source struct {
	Kind       string `json:"kind"`
	Key        string `json:"key,omitempty"`
	ProductID  string `json:"productId,omitempty"`
	Capability string `json:"capability,omitempty"`
}

type Condition struct {
	Type     string      `json:"type"`
	Children []Condition `json:"children,omitempty"`
	Child    *Condition  `json:"child,omitempty"`
	Source   Source      `json:"source,omitempty"`
	Operator string      `json:"operator,omitempty"`
	Value    *TypedValue `json:"operand,omitempty"`
}

type Rollout struct {
	Algorithm            string `json:"algorithm"`
	ThresholdBasisPoints int    `json:"thresholdBasisPoints"`
}

type Rule struct {
	ID        string    `json:"id"`
	Priority  int       `json:"priority"`
	Enabled   bool      `json:"enabled"`
	SafeLabel string    `json:"safeLabel,omitempty"`
	Condition Condition `json:"conditions"`
	Rollout   *Rollout  `json:"rollout,omitempty"`
	Outcome   Outcome   `json:"outcome"`
}

type Compatibility struct {
	RequiredFeatures            []string `json:"requiredFeatures"`
	RequiredBucketingAlgorithms []string `json:"bucketingAlgorithms"`
}

type Fallback struct {
	Key       string  `json:"key"`
	SafeLabel string  `json:"safeLabel,omitempty"`
	Outcome   Outcome `json:"outcome"`
}
type ContractAttributeDefinition struct {
	Key              string   `json:"key"`
	ValueType        string   `json:"type"`
	Sensitivity      string   `json:"sensitivity"`
	AllowedOperators []string `json:"allowedOperators"`
}
type PublishedOverride struct {
	ID             string  `json:"id"`
	SelectorDigest string  `json:"selectorDigest"`
	SafeLabel      string  `json:"safeLabel"`
	StartsAt       string  `json:"startsAt"`
	ExpiresAt      string  `json:"expiresAt"`
	Outcome        Outcome `json:"outcome"`
}

type Document struct {
	RuleSetID            string                        `json:"id"`
	Version              int64                         `json:"version"`
	ProjectID            string                        `json:"projectId"`
	EnvironmentID        string                        `json:"environmentId"`
	EnvironmentKey       string                        `json:"environmentKey"`
	PlacementID          string                        `json:"placementId"`
	PlacementKey         string                        `json:"placementKey"`
	Enabled              bool                          `json:"enabled"`
	AssignmentPolicy     string                        `json:"assignmentPolicy"`
	AttributeDefinitions []ContractAttributeDefinition `json:"attributeDefinitions"`
	DefaultOutcome       Outcome                       `json:"defaultOutcome"`
	Fallbacks            []Fallback                    `json:"fallbacks"`
	Rules                []Rule                        `json:"rules"`
	QAOverrides          []PublishedOverride           `json:"qaOverrides"`
	Compatibility        Compatibility                 `json:"compatibility"`
}

type DecisionEnvelope struct {
	PlacementDecisionVersion string   `json:"placementDecisionVersion"`
	RuleSet                  Document `json:"ruleSet"`
}

type ValidationIssue struct {
	Severity       string `json:"severity"`
	Code           string `json:"code"`
	RuleID         string `json:"ruleId,omitempty"`
	ConditionPath  string `json:"conditionPath,omitempty"`
	ResourceType   string `json:"resourceType,omitempty"`
	ResourceID     string `json:"resourceId,omitempty"`
	RecoveryAction string `json:"recoveryAction"`
}

type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Issues []ValidationIssue `json:"issues"`
}

type RuleSet struct {
	ID                        string     `json:"id"`
	ProjectID                 string     `json:"projectId"`
	EnvironmentID             string     `json:"environmentId"`
	PlacementID               string     `json:"placementId"`
	ContractVersion           string     `json:"contractVersion"`
	Status                    string     `json:"status"`
	CurrentDraftID            string     `json:"currentDraftId,omitempty"`
	CurrentPublishedVersionID string     `json:"currentPublishedVersionId,omitempty"`
	CreatedByActorID          string     `json:"createdByActorId"`
	CreatedAt                 time.Time  `json:"createdAt"`
	UpdatedAt                 time.Time  `json:"updatedAt"`
	ArchivedAt                *time.Time `json:"archivedAt,omitempty"`
}

type Draft struct {
	ID               string    `json:"id"`
	RuleSetID        string    `json:"ruleSetId"`
	ProjectID        string    `json:"projectId"`
	EnvironmentID    string    `json:"environmentId"`
	Status           string    `json:"status"`
	CurrentRevision  int64     `json:"revision"`
	SourceVersionID  string    `json:"sourceVersionId,omitempty"`
	CreatedByActorID string    `json:"createdByActorId"`
	UpdatedByActorID string    `json:"updatedByActorId"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type DraftResource struct {
	RuleSet    RuleSet          `json:"ruleSet"`
	Draft      Draft            `json:"draft"`
	Document   json.RawMessage  `json:"document"`
	Validation ValidationResult `json:"validation"`
	ETag       string           `json:"-"`
}

type Version struct {
	ID                 string           `json:"id"`
	RuleSetID          string           `json:"ruleSetId"`
	ProjectID          string           `json:"projectId"`
	EnvironmentID      string           `json:"environmentId"`
	PlacementID        string           `json:"placementId"`
	VersionNumber      int64            `json:"versionNumber"`
	SourceDraftID      string           `json:"sourceDraftId"`
	SourceRevision     int64            `json:"sourceRevision"`
	ContractVersion    string           `json:"contractVersion"`
	Document           json.RawMessage  `json:"document"`
	DocumentHash       string           `json:"documentHash"`
	Validation         ValidationResult `json:"validation"`
	PublishedByActorID string           `json:"publishedByActorId"`
	PublishedAt        time.Time        `json:"publishedAt"`
}

type AttributeDefinition struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	Key              string     `json:"key"`
	ValueType        string     `json:"type"`
	Description      string     `json:"description"`
	AllowedOperators []string   `json:"allowedOperators"`
	Sensitivity      string     `json:"sensitivity"`
	Status           string     `json:"status"`
	Revision         int64      `json:"revision"`
	CreatedByActorID string     `json:"createdByActorId"`
	UpdatedByActorID string     `json:"updatedByActorId"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
	ArchivedAt       *time.Time `json:"archivedAt,omitempty"`
}

type Alias struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	PlacementID      string     `json:"placementId"`
	Key              string     `json:"key"`
	Status           string     `json:"status"`
	CreatedByActorID string     `json:"createdByActorId"`
	CreatedAt        time.Time  `json:"createdAt"`
	ArchivedAt       *time.Time `json:"archivedAt,omitempty"`
}

type Usage struct {
	RuleSetCount       int `json:"ruleSetCount"`
	AliasCount         int `json:"aliasCount"`
	PublishedRuleCount int `json:"publishedRuleCount"`
}

type QAOverride struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	EnvironmentID    string     `json:"environmentId"`
	PlacementID      string     `json:"placementId"`
	SafeLabel        string     `json:"safeLabel"`
	SelectorDigest   string     `json:"selectorDigest,omitempty"`
	Outcome          Outcome    `json:"outcome"`
	Status           string     `json:"status"`
	CreatedByActorID string     `json:"createdByActorId"`
	CreatedAt        time.Time  `json:"createdAt"`
	ExpiresAt        time.Time  `json:"expiresAt"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
}

type QAOverrideCreated struct {
	Override QAOverride `json:"override"`
	Token    string     `json:"token"`
}
