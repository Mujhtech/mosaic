package hostedpublishing

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// releaseCarryingCanonicalV04Document publishes the canonical 0.4 fixture into a
// Delivery v1 envelope, so negotiation is exercised against the capability list
// the publish path actually derives rather than a hand-written one.
func releaseCarryingCanonicalV04Document(t *testing.T) (Release, []SDKCapability) {
	t.Helper()
	document, err := os.ReadFile(filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
	if err != nil {
		t.Fatal(err)
	}
	payload, _, err := buildDeliveryPayload(
		"configuration_release_1", 1, Environment{ID: "environment_1", Key: "staging"}, time.Now().UTC(),
		[]ReleasePlacement{{PlacementKey: "onboarding", PaywallVersionID: "version_1"}},
		map[string]PaywallVersion{"version_1": {
			ID: "version_1", PaywallID: "complete-paywall", ProtocolVersion: ProtocolVersion04, Document: document,
		}},
		map[string]Product{}, map[string]Asset{},
	)
	if err != nil {
		t.Fatal(err)
	}
	var envelope deliveryEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	protocols := envelope.Release.Compatibility.PaywallProtocols
	if len(protocols) != 1 || protocols[0].Version != ProtocolVersion04 {
		t.Fatalf("a Release carrying a 0.4 document must advertise a 0.4 compatibility entry, got %#v", protocols)
	}
	capabilities := make([]SDKCapability, 0, len(protocols[0].RequiredCapabilities))
	for _, capability := range protocols[0].RequiredCapabilities {
		capabilities = append(capabilities, SDKCapability{Name: capability.Name, Version: capability.Version})
	}
	return Release{DeliveryContractVersion: DeliveryVersion, Payload: payload}, capabilities
}

func v04CapabilityRequest(capabilities []SDKCapability) SDKCapabilityRequest {
	return SDKCapabilityRequest{
		Platform: "ios", SDKVersion: "1.0.0", ApplicationVersion: "1.0.0",
		SupportedConfigurationDeliveryVersions: []string{"1"},
		SupportedPaywallProtocols:              []SDKPaywallProtocolSupport{{Version: ProtocolVersion04, Capabilities: capabilities}},
	}
}

func withoutCapabilityPrefix(capabilities []SDKCapability, prefix string) []SDKCapability {
	kept := make([]SDKCapability, 0, len(capabilities))
	for _, capability := range capabilities {
		if len(capability.Name) >= len(prefix) && capability.Name[:len(prefix)] == prefix {
			continue
		}
		kept = append(kept, capability)
	}
	return kept
}

// The enhancement tier is the one behaviour 0.4 adds to negotiation, and it is
// the only place in Mosaic where a required capability the SDK cannot render
// does not refuse the Release. A reader that cannot animate must still receive
// the document and render it statically; the terminal-state rule makes that the
// full authored design. The counter-case is asserted in the same test because
// the tier is only safe if it is narrow: a missing component capability must
// still reject, or "degrade gracefully" would have quietly become "render a
// paywall with pieces missing".
func TestV04MotionCapabilitiesDegradeWhileComponentCapabilitiesStillReject(t *testing.T) {
	release, capabilities := releaseCarryingCanonicalV04Document(t)

	if err := ValidateSDKCapabilityRequest(v04CapabilityRequest(capabilities), release); err != nil {
		t.Fatalf("a fully capable 0.4 reader was refused: %v", err)
	}

	t.Run("missing_motion_capabilities_still_deliver", func(t *testing.T) {
		withoutMotion := withoutCapabilityPrefix(capabilities, "motion.")
		if len(withoutMotion) == len(capabilities) {
			t.Fatal("the canonical 0.4 Release advertises no motion capability, so the tier is untested")
		}
		if err := ValidateSDKCapabilityRequest(v04CapabilityRequest(withoutMotion), release); err != nil {
			t.Fatalf("a reader missing motion.* must receive the Release and degrade, got %v", err)
		}
	})

	t.Run("missing_component_capability_rejects", func(t *testing.T) {
		withoutText := withoutCapabilityPrefix(capabilities, "component.text")
		if len(withoutText) == len(capabilities) {
			t.Fatal("the canonical 0.4 Release does not require component.text, so the counter-case is untested")
		}
		err := ValidateSDKCapabilityRequest(v04CapabilityRequest(withoutText), release)
		if !errors.Is(err, ErrUnsupportedCapability) {
			t.Fatalf("a reader missing component.text must be refused, got %v", err)
		}
		failure, ok := CapabilityFailure(err)
		if !ok || failure.Name != "component.text" || failure.Reason != CapabilityMissing {
			t.Fatalf("refusal must name the capability that failed, got %#v", failure)
		}
	})
}

// The fallback tier is read from the embedded 0.4 compatibility manifest rather
// than a list in this package, so the two cannot disagree. Asserting the exact
// partition here is what keeps a manifest edit from silently widening the
// no-reject tier past motion: renderWithoutMotion is deliberately named for
// motion so it cannot spread by imitation.
func TestV04FallbackTierIsExactlyTheThreeMotionCapabilities(t *testing.T) {
	degrading := make([]string, 0)
	for name, fallback := range protocolCapabilityFallbacks[ProtocolVersion04] {
		if fallback == capabilityFallbackRenderWithoutMotion {
			degrading = append(degrading, name)
		} else if fallback != "rejectDocument" {
			t.Fatalf("capability %s declares fallback %q; only rejectDocument and %s are permitted", name, fallback, capabilityFallbackRenderWithoutMotion)
		}
	}
	if len(degrading) != 3 {
		t.Fatalf("expected exactly 3 enhancement capabilities, found %v", degrading)
	}
	for _, name := range []string{"motion.appear", "motion.selection", "motion.loop"} {
		if protocolCapabilityFallbacks[ProtocolVersion04][name] != capabilityFallbackRenderWithoutMotion {
			t.Fatalf("%s must carry the %s fallback", name, capabilityFallbackRenderWithoutMotion)
		}
	}
	// 0.4 removed it; a reader advertising it is advertising a name 0.4 does
	// not define.
	if _, present := protocolCapabilityFallbacks[ProtocolVersion04]["style.productCardStates"]; present {
		t.Fatal("the 0.4 manifest must not carry style.productCardStates")
	}
}

// Regression: the capability vocabulary was hand-maintained in this package and
// had fallen six names behind Protocol 0.3, so a conformant SDK advertising
// component.tabs, component.timeline, component.award, component.socialProof,
// condition.tabVisibility, or accessibility.reservedStrings was refused every
// Release as advertising a capability Mosaic does not define - the four
// components 0.3 added among them. Reconciling against the published manifests
// is what makes the drift impossible rather than merely corrected.
func TestPaywallCapabilityVocabularyMatchesThePublishedManifests(t *testing.T) {
	for _, version := range []string{ProtocolVersion, ProtocolVersion04} {
		t.Run(version, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join("../../../../protocol/fixtures/v"+version, "complete-paywall.json"))
			declared := arrayValue(mapValue(root["compatibility"])["requiredCapabilities"])
			if len(declared) == 0 {
				t.Fatal("the canonical fixture declares no capabilities, so the vocabulary is untested")
			}
			for _, raw := range declared {
				name := stringValue(mapValue(raw)["name"])
				if !knownPaywallCapability(version, name) {
					t.Fatalf("the canonical %s document requires %s, but negotiation does not define it", version, name)
				}
			}
		})
	}
}

