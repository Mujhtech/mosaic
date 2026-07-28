package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/jobtelemetry"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// validationLease bounds how long one worker may hold a validation job.
const validationLease = 2 * time.Minute

// ProcessNextValidation leases and runs one validation job. It matches the
// (processed, error) contract every other Mosaic job family uses so the worker
// loop treats billing exactly like analytics and Experiment scheduling.
func (s *Service) ProcessNextValidation(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	job, leased, err := s.repository.LeaseValidationJob(ctx, workerID, now, now.Add(validationLease))
	if err != nil {
		return false, safeFailure(err, "billing_lease_failed")
	}
	if !leased {
		return false, nil
	}
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: job.ID, JobKind: "billing_validation",
		ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID, ResourceID: job.RawInputID,
	})

	// Defense in depth: a disabled Project makes no provider calls and records
	// no facts. The job is parked rather than failed — disabling is reversible,
	// and a failed job would need an operator action to recover work that only
	// ever needed to wait.
	if !s.billingEnabled(ctx, job.ProjectID) {
		return true, s.repository.ParkValidationJob(ctx, job, "billing_disabled", s.now())
	}

	ctx, span := s.tracer.Start(ctx, "billing.validate."+job.Provider)
	defer span.End()

	started := s.now()
	outcome := s.runValidation(ctx, job, started)
	s.validationLatency.Record(ctx, float64(outcome.Attempt.LatencyMs), metric.WithAttributes(
		attribute.String("provider", job.Provider)))
	s.validationOutcome.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", job.Provider),
		attribute.String("outcome", outcome.Attempt.Outcome)))

	if err := s.repository.CompleteAttempt(ctx, job, outcome, s.now()); err != nil {
		return true, safeFailure(err, "billing_attempt_write_failed")
	}
	return true, nil
}

// runValidation performs one attempt and assembles everything it produced. It
// never returns an error: a failure is an outcome that must be recorded, not a
// condition that discards the work.
func (s *Service) runValidation(ctx context.Context, job ValidationJob, started time.Time) AttemptOutcome {
	attemptNumber, err := s.repository.NextAttemptNumber(ctx, job.RawInputID)
	if err != nil || attemptNumber < 1 {
		attemptNumber = job.AttemptCount + 1
	}
	attemptID, _ := s.newID("bva")

	input, err := s.repository.RawInput(ctx, job.ProjectID, job.RawInputID)
	if err != nil {
		return s.failedAttempt(job, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "raw_input_unavailable"), StoreUnclassified, "")
	}

	body, bodyAvailable := s.openBody(input)

	switch {
	case input.Provider == ProviderAppStore:
		return s.validateApple(ctx, job, input, body, bodyAvailable, attemptID, attemptNumber, started)
	case input.Provider == ProviderGooglePlay:
		return s.validateGoogle(ctx, job, input, body, bodyAvailable, attemptID, attemptNumber, started)
	default:
		return s.failedAttempt(job, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "unsupported_provider"), input.StoreEnvironment, input.CredentialID)
	}
}

// openBody decrypts a raw body. A body that has aged out of retention is not an
// error: replay after expiry runs from normalized facts and is labelled as
// such, which is why the caller is told availability rather than handed a
// failure.
func (s *Service) openBody(input RawInput) ([]byte, bool) {
	if input.BodyState != "stored" || input.Envelope == nil || s.cipher == nil {
		return nil, false
	}
	plaintext, err := s.cipher.DecryptSubject(providercredential.Envelope{
		Version: input.Envelope.Version, Algorithm: input.Envelope.Algorithm, KeyID: input.Envelope.KeyID,
		Nonce: input.Envelope.Nonce, Ciphertext: input.Envelope.Ciphertext,
		CredentialClass: ClassBillingRawPayload, Fingerprint: input.Envelope.Fingerprint,
	}, providercredential.SubjectScope{
		OrganizationID:  input.OrganizationID,
		ProjectID:       input.ProjectID,
		SubjectKind:     providercredential.SubjectBillingRawInput,
		SubjectID:       input.ID,
		CredentialClass: ClassBillingRawPayload,
	})
	if err != nil {
		return nil, false
	}
	return plaintext, true
}

// ---------------------------------------------------------------------------
// Apple validation
// ---------------------------------------------------------------------------

func (s *Service) validateApple(ctx context.Context, job ValidationJob, input RawInput, body []byte, bodyAvailable bool, attemptID string, attemptNumber int, started time.Time) AttemptOutcome {
	credential, credentialID, err := s.appleCredential(ctx, input, scopedToInput)
	// The resolved credential is stamped on the input before any early return,
	// so an attempt recorded for a failure still names the credential the
	// pipeline was trying to use.
	input.CredentialID = credentialID
	if err != nil {
		reason, diagnostic := credentialFailure(err)
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryConfiguration, diagnostic), reason, "error")
	}

	transactionID := ""
	var transaction appstorejws.TransactionPayload
	var renewal *appstorejws.RenewalPayload

	// A notification carries a signed transaction; an observation carries only a
	// reference. Either way the App Store Server API is the authority and the
	// notification is a trigger, so the signed payload is used to learn *which*
	// transaction to ask about rather than as the answer itself.
	notificationSource := input.Source == SourceAppleNotification || input.Source == SourceAppleNotificationHistory
	if bodyAvailable && notificationSource {
		var envelope struct {
			SignedPayload string `json:"signedPayload"`
		}
		if json.Unmarshal(body, &envelope) == nil && envelope.SignedPayload != "" {
			notification, decodeErr := s.verifier.DecodeNotification(envelope.SignedPayload)
			if decodeErr != nil {
				s.signatureFailure.Add(ctx, 1, metric.WithAttributes(attribute.String("provider", ProviderAppStore)))
				return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
					Permanent(CategorySignature, string(appstorejws.ReasonOf(decodeErr))), QuarantineSignatureInvalid, "security")
			}
			if notification.NotificationType == "TEST" {
				// A test notification proves the endpoint works and models
				// nothing. Recording it without a fact keeps the ledger
				// complete without inventing a transaction.
				return s.recordedNoFactAttempt(job, input, attemptID, attemptNumber, started, "apple_test_notification")
			}
			if notification.Data != nil && notification.Data.SignedTransactionInfo != "" {
				decoded, txErr := s.verifier.DecodeTransaction(notification.Data.SignedTransactionInfo)
				if txErr != nil {
					s.signatureFailure.Add(ctx, 1, metric.WithAttributes(attribute.String("provider", ProviderAppStore)))
					return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
						Permanent(CategorySignature, string(appstorejws.ReasonOf(txErr))), QuarantineSignatureInvalid, "security")
				}
				transactionID = decoded.TransactionID
			}
			if notification.Data != nil && notification.Data.SignedRenewalInfo != "" {
				if decoded, renewalErr := s.verifier.DecodeRenewal(notification.Data.SignedRenewalInfo); renewalErr == nil {
					renewal = &decoded
				}
			}
		}
	}
	if transactionID == "" && bodyAvailable {
		var observation struct {
			Reference string `json:"reference"`
		}
		if json.Unmarshal(body, &observation) == nil {
			transactionID = observation.Reference
		}
	}
	if transactionID == "" {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "no_transaction_reference"), QuarantineMalformedReference, "error")
	}

	// The authority call.
	signed, err := s.apple.TransactionInfo(ctx, credential, transactionID)
	s.providerRequests.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", ProviderAppStore),
		attribute.String("endpoint", "transaction_info"),
		attribute.Bool("failed", err != nil)))
	if err != nil {
		return s.classifiedFailure(job, input, attemptID, attemptNumber, started, err)
	}
	transaction, err = s.verifier.DecodeTransaction(signed)
	if err != nil {
		// A response that does not verify is a far more serious signal than a
		// notification that does not verify: it means the transport or the host
		// is not who it claims to be.
		s.signatureFailure.Add(ctx, 1, metric.WithAttributes(attribute.String("provider", ProviderAppStore)))
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategorySignature, string(appstorejws.ReasonOf(err))), QuarantineSignatureInvalid, "security")
	}

	// Bind the verified payload to the tenant that received it.
	applicationID, platform, appErr := s.repository.ApplicationForIdentifier(ctx, input.CredentialID, transaction.BundleID)
	if appErr != nil || applicationID == "" {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryResolution, "bundle_not_in_credential_scope"), QuarantineApplicationMismatch, "error")
	}
	storeEnvironment := normalizeAppleEnvironment(transaction.Environment)
	if storeEnvironment == StoreUnclassified {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "unclassified_store_environment"), QuarantineStoreEnvironmentMismatch, "error")
	}
	if !storeEnvironmentMatchesMode(storeEnvironment, input.EnvironmentMode) {
		// A sandbox transaction in a production Environment (or the reverse) is
		// exactly the mixing the schema forbids; quarantining here means the
		// insert never has to be attempted.
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "store_environment_mismatch"), QuarantineStoreEnvironmentMismatch, "error")
	}

	transactionType, supported := appleTransactionType(transaction.Type)
	if !supported {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "unsupported_transaction_type"), QuarantineUnsupportedTransaction, "warning")
	}

	fact := TransactionFact{
		ProjectID:                     input.ProjectID,
		EnvironmentID:                 input.EnvironmentID,
		EnvironmentMode:               input.EnvironmentMode,
		ApplicationID:                 applicationID,
		Provider:                      ProviderAppStore,
		StoreEnvironment:              storeEnvironment,
		ProviderTransactionID:         transaction.TransactionID,
		ProviderOriginalTransactionID: transaction.OriginalTransactionID,
		TransactionType:               transactionType,
		FactKind:                      appleFactKind(input.NotificationKind, transaction, renewal),
		IsTestTransaction:             storeEnvironment == StoreSandbox,
		ProviderProductIdentifier:     transaction.ProductID,
		ValidatorVersion:              ValidatorVersion,
		FactVersion:                   1,
		SourceRawInputID:              input.ID,
		ValidationAttemptID:           attemptID,
	}
	if !applyAppleTransaction(&fact, transaction, renewal) {
		// 9A correction (B7): worker wall-clock must never stand in for
		// occurred_at — it participates in FactDigest, so a wall-clock value
		// makes every replay of the same input a "new" fact and defeats replay
		// idempotency. An Apple payload with neither purchaseDate nor
		// signedDate quarantines instead.
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "no_provider_timestamp"), QuarantineMissingProviderTimestamp, "error")
	}

	return s.resolveAndBuild(ctx, job, input, fact, platform, attemptID, attemptNumber, started, storeEnvironment)
}

