package analytics

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/jobtelemetry"
)

type Service struct {
	repository Repository
	objects    ObjectStore
	validator  *SchemaValidator
	now        func() time.Time
	ingested   metric.Int64Counter
	rejected   metric.Int64Counter
	jobs       metric.Int64Counter
}

func NewService(repository Repository, objects ObjectStore, validator ...*SchemaValidator) *Service {
	meter := otel.Meter("mosaic/analytics")
	ingested, _ := meter.Int64Counter("mosaic.analytics.events.ingested")
	rejected, _ := meter.Int64Counter("mosaic.analytics.events.rejected")
	jobs, _ := meter.Int64Counter("mosaic.analytics.jobs.processed")
	service := &Service{repository: repository, objects: objects, now: time.Now, ingested: ingested, rejected: rejected, jobs: jobs}
	if len(validator) > 0 {
		service.validator = validator[0]
	}
	return service
}

// ValidateRawEvent is the exact per-event validation the batch endpoint applies:
// canonical schema validation followed by Mosaic's semantic and minimization
// rules. It returns a stable permanent-rejection code, or an empty string when
// the event is accepted. Tests exercise this rather than reimplementing the path.
func (s *Service) ValidateRawEvent(raw []byte, sentAt, now time.Time) (Candidate, string) {
	if s.validator != nil {
		if err := s.validator.ValidateEvent(raw); err != nil {
			if strings.Contains(err.Error(), "additionalProperties") ||
				strings.Contains(err.Error(), "unevaluatedProperties") {
				return Candidate{}, RejectUnknownField
			}
			return Candidate{}, RejectSchemaInvalid
		}
	}
	var event Event
	if err := json.Unmarshal(raw, &event); err != nil {
		return Candidate{}, RejectSchemaInvalid
	}
	return ValidateEvent(event, sentAt, now)
}

func (s *Service) Ingest(ctx context.Context, rawKey string, batch Batch) (IngestionResponse, error) {
	ctx, span := otel.Tracer("mosaic/analytics").Start(ctx, "events.ingest")
	defer span.End()
	now := s.now().UTC()
	if batch.ContractVersion != ContractVersion || !validID(batch.BatchID) || len(batch.Events) == 0 || len(batch.Events) > MaxBatchEvents {
		return IngestionResponse{}, ErrInvalidBatch
	}
	sentAt, ok := ParseTimestamp(batch.SentAt)
	if !ok {
		return IngestionResponse{}, ErrInvalidBatch
	}
	seen := make(map[string]struct{}, len(batch.Events))
	results := make(map[string]EventResult, len(batch.Events))
	candidates := make([]Candidate, 0, len(batch.Events))
	orderedIDs := make([]string, 0, len(batch.Events))
	for _, raw := range batch.Events {
		var identity struct {
			EventID            string `json:"eventId"`
			EventSchemaVersion string `json:"eventSchemaVersion"`
		}
		if err := json.Unmarshal(raw, &identity); err != nil || !validID(identity.EventID) {
			return IngestionResponse{}, ErrInvalidBatch
		}
		if identity.EventSchemaVersion != EventSchemaVersion {
			return IngestionResponse{}, ErrInvalidBatch
		}
		eventID := identity.EventID
		orderedIDs = append(orderedIDs, eventID)
		if _, duplicate := seen[eventID]; duplicate {
			return IngestionResponse{}, ErrInvalidBatch
		}
		seen[eventID] = struct{}{}
		if len(raw) > MaxEventBytes {
			results[eventID] = EventResult{EventID: eventID, Status: "permanently_rejected", Code: "event_too_large"}
			continue
		}
		candidate, code := s.ValidateRawEvent(raw, sentAt, now)
		if code != "" {
			results[eventID] = EventResult{EventID: eventID, Status: "permanently_rejected", Code: code}
			continue
		}
		var canonical any
		_ = json.Unmarshal(raw, &canonical)
		candidate.Raw, _ = json.Marshal(canonical)
		candidate.Digest = sha256.Sum256(candidate.Raw)
		candidates = append(candidates, candidate)
	}
	scope, err := s.repository.AuthenticateSDKKey(ctx, rawKey)
	if err != nil {
		span.RecordError(err)
		return IngestionResponse{}, err
	}
	settings, err := s.repository.Settings(ctx, scope.ProjectID, scope.EnvironmentID)
	if err != nil {
		return IngestionResponse{}, err
	}
	if !settings.CollectionEnabled {
		return IngestionResponse{}, ErrCollectionDisabled
	}
	if len(candidates) > 0 {
		persisted, err := s.repository.Ingest(ctx, scope, batch.BatchID, candidates, now)
		if err != nil {
			span.RecordError(err)
			zerolog.Ctx(ctx).Error().Err(err).Str("project_id", scope.ProjectID).Str("environment_id", scope.EnvironmentID).Msg("analytics event persistence failed")
			for _, candidate := range candidates {
				results[candidate.Event.EventID] = EventResult{EventID: candidate.Event.EventID, Status: "retryable", Code: "storage_temporarily_unavailable"}
			}
		} else {
			for id, result := range persisted {
				results[id] = result
			}
		}
	}
	ordered := make([]EventResult, 0, len(batch.Events))
	counts := map[string]int{}
	for _, eventID := range orderedIDs {
		result := results[eventID]
		ordered = append(ordered, result)
		counts[result.Status]++
	}
	span.SetAttributes(attribute.Int("analytics.batch.events", len(batch.Events)), attribute.Int("analytics.accepted", counts["accepted"]), attribute.Int("analytics.duplicate", counts["duplicate"]), attribute.Int("analytics.rejected", counts["permanently_rejected"]))
	s.ingested.Add(ctx, int64(counts["accepted"]+counts["duplicate"]), metric.WithAttributes(attribute.String("outcome", "durable")))
	s.rejected.Add(ctx, int64(counts["permanently_rejected"]), metric.WithAttributes(attribute.String("outcome", "permanent")))
	return IngestionResponse{ContractVersion: batch.ContractVersion, BatchID: batch.BatchID, ReceivedAt: now.Format("2006-01-02T15:04:05.000Z"), Results: ordered}, nil
}

