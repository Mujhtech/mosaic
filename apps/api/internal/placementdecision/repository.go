package placementdecision

import (
	"context"
	"encoding/json"
	"time"
)

type Scope struct {
	ProjectID       string
	OrganizationID  string
	ProjectStatus   string
	Role            string
	EnvironmentID   string
	EnvironmentKey  string
	EnvironmentMode string
	PlacementID     string
	PlacementKey    string
	PlacementStatus string
}

type DraftRevision struct {
	DraftID       string
	RuleSetID     string
	ProjectID     string
	EnvironmentID string
	Revision      int64
	Document      json.RawMessage
	DocumentHash  string
	Validation    ValidationResult
	MutationHash  string
	RequestHash   string
	ActorID       string
	CreatedAt     time.Time
}

type AuditEvent struct {
	ID, ActorID, OrganizationID, ProjectID, EnvironmentID string
	Action, ResourceType, ResourceID                      string
	Metadata                                              map[string]string
	CreatedAt                                             time.Time
}

type Repository interface {
	View(context.Context, func(Reader) error) error
	Transact(context.Context, func(Transaction) error) error
}

type Reader interface {
	Scope(actorID, projectID, environmentID, placementID string) (Scope, bool)
	RuleSet(id string) (RuleSet, bool)
	RuleSetForPlacement(environmentID, placementID string) (RuleSet, bool)
	Draft(id string) (Draft, bool)
	DraftRevision(id string, revision int64) (DraftRevision, bool)
	DraftRevisionByMutation(id, mutationHash string) (DraftRevision, bool)
	Version(id string) (Version, bool)
	Versions(ruleSetID string) []Version
	AttributeScoped(key, projectID string) (AttributeDefinition, bool)
	Attributes(projectID string) []AttributeDefinition
	PaywallVersionScoped(id, projectID, environmentID string) bool
	ProductScoped(id, projectID string) bool
	EntitlementScoped(key, projectID string) bool
	Aliases(placementID string) []Alias
	Usage(placementID string) Usage
	OverrideScoped(id, projectID, environmentID, placementID string) (QAOverride, bool)
	Overrides(environmentID, placementID string, now time.Time) []QAOverride
}

type Transaction interface {
	Reader
	Lock(string)
	NextID(prefix string) string
	SaveRuleSet(RuleSet)
	SaveDraft(Draft)
	SaveDraftRevision(DraftRevision)
	SaveVersion(Version, []Rule)
	SaveAttribute(AttributeDefinition)
	ArchiveAttribute(id, projectID, actorID string, at time.Time) bool
	SaveAlias(Alias)
	ArchiveRuleSet(id, actorID string, at time.Time) bool
	ArchivePlacement(placementID, actorID string, at time.Time)
	SaveOverride(value QAOverride, selectorDigest, tokenDigest []byte)
	RevokeOverride(id, projectID, environmentID, placementID, actorID string, at time.Time) bool
	SaveAudit(AuditEvent)
}
