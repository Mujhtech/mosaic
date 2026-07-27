package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/browserauthpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/experimentpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/hostedpublishingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/objectstoreminio"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/placementdecisionpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/protocolschema"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/ratelimit"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/revenuecat"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
	browserauthhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/transport/health"
)

func main() {
	if err := run(); err != nil {
		logger := zerolog.New(os.Stderr).
			With().
			Timestamp().
			Logger()
		logger.Error().
			Err(err).
			Msg("api stopped")
		os.Exit(1)
	}
}

// openSchemas resolves every canonical schema the runtime compiles. Schemas are
// embedded in the binary; a configured path is an explicit operator override.
func openSchemas(cfg config.Config) (map[protocolschema.Schema]io.ReadCloser, error) {
	overrides := map[protocolschema.Schema]string{
		protocolschema.PaywallV02:              cfg.Protocol.V02SchemaPath,
		protocolschema.CommerceProviderV1:      cfg.Protocol.CommerceProviderSchemaPath,
		protocolschema.CommerceProviderV2:      cfg.Protocol.CommerceProviderV2SchemaPath,
		protocolschema.CommerceConfigurationV1: cfg.Protocol.CommerceConfigurationSchemaPath,
		protocolschema.CommerceConfigurationV2: cfg.Protocol.CommerceConfigurationV2SchemaPath,
		protocolschema.AnalyticsEventV1:        cfg.Analytics.EventSchemaPath,
		protocolschema.AnalyticsEventV2:        cfg.Analytics.EventV2SchemaPath,
	}
	readers := make(map[protocolschema.Schema]io.ReadCloser, len(overrides))
	for schema, override := range overrides {
		reader, err := protocolschema.Open(schema, override)
		if err != nil {
			closeSchemas(readers)
			return nil, err
		}
		readers[schema] = reader
	}
	return readers, nil
}

func closeSchemas(readers map[protocolschema.Schema]io.ReadCloser) {
	for _, reader := range readers {
		_ = reader.Close()
	}
}

