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
	if cfg.Migration.Enabled {
		t.Fatal("billing migration execution must default off")
	}
	if cfg.Migration.SourceObjectBucket != "mosaic-migration-private" || cfg.Migration.SourceObjectChunkBytes != 256*1024 {
		t.Fatalf("migration source-object defaults = %#v", cfg.Migration)
	}
	if cfg.Migration.SourceObjectOperationTimeout != 5*time.Minute || cfg.Migration.WorkerPollInterval != time.Second {
		t.Fatalf("migration worker defaults = %#v", cfg.Migration)
	}
}

func TestBillingMigrationExecutionRequiresBillingAndSeparateEncryption(t *testing.T) {
	validKeyring := `{"version":1,"activeKeyId":"migration-1","keys":{"migration-1":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI"}}`
	providerKeyring := `{"version":1,"activeKeyId":"provider-1","keys":{"provider-1":"QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE"}}`

	for name, test := range map[string]struct {
		values map[string]string
		want   string
	}{
		"billing is enabled": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_ENABLED": "true", "MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING": validKeyring},
			want:   "MOSAIC_BILLING_ENABLED",
		},
		"source keyring is configured": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_ENABLED": "true", "MOSAIC_BILLING_ENABLED": "true"},
			want:   "MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING",
		},
		"source keyring is valid": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING": `{"version":1,"activeKeyId":"missing","keys":{}}`},
			want:   "MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING",
		},
		"source keyring is not the provider credential keyring": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING": validKeyring, "MOSAIC_PROVIDER_CREDENTIAL_KEYRING": validKeyring},
			want:   "MOSAIC_PROVIDER_CREDENTIAL_KEYRING",
		},
		"source keyring does not reuse provider key material under another id": {
			values: map[string]string{
				"MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING": validKeyring,
				"MOSAIC_PROVIDER_CREDENTIAL_KEYRING":      `{"version":1,"activeKeyId":"provider-elsewhere","keys":{"provider-elsewhere":"MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI"}}`,
			},
			want: "MOSAIC_PROVIDER_CREDENTIAL_KEYRING",
		},
		"source objects use a private bucket": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_SOURCE_BUCKET": "mosaic-assets"},
			want:   "MOSAIC_BILLING_MIGRATION_SOURCE_BUCKET",
		},
		"chunk size remains bounded": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_SOURCE_CHUNK_BYTES": "8192"},
			want:   "MOSAIC_BILLING_MIGRATION_SOURCE_CHUNK_BYTES",
		},
		"source operation remains bounded": {
			values: map[string]string{"MOSAIC_BILLING_MIGRATION_SOURCE_OPERATION_TIMEOUT": "16m"},
			want:   "MOSAIC_BILLING_MIGRATION_SOURCE_OPERATION_TIMEOUT",
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := loadTestConfig(t, test.values)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %s", err, test.want)
			}
		})
	}

	cfg, err := loadTestConfig(t, map[string]string{
		"MOSAIC_BILLING_ENABLED":                      "true",
		"MOSAIC_BILLING_NOTIFICATION_BASE_URL":        "http://localhost:8080",
		"MOSAIC_PROVIDER_CREDENTIAL_KEYRING":          providerKeyring,
		"MOSAIC_BILLING_MIGRATION_ENABLED":            "true",
		"MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING":     validKeyring,
		"MOSAIC_BILLING_MIGRATION_SOURCE_BUCKET":      "migration-evidence-private",
		"MOSAIC_BILLING_MIGRATION_SOURCE_CHUNK_BYTES": "32768",
	})
	if err != nil {
		t.Fatalf("valid migration configuration rejected: %v", err)
	}
	if !cfg.Migration.Enabled || cfg.Migration.SourceObjectChunkBytes != 32768 {
		t.Fatalf("migration configuration = %#v", cfg.Migration)
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

func TestTelemetryProtocolAcceptsSupportedTransports(t *testing.T) {
	for name, test := range map[string]struct {
		value     string
		wantError bool
	}{
		"unset defaults to http":  {value: ""},
		"http/protobuf":           {value: "http/protobuf"},
		"grpc":                    {value: "grpc"},
		"mixed case is tolerated": {value: "GRPC"},
		"unsupported transport":   {value: "thrift", wantError: true},
	} {
		t.Run(name, func(t *testing.T) {
			values := map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.internal:4317"}
			if test.value != "" {
				values["OTEL_EXPORTER_OTLP_PROTOCOL"] = test.value
			}
			cfg, err := loadTestConfig(t, values)
			if test.wantError {
				if err == nil {
					t.Fatal("load succeeded with unsupported OTLP protocol")
				}
				if !strings.Contains(err.Error(), "OTEL_EXPORTER_OTLP_PROTOCOL") {
					t.Fatalf("error = %v, want it to name the offending variable", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("load telemetry protocol %q: %v", test.value, err)
			}
			if want := strings.ToLower(test.value); cfg.Telemetry.OTLPProtocol != want {
				t.Fatalf("protocol = %q, want %q", cfg.Telemetry.OTLPProtocol, want)
			}
		})
	}
}

// Log export follows the collector: on by default so logs sit beside the traces
// they belong to, off when there is nowhere to send them or an operator says so.
func TestLogExportFollowsCollectorAndOptOut(t *testing.T) {
	for name, test := range map[string]struct {
		values map[string]string
		want   bool
	}{
		"no collector configured": {values: map[string]string{}},
		"collector configured": {
			values: map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"},
			want:   true,
		},
		"logs disabled with a collector": {
			values: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
				"MOSAIC_OTEL_LOGS_ENABLED":    "false",
			},
		},
		"logs enabled without a collector": {
			values: map[string]string{"MOSAIC_OTEL_LOGS_ENABLED": "true"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			cfg, err := loadTestConfig(t, test.values)
			if err != nil {
				t.Fatalf("load configuration: %v", err)
			}
			if cfg.Telemetry.ExportLogs() != test.want {
				t.Fatalf("export logs = %t, want %t", cfg.Telemetry.ExportLogs(), test.want)
			}
		})
	}
}

func TestTelemetryExportSecurityIsValidated(t *testing.T) {
	secretHeader := "authorization=Bearer%20collector-super-secret"
	for name, test := range map[string]struct {
		values    map[string]string
		wantError bool
	}{
		"plaintext collector in development": {
			values: map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"},
		},
		"authenticated https collector": {
			values: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:4318",
				"OTEL_EXPORTER_OTLP_HEADERS":  secretHeader,
			},
		},
		"malformed headers": {
			values: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:4318",
				"OTEL_EXPORTER_OTLP_HEADERS":  "authorization Bearer collector-super-secret",
			},
			wantError: true,
		},
		"endpoint embedding credentials": {
			values:    map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "https://user:collector-super-secret@collector.example:4318"},
			wantError: true,
		},
		"skip verify on a plaintext endpoint": {
			values: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT":          "http://localhost:4318",
				"MOSAIC_OTEL_EXPORTER_TLS_SKIP_VERIFY": "true",
			},
			wantError: true,
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := loadTestConfig(t, test.values)
			assertTelemetryValidation(t, err, test.wantError)
		})
	}
}

