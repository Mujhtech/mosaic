package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func get(t *testing.T, handler http.Handler) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	return recorder
}

// Readiness exists so a load balancer stops sending traffic to an instance that
// cannot serve. A probe that only checked PostgreSQL would report ready while
// every Asset upload and delivery read failed, which is the failure this test
// prevents. It also asserts the response carries a safe per-check code and no
// configuration detail.
func TestReadinessFailsWhenObjectStorageIsDownWhilePostgreSQLIsHealthy(t *testing.T) {
	readiness := NewReadiness(
		Check{Name: "postgresql", Code: "database_unavailable", Probe: func(context.Context) error { return nil }},
		Check{Name: "object_storage", Code: "object_storage_unavailable", Probe: func(context.Context) error {
			return errors.New("dial tcp minio:9000: connect: connection refused")
		}},
	)

	recorder := get(t, ReadinessRoutes(readiness))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Checks []string `json:"checks"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "not_ready" {
		t.Fatalf("code = %q, want not_ready", payload.Error.Code)
	}
	if len(payload.Error.Details.Checks) != 1 || payload.Error.Details.Checks[0] != "object_storage_unavailable" {
		t.Fatalf("checks = %#v, want only object_storage_unavailable", payload.Error.Details.Checks)
	}
	if strings.Contains(recorder.Body.String(), "minio:9000") {
		t.Fatalf("readiness leaked internal topology: %s", recorder.Body.String())
	}
}

// Draining must be observable before the HTTP server starts refusing
// connections; otherwise a rolling restart drops in-flight client traffic.
func TestReadinessReportsDrainingBeforeShutdown(t *testing.T) {
	readiness := NewReadiness(Check{Name: "postgresql", Code: "database_unavailable", Probe: func(context.Context) error { return nil }})
	if recorder := get(t, ReadinessRoutes(readiness)); recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 before draining", recorder.Code)
	}
	readiness.StartDraining()
	recorder := get(t, ReadinessRoutes(readiness))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 while draining", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "draining") {
		t.Fatalf("body = %s, want a draining diagnostic", recorder.Body.String())
	}
}
