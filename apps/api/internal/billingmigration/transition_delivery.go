package billingmigration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
)

const (
	TransitionCutoverPending          = "cutover_pending"
	TransitionCutoverCompleted        = "cutover_completed"
	TransitionRollbackCompleted       = "rollback_completed"
	TransitionStabilizationCompleted  = "stabilization_completed"
	TransitionLegacyCutoverCompleted  = "authority_changed"
	TransitionLegacyRollbackCompleted = "rollback_changed"
	TransitionDeliveryLease           = 90 * time.Second
	TransitionDeliveryMaxAttempts     = 8
)

type TransitionOutbox struct {
	ID, ProgramID, ProjectID, AuthorityScopeID     string
	CheckpointID, TransitionID, CompletionReportID string
	EventKind, CorrelationID                       string
	AuthorityEpoch, LeaseGeneration                int64
	AttemptCount, MaxAttempts                      int
	CreatedAt, DueAt, LeaseExpiresAt               time.Time
	LeaseOwner                                     string
}

type TransitionAudienceMember struct {
	BillingCustomerID, CustomerSnapshotID string
	SnapshotVersion                       int64
	PreviousSnapshotVersion               *int64
	SnapshotChecksum, AuthorityDigest     []byte
	ProjectID, EnvironmentID              string
	ApplicationID, Platform               string
	AuthorityKind, TransitionState        string
	AuthorityEpoch                        int64
	CutoverAt                             *time.Time
	OccurredAt                            time.Time
}

type AppendTransition struct {
	ID, ProgramID, ProjectID, AuthorityScopeID     string
	CheckpointID, TransitionID, CompletionReportID string
	EventKind, CorrelationID                       string
	AuthorityEpoch                                 int64
	DueAt, CreatedAt                               time.Time
}

type TransitionFailure struct {
	OutboxID, LeaseOwner, ErrorCode string
	LeaseGeneration                 int64
	RetryAt, FailedAt               time.Time
}

type TransitionDeliveryRepository interface {
	AppendTransition(ctx context.Context, input AppendTransition) (TransitionOutbox, bool, error)
	LeaseTransition(ctx context.Context, workerID string, now, leaseUntil time.Time) (TransitionOutbox, bool, error)
	TransitionAudience(ctx context.Context, outbox TransitionOutbox) ([]TransitionAudienceMember, error)
	CommitTransition(ctx context.Context, outbox TransitionOutbox, events []billingwebhook.StoredEventV2, completedAt time.Time) error
	FailTransition(ctx context.Context, failure TransitionFailure) error
}

type TransitionDeliveryService struct {
	repository TransitionDeliveryRepository
	now        func() time.Time
}

func NewTransitionDeliveryService(repository TransitionDeliveryRepository, now func() time.Time) *TransitionDeliveryService {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &TransitionDeliveryService{repository: repository, now: now}
}

func (s *TransitionDeliveryService) Append(ctx context.Context, input AppendTransition) (TransitionOutbox, bool, error) {
	if input.ProgramID == "" || input.ProjectID == "" || input.AuthorityScopeID == "" ||
		input.CheckpointID == "" || input.CorrelationID == "" || input.AuthorityEpoch < 0 {
		return TransitionOutbox{}, false, ErrInvalid
	}
	switch input.EventKind {
	case TransitionCutoverPending:
		if input.TransitionID != "" || input.CompletionReportID != "" {
			return TransitionOutbox{}, false, ErrInvalid
		}
	case TransitionCutoverCompleted, TransitionRollbackCompleted:
		if input.TransitionID == "" || input.CompletionReportID != "" {
			return TransitionOutbox{}, false, ErrInvalid
		}
	case TransitionStabilizationCompleted:
		if input.TransitionID != "" || input.CompletionReportID == "" {
			return TransitionOutbox{}, false, ErrInvalid
		}
	default:
		return TransitionOutbox{}, false, ErrInvalid
	}
	return s.repository.AppendTransition(ctx, input)
}

func transitionEventType(kind string) string {
	switch kind {
	case TransitionCutoverPending:
		return billingwebhook.EventTypeAuthorityCutoverPending
	case TransitionCutoverCompleted:
		return billingwebhook.EventTypeAuthorityCutoverCompleted
	case TransitionLegacyCutoverCompleted:
		return billingwebhook.EventTypeAuthorityCutoverCompleted
	case TransitionRollbackCompleted:
		return billingwebhook.EventTypeAuthorityRollbackCompleted
	case TransitionLegacyRollbackCompleted:
		return billingwebhook.EventTypeAuthorityRollbackCompleted
	case TransitionStabilizationCompleted:
		return billingwebhook.EventTypeAuthorityStabilizationCompleted
	default:
		return ""
	}
}