func (s *Service) Settings(ctx context.Context, actor Actor, projectID, environmentID string) (Settings, error) {
	if actor.ID == "" {
		return Settings{}, ErrUnauthenticated
	}
	return s.repository.SettingsForActor(ctx, actor, projectID, environmentID)
}
func (s *Service) UpdateSettings(ctx context.Context, actor Actor, projectID, environmentID string, enabled bool, days int) (Settings, error) {
	if actor.ID == "" {
		return Settings{}, ErrUnauthenticated
	}
	if days < MinimumRetentionDays || days > MaximumRetentionDays {
		return Settings{}, ErrInvalidBatch
	}
	return s.repository.UpdateSettings(ctx, actor, projectID, environmentID, enabled, days)
}
func (s *Service) Query(ctx context.Context, actor Actor, query Query, metricIDs []string) (AnalyticsResult, error) {
	if actor.ID == "" {
		return AnalyticsResult{}, ErrUnauthenticated
	}
	if query.From.IsZero() || !query.To.After(query.From) || query.To.Sub(query.From) > 366*24*time.Hour || query.Basis != "event_count" {
		return AnalyticsResult{}, ErrInvalidBatch
	}
	if _, err := time.LoadLocation(query.Timezone); err != nil {
		return AnalyticsResult{}, ErrInvalidBatch
	}
	return s.repository.Query(ctx, actor, query, metricIDs)
}

