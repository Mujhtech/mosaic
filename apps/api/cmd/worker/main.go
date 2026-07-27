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
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/experimentpostgres"
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
	runContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.New(runContext, telemetry.Config{
		ServiceName: cfg.Telemetry.ServiceName, Environment: cfg.Environment,
		OTLPEndpoint: cfg.Telemetry.OTLPEndpoint,
	})
	if err != nil {
		return fmt.Errorf("configure telemetry: %w", err)
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
		providerService = cloudworkspace.NewService(cloudworkspacepostgres.New(pool), cloudworkspace.WithProviderOperations(cipher, client, cfg.Providers.SnapshotTTL))
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

	families := make([]jobFamily, 0, 3)
	if providerService != nil {
		families = append(families, jobFamily{"provider_sync", providerService.ProcessNextProviderSync})
	}
	families = append(families,
		jobFamily{"analytics", analyticsService.ProcessNextJob},
		jobFamily{"experiment_schedule", experimentService.ProcessNextSchedule},
	)

	logger.Info().
		Str("worker_id", workerID).
		Str("health_address", cfg.Worker.HealthAddress).
		Int("job_families", len(families)).
		Msg("worker started")

	// Jobs run on a context detached from the signal context so a job in flight
	// during SIGTERM can still commit its outcome. The budget bounds it.
	jobBudget := cfg.Worker.JobShutdownBudget
	next := 0
	for {
		processedAny := false
		for range families {
			family := families[next%len(families)]
			next++
			// processOne logs its own failure through the job context, which
			// carries the job, tenant, and trace identifiers this loop does not
			// have.
			processed, _ := processOne(runContext, jobBudget, family, workerID, logger)
			processedAny = processedAny || processed
		}
		select {
		case err := <-healthErrors:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				return fmt.Errorf("serve worker health listener: %w", err)
			}
		default:
		}
		if runContext.Err() != nil {
			logger.Info().Msg("worker stopped gracefully")
			return nil
		}
		if processedAny {
			continue
		}
		interval := cfg.Analytics.WorkerPollInterval
		if providerService != nil && cfg.Providers.WorkerPollInterval < interval {
			interval = cfg.Providers.WorkerPollInterval
		}
		select {
		case <-runContext.Done():
			logger.Info().Msg("worker stopped gracefully")
			return nil
		case <-time.After(interval):
		}
	}
}

// processOne runs one job on a detached context with a completion budget and
// emits one structured line per executed job.
//
// The completion line is written through the logger read back out of the job
// context, not through the local copy: each job family calls
// jobtelemetry.Annotate once it knows what it leased, which adds the job id,
// tenant identifiers, and trace id. Without that read-back the line would name
// only the family and the worker, which no runbook step can act on.
func processOne(runContext context.Context, budget time.Duration, family jobFamily, workerID string, logger zerolog.Logger) (bool, error) {
	jobLogger := logger.With().Str("job_family", family.name).Str("worker_id", workerID).Logger()
	jobContext, cancel := context.WithTimeout(context.WithoutCancel(runContext), budget)
	defer cancel()
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
