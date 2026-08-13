package hostedpublishing

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDocumentAnalysisExtractsRemoteAssetAndProductReferences(t *testing.T) {
	document := json.RawMessage(`{
        "schemaVersion":"0.4",
        "products":[{"id":"monthly","productId":"product_000001"}],
        "assets":[{"type":"image","id":"hero","source":{"type":"remote","url":"https://api.example.com/v1/sdk/assets/asset_1/sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}]
    }`)
	analysis := analyzeDocument(document)
	if len(analysis.ProductIDs) != 1 || analysis.ProductIDs[0] != "product_000001" {
		t.Fatalf("ProductIDs=%v", analysis.ProductIDs)
	}
	if !analysis.HostedAssets || len(analysis.RemoteAssets) != 1 || analysis.RemoteAssets[0].DocumentAssetID != "hero" || analysis.RemoteAssets[0].Kind != "image" {
		t.Fatalf("remote Asset reference was not extracted safely: %#v", analysis)
	}
}

func TestDeliveryPayloadMatchesV3ShapeAndCanonicalDigest(t *testing.T) {
	document, err := os.ReadFile("../../../../protocol/fixtures/v0.4/navigation-only.json")
	if err != nil {
		t.Fatal(err)
	}
	payload, _, err := buildDeliveryPayload(
		"configuration_release_1",
		1,
		"project_1",
		Environment{ID: "environment_staging", Key: "staging", Mode: "staging"},
		time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC),
		[]ReleasePlacement{{ProjectID: "project_1", EnvironmentID: "environment_staging", PlacementID: "placement_1", PlacementKey: "onboarding_complete", PaywallVersionID: "paywall_version_1"}},
		nil,
		map[string]PaywallVersion{"paywall_version_1": {
			ID: "paywall_version_1", PaywallID: "navigation-only", ProtocolVersion: ProtocolVersion,
			Document: document, ProductIDs: []string{},
		}},
		map[string]Product{},
		map[string]EntitlementReference{},
		map[string]Asset{},
	)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope["configurationDeliveryVersion"] != DeliveryVersion {
		t.Fatalf("payload claims delivery version %v, want %s", envelope["configurationDeliveryVersion"], DeliveryVersion)
	}
	release := envelope["release"].(map[string]any)
	// v3 carries Placement material as Placement Decision Rule Sets; the v1
	// bare-binding member must not survive into the single representation.
	if _, legacy := release["placements"]; legacy {
		t.Fatal("the v3 payload leaked the deleted v1 placements member")
	}
	decisions := release["placementDecisions"].([]any)
	if len(decisions) != 1 {
		t.Fatalf("expected the bound Placement carried as one Rule Set, got %d", len(decisions))
	}
	versions := release["paywallVersions"].([]any)
	version := versions[0].(map[string]any)
	for _, required := range []string{"productReferenceIds", "assetBindings"} {
		if _, ok := version[required]; !ok {
			t.Fatalf("Paywall Version is missing %s", required)
		}
	}
	compatibility := release["compatibility"].(map[string]any)
	protocols := compatibility["paywallProtocols"].([]any)
	if protocols[0].(map[string]any)["version"] != ProtocolVersion {
		t.Fatal("Delivery compatibility is not represented by the canonical object contract")
	}
	declared := release["contentDigest"].(string)
	delete(release, "contentDigest")
	canonical, err := canonicalJSON(release)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(canonical)
	if want := fmt.Sprintf("sha256:%x", digest); declared != want {
		t.Fatalf("contentDigest=%q want %q", declared, want)
	}
}

func TestSDKCapabilityRequestMustCoverSelectedReleaseExactly(t *testing.T) {
	document, err := os.ReadFile("../../../../protocol/fixtures/v0.4/navigation-only.json")
	if err != nil {
		t.Fatal(err)
	}
	payload, _, err := buildDeliveryPayload(
		"configuration_release_1", 1, "project_1",
		Environment{ID: "environment_1", Key: "staging", Mode: "staging"}, time.Now().UTC(),
		[]ReleasePlacement{{ProjectID: "project_1", EnvironmentID: "environment_1", PlacementID: "placement_1", PlacementKey: "onboarding", PaywallVersionID: "version_1"}},
		nil,
		map[string]PaywallVersion{"version_1": {ID: "version_1", PaywallID: "navigation-only", ProtocolVersion: ProtocolVersion, Document: document}},
		map[string]Product{}, map[string]EntitlementReference{}, map[string]Asset{},
	)
	if err != nil {
		t.Fatal(err)
	}
	required, err := documentRequiredCapabilities(document)
	if err != nil {
		t.Fatal(err)
	}
	capabilities := make([]SDKCapability, 0, len(required))
	for _, capability := range required {
		capabilities = append(capabilities, SDKCapability{Name: capability.Name, Version: capability.Version})
	}
	request := v04CapabilityRequest(capabilities)
	request.Platform, request.SDKVersion = "flutter", "0.2.0-dev.5"
	if err := ValidateSDKCapabilityPayload(request, payload); err != nil {
		t.Fatalf("valid capability request rejected: %v", err)
	}
	request.SupportedPaywallProtocols[0].Capabilities = capabilities[1:]
	if err := ValidateSDKCapabilityPayload(request, payload); !errors.Is(err, ErrUnsupportedCapability) {
		t.Fatalf("missing exact capability error=%v, want unsupported capability", err)
	}
}

func TestRollbackPayloadPreservesTargetSnapshot(t *testing.T) {
	document, err := os.ReadFile("../../../../protocol/fixtures/v0.4/navigation-only.json")
	if err != nil {
		t.Fatal(err)
	}
	target, _, err := buildDeliveryPayload(
		"release_original", 3, "project_1",
		Environment{ID: "environment_1", Key: "production", Mode: "production"}, time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC),
		[]ReleasePlacement{{ProjectID: "project_1", EnvironmentID: "environment_1", PlacementID: "placement_1", PlacementKey: "onboarding", PaywallVersionID: "version_1"}},
		nil,
		map[string]PaywallVersion{"version_1": {ID: "version_1", PaywallID: "navigation-only", ProtocolVersion: ProtocolVersion, Document: document}},
		map[string]Product{"product_1": {ID: "product_1", Type: "subscription", InternalName: "Original name"}},
		map[string]EntitlementReference{},
		map[string]Asset{"asset_1": {ID: "asset_1", Kind: "image", MediaType: "image/png", ByteLength: 8, ContentDigest: "sha256:" + strings.Repeat("a", 64), URL: "https://assets.example/asset_1/sha256:" + strings.Repeat("a", 64)}},
	)
	if err != nil {
		t.Fatal(err)
	}
	cloned, _, err := cloneDeliveryPayload(target, "release_rollback", 4, time.Date(2026, 7, 22, 11, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	var before, after deliveryEnvelope
	if err := json.Unmarshal(target, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(cloned, &after); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Release.Compatibility, after.Release.Compatibility) ||
		!reflect.DeepEqual(before.Release.PlacementDecisions, after.Release.PlacementDecisions) ||
		!reflect.DeepEqual(before.Release.PaywallVersions, after.Release.PaywallVersions) ||
		!reflect.DeepEqual(before.Release.ProductReferences, after.Release.ProductReferences) ||
		!reflect.DeepEqual(before.Release.AssetReferences, after.Release.AssetReferences) {
		t.Fatal("rollback rebuilt or changed immutable target snapshot content")
	}
	if after.Release.ID != "release_rollback" || after.Release.Number != 4 || after.Release.ContentDigest == before.Release.ContentDigest {
		t.Fatalf("rollback publication metadata was not regenerated: %#v", after.Release)
	}
}
