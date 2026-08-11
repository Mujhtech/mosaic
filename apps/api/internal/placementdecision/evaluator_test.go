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

// The conformance corpus pins the ruled locale cases end to end, but it
// exercises only a handful of tags. These assert the normalization rules the
// corpus cannot reach: script/region/variant casing, the singleton truncation
// boundary, empty-subtag dropping, the ICU pre-cut on shapes the corpus does not
// carry, and the bounds that still reject a tag outright. Every expectation was
// produced by running protocol/tools/placement-decision-validation-v1.mjs's
// exported normalizeLocale over these same inputs and diffing, not by reading
// the Go implementation back.
func TestNormalizeLocaleFollowsProtocolRules(t *testing.T) {
	for _, testCase := range []struct{ input, want string }{
		{"en-US-u-rg-gbzzzz", "en-US"}, // extension subtags are device detail, not identity
		{"pt-BR-u-nu-latn", "pt-BR"},
		{"de_DE-x-corp", "de-DE"},    // private use truncates, underscores become hyphens
		{"en--US", "en-US"},          // empty subtags are dropped, not rejected
		{"  en_us  ", "en-US"},       // trimmed, region uppercased
		{"zh-hans-cn", "zh-Hans-CN"}, // script is title case
		{"es-419", "es-419"},         // numeric region stays as authored
		{"en-1234-US", "en-1234-US"}, // a 4-char non-alpha subtag is not a script
		{"en-US-POSIX", "en-US-posix"},
		{"ja_JP.eucJP", "ja-JP"},           // POSIX charset suffix is cut
		{"en_US.UTF-8@euro", "en-US"},      // cut takes the first of '.' and '@'
		{"en.US@x", "en"},                  // the cut precedes the subtag scan
		{"POSIX", "posix"},                 // a bare language is still a tag
		{"C", ""},                          // the C locale is one character, so nothing survives
		{"x-private", ""},                  // a leading singleton leaves no language
		{"@en-US", ""},                     // a leading cut character leaves nothing
		{"!!not-a-locale", ""},             // pinned present-but-unusable by the corpus
		{"en-AA-BB-CC-DD-EE-FF-GG-HH", ""}, // the range the corpus uses for unknown locale_matches
		{"", ""},
		{"1en-US", ""},                     // language must be alphabetic
		{"en-US!", ""},                     // non-alphanumeric subtag
		{"verylongl-US", ""},               // language exceeds eight characters
		{"en-verylongsubtag", ""},          // targeting does not recover the language subtag
		{"aa-bb-cc-dd-ee-ff-gg-hh-ii", ""}, // more than eight subtags
		{"aa-bb-cc-dd-ee-ff-gg-hh", "aa-BB-CC-DD-EE-FF-GG-HH"}, // exactly eight is allowed
	} {
		t.Run(testCase.input, func(t *testing.T) {
			got, ok := normalizeLocale(testCase.input)
			if ok != (testCase.want != "") {
				t.Fatalf("normalizeLocale(%q) ok = %v, want %v", testCase.input, ok, testCase.want != "")
			}
			if got != testCase.want {
				t.Fatalf("normalizeLocale(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
}

// The corpus pins the closed-vocabulary rule for device.platform under both a
// direct and a negated condition, but platform is the only one of the five
// closed sources it reaches. These assert that the other four are actually
// registered, since a missing map entry would silently restore "unknown means
// false" for provider-sourced values, where a not_equals is a positive match.
func TestOutOfSetClosedVocabularyComparesUnknown(t *testing.T) {
	for kind, outOfSet := range map[string]string{
		"entitlement_state":    "cancelled",
		"product_availability": "pending",
		"product_readiness":    "partially_ready",
		"provider_capability":  "degraded",
	} {
		t.Run(kind, func(t *testing.T) {
			input := InputValue{Value: outOfSet, Valid: true, Source: "provider_observation"}
			for _, operator := range []string{"equals", "not_equals"} {
				if result := compare(kind, operator, input, &TypedValue{Type: "string", Value: "active"}); result != Unknown {
					t.Fatalf("%s %s on out-of-set %q = %q, want %q", kind, operator, outOfSet, result, Unknown)
				}
			}
			if result := compare(kind, "exists", input, nil); result != True {
				t.Fatalf("%s exists on out-of-set %q = %q, want %q", kind, outOfSet, result, True)
			}
		})
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