func run() (runErr error) {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	logger, err := logging.New(cfg.Log.Level, cfg.Log.Format, os.Stdout)
	if err != nil {
		return fmt.Errorf("configure logging: %w", err)
	}
	build := buildinfo.Current()
	logger = logger.With().
		Str("service", cfg.Telemetry.ServiceName).
		Str("environment", cfg.Environment).
		Str("version", build.Version).
		Logger()

	runContext, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	shutdownTelemetry, err := telemetry.New(runContext, telemetry.Config{
		ServiceName:  cfg.Telemetry.ServiceName,
		Environment:  cfg.Environment,
		OTLPEndpoint: cfg.Telemetry.OTLPEndpoint,
	})
	if err != nil {
		return fmt.Errorf("configure telemetry: %w", err)
	}
	defer func() {
		// Telemetry flush has its own budget so a slow collector cannot consume
		// the HTTP drain budget or delay closing the database pool.
		shutdownContext, cancel := context.WithTimeout(
			context.Background(),
			cfg.HTTP.TelemetryShutdownTimeout,
		)
		defer cancel()

		if err := shutdownTelemetry(shutdownContext); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("shutdown telemetry: %w", err))
		}
	}()

	databasePool, err := database.Open(runContext, database.Config{
		URL:               cfg.Database.URL,
		MaxConnections:    cfg.Database.MaxConnections,
		MinConnections:    cfg.Database.MinConnections,
		ConnectTimeout:    cfg.Database.ConnectTimeout,
		MaxConnLifetime:   cfg.Database.MaxConnLifetime,
		MaxConnIdleTime:   cfg.Database.MaxConnIdleTime,
		HealthCheckPeriod: cfg.Database.HealthCheckPeriod,
		StatementTimeout:  cfg.Database.StatementTimeout,
		LockTimeout:       cfg.Database.LockTimeout,
	})
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer func() {
		// Close is synchronous; the budget bounds how long callers may still be
		// returning connections before the process exits.
		closeContext, cancel := context.WithTimeout(context.Background(), cfg.Database.CloseTimeout)
		defer cancel()
		done := make(chan struct{})
		go func() { databasePool.Close(); close(done) }()
		select {
		case <-done:
		case <-closeContext.Done():
			logger.Warn().Msg("database pool did not close within the configured budget")
		}
	}()
	if err := database.RegisterPoolMetrics(databasePool); err != nil {
		return fmt.Errorf("register database metrics: %w", err)
	}

	// Startup fails closed when the schema does not match this binary; Mosaic
	// never migrates during normal startup.
	if err := database.MigrationCompatibility(runContext, databasePool); err != nil {
		return fmt.Errorf("verify migration compatibility: %w", err)
	}

	schemas, err := openSchemas(cfg)
	if err != nil {
		return err
	}
	protocolValidator, err := hostedpublishing.CompileProtocolValidator(schemas[protocolschema.PaywallV02])
	if err != nil {
		closeSchemas(schemas)
		return err
	}
	commerceValidator, err := hostedpublishing.CompileCommerceConfigurationValidator(
		schemas[protocolschema.CommerceProviderV1], schemas[protocolschema.CommerceConfigurationV1],
		schemas[protocolschema.CommerceProviderV2], schemas[protocolschema.CommerceConfigurationV2],
	)
	if err != nil {
		closeSchemas(schemas)
		return err
	}
	analyticsValidator, err := analytics.CompileSchemaValidators(
		schemas[protocolschema.AnalyticsEventV1], schemas[protocolschema.AnalyticsEventV2],
	)
	closeSchemas(schemas)
	if err != nil {
		return err
	}

	objectStore, err := objectstoreminio.New(objectstoreminio.Config{
		Endpoint: cfg.ObjectStore.Endpoint, AccessKey: cfg.ObjectStore.AccessKey,
		SecretKey: cfg.ObjectStore.SecretKey, Bucket: cfg.ObjectStore.Bucket, UseTLS: cfg.ObjectStore.UseTLS,
		OperationTimeout: cfg.ObjectStore.OperationTimeout, CheckTimeout: cfg.ObjectStore.CheckTimeout,
	})
	if err != nil {
		return err
	}
	if err := objectStore.Check(runContext); err != nil {
		return fmt.Errorf("initialize object storage: %w", err)
	}

	workspaceRepository := cloudworkspacepostgres.New(databasePool)
	workspaceOptions := make([]cloudworkspace.ServiceOption, 0, 1)
	if cfg.Providers.Enabled {
		credentialCipher, err := providercredential.NewAESGCMCipher(cfg.Providers.CredentialKeyring, rand.Reader)
		if err != nil {
			return fmt.Errorf("configure provider credential encryption: %w", err)
		}
		revenueCatClient, err := revenuecat.New(revenuecat.Config{
			BaseURL:          cfg.Providers.RevenueCatBaseURL,
			RequestTimeout:   cfg.Providers.RequestTimeout,
			OperationTimeout: cfg.Providers.OperationTimeout,
			ConnectTimeout:   cfg.Providers.ConnectTimeout,
			MaxResponseBytes: cfg.Providers.MaxResponseBytes,
			MaxAttempts:      cfg.Providers.MaxAttempts,
		})
		if err != nil {
			return fmt.Errorf("configure RevenueCat adapter: %w", err)
		}
		workspaceOptions = append(workspaceOptions,
			cloudworkspace.WithProviderOperations(credentialCipher, revenueCatClient, cfg.Providers.SnapshotTTL),
		)
	}
	workspaceService := cloudworkspace.NewService(workspaceRepository, workspaceOptions...)
	browserAuthService := browserauth.NewService(browserauthpostgres.New(databasePool), cfg.BrowserAuth.SessionLifetime)
	publishingRepository := hostedpublishingpostgres.New(databasePool)
	publishingService := hostedpublishing.NewService(publishingRepository,
		hostedpublishing.WithProtocolValidator(protocolValidator),
		hostedpublishing.WithCommerceConfigurationValidator(commerceValidator),
		hostedpublishing.WithObjectStore(objectStore, cfg.ObjectStore.PublicAssetBaseURL, cfg.ObjectStore.MaxUploadBytes),
	)
	placementDecisionService := placementdecision.NewService(placementdecisionpostgres.New(databasePool))
	analyticsService := analytics.NewService(analyticspostgres.New(databasePool), objectStore, analyticsValidator)
	experimentService := experiment.NewService(experimentpostgres.New(databasePool))
	deliveryLimiter := ratelimit.New(cfg.Delivery.RequestsPerMinute, cfg.Delivery.Burst, cfg.Delivery.LimiterEntries)
	authenticationLimiter := ratelimit.New(cfg.BrowserAuth.RequestsPerMinute, cfg.BrowserAuth.Burst, cfg.BrowserAuth.LimiterEntries)
	apiLimiter := ratelimit.New(cfg.Delivery.APIRequestsPerMinute, cfg.Delivery.APIBurst, cfg.Delivery.LimiterEntries)
	decisionLimiter := ratelimit.New(cfg.Delivery.DecisionRequestsPerMinute, cfg.Delivery.DecisionBurst, cfg.Delivery.LimiterEntries)
	analyticsIPLimiter := ratelimit.New(cfg.Analytics.IPRequestsPerMinute, cfg.Analytics.IPBurst, cfg.Analytics.LimiterEntries)
	analyticsKeyLimiter := ratelimit.New(cfg.Analytics.KeyBatchesPerMinute, cfg.Analytics.KeyBatchBurst, cfg.Analytics.LimiterEntries)
	analyticsEventLimiter := ratelimit.New(cfg.Analytics.KeyEventsPerMinute, cfg.Analytics.KeyEventBurst, cfg.Analytics.LimiterEntries)

	readiness := health.NewReadiness(
		health.Check{Name: "postgresql", Code: "database_unavailable", Probe: func(ctx context.Context) error {
			return database.Ping(ctx, databasePool)
		}},
		health.Check{Name: "object_storage", Code: "object_storage_unavailable", Probe: objectStore.Check},
		health.Check{Name: "migrations", Code: "migration_incompatible", Probe: func(ctx context.Context) error {
			return database.MigrationCompatibility(ctx, databasePool)
		}},
		health.Check{Name: "encryption", Code: "encryption_misconfigured", Probe: func(context.Context) error {
			if !cfg.Providers.Enabled {
				return nil
			}
			return providercredential.ValidateKeyring(cfg.Providers.CredentialKeyring)
		}},
	)

	handler := httpserver.NewWithDependencies(httpserver.Config{
		ServiceName:       cfg.Telemetry.ServiceName,
		AllowedOrigins:    cfg.HTTP.CORSAllowedOrigins,
		RequestTimeout:    cfg.HTTP.HandlerTimeout,
		UploadTimeout:     cfg.HTTP.UploadTimeout,
		IngestTimeout:     cfg.HTTP.IngestTimeout,
		TrustedProxyCIDRs: cfg.HTTP.TrustedProxyCIDRs,
		EnableHSTS:        cfg.ProductionLike(),
	}, logger, httpserver.Dependencies{
		BrowserAuth:           browserAuthService,
		BrowserAuthConfig:     browserauthhttp.Config{CookieSecure: cfg.BrowserAuth.CookieSecure, CookieDomain: cfg.BrowserAuth.CookieDomain, AllowedOrigins: cfg.HTTP.CORSAllowedOrigins, RateLimiter: authenticationLimiter},
		CloudWorkspace:        workspaceService,
		HostedPublishing:      publishingService,
		PlacementDecision:     placementDecisionService,
		PrincipalResolver:     authn.NewBrowserSessionResolver(browserAuthService),
		DeliveryLimiter:       deliveryLimiter,
		Analytics:             analyticsService,
		AnalyticsIPLimiter:    analyticsIPLimiter,
		AnalyticsKeyLimiter:   analyticsKeyLimiter,
		AnalyticsEventLimiter: analyticsEventLimiter,
		Experiment:            experimentService,
		APILimiter:            apiLimiter,
		DecisionLimiter:       decisionLimiter,
		Readiness:             readiness,
		ReadinessChecker:      database.HealthChecker{Pinger: databasePool},
	})

	server := &http.Server{
		Addr:              cfg.HTTP.Address,
		Handler:           handler,
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		WriteTimeout:      cfg.HTTP.WriteTimeout,
		IdleTimeout:       cfg.HTTP.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}

	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	logger.Info().
		Str("address", cfg.HTTP.Address).
		Str("commit", build.Commit).
		Msg("api listening")

	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve http: %w", err)
		}
		return nil
	case <-runContext.Done():
		logger.Info().Msg("api shutdown requested")
	}

	// Readiness flips first so a load balancer stops routing new work before
	// in-flight requests are drained.
	readiness.StartDraining()

	shutdownContext, cancel := context.WithTimeout(
		context.Background(),
		cfg.HTTP.ShutdownTimeout,
	)
	defer cancel()

	if err := server.Shutdown(shutdownContext); err != nil {
		closeErr := server.Close()
		return errors.Join(
			fmt.Errorf("graceful http shutdown: %w", err),
			closeErr,
		)
	}

	if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("finish http shutdown: %w", err)
	}

	logger.Info().Msg("api stopped gracefully")
	return nil
}
