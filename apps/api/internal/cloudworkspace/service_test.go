package cloudworkspace_test

import (
	"bytes"
	"context"
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
		Name: "Cross-project", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		EnvironmentIDs: []string{otherEnvironments.Items[0].ID}, ApplicationIDs: []string{application.ID},
	}); !errors.Is(err, cloudworkspace.ErrScopeMismatch) {
		t.Fatalf("cross-project connection scope error = %v, want scope mismatch", err)
	}

	connection, err := service.CreateProviderConnection(ctx, actor, project.ID, cloudworkspace.CreateProviderConnectionInput{
		Name: "RevenueCat sandbox", Provider: cloudworkspace.ProviderRevenueCat,
		IntegrationMode: cloudworkspace.ProviderServerConnected, Mode: cloudworkspace.ProviderSandbox,
		ExternalProjectID: "rc-project-reference",
		EnvironmentIDs:    []string{development.ID, production.ID},
		ApplicationIDs:    []string{application.ID},
	})
	if err != nil {
		t.Fatalf("create provider connection: %v", err)
	}
	if connection.Status != cloudworkspace.ProviderConnectionPending || connection.HealthStatus != cloudworkspace.ProviderHealthUntested {
		t.Fatalf("new connection asserted provider health: %#v", connection)
	}
	if _, err := service.SetActiveProviderAssignment(ctx, actor, production.ID, application.ID, connection.ID, false); !errors.Is(err, cloudworkspace.ErrModeMismatch) {
		t.Fatalf("sandbox production assignment error = %v, want mode mismatch", err)
	}
	assignment, err := service.SetActiveProviderAssignment(ctx, actor, development.ID, application.ID, connection.ID, false)
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
	if readiness.State != cloudworkspace.ProviderReadinessDraft ||
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
	}); !errors.Is(err, cloudworkspace.ErrScopeMismatch) {
		t.Fatalf("scope removal used by assignment/mapping error = %v, want scope mismatch", err)
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

func providerIssuePresent(issues []cloudworkspace.ProviderReadinessIssue, code cloudworkspace.ProviderErrorCode) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
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
