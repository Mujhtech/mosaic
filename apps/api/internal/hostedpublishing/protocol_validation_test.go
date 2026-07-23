package hostedpublishing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalProtocolV02SchemaAndSemanticFixtures(t *testing.T) {
	schemaFile, err := os.Open("../../../../protocol/schema/v0.2/paywall.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	validator, err := CompileProtocolValidator(schemaFile)
	_ = schemaFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"navigation-only.json", "edge-cases.json", "expired-countdown.json", "hidden-purchase-target.json", "complete-paywall.json"} {
		t.Run("accepts_"+name, func(t *testing.T) {
			root := readProtocolFixture(t, filepath.Join("../../../../protocol/fixtures/v0.2", name))
			if errors := validator.Validate(root); len(errors) != 0 {
				t.Fatalf("canonical valid fixture rejected: %v", errors)
			}
		})
	}
	invalid, err := filepath.Glob("../../../../protocol/fixtures/v0.2/invalid/*.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range invalid {
		t.Run("rejects_"+filepath.Base(path), func(t *testing.T) {
			root := readProtocolFixture(t, path)
			if errors := validator.Validate(root); len(errors) == 0 {
				t.Fatal("canonical invalid fixture passed schema and semantic validation")
			}
		})
	}
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
