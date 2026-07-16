package config

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

const (
	defaultEnvironment       = "development"
	defaultHTTPAddress       = ":8080"
	defaultReadHeaderTimeout = 5 * time.Second
	defaultReadTimeout       = 15 * time.Second
	defaultWriteTimeout      = 15 * time.Second
	defaultIdleTimeout       = 60 * time.Second
	defaultHandlerTimeout    = 10 * time.Second
	defaultShutdownTimeout   = 10 * time.Second
	defaultLogLevel          = "info"
	defaultLogFormat         = "json"
	defaultServiceName       = "mosaic-api"
)

var defaultAllowedOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
}

type Config struct {
	Environment string
	HTTP        HTTPConfig
	Log         LogConfig
	Telemetry   TelemetryConfig
}

type HTTPConfig struct {
	Address            string
	ReadHeaderTimeout  time.Duration
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
	HandlerTimeout     time.Duration
	ShutdownTimeout    time.Duration
	CORSAllowedOrigins []string
}

type LogConfig struct {
	Level  string
	Format string
}

type TelemetryConfig struct {
	ServiceName  string
	OTLPEndpoint string
}

type lookupFunc func(string) (string, bool)

func Load() (Config, error) {
	return load(os.LookupEnv)
}

func load(lookup lookupFunc) (Config, error) {
	readHeaderTimeout, err := duration(
		lookup,
		"MOSAIC_HTTP_READ_HEADER_TIMEOUT",
		defaultReadHeaderTimeout,
	)
	if err != nil {
		return Config{}, err
	}

	readTimeout, err := duration(lookup, "MOSAIC_HTTP_READ_TIMEOUT", defaultReadTimeout)
	if err != nil {
		return Config{}, err
	}

	writeTimeout, err := duration(lookup, "MOSAIC_HTTP_WRITE_TIMEOUT", defaultWriteTimeout)
	if err != nil {
		return Config{}, err
	}

	idleTimeout, err := duration(lookup, "MOSAIC_HTTP_IDLE_TIMEOUT", defaultIdleTimeout)
	if err != nil {
		return Config{}, err
	}

	handlerTimeout, err := duration(lookup, "MOSAIC_HTTP_HANDLER_TIMEOUT", defaultHandlerTimeout)
	if err != nil {
		return Config{}, err
	}

	shutdownTimeout, err := duration(
		lookup,
		"MOSAIC_HTTP_SHUTDOWN_TIMEOUT",
		defaultShutdownTimeout,
	)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		Environment: value(lookup, "MOSAIC_ENVIRONMENT", defaultEnvironment),
		HTTP: HTTPConfig{
			Address:           value(lookup, "MOSAIC_HTTP_ADDRESS", defaultHTTPAddress),
			ReadHeaderTimeout: readHeaderTimeout,
			ReadTimeout:       readTimeout,
			WriteTimeout:      writeTimeout,
			IdleTimeout:       idleTimeout,
			HandlerTimeout:    handlerTimeout,
			ShutdownTimeout:   shutdownTimeout,
			CORSAllowedOrigins: commaSeparated(
				lookup,
				"MOSAIC_CORS_ALLOWED_ORIGINS",
				defaultAllowedOrigins,
			),
		},
		Log: LogConfig{
			Level:  strings.ToLower(value(lookup, "MOSAIC_LOG_LEVEL", defaultLogLevel)),
			Format: strings.ToLower(value(lookup, "MOSAIC_LOG_FORMAT", defaultLogFormat)),
		},
		Telemetry: TelemetryConfig{
			ServiceName:  value(lookup, "OTEL_SERVICE_NAME", defaultServiceName),
			OTLPEndpoint: value(lookup, "OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		},
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func (cfg Config) validate() error {
	if strings.TrimSpace(cfg.Environment) == "" {
		return fmt.Errorf("MOSAIC_ENVIRONMENT must not be empty")
	}

	if _, _, err := net.SplitHostPort(cfg.HTTP.Address); err != nil {
		return fmt.Errorf("MOSAIC_HTTP_ADDRESS must be a host:port address: %w", err)
	}

	if cfg.HTTP.HandlerTimeout >= cfg.HTTP.WriteTimeout {
		return fmt.Errorf(
			"MOSAIC_HTTP_HANDLER_TIMEOUT must be shorter than MOSAIC_HTTP_WRITE_TIMEOUT",
		)
	}

	switch cfg.Log.Format {
	case "json", "console":
	default:
		return fmt.Errorf("MOSAIC_LOG_FORMAT must be json or console")
	}

	if strings.TrimSpace(cfg.Log.Level) == "" {
		return fmt.Errorf("MOSAIC_LOG_LEVEL must not be empty")
	}

	if strings.TrimSpace(cfg.Telemetry.ServiceName) == "" {
		return fmt.Errorf("OTEL_SERVICE_NAME must not be empty")
	}

	return nil
}

func duration(lookup lookupFunc, key string, fallback time.Duration) (time.Duration, error) {
	raw := value(lookup, key, fallback.String())
	parsed, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be a duration: %w", key, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("%s must be greater than zero", key)
	}

	return parsed, nil
}

func value(lookup lookupFunc, key string, fallback string) string {
	value, ok := lookup(key)
	if !ok {
		return fallback
	}

	return strings.TrimSpace(value)
}

func commaSeparated(lookup lookupFunc, key string, fallback []string) []string {
	raw, ok := lookup(key)
	if !ok {
		return append([]string(nil), fallback...)
	}

	if strings.TrimSpace(raw) == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			values = append(values, item)
		}
	}

	return values
}
