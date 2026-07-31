package hostedpublishing

import (
	"testing"
	"time"
)

type readinessReader struct {
	Reader
	application Application
	assignment  *ProviderAssignment
	connection  ProviderConnection
	mapping     ProviderMappingReadiness
	snapshot    ProviderMetadataSnapshot
}

func (r readinessReader) Applications(string) []Application { return []Application{r.application} }
func (r readinessReader) ProductGrantCount(string) int      { return 1 }
func (r readinessReader) ProviderAssignment(string, string) (ProviderAssignment, bool) {
	if r.assignment == nil {
		return ProviderAssignment{}, false
	}
	return *r.assignment, true
}
func (r readinessReader) ProviderConnection(string) (ProviderConnection, bool) {
	return r.connection, r.connection.ID != ""
}
func (readinessReader) ProviderConnectionEnvironmentScoped(string, string) bool { return true }
func (readinessReader) ProviderConnectionApplicationScoped(string, string) bool { return true }
func (r readinessReader) ProviderMappingsForReadiness(string, string, string, string, string) []ProviderMappingReadiness {
	return []ProviderMappingReadiness{r.mapping}
}
func (r readinessReader) ProviderMetadataSnapshot(string) (ProviderMetadataSnapshot, bool) {
	return r.snapshot, r.snapshot.ID != ""
}

func TestProviderPublicationReadinessRequiresAssignmentAndFreshAvailableMapping(t *testing.T) {
	now := time.Date(2026, time.July, 23, 12, 0, 0, 0, time.UTC)
	assignment := &ProviderAssignment{ConnectionID: "connection_1"}
	reader := readinessReader{
		application: Application{ID: "application_1", ProjectID: "project_1", Platform: "ios"},
		assignment:  assignment,
		connection:  ProviderConnection{ID: "connection_1", ProjectID: "project_1", Mode: "production", Status: "active", HealthStatus: "healthy"},
		mapping:     ProviderMappingReadiness{ID: "mapping_1", Availability: "available", SyncState: "current", CurrentSnapshotID: "snapshot_1"},
		snapshot:    ProviderMetadataSnapshot{ID: "snapshot_1"},
	}
	product := Product{ID: "product_1", ProjectID: "project_1", Status: "connected", MetadataSource: "provider"}
	environment := Environment{ID: "environment_1", ProjectID: "project_1", Mode: "production"}
	if issues := providerPublicationIssues(reader, environment, map[string]Product{product.ID: product}, now); len(issues) != 0 {
		t.Fatalf("ready provider scope produced issues: %#v", issues)
	}

	reader.assignment = nil
	issues := providerPublicationIssues(reader, environment, map[string]Product{product.ID: product}, now)
	if len(issues) != 1 || issues[0].Code != "providerUnavailable" {
		t.Fatalf("missing assignment issues = %#v", issues)
	}

	reader.assignment = assignment
	expired := now.Add(-time.Minute)
	reader.snapshot.ExpiresAt = &expired
	issues = providerPublicationIssues(reader, environment, map[string]Product{product.ID: product}, now)
	if len(issues) != 1 || issues[0].Code != "metadataStale" {
		t.Fatalf("expired metadata issues = %#v", issues)
	}
}
