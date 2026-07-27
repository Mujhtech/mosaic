package hostedpublishing

import (
	"encoding/json"
	"os"
	"sort"
	"testing"
)

func TestDeliveryV2CompilerAndCapabilityNegotiationUseExactDecisionReferences(t *testing.T) {
	fixtureBytes, err := os.ReadFile("../../../../protocol/fixtures/configuration-delivery/v2/advanced-release.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture deliveryV2Envelope
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}
	v1 := deliveryEnvelope{ConfigurationDeliveryVersion: "1", Release: deliveryRelease{ID: fixture.Release.ID, Number: fixture.Release.Number, Environment: deliveryEnvironment{ID: fixture.Release.Environment.ID, Key: fixture.Release.Environment.Key}, PublishedAt: fixture.Release.PublishedAt, Compatibility: deliveryCompatibility{PaywallProtocols: fixture.Release.Compatibility.PaywallProtocols, Acceptance: "atomic"}, Placements: []deliveryPlacement{{Key: "legacy_default", PaywallVersionID: fixture.Release.PaywallVersions[0].ID}}, PaywallVersions: fixture.Release.PaywallVersions, ProductReferences: []deliveryProduct{}, AssetReferences: fixture.Release.AssetReferences}}
	v1Payload, err := json.Marshal(v1)
	if err != nil {
		t.Fatal(err)
	}
	products := map[string]Product{}
	for _, value := range fixture.Release.ProductReferences {
		products[value.ID] = Product{ID: value.ID, ProjectID: fixture.Release.ProjectID, Type: value.Type, InternalName: value.FallbackDisplayName, ReadinessReady: value.Readiness == "ready"}
	}
	entitlements := map[string]EntitlementReference{}
	for _, value := range fixture.Release.EntitlementReferences {
		entitlements[value.Key] = value
	}
	decisions := make([]PublishedDecisionVersion, len(fixture.Release.PlacementDecisions))
	for index, document := range fixture.Release.PlacementDecisions {
		var envelope struct {
			RuleSet struct {
				PlacementID string `json:"placementId"`
			} `json:"ruleSet"`
		}
		if err := json.Unmarshal(document, &envelope); err != nil {
			t.Fatal(err)
		}
		decisions[index] = PublishedDecisionVersion{ID: "version_" + envelope.RuleSet.PlacementID, PlacementID: envelope.RuleSet.PlacementID, Document: document}
	}
	payload, _, err := buildDeliveryV2Payload(v1Payload, fixture.Release.ProjectID, fixture.Release.Environment.Mode, decisions, products, entitlements)
	if err != nil {
		t.Fatal(err)
	}
	var compiled deliveryV2Envelope
	if err := json.Unmarshal(payload, &compiled); err != nil {
		t.Fatal(err)
	}
	if len(compiled.Release.PaywallVersions) != len(fixture.Release.PaywallVersions) {
		t.Fatalf("compiled Paywalls = %d, want %d", len(compiled.Release.PaywallVersions), len(fixture.Release.PaywallVersions))
	}
	if compiled.Release.Environment.Mode != fixture.Release.Environment.Mode || compiled.Release.Environment.Mode == "" {
		t.Fatalf("Delivery v2 omitted authoritative Environment mode: %#v", compiled.Release.Environment)
	}
	contract := compiled.Release.Compatibility.PlacementDecisionContracts[0]
	request := SDKCapabilityRequest{Platform: "ios", SDKVersion: "1.0.0", SupportedConfigurationDeliveryVersions: []string{"2"}, SupportedPlacementDecisionContracts: []string{"1"}, SupportedDecisionFeatures: contract.RequiredFeatures, SupportedBucketingAlgorithms: contract.BucketingAlgorithms, SupportedPaywallProtocols: []SDKPaywallProtocolSupport{{Version: "0.2", Capabilities: []SDKCapability{}}}}
	for _, capability := range compiled.Release.Compatibility.PaywallProtocols[0].RequiredCapabilities {
		request.SupportedPaywallProtocols[0].Capabilities = append(request.SupportedPaywallProtocols[0].Capabilities, SDKCapability{Name: capability.Name, Version: capability.Version})
	}
	if len(request.SupportedPaywallProtocols[0].Capabilities) == 0 {
		request.SupportedPaywallProtocols[0].Capabilities = []SDKCapability{{Name: "component.text", Version: "0.2"}}
	}
	if err := ValidateSDKCapabilityPayload(request, payload, "2"); err != nil {
		t.Fatalf("valid v2 capability request rejected: %v", err)
	}
	request.SupportedDecisionFeatures = nil
	if err := ValidateSDKCapabilityPayload(request, payload, "2"); err == nil {
		t.Fatal("v2 payload accepted without required decision features")
	}
}

