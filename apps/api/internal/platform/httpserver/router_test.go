package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

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
		"real_ip",
		"otelchi",
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

func newTestHandler() http.Handler {
	return New(Config{
		ServiceName:    "mosaic-api-test",
		AllowedOrigins: []string{"http://localhost:3000"},
		RequestTimeout: time.Second,
	}, zerolog.Nop())
}
