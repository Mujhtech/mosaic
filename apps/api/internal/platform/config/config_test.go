package config

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLoadUsesFoundationDefaults(t *testing.T) {
	cfg, err := loadTestConfig(t, map[string]string{})
	if err != nil {
		t.Fatalf("load defaults: %v", err)
	}

	if cfg.Environment != "development" {
		t.Fatalf("environment = %q, want development", cfg.Environment)
	}
	if cfg.HTTP.Address != ":8080" {
		t.Fatalf("address = %q, want :8080", cfg.HTTP.Address)
	}
	if cfg.HTTP.HandlerTimeout != 10*time.Second {
		t.Fatalf("handler timeout = %s, want 10s", cfg.HTTP.HandlerTimeout)
	}
	if !reflect.DeepEqual(cfg.HTTP.CORSAllowedOrigins, defaultAllowedOrigins) {
		t.Fatalf(
			"allowed origins = %#v, want %#v",
			cfg.HTTP.CORSAllowedOrigins,
			defaultAllowedOrigins,
		)
	}
	if cfg.Telemetry.ServiceName != "mosaic-api" {
		t.Fatalf("service name = %q, want mosaic-api", cfg.Telemetry.ServiceName)
	}
	if cfg.ObjectStore.PublicAssetBaseURL != "https://localhost:8443/v1/sdk/assets" {
		t.Fatalf("local Asset base URL = %q, want TLS edge URL", cfg.ObjectStore.PublicAssetBaseURL)
	}
	if cfg.BrowserAuth.RequestsPerMinute != defaultAuthRequestsMinute || cfg.BrowserAuth.Burst != defaultAuthBurst {
		t.Fatalf("authentication rate limits = %#v", cfg.BrowserAuth)
	}
	if cfg.Providers.OperationTimeout != 60*time.Second {
		t.Fatalf("provider operation timeout = %s, want 60s", cfg.Providers.OperationTimeout)
	}
}

func TestLoadRejectsInvalidAuthenticationRateLimits(t *testing.T) {
	for _, key := range []string{"MOSAIC_AUTH_REQUESTS_PER_MINUTE", "MOSAIC_AUTH_BURST", "MOSAIC_AUTH_LIMITER_ENTRIES"} {
		t.Run(key, func(t *testing.T) {
			if _, err := loadTestConfig(t, map[string]string{key: "0"}); err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("error=%v, want invalid %s", err, key)
			}
		})
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	clearConfigEnvironment(t)
	_, err := load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("error = %v, want required DATABASE_URL", err)
	}
}

func TestProviderOperationsRequireCredentialKeyringWhenEnabled(t *testing.T) {
	_, err := loadTestConfig(t, map[string]string{
		"MOSAIC_PROVIDER_INTEGRATIONS_ENABLED": "true",
	})
	if err == nil || !strings.Contains(err.Error(), "MOSAIC_PROVIDER_CREDENTIAL_KEYRING") {
		t.Fatalf("error = %v, want required provider credential keyring", err)
	}
}

func TestLoadParsesAllowedOrigins(t *testing.T) {
	values := map[string]string{
		"MOSAIC_CORS_ALLOWED_ORIGINS": "https://studio.example, https://admin.example",
	}

	cfg, err := loadTestConfig(t, values)
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}

	want := []string{"https://studio.example", "https://admin.example"}
	if !reflect.DeepEqual(cfg.HTTP.CORSAllowedOrigins, want) {
		t.Fatalf("allowed origins = %#v, want %#v", cfg.HTTP.CORSAllowedOrigins, want)
	}
}

func TestLoadAllowsExplicitlyDisablingCORS(t *testing.T) {
	values := map[string]string{
		"MOSAIC_CORS_ALLOWED_ORIGINS": "  ",
	}

	cfg, err := loadTestConfig(t, values)
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}
	if len(cfg.HTTP.CORSAllowedOrigins) != 0 {
		t.Fatalf("allowed origins = %#v, want none", cfg.HTTP.CORSAllowedOrigins)
	}
}

