// Command worker runs Mosaic's background job families: analytics aggregation,
// retention, privacy export and deletion, Experiment scheduling, and provider
// synchronization.
//
// Jobs run on a background context with a completion budget so a failure record
// still commits when SIGTERM arrives mid-job, and the families are polled
// round-robin so one busy family cannot starve another.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreconnect"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstorejws"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/appstoreserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingaccesspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingcustomerpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingdiagnosticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingkeys"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationevaluation"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationobject"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationrepair"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationvalidation"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingprojectionpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingrestorepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingseam"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingwebhookpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/experimentpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/googleplay"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/objectstoreminio"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/revenuecat"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
	"github.com/Mujhtech/mosaic/apps/api/internal/transport/health"
)

func main() {
	if err := run(); err != nil {
		logger := zerolog.New(os.Stderr).With().Timestamp().Logger()
		logger.Error().Err(err).Msg("worker stopped")
		os.Exit(1)
	}
}

// jobFamily is one pollable source of work. Families are tried round-robin so a
// continuously busy analytics queue cannot starve Experiment scheduling.
type jobFamily struct {
	name    string
	process func(context.Context, string) (bool, error)
	// interval is how long this family's loop waits after a poll that found
	// no work, so each domain keeps its own configured cadence.
	interval time.Duration
}

// migrationSourceObjectDeleter keeps retention deletion pinned to the private
// migration bucket. The public asset store is deliberately not accepted here.
type migrationSourceObjectDeleter struct{ store *objectstoreminio.Store }

func (d migrationSourceObjectDeleter) DeleteRawSourceObject(ctx context.Context, key string) (string, error) {
	if err := d.store.Delete(ctx, key); err != nil {
		return "retryable_failure", err
	}
	return "deleted", nil
}

type migrationRetentionProcessor struct {
	service *billingmigration.OperationsService
	deleter migrationSourceObjectDeleter
}