// applyAppleTransaction populates the transaction-derived fields of an Apple
// fact. It reports false when the payload carries no provider timestamp at
// all, in which case no fact may be recorded (9A correction B7).
func applyAppleTransaction(fact *TransactionFact, transaction appstorejws.TransactionPayload, renewal *appstorejws.RenewalPayload) bool {
	if transaction.OriginalTransactionID != "" {
		fact.PurchaseChainDigest = AppleTransactionKey(fact.StoreEnvironment, transaction.OriginalTransactionID)
	}
	if when, ok := appstorejws.Millis(transaction.PurchaseDate); ok {
		fact.OccurredAt = when
		fact.PeriodStartAt = &when
	}
	if when, ok := appstorejws.Millis(transaction.ExpiresDate); ok {
		fact.PeriodEndAt = &when
	}
	if when, ok := appstorejws.Millis(transaction.RevocationDate); ok {
		// 9A correction: both of Apple's revocation reasons are refunds — 0 is
		// "refunded for another reason", 1 is "refunded due to an app issue" —
		// so a revocation always carries refunded_at, not only reason 1.
		fact.RevokedAt = &when
		fact.RefundedAt = &when
	}
	// Fact-shape v2: persist what was already parsed but dropped (quality B10).
	fact.RevocationReason = transaction.RevocationReason
	fact.InAppOwnershipType = transaction.InAppOwnershipType
	fact.SubscriptionGroupIdentifier = transaction.SubscriptionGroupIdentifier
	if transaction.IsUpgraded {
		upgraded := true
		fact.IsUpgraded = &upgraded
	}
	if renewal != nil {
		expected := renewal.AutoRenewStatus == 1
		fact.RenewalExpected = &expected
		fact.AutoRenewProductIdentifier = renewal.AutoRenewProductID
		if renewal.IsInBillingRetry {
			retrying := true
			fact.BillingRetryActive = &retrying
		}
		if when, ok := appstorejws.Millis(renewal.GracePeriodExpiresAt); ok {
			fact.GracePeriodExpiresAt = &when
		}
	}
	if when, ok := appstorejws.Millis(transaction.SignedDate); ok {
		fact.ProviderEventOccurredAt = &when
	}
	if fact.OccurredAt.IsZero() {
		if when, ok := appstorejws.Millis(transaction.SignedDate); ok {
			fact.OccurredAt = when
		}
	}
	return !fact.OccurredAt.IsZero()
}

// appleTransactionType maps Apple's product type onto the two types Phase 9A
// models. Consumables and non-renewing subscriptions are deliberately
// unsupported: modelling them would require quantity and consumption semantics
// this phase excludes, and silently coercing them into another type would put a
// wrong statement into an append-only ledger.
func appleTransactionType(value string) (string, bool) {
	switch value {
	case appstorejws.ProductTypeAutoRenewable:
		return TypeAutoRenewableSubscription, true
	case appstorejws.ProductTypeNonConsumable:
		return TypeNonConsumable, true
	default:
		return "", false
	}
}

// appleFactKind classifies what happened. The notification type is the best
// signal when present; the transaction alone falls back to purchase semantics.
func appleFactKind(notificationType string, transaction appstorejws.TransactionPayload, renewal *appstorejws.RenewalPayload) string {
	switch notificationType {
	case "SUBSCRIBED":
		return KindInitialPurchase
	case "DID_RENEW":
		return KindRenewal
	case "EXPIRED":
		return KindExpiration
	case "REFUND":
		return KindRefund
	case "REVOKE":
		return KindRevocation
	case "ONE_TIME_CHARGE":
		return KindOneTimePurchase
	case "OFFER_REDEEMED":
		return KindOfferRedeemed
	case "DID_CHANGE_RENEWAL_PREF":
		return KindPlanChange
	case "DID_CHANGE_RENEWAL_STATUS":
		if renewal != nil && renewal.AutoRenewStatus == 1 {
			return KindAutoRenewEnabled
		}
		return KindAutoRenewDisabled
	case "DID_FAIL_TO_RENEW":
		return KindBillingRetryStart
	case "GRACE_PERIOD_EXPIRED":
		return KindExpiration
	}
	switch transaction.TransactionReason {
	case "RENEWAL":
		return KindRenewal
	default:
		if transaction.Type == appstorejws.ProductTypeNonConsumable {
			return KindOneTimePurchase
		}
		return KindInitialPurchase
	}
}