func TestLoadRejectsHandlerTimeoutAtOrAboveWriteTimeout(t *testing.T) {
	values := map[string]string{
		"MOSAIC_HTTP_HANDLER_TIMEOUT": "15s",
		"MOSAIC_HTTP_WRITE_TIMEOUT":   "15s",
	}

	_, err := loadTestConfig(t, values)
	if err == nil {
		t.Fatal("load configuration succeeded, want timeout validation error")
	}
	if !strings.Contains(err.Error(), "MOSAIC_HTTP_HANDLER_TIMEOUT") {
		t.Fatalf("error = %q, want handler-timeout key", err)
	}
}

func TestLoadRejectsProviderOperationTimeoutBelowRequestTimeout(t *testing.T) {
	_, err := loadTestConfig(t, map[string]string{
		"MOSAIC_PROVIDER_REQUEST_TIMEOUT":   "8s",
		"MOSAIC_PROVIDER_OPERATION_TIMEOUT": "7s",
	})
	if err == nil || !strings.Contains(err.Error(), "MOSAIC_PROVIDER_OPERATION_TIMEOUT") {
		t.Fatalf("error = %q, want provider operation-timeout validation", err)
	}
}

func TestLoadRejectsExcessiveProviderOperationTimeout(t *testing.T) {
	_, err := loadTestConfig(t, map[string]string{
		"MOSAIC_PROVIDER_OPERATION_TIMEOUT": "6m",
	})
	if err == nil || !strings.Contains(err.Error(), "MOSAIC_PROVIDER_OPERATION_TIMEOUT") {
		t.Fatalf("error = %q, want bounded provider operation-timeout validation", err)
	}
}

func TestLoadRejectsInsecureHostedAuthenticationAndAssetDefaults(t *testing.T) {
	base := map[string]string{
		"MOSAIC_ENVIRONMENT":               "production",
		"MOSAIC_PUBLIC_ASSET_BASE_URL":     "https://assets.example/v1/sdk/assets",
		"MOSAIC_SESSION_COOKIE_SECURE":     "true",
		"MOSAIC_OBJECT_STORAGE_ACCESS_KEY": "production-access",
		"MOSAIC_OBJECT_STORAGE_SECRET_KEY": "production-secret",
	}

	for name, mutation := range map[string]func(map[string]string){
		"insecure cookie": func(values map[string]string) { values["MOSAIC_SESSION_COOKIE_SECURE"] = "false" },
		"insecure asset URL": func(values map[string]string) {
			values["MOSAIC_PUBLIC_ASSET_BASE_URL"] = "http://assets.example/v1/sdk/assets"
		},
		"development credentials": func(values map[string]string) {
			values["MOSAIC_OBJECT_STORAGE_ACCESS_KEY"] = defaultObjectStoreAccessKey
			values["MOSAIC_OBJECT_STORAGE_SECRET_KEY"] = defaultObjectStoreSecretKey
		},
	} {
		t.Run(name, func(t *testing.T) {
			values := make(map[string]string, len(base))
			for key, value := range base {
				values[key] = value
			}
			mutation(values)
			if _, err := loadTestConfig(t, values); err == nil {
				t.Fatal("load production configuration succeeded with insecure hosted setting")
			}
		})
	}
}

