package cloudworkspacehttp_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacememory"
	cloudworkspacehttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/cloudworkspace"
)

func TestWorkspaceBootstrapRequiresAPrincipalAndCarriesProjects(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	anonymous := cloudworkspacehttp.Routes(service, authn.AnonymousResolver{})
	assertErrorCode(t, request(t, anonymous, http.MethodGet, "/workspace/bootstrap", ""),
		http.StatusUnauthorized, "unauthenticated")

	actor := cloudworkspace.Actor{ID: "actor-owner"}
	organization, err := service.CreateOrganization(t.Context(), actor, "Northwind")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	project, err := service.CreateProject(t.Context(), actor, organization.ID, "mobile", "Mobile")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	handler := cloudworkspacehttp.Routes(service, authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		return authn.Principal{ActorID: actor.ID, Method: "test"}, nil
	}))

	recorder := request(t, handler, http.MethodGet, "/workspace/bootstrap", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		Data cloudworkspace.WorkspaceBootstrap `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode bootstrap: %v", err)
	}
	if len(envelope.Data.Organizations) != 1 {
		t.Fatalf("organizations = %#v", envelope.Data.Organizations)
	}
	entry := envelope.Data.Organizations[0]
	if entry.Organization.ID != organization.ID || entry.Role != cloudworkspace.RoleOwner {
		t.Fatalf("entry = %#v", entry)
	}
	if len(entry.Projects) != 1 || entry.Projects[0].ID != project.ID {
		t.Fatalf("projects = %#v", entry.Projects)
	}
}

func TestWorkspaceBootstrapEncodesEmptyCollectionsAsArrays(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	if _, err := service.CreateOrganization(t.Context(), actor, "Northwind"); err != nil {
		t.Fatalf("create organization: %v", err)
	}
	member := cloudworkspace.Actor{ID: "actor-outsider"}
	principal := actor
	handler := cloudworkspacehttp.Routes(service, authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		return authn.Principal{ActorID: principal.ID, Method: "test"}, nil
	}))

	// A null here would make the client's "no organizations yet" and "no projects
	// yet" branches depend on a null check the generated types do not describe.
	body := request(t, handler, http.MethodGet, "/workspace/bootstrap", "").Body.String()
	if !strings.Contains(body, `"projects":[]`) {
		t.Fatalf("expected an empty project array in %s", body)
	}

	principal = member
	body = request(t, handler, http.MethodGet, "/workspace/bootstrap", "").Body.String()
	if !strings.Contains(body, `"organizations":[]`) {
		t.Fatalf("expected an empty organization array in %s", body)
	}
}
