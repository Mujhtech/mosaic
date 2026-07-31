package cloudworkspace_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacememory"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

var fixedTime = time.Date(2026, time.July, 20, 18, 0, 0, 0, time.UTC)

func newService(options ...cloudworkspace.ServiceOption) (*cloudworkspace.Service, *cloudworkspacememory.Repository) {
	repository := cloudworkspacememory.New()
	options = append([]cloudworkspace.ServiceOption{cloudworkspace.WithClock(func() time.Time { return fixedTime })}, options...)
	return cloudworkspace.NewService(repository, options...), repository
}

func TestAuthorizationAndLastOwnerIntegrity(t *testing.T) {
	service, _ := newService()
	owner := cloudworkspace.Actor{ID: "actor-owner"}
	admin := cloudworkspace.Actor{ID: "actor-admin"}
	member := cloudworkspace.Actor{ID: "actor-member"}
	outsider := cloudworkspace.Actor{ID: "actor-outsider"}
	ctx := context.Background()

	organization, err := service.CreateOrganization(ctx, owner, "Acme")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	if _, err := service.AddMember(ctx, owner, organization.ID, admin.ID, cloudworkspace.RoleAdmin); err != nil {
		t.Fatalf("add admin: %v", err)
	}
	if _, err := service.AddMember(ctx, owner, organization.ID, member.ID, cloudworkspace.RoleMember); err != nil {
		t.Fatalf("add member: %v", err)
	}

	if _, err := service.CreateProject(ctx, member, organization.ID, "mobile", "Mobile"); !errors.Is(err, cloudworkspace.ErrForbidden) {
		t.Fatalf("member create project error = %v, want forbidden", err)
	}
	if _, err := service.GetOrganization(ctx, outsider, organization.ID); !errors.Is(err, cloudworkspace.ErrForbidden) {
		t.Fatalf("outsider get organization error = %v, want forbidden", err)
	}
	if _, err := service.UpdateMember(ctx, admin, organization.ID, owner.ID, cloudworkspace.RoleMember); !errors.Is(err, cloudworkspace.ErrForbidden) {
		t.Fatalf("admin demote owner error = %v, want forbidden", err)
	}
	if _, err := service.UpdateMember(ctx, owner, organization.ID, owner.ID, cloudworkspace.RoleMember); !errors.Is(err, cloudworkspace.ErrLastOwner) {
		t.Fatalf("final owner demotion error = %v, want last owner", err)
	}

	if _, err := service.UpdateMember(ctx, owner, organization.ID, admin.ID, cloudworkspace.RoleOwner); err != nil {
		t.Fatalf("promote second owner: %v", err)
	}
	if _, err := service.UpdateMember(ctx, owner, organization.ID, owner.ID, cloudworkspace.RoleMember); err != nil {
		t.Fatalf("demote non-final owner: %v", err)
	}
}

