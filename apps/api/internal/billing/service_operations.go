package billing

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/jobtelemetry"
)

const (
	operationLease = 5 * time.Minute
	// rtdnBatchSize bounds one pull. Small batches keep the acknowledge window
	// short, which matters because a message is only acknowledged after its Raw
	// Billing Input is durably committed.
	rtdnBatchSize = 25
	// reconciliationPageSize bounds one reconciliation step so a run yields the
	// worker regularly and can be resumed from its cursor.
	reconciliationPageSize = 20
	// replayBatchSize bounds one replay job. Both this and the page size above
	// are sized against operationLease rather than chosen round: each input in
	// the batch makes a bounded provider call (8 s ceiling in both clients), so
	// 25 × 8 s = 200 s stays inside the five-minute lease with room to spare. A
	// larger batch could have its lease expire mid-run and let a second worker
	// duplicate the work.
	replayBatchSize = 25
)

// revalidationResult is what one caller-initiated revalidation produced. It is
// the input to a replay's comparison and to a reconciliation's counters.
type revalidationResult struct {
	// Outcome is the validation attempt's own outcome.
	Outcome string
	// Digest is the lowercase-hex fact digest the revalidation recomputed, empty
	// when the attempt asserted no fact.
	Digest string
	// Existing reports whether Digest was already on record for this input. This
	// is the actual comparison: an unchanged provider answer recomputes a digest
	// Mosaic already holds, and a changed one does not.
	Existing bool
	// Conflicted reports that the recomputed fact contradicts what was already
	// recorded for this input: the input had facts before, and this attempt
	// produced a digest that is not among them.
	//
	// The distinction from a plain discovery is the whole point. An input that
	// had no facts and now has one is Mosaic learning something new. An input
	// that had a fact and now produces a different one is the provider saying
	// something different from what Mosaic recorded — which is the "conflicting
	// state" half of the Gate 9A reconciliation criterion, and needs an
	// operator's attention rather than a counter labelled "discovered".
	//
	// Nothing is overwritten either way: both facts remain, and the conflict is
	// a diagnostic over an append-only ledger.
	Conflicted bool
}

