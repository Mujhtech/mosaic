package billingrestore

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	mathrand "math/rand/v2"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/jobtelemetry"
)

// restoreLease bounds how long one worker may hold a restore job. It is short
// on purpose: an attempt makes no external call, so a job held for minutes is a
// stuck worker rather than slow work.
const restoreLease = 60 * time.Second

// Backoff bounds. A restore is the one billing job a person is waiting on — the
// SDK polls three times over roughly six seconds before it reports
// validation_pending — so the first retries are seconds apart rather than the
// tens of seconds validation uses, and the ceiling is a minute rather than ten.
const (
	backoffBase = 2 * time.Second
	backoffCap  = 60 * time.Second
	// DefaultMaxAttempts spans roughly four minutes across the schedule below.
	// That comfortably outlasts a normal validate-then-project chain while
	// still ending: a restore that has not resolved in four minutes has an
	// answer, and the answer is the honest uncertain one.
	DefaultMaxAttempts = 12
)

// Service is the restore application service. It owns the job lifecycle, the
// outcome decision, and the guarantee that `restored` is never written without
// the snapshot that proves it.
type Service struct {
	repository Repository
	keys       KeyAuthenticator
	now        func() time.Time
	random     io.Reader
	jitter     *mathrand.Rand
	tracer     trace.Tracer

	outcomes     metric.Int64Counter
	chainLatency metric.Float64Histogram
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func WithRandom(random io.Reader) Option {
	return func(s *Service) {
		if random != nil {
			s.random = random
		}
	}
}

// WithJitter fixes the retry jitter source. Tests use it so a reschedule is
// reproducible; production leaves it nil and gets a per-process source.
func WithJitter(jitter *mathrand.Rand) Option {
	return func(s *Service) { s.jitter = jitter }
}

func NewService(repository Repository, keys KeyAuthenticator, options ...Option) *Service {
	meter := otel.Meter("mosaic/billingrestore")
	service := &Service{
		repository: repository,
		keys:       keys,
		now:        func() time.Time { return time.Now().UTC() },
		random:     cryptorand.Reader,
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingrestore"),
	}
	service.outcomes, _ = meter.Int64Counter("mosaic.billing.restore.outcomes",
		metric.WithDescription("Restore jobs by Mosaic outcome and native provider outcome."))
	// The latency that matters is the whole chain — request to authoritative
	// answer — not the worker attempt. A fast worker attached to a slow
	// validation queue is still a user waiting on a restore.
	service.chainLatency, _ = meter.Float64Histogram("mosaic.billing.restore.chain_latency",
		metric.WithDescription("Time from restore request to authoritative outcome."),
		metric.WithUnit("ms"))
	for _, option := range options {
		option(service)
	}
	return service
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

// SubmitFromSDK records a restore requested by an SDK.
//
// It authenticates the public SDK key only. That is deliberate and it is what
// makes the surface safe: a public key proves which Environment is asking and
// can never select a customer, and this request never names one. Identity is
// resolved later, from the store lineage the submitted observations validate
// into — which is the same server-validated path plan §5a requires, and the
// reason `identity_unresolved` is a first-class outcome rather than an error.
func (s *Service) SubmitFromSDK(ctx context.Context, rawKey string, request SubmitRequest) ([]byte, error) {
	scope, err := s.keys.AuthenticateSDKKey(ctx, strings.TrimSpace(rawKey))
	if err != nil {
		return nil, ErrUnauthenticated
	}
	// A client-supplied customer identifier is dropped rather than rejected:
	// the surface accepts one shape from both callers, and the untrusted one
	// simply cannot use it to select anybody.
	request.CustomerID = ""
	return s.submit(ctx, scope, request)
}

// SubmitFromServer records a restore requested by an application backend over
// the trusted secret-server key. Such a caller may name the Billing Customer,
// because it has authenticated the user itself.
func (s *Service) SubmitFromServer(ctx context.Context, rawKey string, request SubmitRequest) ([]byte, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, strings.TrimSpace(rawKey))
	if err != nil {
		return nil, ErrUnauthenticated
	}
	return s.submit(ctx, scope, request)
}

func (s *Service) submit(ctx context.Context, scope KeyScope, request SubmitRequest) ([]byte, error) {
	ctx, span := s.tracer.Start(ctx, "billing.restore.submit")
	defer span.End()

	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, err
	}
	if err := validateSubmission(request); err != nil {
		return nil, err
	}

	id, err := s.newID("rst")
	if err != nil {
		return nil, err
	}
	now := s.now()
	job := Job{
		ID:                id,
		ProjectID:         scope.ProjectID,
		EnvironmentID:     scope.EnvironmentID,
		CustomerID:        strings.TrimSpace(request.CustomerID),
		StorePlatform:     request.StorePlatform,
		Status:            StatusQueued,
		ProviderOutcome:   request.ProviderOutcome,
		UncertaintyReason: ReasonNone,
		CorrelationID:     SafeCorrelation(request.CorrelationID),
		MaxAttempts:       DefaultMaxAttempts,
		RequestedAt:       now,
		UpdatedAt:         now,
	}

	stored, err := s.repository.CreateJob(ctx, job, request.ObservationSubmissionIDs, now)
	if err != nil {
		return nil, err
	}
	span.SetAttributes(
		attribute.String("mosaic.billing.restore.id", stored.ID),
		attribute.String("mosaic.billing.restore.provider_outcome", stored.ProviderOutcome),
		attribute.Int("mosaic.billing.restore.observed", stored.ObservedTransactionCount))

	return s.render(View{Job: stored, EvaluatedAt: now})
}

