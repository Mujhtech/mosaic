package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
)

const (
	defaultAuthRequestsMinute   = 12
	defaultAuthBurst            = 4
	defaultObjectStoreAccessKey = "mosaic"
	defaultObjectStoreSecretKey = "mosaic_dev_secret"
)

var defaultAllowedOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
}

type Config struct {
	Environment string `envconfig:"MOSAIC_ENVIRONMENT" default:"development"`
	HTTP        HTTPConfig
	Log         LogConfig
	Telemetry   TelemetryConfig
	Database    DatabaseConfig
	BrowserAuth BrowserAuthConfig
	Protocol    ProtocolConfig
	ObjectStore ObjectStoreConfig
	Delivery    DeliveryConfig
	Providers   ProviderConfig
}

type BrowserAuthConfig struct {
	SessionLifetime   time.Duration `envconfig:"MOSAIC_SESSION_LIFETIME" default:"168h"`
	CookieSecure      bool          `envconfig:"MOSAIC_SESSION_COOKIE_SECURE" default:"false"`
	CookieDomain      string        `envconfig:"MOSAIC_SESSION_COOKIE_DOMAIN"`
	RequestsPerMinute int           `envconfig:"MOSAIC_AUTH_REQUESTS_PER_MINUTE" default:"12"`
	Burst             int           `envconfig:"MOSAIC_AUTH_BURST" default:"4"`
	LimiterEntries    int           `envconfig:"MOSAIC_AUTH_LIMITER_ENTRIES" default:"10000"`
}

type ProtocolConfig struct {
	V02SchemaPath                     string `envconfig:"MOSAIC_PROTOCOL_V02_SCHEMA_PATH" default:"../../protocol/schema/v0.2/paywall.schema.json"`
	CommerceProviderSchemaPath        string `envconfig:"MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH" default:"../../protocol/schema/commerce-provider/v1/contract.schema.json"`
	CommerceConfigurationSchemaPath   string `envconfig:"MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH" default:"../../protocol/schema/commerce-configuration/v1/configuration.schema.json"`
	CommerceProviderV2SchemaPath      string `envconfig:"MOSAIC_COMMERCE_PROVIDER_V2_SCHEMA_PATH" default:"../../protocol/schema/commerce-provider/v2/contract.schema.json"`
	CommerceConfigurationV2SchemaPath string `envconfig:"MOSAIC_COMMERCE_CONFIGURATION_V2_SCHEMA_PATH" default:"../../protocol/schema/commerce-configuration/v2/configuration.schema.json"`
}

type ProviderConfig struct {
	Enabled            bool          `envconfig:"MOSAIC_PROVIDER_INTEGRATIONS_ENABLED" default:"false"`
	CredentialKeyring  string        `envconfig:"MOSAIC_PROVIDER_CREDENTIAL_KEYRING"`
	RevenueCatBaseURL  string        `envconfig:"MOSAIC_REVENUECAT_BASE_URL" default:"https://api.revenuecat.com/v2"`
	RequestTimeout     time.Duration `envconfig:"MOSAIC_PROVIDER_REQUEST_TIMEOUT" default:"8s"`
	OperationTimeout   time.Duration `envconfig:"MOSAIC_PROVIDER_OPERATION_TIMEOUT" default:"60s"`
	ConnectTimeout     time.Duration `envconfig:"MOSAIC_PROVIDER_CONNECT_TIMEOUT" default:"3s"`
	MaxResponseBytes   int64         `envconfig:"MOSAIC_PROVIDER_MAX_RESPONSE_BYTES" default:"2097152"`
	MaxAttempts        int           `envconfig:"MOSAIC_PROVIDER_MAX_ATTEMPTS" default:"3"`
	SnapshotTTL        time.Duration `envconfig:"MOSAIC_PROVIDER_SNAPSHOT_TTL" default:"24h"`
	WorkerPollInterval time.Duration `envconfig:"MOSAIC_PROVIDER_WORKER_POLL_INTERVAL" default:"1s"`
}

