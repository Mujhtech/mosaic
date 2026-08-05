package analytics

import (
	"context"
	"io"
	"time"
)

type Repository interface {
	AuthenticateSDKKey(context.Context, string) (Scope, error)
	Settings(context.Context, string, string) (Settings, error)
	SettingsForActor(context.Context, Actor, string, string) (Settings, error)
	UpdateSettings(context.Context, Actor, string, string, bool, int) (Settings, error)
	Ingest(context.Context, Scope, string, []Candidate, time.Time) (map[string]EventResult, error)
	Query(context.Context, Actor, Query, []string) (AnalyticsResult, error)
	DailySeries(context.Context, Actor, Query, []string) (DailySeriesResult, error)
	PreviewIdentity(context.Context, Actor, string, string, string) (PrivacyPreview, string, error)
	CreateExport(context.Context, Actor, string, string, string, string, string, time.Time, time.Time) (Job, error)
	CreateDeletion(context.Context, Actor, string, string, string, string, time.Time) (Job, error)
	Job(context.Context, Actor, string, string) (Job, error)
	LeaseAggregation(context.Context, string, time.Time, time.Time) (Job, bool, error)
	RunAggregation(context.Context, Job, time.Time) error
	LeaseExport(context.Context, string, time.Time, time.Time) (Job, bool, error)
	ExportRows(context.Context, Job, io.Writer) (int64, error)
	CompleteExport(context.Context, Job, string, string, int64, int64, time.Time, time.Time) error
	LeaseDeletion(context.Context, string, time.Time, time.Time) (Job, bool, error)
	RunDeletion(context.Context, Job, time.Time) (bool, error)
	LeaseRetention(context.Context, string, time.Time, time.Time) (Job, bool, error)
	RunRetention(context.Context, Job, time.Time, int) (bool, error)
	FailJob(context.Context, Job, string, time.Time) error
}

type ObjectStore interface {
	Put(context.Context, string, io.Reader, int64, string) error
	Open(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}
