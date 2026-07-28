// Package billingwebhook owns application-webhook destinations, signing, the
// SSRF policy applied to operator-supplied URLs, and delivery.
//
// It implements ADR-0024. Three things in that decision shape everything here:
// the signature binds scheme version, timestamp, event id, and body together;
// a destination may hold more than one signing secret while a rotation is in
// flight; and delivery is a notification path that may never roll back or
// block committed customer state.
package billingwebhook

import "time"

// ContractVersion is the Billing State Webhook Contract this package speaks.
// It appears on the stored envelope, never assembled here — the projection
// transaction writes the complete body and delivery sends those exact bytes.
const ContractVersion = "1"

// EventTypeEntitlementsChanged is the one event type Phase 9B emits. The
// contract declares ten; the other nine are reserved vocabulary.
const EventTypeEntitlementsChanged = "customer.entitlements.changed"

// Destination lifecycle. These are the words the `webhook_destinations` CHECK
// stores, not a parallel Go vocabulary that would need translating.
const (
	// DestinationActive receives deliveries.
	DestinationActive = "active"
	// DestinationPaused is an operator's temporary stop. Events still fan out
	// and are recorded as skipped, so the gap is visible afterwards.
	DestinationPaused = "paused"
	// DestinationDisabled is terminal until an operator re-enables it. Mosaic
	// sets it automatically after a bounded run of exhausted deliveries.
	DestinationDisabled = "disabled"
)

// Delivery status, matching the `webhook_deliveries` CHECK.
const (
	DeliveryPending   = "pending"
	DeliverySucceeded = "succeeded"
	DeliveryFailed    = "failed"
	DeliveryExhausted = "exhausted"
	DeliverySkipped   = "skipped"
)

// Attempt outcome, matching the `webhook_delivery_attempts` CHECK.
const (
	OutcomeDelivered        = "delivered"
	OutcomeRetryableFailure = "retryable_failure"
	OutcomePermanentFailure = "permanent_failure"
	OutcomeExhausted        = "exhausted"
	OutcomeSkipped          = "skipped"
)

// Skip reasons, matching both CHECKs and the delivery schema enumeration.
const (
	SkippedDestinationDisabled = "destination_disabled"
	SkippedEventTypeNotEnabled = "event_type_not_enabled"
	SkippedDestinationDeleted  = "destination_deleted"
	SkippedTenantSuspended     = "tenant_suspended"
)

// Signing secret status, matching the `webhook_signing_secrets` CHECK.
const (
	SecretActive  = "active"
	SecretRetired = "retired"
)

// Auto-disable reasons. Mosaic-owned stable codes, kept distinct from the
// free-text reason an operator writes when disabling by hand.
const (
	AutoDisabledConsecutiveExhausted = "consecutive_exhausted_deliveries"
	AutoDisabledDestinationRefused   = "destination_refused"
)

const (
	// DefaultMaxAttempts matches the column default. Eight attempts across the
	// backoff schedule spans roughly forty minutes, which outlasts an ordinary
	// receiver deployment without holding a queue slot for days.
	DefaultMaxAttempts = 8
	// MaxAttemptsCeiling is the contract's bound on an attempt number.
	MaxAttemptsCeiling = 32
	// AutoDisableThreshold is how many exhausted deliveries in a row disable a
	// destination. Three is a run, not an incident: a destination that has
	// failed every attempt of three separate events is not coming back on its
	// own, and any single success resets the count.
	AutoDisableThreshold = 3
	// RotationOverlap is how long a retired secret keeps signing. Twenty-four
	// hours is long enough for a receiver deploy to reach every instance and
	// short enough that a secret rotated after a suspected compromise is out of
	// use within a day.
	RotationOverlap = 24 * time.Hour
	// SecretRandomBytes is the entropy behind a signing secret.
	SecretRandomBytes = 32
	// SecretPrefix marks the value in a receiver's own configuration so a
	// secret pasted into the wrong field is recognizable.
	SecretPrefix = "whsec_"
	// MaxResponseExcerpt is the contract's ceiling on a stored excerpt.
	MaxResponseExcerpt = 240
	// DeliveryLease bounds how long one worker may hold a delivery. It must
	// exceed the total request timeout, or a slow destination would let a
	// second worker claim a delivery that is still in flight.
	DeliveryLease = 90 * time.Second
	// FanOutBatch bounds how many committed events one poll expands.
	FanOutBatch = 50
	// FanOutHorizon bounds how far back the fan-out scan looks for events that
	// have never been expanded. It is generous on purpose: the marker table
	// makes the scan cheap, and the horizon exists only so a table that has
	// grown for years is not re-examined from the beginning on every poll.
	FanOutHorizon = 30 * 24 * time.Hour
)

