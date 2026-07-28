package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/riandyrn/otelchi"
	otelchimetric "github.com/riandyrn/otelchi/metric"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/httpmiddleware"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	analyticshttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/analytics"
	billinghttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billing"
	billingaccesshttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingaccess"
	browserauthhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/browserauth"
	cloudworkspacehttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/cloudworkspace"
	experimenthttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/transport/health"
	hostedpublishinghttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/hostedpublishing"
	placementdecisionhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/placementdecision"
)

const (
	MiddlewareRequestID       = "request_id"
	MiddlewareRealIP          = "trusted_proxy_real_ip"
	MiddlewareTelemetry       = "otelchi"
	MiddlewareRequestLogging  = "request_scoped_zerolog"
	MiddlewareRecovery        = "recovery"
	MiddlewareSecurityHeaders = "security_headers"
	MiddlewareCORS            = "cors"
	MiddlewareTimeout         = "timeout"
	MiddlewareMetrics         = "otelchi_metrics"
)

var middlewareOrder = []string{
	MiddlewareRequestID,
	MiddlewareRealIP,
	MiddlewareTelemetry,
	MiddlewareMetrics,
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
	// UploadTimeout and IngestTimeout override RequestTimeout for the two
	// routes whose legitimate work exceeds the default request budget.
	UploadTimeout time.Duration
	IngestTimeout time.Duration
	// TrustedProxyCIDRs lists peers whose forwarded-client headers are honoured.
	TrustedProxyCIDRs []string
	// EnableHSTS is set when the deployment is reached over TLS.
	EnableHSTS bool
}

type Dependencies struct {
	CloudWorkspace    *cloudworkspace.Service
	HostedPublishing  *hostedpublishing.Service
	PlacementDecision *placementdecision.Service
	PrincipalResolver authn.Resolver
	// Readiness is the full dependency probe used by /health/ready. When it is
	// nil the router falls back to ReadinessChecker.
	Readiness             *health.Readiness
	ReadinessChecker      health.Checker
	BrowserAuth           *browserauth.Service
	BrowserAuthConfig     browserauthhttp.Config
	DeliveryLimiter       hostedpublishinghttp.DeliveryRateLimiter
	Analytics             *analytics.Service
	AnalyticsIPLimiter    analyticshttp.Limiter
	AnalyticsKeyLimiter   analyticshttp.Limiter
	AnalyticsEventLimiter analyticshttp.EventLimiter
	Experiment            *experiment.Service
	// Billing is nil unless MOSAIC_BILLING_ENABLED is set.
	Billing *billing.Service
	// BillingAccess owns the Phase 9B authoritative access surfaces: Customer
	// Access Tokens, the SDK entitlement sync endpoint, and the trusted-server
	// entitlement reads. It is nil whenever Billing is.
	BillingAccess *billingaccess.Service
	// EntitlementSyncLimiter bounds the SDK sync endpoint, which is the
	// highest-QPS authenticated surface Mosaic serves.
	EntitlementSyncLimiter httpmiddleware.Limiter
	// BillingIPLimiter and BillingKeyLimiter bound the observation endpoints
	// only. The store notification endpoint is deliberately unlimited.
	BillingIPLimiter  httpmiddleware.Limiter
	BillingKeyLimiter httpmiddleware.Limiter
	// APILimiter is the baseline limit for authenticated dashboard APIs.
	APILimiter httpmiddleware.Limiter
	// DecisionLimiter bounds Placement and Experiment decision reads.
	DecisionLimiter httpmiddleware.Limiter
	// UploadLimiter bounds asset upload, whose per-request cost (body size,
	// extended timeout, object-storage write) is far above the API baseline.
	UploadLimiter httpmiddleware.Limiter
	// ExportLimiter bounds the analytics, experiment, and privacy export and
	// deletion-request routes, each of which enqueues a history-scanning job.
	ExportLimiter httpmiddleware.Limiter
}

func New(cfg Config, logger zerolog.Logger) http.Handler {
	return NewWithDependencies(cfg, logger, Dependencies{})
}