// revalidate runs the full validation pipeline once against an input that has
// already been ingested, and reports how its result compares with what is
// already recorded.
//
// It does not go through PersistRawInput. That path is idempotent by design: a
// second write of an existing input takes the duplicate branch, which returns
// before the enqueue and therefore queues nothing. Anything built on it would
// report work it never did. Instead the validation job is created (or taken
// over) already leased to this caller, so the ordinary validation worker cannot
// claim it in between, and the attempt is committed through exactly the same
// CompleteAttempt transaction the worker uses — the same append-only attempt,
// the same fact deduplication, the same ledger entries, the same quarantine
// closure on success.
func (s *Service) revalidate(ctx context.Context, workerID string, input RawInput) (revalidationResult, error) {
	// The baseline is read before the attempt runs, so a fact this very attempt
	// appends cannot be mistaken for one that was already there.
	baseline, err := s.repository.FactDigestsForInput(ctx, input.ProjectID, input.ID)
	if err != nil {
		return revalidationResult{}, safeFailure(err, "billing_fact_baseline_failed")
	}

	now := s.now()
	job, err := s.repository.LeaseValidationJobFor(ctx, workerID, input, now, now.Add(validationLease))
	if errors.Is(err, ErrValidationBusy) {
		// Another worker holds a live lease on this input. Running anyway would
		// put two validations on the same input concurrently, and the loser of
		// the attempt-number race would discard everything it produced. The
		// caller leaves the input for the next pass instead.
		return revalidationResult{}, ErrValidationBusy
	}
	if err != nil {
		return revalidationResult{}, safeFailure(err, "billing_revalidation_lease_failed")
	}

	started := s.now()
	outcome := s.runValidation(ctx, job, started)
	s.validationLatency.Record(ctx, float64(outcome.Attempt.LatencyMs), metric.WithAttributes(
		attribute.String("provider", job.Provider)))
	s.validationOutcome.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", job.Provider),
		attribute.String("outcome", outcome.Attempt.Outcome),
		attribute.String("trigger", "revalidation")))
	if err := s.repository.CompleteAttempt(ctx, job, outcome, s.now()); err != nil {
		return revalidationResult{}, safeFailure(err, "billing_attempt_write_failed")
	}

	result := revalidationResult{Outcome: outcome.Attempt.Outcome}
	if outcome.Fact != nil {
		result.Digest = hexOf(outcome.Fact.FactDigest)
		for _, known := range baseline {
			if known == result.Digest {
				result.Existing = true
				break
			}
		}
		// A new digest where facts already existed is a contradiction, not a
		// discovery. Where no facts existed it is simply new information.
		result.Conflicted = !result.Existing && len(baseline) > 0
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// Google RTDN pull consumer
// ---------------------------------------------------------------------------

// ProcessNextRTDN pulls one batch of Real-time Developer Notifications for each
// active Google credential.
//
// The order is deliberate and is the whole reliability argument: pull, persist,
// then acknowledge. A crash between persist and acknowledge causes Google to
// redeliver, and the idempotency key turns the redelivery into a duplicate that
// writes nothing. A crash between acknowledge and persist would lose a
// notification outright, which is why acknowledgement never runs first.
func (s *Service) ProcessNextRTDN(ctx context.Context, workerID string) (bool, error) {
	if s.google == nil {
		return false, nil
	}
	credentials, err := s.repository.ActiveCredentials(ctx, ProviderGooglePlay)
	if err != nil {
		return false, safeFailure(err, "billing_credential_scan_failed")
	}
	processedAny := false
	for _, identity := range credentials {
		// A disabled Project records nothing. Skipping before the pull also
		// avoids acknowledging messages Mosaic would then refuse to store,
		// which would lose them permanently.
		if enabled, err := s.repository.BillingEnabled(ctx, identity.ProjectID); err == nil && !enabled {
			continue
		}
		processed, err := s.pullOne(ctx, identity)
		if err != nil {
			// One tenant's misconfiguration must not stop every other tenant's
			// notifications, so the loop continues and the failure is recorded
			// against that credential's health.
			_ = s.repository.UpdateCredentialHealth(ctx, identity.ProjectID, identity.CredentialID,
				"degraded", "rtdn_pull_failed", false, s.now())
			continue
		}
		processedAny = processedAny || processed
	}
	return processedAny, nil
}

func (s *Service) pullOne(ctx context.Context, identity IntakeIdentity) (bool, error) {
	ctx, span := s.tracer.Start(ctx, "billing.intake.google")
	defer span.End()

	credential, _, _, _, _, err := s.repository.CredentialSecretFor(ctx, identity.ProjectID, identity.CredentialID)
	if err != nil {
		return false, err
	}
	account, _, _, err := s.googleCredential(ctx, RawInput{
		ProjectID: identity.ProjectID, CredentialID: identity.CredentialID, Provider: ProviderGooglePlay,
	})
	if err != nil {
		return false, err
	}
	messages, err := s.google.Pull(ctx, account, credential.GooglePubSubProjectID, credential.GooglePubSubSubscription, rtdnBatchSize)
	if err != nil {
		return false, err
	}
	if len(messages) == 0 {
		return false, nil
	}

	now := s.now()
	subscription := credential.GooglePubSubProjectID + "/" + credential.GooglePubSubSubscription
	acknowledged := make([]string, 0, len(messages))

	for _, received := range messages {
		notification, raw, decodeErr := googleplay.DecodeNotification(received.Message)
		if decodeErr != nil {
			// A message that is not a developer notification cannot be attributed
			// to an Application. It is acknowledged so it stops being redelivered
			// forever, and the counter is the operator's signal.
			s.intakeRejected.Add(ctx, 1, metric.WithAttributes(
				attribute.String("provider", ProviderGooglePlay),
				attribute.String("reason", "malformed_notification")))
			acknowledged = append(acknowledged, received.AckID)
			continue
		}

		// The verified packageName must be inside this credential's Application
		// scope. Without that check a notification for any package reaching this
		// subscription would be attributed to this tenant.
		applicationID, _, appErr := s.repository.ApplicationForIdentifier(ctx, identity.CredentialID, notification.PackageName)
		mismatch := appErr != nil || applicationID == ""

		input := RawInput{
			ProjectID:            identity.ProjectID,
			OrganizationID:       identity.OrganizationID,
			EnvironmentID:        identity.EnvironmentID,
			EnvironmentMode:      identity.EnvironmentMode,
			ApplicationID:        applicationID,
			CredentialID:         identity.CredentialID,
			Provider:             ProviderGooglePlay,
			Source:               SourceGoogleRTDN,
			SourceAuthority:      AuthorityStoreNotification,
			ProviderEventID:      received.Message.MessageID,
			ContentDigest:        ContentDigest(raw),
			AuthenticationResult: AuthVerifiedTransport,
			StoreEnvironment:     identity.StoreEnvironment,
			IngestionStatus:      IngestAccepted,
			CorrelationID:        "rtdn:" + received.Message.MessageID,
			ReceivedAt:           now,
			ExpiresAt:            now.Add(s.retention),
		}
		input.IdempotencyKey = GoogleRTDNKey(subscription, received.Message.MessageID, input.ContentDigest)
		input.NotificationKind, input.TransactionReferenceDigest = googleNotificationFacts(notification)
		if when, ok := parseRFC3339(received.Message.PublishTime); ok {
			input.ProviderOccurredAt = &when
		}
		if mismatch {
			input.IngestionStatus = IngestQuarantined
		}
		if err := s.sealBody(&input, raw); err != nil {
			return len(acknowledged) > 0, err
		}

		result, persistErr := s.repository.PersistRawInput(ctx, input, !mismatch && notification.TestNotification == nil, now)
		if persistErr != nil {
			// Not acknowledged: Google will redeliver, which is exactly what a
			// storage failure should cause.
			break
		}
		s.observeIntake(ctx, ProviderGooglePlay, result)
		acknowledged = append(acknowledged, received.AckID)
	}

	if len(acknowledged) > 0 {
		if err := s.google.Acknowledge(ctx, account, credential.GooglePubSubProjectID, credential.GooglePubSubSubscription, acknowledged); err != nil {
			// The inputs are already durable; a failed acknowledge only means
			// redelivery, and redelivery deduplicates.
			return true, nil
		}
	}
	return len(acknowledged) > 0, nil
}

// googleNotificationFacts extracts the safe classification and the attribution
// digest. The purchase token itself never leaves this function.
func googleNotificationFacts(notification googleplay.DeveloperNotification) (string, []byte) {
	switch {
	case notification.SubscriptionNotification != nil:
		return "subscription_" + itoa(notification.SubscriptionNotification.NotificationType),
			TokenDigest(notification.SubscriptionNotification.PurchaseToken)
	case notification.OneTimeProductNotification != nil:
		return "one_time_" + itoa(notification.OneTimeProductNotification.NotificationType),
			TokenDigest(notification.OneTimeProductNotification.PurchaseToken)
	case notification.VoidedPurchaseNotification != nil:
		return "voided_purchase", TokenDigest(notification.VoidedPurchaseNotification.PurchaseToken)
	case notification.TestNotification != nil:
		return "test", nil
	default:
		return "unclassified", nil
	}
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	negative := value < 0
	if negative {
		value = -value
	}
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	if negative {
		return "-" + digits
	}
	return digits
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

// ProcessNextReconciliation runs one bounded step of one reconciliation run.
//
// A step is bounded rather than a whole window so the run stays restart-safe:
// the cursor is committed after each page, and a worker that dies mid-run
// resumes from the last committed cursor instead of re-scanning from the start.
func (s *Service) ProcessNextReconciliation(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	run, leased, err := s.repository.LeaseReconciliationRun(ctx, workerID, now, now.Add(operationLease))
	if err != nil {
		return false, safeFailure(err, "billing_reconciliation_lease_failed")
	}
	if !leased {
		return false, nil
	}
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: run.ID, JobKind: "billing_reconciliation",
		ProjectID: run.ProjectID, EnvironmentID: run.EnvironmentID, ResourceID: run.CredentialID,
	})
	// A disabled Project runs no reconciliation: it would call the provider and
	// append facts for a Project that asked to record nothing.
	if enabled, enabledErr := s.repository.BillingEnabled(ctx, run.ProjectID); enabledErr == nil && !enabled {
		return true, s.repository.CompleteReconciliationRun(ctx, run, "failed", "billing_disabled", s.now())
	}

	ctx, span := s.tracer.Start(ctx, "billing.reconcile.run")
	defer span.End()

	switch run.Strategy {
	case "apple_notification_history":
		return true, s.reconcileAppleNotifications(ctx, run)
	case "google_token_requery":
		return true, s.reconcileGoogleTokens(ctx, run)
	default:
		return true, s.repository.CompleteReconciliationRun(ctx, run, "failed", "unsupported_strategy", s.now())
	}
}