func TestProductionTelemetryRequiresVerifiedCollectorOrAcknowledgement(t *testing.T) {
	for name, test := range map[string]struct {
		overrides map[string]string
		wantError bool
	}{
		"verified https collector": {
			overrides: map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "https://collector.example:4318"},
		},
		"plaintext collector": {
			overrides: map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector.example:4318"},
			wantError: true,
		},
		"plaintext collector on a trusted network": {
			overrides: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT":         "http://collector.internal:4318",
				"MOSAIC_OTEL_EXPORTER_ALLOW_INSECURE": "true",
			},
		},
		"unverified certificate": {
			overrides: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT":          "https://collector.example:4318",
				"MOSAIC_OTEL_EXPORTER_TLS_SKIP_VERIFY": "true",
			},
			wantError: true,
		},
		"unverified certificate acknowledged": {
			overrides: map[string]string{
				"OTEL_EXPORTER_OTLP_ENDPOINT":          "https://collector.example:4318",
				"MOSAIC_OTEL_EXPORTER_TLS_SKIP_VERIFY": "true",
				"MOSAIC_OTEL_EXPORTER_ALLOW_INSECURE":  "true",
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			values := productionConfigValues()
			values["OTEL_EXPORTER_OTLP_HEADERS"] = "authorization=Bearer%20collector-super-secret"
			for key, value := range test.overrides {
				values[key] = value
			}
			_, err := loadTestConfig(t, values)
			assertTelemetryValidation(t, err, test.wantError)
		})
	}
}

