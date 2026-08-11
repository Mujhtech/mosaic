package cloudworkspace_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	cryptorand "crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

func appStoreConnectCredential(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), cryptorand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	document, err := json.Marshal(map[string]string{
		"privateKey":   string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"keyId":        "ABCDE12345",
		"issuerId":     "57246542-96fe-1a63-e053-0824d011072a",
		"vendorNumber": "85200000",
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(document)
}

func testCipher(t *testing.T) providercredential.CredentialCipher {
	t.Helper()
	key := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32))
	cipher, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"test-key","keys":{"test-key":"`+key+`"}}`,
		bytes.NewReader(bytes.Repeat([]byte{5}, 256)),
	)
	if err != nil {
		t.Fatal(err)
	}
	return cipher
}

func appStoreConnectCatalog() providercatalog.Catalog {
	return providercatalog.Catalog{
		ObservedAt: fixedTime.Add(-time.Minute),
		Apps: []providercatalog.App{{
			ID: "app_1", Name: "Acme", Platform: "app_store", Identifier: "com.example.app",
		}},
		Products: []providercatalog.Product{
			{ID: "sub_monthly", AppID: "app_1", StoreIdentifier: "com.example.monthly", DisplayName: "Monthly", Type: "subscription", State: "active"},
			{ID: "iap_lifetime", AppID: "app_1", StoreIdentifier: "com.example.lifetime", DisplayName: "Lifetime", Type: "one_time_non_consumable", State: "active"},
			{ID: "iap_coins", AppID: "app_1", StoreIdentifier: "com.example.coins", DisplayName: "Coins", Type: "one_time_consumable", State: "active"},
		},
		Entitlements: []providercatalog.Entitlement{},
		Offerings: []providercatalog.Offering{{
			ID: "grp_pro", LookupKey: "grp_pro", DisplayName: "Pro", State: "active",
			Packages: []providercatalog.Package{{
				ID: "grp_pro", LookupKey: "grp_pro", DisplayName: "Pro", ProductIDs: []string{"sub_monthly"},
			}},
		}},
	}
}

// TestAppStoreConnectConnectionCompletesCatalogImport walks the whole operator
// journey for the second server-connected provider: create, test, preview, and
// import. It protects the seams that were previously hardcoded to RevenueCat —
// the credential shape, the integration-mode pairing, the catalog client the
// service dispatches to, and the provider stamped on the created mapping. A
// mapping stamped `revenuecat` after an App Store Connect import would violate
// the database scope-shape constraint and misattribute the operator's catalog.
func TestAppStoreConnectConnectionCompletesCatalogImport(t *testing.T) {
	catalog := &providerCatalogStub{catalog: appStoreConnectCatalog()}
	service, repository := newService(cloudworkspace.WithProviderOperations(
		testCipher(t),
		cloudworkspace.ProviderCatalogClients{cloudworkspace.ProviderAppStoreConnect: catalog},
		6*time.Hour,
	))
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	application, _ := service.CreateApplication(ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.app")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	var development cloudworkspace.Environment
	for _, environment := range environments.Items {
		if environment.Mode == cloudworkspace.EnvironmentDevelopment {
			development = environment
		}
	}
	credential := appStoreConnectCredential(t)

	// An App Store Connect key is team-scoped: an external project identifier
	// would persist configuration nothing reads.
	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple (bad)", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "proj_1", EnvironmentIDs: []string{development.ID},
		ApplicationIDs: []string{application.ID}, Credential: credential,
	}); !errors.Is(err, cloudworkspace.ErrProviderProjectInvalid) {
		t.Fatalf("external project identifier error = %v, want provider project invalid", err)
	}
	// A RevenueCat secret is not a usable App Store Connect credential.
	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple (bad credential)", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
		Credential: "sk_revenuecat_secret",
	}); !errors.Is(err, cloudworkspace.ErrProviderCredentialInvalid) {
		t.Fatalf("cross-provider credential error = %v, want provider credential invalid", err)
	}
	// SDK-only is not a supported integration mode for a server-read provider.
	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple (bad mode)", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderSDKOnly, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
		Credential: credential,
	}); !errors.Is(err, cloudworkspace.ErrProviderUnsupported) {
		t.Fatalf("sdk-only integration error = %v, want provider unsupported", err)
	}

	connection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
		Credential: credential,
	})
	if err != nil {
		t.Fatalf("create App Store Connect connection: %v", err)
	}
	if connection.Credential == nil || connection.Credential.Class != "serverSecret" {
		t.Fatalf("connection credential = %#v", connection.Credential)
	}

	health, err := service.TestProviderConnection(ctx, actor, connection.ID)
	if err != nil {
		t.Fatalf("test App Store Connect connection: %v", err)
	}
	if health.Status != cloudworkspace.ProviderHealthHealthy || len(health.RequiredPermissions) == 0 {
		t.Fatalf("connection health = %#v", health)
	}
	// Apple has no entitlement resource, so the capability must be reported as
	// host-managed rather than claimed the way RevenueCat's is.
	entitlementLookup := ""
	for _, capability := range health.Capabilities {
		if capability.Name == "activeEntitlementLookup" {
			entitlementLookup = capability.Support
		}
	}
	if entitlementLookup != "conditional" {
		t.Fatalf("activeEntitlementLookup support = %q, want conditional", entitlementLookup)
	}
	if len(catalog.secrets) == 0 || catalog.secrets[0] != credential {
		t.Fatalf("the sealed credential did not round-trip to the adapter")
	}

	preview, err := service.PreviewProviderCatalog(ctx, actor, connection.ID)
	if err != nil {
		t.Fatalf("preview App Store Connect catalog: %v", err)
	}
	importable := make(map[string]bool, len(preview.Products))
	for _, product := range preview.Products {
		importable[product.ID] = product.Importable
	}
	if !importable["sub_monthly"] || !importable["iap_lifetime"] || importable["iap_coins"] {
		t.Fatalf("preview importability = %#v", importable)
	}
	if len(preview.Entitlements) != 0 || len(preview.Offerings) != 1 {
		t.Fatalf("preview offerings/entitlements = %#v / %#v", preview.Offerings, preview.Entitlements)
	}

	result, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "asc-import-1",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier:  "sub_monthly",
			ProviderOfferingIdentifier: "grp_pro", ProviderPackageIdentifier: "grp_pro",
			Key: "monthly", InternalName: "Monthly",
			EnvironmentID: development.ID, ApplicationID: application.ID,
		}},
	})
	if err != nil {
		t.Fatalf("import App Store Connect products: %v", err)
	}
	if result.Import.Status != cloudworkspace.ProviderImportCompleted || len(result.Items) != 1 ||
		result.Items[0].Status != "imported" {
		t.Fatalf("import result = %#v", result)
	}
	err = repository.View(ctx, func(reader cloudworkspace.Reader) error {
		mapping, ok := reader.ProviderMapping(result.Items[0].MappingID)
		if !ok || mapping.Provider != cloudworkspace.ProviderAppStoreConnect ||
			mapping.ConnectionID != connection.ID ||
			mapping.ExpectedStoreProductID != "com.example.monthly" {
			t.Fatalf("imported mapping = %#v", mapping)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// A consumable must be refused rather than imported as a permanent
	// non-consumable entitlement.
	consumable, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "asc-import-consumable",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier: "iap_coins", Key: "coins", InternalName: "Coins",
			EnvironmentID: development.ID, ApplicationID: application.ID,
		}},
	})
	if err != nil {
		t.Fatalf("import consumable: %v", err)
	}
	if consumable.Items[0].Status != "failed" ||
		consumable.Items[0].ErrorCode != cloudworkspace.ProviderErrorProductUnavailable {
		t.Fatalf("consumable import item = %#v", consumable.Items[0])
	}
}

// TestProviderCatalogDispatchRefusesUnregisteredProvider protects the registry
// seam. Before per-provider dispatch a single client served every connection,
// so a RevenueCat adapter would happily be handed an Apple credential. An
// unregistered provider must be refused, not silently served.
func TestProviderCatalogDispatchRefusesUnregisteredProvider(t *testing.T) {
	catalog := &providerCatalogStub{catalog: appStoreConnectCatalog()}
	service, _ := newService(cloudworkspace.WithProviderOperations(
		testCipher(t),
		// Only RevenueCat is registered.
		cloudworkspace.ProviderCatalogClients{cloudworkspace.ProviderRevenueCat: catalog},
		6*time.Hour,
	))
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	application, _ := service.CreateApplication(ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.app")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	var development cloudworkspace.Environment
	for _, environment := range environments.Items {
		if environment.Mode == cloudworkspace.EnvironmentDevelopment {
			development = environment
		}
	}
	// With no adapter registered the connection may still be recorded, but it
	// must not accept a credential and must not be operable.
	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
		Credential: appStoreConnectCredential(t),
	}); !errors.Is(err, cloudworkspace.ErrProviderUnsupported) {
		t.Fatalf("unregistered provider credential error = %v, want provider unsupported", err)
	}
	connection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
	})
	if err != nil {
		t.Fatalf("create connection without adapter: %v", err)
	}
	if _, err := service.TestProviderConnection(ctx, actor, connection.ID); !errors.Is(err, cloudworkspace.ErrProviderUnsupported) {
		t.Fatalf("test unregistered provider error = %v, want provider unsupported", err)
	}
	if _, err := service.PreviewProviderCatalog(ctx, actor, connection.ID); !errors.Is(err, cloudworkspace.ErrProviderUnsupported) {
		t.Fatalf("preview unregistered provider error = %v, want provider unsupported", err)
	}
	if len(catalog.secrets) != 0 {
		t.Fatalf("the RevenueCat adapter was called for an App Store Connect connection")
	}
}

// TestAppStoreConnectImportIsDeliveredByTheNativeAppStoreActivation pins the
// delivery story for the second server-connected provider: import through App
// Store Connect, activate the native App Store, publish.
//
// It protects three decisions that are invisible at the type level. Assigning
// an App Store Connect connection as the provider that serves purchases used
// to be accepted and then fail late, during commerce configuration
// generation, as an unexplained readiness error; it must now be refused with
// the remedy. Under a native activation an imported mapping must satisfy iOS
// readiness, or the dashboard would report a Product as unmapped that
// publishes fine. And because an imported mapping cannot carry an SDK
// observation, its provider-verified metadata snapshot is the evidence that
// has to go stale, or nothing would ever report that Apple's catalog moved.
func TestAppStoreConnectImportIsDeliveredByTheNativeAppStoreActivation(t *testing.T) {
	catalog := &providerCatalogStub{catalog: appStoreConnectCatalog()}
	service, repository := newService(cloudworkspace.WithProviderOperations(
		testCipher(t),
		cloudworkspace.ProviderCatalogClients{cloudworkspace.ProviderAppStoreConnect: catalog},
		6*time.Hour,
	))
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	application, _ := service.CreateApplication(ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.app")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	var development cloudworkspace.Environment
	for _, environment := range environments.Items {
		if environment.Mode == cloudworkspace.EnvironmentDevelopment {
			development = environment
		}
	}
	connection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Apple", Provider: cloudworkspace.ProviderAppStoreConnect,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
		Credential: appStoreConnectCredential(t),
	})
	if err != nil {
		t.Fatalf("create App Store Connect connection: %v", err)
	}
	if _, err := service.TestProviderConnection(ctx, actor, connection.ID); err != nil {
		t.Fatalf("test App Store Connect connection: %v", err)
	}
	result, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "asc-native-delivery",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier:  "sub_monthly",
			ProviderOfferingIdentifier: "grp_pro", ProviderPackageIdentifier: "grp_pro",
			Key: "monthly", InternalName: "Monthly",
			EnvironmentID: development.ID, ApplicationID: application.ID,
		}},
	})
	if err != nil || len(result.Items) != 1 || result.Items[0].Status != "imported" {
		t.Fatalf("import App Store Connect products: %#v, %v", result, err)
	}
	productID, mappingID := result.Items[0].MosaicProductID, result.Items[0].MappingID
	// Apple exposes no entitlement resource, so the grant is always a host
	// decision made after the import.
	entitlement, err := service.CreateEntitlement(ctx, actor, project.ID, "pro", "Pro", "")
	if err != nil {
		t.Fatalf("create entitlement: %v", err)
	}
	if _, err := service.AddProductEntitlement(ctx, actor, productID, entitlement.ID); err != nil {
		t.Fatalf("grant entitlement: %v", err)
	}

	// The connection imports the catalog; it cannot serve a purchase. Refuse
	// the assignment with the remedy instead of failing at the next publish.
	if _, err := service.SetActiveProviderAssignment(ctx, actor, development.ID, application.ID,
		cloudworkspace.SetActiveProviderAssignmentInput{
			ActivationKind: cloudworkspace.ProviderActivationConnection, ConnectionID: connection.ID,
		},
	); !errors.Is(err, cloudworkspace.ErrProviderNativeActivationRequired) {
		t.Fatalf("server-connected App Store Connect assignment error = %v, want native activation required", err)
	}

	if _, err := service.SetActiveProviderAssignment(ctx, actor, development.ID, application.ID,
		cloudworkspace.SetActiveProviderAssignmentInput{
			Provider: cloudworkspace.ProviderAppStore, ActivationKind: cloudworkspace.ProviderActivationNativeStore,
		},
	); err != nil {
		t.Fatalf("activate the native App Store: %v", err)
	}

	readiness, err := service.ProviderReadiness(ctx, actor, productID, development.ID, application.ID)
	if err != nil {
		t.Fatalf("evaluate readiness: %v", err)
	}
	if readiness.State != cloudworkspace.ProviderReadinessConfigured || len(readiness.Blockers) != 0 ||
		readiness.MappingID != mappingID ||
		readiness.MappingProvider != cloudworkspace.ProviderAppStoreConnect {
		t.Fatalf("App Store Connect backed native readiness = %#v", readiness)
	}

	// Expire the snapshot Apple's catalog was read into. The mapping is
	// untouched, so only the freshness evidence can report the problem.
	if err := repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		mapping, _ := tx.ProviderMapping(mappingID)
		snapshot, ok := tx.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
		if !ok {
			t.Fatal("the import recorded no metadata snapshot")
		}
		expired := fixedTime.Add(-time.Hour)
		snapshot.ExpiresAt = &expired
		tx.SaveProviderMetadataSnapshot(snapshot)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	readiness, err = service.ProviderReadiness(ctx, actor, productID, development.ID, application.ID)
	if err != nil {
		t.Fatalf("re-evaluate readiness: %v", err)
	}
	if readiness.State != cloudworkspace.ProviderReadinessAttentionRequired || len(readiness.Blockers) != 1 ||
		readiness.Blockers[0].Code != cloudworkspace.ProviderErrorProductUnavailable ||
		readiness.Blockers[0].RecoveryAction != "syncProviderMetadata" {
		t.Fatalf("stale App Store Connect readiness = %#v", readiness)
	}
}
