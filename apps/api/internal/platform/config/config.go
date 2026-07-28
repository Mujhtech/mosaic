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

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

const (
	defaultAuthRequestsMinute   = 12
	defaultAuthBurst            = 4
	defaultObjectStoreAccessKey = "mosaic"
	defaultObjectStoreSecretKey = "mosaic_dev_secret"

	// maxTransportUploadBytes is the hard ceiling the HTTP asset-upload route
	// will accept regardless of MOSAIC_ASSET_MAX_UPLOAD_BYTES.
	maxTransportUploadBytes = 256 << 20
)

var defaultAllowedOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
}

var logLevels = map[string]struct{}{
	"trace": {}, "debug": {}, "info": {}, "warn": {}, "error": {}, "fatal": {}, "panic": {},
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
	Analytics   AnalyticsConfig
	Providers   ProviderConfig
	Billing     BillingConfig
	Worker      WorkerConfig
}

// BillingConfig holds Phase 9A's deployment-level settings. Mosaic Billing is
// additionally per-Project opt-in and off by default, so enabling it here only
// makes it available, never active.
type BillingConfig struct {
	Enabled bool `envconfig:"MOSAIC_BILLING_ENABLED" default:"false"`
	// NotificationBaseURL is the public origin Apple posts notifications to. It
	// is used solely to render the endpoint URL returned once on credential
	// create and rotate.
	NotificationBaseURL string `envconfig:"MOSAIC_BILLING_NOTIFICATION_BASE_URL"`
	// RawRetentionDays bounds how long an encrypted Raw Billing Input body is
	// kept. Ninety days is the midpoint of Apple's 180-day production and
	// 30-day sandbox notification-history windows. Normalized facts are kept
	// indefinitely; only the sensitive payload behind them expires.
	RawRetentionDays int `envconfig:"MOSAIC_BILLING_RAW_RETENTION_DAYS" default:"90"`
	// WorkerPollInterval is dedicated so notification latency is not coupled to
	// analytics aggregation load in the shared worker loop.
	WorkerPollInterval     time.Duration `envconfig:"MOSAIC_BILLING_WORKER_POLL_INTERVAL" default:"1s"`
	AppleProductionBaseURL string        `envconfig:"MOSAIC_APPLE_STOREKIT_BASE_URL" default:"https://api.storekit.apple.com"`
	AppleSandboxBaseURL    string        `envconfig:"MOSAIC_APPLE_STOREKIT_SANDBOX_BASE_URL" default:"https://api.storekit-sandbox.apple.com"`
	GooglePlayBaseURL      string        `envconfig:"MOSAIC_GOOGLE_PLAY_BASE_URL" default:"https://androidpublisher.googleapis.com"`
	GooglePubSubBaseURL    string        `envconfig:"MOSAIC_GOOGLE_PUBSUB_BASE_URL" default:"https://pubsub.googleapis.com"`
	// Observation submissions may be shed with a 429 because SDKs queue and
	// retry. Notification intake deliberately has no limiter.
	ObservationsPerMinute int `envconfig:"MOSAIC_BILLING_OBSERVATIONS_PER_MINUTE" default:"600"`
	ObservationBurst      int `envconfig:"MOSAIC_BILLING_OBSERVATION_BURST" default:"120"`
	LimiterEntries        int `envconfig:"MOSAIC_BILLING_LIMITER_ENTRIES" default:"10000"`
}

// RawRetention is the configured retention window as a duration.
func (cfg BillingConfig) RawRetention() time.Duration {
	return time.Duration(cfg.RawRetentionDays) * 24 * time.Hour
}

// ProductionLike reports whether the deployment must satisfy the strict
// production configuration guards.
func (cfg Config) ProductionLike() bool {
	return cfg.Environment != "development" && cfg.Environment != "test"
}

type AnalyticsConfig struct {
	EventSchemaPath     string        `envconfig:"MOSAIC_ANALYTICS_EVENT_SCHEMA_PATH"`
	EventV2SchemaPath   string        `envconfig:"MOSAIC_ANALYTICS_EVENT_V2_SCHEMA_PATH"`
	IPRequestsPerMinute int           `envconfig:"MOSAIC_ANALYTICS_IP_REQUESTS_PER_MINUTE" default:"30"`
	IPBurst             int           `envconfig:"MOSAIC_ANALYTICS_IP_BURST" default:"10"`
	KeyBatchesPerMinute int           `envconfig:"MOSAIC_ANALYTICS_KEY_BATCHES_PER_MINUTE" default:"60"`
	KeyBatchBurst       int           `envconfig:"MOSAIC_ANALYTICS_KEY_BATCH_BURST" default:"10"`
	KeyEventsPerMinute  int           `envconfig:"MOSAIC_ANALYTICS_KEY_EVENTS_PER_MINUTE" default:"6000"`
	KeyEventBurst       int           `envconfig:"MOSAIC_ANALYTICS_KEY_EVENT_BURST" default:"1000"`
	LimiterEntries      int           `envconfig:"MOSAIC_ANALYTICS_LIMITER_ENTRIES" default:"10000"`
	WorkerPollInterval  time.Duration `envconfig:"MOSAIC_ANALYTICS_WORKER_POLL_INTERVAL" default:"1s"`
}