func TestCatalogRelationshipsLifecycleUsageAndPlaceholders(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, err := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	otherProject, _ := service.CreateProject(ctx, actor, organization.ID, "other", "Other")

	environments, err := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	if err != nil {
		t.Fatalf("list environments: %v", err)
	}
	if len(environments.Items) != 3 || environments.Items[0].Key != "development" || environments.Items[2].Key != "staging" {
		t.Fatalf("default environments = %#v", environments.Items)
	}

	plan, _ := service.CreatePlan(ctx, actor, project.ID, "pro", "Pro", "")
	monthly, _ := service.CreateProduct(ctx, actor, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription)
	yearly, _ := service.CreateProduct(ctx, actor, project.ID, "yearly", "Yearly", "", cloudworkspace.ProductSubscription)
	other, _ := service.CreateProduct(ctx, actor, otherProject.ID, "other", "Other", "", cloudworkspace.ProductSubscription)
	entitlement, _ := service.CreateEntitlement(ctx, actor, project.ID, "pro", "Pro", "")
	otherEntitlement, _ := service.CreateEntitlement(ctx, actor, otherProject.ID, "other", "Other", "")

	if _, err := service.AddPlanProduct(ctx, actor, plan.ID, other.ID); !errors.Is(err, cloudworkspace.ErrReplacementInvalid) {
		t.Fatalf("cross-project Plan membership error = %v", err)
	}
	if _, err := service.AddProductEntitlement(ctx, actor, monthly.ID, otherEntitlement.ID); !errors.Is(err, cloudworkspace.ErrReplacementInvalid) {
		t.Fatalf("cross-project grant error = %v", err)
	}
	if _, err := service.AddPlanProduct(ctx, actor, plan.ID, monthly.ID); err != nil {
		t.Fatalf("add Plan Product: %v", err)
	}
	if _, err := service.AddProductEntitlement(ctx, actor, monthly.ID, entitlement.ID); err != nil {
		t.Fatalf("grant Entitlement: %v", err)
	}

	application, _ := service.CreateApplication(ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.app")
	mapping, err := service.CreateProviderMapping(ctx, actor, monthly.ID, application.ID, cloudworkspace.ProviderAppStore, "monthly_pro")
	if err != nil {
		t.Fatalf("create placeholder: %v", err)
	}
	if mapping.Status != "placeholder" {
		t.Fatalf("mapping status = %q", mapping.Status)
	}
	readiness, _ := service.ProductReadiness(ctx, actor, monthly.ID)
	if readiness.Ready || readiness.MetadataSource != cloudworkspace.MetadataMock {
		t.Fatalf("placeholder asserted provider readiness: %#v", readiness)
	}

	usage, err := service.ProductUsage(ctx, actor, monthly.ID)
	if err != nil {
		t.Fatalf("get usage: %v", err)
	}
	if len(usage.Plans) != 1 || len(usage.Entitlements) != 1 || len(usage.ProviderMappings) != 1 {
		t.Fatalf("usage = %#v", usage)
	}
	if err := service.DeleteProduct(ctx, actor, monthly.ID); !errors.Is(err, cloudworkspace.ErrProductReferenced) {
		t.Fatalf("delete referenced Product error = %v", err)
	}

	archived, _ := service.ArchiveProduct(ctx, actor, monthly.ID)
	restored, _ := service.RestoreProduct(ctx, actor, monthly.ID)
	if archived.ID != monthly.ID || restored.ID != monthly.ID || restored.Status != cloudworkspace.ProductDraft {
		t.Fatalf("archive/restore did not preserve identity: %#v %#v", archived, restored)
	}
	if _, err := service.SetProductReplacement(ctx, actor, monthly.ID, yearly.ID); err != nil {
		t.Fatalf("set replacement: %v", err)
	}
	if _, err := service.SetProductReplacement(ctx, actor, monthly.ID, monthly.ID); !errors.Is(err, cloudworkspace.ErrReplacementInvalid) {
		t.Fatalf("self replacement error = %v", err)
	}
}

func TestNativeGooglePlayMappingObservationAndReplacementLifecycle(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	application, _ := service.CreateApplication(ctx, actor, project.ID, "Android", cloudworkspace.PlatformAndroid, "com.example.app")
	product, _ := service.CreateProduct(ctx, actor, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription)
	entitlement, _ := service.CreateEntitlement(ctx, actor, project.ID, "pro", "Pro", "")
	if _, err := service.AddProductEntitlement(ctx, actor, product.ID, entitlement.ID); err != nil {
		t.Fatalf("grant entitlement: %v", err)
	}
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	development := environments.Items[0]

	assignment, err := service.SetActiveProviderAssignment(ctx, actor, development.ID, application.ID, cloudworkspace.SetActiveProviderAssignmentInput{
		Provider: cloudworkspace.ProviderGooglePlay, ActivationKind: cloudworkspace.ProviderActivationNativeStore,
	})
	if err != nil {
		t.Fatalf("activate native Google Play: %v", err)
	}
	if assignment.ConnectionID != "" || assignment.Provider != cloudworkspace.ProviderGooglePlay {
		t.Fatalf("native assignment = %#v", assignment)
	}
	if _, err := service.CreateProviderMappingDraft(ctx, actor, product.ID, cloudworkspace.CreateProviderMappingDraftInput{
		Provider: cloudworkspace.ProviderGooglePlay, EnvironmentID: development.ID,
		ApplicationID: application.ID, ProviderProductIdentifier: "monthly",
	}); !errors.Is(err, cloudworkspace.ErrMappingTargetInvalid) {
		t.Fatalf("subscription without base plan error = %v, want invalid target", err)
	}

	mapping, err := service.CreateProviderMappingDraft(ctx, actor, product.ID, cloudworkspace.CreateProviderMappingDraftInput{
		Provider: cloudworkspace.ProviderGooglePlay, EnvironmentID: development.ID,
		ApplicationID: application.ID, ProviderProductIdentifier: "monthly",
		ProviderBasePlanIdentifier: "monthly-auto", ProviderOfferIdentifier: "intro",
	})
	if err != nil {
		t.Fatalf("create native mapping: %v", err)
	}
	otherProduct, _ := service.CreateProduct(ctx, actor, project.ID, "monthly-alt", "Monthly alt", "", cloudworkspace.ProductSubscription)
	if _, err := service.CreateProviderMappingDraft(ctx, actor, otherProduct.ID, cloudworkspace.CreateProviderMappingDraftInput{
		Provider: cloudworkspace.ProviderGooglePlay, EnvironmentID: development.ID,
		ApplicationID: application.ID, ProviderProductIdentifier: "monthly",
		ProviderBasePlanIdentifier: "different-selector",
	}); !errors.Is(err, cloudworkspace.ErrConflict) {
		t.Fatalf("duplicate native provider target error = %v, want conflict", err)
	}
	readiness, err := service.ProviderReadiness(ctx, actor, product.ID, development.ID, application.ID)
	if err != nil || readiness.State != cloudworkspace.ProviderReadinessConfigured || len(readiness.Warnings) != 1 {
		t.Fatalf("configured readiness = %#v error=%v", readiness, err)
	}

	expiresAt := fixedTime.Add(time.Hour)
	if _, err := service.CreateProviderMappingObservation(ctx, actor, mapping.ID, cloudworkspace.CreateProviderMappingObservationInput{
		AdapterVersion: "1.0.0", StoreContext: cloudworkspace.ProviderObservationGooglePlayTest,
		Result: cloudworkspace.ProviderObservationAvailable, CorrelationID: "unsafe-run",
		Metadata: cloudworkspace.ProviderMappingObservationMetadata{ClientVersion: "secret-token"},
		ObservedAt: fixedTime, ExpiresAt: &expiresAt,
	}); !errors.Is(err, cloudworkspace.ErrMappingTargetInvalid) {
		t.Fatalf("sensitive observation metadata error = %v, want invalid target", err)
	}
	observation, err := service.CreateProviderMappingObservation(ctx, actor, mapping.ID, cloudworkspace.CreateProviderMappingObservationInput{
		AdapterVersion: "1.0.0", StoreContext: cloudworkspace.ProviderObservationGooglePlayTest,
		Result: cloudworkspace.ProviderObservationAvailable, CorrelationID: "test-run-1",
		Metadata: cloudworkspace.ProviderMappingObservationMetadata{
			ClientPlatform: cloudworkspace.ProviderObservationClientAndroid,
			ConfigurationSource: cloudworkspace.ProviderObservationConfigurationRemote,
			TestScenario: cloudworkspace.ProviderObservationScenarioProductLoad,
		},
		ObservedAt: fixedTime, ExpiresAt: &expiresAt,
	})
	if err != nil {
		t.Fatalf("record observation: %v", err)
	}
	readiness, err = service.ProviderReadiness(ctx, actor, product.ID, development.ID, application.ID)
	if err != nil || readiness.State != cloudworkspace.ProviderReadinessVerifiedInTest ||
		readiness.Observation == nil || readiness.Observation.ID != observation.ID {
		t.Fatalf("verified readiness = %#v error=%v", readiness, err)
	}

	replacement, err := service.ReplaceProviderMapping(ctx, actor, mapping.ID, cloudworkspace.ReplaceProviderMappingInput{
		ProviderProductIdentifier: "monthly-v2", ProviderBasePlanIdentifier: "monthly-v2-auto",
	})
	if err != nil {
		t.Fatalf("replace native mapping: %v", err)
	}
	if replacement.ReplacesMappingID != mapping.ID || replacement.Status != cloudworkspace.ProviderMappingActive {
		t.Fatalf("replacement = %#v", replacement)
	}
}

func TestProductReplacementGraphRejectsThreeNodeCycle(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	first, _ := service.CreateProduct(ctx, actor, project.ID, "first", "First", "", cloudworkspace.ProductSubscription)
	second, _ := service.CreateProduct(ctx, actor, project.ID, "second", "Second", "", cloudworkspace.ProductSubscription)
	third, _ := service.CreateProduct(ctx, actor, project.ID, "third", "Third", "", cloudworkspace.ProductSubscription)
	if _, err := service.SetProductReplacement(ctx, actor, first.ID, second.ID); err != nil {
		t.Fatalf("set first replacement: %v", err)
	}
	if _, err := service.SetProductReplacement(ctx, actor, second.ID, third.ID); err != nil {
		t.Fatalf("set second replacement: %v", err)
	}
	if _, err := service.SetProductReplacement(ctx, actor, third.ID, first.ID); !errors.Is(err, cloudworkspace.ErrReplacementInvalid) {
		t.Fatalf("three-node cycle error=%v, want replacement invalid", err)
	}
	unchanged, _ := service.GetProduct(ctx, actor, third.ID)
	if unchanged.ReplacementProductID != "" {
		t.Fatalf("rejected cycle mutated third Product: %#v", unchanged)
	}
}

func TestProductReplacementTargetCannotBeArchived(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	source, _ := service.CreateProduct(ctx, actor, project.ID, "source", "Source", "", cloudworkspace.ProductSubscription)
	target, _ := service.CreateProduct(ctx, actor, project.ID, "target", "Target", "", cloudworkspace.ProductSubscription)
	if _, err := service.SetProductReplacement(ctx, actor, source.ID, target.ID); err != nil {
		t.Fatalf("set replacement: %v", err)
	}
	if _, err := service.ArchiveProduct(ctx, actor, target.ID); !errors.Is(err, cloudworkspace.ErrReplacementInvalid) {
		t.Fatalf("archive replacement target error=%v, want replacement invalid", err)
	}
	unchanged, _ := service.GetProduct(ctx, actor, target.ID)
	if unchanged.Status != cloudworkspace.ProductDraft {
		t.Fatalf("rejected archive changed target status to %q", unchanged.Status)
	}
	sourceAfter, _ := service.GetProduct(ctx, actor, source.ID)
	if contains(sourceAfter.Readiness.Reasons, "replacement_invalid") {
		t.Fatalf("valid dependency reported invalid after rejected archive: %#v", sourceAfter.Readiness)
	}
}

func TestProductTypeChangeCannotInvalidateReplacement(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	source, _ := service.CreateProduct(ctx, actor, project.ID, "source", "Source", "", cloudworkspace.ProductSubscription)
	target, _ := service.CreateProduct(ctx, actor, project.ID, "target", "Target", "", cloudworkspace.ProductSubscription)
	if _, err := service.SetProductReplacement(ctx, actor, source.ID, target.ID); err != nil {
		t.Fatalf("set replacement: %v", err)
	}
	if _, err := service.UpdateProduct(ctx, actor, target.ID, target.Key, target.InternalName, target.Description, cloudworkspace.ProductOneTimeNonConsumable); !errors.Is(err, cloudworkspace.ErrReplacementInvalid) {
		t.Fatalf("incompatible target type change error=%v, want replacement invalid", err)
	}
	unchanged, _ := service.GetProduct(ctx, actor, target.ID)
	if unchanged.Type != cloudworkspace.ProductSubscription {
		t.Fatalf("rejected type change mutated target type to %q", unchanged.Type)
	}
}

func TestProviderFoundationEnforcesScopesModesLifecycleAndReadiness(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	otherProject, _ := service.CreateProject(ctx, actor, organization.ID, "other", "Other")
	application, _ := service.CreateApplication(ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.app")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	otherEnvironments, _ := service.ListEnvironments(ctx, actor, otherProject.ID, cloudworkspace.ListOptions{})
	var development, production cloudworkspace.Environment
	for _, environment := range environments.Items {
		switch environment.Mode {
		case cloudworkspace.EnvironmentDevelopment:
			development = environment
		case cloudworkspace.EnvironmentProduction:
			production = environment
		}
	}
	if development.ID == "" || production.ID == "" {
		t.Fatalf("default Environment modes are not explicit: %#v", environments.Items)
	}

	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Missing RevenueCat project", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
	}); !errors.Is(err, cloudworkspace.ErrProviderProjectInvalid) {
		t.Fatalf("missing RevenueCat project error = %v, want provider project invalid", err)
	}

	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Cross-project", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "rc-project-reference",
		EnvironmentIDs:    []string{otherEnvironments.Items[0].ID}, ApplicationIDs: []string{application.ID},
	}); !errors.Is(err, cloudworkspace.ErrScopeMismatch) {
		t.Fatalf("cross-project connection scope error = %v, want scope mismatch", err)
	}

	if _, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "RevenueCat invalid mixed scope", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "rc-project-reference",
		EnvironmentIDs:    []string{development.ID, production.ID},
		ApplicationIDs:    []string{application.ID},
	}); !errors.Is(err, cloudworkspace.ErrModeMismatch) {
		t.Fatalf("sandbox production scope error = %v, want mode mismatch", err)
	}

	connection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "RevenueCat sandbox", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "rc-project-reference",
		EnvironmentIDs:    []string{development.ID},
		ApplicationIDs:    []string{application.ID},
	})
	if err != nil {
		t.Fatalf("create provider connection: %v", err)
	}
	if connection.Status != cloudworkspace.ProviderConnectionPending || connection.HealthStatus != cloudworkspace.ProviderHealthUntested {
		t.Fatalf("new connection asserted provider health: %#v", connection)
	}
	if _, err := service.SetEnvironmentMode(ctx, actor, development.ID, cloudworkspace.EnvironmentProduction); !errors.Is(err, cloudworkspace.ErrModeMismatch) {
		t.Fatalf("scoped sandbox connection allowed production mode transition: %v", err)
	}
	if _, err := service.SetActiveProviderAssignment(ctx, actor, production.ID, application.ID, cloudworkspace.SetActiveProviderAssignmentInput{ConnectionID: connection.ID}); !errors.Is(err, cloudworkspace.ErrScopeMismatch) {
		t.Fatalf("out-of-scope production assignment error = %v, want scope mismatch", err)
	}
	assignment, err := service.SetActiveProviderAssignment(ctx, actor, development.ID, application.ID, cloudworkspace.SetActiveProviderAssignmentInput{ConnectionID: connection.ID})
	if err != nil {
		t.Fatalf("set development assignment: %v", err)
	}
	if assignment.Platform != cloudworkspace.PlatformIOS {
		t.Fatalf("assignment platform = %q, want ios", assignment.Platform)
	}

	product, _ := service.CreateProduct(ctx, actor, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription)
	entitlement, _ := service.CreateEntitlement(ctx, actor, project.ID, "pro", "Pro", "")
	if _, err := service.AddProductEntitlement(ctx, actor, product.ID, entitlement.ID); err != nil {
		t.Fatalf("grant entitlement: %v", err)
	}
	readiness, err := service.ProviderReadiness(ctx, actor, product.ID, development.ID, application.ID)
	if err != nil {
		t.Fatalf("evaluate readiness: %v", err)
	}
	if readiness.State != cloudworkspace.ProviderReadinessAttentionRequired ||
		!providerIssuePresent(readiness.Blockers, cloudworkspace.ProviderErrorProviderUnavailable) ||
		!providerIssuePresent(readiness.Blockers, cloudworkspace.ProviderErrorMappingMissing) ||
		!providerIssuePresent(readiness.Blockers, cloudworkspace.ProviderErrorMetadataStale) {
		t.Fatalf("pending connection readiness = %#v", readiness)
	}

	mapping, err := service.CreateProviderMappingDraft(ctx, actor, product.ID, cloudworkspace.CreateProviderMappingDraftInput{
		ConnectionID: connection.ID, EnvironmentID: development.ID, ApplicationID: application.ID,
		ProviderProductIdentifier: "monthly",
	})
	if err != nil {
		t.Fatalf("create mapping draft: %v", err)
	}
	if mapping.Status != cloudworkspace.ProviderMappingDraft || mapping.SyncState != cloudworkspace.ProviderSyncNeverSynced {
		t.Fatalf("mapping draft asserted provider state: %#v", mapping)
	}
	customConnection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "Custom SDK", Provider: cloudworkspace.ProviderCustom,
		IntegrationMode: cloudworkspace.ProviderSDKOnly, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{development.ID}, ApplicationIDs: []string{application.ID},
	})
	if err != nil {
		t.Fatalf("create custom connection: %v", err)
	}
	if _, err := service.CreateProviderMappingDraft(ctx, actor, product.ID, cloudworkspace.CreateProviderMappingDraftInput{
		ConnectionID: customConnection.ID, EnvironmentID: development.ID, ApplicationID: application.ID,
		ProviderProductIdentifier: "custom-monthly", ProviderPackageIdentifier: "monthly",
		ProviderOfferingIdentifier: "default",
	}); !errors.Is(err, cloudworkspace.ErrMappingTargetInvalid) {
		t.Fatalf("custom provider RevenueCat metadata error = %v, want mapping target invalid", err)
	}
	if _, err := service.ReplaceProviderConnectionScopes(ctx, actor, connection.ID, cloudworkspace.ReplaceProviderConnectionScopesInput{
		EnvironmentIDs: []string{production.ID}, ApplicationIDs: []string{application.ID},
	}); !errors.Is(err, cloudworkspace.ErrModeMismatch) {
		t.Fatalf("sandbox production replacement scope error = %v, want mode mismatch", err)
	}

	revoked, err := service.RevokeProviderConnection(ctx, actor, connection.ID)
	if err != nil {
		t.Fatalf("revoke connection: %v", err)
	}
	if revoked.Status != cloudworkspace.ProviderConnectionRevoked || revoked.RevokedAt == nil {
		t.Fatalf("revoked connection = %#v", revoked)
	}
	readiness, _ = service.ProviderReadiness(ctx, actor, product.ID, development.ID, application.ID)
	if readiness.State != cloudworkspace.ProviderReadinessUnavailable ||
		!providerIssuePresent(readiness.Blockers, cloudworkspace.ProviderErrorConnectionRevoked) {
		t.Fatalf("revoked connection readiness = %#v", readiness)
	}
}

