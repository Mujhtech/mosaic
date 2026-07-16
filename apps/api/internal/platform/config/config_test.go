package config

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLoadUsesFoundationDefaults(t *testing.T) {
	cfg, err := load(func(string) (string, bool) { return "", false })
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
}

func TestLoadParsesAllowedOrigins(t *testing.T) {
	values := map[string]string{
		"MOSAIC_CORS_ALLOWED_ORIGINS": "https://studio.example, https://admin.example",
	}

	cfg, err := load(mapLookup(values))
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

	cfg, err := load(mapLookup(values))
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

	_, err := load(mapLookup(values))
	if err == nil {
		t.Fatal("load configuration succeeded, want timeout validation error")
	}
	if !strings.Contains(err.Error(), "MOSAIC_HTTP_HANDLER_TIMEOUT") {
		t.Fatalf("error = %q, want handler-timeout key", err)
	}
}

func mapLookup(values map[string]string) lookupFunc {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
