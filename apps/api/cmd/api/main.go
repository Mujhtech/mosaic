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
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingdiagnostics"
	"github.com/Mujhtech/mosaic/apps/api/internal/billinggrant"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingoperator"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingaccesspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingcustomerpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingdiagnosticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billinggrantpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingkeys"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationrepair"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationvalidation"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingoperatorpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingprojectionpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingrestorepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingseam"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingwebhookpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/browserauthpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/experimentpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
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

func repairExecutionEnabled(cfg config.Config) bool {
	return cfg.Billing.Enabled && cfg.Migration.Enabled
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
	// Applied to whichever logger ends up in use, so the local stream and the
	// exported records carry the same service identity.
	withServiceContext := func(base zerolog.Logger) zerolog.Logger {
		return base.With().
			Str("service", cfg.Telemetry.ServiceName).
			Str("environment", cfg.Environment).
			Str("version", build.Version).
			Logger()
	}
	logger = withServiceContext(logger)

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
		OTLPProtocol: cfg.Telemetry.OTLPProtocol,
		OTLPHeaders:  cfg.Telemetry.OTLPHeaders,
		// Startup validation has already refused an unverified collector in a
		// production-like environment unless it was explicitly acknowledged.
		OTLPTLSSkipVerify: cfg.Telemetry.TLSSkipVerify,
		DisableLogExport:  !cfg.Telemetry.ExportLogs(),
		// Telemetry keeps the local-only logger: routing its own export failures
		// through the exporting logger would feed the failing exporter.
		Logger: logger,
	})
	if err != nil {
		return fmt.Errorf("configure telemetry: %w", err)
	}
	if cfg.Telemetry.ExportLogs() {
		// Swapped in only once the logger provider exists, so every record this
		// logger writes locally also reaches the collector.
		exportingLogger, err := logging.NewExporting(
			cfg.Log.Level, cfg.Log.Format, os.Stdout, cfg.Telemetry.ServiceName,
		)
		if err != nil {
			return fmt.Errorf("configure log export: %w", err)
		}
		logger = withServiceContext(exportingLogger)
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
	uploadLimiter := ratelimit.New(cfg.Delivery.UploadRequestsPerMinute, cfg.Delivery.UploadBurst, cfg.Delivery.LimiterEntries)
	exportLimiter := ratelimit.New(cfg.Delivery.ExportRequestsPerMinute, cfg.Delivery.ExportBurst, cfg.Delivery.LimiterEntries)
	analyticsIPLimiter := ratelimit.New(cfg.Analytics.IPRequestsPerMinute, cfg.Analytics.IPBurst, cfg.Analytics.LimiterEntries)
	analyticsKeyLimiter := ratelimit.New(cfg.Analytics.KeyBatchesPerMinute, cfg.Analytics.KeyBatchBurst, cfg.Analytics.LimiterEntries)
	analyticsEventLimiter := ratelimit.New(cfg.Analytics.KeyEventsPerMinute, cfg.Analytics.KeyEventBurst, cfg.Analytics.LimiterEntries)

	var billingService *billing.Service
	var billingAccessService *billingaccess.Service
	var billingDiagnosticsService *billingdiagnostics.Service
	var billingGrantService *billinggrant.Service
	var billingMigrationService *billingmigration.Service
	var billingMigrationSourcePull *billingmigration.SourcePullService
	var billingMigrationOperations *billingmigration.OperationsService
	var billingMigrationRedelivery *billingmigration.RedeliveryService
	var billingMigrationReads *billingmigration.OperationalReadService
	var billingMigrationStabilization *billingmigration.StabilizationService
	var billingMigrationRollbackReadiness *billingmigration.RollbackReadinessService
	var billingMigrationRepairOnline bool
	var billingRestoreService *billingrestore.Service
	var billingCustomerService *billingcustomer.Service
	var billingOperatorService *billingoperator.Service
	var billingProjectionService *billingprojection.Service
	var billingWebhookService *billingwebhook.Service
	var billingIPLimiter, billingKeyLimiter, entitlementSyncLimiter *ratelimit.Limiter
	if cfg.Billing.Enabled {
		billingCipher, err := providercredential.NewAESGCMCipher(cfg.Providers.CredentialKeyring, rand.Reader)
		if err != nil {
			return fmt.Errorf("configure billing credential encryption: %w", err)
		}
		migrationRevenueCatClient, err := revenuecat.New(revenuecat.Config{
			BaseURL: cfg.Providers.RevenueCatBaseURL, RequestTimeout: cfg.Providers.RequestTimeout,
			OperationTimeout: cfg.Providers.OperationTimeout, ConnectTimeout: cfg.Providers.ConnectTimeout,
			MaxResponseBytes: cfg.Providers.MaxResponseBytes, MaxAttempts: cfg.Providers.MaxAttempts,
		})
		if err != nil {
			return fmt.Errorf("configure RevenueCat migration adapter: %w", err)
		}
		migrationRepository := billingmigrationpostgres.New(databasePool)
		billingMigrationService = billingmigration.NewService(
			migrationRepository, billingCipher, migrationRevenueCatClient)
		// Non-repair operator controls remain readable/usable when the optional
		// execution plane is disabled; repair itself fails closed through a nil
		// executor and the explicit transport gate below.
		billingMigrationOperations = billingmigration.NewOperationsService(
			migrationRepository, migrationRepository, nil)
		billingMigrationRedelivery = billingmigration.NewRedeliveryService(migrationRepository, nil)
		billingMigrationReads = billingmigration.NewOperationalReadService(migrationRepository, migrationRepository)
		billingMigrationStabilization = billingmigration.NewStabilizationService(migrationRepository, migrationRepository)
		billingMigrationRollbackReadiness = billingmigration.NewRollbackReadinessService(migrationRepository, migrationRepository)
		if cfg.Migration.Enabled {
			billingMigrationSourcePull = billingmigration.NewSourcePullService(migrationRepository, nil)
		}
		// The Apple root is compiled in, so a broken embed fails startup rather
		// than the first notification.
		verifier, err := appstorejws.NewVerifier()
		if err != nil {
			return fmt.Errorf("configure Apple notification verification: %w", err)
		}
		appleClient, err := appstoreserver.New(appstoreserver.Config{
			ProductionBaseURL: cfg.Billing.AppleProductionBaseURL,
			SandboxBaseURL:    cfg.Billing.AppleSandboxBaseURL,
			RequestTimeout:    cfg.Providers.RequestTimeout,
			ConnectTimeout:    cfg.Providers.ConnectTimeout,
			MaxResponseBytes:  cfg.Providers.MaxResponseBytes,
		})
		if err != nil {
			return fmt.Errorf("configure App Store Server client: %w", err)
		}
		googleClient, err := googleplay.New(googleplay.Config{
			PlayBaseURL:      cfg.Billing.GooglePlayBaseURL,
			PubSubBaseURL:    cfg.Billing.GooglePubSubBaseURL,
			RequestTimeout:   cfg.Providers.RequestTimeout,
			ConnectTimeout:   cfg.Providers.ConnectTimeout,
			MaxResponseBytes: cfg.Providers.MaxResponseBytes,
		})
		if err != nil {
			return fmt.Errorf("configure Google Play client: %w", err)
		}
		billingIPLimiter = ratelimit.New(cfg.Billing.ObservationsPerMinute, cfg.Billing.ObservationBurst, cfg.Billing.LimiterEntries)
		billingKeyLimiter = ratelimit.New(cfg.Billing.ObservationsPerMinute, cfg.Billing.ObservationBurst, cfg.Billing.LimiterEntries)
		billingAccessService = billingaccess.NewService(
			billingaccesspostgres.New(databasePool),
			billingaccesspostgres.NewKeyAuthenticator(billingpostgres.New(databasePool)),
			billingaccess.WithIssuer(cfg.Telemetry.ServiceName),
			billingaccess.WithFreshness(billingaccess.Freshness{
				RefreshAfter: cfg.Billing.EntitlementRefreshAfter,
				ValidFor:     cfg.Billing.EntitlementValidFor,
				StaleGrace:   cfg.Billing.EntitlementStaleGrace(),
			}))
		entitlementSyncLimiter = ratelimit.New(cfg.Billing.EntitlementSyncPerMinute,
			cfg.Billing.EntitlementSyncBurst, cfg.Billing.LimiterEntries)
		// The API process runs no projection jobs; it constructs the projection
		// service only to enqueue triggers (identity movements) and to run
		// bounded operator replays. Both go through the same command the worker
		// runs, so there is no second write path.
		projectionRepository := billingprojectionpostgres.New(databasePool)
		billingProjectionService = billingprojection.NewService(projectionRepository)
		billingDiagnosticsService = billingdiagnostics.NewService(
			billingdiagnosticspostgres.New(databasePool),
			billingdiagnostics.WithReplay(billingProjectionService, projectionRepository))
		billingKeys := billingkeys.New(billingpostgres.New(databasePool))
		billingRestoreService = billingrestore.NewService(
			billingrestorepostgres.New(databasePool), billingKeys.Restore())
		billingCustomerService = billingcustomer.NewService(
			billingcustomerpostgres.New(databasePool), billingKeys.Identity(), billingProjectionService)
		// The Phase 9A→9B seam. The ingestion service is constructed last
		// because it depends on it: an observation submitted with a Customer
		// Access Token records the association that lets a first purchase reach
		// an identified customer, and a committed fact hands its lineage to the
		// identity service. Without this the 9B read model is unreachable from a
		// purchase, which was defect D-1.
		billingService = billing.NewService(billingpostgres.New(databasePool), billingCipher, verifier,
			billing.WithProviders(appleClient, googleClient),
			billing.WithRetention(cfg.Billing.RawRetention()),
			billing.WithNotificationBaseURL(cfg.Billing.NotificationBaseURL),
			billing.WithSeam(billingseam.New(billingCustomerService, billingAccessService),
				billingseam.New(billingCustomerService, billingAccessService)))
		if repairExecutionEnabled(cfg) {
			migrationRepairExecutor := billingmigrationrepair.NewProductionExecutor(
				billingmigrationrepair.NewPostgresStore(databasePool),
				billingmigrationvalidation.New(billingService),
				billingProjectionService,
				projectionRepository,
			)
			billingMigrationOperations = billingmigration.NewOperationsService(
				migrationRepository, migrationRepository, migrationRepairExecutor)
			billingMigrationRepairOnline = true
		}
		billingGrantService = billinggrant.NewService(billinggrantpostgres.New(databasePool))
		// The operator surface reads through the same repositories the trusted
		// APIs read through, so the dashboard and an application backend see one
		// answer derived once. Its own repository holds only the read model the
		// dashboard needs and no writer at all.
		billingOperatorService = billingoperator.NewService(
			billingoperatorpostgres.New(databasePool),
			billingaccesspostgres.New(databasePool),
			billingCustomerService)
		billingWebhookService = billingwebhook.NewService(
			billingwebhookpostgres.New(databasePool), billingCipher,
			billingwebhook.NewPolicy(billingwebhook.WithSelfHostedAllowlist(
				cfg.Billing.WebhookAllowPrivateDestinations)))
	}

	readiness := health.NewReadiness(
		health.Check{Name: "postgresql", Code: "database_unavailable", Probe: func(ctx context.Context) error {
			return database.Ping(ctx, databasePool)
		}},
		health.Check{Name: "object_storage", Code: "object_storage_unavailable", Probe: objectStore.Check},
		health.Check{Name: "migrations", Code: "migration_incompatible", DependsOn: "postgresql", Probe: func(ctx context.Context) error {
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
		BrowserAuth:                       browserAuthService,
		BrowserAuthConfig:                 browserauthhttp.Config{CookieSecure: cfg.BrowserAuth.CookieSecure, CookieDomain: cfg.BrowserAuth.CookieDomain, AllowedOrigins: cfg.HTTP.CORSAllowedOrigins, RateLimiter: authenticationLimiter},
		CloudWorkspace:                    workspaceService,
		HostedPublishing:                  publishingService,
		PlacementDecision:                 placementDecisionService,
		PrincipalResolver:                 authn.NewBrowserSessionResolver(browserAuthService),
		DeliveryLimiter:                   deliveryLimiter,
		Analytics:                         analyticsService,
		AnalyticsIPLimiter:                analyticsIPLimiter,
		AnalyticsKeyLimiter:               analyticsKeyLimiter,
		AnalyticsEventLimiter:             analyticsEventLimiter,
		Experiment:                        experimentService,
		Billing:                           billingService,
		BillingAccess:                     billingAccessService,
		BillingDiagnostics:                billingDiagnosticsService,
		BillingGrant:                      billingGrantService,
		BillingMigration:                  billingMigrationService,
		BillingMigrationSourcePull:        billingMigrationSourcePull,
		BillingMigrationOperations:        billingMigrationOperations,
		BillingMigrationRedelivery:        billingMigrationRedelivery,
		BillingMigrationReads:             billingMigrationReads,
		BillingMigrationStabilization:     billingMigrationStabilization,
		BillingMigrationRollbackReadiness: billingMigrationRollbackReadiness,
		BillingMigrationRepairOnline:      billingMigrationRepairOnline,
		BillingRestore:                    billingRestoreService,
		BillingCustomer:                   billingCustomerService,
		BillingOperator:                   billingOperatorService,
		BillingWebhook:                    billingWebhookService,
		BillingIPLimiter:                  billingIPLimiter,
		BillingKeyLimiter:                 billingKeyLimiter,
		EntitlementSyncLimiter:            entitlementSyncLimiter,
		APILimiter:                        apiLimiter,
		DecisionLimiter:                   decisionLimiter,
		UploadLimiter:                     uploadLimiter,
		ExportLimiter:                     exportLimiter,
		Readiness:                         readiness,
		ReadinessChecker:                  database.HealthChecker{Pinger: databasePool},
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

	// Then keep serving for the drain delay. http.Server.Shutdown closes every
	// listener immediately, so without this pause the draining state is
	// unobservable: a load balancer polling readiness gets connection-refused
	// instead of the 503 that tells it to stop routing, and every deploy sheds
	// traffic at the edge. The delay is the window in which readiness answers
	// 503 while the instance still serves requests already in flight.
	if delay := cfg.HTTP.DrainDelay; delay > 0 {
		logger.Info().Dur("drain_delay", delay).Msg("api draining: readiness now reports unavailable")
		timer := time.NewTimer(delay)
		defer timer.Stop()
		<-timer.C
	}

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