type providerCatalogStub struct {
	catalog providercatalog.Catalog
	secrets []string
}

func (stub *providerCatalogStub) FetchCatalog(_ context.Context, credential providercatalog.Credential) (providercatalog.Catalog, error) {
	stub.secrets = append(stub.secrets, string(credential.Secret))
	return stub.catalog, nil
}

func TestProviderImportNormalizesSDKLookupKeysAndReusesEntitlementMapping(t *testing.T) {
	key := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))
	cipher, err := providercredential.NewAESGCMCipher(
		`{"version":1,"activeKeyId":"test-key","keys":{"test-key":"`+key+`"}}`,
		bytes.NewReader(bytes.Repeat([]byte{3}, 128)),
	)
	if err != nil {
		t.Fatal(err)
	}
	catalog := &providerCatalogStub{catalog: providercatalog.Catalog{
		ObservedAt: fixedTime.Add(-time.Minute),
		Apps: []providercatalog.App{{
			ID: "app_resource", Name: "iOS", Platform: "app_store", Identifier: "com.example.app",
		}},
		Products: []providercatalog.Product{
			{ID: "prod_monthly", AppID: "app_resource", StoreIdentifier: "com.example.monthly", Type: "subscription", State: "active"},
			{ID: "prod_yearly", AppID: "app_resource", StoreIdentifier: "com.example.yearly", Type: "subscription", State: "active"},
			{ID: "prod_replacement", AppID: "app_resource", StoreIdentifier: "com.example.monthly.v2", Type: "subscription", State: "active"},
		},
		Entitlements: []providercatalog.Entitlement{{
			ID: "ent_resource", LookupKey: "pro", DisplayName: "Pro", State: "active",
		}},
		Offerings: []providercatalog.Offering{{
			ID: "off_resource", LookupKey: "default", State: "active",
			Packages: []providercatalog.Package{{
				ID: "pkg_resource", LookupKey: "$rc_annual",
				ProductIDs: []string{"prod_monthly", "prod_yearly", "prod_replacement"},
			}},
		}},
	}}
	service, repository := newService(cloudworkspace.WithProviderOperations(cipher, catalog, 6*time.Hour))
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	application, _ := service.CreateApplication(ctx, actor, project.ID, "iOS", cloudworkspace.PlatformIOS, "com.example.app")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	var development, staging cloudworkspace.Environment
	for _, environment := range environments.Items {
		if environment.Mode == cloudworkspace.EnvironmentDevelopment {
			development = environment
		} else if environment.Mode == cloudworkspace.EnvironmentStaging {
			staging = environment
		}
	}
	connection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "RevenueCat", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "proj_resource", EnvironmentIDs: []string{development.ID},
		ApplicationIDs: []string{application.ID}, Credential: "sk_least_privilege",
	})
	if err != nil {
		t.Fatalf("create provider connection: %v", err)
	}
	health, err := service.ProviderConnectionHealth(ctx, actor, connection.ID)
	if err != nil {
		t.Fatalf("provider capability health: %v", err)
	}
	for _, capabilityName := range []string{"trials", "introductoryOffers"} {
		found := false
		for _, capability := range health.Capabilities {
			if capability.Name == capabilityName {
				found = capability.Support == "conditional" &&
					capability.ReasonCode == "provider.platformCapabilityVaries"
			}
		}
		if !found {
			t.Fatalf("%s capability overstated: %#v", capabilityName, health.Capabilities)
		}
	}
	result, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "import-lookup-normalization",
		Items: []cloudworkspace.ProviderProductImportInput{
			{
				ProviderProductIdentifier: "prod_monthly", ProviderOfferingIdentifier: "off_resource",
				ProviderPackageIdentifier: "pkg_resource", Key: "monthly", InternalName: "Monthly",
				EnvironmentID: development.ID, ApplicationID: application.ID,
				Entitlements: []cloudworkspace.ProviderEntitlementImportInput{{
					ProviderIdentifier: "ent_resource", Key: "pro", Name: "Pro",
				}},
			},
			{
				ProviderProductIdentifier: "prod_yearly", ProviderOfferingIdentifier: "off_resource",
				ProviderPackageIdentifier: "pkg_resource", Key: "yearly", InternalName: "Yearly",
				EnvironmentID: development.ID, ApplicationID: application.ID,
				Entitlements: []cloudworkspace.ProviderEntitlementImportInput{{
					ProviderIdentifier: "ent_resource", Key: "pro", Name: "Pro",
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("import provider products: %v", err)
	}
	if result.Import.Status != cloudworkspace.ProviderImportCompleted || len(result.Items) != 2 {
		t.Fatalf("import result = %#v", result)
	}
	replay, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "import-lookup-normalization",
		Items: []cloudworkspace.ProviderProductImportInput{
			{
				ProviderProductIdentifier: "prod_monthly", ProviderOfferingIdentifier: "off_resource",
				ProviderPackageIdentifier: "pkg_resource", Key: "monthly", InternalName: "Monthly",
				EnvironmentID: development.ID, ApplicationID: application.ID,
				Entitlements: []cloudworkspace.ProviderEntitlementImportInput{{ProviderIdentifier: "ent_resource", Key: "pro", Name: "Pro"}},
			},
			{
				ProviderProductIdentifier: "prod_yearly", ProviderOfferingIdentifier: "off_resource",
				ProviderPackageIdentifier: "pkg_resource", Key: "yearly", InternalName: "Yearly",
				EnvironmentID: development.ID, ApplicationID: application.ID,
				Entitlements: []cloudworkspace.ProviderEntitlementImportInput{{ProviderIdentifier: "ent_resource", Key: "pro", Name: "Pro"}},
			},
		},
	})
	if err != nil || replay.Import.ID != result.Import.ID {
		t.Fatalf("idempotent replay = %#v, %v", replay, err)
	}
	replacement, err := service.ReplaceProviderMapping(ctx, actor, result.Items[0].MappingID, cloudworkspace.ReplaceProviderMappingInput{
		ProviderProductIdentifier: "prod_replacement", ProviderOfferingIdentifier: "off_resource",
		ProviderPackageIdentifier: "pkg_resource",
	})
	if err != nil {
		t.Fatalf("replace verified provider mapping: %v", err)
	}
	if replacement.ProviderOfferingIdentifier != "default" ||
		replacement.ProviderPackageIdentifier != "$rc_annual" ||
		replacement.ExpectedStoreProductID != "com.example.monthly.v2" {
		t.Fatalf("replacement mapping did not use canonical values: %#v", replacement)
	}
	metadata, err := service.GetProviderMappingMetadata(ctx, actor, replacement.ID)
	if err != nil || metadata.MappingID != replacement.ID ||
		!bytes.Contains(metadata.Metadata, []byte(`"storeIdentifier":"com.example.monthly.v2"`)) {
		t.Fatalf("current normalized provider metadata = %#v, %v", metadata, err)
	}
	err = repository.View(ctx, func(reader cloudworkspace.Reader) error {
		for index, item := range result.Items {
			mapping, ok := reader.ProviderMapping(item.MappingID)
			if index == 0 {
				if !ok || mapping.Status != cloudworkspace.ProviderMappingArchived {
					t.Fatalf("replaced mapping was not archived: %#v", mapping)
				}
				continue
			}
			if !ok || mapping.ProviderOfferingIdentifier != "default" ||
				mapping.ProviderPackageIdentifier != "$rc_annual" ||
				!strings.HasPrefix(mapping.ExpectedStoreProductID, "com.example.") {
				t.Fatalf("mapping did not persist canonical SDK lookup values: %#v", mapping)
			}
		}
		entitlementMappings := reader.ProviderEntitlementMappings(connection.ID, development.ID, application.ID)
		if len(entitlementMappings) != 1 || entitlementMappings[0].ProviderEntitlementIdentifier != "pro" {
			t.Fatalf("entitlement mappings = %#v, want one canonical lookup mapping", entitlementMappings)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetActiveProviderAssignment(
		ctx, actor, development.ID, application.ID, cloudworkspace.SetActiveProviderAssignmentInput{ConnectionID: connection.ID},
	); err != nil {
		t.Fatalf("set active provider assignment: %v", err)
	}
	extraEntitlement, err := service.CreateEntitlement(ctx, actor, project.ID, "bonus", "Bonus", "")
	if err != nil {
		t.Fatalf("create second entitlement: %v", err)
	}
	if _, err := service.AddProductEntitlement(
		ctx, actor, result.Items[1].MosaicProductID, extraEntitlement.ID,
	); err != nil {
		t.Fatalf("grant second entitlement: %v", err)
	}
	multiGrantReadiness, err := service.ProviderReadiness(
		ctx, actor, result.Items[1].MosaicProductID, development.ID, application.ID,
	)
	if err != nil || !providerIssuePresent(multiGrantReadiness.Blockers, cloudworkspace.ProviderErrorMappingMissing) {
		t.Fatalf("multi-grant readiness = %#v, %v", multiGrantReadiness, err)
	}
	catalog.catalog.Products = []providercatalog.Product{{
		ID: "prod_yearly", AppID: "app_resource", StoreIdentifier: "com.example.yearly",
		Type: "subscription", State: "active",
	}}
	if _, err := service.EnqueueProviderSync(ctx, actor, connection.ID); err != nil {
		t.Fatalf("enqueue provider synchronization: %v", err)
	}
	processed, err := service.ProcessNextProviderSync(ctx, "worker_test")
	if err != nil || !processed {
		t.Fatalf("process provider synchronization: processed=%t err=%v", processed, err)
	}
	err = repository.View(ctx, func(reader cloudworkspace.Reader) error {
		afterFailure, ok := reader.ProviderMapping(replacement.ID)
		if !ok || afterFailure.SyncState != cloudworkspace.ProviderSyncFailed ||
			afterFailure.CurrentSnapshotID != replacement.CurrentSnapshotID {
			t.Fatalf("failed synchronization replaced last known-good snapshot: %#v", afterFailure)
		}
		runs := reader.ProviderSyncRuns(connection.ID)
		if len(runs) != 1 || runs[0].Status != "partial" ||
			runs[0].SuccessCount != 1 || runs[0].FailureCount != 1 {
			t.Fatalf("synchronization run = %#v", runs)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveProviderMapping(ctx, actor, replacement.ID); err != nil {
		t.Fatalf("archive replacement mapping before scope check: %v", err)
	}
	if _, err := service.ArchiveProviderMapping(ctx, actor, result.Items[1].MappingID); err != nil {
		t.Fatalf("archive second mapping before scope check: %v", err)
	}
	if err := service.ClearActiveProviderAssignment(ctx, actor, development.ID, application.ID); err != nil {
		t.Fatalf("clear assignment before entitlement-scope check: %v", err)
	}
	if _, err := service.ReplaceProviderConnectionScopes(
		ctx, actor, connection.ID,
		cloudworkspace.ReplaceProviderConnectionScopesInput{
			EnvironmentIDs: []string{staging.ID}, ApplicationIDs: []string{application.ID},
		},
	); !errors.Is(err, cloudworkspace.ErrScopeMismatch) {
		t.Fatalf("entitlement mapping scope replacement error = %v, want scope mismatch", err)
	}
	staleInput := cloudworkspace.ImportProviderProductsInput{
		IdempotencyKey: "expired-provider-import",
		Items: []cloudworkspace.ProviderProductImportInput{{
			ProviderProductIdentifier: "prod_yearly",
			ExistingProductID:         result.Items[1].MosaicProductID,
			EnvironmentID:             development.ID,
			ApplicationID:             application.ID,
		}},
	}
	requestMaterial, _ := json.Marshal(struct {
		ConnectionID string
		Items        []cloudworkspace.ProviderProductImportInput
	}{ConnectionID: connection.ID, Items: staleInput.Items})
	staleKeyHash := sha256.Sum256([]byte(staleInput.IdempotencyKey))
	staleRequestHash := sha256.Sum256(requestMaterial)
	staleImport := cloudworkspace.ProviderImportRequest{
		ID: "provider_import_expired", ProjectID: project.ID, ConnectionID: connection.ID,
		IdempotencyKeyHash: staleKeyHash, RequestHash: staleRequestHash,
		Status: cloudworkspace.ProviderImportInProgress, CreatedByActorID: actor.ID,
		CreatedAt: fixedTime.Add(-16 * time.Minute),
	}
	productCount := 0
	if err := repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		tx.SaveProviderImport(staleImport)
		productCount = len(tx.Products(project.ID))
		return nil
	}); err != nil {
		t.Fatalf("seed expired provider import: %v", err)
	}
	expiredReplay, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, staleInput)
	if err != nil || expiredReplay.Import.Status != cloudworkspace.ProviderImportPartial ||
		expiredReplay.Import.CompletedAt == nil || len(expiredReplay.Items) != 0 {
		t.Fatalf("expired provider import replay = %#v, %v", expiredReplay, err)
	}
	secondExpiredReplay, err := service.ImportProviderProducts(ctx, actor, project.ID, connection.ID, staleInput)
	if err != nil || secondExpiredReplay.Import.ID != staleImport.ID ||
		secondExpiredReplay.Import.Status != cloudworkspace.ProviderImportPartial {
		t.Fatalf("stable expired provider import replay = %#v, %v", secondExpiredReplay, err)
	}
	if err := repository.View(ctx, func(reader cloudworkspace.Reader) error {
		if got := len(reader.Products(project.ID)); got != productCount {
			t.Fatalf("expired import created duplicate Products: got %d want %d", got, productCount)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	publicConnection, err := service.GetProviderConnection(ctx, actor, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	material, _ := json.Marshal(publicConnection)
	if strings.Contains(string(material), "sk_least_privilege") || len(catalog.secrets) != 3 ||
		catalog.secrets[0] != "sk_least_privilege" || catalog.secrets[1] != "sk_least_privilege" ||
		catalog.secrets[2] != "sk_least_privilege" {
		t.Fatalf("credential handling leaked or replayed secret: response=%s calls=%d", material, len(catalog.secrets))
	}
}

func providerIssuePresent(issues []cloudworkspace.ProviderReadinessIssue, code cloudworkspace.ProviderErrorCode) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

func TestProviderSyncLeaseFencesConcurrentExpiredWorker(t *testing.T) {
	repository := cloudworkspacememory.New()
	ctx := context.Background()
	now := fixedTime
	job := cloudworkspace.ProviderSyncJob{
		ID: "sync_job_1", ProjectID: "project_1", ConnectionID: "connection_1",
		Status: cloudworkspace.ProviderSyncJobQueued, MaxAttempts: 5,
		AvailableAt: now, RequestedByActorID: "actor_1", CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		tx.SaveProviderSyncJob(job)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var firstLease cloudworkspace.ProviderSyncJob
	if err := repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		var ok bool
		firstLease, ok = tx.LeaseProviderSyncJob("worker_1", now, now.Add(time.Minute))
		if !ok {
			return errors.New("first worker did not lease sync job")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	expiredAt := now.Add(time.Minute)
	start := make(chan struct{})
	errs := make(chan error, 2)
	var secondLease cloudworkspace.ProviderSyncJob
	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	go func() {
		defer waitGroup.Done()
		<-start
		errs <- repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
			if tx.OwnsProviderSyncJobLease(firstLease.ID, "worker_1", firstLease.AttemptCount, expiredAt) {
				return errors.New("expired worker retained fenced lease")
			}
			return nil
		})
	}()
	go func() {
		defer waitGroup.Done()
		<-start
		errs <- repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
			var ok bool
			secondLease, ok = tx.LeaseProviderSyncJob("worker_2", expiredAt, expiredAt.Add(time.Minute))
			if !ok {
				return errors.New("second worker did not re-lease expired sync job")
			}
			return nil
		})
	}()
	close(start)
	waitGroup.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if secondLease.AttemptCount != firstLease.AttemptCount+1 {
		t.Fatalf("second lease attempt = %d, want %d", secondLease.AttemptCount, firstLease.AttemptCount+1)
	}
	if err := repository.Transact(ctx, func(tx cloudworkspace.Transaction) error {
		if tx.OwnsProviderSyncJobLease(firstLease.ID, "worker_1", firstLease.AttemptCount, expiredAt) {
			return errors.New("stale worker passed fencing after re-lease")
		}
		if !tx.OwnsProviderSyncJobLease(secondLease.ID, "worker_2", secondLease.AttemptCount, expiredAt) {
			return errors.New("current worker failed fencing check")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestListRejectsMalformedAndStaleCursors(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()
	if _, err := service.CreateOrganization(ctx, actor, "Acme"); err != nil {
		t.Fatalf("create organization: %v", err)
	}
	for name, cursor := range map[string]string{
		"malformed": "%%%",
		"stale":     base64.RawURLEncoding.EncodeToString([]byte("org_missing")),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := service.ListOrganizations(ctx, actor, cloudworkspace.ListOptions{Cursor: cursor})
			if !errors.Is(err, cloudworkspace.ErrInvalidCursor) {
				t.Fatalf("cursor error=%v, want invalid cursor", err)
			}
		})
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestAPIKeySecretIsOneTimeIrreversibleAndRevocationIsMonotonic(t *testing.T) {
	random := bytes.NewReader(append(bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32)...))
	service, repository := newService(cloudworkspace.WithRandom(random))
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	var logs bytes.Buffer
	ctx := zerolog.New(&logs).WithContext(context.Background())
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	environmentID := environments.Items[0].ID

	created, err := service.CreateAPIKey(ctx, actor, environmentID, cloudworkspace.APIKeySecretServer)
	if err != nil {
		t.Fatalf("create API key: %v", err)
	}
	rotated, err := service.RotateAPIKey(ctx, actor, created.APIKey.ID)
	if err != nil {
		t.Fatalf("rotate API key: %v", err)
	}
	if created.Secret == "" || rotated.Secret == "" || created.Secret == rotated.Secret {
		t.Fatal("create and rotate must reveal distinct one-time secrets")
	}

	listed, err := service.ListAPIKeys(ctx, actor, environmentID, "", "", cloudworkspace.ListOptions{})
	if err != nil {
		t.Fatalf("list API keys: %v", err)
	}
	encoded, _ := json.Marshal(listed)
	if bytes.Contains(encoded, []byte(created.Secret)) || bytes.Contains(encoded, []byte(rotated.Secret)) || bytes.Contains(encoded, []byte("SecretDigest")) {
		t.Fatalf("list exposed secret material: %s", encoded)
	}
	if bytes.Contains(logs.Bytes(), []byte(created.Secret)) || bytes.Contains(logs.Bytes(), []byte(rotated.Secret)) {
		t.Fatal("logs exposed raw API-key secret")
	}

	var digest [32]byte
	if err := repository.View(ctx, func(reader cloudworkspace.Reader) error {
		record, ok := reader.APIKey(created.APIKey.ID)
		if !ok {
			t.Fatal("stored API key missing")
		}
		digest = record.SecretDigest
		return nil
	}); err != nil {
		t.Fatalf("read API key record: %v", err)
	}
	if digest == ([32]byte{}) {
		t.Fatal("stored API key digest is empty")
	}
	if _, err := service.RevokeAPIKey(ctx, actor, created.APIKey.ID); err != nil {
		t.Fatalf("revoke API key: %v", err)
	}
	if _, err := service.RevokeAPIKey(ctx, actor, created.APIKey.ID); err != nil {
		t.Fatalf("idempotent revoke: %v", err)
	}
	if _, err := service.RotateAPIKey(ctx, actor, created.APIKey.ID); !errors.Is(err, cloudworkspace.ErrKeyRevoked) {
		t.Fatalf("rotate revoked key error = %v", err)
	}
}

func TestConcurrentProjectKeyUniquenessIsAtomic(t *testing.T) {
	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	organization, _ := service.CreateOrganization(context.Background(), actor, "Acme")
	const attempts = 8
	errorsFound := make(chan error, attempts)
	var wait sync.WaitGroup
	for index := 0; index < attempts; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := service.CreateProject(context.Background(), actor, organization.ID, "mobile", "Mobile")
			errorsFound <- err
		}()
	}
	wait.Wait()
	close(errorsFound)
	successes, conflicts := 0, 0
	for err := range errorsFound {
		if err == nil {
			successes++
		} else if errors.Is(err, cloudworkspace.ErrConflict) {
			conflicts++
		} else {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || conflicts != attempts-1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestRelationshipRemovalsAndEnvironmentUpdateEmitScopedTelemetry(t *testing.T) {
	previousProvider := otel.GetTracerProvider()
	spanRecorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spanRecorder))
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)

	service, _ := newService()
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	var logs bytes.Buffer
	ctx := zerolog.New(&logs).WithContext(context.Background())
	organization, _ := service.CreateOrganization(ctx, actor, "Acme")
	project, _ := service.CreateProject(ctx, actor, organization.ID, "mobile", "Mobile")
	environments, _ := service.ListEnvironments(ctx, actor, project.ID, cloudworkspace.ListOptions{})
	plan, _ := service.CreatePlan(ctx, actor, project.ID, "pro", "Pro", "")
	product, _ := service.CreateProduct(ctx, actor, project.ID, "monthly", "Monthly", "", cloudworkspace.ProductSubscription)
	entitlement, _ := service.CreateEntitlement(ctx, actor, project.ID, "pro", "Pro", "")
	_, _ = service.AddPlanProduct(ctx, actor, plan.ID, product.ID)
	_, _ = service.AddProductEntitlement(ctx, actor, product.ID, entitlement.ID)
	logs.Reset()

	if _, err := service.UpdateEnvironment(ctx, actor, environments.Items[0].ID, "Development apps"); err != nil {
		t.Fatalf("update Environment: %v", err)
	}
	if err := service.RemovePlanProduct(ctx, actor, plan.ID, product.ID); err != nil {
		t.Fatalf("remove Plan Product: %v", err)
	}
	if err := service.RemoveProductEntitlement(ctx, actor, product.ID, entitlement.ID); err != nil {
		t.Fatalf("remove Product Entitlement: %v", err)
	}

	logOutput := logs.String()
	for _, expected := range []string{
		`"action":"environment.updated"`,
		`"action":"plan.product_removed"`,
		`"action":"product.entitlement_removed"`,
		`"organization_id":"` + organization.ID + `"`,
	} {
		if !strings.Contains(logOutput, expected) {
			t.Fatalf("log missing %s: %s", expected, logOutput)
		}
	}

	spanNames := make(map[string]bool)
	for _, span := range spanRecorder.Ended() {
		spanNames[span.Name()] = true
	}
	for _, expected := range []string{"environment.update", "plan.remove_product", "product.remove_entitlement"} {
		if !spanNames[expected] {
			t.Fatalf("span %q missing from %#v", expected, spanNames)
		}
	}
}
