package browserauthhttp

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/go-ozzo/ozzo-validation/v4/is"

	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/requestvalidation"
)

const maxAuthRequestBytes = 16 << 10

type Config struct {
	CookieSecure   bool
	CookieDomain   string
	AllowedOrigins []string
	RateLimiter    AuthenticationRateLimiter
}

type AuthenticationRateLimiter interface {
	Allow(string) (bool, time.Duration)
}

type Handler struct {
	service *browserauth.Service
	config  Config
}

func RegisterRoutes(router chi.Router, service *browserauth.Service, cfg Config) {
	handler := &Handler{service: service, config: cfg}
	router.Route("/auth", func(router chi.Router) {
		router.Post("/signup", handler.signup)
		router.Post("/login", handler.login)
		router.Post("/logout", handler.logout)
		router.Get("/session", handler.session)
	})
}

// emailAddress validates the shape of an email address without resolving it.
//
// ozzo's `is.Email` is `govalidator.IsExistingEmail`, which performs a live
// net.LookupMX (then net.LookupIP) on the domain of every submitted address.
// That made administrator bootstrap depend on outbound DNS from the API
// container and rejected every internal-only domain (`.internal`, `.local`,
// an intranet zone, an RFC 2606 `.test`/`.example` name), so a self-hosted
// installation on an isolated network could not create its first user. It also
// put an unbounded, uncancellable network call inside two unauthenticated
// handlers. Mosaic validates the format only; deliverability is not something
// an authentication boundary can or should assert.
var emailAddress = is.EmailFormat

type signupRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (request *signupRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Email, validation.Required, emailAddress, validation.Length(3, 320)),
		validation.Field(&request.Name, validation.Required, validation.Length(1, 120)),
		validation.Field(&request.Password, validation.Required, validation.Length(12, 72)),
	)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (request *loginRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Email, validation.Required, emailAddress, validation.Length(3, 320)),
		validation.Field(&request.Password, validation.Required, validation.Length(1, 72)),
	)
}

func decodeAndValidate(w http.ResponseWriter, r *http.Request, target interface{ Validate() error }) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxAuthRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeValidationError(w, r, map[string][]string{"_request": {"Request body must be valid JSON with only supported fields."}})
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeValidationError(w, r, map[string][]string{"_request": {"Request body must contain one JSON object."}})
		return false
	}
	if err := target.Validate(); err != nil {
		fields, ok := requestvalidation.FieldErrors(err)
		if !ok {
			response.Error(w, r, err)
			return false
		}
		writeValidationError(w, r, fields)
		return false
	}
	return true
}

func writeValidationError(w http.ResponseWriter, r *http.Request, fields map[string][]string) {
	response.Error(w, r, response.ValidationFailed(fields))
}

func (h *Handler) signup(w http.ResponseWriter, r *http.Request) {
	if !h.requireTrustedOrigin(w, r) {
		return
	}
	if !h.allowAuthentication(w, r, "ip:"+requestIP(r)) {
		return
	}
	request := new(signupRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	if !h.allowAuthentication(w, r, "account:"+accountKey(request.Email)) {
		return
	}
	result, err := h.service.SignUp(r.Context(), request.Email, request.Name, request.Password)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.setSessionCookie(w, result.Token, result.ExpiresAt)
	response.Created(w, r, result.User)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	if !h.requireTrustedOrigin(w, r) {
		return
	}
	if !h.allowAuthentication(w, r, "ip:"+requestIP(r)) {
		return
	}
	request := new(loginRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	if !h.allowAuthentication(w, r, "account:"+accountKey(request.Email)) {
		return
	}
	result, err := h.service.Login(r.Context(), request.Email, request.Password)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.setSessionCookie(w, result.Token, result.ExpiresAt)
	response.OK(w, r, result.User)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if !h.requireTrustedOrigin(w, r) {
		return
	}
	cookie, _ := r.Cookie(browserauth.SessionCookieName)
	if cookie != nil {
		if err := h.service.Logout(r.Context(), cookie.Value); err != nil {
			h.writeError(w, r, err)
			return
		}
	}
	h.clearSessionCookie(w)
	response.NoContent(w, r)
}

func (h *Handler) requireTrustedOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	for _, allowed := range h.config.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	response.Error(w, r, response.NewAPIError(http.StatusForbidden, "origin_not_allowed", "The request origin is not allowed."))
	return false
}

func (h *Handler) allowAuthentication(w http.ResponseWriter, r *http.Request, key string) bool {
	if h.config.RateLimiter == nil {
		return true
	}
	allowed, retryAfter := h.config.RateLimiter.Allow(key)
	if allowed {
		return true
	}
	seconds := int64(retryAfter/time.Second) + 1
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
	response.Error(w, r, response.NewAPIError(http.StatusTooManyRequests, "rate_limited", "Too many authentication attempts. Retry later."))
	return false
}

func accountKey(email string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return fmtDigest(digest[:])
}

func fmtDigest(value []byte) string {
	const digits = "0123456789abcdef"
	result := make([]byte, len(value)*2)
	for index, item := range value {
		result[index*2], result[index*2+1] = digits[item>>4], digits[item&0x0f]
	}
	return string(result)
}

func requestIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func (h *Handler) session(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(browserauth.SessionCookieName)
	if err != nil {
		h.writeError(w, r, browserauth.ErrUnauthenticated)
		return
	}
	principal, err := h.service.Authenticate(r.Context(), cookie.Value)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	response.OK(w, r, principal.User)
}

func (h *Handler) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{
		Name: browserauth.SessionCookieName, Value: token, Path: "/", Domain: h.config.CookieDomain,
		Expires: expiresAt, MaxAge: maxAge, HttpOnly: true, Secure: h.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: browserauth.SessionCookieName, Value: "", Path: "/", Domain: h.config.CookieDomain,
		Expires: time.Unix(1, 0), MaxAge: -1, HttpOnly: true, Secure: h.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "The request could not be completed."
	switch {
	case errors.Is(err, browserauth.ErrEmailInUse):
		status, code, message = http.StatusConflict, "signup_unavailable", "The account could not be created with those details."
	case errors.Is(err, browserauth.ErrInvalidLogin):
		status, code, message = http.StatusUnauthorized, "invalid_credentials", "The email or password is invalid."
	case errors.Is(err, browserauth.ErrUnauthenticated), errors.Is(err, browserauth.ErrInvalidSession):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}

func CookieToken(r *http.Request) string {
	cookie, err := r.Cookie(browserauth.SessionCookieName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}