type BrowserAuthConfig struct {
	SessionLifetime   time.Duration `envconfig:"MOSAIC_SESSION_LIFETIME" default:"168h"`
	CookieSecure      bool          `envconfig:"MOSAIC_SESSION_COOKIE_SECURE" default:"false"`
	CookieDomain      string        `envconfig:"MOSAIC_SESSION_COOKIE_DOMAIN"`
	RequestsPerMinute int           `envconfig:"MOSAIC_AUTH_REQUESTS_PER_MINUTE" default:"12"`
	Burst             int           `envconfig:"MOSAIC_AUTH_BURST" default:"4"`
	LimiterEntries    int           `envconfig:"MOSAIC_AUTH_LIMITER_ENTRIES" default:"10000"`
}

// ProtocolConfig holds optional filesystem overrides for the canonical protocol
// schemas. Every value defaults to empty, meaning "use the schema embedded in
// the binary"; an override is only for operators pinning a local file.
type ProtocolConfig struct {
	V02SchemaPath                     string `envconfig:"MOSAIC_PROTOCOL_V02_SCHEMA_PATH"`
	CommerceProviderSchemaPath        string `envconfig:"MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH"`
	CommerceConfigurationSchemaPath   string `envconfig:"MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH"`
	CommerceProviderV2SchemaPath      string `envconfig:"MOSAIC_COMMERCE_PROVIDER_V2_SCHEMA_PATH"`
	CommerceConfigurationV2SchemaPath string `envconfig:"MOSAIC_COMMERCE_CONFIGURATION_V2_SCHEMA_PATH"`
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
	Endpoint           string        `envconfig:"MOSAIC_OBJECT_STORAGE_ENDPOINT" default:"localhost:9000"`
	AccessKey          string        `envconfig:"MOSAIC_OBJECT_STORAGE_ACCESS_KEY" default:"mosaic"`
	SecretKey          string        `envconfig:"MOSAIC_OBJECT_STORAGE_SECRET_KEY" default:"mosaic_dev_secret"`
	Bucket             string        `envconfig:"MOSAIC_OBJECT_STORAGE_BUCKET" default:"mosaic-assets"`
	UseTLS             bool          `envconfig:"MOSAIC_OBJECT_STORAGE_TLS" default:"false"`
	AllowInsecure      bool          `envconfig:"MOSAIC_OBJECT_STORAGE_ALLOW_INSECURE" default:"false"`
	PublicAssetBaseURL string        `envconfig:"MOSAIC_PUBLIC_ASSET_BASE_URL" default:"https://localhost:8443/v1/sdk/assets"`
	MaxUploadBytes     int64         `envconfig:"MOSAIC_ASSET_MAX_UPLOAD_BYTES" default:"10485760"`
	OperationTimeout   time.Duration `envconfig:"MOSAIC_OBJECT_STORAGE_OPERATION_TIMEOUT" default:"30s"`
	CheckTimeout       time.Duration `envconfig:"MOSAIC_OBJECT_STORAGE_CHECK_TIMEOUT" default:"5s"`
}

type DeliveryConfig struct {
	RequestsPerMinute int `envconfig:"MOSAIC_DELIVERY_REQUESTS_PER_MINUTE" default:"120"`
	Burst             int `envconfig:"MOSAIC_DELIVERY_BURST" default:"30"`
	LimiterEntries    int `envconfig:"MOSAIC_DELIVERY_LIMITER_ENTRIES" default:"10000"`
	// Baseline limit for authenticated dashboard/API surfaces that previously
	// had no limiter at all.
	APIRequestsPerMinute int `envconfig:"MOSAIC_API_REQUESTS_PER_MINUTE" default:"600"`
	APIBurst             int `envconfig:"MOSAIC_API_BURST" default:"120"`
	// Limit for Placement/Experiment decision reads.
	DecisionRequestsPerMinute int `envconfig:"MOSAIC_DECISION_REQUESTS_PER_MINUTE" default:"600"`
	DecisionBurst             int `envconfig:"MOSAIC_DECISION_BURST" default:"120"`
	// Asset upload is bounded separately from the baseline API limit: each
	// request may carry MOSAIC_ASSET_MAX_UPLOAD_BYTES of body, hold a long
	// upload timeout, and write to object storage, so the baseline 600/minute
	// would allow one actor to saturate storage bandwidth on its own.
	UploadRequestsPerMinute int `envconfig:"MOSAIC_UPLOAD_REQUESTS_PER_MINUTE" default:"30"`
	UploadBurst             int `envconfig:"MOSAIC_UPLOAD_BURST" default:"10"`
	// Export and privacy-request submissions each enqueue an asynchronous job
	// that scans analytics history, so they are far more expensive than the
	// dashboard reads sharing the baseline API bucket.
	ExportRequestsPerMinute int `envconfig:"MOSAIC_EXPORT_REQUESTS_PER_MINUTE" default:"10"`
	ExportBurst             int `envconfig:"MOSAIC_EXPORT_BURST" default:"5"`
}

