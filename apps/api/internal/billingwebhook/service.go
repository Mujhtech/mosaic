package billingwebhook

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	mathrand "math/rand/v2"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/jobtelemetry"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// Service owns destination management, secret rotation, and delivery.
//
// Delivery deliberately lives here rather than in a separate worker package:
// the decision of whether a failure is retryable, when the next attempt is
// due, and when a destination has failed often enough to disable is business
// behaviour, and splitting it from the destination lifecycle would put the
// auto-disable rule in one package and the thing it disables in another.
type Service struct {
	repository Repository
	cipher     providercredential.SubjectCipher
	policy     *Policy
	now        func() time.Time
	random     io.Reader
	jitter     *mathrand.Rand
	tracer     trace.Tracer
	userAgent  string

	destinationsCreated metric.Int64Counter
	secretsRotated      metric.Int64Counter
	deliveries          metric.Int64Counter
	deliveryLatency     metric.Float64Histogram
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

// WithJitter makes the retry schedule deterministic for tests.
func WithJitter(source *mathrand.Rand) Option {
	return func(s *Service) { s.jitter = source }
}

func NewService(repository Repository, cipher providercredential.SubjectCipher, policy *Policy, options ...Option) *Service {
	if policy == nil {
		policy = NewPolicy()
	}
	meter := otel.Meter("mosaic/billingwebhook")
	service := &Service{
		repository: repository,
		cipher:     cipher,
		policy:     policy,
		now:        func() time.Time { return time.Now().UTC() },
		random:     rand.Reader,
		jitter:     mathrand.New(mathrand.NewPCG(uint64(time.Now().UnixNano()), 0x9e3779b9)),
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingwebhook"),
		userAgent:  "Mosaic-Webhooks/1",
	}
	service.destinationsCreated, _ = meter.Int64Counter("mosaic.billing.webhook.destination.created")
	service.secretsRotated, _ = meter.Int64Counter("mosaic.billing.webhook.secret.rotated")
	service.deliveries, _ = meter.Int64Counter("mosaic.billing.webhook.delivery.attempts")
	service.deliveryLatency, _ = meter.Float64Histogram("mosaic.billing.webhook.delivery.latency",
		metric.WithUnit("ms"))
	for _, option := range options {
		option(service)
	}
	return service
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

// CreateDestination registers a destination and mints its first signing secret.
//
// The URL is screened before anything is written, so an operator learns
// immediately that the address is refused rather than discovering it when the
// first entitlement change fails to deliver hours later. The returned secret
// is the only time it exists outside the caller's process.
func (s *Service) CreateDestination(ctx context.Context, actor Actor, input DestinationInput) (DestinationWithSecret, error) {
	ctx, span := s.tracer.Start(ctx, "billing.webhook.destination.create")
	defer span.End()

	if err := s.repository.AuthorizeEnvironment(ctx, actor, input.ProjectID, input.EnvironmentID); err != nil {
		return DestinationWithSecret{}, err
	}
	if err := s.requireEnabled(ctx, input.ProjectID); err != nil {
		return DestinationWithSecret{}, err
	}
	eventTypes, err := normalizeEventTypes(input.EventTypes)
	if err != nil {
		return DestinationWithSecret{}, err
	}
	// Registration-time screening. It runs again at every delivery attempt.
	if _, err := s.policy.Check(ctx, input.URL); err != nil {
		return DestinationWithSecret{}, err
	}

	destinationID, err := s.newID("whd")
	if err != nil {
		return DestinationWithSecret{}, err
	}
	secretValue, sealed, err := s.mintSecret(ctx, input.ProjectID, destinationID)
	if err != nil {
		return DestinationWithSecret{}, err
	}

	now := s.now()
	created, err := s.repository.CreateDestination(ctx, Destination{
		ID:            destinationID,
		ProjectID:     input.ProjectID,
		EnvironmentID: input.EnvironmentID,
		URL:           strings.TrimSpace(input.URL),
		Status:        DestinationActive,
		EventTypes:    eventTypes,
		Description:   strings.TrimSpace(input.Description),
		CreatedAt:     now,
		UpdatedAt:     now,
	}, sealed, actor.ID, now)
	if err != nil {
		return DestinationWithSecret{}, err
	}

	s.destinationsCreated.Add(ctx, 1)
	span.SetAttributes(attribute.String("mosaic.billing.webhook.destination.id", created.ID))
	// The destination id and Environment are safe to log. The URL is not
	// logged: it is operator-supplied, may carry a path segment the operator
	// treats as secret, and no branch of this method can reach a logger with
	// it.
	zerolog.Ctx(ctx).Info().
		Str("webhook_destination_id", created.ID).
		Str("project_id", created.ProjectID).
		Str("environment_id", created.EnvironmentID).
		Msg("webhook destination created")

	return DestinationWithSecret{Destination: created, Secret: secretValue, SecretID: sealed.ID}, nil
}

func (s *Service) ListDestinations(ctx context.Context, actor Actor, projectID, environmentID string) ([]Destination, error) {
	if err := s.repository.AuthorizeEnvironment(ctx, actor, projectID, environmentID); err != nil {
		return nil, err
	}
	return s.repository.ListDestinations(ctx, projectID, environmentID)
}

func (s *Service) Destination(ctx context.Context, actor Actor, projectID, destinationID string) (Destination, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return Destination{}, err
	}
	return s.repository.Destination(ctx, projectID, destinationID)
}

// UpdateDestination changes the URL, subscribed event types, or description. A
// changed URL is screened before it is stored, exactly as a new one is.
func (s *Service) UpdateDestination(ctx context.Context, actor Actor, projectID, destinationID string, update DestinationUpdate) (Destination, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return Destination{}, err
	}
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Destination{}, err
	}
	if update.URL != nil {
		if _, err := s.policy.Check(ctx, *update.URL); err != nil {
			return Destination{}, err
		}
		trimmed := strings.TrimSpace(*update.URL)
		update.URL = &trimmed
	}
	if update.EventTypes != nil {
		eventTypes, err := normalizeEventTypes(update.EventTypes)
		if err != nil {
			return Destination{}, err
		}
		update.EventTypes = eventTypes
	}
	return s.repository.UpdateDestination(ctx, projectID, destinationID, update, actor.ID, s.now())
}

