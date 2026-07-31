package cloudworkspace_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

func TestBootstrapScopesToMembershipAndActiveProjects(t *testing.T) {
	service, _ := newService()
	owner := cloudworkspace.Actor{ID: "actor-owner"}
	member := cloudworkspace.Actor{ID: "actor-member"}
	outsider := cloudworkspace.Actor{ID: "actor-outsider"}
	ctx := context.Background()

	first, err := service.CreateOrganization(ctx, owner, "Northwind")
	if err != nil {
		t.Fatalf("create first organization: %v", err)
	}
	second, err := service.CreateOrganization(ctx, owner, "Contoso")
	if err != nil {
		t.Fatalf("create second organization: %v", err)
	}
	if _, err := service.AddMember(ctx, owner, second.ID, member.ID, cloudworkspace.RoleMember); err != nil {
		t.Fatalf("add member: %v", err)
	}

	mobile, err := service.CreateProject(ctx, owner, first.ID, "mobile", "Mobile")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	retired, err := service.CreateProject(ctx, owner, first.ID, "retired", "Retired")
	if err != nil {
		t.Fatalf("create archived project: %v", err)
	}
	if _, err := service.ArchiveProject(ctx, owner, retired.ID); err != nil {
		t.Fatalf("archive project: %v", err)
	}

	bootstrap, err := service.Bootstrap(ctx, owner)
	if err != nil {
		t.Fatalf("bootstrap owner: %v", err)
	}
	if len(bootstrap.Organizations) != 2 {
		t.Fatalf("expected both organizations, got %d", len(bootstrap.Organizations))
	}
	if bootstrap.Organizations[0].Organization.ID != first.ID {
		t.Fatalf("expected organizations ordered by id, got %q first", bootstrap.Organizations[0].Organization.ID)
	}
	if role := bootstrap.Organizations[0].Role; role != cloudworkspace.RoleOwner {
		t.Fatalf("expected owner role, got %q", role)
	}
	if projects := bootstrap.Organizations[0].Projects; len(projects) != 1 || projects[0].ID != mobile.ID {
		t.Fatalf("expected only the active project, got %+v", projects)
	}
	if count := bootstrap.Organizations[0].ProjectCount; count != 1 {
		t.Fatalf("expected an archived project to be excluded from the count, got %d", count)
	}
	if bootstrap.Organizations[0].ProjectsTruncated {
		t.Fatal("expected a single project not to be reported as truncated")
	}
	// An Organization with no Projects must still appear, otherwise entry cannot
	// tell "you have no Organizations" from "your Organization has no Projects".
	if projects := bootstrap.Organizations[1].Projects; len(projects) != 0 {
		t.Fatalf("expected the second organization to carry no projects, got %+v", projects)
	}

	// Membership, not visibility of the tenant, decides what the snapshot holds.
	memberBootstrap, err := service.Bootstrap(ctx, member)
	if err != nil {
		t.Fatalf("bootstrap member: %v", err)
	}
	if len(memberBootstrap.Organizations) != 1 || memberBootstrap.Organizations[0].Organization.ID != second.ID {
		t.Fatalf("expected only the joined organization, got %+v", memberBootstrap.Organizations)
	}
	if role := memberBootstrap.Organizations[0].Role; role != cloudworkspace.RoleMember {
		t.Fatalf("expected member role, got %q", role)
	}

	outsiderBootstrap, err := service.Bootstrap(ctx, outsider)
	if err != nil {
		t.Fatalf("bootstrap outsider: %v", err)
	}
	if len(outsiderBootstrap.Organizations) != 0 {
		t.Fatalf("expected an empty snapshot for a non-member, got %+v", outsiderBootstrap.Organizations)
	}
}

func TestBootstrapRequiresAnActor(t *testing.T) {
	service, _ := newService()
	if _, err := service.Bootstrap(context.Background(), cloudworkspace.Actor{}); !errors.Is(err, cloudworkspace.ErrUnauthenticated) {
		t.Fatalf("expected an unauthenticated error, got %v", err)
	}
}

func TestBootstrapTruncatesProjectsButReportsTheTotal(t *testing.T) {
	service, _ := newService()
	owner := cloudworkspace.Actor{ID: "actor-owner"}
	ctx := context.Background()

	organization, err := service.CreateOrganization(ctx, owner, "Northwind")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	const total = 30
	for index := 0; index < total; index++ {
		key := "project-" + string(rune('a'+index/26)) + string(rune('a'+index%26))
		if _, err := service.CreateProject(ctx, owner, organization.ID, key, key); err != nil {
			t.Fatalf("create project %s: %v", key, err)
		}
	}

	bootstrap, err := service.Bootstrap(ctx, owner)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	entry := bootstrap.Organizations[0]
	if len(entry.Projects) != 25 {
		t.Fatalf("expected the snapshot to be bounded at 25 projects, got %d", len(entry.Projects))
	}
	if entry.ProjectCount != total {
		t.Fatalf("expected the full count to survive truncation, got %d", entry.ProjectCount)
	}
	if !entry.ProjectsTruncated {
		t.Fatal("expected truncation to be reported so the client does not present a partial list as complete")
	}
}