type DatabaseConfig struct {
	URL               string        `envconfig:"DATABASE_URL" required:"true"`
	MaxConnections    int32         `envconfig:"DATABASE_MAX_CONNECTIONS" default:"10"`
	MinConnections    int32         `envconfig:"DATABASE_MIN_CONNECTIONS" default:"2"`
	ConnectTimeout    time.Duration `envconfig:"DATABASE_CONNECT_TIMEOUT" default:"5s"`
	MaxConnLifetime   time.Duration `envconfig:"DATABASE_MAX_CONN_LIFETIME" default:"30m"`
	MaxConnIdleTime   time.Duration `envconfig:"DATABASE_MAX_CONN_IDLE_TIME" default:"5m"`
	HealthCheckPeriod time.Duration `envconfig:"DATABASE_HEALTH_CHECK_PERIOD" default:"30s"`
	StatementTimeout  time.Duration `envconfig:"DATABASE_STATEMENT_TIMEOUT" default:"30s"`
	LockTimeout       time.Duration `envconfig:"DATABASE_LOCK_TIMEOUT" default:"5s"`
	CloseTimeout      time.Duration `envconfig:"DATABASE_CLOSE_TIMEOUT" default:"5s"`
	// AllowInsecure permits a production DATABASE_URL without sslmode.
	AllowInsecure bool `envconfig:"MOSAIC_DATABASE_ALLOW_INSECURE" default:"false"`
}

type HTTPConfig struct {
	Address           string        `envconfig:"MOSAIC_HTTP_ADDRESS" default:":8080"`
	ReadHeaderTimeout time.Duration `envconfig:"MOSAIC_HTTP_READ_HEADER_TIMEOUT" default:"5s"`
	ReadTimeout       time.Duration `envconfig:"MOSAIC_HTTP_READ_TIMEOUT" default:"120s"`
	WriteTimeout      time.Duration `envconfig:"MOSAIC_HTTP_WRITE_TIMEOUT" default:"120s"`
	IdleTimeout       time.Duration `envconfig:"MOSAIC_HTTP_IDLE_TIMEOUT" default:"60s"`
	HandlerTimeout    time.Duration `envconfig:"MOSAIC_HTTP_HANDLER_TIMEOUT" default:"10s"`
	UploadTimeout     time.Duration `envconfig:"MOSAIC_HTTP_UPLOAD_TIMEOUT" default:"90s"`
	IngestTimeout     time.Duration `envconfig:"MOSAIC_HTTP_INGEST_TIMEOUT" default:"30s"`
	// DrainDelay is how long the instance keeps serving after readiness flips
	// to draining and before the HTTP listener closes. Without it the listener
	// closes in the same instant readiness flips, so a load balancer polling
	// readiness sees connection-refused rather than a clean 503 and routes
	// traffic into a closing instance. 0 disables the wait.
	DrainDelay               time.Duration `envconfig:"MOSAIC_HTTP_DRAIN_DELAY" default:"5s"`
	ShutdownTimeout          time.Duration `envconfig:"MOSAIC_HTTP_SHUTDOWN_TIMEOUT" default:"20s"`
	TelemetryShutdownTimeout time.Duration `envconfig:"MOSAIC_TELEMETRY_SHUTDOWN_TIMEOUT" default:"5s"`
	CORSAllowedOrigins       []string      `envconfig:"MOSAIC_CORS_ALLOWED_ORIGINS" default:"http://localhost:3000,http://127.0.0.1:3000"`
	// TrustedProxyCIDRs lists peer networks whose X-Forwarded-For/X-Real-IP
	// headers may be trusted. Empty (the default) means never trust them.
	TrustedProxyCIDRs []string `envconfig:"MOSAIC_TRUSTED_PROXY_CIDRS"`
}