func NewWithDependencies(cfg Config, logger zerolog.Logger, dependencies Dependencies) http.Handler {
	router := chi.NewRouter()

	router.Use(chimiddleware.RequestID)
	// Mosaic's own RealIP honours forwarded-client headers only from a trusted
	// peer, so limiter buckets and remote_ip log fields cannot be spoofed.
	router.Use(httpmiddleware.RealIP(cfg.TrustedProxyCIDRs))
	router.Use(otelchi.Middleware(cfg.ServiceName,
		otelchi.WithChiRoutes(router),
		otelchi.WithRequestMethodInSpanName(true),
	))
	metrics := otelchimetric.NewBaseConfig(cfg.ServiceName)
	router.Use(otelchimetric.NewRequestDurationMillis(metrics))
	router.Use(otelchimetric.NewRequestInFlight(metrics))
	router.Use(otelchimetric.NewResponseSizeBytes(metrics))
	router.Use(httpmiddleware.RequestLogging(logger))
	router.Use(httpmiddleware.Recovery)
	router.Use(httpmiddleware.SecurityHeaders(cfg.EnableHSTS))
	router.Use(corsMiddleware(cfg.AllowedOrigins))
	router.Use(httpmiddleware.Timeout(cfg.RequestTimeout))

	router.Mount("/health/live", health.LiveRoutes())
	router.Mount("/health/ready", readinessRoutes(dependencies))
	// Compatibility aliases retained for existing probes while documented callers migrate.
	router.Mount("/health", health.LiveRoutes())
	router.Mount("/ready", readinessRoutes(dependencies))
	if dependencies.BrowserAuth != nil || dependencies.CloudWorkspace != nil || dependencies.HostedPublishing != nil || dependencies.PlacementDecision != nil || dependencies.Analytics != nil || dependencies.Billing != nil || dependencies.BillingAccess != nil {
		router.Route("/v1", func(versioned chi.Router) {
			versioned.Use(trustedMutationOrigins(cfg.AllowedOrigins))
			if dependencies.BrowserAuth != nil {
				browserauthhttp.RegisterRoutes(versioned, dependencies.BrowserAuth, dependencies.BrowserAuthConfig)
			}
			if dependencies.CloudWorkspace != nil || dependencies.HostedPublishing != nil || dependencies.Analytics != nil || dependencies.Billing != nil {
				versioned.Group(func(authenticated chi.Router) {
					authenticated.Use(authn.Middleware(dependencies.PrincipalResolver))
					// Authenticated dashboard APIs had no limit at all before
					// Phase 8; the baseline bucket is per principal so one
					// tenant cannot exhaust the API for everyone.
					authenticated.Use(httpmiddleware.RateLimit("api", dependencies.APILimiter, principalKey))
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
							hostedpublishinghttp.RegisterProjectRoutes(project, dependencies.HostedPublishing,
								routeTimeout(cfg.UploadTimeout, cfg.RequestTimeout),
								httpmiddleware.RateLimit("upload", dependencies.UploadLimiter, principalKey))
						}
						if dependencies.PlacementDecision != nil {
							project.Group(func(decision chi.Router) {
								decision.Use(httpmiddleware.RateLimit("decision", dependencies.DecisionLimiter, principalKey))
								placementdecisionhttp.RegisterProjectRoutes(decision, dependencies.PlacementDecision)
							})
						}
						if dependencies.Analytics != nil {
							analyticshttp.RegisterProjectRoutes(project, dependencies.Analytics,
								httpmiddleware.RateLimit("export", dependencies.ExportLimiter, principalKey))
						}
						if dependencies.Billing != nil {
							// Credential tests, reconciliation, replay, and
							// quarantine retries each reach a provider or enqueue
							// history-scanning work, so they share the
							// export-class bucket rather than the baseline API one.
							billinghttp.RegisterProjectRoutes(project, dependencies.Billing,
								httpmiddleware.RateLimit("export", dependencies.ExportLimiter, principalKey))
						}
						if dependencies.Experiment != nil {
							project.Group(func(decision chi.Router) {
								decision.Use(httpmiddleware.RateLimit("decision", dependencies.DecisionLimiter, principalKey))
								experimenthttp.RegisterProjectRoutes(decision, dependencies.Experiment)
							})
						}
					})
				})
			}
			if dependencies.HostedPublishing != nil {
				hostedpublishinghttp.RegisterPublicRoutes(versioned, dependencies.HostedPublishing, dependencies.DeliveryLimiter)
			}
			if dependencies.Analytics != nil {
				analyticshttp.RegisterPublicRoutes(versioned, dependencies.Analytics, dependencies.AnalyticsIPLimiter, dependencies.AnalyticsKeyLimiter, dependencies.AnalyticsEventLimiter,
					routeTimeout(cfg.IngestTimeout, cfg.RequestTimeout))
			}
			if dependencies.Billing != nil {
				// Store notification intake is registered outside every
				// 429-returning limiter family: a 429 to Apple consumes one of
				// five non-renewable retries and can lose a transaction
				// permanently. Observations, which SDKs queue and retry, keep
				// their limiter.
				billinghttp.RegisterNotificationRoutes(versioned, dependencies.Billing)
				billinghttp.RegisterPublicRoutes(versioned, dependencies.Billing,
					dependencies.BillingIPLimiter, dependencies.BillingKeyLimiter)
			}
			if dependencies.BillingAccess != nil {
				// Both surfaces authenticate by API key rather than by browser
				// session, so they are registered outside the principal
				// middleware. The SDK sync endpoint is bucketed by the public
				// SDK key it presents; the trusted APIs share the baseline API
				// bucket keyed on the caller's client address, because a secret
				// server key has no dashboard principal to bucket on.
				billingaccesshttp.RegisterSDKRoutes(versioned, dependencies.BillingAccess,
					httpmiddleware.RateLimit("entitlement_sync", dependencies.EntitlementSyncLimiter, sdkKeyBucket))
				billingaccesshttp.RegisterTrustedRoutes(versioned, dependencies.BillingAccess,
					httpmiddleware.RateLimit("billing_server_api", dependencies.APILimiter, clientAddressBucket))
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

func readinessRoutes(dependencies Dependencies) http.Handler {
	if dependencies.Readiness != nil {
		return health.ReadinessRoutes(dependencies.Readiness)
	}
	return health.ReadyRoutes(dependencies.ReadinessChecker)
}

// routeTimeout returns a middleware that raises the handler timeout for one
// route subtree. It is a no-op when the override is not longer than the global
// timeout, so the default configuration keeps exactly one timeout layer.
func routeTimeout(override, global time.Duration) func(http.Handler) http.Handler {
	if override <= global {
		return nil
	}
	return httpmiddleware.RouteTimeout(override)
}

// principalKey buckets authenticated traffic by actor, falling back to the
// trusted client IP for unauthenticated requests that reach a limited subtree.
func principalKey(r *http.Request) string {
	if principal, ok := authn.FromContext(r.Context()); ok && principal.ActorID != "" {
		return "actor:" + principal.ActorID
	}
	return "ip:" + httpmiddleware.ClientIP(r)
}

// sdkKeyBucket buckets the entitlement sync endpoint by the public SDK key
// presented. Bucketing by client address alone would put every customer behind
// one mobile carrier NAT into a single bucket.
func sdkKeyBucket(r *http.Request) string {
	if key := strings.TrimSpace(r.Header.Get(billingaccesshttp.SDKKeyHeader)); key != "" {
		// Only the key prefix is used as the bucket label: it identifies the key
		// without the bucket map ever holding a credential.
		if index := strings.Index(key, "."); index > 0 {
			return "sdkkey:" + key[:index]
		}
	}
	return "ip:" + httpmiddleware.ClientIP(r)
}

// clientAddressBucket buckets a trusted-server call. The secret key itself is
// never used as a bucket key, so the limiter map cannot become a place
// credentials accumulate.
func clientAddressBucket(r *http.Request) string {
	return "ip:" + httpmiddleware.ClientIP(r)
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