func transitionEventID(outboxID, customerID string) string {
	sum := sha256.Sum256([]byte("mosaic-bsw-v2\x00" + outboxID + "\x00" + customerID))
	return "whe2_" + hex.EncodeToString(sum[:16])
}

func snapshotBindingDigest(member TransitionAudienceMember) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte("mosaic-bsw-v2-snapshot-authority\x00"))
	_, _ = hash.Write(member.AuthorityDigest)
	_, _ = hash.Write([]byte{0})
	if len(member.SnapshotChecksum) == 0 {
		_, _ = hash.Write([]byte("absent"))
	} else {
		_, _ = hash.Write(member.SnapshotChecksum)
	}
	return billingwebhook.FormatDigest(hash.Sum(nil))
}

func renderTransitionEvent(outbox TransitionOutbox, member TransitionAudienceMember) (billingwebhook.StoredEventV2, error) {
	eventType := transitionEventType(outbox.EventKind)
	if eventType == "" {
		return billingwebhook.StoredEventV2{}, ErrInvalid
	}
	event := billingwebhook.EventV2{
		EventID: transitionEventID(outbox.ID, member.BillingCustomerID), EventType: eventType,
		BillingCustomerID: member.BillingCustomerID, SnapshotVersion: member.SnapshotVersion,
		PreviousSnapshotVersion: member.PreviousSnapshotVersion, OccurredAt: member.OccurredAt,
		CreatedAt: outbox.CreatedAt, CorrelationID: outbox.CorrelationID,
		ChangedEntitlements: []billingwebhook.ChangedEntitlement{},
		Authority: billingwebhook.EventAuthority{AuthorityEpoch: member.AuthorityEpoch,
			AuthorityKind: member.AuthorityKind, TransitionState: member.TransitionState,
			CutoverAt: member.CutoverAt, SnapshotAuthorityDigest: snapshotBindingDigest(member),
			Scope: billingwebhook.AuthorityScope{ProjectID: member.ProjectID,
				EnvironmentID: member.EnvironmentID, ApplicationID: member.ApplicationID, Platform: member.Platform}},
	}
	body, digest, err := billingwebhook.CanonicalEventV2(event)
	if err != nil {
		return billingwebhook.StoredEventV2{}, err
	}
	return billingwebhook.StoredEventV2{Event: event, CustomerSnapshotID: member.CustomerSnapshotID,
		AuthorityScopeID: outbox.AuthorityScopeID, TransitionOutboxID: outbox.ID,
		Body: body, Digest: digest}, nil
}

func (s *TransitionDeliveryService) ProcessOne(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	outbox, ok, err := s.repository.LeaseTransition(ctx, workerID, now, now.Add(TransitionDeliveryLease))
	if err != nil || !ok {
		return ok, err
	}
	audience, err := s.repository.TransitionAudience(ctx, outbox)
	if err == nil && len(audience) == 0 {
		err = fmt.Errorf("transition audience is empty")
	}
	events := make([]billingwebhook.StoredEventV2, 0, len(audience))
	if err == nil {
		for _, member := range audience {
			event, renderErr := renderTransitionEvent(outbox, member)
			if renderErr != nil {
				err = renderErr
				break
			}
			events = append(events, event)
		}
	}
	if err == nil {
		err = s.repository.CommitTransition(ctx, outbox, events, s.now())
		if err == nil {
			return true, nil
		}
	}
	failure := TransitionFailure{OutboxID: outbox.ID, LeaseOwner: workerID,
		LeaseGeneration: outbox.LeaseGeneration, ErrorCode: "transition_delivery_failed", FailedAt: s.now(),
		RetryAt: s.now().Add(transitionBackoff(outbox.AttemptCount))}
	if failErr := s.repository.FailTransition(ctx, failure); failErr != nil {
		return true, fmt.Errorf("transition failed: %v; release lease: %w", err, failErr)
	}
	return true, err
}

func transitionBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 7 {
		attempt = 7
	}
	delay := 15 * time.Second * time.Duration(1<<(attempt-1))
	if delay > 10*time.Minute {
		return 10 * time.Minute
	}
	return delay
}
