package hostedpublishing

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// The frozen Configuration Delivery contracts (v1, v2, and v3) pin
// compatibility.paywallProtocols to exactly one entry, and every shipped SDK
// decoder enforces exactly-one. A Release mixing a 0.3 and a 0.4 Paywall can
// therefore never be expressed as a decodable payload: publish must refuse it
// with an error naming which Paywalls are on which version, so the operator
// knows exactly what to republish. The regression this protects against is the
// total-configuration-outage variant: emitting one entry per version, which
// every SDK decode would hard-fail.
func TestPublishRefusesAMixedProtocolVersionRelease(t *testing.T) {
	legacyDocument, err := os.ReadFile(filepath.Join(protocolFixtureRoot, "complete-paywall.json"))
	if err != nil {
		t.Fatal(err)
	}
	motionDocument, err := os.ReadFile(filepath.Join(protocolFixtureRoot04, "complete-paywall.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = buildDeliveryPayload(
		"configuration_release_1", 1, Environment{ID: "environment_1", Key: "staging"}, time.Now().UTC(),
		[]ReleasePlacement{
			{PlacementKey: "onboarding", PaywallVersionID: "version_legacy"},
			{PlacementKey: "settings_upsell", PaywallVersionID: "version_baseline"},
			{PlacementKey: "export_pdf", PaywallVersionID: "version_motion"},
		},
		map[string]PaywallVersion{
			// An empty protocol version is a Version persisted before the field
			// was authoritative; it must count as the 0.3 baseline rather than
			// as a third version (or the refusal would fire on homogeneous
			// legacy Releases).
			"version_legacy":   {ID: "version_legacy", PaywallID: "paywall_legacy", ProtocolVersion: "", Document: legacyDocument},
			"version_baseline": {ID: "version_baseline", PaywallID: "paywall_baseline", ProtocolVersion: ProtocolVersion, Document: legacyDocument},
			"version_motion":   {ID: "version_motion", PaywallID: "paywall_motion", ProtocolVersion: ProtocolVersion04, Document: motionDocument},
		},
		map[string]Product{}, map[string]Asset{},
	)
	if !errors.Is(err, ErrReleaseProtocolMixed) {
		t.Fatalf("a mixed-protocol Release must be refused with ErrReleaseProtocolMixed, got %v", err)
	}
	var mixed *ReleaseProtocolMixError
	if !errors.As(err, &mixed) {
		t.Fatalf("the refusal must carry the per-version Paywall detail, got %v", err)
	}
	want := map[string][]string{
		ProtocolVersion:   {"paywall_baseline", "paywall_legacy"},
		ProtocolVersion04: {"paywall_motion"},
	}
	if !reflect.DeepEqual(mixed.PaywallIDsByProtocolVersion, want) {
		t.Fatalf("the refusal must tell the operator which Paywalls are on which version:\n got %#v\nwant %#v", mixed.PaywallIDsByProtocolVersion, want)
	}
}

// Until the Delivery contract version deferred in docs/protocol/v0.4.md
// ("Configuration Delivery cannot yet carry 0.4") ships, even a homogeneous
// 0.4 Release has no hosted delivery representation: Delivery v1-v3 pin
// Protocol 0.3 structurally, so emitting the payload anyway would manufacture
// a release every frozen schema rejects and every SDK decode hard-fails.
// Publish must refuse it with the undeliverable Paywalls named, and must keep
// treating 0.3 (including the empty pre-authoritative version) as deliverable,
// or the gate itself would become the outage.
func TestPublishRefusesAProtocol04ReleaseUntilADeliveryContractCanCarryIt(t *testing.T) {
	err := undeliverableReleaseProtocolError(map[string]PaywallVersion{
		"version_a": {ID: "version_a", PaywallID: "paywall_motion_a", ProtocolVersion: ProtocolVersion04},
		"version_b": {ID: "version_b", PaywallID: "paywall_motion_b", ProtocolVersion: ProtocolVersion04},
	})
	if !errors.Is(err, ErrReleaseProtocolUndeliverable) {
		t.Fatalf("a homogeneous 0.4 Release must be refused with ErrReleaseProtocolUndeliverable, got %v", err)
	}
	var undeliverable *ReleaseProtocolUndeliverableError
	if !errors.As(err, &undeliverable) {
		t.Fatalf("the refusal must carry the per-version Paywall detail, got %v", err)
	}
	want := map[string][]string{ProtocolVersion04: {"paywall_motion_a", "paywall_motion_b"}}
	if !reflect.DeepEqual(undeliverable.PaywallIDsByProtocolVersion, want) {
		t.Fatalf("the refusal must name the undeliverable Paywalls:\n got %#v\nwant %#v", undeliverable.PaywallIDsByProtocolVersion, want)
	}

	if err := undeliverableReleaseProtocolError(map[string]PaywallVersion{
		"version_c": {ID: "version_c", PaywallID: "paywall_baseline", ProtocolVersion: ProtocolVersion},
		"version_d": {ID: "version_d", PaywallID: "paywall_legacy", ProtocolVersion: ""},
	}); err != nil {
		t.Fatalf("a 0.3 Release must stay publishable exactly as today, got %v", err)
	}
}

// compileCanonicalDeliveryV1Schema compiles the actual frozen Delivery v1
// contract file, registering the canonical Paywall 0.3 schema it references by
// URN, so the assertion below is against the published contract and not a
// hand-rolled shape.
func compileCanonicalDeliveryV1Schema(t *testing.T) *jsonschema.Schema {
	t.Helper()
	const deliverySchemaID = "urn:mosaic:protocol:schema:configuration-delivery:v1:release"
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(compileECMARegexp)
	compiler.AssertFormat()
	for id, path := range map[string]string{
		protocolSchemaID: "../../../../protocol/schema/v0.3/paywall.schema.json",
		deliverySchemaID: "../../../../protocol/schema/configuration-delivery/v1/release.schema.json",
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

// A single-version Release built by the publish path must satisfy the canonical
// Delivery v1 schema file, most importantly its exactly-one paywallProtocols
// pin. This is the payload-shaped half of the mixed-Release refusal above: the
// refusal keeps invalid Releases out, and this keeps the emitter honest about
// the frozen contract for the Releases it does build.
//
// The 0.3 Release is asserted against the full schema. The canonical v1 schema
// pins protocolVersion, protocolCompatibility.version, and the embedded
// document to Protocol 0.3, which is exactly why publish refuses a 0.4 Release
// outright (TestPublishRefusesAProtocol04ReleaseUntilADeliveryContractCanCarryIt).
// The builder itself still emits 0.4 payloads -- capability negotiation tests
// exercise the forward path against them -- so the 0.4 half here asserts the
// frozen cardinality directly (exactly one advertised entry, pinned to 0.4)
// and must be widened to full schema validation once the Delivery contract
// deferred in docs/protocol/v0.4.md admits 0.4.
func TestSingleProtocolReleasePayloadSatisfiesTheFrozenDeliveryV1Contract(t *testing.T) {
	schema := compileCanonicalDeliveryV1Schema(t)
	buildPayload := func(t *testing.T, protocolVersion, fixtureRoot string) json.RawMessage {
		t.Helper()
		document, err := os.ReadFile(filepath.Join(fixtureRoot, "complete-paywall.json"))
		if err != nil {
			t.Fatal(err)
		}
		payload, _, err := buildDeliveryPayload(
			"configuration_release_1", 1, Environment{ID: "environment_1", Key: "staging"}, time.Now().UTC(),
			[]ReleasePlacement{{PlacementKey: "onboarding", PaywallVersionID: "version_1"}},
			map[string]PaywallVersion{"version_1": {
				ID: "version_1", PaywallID: "complete-paywall", ProtocolVersion: protocolVersion, Document: document,
			}},
			map[string]Product{}, map[string]Asset{},
		)
		if err != nil {
			t.Fatal(err)
		}
		return payload
	}

	t.Run("a_homogeneous_0.3_release_validates_against_the_schema_file", func(t *testing.T) {
		var instance any
		if err := json.Unmarshal(buildPayload(t, ProtocolVersion, protocolFixtureRoot), &instance); err != nil {
			t.Fatal(err)
		}
		if err := schema.Validate(instance); err != nil {
			t.Fatalf("the published payload does not satisfy the canonical Delivery v1 schema: %v", err)
		}
	})

	t.Run("a_homogeneous_0.4_release_advertises_exactly_one_entry", func(t *testing.T) {
		var envelope deliveryEnvelope
		if err := json.Unmarshal(buildPayload(t, ProtocolVersion04, protocolFixtureRoot04), &envelope); err != nil {
			t.Fatal(err)
		}
		protocols := envelope.Release.Compatibility.PaywallProtocols
		if len(protocols) != 1 || protocols[0].Version != ProtocolVersion04 {
			t.Fatalf("a 0.4 Release must advertise exactly one paywallProtocols entry pinned to 0.4, got %#v", protocols)
		}
	})
}
