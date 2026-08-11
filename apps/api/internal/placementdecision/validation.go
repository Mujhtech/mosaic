package placementdecision

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"time"
)

const maxDocumentBytes = 256 << 10

var (
	keyPattern     = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	countryPattern = regexp.MustCompile(`^[A-Z]{2}$`)
	// alpha2Pattern recognizes a host-reported country in either case. The
	// authored side stays on countryPattern, which is canonical-only.
	alpha2Pattern = regexp.MustCompile(`^[A-Za-z]{2}$`)
)

type ReferenceCatalog interface {
	Attribute(string) (AttributeDefinition, bool)
	PaywallVersion(string) bool
	Product(string) bool
	Entitlement(string) bool
}

func Canonicalize(raw json.RawMessage) (Document, json.RawMessage, string, error) {
	if len(raw) == 0 || len(raw) > maxDocumentBytes {
		return Document{}, nil, "", fmt.Errorf("document size outside accepted bounds")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	var envelope DecisionEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return Document{}, nil, "", fmt.Errorf("decode decision document: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return Document{}, nil, "", fmt.Errorf("document contains trailing values")
	}
	if envelope.PlacementDecisionVersion != ContractVersion {
		return Document{}, nil, "", fmt.Errorf("unsupported placement decision version")
	}
	canonical, err := json.Marshal(envelope)
	if err != nil {
		return Document{}, nil, "", fmt.Errorf("encode decision document: %w", err)
	}
	return envelope.RuleSet, canonical, digest(canonical), nil
}

func MarshalDocument(document Document) json.RawMessage {
	encoded, _ := json.Marshal(DecisionEnvelope{PlacementDecisionVersion: ContractVersion, RuleSet: document})
	return encoded
}

func Validate(document Document, catalog ReferenceCatalog) ValidationResult {
	issues := make([]ValidationIssue, 0)
	add := func(code, ruleID, path, resourceType, resourceID, action string) {
		issues = append(issues, ValidationIssue{Severity: "error", Code: code, RuleID: ruleID, ConditionPath: path, ResourceType: resourceType, ResourceID: resourceID, RecoveryAction: action})
	}
	addWarning := func(code, ruleID, path, resourceType, resourceID, action string) {
		if warningCount(issues) < 64 {
			issues = append(issues, ValidationIssue{Severity: "warning", Code: code, RuleID: ruleID, ConditionPath: path, ResourceType: resourceType, ResourceID: resourceID, RecoveryAction: action})
		}
	}
	if document.RuleSetID == "" || document.Version < 1 || document.ProjectID == "" || document.EnvironmentID == "" || document.PlacementID == "" || !keyPattern.MatchString(document.PlacementKey) {
		add("invalid_rule_set_identity", "", "", "rule_set", document.RuleSetID, "restore_rule_set_identity")
	}
	if document.AssignmentPolicy != "installation" && document.AssignmentPolicy != "identified_user" && document.AssignmentPolicy != "identified_user_or_installation" {
		add("unsupported_assignment_policy", "", "", "rule_set", document.RuleSetID, "select_supported_assignment_policy")
	}
	if len(document.Rules) > 100 {
		add("too_many_rules", "", "rules", "rule_set", document.RuleSetID, "remove_rules")
	}
	if len(document.AttributeDefinitions) > 32 {
		add("too_many_attribute_definitions", "", "attributeDefinitions", "rule_set", document.RuleSetID, "archive_unused_attribute_definitions")
	}
	if len(document.QAOverrides) > 32 {
		add("too_many_qa_overrides", "", "qaOverrides", "rule_set", document.RuleSetID, "revoke_or_expire_qa_overrides")
	}
	fallbacks := fallbackMap(document.Fallbacks)
	validateOutcome(document.DefaultOutcome, "", "defaultOutcome", fallbacks, catalog, add)
	for _, fallback := range document.Fallbacks {
		if !keyPattern.MatchString(fallback.Key) {
			add("invalid_fallback_key", "", "fallbacks."+fallback.Key, "fallback", fallback.Key, "rename_fallback")
		}
		validateOutcome(fallback.Outcome, "", "fallbacks."+fallback.Key, fallbacks, catalog, add)
	}
	validateFallbackCycles(fallbacks, add)
	overrideIDs := map[string]struct{}{}
	for index, override := range document.QAOverrides {
		path := fmt.Sprintf("qaOverrides.%d", index)
		if override.ID == "" {
			add("missing_qa_override_id", "", path+".id", "qa_override", "", "recreate_qa_override")
		} else if _, exists := overrideIDs[override.ID]; exists {
			add("duplicate_qa_override_id", "", path+".id", "qa_override", override.ID, "revoke_duplicate_qa_override")
		}
		overrideIDs[override.ID] = struct{}{}
		validateOutcome(override.Outcome, "", path+".outcome", fallbacks, catalog, add)
	}
	priorities := map[int]string{}
	ruleIDs := map[string]struct{}{}
	for index, rule := range document.Rules {
		path := fmt.Sprintf("rules.%d", index)
		if rule.ID == "" {
			add("missing_rule_id", rule.ID, path, "rule", "", "assign_rule_id")
		}
		if _, exists := ruleIDs[rule.ID]; exists {
			add("duplicate_rule_id", rule.ID, path, "rule", rule.ID, "remove_duplicate_rule")
		}
		ruleIDs[rule.ID] = struct{}{}
		if rule.Priority < 0 || rule.Priority > 9999 {
			add("invalid_rule_priority", rule.ID, path+".priority", "rule", rule.ID, "set_priority_between_0_and_9999")
		}
		if other, exists := priorities[rule.Priority]; exists {
			add("duplicate_rule_priority", rule.ID, path+".priority", "rule", other, "assign_unique_priority")
		}
		priorities[rule.Priority] = rule.ID
		leaves := 0
		validateCondition(rule.Condition, rule.ID, path+".condition", 1, &leaves, catalog, add)
		warnDuplicateLeaves(rule.Condition, rule.ID, path+".condition", map[string]string{}, addWarning)
		if leaves > 64 {
			add("too_many_condition_leaves", rule.ID, path+".condition", "rule", rule.ID, "remove_conditions")
		}
		if rule.Rollout != nil {
			if rule.Rollout.Algorithm != BucketingAlgorithm {
				add("unsupported_bucketing_algorithm", rule.ID, path+".rollout.algorithm", "rule", rule.ID, "select_supported_bucketing_algorithm")
			}
			if rule.Rollout.ThresholdBasisPoints < 0 || rule.Rollout.ThresholdBasisPoints > 10000 {
				add("invalid_rollout_threshold", rule.ID, path+".rollout.thresholdBasisPoints", "rule", rule.ID, "set_rollout_between_0_and_10000")
			}
		}
		validateOutcome(rule.Outcome, rule.ID, path+".outcome", fallbacks, catalog, add)
	}
	enabledRules := make([]Rule, 0, len(document.Rules))
	for _, rule := range document.Rules {
		if rule.Enabled {
			enabledRules = append(enabledRules, rule)
		}
	}
	sort.SliceStable(enabledRules, func(i, j int) bool { return enabledRules[i].Priority < enabledRules[j].Priority })
	earlierConditions := map[string]Rule{}
	for _, rule := range enabledRules {
		conditionKey := canonicalCondition(rule.Condition)
		if earlier, exists := earlierConditions[conditionKey]; exists && (earlier.Rollout == nil || earlier.Rollout.ThresholdBasisPoints == 10000) {
			addWarning("rule_shadowed_by_earlier_equivalent", rule.ID, "rules."+rule.ID+".condition", "rule", earlier.ID, "remove_or_change_shadowed_rule")
			continue
		}
		if earlier, exists := earlierConditions[conditionKey]; !exists || (earlier.Rollout != nil && rule.Rollout == nil) || (earlier.Rollout != nil && rule.Rollout != nil && rule.Rollout.ThresholdBasisPoints == 10000) {
			earlierConditions[conditionKey] = rule
		}
	}
	sort.SliceStable(issues, func(i, j int) bool {
		return issues[i].ConditionPath+issues[i].Code < issues[j].ConditionPath+issues[j].Code
	})
	valid := true
	for _, issue := range issues {
		if issue.Severity == "error" {
			valid = false
			break
		}
	}
	return ValidationResult{Valid: valid, Issues: issues}
}

func warningCount(issues []ValidationIssue) int {
	count := 0
	for _, issue := range issues {
		if issue.Severity == "warning" {
			count++
		}
	}
	return count
}

func canonicalCondition(condition Condition) string {
	encoded, _ := json.Marshal(condition)
	return string(encoded)
}

func warnDuplicateLeaves(node Condition, ruleID, path string, seen map[string]string, add func(string, string, string, string, string, string)) {
	if node.Type == "condition" {
		key := canonicalCondition(node)
		if _, exists := seen[key]; exists {
			add("duplicate_leaf_condition", ruleID, path, "rule", ruleID, "remove_duplicate_condition")
		} else {
			seen[key] = path
		}
		return
	}
	if node.Child != nil {
		warnDuplicateLeaves(*node.Child, ruleID, path+".child", seen, add)
	}
	for index, child := range node.Children {
		warnDuplicateLeaves(child, ruleID, fmt.Sprintf("%s.children.%d", path, index), seen, add)
	}
}

// DeriveCompatibility returns the exact feature and bucketing requirements of
// the final immutable Rule Set document. Author-supplied compatibility metadata
// is never trusted during publication.
func DeriveCompatibility(document Document) Compatibility {
	features := map[string]struct{}{}
	algorithms := map[string]struct{}{}
	addOutcome := func(outcome Outcome) { features["outcome."+outcome.Type] = struct{}{} }
	addOutcome(document.DefaultOutcome)
	for _, fallback := range document.Fallbacks {
		addOutcome(fallback.Outcome)
	}
	for _, override := range document.QAOverrides {
		features["override.qa"] = struct{}{}
		addOutcome(override.Outcome)
	}
	var visit func(Condition)
	visit = func(condition Condition) {
		if condition.Type == "condition" {
			features["source."+condition.Source.Kind] = struct{}{}
			features["operator."+condition.Operator] = struct{}{}
			return
		}
		features["condition."+condition.Type] = struct{}{}
		if condition.Child != nil {
			visit(*condition.Child)
		}
		for _, child := range condition.Children {
			visit(child)
		}
	}
	for _, rule := range document.Rules {
		addOutcome(rule.Outcome)
		visit(rule.Condition)
		if rule.Rollout != nil {
			algorithms[rule.Rollout.Algorithm] = struct{}{}
		}
	}
	result := Compatibility{RequiredFeatures: make([]string, 0, len(features)), RequiredBucketingAlgorithms: make([]string, 0, len(algorithms))}
	for feature := range features {
		result.RequiredFeatures = append(result.RequiredFeatures, feature)
	}
	for algorithm := range algorithms {
		result.RequiredBucketingAlgorithms = append(result.RequiredBucketingAlgorithms, algorithm)
	}
	sort.Strings(result.RequiredFeatures)
	sort.Strings(result.RequiredBucketingAlgorithms)
	return result
}

func validateCondition(node Condition, ruleID, path string, depth int, leaves *int, catalog ReferenceCatalog, add func(string, string, string, string, string, string)) {
	if depth > 5 {
		add("condition_depth_exceeded", ruleID, path, "rule", ruleID, "reduce_condition_nesting")
		return
	}
	switch node.Type {
	case "all", "any":
		if len(node.Children) < 2 || len(node.Children) > 16 {
			add("invalid_condition_group_size", ruleID, path, "rule", ruleID, "use_2_to_16_children")
		}
		for index, child := range node.Children {
			validateCondition(child, ruleID, fmt.Sprintf("%s.children.%d", path, index), depth+1, leaves, catalog, add)
		}
	case "not":
		if node.Child == nil {
			add("missing_not_child", ruleID, path, "rule", ruleID, "add_one_condition")
			return
		}
		validateCondition(*node.Child, ruleID, path+".child", depth+1, leaves, catalog, add)
	case "condition":
		*leaves = *leaves + 1
		validateLeaf(node, ruleID, path, catalog, add)
	default:
		add("unsupported_condition_type", ruleID, path, "rule", ruleID, "select_supported_condition_group")
	}
}

var sourceOperators = map[string]map[string]bool{
	"device.platform": exactOperators(), "environment.id": exactOperators(), "environment.key": exactOperators(),
	"identity.user_present": exactOperators(), "context.country": exactOperators(),
	"device.os_version": orderedOperators(), "application.version": orderedOperators(),
	"application.locale": {"equals": true, "not_equals": true, "in": true, "not_in": true, "exists": true, "does_not_exist": true, "locale_matches": true},
	"user_attribute":     allValueOperators(), "entitlement_state": exactOperators(), "product_availability": exactOperators(),
	"product_readiness": exactOperators(), "provider_capability": exactOperators(),
}

func exactOperators() map[string]bool {
	return map[string]bool{"equals": true, "not_equals": true, "in": true, "not_in": true, "exists": true, "does_not_exist": true}
}
func orderedOperators() map[string]bool {
	result := exactOperators()
	for _, op := range []string{"greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal"} {
		result[op] = true
	}
	return result
}
func allValueOperators() map[string]bool {
	result := orderedOperators()
	result["contains_any"], result["contains_all"] = true, true
	return result
}

func validateLeaf(node Condition, ruleID, path string, catalog ReferenceCatalog, add func(string, string, string, string, string, string)) {
	operators, ok := sourceOperators[node.Source.Kind]
	if !ok {
		add("unsupported_condition_source", ruleID, path+".source", "rule", ruleID, "select_supported_source")
		return
	}
	if !operators[node.Operator] {
		add("unsupported_operator", ruleID, path+".operator", "rule", ruleID, "select_operator_compatible_with_source")
	}
	key := node.Source.Key
	if node.Source.ProductID != "" {
		key = node.Source.ProductID
	}
	if node.Source.Capability != "" {
		key = node.Source.Capability
	}
	needsKey := node.Source.Kind == "user_attribute" || node.Source.Kind == "entitlement_state" || node.Source.Kind == "product_availability" || node.Source.Kind == "product_readiness" || node.Source.Kind == "provider_capability"
	if needsKey && key == "" {
		add("missing_condition_key", ruleID, path+".key", "rule", ruleID, "select_reference")
	}
	if catalog != nil {
		switch node.Source.Kind {
		case "user_attribute":
			definition, exists := catalog.Attribute(key)
			if !exists || definition.Status != "active" {
				add("attribute_not_allow_listed", ruleID, path+".key", "attribute_definition", key, "create_or_enable_attribute_definition")
			} else if !contains(definition.AllowedOperators, node.Operator) {
				add("attribute_operator_not_allowed", ruleID, path+".operator", "attribute_definition", definition.ID, "allow_operator_or_change_condition")
			}
		case "product_availability", "product_readiness":
			if !catalog.Product(key) {
				add("invalid_product_reference", ruleID, path+".key", "product", key, "select_project_product")
			}
		case "entitlement_state":
			if !catalog.Entitlement(key) {
				add("invalid_entitlement_reference", ruleID, path+".key", "entitlement", key, "select_project_entitlement")
			}
		}
	}
	if node.Operator == "exists" || node.Operator == "does_not_exist" {
		if node.Value != nil {
			add("unexpected_condition_value", ruleID, path+".value", "rule", ruleID, "remove_operand")
		}
		return
	}
	if node.Value == nil || !validTypedValue(*node.Value) {
		add("invalid_typed_value", ruleID, path+".value", "rule", ruleID, "enter_value_matching_the_condition_type")
		return
	}
	if node.Source.Kind == "context.country" {
		value, _ := node.Value.Value.(string)
		if node.Value.Type != "string" || !countryPattern.MatchString(value) {
			add("invalid_explicit_country", ruleID, path+".value", "rule", ruleID, "use_iso_3166_1_alpha_2_country")
		}
	}
	if (node.Source.Kind == "application.version" || node.Source.Kind == "device.os_version") && node.Value.Type == "semantic_version" {
		if value, ok := node.Value.Value.(string); !ok || !validSemver(value) {
			add("invalid_semantic_version", ruleID, path+".value", "rule", ruleID, "use_mosaic_semver_v1")
		}
	}
}

func validTypedValue(value TypedValue) bool {
	switch value.Type {
	case "string":
		text, ok := value.Value.(string)
		return ok && len([]byte(text)) <= 256
	case "boolean":
		_, ok := value.Value.(bool)
		return ok
	case "number":
		switch number := value.Value.(type) {
		case json.Number:
			parsed, err := number.Float64()
			return err == nil && !math.IsInf(parsed, 0) && !math.IsNaN(parsed)
		case float64:
			return !math.IsInf(number, 0) && !math.IsNaN(number)
		default:
			return false
		}
	case "timestamp":
		text, ok := value.Value.(string)
		if !ok {
			return false
		}
		parsed, err := time.Parse(time.RFC3339Nano, text)
		return err == nil && parsed.Location() == time.UTC
	case "semantic_version":
		text, ok := value.Value.(string)
		return ok && validSemver(text)
	case "string_list":
		values, ok := value.Value.([]any)
		if !ok || len(values) > 16 {
			return false
		}
		seen := map[string]bool{}
		for _, item := range values {
			text, ok := item.(string)
			if !ok || len([]byte(text)) > 128 || seen[text] {
				return false
			}
			seen[text] = true
		}
		return true
	default:
		return false
	}
}

func validateOutcome(outcome Outcome, ruleID, path string, fallbacks map[string]Outcome, catalog ReferenceCatalog, add func(string, string, string, string, string, string)) {
	switch outcome.Type {
	case "paywall":
		if outcome.FallbackKey != "" || outcome.ReasonCode != "" {
			add("invalid_paywall_outcome_shape", ruleID, path, "rule", ruleID, "remove_unsupported_outcome_fields")
		}
		if outcome.PaywallVersionID == "" || (catalog != nil && !catalog.PaywallVersion(outcome.PaywallVersionID)) {
			add("invalid_paywall_version_reference", ruleID, path, "paywall_version", outcome.PaywallVersionID, "select_published_paywall")
		}
		if outcome.UnavailableFallbackKey != "" {
			if _, ok := fallbacks[outcome.UnavailableFallbackKey]; !ok {
				add("invalid_unavailable_fallback", ruleID, path, "fallback", outcome.UnavailableFallbackKey, "select_named_fallback")
			}
		}
	case "no_paywall":
		if outcome.PaywallVersionID != "" || outcome.FallbackKey != "" || outcome.UnavailableFallbackKey != "" || outcome.ReasonCode != "" {
			add("invalid_no_paywall_outcome_shape", ruleID, path, "rule", ruleID, "remove_unsupported_outcome_fields")
		}
	case "fallback":
		if outcome.PaywallVersionID != "" || outcome.UnavailableFallbackKey != "" || outcome.ReasonCode != "" {
			add("invalid_fallback_outcome_shape", ruleID, path, "rule", ruleID, "remove_unsupported_outcome_fields")
		}
		if _, ok := fallbacks[outcome.FallbackKey]; !ok {
			add("invalid_fallback_reference", ruleID, path, "fallback", outcome.FallbackKey, "select_named_fallback")
		}
	case "unavailable":
		if outcome.PaywallVersionID != "" || outcome.FallbackKey != "" || outcome.UnavailableFallbackKey != "" {
			add("invalid_unavailable_outcome_shape", ruleID, path, "rule", ruleID, "remove_unsupported_outcome_fields")
		}
		if !contains([]string{"no_safe_decision", "configuration_incompatible", "content_unavailable", "commerce_unavailable"}, outcome.ReasonCode) {
			add("invalid_unavailable_reason", ruleID, path, "rule", ruleID, "select_safe_reason_code")
		}
	default:
		add("unsupported_outcome", ruleID, path, "rule", ruleID, "select_supported_outcome")
	}
}

func validateFallbackCycles(fallbacks map[string]Outcome, add func(string, string, string, string, string, string)) {
	for start := range fallbacks {
		seen, current := map[string]bool{}, start
		for depth := 0; depth <= 8; depth++ {
			if seen[current] {
				add("fallback_cycle", "", "fallbacks."+start, "fallback", current, "remove_fallback_cycle")
				break
			}
			seen[current] = true
			outcome, ok := fallbacks[current]
			if !ok || outcome.Type != "fallback" {
				break
			}
			current = outcome.FallbackKey
			if depth == 8 {
				add("fallback_depth_exceeded", "", "fallbacks."+start, "fallback", start, "shorten_fallback_chain")
			}
		}
	}
}

func contains(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
func normalizedOperators(values []string) []string {
	result := append([]string(nil), values...)
	sort.Strings(result)
	return result
}
func fallbackMap(values []Fallback) map[string]Outcome {
	result := make(map[string]Outcome, len(values))
	for _, value := range values {
		result[value.Key] = value.Outcome
	}
	return result
}
