package browserauthhttp

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
)

func TestSessionCookieUsesBrowserSecurityAttributes(t *testing.T) {
	handler := &Handler{config: Config{CookieSecure: true, CookieDomain: "studio.example"}}
	recorder := httptest.NewRecorder()
	handler.setSessionCookie(recorder, "opaque-token", time.Now().Add(time.Hour))

	response := recorder.Result()
	cookies := response.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies=%d, want one", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != browserauth.SessionCookieName || cookie.Value != "opaque-token" || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Domain != "studio.example" {
		t.Fatalf("session cookie attributes = %#v", cookie)
	}
}

type accountRejectingLimiter struct{ keys []string }

func (limiter *accountRejectingLimiter) Allow(key string) (bool, time.Duration) {
	limiter.keys = append(limiter.keys, key)
	return !strings.HasPrefix(key, "account:"), 1500 * time.Millisecond
}

func TestLoginRateLimitUsesIPAndHashedAccountBuckets(t *testing.T) {
	limiter := new(accountRejectingLimiter)
	handler := &Handler{config: Config{RateLimiter: limiter}}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewBufferString(`{"email":"owner@example.com","password":"wrong"}`))
	request.RemoteAddr = "192.0.2.10:1234"
	recorder := httptest.NewRecorder()

	handler.login(recorder, request)

	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "2" {
		t.Fatalf("status=%d retry=%q body=%s", recorder.Code, recorder.Header().Get("Retry-After"), recorder.Body.String())
	}
	if len(limiter.keys) != 2 || limiter.keys[0] != "ip:192.0.2.10" || !strings.HasPrefix(limiter.keys[1], "account:") || strings.Contains(limiter.keys[1], "owner@example.com") {
		t.Fatalf("rate-limit keys=%#v, want IP plus non-reversible account digest", limiter.keys)
	}
}

func TestAuthenticationMutationRejectsUntrustedBrowserOrigin(t *testing.T) {
	handler := &Handler{config: Config{AllowedOrigins: []string{"https://studio.example"}}}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewBufferString(`{"email":"owner@example.com","password":"correct horse battery"}`))
	request.Header.Set("Origin", "https://attacker.example")
	recorder := httptest.NewRecorder()

	handler.login(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want 403", recorder.Code)
	}
}

func TestSignupConflictDoesNotConfirmAccountExistence(t *testing.T) {
	handler := new(Handler)
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/signup", nil)
	recorder := httptest.NewRecorder()
	handler.writeError(recorder, request, browserauth.ErrEmailInUse)
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), `"code":"signup_unavailable"`) || strings.Contains(strings.ToLower(recorder.Body.String()), "email already") {
		t.Fatalf("enumerating signup response: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
