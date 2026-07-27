package httpmiddleware

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// Limiter is the token-bucket contract shared by every Mosaic rate limiter.
type Limiter interface {
	Allow(string) (bool, time.Duration)
}

var rateLimitRejections = func() metric.Int64Counter {
	counter, _ := otel.Meter("mosaic/http").Int64Counter(
		"mosaic.http.rate_limit.rejections",
		metric.WithDescription("Requests rejected by a Mosaic rate limiter, by surface."),
	)
	return counter
}()

// RateLimit applies a per-surface token bucket. Rejections are observable
// (counter plus a structured log line) and always carry safe retry metadata so
// a well-behaved client can back off instead of hot-looping.
//
// surface names the protected area (auth, delivery, ingestion, api, decision)
// so limits stay per-surface rather than one identical global limit.
func RateLimit(surface string, limiter Limiter, key func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if limiter == nil || key == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			bucket := key(r)
			if bucket == "" {
				next.ServeHTTP(w, r)
				return
			}
			allowed, retryAfter := limiter.Allow(bucket)
			if allowed {
				next.ServeHTTP(w, r)
				return
			}
			Reject(w, r, surface, retryAfter)
		})
	}
}

// Reject writes Mosaic's standard rate-limit response. It is exported so
// handlers with their own limiter bookkeeping stay consistent with the
// middleware.
func Reject(w http.ResponseWriter, r *http.Request, surface string, retryAfter time.Duration) {
	seconds := int(math.Ceil(retryAfter.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	rateLimitRejections.Add(r.Context(), 1, metric.WithAttributes(attribute.String("surface", surface)))
	zerolog.Ctx(r.Context()).Warn().
		Str("rate_limit_surface", surface).
		Int("retry_after_seconds", seconds).
		Msg("request rejected by rate limiter")
	response.Error(w, r, &response.APIError{
		Status:  http.StatusTooManyRequests,
		Code:    "rate_limited",
		Message: "Too many requests. Retry after the interval in the Retry-After header.",
		Details: map[string]any{"retryAfterSeconds": seconds},
	})
}
