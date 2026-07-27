package analytics

import "errors"

var (
	ErrUnauthenticated        = errors.New("unauthenticated")
	ErrForbidden              = errors.New("forbidden")
	ErrNotFound               = errors.New("not found")
	ErrCollectionDisabled     = errors.New("analytics collection disabled")
	ErrInvalidBatch           = errors.New("invalid analytics batch")
	ErrRateLimited            = errors.New("analytics rate limited")
	ErrConflict               = errors.New("analytics conflict")
	ErrTemporarilyUnavailable = errors.New("analytics temporarily unavailable")
)

// Permanent rejection codes returned per event in an ingestion response. They
// are part of the Analytics Event ingestion contract: an SDK must never retry an
// event carrying one of these, so the values are stable and machine-readable.
//
// Codes are deliberately coarse and never echo the rejected value, because the
// values that trigger minimization rejections are exactly the ones that may
// carry personal data.
const (
	// RejectEventTooLarge - the encoded event exceeds MaxEventBytes.
	RejectEventTooLarge = "event_too_large"
	// RejectInvalidIdentifier - an identifier does not match the contract pattern.
	RejectInvalidIdentifier = "invalid_identifier"
	// RejectSensitiveValue - a field looks like personal or credential data.
	RejectSensitiveValue = "sensitive_value_rejected"
	// RejectUnsupportedSchema - the event schema version is not accepted here.
	RejectUnsupportedSchema = "unsupported_event_schema"
	// RejectUnsupportedEventName - the event name is not in the taxonomy.
	RejectUnsupportedEventName = "unsupported_event_name"
	// RejectSchemaInvalid - the event failed canonical schema validation.
	RejectSchemaInvalid = "event_schema_invalid"
	// RejectUnknownField - a payload field is not permitted for this event.
	RejectUnknownField = "unknown_field"
	// RejectInvalidTimestamp - occurredAt/queuedAt are missing, malformed, or misordered.
	RejectInvalidTimestamp = "invalid_timestamp"
	// RejectFutureEvent - occurredAt is beyond the accepted clock skew.
	RejectFutureEvent = "occurred_at_too_far_future"
	// RejectExpired - occurredAt is older than the ingestion window.
	RejectExpired = "event_expired"
	// RejectAuthorityNotAllowed - a public SDK key claimed a trusted authority.
	RejectAuthorityNotAllowed = "authority_not_allowed"
	// RejectExperimentAttributionIncomplete - the Experiment tuple is partial.
	RejectExperimentAttributionIncomplete = "experiment_attribution_incomplete"
	// RejectCorrelationNotAllowed - a correlation ID is not permitted for this event.
	RejectCorrelationNotAllowed = "correlation_field_not_allowed"
	// RejectAttributionNotAllowed - an attribution field is not permitted for this event.
	RejectAttributionNotAllowed = "attribution_field_not_allowed"
	// RejectRuleSetAttributionIncomplete - Rule Set ID and version must travel together.
	RejectRuleSetAttributionIncomplete = "rule_set_attribution_incomplete"
	// RejectRolloutAttributionIncomplete - the rollout tuple must be absent or complete.
	RejectRolloutAttributionIncomplete = "rollout_attribution_incomplete"
	// RejectQAExposure - a QA-overridden presentation must not emit statistical exposure.
	RejectQAExposure = "qa_override_exposure_rejected"
	// RejectFallbackPaywallIdentity - fallback Paywall identity belongs in the payload.
	RejectFallbackPaywallIdentity = "fallback_paywall_identity_rejected"
)