func (p migrationRetentionProcessor) ProcessNext(ctx context.Context, workerID string) (bool, error) {
	err := p.service.RunRetention(ctx, workerID, 2*time.Minute, p.deleter)
	if errors.Is(err, billingmigration.ErrNotFound) {
		return false, nil
	}
	return true, err
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
	runContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.New(runContext, telemetry.Config{
		ServiceName: cfg.Telemetry.ServiceName, Environment: cfg.Environment,
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
		shutdownContext, cancel := context.WithTimeout(context.Background(), cfg.HTTP.TelemetryShutdownTimeout)
		defer cancel()
		if err := shutdownTelemetry(shutdownContext); err != nil {
			runErr = errors.Join(runErr, err)
		}
	}()

	pool, err := database.Open(runContext, database.Config{
		URL: cfg.Database.URL, MaxConnections: cfg.Database.MaxConnections,
		MinConnections: cfg.Database.MinConnections, ConnectTimeout: cfg.Database.ConnectTimeout,
		MaxConnLifetime: cfg.Database.MaxConnLifetime, MaxConnIdleTime: cfg.Database.MaxConnIdleTime,
		HealthCheckPeriod: cfg.Database.HealthCheckPeriod,
		StatementTimeout:  cfg.Database.StatementTimeout, LockTimeout: cfg.Database.LockTimeout,
	})
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer pool.Close()
	if err := database.RegisterPoolMetrics(pool); err != nil {
		return fmt.Errorf("register database metrics: %w", err)
	}
	if err := database.MigrationCompatibility(runContext, pool); err != nil {
		return fmt.Errorf("verify migration compatibility: %w", err)
	}

	objectStore, err := objectstoreminio.New(objectstoreminio.Config{
		Endpoint: cfg.ObjectStore.Endpoint, AccessKey: cfg.ObjectStore.AccessKey,
		SecretKey: cfg.ObjectStore.SecretKey, Bucket: cfg.ObjectStore.Bucket, UseTLS: cfg.ObjectStore.UseTLS,
		OperationTimeout: cfg.ObjectStore.OperationTimeout, CheckTimeout: cfg.ObjectStore.CheckTimeout,
	})
	if err != nil {
		return err
	}
	if err = objectStore.Check(runContext); err != nil {
		return fmt.Errorf("initialize object storage: %w", err)
	}

	analyticsRepository := analyticspostgres.New(pool)
	analyticsService := analytics.NewService(analyticsRepository, objectStore)
	experimentRepository := experimentpostgres.New(pool)
	experimentService := experiment.NewService(experimentRepository)
	var providerService *cloudworkspace.Service
	if cfg.Providers.Enabled {
		cipher, err := providercredential.NewAESGCMCipher(cfg.Providers.CredentialKeyring, rand.Reader)
		if err != nil {
			return fmt.Errorf("configure provider credential encryption: %w", err)
		}
		client, err := revenuecat.New(revenuecat.Config{
			BaseURL: cfg.Providers.RevenueCatBaseURL, RequestTimeout: cfg.Providers.RequestTimeout,
			OperationTimeout: cfg.Providers.OperationTimeout,
			ConnectTimeout:   cfg.Providers.ConnectTimeout, MaxResponseBytes: cfg.Providers.MaxResponseBytes,
			MaxAttempts: cfg.Providers.MaxAttempts,
		})
		if err != nil {
			return fmt.Errorf("configure RevenueCat adapter: %w", err)
		}
		appStoreConnectClient, err := appstoreconnect.New(appstoreconnect.Config{
			BaseURL: cfg.Providers.AppStoreConnectBaseURL, RequestTimeout: cfg.Providers.RequestTimeout,
			OperationTimeout: cfg.Providers.OperationTimeout,
			ConnectTimeout:   cfg.Providers.ConnectTimeout, MaxResponseBytes: cfg.Providers.MaxResponseBytes,
			MaxAttempts: cfg.Providers.MaxAttempts,
		})
		if err != nil {
			return fmt.Errorf("configure App Store Connect adapter: %w", err)
		}
		providerService = cloudworkspace.NewService(cloudworkspacepostgres.New(pool),
			cloudworkspace.WithProviderOperations(cipher, cloudworkspace.ProviderCatalogClients{
				cloudworkspace.ProviderRevenueCat:      client,
				cloudworkspace.ProviderAppStoreConnect: appStoreConnectClient,
			}, cfg.Providers.SnapshotTTL))
	}

	var billingService *billing.Service
	var billingRepository *billingpostgres.Repository
	var projectionRepository *billingprojectionpostgres.Repository
	var projectionService *billingprojection.Service
	var restoreService *billingrestore.Service
	var restoreRepository *billingrestorepostgres.Repository
	var webhookService *billingwebhook.Service
	var webhookRepository *billingwebhookpostgres.Repository
	if cfg.Billing.Enabled {
		billingCipher, err := providercredential.NewAESGCMCipher(cfg.Providers.CredentialKeyring, rand.Reader)
		if err != nil {
			return fmt.Errorf("configure billing credential encryption: %w", err)
		}
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
		billingRepository = billingpostgres.New(pool)
		projectionRepository = billingprojectionpostgres.New(pool)
		projectionService = billingprojection.NewService(projectionRepository)
		// The worker is where the Phase 9A→9B seam matters most: it runs the
		// validation job, so it is where a committed fact has to reach a Purchase
		// Lineage and a Billing Customer. The identity and access services are
		// constructed here for that reason alone — the worker serves no HTTP and
		// exposes neither.
		billingKeys := billingkeys.New(billingRepository)
		customerService := billingcustomer.NewService(
			billingcustomerpostgres.New(pool), billingKeys.Identity(), projectionService)
		accessService := billingaccess.NewService(
			billingaccesspostgres.New(pool),
			billingaccesspostgres.NewKeyAuthenticator(billingRepository))
		seam := billingseam.New(customerService, accessService)
		billingService = billing.NewService(billingRepository, billingCipher, verifier,
			billing.WithProviders(appleClient, googleClient),
			billing.WithRetention(cfg.Billing.RawRetention()),
			billing.WithSeam(seam, seam))
		restoreRepository = billingrestorepostgres.New(pool)
		restoreService = billingrestore.NewService(restoreRepository,
			billingkeys.New(billingRepository).Restore())
		webhookRepository = billingwebhookpostgres.New(pool)
		webhookService = billingwebhook.NewService(webhookRepository, billingCipher,
			billingwebhook.NewPolicy(billingwebhook.WithSelfHostedAllowlist(
				cfg.Billing.WebhookAllowPrivateDestinations)))
	}

	var migrationSourcePull *billingmigration.SourcePullProcessor
	var migrationSourceExecution *billingmigration.SourceExecutionProcessor
	var migrationTransitionDelivery *billingmigration.TransitionDeliveryService
	var migrationRetention migrationRetentionProcessor
	if cfg.Migration.Enabled {
		if billingService == nil {
			return errors.New("billing migration execution requires billing service")
		}
		migrationObjectStore, err := objectstoreminio.New(objectstoreminio.Config{
			Endpoint: cfg.ObjectStore.Endpoint, AccessKey: cfg.ObjectStore.AccessKey,
			SecretKey: cfg.ObjectStore.SecretKey, Bucket: cfg.Migration.SourceObjectBucket,
			UseTLS: cfg.ObjectStore.UseTLS, OperationTimeout: cfg.Migration.SourceObjectOperationTimeout,
			CheckTimeout: cfg.ObjectStore.CheckTimeout,
		})
		if err != nil {
			return fmt.Errorf("configure migration source object storage: %w", err)
		}
		if err = migrationObjectStore.Check(runContext); err != nil {
			return fmt.Errorf("initialize migration source object storage: %w", err)
		}
		migrationObjectCipher, err := billingmigrationobject.NewKeyringCipher(
			cfg.Migration.SourceObjectKeyring, cfg.Migration.SourceObjectChunkBytes)
		if err != nil {
			return fmt.Errorf("configure migration source object encryption: %w", err)
		}
		migrationCredentialCipher, err := providercredential.NewAESGCMCipher(
			cfg.Providers.CredentialKeyring, rand.Reader)
		if err != nil {
			return fmt.Errorf("configure migration provider credential encryption: %w", err)
		}
		migrationRevenueCat, err := revenuecat.New(revenuecat.Config{
			BaseURL: cfg.Providers.RevenueCatBaseURL, RequestTimeout: cfg.Providers.RequestTimeout,
			OperationTimeout: cfg.Providers.OperationTimeout,
			ConnectTimeout:   cfg.Providers.ConnectTimeout, MaxResponseBytes: cfg.Providers.MaxResponseBytes,
			MaxAttempts: cfg.Providers.MaxAttempts,
		})
		if err != nil {
			return fmt.Errorf("configure RevenueCat migration source adapter: %w", err)
		}
		migrationRepository := billingmigrationpostgres.New(pool)
		migrationRepairExecutor := billingmigrationrepair.NewProductionExecutor(
			billingmigrationrepair.NewPostgresStore(pool),
			billingmigrationvalidation.New(billingService),
			projectionService,
			projectionRepository)
		migrationIngestor := billingmigration.NewSourceObjectIngestor(
			migrationRepository, migrationObjectStore, migrationObjectCipher, nil)
		migrationSourcePull = billingmigration.NewSourcePullProcessor(
			migrationRepository, migrationRevenueCat, migrationIngestor, migrationCredentialCipher, nil)
		migrationEvaluator := billingmigrationevaluation.New(pool)
		migrationSourceExecution = billingmigration.NewSourceExecutionProcessor(
			migrationRepository, billingmigrationvalidation.New(billingService),
			migrationEvaluator, migrationEvaluator, nil)
		migrationTransitionDelivery = billingmigration.NewTransitionDeliveryService(migrationRepository, nil)
		migrationRetention = migrationRetentionProcessor{
			service: billingmigration.NewOperationsService(migrationRepository, migrationRepository, migrationRepairExecutor),
			deleter: migrationSourceObjectDeleter{store: migrationObjectStore},
		}
	}

	workerID, err := os.Hostname()
	if err != nil || workerID == "" {
		workerID = "mosaic-worker"
	}

	readiness := health.NewReadiness(
		health.Check{Name: "postgresql", Code: "database_unavailable", Probe: func(ctx context.Context) error {
			return database.Ping(ctx, pool)
		}},
	)
	healthServer, healthErrors := startHealthListener(cfg.Worker.HealthAddress, readiness)
	defer func() {
		readiness.StartDraining()
		shutdownContext, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
		defer cancel()
		if err := healthServer.Shutdown(shutdownContext); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("shutdown worker health listener: %w", err))
		}
	}()

	if err := analyticsRepository.RegisterQueueMetrics(); err != nil {
		return fmt.Errorf("register analytics queue metrics: %w", err)
	}
	if err := experimentRepository.RegisterQueueMetrics(); err != nil {
		return fmt.Errorf("register Experiment queue metrics: %w", err)
	}
	if billingRepository != nil {
		// Billing queues publish depth, oldest age, and dead-letter count from
		// day one rather than being added after the first incident.
		if err := billingRepository.RegisterQueueMetrics(); err != nil {
			return fmt.Errorf("register billing queue metrics: %w", err)
		}
		// Per-table row counts for the Phase 9B schema. Plan §15 decided
		// snapshot retention with no drill baseline to extrapolate from, so the
		// trend has to start being recorded before it is needed.
		if err := billingdiagnosticspostgres.New(pool).RegisterRowCountMetrics(); err != nil {
			return fmt.Errorf("register billing table row metrics: %w", err)
		}
		if err := restoreRepository.RegisterQueueMetrics(); err != nil {
			return fmt.Errorf("register billing restore queue metrics: %w", err)
		}
		if err := webhookRepository.RegisterQueueMetrics(); err != nil {
			return fmt.Errorf("register billing webhook queue metrics: %w", err)
		}
	}

	families := make([]jobFamily, 0, 24)
	if providerService != nil {
		families = append(families, jobFamily{"provider_sync", providerService.ProcessNextProviderSync, cfg.Providers.WorkerPollInterval})
	}
	if billingService != nil {
		// Billing families carry their own poll interval so store-notification
		// latency — validation plus projection is the one user-visible number —
		// is never coupled to analytics aggregation load.
		families = append(families,
			jobFamily{"billing_validation", billingService.ProcessNextValidation, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_identity_binding", billingService.ProcessNextIdentityBinding, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_projection", projectionService.ProcessNextProjection, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_restore_sync", restoreService.ProcessNextRestoreSync, cfg.Billing.WorkerPollInterval},
			// Delivery runs strictly outside the projection transaction. A
			// destination that is down produces retries and eventually an
			// exhausted delivery; it never rolls back an entitlement change and
			// never blocks a projection.
			jobFamily{"billing_webhook_delivery", webhookService.ProcessNextDelivery, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_rtdn", billingService.ProcessNextRTDN, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_reconciliation", billingService.ProcessNextReconciliation, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_replay", billingService.ProcessNextReplay, cfg.Billing.WorkerPollInterval},
			jobFamily{"billing_retention", billingService.ProcessRetention, cfg.Billing.WorkerPollInterval},
		)
	}
	if migrationSourcePull != nil {
		families = append(families,
			jobFamily{"billing_migration_source_pull", migrationSourcePull.ProcessNext, cfg.Migration.WorkerPollInterval},
			jobFamily{"billing_migration_import_validation", migrationSourceExecution.ProcessNextImport, cfg.Migration.WorkerPollInterval},
			jobFamily{"billing_migration_prepared_snapshot", migrationSourceExecution.ProcessNextRun, cfg.Migration.WorkerPollInterval},
			jobFamily{"billing_migration_final_delta", migrationSourceExecution.ProcessNextFinalDelta, cfg.Migration.WorkerPollInterval},
			jobFamily{"billing_migration_transition_delivery", migrationTransitionDelivery.ProcessOne, cfg.Migration.WorkerPollInterval},
			jobFamily{"billing_migration_retention", migrationRetention.ProcessNext, cfg.Migration.WorkerPollInterval},
		)
	}
	families = append(families,
		jobFamily{"analytics", analyticsService.ProcessNextJob, cfg.Analytics.WorkerPollInterval},
		jobFamily{"experiment_schedule", experimentService.ProcessNextSchedule, cfg.Analytics.WorkerPollInterval},
	)

	logger.Info().
		Str("worker_id", workerID).
		Str("health_address", cfg.Worker.HealthAddress).
		Int("job_families", len(families)).
		Msg("worker started")

	// Jobs run on a context detached from the signal context so a job in flight
	// during SIGTERM can still commit its outcome. The execution timeout bounds
	// a normal run; once the signal lands, each in-flight job keeps only the
	// shutdown budget.
	executionTimeout := cfg.Worker.JobExecutionTimeout
	shutdownBudget := cfg.Worker.JobShutdownBudget
	// One loop per family. The families lease work from independent queues
	// with FOR UPDATE SKIP LOCKED, so they are safe to run concurrently — and
	// a single serial loop head-of-line blocks every family behind one slow
	// provider call: an Apple validation riding out its response timeouts
	// would delay projection, webhooks, and analytics by that amount every
	// round. Concurrency is bounded by the family count; the database pool
	// remains the shared brake underneath.
	//
	// workContext ends either with the SIGTERM context or when the health
	// listener fails, so every family loop stops starting new jobs in both
	// shutdown paths.
	workContext, stopWork := context.WithCancel(runContext)
	defer stopWork()
	var workers sync.WaitGroup
	for _, family := range families {
		workers.Add(1)
		go func(family jobFamily) {
			defer workers.Done()
			for {
				if workContext.Err() != nil {
					return
				}
				// processOne logs its own failure through the job context,
				// which carries the job, tenant, and trace identifiers this
				// loop does not have.
				processed, _ := processOne(workContext, executionTimeout, shutdownBudget, family, workerID, logger)
				if processed {
					continue
				}
				select {
				case <-workContext.Done():
					return
				case <-time.After(family.interval):
				}
			}
		}(family)
	}
	var healthErr error
	select {
	case err := <-healthErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			healthErr = fmt.Errorf("serve worker health listener: %w", err)
		}
		stopWork()
	case <-runContext.Done():
	}
	// In-flight jobs finish on their detached contexts within the shutdown
	// budget before the deferred pool and telemetry teardown may run.
	workers.Wait()
	if healthErr != nil {
		return healthErr
	}
	logger.Info().Msg("worker stopped gracefully")
	return nil
}

