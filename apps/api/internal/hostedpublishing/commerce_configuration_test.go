package hostedpublishing

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

type commerceTestTransaction struct {
	Transaction
	assignment          ProviderAssignment
	connection          ProviderConnection
	mappings            []CommerceProductMapping
	entitlements        []CommerceEntitlementMapping
	grantCounts         map[string]int
	snapshots           map[string]ProviderMetadataSnapshot
	requestedProductIDs []string
}

func (tx *commerceTestTransaction) ProviderAssignment(string, string) (ProviderAssignment, bool) {
	return tx.assignment, tx.assignment.ConnectionID != ""
}

func (tx *commerceTestTransaction) ProviderConnection(string) (ProviderConnection, bool) {
	return tx.connection, tx.connection.ID != ""
}

func (tx *commerceTestTransaction) ProviderMappingsForCommerce(_, _, _, _ string, productIDs []string) []CommerceProductMapping {
	tx.requestedProductIDs = append([]string(nil), productIDs...)
	expected := make(map[string]struct{}, len(productIDs))
	for _, productID := range productIDs {
		expected[productID] = struct{}{}
	}
	result := make([]CommerceProductMapping, 0, len(productIDs))
	for _, mapping := range tx.mappings {
		if _, ok := expected[mapping.ProductID]; ok {
			result = append(result, mapping)
		}
	}
	return result
}

func (tx *commerceTestTransaction) ProviderEntitlementMappingsForCommerce(string, string, string, []string) []CommerceEntitlementMapping {
	return append([]CommerceEntitlementMapping(nil), tx.entitlements...)
}

func (tx *commerceTestTransaction) ProductGrantCount(productID string) int {
	if tx.grantCounts == nil {
		return 1
	}
	return tx.grantCounts[productID]
}

func (tx *commerceTestTransaction) ProviderMetadataSnapshot(id string) (ProviderMetadataSnapshot, bool) {
	value, ok := tx.snapshots[id]
	return value, ok
}