type ObjectStoreConfig struct {
	Endpoint           string `envconfig:"MOSAIC_OBJECT_STORAGE_ENDPOINT" default:"localhost:9000"`
	AccessKey          string `envconfig:"MOSAIC_OBJECT_STORAGE_ACCESS_KEY" default:"mosaic"`
	SecretKey          string `envconfig:"MOSAIC_OBJECT_STORAGE_SECRET_KEY" default:"mosaic_dev_secret"`
	Bucket             string `envconfig:"MOSAIC_OBJECT_STORAGE_BUCKET" default:"mosaic-assets"`
	UseTLS             bool   `envconfig:"MOSAIC_OBJECT_STORAGE_TLS" default:"false"`
	PublicAssetBaseURL string `envconfig:"MOSAIC_PUBLIC_ASSET_BASE_URL" default:"https://localhost:8443/v1/sdk/assets"`
	MaxUploadBytes     int64  `envconfig:"MOSAIC_ASSET_MAX_UPLOAD_BYTES" default:"10485760"`
}

type DeliveryConfig struct {
	RequestsPerMinute int `envconfig:"MOSAIC_DELIVERY_REQUESTS_PER_MINUTE" default:"120"`
	Burst             int `envconfig:"MOSAIC_DELIVERY_BURST" default:"30"`
	LimiterEntries    int `envconfig:"MOSAIC_DELIVERY_LIMITER_ENTRIES" default:"10000"`
}

type DatabaseConfig struct {
	URL            string        `envconfig:"DATABASE_URL" required:"true"`
	MaxConnections int32         `envconfig:"DATABASE_MAX_CONNECTIONS" default:"10"`
	MinConnections int32         `envconfig:"DATABASE_MIN_CONNECTIONS" default:"2"`
	ConnectTimeout time.Duration `envconfig:"DATABASE_CONNECT_TIMEOUT" default:"5s"`
}

type HTTPConfig struct {
	Address            string        `envconfig:"MOSAIC_HTTP_ADDRESS" default:":8080"`
	ReadHeaderTimeout  time.Duration `envconfig:"MOSAIC_HTTP_READ_HEADER_TIMEOUT" default:"5s"`
	ReadTimeout        time.Duration `envconfig:"MOSAIC_HTTP_READ_TIMEOUT" default:"15s"`
	WriteTimeout       time.Duration `envconfig:"MOSAIC_HTTP_WRITE_TIMEOUT" default:"15s"`
	IdleTimeout        time.Duration `envconfig:"MOSAIC_HTTP_IDLE_TIMEOUT" default:"60s"`
	HandlerTimeout     time.Duration `envconfig:"MOSAIC_HTTP_HANDLER_TIMEOUT" default:"10s"`
	ShutdownTimeout    time.Duration `envconfig:"MOSAIC_HTTP_SHUTDOWN_TIMEOUT" default:"10s"`
	CORSAllowedOrigins []string      `envconfig:"MOSAIC_CORS_ALLOWED_ORIGINS" default:"http://localhost:3000,http://127.0.0.1:3000"`
}

type LogConfig struct {
	Level  string `envconfig:"MOSAIC_LOG_LEVEL" default:"info"`
	Format string `envconfig:"MOSAIC_LOG_FORMAT" default:"json"`
}

type TelemetryConfig struct {
	ServiceName  string `envconfig:"OTEL_SERVICE_NAME" default:"mosaic-api"`
	OTLPEndpoint string `envconfig:"OTEL_EXPORTER_OTLP_ENDPOINT"`
}

func Load() (Config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Config{}, fmt.Errorf("load .env: %w", err)
	}
	return load()
}

