package placementdecision

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Truth string

const (
	True    Truth = "true"
	False   Truth = "false"
	Unknown Truth = "unknown"
)

type InputValue struct {
	Value     any    `json:"value,omitempty"`
	Valid     bool   `json:"valid"`
	Source    string `json:"source"`
	Sensitive bool   `json:"sensitive,omitempty"`
}

type EvaluationContext struct {
	ProjectID            string                `json:"projectId"`
	EnvironmentID        string                `json:"environmentId"`
	EnvironmentKey       string                `json:"environmentKey"`
	PlacementID          string                `json:"placementId"`
	Platform             string                `json:"platform,omitempty"`
	OSVersion            string                `json:"osVersion,omitempty"`
	ApplicationVersion   string                `json:"applicationVersion,omitempty"`
	Locale               string                `json:"locale,omitempty"`
	Country              string                `json:"country,omitempty"`
	InstallationID       string                `json:"installationId,omitempty"`
	UserID               string                `json:"userId,omitempty"`
	Attributes           map[string]InputValue `json:"attributes,omitempty"`
	Entitlements         map[string]InputValue `json:"entitlements,omitempty"`
	ProductAvailability  map[string]InputValue `json:"productAvailability,omitempty"`
	ProductReadiness     map[string]InputValue `json:"productReadiness,omitempty"`
	ProviderCapabilities map[string]InputValue `json:"providerCapabilities,omitempty"`
	OverrideToken        string                `json:"overrideToken,omitempty"`
	EvaluationTime       time.Time             `json:"-"`
}

type TraceStep struct {
	Kind              string `json:"kind"`
	RuleID            string `json:"ruleId,omitempty"`
	ConditionPath     string `json:"conditionPath,omitempty"`
	Source            string `json:"source,omitempty"`
	InputSource       string `json:"inputSource,omitempty"`
	Result            Truth  `json:"result,omitempty"`
	Operator          string `json:"operator,omitempty"`
	AssignmentKeyType string `json:"assignmentKeyType,omitempty"`
	Bucket            *int   `json:"bucket,omitempty"`
	OutcomeType       string `json:"outcomeType,omitempty"`
	FallbackKey       string `json:"fallbackKey,omitempty"`
	ReasonCode        string `json:"reasonCode,omitempty"`
	Redacted          bool   `json:"redacted,omitempty"`
}

type EvaluationResult struct {
	WinningRuleID     string      `json:"winningRuleId,omitempty"`
	SelectedOutcome   Outcome     `json:"selectedOutcome"`
	FinalOutcome      Outcome     `json:"finalOutcome"`
	FallbackPath      []string    `json:"fallbackPath"`
	AssignmentKeyType string      `json:"assignmentKeyType,omitempty"`
	RolloutBucket     *int        `json:"rolloutBucket,omitempty"`
	Trace             []TraceStep `json:"trace"`
}

func Evaluate(document Document, context EvaluationContext) EvaluationResult {
	result := EvaluationResult{FallbackPath: []string{}, Trace: []TraceStep{}}
	if context.OverrideToken != "" {
		tokenHash := sha256.Sum256([]byte(context.OverrideToken))
		selector := "sha256:" + hex.EncodeToString(tokenHash[:])
		now := context.EvaluationTime
		for _, override := range document.QAOverrides {
			startsAt, startErr := time.Parse(time.RFC3339Nano, override.StartsAt)
			expiresAt, expiryErr := time.Parse(time.RFC3339Nano, override.ExpiresAt)
			if override.SelectorDigest == selector && startErr == nil && expiryErr == nil && !now.Before(startsAt) && now.Before(expiresAt) {
				result.SelectedOutcome = override.Outcome
				result.FinalOutcome = resolveFallback(override.Outcome, fallbackMap(document.Fallbacks), &result.FallbackPath, &result.Trace)
				result.Trace = appendTrace(result.Trace, TraceStep{Kind: "qa_override", OutcomeType: result.FinalOutcome.Type})
				return result
			}
		}
	}
	rules := append([]Rule(nil), document.Rules...)
	sort.SliceStable(rules, func(i, j int) bool { return rules[i].Priority < rules[j].Priority })
	selected := document.DefaultOutcome
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		truth := evaluateCondition(rule.Condition, context, rule.ID, "condition", &result.Trace)
		result.Trace = appendTrace(result.Trace, TraceStep{Kind: "rule", RuleID: rule.ID, Result: truth})
		if truth != True {
			continue
		}
		if rule.Rollout != nil {
			keyType, key, ok := assignmentKey(document.AssignmentPolicy, context)
			result.AssignmentKeyType = keyType
			if !ok {
				result.Trace = appendTrace(result.Trace, TraceStep{Kind: "rollout", RuleID: rule.ID, Result: Unknown, AssignmentKeyType: keyType})
				continue
			}
			bucket := RolloutBucket(context.ProjectID, context.EnvironmentID, context.PlacementID, rule.ID, keyType, key)
			result.RolloutBucket = &bucket
			matches := rule.Rollout.ThresholdBasisPoints == 10000 || (rule.Rollout.ThresholdBasisPoints > 0 && bucket < rule.Rollout.ThresholdBasisPoints)
			rolloutTruth := False
			if matches {
				rolloutTruth = True
			}
			result.Trace = appendTrace(result.Trace, TraceStep{Kind: "rollout", RuleID: rule.ID, Result: rolloutTruth, AssignmentKeyType: keyType, Bucket: &bucket})
			if !matches {
				continue
			}
		}
		result.WinningRuleID, selected = rule.ID, rule.Outcome
		break
	}
	result.SelectedOutcome = selected
	result.FinalOutcome = resolveFallback(selected, fallbackMap(document.Fallbacks), &result.FallbackPath, &result.Trace)
	result.Trace = appendTrace(result.Trace, TraceStep{Kind: "final", RuleID: result.WinningRuleID, OutcomeType: result.FinalOutcome.Type, ReasonCode: result.FinalOutcome.ReasonCode})
	return result
}

