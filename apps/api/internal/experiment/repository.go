package experiment

import (
	"context"
	"time"
)

type Scope struct{ OrganizationID, ProjectID, EnvironmentID, EnvironmentMode, Role string }
type RevisionRecord struct {
	Draft                         Draft
	Document                      DraftDocument
	Validation                    ValidationResult
	MutationDigest, RequestDigest []byte
}
type PublishInput struct {
	Experiment Experiment
	Draft      Draft
	Document   DraftDocument
	Validation ValidationResult
	Digest     []byte
	ActorID    string
	Now        time.Time
}
type PublishOutput struct {
	Version   VersionResponse
	ReleaseID string
}

type Repository interface {
	Scope(context.Context, Actor, string, string) (Scope, error)
	Create(context.Context, Scope, Actor, string, string, string, DraftDocument, ValidationResult, []byte, []byte, time.Time) (Experiment, DraftResource, error)
	List(context.Context, Scope) ([]Experiment, error)
	Get(context.Context, Scope, string) (Experiment, *RevisionRecord, *VersionResponse, error)
	UpdateDraft(context.Context, Scope, Actor, string, int64, []byte, []byte, DraftDocument, ValidationResult, time.Time) (DraftResource, error)
	Publish(context.Context, Scope, PublishInput) (PublishOutput, error)
	Transition(context.Context, Scope, Actor, string, string, string, time.Time) (Experiment, string, error)
	Versions(context.Context, Scope, string) ([]VersionResponse, error)
	History(context.Context, Scope, string) ([]HistoryEntry, error)
	Metrics(context.Context) ([]MetricDefinition, error)
	Aggregates(context.Context, Scope, string) (Experiment, VersionResponse, []VariantAggregate, error)
	GuardrailAggregates(context.Context, Scope, string) ([]GuardrailAggregate, error)
	Groups(context.Context, Scope) ([]Group, error)
	CreateGroup(context.Context, Scope, Actor, CreateGroupInput, time.Time) (GroupCreated, error)
	CreateGroupVersion(context.Context, Scope, Actor, string, CreateGroupInput, time.Time) (GroupVersion, error)
	GroupVersions(context.Context, Scope, string) ([]GroupVersion, error)
	CreateOverride(context.Context, Scope, Actor, string, string, string, string, string, []byte, time.Time, time.Time) (QAOverride, error)
	Overrides(context.Context, Scope, string, time.Time) ([]QAOverride, error)
	RevokeOverride(context.Context, Scope, Actor, string, string, time.Time) error
	LeaseSchedule(context.Context, string, time.Time, time.Time) (ScheduleJob, bool, error)
	FinishSchedule(context.Context, string, bool, time.Time) error
}
