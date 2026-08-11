package hostedpublishing

import (
	"path/filepath"
	"testing"
)

const protocolFixtureRoot04 = "../../../../protocol/fixtures/v0.4"

// The 0.4 corpus is the contract the dispatch mirrors. Accepting every valid
// fixture is what proves dispatching on schemaVersion actually reaches the 0.4
// schema and the 0.4 semantic layer: a document validated against the 0.3
// schema fails on designSystem.motions, and one validated against 0.3 semantics
// fails capability reconciliation on style.productCardStates and motion.*.
// Rejecting every invalid fixture is what proves the carried 0.3 rules did not
// stop running when the version changed.
func TestCanonicalProtocolV04SchemaAndSemanticFixtures(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	for _, name := range []string{"navigation-only.json", "edge-cases.json", "expired-countdown.json", "hidden-purchase-target.json", "complete-paywall.json"} {
		t.Run("accepts_"+name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, name))
			if errors := validator.Validate(root); len(errors) != 0 {
				t.Fatalf("canonical valid 0.4 fixture rejected: %v", errors)
			}
		})
	}

	// Driven by the manifest rather than a glob, and its size asserted, for the
	// same reason as the 0.3 corpus: a corpus emptied or renamed out from under
	// a glob otherwise reports success over zero cases.
	layers := readRejectionLayersIn(t, protocolFixtureRoot04)
	if len(layers) != 19 {
		t.Fatalf("expected 19 registered invalid 0.4 fixtures, found %d", len(layers))
	}
	for _, name := range layers {
		t.Run("rejects_"+name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "invalid", name))
			if errors := validator.Validate(root); len(errors) == 0 {
				t.Fatal("canonical invalid 0.4 fixture passed schema and semantic validation")
			}
		})
	}
}

// Every 0.4 semantic rule with no 0.3 analogue is pinned to its named
// diagnostic. The corpus test above only proves each fixture is rejected; these
// prove it is rejected for the intended reason, so a fixture that starts
// failing for an unrelated edit cannot mask a motion rule that stopped firing.
func TestProtocolV04MotionRulesReportNamedDiagnostics(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	for name, diagnostic := range map[string]string{
		"nested-appear-motion.json":          "protocol_motion_appear_nested",
		"two-loops-on-one-screen.json":       "protocol_motion_loop_duplicate",
		"loop-motion-below-flash-floor.json": "protocol_motion_loop_duration_invalid",
		"unknown-motion-token.json":          "protocol_motion_token_unknown",
		"unused-motion-token.json":           "protocol_motion_token_unused",
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

// A cyclic motion token has no fixture, and the rule that catches it is load
// bearing beyond tidiness: an unresolvable curve makes the flash-safety floor
// check skip silently, so a cycle that went unreported would deliver a pulse
// whose rate was never checked against the 500ms floor. Both halves are
// asserted together - the cycle is named, and the floor's silence is shown to
// be covered rather than merely absent.
func TestProtocolV04CyclicMotionTokenIsRejectedRatherThanSkippingTheFlashFloor(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)
	root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
	for _, raw := range arrayValue(mapValue(root["designSystem"])["motions"]) {
		token := mapValue(raw)
		if stringValue(token["id"]) == "motion-pulse" {
			token["value"] = map[string]any{"type": "motionToken", "id": "motion-pulse"}
		}
	}
	errors := validator.Validate(root)
	if !containsString(errors, "protocol_motion_token_cycle") {
		t.Fatalf("expected protocol_motion_token_cycle, got %v", errors)
	}
	if containsString(errors, "protocol_motion_loop_duration_invalid") {
		t.Fatal("an unresolvable curve must not also report a floor verdict about a duration nobody authored")
	}
}

// Unused-token detection is transitive reachability rooted at node reference
// sites: a token counted as used merely because another *unused* token aliased
// it survives a redesign looking approved, which is the exact gap the unused
// rule exists to close. The mutation adds an alias of the fixture's orphan that
// nothing references; both the alias and the orphan must be reported, where the
// earlier catalog-seeded implementation reported only the alias. Mirrors the
// reachability correction in protocol/tools/validation-v0.4.mjs; reconcile with
// its unused-token-transitive fixture once that fixture lands.
func TestProtocolV04UnusedMotionTokenReachabilityIsRootedAtNodeReferences(t *testing.T) {
	root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "invalid", "unused-motion-token.json"))
	design := mapValue(root["designSystem"])
	design["motions"] = append(arrayValue(design["motions"]), map[string]any{
		"id": "motion-orphan-alias", "name": "Orphan alias",
		"value": map[string]any{"type": "motionToken", "id": "motion-orphan"},
	})
	unused := 0
	for _, code := range validateProtocolMotionTokens(root, walkProtocolNodes(root)) {
		if code == "protocol_motion_token_unused" {
			unused++
		}
	}
	if unused != 2 {
		t.Fatalf("an unused alias chain must report both links unused, got %d unused-token errors", unused)
	}
}