func load() (Config, error) {
	var cfg Config
	if err := envconfig.Process("", &cfg); err != nil {
		return Config{}, fmt.Errorf("decode environment configuration: %w", err)
	}

	cfg.Environment = strings.TrimSpace(cfg.Environment)
	cfg.Database.URL = strings.TrimSpace(cfg.Database.URL)
	cfg.Log.Level = strings.ToLower(strings.TrimSpace(cfg.Log.Level))
	cfg.Log.Format = strings.ToLower(strings.TrimSpace(cfg.Log.Format))
	cfg.Telemetry.ServiceName = strings.TrimSpace(cfg.Telemetry.ServiceName)
	cfg.Telemetry.OTLPEndpoint = strings.TrimSpace(cfg.Telemetry.OTLPEndpoint)
	cfg.BrowserAuth.CookieDomain = strings.TrimSpace(cfg.BrowserAuth.CookieDomain)
	cfg.Protocol.V02SchemaPath = strings.TrimSpace(cfg.Protocol.V02SchemaPath)
	cfg.Protocol.CommerceProviderSchemaPath = strings.TrimSpace(cfg.Protocol.CommerceProviderSchemaPath)
	cfg.Protocol.CommerceConfigurationSchemaPath = strings.TrimSpace(cfg.Protocol.CommerceConfigurationSchemaPath)
	cfg.Protocol.CommerceProviderV2SchemaPath = strings.TrimSpace(cfg.Protocol.CommerceProviderV2SchemaPath)
	cfg.Protocol.CommerceConfigurationV2SchemaPath = strings.TrimSpace(cfg.Protocol.CommerceConfigurationV2SchemaPath)
	cfg.Providers.CredentialKeyring = strings.TrimSpace(cfg.Providers.CredentialKeyring)
	cfg.Providers.RevenueCatBaseURL = strings.TrimSpace(cfg.Providers.RevenueCatBaseURL)
	cfg.ObjectStore.Endpoint = strings.TrimSpace(cfg.ObjectStore.Endpoint)
	cfg.ObjectStore.AccessKey = strings.TrimSpace(cfg.ObjectStore.AccessKey)
	cfg.ObjectStore.SecretKey = strings.TrimSpace(cfg.ObjectStore.SecretKey)
	cfg.ObjectStore.Bucket = strings.TrimSpace(cfg.ObjectStore.Bucket)
	cfg.ObjectStore.PublicAssetBaseURL = strings.TrimSpace(cfg.ObjectStore.PublicAssetBaseURL)
	origins := cfg.HTTP.CORSAllowedOrigins[:0]
	for _, origin := range cfg.HTTP.CORSAllowedOrigins {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}
	cfg.HTTP.CORSAllowedOrigins = origins

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
	for key, value := range map[string]time.Duration{
		"MOSAIC_HTTP_READ_HEADER_TIMEOUT": cfg.HTTP.ReadHeaderTimeout,
		"MOSAIC_HTTP_READ_TIMEOUT":        cfg.HTTP.ReadTimeout,
		"MOSAIC_HTTP_WRITE_TIMEOUT":       cfg.HTTP.WriteTimeout,
		"MOSAIC_HTTP_IDLE_TIMEOUT":        cfg.HTTP.IdleTimeout,
		"MOSAIC_HTTP_HANDLER_TIMEOUT":     cfg.HTTP.HandlerTimeout,
		"MOSAIC_HTTP_SHUTDOWN_TIMEOUT":    cfg.HTTP.ShutdownTimeout,
	} {
		if value <= 0 {
			return fmt.Errorf("%s must be greater than zero", key)
		}
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
	if cfg.Database.MinConnections > cfg.Database.MaxConnections {
		return fmt.Errorf("DATABASE_MIN_CONNECTIONS must not exceed DATABASE_MAX_CONNECTIONS")
	}
	if strings.TrimSpace(cfg.Database.URL) == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.Database.MaxConnections <= 0 {
		return fmt.Errorf("DATABASE_MAX_CONNECTIONS must be greater than zero")
	}
	if cfg.Database.MinConnections < 0 {
		return fmt.Errorf("DATABASE_MIN_CONNECTIONS must not be negative")
	}
	if cfg.Database.ConnectTimeout <= 0 {
		return fmt.Errorf("DATABASE_CONNECT_TIMEOUT must be greater than zero")
	}
	if strings.TrimSpace(cfg.Protocol.V02SchemaPath) == "" {
		return fmt.Errorf("MOSAIC_PROTOCOL_V02_SCHEMA_PATH must not be empty")
	}
	if cfg.Protocol.CommerceProviderSchemaPath == "" {
		return fmt.Errorf("MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH must not be empty")
	}
	if cfg.Protocol.CommerceConfigurationSchemaPath == "" {
		return fmt.Errorf("MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH must not be empty")
	}
	if cfg.Protocol.CommerceProviderV2SchemaPath == "" || cfg.Protocol.CommerceConfigurationV2SchemaPath == "" {
		return errors.New("Commerce Configuration v2 schema paths are required")
	}
	if cfg.Providers.Enabled && cfg.Providers.CredentialKeyring == "" {
		return fmt.Errorf("MOSAIC_PROVIDER_CREDENTIAL_KEYRING is required when provider integrations are enabled")
	}
	if cfg.Providers.RevenueCatBaseURL == "" {
		return fmt.Errorf("MOSAIC_REVENUECAT_BASE_URL must not be empty")
	}
	providerBaseURL, err := url.Parse(cfg.Providers.RevenueCatBaseURL)
	if err != nil || providerBaseURL.Host == "" || providerBaseURL.User != nil ||
		providerBaseURL.Scheme != "https" && providerBaseURL.Scheme != "http" {
		return fmt.Errorf("MOSAIC_REVENUECAT_BASE_URL must be an absolute HTTP(S) URL without credentials")
	}
	if cfg.Environment != "development" && cfg.Environment != "test" && providerBaseURL.Scheme != "https" {
		return fmt.Errorf("MOSAIC_REVENUECAT_BASE_URL must use HTTPS outside development and test")
	}
	if cfg.Providers.RequestTimeout <= 0 || cfg.Providers.OperationTimeout <= 0 || cfg.Providers.ConnectTimeout <= 0 ||
		cfg.Providers.SnapshotTTL <= 0 || cfg.Providers.WorkerPollInterval <= 0 {
		return fmt.Errorf("provider timeout, freshness, and worker intervals must be greater than zero")
	}
	if cfg.Providers.OperationTimeout < cfg.Providers.RequestTimeout {
		return fmt.Errorf("MOSAIC_PROVIDER_OPERATION_TIMEOUT must be greater than or equal to MOSAIC_PROVIDER_REQUEST_TIMEOUT")
	}
	if cfg.Providers.OperationTimeout > 5*time.Minute {
		return fmt.Errorf("MOSAIC_PROVIDER_OPERATION_TIMEOUT must not exceed 5m")
	}
	if cfg.Providers.MaxResponseBytes <= 0 {
		return fmt.Errorf("MOSAIC_PROVIDER_MAX_RESPONSE_BYTES must be greater than zero")
	}
	if cfg.Providers.MaxAttempts < 1 || cfg.Providers.MaxAttempts > 5 {
		return fmt.Errorf("MOSAIC_PROVIDER_MAX_ATTEMPTS must be between 1 and 5")
	}
	if strings.TrimSpace(cfg.ObjectStore.Endpoint) == "" || strings.TrimSpace(cfg.ObjectStore.AccessKey) == "" || strings.TrimSpace(cfg.ObjectStore.SecretKey) == "" || strings.TrimSpace(cfg.ObjectStore.Bucket) == "" {
		return fmt.Errorf("S3-compatible object-storage configuration must not be empty")
	}
	if cfg.ObjectStore.MaxUploadBytes <= 0 {
		return fmt.Errorf("MOSAIC_ASSET_MAX_UPLOAD_BYTES must be a positive integer")
	}
	if cfg.BrowserAuth.SessionLifetime <= 0 {
		return fmt.Errorf("MOSAIC_SESSION_LIFETIME must be greater than zero")
	}
	for key, value := range map[string]int{
		"MOSAIC_AUTH_REQUESTS_PER_MINUTE":     cfg.BrowserAuth.RequestsPerMinute,
		"MOSAIC_AUTH_BURST":                   cfg.BrowserAuth.Burst,
		"MOSAIC_AUTH_LIMITER_ENTRIES":         cfg.BrowserAuth.LimiterEntries,
		"MOSAIC_DELIVERY_REQUESTS_PER_MINUTE": cfg.Delivery.RequestsPerMinute,
		"MOSAIC_DELIVERY_BURST":               cfg.Delivery.Burst,
		"MOSAIC_DELIVERY_LIMITER_ENTRIES":     cfg.Delivery.LimiterEntries,
	} {
		if value <= 0 {
			return fmt.Errorf("%s must be a positive integer", key)
		}
	}
	assetURL, err := url.Parse(cfg.ObjectStore.PublicAssetBaseURL)
	if err != nil || assetURL.Host == "" || assetURL.User != nil || assetURL.Scheme != "https" {
		return fmt.Errorf("MOSAIC_PUBLIC_ASSET_BASE_URL must be an absolute HTTPS URL without credentials")
	}
	productionLike := cfg.Environment != "development" && cfg.Environment != "test"
	if productionLike && !cfg.BrowserAuth.CookieSecure {
		return fmt.Errorf("MOSAIC_SESSION_COOKIE_SECURE must be true outside development and test")
	}
	if productionLike && (cfg.ObjectStore.AccessKey == defaultObjectStoreAccessKey || cfg.ObjectStore.SecretKey == defaultObjectStoreSecretKey) {
		return fmt.Errorf("development object-storage credentials must not be used outside development and test")
	}

	return nil
}