// credentialIDFor resolves which Store Server Credential an input validates
// against.
//
// A notification carries its own credential, because the intake token or the
// Pub/Sub subscription identified it. An observation does not: its tenancy comes
// from an API key, which proves organization, Project, Environment, and
// Application — but says nothing about which store connection is configured.
// Requiring a credential on the input made every observation fail before its
// reference was read, so the credential is resolved here from the scope instead.
// Migration 00022's UNIQUE (project_id, provider, environment_id) is what makes
// that resolution unambiguous rather than a guess.
func (s *Service) credentialIDFor(ctx context.Context, input RawInput) (string, error) {
	if input.CredentialID != "" {
		return input.CredentialID, nil
	}
	identity, err := s.repository.CredentialForEnvironment(ctx, input.ProjectID, input.Provider, input.EnvironmentID)
	if err != nil {
		// Reported as missing rather than unusable: there is nothing to rotate.
		return "", ErrCredentialMissing
	}
	return identity.CredentialID, nil
}

// appleCredential returns the App Store Server API credential and the id of the
// Store Server Credential it came from, so the caller can stamp provenance on
// the attempt even when the input arrived without one.
// applicationScope says how strictly the per-request Apple `bid` must be bound.
//
// Apple requires a `bid` claim on every JWT, but not every call is about one
// Application. Get Transaction Info answers about a specific transaction and
// must carry that transaction's own bundle id; Get Notification History is
// team-scoped and any bundle id inside the credential's scope is a truthful
// claim. Conflating the two either sends the wrong `bid` for a specific
// transaction (the original M-1 defect) or refuses a team-scoped call that has
// no Application to name.
type applicationScope int

const (
	// scopedToInput requires the input's own Application. Used for anything
	// that answers about a specific transaction.
	scopedToInput applicationScope = iota
	// scopedToTeam accepts any Application in the credential's scope. Used for
	// team-wide calls such as notification history and the credential test.
	scopedToTeam
)

func (s *Service) appleCredential(ctx context.Context, input RawInput, scope applicationScope) (appstoreserver.Credential, string, error) {
	if s.apple == nil {
		return appstoreserver.Credential{}, "", ErrCredentialUnusable
	}
	credentialID, err := s.credentialIDFor(ctx, input)
	if err != nil {
		return appstoreserver.Credential{}, "", err
	}
	input.CredentialID = credentialID
	credential, envelope, class, organizationID, bundleID, err := s.repository.CredentialSecretFor(ctx, input.ProjectID, input.CredentialID)
	if err != nil || credential.Status != "active" {
		return appstoreserver.Credential{}, credentialID, ErrCredentialUnusable
	}
	plaintext, err := s.cipher.DecryptSubject(providercredential.Envelope{
		Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
		Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
		CredentialClass: class, Fingerprint: envelope.Fingerprint,
	}, providercredential.SubjectScope{
		OrganizationID:  organizationID,
		ProjectID:       input.ProjectID,
		SubjectKind:     providercredential.SubjectStoreServerCredential,
		SubjectID:       input.CredentialID,
		CredentialClass: class,
	})
	if err != nil {
		return appstoreserver.Credential{}, credentialID, ErrCredentialUnusable
	}
	defer zero(plaintext)
	key, err := appstoreserver.ParsePrivateKey(plaintext)
	if err != nil {
		return appstoreserver.Credential{}, credentialID, ErrCredentialUnusable
	}
	// The `bid` must name the Application this input belongs to. The fallback
	// from CredentialSecretFor is the credential's first scoped Application,
	// which is correct only for a single-Application credential; for a team with
	// two apps on one key it would send the wrong bundle id and Apple would
	// answer 401.
	//
	// There is deliberately no fallback to the issuer id. An issuer UUID is not
	// a bundle id under any circumstance, so sending one can only produce a
	// request Apple rejects — and because a 401 is classified retryable, that
	// rejection would be retried eight times before dead-lettering with a
	// diagnostic pointing at the wrong cause. Failing closed here reports the
	// real problem immediately.
	// For an input-scoped call the `bid` must name this input's Application, and
	// nothing else is an acceptable substitute. The value CredentialSecretFor
	// returns is the credential's alphabetically-first scoped Application, which
	// is correct only for a single-Application credential; falling back to it on
	// a resolution error reintroduces the original defect on exactly the
	// multi-Application credentials the model exists to support, and the 401 it
	// eventually produces points the operator at credential rotation rather than
	// at the missing Application scope.
	//
	// So the resolution error is propagated rather than absorbed. A transient
	// read failure retries; a genuinely unscoped Application quarantines with a
	// diagnostic that names the real problem.
	if scope == scopedToInput {
		if input.ApplicationID == "" {
			return appstoreserver.Credential{}, credentialID, ErrApplicationNotScoped
		}
		resolved, resolveErr := s.repository.ProviderApplicationIdentifier(ctx, input.CredentialID, input.ApplicationID)
		if resolveErr != nil || resolved == "" {
			return appstoreserver.Credential{}, credentialID, ErrApplicationNotScoped
		}
		bundleID = resolved
	}
	// A team-scoped call keeps whichever scoped Application CredentialSecretFor
	// supplied: the request is not about one Application, and any bundle id
	// inside the credential's scope is a truthful claim. An empty one still
	// fails closed, because a credential with no scoped Application cannot make
	// any Apple call at all.
	if bundleID == "" {
		return appstoreserver.Credential{}, credentialID, ErrApplicationNotScoped
	}
	return appstoreserver.Credential{
		IssuerID: credential.AppleIssuerID, KeyID: credential.AppleKeyID, PrivateKey: key,
		BundleID: bundleID, Sandbox: credential.StoreEnvironment == StoreSandbox,
	}, credentialID, nil
}

// ---------------------------------------------------------------------------
// Google validation
// ---------------------------------------------------------------------------

