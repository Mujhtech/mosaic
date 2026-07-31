package billingrestore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// This file is the only place a restoreResult record is produced.
//
// Records are built as map[string]any rather than as tagged structs for the
// same reason the access surfaces do it: the contract closes every object with
// additionalProperties:false and forbids null, and a tagged struct with pointer
// fields puts "absent" and "null" one keystroke apart. A map cannot carry a
// member it was not given.

// ContractTimestamp renders an instant in the contract's fixed form: RFC 3339
// UTC with exactly three fractional digits and a literal Z.
func ContractTimestamp(at time.Time) string {
	return at.UTC().Format("2006-01-02T15:04:05.000Z")
}

// CanonicalJSON renders the contract's canonical serialization: minified, keys
// ascending at every depth, absent members omitted, minimal escaping.
func CanonicalJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("serialize restore record: %w", err)
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// RestoreRecord renders one restore as an Authoritative Entitlement Contract v1
// restoreResult.
//
// The two axes stay separate throughout: `outcome` is Mosaic's authoritative
// answer and `providerOutcome` is what the native restore did, and neither is
// ever derived from the other.
//
// A job that has not reached a terminal outcome is reported as
// `validation_pending` rather than as an absent outcome. The contract has no
// "still working" member, and the honest reading of an unfinished chain is that
// Mosaic cannot yet confirm anything — which is exactly what validation_pending
// means.
func RestoreRecord(view View) (map[string]any, error) {
	job := view.Job

	outcome, reason := job.Outcome, job.UncertaintyReason
	if outcome == "" {
		outcome = OutcomeValidationPending
		if reason == "" || reason == ReasonNone {
			reason = ReasonMissingFact
		}
	}

	payload := map[string]any{
		"restoreId":                job.ID,
		"projectId":                job.ProjectID,
		"environmentId":            job.EnvironmentID,
		"storePlatform":            job.StorePlatform,
		"outcome":                  outcome,
		"providerOutcome":          job.ProviderOutcome,
		"requestedAt":              ContractTimestamp(job.RequestedAt),
		"observedTransactionCount": job.ObservedTransactionCount,
		"correlationId":            SafeCorrelation(job.CorrelationID),
	}

	// identity_unresolved is the one outcome that must carry no customer: the
	// whole meaning of the answer is that Mosaic does not know whose purchase
	// this is, and naming a customer beside it would contradict it.
	if job.CustomerID != "" && outcome != OutcomeIdentityUnresolved {
		payload["billingCustomerId"] = job.CustomerID
	}
	if job.CompletedAt != nil {
		payload["completedAt"] = ContractTimestamp(*job.CompletedAt)
	}
	// The snapshot version is emitted only with `restored`. It is that outcome's
	// evidence, and attaching it to any other outcome would suggest the restore
	// had been reflected when it had not.
	if outcome == OutcomeRestored {
		if job.SnapshotVersion == nil || *job.SnapshotVersion < 1 {
			return nil, ErrUnprovenRestore
		}
		payload["snapshotVersion"] = *job.SnapshotVersion
	}
	if outcome == OutcomeValidationPending {
		payload["pendingValidationCount"] = job.PendingValidationCount
	}
	if outcome != OutcomeRestored && outcome != OutcomeNoAdditionalPurchases {
		if reason == "" || reason == ReasonNone {
			return nil, ErrInvalidOutcome
		}
		since := view.EvaluatedAt
		if since.IsZero() {
			since = job.UpdatedAt
		}
		payload["uncertainty"] = uncertaintyRecord(reason, since)
	}

	return map[string]any{
		"authoritativeEntitlementContractVersion": ContractVersion,
		"recordType": "restoreResult",
		"payload":    payload,
	}, nil
}

func uncertaintyRecord(reason string, since time.Time) map[string]any {
	record := map[string]any{
		"reason": reason,
		"since":  ContractTimestamp(since),
	}
	if resolution := expectedResolutionFor(reason); resolution != "" {
		record["expectedResolution"] = resolution
	}
	return record
}

// expectedResolutionFor is guidance for a caller deciding whether to poll
// again, not a promise. It matches the mapping the snapshot surfaces use, so a
// reader never sees the same reason resolve two different ways.
func expectedResolutionFor(reason string) string {
	switch reason {
	case ReasonProviderUnavailable, ReasonStaleValidation:
		return "automatic_retry"
	case ReasonMissingFact:
		return "next_provider_notification"
	case ReasonProjectionFailed:
		return "next_projection_run"
	case ReasonIdentityUnresolved, ReasonConflictingFacts, ReasonProductUnresolved,
		ReasonUnsupportedProviderState:
		return "operator_action"
	default:
		return ""
	}
}

// SafeCorrelation reduces a caller-supplied correlation id to the contract's
// identifier charset. A correlation id travels into logs and spans, so it is
// filtered rather than trusted.
func SafeCorrelation(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 128 {
		value = value[:128]
	}
	cleaned := make([]rune, 0, len(value))
	for index, char := range value {
		switch {
		case char >= 'A' && char <= 'Z', char >= 'a' && char <= 'z', char >= '0' && char <= '9':
			cleaned = append(cleaned, char)
		case len(cleaned) > 0 && index > 0 && (char == '.' || char == '_' || char == ':' || char == '-'):
			cleaned = append(cleaned, char)
		}
	}
	if len(cleaned) == 0 {
		return "mosaic"
	}
	return string(cleaned)
}
