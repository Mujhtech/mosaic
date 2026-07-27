package experimentpostgres

import (
	"encoding/json"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
)

func TestSetReleaseContentDigestChangesWithReleaseMaterial(t *testing.T) {
	release := map[string]any{"id": "release_1", "number": float64(1), "publishedAt": "2026-07-27T00:00:00.000Z", "paywallVersions": []any{}}
	if err := setReleaseContentDigest(release); err != nil {
		t.Fatal(err)
	}
	first := release["contentDigest"]
	release["number"] = float64(2)
	if err := setReleaseContentDigest(release); err != nil {
		t.Fatal(err)
	}
	if first == release["contentDigest"] {
		t.Fatal("content digest did not change after normative release material changed")
	}
}

func TestValidateExperimentDeliveryPayloadRequiresExactClosure(t *testing.T) {
	payload := map[string]any{
		"configurationDeliveryVersion": "3",
		"release": map[string]any{
			"paywallVersions":   []any{},
			"productReferences": []any{},
			"experimentAssignments": []any{map[string]any{"variants": []any{map[string]any{
				"paywallVersionId": "paywall_version_treatment",
				"compatibility":    map[string]any{"requiredProductIds": []any{"product_treatment"}},
			}}}},
		},
	}
	release := payload["release"].(map[string]any)
	if err := setReleaseContentDigest(release); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	// Assert the machine-readable reason rather than the prose: the reason is
	// the contract the API surfaces as `details.reason` on a 422.
	err = validateExperimentDeliveryPayload(raw)
	reason, ok := experiment.InvalidReason(err)
	if err == nil || !ok || reason != "experiment_paywall_closure_incomplete" {
		t.Fatalf("missing treatment closure error = %v (reason %q)", err, reason)
	}

	release["paywallVersions"] = []any{map[string]any{"id": "paywall_version_treatment"}}
	release["productReferences"] = []any{map[string]any{"id": "product_treatment"}}
	if err = setReleaseContentDigest(release); err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(payload)
	if err = validateExperimentDeliveryPayload(raw); err != nil {
		t.Fatalf("complete immutable closure rejected: %v", err)
	}
}