func (s *Service) validateGoogle(ctx context.Context, job ValidationJob, input RawInput, body []byte, bodyAvailable bool, attemptID string, attemptNumber int, started time.Time) AttemptOutcome {
	account, credential, scopedPackageName, err := s.googleCredential(ctx, input)
	if credential.ID != "" {
		input.CredentialID = credential.ID
	}
	if err != nil {
		reason, diagnostic := credentialFailure(err)
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryConfiguration, diagnostic), reason, "error")
	}
	if !bodyAvailable {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "raw_body_unavailable"), QuarantineMalformedReference, "warning")
	}

	work, ok := decodeGoogleWork(body)
	if !ok {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "malformed_google_input"), QuarantineMalformedReference, "error")
	}
	packageName, purchaseToken, productID, orderID := work.packageName, work.purchaseToken, work.productID, work.orderID
	subscription := work.subscription
	if packageName == "" {
		// Only an RTDN carries a packageName; an observation does not.
		packageName = scopedPackageName
	}
	if packageName == "" {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryConfiguration, "no_package_in_credential_scope"),
			QuarantineApplicationMismatch, "error")
	}

	// An observation may carry only an order id. orders.get is the documented
	// way to turn one into a purchase token, and it is the reason a client that
	// knows nothing but an order id is still server-actionable.
	if purchaseToken == "" && orderID != "" {
		order, orderErr := s.google.GetOrder(ctx, account, packageName, orderID)
		s.providerRequests.Add(ctx, 1, metric.WithAttributes(
			attribute.String("provider", ProviderGooglePlay),
			attribute.String("endpoint", "order_get"),
			attribute.Bool("failed", orderErr != nil)))
		if orderErr != nil {
			return s.classifiedFailure(job, input, attemptID, attemptNumber, started, orderErr)
		}
		purchaseToken = order.PurchaseToken
		if productID == "" && len(order.LineItems) == 1 {
			productID = order.LineItems[0].ProductID
		}
	}
	if purchaseToken == "" {
		// A client observation carries only a digest by design, and a digest
		// cannot be reversed into a token. Such an input waits for the RTDN that
		// carries the real token rather than failing permanently.
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "purchase_token_unavailable"), QuarantineMalformedReference, "warning")
	}

	applicationID, platform, appErr := s.repository.ApplicationForIdentifier(ctx, input.CredentialID, packageName)
	if appErr != nil || applicationID == "" {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryResolution, "package_not_in_credential_scope"), QuarantineApplicationMismatch, "error")
	}

	fact := TransactionFact{
		ProjectID:           input.ProjectID,
		EnvironmentID:       input.EnvironmentID,
		EnvironmentMode:     input.EnvironmentMode,
		ApplicationID:       applicationID,
		Provider:            ProviderGooglePlay,
		StoreEnvironment:    credential.StoreEnvironment,
		PurchaseChainDigest: TokenDigest(purchaseToken),
		ValidatorVersion:    ValidatorVersion,
		FactVersion:         1,
		SourceRawInputID:    input.ID,
		ValidationAttemptID: attemptID,
		// OccurredAt is deliberately not defaulted: only a provider-stated
		// time may date a fact (9A correction B7), and a branch that cannot
		// supply one quarantines below.
	}
	// Fact-shape v2: recover the provider event time so ordering inside a
	// Google lineage does not tie on the constant startTime. The RTDN's
	// eventTimeMillis is the provider's own statement; the raw input's
	// provider_occurred_at (Pub/Sub publish time) is the fallback.
	if !work.eventTime.IsZero() {
		when := work.eventTime
		fact.ProviderEventOccurredAt = &when
	} else if input.ProviderOccurredAt != nil {
		when := input.ProviderOccurredAt.UTC()
		fact.ProviderEventOccurredAt = &when
	}

	linkedPurchaseToken := ""
	if subscription {
		purchase, err := s.google.GetSubscription(ctx, account, packageName, purchaseToken)
		s.providerRequests.Add(ctx, 1, metric.WithAttributes(
			attribute.String("provider", ProviderGooglePlay),
			attribute.String("endpoint", "subscription_get"),
			attribute.Bool("failed", err != nil)))
		if err != nil {
			return s.classifiedFailure(job, input, attemptID, attemptNumber, started, err)
		}
		if len(purchase.LineItems) == 0 {
			return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
				Permanent(CategoryInvalid, "subscription_has_no_line_items"), QuarantineMalformedReference, "error")
		}
		applyGoogleSubscription(&fact, purchase)
		if !applyGoogleVoid(&fact, work, input.ProviderOccurredAt) {
			return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
				Permanent(CategoryInvalid, "void_event_time_unavailable"), QuarantineMissingProviderTimestamp, "error")
		}
		linkedPurchaseToken = purchase.LinkedPurchaseToken
	} else {
		// A voided-purchase notification carries no SKU; recover it from the
		// order so the refund fact still resolves to a Product.
		if productID == "" && orderID != "" {
			order, orderErr := s.google.GetOrder(ctx, account, packageName, orderID)
			s.providerRequests.Add(ctx, 1, metric.WithAttributes(
				attribute.String("provider", ProviderGooglePlay),
				attribute.String("endpoint", "order_get"),
				attribute.Bool("failed", orderErr != nil)))
			if orderErr != nil {
				// Review finding I-4: a *permanently* failing orders.get on a
				// void used to burn attempts and record nothing, so the refund
				// never became a fact and the purchase kept granting forever.
				// A transient failure still retries — the order may come back —
				// but once the failure is permanent (or retries are spent) the
				// void is recorded with an unresolved Product instead of being
				// dropped.
				classification := Classify(orderErr, s.now())
				if !work.voided || (classification.Retryable &&
					!classification.ExhaustedFor(attemptNumber, job.MaxAttempts)) {
					return s.classifiedFailure(job, input, attemptID, attemptNumber, started, orderErr)
				}
				return s.voidWithoutProduct(job, input, fact, work, attemptID, attemptNumber, started,
					orderID, "void_order_lookup_permanently_failed")
			}
			if len(order.LineItems) == 1 {
				productID = order.LineItems[0].ProductID
			} else if work.voided {
				// Review finding I-4: a multi-line-item order cannot be
				// attributed to one SKU from the order alone. Quarantining the
				// whole input left the refund unrecorded and the purchase
				// entitled, so the void is recorded product-unresolved instead
				// and gets its own quarantine reason — an operator looking at
				// `product_identifier_unavailable` had no way to tell this case
				// (revenue already refunded, access still to be corrected) from
				// a plainly malformed reference.
				return s.voidWithoutProduct(job, input, fact, work, attemptID, attemptNumber, started,
					orderID, "void_order_line_items_ambiguous")
			}
		}
		if productID == "" {
			if work.voided {
				return s.voidWithoutProduct(job, input, fact, work, attemptID, attemptNumber, started,
					orderID, "void_product_identifier_unavailable")
			}
			return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
				Permanent(CategoryInvalid, "product_identifier_unavailable"), QuarantineMalformedReference, "error")
		}
		purchase, err := s.google.GetProduct(ctx, account, packageName, productID, purchaseToken)
		s.providerRequests.Add(ctx, 1, metric.WithAttributes(
			attribute.String("provider", ProviderGooglePlay),
			attribute.String("endpoint", "product_get"),
			attribute.Bool("failed", err != nil)))
		if err != nil {
			return s.classifiedFailure(job, input, attemptID, attemptNumber, started, err)
		}
		if purchase.PurchaseState != 0 && !work.voided {
			// Only PURCHASED is a completed purchase. PENDING and CANCELLED are
			// recorded as inputs but produce no fact, because a fact asserts that
			// the store confirmed a completed transaction.
			return s.recordedNoFactAttempt(job, input, attemptID, attemptNumber, started, "google_purchase_not_completed")
		}
		// 9A correction (B2): a voided one-time purchase re-queries as
		// purchaseState != 0, and recording no fact left refunded
		// non-consumables entitled forever. The voided-purchase notification is
		// the provider's refund statement — its 30-day lookback is why the void
		// must become a fact on receipt — so it produces a refund fact even
		// though the re-queried state alone says only "not purchased".
		applyGoogleOneTime(&fact, purchase)
		if !applyGoogleVoid(&fact, work, input.ProviderOccurredAt) {
			return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
				Permanent(CategoryInvalid, "void_event_time_unavailable"), QuarantineMissingProviderTimestamp, "error")
		}
	}

	if fact.ProviderTransactionID == "" {
		// Google does not always supply an order id (promotional purchases have
		// none), and the token digest is the documented stable identity, so it
		// stands in rather than leaving the column empty.
		fact.ProviderTransactionID = "token:" + hexOf(fact.PurchaseChainDigest)
	}
	if !storeEnvironmentMatchesMode(fact.StoreEnvironment, input.EnvironmentMode) {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "store_environment_mismatch"), QuarantineStoreEnvironmentMismatch, "error")
	}
	if fact.OccurredAt.IsZero() {
		// 9A correction (B7): occurred_at participates in FactDigest, so worker
		// wall-clock would make every replay a different fact. No provider
		// timestamp means no fact.
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "no_provider_timestamp"), QuarantineMissingProviderTimestamp, "error")
	}
	outcome := s.resolveAndBuild(ctx, job, input, fact, platform, attemptID, attemptNumber, started, fact.StoreEnvironment)
	if linkedPurchaseToken != "" && outcome.Fact != nil {
		// 9A correction (B1): the linked purchase token is a persistent attribute
		// of the successor subscription, present on every re-query for its whole
		// life. The state-derived fact kind is kept — overwriting it hid every
		// later expiration, cancellation, and grace fact behind
		// purchase_superseded — and the supersession edge is recorded as its own
		// fact built only from lineage-constant fields, so its digest is stable
		// and the unique fact constraint absorbs every observation after the
		// first. The link is thereby "emitted once when newly observed" as a
		// structural property rather than a lookup.
		supersession, err := s.supersessionFactFrom(*outcome.Fact)
		if err != nil {
			return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
				Permanent(CategoryInvalid, "supersession_fact_unavailable"),
				QuarantineMalformedReference, "error")
		}
		outcome.Supersession = supersession
	}
	return outcome
}