func TestLoadReadsDotEnvBeforeDecoding(t *testing.T) {
	clearConfigEnvironment(t)
	temporaryDirectory := t.TempDir()
	dotEnv := []byte("DATABASE_URL=postgres://mosaic:dotenv@localhost:5432/mosaic_dotenv\n")
	if err := os.WriteFile(filepath.Join(temporaryDirectory, ".env"), dotEnv, 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir(temporaryDirectory); err != nil {
		t.Fatalf("enter temporary directory: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(workingDirectory) })

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load .env configuration: %v", err)
	}
	if cfg.Database.URL != "postgres://mosaic:dotenv@localhost:5432/mosaic_dotenv" {
		t.Fatalf("database URL = %q, want .env value", cfg.Database.URL)
	}
}

func loadTestConfig(t *testing.T, values map[string]string) (Config, error) {
	t.Helper()
	clearConfigEnvironment(t)
	if _, ok := values["DATABASE_URL"]; !ok {
		t.Setenv("DATABASE_URL", "postgres://mosaic:test@localhost:5432/mosaic_test")
	}
	for key, value := range values {
		t.Setenv(key, value)
	}
	return load()
}

func clearConfigEnvironment(t *testing.T) {
	t.Helper()
	keys := []string{
		"MOSAIC_ENVIRONMENT", "MOSAIC_HTTP_ADDRESS", "MOSAIC_HTTP_READ_HEADER_TIMEOUT",
		"MOSAIC_HTTP_READ_TIMEOUT", "MOSAIC_HTTP_WRITE_TIMEOUT", "MOSAIC_HTTP_IDLE_TIMEOUT",
		"MOSAIC_HTTP_HANDLER_TIMEOUT", "MOSAIC_HTTP_SHUTDOWN_TIMEOUT", "MOSAIC_CORS_ALLOWED_ORIGINS",
		"MOSAIC_LOG_LEVEL", "MOSAIC_LOG_FORMAT", "OTEL_SERVICE_NAME", "OTEL_EXPORTER_OTLP_ENDPOINT",
		"DATABASE_URL", "DATABASE_MAX_CONNECTIONS", "DATABASE_MIN_CONNECTIONS", "DATABASE_CONNECT_TIMEOUT",
		"MOSAIC_SESSION_LIFETIME", "MOSAIC_SESSION_COOKIE_SECURE", "MOSAIC_SESSION_COOKIE_DOMAIN",
		"MOSAIC_AUTH_REQUESTS_PER_MINUTE", "MOSAIC_AUTH_BURST", "MOSAIC_AUTH_LIMITER_ENTRIES",
		"MOSAIC_PROTOCOL_V02_SCHEMA_PATH", "MOSAIC_OBJECT_STORAGE_ENDPOINT",
		"MOSAIC_OBJECT_STORAGE_ACCESS_KEY", "MOSAIC_OBJECT_STORAGE_SECRET_KEY",
		"MOSAIC_OBJECT_STORAGE_BUCKET", "MOSAIC_OBJECT_STORAGE_TLS", "MOSAIC_PUBLIC_ASSET_BASE_URL",
		"MOSAIC_ASSET_MAX_UPLOAD_BYTES", "MOSAIC_DELIVERY_REQUESTS_PER_MINUTE",
		"MOSAIC_DELIVERY_BURST", "MOSAIC_DELIVERY_LIMITER_ENTRIES",
		"MOSAIC_COMMERCE_PROVIDER_SCHEMA_PATH", "MOSAIC_COMMERCE_CONFIGURATION_SCHEMA_PATH",
		"MOSAIC_PROVIDER_INTEGRATIONS_ENABLED", "MOSAIC_PROVIDER_CREDENTIAL_KEYRING",
		"MOSAIC_REVENUECAT_BASE_URL", "MOSAIC_PROVIDER_REQUEST_TIMEOUT",
		"MOSAIC_PROVIDER_OPERATION_TIMEOUT", "MOSAIC_PROVIDER_CONNECT_TIMEOUT", "MOSAIC_PROVIDER_MAX_RESPONSE_BYTES",
		"MOSAIC_PROVIDER_MAX_ATTEMPTS", "MOSAIC_PROVIDER_SNAPSHOT_TTL",
		"MOSAIC_PROVIDER_WORKER_POLL_INTERVAL",
		"MOSAIC_ANALYTICS_EVENT_SCHEMA_PATH", "MOSAIC_ANALYTICS_EVENT_V2_SCHEMA_PATH",
		"MOSAIC_ANALYTICS_IP_REQUESTS_PER_MINUTE", "MOSAIC_ANALYTICS_IP_BURST",
		"MOSAIC_ANALYTICS_KEY_BATCHES_PER_MINUTE", "MOSAIC_ANALYTICS_KEY_BATCH_BURST",
		"MOSAIC_ANALYTICS_KEY_EVENTS_PER_MINUTE", "MOSAIC_ANALYTICS_KEY_EVENT_BURST",
		"MOSAIC_ANALYTICS_LIMITER_ENTRIES", "MOSAIC_ANALYTICS_WORKER_POLL_INTERVAL",
		"MOSAIC_COMMERCE_PROVIDER_V2_SCHEMA_PATH", "MOSAIC_COMMERCE_CONFIGURATION_V2_SCHEMA_PATH",
		"MOSAIC_HTTP_UPLOAD_TIMEOUT", "MOSAIC_HTTP_INGEST_TIMEOUT", "MOSAIC_TELEMETRY_SHUTDOWN_TIMEOUT",
		"MOSAIC_TRUSTED_PROXY_CIDRS", "MOSAIC_DATABASE_ALLOW_INSECURE",
		"MOSAIC_OBJECT_STORAGE_ALLOW_INSECURE", "MOSAIC_OBJECT_STORAGE_OPERATION_TIMEOUT",
		"MOSAIC_OBJECT_STORAGE_CHECK_TIMEOUT", "MOSAIC_API_REQUESTS_PER_MINUTE", "MOSAIC_API_BURST",
		"MOSAIC_DECISION_REQUESTS_PER_MINUTE", "MOSAIC_DECISION_BURST",
		"MOSAIC_WORKER_HEALTH_ADDRESS", "MOSAIC_WORKER_JOB_SHUTDOWN_BUDGET", "MOSAIC_WORKER_SCHEDULE_LEASE",
		"DATABASE_MAX_CONN_LIFETIME", "DATABASE_MAX_CONN_IDLE_TIME", "DATABASE_HEALTH_CHECK_PERIOD",
		"DATABASE_STATEMENT_TIMEOUT", "DATABASE_LOCK_TIMEOUT", "DATABASE_CLOSE_TIMEOUT",
	}
	for _, key := range keys {
		value, existed := os.LookupEnv(key)
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("unset %s: %v", key, err)
		}
		capturedKey, capturedValue, capturedExists := key, value, existed
		t.Cleanup(func() {
			if capturedExists {
				_ = os.Setenv(capturedKey, capturedValue)
			} else {
				_ = os.Unsetenv(capturedKey)
			}
		})
	}
}

// Production guards are the last line of defence between an operator's typo and
// a GA deployment that leaks credentials over plaintext transport or accepts
// requests from any origin. Each case asserts one guard fires and that the
// error names the variable without echoing its value.
func TestProductionConfigurationGuards(t *testing.T) {
	secureProduction := map[string]string{
		"MOSAIC_ENVIRONMENT":               "production",
		"MOSAIC_CORS_ALLOWED_ORIGINS":      "https://studio.example",
		"MOSAIC_SESSION_COOKIE_SECURE":     "true",
		"MOSAIC_PUBLIC_ASSET_BASE_URL":     "https://assets.example/v1/sdk/assets",
		"MOSAIC_OBJECT_STORAGE_ACCESS_KEY": "production-access",
		"MOSAIC_OBJECT_STORAGE_SECRET_KEY": "production-secret",
		"MOSAIC_OBJECT_STORAGE_TLS":        "true",
		"DATABASE_URL":                     "postgres://mosaic:secret-password@db.example:5432/mosaic?sslmode=verify-full",
	}

	for name, test := range map[string]struct {
		overrides map[string]string
		want      string
		accepted  bool
	}{
		"baseline production configuration is accepted": {
			overrides: map[string]string{},
			accepted:  true,
		},
		"wildcard CORS origin is rejected": {
			overrides: map[string]string{"MOSAIC_CORS_ALLOWED_ORIGINS": "*"},
			want:      "MOSAIC_CORS_ALLOWED_ORIGINS",
		},
		"plaintext CORS origin is rejected": {
			overrides: map[string]string{"MOSAIC_CORS_ALLOWED_ORIGINS": "http://studio.example"},
			want:      "MOSAIC_CORS_ALLOWED_ORIGINS",
		},
		"DATABASE_URL without sslmode is rejected": {
			overrides: map[string]string{"DATABASE_URL": "postgres://mosaic:secret-password@db.example:5432/mosaic"},
			want:      "DATABASE_URL",
		},
		"DATABASE_URL with sslmode=disable is rejected": {
			overrides: map[string]string{"DATABASE_URL": "postgres://mosaic:secret-password@db.example:5432/mosaic?sslmode=disable"},
			want:      "DATABASE_URL",
		},
		"DATABASE_URL escape hatch is honoured": {
			overrides: map[string]string{
				"DATABASE_URL":                   "postgres://mosaic:secret-password@db.example:5432/mosaic",
				"MOSAIC_DATABASE_ALLOW_INSECURE": "true",
			},
			accepted: true,
		},
		"object storage without TLS is rejected": {
			overrides: map[string]string{"MOSAIC_OBJECT_STORAGE_TLS": "false"},
			want:      "MOSAIC_OBJECT_STORAGE_TLS",
		},
		"object storage escape hatch is honoured": {
			overrides: map[string]string{
				"MOSAIC_OBJECT_STORAGE_TLS":            "false",
				"MOSAIC_OBJECT_STORAGE_ALLOW_INSECURE": "true",
			},
			accepted: true,
		},
		"unknown log level is rejected": {
			overrides: map[string]string{"MOSAIC_LOG_LEVEL": "verbose"},
			want:      "MOSAIC_LOG_LEVEL",
		},
		"malformed keyring is rejected": {
			overrides: map[string]string{"MOSAIC_PROVIDER_CREDENTIAL_KEYRING": `{"version":1,"activeKeyId":"k1"}`},
			want:      "MOSAIC_PROVIDER_CREDENTIAL_KEYRING",
		},
		"upload bytes above the transport ceiling are rejected": {
			overrides: map[string]string{"MOSAIC_ASSET_MAX_UPLOAD_BYTES": "1073741824"},
			want:      "MOSAIC_ASSET_MAX_UPLOAD_BYTES",
		},
		"upload timeout at or above the write timeout is rejected": {
			overrides: map[string]string{"MOSAIC_HTTP_UPLOAD_TIMEOUT": "120s", "MOSAIC_HTTP_WRITE_TIMEOUT": "120s"},
			want:      "MOSAIC_HTTP_UPLOAD_TIMEOUT",
		},
		"malformed trusted proxy CIDR is rejected": {
			overrides: map[string]string{"MOSAIC_TRUSTED_PROXY_CIDRS": "not-a-network"},
			want:      "MOSAIC_TRUSTED_PROXY_CIDRS",
		},
	} {
		t.Run(name, func(t *testing.T) {
			values := make(map[string]string, len(secureProduction)+len(test.overrides))
			for key, value := range secureProduction {
				values[key] = value
			}
			for key, value := range test.overrides {
				values[key] = value
			}
			_, err := loadTestConfig(t, values)
			if test.accepted {
				if err != nil {
					t.Fatalf("secure production configuration rejected: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("configuration accepted, want %s rejected", test.want)
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %q, want it to name %s", err, test.want)
			}
			for _, secret := range []string{"secret-password", "production-secret"} {
				if strings.Contains(err.Error(), secret) {
					t.Fatalf("startup error leaked a secret value: %q", err)
				}
			}
		})
	}
}

func TestValidationErrorReportsEveryProblem(t *testing.T) {
	_, err := loadTestConfig(t, map[string]string{
		"MOSAIC_LOG_LEVEL":             "verbose",
		"MOSAIC_LOG_FORMAT":            "yaml",
		"MOSAIC_WORKER_HEALTH_ADDRESS": "not-an-address",
	})
	var validationError *ValidationError
	if !errors.As(err, &validationError) {
		t.Fatalf("error = %v, want *ValidationError", err)
	}
	if len(validationError.Problems) < 3 {
		t.Fatalf("problems = %#v, want every problem reported in one pass", validationError.Problems)
	}
}
