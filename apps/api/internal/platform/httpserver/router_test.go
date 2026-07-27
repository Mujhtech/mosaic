package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacememory"
)

type readinessChecker struct{ err error }

func (checker readinessChecker) Ping(context.Context) error { return checker.err }

type healthEnvelope struct {
	Data struct {
		Status string `json:"status"`
	} `json:"data"`
}

type errorEnvelope struct {
	Error struct {
		Code      string `json:"code"`
		RequestID string `json:"requestId"`
	} `json:"error"`
}

func TestHealthEndpoint(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("X-Request-ID", "req-health")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if recorder.Header().Get("X-Request-ID") != "req-health" {
		t.Fatalf(
			"X-Request-ID = %q, want req-health",
			recorder.Header().Get("X-Request-ID"),
		)
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf(
			"X-Content-Type-Options = %q, want nosniff",
			recorder.Header().Get("X-Content-Type-Options"),
		)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}

	var body healthEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if body.Data.Status != "ok" {
		t.Fatalf("health status = %q, want ok", body.Data.Status)
	}
}

func TestExactHealthRoutesAndUnavailableReadiness(t *testing.T) {
	handler := NewWithDependencies(Config{ServiceName: "mosaic-api-test", RequestTimeout: time.Second}, zerolog.Nop(), Dependencies{ReadinessChecker: readinessChecker{}})
	for _, path := range []string{"/health/live", "/health/ready"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200", path, recorder.Code)
		}
	}
	unready := NewWithDependencies(Config{ServiceName: "mosaic-api-test", RequestTimeout: time.Second}, zerolog.Nop(), Dependencies{ReadinessChecker: readinessChecker{err: errors.New("database unavailable")}})
	recorder := httptest.NewRecorder()
	unready.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("unready status = %d, want 503", recorder.Code)
	}
}

func TestNotFoundUsesStableErrorEnvelope(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "/missing", nil)
	request.Header.Set("X-Request-ID", "req-missing")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
	}

	var body errorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if body.Error.Code != "not_found" {
		t.Fatalf("error code = %q, want not_found", body.Error.Code)
	}
	if body.Error.RequestID != "req-missing" {
		t.Fatalf("request ID = %q, want req-missing", body.Error.RequestID)
	}
}

func TestCORSAllowsDashboardRequestIDHeader(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodOptions, "/health", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "X-Request-ID")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if origin := recorder.Header().Get("Access-Control-Allow-Origin"); origin != "http://localhost:3000" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want dashboard origin", origin)
	}
	if credentials := recorder.Header().Get("Access-Control-Allow-Credentials"); credentials != "true" {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want true", credentials)
	}
	if headers := recorder.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(
		strings.ToLower(headers),
		strings.ToLower("X-Request-ID"),
	) {
		t.Fatalf("Access-Control-Allow-Headers = %q, want X-Request-ID", headers)
	}
}

func TestCORSRejectsUnconfiguredOrigin(t *testing.T) {
	handler := newTestHandler()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if origin := recorder.Header().Get("Access-Control-Allow-Origin"); origin != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", origin)
	}
}

func TestEmptyCORSOriginsDisableCrossOriginAccess(t *testing.T) {
	handler := New(Config{
		ServiceName:    "mosaic-api-test",
		AllowedOrigins: nil,
		RequestTimeout: time.Second,
	}, zerolog.Nop())
	request := httptest.NewRequest(http.MethodOptions, "/health", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if origin := recorder.Header().Get("Access-Control-Allow-Origin"); origin != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", origin)
	}
	if headers := recorder.Header().Get("Access-Control-Allow-Headers"); headers != "" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want empty", headers)
	}
}

func TestMiddlewareOrder(t *testing.T) {
	want := []string{
		"request_id",
		"trusted_proxy_real_ip",
		"otelchi",
		"otelchi_metrics",
		"request_scoped_zerolog",
		"recovery",
		"security_headers",
		"cors",
		"timeout",
	}

	if got := MiddlewareOrder(); !reflect.DeepEqual(got, want) {
		t.Fatalf("middleware order = %#v, want %#v", got, want)
	}
}

func TestCloudWorkspaceIsMountedAtV1WithInjectedPrincipal(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	handler := NewWithDependencies(Config{
		ServiceName:    "mosaic-api-test",
		AllowedOrigins: []string{"http://localhost:3000"},
		RequestTimeout: time.Second,
	}, zerolog.Nop(), Dependencies{
		CloudWorkspace: service,
		PrincipalResolver: authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
			return authn.Principal{ActorID: "actor-owner", Method: "test"}, nil
		}),
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/organizations", bytes.NewBufferString(`{"name":"Acme"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
}

