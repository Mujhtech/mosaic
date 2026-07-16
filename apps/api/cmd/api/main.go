package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
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

func run() (runErr error) {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	logger, err := logging.New(cfg.Log.Level, cfg.Log.Format, os.Stdout)
	if err != nil {
		return fmt.Errorf("configure logging: %w", err)
	}
	logger = logger.With().
		Str("service", cfg.Telemetry.ServiceName).
		Str("environment", cfg.Environment).
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
		shutdownContext, cancel := context.WithTimeout(
			context.Background(),
			cfg.HTTP.ShutdownTimeout,
		)
		defer cancel()

		if err := shutdownTelemetry(shutdownContext); err != nil {
			runErr = errors.Join(runErr, fmt.Errorf("shutdown telemetry: %w", err))
		}
	}()

	handler := httpserver.New(httpserver.Config{
		ServiceName:    cfg.Telemetry.ServiceName,
		AllowedOrigins: cfg.HTTP.CORSAllowedOrigins,
		RequestTimeout: cfg.HTTP.HandlerTimeout,
	}, logger)

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

	logger.Info().Str("address", cfg.HTTP.Address).Msg("api listening")

	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve http: %w", err)
		}
		return nil
	case <-runContext.Done():
		logger.Info().Msg("api shutdown requested")
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
