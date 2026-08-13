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
	"experiment_assigned": {}, "experiment_exposed": {}, "experiment_fallback_presented": {}, "experiment_assignment_failed": {},
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
	"placement_requested":           {fields("decisionContractVersion", "string"), nil},
	"placement_paywall_selected":    {fields("finalOutcome", "string", "decisionContractVersion", "string"), fields("assignmentKeyType", "string", "bucketingAlgorithm", "string", "rolloutBucket", "number")},
	"placement_no_paywall":          {fields("finalOutcome", "string", "decisionContractVersion", "string"), fields("assignmentKeyType", "string", "bucketingAlgorithm", "string", "rolloutBucket", "number")},
	"placement_fallback_used":       {fields("trigger", "string", "fallbackKey", "string", "finalOutcome", "string"), fields("diagnosticCode", "string")},
	"placement_unavailable":         {fields("reason", "string"), fields("diagnosticCode", "string")},
	"placement_evaluation_failed":   {fields("diagnosticCode", "string", "retryable", "boolean"), nil},
	"paywall_presented":             {nil, nil},
	"paywall_dismissed":             {fields("reason", "string"), nil},
	"paywall_action_selected":       {fields("action", "string"), fields("componentId", "string")},
	"paywall_render_failed":         {fields("diagnosticCode", "string", "retryable", "boolean"), nil},
	"product_load_started":          {fields("requestedProductCount", "number"), nil},
	"product_load_completed":        {fields("availableProductCount", "number", "unavailableProductCount", "number", "durationMs", "number"), nil},
	"product_load_failed":           {fields("requestedProductCount", "number", "durationMs", "number", "diagnosticCode", "string", "retryable", "boolean"), nil},
	"product_unavailable":           {fields("reason", "string"), fields("diagnosticCode", "string")},
	"product_selected":              {fields("source", "string"), nil},
	"purchase_started":              {nil, nil},
	"purchase_completed_client":     {fields("outcome", "string", "durationMs", "number", "observedEntitlementKeys", "string_array"), fields("providerResultCode", "string")},
	"purchase_completed_provider":   {fields("confirmationSource", "string", "activeEntitlementKeys", "string_array"), fields("linkedClientEventId", "string")},
	"purchase_pending":              {fields("durationMs", "number"), fields("providerResultCode", "string")},
	"purchase_deferred":             {fields("durationMs", "number"), fields("providerResultCode", "string")},
	"purchase_cancelled":            {fields("durationMs", "number"), fields("providerResultCode", "string")},
	"purchase_failed":               {fields("durationMs", "number", "diagnosticCode", "string", "retryable", "boolean"), nil},
	"restore_started":               {fields("providerId", "string"), nil},
	"restore_completed":             {fields("providerId", "string", "durationMs", "number", "restoredProductIds", "string_array", "observedEntitlementKeys", "string_array"), nil},
	"restore_nothing_found":         {fields("providerId", "string", "durationMs", "number"), fields("providerResultCode", "string")},
	"restore_cancelled":             {fields("providerId", "string", "durationMs", "number"), fields("providerResultCode", "string")},
	"restore_failed":                {fields("providerId", "string", "durationMs", "number", "diagnosticCode", "string", "retryable", "boolean"), nil},
	"experiment_assigned":           {fields("assignmentKeyType", "string", "bucketingAlgorithm", "string", "bucket", "number", "source", "string"), nil},
	"experiment_exposed":            {fields("assignmentKeyType", "string", "bucketingAlgorithm", "string", "productReadiness", "string", "providerCapability", "string"), fields("qaOverride", "boolean")},
	"experiment_fallback_presented": {fields("reason", "string", "presentedPaywallId", "string", "presentedPaywallVersionId", "string"), fields("diagnosticCode", "string")},
	"experiment_assignment_failed":  {fields("diagnosticCode", "string", "retryable", "boolean"), nil},
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
	attribution := event.Attribution
	experimentFields := []string{attribution.ExperimentID, attribution.ExperimentVersionID, attribution.ExperimentVariantID, attribution.ExperimentAllocationVersion}
	present := 0
	for _, value := range experimentFields {
		if value != "" {
			present++
		}
	}
	if present != 0 && present != len(experimentFields) {
		return Candidate{}, "experiment_attribution_incomplete"
	}
	if strings.HasPrefix(event.EventName, "experiment_") && present != len(experimentFields) {
		return Candidate{}, "experiment_attribution_incomplete"
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
	if code := validateMinimization(event); code != "" {
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
	case strings.HasPrefix(event.EventName, "experiment_"):
		if !require(c.PlacementRequestID, a.PlacementID, a.ExperimentID, a.ExperimentVersionID, a.ExperimentVariantID, a.ExperimentAllocationVersion) {
			return "event_schema_invalid"
		}
		if (event.EventName == "experiment_exposed" || event.EventName == "experiment_fallback_presented") && !require(c.PaywallPresentationID) {
			return "event_schema_invalid"
		}
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

// Data-minimization tables.
//
// These mirror the canonical semantic validators
// (protocol/tools/analytics-event-validation-v1.mjs and -v2.mjs). Before Phase 8
// the API accepted any correlation or attribution field the JSON Schema allowed,
// so the canonical validator, the schema, and the runtime disagreed about
// validity and the ingestion boundary collected identifiers an event has no
// business carrying. The tables below make the runtime the same authority.
var (
	experimentTupleFields = []string{"experimentId", "experimentVersionId", "experimentVariantId", "experimentAllocationVersion"}
	placementAttribution  = []string{"configurationReleaseId", "placementId", "placementRuleSetId", "placementRuleSetVersion", "winningRuleId"}
	paywallAttribution    = append(append([]string{}, placementAttribution...), "paywallId", "paywallVersionId")
	productAttribution    = append(append([]string{}, paywallAttribution...), "mosaicProductId", "planId", "providerId", "providerProductMappingId")
)

func withoutWinningRule(fields []string) []string {
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		if field != "winningRuleId" {
			result = append(result, field)
		}
	}
	return result
}

func withExperimentTuple(fields []string) []string {
	return append(append([]string{}, fields...), experimentTupleFields...)
}

func fieldSet(values ...[]string) map[string]struct{} {
	set := make(map[string]struct{})
	for _, group := range values {
		for _, value := range group {
			set[value] = struct{}{}
		}
	}
	return set
}

var correlationFieldsByEvent = map[string]map[string]struct{}{
	"placement_requested":           fieldSet([]string{"placementRequestId"}),
	"placement_paywall_selected":    fieldSet([]string{"placementRequestId"}),
	"placement_no_paywall":          fieldSet([]string{"placementRequestId"}),
	"placement_fallback_used":       fieldSet([]string{"placementRequestId"}),
	"placement_unavailable":         fieldSet([]string{"placementRequestId"}),
	"placement_evaluation_failed":   fieldSet([]string{"placementRequestId"}),
	"paywall_presented":             fieldSet([]string{"placementRequestId", "paywallPresentationId"}),
	"paywall_dismissed":             fieldSet([]string{"placementRequestId", "paywallPresentationId"}),
	"paywall_action_selected":       fieldSet([]string{"placementRequestId", "paywallPresentationId"}),
	"paywall_render_failed":         fieldSet([]string{"placementRequestId", "paywallPresentationId"}),
	"product_load_started":          fieldSet([]string{"placementRequestId", "paywallPresentationId", "productLoadAttemptId"}),
	"product_load_completed":        fieldSet([]string{"placementRequestId", "paywallPresentationId", "productLoadAttemptId"}),
	"product_load_failed":           fieldSet([]string{"placementRequestId", "paywallPresentationId", "productLoadAttemptId"}),
	"product_unavailable":           fieldSet([]string{"placementRequestId", "paywallPresentationId", "productLoadAttemptId"}),
	"product_selected":              fieldSet([]string{"placementRequestId", "paywallPresentationId", "productLoadAttemptId"}),
	"purchase_started":              fieldSet(purchaseCorrelation),
	"purchase_completed_client":     fieldSet(purchaseCorrelation),
	"purchase_completed_provider":   fieldSet([]string{"purchaseAttemptId", "providerOperationId", "providerUpdateId"}),
	"purchase_pending":              fieldSet(purchaseCorrelation),
	"purchase_deferred":             fieldSet(purchaseCorrelation),
	"purchase_cancelled":            fieldSet(purchaseCorrelation),
	"purchase_failed":               fieldSet(purchaseCorrelation),
	"restore_started":               fieldSet(restoreCorrelation),
	"restore_completed":             fieldSet(restoreCorrelation),
	"restore_nothing_found":         fieldSet(restoreCorrelation),
	"restore_cancelled":             fieldSet(restoreCorrelation),
	"restore_failed":                fieldSet(restoreCorrelation),
	"experiment_assigned":           fieldSet([]string{"placementRequestId"}),
	"experiment_exposed":            fieldSet([]string{"placementRequestId", "paywallPresentationId"}),
	"experiment_fallback_presented": fieldSet([]string{"placementRequestId", "paywallPresentationId"}),
	"experiment_assignment_failed":  fieldSet([]string{"placementRequestId"}),
}

var (
	purchaseCorrelation = []string{"placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId", "providerOperationId"}
	restoreCorrelation  = []string{"restoreAttemptId", "providerOperationId"}
)

var attributionFieldsByEvent = map[string]map[string]struct{}{
	"placement_requested":           fieldSet(withoutWinningRule(placementAttribution)),
	"placement_paywall_selected":    fieldSet(paywallAttribution),
	"placement_no_paywall":          fieldSet(placementAttribution),
	"placement_fallback_used":       fieldSet(paywallAttribution),
	"placement_unavailable":         fieldSet(placementAttribution),
	"placement_evaluation_failed":   fieldSet(withoutWinningRule(placementAttribution)),
	"paywall_presented":             fieldSet(paywallAttribution),
	"paywall_dismissed":             fieldSet(paywallAttribution),
	"paywall_action_selected":       fieldSet(paywallAttribution),
	"paywall_render_failed":         fieldSet(paywallAttribution),
	"product_load_started":          fieldSet(paywallAttribution),
	"product_load_completed":        fieldSet(paywallAttribution),
	"product_load_failed":           fieldSet(paywallAttribution),
	"product_unavailable":           fieldSet(productAttribution),
	"product_selected":              fieldSet(withExperimentTuple(productAttribution)),
	"purchase_started":              fieldSet(withExperimentTuple(productAttribution)),
	"purchase_completed_client":     fieldSet(withExperimentTuple(productAttribution)),
	"purchase_completed_provider":   fieldSet(withExperimentTuple(productAttribution)),
	"purchase_pending":              fieldSet(withExperimentTuple(productAttribution)),
	"purchase_deferred":             fieldSet(withExperimentTuple(productAttribution)),
	"purchase_cancelled":            fieldSet(withExperimentTuple(productAttribution)),
	"purchase_failed":               fieldSet(withExperimentTuple(productAttribution)),
	"restore_started":               fieldSet([]string{"configurationReleaseId"}),
	"restore_completed":             fieldSet([]string{"configurationReleaseId"}),
	"restore_nothing_found":         fieldSet([]string{"configurationReleaseId"}),
	"restore_cancelled":             fieldSet([]string{"configurationReleaseId"}),
	"restore_failed":                fieldSet([]string{"configurationReleaseId"}),
	"experiment_assigned":           fieldSet(withExperimentTuple(placementAttribution)),
	"experiment_exposed":            fieldSet(withExperimentTuple(paywallAttribution)),
	"experiment_fallback_presented": fieldSet(withExperimentTuple(placementAttribution)),
	"experiment_assignment_failed":  fieldSet(withExperimentTuple(placementAttribution)),
}

// presentCorrelationFields lists the correlation identifiers carried by an event.
func presentCorrelationFields(c Correlation) []string {
	present := make([]string, 0, 7)
	for _, candidate := range []struct {
		name  string
		value string
	}{
		{"placementRequestId", c.PlacementRequestID},
		{"paywallPresentationId", c.PaywallPresentationID},
		{"productLoadAttemptId", c.ProductLoadAttemptID},
		{"purchaseAttemptId", c.PurchaseAttemptID},
		{"restoreAttemptId", c.RestoreAttemptID},
		{"providerOperationId", c.ProviderOperationID},
		{"providerUpdateId", c.ProviderUpdateID},
	} {
		if candidate.value != "" {
			present = append(present, candidate.name)
		}
	}
	return present
}

// presentAttributionFields lists the attribution fields carried by an event.
func presentAttributionFields(a Attribution) []string {
	present := make([]string, 0, 15)
	for _, candidate := range []struct {
		name  string
		value string
	}{
		{"configurationReleaseId", a.ConfigurationReleaseID},
		{"placementId", a.PlacementID},
		{"placementRuleSetId", a.PlacementRuleSetID},
		{"winningRuleId", a.WinningRuleID},
		{"paywallId", a.PaywallID},
		{"paywallVersionId", a.PaywallVersionID},
		{"mosaicProductId", a.ProductID},
		{"planId", a.PlanID},
		{"providerId", a.Provider},
		{"providerProductMappingId", a.ProviderMappingID},
		{"experimentId", a.ExperimentID},
		{"experimentVersionId", a.ExperimentVersionID},
		{"experimentVariantId", a.ExperimentVariantID},
		{"experimentAllocationVersion", a.ExperimentAllocationVersion},
	} {
		if candidate.value != "" {
			present = append(present, candidate.name)
		}
	}
	if a.PlacementRuleSetVersion != 0 {
		present = append(present, "placementRuleSetVersion")
	}
	return present
}

// validateMinimization enforces the per-event correlation and attribution
// allow-lists plus the pairing rules that keep attribution interpretable. It
// applies to both v1 and v2 events.
func validateMinimization(event Event) string {
	allowedCorrelation, known := correlationFieldsByEvent[event.EventName]
	if !known {
		return RejectUnsupportedEventName
	}
	for _, field := range presentCorrelationFields(event.Correlation) {
		if _, ok := allowedCorrelation[field]; !ok {
			return RejectCorrelationNotAllowed
		}
	}
	allowedAttribution := attributionFieldsByEvent[event.EventName]
	for _, field := range presentAttributionFields(event.Attribution) {
		if _, ok := allowedAttribution[field]; !ok {
			return RejectAttributionNotAllowed
		}
	}

	// A Rule Set ID without its version cannot identify the evaluated targeting
	// state, and a winning Rule without a Rule Set is unattributable.
	hasRuleSetID := event.Attribution.PlacementRuleSetID != ""
	hasRuleSetVersion := event.Attribution.PlacementRuleSetVersion != 0
	if hasRuleSetID != hasRuleSetVersion {
		return RejectRuleSetAttributionIncomplete
	}
	if event.Attribution.WinningRuleID != "" && !hasRuleSetID {
		return RejectRuleSetAttributionIncomplete
	}

	if code := validateRolloutTuple(event); code != "" {
		return code
	}

	// A QA-overridden presentation is not a statistical exposure; counting it
	// would corrupt Experiment results.
	if event.EventName == "experiment_exposed" && payloadBool(event.Payload, "qaOverride") {
		return RejectQAExposure
	}
	if event.EventName == "experiment_fallback_presented" &&
		(event.Attribution.PaywallID != "" || event.Attribution.PaywallVersionID != "") {
		return RejectFallbackPaywallIdentity
	}
	return ""
}

// validateRolloutTuple enforces that rollout attribution on a selection event is
// either entirely absent or entirely present. A partial tuple silently
// misattributes a rollout bucket to an unknown algorithm.
func validateRolloutTuple(event Event) string {
	if event.EventName != "placement_paywall_selected" && event.EventName != "placement_no_paywall" {
		return ""
	}
	payload := decodePayload(event.Payload)
	if payload == nil {
		return ""
	}
	present := 0
	for _, field := range []string{"assignmentKeyType", "bucketingAlgorithm", "rolloutBucket"} {
		if _, ok := payload[field]; ok {
			present++
		}
	}
	if present != 0 && present != 3 {
		return RejectRolloutAttributionIncomplete
	}
	return ""
}

func decodePayload(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return nil
	}
	return value
}

func payloadBool(raw json.RawMessage, field string) bool {
	value, _ := decodePayload(raw)[field].(bool)
	return value
}