// DailySeries reads completed UTC-day aggregate buckets for the named metrics.
//
// The range is interpreted as whole UTC days and is expected to end at the
// current midnight: the bucket for the day in progress is half-built, and this
// method deliberately serves it as written rather than pretending otherwise, so
// callers that care must not ask for it. Metric identifiers are required — an
// unbounded series over every metric Mosaic defines is not a chart, it is a
// table scan.
func (s *Service) DailySeries(ctx context.Context, actor Actor, query Query, metricIDs []string) (DailySeriesResult, error) {
	if actor.ID == "" {
		return DailySeriesResult{}, ErrUnauthenticated
	}
	if len(metricIDs) == 0 {
		return DailySeriesResult{}, ErrInvalidBatch
	}
	if query.From.IsZero() || !query.To.After(query.From) || query.To.Sub(query.From) > 366*24*time.Hour {
		return DailySeriesResult{}, ErrInvalidBatch
	}
	return s.repository.DailySeries(ctx, actor, query, metricIDs)
}
func (s *Service) PreviewIdentity(ctx context.Context, actor Actor, projectID, kind, identity string) (PrivacyPreview, error) {
	if actor.ID == "" {
		return PrivacyPreview{}, ErrUnauthenticated
	}
	if kind != "application_user" && kind != "installation" ||
		kind == "application_user" && (!validApplicationUserID(identity) || looksSensitive(identity)) ||
		kind == "installation" && !validID(identity) {
		return PrivacyPreview{}, ErrInvalidBatch
	}
	preview, _, err := s.repository.PreviewIdentity(ctx, actor, projectID, kind, identity)
	return preview, err
}
func (s *Service) CreateUserExport(ctx context.Context, actor Actor, projectID, kind, identity, format string) (JobResponse, error) {
	if actor.ID == "" {
		return JobResponse{}, ErrUnauthenticated
	}
	if format != "ndjson" && format != "csv" {
		return JobResponse{}, ErrInvalidBatch
	}
	preview, reference, err := s.repository.PreviewIdentity(ctx, actor, projectID, kind, identity)
	if err != nil {
		return JobResponse{}, err
	}
	job, err := s.repository.CreateExport(ctx, actor, projectID, "", kind, reference, format, s.now().UTC(), s.now().UTC().Add(ExportRetention))
	_ = preview
	return job.Response(), err
}
func (s *Service) CreateEventExport(ctx context.Context, actor Actor, projectID, environmentID, format string, from, to time.Time) (JobResponse, error) {
	if actor.ID == "" {
		return JobResponse{}, ErrUnauthenticated
	}
	if format != "ndjson" && format != "csv" || !to.After(from) {
		return JobResponse{}, ErrInvalidBatch
	}
	job, err := s.repository.CreateExport(ctx, actor, projectID, environmentID, "events", from.UTC().Format(time.RFC3339Nano)+"/"+to.UTC().Format(time.RFC3339Nano), format, s.now().UTC(), s.now().UTC().Add(ExportRetention))
	return job.Response(), err
}
func (s *Service) CreateExperimentExport(ctx context.Context, actor Actor, projectID, environmentID, experimentID, format string, includeIdentity bool) (JobResponse, error) {
	if actor.ID == "" {
		return JobResponse{}, ErrUnauthenticated
	}
	if format != "ndjson" && format != "csv" || experimentID == "" {
		return JobResponse{}, ErrInvalidBatch
	}
	reference := experimentID + "|false"
	if includeIdentity {
		reference = experimentID + "|true"
	}
	job, err := s.repository.CreateExport(ctx, actor, projectID, environmentID, "experiment", reference, format, s.now().UTC(), s.now().UTC().Add(ExportRetention))
	return job.Response(), err
}
func (s *Service) CreateDeletion(ctx context.Context, actor Actor, projectID, kind, identity, requestDigest string) (JobResponse, error) {
	if actor.ID == "" {
		return JobResponse{}, ErrUnauthenticated
	}
	preview, reference, err := s.repository.PreviewIdentity(ctx, actor, projectID, kind, identity)
	if err != nil {
		return JobResponse{}, err
	}
	if requestDigest != "" && requestDigest != preview.RequestDigest {
		return JobResponse{}, ErrConflict
	}
	job, err := s.repository.CreateDeletion(ctx, actor, projectID, kind, reference, preview.RequestDigest, s.now().UTC())
	return job.Response(), err
}
func (s *Service) Job(ctx context.Context, actor Actor, projectID, jobID string) (JobResponse, error) {
	if actor.ID == "" {
		return JobResponse{}, ErrUnauthenticated
	}
	j, e := s.repository.Job(ctx, actor, projectID, jobID)
	return j.Response(), e
}
func (s *Service) Download(ctx context.Context, actor Actor, projectID, jobID string) (io.ReadCloser, string, error) {
	if actor.ID == "" {
		return nil, "", ErrUnauthenticated
	}
	job, err := s.repository.Job(ctx, actor, projectID, jobID)
	if err != nil {
		return nil, "", err
	}
	if job.Status != "completed" || job.ObjectKey == "" || job.ExpiresAt == nil || !job.ExpiresAt.After(s.now()) {
		return nil, "", ErrNotFound
	}
	if s.objects == nil {
		return nil, "", ErrTemporarilyUnavailable
	}
	reader, err := s.objects.Open(ctx, job.ObjectKey)
	return reader, job.MediaType, err
}

