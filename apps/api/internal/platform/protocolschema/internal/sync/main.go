// Command sync refreshes the embedded protocol schema copies from the
// canonical files under protocol/schema/**.
//
// Run it from the protocolschema package directory:
//
//	go generate ./internal/platform/protocolschema
package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// copies maps the embedded file name to its canonical repository-relative path.
var copies = map[string]string{
	"paywall-v0.2.schema.json":              "protocol/schema/v0.2/paywall.schema.json",
	"commerce-provider-v1.schema.json":      "protocol/schema/commerce-provider/v1/contract.schema.json",
	"commerce-provider-v2.schema.json":      "protocol/schema/commerce-provider/v2/contract.schema.json",
	"commerce-configuration-v1.schema.json": "protocol/schema/commerce-configuration/v1/configuration.schema.json",
	"commerce-configuration-v2.schema.json": "protocol/schema/commerce-configuration/v2/configuration.schema.json",
	"analytics-event-v1.schema.json":        "protocol/schema/analytics-event/v1/event.schema.json",
	"analytics-event-v2.schema.json":        "protocol/schema/analytics-event/v2/event.schema.json",
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "sync protocol schemas: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	working, err := os.Getwd()
	if err != nil {
		return err
	}
	// working is apps/api/internal/platform/protocolschema during go:generate.
	repositoryRoot := filepath.Clean(filepath.Join(working, "../../../../../"))
	for name, canonical := range copies {
		document, err := os.ReadFile(filepath.Join(repositoryRoot, canonical))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(working, "schemas", name), document, 0o644); err != nil {
			return err
		}
	}
	return nil
}
