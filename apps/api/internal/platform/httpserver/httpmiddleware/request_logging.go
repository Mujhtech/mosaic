package httpmiddleware

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

func RequestLogging(base zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			startedAt := time.Now()
			requestID := chimiddleware.GetReqID(r.Context())
			spanContext := trace.SpanContextFromContext(r.Context())

			context := base.With().
				Str("request_id", requestID).
				Str("http_method", r.Method).
				Str("http_path", r.URL.Path).
				Str("remote_ip", r.RemoteAddr)
			if spanContext.IsValid() {
				context = context.Str("trace_id", spanContext.TraceID().String())
			}
			requestLogger := context.Logger()

			w.Header().Set(response.RequestIDHeader, requestID)
			wrapped := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(wrapped, r.WithContext(requestLogger.WithContext(r.Context())))

			status := wrapped.Status()
			if status == 0 {
				status = http.StatusOK
			}
			routePattern := chi.RouteContext(r.Context()).RoutePattern()

			requestLogger.Info().
				Int("http_status", status).
				Str("http_route", routePattern).
				Dur("duration", time.Since(startedAt)).
				Msg("http request completed")
		})
	}
}