type WorkerConfig struct {
	HealthAddress     string        `envconfig:"MOSAIC_WORKER_HEALTH_ADDRESS" default:":8081"`
	JobShutdownBudget time.Duration `envconfig:"MOSAIC_WORKER_JOB_SHUTDOWN_BUDGET" default:"30s"`
	ScheduleLease     time.Duration `envconfig:"MOSAIC_WORKER_SCHEDULE_LEASE" default:"2m"`
}

type LogConfig struct {
	Level  string `envconfig:"MOSAIC_LOG_LEVEL" default:"info"`
	Format string `envconfig:"MOSAIC_LOG_FORMAT" default:"json"`
}

type TelemetryConfig struct {
	ServiceName  string `envconfig:"OTEL_SERVICE_NAME" default:"mosaic-api"`
	OTLPEndpoint string `envconfig:"OTEL_EXPORTER_OTLP_ENDPOINT"`
}

// ValidationError aggregates every configuration problem found at startup so an
// operator can fix them in one pass. It never contains configured values, only
// variable names and the reason they were rejected.
type ValidationError struct{ Problems []string }

func (e *ValidationError) Error() string {
	return fmt.Sprintf(
		"invalid Mosaic configuration (%d problem(s)):\n  - %s",
		len(e.Problems), strings.Join(e.Problems, "\n  - "),
	)
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
	cfg.Analytics.EventSchemaPath = strings.TrimSpace(cfg.Analytics.EventSchemaPath)
	cfg.Analytics.EventV2SchemaPath = strings.TrimSpace(cfg.Analytics.EventV2SchemaPath)
	cfg.Providers.CredentialKeyring = strings.TrimSpace(cfg.Providers.CredentialKeyring)
	cfg.Billing.NotificationBaseURL = strings.TrimSpace(cfg.Billing.NotificationBaseURL)
	cfg.Billing.AppleProductionBaseURL = strings.TrimSpace(cfg.Billing.AppleProductionBaseURL)
	cfg.Billing.AppleSandboxBaseURL = strings.TrimSpace(cfg.Billing.AppleSandboxBaseURL)
	cfg.Billing.GooglePlayBaseURL = strings.TrimSpace(cfg.Billing.GooglePlayBaseURL)
	cfg.Billing.GooglePubSubBaseURL = strings.TrimSpace(cfg.Billing.GooglePubSubBaseURL)
	cfg.Providers.RevenueCatBaseURL = strings.TrimSpace(cfg.Providers.RevenueCatBaseURL)
	cfg.ObjectStore.Endpoint = strings.TrimSpace(cfg.ObjectStore.Endpoint)
	cfg.ObjectStore.AccessKey = strings.TrimSpace(cfg.ObjectStore.AccessKey)
	cfg.ObjectStore.SecretKey = strings.TrimSpace(cfg.ObjectStore.SecretKey)
	cfg.ObjectStore.Bucket = strings.TrimSpace(cfg.ObjectStore.Bucket)
	cfg.ObjectStore.PublicAssetBaseURL = strings.TrimSpace(cfg.ObjectStore.PublicAssetBaseURL)
	cfg.Worker.HealthAddress = strings.TrimSpace(cfg.Worker.HealthAddress)
	cfg.HTTP.CORSAllowedOrigins = nonEmpty(cfg.HTTP.CORSAllowedOrigins)
	cfg.HTTP.TrustedProxyCIDRs = nonEmpty(cfg.HTTP.TrustedProxyCIDRs)

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func nonEmpty(values []string) []string {
	result := values[:0]
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

type problems struct{ list []string }

func (p *problems) add(format string, args ...any) {
	p.list = append(p.list, fmt.Sprintf(format, args...))
}

func (p *problems) requirePositive(values map[string]time.Duration) {
	for _, key := range sortedDurationKeys(values) {
		if values[key] <= 0 {
			p.add("%s must be greater than zero", key)
		}
	}
}

func (p *problems) requirePositiveInts(values map[string]int) {
	for _, key := range sortedIntKeys(values) {
		if values[key] <= 0 {
			p.add("%s must be a positive integer", key)
		}
	}
}

func sortedDurationKeys(values map[string]time.Duration) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sortStrings(keys)
	return keys
}

func sortedIntKeys(values map[string]int) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sortStrings(keys)
	return keys
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

func (cfg Config) validate() error {
	report := &problems{}
	productionLike := cfg.ProductionLike()

	if strings.TrimSpace(cfg.Environment) == "" {
		report.add("MOSAIC_ENVIRONMENT must not be empty")
	}

	cfg.validateHTTP(report, productionLike)
	cfg.validateLogging(report)
	cfg.validateDatabase(report, productionLike)
	cfg.validateObjectStore(report, productionLike)
	cfg.validateProviders(report, productionLike)
	cfg.validateAnalytics(report)
	cfg.validateBilling(report, productionLike)
	cfg.validateWorker(report)

	if strings.TrimSpace(cfg.Telemetry.ServiceName) == "" {
		report.add("OTEL_SERVICE_NAME must not be empty")
	}
	if cfg.BrowserAuth.SessionLifetime <= 0 {
		report.add("MOSAIC_SESSION_LIFETIME must be greater than zero")
	}
	if productionLike && !cfg.BrowserAuth.CookieSecure {
		report.add("MOSAIC_SESSION_COOKIE_SECURE must be true outside development and test")
	}
	report.requirePositiveInts(map[string]int{
		"MOSAIC_AUTH_REQUESTS_PER_MINUTE":     cfg.BrowserAuth.RequestsPerMinute,
		"MOSAIC_AUTH_BURST":                   cfg.BrowserAuth.Burst,
		"MOSAIC_AUTH_LIMITER_ENTRIES":         cfg.BrowserAuth.LimiterEntries,
		"MOSAIC_DELIVERY_REQUESTS_PER_MINUTE": cfg.Delivery.RequestsPerMinute,
		"MOSAIC_DELIVERY_BURST":               cfg.Delivery.Burst,
		"MOSAIC_DELIVERY_LIMITER_ENTRIES":     cfg.Delivery.LimiterEntries,
		"MOSAIC_API_REQUESTS_PER_MINUTE":      cfg.Delivery.APIRequestsPerMinute,
		"MOSAIC_API_BURST":                    cfg.Delivery.APIBurst,
		"MOSAIC_DECISION_REQUESTS_PER_MINUTE": cfg.Delivery.DecisionRequestsPerMinute,
		"MOSAIC_DECISION_BURST":               cfg.Delivery.DecisionBurst,
		"MOSAIC_UPLOAD_REQUESTS_PER_MINUTE":   cfg.Delivery.UploadRequestsPerMinute,
		"MOSAIC_UPLOAD_BURST":                 cfg.Delivery.UploadBurst,
		"MOSAIC_EXPORT_REQUESTS_PER_MINUTE":   cfg.Delivery.ExportRequestsPerMinute,
		"MOSAIC_EXPORT_BURST":                 cfg.Delivery.ExportBurst,
	})

	if len(report.list) > 0 {
		return &ValidationError{Problems: report.list}
	}
	return nil
}

func (cfg Config) validateHTTP(report *problems, productionLike bool) {
	if _, _, err := net.SplitHostPort(cfg.HTTP.Address); err != nil {
		report.add("MOSAIC_HTTP_ADDRESS must be a host:port address")
	}
	report.requirePositive(map[string]time.Duration{
		"MOSAIC_HTTP_READ_HEADER_TIMEOUT":   cfg.HTTP.ReadHeaderTimeout,
		"MOSAIC_HTTP_READ_TIMEOUT":          cfg.HTTP.ReadTimeout,
		"MOSAIC_HTTP_WRITE_TIMEOUT":         cfg.HTTP.WriteTimeout,
		"MOSAIC_HTTP_IDLE_TIMEOUT":          cfg.HTTP.IdleTimeout,
		"MOSAIC_HTTP_HANDLER_TIMEOUT":       cfg.HTTP.HandlerTimeout,
		"MOSAIC_HTTP_UPLOAD_TIMEOUT":        cfg.HTTP.UploadTimeout,
		"MOSAIC_HTTP_INGEST_TIMEOUT":        cfg.HTTP.IngestTimeout,
		"MOSAIC_HTTP_SHUTDOWN_TIMEOUT":      cfg.HTTP.ShutdownTimeout,
		"MOSAIC_TELEMETRY_SHUTDOWN_TIMEOUT": cfg.HTTP.TelemetryShutdownTimeout,
	})
	if cfg.HTTP.DrainDelay < 0 {
		report.add("MOSAIC_HTTP_DRAIN_DELAY must not be negative")
	}
	for key, value := range map[string]time.Duration{
		"MOSAIC_HTTP_HANDLER_TIMEOUT": cfg.HTTP.HandlerTimeout,
		"MOSAIC_HTTP_UPLOAD_TIMEOUT":  cfg.HTTP.UploadTimeout,
		"MOSAIC_HTTP_INGEST_TIMEOUT":  cfg.HTTP.IngestTimeout,
	} {
		if value > 0 && cfg.HTTP.WriteTimeout > 0 && value >= cfg.HTTP.WriteTimeout {
			report.add("%s must be shorter than MOSAIC_HTTP_WRITE_TIMEOUT", key)
		}
	}
	// An empty list disables CORS entirely, which is valid for deployments with
	// no browser client. Only non-empty entries are checked.
	for _, origin := range cfg.HTTP.CORSAllowedOrigins {
		if origin == "*" {
			report.add("MOSAIC_CORS_ALLOWED_ORIGINS must not contain the wildcard origin because Mosaic sends credentialed requests")
			continue
		}
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			report.add("MOSAIC_CORS_ALLOWED_ORIGINS entries must be absolute http(s) origins")
			continue
		}
		if productionLike && parsed.Scheme != "https" {
			report.add("MOSAIC_CORS_ALLOWED_ORIGINS must use https outside development and test")
		}
	}
	for _, entry := range cfg.HTTP.TrustedProxyCIDRs {
		if _, _, err := net.ParseCIDR(entry); err != nil {
			if net.ParseIP(entry) == nil {
				report.add("MOSAIC_TRUSTED_PROXY_CIDRS entries must be CIDR blocks or IP addresses")
			}
		}
	}
}

