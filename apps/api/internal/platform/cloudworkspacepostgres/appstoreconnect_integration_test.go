package cloudworkspacepostgres_test

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
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/hostedpublishingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// TestAppStoreConnectProviderPersistence proves the widened schema accepts a
// second server-connected provider end to end.
//
// This is the only layer that can prove it: the in-memory repository has no
// CHECK constraints, so a mapping stamped app_store_connect could pass every
// unit test and still be rejected by provider_product_mappings' scope-shape
// constraint in production. The test also pins the distinction the migration
// exists to preserve — an App Store Connect mapping keeps its connection, while
// a native app_store mapping must not have one.
func TestAppStoreConnectProviderPersistence(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	db := openSQL(t, databaseURL)
	defer db.Close()
	resetAndMigrate(t, db, 0)
	// The assertion clock starts after the schema is up: a deadline
	// created before migration is spent by migration.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	key := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{11}, 32))
	cipher, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"integration-key","keys":{"integration-key":"`+key+`"}}`,
		bytes.NewReader(bytes.Repeat([]byte{6}, 128)),
	)
	if err != nil {
		t.Fatal(err)
	}
	catalog := phase4AProviderCatalog{catalog: providercatalog.Catalog{
		ObservedAt: time.Now().UTC().Add(-time.Minute),
		Apps: []providercatalog.App{{
			ID: "app_1", Name: "Acme", Platform: "app_store", Identifier: "com.example.asc",
		}},
		Products: []providercatalog.Product{{
			ID: "sub_monthly", AppID: "app_1", StoreIdentifier: "com.example.asc.monthly",
			DisplayName: "Monthly", Type: "subscription", State: "active",
		}},
		Entitlements: []providercatalog.Entitlement{},
		Offerings: []providercatalog.Offering{{
			ID: "grp_pro", LookupKey: "grp_pro", DisplayName: "Pro", State: "active",
			Packages: []providercatalog.Package{{
				ID: "grp_pro", LookupKey: "grp_pro", DisplayName: "Pro",
				ProductIDs: []string{"sub_monthly"},
			}},
		}},
	}}
	service := cloudworkspace.NewService(
		cloudworkspacepostgres.New(pool),
		cloudworkspace.WithProviderOperations(cipher, cloudworkspace.ProviderCatalogClients{
			cloudworkspace.ProviderAppStoreConnect: catalog,
		}, time.Hour),
	)
	actor := cloudworkspace.Actor{ID: "asc-owner"}
	organization, err := service.CreateOrganization(ctx, actor, "App Store Connect")
	if err != nil {
		t.Fatal(err)
	}
	project, err := service.CreateProject(ctx, actor, organization.ID, "asc", "App Store Connect")
	if err != nil {
		t.Fatal(err)
	}
	application, err := service.CreateApplication(
		ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.asc",
	)
	if err != nil {
		t.Fatal(err)
	}
	environments, err := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
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
		Credential: appStoreConnectIntegrationCredential(t),
	})
	if err != nil {
		t.Fatalf("persist App Store Connect connection: %v", err)
	}
	if _, err := service.TestProviderConnection(ctx, actor, connection.ID); err != nil {
		t.Fatalf("test App Store Connect connection: %v", err)
	}
	result, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "asc-postgres-import",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier:  "sub_monthly",
			ProviderOfferingIdentifier: "grp_pro", ProviderPackageIdentifier: "grp_pro",
			Key: "monthly", InternalName: "Monthly",
			EnvironmentID: development.ID, ApplicationID: application.ID,
		}},
	})
	if err != nil || result.Import.Status != cloudworkspace.ProviderImportCompleted ||
		len(result.Items) != 1 || result.Items[0].MappingID == "" {
		t.Fatalf("App Store Connect import result = %#v, %v", result, err)
	}
	var provider, storedConnectionID string
	if err := pool.QueryRow(ctx,
		`SELECT provider, connection_id FROM provider_product_mappings WHERE id=$1`,
		result.Items[0].MappingID,
	).Scan(&provider, &storedConnectionID); err != nil {
		t.Fatalf("read persisted mapping: %v", err)
	}
	if provider != "app_store_connect" || storedConnectionID != connection.ID {
		t.Fatalf("persisted mapping provider=%q connection=%q", provider, storedConnectionID)
	}
	// The imported mapping must reach the native App Store delivery path. This
	// is the only layer that can prove it: the query is raw SQL, so a wrong
	// column or a predicate that still demands connection_id IS NULL compiles
	// and passes every unit test, then silently refuses to publish an imported
	// catalog in production.
	var native []hostedpublishing.CommerceProductMapping
	if err := hostedpublishingpostgres.New(pool).View(ctx, func(reader hostedpublishing.Reader) error {
		native = reader.ProviderMappingsForNativeCommerce(
			"app_store", development.ID, application.ID, "ios",
			[]string{result.Items[0].MosaicProductID},
		)
		return nil
	}); err != nil {
		t.Fatalf("read native commerce mappings: %v", err)
	}
	if len(native) != 1 || native[0].ID != result.Items[0].MappingID ||
		native[0].Provider != "app_store_connect" ||
		native[0].ExpectedStoreProductID != "com.example.asc.monthly" ||
		native[0].CurrentSnapshotID == "" {
		t.Fatalf("native commerce mappings = %#v", native)
	}

	// The native App Store mapping shape is unchanged: connection_id must stay
	// NULL, so the widened constraint has not merged the two provider kinds.
	if _, err := pool.Exec(ctx,
		`UPDATE provider_product_mappings SET provider='app_store' WHERE id=$1`,
		result.Items[0].MappingID,
	); err == nil {
		t.Fatal("a connection-backed mapping was allowed to claim the native app_store provider")
	}
}

func appStoreConnectIntegrationCredential(t *testing.T) string {
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
		"privateKey": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"keyId":      "ABCDE12345",
		"issuerId":   "57246542-96fe-1a63-e053-0824d011072a",
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(document)
}
