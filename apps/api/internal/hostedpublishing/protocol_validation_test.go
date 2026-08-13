package hostedpublishing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func newCanonicalProtocolValidator(t *testing.T) *ProtocolValidator {
	t.Helper()
	schemaFile, err := os.Open("../../../../protocol/schema/v0.4/paywall.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	validator, err := CompileProtocolValidator(schemaFile)
	_ = schemaFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	return validator
}

// There is exactly one Paywall Protocol version (ADR-0028). A document
// claiming the deleted 0.3, the superseded 0.2, or any unknown version must be
// refused atomically with the one named diagnostic — not degraded, not
// reported as a generic schema failure. The deleted-version case is the load
// bearing one: 0.3 documents existed, and their rejection path must be
// identical to a version that never did.
func TestProtocolValidatorRejectsDeletedAndUnknownVersions(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	for _, version := range []string{"0.3", "0.2", "1.0", ""} {
		t.Run("version_"+version, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
			if version == "" {
				delete(root, "schemaVersion")
			} else {
				root["schemaVersion"] = version
			}
			errors := validator.Validate(root)
			if len(errors) != 1 || errors[0] != "protocol_version_unsupported" {
				t.Fatalf("expected a sole protocol_version_unsupported diagnostic, got %v", errors)
			}
		})
	}
}

// The carried-forward semantic rules are pinned to their named diagnostics.
// The corpus test only proves each fixture is rejected; these prove it is
// rejected for the intended reason, so a fixture that starts failing for an
// unrelated edit cannot mask a missing rule.
func TestProtocolSemanticRulesReportNamedDiagnostics(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	for name, diagnostic := range map[string]string{
		"unknown-tab-visibility.json":       "protocol_tab_visibility_invalid",
		"timeline-unused-marker-style.json": "protocol_timeline_style_copresence_invalid",
		"social-proof-overrated.json":       "protocol_social_proof_rating_invalid",
	} {
		t.Run(name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "invalid", name))
			errors := validator.Validate(root)
			if !containsString(errors, diagnostic) {
				t.Fatalf("expected %s, got %v", diagnostic, errors)
			}
		})
	}
}

// Reserved accessibility keys are the one localization class no component
// references, so the ordinary "unused key" and "missing key" sweeps cannot see
// them. Each direction is mutated out of the canonical document here. Absent
// this, a renderer would be free to compose an accessibility phrase from a
// hardcoded English string.
func TestReservedAccessibilityKeyRulesHoldInBothDirections(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	defaultStrings := func(root map[string]any) map[string]any {
		localization := mapValue(root["localization"])
		locale := mapValue(localization["locales"])[stringValue(localization["defaultLocale"])]
		return mapValue(mapValue(locale)["strings"])
	}

	t.Run("declared_but_nothing_announces_it", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "navigation-only.json"))
		defaultStrings(root)["mosaic.a11y.rating"] = "Rated {{ rating.value }} of {{ rating.maximum }}"
		if errors := validator.Validate(root); !containsString(errors, "protocol_reserved_accessibility_key_invalid") {
			t.Fatalf("a reserved phrase nothing announces must be rejected, got %v", errors)
		}
	})

	t.Run("announced_but_not_declared", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
		delete(defaultStrings(root), "mosaic.a11y.rating")
		if errors := validator.Validate(root); !containsString(errors, "protocol_reserved_accessibility_key_invalid") {
			t.Fatalf("a rating with no authored announcement must be rejected, got %v", errors)
		}
	})

	// A translation that drops the placeholder announces a rating with no
	// number in it, which reads as correct to everyone who cannot hear it.
	t.Run("translation_drops_placeholder", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
		defaultStrings(root)["mosaic.a11y.rating"] = "Rated {{ rating.maximum }} stars"
		if errors := validator.Validate(root); !containsString(errors, "protocol_reserved_accessibility_placeholder_invalid") {
			t.Fatalf("a dropped reserved placeholder must be rejected, got %v", errors)
		}
	})
}

func readRejectionLayersIn(t *testing.T, root string) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "invalid", "rejection-layers.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Layers map[string]string `json:"layers"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(manifest.Layers))
	for name := range manifest.Layers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func readProtocolFixture(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	return root
}