// Actor is the authenticated operator behind a management call. Delivery has
// no actor: the worker acts for Mosaic.
type Actor struct{ ID string }

// Destination is the operator-facing view of a webhook destination. It never
// carries secret material — not the ciphertext, not the plaintext, not a
// fingerprint an offline guess could be checked against.
type Destination struct {
	ID            string    `json:"id"`
	ProjectID     string    `json:"projectId"`
	EnvironmentID string    `json:"environmentId"`
	URL           string    `json:"url"`
	Status        string    `json:"status"`
	EventTypes    []string  `json:"eventTypes"`
	Description   string    `json:"description"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`

	SecretLastRotatedAt     *time.Time `json:"secretLastRotatedAt,omitempty"`
	DisabledReason          string     `json:"disabledReason,omitempty"`
	ConsecutiveFailureCount int        `json:"consecutiveFailureCount"`
	AutoDisabledAt          *time.Time `json:"autoDisabledAt,omitempty"`
	AutoDisableReason       string     `json:"autoDisableReason,omitempty"`
}

// Deliverable reports whether this destination should be attempted for an
// event of the given type. A destination that is not deliverable produces a
// recorded skip rather than nothing at all.
func (d Destination) Deliverable(eventType string) (bool, string) {
	if d.Status != DestinationActive {
		return false, SkippedDestinationDisabled
	}
	for _, candidate := range d.EventTypes {
		if candidate == eventType {
			return true, ""
		}
	}
	return false, SkippedEventTypeNotEnabled
}

// DestinationWithSecret is the create and rotate response. The secret exists
// in this struct and nowhere else in Mosaic: it is sealed on the way to
// storage and this plaintext is never written to a log, a span, or a second
// read of the same resource.
type DestinationWithSecret struct {
	Destination Destination `json:"destination"`
	// Secret is displayed exactly once.
	Secret string `json:"secret"`
	// SecretID names the row so a later explicit retirement can address it.
	SecretID string `json:"secretId"`
	// PreviousSecretHonoredUntil is set by a rotation: until this instant the
	// superseded secret still signs, so a receiver may adopt the new one at its
	// own pace. It is absent on a create, which has no previous secret.
	PreviousSecretHonoredUntil *time.Time `json:"previousSecretHonoredUntil,omitempty"`
}

// SecretMetadata describes a signing secret without revealing it.
type SecretMetadata struct {
	ID           string     `json:"id"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	RetiredAt    *time.Time `json:"retiredAt,omitempty"`
	HonoredUntil *time.Time `json:"honoredUntil,omitempty"`
}

// SealedSecret is a signing secret on its way to storage. The plaintext is
// already gone by the time this exists.
type SealedSecret struct {
	ID              string
	EnvelopeVersion int
	Algorithm       string
	KeyID           string
	Nonce           []byte
	Ciphertext      []byte
	Fingerprint     []byte
}

// Delivery is one event's journey to one destination.
type Delivery struct {
	ID            string     `json:"id"`
	ProjectID     string     `json:"projectId"`
	EnvironmentID string     `json:"environmentId"`
	EventID       string     `json:"eventId"`
	DestinationID string     `json:"destinationId"`
	Status        string     `json:"status"`
	SkippedReason string     `json:"skippedReason,omitempty"`
	AttemptCount  int        `json:"attemptCount"`
	MaxAttempts   int        `json:"maxAttempts"`
	NextAttemptAt *time.Time `json:"nextAttemptAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
}

