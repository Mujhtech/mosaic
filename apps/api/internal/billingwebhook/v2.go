package billingwebhook

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"time"
)

const maxContractInteger int64 = 999999999999

var (
	contractIDPattern         = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)
	entitlementKeyPattern     = regexp.MustCompile(`^[a-z][a-z0-9_.-]*$`)
	lowercaseHexDigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
)

type eventAuthorityWire struct {
	AuthorityEpoch          int64          `json:"authorityEpoch"`
	AuthorityKind           string         `json:"authorityKind"`
	Scope                   AuthorityScope `json:"scope"`
	TransitionState         string         `json:"transitionState"`
	CutoverAt               string         `json:"cutoverAt,omitempty"`
	SnapshotAuthorityDigest string         `json:"snapshotAuthorityDigest"`
}

type eventV2Wire struct {
	EventID                 string               `json:"eventId"`
	EventType               string               `json:"eventType"`
	BillingCustomerID       string               `json:"billingCustomerId"`
	Authority               eventAuthorityWire   `json:"authority"`
	SnapshotVersion         int64                `json:"snapshotVersion"`
	PreviousSnapshotVersion *int64               `json:"previousSnapshotVersion,omitempty"`
	OccurredAt              string               `json:"occurredAt"`
	CreatedAt               string               `json:"createdAt"`
	CorrelationID           string               `json:"correlationId"`
	ChangedEntitlements     []ChangedEntitlement `json:"changedEntitlements"`
}

type eventEnvelopeV2 struct {
	ContractVersion string      `json:"billingStateWebhookContractVersion"`
	RecordType      string      `json:"recordType"`
	Payload         eventV2Wire `json:"payload"`
}

func ContractTimestamp(value time.Time) string {
	return value.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
}

func validContractID(value string) bool {
	return len(value) >= 1 && len(value) <= 128 && contractIDPattern.MatchString(value)
}

func validContractTimestamp(value time.Time) bool {
	if value.IsZero() || value.Year() < 0 || value.Year() > 9999 {
		return false
	}
	return len(ContractTimestamp(value)) == 24
}

func validEntitlementState(value string, previous bool) bool {
	return value == "active" || value == "inactive" || value == "unknown" || (previous && value == "absent")
}