// reconcileAppleNotifications recovers notifications Apple could not deliver.
//
// Apple retries a failed V2 notification five times and only in production, so
// a Mosaic outage longer than that window loses notifications permanently
// unless they are pulled back from notification history. This is that pull.
// Everything it discovers re-enters the normal pipeline, so the same
// idempotency key that deduplicates a live delivery deduplicates a recovered
// one.
func (s *Service) reconcileAppleNotifications(ctx context.Context, run ReconciliationRun) error {
	apple, _, err := s.appleCredential(ctx, RawInput{
		ProjectID: run.ProjectID, CredentialID: run.CredentialID, Provider: ProviderAppStore,
	})
	if err != nil {
		return s.repository.CompleteReconciliationRun(ctx, run, "failed", "credential_unusable", s.now())
	}

	page, err := s.apple.NotificationHistory(ctx, apple, appstoreserver.NotificationHistoryRequest{
		StartDate:    run.WindowStart.UnixMilli(),
		EndDate:      run.WindowEnd.UnixMilli(),
		OnlyFailures: true,
	}, run.cursorToken())
	s.providerRequests.Add(ctx, 1, metric.WithAttributes(
		attribute.String("provider", ProviderAppStore),
		attribute.String("endpoint", "notification_history"),
		attribute.Bool("failed", err != nil)))
	if err != nil {
		classification := Classify(err, s.now())
		if classification.Retryable {
			// Leave the run queued: the cursor is unchanged, so the retry resumes
			// exactly where this attempt started.
			return s.repository.UpdateReconciliationProgress(ctx, run, run.cursorToken(), run.Cursor, s.now())
		}
		return s.repository.CompleteReconciliationRun(ctx, run, "failed", classification.Diagnostic, s.now())
	}

	// The Environment's mode is read from the Environment, not derived from the
	// Store Environment. Deriving it produced only "production" or
	// "development", so every discovery in a staging Environment failed the
	// composite FK onto environments(id, project_id, mode), incremented
	// FailureCount silently, and left the run reporting `partial` with no
	// diagnostic — the recovery path failing in exactly the outage it exists to
	// repair. The intake path always read it from the credential row; this one
	// now reads it from the same source of truth.
	environmentMode, organizationID, scopeErr := s.repository.EnvironmentScope(ctx, run.ProjectID, run.EnvironmentID)
	if scopeErr != nil {
		return s.repository.CompleteReconciliationRun(ctx, run, "failed", "environment_unresolvable", s.now())
	}

	now := s.now()
	for _, item := range page.NotificationHistory {
		run.ExaminedCount++
		notification, decodeErr := s.verifier.DecodeNotification(item.SignedPayload)
		if decodeErr != nil {
			run.FailureCount++
			continue
		}
		applicationID := ""
		storeEnvironment := StoreUnclassified
		if notification.Data != nil {
			applicationID, _, _ = s.repository.ApplicationForIdentifier(ctx, run.CredentialID, notification.Data.BundleID)
			storeEnvironment = normalizeAppleEnvironment(notification.Data.Environment)
		}
		body := []byte(`{"signedPayload":"` + item.SignedPayload + `"}`)
		input := RawInput{
			ProjectID: run.ProjectID, EnvironmentID: run.EnvironmentID,
			ApplicationID: applicationID, CredentialID: run.CredentialID,
			Provider: ProviderAppStore, Source: SourceAppleNotificationHistory,
			SourceAuthority: AuthorityStoreReconciliation,
			ProviderEventID: notification.NotificationUUID,
			// The same key a live delivery would have produced: a recovered
			// notification collapses onto the live one rather than duplicating it.
			IdempotencyKey:       AppleNotificationKey(notification.NotificationUUID),
			ContentDigest:        ContentDigest(body),
			AuthenticationResult: AuthVerifiedSignature,
			StoreEnvironment:     storeEnvironment,
			NotificationKind:     boundedCode(notification.NotificationType),
			NotificationSubtype:  boundedCode(notification.Subtype),
			IngestionStatus:      IngestAccepted,
			CorrelationID:        "reconcile:" + run.ID,
			ReceivedAt:           now,
			ExpiresAt:            now.Add(s.retention),
		}
		input.OrganizationID = organizationID
		input.EnvironmentMode = environmentMode
		if err := s.sealBody(&input, body); err != nil {
			run.FailureCount++
			continue
		}
		result, persistErr := s.repository.PersistRawInput(ctx, input, true, now)
		switch {
		case persistErr != nil:
			run.FailureCount++
		case result.Conflicted:
			// The same notification UUID arrived carrying different content than
			// the copy already on record. That is contradiction, not discovery.
			run.ConflictCount++
		case result.Status == IngestDuplicate:
			run.DuplicateCount++
		default:
			run.DiscoveredCount++
		}
	}

	if page.HasMore && page.PaginationToken != "" {
		return s.repository.UpdateReconciliationProgress(ctx, run, page.PaginationToken, run.Cursor, s.now())
	}
	return s.repository.CompleteReconciliationRun(ctx, run, reconciliationStatus(run), "", s.now())
}

