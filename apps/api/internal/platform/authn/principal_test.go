package authn

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

func TestMiddlewareDistinguishesUnauthenticatedFromResolverFailure(t *testing.T) {
	t.Run("expected unauthenticated continues without a Principal", func(t *testing.T) {
		called := false
		handler := Middleware(ResolverFunc(func(*http.Request) (Principal, error) {
			return Principal{}, ErrUnauthenticated
		}))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			if _, ok := FromContext(r.Context()); ok {
				t.Fatal("unexpected Principal in context")
			}
			w.WriteHeader(http.StatusNoContent)
		}))

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

		if !called || recorder.Code != http.StatusNoContent {
			t.Fatalf("called=%v status=%d", called, recorder.Code)
		}
	})

	t.Run("unexpected resolver failure is safe and stops the request", func(t *testing.T) {
		var logs bytes.Buffer
		called := false
		handler := Middleware(ResolverFunc(func(*http.Request) (Principal, error) {
			return Principal{}, errors.New("session database password=do-not-log")
		}))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request = request.WithContext(zerolog.New(&logs).WithContext(request.Context()))
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, request)

		if called {
			t.Fatal("downstream handler was called after resolver failure")
		}
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("status=%d, want 500", recorder.Code)
		}
		var envelope struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("decode error: %v", err)
		}
		if envelope.Error.Code != "internal_error" {
			t.Fatalf("code=%q, want internal_error", envelope.Error.Code)
		}
		if strings.Contains(recorder.Body.String(), "password") || strings.Contains(logs.String(), "password") {
			t.Fatal("resolver error details were exposed")
		}
		if !strings.Contains(logs.String(), "authentication resolver failed") {
			t.Fatalf("safe resolver failure log missing: %s", logs.String())
		}
	})
}