// Capability derivation is what a Release advertises to an SDK. The two 0.4
// deltas are asserted from the canonical document, which reconciles exactly in
// both directions: the three motion.* names must be derived, and
// style.productCardStates must not be - a 0.4 document declaring the removed
// capability is rejected as unused, and one omitting a motion capability it
// authors is rejected as missing.
func TestProtocolV04CapabilityDerivationAddsMotionAndDropsProductCardStates(t *testing.T) {
	root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
	entries := walkProtocolNodes(root)
	if errors := validateProtocolCapabilities(root, entries, ProtocolVersion04); len(errors) != 0 {
		t.Fatalf("canonical 0.4 fixture capability reconciliation failed: %v", errors)
	}
	declared := map[string]bool{}
	for _, raw := range arrayValue(mapValue(root["compatibility"])["requiredCapabilities"]) {
		capability := mapValue(raw)
		if stringValue(capability["version"]) != ProtocolVersion04 {
			t.Fatalf("capability %s is not pinned to %s", stringValue(capability["name"]), ProtocolVersion04)
		}
		declared[stringValue(capability["name"])] = true
	}
	for _, name := range []string{"motion.appear", "motion.selection", "motion.loop"} {
		if !declared[name] {
			t.Fatalf("canonical 0.4 fixture does not declare %s, so reconciliation could not have checked it", name)
		}
	}
	if declared["style.productCardStates"] {
		t.Fatal("0.4 removed style.productCardStates; the canonical fixture must not declare it")
	}

	t.Run("declaring_the_removed_capability_is_rejected", func(t *testing.T) {
		mutated := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
		compatibility := mapValue(mutated["compatibility"])
		compatibility["requiredCapabilities"] = append(arrayValue(compatibility["requiredCapabilities"]),
			map[string]any{"name": "style.productCardStates", "version": ProtocolVersion04})
		errors := validateProtocolCapabilities(mutated, walkProtocolNodes(mutated), ProtocolVersion04)
		if !containsString(errors, "protocol_capability_unused_or_unsupported") {
			t.Fatalf("expected the removed capability to be rejected as unused, got %v", errors)
		}
	})

	t.Run("omitting_an_authored_motion_capability_is_rejected", func(t *testing.T) {
		mutated := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
		compatibility := mapValue(mutated["compatibility"])
		kept := make([]any, 0)
		for _, raw := range arrayValue(compatibility["requiredCapabilities"]) {
			if stringValue(mapValue(raw)["name"]) != "motion.loop" {
				kept = append(kept, raw)
			}
		}
		compatibility["requiredCapabilities"] = kept
		errors := validateProtocolCapabilities(mutated, walkProtocolNodes(mutated), ProtocolVersion04)
		if !containsString(errors, "protocol_capability_missing") {
			t.Fatalf("expected an authored but undeclared motion capability to be rejected, got %v", errors)
		}
	})
}

// Versions are exact identifiers. A 0.4 document must not be validated against
// the 0.3 rules and vice versa: a 0.3 document silently accepted as 0.4 would
// be advertised to readers under a contract it was never checked against.
func TestProtocolValidatorDispatchesOnDeclaredVersion(t *testing.T) {
	validator := newCanonicalProtocolValidator(t)

	t.Run("a_0.3_document_relabelled_0.4_is_rejected", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot, "complete-paywall.json"))
		root["schemaVersion"] = ProtocolVersion04
		if errors := validator.Validate(root); len(errors) == 0 {
			t.Fatal("a 0.3 document must not validate as 0.4")
		}
	})

	t.Run("a_0.4_document_relabelled_0.3_is_rejected", func(t *testing.T) {
		root := readProtocolFixture(t, filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
		root["schemaVersion"] = ProtocolVersion
		if errors := validator.Validate(root); len(errors) == 0 {
			t.Fatal("a 0.4 document must not validate as 0.3")
		}
	})
}
