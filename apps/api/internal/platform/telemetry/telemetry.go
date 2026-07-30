package telemetry

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
	"google.golang.org/grpc/credentials"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
)

// Supported values for Config.OTLPProtocol. They mirror the OpenTelemetry
// specification's OTEL_EXPORTER_OTLP_PROTOCOL values so an operator can reuse
// the vendor documentation of whichever collector they point Mosaic at.
const (
	ProtocolHTTP = "http/protobuf"
	ProtocolGRPC = "grpc"
)

// DefaultProtocol is what an unset OTLPProtocol resolves to. HTTP stays the
// default because it survives proxies and ingress that do not speak HTTP/2,
// which is how most hosted collectors are reached.
const DefaultProtocol = ProtocolHTTP

type Config struct {
	ServiceName  string
	Environment  string
	OTLPEndpoint string
	// OTLPProtocol selects the OTLP transport: "http/protobuf" (default) or
	// "grpc". Both carry the same payloads; only the wire transport differs,
	// and the endpoint port usually does too (4318 for HTTP, 4317 for gRPC).
	OTLPProtocol string
	// OTLPHeaders carries per-request export headers in the OpenTelemetry
	// specification's format ("key1=value1,key2=value2", values
	// percent-encoded). This is where a hosted collector's API key or bearer
	// token goes, so the values are secrets: they are never logged, and never
	// appear in an error returned from this package.
	OTLPHeaders string
	// OTLPTLSSkipVerify disables certificate verification for an https://
	// endpoint. It exists for collectors behind a private CA or a self-signed
	// certificate; it is not a way to run TLS "loosely" on the public internet,
	// because an unverified connection cannot tell the collector apart from
	// anything that intercepts it — including whatever OTLPHeaders is sent to.
	// It has no effect on an http:// endpoint, which is plaintext regardless.
	OTLPTLSSkipVerify bool
	// DisableLogExport stops log records from being exported while leaving
	// traces and metrics alone. Log volume is the expensive signal at most
	// vendors, so an operator needs to turn it off without giving up tracing.
	// The local log stream is unaffected either way.
	DisableLogExport bool
	// Logger receives OpenTelemetry's own internal errors (export failures,
	// dropped batches). Without it the SDK writes them to the standard library
	// logger, which bypasses Mosaic's JSON log stream and makes exporter
	// breakage invisible to log-based alerting.
	Logger zerolog.Logger
}

type Shutdown func(context.Context) error

func New(ctx context.Context, cfg Config) (Shutdown, error) {
	otel.SetErrorHandler(errorHandler{logger: cfg.Logger})
	build := buildinfo.Current()
	attributes := []attribute.KeyValue{
		semconv.ServiceName(cfg.ServiceName),
		semconv.ServiceVersion(build.Version),
		semconv.DeploymentEnvironmentNameKey.String(cfg.Environment),
	}
	// The commit is release identity, never a secret, and is what an operator
	// correlates a trace back to a source tree with.
	if build.Commit != "" {
		attributes = append(attributes, attribute.String("service.commit", build.Commit))
	}
	serviceResource, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL, attributes...),
	)
	if err != nil {
		return nil, fmt.Errorf("create telemetry resource: %w", err)
	}

	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(serviceResource),
	}
	metricOptions := []sdkmetric.Option{sdkmetric.WithResource(serviceResource)}
	logOptions := []sdklog.LoggerProviderOption{sdklog.WithResource(serviceResource)}

	if cfg.OTLPEndpoint != "" {
		export, err := resolveExport(cfg)
		if err != nil {
			return nil, err
		}
		traceExporter, err := newTraceExporter(ctx, export)
		if err != nil {
			return nil, fmt.Errorf("create OTLP %s trace exporter: %w", export.protocol, err)
		}
		options = append(options, sdktrace.WithBatcher(traceExporter))
		metricExporter, err := newMetricExporter(ctx, export)
		if err != nil {
			return nil, fmt.Errorf("create OTLP %s metric exporter: %w", export.protocol, err)
		}
		metricOptions = append(metricOptions, sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)))
		if !cfg.DisableLogExport {
			logExporter, err := newLogExporter(ctx, export)
			if err != nil {
				return nil, fmt.Errorf("create OTLP %s log exporter: %w", export.protocol, err)
			}
			logOptions = append(logOptions, sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)))
		}
	}

	provider := sdktrace.NewTracerProvider(options...)
	otel.SetTracerProvider(provider)
	metricProvider := sdkmetric.NewMeterProvider(metricOptions...)
	otel.SetMeterProvider(metricProvider)
	// Installing the logger provider globally is what connects an already-built
	// exporting logger to the pipeline: until this call its records go to the
	// no-op provider and appear on the local stream only.
	logProvider := sdklog.NewLoggerProvider(logOptions...)
	global.SetLoggerProvider(logProvider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return func(ctx context.Context) error {
		// Logs flush first: the last records a shutdown produces are the ones an
		// operator most wants to see, and they are the cheapest signal to drain.
		return errors.Join(
			logProvider.Shutdown(ctx),
			metricProvider.Shutdown(ctx),
			provider.Shutdown(ctx),
		)
	}, nil
}