// SetStatus pauses, resumes, or disables a destination.
//
// Resuming clears the auto-disable state, which is what makes an automatic
// disable recoverable by an operator rather than permanent.
func (s *Service) SetStatus(ctx context.Context, actor Actor, projectID, destinationID, status, reason string) (Destination, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return Destination{}, err
	}
	switch status {
	case DestinationActive, DestinationPaused, DestinationDisabled:
	default:
		return Destination{}, ErrInvalid
	}
	if len(reason) > 128 {
		return Destination{}, ErrInvalid
	}
	return s.repository.SetDestinationStatus(ctx, projectID, destinationID, status, strings.TrimSpace(reason), actor.ID, s.now())
}

// DeleteDestination removes a destination that has never been sent anything.
// Once it has delivery history the answer is disable, not delete: the history
// is the record of what a tenant's backend was told, and the destination is
// what identifies it.
func (s *Service) DeleteDestination(ctx context.Context, actor Actor, projectID, destinationID string) error {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return err
	}
	return s.repository.DeleteDestination(ctx, projectID, destinationID, actor.ID, s.now())
}

// ---------------------------------------------------------------------------
// Secret rotation
// ---------------------------------------------------------------------------

// RotateSecret mints a new signing secret and schedules the retirement of the
// current ones.
//
// Both sign during the overlap window and the delivery header carries one v1
// element per signing secret, so a receiver that has adopted the new secret and
// one that has not both verify. Without the overlap, a rotation would require a
// simultaneous change on both sides or a period of rejected deliveries, and an
// operator can achieve neither.
func (s *Service) RotateSecret(ctx context.Context, actor Actor, projectID, destinationID string) (DestinationWithSecret, error) {
	ctx, span := s.tracer.Start(ctx, "billing.webhook.secret.rotate")
	defer span.End()

	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return DestinationWithSecret{}, err
	}
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return DestinationWithSecret{}, err
	}
	destination, err := s.repository.Destination(ctx, projectID, destinationID)
	if err != nil {
		return DestinationWithSecret{}, err
	}

	secretValue, sealed, err := s.mintSecret(ctx, projectID, destination.ID)
	if err != nil {
		return DestinationWithSecret{}, err
	}
	now := s.now()
	honoredUntil := now.Add(RotationOverlap)
	if _, err := s.repository.RotateSecret(ctx, projectID, destination.ID, sealed, honoredUntil, actor.ID, now); err != nil {
		return DestinationWithSecret{}, err
	}

	s.secretsRotated.Add(ctx, 1)
	span.SetAttributes(attribute.String("mosaic.billing.webhook.destination.id", destination.ID))
	zerolog.Ctx(ctx).Info().
		Str("webhook_destination_id", destination.ID).
		Str("project_id", projectID).
		Time("previous_secret_honored_until", honoredUntil).
		Msg("webhook signing secret rotated")

	refreshed, err := s.repository.Destination(ctx, projectID, destination.ID)
	if err != nil {
		refreshed = destination
	}
	return DestinationWithSecret{
		Destination:                refreshed,
		Secret:                     secretValue,
		SecretID:                   sealed.ID,
		PreviousSecretHonoredUntil: &honoredUntil,
	}, nil
}

