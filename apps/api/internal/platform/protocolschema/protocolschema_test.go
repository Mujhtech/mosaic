package protocolschema

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../../"))
}

// The API validates SDK traffic against these schemas. If an embedded copy
// drifts from the canonical protocol file, the runtime silently enforces a
// different contract than the published one (blocker category 17). This test
// makes that drift a build failure instead.
func TestEmbeddedSchemasMatchCanonicalProtocolFiles(t *testing.T) {
	root := repositoryRoot(t)
	for _, schema := range Schemas() {
		canonical, ok := CanonicalPath(schema)
		if !ok {
			t.Fatalf("schema %q has no canonical path", schema)
		}
		t.Run(string(schema), func(t *testing.T) {
			want, err := os.ReadFile(filepath.Join(root, canonical))
			if err != nil {
				t.Fatal(err)
			}
			got, err := Bytes(schema)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("embedded %s differs from %s; run go generate ./internal/platform/protocolschema", schema, canonical)
			}
		})
	}
}

func TestOpenPrefersExplicitOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "override.json")
	if err := os.WriteFile(path, []byte(`{"$id":"override"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	reader, err := Open(PaywallV04, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	document := make([]byte, 64)
	n, _ := reader.Read(document)
	if string(document[:n]) != `{"$id":"override"}` {
		t.Fatalf("override was not used: %q", document[:n])
	}
	if _, err := Open(PaywallV04, filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("a missing override must fail rather than silently fall back to the embedded schema")
	}
}
