package billing

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// MaxNotificationBytes bounds an Apple notification body. Apple's payloads are
// a few kilobytes; this is generous while still refusing an unbounded write on
// an unauthenticated endpoint.
const MaxNotificationBytes = 256 << 10

// MaxObservationBytes bounds an observation body.
const MaxObservationBytes = 8 << 10

// Service is the billing application service. Handlers are thin wrappers over
// it and it owns every transaction boundary, authorization decision, and
// provider interaction.
type Service struct {
	repository Repository
	cipher     providercredential.SubjectCipher
	verifier   *appstorejws.Verifier
	apple      AppleClient
	google     GoogleClient

	now    func() time.Time
	random io.Reader
	jitter *mathrand.Rand
	tracer trace.Tracer

	retention time.Duration
	// notificationBaseURL is the public origin Apple posts notifications to. It
	// is used only to render the endpoint URL returned on create and rotate.
	notificationBaseURL string

	// lineages attaches a committed fact's Purchase Lineage to a Billing
	// Customer, and submissions record the association a token-bound
	// observation carries. Both are the Phase 9A→9B seam (see seam.go) and both
	// are optional: without them this service behaves exactly as Phase 9A did.
	lineages    LineageBinder
	submissions SubmissionBinder

	intakeAccepted    metric.Int64Counter
	intakeRejected    metric.Int64Counter
	signatureFailure  metric.Int64Counter
	validationOutcome metric.Int64Counter
	factsAppended     metric.Int64Counter
	factsDeduped      metric.Int64Counter
	providerRequests  metric.Int64Counter
	validationLatency metric.Float64Histogram
}

// AppleClient is the App Store Server API port.
type AppleClient interface {
	TransactionInfo(ctx context.Context, credential appstoreserver.Credential, transactionID string) (string, error)
	TransactionHistory(ctx context.Context, credential appstoreserver.Credential, transactionID, revision string) (appstoreserver.HistoryPage, error)
	NotificationHistory(ctx context.Context, credential appstoreserver.Credential, request appstoreserver.NotificationHistoryRequest, paginationToken string) (appstoreserver.NotificationHistoryPage, error)
}

// GoogleClient is the Play Developer API and Pub/Sub port.
type GoogleClient interface {
	GetSubscription(ctx context.Context, account *googleplay.ServiceAccount, packageName, purchaseToken string) (googleplay.SubscriptionPurchase, error)
	GetProduct(ctx context.Context, account *googleplay.ServiceAccount, packageName, productID, purchaseToken string) (googleplay.ProductPurchase, error)
	GetOrder(ctx context.Context, account *googleplay.ServiceAccount, packageName, orderID string) (googleplay.Order, error)
	Pull(ctx context.Context, account *googleplay.ServiceAccount, projectID, subscriptionID string, maxMessages int) ([]googleplay.ReceivedMessage, error)
	Acknowledge(ctx context.Context, account *googleplay.ServiceAccount, projectID, subscriptionID string, ackIDs []string) error
}

type ServiceOption func(*Service)