// RetireSecret ends a secret's overlap immediately. This is the action after a
// suspected compromise: the secret stops signing on the next delivery rather
// than when its window would have lapsed.
func (s *Service) RetireSecret(ctx context.Context, actor Actor, projectID, destinationID, secretID string) (SecretMetadata, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return SecretMetadata{}, err
	}
	return s.repository.RetireSecret(ctx, projectID, destinationID, secretID, actor.ID, s.now())
}

func (s *Service) ListSecrets(ctx context.Context, actor Actor, projectID, destinationID string) ([]SecretMetadata, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return nil, err
	}
	return s.repository.ListSecrets(ctx, projectID, destinationID)
}

// ---------------------------------------------------------------------------
// Delivery history and replay
// ---------------------------------------------------------------------------

func (s *Service) ListDeliveries(ctx context.Context, actor Actor, projectID string, filter DeliveryFilter) ([]Delivery, error) {
	if filter.EnvironmentID != "" {
		if err := s.repository.AuthorizeEnvironment(ctx, actor, projectID, filter.EnvironmentID); err != nil {
			return nil, err
		}
	} else if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return nil, err
	}
	return s.repository.ListDeliveries(ctx, projectID, filter.Bounded())
}

func (s *Service) Delivery(ctx context.Context, actor Actor, projectID, deliveryID string) (Delivery, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return Delivery{}, err
	}
	return s.repository.Delivery(ctx, projectID, deliveryID)
}

func (s *Service) ListAttempts(ctx context.Context, actor Actor, projectID, deliveryID string) ([]Attempt, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return nil, err
	}
	return s.repository.ListAttempts(ctx, projectID, deliveryID)
}

// ReplayDelivery re-queues one terminal delivery.
//
// The event id does not change. A replay is a new delivery attempt, never a
// new logical event, so a receiver deduplicating on the event id sees the
// change exactly once however many times an operator replays it.
func (s *Service) ReplayDelivery(ctx context.Context, actor Actor, projectID, deliveryID string) (Delivery, error) {
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return Delivery{}, err
	}
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Delivery{}, err
	}
	return s.repository.ReplayDelivery(ctx, projectID, deliveryID, actor.ID, s.now())
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