// NormalizeProtocol resolves an operator-supplied protocol name to one of the
// supported constants, treating the empty value as the default. Configuration
// loading uses it so an unsupported protocol is reported at startup validation
// alongside every other config problem rather than failing later in New.
func NormalizeProtocol(value string) (string, error) {
	return normalizeProtocol(value)
}

func normalizeProtocol(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return DefaultProtocol, nil
	// "http" is not a spec value, but it is the obvious thing to write and
	// rejecting it would only cost an operator a deploy cycle to learn.
	case ProtocolHTTP, "http":
		return ProtocolHTTP, nil
	case ProtocolGRPC:
		return ProtocolGRPC, nil
	default:
		return "", fmt.Errorf(
			"unsupported OTLP protocol %q: want %q or %q",
			value, ProtocolHTTP, ProtocolGRPC,
		)
	}
}

// ParseHeaders decodes the OpenTelemetry OTLP header format —
// "key1=value1,key2=value2" with percent-encoded values — into the map the
// exporters take. An empty input yields no headers. Errors name the offending
// key at most, never a value, because values are credentials.
func ParseHeaders(value string) (map[string]string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	headers := make(map[string]string)
	for _, pair := range strings.Split(trimmed, ",") {
		if strings.TrimSpace(pair) == "" {
			continue
		}
		key, encoded, found := strings.Cut(pair, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			return nil, errors.New("OTLP headers must be a comma-separated list of key=value pairs")
		}
		decoded, err := url.QueryUnescape(strings.TrimSpace(encoded))
		if err != nil {
			return nil, fmt.Errorf("OTLP header %q has a malformed percent-encoded value", key)
		}
		headers[key] = decoded
	}
	return headers, nil
}

// exportSettings is the resolved, validated shape of the export configuration:
// everything the exporter constructors need, already normalized.
type exportSettings struct {
	protocol string
	endpoint string
	headers  map[string]string
	// tlsConfig is nil unless certificate verification is being skipped on an
	// https:// endpoint, which is the only case where the default client TLS
	// behaviour needs overriding.
	tlsConfig *tls.Config
}

func resolveExport(cfg Config) (exportSettings, error) {
	protocol, err := normalizeProtocol(cfg.OTLPProtocol)
	if err != nil {
		return exportSettings{}, err
	}
	headers, err := ParseHeaders(cfg.OTLPHeaders)
	if err != nil {
		return exportSettings{}, err
	}
	endpoint, err := url.Parse(cfg.OTLPEndpoint)
	if err != nil || endpoint.Host == "" {
		return exportSettings{}, errors.New("OTLP endpoint must be an absolute http:// or https:// URL")
	}
	settings := exportSettings{protocol: protocol, endpoint: cfg.OTLPEndpoint, headers: headers}
	// Skipping verification only means anything over TLS. Applying it to a
	// plaintext endpoint would, for the gRPC exporter, quietly upgrade the
	// connection to TLS against a collector that is not listening for it.
	if cfg.OTLPTLSSkipVerify && endpoint.Scheme == "https" {
		settings.tlsConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // opt-in, and rejected in production-like environments without an explicit acknowledgement
	}
	return settings, nil
}