// applyGoogleSubscription populates the subscription-specific fields of a
// Google fact from the authoritative subscriptionsv2 resource. It is a pure
// assembly step, split out so the fact-kind and supersession behaviour is
// testable without provider plumbing.
func applyGoogleSubscription(fact *TransactionFact, purchase googleplay.SubscriptionPurchase) {
	item := purchase.LineItems[0]
	fact.TransactionType = TypeAutoRenewableSubscription
	fact.ProviderProductIdentifier = item.ProductID
	fact.ProviderTransactionID = purchase.LatestOrderID
	fact.FactKind = googleSubscriptionKind(purchase.SubscriptionState)
	fact.IsTestTransaction = purchase.TestPurchase != nil
	if purchase.SubscriptionState == "SUBSCRIPTION_STATE_ON_HOLD" {
		retrying := true
		fact.BillingRetryActive = &retrying
	}
	if item.OfferDetails != nil {
		fact.ProviderBasePlanIdentifier = item.OfferDetails.BasePlanID
		fact.ProviderOfferIdentifier = item.OfferDetails.OfferID
	}
	if item.AutoRenewingPlan != nil {
		expected := item.AutoRenewingPlan.AutoRenewEnabled
		fact.RenewalExpected = &expected
	}
	if when, ok := parseRFC3339(purchase.StartTime); ok {
		fact.PeriodStartAt = &when
		fact.OccurredAt = when
	}
	if when, ok := parseRFC3339(item.ExpiryTime); ok {
		fact.PeriodEndAt = &when
		if purchase.SubscriptionState == "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" {
			// Play does not publish a separate grace-end field: while a
			// subscription is in grace it keeps `expiryTime` extended to the
			// end of the grace window, so that value *is* the provider-stated
			// grace end. Without it the grace fact carried no bound, the
			// projection warned on every pass, reported the lineage plainly
			// active, and a Project's grants_in_grace opt-out had nothing to
			// act on.
			graceEnd := when
			fact.GracePeriodExpiresAt = &graceEnd
		}
	}
	if purchase.LinkedPurchaseToken != "" {
		// The link is recorded, not acted on: acting on it would mean revoking
		// access, and no access state exists to revoke. The state-derived
		// fact_kind above is deliberately not overwritten (9A defect B1).
		fact.SupersedesChainDigest = TokenDigest(purchase.LinkedPurchaseToken)
	}
}

// applyGoogleOneTime populates the one-time-purchase fields of a Google fact
// from the authoritative purchases.products resource.
func applyGoogleOneTime(fact *TransactionFact, purchase googleplay.ProductPurchase) {
	fact.TransactionType = TypeNonConsumable
	fact.FactKind = KindOneTimePurchase
	fact.ProviderProductIdentifier = purchase.ProductID
	fact.ProviderTransactionID = purchase.OrderID
	if purchase.PurchaseType != nil && *purchase.PurchaseType == 0 {
		fact.IsTestTransaction = true
	}
	if millis, err := strconv.ParseInt(purchase.PurchaseTimeMillis, 10, 64); err == nil && millis > 0 {
		when := time.UnixMilli(millis).UTC()
		fact.OccurredAt = when
		fact.PeriodStartAt = &when
	}
}

// applyGoogleVoid rewrites a fact as the refund the voided-purchase
// notification asserts (9A correction B2). A Google void both refunds and
// revokes ownership, so both effective timestamps are set from the provider's
// own event time. It reports false when the input is voided but no provider
// timestamp exists to date the refund — a fact must never be dated with worker
// wall-clock.
func applyGoogleVoid(fact *TransactionFact, work googleWork, providerOccurredAt *time.Time) bool {
	if !work.voided {
		return true
	}
	when := work.eventTime
	if when.IsZero() && providerOccurredAt != nil {
		when = providerOccurredAt.UTC()
	}
	if when.IsZero() {
		return false
	}
	fact.FactKind = KindRefund
	fact.OccurredAt = when
	fact.RefundedAt = &when
	fact.RevokedAt = &when
	switch work.refundType {
	case 1:
		fact.RefundType = RefundTypeFull
	case 2:
		fact.RefundType = RefundTypeQuantityPartial
	}
	return true
}

// ProviderProductVoidUnresolved stands in for the SKU of a voided Google
// purchase Mosaic could not attribute to one product. Play product identifiers
// cannot contain a colon, so the sentinel can never collide with a real one, and
// it exists only because `provider_product_identifier` is NOT NULL and non-blank
// on every fact.
const ProviderProductVoidUnresolved = "unresolved:voided_purchase"

// voidWithoutProduct records a Google void whose Product could not be resolved
// (review finding I-4).
//
// Two provider shapes reach here: an order with several line items, which
// cannot be attributed to one SKU, and an orders.get that fails permanently.
// Both previously produced no fact at all — the first quarantined the input as
// a malformed reference, the second exhausted its attempts — so a refunded
// purchase went on granting its Entitlement indefinitely. Money left the
// merchant and access did not.
//
// The refund is therefore recorded as a fact with `resolution_state =
// unresolved`, which drives the lineage to `unknown` rather than leaving it
// `owned`: Mosaic states that this purchase is no longer good without claiming
// to know which Product it was. The input is quarantined alongside it under its
// own reason code, so the operator queue distinguishes "refund recorded,
// product needs attribution" from a plainly malformed reference.
func (s *Service) voidWithoutProduct(job ValidationJob, input RawInput, fact TransactionFact, work googleWork,
	attemptID string, attemptNumber int, started time.Time, orderID, diagnostic string) AttemptOutcome {

	fact.TransactionType = TypeNonConsumable
	fact.ProviderProductIdentifier = ProviderProductVoidUnresolved
	fact.ResolutionState = StateUnresolved
	fact.MosaicProductID = ""
	fact.ProviderProductMappingID = ""
	fact.ResolvedMappingVersion = nil
	if orderID != "" {
		fact.ProviderTransactionID = orderID
	} else {
		fact.ProviderTransactionID = "token:" + hexOf(fact.PurchaseChainDigest)
	}
	if !applyGoogleVoid(&fact, work, input.ProviderOccurredAt) || fact.OccurredAt.IsZero() {
		// 9A correction B7 still governs: no provider timestamp, no fact. The
		// void is reported under the timestamp reason rather than this one,
		// because the operator's next action is different.
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "void_event_time_unavailable"),
			QuarantineMissingProviderTimestamp, "error")
	}
	if !storeEnvironmentMatchesMode(fact.StoreEnvironment, input.EnvironmentMode) {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "store_environment_mismatch"),
			QuarantineStoreEnvironmentMismatch, "error")
	}

	factID, err := s.newID("btf")
	if err != nil {
		return s.quarantineAttempt(job, input, attemptID, attemptNumber, started,
			Permanent(CategoryInvalid, "fact_identifier_unavailable"),
			QuarantineMalformedReference, "error")
	}
	fact.ID = factID
	fact.RecordedAt = s.now()
	fact.FactDigest = FactDigest(fact)

	completed := s.now()
	outcome := AttemptOutcome{
		Attempt: ValidationAttempt{
			ID: attemptID, ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
			RawInputID: input.ID, CredentialID: input.CredentialID,
			AttemptNumber: attemptNumber, ValidatorVersion: ValidatorVersion,
			StartedAt: started, CompletedAt: completed,
			// Quarantined rather than validated: a fact was produced, but the
			// input still needs operator attention, which is the same shape
			// resolveAndBuild uses for an unresolvable Product.
			Outcome: OutcomeQuarantined, Retryable: false,
			FailureCategory:  CategoryResolution,
			DiagnosticCode:   diagnostic,
			StoreEnvironment: fact.StoreEnvironment,
			LatencyMs:        int(completed.Sub(started).Milliseconds()),
			CorrelationID:    input.CorrelationID,
		},
		Fact: &fact,
		Quarantine: &QuarantineWrite{
			RawInputID: input.ID, ApplicationID: fact.ApplicationID, Provider: fact.Provider,
			ReasonCode: QuarantineVoidProductUnresolved, Severity: "error",
			Scopes:         []string{"provider_product_mapping"},
			DiagnosticCode: diagnostic, OccurredAt: completed,
		},
		// The work is done: re-running it would re-query the same order and
		// reach the same answer, and the fact is already recorded.
		JobStatus: "completed",
	}
	outcome.Ledger = s.ledgerFor(input, outcome)
	return outcome
}

