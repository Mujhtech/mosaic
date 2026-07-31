package response

import (
	"bytes"
	"encoding/json"
	stderrors "errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
)

func TestSuccessHelpers(t *testing.T) {
	tests := []struct {
		name       string
		wantStatus int
		write      func(http.ResponseWriter, *http.Request)
	}{
		{
			name:       "ok",
			wantStatus: http.StatusOK,
			write: func(w http.ResponseWriter, r *http.Request) {
				OK(w, r, map[string]string{"status": "ok"})
			},
		},
		{
			name:       "created",
			wantStatus: http.StatusCreated,
			write: func(w http.ResponseWriter, r *http.Request) {
				Created(w, r, map[string]string{"id": "resource-id"})
			},
		},
		{
			name:       "accepted",
			wantStatus: http.StatusAccepted,
			write: func(w http.ResponseWriter, r *http.Request) {
				Accepted(w, r, map[string]string{"status": "queued"})
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			recorder := httptest.NewRecorder()

			test.write(recorder, request)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Fatalf("Content-Type = %q, want application/json", contentType)
			}

			var body map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if _, ok := body["data"]; !ok {
				t.Fatalf("body = %#v, want data envelope", body)
			}
		})
	}
}

func TestNoContent(t *testing.T) {
	request := httptest.NewRequest(http.MethodDelete, "/", nil)
	recorder := httptest.NewRecorder()

	NoContent(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("body = %q, want empty", recorder.Body.String())
	}
}

func TestSuccessSerializationFailureUsesSafeStableError(t *testing.T) {
	var logs bytes.Buffer
	logger := zerolog.New(&logs)

	recorder := serveWithRequestID(t, "req-serialization", func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(logger.WithContext(r.Context()))
		OK(w, r, make(chan string))
	})

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf(
			"status = %d, want %d",
			recorder.Code,
			http.StatusInternalServerError,
		)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}

	body := recorder.Body.String()
	if strings.Contains(body, "unsupported") || strings.Contains(body, "chan string") {
		t.Fatalf("response exposed serialization details: %s", body)
	}

	payload := decodeError(t, recorder)
	if payload.Error.Code != internalErrorCode {
		t.Fatalf("code = %q, want %s", payload.Error.Code, internalErrorCode)
	}
	if payload.Error.Message != internalErrorMessage {
		t.Fatalf("message = %q, want %q", payload.Error.Message, internalErrorMessage)
	}
	if payload.Error.RequestID != "req-serialization" {
		t.Fatalf("request ID = %q, want req-serialization", payload.Error.RequestID)
	}

	logOutput := logs.String()
	if !strings.Contains(logOutput, `"response_payload_type":"chan string"`) ||
		!strings.Contains(logOutput, `"intended_http_status":200`) {
		t.Fatalf("log = %q, want safe payload type and intended status", logOutput)
	}
	if strings.Contains(logOutput, "unsupported type") {
		t.Fatalf("log exposed serialization error text: %s", logOutput)
	}
}

func TestErrorMapsValidationFieldsAndRequestID(t *testing.T) {
	fields := map[string][]string{
		"name": {"Name is required."},
	}
	errorValue := ValidationFailed(fields)

	recorder := serveWithRequestID(t, "req-validation", func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, errorValue)
	})

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf(
			"status = %d, want %d",
			recorder.Code,
			http.StatusUnprocessableEntity,
		)
	}

	payload := decodeError(t, recorder)
	if payload.Error.Code != "validation_failed" {
		t.Fatalf("code = %q, want validation_failed", payload.Error.Code)
	}
	if payload.Error.RequestID != "req-validation" {
		t.Fatalf("request ID = %q, want req-validation", payload.Error.RequestID)
	}
	if !reflect.DeepEqual(payload.Error.Fields, fields) {
		t.Fatalf("fields = %#v, want %#v", payload.Error.Fields, fields)
	}
}

func TestErrorDoesNotExposeUnknownInternalError(t *testing.T) {
	recorder := serveWithRequestID(t, "req-internal", func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, stderrors.New("sql: password=do-not-expose"))
	})

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf(
			"status = %d, want %d",
			recorder.Code,
			http.StatusInternalServerError,
		)
	}

	body := recorder.Body.String()
	if strings.Contains(body, "password") || strings.Contains(body, "sql") {
		t.Fatalf("response exposed internal error: %s", body)
	}

	payload := decodeError(t, recorder)
	if payload.Error.Code != "internal_error" {
		t.Fatalf("code = %q, want internal_error", payload.Error.Code)
	}
	if payload.Error.Message != "An unexpected error occurred." {
		t.Fatalf("message = %q, want safe internal message", payload.Error.Message)
	}
	if payload.Error.RequestID != "req-internal" {
		t.Fatalf("request ID = %q, want req-internal", payload.Error.RequestID)
	}
}

// A deliberate 5xx keeps its machine-readable code, because SDKs and Studio use
// it to tell a failed dependency from a broken Mosaic, but never its message:
// free-text messages are where internal topology leaks.
func TestServerAPIErrorKeepsItsCodeAndDropsItsMessage(t *testing.T) {
	recorder := serveWithRequestID(t, "req-server", func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, &APIError{
			Status:  http.StatusServiceUnavailable,
			Code:    "database_unavailable",
			Message: "database host db.internal is unavailable",
		})
	})

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
	payload := decodeError(t, recorder)
	if payload.Error.Code != "database_unavailable" {
		t.Fatalf("code = %q, want the deliberate code to survive", payload.Error.Code)
	}
	if strings.Contains(recorder.Body.String(), "db.internal") {
		t.Fatalf("response exposed internal host: %s", recorder.Body.String())
	}
}