func (cfg Config) validateLogging(report *problems) {
	switch cfg.Log.Format {
	case "json", "console":
	default:
		report.add("MOSAIC_LOG_FORMAT must be json or console")
	}
	if _, ok := logLevels[cfg.Log.Level]; !ok {
		report.add("MOSAIC_LOG_LEVEL must be one of trace, debug, info, warn, error, fatal, panic")
	}
}

func (cfg Config) validateDatabase(report *problems, productionLike bool) {
	if strings.TrimSpace(cfg.Database.URL) == "" {
		report.add("DATABASE_URL is required")
	} else if productionLike && !cfg.Database.AllowInsecure {
		if mode := databaseSSLMode(cfg.Database.URL); mode == "" || mode == "disable" || mode == "allow" || mode == "prefer" {
			report.add(
				"DATABASE_URL must set a verifying sslmode (require, verify-ca, or verify-full) outside " +
					"development and test; set MOSAIC_DATABASE_ALLOW_INSECURE=true only for a trusted private network",
			)
		}
	}
	if cfg.Database.MaxConnections <= 0 {
		report.add("DATABASE_MAX_CONNECTIONS must be greater than zero")
	}
	if cfg.Database.MinConnections < 0 {
		report.add("DATABASE_MIN_CONNECTIONS must not be negative")
	}
	if cfg.Database.MinConnections > cfg.Database.MaxConnections {
		report.add("DATABASE_MIN_CONNECTIONS must not exceed DATABASE_MAX_CONNECTIONS")
	}
	report.requirePositive(map[string]time.Duration{
		"DATABASE_CONNECT_TIMEOUT":     cfg.Database.ConnectTimeout,
		"DATABASE_MAX_CONN_LIFETIME":   cfg.Database.MaxConnLifetime,
		"DATABASE_MAX_CONN_IDLE_TIME":  cfg.Database.MaxConnIdleTime,
		"DATABASE_HEALTH_CHECK_PERIOD": cfg.Database.HealthCheckPeriod,
		"DATABASE_STATEMENT_TIMEOUT":   cfg.Database.StatementTimeout,
		"DATABASE_LOCK_TIMEOUT":        cfg.Database.LockTimeout,
		"DATABASE_CLOSE_TIMEOUT":       cfg.Database.CloseTimeout,
	})
	if cfg.Database.LockTimeout > 0 && cfg.Database.StatementTimeout > 0 &&
		cfg.Database.LockTimeout > cfg.Database.StatementTimeout {
		report.add("DATABASE_LOCK_TIMEOUT must not exceed DATABASE_STATEMENT_TIMEOUT")
	}
}