// ProcessNextDelivery expands newly committed events and delivers at most one.
// It matches the (processed, error) contract every other Mosaic job family
// uses.
//
// Nothing here runs inside a projection transaction, and the delivery row's
// lease is committed before the HTTP request begins. A destination that hangs
// for the full request timeout holds no database lock while it does so.
func (s *Service) ProcessNextDelivery(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	// Fan-out is best-effort within the poll: a failure to expand must not stop
	// the deliveries already queued from being attempted.
	if _, err := s.repository.FanOut(ctx, now, FanOutBatch); err != nil {
		zerolog.Ctx(ctx).Error().
			Str("webhook_error_kind", fmt.Sprintf("%T", err)).
			Msg("webhook fan-out failed")
	}

	leased, ok, err := s.repository.LeaseDelivery(ctx, workerID, now, now.Add(DeliveryLease))
	if err != nil {
		return false, fmt.Errorf("lease webhook delivery: %w", err)
	}
	if !ok {
		return false, nil
	}
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: leased.Delivery.ID, JobKind: "billing_webhook_delivery",
		ProjectID: leased.Delivery.ProjectID, EnvironmentID: leased.Delivery.EnvironmentID,
		ResourceID: leased.Delivery.DestinationID,
	})
	return true, s.deliver(ctx, leased)
}

// deliver performs one attempt and records its outcome.
func (s *Service) deliver(ctx context.Context, leased LeasedDelivery) error {
	ctx, span := s.tracer.Start(ctx, "webhook.deliver")
	defer span.End()
	span.SetAttributes(
		attribute.String("mosaic.billing.webhook.delivery.id", leased.Delivery.ID),
		attribute.String("mosaic.billing.webhook.destination.id", leased.Delivery.DestinationID),
		attribute.Int("mosaic.billing.webhook.delivery.attempt", leased.Delivery.AttemptCount))

	started := s.now()

	// The destination is re-checked at delivery time, not only at fan-out. An
	// operator who pauses a destination while a delivery is queued expects the
	// pause to take effect, and the fan-out decision may be hours old.
	if deliverable, reason := leased.Destination.Deliverable(leased.EventType); !deliverable {
		return s.record(ctx, leased, AttemptResult{
			Delivery: leased.Delivery, AttemptNumber: leased.Delivery.AttemptCount,
			Outcome: OutcomeSkipped, Status: DeliverySkipped, SkippedReason: reason,
			AttemptedAt: started, CompletedAt: &started,
		}, reason)
	}

	// Screening runs on every attempt. A hostname that resolved to a public
	// address at registration can resolve to a private one now, and a check
	// that ran only once would have approved that forever.
	target, err := s.policy.Check(ctx, leased.Destination.URL)
	if err != nil {
		// A refused destination is permanent: the next attempt would resolve the
		// same way, and retrying an SSRF-refused address is a scan.
		return s.terminal(ctx, leased, started, "destination_refused", nil, "",
			AutoDisabledDestinationRefused)
	}

	secrets, err := s.openSecrets(ctx, leased)
	if err != nil {
		// Unsealing failed — a keyring the process cannot reach, or an envelope
		// bound to another destination. Retryable, because restoring a keyring
		// is an operator action that should recover queued deliveries by
		// itself. Signing with nothing is not an option: an unsigned
		// entitlement webhook is an unauthenticated instruction to grant access.
		return s.retryable(ctx, leased, started, "signing_secret_unavailable", nil, "")
	}

	timestamp := started.Unix()
	signatures := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		signatures = append(signatures, Sign(secret, timestamp, leased.Delivery.EventID, leased.Body))
	}
	header := http.Header{}
	header.Set("Content-Type", "application/json")
	header.Set("User-Agent", s.userAgent)
	header.Set(HeaderName, Header(signatures, timestamp))

	result, sendErr := s.policy.Send(ctx, target, header, leased.Body)
	s.deliveryLatency.Record(ctx, float64(result.Latency.Milliseconds()))

	status := (*int)(nil)
	if result.StatusCode != 0 {
		code := result.StatusCode
		status = &code
	}
	switch {
	case sendErr != nil && errors.Is(sendErr, errRedirectRefused):
		// A redirect is a second destination the operator never approved.
		// Permanent: the destination has to be reconfigured.
		return s.terminal(ctx, leased, started, "redirect_refused", nil, "", AutoDisabledDestinationRefused)
	case sendErr != nil:
		return s.retryable(ctx, leased, started, transportErrorCode(sendErr), nil, "")
	case result.StatusCode >= 200 && result.StatusCode < 300:
		responded := s.now()
		return s.record(ctx, leased, AttemptResult{
			Delivery: leased.Delivery, AttemptNumber: leased.Delivery.AttemptCount,
			Outcome: OutcomeDelivered, Status: DeliverySucceeded,
			ResponseStatus: status, ResponseExcerpt: result.Excerpt,
			LatencyMS:   int(result.Latency.Milliseconds()),
			AttemptedAt: started, RespondedAt: &responded, CompletedAt: &responded,
			ResetDestinationFailures: true,
		}, "")
	case retryableStatus(result.StatusCode):
		return s.retryable(ctx, leased, started, "destination_error", status, result.Excerpt)
	default:
		// Any other 3xx or 4xx is the destination saying no in a way that will
		// not change on its own. Retrying spends the budget for nothing.
		return s.terminal(ctx, leased, started, "destination_rejected", status, result.Excerpt,
			AutoDisabledConsecutiveExhausted)
	}
}