// processOne runs one job on a detached context with a completion budget and
// emits one structured line per executed job.
//
// The completion line is written through the logger read back out of the job
// context, not through the local copy: each job family calls
// jobtelemetry.Annotate once it knows what it leased, which adds the job id,
// tenant identifiers, and trace id. Without that read-back the line would name
// only the family and the worker, which no runbook step can act on.
func processOne(runContext context.Context, executionTimeout, shutdownBudget time.Duration, family jobFamily, workerID string, logger zerolog.Logger) (bool, error) {
	jobLogger := logger.With().Str("job_family", family.name).Str("worker_id", workerID).Logger()
	jobContext, cancel := context.WithTimeout(context.WithoutCancel(runContext), executionTimeout)
	defer cancel()
	// The two limits are distinct on purpose: the execution timeout is sized
	// for the job leases so long-running provider syncs can actually finish,
	// while the shutdown budget keeps the post-SIGTERM drain inside the
	// deployment's termination grace. When the signal lands mid-job, the job's
	// deadline tightens to the budget from that moment.
	stop := context.AfterFunc(runContext, func() {
		time.AfterFunc(shutdownBudget, cancel)
	})
	defer stop()
	jobContext = jobLogger.WithContext(jobContext)
	started := time.Now()
	processed, err := family.process(jobContext, workerID)
	if processed {
		event := zerolog.Ctx(jobContext).Info().
			Dur("duration", time.Since(started)).
			Bool("failed", err != nil)
		event.Msg("background job finished")
	}
	if err != nil {
		zerolog.Ctx(jobContext).Error().Err(err).Msg("background job processing failed")
	}
	return processed, err
}

// atRoot serves a router mounted at "/" from a fixed ServeMux path.
func atRoot(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := r.Clone(r.Context())
		request.URL.Path = "/"
		handler.ServeHTTP(w, request)
	})
}

func startHealthListener(address string, readiness *health.Readiness) (*http.Server, <-chan error) {
	mux := http.NewServeMux()
	mux.Handle("/health/live", atRoot(health.LiveRoutes()))
	mux.Handle("/health/ready", atRoot(health.ReadinessRoutes(readiness)))
	server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	errs := make(chan error, 1)
	go func() { errs <- server.ListenAndServe() }()
	return server, errs
}
