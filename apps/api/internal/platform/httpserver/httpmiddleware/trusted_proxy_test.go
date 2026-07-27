package httpmiddleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type singleTokenLimiter struct{ used map[string]int }

func (l *singleTokenLimiter) Allow(key string) (bool, time.Duration) {
	l.used[key]++
	return l.used[key] <= 1, time.Second
}

// A spoofable client key lets any caller bypass every Mosaic rate limit by
// rotating X-Forwarded-For, which is the abuse-protection bypass Phase 8 closes.
// With no trusted proxy configured, two requests from the same TCP peer must
// share one limiter bucket no matter what they claim in forwarded headers.
func TestForwardedHeadersAreIgnoredFromAnUntrustedPeer(t *testing.T) {
	limiter := &singleTokenLimiter{used: map[string]int{}}
	handler := RealIP(nil)(RateLimit("test", limiter, func(r *http.Request) string {
		return ClientIP(r)
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))

	statuses := make([]int, 0, 2)
	for _, forwarded := range []string{"203.0.113.10", "198.51.100.77"} {
		request := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
		request.RemoteAddr = "10.9.8.7:54321"
		request.Header.Set("X-Forwarded-For", forwarded)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		statuses = append(statuses, recorder.Code)
	}

	if statuses[0] != http.StatusNoContent {
		t.Fatalf("first request status = %d, want 204", statuses[0])
	}
	if statuses[1] != http.StatusTooManyRequests {
		t.Fatalf("second request status = %d, want 429 from the shared bucket", statuses[1])
	}
	if len(limiter.used) != 1 {
		t.Fatalf("limiter buckets = %#v, want exactly one shared bucket", limiter.used)
	}
}

func TestForwardedHeadersAreHonouredFromATrustedPeer(t *testing.T) {
	var seen string
	handler := RealIP([]string{"10.9.0.0/16"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = ClientIP(r)
	}))
	request := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
	request.RemoteAddr = "10.9.8.7:54321"
	request.Header.Set("X-Forwarded-For", "203.0.113.10, 10.9.8.7")
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if seen != "203.0.113.10" {
		t.Fatalf("client IP = %q, want the forwarded client address from a trusted proxy", seen)
	}
}

func TestRateLimitRejectionCarriesRetryMetadata(t *testing.T) {
	limiter := &singleTokenLimiter{used: map[string]int{"ip:1.2.3.4": 5}}
	handler := RateLimit("auth", limiter, func(*http.Request) string { return "ip:1.2.3.4" })(
		http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil))
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", recorder.Code)
	}
	if recorder.Header().Get("Retry-After") == "" {
		t.Fatal("rejection is missing Retry-After metadata")
	}
}
