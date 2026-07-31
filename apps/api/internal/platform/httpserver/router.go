package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/riandyrn/otelchi"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/httpmiddleware"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	analyticshttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/analytics"
	browserauthhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/browserauth"
	cloudworkspacehttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/transport/health"
	hostedpublishinghttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/hostedpublishing"
	placementdecisionhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/placementdecision"
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

type Dependencies struct {
	CloudWorkspace        *cloudworkspace.Service
	HostedPublishing      *hostedpublishing.Service
	PlacementDecision     *placementdecision.Service
	PrincipalResolver     authn.Resolver
	ReadinessChecker      health.Checker
	BrowserAuth           *browserauth.Service
	BrowserAuthConfig     browserauthhttp.Config
	DeliveryLimiter       hostedpublishinghttp.DeliveryRateLimiter
	Analytics             *analytics.Service
	AnalyticsIPLimiter    analyticshttp.Limiter
	AnalyticsKeyLimiter   analyticshttp.Limiter
	AnalyticsEventLimiter analyticshttp.EventLimiter
}

func New(cfg Config, logger zerolog.Logger) http.Handler {
	return NewWithDependencies(cfg, logger, Dependencies{})
}

func NewWithDependencies(cfg Config, logger zerolog.Logger, dependencies Dependencies) http.Handler {
	router := chi.NewRouter()

	router.Use(chimiddleware.RequestID)
	router.Use(chimiddleware.RealIP)
	router.Use(otelchi.Middleware(cfg.ServiceName, otelchi.WithChiRoutes(router)))
	router.Use(httpmiddleware.RequestLogging(logger))
	router.Use(httpmiddleware.Recovery)
	router.Use(httpmiddleware.SecurityHeaders)
	router.Use(corsMiddleware(cfg.AllowedOrigins))
	router.Use(httpmiddleware.Timeout(cfg.RequestTimeout))

	router.Mount("/health/live", health.LiveRoutes())
	router.Mount("/health/ready", health.ReadyRoutes(dependencies.ReadinessChecker))
	// Compatibility aliases retained for existing probes while documented callers migrate.
	router.Mount("/health", health.LiveRoutes())
	router.Mount("/ready", health.ReadyRoutes(dependencies.ReadinessChecker))
	if dependencies.BrowserAuth != nil || dependencies.CloudWorkspace != nil || dependencies.HostedPublishing != nil || dependencies.PlacementDecision != nil || dependencies.Analytics != nil {
		router.Route("/v1", func(versioned chi.Router) {
			versioned.Use(trustedMutationOrigins(cfg.AllowedOrigins))
			if dependencies.BrowserAuth != nil {
				browserauthhttp.RegisterRoutes(versioned, dependencies.BrowserAuth, dependencies.BrowserAuthConfig)
			}
			if dependencies.CloudWorkspace != nil || dependencies.HostedPublishing != nil || dependencies.Analytics != nil {
				versioned.Group(func(authenticated chi.Router) {
					authenticated.Use(authn.Middleware(dependencies.PrincipalResolver))
					if dependencies.CloudWorkspace != nil {
						cloudworkspacehttp.RegisterWorkspaceRoutes(authenticated, dependencies.CloudWorkspace)
					}
					// Project-scoped domain routes share one Chi subrouter so that
					// registering another module cannot shadow an existing handler.
					authenticated.Route("/projects/{projectId}", func(project chi.Router) {
						if dependencies.CloudWorkspace != nil {
							cloudworkspacehttp.RegisterProjectRoutes(project, dependencies.CloudWorkspace)
						}
						if dependencies.HostedPublishing != nil {
							hostedpublishinghttp.RegisterProjectRoutes(project, dependencies.HostedPublishing)
						}
						if dependencies.PlacementDecision != nil {
							placementdecisionhttp.RegisterProjectRoutes(project, dependencies.PlacementDecision)
						}
						if dependencies.Analytics != nil {
							analyticshttp.RegisterProjectRoutes(project, dependencies.Analytics)
						}
					})
				})
			}
			if dependencies.HostedPublishing != nil {
				hostedpublishinghttp.RegisterPublicRoutes(versioned, dependencies.HostedPublishing, dependencies.DeliveryLimiter)
			}
			if dependencies.Analytics != nil {
				analyticshttp.RegisterPublicRoutes(versioned, dependencies.Analytics, dependencies.AnalyticsIPLimiter, dependencies.AnalyticsKeyLimiter, dependencies.AnalyticsEventLimiter)
			}
		})
	}
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

func trustedMutationOrigins(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[strings.TrimSpace(origin)] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			if _, ok := allowed[origin]; ok {
				next.ServeHTTP(w, r)
				return
			}
			response.Error(w, r, response.NewAPIError(http.StatusForbidden, "origin_not_allowed", "The request origin is not allowed."))
		})
	}
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
			"Idempotency-Key",
			"If-Match",
		},
		ExposedHeaders:   []string{response.RequestIDHeader, "ETag"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}

func MiddlewareOrder() []string {
	return append([]string(nil), middlewareOrder...)
}