func WithClock(now func() time.Time) ServiceOption {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func WithRandom(random io.Reader) ServiceOption {
	return func(s *Service) {
		if random != nil {
			s.random = random
		}
	}
}

func WithProviders(apple AppleClient, google GoogleClient) ServiceOption {
	return func(s *Service) { s.apple, s.google = apple, google }
}

func WithRetention(retention time.Duration) ServiceOption {
	return func(s *Service) {
		if retention > 0 {
			s.retention = retention
		}
	}
}

// WithSeam wires the Phase 9B seam. Either binder may be nil.
//
// They are one option rather than two because wiring one without the other is
// always a mistake: submission evidence nothing reads is dead weight, and a
// lineage binder with no submission evidence can only ever reach the
// purchase-anchored fallback, which silently turns every identified customer's
// first purchase into an unidentified one.
func WithSeam(lineages LineageBinder, submissions SubmissionBinder) ServiceOption {
	return func(s *Service) {
		s.lineages, s.submissions = lineages, submissions
	}
}

func WithNotificationBaseURL(base string) ServiceOption {
	return func(s *Service) { s.notificationBaseURL = strings.TrimRight(strings.TrimSpace(base), "/") }
}

func NewService(repository Repository, cipher providercredential.SubjectCipher, verifier *appstorejws.Verifier, options ...ServiceOption) *Service {
	meter := otel.Meter("mosaic/billing")
	service := &Service{
		repository: repository,
		cipher:     cipher,
		verifier:   verifier,
		now:        func() time.Time { return time.Now().UTC() },
		random:     rand.Reader,
		jitter:     mathrand.New(mathrand.NewPCG(uint64(time.Now().UnixNano()), 0x9E3779B97F4A7C15)),
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billing"),
		retention:  90 * 24 * time.Hour,
	}
	service.intakeAccepted, _ = meter.Int64Counter("mosaic.billing.intake.accepted")
	service.intakeRejected, _ = meter.Int64Counter("mosaic.billing.intake.rejected")
	service.signatureFailure, _ = meter.Int64Counter("mosaic.billing.signature.failures")
	service.validationOutcome, _ = meter.Int64Counter("mosaic.billing.validation.outcomes")
	service.factsAppended, _ = meter.Int64Counter("mosaic.billing.facts.appended")
	service.factsDeduped, _ = meter.Int64Counter("mosaic.billing.facts.deduplicated")
	service.providerRequests, _ = meter.Int64Counter("mosaic.billing.provider.requests")
	service.validationLatency, _ = meter.Float64Histogram("mosaic.billing.validation.latency",
		metric.WithUnit("ms"))
	for _, option := range options {
		option(service)
	}
	return service
}

// ---------------------------------------------------------------------------
// Apple notification intake
// ---------------------------------------------------------------------------

// AcceptAppleNotification is the whole synchronous intake path: verify, persist,
// enqueue, return.
//
// It performs no outbound provider call. Apple retries a failed V2 notification
// only five times in production and never in sandbox, so an intake that blocks
// on Apple's own API spends a finite, unrecoverable retry budget on Mosaic's
// latency. Everything that can fail slowly happens in the worker instead.
//
// The only condition that produces a non-2xx is a storage failure: an unknown
// bundle, a wrong Application, or an unsupported notification type all record
// the input and answer 2xx, because a retry from Apple would produce the same
// outcome while consuming a retry Mosaic may genuinely need later.
func (s *Service) AcceptAppleNotification(ctx context.Context, intakeToken string, body []byte, correlationID string) error {
	ctx, span := s.tracer.Start(ctx, "billing.intake.apple")
	defer span.End()
	now := s.now()

	digest := sha256.Sum256([]byte(intakeToken))
	identity, err := s.repository.ResolveIntakeToken(ctx, digest[:])
	if err != nil {
		// An unknown or revoked token has no tenant to attribute the body to.
		// Persisting an unattributable body would be an unbounded write on an
		// unauthenticated endpoint, so nothing is stored beyond the counter.
		s.intakeRejected.Add(ctx, 1, metric.WithAttributes(
			attribute.String("provider", ProviderAppStore),
			attribute.String("reason", "unknown_intake_token")))
		return ErrNotFound
	}
	span.SetAttributes(
		attribute.String("mosaic.project.id", identity.ProjectID),
		attribute.String("mosaic.environment.id", identity.EnvironmentID),
	)

	// Defense in depth. The credential rule on the settings endpoint is the
	// real guarantee — billing cannot be disabled while a credential is live,
	// so a resolvable intake token implies an enabled Project. This check
	// covers the window where a Project was disabled by some other path, and
	// makes "off means nothing is recorded" true of the notification path and
	// not only of SDK observations. Apple is answered 202 either way: a 4xx
	// would spend one of five non-renewable retries on a condition retrying
	// cannot fix.
	if !s.billingEnabled(ctx, identity.ProjectID) {
		s.intakeRejected.Add(ctx, 1, metric.WithAttributes(
			attribute.String("provider", ProviderAppStore),
			attribute.String("reason", "billing_disabled")))
		return nil
	}

	var envelope struct {
		SignedPayload string `json:"signedPayload"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.SignedPayload == "" {
		return s.recordUnverifiedApple(ctx, identity, body, correlationID, "malformed_body", now)
	}

	notification, err := s.verifier.DecodeNotification(envelope.SignedPayload)
	if err != nil {
		// A signature failure on a valid intake token means either a forgery or
		// a misdirected notification. Both are security signals and neither is
		// something Apple can fix by retrying.
		s.signatureFailure.Add(ctx, 1, metric.WithAttributes(
			attribute.String("provider", ProviderAppStore),
			attribute.String("reason", string(appstorejws.ReasonOf(err)))))
		return s.recordUnverifiedApple(ctx, identity, body, correlationID, string(appstorejws.ReasonOf(err)), now)
	}

	storeEnvironment := StoreUnclassified
	bundleID := ""
	if notification.Data != nil {
		bundleID = notification.Data.BundleID
		storeEnvironment = normalizeAppleEnvironment(notification.Data.Environment)
	}

	// Tenant identity always comes from the intake token, never from the
	// payload: bundle ids are not globally unique across Mosaic tenants, so
	// trusting the payload for attribution would let anyone holding a genuine
	// Apple notification steer it into another tenant's ledger. The verified
	// bundle id is only ever used to *check* the Application, and a mismatch
	// quarantines.
	applicationID, _, appErr := s.repository.ApplicationForIdentifier(ctx, identity.CredentialID, bundleID)
	mismatch := appErr != nil || applicationID == ""

	input := RawInput{
		ProjectID:            identity.ProjectID,
		OrganizationID:       identity.OrganizationID,
		EnvironmentID:        identity.EnvironmentID,
		EnvironmentMode:      identity.EnvironmentMode,
		ApplicationID:        applicationID,
		CredentialID:         identity.CredentialID,
		Provider:             ProviderAppStore,
		Source:               SourceAppleNotification,
		SourceAuthority:      AuthorityStoreNotification,
		ProviderEventID:      notification.NotificationUUID,
		IdempotencyKey:       AppleNotificationKey(notification.NotificationUUID),
		ContentDigest:        ContentDigest(body),
		AuthenticationResult: AuthVerifiedSignature,
		StoreEnvironment:     storeEnvironment,
		NotificationKind:     boundedCode(notification.NotificationType),
		NotificationSubtype:  boundedCode(notification.Subtype),
		IngestionStatus:      IngestAccepted,
		CorrelationID:        correlationID,
		ReceivedAt:           now,
		ExpiresAt:            now.Add(s.retention),
	}
	if when, ok := appstorejws.Millis(notification.SignedDate); ok {
		input.ProviderOccurredAt = &when
	}
	if notification.Data != nil && notification.Data.SignedTransactionInfo != "" {
		// The transaction reference digest is the attribution join between a
		// notification and an earlier client observation. The transaction id
		// itself is decoded only if the inner JWS also verifies.
		if transaction, err := s.verifier.DecodeTransaction(notification.Data.SignedTransactionInfo); err == nil {
			input.TransactionReferenceDigest = AppleTransactionKey(storeEnvironment, transaction.TransactionID)
		}
	}
	if mismatch {
		input.IngestionStatus = IngestQuarantined
	}

	if err := s.sealBody(&input, body); err != nil {
		return err
	}
	result, err := s.repository.PersistRawInput(ctx, input, !mismatch, now)
	if err != nil {
		// The only failure Apple should retry.
		return ErrUnavailable
	}
	s.observeIntake(ctx, ProviderAppStore, result)
	return nil
}

// recordUnverifiedApple stores the metadata of an input that failed
// verification. The body is deliberately not sealed: a payload that did not
// verify is not evidence of anything and retaining it would grow an
// attacker-controlled table.
func (s *Service) recordUnverifiedApple(ctx context.Context, identity IntakeIdentity, body []byte, correlationID, reason string, now time.Time) error {
	// The bucket, not the body, is the identity of an unverified input.
	//
	// The notification endpoint has no rate limiter by design — a 429 to Apple
	// spends one of five non-renewable delivery attempts — so anything keyed by
	// content digest grows without bound: an intake token is an unauthenticated
	// bearer value in a URL, and whoever holds one could post a million distinct
	// malformed bodies and get a million rows. Collapsing onto
	// (credential, reason, hour) caps that at twenty-four rows per credential
	// per reason per day while preserving everything an operator can act on:
	// which credential is receiving garbage, of what kind, and when.
	//
	// The content digest is derived from the same bucket rather than the body,
	// because the body is deliberately not retained here — an unverified payload
	// is not evidence of anything — and a body-derived digest would make every
	// repeat look like a content conflict, which is a security-severity signal
	// this is not.
	bucket := now.UTC().Truncate(time.Hour).Format(time.RFC3339)
	identityKey := UnverifiedInputKey(identity.CredentialID, boundedCode(reason), bucket)
	input := RawInput{
		ProjectID:            identity.ProjectID,
		OrganizationID:       identity.OrganizationID,
		EnvironmentID:        identity.EnvironmentID,
		EnvironmentMode:      identity.EnvironmentMode,
		CredentialID:         identity.CredentialID,
		Provider:             ProviderAppStore,
		Source:               SourceAppleNotification,
		SourceAuthority:      AuthorityStoreNotification,
		IdempotencyKey:       identityKey,
		ContentDigest:        identityKey,
		BodyState:            "not_retained",
		AuthenticationResult: AuthFailed,
		StoreEnvironment:     StoreUnclassified,
		IngestionStatus:      IngestQuarantined,
		CorrelationID:        correlationID,
		ReceivedAt:           now,
		ExpiresAt:            now.Add(s.retention),
	}
	if _, err := s.repository.PersistRawInput(ctx, input, false, now); err != nil {
		return ErrUnavailable
	}
	// The counter is where volume lives. The row records that it happened; the
	// metric records how often, without a row per occurrence.
	s.intakeRejected.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", ProviderAppStore),
		attribute.String("reason", boundedCode(reason))))
	return nil
}

// sealBody encrypts a raw body under the Phase 9A envelope domain. The tenant
// is already known by the time this runs, which is the precondition the
// encryption design requires.
func (s *Service) sealBody(input *RawInput, body []byte) error {
	if s.cipher == nil || len(body) == 0 {
		input.BodyState = "not_retained"
		return nil
	}
	// The subject id must be stable before encryption, so the repository is told
	// the id rather than generating one.
	if input.ID == "" {
		id, err := s.newID("bri")
		if err != nil {
			return err
		}
		input.ID = id
	}
	envelope, err := s.cipher.EncryptSubject(body, providercredential.SubjectScope{
		OrganizationID:  input.OrganizationID,
		ProjectID:       input.ProjectID,
		SubjectKind:     providercredential.SubjectBillingRawInput,
		SubjectID:       input.ID,
		CredentialClass: ClassBillingRawPayload,
	})
	if err != nil {
		// Failing closed: an input whose body cannot be sealed is recorded
		// without a body rather than with a plaintext one.
		input.BodyState = "not_retained"
		return nil
	}
	input.BodyState = "stored"
	input.Envelope = &Envelope{
		Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
		Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext, Fingerprint: envelope.Fingerprint,
	}
	return nil
}

func (s *Service) observeIntake(ctx context.Context, provider string, result PersistResult) {
	status := result.Status
	if result.Conflicted {
		status = IngestConflicted
	}
	s.intakeAccepted.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", provider),
		attribute.String("status", status)))
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

// SubmitClientObservation records an untrusted SDK report.
//
// The response never claims validation. `accepted_for_validation` is the
// strongest thing this endpoint can honestly say, because the store has not
// been consulted at the point the response is written.
//
// A client may not classify the Store Environment. The contract's
// clientTransactionObservation record has no such field at all, and a device
// can be made to say anything: accepting a client assertion would let a sandbox
// purchase present itself as production. Classification for a client
// observation comes only from server-side validation of the store's own
// response, so the field is forced to unclassified here regardless of what
// reached the service.
func (s *Service) SubmitClientObservation(ctx context.Context, rawKey string, observation Observation, correlationID string) (SubmissionResult, error) {
	scope, err := s.repository.AuthenticateSDKKey(ctx, rawKey)
	if err != nil {
		return SubmissionResult{}, ErrUnauthenticated
	}
	observation.StoreEnvironment = StoreUnclassified
	observation.PurchaseToken = ""
	return s.submitObservation(ctx, scope, observation, SourceClientObservation, AuthorityClient, AuthUnauthenticated, correlationID)
}

// CustomerToken carries an optional Customer Access Token presented alongside an
// observation.
//
// It is the submission-context half of the Phase 9A→9B seam. A store
// notification arrives out of band and names nobody, and the observation
// contract has no customer member, so a caller holding a token is the only thing
// in a deployed system that can say which customer a *first* purchase belongs
// to. The token is trustworthy for that because only the application's own
// backend can mint one.
//
// It is a separate argument rather than a field on Observation because it is not
// part of the contract record: it is a credential, and credentials do not travel
// in bodies that get sealed and replayed.
type CustomerToken string

// SubmitClientObservationAs is SubmitClientObservation with a Customer Access
// Token attached. An empty token behaves exactly like the plain form.
func (s *Service) SubmitClientObservationAs(ctx context.Context, rawKey string, token CustomerToken,
	observation Observation, correlationID string) (SubmissionResult, error) {

	scope, err := s.repository.AuthenticateSDKKey(ctx, rawKey)
	if err != nil {
		return SubmissionResult{}, ErrUnauthenticated
	}
	observation.StoreEnvironment = StoreUnclassified
	observation.PurchaseToken = ""
	return s.submitObservationAs(ctx, scope, token, observation,
		SourceClientObservation, AuthorityClient, AuthUnauthenticated, correlationID)
}

// SubmitServerObservationAs is SubmitServerObservation with a Customer Access
// Token attached.
func (s *Service) SubmitServerObservationAs(ctx context.Context, rawKey string, token CustomerToken,
	observation Observation, correlationID string) (SubmissionResult, error) {

	scope, err := s.repository.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return SubmissionResult{}, ErrUnauthenticated
	}
	return s.submitObservationAs(ctx, scope, token, observation,
		SourceTrustedServerObservation, AuthorityTrustedServer, AuthVerifiedTransport, correlationID)
}

// SubmitServerObservation records a trusted app-backend report. It may carry a
// full Google purchase token, which is encrypted on receipt and still subjected
// to complete provider validation: a trusted caller is more accountable, not
// more authoritative.
func (s *Service) SubmitServerObservation(ctx context.Context, rawKey string, observation Observation, correlationID string) (SubmissionResult, error) {
	scope, err := s.repository.AuthenticateServerKey(ctx, rawKey)
	if err != nil {
		return SubmissionResult{}, ErrUnauthenticated
	}
	return s.submitObservation(ctx, scope, observation, SourceTrustedServerObservation, AuthorityTrustedServer, AuthVerifiedTransport, correlationID)
}

func (s *Service) submitObservation(ctx context.Context, scope ObservationScope, observation Observation, source, authority, authentication, correlationID string) (SubmissionResult, error) {
	return s.submitObservationAs(ctx, scope, "", observation, source, authority, authentication, correlationID)
}

func (s *Service) submitObservationAs(ctx context.Context, scope ObservationScope, token CustomerToken, observation Observation, source, authority, authentication, correlationID string) (SubmissionResult, error) {
	ctx, span := s.tracer.Start(ctx, "billing.intake.observation")
	defer span.End()
	now := s.now()

	received := ContractTimestamp(now)

	enabled, err := s.repository.BillingEnabled(ctx, scope.ProjectID)
	if err != nil {
		return SubmissionResult{}, ErrUnavailable
	}
	if !enabled {
		// Off by default. A disabled Project rejects permanently so an SDK
		// queue drains instead of retrying forever.
		return rejected(observation.SubmissionID, received, CodeBillingNotEnabled), nil
	}

	provider, referenceDigest, ok := s.classifyReference(observation)
	if !ok {
		return rejected(observation.SubmissionID, received, CodeProviderReferenceMalformed), nil
	}

	input := RawInput{
		ProjectID:                  scope.ProjectID,
		OrganizationID:             scope.OrganizationID,
		EnvironmentID:              scope.EnvironmentID,
		EnvironmentMode:            scope.EnvironmentMode,
		ApplicationID:              scope.ApplicationID,
		Provider:                   provider,
		Source:                     source,
		SourceAuthority:            authority,
		ProviderEventID:            observation.SubmissionID,
		IdempotencyKey:             ObservationKey(scope.EnvironmentID, observation.SubmissionID),
		TransactionReferenceDigest: referenceDigest,
		AuthenticationResult:       authentication,
		StoreEnvironment:           normalizeStoreEnvironment(observation.StoreEnvironment),
		IngestionStatus:            IngestAccepted,
		CorrelationID:              correlationID,
		ReceivedAt:                 now,
		ExpiresAt:                  now.Add(s.retention),
	}
	if !observation.ObservedAt.IsZero() {
		observedAt := observation.ObservedAt.UTC()
		input.ProviderOccurredAt = &observedAt
	}

	// The persisted body is a Mosaic-built record rather than the request body,
	// so a client cannot decide what Mosaic stores. When a trusted server
	// supplied a purchase token it is included here and sealed; it is never
	// logged, never echoed, and never part of a metric attribute.
	body, err := json.Marshal(map[string]string{
		"referenceKind":    observation.ReferenceKind,
		"reference":        observation.Reference,
		"orderReference":   observation.OrderReference,
		"purchaseToken":    observation.PurchaseToken,
		"storeEnvironment": input.StoreEnvironment,
	})
	if err != nil {
		return rejected(observation.SubmissionID, received, CodeProviderReferenceMalformed), nil
	}
	input.ContentDigest = ContentDigest(body)
	if err := s.sealBody(&input, body); err != nil {
		return SubmissionResult{}, ErrUnavailable
	}

	result, err := s.repository.PersistRawInput(ctx, input, true, now)
	if err != nil {
		// SDKs queue and retry, so a storage failure is reported as retryable
		// rather than swallowed.
		return SubmissionResult{
			SubmissionID: observation.SubmissionID, ReceivedAt: received,
			Status: SubmissionRetryableFailure, Code: CodeStorageUnavailable,
			RetryAfterSeconds: retryableBackoffSeconds,
		}, nil
	}
	s.observeIntake(ctx, provider, result)

	// Record the association the submission carries, before the switch below
	// returns. A duplicate submission still records it: the second device of the
	// same customer submitting the same purchase is the ordinary restore shape,
	// and the evidence table is append-only history rather than a set.
	if s.submissions != nil && token != "" && result.RawInputID != "" && !result.Conflicted {
		if _, err := s.submissions.BindSubmission(ctx, string(token), SubmissionBinding{
			ProjectID: scope.ProjectID, EnvironmentID: scope.EnvironmentID,
			RawInputID:                 result.RawInputID,
			TransactionReferenceDigest: referenceDigest,
			// The credential that authenticated this submission, not the one
			// that minted the token. A token-bound observation arriving on the
			// public SDK key records weaker evidence than the same claim made
			// by the application's own backend over its secret key.
			SecretServerKey: authority == AuthorityTrustedServer,
			ObservedAt:      now,
		}); err != nil {
			// The observation itself is recorded and valid. Failing the
			// submission over the association would turn a transient identity
			// failure into a dropped purchase, and the seam retries the decision
			// from the fact side anyway.
			zerolog.Ctx(ctx).Error().
				Str("project_id", scope.ProjectID).
				Str("raw_input_id", result.RawInputID).
				Msg("observation submission evidence could not be recorded")
		}
	}

	switch {
	case result.Conflicted:
		// The same submission id arrived carrying different content. Accepting
		// it would let a client overwrite an earlier observation.
		return rejected(observation.SubmissionID, received, CodeObservationIDConflict), nil
	case result.Status == IngestDuplicate:
		// A duplicate is idempotent, not an error: the SDK queue retried and
		// Mosaic already holds the submission.
		return SubmissionResult{
			SubmissionID: observation.SubmissionID, ReceivedAt: received, Status: SubmissionDuplicate,
		}, nil
	default:
		return SubmissionResult{
			SubmissionID: observation.SubmissionID, ReceivedAt: received, Status: SubmissionAccepted,
			EstimatedValidationDelaySeconds: estimatedValidationDelaySeconds,
		}, nil
	}
}

// retryableBackoffSeconds and estimatedValidationDelaySeconds are the hints the
// contract lets a submission response carry. Both are advisory: the SDK queue
// owns its own retry schedule and must not treat either as a guarantee.
const (
	retryableBackoffSeconds         = 30
	estimatedValidationDelaySeconds = 30
)

// rejected builds a permanent rejection with a contract code.
func rejected(submissionID, receivedAt, code string) SubmissionResult {
	return SubmissionResult{
		SubmissionID: submissionID, ReceivedAt: receivedAt,
		Status: SubmissionPermanentlyRejected, Code: code,
	}
}

// RateLimited builds the retryable_failure a caller receives when the
// observation limiter sheds it. It lives here rather than in the handler so the
// contract shape has exactly one construction site.
func RateLimited(submissionID string, now time.Time, retryAfter time.Duration) SubmissionResult {
	seconds := int(retryAfter.Round(time.Second) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	if seconds > 86400 {
		seconds = 86400
	}
	return SubmissionResult{
		SubmissionID: submissionID, ReceivedAt: ContractTimestamp(now),
		Status: SubmissionRetryableFailure, Code: CodeRateLimited, RetryAfterSeconds: seconds,
	}
}

// Reject builds a permanent rejection for a transport-level failure such as a
// malformed body or an unknown field.
func Reject(submissionID string, now time.Time, code string) SubmissionResult {
	return rejected(submissionID, ContractTimestamp(now), code)
}

// Now exposes the service clock so the transport can stamp receivedAt on
// responses it builds without reaching the service.
func (s *Service) Now() time.Time { return s.now() }

// classifyReference derives the provider from the reference discriminator and
// computes the attribution digest.
func (s *Service) classifyReference(observation Observation) (string, []byte, bool) {
	reference, ok := SafeProviderCode(observation.Reference)
	if !ok {
		return "", nil, false
	}
	switch observation.ReferenceKind {
	case ReferenceAppStoreTransactionID:
		// Apple transaction ids are decimal. Requiring that is what keeps a JWS
		// out of this field even before the length bound applies.
		if !isDecimal(reference) {
			return "", nil, false
		}
		return ProviderAppStore, AppleTransactionKey(normalizeStoreEnvironment(observation.StoreEnvironment), reference), true
	case ReferenceGooglePlayTokenDigest:
		digest, ok := ValidHexDigest(reference)
		if !ok {
			return "", nil, false
		}
		return ProviderGooglePlay, digest, true
	case ReferenceGooglePlayOrderID:
		return ProviderGooglePlay, digestOf("mosaic-billing-google-order-v1", reference), true
	default:
		return "", nil, false
	}
}

func isDecimal(value string) bool {
	if value == "" || len(value) > 32 {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func normalizeAppleEnvironment(value string) string {
	switch value {
	case appstorejws.EnvironmentProduction:
		return StoreProduction
	case appstorejws.EnvironmentSandbox:
		return StoreSandbox
	default:
		return StoreUnclassified
	}
}

func normalizeStoreEnvironment(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case StoreProduction:
		return StoreProduction
	case StoreSandbox:
		return StoreSandbox
	default:
		return StoreUnclassified
	}
}

// boundedCode clips a provider-supplied classification to the column bound and
// the safe charset.
func boundedCode(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > 64 {
		trimmed = trimmed[:64]
	}
	for _, r := range trimmed {
		if r < 0x20 || r > 0x7e {
			return "unclassified"
		}
	}
	return trimmed
}

func (s *Service) newID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", fmt.Errorf("generate billing identifier: %w", err)
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

// safeFailure reduces an internal error to a stable code before it can reach
// the 5xx cause-logging path.
func safeFailure(err error, code string) error {
	if err == nil {
		return nil
	}
	var safe *SafeError
	if errors.As(err, &safe) {
		return safe
	}
	return &SafeError{Code: code, Kind: fmt.Sprintf("%T", err)}
}

// logSafely writes an operator line with identifiers only.
func logSafely(ctx context.Context, message string, fields map[string]string) {
	event := zerolog.Ctx(ctx).Info()
	for key, value := range fields {
		if value != "" {
			event = event.Str(key, value)
		}
	}
	event.Msg(message)
}

// billingEnabled reports whether a Project may record billing data, failing
// **closed** when the setting cannot be read.
//
// "Off means nothing is recorded" is the phase's frozen optionality promise,
// and a transient database error must not be able to break it: treating an
// unreadable setting as enabled would let a disabled Project accept and store
// signed payloads, call Apple and Google, and append facts. Unknown is
// therefore treated as disabled, and the read failure is logged so the
// difference between "the operator turned it off" and "Mosaic could not tell"
// is visible to an operator rather than inferred from a gap in the ledger.
//
// The cost of the conservative choice is bounded and recoverable: notification
// intake still answers 2xx, so no provider retry budget is spent, and queued
// work is parked rather than failed. The cost of the permissive choice is
// storing bearer material for a tenant that asked Mosaic not to.
func (s *Service) billingEnabled(ctx context.Context, projectID string) bool {
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("billing_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; treating the Project as disabled")
		return false
	}
	return enabled
}
