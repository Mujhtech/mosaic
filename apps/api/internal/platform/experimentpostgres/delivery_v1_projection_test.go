package experimentpostgres

import (
	"encoding/json"
	"testing"
)

// Negotiation promises a client the highest representation it can read. When an
// Experiment published, the resulting Release carried only v2 and v3
// representations, so a v1-only SDK was answered 406 and could not fetch
// configuration at all until it upgraded -- the opposite of the compatibility
// guarantee. This pins the v1 projection: it keeps the Placement-to-Paywall
// bindings a legacy client renders, and drops the vocabulary v1 does not define.
func TestDeliveryV1ProjectionKeepsLegacyClientsServed(t *testing.T) {
	release := map[string]any{
		"id": "release_000009", "number": float64(9),
		"environment":   map[string]any{"id": "env_000001", "key": "development", "mode": "development"},
		"publishedAt":   "2026-07-27T17:52:18.000Z",
		"contentDigest": "sha256:stale-value-that-must-be-recomputed",
		"compatibility": map[string]any{
			"paywallProtocols":              []any{map[string]any{"version": "0.3"}},
			"acceptance":                    "atomic",
			"placementDecisionContracts":    []any{map[string]any{"version": "1"}},
			"experimentAssignmentContracts": []any{map[string]any{"version": "1"}},
		},
		"placements":            []any{map[string]any{"key": "drill_onboarding", "paywallVersionId": "version_000003"}},
		"paywallVersions":       []any{map[string]any{"id": "version_000003"}},
		"productReferences":     []any{},
		"assetReferences":       []any{},
		"placementDecisions":    []any{map[string]any{"ruleSet": "…"}},
		"experimentAssignments": []any{map[string]any{"experimentId": "experiment_000003"}},
		"entitlementReferences": []any{map[string]any{"key": "pro"}},
	}

	projected, err := deliveryV1Projection(release)
	if err != nil {
		t.Fatalf("project v1: %v", err)
	}

	// What a v1 client needs to render must survive.
	for _, key := range []string{"id", "number", "environment", "publishedAt",
		"compatibility", "placements", "paywallVersions", "productReferences", "assetReferences"} {
		if _, ok := projected[key]; !ok {
			t.Errorf("v1 projection dropped %q, which a v1 client requires", key)
		}
	}
	// Vocabulary v1 does not define must not leak into the legacy view.
	for _, key := range []string{"placementDecisions", "experimentAssignments", "entitlementReferences"} {
		if _, ok := projected[key]; ok {
			t.Errorf("v1 projection leaked the non-v1 member %q", key)
		}
	}
	compatibility := projected["compatibility"].(map[string]any)
	for _, key := range []string{"placementDecisionContracts", "experimentAssignmentContracts"} {
		if _, ok := compatibility[key]; ok {
			t.Errorf("v1 compatibility leaked %q", key)
		}
	}
	if compatibility["acceptance"] != "atomic" {
		t.Errorf("v1 acceptance = %v, want atomic", compatibility["acceptance"])
	}
	if _, ok := compatibility["paywallProtocols"]; !ok {
		t.Error("v1 compatibility lost its Paywall protocols")
	}
	// The environment member is narrower in v1.
	if _, ok := projected["environment"].(map[string]any)["mode"]; ok {
		t.Error("v1 environment leaked the v2-only mode member")
	}
	// The digest must describe the projection, not the Release it came from.
	digest, _ := projected["contentDigest"].(string)
	if digest == "" || digest == "sha256:stale-value-that-must-be-recomputed" {
		t.Fatalf("contentDigest = %q, want a digest recomputed over the projection", digest)
	}

	// The Placement bindings a v1 client resolves against are the whole point
	// of the legacy view; a projection that drops them is served but useless.
	// (The publisher prefers carrying the previous Release's v1 forward, which
	// keeps them verbatim; this asserts the fallback path keeps whatever the
	// source envelope had.)
	if placements, ok := projected["placements"].([]any); !ok || len(placements) == 0 {
		t.Fatalf("v1 projection lost the Placement bindings: %#v", projected["placements"])
	}

	// And the projection must be a valid v1 payload by the same check the
	// publisher applies before storing it.
	payload, err := json.Marshal(map[string]any{"configurationDeliveryVersion": "1", "release": projected})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateDeliveryPayload(payload, "1"); err != nil {
		t.Fatalf("the stored v1 projection would be rejected: %v", err)
	}
}