// supersessionFactFrom derives the once-per-lineage purchase_superseded fact
// from a validated successor fact. Every field that changes across the
// successor's life (order id, period end, revocation, renewal intent) is
// cleared or replaced with a lineage-constant value, so re-observing the same
// link always recomputes the same FactDigest.
func (s *Service) supersessionFactFrom(main TransactionFact) (*TransactionFact, error) {
	fact := main
	id, err := s.newID("btf")
	if err != nil {
		// Previously this returned nil and the link was silently never emitted.
		// A supersession edge that is dropped without a trace is a lineage that
		// never learns its own chain root, so the failure is reported.
		return nil, fmt.Errorf("generate supersession fact identifier: %w", err)
	}
	fact.ID = id
	fact.FactKind = KindPurchaseSuperseded
	fact.ProviderTransactionID = "token:" + hexOf(fact.PurchaseChainDigest)
	fact.PeriodEndAt = nil
	fact.RevokedAt = nil
	fact.RefundedAt = nil
	fact.RenewalExpected = nil
	fact.GracePeriodExpiresAt = nil
	fact.BillingRetryActive = nil
	fact.AutoRenewProductIdentifier = ""
	fact.IsUpgraded = nil
	fact.RevocationReason = nil
	fact.RefundType = ""
	fact.ProviderEventOccurredAt = nil

	// The edge is a statement about two purchase tokens and nothing else, so
	// every field that can move underneath it is cleared before the digest is
	// taken. Product identity in particular is not lineage-constant: an offer
	// expires, a mapping is edited, an unresolved fact is later resolved — and
	// each of those recomputed a different digest for the same link, minting a
	// duplicate purchase_superseded fact every time.
	fact.ProviderProductIdentifier = "superseded"
	fact.ProviderBasePlanIdentifier = ""
	fact.ProviderOfferIdentifier = ""
	fact.ResolutionState = StateUnresolved
	fact.MosaicProductID = ""
	fact.ProviderProductMappingID = ""
	fact.ResolvedMappingVersion = nil
	// A void rewrites OccurredAt to the refund instant, so the subscription's
	// own start is used where it exists: that value is constant for the chain.
	if fact.PeriodStartAt != nil {
		fact.OccurredAt = fact.PeriodStartAt.UTC()
	}
	fact.RecordedAt = s.now()
	fact.FactDigest = FactDigest(fact)
	return &fact, nil
}

// googleWork is the decoded intent of one Google raw body: which purchase to
// re-query, and — for a voided purchase notification — the void semantics the
// re-queried state alone cannot express.
type googleWork struct {
	packageName   string
	purchaseToken string
	productID     string
	orderID       string
	subscription  bool
	// voided marks a voidedPurchaseNotification. Google's own state on
	// re-query says only "not purchased"; the notification is the evidence
	// that the reason is a refund, and its 30-day lookback means the void
	// must be persisted on receipt.
	voided bool
	// refundType is Google's voided refundType: 1 full, 2 quantity-based
	// partial. Zero when absent.
	refundType int
	// eventTime is the RTDN eventTimeMillis, the provider-stated instant the
	// event occurred. Zero when the body carried none.
	eventTime time.Time
}

// decodeGoogleWork reads whichever shape the raw body holds: a decoded RTDN or
// a Mosaic-built observation record.
func decodeGoogleWork(body []byte) (googleWork, bool) {
	var notification googleplay.DeveloperNotification
	if err := json.Unmarshal(body, &notification); err == nil && notification.PackageName != "" {
		work := googleWork{packageName: notification.PackageName}
		if millis, err := strconv.ParseInt(notification.EventTimeMillis, 10, 64); err == nil && millis > 0 {
			work.eventTime = time.UnixMilli(millis).UTC()
		}
		switch {
		case notification.SubscriptionNotification != nil:
			work.purchaseToken = notification.SubscriptionNotification.PurchaseToken
			work.productID = notification.SubscriptionNotification.SubscriptionID
			work.subscription = true
			return work, true
		case notification.OneTimeProductNotification != nil:
			work.purchaseToken = notification.OneTimeProductNotification.PurchaseToken
			work.productID = notification.OneTimeProductNotification.SKU
			return work, true
		case notification.VoidedPurchaseNotification != nil:
			work.purchaseToken = notification.VoidedPurchaseNotification.PurchaseToken
			work.orderID = notification.VoidedPurchaseNotification.OrderID
			work.subscription = notification.VoidedPurchaseNotification.ProductType == 1
			work.voided = true
			work.refundType = notification.VoidedPurchaseNotification.RefundType
			return work, true
		case notification.TestNotification != nil:
			return work, true
		}
	}
	var observation struct {
		Reference      string `json:"reference"`
		ReferenceKind  string `json:"referenceKind"`
		OrderReference string `json:"orderReference"`
		PurchaseToken  string `json:"purchaseToken"`
	}
	if err := json.Unmarshal(body, &observation); err != nil {
		return googleWork{}, false
	}
	return googleWork{
		purchaseToken: observation.PurchaseToken,
		orderID:       observation.OrderReference,
		subscription:  true,
	}, true
}

func googleSubscriptionKind(state string) string {
	switch state {
	case "SUBSCRIPTION_STATE_ACTIVE":
		return KindRenewal
	case "SUBSCRIPTION_STATE_CANCELED":
		return KindCancellationScheduled
	case "SUBSCRIPTION_STATE_EXPIRED":
		return KindExpiration
	case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
		return KindGracePeriodStart
	case "SUBSCRIPTION_STATE_ON_HOLD":
		return KindBillingRetryStart
	case "SUBSCRIPTION_STATE_PAUSED":
		return KindPaused
	case "SUBSCRIPTION_STATE_PENDING":
		return KindInitialPurchase
	default:
		return KindInitialPurchase
	}
}