// Until publishing emits a derived 0.3 representation, a 0.4 Release must not
// reach a 0.3-only reader at all. Acceptance is atomic and versions are exact
// identifiers, so the refusal comes from the ordinary rejectDocument flow. This
// pins that it is a refusal and not a silent partial delivery - the failure
// mode a projection is meant to remove, and the one thing that must hold while
// the projection does not exist.
func TestV04ReleaseIsRefusedToAProtocol03OnlyReader(t *testing.T) {
	release, capabilities := releaseCarryingCanonicalV04Document(t)
	downgraded := make([]SDKCapability, 0, len(capabilities))
	for _, capability := range withoutCapabilityPrefix(capabilities, "motion.") {
		downgraded = append(downgraded, SDKCapability{Name: capability.Name, Version: ProtocolVersion})
	}
	request := SDKCapabilityRequest{
		Platform: "ios", SDKVersion: "1.0.0", ApplicationVersion: "1.0.0",
		SupportedConfigurationDeliveryVersions: []string{"1"},
		SupportedPaywallProtocols:              []SDKPaywallProtocolSupport{{Version: ProtocolVersion, Capabilities: downgraded}},
	}
	err := ValidateSDKCapabilityRequest(request, release)
	if !errors.Is(err, ErrUnsupportedCapability) {
		t.Fatalf("a 0.3-only reader must be refused a 0.4 Release, got %v", err)
	}
	failure, ok := CapabilityFailure(err)
	if !ok || failure.Requirement != "paywallProtocolVersion" || failure.Version != ProtocolVersion04 {
		t.Fatalf("refusal must name the 0.4 protocol version the reader lacks, got %#v", failure)
	}
}
