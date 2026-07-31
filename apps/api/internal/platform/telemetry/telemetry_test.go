package telemetry

import (
	"context"
	"crypto/tls"
	"reflect"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/log/global"
)

func TestNormalizeProtocolResolvesSupportedTransports(t *testing.T) {
	for name, test := range map[string]struct {
		value     string
		want      string
		wantError bool
	}{
		"empty falls back to the default": {value: "", want: DefaultProtocol},
		"spec http value":                 {value: "http/protobuf", want: ProtocolHTTP},
		"shorthand http value":            {value: "HTTP", want: ProtocolHTTP},
		"grpc":                            {value: " grpc ", want: ProtocolGRPC},
		"unsupported transport":           {value: "http/json", wantError: true},
	} {
		t.Run(name, func(t *testing.T) {
			protocol, err := NormalizeProtocol(test.value)
			if test.wantError {
				if err == nil {
					t.Fatalf("normalize %q succeeded, want rejection", test.value)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalize %q: %v", test.value, err)
			}
			if protocol != test.want {
				t.Fatalf("protocol = %q, want %q", protocol, test.want)
			}
		})
	}
}

func TestParseHeadersDecodesSpecFormat(t *testing.T) {
	headers, err := ParseHeaders(" api-key = secret-token , x-tenant=acme%20corp ")
	if err != nil {
		t.Fatalf("parse headers: %v", err)
	}
	want := map[string]string{"api-key": "secret-token", "x-tenant": "acme corp"}
	if !reflect.DeepEqual(headers, want) {
		t.Fatalf("headers = %#v, want %#v", headers, want)
	}
	if empty, err := ParseHeaders("  "); err != nil || empty != nil {
		t.Fatalf("empty headers = %#v, %v; want no headers and no error", empty, err)
	}
}

func TestParseHeadersRejectsMalformedInputWithoutLeakingValues(t *testing.T) {
	for name, value := range map[string]string{
		"missing separator": "authorization Bearer super-secret",
		"empty key":         "=super-secret",
		"bad encoding":      "authorization=Bearer%zzsuper-secret",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseHeaders(value); err == nil {
				t.Fatal("parse succeeded, want rejection")
			} else if strings.Contains(err.Error(), "super-secret") {
				t.Fatalf("error leaked a header value: %v", err)
			}
		})
	}
}

// Skip-verify must stay inert on a plaintext endpoint: for the gRPC exporter,
// attaching TLS credentials there would silently switch the connection to TLS
// against a collector that is not serving it.
func TestResolveExportAppliesSkipVerifyOnlyOverTLS(t *testing.T) {
	for name, test := range map[string]struct {
		endpoint     string
		wantTLS      bool
		wantInsecure bool
	}{
		"https endpoint": {endpoint: "https://collector.invalid:4318", wantTLS: true},
		"http endpoint":  {endpoint: "http://collector.invalid:4318", wantInsecure: true},
	} {
		t.Run(name, func(t *testing.T) {
			export, err := resolveExport(Config{OTLPEndpoint: test.endpoint, OTLPTLSSkipVerify: true})
			if err != nil {
				t.Fatalf("resolve export: %v", err)
			}
			if test.wantTLS != (export.tlsConfig != nil) {
				t.Fatalf("tls config = %#v, want present = %t", export.tlsConfig, test.wantTLS)
			}
			if export.tlsConfig != nil && !export.tlsConfig.InsecureSkipVerify {
				t.Fatal("tls config does not skip verification")
			}
			// A plaintext endpoint must be declared insecure to the exporter, not
			// left for it to infer, so the two are never both set.
			if export.insecure != test.wantInsecure {
				t.Fatalf("insecure = %t, want %t", export.insecure, test.wantInsecure)
			}
			if export.insecure && export.tlsConfig != nil {
				t.Fatal("plaintext export must not carry a TLS config")
			}
		})
	}
}

// OTEL_EXPORTER_OTLP_ENDPOINT is a base endpoint: each signal hangs off it. A
// base URL handed to the exporters verbatim posts every signal to the base
// path, which a collector answers with 404 — the failure only the log exporter
// surfaces, since the trace and metric exporters quietly fall back to their
// default path.
func TestSignalEndpointAppendsPerSignalPath(t *testing.T) {
	for name, test := range map[string]struct {
		endpoint string
		want     map[string]string
	}{
		"base endpoint without a path": {
			endpoint: "http://collector.example",
			want: map[string]string{
				tracesPath:  "http://collector.example/v1/traces",
				metricsPath: "http://collector.example/v1/metrics",
				logsPath:    "http://collector.example/v1/logs",
			},
		},
		"base endpoint with a port and trailing slash": {
			endpoint: "https://collector.example:4318/",
			want: map[string]string{
				tracesPath: "https://collector.example:4318/v1/traces",
				logsPath:   "https://collector.example:4318/v1/logs",
			},
		},
		"collector behind a path prefix": {
			endpoint: "https://gateway.example/otlp",
			want: map[string]string{
				tracesPath: "https://gateway.example/otlp/v1/traces",
				logsPath:   "https://gateway.example/otlp/v1/logs",
			},
		},
		// Someone who already wrote the signal path must not get it twice.
		"endpoint already naming the signal": {
			endpoint: "https://collector.example/v1/logs",
			want:     map[string]string{logsPath: "https://collector.example/v1/logs"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			export, err := resolveExport(Config{OTLPEndpoint: test.endpoint})
			if err != nil {
				t.Fatalf("resolve export: %v", err)
			}
			for signalPath, want := range test.want {
				if got := export.signalEndpoint(signalPath); got != want {
					t.Fatalf("endpoint for %s = %q, want %q", signalPath, got, want)
				}
			}
		})
	}
}