// databaseSSLMode extracts sslmode from either a URL or a key/value DSN without
// retaining or logging any credential material.
func databaseSSLMode(raw string) string {
	if parsed, err := url.Parse(raw); err == nil && parsed.Scheme != "" && parsed.Host != "" {
		return strings.ToLower(strings.TrimSpace(parsed.Query().Get("sslmode")))
	}
	for _, field := range strings.Fields(raw) {
		name, value, found := strings.Cut(field, "=")
		if found && strings.EqualFold(strings.TrimSpace(name), "sslmode") {
			return strings.ToLower(strings.Trim(strings.TrimSpace(value), `'"`))
		}
	}
	return ""
}

func (cfg Config) validateObjectStore(report *problems, productionLike bool) {
	if cfg.ObjectStore.Endpoint == "" || cfg.ObjectStore.AccessKey == "" ||
		cfg.ObjectStore.SecretKey == "" || cfg.ObjectStore.Bucket == "" {
		report.add("MOSAIC_OBJECT_STORAGE_ENDPOINT, _ACCESS_KEY, _SECRET_KEY, and _BUCKET must all be set")
	}
	if cfg.ObjectStore.MaxUploadBytes <= 0 {
		report.add("MOSAIC_ASSET_MAX_UPLOAD_BYTES must be a positive integer")
	}
	if cfg.ObjectStore.MaxUploadBytes > maxTransportUploadBytes {
		report.add("MOSAIC_ASSET_MAX_UPLOAD_BYTES must not exceed the %d byte transport ceiling", maxTransportUploadBytes)
	}
	report.requirePositive(map[string]time.Duration{
		"MOSAIC_OBJECT_STORAGE_OPERATION_TIMEOUT": cfg.ObjectStore.OperationTimeout,
		"MOSAIC_OBJECT_STORAGE_CHECK_TIMEOUT":     cfg.ObjectStore.CheckTimeout,
	})
	assetURL, err := url.Parse(cfg.ObjectStore.PublicAssetBaseURL)
	if err != nil || assetURL.Host == "" || assetURL.User != nil || assetURL.Scheme != "https" {
		report.add("MOSAIC_PUBLIC_ASSET_BASE_URL must be an absolute HTTPS URL without credentials")
	}
	if productionLike {
		if cfg.ObjectStore.AccessKey == defaultObjectStoreAccessKey || cfg.ObjectStore.SecretKey == defaultObjectStoreSecretKey {
			report.add("development object-storage credentials must not be used outside development and test")
		}
		if !cfg.ObjectStore.UseTLS && !cfg.ObjectStore.AllowInsecure {
			report.add(
				"MOSAIC_OBJECT_STORAGE_TLS must be true outside development and test; set " +
					"MOSAIC_OBJECT_STORAGE_ALLOW_INSECURE=true only when object storage is reached over a trusted private network",
			)
		}
	}
}