// retryable schedules another attempt, or exhausts the delivery when the
// budget has run out.
func (s *Service) retryable(ctx context.Context, leased LeasedDelivery, started time.Time,
	errorCode string, status *int, excerpt string) error {

	responded := s.now()
	if leased.Delivery.AttemptCount >= leased.Delivery.MaxAttempts {
		return s.record(ctx, leased, AttemptResult{
			Delivery: leased.Delivery, AttemptNumber: leased.Delivery.AttemptCount,
			Outcome: OutcomeExhausted, Status: DeliveryExhausted, ErrorCode: errorCode,
			ResponseStatus: status, ResponseExcerpt: excerpt,
			LatencyMS:   int(responded.Sub(started).Milliseconds()),
			AttemptedAt: started, RespondedAt: &responded, CompletedAt: &responded,
			IncrementDestinationFailures: true,
		}, "")
	}
	next := s.nextAttemptAt(responded, leased.Delivery.AttemptCount)
	return s.record(ctx, leased, AttemptResult{
		Delivery: leased.Delivery, AttemptNumber: leased.Delivery.AttemptCount,
		Outcome: OutcomeRetryableFailure, Status: DeliveryPending, ErrorCode: errorCode,
		ResponseStatus: status, ResponseExcerpt: excerpt,
		LatencyMS:   int(responded.Sub(started).Milliseconds()),
		AttemptedAt: started, RespondedAt: &responded, NextAttemptAt: &next,
	}, "")
}

// terminal gives up on this delivery without spending the remaining budget.
func (s *Service) terminal(ctx context.Context, leased LeasedDelivery, started time.Time,
	errorCode string, status *int, excerpt string, autoDisableReason string) error {

	responded := s.now()
	return s.record(ctx, leased, AttemptResult{
		Delivery: leased.Delivery, AttemptNumber: leased.Delivery.AttemptCount,
		Outcome: OutcomePermanentFailure, Status: DeliveryFailed, ErrorCode: errorCode,
		ResponseStatus: status, ResponseExcerpt: excerpt,
		LatencyMS:   int(responded.Sub(started).Milliseconds()),
		AttemptedAt: started, RespondedAt: &responded, CompletedAt: &responded,
		IncrementDestinationFailures: true,
	}, autoDisableReason)
}

