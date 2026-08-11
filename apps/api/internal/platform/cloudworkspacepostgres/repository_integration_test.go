package cloudworkspacepostgres_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/browserauthpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/hostedpublishingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/pgtest"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

func TestPhase3APersistenceRisks(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	db := openSQL(t, databaseURL)
	defer db.Close()
	resetAndMigrate(t, db, 7)
	// The assertion clock starts after the schema is up: a deadline
	// created before migration is spent by migration.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at)
			VALUES('upgrade_org','Upgrade',now(),now());
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
			VALUES('upgrade_project','upgrade_org','upgrade','Upgrade','active',now(),now());
		INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
			VALUES('upgrade_application','upgrade_project','Upgrade iOS','ios','dev.mosaic.upgrade',now(),now());
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
			VALUES('upgrade_environment','upgrade_project','development','Development','development',now(),now());
		INSERT INTO products(
			id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at
		) VALUES(
			'upgrade_product','upgrade_project','monthly','Monthly','subscription','connected','provider',true,now(),now()
		);
		INSERT INTO provider_connections(
			id,project_id,name,provider,integration_mode,mode,status,health_status,created_at,updated_at
		) VALUES(
			'upgrade_connection','upgrade_project','RevenueCat','revenuecat','server_connected','sandbox','active','healthy',now(),now()
		);
		INSERT INTO provider_connection_environment_scopes(project_id,connection_id,environment_id,created_at)
			VALUES('upgrade_project','upgrade_connection','upgrade_environment',now());
		INSERT INTO provider_connection_application_scopes(project_id,connection_id,application_id,created_at)
			VALUES('upgrade_project','upgrade_connection','upgrade_application',now());
		INSERT INTO active_provider_assignments(
			project_id,environment_id,application_id,platform,connection_id,created_by_actor_id,created_at,updated_at
		) VALUES(
			'upgrade_project','upgrade_environment','upgrade_application','ios','upgrade_connection','upgrade_actor',now(),now()
		);
		INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			connection_id,environment_id,platform,created_at,updated_at
		) VALUES(
			'upgrade_mapping','upgrade_project','upgrade_product','upgrade_application','revenuecat','upgrade.monthly','active',
			'upgrade_connection','upgrade_environment','ios',now(),now()
		);
	`); err != nil {
		t.Fatalf("seed accepted 00007 provider state: %v", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("upgrade accepted 00007 state through 00008: %v", err)
	}
	var upgradedProvider, upgradedActivation string
	if err := db.QueryRowContext(ctx, `
		SELECT provider,activation_kind
		FROM active_provider_assignments
		WHERE environment_id='upgrade_environment' AND application_id='upgrade_application'
	`).Scan(&upgradedProvider, &upgradedActivation); err != nil ||
		upgradedProvider != "revenuecat" || upgradedActivation != "provider_connection" {
		t.Fatalf("00007 assignment upgrade provider=%q activation=%q error=%v", upgradedProvider, upgradedActivation, err)
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()
	owner := cloudworkspace.Actor{ID: "actor-owner"}
	repository := cloudworkspacepostgres.New(pool)
	service := cloudworkspace.NewService(repository)

	readContext, cancelRead := context.WithCancel(context.Background())
	cancelRead()
	err = repository.View(readContext, func(reader cloudworkspace.Reader) error {
		_, _ = reader.Organization("missing")
		return cloudworkspace.ErrNotFound
	})
	if !errors.Is(err, context.Canceled) || errors.Is(err, cloudworkspace.ErrNotFound) {
		t.Fatalf("View error precedence = %v, want captured context cancellation", err)
	}
	transactionContext, cancelTransaction := context.WithCancel(context.Background())
	err = repository.Transact(transactionContext, func(tx cloudworkspace.Transaction) error {
		cancelTransaction()
		_, _ = tx.Organization("missing")
		return cloudworkspace.ErrNotFound
	})
	if !errors.Is(err, context.Canceled) || errors.Is(err, cloudworkspace.ErrNotFound) {
		t.Fatalf("Transact error precedence = %v, want captured context cancellation", err)
	}
	organization, err := service.CreateOrganization(ctx, owner, "Acme")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	project, err := service.CreateProject(ctx, owner, organization.ID, "ios-app", "iOS App")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	duplicate := project
	duplicate.ID = "project_unique_race"
	now := time.Now().UTC()
	duplicate.CreatedAt, duplicate.UpdatedAt = now, now
	err = repository.Transact(ctx, func(tx cloudworkspace.Transaction) error { tx.SaveProject(duplicate); return nil })
	if !errors.Is(err, cloudworkspace.ErrConflict) {
		t.Fatalf("unique constraint error = %v, want stable conflict", err)
	}

	secondOwner := cloudworkspace.Actor{ID: "actor-owner-2"}
	if _, err := service.AddMember(ctx, owner, organization.ID, secondOwner.ID, cloudworkspace.RoleOwner); err != nil {
		t.Fatalf("add second owner: %v", err)
	}
	startOwners := make(chan struct{})
	ownerErrors := make([]error, 2)
	var ownerWait sync.WaitGroup
	ownerWait.Add(2)
	go func() {
		defer ownerWait.Done()
		<-startOwners
		_, ownerErrors[0] = service.UpdateMember(ctx, owner, organization.ID, owner.ID, cloudworkspace.RoleMember)
	}()
	go func() {
		defer ownerWait.Done()
		<-startOwners
		ownerErrors[1] = service.RemoveMember(ctx, secondOwner, organization.ID, secondOwner.ID)
	}()
	close(startOwners)
	ownerWait.Wait()
	members, err := service.ListMembers(ctx, owner, organization.ID, cloudworkspace.ListOptions{})
	if err != nil {
		t.Fatalf("list members after concurrent owner mutations: %v", err)
	}
	ownerCount := 0
	for _, member := range members.Items {
		if member.Role == cloudworkspace.RoleOwner {
			ownerCount++
			owner = cloudworkspace.Actor{ID: member.ActorID}
		}
	}
	if ownerCount != 1 || countNil(ownerErrors) != 1 || countError(ownerErrors, cloudworkspace.ErrLastOwner) != 1 {
		t.Fatalf("concurrent owner mutations errors=%v owners=%d, want one success and one last-owner rejection", ownerErrors, ownerCount)
	}
	plan, err := service.CreatePlan(ctx, owner, project.ID, "pro", "Pro", "")
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	product, err := service.CreateProduct(ctx, owner, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription)
	if err != nil {
		t.Fatalf("create product: %v", err)
	}
	replacement, err := service.CreateProduct(ctx, owner, project.ID, "yearly", "Yearly", "", cloudworkspace.ProductSubscription)
	if err != nil {
		t.Fatalf("create replacement: %v", err)
	}
	entitlement, err := service.CreateEntitlement(ctx, owner, project.ID, "pro", "Pro", "")
	if err != nil {
		t.Fatalf("create entitlement: %v", err)
	}
	if _, err := service.AddPlanProduct(ctx, owner, plan.ID, product.ID); err != nil {
		t.Fatalf("add plan product: %v", err)
	}
	if _, err := service.AddProductEntitlement(ctx, owner, product.ID, entitlement.ID); err != nil {
		t.Fatalf("grant entitlement: %v", err)
	}

	cycleA, _ := service.CreateProduct(ctx, owner, project.ID, "cycle-a", "Cycle A", "", cloudworkspace.ProductSubscription)
	cycleB, _ := service.CreateProduct(ctx, owner, project.ID, "cycle-b", "Cycle B", "", cloudworkspace.ProductSubscription)
	cycleErrors := concurrent(t, func() error { _, err := service.SetProductReplacement(ctx, owner, cycleA.ID, cycleB.ID); return err }, func() error { _, err := service.SetProductReplacement(ctx, owner, cycleB.ID, cycleA.ID); return err })
	if countNil(cycleErrors) != 1 || countError(cycleErrors, cloudworkspace.ErrReplacementInvalid) != 1 {
		t.Fatalf("concurrent cycle errors=%v", cycleErrors)
	}
	gotA, _ := service.GetProduct(ctx, owner, cycleA.ID)
	gotB, _ := service.GetProduct(ctx, owner, cycleB.ID)
	if gotA.ReplacementProductID == cycleB.ID && gotB.ReplacementProductID == cycleA.ID {
		t.Fatal("concurrent replacement created a cycle")
	}

	archiveSource, _ := service.CreateProduct(ctx, owner, project.ID, "archive-source", "Archive Source", "", cloudworkspace.ProductSubscription)
	archiveTarget, _ := service.CreateProduct(ctx, owner, project.ID, "archive-target", "Archive Target", "", cloudworkspace.ProductSubscription)
	archiveErrors := concurrent(t, func() error {
		_, err := service.SetProductReplacement(ctx, owner, archiveSource.ID, archiveTarget.ID)
		return err
	}, func() error { _, err := service.ArchiveProduct(ctx, owner, archiveTarget.ID); return err })
	if countNil(archiveErrors) != 1 || countError(archiveErrors, cloudworkspace.ErrReplacementInvalid) != 1 {
		t.Fatalf("replacement/archive errors=%v", archiveErrors)
	}
	gotSource, _ := service.GetProduct(ctx, owner, archiveSource.ID)
	gotTarget, _ := service.GetProduct(ctx, owner, archiveTarget.ID)
	if gotSource.ReplacementProductID == archiveTarget.ID && gotTarget.Status == cloudworkspace.ProductArchived {
		t.Fatal("replacement target was archived")
	}

	typeSource, _ := service.CreateProduct(ctx, owner, project.ID, "type-source", "Type Source", "", cloudworkspace.ProductSubscription)
	typeTarget, _ := service.CreateProduct(ctx, owner, project.ID, "type-target", "Type Target", "", cloudworkspace.ProductSubscription)
	typeErrors := concurrent(t, func() error {
		_, err := service.SetProductReplacement(ctx, owner, typeSource.ID, typeTarget.ID)
		return err
	}, func() error {
		_, err := service.UpdateProduct(ctx, owner, typeTarget.ID, typeTarget.Key, typeTarget.InternalName, typeTarget.Description, cloudworkspace.ProductOneTimeNonConsumable)
		return err
	})
	if countNil(typeErrors) != 1 || countError(typeErrors, cloudworkspace.ErrReplacementInvalid) != 1 {
		t.Fatalf("replacement/type errors=%v", typeErrors)
	}
	gotTypeSource, _ := service.GetProduct(ctx, owner, typeSource.ID)
	gotTypeTarget, _ := service.GetProduct(ctx, owner, typeTarget.ID)
	if gotTypeSource.ReplacementProductID == typeTarget.ID && gotTypeSource.Type != gotTypeTarget.Type {
		t.Fatal("replacement linked incompatible product types")
	}

	deleteSource, _ := service.CreateProduct(ctx, owner, project.ID, "delete-source", "Delete Source", "", cloudworkspace.ProductSubscription)
	deleteTarget, _ := service.CreateProduct(ctx, owner, project.ID, "delete-target", "Delete Target", "", cloudworkspace.ProductSubscription)
	deleteErrors := concurrent(t, func() error {
		_, err := service.SetProductReplacement(ctx, owner, deleteSource.ID, deleteTarget.ID)
		return err
	}, func() error { return service.DeleteProduct(ctx, owner, deleteSource.ID) })
	if countNil(deleteErrors) != 1 || (countError(deleteErrors, cloudworkspace.ErrProductReferenced)+countError(deleteErrors, cloudworkspace.ErrNotFound)) != 1 {
		t.Fatalf("replacement/delete errors=%v", deleteErrors)
	}
	gotDeleteSource, getDeleteErr := service.GetProduct(ctx, owner, deleteSource.ID)
	if getDeleteErr == nil && gotDeleteSource.ReplacementProductID != deleteTarget.ID {
		t.Fatal("deleted source was resurrected without its replacement")
	}

	// Reconstruction proves that durable repository state, including relationships, survives runtime restart.
	reconstructed := cloudworkspace.NewService(cloudworkspacepostgres.New(pool))
	if got, err := reconstructed.GetOrganization(ctx, owner, organization.ID); err != nil || got.Name != "Acme" {
		t.Fatalf("reconstructed organization = %#v, %v", got, err)
	}
	if got, err := reconstructed.ListPlanProducts(ctx, owner, plan.ID, cloudworkspace.ListOptions{}); err != nil || len(got.Items) != 1 {
		t.Fatalf("reconstructed plan products = %#v, %v", got, err)
	}
	if got, err := reconstructed.ListProductEntitlements(ctx, owner, product.ID, cloudworkspace.ListOptions{}); err != nil || len(got.Items) != 1 {
		t.Fatalf("reconstructed grants = %#v, %v", got, err)
	}

	otherProject, err := service.CreateProject(ctx, owner, organization.ID, "other", "Other")
	if err != nil {
		t.Fatal(err)
	}
	otherProduct, err := service.CreateProduct(ctx, owner, otherProject.ID, "other", "Other", "", cloudworkspace.ProductSubscription)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO plan_products(project_id,plan_id,product_id,created_at) VALUES($1,$2,$3,now())`, project.ID, plan.ID, otherProduct.ID); err == nil {
		t.Fatal("cross-project plan membership succeeded; want composite foreign-key rejection")
	}

	// A forced audit failure must roll back both replacement and its history.
	_, err = pool.Exec(ctx, `CREATE FUNCTION fail_replacement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='product.replacement_set' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_replacement_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_replacement_audit()`)
	if err != nil {
		t.Fatalf("install failure trigger: %v", err)
	}
	if _, err := service.SetProductReplacement(ctx, owner, product.ID, replacement.ID); err == nil {
		t.Fatal("replacement succeeded despite audit failure")
	}
	var replacementID *string
	var historyCount int
	if err := pool.QueryRow(ctx, `SELECT replacement_product_id FROM products WHERE id=$1`, product.ID).Scan(&replacementID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM product_replacement_history WHERE product_id=$1`, product.ID).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if replacementID != nil || historyCount != 0 {
		t.Fatalf("partial replacement persisted: replacement=%v history=%d", replacementID, historyCount)
	}
	if _, err := pool.Exec(ctx, `DROP TRIGGER fail_replacement_audit ON audit_events; DROP FUNCTION fail_replacement_audit()`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetProductReplacement(ctx, owner, product.ID, replacement.ID); err != nil {
		t.Fatalf("set replacement: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM product_replacement_history WHERE product_id=$1`, product.ID).Scan(&historyCount); err != nil || historyCount != 1 {
		t.Fatalf("replacement history count=%d err=%v", historyCount, err)
	}

	environments, err := service.ListEnvironments(ctx, owner, project.ID, cloudworkspace.ListOptions{})
	if err != nil || len(environments.Items) == 0 {
		t.Fatalf("list environments: %#v %v", environments, err)
	}
	application, err := service.CreateApplication(ctx, owner, project.ID, "Provider iOS", cloudworkspace.PlatformIOS, "com.example.provider")
	if err != nil {
		t.Fatalf("create provider application: %v", err)
	}
	var development, staging, production cloudworkspace.Environment
	for _, environment := range environments.Items {
		if environment.Mode == cloudworkspace.EnvironmentDevelopment {
			development = environment
		}
		if environment.Mode == cloudworkspace.EnvironmentStaging {
			staging = environment
		}
		if environment.Mode == cloudworkspace.EnvironmentProduction {
			production = environment
		}
	}
	// A server-connected RevenueCat connection requires the external project id;
	// the invariant landed after this call site was written, which is why it
	// failed with providerProjectInvalid.
	connection, err := service.CreateProviderConnection(ctx, owner, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "RevenueCat sandbox", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "proj_phase3a",
		// A sandbox connection may not be scoped to a production Environment,
		// so this covers development and staging.
		EnvironmentIDs: []string{development.ID, staging.ID}, ApplicationIDs: []string{application.ID},
	})
	if err != nil {
		t.Fatalf("persist provider connection: %v", err)
	}
	if _, err := service.SetActiveProviderAssignment(ctx, owner, development.ID, application.ID, cloudworkspace.SetActiveProviderAssignmentInput{ConnectionID: connection.ID}); err != nil {
		t.Fatalf("persist provider assignment: %v", err)
	}
	if _, err := service.ReplaceProviderConnectionScopes(ctx, owner, connection.ID, cloudworkspace.ReplaceProviderConnectionScopesInput{
		EnvironmentIDs: []string{development.ID, staging.ID}, ApplicationIDs: []string{application.ID},
	}); err != nil {
		t.Fatalf("idempotently retain in-use provider scopes: %v", err)
	}
	if _, err := service.ReplaceProviderConnectionScopes(ctx, owner, connection.ID, cloudworkspace.ReplaceProviderConnectionScopesInput{
		EnvironmentIDs: []string{staging.ID}, ApplicationIDs: []string{application.ID},
	}); !errors.Is(err, cloudworkspace.ErrScopeMismatch) {
		t.Fatalf("remove in-use provider Environment scope error=%v, want scope mismatch", err)
	}
	mapping, err := service.CreateProviderMappingDraft(ctx, owner, product.ID, cloudworkspace.CreateProviderMappingDraftInput{
		ConnectionID: connection.ID, EnvironmentID: development.ID, ApplicationID: application.ID,
		ProviderProductIdentifier: "monthly",
	})
	if err != nil {
		t.Fatalf("persist provider mapping draft: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE provider_product_mappings SET provider_package_identifier='monthly' WHERE id=$1`, mapping.ID); err == nil {
		t.Fatal("database accepted an unpaired provider Package identifier")
	}
	snapshot := cloudworkspace.ProviderProductMetadataSnapshot{
		ID: "provider_snapshot_000001", ProjectID: project.ID, MappingID: mapping.ID,
		Source: cloudworkspace.ProviderMetadataProvider, Digest: strings.Repeat("a", 64),
		Availability: cloudworkspace.ProviderAvailabilityAvailable,
		// stale_at is NOT NULL and must not precede observed_at; a zero value
		// violates the freshness ordering the schema enforces.
		ObservedAt: now, SyncedAt: now, StaleAt: now.Add(time.Hour), CreatedAt: now,
	}
	if err := repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		tx.SaveProviderMetadataSnapshot(snapshot)
		return nil
	}); err != nil {
		t.Fatalf("persist safe provider metadata snapshot: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE provider_product_metadata_snapshots SET availability='unavailable' WHERE id=$1`, snapshot.ID); err == nil {
		t.Fatal("immutable provider metadata snapshot accepted an update")
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			connection_id,environment_id,platform,created_at,updated_at
		) VALUES(
			'connected_out_of_scope',$1,$2,$3,'revenuecat','out.of.scope','active',
			$4,$5,'ios',now(),now()
		)`,
		// production is deliberately outside this sandbox connection's scope
		// (development + staging), so the database must refuse the mapping.
		project.ID, replacement.ID, application.ID, connection.ID, production.ID,
	); err == nil {
		t.Fatal("database accepted connected mapping outside its connection Environment scope")
	}
	androidApplication, err := service.CreateApplication(ctx, owner, project.ID, "Provider Android", cloudworkspace.PlatformAndroid, "com.example.provider.android")
	if err != nil {
		t.Fatalf("create native provider application: %v", err)
	}
	if _, err := service.SetActiveProviderAssignment(ctx, owner, development.ID, androidApplication.ID, cloudworkspace.SetActiveProviderAssignmentInput{
		Provider: cloudworkspace.ProviderGooglePlay, ActivationKind: cloudworkspace.ProviderActivationNativeStore,
	}); err != nil {
		t.Fatalf("persist native provider assignment: %v", err)
	}
	nativeMapping, err := service.CreateProviderMappingDraft(ctx, owner, product.ID, cloudworkspace.CreateProviderMappingDraftInput{
		Provider: cloudworkspace.ProviderGooglePlay, EnvironmentID: development.ID,
		ApplicationID: androidApplication.ID, ProviderProductIdentifier: "monthly",
		ProviderBasePlanIdentifier: "monthly-auto", ProviderOfferIdentifier: "intro",
	})
	if err != nil {
		t.Fatalf("persist native provider mapping: %v", err)
	}
	nativeDuplicateProduct, err := service.CreateProduct(ctx, owner, project.ID, "monthly-native-duplicate", "Monthly native duplicate", "", cloudworkspace.ProductSubscription)
	if err != nil {
		t.Fatalf("create native duplicate Product: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,provider_base_plan_identifier,created_at,updated_at
		) VALUES(
			'native_duplicate_target',$1,$2,$3,'google_play','monthly','active',
			$4,'android','different-selector',now(),now()
		)`,
		project.ID, nativeDuplicateProduct.ID, androidApplication.ID, development.ID,
	); err == nil {
		t.Fatal("database accepted duplicate current native provider Product target")
	}
	otherEnvironments, err := service.ListEnvironments(ctx, owner, otherProject.ID, cloudworkspace.ListOptions{})
	if err != nil || len(otherEnvironments.Items) == 0 {
		t.Fatalf("list cross-Project Environments: %#v, %v", otherEnvironments, err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,provider_base_plan_identifier,created_at,updated_at
		) VALUES(
			'native_cross_project',$1,$2,$3,'google_play','cross-project','active',
			$4,'android','cross-project',now(),now()
		)`,
		project.ID, nativeDuplicateProduct.ID, androidApplication.ID, otherEnvironments.Items[0].ID,
	); err == nil {
		t.Fatal("database accepted native mapping with a cross-Project Environment")
	}
	expiresAt := now.Add(time.Hour)
	observation, err := service.CreateProviderMappingObservation(ctx, owner, nativeMapping.ID, cloudworkspace.CreateProviderMappingObservationInput{
		AdapterVersion: "1.0.0", StoreContext: cloudworkspace.ProviderObservationGooglePlayTest,
		Result: cloudworkspace.ProviderObservationAvailable, CorrelationID: "postgres-test-run",
		Metadata: cloudworkspace.ProviderMappingObservationMetadata{
			ClientPlatform:      cloudworkspace.ProviderObservationClientAndroid,
			ConfigurationSource: cloudworkspace.ProviderObservationConfigurationRemote,
			TestScenario:        cloudworkspace.ProviderObservationScenarioProductLoad,
		},
		ObservedAt: now, ExpiresAt: &expiresAt,
	})
	if err != nil {
		t.Fatalf("persist native provider observation: %v", err)
	}
	observations, err := reconstructed.ListProviderMappingObservations(ctx, owner, nativeMapping.ID)
	if err != nil || len(observations) != 1 || observations[0].ID != observation.ID {
		t.Fatalf("reconstruct native observations = %#v, %v", observations, err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO provider_mapping_observations(
			id,project_id,mapping_id,environment_id,application_id,platform,provider,
			adapter_version,store_context,result,correlation_id,metadata,observed_at,received_at,created_by_actor_id
		)
		SELECT
			'unsafe_observation',project_id,mapping_id,environment_id,application_id,platform,provider,
			adapter_version,store_context,result,'unsafe-correlation','{"receipt":"forbidden"}'::jsonb,
			observed_at,received_at,created_by_actor_id
		FROM provider_mapping_observations WHERE id=$1`,
		observation.ID,
	); err == nil {
		t.Fatal("database accepted unknown sensitive observation metadata")
	}
	if _, err := pool.Exec(ctx, `UPDATE provider_mapping_observations SET result='failed' WHERE id=$1`, observation.ID); err == nil {
		t.Fatal("immutable native provider observation accepted an update")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM provider_mapping_observations WHERE id=$1`, observation.ID); err == nil {
		t.Fatal("immutable native provider observation accepted a delete")
	}
	nativeReplacement, err := service.ReplaceProviderMapping(ctx, owner, nativeMapping.ID, cloudworkspace.ReplaceProviderMappingInput{
		ProviderProductIdentifier: "monthly-v2", ProviderBasePlanIdentifier: "monthly-v2-auto",
	})
	if err != nil || nativeReplacement.ReplacesMappingID != nativeMapping.ID {
		t.Fatalf("replace native mapping = %#v, %v", nativeReplacement, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE provider_product_mappings SET provider_product_identifier='mutated' WHERE id=$1`, nativeMapping.ID); err == nil {
		t.Fatal("database accepted mutation of an archived provider mapping")
	}
	if got, err := reconstructed.GetProviderConnection(ctx, owner, connection.ID); err != nil ||
		!reflect.DeepEqual(got.EnvironmentIDs, []string{development.ID, staging.ID}) ||
		!reflect.DeepEqual(got.ApplicationIDs, []string{application.ID}) {
		t.Fatalf("reconstructed provider connection = %#v, %v", got, err)
	}
	createdKey, err := service.CreateAPIKey(ctx, owner, environments.Items[0].ID, cloudworkspace.APIKeySecretServer)
	if err != nil {
		t.Fatalf("create API key: %v", err)
	}
	if createdKey.Secret == "" {
		t.Fatal("one-time API key secret was not returned")
	}
	var digest []byte
	var applicationID, applicationProjectID sql.NullString
	if err := pool.QueryRow(ctx, `SELECT secret_digest,application_id,application_project_id FROM api_keys WHERE id=$1`, createdKey.APIKey.ID).Scan(&digest, &applicationID, &applicationProjectID); err != nil {
		t.Fatal(err)
	}
	if len(digest) != 32 {
		t.Fatalf("stored digest length=%d, want 32", len(digest))
	}
	if applicationID.Valid || applicationProjectID.Valid {
		t.Fatalf("secret-server key application binding = (%q,%q), want both NULL", applicationID.String, applicationProjectID.String)
	}
	keys, err := service.ListAPIKeys(ctx, owner, environments.Items[0].ID, "", "", cloudworkspace.ListOptions{})
	if err != nil || len(keys.Items) != 1 {
		t.Fatalf("list API keys: %#v %v", keys, err)
	}
	if _, err := service.RevokeAPIKey(ctx, owner, createdKey.APIKey.ID); err != nil {
		t.Fatalf("revoke API key: %v", err)
	}
	err = repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		record, ok := tx.APIKey(createdKey.APIKey.ID)
		if !ok {
			return cloudworkspace.ErrNotFound
		}
		record.RevokedAt = nil
		tx.SaveAPIKey(record)
		return nil
	})
	if err != nil {
		t.Fatalf("attempt stale API-key save: %v", err)
	}
	var revokedAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT revoked_at FROM api_keys WHERE id=$1`, createdKey.APIKey.ID).Scan(&revokedAt); err != nil || revokedAt == nil {
		t.Fatalf("revocation was cleared: revokedAt=%v err=%v", revokedAt, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE api_keys SET revoked_at=NULL WHERE id=$1`, createdKey.APIKey.ID); err != nil {
		t.Fatalf("direct stale API-key update: %v", err)
	}
	revokedAt = nil
	if err := pool.QueryRow(ctx, `SELECT revoked_at FROM api_keys WHERE id=$1`, createdKey.APIKey.ID).Scan(&revokedAt); err != nil || revokedAt == nil {
		t.Fatalf("database trigger allowed revocation clearing: revokedAt=%v err=%v", revokedAt, err)
	}
}

