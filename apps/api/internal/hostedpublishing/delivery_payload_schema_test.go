package hostedpublishing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// compileCanonicalDeliveryV3Schema compiles the actual canonical Delivery v3
// contract file, registering the schemas it references by URN — the Paywall
// 0.4 document, the Placement Decision v1 envelope, and the Experiment
// Assignment v1 root — so the assertion below is against the published
// contract and not a hand-rolled shape.
func compileCanonicalDeliveryV3Schema(t *testing.T) *jsonschema.Schema {
	t.Helper()
	const deliverySchemaID = "urn:mosaic:protocol:schema:configuration-delivery:v3:release"
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(compileECMARegexp)
	compiler.AssertFormat()
	for id, path := range map[string]string{
		protocolSchemaID: "../../../../protocol/schema/v0.4/paywall.schema.json",
		"urn:mosaic:protocol:schema:placement-decision:v1:decision":      "../../../../protocol/schema/placement-decision/v1/decision.schema.json",
		"urn:mosaic:protocol:schema:experiment-assignment:v1:assignment": "../../../../protocol/schema/experiment-assignment/v1/assignment.schema.json",
		deliverySchemaID: "../../../../protocol/schema/configuration-delivery/v3/release.schema.json",
	} {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		document, err := jsonschema.UnmarshalJSON(file)
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		if err := compiler.AddResource(id, document); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := compiler.Compile(deliverySchemaID)
	if err != nil {
		t.Fatal(err)
	}
	return schema
}

// The publish path emits the Release's single stored representation, and there
// is exactly one Delivery contract to satisfy (ADR-0028: v3, re-pinned to
// carry Paywall Protocol 0.4). This validates the emitted payload in full
// against the canonical v3 schema file — including the embedded 0.4 document,
// the synthesized Placement Decision carrying the binding, and the exactly-one
// pins on every compatibility list. The earlier version of this test could
// only assert paywallProtocols cardinality for the 0.4 half because Delivery
// then structurally pinned 0.3; the re-pin resolved that caveat, so the full
// validation deferred there is performed here.
func TestPublishedDeliveryPayloadSatisfiesTheCanonicalV3Contract(t *testing.T) {
	schema := compileCanonicalDeliveryV3Schema(t)
	document, err := os.ReadFile(filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
	if err != nil {
		t.Fatal(err)
	}
	payload, _, err := buildDeliveryPayload(
		"configuration_release_1", 1, "project_1",
		Environment{ID: "environment_1", Key: "staging", Mode: "staging"}, time.Now().UTC(),
		[]ReleasePlacement{{ProjectID: "project_1", EnvironmentID: "environment_1", PlacementID: "placement_1", PlacementKey: "onboarding", PaywallVersionID: "version_1"}},
		nil,
		map[string]PaywallVersion{"version_1": {
			ID: "version_1", PaywallID: "complete-paywall", ProtocolVersion: ProtocolVersion, Document: document,
		}},
		map[string]Product{"product_monthly": {ID: "product_monthly", Type: "subscription", InternalName: "Monthly", ReadinessReady: true}},
		map[string]EntitlementReference{"pro": {ID: "entitlement_1", Key: "pro"}},
		map[string]Asset{},
	)
	if err != nil {
		t.Fatal(err)
	}
	var instance any
	if err := json.Unmarshal(payload, &instance); err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(instance); err != nil {
		t.Fatalf("the published payload does not satisfy the canonical Delivery v3 schema: %v", err)
	}

	var envelope deliveryEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	protocols := envelope.Release.Compatibility.PaywallProtocols
	if len(protocols) != 1 || protocols[0].Version != ProtocolVersion {
		t.Fatalf("the Release must advertise exactly one paywallProtocols entry pinned to %s, got %#v", ProtocolVersion, protocols)
	}
	if len(envelope.Release.PlacementDecisions) != 1 {
		t.Fatalf("a bound Placement without a published Rule Set must be carried as exactly one synthesized Placement Decision, got %d", len(envelope.Release.PlacementDecisions))
	}
	// Reader-strict, beyond the schema's optional 1-9 digit fraction: every
	// Mosaic contract timestamp is millisecond-precision UTC with exactly
	// three fractional digits and a literal Z, and the iOS and Android readers
	// pin that shape exactly. A trailing-zero-trimmed (RFC3339Nano) rendering
	// passes the schema but rejects on device, so the convention is asserted
	// here where the schema cannot.
	if !readerStrictTimestampPattern.MatchString(envelope.Release.PublishedAt) {
		t.Fatalf("publishedAt %q is not the millisecond-precision contract form (yyyy-MM-ddTHH:mm:ss.SSSZ)", envelope.Release.PublishedAt)
	}
}

var readerStrictTimestampPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`)