// record persists the attempt and applies the auto-disable policy.
func (s *Service) record(ctx context.Context, leased LeasedDelivery, result AttemptResult, autoDisableReason string) error {
	result.ResponseExcerpt = SafeExcerpt(result.ResponseExcerpt)
	failures, err := s.repository.CompleteAttempt(ctx, result)
	if err != nil {
		return fmt.Errorf("record webhook delivery attempt: %w", err)
	}
	s.deliveries.Add(ctx, 1, metric.WithAttributes(
		attribute.String("outcome", result.Outcome),
		attribute.String("status", result.Status)))

	if !result.IncrementDestinationFailures || failures < AutoDisableThreshold {
		return nil
	}
	reason := autoDisableReason
	if reason == "" {
		reason = AutoDisabledConsecutiveExhausted
	}
	now := s.now()
	if err := s.repository.AutoDisableDestination(ctx, leased.Delivery.ProjectID,
		leased.Delivery.DestinationID, reason, now); err != nil {
		// The delivery outcome is already committed. A failure to disable is
		// worth an operator's attention but must not be reported as a failed
		// job, because re-running the job would re-deliver an event that was
		// already sent.
		zerolog.Ctx(ctx).Error().
			Str("webhook_destination_id", leased.Delivery.DestinationID).
			Str("webhook_error_kind", fmt.Sprintf("%T", err)).
			Msg("webhook destination could not be auto-disabled")
		return nil
	}
	zerolog.Ctx(ctx).Warn().
		Str("webhook_destination_id", leased.Delivery.DestinationID).
		Str("project_id", leased.Delivery.ProjectID).
		Str("auto_disable_reason", reason).
		Int("consecutive_failure_count", failures).
		Msg("webhook destination disabled after consecutive delivery failures")
	return nil
}

// openSecrets unseals every secret still permitted to sign, newest first.
//
// A retired secret whose overlap has lapsed is dropped here rather than being
// filtered in SQL alone, so a clock skew between the database and this process
// cannot resurrect one.
func (s *Service) openSecrets(ctx context.Context, leased LeasedDelivery) ([]string, error) {
	now := s.now()
	stored := append([]StoredSecret(nil), leased.Secrets...)
	sort.SliceStable(stored, func(left, right int) bool {
		// Active before retired, so the current secret's signature is the first
		// header element a receiver reads.
		return stored[left].Status == SecretActive && stored[right].Status != SecretActive
	})

	secrets := make([]string, 0, len(stored))
	for _, candidate := range stored {
		if candidate.Status == SecretRetired &&
			(candidate.HonoredUntil == nil || !candidate.HonoredUntil.After(now)) {
			continue
		}
		plaintext, err := s.cipher.DecryptSubject(providercredential.Envelope{
			Version: candidate.EnvelopeVersion, Algorithm: candidate.Algorithm, KeyID: candidate.KeyID,
			Nonce: candidate.Nonce, Ciphertext: candidate.Ciphertext,
			Fingerprint: candidate.Fingerprint, CredentialClass: billing.ClassWebhookSigningSecret,
		}, providercredential.SubjectScope{
			OrganizationID:  leased.OrganizationID,
			ProjectID:       leased.Delivery.ProjectID,
			SubjectKind:     providercredential.SubjectWebhookSigningSecret,
			SubjectID:       leased.Delivery.DestinationID,
			CredentialClass: billing.ClassWebhookSigningSecret,
		})
		if err != nil {
			// One unopenable envelope does not condemn the rest: during a
			// keyring rotation a superseded secret may be sealed under a key
			// this process no longer holds, and the active one still signs.
			continue
		}
		secrets = append(secrets, string(plaintext))
	}
	if len(secrets) == 0 {
		return nil, ErrSecretUnavailable
	}
	return secrets, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const (
	backoffBase = 15 * time.Second
	backoffCap  = 10 * time.Minute
)

// nextAttemptAt computes when a retry becomes available.
//
// It mirrors the shape of billing.NextAttemptAt: exponential from a fifteen-
// second base, capped at ten minutes, with ±25% jitter. The jitter matters more
// here than it does for provider calls, because a single entitlement change can
// fan out to every destination in a Project at once, and an unjittered schedule
// would turn one receiver's outage into a synchronized retry burst.
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
	factor := 1.0
	if s.jitter != nil {
		factor = 1 + (s.jitter.Float64()*2-1)*0.25
	}
	return now.Add(time.Duration(float64(delay) * factor))
}