type phase4AProviderCatalog struct {
	catalog providercatalog.Catalog
}

func (catalog phase4AProviderCatalog) FetchCatalog(context.Context, providercatalog.Credential) (providercatalog.Catalog, error) {
	return catalog.catalog, nil
}

func TestPhase4AProviderPersistenceRisks(t *testing.T) {
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
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()
	key := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32))
	cipher, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"integration-key","keys":{"integration-key":"`+key+`"}}`,
		bytes.NewReader(bytes.Repeat([]byte{4}, 128)),
	)
	if err != nil {
		t.Fatal(err)
	}
	catalog := phase4AProviderCatalog{catalog: providercatalog.Catalog{
		ObservedAt: time.Now().UTC().Add(-time.Minute),
		Apps: []providercatalog.App{{
			ID: "app_resource", Name: "iOS", Platform: "app_store", Identifier: "com.example.phase4a",
		}},
		Products: []providercatalog.Product{{
			ID: "product_resource", AppID: "app_resource",
			StoreIdentifier: "com.example.phase4a.monthly", Type: "subscription", State: "active",
		}},
		Entitlements: []providercatalog.Entitlement{{
			ID: "entitlement_resource", LookupKey: "pro", DisplayName: "Pro", State: "active",
		}},
	}}
	repository := cloudworkspacepostgres.New(pool)
	service := cloudworkspace.NewService(
		repository,
		cloudworkspace.WithProviderOperations(cipher, cloudworkspace.ProviderCatalogClients{cloudworkspace.ProviderRevenueCat: catalog}, time.Hour),
	)
	actor := cloudworkspace.Actor{ID: "phase4a-owner"}
	organization, err := service.CreateOrganization(ctx, actor, "Phase 4A")
	if err != nil {
		t.Fatal(err)
	}
	project, err := service.CreateProject(ctx, actor, organization.ID, "phase4a", "Phase 4A")
	if err != nil {
		t.Fatal(err)
	}
	application, err := service.CreateApplication(
		ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.phase4a",
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
		Name: "RevenueCat", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "proj_resource", EnvironmentIDs: []string{development.ID},
		ApplicationIDs: []string{application.ID}, Credential: "sk_integration_secret",
	})
	if err != nil {
		t.Fatalf("persist encrypted provider connection: %v", err)
	}
	if _, err := service.TestProviderConnection(ctx, actor, connection.ID); err != nil {
		t.Fatalf("test provider connection: %v", err)
	}
	importResult, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "phase4a-postgres-import",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier: "product_resource", Key: "monthly", InternalName: "Monthly",
			EnvironmentID: development.ID, ApplicationID: application.ID,
			Entitlements: []cloudworkspace.ProviderEntitlementImportInput{{
				ProviderIdentifier: "entitlement_resource", Key: "pro", Name: "Pro",
			}},
		}},
	})
	if err != nil || importResult.Import.Status != cloudworkspace.ProviderImportCompleted ||
		len(importResult.Items) != 1 || importResult.Items[0].MappingID == "" {
		t.Fatalf("PostgreSQL import result = %#v, %v", importResult, err)
	}
	var ciphertext []byte
	var keyID string
	if err := pool.QueryRow(ctx,
		`SELECT ciphertext,key_id FROM provider_connection_credentials WHERE connection_id=$1`,
		connection.ID,
	).Scan(&ciphertext, &keyID); err != nil {
		t.Fatalf("read encrypted credential evidence: %v", err)
	}
	if bytes.Contains(ciphertext, []byte("sk_integration_secret")) || keyID != "integration-key" {
		t.Fatal("provider credential was not stored as a scoped encrypted envelope")
	}
	if _, err := pool.Exec(ctx,
		`UPDATE provider_product_metadata_snapshots SET normalized_metadata='{}'::jsonb WHERE id=(
			SELECT current_snapshot_id FROM provider_product_mappings WHERE id=$1
		)`,
		importResult.Items[0].MappingID,
	); err == nil || !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("immutable metadata snapshot update error = %v", err)
	}
	job, err := service.EnqueueProviderSync(ctx, actor, connection.ID)
	if err != nil {
		t.Fatalf("enqueue provider sync: %v", err)
	}
	var leased cloudworkspace.ProviderSyncJob
	leaseStartedAt := time.Now().UTC()
	err = repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		var ok bool
		leased, ok = tx.LeaseProviderSyncJob("worker_1", leaseStartedAt, leaseStartedAt.Add(time.Minute))
		if !ok {
			return errors.New("queued provider sync job was not leased")
		}
		return nil
	})
	if err != nil || leased.ID != job.ID || leased.AttemptCount != 1 {
		t.Fatalf("lease provider sync job = %#v, %v", leased, err)
	}
	err = repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		if _, ok := tx.LeaseProviderSyncJob("worker_2", leaseStartedAt.Add(30*time.Second), leaseStartedAt.Add(90*time.Second)); ok {
			return errors.New("active provider sync lease was leased twice")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	err = repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		releasedAt := leaseStartedAt.Add(time.Minute)
		released, ok := tx.LeaseProviderSyncJob("worker_2", releasedAt, releasedAt.Add(time.Minute))
		if !ok || released.ID != leased.ID || released.AttemptCount != leased.AttemptCount+1 {
			return fmt.Errorf("expired provider sync job was not re-leased with a fencing attempt: %#v", released)
		}
		if tx.OwnsProviderSyncJobLease(leased.ID, "worker_1", leased.AttemptCount, releasedAt) {
			return errors.New("stale worker retained provider sync lease ownership")
		}
		if !tx.OwnsProviderSyncJobLease(released.ID, "worker_2", released.AttemptCount, releasedAt) {
			return errors.New("current worker did not own provider sync lease")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	var entitlementID string
	if err := repository.View(ctx, func(reader cloudworkspace.Reader) error {
		grants := reader.ProductGrants(importResult.Items[0].MosaicProductID)
		if len(grants) != 1 {
			return fmt.Errorf("Product grants = %#v, want one", grants)
		}
		entitlementID = grants[0].EntitlementID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveProviderMapping(ctx, actor, importResult.Items[0].MappingID); err != nil {
		t.Fatalf("archive first-connection mapping: %v", err)
	}
	secondConnection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "RevenueCat replacement", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "proj_resource", EnvironmentIDs: []string{development.ID},
		ApplicationIDs: []string{application.ID}, Credential: "sk_integration_secret_2",
	})
	if err != nil {
		t.Fatalf("create replacement provider connection: %v", err)
	}
	// A never-tested connection is deliberately not ready: ProviderReadiness
	// reports providerUnavailable until a successful test, which is the safe
	// direction for commerce Product resolution. The first connection is tested
	// above; the replacement must be too, or this asserts the untested state
	// rather than the connection swap it exists to protect.
	if _, err := service.TestProviderConnection(ctx, actor, secondConnection.ID); err != nil {
		t.Fatalf("test replacement provider connection: %v", err)
	}
	secondImport, err := service.ImportProviderProducts(ctx, actor, project.ID, secondConnection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "phase4a-postgres-second-connection-import",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier: "product_resource",
			ExistingProductID:         importResult.Items[0].MosaicProductID,
			EnvironmentID:             development.ID,
			ApplicationID:             application.ID,
			Entitlements: []cloudworkspace.ProviderEntitlementImportInput{{
				ProviderIdentifier:    "entitlement_resource",
				ExistingEntitlementID: entitlementID,
			}},
		}},
	})
	if err != nil || secondImport.Import.Status != cloudworkspace.ProviderImportCompleted {
		t.Fatalf("second-connection import = %#v, %v", secondImport, err)
	}
	if _, err := service.SetActiveProviderAssignment(
		ctx, actor, development.ID, application.ID, cloudworkspace.SetActiveProviderAssignmentInput{ConnectionID: secondConnection.ID},
	); err != nil {
		t.Fatalf("switch active provider connection: %v", err)
	}
	readiness, err := service.ProviderReadiness(
		ctx, actor, importResult.Items[0].MosaicProductID, development.ID, application.ID,
	)
	if err != nil || readiness.ConnectionID != secondConnection.ID || len(readiness.Blockers) != 0 {
		t.Fatalf("replacement-connection readiness = %#v, %v", readiness, err)
	}
	if err := repository.View(ctx, func(reader cloudworkspace.Reader) error {
		firstMappings := reader.ProviderEntitlementMappings(connection.ID, development.ID, application.ID)
		secondMappings := reader.ProviderEntitlementMappings(secondConnection.ID, development.ID, application.ID)
		if len(firstMappings) != 1 || len(secondMappings) != 1 ||
			firstMappings[0].EntitlementID != entitlementID || secondMappings[0].EntitlementID != entitlementID {
			return fmt.Errorf("connection-scoped entitlement mappings first=%#v second=%#v", firstMappings, secondMappings)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPhase3BPublishingPersistenceRisks(t *testing.T) {
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
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()
	authService := browserauth.NewService(browserauthpostgres.New(pool), time.Hour)
	signUp, err := authService.SignUp(ctx, "owner@example.com", "Owner", "correct horse battery")
	if err != nil {
		t.Fatalf("persist browser account and session: %v", err)
	}
	var storedPasswordHash string
	var storedTokenDigest []byte
	if err := pool.QueryRow(ctx, `SELECT u.password_hash,s.token_digest FROM users u JOIN browser_sessions s ON s.user_id=u.id WHERE u.id=$1`, signUp.User.ID).Scan(&storedPasswordHash, &storedTokenDigest); err != nil {
		t.Fatalf("read stored browser credential: %v", err)
	}
	wantTokenDigest := sha256.Sum256([]byte(signUp.Token))
	if storedPasswordHash == "correct horse battery" || !bytes.Equal(storedTokenDigest, wantTokenDigest[:]) {
		t.Fatal("PostgreSQL did not retain only hashed password and session-token material")
	}
	if principal, err := browserauth.NewService(browserauthpostgres.New(pool), time.Hour).Authenticate(ctx, signUp.Token); err != nil || principal.User.ID != signUp.User.ID {
		t.Fatalf("reconstruct browser session principal = %#v, %v", principal, err)
	}

	owner := cloudworkspace.Actor{ID: "phase3b-owner"}
	workspace := cloudworkspace.NewService(cloudworkspacepostgres.New(pool))
	organization, err := workspace.CreateOrganization(ctx, owner, "Phase 3B")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	project, err := workspace.CreateProject(ctx, owner, organization.ID, "publishing", "Publishing")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	environments, err := workspace.ListEnvironments(ctx, owner, project.ID, cloudworkspace.ListOptions{})
	if err != nil || len(environments.Items) < 2 {
		t.Fatalf("list environments: %#v %v", environments, err)
	}
	var environment, otherEnvironment, productionEnvironment cloudworkspace.Environment
	for _, candidate := range environments.Items {
		switch candidate.Mode {
		case cloudworkspace.EnvironmentDevelopment:
			environment = candidate
		case cloudworkspace.EnvironmentStaging:
			otherEnvironment = candidate
		case cloudworkspace.EnvironmentProduction:
			productionEnvironment = candidate
		}
	}
	if environment.ID == "" || otherEnvironment.ID == "" || productionEnvironment.ID == "" {
		t.Fatalf("explicit Environment modes missing: %#v", environments.Items)
	}
	application, err := workspace.CreateApplication(ctx, owner, project.ID, "Publishing iOS", cloudworkspace.PlatformIOS, "com.example.publishing")
	if err != nil {
		t.Fatalf("create publishing application: %v", err)
	}
	catalogProduct, err := workspace.CreateProduct(ctx, owner, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription)
	if err != nil {
		t.Fatalf("create product: %v", err)
	}
	publicKey, err := workspace.CreateAPIKey(ctx, owner, environment.ID, cloudworkspace.APIKeyPublicSDK, application.ID)
	if err != nil {
		t.Fatalf("create public SDK key: %v", err)
	}
	if publicKey.APIKey.ApplicationID != application.ID {
		t.Fatalf("public SDK key application binding = %q, want %q", publicKey.APIKey.ApplicationID, application.ID)
	}
	if _, err = workspace.CreateAPIKey(ctx, owner, environment.ID, cloudworkspace.APIKeyPublicSDK); !errors.Is(err, cloudworkspace.ErrNotFound) {
		t.Fatalf("create unbound public SDK key error = %v, want not found", err)
	}
	otherPublicKey, err := workspace.CreateAPIKey(ctx, owner, otherEnvironment.ID, cloudworkspace.APIKeyPublicSDK, application.ID)
	if err != nil {
		t.Fatalf("create second Environment public SDK key: %v", err)
	}

	publishingRepository := hostedpublishingpostgres.New(pool)
	protocolSchema, err := os.Open(filepath.Join("../../../../../protocol/schema/v0.3/paywall.schema.json"))
	if err != nil {
		t.Fatalf("open Protocol 0.3 schema: %v", err)
	}
	protocolValidator, err := hostedpublishing.CompileProtocolValidator(protocolSchema)
	_ = protocolSchema.Close()
	if err != nil {
		t.Fatalf("compile Protocol 0.3 validator: %v", err)
	}
	objects := &testObjectStore{objects: make(map[string][]byte)}
	publishingOptions := []hostedpublishing.ServiceOption{
		hostedpublishing.WithProtocolValidator(protocolValidator),
		hostedpublishing.WithObjectStore(objects, "https://assets.example/v1/sdk/assets", 1024),
	}
	publishing := hostedpublishing.NewService(publishingRepository, publishingOptions...)
	actor := hostedpublishing.Actor{ID: owner.ID}
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	asset, err := publishing.UploadAsset(ctx, actor, project.ID, "hero.png", "image/png", bytes.NewReader(png))
	if err != nil || asset.Status != "ready" {
		t.Fatalf("persist hosted Asset = %#v, %v", asset, err)
	}
	opened, err := publishing.OpenAsset(ctx, asset.ID, asset.ContentDigest)
	if err != nil {
		t.Fatalf("open hosted Asset: %v", err)
	}
	storedAssetBytes, readErr := io.ReadAll(opened.Body)
	_ = opened.Body.Close()
	if readErr != nil || !bytes.Equal(storedAssetBytes, png) {
		t.Fatalf("hosted Asset bytes = %x, %v", storedAssetBytes, readErr)
	}
	paywall, err := publishing.CreatePaywall(ctx, actor, project.ID, "onboarding", "Onboarding")
	if err != nil {
		t.Fatalf("create paywall: %v", err)
	}
	document, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/v0.3/navigation-only.json"))
	if err != nil {
		t.Fatalf("read canonical Protocol fixture: %v", err)
	}
	if _, err := publishing.CreateDraft(ctx, actor, project.ID, paywall.ID, environment.ID, document, "", "mismatched-document-id"); !errors.Is(err, hostedpublishing.ErrValidationFailed) {
		t.Fatalf("create Draft with mismatched Protocol document ID error = %v, want validation failure", err)
	}
	var hostedDocument map[string]any
	if err := json.Unmarshal(document, &hostedDocument); err != nil {
		t.Fatalf("decode canonical Protocol fixture: %v", err)
	}
	hostedDocument["id"] = paywall.ID
	bindHostedImage(t, hostedDocument, asset.URL)
	document, err = json.Marshal(hostedDocument)
	if err != nil {
		t.Fatalf("encode hosted Protocol document: %v", err)
	}
	draft, err := publishing.CreateDraft(ctx, actor, project.ID, paywall.ID, environment.ID, document, "", "create-draft")
	if err != nil {
		t.Fatalf("create draft: %v", err)
	}
	reconstructedPublishing := hostedpublishing.NewService(hostedpublishingpostgres.New(pool), publishingOptions...)
	active, err := reconstructedPublishing.GetActiveDraft(ctx, actor, project.ID, paywall.ID, environment.ID)
	if err != nil || active.Draft.ID != draft.Draft.ID || !jsonEquivalent(active.Document, draft.Document) {
		t.Fatalf("reconstructed active Draft = %#v, %v", active, err)
	}
	updatedDocument := bytes.ReplaceAll(document, []byte("View details"), []byte("View updated details"))
	updated, err := publishing.UpdateDraft(ctx, actor, project.ID, paywall.ID, draft.Draft.ID, draft.ETag, "save-1", updatedDocument)
	if err != nil {
		t.Fatalf("update draft: %v", err)
	}
	if _, err := publishing.UpdateDraft(ctx, actor, project.ID, paywall.ID, draft.Draft.ID, draft.ETag, "save-stale", document); !errors.Is(err, hostedpublishing.ErrDraftRevisionConflict) {
		t.Fatalf("stale update error=%v, want revision conflict", err)
	}
	advancedDocument := bytes.ReplaceAll(updatedDocument, []byte("View updated details"), []byte("View final details"))
	advanced, err := publishing.UpdateDraft(ctx, actor, project.ID, paywall.ID, draft.Draft.ID, updated.ETag, "save-2", advancedDocument)
	if err != nil {
		t.Fatalf("advance draft after first idempotent mutation: %v", err)
	}
	replayed, err := publishing.UpdateDraft(ctx, actor, project.ID, paywall.ID, draft.Draft.ID, draft.ETag, "save-1", updatedDocument)
	if err != nil || replayed.Draft.CurrentRevision != updated.Draft.CurrentRevision || replayed.ETag != updated.ETag || !jsonEquivalent(replayed.Document, updated.Document) || replayed.Draft.UpdatedAt != updated.Draft.UpdatedAt {
		t.Fatalf("idempotent replay mismatch: replay_revision=%d original_revision=%d replay_etag=%q original_etag=%q document_equal=%t replay_updated_at=%s original_updated_at=%s err=%v", replayed.Draft.CurrentRevision, updated.Draft.CurrentRevision, replayed.ETag, updated.ETag, jsonEquivalent(replayed.Document, updated.Document), replayed.Draft.UpdatedAt.Format(time.RFC3339Nano), updated.Draft.UpdatedAt.Format(time.RFC3339Nano), err)
	}
	if _, err := publishing.UpdateDraft(ctx, actor, project.ID, paywall.ID, draft.Draft.ID, advanced.ETag, "save-1", updatedDocument); !errors.Is(err, hostedpublishing.ErrIdempotencyConflict) {
		t.Fatalf("reused mutation key with a different base error=%v, want idempotency conflict", err)
	}
	placement, err := publishing.CreatePlacement(ctx, actor, project.ID, "onboarding_complete", "Onboarding complete", "")
	if err != nil {
		t.Fatalf("create placement: %v", err)
	}
	if _, err := publishing.BindPlacement(ctx, actor, project.ID, environment.ID, placement.ID, paywall.ID); err != nil {
		t.Fatalf("bind placement: %v", err)
	}
	command := hostedpublishing.PublishCommand{ProjectID: project.ID, EnvironmentID: environment.ID, DraftID: draft.Draft.ID, ExpectedRevision: advanced.Draft.CurrentRevision, AcknowledgeMockProducts: true, IdempotencyKey: "publish-1"}
	published, err := publishing.Publish(ctx, actor, command)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	retried, err := publishing.Publish(ctx, actor, command)
	if err != nil || retried.Release.ID != published.Release.ID {
		t.Fatalf("publish retry release=%#v err=%v", retried.Release, err)
	}
	configuration, err := publishing.AuthenticateSDKKey(ctx, publicKey.Secret)
	if err != nil || configuration.Release.ID != published.Release.ID || configuration.Environment.ID != environment.ID {
		t.Fatalf("SDK delivery configuration=%#v err=%v", configuration, err)
	}
	if !bytes.Contains(configuration.Release.Payload, []byte("View final details")) || !bytes.Contains(configuration.Release.Payload, []byte(asset.ID)) {
		t.Fatalf("published payload omitted immutable Draft snapshot: %s", configuration.Release.Payload)
	}
	if _, err := publishing.AuthenticateSDKKey(ctx, otherPublicKey.Secret); !errors.Is(err, hostedpublishing.ErrNoCurrentRelease) {
		t.Fatalf("unpublished second Environment key observed another Environment release: %v", err)
	}
	otherDocument := bytes.ReplaceAll(advancedDocument, []byte("View final details"), []byte("View other Environment details"))
	otherDraft, err := publishing.CreateDraft(ctx, actor, project.ID, paywall.ID, otherEnvironment.ID, otherDocument, "", "create-other-environment-draft")
	if err != nil {
		t.Fatalf("create second Environment draft: %v", err)
	}
	if _, err := publishing.BindPlacement(ctx, actor, project.ID, otherEnvironment.ID, placement.ID, paywall.ID); err != nil {
		t.Fatalf("bind second Environment placement: %v", err)
	}
	otherPublished, err := publishing.Publish(ctx, actor, hostedpublishing.PublishCommand{
		ProjectID: project.ID, EnvironmentID: otherEnvironment.ID, DraftID: otherDraft.Draft.ID,
		ExpectedRevision: otherDraft.Draft.CurrentRevision, AcknowledgeMockProducts: true, IdempotencyKey: "publish-other-environment",
	})
	if err != nil {
		t.Fatalf("publish second Environment: %v", err)
	}
	firstConfiguration, firstErr := publishing.AuthenticateSDKKey(ctx, publicKey.Secret)
	otherConfiguration, otherErr := publishing.AuthenticateSDKKey(ctx, otherPublicKey.Secret)
	if firstErr != nil || otherErr != nil || firstConfiguration.Environment.ID != environment.ID || otherConfiguration.Environment.ID != otherEnvironment.ID ||
		firstConfiguration.Release.ID != published.Release.ID || otherConfiguration.Release.ID != otherPublished.Release.ID ||
		bytes.Contains(firstConfiguration.Release.Payload, []byte("other Environment")) || !bytes.Contains(otherConfiguration.Release.Payload, []byte("other Environment")) {
		t.Fatalf("two-key Environment isolation failed: first=%#v/%v other=%#v/%v", firstConfiguration, firstErr, otherConfiguration, otherErr)
	}
	yearlyProduct, err := workspace.CreateProduct(ctx, owner, project.ID, "yearly", "Yearly", "", cloudworkspace.ProductSubscription)
	if err != nil {
		t.Fatalf("create second production Product: %v", err)
	}
	productionDocument, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/v0.3/hidden-purchase-target.json"))
	if err != nil {
		t.Fatalf("read production Protocol fixture: %v", err)
	}
	var productionProtocol map[string]any
	if err := json.Unmarshal(productionDocument, &productionProtocol); err != nil {
		t.Fatalf("decode production Protocol fixture: %v", err)
	}
	productionProtocol["id"] = paywall.ID
	productionProducts := productionProtocol["products"].([]any)
	productionProducts[0].(map[string]any)["productId"] = catalogProduct.ID
	productionProducts[1].(map[string]any)["productId"] = yearlyProduct.ID
	productionDocument, err = json.Marshal(productionProtocol)
	if err != nil {
		t.Fatalf("encode production Protocol document: %v", err)
	}
	productionDraft, err := publishing.CreateDraft(ctx, actor, project.ID, paywall.ID, productionEnvironment.ID, productionDocument, "", "create-production-draft")
	if err != nil {
		t.Fatalf("create production Draft: %v", err)
	}
	if _, err := publishing.BindPlacement(ctx, actor, project.ID, productionEnvironment.ID, placement.ID, paywall.ID); err != nil {
		t.Fatalf("bind production placement: %v", err)
	}
	if _, err := publishing.Publish(ctx, actor, hostedpublishing.PublishCommand{
		ProjectID: project.ID, EnvironmentID: productionEnvironment.ID, DraftID: productionDraft.Draft.ID,
		ExpectedRevision: productionDraft.Draft.CurrentRevision, AcknowledgeMockProducts: true, IdempotencyKey: "publish-production-not-ready",
	}); !errors.Is(err, hostedpublishing.ErrProviderReadiness) {
		t.Fatalf("production publish without scoped provider readiness error=%v, want provider readiness", err)
	}
	usage, err := publishing.GetAssetUsage(ctx, actor, project.ID, asset.ID)
	if err != nil || usage.DraftReferences < 2 || usage.VersionReferences != 2 || usage.ReleaseReferences != 2 {
		t.Fatalf("Asset usage did not include Draft/Version/Release references: %#v, %v", usage, err)
	}
	if _, err := publishing.GetActiveDraft(ctx, actor, project.ID, paywall.ID, environment.ID); !errors.Is(err, hostedpublishing.ErrNotFound) {
		t.Fatalf("published Draft remained discoverable as active: %v", err)
	}
	archivedAsset, err := publishing.ArchiveAsset(ctx, actor, project.ID, asset.ID)
	if err != nil || archivedAsset.Status != "archived" {
		t.Fatalf("archive hosted Asset = %#v, %v", archivedAsset, err)
	}
	if opened, err := reconstructedPublishing.OpenAsset(ctx, asset.ID, asset.ContentDigest); err != nil {
		t.Fatalf("archived Asset bytes were not retained for immutable history: %v", err)
	} else {
		_ = opened.Body.Close()
	}
	blockedDraft, err := publishing.CreateDraft(ctx, actor, project.ID, paywall.ID, environment.ID, advancedDocument, "", "archived-asset-draft")
	if err != nil {
		t.Fatalf("create Draft that references archived Asset: %v", err)
	}
	if _, err := publishing.Publish(ctx, actor, hostedpublishing.PublishCommand{
		ProjectID: project.ID, EnvironmentID: environment.ID, DraftID: blockedDraft.Draft.ID,
		ExpectedRevision: blockedDraft.Draft.CurrentRevision, AcknowledgeMockProducts: true, IdempotencyKey: "publish-archived-asset",
	}); !errors.Is(err, hostedpublishing.ErrAssetNotReady) {
		t.Fatalf("archived Asset was accepted for a new publication: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE paywall_versions SET document_hash=$2 WHERE id=$1`, extractVersionID(t, configuration.Release.Payload), strings.Repeat("0", 64)); err == nil {
		t.Fatal("database allowed immutable Paywall Version update")
	}
	rolledBack, err := publishing.Rollback(ctx, actor, project.ID, environment.ID, published.Release.ID, "rollback-1")
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if rolledBack.ID == published.Release.ID || rolledBack.ReleaseNumber != published.Release.ReleaseNumber+1 || rolledBack.RollbackSourceReleaseID != published.Release.ID {
		t.Fatalf("rollback did not create new immutable release: %#v", rolledBack)
	}
	assertReleaseSnapshotEqual(t, published.Release.Payload, rolledBack.Payload)
}

