// Package protocolschema serves the canonical Mosaic protocol JSON Schemas the
// API runtime compiles at startup.
//
// The schemas are embedded into the binary so a released image can never be
// packaged without them (the release-artifact drift class fixed in Phase 8).
// Operators may still point an individual schema at a file on disk with the
// documented environment variables; an explicit override always wins over the
// embedded copy.
//
// The embedded copies under schemas/ are byte-for-byte duplicates of the
// canonical files under protocol/schema/**. go:embed cannot reach outside the
// module directory, so the copies are refreshed with:
//
//	go generate ./internal/platform/protocolschema
//
// TestEmbeddedSchemasMatchCanonicalProtocolFiles fails loudly when they drift.
package protocolschema

import (
	"bytes"
	"embed"
	"fmt"
	"io"
	"os"
	"sort"
)

//go:generate go run ./internal/sync

//go:embed schemas/*.schema.json
var files embed.FS

// Schema identifies one canonical protocol schema the API runtime loads.
type Schema string

const (
	PaywallV02              Schema = "paywall/v0.2"
	CommerceProviderV1      Schema = "commerce-provider/v1"
	CommerceProviderV2      Schema = "commerce-provider/v2"
	CommerceConfigurationV1 Schema = "commerce-configuration/v1"
	CommerceConfigurationV2 Schema = "commerce-configuration/v2"
	AnalyticsEventV1        Schema = "analytics-event/v1"
	AnalyticsEventV2        Schema = "analytics-event/v2"
)

type location struct {
	embedded  string
	canonical string
}

var locations = map[Schema]location{
	PaywallV02:              {"schemas/paywall-v0.2.schema.json", "protocol/schema/v0.2/paywall.schema.json"},
	CommerceProviderV1:      {"schemas/commerce-provider-v1.schema.json", "protocol/schema/commerce-provider/v1/contract.schema.json"},
	CommerceProviderV2:      {"schemas/commerce-provider-v2.schema.json", "protocol/schema/commerce-provider/v2/contract.schema.json"},
	CommerceConfigurationV1: {"schemas/commerce-configuration-v1.schema.json", "protocol/schema/commerce-configuration/v1/configuration.schema.json"},
	CommerceConfigurationV2: {"schemas/commerce-configuration-v2.schema.json", "protocol/schema/commerce-configuration/v2/configuration.schema.json"},
	AnalyticsEventV1:        {"schemas/analytics-event-v1.schema.json", "protocol/schema/analytics-event/v1/event.schema.json"},
	AnalyticsEventV2:        {"schemas/analytics-event-v2.schema.json", "protocol/schema/analytics-event/v2/event.schema.json"},
}

// Schemas lists every embedded schema in a stable order.
func Schemas() []Schema {
	names := make([]Schema, 0, len(locations))
	for name := range locations {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return names[i] < names[j] })
	return names
}

// CanonicalPath is the repository-relative path of the canonical source file.
func CanonicalPath(schema Schema) (string, bool) {
	where, ok := locations[schema]
	return where.canonical, ok
}

// Bytes returns the embedded document for a schema.
func Bytes(schema Schema) ([]byte, error) {
	where, ok := locations[schema]
	if !ok {
		return nil, fmt.Errorf("unknown protocol schema %q", schema)
	}
	document, err := files.ReadFile(where.embedded)
	if err != nil {
		return nil, fmt.Errorf("read embedded %s schema: %w", schema, err)
	}
	return document, nil
}

// Open returns a reader for a schema. A non-empty overridePath is read from
// disk instead of the embedded copy so operators and tests can pin a schema
// file; an unreadable override is an error rather than a silent fallback.
func Open(schema Schema, overridePath string) (io.ReadCloser, error) {
	if overridePath != "" {
		file, err := os.Open(overridePath)
		if err != nil {
			return nil, fmt.Errorf("open %s schema override %s: %w", schema, overridePath, err)
		}
		return file, nil
	}
	document, err := Bytes(schema)
	if err != nil {
		return nil, err
	}
	return io.NopCloser(bytes.NewReader(document)), nil
}
