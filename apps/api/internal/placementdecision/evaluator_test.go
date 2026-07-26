package placementdecision

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

type fixtureCorpus struct {
	Decision json.RawMessage `json:"decision"`
	Cases    []struct {
		Name    string `json:"name"`
		Context struct {
			Platform           string                `json:"platform"`
			ApplicationLocale  string                `json:"applicationLocale"`
			ApplicationVersion string                `json:"applicationVersion"`
			Country            string                `json:"country"`
			Attributes         map[string]TypedValue `json:"attributes"`
			Entitlements       map[string]string     `json:"entitlements"`
			Products           map[string]string     `json:"products"`
		} `json:"context"`
		Assignment struct {
			Type  string `json:"type"`
			Value string `json:"value"`
		} `json:"assignment"`
		Expected struct {
			MatchedRuleID *string  `json:"matchedRuleId"`
			RolloutBucket *int     `json:"rolloutBucket"`
			FallbackPath  []string `json:"fallbackPath"`
			Outcome       Outcome  `json:"outcome"`
		} `json:"expected"`
	} `json:"cases"`
}

func TestEvaluatorMatchesCanonicalCorpus(t *testing.T) {
	bytes, err := os.ReadFile("../../../../protocol/fixtures/placement-decision/v1/evaluator-conformance.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus fixtureCorpus
	if err := json.Unmarshal(bytes, &corpus); err != nil {
		t.Fatal(err)
	}
	document, _, _, err := Canonicalize(corpus.Decision)
	if err != nil {
		t.Fatal(err)
	}
	for _, testCase := range corpus.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			context := EvaluationContext{ProjectID: document.ProjectID, EnvironmentID: document.EnvironmentID, EnvironmentKey: document.EnvironmentKey, PlacementID: document.PlacementID, Platform: testCase.Context.Platform, ApplicationVersion: testCase.Context.ApplicationVersion, Locale: testCase.Context.ApplicationLocale, Country: testCase.Context.Country, InstallationID: testCase.Assignment.Value, Attributes: map[string]InputValue{}, Entitlements: map[string]InputValue{}, ProductAvailability: map[string]InputValue{}, EvaluationTime: time.Unix(0, 0).UTC()}
			for key, value := range testCase.Context.Attributes {
				context.Attributes[key] = InputValue{Value: value.Value, Valid: true, Source: "host_application"}
			}
			for key, value := range testCase.Context.Entitlements {
				context.Entitlements[key] = InputValue{Value: value, Valid: true, Source: "provider_observation"}
			}
			for key, value := range testCase.Context.Products {
				context.ProductAvailability[key] = InputValue{Value: value, Valid: true, Source: "commerce_snapshot"}
			}
			result := Evaluate(document, context)
			expectedRule := ""
			if testCase.Expected.MatchedRuleID != nil {
				expectedRule = *testCase.Expected.MatchedRuleID
			}
			if result.WinningRuleID != expectedRule {
				t.Fatalf("winning rule = %q, want %q", result.WinningRuleID, expectedRule)
			}
			if testCase.Expected.RolloutBucket != nil && (result.RolloutBucket == nil || *result.RolloutBucket != *testCase.Expected.RolloutBucket) {
				t.Fatalf("bucket = %v, want %d", result.RolloutBucket, *testCase.Expected.RolloutBucket)
			}
			if result.FinalOutcome != testCase.Expected.Outcome {
				t.Fatalf("outcome = %#v, want %#v", result.FinalOutcome, testCase.Expected.Outcome)
			}
			if len(result.FallbackPath) != len(testCase.Expected.FallbackPath) {
				t.Fatalf("fallback path = %v, want %v", result.FallbackPath, testCase.Expected.FallbackPath)
			}
		})
	}
}

func TestValidationRejectsUnsupportedOperatorAndDuplicatePriority(t *testing.T) {
	document := Document{RuleSetID: "ruleset_1", Version: 1, ProjectID: "project_1", EnvironmentID: "environment_1", EnvironmentKey: "production", PlacementID: "placement_1", PlacementKey: "export_pdf", Enabled: true, AssignmentPolicy: "installation", Fallbacks: []Fallback{}, DefaultOutcome: Outcome{Type: "no_paywall"}, Rules: []Rule{
		{ID: "rule_1", Priority: 10, Enabled: true, Condition: Condition{Type: "condition", Source: Source{Kind: "device.platform"}, Operator: "matches_regex", Value: &TypedValue{Type: "string", Value: "ios"}}, Outcome: Outcome{Type: "no_paywall"}},
		{ID: "rule_2", Priority: 10, Enabled: true, Condition: Condition{Type: "condition", Source: Source{Kind: "device.platform"}, Operator: "equals", Value: &TypedValue{Type: "string", Value: "android"}}, Outcome: Outcome{Type: "no_paywall"}},
	}}
	result := Validate(document, nil)
	if result.Valid {
		t.Fatal("invalid rule set reported valid")
	}
	codes := map[string]bool{}
	for _, issue := range result.Issues {
		codes[issue.Code] = true
	}
	if !codes["unsupported_operator"] || !codes["duplicate_rule_priority"] {
		t.Fatalf("issues = %#v", result.Issues)
	}
}

func TestSensitiveTraceRedactsValues(t *testing.T) {
	document := Document{AssignmentPolicy: "installation", DefaultOutcome: Outcome{Type: "no_paywall"}, Fallbacks: []Fallback{}, Rules: []Rule{{ID: "rule_sensitive", Priority: 1, Enabled: true, Condition: Condition{Type: "condition", Source: Source{Kind: "user_attribute", Key: "segment"}, Operator: "equals", Value: &TypedValue{Type: "string", Value: "vip"}}, Outcome: Outcome{Type: "no_paywall"}}}}
	result := Evaluate(document, EvaluationContext{Attributes: map[string]InputValue{"segment": {Value: "vip", Valid: true, Source: "host_application", Sensitive: true}}})
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" || containsText(string(encoded), "vip") {
		t.Fatalf("trace leaked sensitive value: %s", encoded)
	}
	if len(result.Trace) == 0 || !result.Trace[0].Redacted {
		t.Fatalf("trace did not mark sensitive input redacted: %#v", result.Trace)
	}
}

func containsText(value, candidate string) bool {
	for index := 0; index+len(candidate) <= len(value); index++ {
		if value[index:index+len(candidate)] == candidate {
			return true
		}
	}
	return false
}