func assertReleaseSnapshotEqual(t *testing.T, target, rollback []byte) {
	t.Helper()
	decode := func(value []byte) map[string]any {
		var envelope map[string]any
		if err := json.Unmarshal(value, &envelope); err != nil {
			t.Fatal(err)
		}
		release := envelope["release"].(map[string]any)
		for _, key := range []string{"id", "number", "publishedAt", "contentDigest"} {
			delete(release, key)
		}
		return release
	}
	if !reflect.DeepEqual(decode(target), decode(rollback)) {
		t.Fatal("rollback did not preserve the target immutable Release snapshot")
	}
}

func bindHostedImage(t *testing.T, document map[string]any, assetURL string) {
	t.Helper()
	localization := document["localization"].(map[string]any)
	locales := localization["locales"].(map[string]any)
	for _, localeValue := range locales {
		locale := localeValue.(map[string]any)
		strings := locale["strings"].(map[string]any)
		strings["hosted.hero.unavailable"] = "Hero unavailable"
	}
	compatibility := document["compatibility"].(map[string]any)
	required := compatibility["requiredCapabilities"].([]any)
	for _, name := range []string{"component.image", "asset.remoteImage", "fallback.asset"} {
		required = append(required, map[string]any{"name": name, "version": "0.3"})
	}
	compatibility["requiredCapabilities"] = required
	document["assets"] = []any{map[string]any{
		"type": "image", "id": "hosted-hero", "source": map[string]any{"type": "remote", "url": assetURL},
		"fallback": map[string]any{"type": "placeholder", "value": map[string]any{
			"default": "Hero unavailable", "localizationKey": "hosted.hero.unavailable",
		}},
	}}
	screens := document["screens"].([]any)
	firstScreen := screens[0].(map[string]any)
	layout := firstScreen["layout"].(map[string]any)
	content := layout["content"].(map[string]any)
	children := content["children"].([]any)
	content["children"] = append([]any{map[string]any{
		"type": "image", "id": "hosted-hero-image", "assetId": "hosted-hero", "contentMode": "fit",
		"accessibility": map[string]any{"hidden": true},
	}}, children...)
}

