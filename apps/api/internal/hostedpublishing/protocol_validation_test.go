package hostedpublishing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

const protocolFixtureRoot = "../../../../protocol/fixtures/v0.3"

func newCanonicalProtocolValidator(t *testing.T) *ProtocolValidator {
	t.Helper()
	schemaFile, err := os.Open("../../../../protocol/schema/v0.3/paywall.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	schemaFile04, err := os.Open("../../../../protocol/schema/v0.4/paywall.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	validator, err := CompileProtocolValidator(schemaFile, schemaFile04)
	_ = schemaFile.Close()
	_ = schemaFile04.Close()
	if err != nil {
		t.Fatal(err)
	}
	return validator
}

// The canonical corpus is the contract this validator mirrors: every valid
// fixture must be accepted and every invalid one rejected. complete-paywall.json
// exercises all four Protocol 0.3 components, so accepting it is what proves the
// tabs/timeline/award/socialProof rules do not reject a well-formed document.
func TestCanonicalProtocolV03SchemaAndSemanticFixtures(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	for _, name := range []string{"navigation-only.json", "edge-cases.json", "expired-countdown.json", "hidden-purchase-target.json", "complete-paywall.json"} {
		t.Run("accepts_"+name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, name))
			if errors := validator.Validate(root); len(errors) != 0 {
				t.Fatalf("canonical valid fixture rejected: %v", errors)
			}
		})
	}

	// The invalid corpus is driven by its own manifest rather than a glob, and
	// the manifest's size is asserted: a corpus that is emptied or renamed out
	// from under a glob otherwise reports success over zero cases.
	layers := readRejectionLayers(t)
	if len(layers) != 12 {
		t.Fatalf("expected 12 registered invalid fixtures, found %d", len(layers))
	}
	for _, name := range layers {
		t.Run("rejects_"+name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "invalid", name))
			if errors := validator.Validate(root); len(errors) == 0 {
				t.Fatal("canonical invalid fixture passed schema and semantic validation")
			}
		})
	}
}

// The three Protocol 0.3 semantic rules with no 0.2 analogue are pinned to their
// named diagnostics. The corpus test above only proves each fixture is rejected;
// these prove it is rejected for the intended reason, so a fixture that starts
// failing for an unrelated edit cannot mask a missing rule.
func TestProtocolV03SemanticRulesReportNamedDiagnostics(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	for name, diagnostic := range map[string]string{
		"unknown-tab-visibility.json":       "protocol_tab_visibility_invalid",
		"timeline-unused-marker-style.json": "protocol_timeline_style_copresence_invalid",
		"social-proof-overrated.json":       "protocol_social_proof_rating_invalid",
	} {
		t.Run(name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "invalid", name))
			errors := validator.Validate(root)
			if !containsString(errors, diagnostic) {
				t.Fatalf("expected %s, got %v", diagnostic, errors)
			}
		})
	}
}

// Protocol 0.3 replaced 0.2 outright. A 0.2 document is an unknown version and
// must be refused with a named diagnostic rather than degraded into a partial
// accept or reported as a generic schema failure.
func TestProtocolValidatorRejectsSupersededVersion(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "complete-paywall.json"))
	root["schemaVersion"] = "0.2"
	errors := validator.Validate(root)
	if len(errors) != 1 || errors[0] != "protocol_version_unsupported" {
		t.Fatalf("expected a sole protocol_version_unsupported diagnostic, got %v", errors)
	}
}

// Capability derivation is what a Release advertises to an SDK, so a document
// that uses a 0.3 feature without deriving its capability would be served to a
// renderer that cannot draw it. Reconciliation is exact in both directions, so
// asserting the canonical document declares the five new names and reconciles
// cleanly is what pins derivation to emit them.
func TestProtocolCapabilityDerivationCoversNewFeatures(t *testing.T) {
	root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "complete-paywall.json"))
	entries := walkProtocolNodes(root)
	if errors := validateProtocolCapabilities(root, entries, ProtocolVersion); len(errors) != 0 {
		t.Fatalf("canonical fixture capability reconciliation failed: %v", errors)
	}
	declared := map[string]bool{}
	for _, raw := range arrayValue(mapValue(root["compatibility"])["requiredCapabilities"]) {
		capability := mapValue(raw)
		if stringValue(capability["version"]) != ProtocolVersion {
			t.Fatalf("capability %s is not pinned to %s", stringValue(capability["name"]), ProtocolVersion)
		}
		declared[stringValue(capability["name"])] = true
	}
	for _, name := range []string{
		"component.tabs", "component.timeline", "component.award",
		"component.socialProof", "condition.tabVisibility",
		"accessibility.reservedStrings",
	} {
		if !declared[name] {
			t.Fatalf("canonical fixture does not declare %s, so reconciliation could not have checked it", name)
		}
	}
}

// Reserved accessibility keys are the one localization class no component
// references, so the ordinary "unused key" and "missing key" sweeps cannot see
// them. There is no invalid fixture for these rules yet, and an unfixtured rule
// is exactly the kind that silently stops firing, so each direction is mutated
// out of the canonical document here. Absent this, a renderer would be free to
// compose an accessibility phrase from a hardcoded English string.
func TestReservedAccessibilityKeyRulesHoldInBothDirections(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	defaultStrings := func(root map[string]any) map[string]any {
		localization := mapValue(root["localization"])
		locale := mapValue(localization["locales"])[stringValue(localization["defaultLocale"])]
		return mapValue(mapValue(locale)["strings"])
	}

	t.Run("declared_but_nothing_announces_it", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "navigation-only.json"))
		defaultStrings(root)["mosaic.a11y.rating"] = "Rated {{ rating.value }} of {{ rating.maximum }}"
		if errors := validator.Validate(root); !containsString(errors, "protocol_reserved_accessibility_key_invalid") {
			t.Fatalf("a reserved phrase nothing announces must be rejected, got %v", errors)
		}
	})

	t.Run("announced_but_not_declared", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "complete-paywall.json"))
		delete(defaultStrings(root), "mosaic.a11y.rating")
		if errors := validator.Validate(root); !containsString(errors, "protocol_reserved_accessibility_key_invalid") {
			t.Fatalf("a rating with no authored announcement must be rejected, got %v", errors)
		}
	})

	// A translation that drops the placeholder announces a rating with no
	// number in it, which reads as correct to everyone who cannot hear it.
	t.Run("translation_drops_placeholder", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "complete-paywall.json"))
		defaultStrings(root)["mosaic.a11y.rating"] = "Rated {{ rating.maximum }} stars"
		if errors := validator.Validate(root); !containsString(errors, "protocol_reserved_accessibility_placeholder_invalid") {
			t.Fatalf("a dropped reserved placeholder must be rejected, got %v", errors)
		}
	})
}

func readRejectionLayers(t *testing.T) []string {
	t.Helper()
	return readRejectionLayersIn(t, protocolFixtureRoot)
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