// exporterOptions applies the export policy — always the endpoint, headers only
// when there are any, TLS only when verification is being overridden — to one
// exporter package's option type.
//
// Every OTLP exporter package exposes the same three options under the same
// names but as unrelated types, so the alternative is this decision written out
// once per signal per transport. Six copies of one policy is how the trace,
// metric, and log exporters end up disagreeing about when a header is sent.
func exporterOptions[O any](
	export exportSettings,
	withEndpointURL func(string) O,
	withHeaders func(map[string]string) O,
	withTLS func(*tls.Config) O,
) []O {
	options := []O{withEndpointURL(export.endpoint)}
	if len(export.headers) > 0 {
		options = append(options, withHeaders(export.headers))
	}
	if export.tlsConfig != nil {
		options = append(options, withTLS(export.tlsConfig))
	}
	return options
}

// grpcTLS adapts a TLS config to the credentials form the gRPC exporters take,
// so both transports can be described by the same withTLS shape.
func grpcTLS[O any](withCredentials func(credentials.TransportCredentials) O) func(*tls.Config) O {
	return func(config *tls.Config) O {
		return withCredentials(credentials.NewTLS(config))
	}
}

// newTraceExporter builds the span exporter for the resolved protocol. Both
// transports take the endpoint as a URL, so the scheme an operator writes
// (http:// vs https://) still decides whether the connection is encrypted.
func newTraceExporter(ctx context.Context, export exportSettings) (sdktrace.SpanExporter, error) {
	if export.protocol == ProtocolGRPC {
		return otlptracegrpc.New(ctx, exporterOptions(
			export,
			otlptracegrpc.WithEndpointURL,
			otlptracegrpc.WithHeaders,
			grpcTLS(otlptracegrpc.WithTLSCredentials),
		)...)
	}
	return otlptracehttp.New(ctx, exporterOptions(
		export,
		otlptracehttp.WithEndpointURL,
		otlptracehttp.WithHeaders,
		otlptracehttp.WithTLSClientConfig,
	)...)
}

func newMetricExporter(ctx context.Context, export exportSettings) (sdkmetric.Exporter, error) {
	if export.protocol == ProtocolGRPC {
		return otlpmetricgrpc.New(ctx, exporterOptions(
			export,
			otlpmetricgrpc.WithEndpointURL,
			otlpmetricgrpc.WithHeaders,
			grpcTLS(otlpmetricgrpc.WithTLSCredentials),
		)...)
	}
	return otlpmetrichttp.New(ctx, exporterOptions(
		export,
		otlpmetrichttp.WithEndpointURL,
		otlpmetrichttp.WithHeaders,
		otlpmetrichttp.WithTLSClientConfig,
	)...)
}

func newLogExporter(ctx context.Context, export exportSettings) (sdklog.Exporter, error) {
	if export.protocol == ProtocolGRPC {
		return otlploggrpc.New(ctx, exporterOptions(
			export,
			otlploggrpc.WithEndpointURL,
			otlploggrpc.WithHeaders,
			grpcTLS(otlploggrpc.WithTLSCredentials),
		)...)
	}
	return otlploghttp.New(ctx, exporterOptions(
		export,
		otlploghttp.WithEndpointURL,
		otlploghttp.WithHeaders,
		otlploghttp.WithTLSClientConfig,
	)...)
}

// errorHandler routes OpenTelemetry SDK errors into Mosaic's structured log
// stream so an operator sees exporter failures in the same JSON pipeline as
// every other backend error.
type errorHandler struct{ logger zerolog.Logger }

func (h errorHandler) Handle(err error) {
	if err == nil {
		return
	}
	h.logger.Error().Err(err).Str("component", "opentelemetry").Msg("opentelemetry sdk error")
}