func validateEventV2(event EventV2) error {
	if !validContractID(event.EventID) || !validContractID(event.BillingCustomerID) || !validContractID(event.CorrelationID) ||
		!validContractID(event.Authority.Scope.ProjectID) || !validContractID(event.Authority.Scope.EnvironmentID) ||
		!validContractID(event.Authority.Scope.ApplicationID) ||
		(event.Authority.Scope.Platform != "ios" && event.Authority.Scope.Platform != "android") ||
		event.Authority.AuthorityEpoch < 0 || event.Authority.AuthorityEpoch > maxContractInteger ||
		event.SnapshotVersion < 0 || event.SnapshotVersion > maxContractInteger ||
		!validContractTimestamp(event.OccurredAt) || !validContractTimestamp(event.CreatedAt) {
		return ErrInvalid
	}
	if event.PreviousSnapshotVersion != nil && (*event.PreviousSnapshotVersion < 0 || *event.PreviousSnapshotVersion > maxContractInteger) {
		return ErrInvalid
	}
	if len(event.ChangedEntitlements) > 200 {
		return ErrInvalid
	}
	for _, changed := range event.ChangedEntitlements {
		if len(changed.EntitlementKey) < 1 || len(changed.EntitlementKey) > 64 || !entitlementKeyPattern.MatchString(changed.EntitlementKey) ||
			!validEntitlementState(changed.PreviousState, true) || !validEntitlementState(changed.CurrentState, false) {
			return ErrInvalid
		}
	}
	wantKind, wantState := "", ""
	switch event.EventType {
	case EventTypeEntitlementsChanged:
		if len(event.ChangedEntitlements) == 0 {
			return ErrInvalid
		}
	case EventTypeAuthorityCutoverPending:
		wantKind, wantState = "source", "cutover_pending"
	case EventTypeAuthorityCutoverCompleted:
		wantKind, wantState = "mosaic", "stabilizing"
	case EventTypeAuthorityRollbackCompleted:
		wantKind, wantState = "source_rollback", "rolled_back"
	case EventTypeAuthorityStabilizationCompleted:
		wantKind, wantState = "mosaic", "stable"
	default:
		return ErrInvalid
	}
	// Version zero is the deliberately narrow absent-rollback-baseline
	// sentinel. It is not a general snapshot version and must retain the Mosaic
	// snapshot it replaced so receivers can order the rollback notification.
	if event.SnapshotVersion == 0 && (event.EventType != EventTypeAuthorityRollbackCompleted ||
		event.PreviousSnapshotVersion == nil || *event.PreviousSnapshotVersion < 1) {
		return ErrInvalid
	}
	if wantKind != "" && (event.Authority.AuthorityKind != wantKind || event.Authority.TransitionState != wantState || len(event.ChangedEntitlements) != 0) {
		return ErrInvalid
	}
	if event.Authority.AuthorityKind == "source" && event.Authority.CutoverAt != nil {
		return ErrInvalid
	}
	if event.Authority.AuthorityKind != "source" && event.Authority.AuthorityKind != "mosaic" && event.Authority.AuthorityKind != "source_rollback" {
		return ErrInvalid
	}
	if event.Authority.AuthorityKind != "source" && event.Authority.CutoverAt == nil {
		return ErrInvalid
	}
	if event.Authority.CutoverAt != nil && !validContractTimestamp(*event.Authority.CutoverAt) {
		return ErrInvalid
	}
	if !lowercaseHexDigestPattern.MatchString(event.Authority.SnapshotAuthorityDigest) {
		return ErrInvalid
	}
	if _, err := hex.DecodeString(event.Authority.SnapshotAuthorityDigest[7:]); err != nil {
		return ErrInvalid
	}
	return nil
}

// CanonicalEventV2 renders once. Persistence stores the returned bytes and
// delivery signs and sends those same bytes without JSON re-serialization.
func CanonicalEventV2(event EventV2) ([]byte, []byte, error) {
	if event.ChangedEntitlements == nil {
		event.ChangedEntitlements = []ChangedEntitlement{}
	}
	if err := validateEventV2(event); err != nil {
		return nil, nil, err
	}
	authority := eventAuthorityWire{AuthorityEpoch: event.Authority.AuthorityEpoch,
		AuthorityKind: event.Authority.AuthorityKind, Scope: event.Authority.Scope,
		TransitionState:         event.Authority.TransitionState,
		SnapshotAuthorityDigest: event.Authority.SnapshotAuthorityDigest}
	if event.Authority.CutoverAt != nil {
		authority.CutoverAt = ContractTimestamp(*event.Authority.CutoverAt)
	}
	body, err := json.Marshal(eventEnvelopeV2{ContractVersion: ContractVersionV2,
		RecordType: "billingStateEvent", Payload: eventV2Wire{
			EventID: event.EventID, EventType: event.EventType,
			BillingCustomerID: event.BillingCustomerID, Authority: authority,
			SnapshotVersion:         event.SnapshotVersion,
			PreviousSnapshotVersion: event.PreviousSnapshotVersion,
			OccurredAt:              ContractTimestamp(event.OccurredAt), CreatedAt: ContractTimestamp(event.CreatedAt),
			CorrelationID: event.CorrelationID, ChangedEntitlements: event.ChangedEntitlements}})
	if err != nil {
		return nil, nil, fmt.Errorf("encode Billing State Webhook v2 event: %w", err)
	}
	digest := sha256.Sum256(body)
	return body, digest[:], nil
}

func FormatDigest(raw []byte) string { return "sha256:" + hex.EncodeToString(raw) }
