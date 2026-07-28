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
	input := RawInput{
		ProjectID:            identity.ProjectID,
		OrganizationID:       identity.OrganizationID,
		EnvironmentID:        identity.EnvironmentID,
		EnvironmentMode:      identity.EnvironmentMode,
		CredentialID:         identity.CredentialID,
		Provider:             ProviderAppStore,
		Source:               SourceAppleNotification,
		SourceAuthority:      AuthorityStoreNotification,
		IdempotencyKey:       digestOf("mosaic-billing-apple-unverified-v1", identity.CredentialID, string(ContentDigest(body))),
		ContentDigest:        ContentDigest(body),
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
func (s *Service) SubmitClientObservation(ctx context.Context, rawKey string, observation Observation, correlationID string) (SubmissionResult, error) {
	scope, err := s.repository.AuthenticateSDKKey(ctx, rawKey)
	if err != nil {
		return SubmissionResult{}, ErrUnauthenticated
	}
	return s.submitObservation(ctx, scope, observation, SourceClientObservation, AuthorityClient, AuthUnauthenticated, correlationID)
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
	ctx, span := s.tracer.Start(ctx, "billing.intake.observation")
	defer span.End()
	now := s.now()

	enabled, err := s.repository.BillingEnabled(ctx, scope.ProjectID)
	if err != nil {
		return SubmissionResult{}, ErrUnavailable
	}
	if !enabled {
		// Off by default. A disabled Project rejects permanently so an SDK
		// queue drains instead of retrying forever.
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionPermanentlyRejected, Code: "billing_not_enabled"}, nil
	}

	provider, referenceDigest, ok := s.classifyReference(observation)
	if !ok {
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionPermanentlyRejected, Code: "invalid_reference"}, nil
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
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionPermanentlyRejected, Code: "invalid_reference"}, nil
	}
	input.ContentDigest = ContentDigest(body)
	if err := s.sealBody(&input, body); err != nil {
		return SubmissionResult{}, ErrUnavailable
	}

	result, err := s.repository.PersistRawInput(ctx, input, true, now)
	if err != nil {
		// SDKs queue and retry, so a storage failure is reported as retryable
		// rather than swallowed.
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionRetryableFailure, Code: "storage_temporarily_unavailable"}, nil
	}
	s.observeIntake(ctx, provider, result)
	switch {
	case result.Conflicted:
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionPermanentlyRejected, Code: "submission_id_conflict"}, nil
	case result.Status == IngestDuplicate:
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionDuplicate}, nil
	default:
		return SubmissionResult{SubmissionID: observation.SubmissionID, Outcome: SubmissionAccepted}, nil
	}
}

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