// productionConfigValues is a deployment that passes every production guard, so
// a test that overrides one variable is asserting about that variable alone.
func productionConfigValues() map[string]string {
	return map[string]string{
		"MOSAIC_ENVIRONMENT":               "production",
		"MOSAIC_CORS_ALLOWED_ORIGINS":      "https://studio.example",
		"MOSAIC_SESSION_COOKIE_SECURE":     "true",
		"MOSAIC_PUBLIC_ASSET_BASE_URL":     "https://assets.example/v1/sdk/assets",
		"MOSAIC_OBJECT_STORAGE_ACCESS_KEY": "production-access",
		"MOSAIC_OBJECT_STORAGE_SECRET_KEY": "production-secret",
		"MOSAIC_OBJECT_STORAGE_TLS":        "true",
		"DATABASE_URL":                     "postgres://mosaic:secret-password@db.example:5432/mosaic?sslmode=verify-full",
	}
}

func assertTelemetryValidation(t *testing.T, err error, wantError bool) {
	t.Helper()
	if err != nil && strings.Contains(err.Error(), "collector-super-secret") {
		t.Fatalf("startup error leaked a collector credential: %v", err)
	}
	switch {
	case wantError && err == nil:
		t.Fatal("load succeeded with an unsafe telemetry export configuration")
	case !wantError && err != nil:
		t.Fatalf("load telemetry export configuration: %v", err)
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
		"OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_EXPORTER_OTLP_HEADERS",
		"MOSAIC_OTEL_EXPORTER_TLS_SKIP_VERIFY", "MOSAIC_OTEL_EXPORTER_ALLOW_INSECURE",
		"MOSAIC_OTEL_LOGS_ENABLED",
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
		"MOSAIC_BILLING_MIGRATION_ENABLED", "MOSAIC_BILLING_MIGRATION_SOURCE_KEYRING",
		"MOSAIC_BILLING_MIGRATION_SOURCE_BUCKET", "MOSAIC_BILLING_MIGRATION_SOURCE_CHUNK_BYTES",
		"MOSAIC_BILLING_MIGRATION_SOURCE_OPERATION_TIMEOUT", "MOSAIC_BILLING_MIGRATION_WORKER_POLL_INTERVAL",
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
	secureProduction := productionConfigValues()

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

// A rolling restart sheds traffic at the edge unless readiness reports 503 for
// long enough that a load balancer notices before the listener closes. The
// default must therefore be non-zero; 0 is a deliberate opt-out, and a negative
// value is a configuration error rather than a silently-ignored one.
func TestDrainDelayDefaultsToAnObservableWindow(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://mosaic:mosaic@localhost:5432/mosaic?sslmode=disable")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}
	if cfg.HTTP.DrainDelay <= 0 {
		t.Fatalf("MOSAIC_HTTP_DRAIN_DELAY default = %s, want a non-zero window", cfg.HTTP.DrainDelay)
	}
	if cfg.HTTP.DrainDelay >= cfg.HTTP.ShutdownTimeout {
		t.Fatalf("drain delay %s must leave room inside the shutdown timeout %s",
			cfg.HTTP.DrainDelay, cfg.HTTP.ShutdownTimeout)
	}

	t.Setenv("MOSAIC_HTTP_DRAIN_DELAY", "-1s")
	if _, err := Load(); err == nil {
		t.Fatal("a negative drain delay was accepted")
	}

	t.Setenv("MOSAIC_HTTP_DRAIN_DELAY", "0s")
	cfg, err = Load()
	if err != nil || cfg.HTTP.DrainDelay != 0 {
		t.Fatalf("0 must be an accepted opt-out: delay=%s err=%v", cfg.HTTP.DrainDelay, err)
	}
}