// reconciliationStatus reports partial when anything went wrong. A conflict is
// not a failure of the run — the run did its job by finding it — but it must
// not read as a clean sweep either.
func reconciliationStatus(run ReconciliationRun) string {
	if run.FailureCount > 0 || run.ConflictCount > 0 {
		return "partial"
	}
	return "completed"
}

// reconcileGoogleTokens re-queries known purchase tokens.
//
// Google offers no notification-history equivalent, so reconciliation is
// forward polling rather than replay: the tokens Mosaic already knows about are
// re-read from the Play API, which detects state Mosaic missed while it was
// unavailable.
func (s *Service) reconcileGoogleTokens(ctx context.Context, run ReconciliationRun) error {
	// The candidate set is bounded by the run's window and narrowed twice. The
	// provider filter keeps Apple notifications — which this strategy cannot
	// re-query — out of the counts. The source filter keeps observations out:
	// an observation carries a token digest, and a digest cannot be reversed
	// into the token the Play API needs, so including them would make every run
	// report `partial` and leave an alarm that never clears.
	// One bounded page per pass, resumed from the committed cursor. A single
	// unbounded scan would either stall the worker on a large window or — as it
	// previously did — examine one batch and report the whole window complete.
	inputs, next, err := s.repository.ReplayInputs(ctx, ReplayJob{
		ProjectID: run.ProjectID, EnvironmentID: run.EnvironmentID,
		WindowStart: &run.WindowStart, WindowEnd: &run.WindowEnd,
	}, InputFilter{
		Provider: ProviderGooglePlay,
		Sources:  []string{SourceGoogleRTDN, SourceGoogleTokenRequery},
	}, run.Cursor, reconciliationPageSize)
	if err != nil {
		return s.repository.CompleteReconciliationRun(ctx, run, "failed", "candidate_scan_failed", s.now())
	}
	for _, input := range inputs {
		run.ExaminedCount++
		// Each candidate is genuinely re-read from the Play API. Google offers no
		// notification-history equivalent, so reconciliation here is forward
		// polling: the authoritative state is fetched again, and a state Mosaic
		// missed while it was unavailable shows up as a new fact digest.
		result, revalidateErr := s.revalidate(ctx, "reconcile:"+run.ID, input)
		switch {
		case errors.Is(revalidateErr, ErrValidationBusy):
			// Another worker holds the lease. The cursor does not advance past
			// this input, so the next pass picks it up rather than skipping it.
			run.ExaminedCount--
			next = run.Cursor
			return s.repository.UpdateReconciliationProgress(ctx, run, run.cursorToken(), next, s.now())
		case revalidateErr != nil:
			run.FailureCount++
		case result.Outcome != OutcomeValidated && result.Outcome != OutcomeRecordedNoFact:
			run.FailureCount++
		case result.Conflicted:
			// The provider's current answer contradicts a fact already on
			// record for this transaction. That is the "conflicting state" half
			// of the Gate 9A criterion, and it is not the same thing as
			// learning something new. Both facts stand — the ledger is
			// append-only and nothing is rewritten — so the quarantine is the
			// operator-visible diagnostic over the contradiction rather than a
			// resolution of it.
			run.ConflictCount++
			if quarantineErr := s.repository.OpenQuarantine(ctx, run.ProjectID, run.EnvironmentID, QuarantineWrite{
				RawInputID: input.ID, ApplicationID: input.ApplicationID, Provider: input.Provider,
				ReasonCode: QuarantineReplayConflict, Severity: "warning",
				Scopes:         []string{"reconciliation"},
				DiagnosticCode: "reconciliation_contradicts_recorded_fact",
				OccurredAt:     s.now(),
			}); quarantineErr != nil {
				run.FailureCount++
			}
		case result.Digest != "" && !result.Existing:
			run.DiscoveredCount++
		default:
			run.DuplicateCount++
		}
	}

	// A short page means the window is exhausted. Anything else commits the
	// cursor and comes back, so `completed` is only ever reported over a scan
	// that actually reached the end.
	if len(inputs) == reconciliationPageSize {
		return s.repository.UpdateReconciliationProgress(ctx, run, run.cursorToken(), next, s.now())
	}
	return s.repository.CompleteReconciliationRun(ctx, run, reconciliationStatus(run), "", s.now())
}

