package httpserver

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/riandyrn/otelchi"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/httpmiddleware"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/transport/health"
)

const (
	MiddlewareRequestID       = "request_id"
	MiddlewareRealIP          = "real_ip"
	MiddlewareTelemetry       = "otelchi"
	MiddlewareRequestLogging  = "request_scoped_zerolog"
	MiddlewareRecovery        = "recovery"
	MiddlewareSecurityHeaders = "security_headers"
	MiddlewareCORS            = "cors"
	MiddlewareTimeout         = "timeout"
)

var middlewareOrder = []string{
	MiddlewareRequestID,
	MiddlewareRealIP,
	MiddlewareTelemetry,
	MiddlewareRequestLogging,
	MiddlewareRecovery,
	MiddlewareSecurityHeaders,
	MiddlewareCORS,
	MiddlewareTimeout,
}

type Config struct {
	ServiceName    string
	AllowedOrigins []string
	RequestTimeout time.Duration
}

func New(cfg Config, logger zerolog.Logger) http.Handler {
	router := chi.NewRouter()

	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.RealIP)
	router.Use(otelchi.Middleware(cfg.ServiceName, otelchi.WithChiRoutes(router)))
	router.Use(httpmiddleware.RequestLogging(logger))
	router.Use(httpmiddleware.Recovery)
	router.Use(httpmiddleware.SecurityHeaders)
	router.Use(corsMiddleware(cfg.AllowedOrigins))
	router.Use(httpmiddleware.Timeout(cfg.RequestTimeout))

	router.Mount("/health", health.Routes())
	router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, response.NewAPIError(
			http.StatusNotFound,
			"not_found",
			"The requested resource was not found.",
		))
	})
	router.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, response.NewAPIError(
			http.StatusMethodNotAllowed,
			"method_not_allowed",
			"The request method is not allowed for this resource.",
		))
	})

	return router
}

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	if len(allowedOrigins) == 0 {
		return func(next http.Handler) http.Handler {
			return next
		}
	}

	return cors.Handler(cors.Options{
		AllowedOrigins: allowedOrigins,
		AllowedMethods: []string{
			http.MethodGet,
			http.MethodPost,
			http.MethodPut,
			http.MethodPatch,
			http.MethodDelete,
			http.MethodOptions,
		},
		AllowedHeaders: []string{
			"Accept",
			"Authorization",
			"Content-Type",
			response.RequestIDHeader,
		},
		ExposedHeaders:   []string{response.RequestIDHeader},
		AllowCredentials: false,
		MaxAge:           300,
	})
}

func MiddlewareOrder() []string {
	return append([]string(nil), middlewareOrder...)
}