func (cfg Config) validateProviders(report *problems, productionLike bool) {
	switch {
	case cfg.Providers.Enabled && cfg.Providers.CredentialKeyring == "":
		report.add("MOSAIC_PROVIDER_CREDENTIAL_KEYRING is required when provider integrations are enabled")
	case cfg.Providers.CredentialKeyring != "":
		if err := providercredential.ValidateKeyring(cfg.Providers.CredentialKeyring); err != nil {
			report.add(
				"MOSAIC_PROVIDER_CREDENTIAL_KEYRING is not a valid version 1 keyring: it must be JSON with " +
					"version, activeKeyId, and keys mapping each key ID to a base64url 32-byte key including the active one",
			)
		}
	}
	if cfg.Providers.RevenueCatBaseURL == "" {
		report.add("MOSAIC_REVENUECAT_BASE_URL must not be empty")
	} else {
		providerBaseURL, err := url.Parse(cfg.Providers.RevenueCatBaseURL)
		switch {
		case err != nil || providerBaseURL.Host == "" || providerBaseURL.User != nil ||
			(providerBaseURL.Scheme != "https" && providerBaseURL.Scheme != "http"):
			report.add("MOSAIC_REVENUECAT_BASE_URL must be an absolute HTTP(S) URL without credentials")
		case productionLike && providerBaseURL.Scheme != "https":
			report.add("MOSAIC_REVENUECAT_BASE_URL must use HTTPS outside development and test")
		}
	}
	report.requirePositive(map[string]time.Duration{
		"MOSAIC_PROVIDER_REQUEST_TIMEOUT":      cfg.Providers.RequestTimeout,
		"MOSAIC_PROVIDER_OPERATION_TIMEOUT":    cfg.Providers.OperationTimeout,
		"MOSAIC_PROVIDER_CONNECT_TIMEOUT":      cfg.Providers.ConnectTimeout,
		"MOSAIC_PROVIDER_SNAPSHOT_TTL":         cfg.Providers.SnapshotTTL,
		"MOSAIC_PROVIDER_WORKER_POLL_INTERVAL": cfg.Providers.WorkerPollInterval,
	})
	if cfg.Providers.OperationTimeout < cfg.Providers.RequestTimeout {
		report.add("MOSAIC_PROVIDER_OPERATION_TIMEOUT must be greater than or equal to MOSAIC_PROVIDER_REQUEST_TIMEOUT")
	}
	if cfg.Providers.OperationTimeout > 5*time.Minute {
		report.add("MOSAIC_PROVIDER_OPERATION_TIMEOUT must not exceed 5m")
	}
	if cfg.Providers.MaxResponseBytes <= 0 {
		report.add("MOSAIC_PROVIDER_MAX_RESPONSE_BYTES must be greater than zero")
	}
	if cfg.Providers.MaxAttempts < 1 || cfg.Providers.MaxAttempts > 5 {
		report.add("MOSAIC_PROVIDER_MAX_ATTEMPTS must be between 1 and 5")
	}
}