// Attempt is one recorded try. It is append-only history and is never sent to
// a destination: the contract's webhookDeliveryAttempt record is API-facing
// only, carries no URL and no secret, and this struct matches that.
type Attempt struct {
	ID              string     `json:"id"`
	DeliveryID      string     `json:"deliveryId"`
	EventID         string     `json:"eventId"`
	DestinationID   string     `json:"destinationId"`
	AttemptNumber   int        `json:"attempt"`
	MaxAttempts     int        `json:"maxAttempts"`
	Outcome         string     `json:"outcome"`
	ResponseStatus  *int       `json:"responseStatusCode,omitempty"`
	ResponseExcerpt string     `json:"responseExcerpt,omitempty"`
	ErrorCode       string     `json:"errorCode,omitempty"`
	LatencyMS       *int       `json:"latencyMs,omitempty"`
	SkippedReason   string     `json:"skippedReason,omitempty"`
	AttemptedAt     time.Time  `json:"requestedAt"`
	RespondedAt     *time.Time `json:"respondedAt,omitempty"`
	NextAttemptAt   *time.Time `json:"nextAttemptAt,omitempty"`
}

// LeasedDelivery is everything one delivery attempt needs, read in the same
// transaction that claimed the row.
//
// It carries the stored body verbatim. Delivery must never re-render the
// envelope: the signature covers exact bytes, so a re-serialization that
// reorders one member produces a signature no receiver can reproduce.
type LeasedDelivery struct {
	Delivery       Delivery
	Destination    Destination
	OrganizationID string
	EventType      string
	// Body is the committed Billing State Webhook envelope, exactly as stored.
	Body []byte
	// Secrets are every secret still permitted to sign, newest first. More than
	// one means a rotation is in its overlap window.
	Secrets []StoredSecret
}

// StoredSecret is a sealed secret read for signing.
type StoredSecret struct {
	SealedSecret
	Status       string
	HonoredUntil *time.Time
}

// DestinationInput is a create or update request after transport validation.
type DestinationInput struct {
	ProjectID     string
	EnvironmentID string
	URL           string
	EventTypes    []string
	Description   string
}

// DestinationUpdate is a partial update. A nil field is unchanged, which keeps
// "clear the description" distinguishable from "leave it alone".
type DestinationUpdate struct {
	URL         *string
	EventTypes  []string
	Description *string
}

// AttemptResult is the outcome of one delivery attempt, applied to the
// delivery row and appended to history in one transaction.
type AttemptResult struct {
	Delivery      Delivery
	AttemptNumber int
	Outcome       string
	// Status is the delivery's resulting status.
	Status    string
	ErrorCode string
	// SkippedReason is set only for a skipped outcome, where the column CHECK
	// requires it and forbids it everywhere else.
	SkippedReason  string
	ResponseStatus *int
	// ResponseExcerpt is already bounded and control-character-free by the time
	// it reaches here.
	ResponseExcerpt string
	LatencyMS       int
	AttemptedAt     time.Time
	RespondedAt     *time.Time
	NextAttemptAt   *time.Time
	CompletedAt     *time.Time
	// ResetDestinationFailures clears the auto-disable counter, and
	// IncrementDestinationFailures advances it. Exactly one may be set.
	ResetDestinationFailures     bool
	IncrementDestinationFailures bool
}

// DeliveryFilter bounds an operator's read of delivery history.
type DeliveryFilter struct {
	EnvironmentID string
	EventID       string
	DestinationID string
	Status        string
	Limit         int
}

// Bounded applies the page ceiling.
func (f DeliveryFilter) Bounded() DeliveryFilter {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	if f.Limit > 200 {
		f.Limit = 200
	}
	return f
}