// googleCredential returns the service account, the credential record, and the
// package name of the credential's first scoped Application.
//
// The package name is returned because an observation's body carries none — only
// an RTDN does — and the Play API requires one on every call. Falling back to
// the credential's scoped Application is the same convention the Apple path
// already uses for `bid`. The previous fallback was the Pub/Sub project id,
// which is not a package name and could never match an Application scope.
func (s *Service) googleCredential(ctx context.Context, input RawInput) (*googleplay.ServiceAccount, StoreServerCredential, string, error) {
	if s.google == nil {
		return nil, StoreServerCredential{}, "", ErrCredentialUnusable
	}
	credentialID, err := s.credentialIDFor(ctx, input)
	if err != nil {
		return nil, StoreServerCredential{}, "", err
	}
	input.CredentialID = credentialID
	credential, envelope, class, organizationID, packageName, err := s.repository.CredentialSecretFor(ctx, input.ProjectID, input.CredentialID)
	if err != nil || credential.Status != "active" {
		return nil, StoreServerCredential{}, "", ErrCredentialUnusable
	}
	plaintext, err := s.cipher.DecryptSubject(providercredential.Envelope{
		Version: envelope.Version, Algorithm: envelope.Algorithm, KeyID: envelope.KeyID,
		Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
		CredentialClass: class, Fingerprint: envelope.Fingerprint,
	}, providercredential.SubjectScope{
		OrganizationID:  organizationID,
		ProjectID:       input.ProjectID,
		SubjectKind:     providercredential.SubjectStoreServerCredential,
		SubjectID:       input.CredentialID,
		CredentialClass: class,
	})
	if err != nil {
		return nil, credential, packageName, ErrCredentialUnusable
	}
	defer zero(plaintext)
	account, err := googleplay.ParseServiceAccount(plaintext)
	if err != nil {
		return nil, credential, packageName, ErrCredentialUnusable
	}
	return account, credential, packageName, nil
}

// ---------------------------------------------------------------------------
// Resolution and outcome assembly
// ---------------------------------------------------------------------------

// resolveAndBuild runs Product resolution and assembles the attempt outcome.
//
// An unresolved Product still produces a fact, with resolution_state
// 'unresolved' and no Mosaic Product. Dropping it instead would make the ledger
// incomplete exactly where an operator most needs it: the store confirmed a
// real purchase of something Mosaic does not recognise, and that is evidence,
// not noise. The input is quarantined in parallel so the operator is asked to
// create the mapping.
func (s *Service) resolveAndBuild(ctx context.Context, job ValidationJob, input RawInput, fact TransactionFact, platform, attemptID string, attemptNumber int, started time.Time, storeEnvironment string) AttemptOutcome {
	candidates, err := s.repository.MappingCandidates(ctx, input.EnvironmentID, fact.ApplicationID, platform, fact.Provider, fact.ProviderProductIdentifier)
	if err != nil {
		return s.failedAttempt(job, attemptID, attemptNumber, started,
			Classification{Category: CategoryTransient, Retryable: true, Diagnostic: "mapping_lookup_failed"},
			storeEnvironment, input.CredentialID)
	}
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ID)
	}
	successors, err := s.repository.MappingSuccessors(ctx, input.ProjectID, ids)
	if err != nil {
		successors = map[string]MappingCandidate{}
	}

	resolution := Resolve(ResolutionInput{
		Provider:                   fact.Provider,
		ProviderProductIdentifier:  fact.ProviderProductIdentifier,
		ProviderBasePlanIdentifier: fact.ProviderBasePlanIdentifier,
		ProviderOfferIdentifier:    fact.ProviderOfferIdentifier,
		OccurredAt:                 fact.OccurredAt,
		TransactionType:            fact.TransactionType,
		Candidates:                 candidates,
		Successors:                 successors,
	})

	resolutionID, _ := s.newID("bpr")
	record := &ResolutionRecord{
		ID:                         resolutionID,
		ProjectID:                  input.ProjectID,
		EnvironmentID:              input.EnvironmentID,
		ApplicationID:              fact.ApplicationID,
		ValidationAttemptID:        attemptID,
		RawInputID:                 input.ID,
		Provider:                   fact.Provider,
		ProviderProductIdentifier:  fact.ProviderProductIdentifier,
		ProviderBasePlanIdentifier: fact.ProviderBasePlanIdentifier,
		ProviderOfferIdentifier:    fact.ProviderOfferIdentifier,
		Outcome:                    resolution.Outcome,
		CandidateCount:             resolution.CandidateCount,
		DiagnosticCode:             resolution.DiagnosticCode,
		OccurredAt:                 fact.OccurredAt,
		ResolvedAt:                 s.now(),
	}

	if resolution.Outcome == ResolutionResolved {
		record.ResolutionState = resolution.State
		record.MosaicProductID = resolution.MosaicProductID
		record.ProviderProductMappingID = resolution.MappingID
		record.MatchedMappingID = resolution.MatchedMappingID
		version := resolution.MappingVersion
		record.MappingVersion = &version

		fact.ResolutionState = resolution.State
		fact.MosaicProductID = resolution.MosaicProductID
		fact.ProviderProductMappingID = resolution.MappingID
		fact.ResolvedMappingVersion = &version
	} else {
		fact.ResolutionState = StateUnresolved
	}

	factID, _ := s.newID("btf")
	fact.ID = factID
	fact.RecordedAt = s.now()
	fact.FactDigest = FactDigest(fact)

	completed := s.now()
	outcome := AttemptOutcome{
		Attempt: ValidationAttempt{
			ID: attemptID, ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
			RawInputID: input.ID, CredentialID: input.CredentialID,
			AttemptNumber: attemptNumber, ValidatorVersion: ValidatorVersion,
			StartedAt: started, CompletedAt: completed,
			Outcome: OutcomeValidated, Retryable: false,
			StoreEnvironment: storeEnvironment,
			LatencyMs:        int(completed.Sub(started).Milliseconds()),
			CorrelationID:    input.CorrelationID,
		},
		Resolution: record,
		Fact:       &fact,
		JobStatus:  "completed",
	}

	if reason, quarantines := QuarantineReasonFor(resolution.Outcome); quarantines {
		outcome.Attempt.Outcome = OutcomeQuarantined
		outcome.Attempt.FailureCategory = CategoryResolution
		outcome.Attempt.DiagnosticCode = resolution.DiagnosticCode
		outcome.Quarantine = &QuarantineWrite{
			RawInputID: input.ID, ApplicationID: fact.ApplicationID, Provider: fact.Provider,
			ReasonCode: reason, Severity: "warning",
			Scopes:         []string{"provider_product_mapping"},
			DiagnosticCode: resolution.DiagnosticCode, OccurredAt: completed,
		}
	}
	outcome.Ledger = s.ledgerFor(input, outcome)
	return outcome
}

func (s *Service) ledgerFor(input RawInput, outcome AttemptOutcome) []LedgerEntry {
	now := s.now()
	entries := make([]LedgerEntry, 0, 4)
	add := func(entryType string, detail map[string]string) {
		id, _ := s.newID("ble")
		entries = append(entries, LedgerEntry{
			ID: id, ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
			EntryType: entryType, RawInputID: input.ID,
			ValidationAttemptID: outcome.Attempt.ID,
			CorrelationID:       input.CorrelationID, OccurredAt: now, Detail: detail,
		})
	}
	add(LedgerValidationStarted, nil)
	switch outcome.Attempt.Outcome {
	case OutcomeValidated:
		add(LedgerValidationSucceeded, nil)
	case OutcomeQuarantined:
		add(LedgerValidationFailed, map[string]string{"diagnosticCode": outcome.Attempt.DiagnosticCode})
	default:
		add(LedgerValidationFailed, map[string]string{"diagnosticCode": outcome.Attempt.DiagnosticCode})
	}
	if outcome.Resolution != nil {
		entryType := LedgerProductResolved
		if outcome.Resolution.Outcome != ResolutionResolved {
			entryType = LedgerProductResolutionFailed
		}
		add(entryType, map[string]string{"outcome": outcome.Resolution.Outcome})
	}
	if outcome.Fact != nil {
		add(LedgerFactRecorded, nil)
	}
	if outcome.Quarantine != nil {
		add(LedgerInputQuarantined, map[string]string{"reasonCode": outcome.Quarantine.ReasonCode})
	}
	return entries
}

// ---------------------------------------------------------------------------
// Attempt shapes
// ---------------------------------------------------------------------------