func appendTrace(trace []TraceStep, step TraceStep) []TraceStep {
	if len(trace) >= 256 {
		return trace
	}
	return append(trace, step)
}

func evaluateCondition(node Condition, context EvaluationContext, ruleID, path string, trace *[]TraceStep) Truth {
	var result Truth
	switch node.Type {
	case "all":
		result = True
		for index, child := range node.Children {
			value := evaluateCondition(child, context, ruleID, fmt.Sprintf("%s.children.%d", path, index), trace)
			if value == False {
				result = False
			} else if value == Unknown && result == True {
				result = Unknown
			}
		}
	case "any":
		result = False
		for index, child := range node.Children {
			value := evaluateCondition(child, context, ruleID, fmt.Sprintf("%s.children.%d", path, index), trace)
			if value == True {
				result = True
			} else if value == Unknown && result == False {
				result = Unknown
			}
		}
	case "not":
		if node.Child == nil {
			result = Unknown
		} else {
			result = evaluateCondition(*node.Child, context, ruleID, path+".child", trace)
			if result == True {
				result = False
			} else if result == False {
				result = True
			}
		}
	case "condition":
		input := lookup(node, context)
		result = compare(node.Source.Kind, node.Operator, input, node.Value)
		*trace = appendTrace(*trace, TraceStep{Kind: "condition", RuleID: ruleID, ConditionPath: path, Source: node.Source.Kind, InputSource: input.Source, Operator: node.Operator, Result: result, Redacted: input.Sensitive})
		return result
	default:
		result = Unknown
	}
	*trace = appendTrace(*trace, TraceStep{Kind: "group", RuleID: ruleID, ConditionPath: path, Result: result})
	return result
}

func lookup(condition Condition, context EvaluationContext) InputValue {
	key := condition.Source.Key
	if condition.Source.ProductID != "" {
		key = condition.Source.ProductID
	}
	if condition.Source.Capability != "" {
		key = condition.Source.Capability
	}
	switch condition.Source.Kind {
	case "device.platform":
		return reported(context.Platform, true, "sdk")
	case "device.os_version":
		return reported(context.OSVersion, validSemver(context.OSVersion), "sdk")
	case "application.version":
		return reported(context.ApplicationVersion, validSemver(context.ApplicationVersion), "host_application")
	case "application.locale":
		normalized, ok := normalizeLocale(context.Locale)
		if !ok {
			normalized = context.Locale
		}
		return reported(normalized, ok, "sdk")
	case "context.country":
		if alpha2Pattern.MatchString(context.Country) {
			return scalar(strings.ToUpper(context.Country), true, "host_application")
		}
		return reported(context.Country, false, "host_application")
	case "environment.id":
		return scalar(context.EnvironmentID, context.EnvironmentID != "", "configuration")
	case "environment.key":
		return scalar(context.EnvironmentKey, context.EnvironmentKey != "", "configuration")
	case "identity.user_present":
		return scalar(context.UserID != "", true, "identity_store")
	case "user_attribute":
		return mapValue(context.Attributes, key)
	case "entitlement_state":
		return mapValue(context.Entitlements, key)
	case "product_availability":
		return mapValue(context.ProductAvailability, key)
	case "product_readiness":
		return mapValue(context.ProductReadiness, key)
	case "provider_capability":
		return mapValue(context.ProviderCapabilities, key)
	default:
		return InputValue{}
	}
}