// cursorToken exposes the persisted pagination cursor.
func (r ReconciliationRun) cursorToken() string { return r.CursorToken }

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

// ProcessNextReplay re-runs accepted inputs.
//
// Replay never creates a Raw Billing Input and never edits an attempt or a
// fact. It appends new Validation Attempts against the existing inputs; an
// unchanged outcome recomputes the same fact digest and writes nothing, a
// changed outcome appends a new fact beside the old one, and the two are shown
// side by side rather than one replacing the other.
func (s *Service) ProcessNextReplay(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	job, leased, err := s.repository.LeaseReplayJob(ctx, workerID, now, now.Add(operationLease))
	if err != nil {
		return false, safeFailure(err, "billing_replay_lease_failed")
	}
	if !leased {
		return false, nil
	}
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: job.ID, JobKind: "billing_replay",
		ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID, ResourceID: job.RawInputID,
	})
	if enabled, enabledErr := s.repository.BillingEnabled(ctx, job.ProjectID); enabledErr == nil && !enabled {
		return true, s.repository.CompleteReplayJob(ctx, job, "", "billing_disabled", s.now())
	}

	ctx, span := s.tracer.Start(ctx, "billing.replay.run")
	defer span.End()

	// The zero filter: replaying a window deliberately covers every input in it,
	// unlike a provider-specific reconciliation. One bounded page per pass,
	// resumed from the committed cursor.
	inputs, next, err := s.repository.ReplayInputs(ctx, job, InputFilter{}, job.Cursor, replayBatchSize)
	if err != nil {
		return true, s.repository.CompleteReplayJob(ctx, job, "", "input_scan_failed", s.now())
	}
	for _, input := range inputs {
		job.ExaminedCount++
		// The replay runs the validation pipeline; it does not reimplement any of
		// it, so determinism still lives in exactly one place.
		result, revalidateErr := s.revalidate(ctx, "replay:"+job.ID, input)
		switch {
		case errors.Is(revalidateErr, ErrValidationBusy):
			// Do not advance past an input another worker is validating.
			job.ExaminedCount--
			return true, s.repository.UpdateReplayProgress(ctx, job, job.Cursor, s.now())
		case revalidateErr != nil:
			job.ConflictCount++
		case result.Outcome != OutcomeValidated && result.Outcome != OutcomeRecordedNoFact:
			// A quarantine, a permanent failure, or a provider outage means the
			// replay could not confirm the earlier answer. Reporting that as
			// "unchanged" would be a claim the run did not earn.
			job.ConflictCount++
		case result.Digest == "" || result.Existing:
			job.UnchangedCount++
		default:
			job.NewFactCount++
		}
	}

	// A full page means there is more window to walk. Committing the cursor and
	// returning the job to the queue is what makes a four-hundred-input replay
	// actually cover four hundred inputs instead of the first twenty-five.
	if len(inputs) == replayBatchSize {
		return true, s.repository.UpdateReplayProgress(ctx, job, next, s.now())
	}

	comparison := "identical"
	switch {
	case job.ConflictCount > 0:
		comparison = "conflicting"
	case job.NewFactCount > 0:
		comparison = "new_facts"
	}
	return true, s.repository.CompleteReplayJob(ctx, job, comparison, "", s.now())
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