// retryableStatus reports whether a response status is worth another attempt.
func retryableStatus(status int) bool {
	switch {
	case status == http.StatusRequestTimeout,
		status == http.StatusTooManyRequests,
		status >= 500:
		return true
	default:
		return false
	}
}

// transportErrorCode maps a dial, TLS, or deadline failure onto a stable
// Mosaic code. The error itself is never persisted or returned: it can carry
// the destination host and resolved address, which is information about
// Mosaic's network position.
func transportErrorCode(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "destination_timeout"
	case errors.Is(err, context.Canceled):
		return "delivery_cancelled"
	case errors.Is(err, ErrDestinationRefused):
		return "destination_refused"
	default:
		return "destination_unreachable"
	}
}

// mintSecret generates a signing secret and seals it under the destination's
// subject scope. The plaintext is returned once and is never stored.
func (s *Service) mintSecret(ctx context.Context, projectID, destinationID string) (string, SealedSecret, error) {
	organizationID, err := s.repository.OrganizationForProject(ctx, projectID)
	if err != nil {
		return "", SealedSecret{}, ErrNotFound
	}
	buffer := make([]byte, SecretRandomBytes)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", SealedSecret{}, ErrSecretUnavailable
	}
	value := SecretPrefix + base64.RawURLEncoding.EncodeToString(buffer)
	secretID, err := s.newID("whs")
	if err != nil {
		return "", SealedSecret{}, err
	}
	// The additional authenticated data binds the ciphertext to this exact
	// destination row, so a sealed secret moved to another destination — by a
	// bug, or by a compromise that can write the table but not decrypt it —
	// fails to open rather than signing deliveries for the wrong tenant.
	envelope, err := s.cipher.EncryptSubject([]byte(value), providercredential.SubjectScope{
		OrganizationID:  organizationID,
		ProjectID:       projectID,
		SubjectKind:     providercredential.SubjectWebhookSigningSecret,
		SubjectID:       destinationID,
		CredentialClass: billing.ClassWebhookSigningSecret,
	})
	if err != nil {
		return "", SealedSecret{}, ErrSecretUnavailable
	}
	return value, SealedSecret{
		ID: secretID, EnvelopeVersion: envelope.Version, Algorithm: envelope.Algorithm,
		KeyID: envelope.KeyID, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
		Fingerprint: envelope.Fingerprint,
	}, nil
}

func (s *Service) newID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", fmt.Errorf("generate webhook identifier: %w", err)
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

// normalizeEventTypes validates the subscription list against the closed
// vocabulary Phase 9B emits. The contract declares ten event types; subscribing
// to one Mosaic never emits would be a destination that is configured and
// permanently silent.
func normalizeEventTypes(requested []string) ([]string, error) {
	if len(requested) == 0 {
		return []string{EventTypeEntitlementsChanged}, nil
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(requested))
	for _, eventType := range requested {
		if eventType != EventTypeEntitlementsChanged {
			return nil, ErrInvalid
		}
		if seen[eventType] {
			return nil, ErrInvalid
		}
		seen[eventType] = true
		result = append(result, eventType)
	}
	return result, nil
}

// requireEnabled fails closed, matching the ingestion, projection, and access
// paths: an unreadable setting is treated as disabled, so a transient database
// error cannot quietly re-enable a Project that asked Mosaic to hold no billing
// state.
func (s *Service) requireEnabled(ctx context.Context, projectID string) error {
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("webhook_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; treating the Project as disabled")
		return ErrBillingDisabled
	}
	if !enabled {
		return ErrBillingDisabled
	}
	return nil
}