func (cfg Config) validateAnalytics(report *problems) {
	report.requirePositiveInts(map[string]int{
		"MOSAIC_ANALYTICS_IP_REQUESTS_PER_MINUTE": cfg.Analytics.IPRequestsPerMinute,
		"MOSAIC_ANALYTICS_IP_BURST":               cfg.Analytics.IPBurst,
		"MOSAIC_ANALYTICS_KEY_BATCHES_PER_MINUTE": cfg.Analytics.KeyBatchesPerMinute,
		"MOSAIC_ANALYTICS_KEY_BATCH_BURST":        cfg.Analytics.KeyBatchBurst,
		"MOSAIC_ANALYTICS_KEY_EVENTS_PER_MINUTE":  cfg.Analytics.KeyEventsPerMinute,
		"MOSAIC_ANALYTICS_KEY_EVENT_BURST":        cfg.Analytics.KeyEventBurst,
		"MOSAIC_ANALYTICS_LIMITER_ENTRIES":        cfg.Analytics.LimiterEntries,
	})
	if cfg.Analytics.WorkerPollInterval <= 0 {
		report.add("MOSAIC_ANALYTICS_WORKER_POLL_INTERVAL must be greater than zero")
	}
}

func (cfg Config) validateBilling(report *problems, productionLike bool) {
	if !cfg.Billing.Enabled {
		return
	}
	// Billing cannot run without the keyring: every Store Server Credential and
	// every retained Raw Billing Input body is sealed under it.
	if cfg.Providers.CredentialKeyring == "" {
		report.add("MOSAIC_PROVIDER_CREDENTIAL_KEYRING is required when MOSAIC_BILLING_ENABLED is true")
	}
	if cfg.Billing.RawRetentionDays < 30 || cfg.Billing.RawRetentionDays > 400 {
		report.add("MOSAIC_BILLING_RAW_RETENTION_DAYS must be between 30 and 400")
	}
	if cfg.Billing.WorkerPollInterval <= 0 {
		report.add("MOSAIC_BILLING_WORKER_POLL_INTERVAL must be greater than zero")
	}
	// Apple posts notifications to this origin, so it must be a real HTTPS
	// origin an operator can hand to App Store Connect.
	base, err := url.Parse(cfg.Billing.NotificationBaseURL)
	switch {
	case cfg.Billing.NotificationBaseURL == "":
		report.add("MOSAIC_BILLING_NOTIFICATION_BASE_URL is required when MOSAIC_BILLING_ENABLED is true")
	case err != nil || base.Host == "" || base.User != nil || (base.Scheme != "https" && base.Scheme != "http"):
		report.add("MOSAIC_BILLING_NOTIFICATION_BASE_URL must be an absolute HTTP(S) URL without credentials")
	case productionLike && base.Scheme != "https":
		report.add("MOSAIC_BILLING_NOTIFICATION_BASE_URL must use HTTPS outside development and test")
	}
	for name, value := range map[string]string{
		"MOSAIC_APPLE_STOREKIT_BASE_URL":         cfg.Billing.AppleProductionBaseURL,
		"MOSAIC_APPLE_STOREKIT_SANDBOX_BASE_URL": cfg.Billing.AppleSandboxBaseURL,
		"MOSAIC_GOOGLE_PLAY_BASE_URL":            cfg.Billing.GooglePlayBaseURL,
		"MOSAIC_GOOGLE_PUBSUB_BASE_URL":          cfg.Billing.GooglePubSubBaseURL,
	} {
		parsed, err := url.Parse(value)
		if value == "" || err != nil || parsed.Host == "" || parsed.User != nil ||
			(parsed.Scheme != "https" && parsed.Scheme != "http") {
			report.add("%s must be an absolute HTTP(S) URL without credentials", name)
			continue
		}
		if productionLike && parsed.Scheme != "https" {
			report.add("%s must use HTTPS outside development and test", name)
		}
	}
	report.requirePositiveInts(map[string]int{
		"MOSAIC_BILLING_OBSERVATIONS_PER_MINUTE": cfg.Billing.ObservationsPerMinute,
		"MOSAIC_BILLING_OBSERVATION_BURST":       cfg.Billing.ObservationBurst,
		"MOSAIC_BILLING_LIMITER_ENTRIES":         cfg.Billing.LimiterEntries,
	})
}

func (cfg Config) validateWorker(report *problems) {
	if _, _, err := net.SplitHostPort(cfg.Worker.HealthAddress); err != nil {
		report.add("MOSAIC_WORKER_HEALTH_ADDRESS must be a host:port address")
	}
	report.requirePositive(map[string]time.Duration{
		"MOSAIC_WORKER_JOB_SHUTDOWN_BUDGET": cfg.Worker.JobShutdownBudget,
		"MOSAIC_WORKER_SCHEDULE_LEASE":      cfg.Worker.ScheduleLease,
	})
}