// ProcessRetention removes raw bodies past their retention window.
//
// This is the only path that deletes a Raw Billing Input body. Normalized facts
// are retained indefinitely, so the ledger stays complete after the sensitive
// payload behind it is gone; replay after expiry runs from facts and is
// labelled as such.
func (s *Service) ProcessRetention(ctx context.Context, workerID string) (bool, error) {
	removed, err := s.repository.ExpireRawInputBodies(ctx, s.now(), 500)
	if err != nil {
		return false, safeFailure(err, "billing_retention_failed")
	}
	return removed > 0, nil
}

// ---------------------------------------------------------------------------
// Operator reads and recovery actions
// ---------------------------------------------------------------------------

func (s *Service) ListFacts(ctx context.Context, actor Actor, projectID, environmentID string, options ListOptions) (Page[TransactionFact], error) {
	if actor.ID == "" {
		return Page[TransactionFact]{}, ErrUnauthenticated
	}
	return s.repository.ListFacts(ctx, actor, projectID, environmentID, options)
}

func (s *Service) ListAttempts(ctx context.Context, actor Actor, projectID, environmentID string, options ListOptions) (Page[ValidationAttempt], error) {
	if actor.ID == "" {
		return Page[ValidationAttempt]{}, ErrUnauthenticated
	}
	return s.repository.ListAttempts(ctx, actor, projectID, environmentID, options)
}

