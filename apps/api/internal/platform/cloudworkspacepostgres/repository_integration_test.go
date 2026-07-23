package cloudworkspacepostgres_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
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
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func TestPhase3APersistenceRisks(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openSQL(t, databaseURL)
	defer db.Close()
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.DownToContext(ctx, db, ".", 0); err != nil {
		t.Fatalf("reset migrations: %v", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations to empty PostgreSQL: %v", err)
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
	createdKey, err := service.CreateAPIKey(ctx, owner, environments.Items[0].ID, cloudworkspace.APIKeySecretServer)
	if err != nil {
		t.Fatalf("create API key: %v", err)
	}
	if createdKey.Secret == "" {
		t.Fatal("one-time API key secret was not returned")
	}
	var digest []byte
	if err := pool.QueryRow(ctx, `SELECT secret_digest FROM api_keys WHERE id=$1`, createdKey.APIKey.ID).Scan(&digest); err != nil {
		t.Fatal(err)
	}
	if len(digest) != 32 {
		t.Fatalf("stored digest length=%d, want 32", len(digest))
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

func TestPhase3BPublishingPersistenceRisks(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openSQL(t, databaseURL)
	defer db.Close()
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.DownToContext(ctx, db, ".", 0); err != nil {
		t.Fatalf("reset migrations: %v", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply Phase 3B migrations: %v", err)
	}
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
	environment := environments.Items[0]
	otherEnvironment := environments.Items[1]
	if _, err := workspace.CreateProduct(ctx, owner, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription); err != nil {
		t.Fatalf("create product: %v", err)
	}
	publicKey, err := workspace.CreateAPIKey(ctx, owner, environment.ID, cloudworkspace.APIKeyPublicSDK)
	if err != nil {
		t.Fatalf("create public SDK key: %v", err)
	}
	otherPublicKey, err := workspace.CreateAPIKey(ctx, owner, otherEnvironment.ID, cloudworkspace.APIKeyPublicSDK)
	if err != nil {
		t.Fatalf("create second Environment public SDK key: %v", err)
	}

	publishingRepository := hostedpublishingpostgres.New(pool)
	protocolSchema, err := os.Open(filepath.Join("../../../../../protocol/schema/v0.2/paywall.schema.json"))
	if err != nil {
		t.Fatalf("open Protocol 0.2 schema: %v", err)
	}
	protocolValidator, err := hostedpublishing.CompileProtocolValidator(protocolSchema)
	_ = protocolSchema.Close()
	if err != nil {
		t.Fatalf("compile Protocol 0.2 validator: %v", err)
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
	document, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/v0.2/navigation-only.json"))
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
		required = append(required, map[string]any{"name": name, "version": "0.2"})
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
