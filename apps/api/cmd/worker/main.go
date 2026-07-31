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

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
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
	if !cfg.Providers.Enabled {
		return errors.New("provider worker requires MOSAIC_PROVIDER_INTEGRATIONS_ENABLED=true")
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
	service := cloudworkspace.NewService(
		cloudworkspacepostgres.New(pool),
		cloudworkspace.WithProviderOperations(cipher, client, cfg.Providers.SnapshotTTL),
	)
	workerID, err := os.Hostname()
	if err != nil || workerID == "" {
		workerID = "mosaic-provider-worker"
	}
	logger.Info().Str("worker_id", workerID).Msg("provider worker started")
	for {
		processed, err := service.ProcessNextProviderSync(runContext, workerID)
		if err != nil {
			logger.Error().Err(err).Msg("provider sync job processing failed")
		}
		if runContext.Err() != nil {
			logger.Info().Msg("provider worker stopped gracefully")
			return nil
		}
		if processed {
			continue
		}
		timer := cfg.Providers.WorkerPollInterval
		select {
		case <-runContext.Done():
			logger.Info().Msg("provider worker stopped gracefully")
			return nil
		case <-time.After(timer):
		}
	}
}