func (s *Service) ListLedger(ctx context.Context, actor Actor, projectID, environmentID string, options ListOptions) (Page[LedgerEntry], error) {
	if actor.ID == "" {
		return Page[LedgerEntry]{}, ErrUnauthenticated
	}
	return s.repository.ListLedger(ctx, actor, projectID, environmentID, options)
}

func (s *Service) ListQuarantine(ctx context.Context, actor Actor, projectID, environmentID string, options ListOptions) (Page[QuarantineRecord], error) {
	if actor.ID == "" {
		return Page[QuarantineRecord]{}, ErrUnauthenticated
	}
	return s.repository.ListQuarantine(ctx, actor, projectID, environmentID, options)
}

func (s *Service) Quarantine(ctx context.Context, actor Actor, projectID, recordID string) (QuarantineRecord, error) {
	if actor.ID == "" {
		return QuarantineRecord{}, ErrUnauthenticated
	}
	return s.repository.Quarantine(ctx, actor, projectID, recordID)
}

// RetryQuarantine re-queues a quarantined input for validation.
//
// This is the only recovery action that can lead to a Transaction Fact, and it
// leads there only by asking the store again. There is deliberately no action
// that marks a quarantined input valid: an operator can repair a mapping, or
// re-run validation, but cannot assert an outcome the store never confirmed.
func (s *Service) RetryQuarantine(ctx context.Context, actor Actor, projectID, recordID string) (QuarantineRecord, error) {
	if actor.ID == "" {
		return QuarantineRecord{}, ErrUnauthenticated
	}
	return s.repository.RequeueValidation(ctx, actor, projectID, recordID, s.now())
}

