package analytics

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`)

var eventNames = map[string]struct{}{
	"placement_requested": {}, "placement_paywall_selected": {}, "placement_no_paywall": {},
	"placement_fallback_used": {}, "placement_unavailable": {}, "placement_evaluation_failed": {},
	"paywall_presented": {}, "paywall_dismissed": {}, "paywall_action_selected": {}, "paywall_render_failed": {},
	"product_load_started": {}, "product_load_completed": {}, "product_load_failed": {}, "product_unavailable": {}, "product_selected": {},
	"purchase_started": {}, "purchase_completed_client": {}, "purchase_completed_provider": {}, "purchase_pending": {},
	"purchase_deferred": {}, "purchase_cancelled": {}, "purchase_failed": {},
	"restore_started": {}, "restore_completed": {}, "restore_nothing_found": {}, "restore_cancelled": {}, "restore_failed": {},
}

type payloadRule struct{ required, optional map[string]string }

func fields(values ...string) map[string]string {
	result := make(map[string]string, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		result[values[i]] = values[i+1]
	}
	return result
}

var payloadRules = map[string]payloadRule{
	"placement_requested":         {fields("decisionContractVersion", "string"), nil},
	"placement_paywall_selected":  {fields("finalOutcome", "string", "decisionContractVersion", "string"), fields("assignmentKeyType", "string", "bucketingAlgorithm", "string", "rolloutBucket", "number")},
	"placement_no_paywall":        {fields("finalOutcome", "string", "decisionContractVersion", "string"), fields("assignmentKeyType", "string", "bucketingAlgorithm", "string", "rolloutBucket", "number")},
	"placement_fallback_used":     {fields("trigger", "string", "fallbackKey", "string", "finalOutcome", "string"), fields("diagnosticCode", "string")},
	"placement_unavailable":       {fields("reason", "string"), fields("diagnosticCode", "string")},
	"placement_evaluation_failed": {fields("diagnosticCode", "string", "retryable", "boolean"), nil},
	"paywall_presented":           {nil, nil},
	"paywall_dismissed":           {fields("reason", "string"), nil},
	"paywall_action_selected":     {fields("action", "string"), fields("componentId", "string")},
	"paywall_render_failed":       {fields("diagnosticCode", "string", "retryable", "boolean"), nil},
	"product_load_started":        {fields("requestedProductCount", "number"), nil},
	"product_load_completed":      {fields("availableProductCount", "number", "unavailableProductCount", "number", "durationMs", "number"), nil},
	"product_load_failed":         {fields("requestedProductCount", "number", "durationMs", "number", "diagnosticCode", "string", "retryable", "boolean"), nil},
	"product_unavailable":         {fields("reason", "string"), fields("diagnosticCode", "string")},
	"product_selected":            {fields("source", "string"), nil},
	"purchase_started":            {nil, nil},
	"purchase_completed_client":   {fields("outcome", "string", "durationMs", "number", "observedEntitlementKeys", "string_array"), fields("providerResultCode", "string")},
	"purchase_completed_provider": {fields("confirmationSource", "string", "activeEntitlementKeys", "string_array"), fields("linkedClientEventId", "string")},
	"purchase_pending":            {fields("durationMs", "number"), fields("providerResultCode", "string")},
	"purchase_deferred":           {fields("durationMs", "number"), fields("providerResultCode", "string")},
	"purchase_cancelled":          {fields("durationMs", "number"), fields("providerResultCode", "string")},
	"purchase_failed":             {fields("durationMs", "number", "diagnosticCode", "string", "retryable", "boolean"), nil},
	"restore_started":             {fields("providerId", "string"), nil},
	"restore_completed":           {fields("providerId", "string", "durationMs", "number", "restoredProductIds", "string_array", "observedEntitlementKeys", "string_array"), nil},
	"restore_nothing_found":       {fields("providerId", "string", "durationMs", "number"), fields("providerResultCode", "string")},
	"restore_cancelled":           {fields("providerId", "string", "durationMs", "number"), fields("providerResultCode", "string")},
	"restore_failed":              {fields("providerId", "string", "durationMs", "number", "diagnosticCode", "string", "retryable", "boolean"), nil},
}

func ParseTimestamp(value string) (time.Time, bool) {
	if len(value) != len("2006-01-02T15:04:05.000Z") || !strings.HasSuffix(value, "Z") {
		return time.Time{}, false
	}
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	return parsed, err == nil
}

func ValidateEvent(event Event, sentAt, now time.Time) (Candidate, string) {
	raw, _ := json.Marshal(event)
	if len(raw) > MaxEventBytes {
		return Candidate{}, "event_too_large"
	}
	if !validID(event.EventID) || !validID(event.Identity.InstallationID) ||
		!validID(event.SessionID) {
		return Candidate{}, "invalid_identifier"
	}
	if event.Identity.ApplicationUserID != "" && (!validApplicationUserID(event.Identity.ApplicationUserID) || looksSensitive(event.Identity.ApplicationUserID)) {
		return Candidate{}, "sensitive_value_rejected"
	}
	if event.Identity.Generation < 0 {
		return Candidate{}, "event_schema_invalid"
	}
	if event.EventSchemaVersion != EventSchemaVersion {
		return Candidate{}, "unsupported_event_schema"
	}
	if _, ok := eventNames[event.EventName]; !ok {
		return Candidate{}, "unsupported_event_name"
	}
	if event.Authority != "client_observed" || event.EventName == "purchase_completed_provider" {
		return Candidate{}, "authority_not_allowed"
	}
	occurred, ok := ParseTimestamp(event.OccurredAt)
	if !ok {
		return Candidate{}, "invalid_timestamp"
	}
	queued, ok := ParseTimestamp(event.QueuedAt)
	if !ok || queued.Before(occurred) {
		return Candidate{}, "invalid_timestamp"
	}
	if occurred.After(now.Add(FutureSkew)) {
		return Candidate{}, "occurred_at_too_far_future"
	}
	if occurred.Before(now.Add(-EventExpiry)) {
		return Candidate{}, "event_expired"
	}
	if event.Context.Platform != "ios" && event.Context.Platform != "android" || event.Context.SDKFamily != "flutter" && event.Context.SDKFamily != "ios" && event.Context.SDKFamily != "android" {
		return Candidate{}, "event_schema_invalid"
	}
	if event.Context.SDKVersion == "" || len(event.Context.SDKVersion) > 64 || len(event.Context.ApplicationVersion) > 64 || len(event.Context.Locale) > 35 {
		return Candidate{}, "event_schema_invalid"
	}
	if code := validateRequiredContext(event); code != "" {
		return Candidate{}, code
	}
	if code := validatePayload(event.EventName, event.Payload); code != "" {
		return Candidate{}, code
	}
	return Candidate{Event: event, Raw: raw, OccurredAt: occurred, QueuedAt: queued, SentAt: sentAt, ReceivedAt: now, ExpiresAt: now.Add(EventExpiry)}, ""
}

func validID(value string) bool { return identifierPattern.MatchString(value) }
func validApplicationUserID(value string) bool {
	length := utf8.RuneCountInString(value)
	if length < 1 || length > 256 {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func looksSensitive(value string) bool {
	if strings.Contains(value, "@") || strings.HasPrefix(strings.ToLower(value), "bearer ") {
		return true
	}
	digits := 0
	for _, r := range value {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	return digits >= 10 && (strings.HasPrefix(value, "+") || strings.ContainsAny(value, " ()-"))
}

func require(values ...string) bool {
	for _, value := range values {
		if !validID(value) {
			return false
		}
	}
	return true
}

func validateRequiredContext(event Event) string {
	a, c := event.Attribution, event.Correlation
	switch {
	case strings.HasPrefix(event.EventName, "placement_"):
		if !require(c.PlacementRequestID, a.PlacementID) {
			return "event_schema_invalid"
		}
	case strings.HasPrefix(event.EventName, "paywall_"):
		if !require(c.PaywallPresentationID) {
			return "event_schema_invalid"
		}
	case strings.HasPrefix(event.EventName, "product_load_"):
		if !require(c.ProductLoadAttemptID) {
			return "event_schema_invalid"
		}
	case event.EventName == "product_unavailable":
		if !require(c.ProductLoadAttemptID, a.ProductID) {
			return "event_schema_invalid"
		}
	case event.EventName == "product_selected":
		if !require(c.PaywallPresentationID, a.ProductID) {
			return "event_schema_invalid"
		}
	case strings.HasPrefix(event.EventName, "purchase_"):
		if !require(c.PurchaseAttemptID, a.ProductID) {
			return "event_schema_invalid"
		}
	case strings.HasPrefix(event.EventName, "restore_"):
		if !require(c.RestoreAttemptID) {
			return "event_schema_invalid"
		}
	}
	if event.EventName == "placement_paywall_selected" || event.EventName == "paywall_presented" {
		if !require(a.PaywallVersionID) {
			return "event_schema_invalid"
		}
	}
	return ""
}

func validatePayload(eventName string, raw json.RawMessage) string {
	if len(raw) == 0 {
		return "event_schema_invalid"
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil {
		return "event_schema_invalid"
	}
	rule := payloadRules[eventName]
	for key := range value {
		if _, ok := rule.required[key]; ok {
			continue
		}
		if _, ok := rule.optional[key]; !ok {
			return "unknown_field"
		}
	}
	for key, kind := range rule.required {
		item, ok := value[key]
		if !ok || !validPayloadValue(kind, item) {
			return "event_schema_invalid"
		}
	}
	for key, kind := range rule.optional {
		if item, ok := value[key]; ok && !validPayloadValue(kind, item) {
			return "event_schema_invalid"
		}
	}
	for key, item := range value {
		if strings.Contains(strings.ToLower(key), "secret") || strings.Contains(strings.ToLower(key), "token") {
			return "sensitive_value_rejected"
		}
		if text, ok := item.(string); ok && len(text) > 96 {
			return "event_schema_invalid"
		}
	}
	return ""
}

func validPayloadValue(kind string, value any) bool {
	switch kind {
	case "string":
		text, ok := value.(string)
		return ok && text != "" && len(text) <= 96
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "number":
		number, ok := value.(json.Number)
		if !ok {
			return false
		}
		n, err := number.Int64()
		return err == nil && n >= 0 && n <= 86400000
	case "string_array":
		items, ok := value.([]any)
		if !ok || len(items) > 64 {
			return false
		}
		for _, item := range items {
			text, ok := item.(string)
			if !ok || !validID(text) {
				return false
			}
		}
		return true
	default:
		panic(fmt.Sprintf("unknown payload kind %q", kind))
	}
}