func (s *Service) ProcessNextJob(ctx context.Context, workerID string) (bool, error) {
	now := s.now().UTC()
	lease := now.Add(2 * time.Minute)
	if job, ok, err := s.repository.LeaseAggregation(ctx, workerID, now, lease); err != nil {
		return false, err
	} else if ok {
		return true, s.runJob(ctx, job, func() error { return s.repository.RunAggregation(ctx, job, now) })
	}
	if job, ok, err := s.repository.LeaseDeletion(ctx, workerID, now, lease); err != nil {
		return false, err
	} else if ok {
		return true, s.runJob(ctx, job, func() error { _, err := s.repository.RunDeletion(ctx, job, now); return err })
	}
	if job, ok, err := s.repository.LeaseRetention(ctx, workerID, now, lease); err != nil {
		return false, err
	} else if ok {
		return true, s.runJob(ctx, job, func() error { _, err := s.repository.RunRetention(ctx, job, now, 1000); return err })
	}
	if job, ok, err := s.repository.LeaseExport(ctx, workerID, now, lease); err != nil {
		return false, err
	} else if ok {
		jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
			JobID: job.ID, JobKind: job.Kind, ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID,
		})
		return true, s.processExport(ctx, job, now)
	}
	return false, nil
}

// jobFailureBudget bounds the detached write that records a job failure.
const jobFailureBudget = 10 * time.Second

func (s *Service) runJob(ctx context.Context, job Job, operation func() error) error {
	ctx, span := otel.Tracer("mosaic/analytics").Start(ctx, "analytics."+job.Kind)
	defer span.End()
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: job.ID, JobKind: job.Kind, ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID,
	})
	if err := operation(); err != nil {
		span.RecordError(err)
		// The failure record must land even when the run context was cancelled
		// mid-job by a shutdown signal; otherwise the lease silently expires and
		// the job looks like it never ran.
		failureContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), jobFailureBudget)
		defer cancel()
		if failErr := s.repository.FailJob(failureContext, job, "job_failed", s.now().UTC()); failErr != nil {
			zerolog.Ctx(ctx).Error().Err(failErr).Str("job_id", job.ID).Str("job_kind", job.Kind).
				Msg("analytics job failure record could not be committed")
		}
		return err
	}
	s.jobs.Add(ctx, 1, metric.WithAttributes(attribute.String("kind", job.Kind), attribute.String("outcome", "completed")))
	return nil
}
func (s *Service) processExport(ctx context.Context, job Job, now time.Time) error {
	if s.objects == nil {
		return s.repository.FailJob(ctx, job, "object_store_unavailable", now)
	}
	temporary, err := os.CreateTemp("", "mosaic-analytics-export-*")
	if err != nil {
		return s.repository.FailJob(ctx, job, "export_temporarily_unavailable", now)
	}
	name := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(name)
	}()
	rows, err := s.repository.ExportRows(ctx, job, temporary)
	if err != nil {
		return s.repository.FailJob(ctx, job, "export_failed", now)
	}
	info, err := temporary.Stat()
	if err != nil {
		return s.repository.FailJob(ctx, job, "export_temporarily_unavailable", now)
	}
	if _, err = temporary.Seek(0, io.SeekStart); err != nil {
		return s.repository.FailJob(ctx, job, "export_temporarily_unavailable", now)
	}
	media := "application/x-ndjson"
	if job.Format == "csv" {
		media = "text/csv"
	}
	key := fmt.Sprintf("analytics-exports/%s/%s.%s", job.ProjectID, job.ID, job.Format)
	if err := s.objects.Put(ctx, key, temporary, info.Size(), media); err != nil {
		return s.repository.FailJob(ctx, job, "object_store_unavailable", now)
	}
	return s.repository.CompleteExport(ctx, job, key, media, info.Size(), rows, now, now.Add(ExportRetention))
}

func RequestDigest(projectID, kind, identity string) string {
	value := sha256.Sum256([]byte("mosaic-privacy-v1\x00" + projectID + "\x00" + kind + "\x00" + identity))
	return hex.EncodeToString(value[:])
}
func IsKnownError(err error) bool {
	return errors.Is(err, ErrUnauthenticated) || errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrCollectionDisabled) || errors.Is(err, ErrInvalidBatch) || errors.Is(err, ErrRateLimited) || errors.Is(err, ErrConflict)
}
