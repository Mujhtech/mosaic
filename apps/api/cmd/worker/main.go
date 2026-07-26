package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/objectstoreminio"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/revenuecat"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

func main() {
	if err := run(); err != nil {
		logger := zerolog.New(os.Stderr).With().Timestamp().Logger()
		logger.Error().Err(err).Msg("worker stopped")
		os.Exit(1)
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
	logger = logger.With().Str("service", cfg.Telemetry.ServiceName).Str("environment", cfg.Environment).Logger()
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
		shutdownContext, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
		defer cancel()
		if err := shutdownTelemetry(shutdownContext); err != nil {
			runErr = errors.Join(runErr, err)
		}
	}()
	pool, err := database.Open(runContext, database.Config{
		URL: cfg.Database.URL, MaxConnections: cfg.Database.MaxConnections,
		MinConnections: cfg.Database.MinConnections, ConnectTimeout: cfg.Database.ConnectTimeout,
	})
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer pool.Close()
	objectStore, err := objectstoreminio.New(objectstoreminio.Config{Endpoint: cfg.ObjectStore.Endpoint, AccessKey: cfg.ObjectStore.AccessKey, SecretKey: cfg.ObjectStore.SecretKey, Bucket: cfg.ObjectStore.Bucket, UseTLS: cfg.ObjectStore.UseTLS})
	if err != nil {
		return err
	}
	if err = objectStore.Check(runContext); err != nil {
		return fmt.Errorf("initialize object storage: %w", err)
	}
	analyticsService := analytics.NewService(analyticspostgres.New(pool), objectStore)
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
	logger.Info().Str("worker_id", workerID).Msg("worker started")
	for {
		processed := false
		if providerService != nil {
			providerProcessed, processErr := providerService.ProcessNextProviderSync(runContext, workerID)
			processed = providerProcessed
			if processErr != nil {
				logger.Error().Err(processErr).Msg("provider sync job processing failed")
			}
		}
		analyticsProcessed, processErr := analyticsService.ProcessNextJob(runContext, workerID)
		processed = processed || analyticsProcessed
		if processErr != nil {
			logger.Error().Err(processErr).Msg("analytics job processing failed")
		}
		if runContext.Err() != nil {
			logger.Info().Msg("provider worker stopped gracefully")
			return nil
		}
		if processed {
			continue
		}
		timer := cfg.Analytics.WorkerPollInterval
		if providerService != nil && cfg.Providers.WorkerPollInterval < timer {
			timer = cfg.Providers.WorkerPollInterval
		}
		select {
		case <-runContext.Done():
			logger.Info().Msg("provider worker stopped gracefully")
			return nil
		case <-time.After(timer):
		}
	}
}