func scalar(value any, valid bool, source string) InputValue {
	return InputValue{Value: value, Valid: valid, Source: source}
}

// reported separates a value the host never supplied from one it supplied that
// the evaluator cannot use. The empty string is absence, so exists is false. A
// non-empty value that fails its grammar is present: exists is true and
// does_not_exist is false, because the host did report a locale or a version,
// while every comparison against it stays unknown rather than false. Collapsing
// the two would let does_not_exist match a device that reported a malformed
// value, which is a different population than a device that reported none.
func reported(value string, usable bool, source string) InputValue {
	if value == "" {
		return InputValue{Source: "missing"}
	}
	return scalar(value, usable, source)
}
func mapValue(values map[string]InputValue, key string) InputValue {
	if value, ok := values[key]; ok {
		return value
	}
	return InputValue{Source: "missing"}
}

// closedVocabulary lists the sources whose value set the contract closes. A
// value outside the set compares unknown, never false: returning false for
// platform equals "ios" on a "windows" host would make the negation of that
// condition a positive match on a platform the Rule was never written for.
var closedVocabulary = map[string][]string{
	"device.platform":      {"ios", "android"},
	"entitlement_state":    {"active", "inactive", "unknown", "provider_unavailable", "failed"},
	"product_availability": {"available", "unavailable", "unknown", "provider_unavailable", "failed"},
	"product_readiness":    {"ready", "not_ready"},
	"provider_capability":  {"available", "unavailable", "unknown"},
}

func compare(kind, operator string, input InputValue, operand *TypedValue) Truth {
	missing := input.Source == "missing" || input.Value == nil
	if operator == "exists" {
		if missing {
			return False
		}
		return True
	}
	if operator == "does_not_exist" {
		if missing {
			return True
		}
		return False
	}
	if missing || !input.Valid || operand == nil {
		return Unknown
	}
	if allowed, closed := closedVocabulary[kind]; closed {
		text, ok := input.Value.(string)
		if !ok || !contains(allowed, text) {
			return Unknown
		}
	}
	left, right := input.Value, operand.Value
	switch operator {
	case "equals", "not_equals":
		if kind == "application.locale" {
			text, ok := right.(string)
			if !ok {
				return Unknown
			}
			normalized, ok := normalizeLocale(text)
			if !ok {
				return Unknown
			}
			right = normalized
		}
		match, known := equalValues(left, right, operand.Type)
		if !known {
			return Unknown
		}
		if operator == "not_equals" {
			match = !match
		}
		return truth(match)
	case "in", "not_in":
		values, ok := asStrings(right)
		if !ok {
			return Unknown
		}
		if kind == "application.locale" {
			// One unusable member makes the whole condition unknown even when
			// another member matches. The list is a single defective authored
			// value, and deciding a Rule on the half that parsed would act on
			// less than its author wrote.
			canonical := make([]string, 0, len(values))
			for _, value := range values {
				normalized, ok := normalizeLocale(value)
				if !ok {
					return Unknown
				}
				canonical = append(canonical, normalized)
			}
			values = canonical
		}
		text, ok := left.(string)
		if !ok {
			return Unknown
		}
		match := contains(values, text)
		if operator == "not_in" {
			match = !match
		}
		return truth(match)
	case "contains_any", "contains_all":
		leftValues, ok1 := asStrings(left)
		rightValues, ok2 := asStrings(right)
		if !ok1 || !ok2 {
			return Unknown
		}
		matches := 0
		for _, value := range rightValues {
			if contains(leftValues, value) {
				matches++
			}
		}
		if operator == "contains_any" {
			return truth(matches > 0)
		}
		return truth(matches == len(rightValues))
	case "locale_matches":
		locale, ok1 := left.(string)
		filter, ok2 := right.(string)
		if !ok1 || !ok2 {
			return Unknown
		}
		return localeMatches(locale, filter)
	case "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal":
		ordering, ok := compareOrdered(left, right, operand.Type)
		if !ok {
			return Unknown
		}
		switch operator {
		case "greater_than":
			return truth(ordering > 0)
		case "greater_than_or_equal":
			return truth(ordering >= 0)
		case "less_than":
			return truth(ordering < 0)
		default:
			return truth(ordering <= 0)
		}
	default:
		return Unknown
	}
}

func truth(value bool) Truth {
	if value {
		return True
	}
	return False
}