func validateSubmission(request SubmitRequest) error {
	switch request.StorePlatform {
	case StoreApple, StoreGoogle:
	default:
		return ErrInvalid
	}
	switch request.ProviderOutcome {
	case ProviderOutcomeCompleted, ProviderOutcomeNoPurchasesFound, ProviderOutcomeCancelled,
		ProviderOutcomeFailed, ProviderOutcomeUnsupported, ProviderOutcomeNotAttempted:
	default:
		return ErrInvalid
	}
	if len(request.ObservationSubmissionIDs) > MaxSubmittedObservations {
		return ErrInvalid
	}
	for _, id := range request.ObservationSubmissionIDs {
		if trimmed := strings.TrimSpace(id); trimmed == "" || len(trimmed) > 128 {
			return ErrInvalid
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

// RestoreForSDK reads one restore over the public SDK key. The job must belong
// to the key's Project and Environment; a restore from another tenant reads as
// absent rather than forbidden, so the surface cannot be used to probe for the
// existence of another tenant's restores.
func (s *Service) RestoreForSDK(ctx context.Context, rawKey, restoreID string) ([]byte, error) {
	scope, err := s.keys.AuthenticateSDKKey(ctx, strings.TrimSpace(rawKey))
	if err != nil {
		return nil, ErrUnauthenticated
	}
	return s.restore(ctx, scope, restoreID)
}

// RestoreForServer reads one restore over the trusted secret-server key.
func (s *Service) RestoreForServer(ctx context.Context, rawKey, restoreID string) ([]byte, error) {
	scope, err := s.keys.AuthenticateServerKey(ctx, strings.TrimSpace(rawKey))
	if err != nil {
		return nil, ErrUnauthenticated
	}
	return s.restore(ctx, scope, restoreID)
}

func (s *Service) restore(ctx context.Context, scope KeyScope, restoreID string) ([]byte, error) {
	ctx, span := s.tracer.Start(ctx, "billing.restore.status")
	defer span.End()

	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return nil, err
	}
	restoreID = strings.TrimSpace(restoreID)
	if restoreID == "" || len(restoreID) > 128 {
		return nil, ErrNotFound
	}
	job, err := s.repository.Job(ctx, scope.ProjectID, scope.EnvironmentID, restoreID)
	if err != nil {
		return nil, err
	}
	span.SetAttributes(
		attribute.String("mosaic.billing.restore.id", job.ID),
		attribute.String("mosaic.billing.restore.status", job.Status))
	return s.render(View{Job: job, EvaluatedAt: job.UpdatedAt})
}

// render produces the contract record's canonical serialization. The response
// body is the canonical bytes rather than a second encoding of the same map, so
// a caller that digests what it received digests what Mosaic produced.
func (s *Service) render(view View) ([]byte, error) {
	record, err := RestoreRecord(view)
	if err != nil {
		return nil, err
	}
	return CanonicalJSON(record)
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

// ProcessNextRestoreSync leases and advances one restore job. It matches the
// (processed, error) contract every other Mosaic job family uses.
//
// The attempt is a read and a decision, never a repair: it does not validate,
// does not project, and does not resolve identity. It looks at where the chain
// got to and either records the answer or schedules another look.
func (s *Service) ProcessNextRestoreSync(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	job, leased, err := s.repository.LeaseJob(ctx, workerID, now, now.Add(restoreLease))
	if err != nil {
		return false, fmt.Errorf("lease restore job: %w", err)
	}
	if !leased {
		return false, nil
	}
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: job.ID, JobKind: JobFamily,
		ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID, ResourceID: job.ID,
	})
	ctx, span := s.tracer.Start(ctx, "billing.restore.attempt")
	defer span.End()
	span.SetAttributes(attribute.String("mosaic.billing.restore.id", job.ID))

	// A Project that turned billing off decides nothing. The job is parked
	// rather than failed: disabling is reversible, and failing would need an
	// operator action to recover work that only ever needed to wait.
	if err := s.requireEnabled(ctx, job.ProjectID); err != nil {
		parked := s.now()
		return true, s.repository.RescheduleJob(ctx, job, Decision{}, ChainState{},
			parked.Add(5*time.Minute), parked)
	}

	chain, err := s.repository.LoadChain(ctx, job)
	if err != nil {
		// The chain could not be read at all. That is Mosaic's own transient
		// failure, not an answer about the restore, so nothing is written to
		// the outcome column and the job simply comes back.
		completed := s.now()
		return true, s.repository.RescheduleJob(ctx, job, Decision{}, ChainState{},
			s.nextAttemptAt(completed, job.AttemptCount), completed)
	}

	// The baseline is adopted the first time identity resolves, and never
	// again. Until it exists there is no version for an accepted snapshot to
	// have moved past, so Decide cannot return `restored` — which is why the
	// adoption happens on its own attempt rather than being folded into a
	// decision made from the same read.
	if job.BaselineSnapshotVersion == nil && chain.CustomerID != "" {
		adopted := s.now()
		if err := s.repository.AdoptBaseline(ctx, job, chain.CustomerID,
			chain.SnapshotVersion, adopted); err != nil {
			return true, fmt.Errorf("adopt restore baseline: %w", err)
		}
		return true, s.repository.RescheduleJob(ctx, job, Decision{}, chain,
			s.nextAttemptAt(adopted, job.AttemptCount), adopted)
	}

	decision := Decide(job, chain)
	exhausted := job.AttemptCount >= job.MaxAttempts
	if !decision.Terminal && !exhausted {
		scheduled := s.now()
		return true, s.repository.RescheduleJob(ctx, job, decision, chain,
			s.nextAttemptAt(scheduled, job.AttemptCount), scheduled)
	}

	// Belt and braces before the row is written. Decide cannot produce an
	// unproven `restored`, and the schema would reject one, but the check that
	// catches a future edit is the one in the code path rather than in either
	// of those.
	if err := decision.Validate(); err != nil {
		zerolog.Ctx(ctx).Error().
			Str("restore_id", job.ID).
			Str("restore_outcome", decision.Outcome).
			Msg("a restore decision was refused before it could be written")
		return true, err
	}

	completed := s.now()
	if err := s.repository.CompleteJob(ctx, job, decision, chain, completed); err != nil {
		return true, err
	}

	s.outcomes.Add(ctx, 1, metric.WithAttributes(
		attribute.String("outcome", decision.Outcome),
		attribute.String("provider_outcome", job.ProviderOutcome),
		attribute.String("uncertainty_reason", decision.UncertaintyReason),
		attribute.Bool("attempts_exhausted", exhausted && !decision.Terminal)))
	s.chainLatency.Record(ctx, float64(completed.Sub(job.RequestedAt).Milliseconds()),
		metric.WithAttributes(attribute.String("outcome", decision.Outcome)))
	span.SetAttributes(
		attribute.String("mosaic.billing.restore.outcome", decision.Outcome),
		attribute.String("mosaic.billing.restore.uncertainty", decision.UncertaintyReason),
		attribute.Int64("mosaic.billing.restore.snapshot_version", decision.SnapshotVersion()))
	return true, nil
}

// nextAttemptAt computes when the next look becomes available.
//
// Jitter is applied for the same reason validation applies it: a store outage
// or a slow projection makes every waiting restore due at the same instant, and
// a synchronized burst turns a recoverable delay into a self-inflicted one.
func (s *Service) nextAttemptAt(now time.Time, attempt int) time.Time {
	shift := attempt
	if shift < 0 {
		shift = 0
	}
	if shift > 6 {
		shift = 6
	}
	delay := backoffBase << shift
	if delay > backoffCap {
		delay = backoffCap
	}
	factor := 1 + (mathrand.Float64()*2-1)*0.25
	if s.jitter != nil {
		factor = 1 + (s.jitter.Float64()*2-1)*0.25
	}
	return now.Add(time.Duration(float64(delay) * factor))
}

// requireEnabled fails closed, matching every sibling billing service: an
// unreadable setting is treated as disabled, so a transient database error
// cannot quietly re-enable a Project that asked Mosaic to hold no billing
// state.
func (s *Service) requireEnabled(ctx context.Context, projectID string) error {
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("billing_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; treating the Project as disabled")
		return ErrBillingDisabled
	}
	if !enabled {
		return ErrBillingDisabled
	}
	return nil
}

func (s *Service) newID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", fmt.Errorf("generate restore identifier: %w", err)
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}