// CloseQuarantineSuperseded closes a record that a later record replaced. It
// produces no fact and asserts nothing about authenticity.
func (s *Service) CloseQuarantineSuperseded(ctx context.Context, actor Actor, projectID, recordID, supersededBy string) (QuarantineRecord, error) {
	if actor.ID == "" {
		return QuarantineRecord{}, ErrUnauthenticated
	}
	return s.repository.CloseQuarantineSuperseded(ctx, actor, projectID, recordID, supersededBy, s.now())
}

// CreateReconciliation queues an operator-triggered reconciliation.
func (s *Service) CreateReconciliation(ctx context.Context, actor Actor, run ReconciliationRun) (ReconciliationRun, error) {
	if actor.ID == "" {
		return ReconciliationRun{}, ErrUnauthenticated
	}
	if !run.WindowEnd.After(run.WindowStart) {
		return ReconciliationRun{}, ErrInvalid
	}
	// Apple retains 180 days of production notification history and 30 days of
	// sandbox history, so a window wider than that cannot be satisfied and is
	// rejected rather than silently truncated.
	if run.WindowEnd.Sub(run.WindowStart) > 180*24*time.Hour {
		return ReconciliationRun{}, ErrInvalid
	}
	id, err := s.newID("brr")
	if err != nil {
		return ReconciliationRun{}, safeFailure(err, "identifier_generation_failed")
	}
	run.ID = id
	run.Trigger = "manual"
	return s.repository.CreateReconciliationRun(ctx, actor, run, s.now())
}

func (s *Service) ListReconciliationRuns(ctx context.Context, actor Actor, projectID, environmentID string, options ListOptions) (Page[ReconciliationRun], error) {
	if actor.ID == "" {
		return Page[ReconciliationRun]{}, ErrUnauthenticated
	}
	return s.repository.ListReconciliationRuns(ctx, actor, projectID, environmentID, options)
}

// CreateReplay queues a replay or revalidation.
func (s *Service) CreateReplay(ctx context.Context, actor Actor, job ReplayJob) (ReplayJob, error) {
	if actor.ID == "" {
		return ReplayJob{}, ErrUnauthenticated
	}
	if job.RawInputID == "" && (job.WindowStart == nil || job.WindowEnd == nil) {
		return ReplayJob{}, ErrInvalid
	}
	id, err := s.newID("brp")
	if err != nil {
		return ReplayJob{}, safeFailure(err, "identifier_generation_failed")
	}
	job.ID = id
	if job.ValidatorVersion <= 0 {
		job.ValidatorVersion = ValidatorVersion
	}
	return s.repository.CreateReplayJob(ctx, actor, job, s.now())
}

func (s *Service) ListReplayJobs(ctx context.Context, actor Actor, projectID, environmentID string, options ListOptions) (Page[ReplayJob], error) {
	if actor.ID == "" {
		return Page[ReplayJob]{}, ErrUnauthenticated
	}
	return s.repository.ListReplayJobs(ctx, actor, projectID, environmentID, options)
}

func (s *Service) Health(ctx context.Context, actor Actor, projectID, environmentID string) (Health, error) {
	if actor.ID == "" {
		return Health{}, ErrUnauthenticated
	}
	return s.repository.Health(ctx, actor, projectID, environmentID)
}