func TestProjectRouterComposesWorkspaceAndHostedPublishingRoutes(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	organization, err := service.CreateOrganization(context.Background(), actor, "Acme")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	project, err := service.CreateProject(context.Background(), actor, organization.ID, "ios-app", "iOS App")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	handler := NewWithDependencies(Config{
		ServiceName:    "mosaic-api-test",
		AllowedOrigins: []string{"http://localhost:3000"},
		RequestTimeout: time.Second,
	}, zerolog.Nop(), Dependencies{
		CloudWorkspace:   service,
		HostedPublishing: hostedpublishing.NewService(nil),
		PrincipalResolver: authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
			return authn.Principal{ActorID: actor.ID, Method: "test"}, nil
		}),
	})
	request := httptest.NewRequest(http.MethodGet, "/v1/projects/"+project.ID, nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/projects/"+project.ID+"/assets", strings.NewReader("not multipart"))
	request.Header.Set("Content-Type", "multipart/form-data; boundary=missing")
	recorder = httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("asset route status = %d, want %d; body=%s", recorder.Code, http.StatusUnprocessableEntity, recorder.Body.String())
	}
}

func TestUnsafeHostedMutationRejectsUntrustedOriginIncludingMultipart(t *testing.T) {
	handler := NewWithDependencies(Config{
		ServiceName: "mosaic-api-test", AllowedOrigins: []string{"https://studio.example"}, RequestTimeout: time.Second,
	}, zerolog.Nop(), Dependencies{HostedPublishing: hostedpublishing.NewService(nil)})

	for _, test := range []struct {
		name   string
		origin string
		want   int
	}{
		{name: "untrusted browser", origin: "https://attacker.example", want: http.StatusForbidden},
		{name: "trusted browser", origin: "https://studio.example", want: http.StatusUnprocessableEntity},
		{name: "originless non-browser", want: http.StatusUnprocessableEntity},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/v1/projects/project_1/assets", strings.NewReader("not multipart"))
			request.Header.Set("Content-Type", "multipart/form-data; boundary=missing")
			if test.origin != "" {
				request.Header.Set("Origin", test.origin)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
}

func newTestHandler() http.Handler {
	return New(Config{
		ServiceName:    "mosaic-api-test",
		AllowedOrigins: []string{"http://localhost:3000"},
		RequestTimeout: time.Second,
	}, zerolog.Nop())
}

// exhaustedLimiter rejects everything, so a request that reaches it is proof the
// middleware is mounted on that route.
type exhaustedLimiter struct{ keys []string }

func (limiter *exhaustedLimiter) Allow(key string) (bool, time.Duration) {
	limiter.keys = append(limiter.keys, key)
	return false, time.Second
}

// Asset upload and the four export/privacy submissions each cost far more than a
// dashboard read -- a large body plus an object-storage write, or an enqueued job
// that scans analytics history. Before Phase 8 Stage 6 they shared the baseline
// per-principal API bucket. This pins both halves of that wiring: the expensive
// routes really are behind their own limiter, and the limiter does not leak onto
// the ordinary reads mounted beside them, which would 429 normal dashboard use.
func TestUploadAndExportLimitersCoverOnlyTheExpensiveRoutes(t *testing.T) {
	service := cloudworkspace.NewService(cloudworkspacememory.New())
	actor := cloudworkspace.Actor{ID: "actor-owner"}
	organization, err := service.CreateOrganization(context.Background(), actor, "Acme")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	project, err := service.CreateProject(context.Background(), actor, organization.ID, "ios-app", "iOS App")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	uploadLimiter := &exhaustedLimiter{}
	exportLimiter := &exhaustedLimiter{}
	handler := NewWithDependencies(Config{
		ServiceName:    "mosaic-api-test",
		AllowedOrigins: []string{"http://localhost:3000"},
		RequestTimeout: time.Second,
	}, zerolog.Nop(), Dependencies{
		CloudWorkspace:   service,
		HostedPublishing: hostedpublishing.NewService(nil),
		Analytics:        analytics.NewService(nil, nil),
		PrincipalResolver: authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
			return authn.Principal{ActorID: actor.ID, Method: "test"}, nil
		}),
		UploadLimiter: uploadLimiter,
		ExportLimiter: exportLimiter,
	})

	base := "/v1/projects/" + project.ID
	for _, limited := range []struct {
		name string
		path string
	}{
		{name: "asset upload", path: base + "/assets"},
		{name: "analytics export", path: base + "/environments/env-1/analytics/exports"},
		{name: "experiment export", path: base + "/environments/env-1/experiments/experiment-1/exports"},
		{name: "privacy export", path: base + "/analytics/privacy/exports"},
		{name: "privacy deletion request", path: base + "/analytics/privacy/deletions"},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, limited.path, strings.NewReader("{}"))
		request.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("%s status = %d, want 429 from its own limiter; body=%s", limited.name, recorder.Code, recorder.Body.String())
		}
	}
	if len(uploadLimiter.keys) != 1 {
		t.Fatalf("upload limiter saw %d requests, want exactly the upload route", len(uploadLimiter.keys))
	}
	if len(exportLimiter.keys) != 4 {
		t.Fatalf("export limiter saw %d requests, want the four export and privacy submissions", len(exportLimiter.keys))
	}

	// Reads mounted beside the limited routes must be unaffected.
	for _, path := range []string{base + "/assets", base + "/environments/env-1/analytics/settings"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code == http.StatusTooManyRequests {
			t.Fatalf("GET %s was rate limited by an upload/export bucket", path)
		}
	}
	if len(uploadLimiter.keys) != 1 || len(exportLimiter.keys) != 4 {
		t.Fatalf("a read consumed an upload/export token: upload=%d export=%d", len(uploadLimiter.keys), len(exportLimiter.keys))
	}
}