func commerceValidatorForTest(t *testing.T) *CommerceConfigurationValidator {
	t.Helper()
	providerSchema, err := os.Open("../../../../protocol/schema/commerce-provider/v1/contract.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	defer providerSchema.Close()
	configurationSchema, err := os.Open("../../../../protocol/schema/commerce-configuration/v1/configuration.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	defer configurationSchema.Close()
	validator, err := CompileCommerceConfigurationValidator(providerSchema, configurationSchema)
	if err != nil {
		t.Fatal(err)
	}
	return validator
}

func TestCommerceConfigurationUsesStoreAndCanonicalSDKLookupReferences(t *testing.T) {
	now := time.Date(2026, time.July, 23, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name        string
		offeringKey string
		packageKey  string
		wantKind    string
	}{
		{name: "direct_product", wantKind: "directProduct"},
		{name: "RevenueCat_package", offeringKey: "default", packageKey: "$rc_annual", wantKind: "revenueCatPackage"},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx := &commerceTestTransaction{
				assignment: ProviderAssignment{ConnectionID: "connection_1"},
				connection: ProviderConnection{
					ID: "connection_1", ProjectID: "project_1", Provider: "revenuecat",
					Status: "active", HealthStatus: "healthy",
				},
				mappings: []CommerceProductMapping{
					{
						ID: "mapping_1", ProductID: "product_1",
						ProviderProductIdentifier:  "prod_v2_resource",
						ProviderOfferingIdentifier: test.offeringKey,
						ProviderPackageIdentifier:  test.packageKey,
						ExpectedStoreProductID:     "com.example.pro.monthly",
						CurrentSnapshotID:          "snapshot_1",
					},
					// A connected Product not referenced by this Release must not
					// affect the exact sidecar mapping set.
					{ID: "mapping_extra", ProductID: "product_extra", CurrentSnapshotID: "snapshot_extra"},
				},
				entitlements: []CommerceEntitlementMapping{{
					EntitlementID: "entitlement_1", EntitlementKey: "pro", ProviderEntitlementIdentifier: "pro",
				}},
				snapshots: map[string]ProviderMetadataSnapshot{
					"snapshot_1": {
						ID: "snapshot_1", ObservedAt: now.Add(-2 * time.Minute),
						SyncedAt: now.Add(-time.Minute), StaleAt: now.Add(time.Hour),
					},
				},
			}
			service := &Service{commerceValidator: commerceValidatorForTest(t)}
			release := Release{
				ID: "release_1", ProjectID: "project_1", EnvironmentID: "environment_1",
				Payload: json.RawMessage(`{"release":{"contentDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}`),
			}
			snapshot, err := service.buildCommerceConfiguration(
				tx, release,
				Environment{ID: "environment_1", ProjectID: "project_1"},
				Application{ID: "application_1", ProjectID: "project_1", Platform: "ios"},
				[]string{"product_1"}, now,
			)
			if err != nil {
				t.Fatalf("build sidecar: %v", err)
			}
			if len(tx.requestedProductIDs) != 1 || tx.requestedProductIDs[0] != "product_1" {
				t.Fatalf("mapping query was not filtered to Release Products: %v", tx.requestedProductIDs)
			}
			var envelope commerceConfigurationEnvelope
			if err := json.Unmarshal(snapshot.Payload, &envelope); err != nil {
				t.Fatal(err)
			}
			mapping := envelope.Configuration.ProductMappings[0]
			if mapping.ProviderProductReference != "com.example.pro.monthly" ||
				mapping.ProviderProductReference == "prod_v2_resource" ||
				mapping.AdapterMapping.Kind != test.wantKind ||
				mapping.AdapterMapping.OfferingIdentifier != test.offeringKey ||
				mapping.AdapterMapping.PackageIdentifier != test.packageKey {
				t.Fatalf("sidecar mapping = %#v", mapping)
			}
			if len(envelope.Configuration.EntitlementMappings) != 1 ||
				envelope.Configuration.EntitlementMappings[0].ProviderEntitlementIdentifier != "pro" {
				t.Fatalf("sidecar entitlement mapping = %#v", envelope.Configuration.EntitlementMappings)
			}
			for _, capabilityName := range []string{"trials", "introductoryOffers"} {
				found := false
				for _, capability := range envelope.Configuration.ActiveProvider.Capabilities {
					if capability.Name == capabilityName {
						found = capability.Support == "conditional" &&
							capability.ReasonCode == "provider.platformCapabilityVaries"
					}
				}
				if !found {
					t.Fatalf("%s sidecar capability overstated: %#v", capabilityName, envelope.Configuration.ActiveProvider.Capabilities)
				}
			}
			material, _ := json.Marshal(envelope.Configuration)
			var canonicalMaterial map[string]any
			_ = json.Unmarshal(material, &canonicalMaterial)
			delete(canonicalMaterial, "contentDigest")
			canonical, err := canonicalJSON(canonicalMaterial)
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(canonical)
			if want := fmt.Sprintf("sha256:%x", digest); snapshot.ContentDigest != want {
				t.Fatalf("content digest = %q, want %q", snapshot.ContentDigest, want)
			}

			rolledBack, err := service.cloneCommerceConfiguration(
				snapshot,
				Release{
					ID: "release_2", ProjectID: "project_1", EnvironmentID: "environment_1",
					Payload: json.RawMessage(`{"release":{"contentDigest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}`),
				},
				now.Add(2*time.Hour),
			)
			if err != nil {
				t.Fatalf("clone delayed rollback sidecar: %v", err)
			}
			if err := json.Unmarshal(rolledBack.Payload, &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Configuration.Freshness.Status != "stale" {
				t.Fatalf("delayed rollback freshness = %q, want stale", envelope.Configuration.Freshness.Status)
			}
		})
	}
}

func TestCommerceConfigurationRequiresMappingForEveryProductGrant(t *testing.T) {
	now := time.Date(2026, time.July, 23, 12, 0, 0, 0, time.UTC)
	tx := &commerceTestTransaction{
		assignment: ProviderAssignment{ConnectionID: "connection_1"},
		connection: ProviderConnection{
			ID: "connection_1", ProjectID: "project_1", Provider: "revenuecat",
			Status: "active", HealthStatus: "healthy",
		},
		mappings: []CommerceProductMapping{{
			ID: "mapping_1", ProductID: "product_1",
			ProviderProductIdentifier: "prod_1", ExpectedStoreProductID: "store.product",
			CurrentSnapshotID: "snapshot_1",
		}},
		entitlements: []CommerceEntitlementMapping{{
			EntitlementID: "entitlement_1", EntitlementKey: "pro",
			ProviderEntitlementIdentifier: "pro",
		}},
		grantCounts: map[string]int{"product_1": 2},
		snapshots: map[string]ProviderMetadataSnapshot{
			"snapshot_1": {
				ID: "snapshot_1", ObservedAt: now.Add(-2 * time.Minute),
				SyncedAt: now.Add(-time.Minute), StaleAt: now.Add(time.Hour),
			},
		},
	}
	_, err := (&Service{}).buildCommerceConfiguration(
		tx,
		Release{
			ID: "release_1", ProjectID: "project_1", EnvironmentID: "environment_1",
			Payload: json.RawMessage(`{"release":{"contentDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}`),
		},
		Environment{ID: "environment_1", ProjectID: "project_1"},
		Application{ID: "application_1", ProjectID: "project_1", Platform: "ios"},
		[]string{"product_1"},
		now,
	)
	if !errors.Is(err, ErrProviderReadiness) {
		t.Fatalf("sidecar error = %v, want provider readiness failure", err)
	}
}

func TestInformationalReleaseDoesNotRequireCommerceSidecar(t *testing.T) {
	if shouldBuildCommerceConfigurations(nil, nil) {
		t.Fatal("zero-Product release attempted Commerce Configuration generation")
	}
	if !shouldBuildCommerceConfigurations([]string{"product_1"}, nil) {
		t.Fatal("ready commerce Release skipped Commerce Configuration generation")
	}
	if !shouldBuildCommerceConfigurations(
		[]string{"product_1"},
		[]ProviderPublicationIssue{{Code: "metadataStale"}},
	) {
		t.Fatal("soft-stale non-production Release skipped Commerce Configuration generation")
	}
	if shouldBuildCommerceConfigurations(
		[]string{"product_1"},
		[]ProviderPublicationIssue{{Code: "productUnavailable"}},
	) {
		t.Fatal("unavailable Product attempted Commerce Configuration generation")
	}
}