// The insecure option must reach every exporter, not just the one that was
// checked by hand: exporterOptions is where that guarantee lives.
func TestExporterOptionsDeclarePlaintextOnce(t *testing.T) {
	type option string
	endpoint := func(url string) option { return option("endpoint:" + url) }
	insecure := func() option { return "insecure" }
	headers := func(map[string]string) option { return "headers" }
	tlsOption := func(*tls.Config) option { return "tls" }

	plaintext, err := resolveExport(Config{OTLPEndpoint: "http://collector.invalid:4318"})
	if err != nil {
		t.Fatalf("resolve export: %v", err)
	}
	options := exporterOptions(plaintext, logsPath, endpoint, insecure, headers, tlsOption)
	want := []option{"endpoint:http://collector.invalid:4318/v1/logs", "insecure"}
	if !reflect.DeepEqual(options, want) {
		t.Fatalf("options = %#v, want %#v", options, want)
	}

	secure, err := resolveExport(Config{OTLPEndpoint: "https://collector.invalid:4318", OTLPTLSSkipVerify: true})
	if err != nil {
		t.Fatalf("resolve export: %v", err)
	}
	secureOptions := exporterOptions(secure, tracesPath, endpoint, insecure, headers, tlsOption)
	wantSecure := []option{"endpoint:https://collector.invalid:4318/v1/traces", "tls"}
	if !reflect.DeepEqual(secureOptions, wantSecure) {
		t.Fatalf("options = %#v, want %#v", secureOptions, wantSecure)
	}
}

// New must build both exporters for either transport without reaching the
// collector: exporter construction is lazy, so a startup failure here would be
// a configuration bug rather than an unreachable-collector symptom.
func TestNewBuildsExportersForEitherTransport(t *testing.T) {
	for name, test := range map[string]struct {
		protocol   string
		endpoint   string
		skipVerify bool
	}{
		"http":                     {protocol: "http/protobuf", endpoint: "http://collector.invalid:4318"},
		"grpc":                     {protocol: "grpc", endpoint: "http://collector.invalid:4317"},
		"http over unverified tls": {protocol: "http/protobuf", endpoint: "https://collector.invalid:4318", skipVerify: true},
		"grpc over unverified tls": {protocol: "grpc", endpoint: "https://collector.invalid:4317", skipVerify: true},
	} {
		t.Run(name, func(t *testing.T) {
			shutdown, err := New(context.Background(), Config{
				ServiceName:       "mosaic-api-test",
				Environment:       "test",
				OTLPEndpoint:      test.endpoint,
				OTLPProtocol:      test.protocol,
				OTLPHeaders:       "authorization=Bearer%20token,x-tenant=acme",
				OTLPTLSSkipVerify: test.skipVerify,
			})
			if err != nil {
				t.Fatalf("configure telemetry over %s: %v", test.protocol, err)
			}
			// Shutdown flushes to an endpoint that does not resolve, so it is
			// bounded here and its export failure is expected; the exporters
			// building at all is what this test guards.
			shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := shutdown(shutdownContext); err != nil {
				t.Logf("shutdown reported an export failure: %v", err)
			}
		})
	}
}

// Log export is the one signal an operator turns off for cost, so disabling it
// must leave traces and metrics — and startup — untouched.
func TestNewBuildsLogPipelineUnlessDisabled(t *testing.T) {
	for name, disabled := range map[string]bool{"exporting logs": false, "log export disabled": true} {
		t.Run(name, func(t *testing.T) {
			shutdown, err := New(context.Background(), Config{
				ServiceName:      "mosaic-api-test",
				Environment:      "test",
				OTLPEndpoint:     "http://collector.invalid:4318",
				DisableLogExport: disabled,
			})
			if err != nil {
				t.Fatalf("configure telemetry: %v", err)
			}
			// A logger provider is installed either way, so code that emits
			// records never has to check whether export is on.
			var record log.Record
			record.SetBody(log.StringValue("startup"))
			global.Logger("mosaic-api-test").Emit(context.Background(), record)

			shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := shutdown(shutdownContext); err != nil {
				t.Logf("shutdown reported an export failure: %v", err)
			}
		})
	}
}

func TestNewRejectsUnsupportedProtocol(t *testing.T) {
	_, err := New(context.Background(), Config{
		ServiceName:  "mosaic-api-test",
		Environment:  "test",
		OTLPEndpoint: "http://collector.invalid:4318",
		OTLPProtocol: "thrift",
	})
	if err == nil {
		t.Fatal("configure telemetry succeeded with an unsupported protocol")
	}
	if !strings.Contains(err.Error(), "unsupported OTLP protocol") {
		t.Fatalf("error = %v, want an unsupported-protocol message", err)
	}
}

// With no endpoint the exporters are never built, so the protocol value is
// irrelevant and must not turn a working no-export setup into a startup error.
func TestNewIgnoresProtocolWithoutEndpoint(t *testing.T) {
	shutdown, err := New(context.Background(), Config{
		ServiceName:  "mosaic-api-test",
		Environment:  "test",
		OTLPProtocol: "thrift",
	})
	if err != nil {
		t.Fatalf("configure telemetry without an endpoint: %v", err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown telemetry: %v", err)
	}
}