func extractVersionID(t *testing.T, payload []byte) string {
	t.Helper()
	var envelope struct {
		Release struct {
			PaywallVersions []struct {
				ID string `json:"id"`
			} `json:"paywallVersions"`
		} `json:"release"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil || len(envelope.Release.PaywallVersions) != 1 {
		t.Fatalf("decode release payload: %v %#v", err, envelope)
	}
	return envelope.Release.PaywallVersions[0].ID
}

func jsonEquivalent(first, second []byte) bool {
	var left, right any
	return json.Unmarshal(first, &left) == nil && json.Unmarshal(second, &right) == nil && reflect.DeepEqual(left, right)
}

func concurrent(t *testing.T, first, second func() error) []error {
	t.Helper()
	start := make(chan struct{})
	errs := make([]error, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() { defer wait.Done(); <-start; errs[0] = first() }()
	go func() { defer wait.Done(); <-start; errs[1] = second() }()
	close(start)
	wait.Wait()
	return errs
}

func countNil(errs []error) int {
	count := 0
	for _, err := range errs {
		if err == nil {
			count++
		}
	}
	return count
}
func countError(errs []error, target error) int {
	count := 0
	for _, err := range errs {
		if errors.Is(err, target) {
			count++
		}
	}
	return count
}

func openSQL(t *testing.T, databaseURL string) *sql.DB {
	t.Helper()
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	return stdlib.OpenDB(*config)
}

// resetAndMigrate delegates to the shared pgtest helper so the migration
// phase carries its own deadline and its failures name the real cause.
func resetAndMigrate(t *testing.T, db *sql.DB, upTo int64) {
	t.Helper()
	if err := pgtest.ResetAndMigrate(db, upTo); err != nil {
		t.Fatal(err)
	}
}

type testObjectStore struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (*testObjectStore) Check(context.Context) error { return nil }

func (store *testObjectStore) Put(_ context.Context, key string, reader io.Reader, _ int64, _ string) error {
	content, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.objects[key] = append([]byte(nil), content...)
	return nil
}

func (store *testObjectStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	content, ok := store.objects[key]
	if !ok {
		return nil, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(append([]byte(nil), content...))), nil
}

func (store *testObjectStore) Delete(_ context.Context, key string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.objects, key)
	return nil
}

var _ hostedpublishing.ObjectStore = (*testObjectStore)(nil)