func TestDeliveryV3CapabilityValidationAllowsNoAssignments(t *testing.T) {
	payload, err := os.ReadFile("../../../../protocol/fixtures/configuration-delivery/v3/experiment-release.json")
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err = json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	release := envelope["release"].(map[string]any)
	release["experimentAssignments"] = []any{}
	release["compatibility"].(map[string]any)["experimentAssignmentContracts"] = []any{}
	payload, _ = json.Marshal(envelope)
	request := SDKCapabilityRequest{
		Platform: "ios", SDKVersion: "1.0.0",
		SupportedConfigurationDeliveryVersions: []string{"3"},
		SupportedExperimentAssignmentContracts: []string{"1"},
		SupportedExperimentFeatures:            sortedCapabilityKeys(supportedExperimentFeatures),
		SupportedExperimentBucketingAlgorithms: sortedCapabilityKeys(supportedExperimentBucketingAlgorithms),
		SupportedExperimentSchedulePolicies:    sortedCapabilityKeys(supportedExperimentSchedulePolicies),
		SupportedPaywallProtocols:              []SDKPaywallProtocolSupport{{Version: "0.2", Capabilities: paywallCapabilities(release)}},
	}
	if err = ValidateSDKCapabilityPayload(request, payload, "3"); err != nil {
		t.Fatalf("zero-assignment Delivery v3 rejected: %v", err)
	}
}

func sortedCapabilityKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func paywallCapabilities(release map[string]any) []SDKCapability {
	result := []SDKCapability{}
	compatibility, _ := release["compatibility"].(map[string]any)
	protocols, _ := compatibility["paywallProtocols"].([]any)
	for _, rawProtocol := range protocols {
		protocol, _ := rawProtocol.(map[string]any)
		required, _ := protocol["requiredCapabilities"].([]any)
		for _, rawCapability := range required {
			capability, _ := rawCapability.(map[string]any)
			result = append(result, SDKCapability{Name: capability["name"].(string), Version: capability["version"].(string)})
		}
	}
	return result
}

func TestSafeV1ProjectionRequiresPaywallDefault(t *testing.T) {
	paywall, _ := json.Marshal(struct {
		PlacementDecisionVersion string         `json:"placementDecisionVersion"`
		RuleSet                  map[string]any `json:"ruleSet"`
	}{"1", map[string]any{"id": "ruleset_1", "version": 1, "projectId": "project_1", "environmentId": "environment_1", "environmentKey": "staging", "placementId": "placement_1", "placementKey": "export_pdf", "enabled": true, "assignmentPolicy": "installation", "attributeDefinitions": []any{}, "fallbacks": []any{}, "rules": []any{}, "defaultOutcome": map[string]any{"type": "paywall", "paywallVersionId": "version_1"}, "qaOverrides": []any{}, "compatibility": map[string]any{"requiredFeatures": []any{"outcome.paywall"}, "bucketingAlgorithms": []any{}}}})
	noPaywall := append([]byte(nil), paywall...)
	var envelope map[string]any
	if err := json.Unmarshal(noPaywall, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope["ruleSet"].(map[string]any)["defaultOutcome"] = map[string]any{"type": "no_paywall"}
	noPaywall, _ = json.Marshal(envelope)
	if !safeV1Projection([]PublishedDecisionVersion{{Document: paywall}}) {
		t.Fatal("explicit Paywall default was not projected")
	}
	projected, safe := projectDeliveryV1Placements([]ReleasePlacement{{PlacementID: "placement_1", PlacementKey: "export_pdf", PaywallVersionID: "legacy_mismatch"}}, []PublishedDecisionVersion{{Document: paywall}})
	if !safe || len(projected) != 1 || projected[0].PaywallVersionID != "version_1" {
		t.Fatalf("v1 projection reused mismatched legacy binding: %#v safe=%t", projected, safe)
	}
	if safeV1Projection([]PublishedDecisionVersion{{Document: noPaywall}}) {
		t.Fatal("no_paywall default was projected to legacy SDKs")
	}
}