func TestRequestTimeoutUsesSafeStableError(t *testing.T) {
	recorder := serveWithRequestID(t, "req-timeout", func(w http.ResponseWriter, r *http.Request) {
		RequestTimeout(w, r)
	})

	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusGatewayTimeout)
	}
	payload := decodeError(t, recorder)
	if payload.Error.Code != requestTimeoutCode {
		t.Fatalf("code = %q, want %s", payload.Error.Code, requestTimeoutCode)
	}
	if payload.Error.Message != requestTimeoutMessage {
		t.Fatalf("message = %q, want safe timeout message", payload.Error.Message)
	}
	if payload.Error.RequestID != "req-timeout" {
		t.Fatalf("request ID = %q, want req-timeout", payload.Error.RequestID)
	}
}

func serveWithRequestID(
	t *testing.T,
	requestID string,
	handler http.HandlerFunc,
) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(RequestIDHeader, requestID)
	recorder := httptest.NewRecorder()

	chimiddleware.RequestID(handler).ServeHTTP(recorder, request)
	return recorder
}

func decodeError(t *testing.T, recorder *httptest.ResponseRecorder) errorEnvelope {
	t.Helper()

	var payload errorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	return payload
}

// TestUnexpectedErrorIsLoggedForOperators protects every "the API returned 500"
// runbook. The response body carries only `internal_error` plus a request ID, so
// if the cause is not written to the operator log it is lost: the sole trace of
// the failure was an access-log line with http_status 500 and no reason. The
// cause must reach the log and must not reach the body.
func TestUnexpectedErrorIsLoggedForOperators(t *testing.T) {
	var logged bytes.Buffer
	logger := zerolog.New(&logged)

	request := httptest.NewRequest(http.MethodPost, "/v1/projects/project_1/placements", nil)
	request.Header.Set(RequestIDHeader, "req-unexpected")
	request = request.WithContext(logger.WithContext(request.Context()))
	recorder := httptest.NewRecorder()

	chimiddleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, stderrors.New(`ERROR: new row violates check constraint "placements_key_format_check"`))
	})).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	entry := logged.String()
	if !strings.Contains(entry, "placements_key_format_check") {
		t.Fatalf("operator log did not record the cause: %s", entry)
	}
	if !strings.Contains(entry, "req-unexpected") {
		t.Fatalf("operator log did not record the request ID: %s", entry)
	}
	if strings.Contains(recorder.Body.String(), "placements_key_format_check") {
		t.Fatalf("response leaked the internal cause: %s", recorder.Body.String())
	}
}

// TestClientErrorIsNotLoggedAsUnexpected keeps ordinary 4xx validation traffic
// out of the error log; otherwise the signal that matters is buried.
func TestClientErrorIsNotLoggedAsUnexpected(t *testing.T) {
	var logged bytes.Buffer
	logger := zerolog.New(&logged)

	request := httptest.NewRequest(http.MethodPost, "/v1/projects/project_1/placements", nil)
	request = request.WithContext(logger.WithContext(request.Context()))
	recorder := httptest.NewRecorder()

	chimiddleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		Error(w, r, ValidationFailed(map[string][]string{"key": {"must be lowercase"}}))
	})).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", recorder.Code)
	}
	if logged.Len() != 0 {
		t.Fatalf("client error was logged as unexpected: %s", logged.String())
	}
}

// The API documents deliberate upstream-failure statuses -- 503
// providerUnavailable, 503 asset_storage_failed, 502 providerInvalidResponse --
// and SDKs use them to decide whether to retry. Every one of them was rewritten
// to 500 internal_error before reaching the client, so a temporarily
// unavailable commerce provider was indistinguishable from a broken Mosaic and
// the documented contract could never be produced. A 500 must still collapse,
// and an APIError with no code must still degrade safely rather than leak.
func TestDeliberateUpstreamFailureStatusesReachTheClient(t *testing.T) {
	for name, testCase := range map[string]struct {
		err         error
		wantStatus  int
		wantCode    string
		wantMessage string
	}{
		"provider temporarily unavailable": {
			&APIError{Status: http.StatusServiceUnavailable, Code: "providerUnavailable",
				Message: "The provider is temporarily unavailable.",
				Cause:   stderrors.New("dial tcp 10.0.0.1:443: connection refused")},
			http.StatusServiceUnavailable, "providerUnavailable", upstreamFailureMessage,
		},
		"provider returned an invalid response": {
			&APIError{Status: http.StatusBadGateway, Code: "providerInvalidResponse",
				Message: "The provider returned an invalid response."},
			http.StatusBadGateway, "providerInvalidResponse", upstreamFailureMessage,
		},
		"an unexpected 500 still collapses": {
			&APIError{Status: http.StatusInternalServerError, Code: "some_internal_detail",
				Message: "pq: relation does not exist", Cause: stderrors.New("SQLSTATE 42P01")},
			http.StatusInternalServerError, "internal_error", "An unexpected error occurred.",
		},
		"a 5xx with no code degrades to internal_error": {
			&APIError{Status: http.StatusServiceUnavailable},
			http.StatusInternalServerError, "internal_error", "An unexpected error occurred.",
		},
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/x", nil)
			Error(recorder, request, testCase.err)

			if recorder.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, testCase.wantStatus, recorder.Body.String())
			}
			var payload struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Error.Code != testCase.wantCode || payload.Error.Message != testCase.wantMessage {
				t.Fatalf("body = %s, want code %q message %q",
					recorder.Body.String(), testCase.wantCode, testCase.wantMessage)
			}
			// The cause must never reach the client on any 5xx.
			if strings.Contains(recorder.Body.String(), "connection refused") ||
				strings.Contains(recorder.Body.String(), "SQLSTATE") {
				t.Fatalf("the internal cause leaked into the response: %s", recorder.Body.String())
			}
		})
	}
}