func (s *Service) classifiedFailure(job ValidationJob, input RawInput, attemptID string, attemptNumber int, started time.Time, err error) AttemptOutcome {
	now := s.now()
	classification := Classify(err, now)
	outcome := AttemptOutcome{
		Attempt: ValidationAttempt{
			ID: attemptID, ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
			RawInputID: input.ID, CredentialID: input.CredentialID,
			AttemptNumber: attemptNumber, ValidatorVersion: ValidatorVersion,
			StartedAt: started, CompletedAt: now,
			FailureCategory:    classification.Category,
			DiagnosticCode:     classification.Diagnostic,
			ProviderCode:       classification.ProviderCode,
			ProviderHTTPStatus: classification.HTTPStatus,
			StoreEnvironment:   input.StoreEnvironment,
			LatencyMs:          int(now.Sub(started).Milliseconds()),
			CorrelationID:      input.CorrelationID,
		},
	}
	exhausted := classification.ExhaustedFor(attemptNumber, job.MaxAttempts)
	switch {
	case classification.Retryable && !exhausted:
		outcome.Attempt.Outcome = OutcomeRetryableFailure
		outcome.Attempt.Retryable = true
		outcome.NextAttemptAtSet(NextAttemptAt(now, attemptNumber, classification, s.jitter))
		outcome.JobStatus = "queued"
	case classification.Retryable && exhausted:
		// A retryable failure that has run out of attempts is a dead letter, not
		// a silent drop: it becomes a quarantine record an operator can retry.
		// An authentication failure reaches here after two attempts rather than
		// eight, and quarantines under a reason that names the credential, so
		// the operator is pointed at the thing they actually have to fix.
		outcome.Attempt.Outcome = OutcomePermanentlyFailed
		outcome.JobStatus = "failed"
		reason := QuarantineValidationExhausted
		scopes := []string(nil)
		if classification.Category == CategoryAuth {
			// Name the credential, not the input: a rejected assertion is a
			// credential problem and the operator's next action is to check it.
			reason = QuarantineCredentialRevoked
			scopes = []string{"store_server_credential"}
		}
		outcome.Quarantine = &QuarantineWrite{
			RawInputID: input.ID, Provider: input.Provider,
			ReasonCode: reason, Severity: "error", Scopes: scopes,
			DiagnosticCode: classification.Diagnostic, OccurredAt: now,
		}
	default:
		outcome.Attempt.Outcome = OutcomePermanentlyFailed
		outcome.JobStatus = "failed"
		outcome.Quarantine = &QuarantineWrite{
			RawInputID: input.ID, Provider: input.Provider,
			ReasonCode: QuarantineProviderPermanentlyFailed, Severity: "error",
			DiagnosticCode: classification.Diagnostic, OccurredAt: now,
		}
	}
	outcome.Ledger = s.ledgerFor(input, outcome)
	return outcome
}

func (s *Service) quarantineAttempt(job ValidationJob, input RawInput, attemptID string, attemptNumber int, started time.Time, classification Classification, reason, severity string) AttemptOutcome {
	now := s.now()
	outcome := AttemptOutcome{
		Attempt: ValidationAttempt{
			ID: attemptID, ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
			RawInputID: input.ID, CredentialID: input.CredentialID,
			AttemptNumber: attemptNumber, ValidatorVersion: ValidatorVersion,
			StartedAt: started, CompletedAt: now,
			Outcome: OutcomeQuarantined, Retryable: false,
			FailureCategory: classification.Category, DiagnosticCode: classification.Diagnostic,
			StoreEnvironment: input.StoreEnvironment,
			LatencyMs:        int(now.Sub(started).Milliseconds()),
			CorrelationID:    input.CorrelationID,
		},
		Quarantine: &QuarantineWrite{
			RawInputID: input.ID, ApplicationID: input.ApplicationID, Provider: input.Provider,
			ReasonCode: reason, Severity: severity,
			DiagnosticCode: classification.Diagnostic, OccurredAt: now,
		},
		JobStatus: "failed",
	}
	outcome.Ledger = s.ledgerFor(input, outcome)
	return outcome
}

func (s *Service) recordedNoFactAttempt(job ValidationJob, input RawInput, attemptID string, attemptNumber int, started time.Time, diagnostic string) AttemptOutcome {
	now := s.now()
	outcome := AttemptOutcome{
		Attempt: ValidationAttempt{
			ID: attemptID, ProjectID: input.ProjectID, EnvironmentID: input.EnvironmentID,
			RawInputID: input.ID, CredentialID: input.CredentialID,
			AttemptNumber: attemptNumber, ValidatorVersion: ValidatorVersion,
			StartedAt: started, CompletedAt: now,
			Outcome: OutcomeRecordedNoFact, Retryable: false,
			DiagnosticCode:   diagnostic,
			StoreEnvironment: input.StoreEnvironment,
			LatencyMs:        int(now.Sub(started).Milliseconds()),
			CorrelationID:    input.CorrelationID,
		},
		JobStatus: "completed",
	}
	outcome.Ledger = s.ledgerFor(input, outcome)
	return outcome
}

func (s *Service) failedAttempt(job ValidationJob, attemptID string, attemptNumber int, started time.Time, classification Classification, storeEnvironment, credentialID string) AttemptOutcome {
	now := s.now()
	return AttemptOutcome{
		Attempt: ValidationAttempt{
			ID: attemptID, ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID,
			RawInputID: job.RawInputID, CredentialID: credentialID,
			AttemptNumber: attemptNumber, ValidatorVersion: ValidatorVersion,
			StartedAt: started, CompletedAt: now,
			Outcome: OutcomePermanentlyFailed, Retryable: false,
			FailureCategory: classification.Category, DiagnosticCode: classification.Diagnostic,
			StoreEnvironment: storeEnvironment,
			LatencyMs:        int(now.Sub(started).Milliseconds()),
			CorrelationID:    "worker",
		},
		JobStatus: "failed",
	}
}

// NextAttemptAtSet assigns the retry instant. It exists as a method so the
// zero value keeps its meaning ("no retry scheduled") at the call sites above.
func (o *AttemptOutcome) NextAttemptAtSet(at time.Time) { o.NextAvailableAt = at }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// credentialFailure separates "there is no connection" from "the connection is
// broken". They are different operator actions — connect a store versus rotate a
// secret — so they get different quarantine reasons and different diagnostics
// rather than being flattened into one misleading code.
func credentialFailure(err error) (reason, diagnostic string) {
	switch {
	case errors.Is(err, ErrCredentialMissing):
		return QuarantineMissingCredential, "no_credential_for_environment"
	case errors.Is(err, ErrApplicationNotScoped):
		// A different operator action from a bad credential: scope the
		// Application to the credential rather than replace the key.
		return QuarantineApplicationMismatch, "application_not_scoped_to_credential"
	default:
		return QuarantineCredentialUnavailable, "credential_unusable"
	}
}

// storeEnvironmentMatchesMode enforces the sandbox/production separation the
// schema also enforces, so a mismatch becomes a quarantine record rather than a
// constraint violation.
func storeEnvironmentMatchesMode(storeEnvironment, environmentMode string) bool {
	if environmentMode == "production" {
		return storeEnvironment == StoreProduction
	}
	return storeEnvironment == StoreSandbox
}

func parseRFC3339(value string) (time.Time, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return time.Time{}, false
	}
	return parsed.UTC(), true
}

func hexOf(value []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(value)*2)
	for i, b := range value {
		out[i*2] = digits[b>>4]
		out[i*2+1] = digits[b&0x0f]
	}
	return string(out)
}

// zero clears decrypted material as soon as it is no longer needed.
func zero(value []byte) {
	for i := range value {
		value[i] = 0
	}
}

var _ = errors.Is
