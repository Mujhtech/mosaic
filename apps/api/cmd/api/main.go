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

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/browserauthpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/database"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/hostedpublishingpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/objectstoreminio"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/ratelimit"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/revenuecat"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
	browserauthhttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/browserauth"
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

	databasePool, err := database.Open(runContext, database.Config{
		URL:            cfg.Database.URL,
		MaxConnections: cfg.Database.MaxConnections,
		MinConnections: cfg.Database.MinConnections,
		ConnectTimeout: cfg.Database.ConnectTimeout,
	})
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer databasePool.Close()

	protocolSchema, err := os.Open(cfg.Protocol.V02SchemaPath)
	if err != nil {
		return fmt.Errorf("open canonical Protocol 0.2 schema: %w", err)
	}
	protocolValidator, err := hostedpublishing.CompileProtocolValidator(protocolSchema)
	closeSchemaErr := protocolSchema.Close()
	if err != nil {
		return err
	}
	if closeSchemaErr != nil {
		return fmt.Errorf("close canonical Protocol 0.2 schema: %w", closeSchemaErr)
	}
	commerceProviderSchema, err := os.Open(cfg.Protocol.CommerceProviderSchemaPath)
	if err != nil {
		return fmt.Errorf("open canonical Commerce Provider v1 schema: %w", err)
	}
	commerceConfigurationSchema, err := os.Open(cfg.Protocol.CommerceConfigurationSchemaPath)
	if err != nil {
		_ = commerceProviderSchema.Close()
		return fmt.Errorf("open canonical Commerce Configuration v1 schema: %w", err)
	}
	commerceProviderV2Schema, err := os.Open(cfg.Protocol.CommerceProviderV2SchemaPath)
	if err != nil {
		_ = commerceProviderSchema.Close()
		_ = commerceConfigurationSchema.Close()
		return fmt.Errorf("open canonical Commerce Provider v2 schema: %w", err)
	}
	commerceConfigurationV2Schema, err := os.Open(cfg.Protocol.CommerceConfigurationV2SchemaPath)
	if err != nil {
		_ = commerceProviderSchema.Close()
		_ = commerceConfigurationSchema.Close()
		_ = commerceProviderV2Schema.Close()
		return fmt.Errorf("open canonical Commerce Configuration v2 schema: %w", err)
	}
	commerceValidator, err := hostedpublishing.CompileCommerceConfigurationValidator(
		commerceProviderSchema, commerceConfigurationSchema,
		commerceProviderV2Schema, commerceConfigurationV2Schema,
	)
	closeCommerceProviderErr := commerceProviderSchema.Close()
	closeCommerceConfigurationErr := commerceConfigurationSchema.Close()
	closeCommerceProviderV2Err := commerceProviderV2Schema.Close()
	closeCommerceConfigurationV2Err := commerceConfigurationV2Schema.Close()
	if err != nil {
		return err
	}
	if closeErr := errors.Join(closeCommerceProviderErr, closeCommerceConfigurationErr, closeCommerceProviderV2Err, closeCommerceConfigurationV2Err); closeErr != nil {
		return fmt.Errorf("close canonical commerce schemas: %w", closeErr)
	}

	objectStore, err := objectstoreminio.New(objectstoreminio.Config{
		Endpoint: cfg.ObjectStore.Endpoint, AccessKey: cfg.ObjectStore.AccessKey,
		SecretKey: cfg.ObjectStore.SecretKey, Bucket: cfg.ObjectStore.Bucket, UseTLS: cfg.ObjectStore.UseTLS,
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
	deliveryLimiter := ratelimit.New(cfg.Delivery.RequestsPerMinute, cfg.Delivery.Burst, cfg.Delivery.LimiterEntries)
	authenticationLimiter := ratelimit.New(cfg.BrowserAuth.RequestsPerMinute, cfg.BrowserAuth.Burst, cfg.BrowserAuth.LimiterEntries)
	handler := httpserver.NewWithDependencies(httpserver.Config{
		ServiceName:    cfg.Telemetry.ServiceName,
		AllowedOrigins: cfg.HTTP.CORSAllowedOrigins,
		RequestTimeout: cfg.HTTP.HandlerTimeout,
	}, logger, httpserver.Dependencies{
		BrowserAuth:       browserAuthService,
		BrowserAuthConfig: browserauthhttp.Config{CookieSecure: cfg.BrowserAuth.CookieSecure, CookieDomain: cfg.BrowserAuth.CookieDomain, AllowedOrigins: cfg.HTTP.CORSAllowedOrigins, RateLimiter: authenticationLimiter},
		CloudWorkspace:    workspaceService,
		HostedPublishing:  publishingService,
		PrincipalResolver: authn.NewBrowserSessionResolver(browserAuthService),
		DeliveryLimiter:   deliveryLimiter,
		ReadinessChecker:  database.HealthChecker{Pinger: databasePool},
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
