package cloudworkspacehttp_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacememory"
	cloudworkspacehttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/cloudworkspace"
)

func TestHostedRoutesRequirePrincipalAndUseStableValidationAndPagination(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	anonymous := cloudworkspacehttp.Routes(service, authn.AnonymousResolver{})
	response := request(t, anonymous, http.MethodPost, "/organizations", `{"name":"Acme"}`)
	assertErrorCode(t, response, http.StatusUnauthorized, "unauthenticated")

	authenticated := cloudworkspacehttp.Routes(service, authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		return authn.Principal{ActorID: "actor-owner", Method: "test"}, nil
	}))
	response = request(t, authenticated, http.MethodPost, "/organizations", `{"name":"","unknown":true}`)
	assertErrorCode(t, response, http.StatusUnprocessableEntity, "validation_failed")

	for _, name := range []string{"Acme", "Beta"} {
		response = request(t, authenticated, http.MethodPost, "/organizations", `{"name":"`+name+`"}`)
		if response.Code != http.StatusCreated {
			t.Fatalf("create %s status = %d body=%s", name, response.Code, response.Body.String())
		}
	}
	response = request(t, authenticated, http.MethodGet, "/organizations?limit=1", "")
	if response.Code != http.StatusOK {
		t.Fatalf("list status = %d body=%s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data struct {
			Items []cloudworkspace.Organization `json:"items"`
			Page  cloudworkspace.Page           `json:"page"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(envelope.Data.Items) != 1 || envelope.Data.Page.NextCursor == "" {
		t.Fatalf("paginated data = %#v", envelope.Data)
	}
}

func TestOrganizationListRejectsMalformedAndStaleCursors(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	handler := cloudworkspacehttp.Routes(service, authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		return authn.Principal{ActorID: "actor-owner", Method: "test"}, nil
	}))
	created := request(t, handler, http.MethodPost, "/organizations", `{"name":"Acme"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}

	for name, cursor := range map[string]string{
		"malformed": "%25%25%25",
		"stale":     base64.RawURLEncoding.EncodeToString([]byte("org_missing")),
	} {
		t.Run(name, func(t *testing.T) {
			response := request(t, handler, http.MethodGet, "/organizations?cursor="+cursor, "")
			assertErrorCode(t, response, http.StatusUnprocessableEntity, "validation_failed")
			var envelope struct {
				Error struct {
					Fields map[string][]string `json:"fields"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode validation error: %v", err)
			}
			if len(envelope.Error.Fields["cursor"]) == 0 {
				t.Fatalf("cursor field error missing: %s", response.Body.String())
			}
		})
	}
}

func request(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func assertErrorCode(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, status, recorder.Body.String())
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if envelope.Error.Code != code {
		t.Fatalf("code = %q, want %q", envelope.Error.Code, code)
	}
}
