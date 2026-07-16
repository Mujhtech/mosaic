package httpmiddleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

func TestTimeoutUsesMosaicErrorEnvelope(t *testing.T) {
	handler := chimiddleware.RequestID(Timeout(time.Millisecond)(http.HandlerFunc(
		func(_ http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		},
	)))
	request := httptest.NewRequest(http.MethodGet, "/slow", nil)
	request.Header.Set(response.RequestIDHeader, "req-timeout")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusGatewayTimeout)
	}

	var body struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"requestId"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode timeout response: %v", err)
	}
	if body.Error.Code != "request_timeout" {
		t.Fatalf("error code = %q, want request_timeout", body.Error.Code)
	}
	if body.Error.Message != "The request timed out." {
		t.Fatalf("error message = %q, want safe timeout message", body.Error.Message)
	}
	if body.Error.RequestID != "req-timeout" {
		t.Fatalf("request ID = %q, want req-timeout", body.Error.RequestID)
	}
}