func equalValues(left, right any, kind string) (bool, bool) {
	if kind == "number" {
		l, ok1 := number(left)
		r, ok2 := number(right)
		return l == r, ok1 && ok2
	}
	if kind == "string_list" {
		l, ok1 := asStrings(left)
		r, ok2 := asStrings(right)
		if !ok1 || !ok2 || len(l) != len(r) {
			return false, ok1 && ok2
		}
		for index := range l {
			if l[index] != r[index] {
				return false, true
			}
		}
		return true, true
	}
	return fmt.Sprint(left) == fmt.Sprint(right), true
}

func compareOrdered(left, right any, kind string) (int, bool) {
	if kind == "number" {
		l, ok1 := number(left)
		r, ok2 := number(right)
		if !ok1 || !ok2 {
			return 0, false
		}
		if l < r {
			return -1, true
		}
		if l > r {
			return 1, true
		}
		return 0, true
	}
	if kind == "semantic_version" {
		l, ok1 := parseSemver(fmt.Sprint(left))
		r, ok2 := parseSemver(fmt.Sprint(right))
		if !ok1 || !ok2 {
			return 0, false
		}
		return compareSemver(l, r), true
	}
	l, ok1 := left.(string)
	r, ok2 := right.(string)
	if !ok1 || !ok2 {
		return 0, false
	}
	return strings.Compare(l, r), true
}

func number(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}
func asStrings(value any) ([]string, bool) {
	switch typed := value.(type) {
	case []string:
		return typed, true
	case []any:
		result := make([]string, len(typed))
		for i, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			result[i] = text
		}
		return result, true
	default:
		return nil, false
	}
}

func assignmentKey(policy string, context EvaluationContext) (string, string, bool) {
	switch policy {
	case "installation":
		return "installation", context.InstallationID, context.InstallationID != ""
	case "identified_user":
		return "identified_user", context.UserID, context.UserID != ""
	case "identified_user_or_installation":
		if context.UserID != "" {
			return "identified_user", context.UserID, true
		}
		return "installation", context.InstallationID, context.InstallationID != ""
	default:
		return "", "", false
	}
}

func RolloutBucket(projectID, environmentID, placementID, ruleID, keyType, key string) int {
	fields := []string{projectID, environmentID, placementID, ruleID, keyType, key}
	var builder strings.Builder
	builder.WriteString("mosaic-placement-rollout\n1\n")
	for _, field := range fields {
		builder.WriteString(strconv.Itoa(len([]byte(field))))
		builder.WriteByte(':')
		builder.WriteString(field)
		builder.WriteByte('\n')
	}
	hash := sha256.Sum256([]byte(builder.String()))
	return int(binary.BigEndian.Uint64(hash[:8]) % 10000)
}

func resolveFallback(outcome Outcome, fallbacks map[string]Outcome, path *[]string, trace *[]TraceStep) Outcome {
	current := outcome
	for depth := 0; current.Type == "fallback" && depth < 8; depth++ {
		key := current.FallbackKey
		*path = append(*path, key)
		*trace = appendTrace(*trace, TraceStep{Kind: "fallback", FallbackKey: key, OutcomeType: current.Type})
		next, ok := fallbacks[key]
		if !ok {
			return Outcome{Type: "unavailable", ReasonCode: "fallback_missing"}
		}
		current = next
	}
	if current.Type == "fallback" {
		return Outcome{Type: "unavailable", ReasonCode: "fallback_depth_exceeded"}
	}
	return current
}

type semver struct {
	core       [3]uint64
	prerelease []string
}

var semverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:\.(0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

func validSemver(value string) bool { _, ok := parseSemver(value); return ok }
func parseSemver(value string) (semver, bool) {
	match := semverPattern.FindStringSubmatch(value)
	if match == nil {
		return semver{}, false
	}
	var result semver
	for i := 1; i <= 3; i++ {
		if match[i] == "" {
			continue
		}
		parsed, err := strconv.ParseUint(match[i], 10, 64)
		if err != nil {
			return semver{}, false
		}
		result.core[i-1] = parsed
	}
	if match[4] != "" {
		result.prerelease = strings.Split(match[4], ".")
		for _, part := range result.prerelease {
			if len(part) > 1 && part[0] == '0' {
				if _, err := strconv.ParseUint(part, 10, 64); err == nil {
					return semver{}, false
				}
			}
		}
	}
	return result, true
}
func compareSemver(left, right semver) int {
	for i := range left.core {
		if left.core[i] < right.core[i] {
			return -1
		}
		if left.core[i] > right.core[i] {
			return 1
		}
	}
	if len(left.prerelease) == 0 && len(right.prerelease) > 0 {
		return 1
	}
	if len(right.prerelease) == 0 && len(left.prerelease) > 0 {
		return -1
	}
	for i := 0; i < len(left.prerelease) && i < len(right.prerelease); i++ {
		l, le := strconv.ParseUint(left.prerelease[i], 10, 64)
		r, re := strconv.ParseUint(right.prerelease[i], 10, 64)
		if le == nil && re == nil {
			if l < r {
				return -1
			}
			if l > r {
				return 1
			}
		} else if le == nil {
			return -1
		} else if re == nil {
			return 1
		} else if compared := strings.Compare(left.prerelease[i], right.prerelease[i]); compared != 0 {
			return compared
		}
	}
	if len(left.prerelease) < len(right.prerelease) {
		return -1
	}
	if len(left.prerelease) > len(right.prerelease) {
		return 1
	}
	return 0
}

// normalizeLocale reduces a BCP 47 tag to the canonical comparison form shared
// by every Mosaic evaluator.
//
// Only the language-script-region core carries locale identity. A one-character
// subtag opens a BCP 47 extension or private-use sequence (-u-, -t-, -x-), and
// everything from there on is device detail: a host reporting
// "en-US-u-rg-gbzzzz" for a region override reports the same locale as a host
// reporting "en-US". Truncating at the first singleton is what keeps a runtime
// tag from mis-evaluating equals/in/locale_matches against an authored "en-US",
// and it is the same rule every SDK applies at its device- and host-locale
// boundary, so a tag cannot mean one thing at the boundary and another here.
// Empty subtags are dropped for the same reason.
//
// The tag is first cut at '@', '.', or '#', because a host reports an ICU
// identifier rather than a language tag: "en_US@rg=gbzzzz" (keyword),
// "en_US.UTF-8" (POSIX charset), and "en_US_#u-rg-gbzzzz" (Java
// Locale.toString) all denote the locale "en-US". Without the cut the remainder
// fails the subtag grammar and the whole tag evaluates unknown.
func normalizeLocale(value string) (string, bool) {
	rest := strings.TrimSpace(value)
	if cut := strings.IndexAny(rest, "@.#"); cut >= 0 {
		rest = rest[:cut]
	}
	rest = strings.ReplaceAll(rest, "_", "-")
	parts := make([]string, 0, 8)
	for last := false; !last; {
		part := rest
		if index := strings.IndexByte(rest, '-'); index >= 0 {
			part, rest = rest[:index], rest[index+1:]
		} else {
			last = true
		}
		if len(part) == 1 {
			break
		}
		if part == "" {
			continue
		}
		if parts = append(parts, part); len(parts) > 8 {
			return "", false
		}
	}
	if len(parts) == 0 || len(parts[0]) < 2 || len(parts[0]) > 8 || !isLocaleAlpha(parts[0]) {
		return "", false
	}
	for index, part := range parts {
		switch {
		case index == 0:
			parts[index] = strings.ToLower(part)
		case len(part) > 8 || !isLocaleAlphanumeric(part):
			return "", false
		case len(part) == 4 && isLocaleAlpha(part):
			parts[index] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		case len(part) == 2 && isLocaleAlpha(part), len(part) == 3 && isLocaleDigits(part):
			parts[index] = strings.ToUpper(part)
		default:
			parts[index] = strings.ToLower(part)
		}
	}
	return strings.Join(parts, "-"), true
}

func isLocaleAlpha(part string) bool {
	for index := 0; index < len(part); index++ {
		if char := part[index]; !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') {
			return false
		}
	}
	return true
}

func isLocaleDigits(part string) bool {
	for index := 0; index < len(part); index++ {
		if char := part[index]; char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func isLocaleAlphanumeric(part string) bool {
	for index := 0; index < len(part); index++ {
		char := part[index]
		if !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') && !(char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

// localeMatches applies RFC 4647 basic filtering to two canonicalized tags. A
// range that cannot be canonicalized yields Unknown rather than False: False
// would be a claim that the tag does not match, which under a not group would
// turn into a positive match and let a Rule win on an operand the evaluator
// could not read. The range grammar has no "*" wildcard.
func localeMatches(locale, filter string) Truth {
	candidate, candidateOK := normalizeLocale(locale)
	rangeTag, rangeOK := normalizeLocale(filter)
	if !candidateOK || !rangeOK {
		return Unknown
	}
	return truth(candidate == rangeTag || strings.HasPrefix(candidate, rangeTag+"-"))
}

func digest(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }
