package telemetry

import (
	"context"
	"errors"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/buildinfo"
)

type Config struct {
	ServiceName  string
	Environment  string
	OTLPEndpoint string
}

type Shutdown func(context.Context) error

func New(ctx context.Context, cfg Config) (Shutdown, error) {
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

	if cfg.OTLPEndpoint != "" {
		exporter, err := otlptracehttp.New(
			ctx,
			otlptracehttp.WithEndpointURL(cfg.OTLPEndpoint),
		)
		if err != nil {
			return nil, fmt.Errorf("create OTLP HTTP trace exporter: %w", err)
		}
		options = append(options, sdktrace.WithBatcher(exporter))
		metricExporter, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithEndpointURL(cfg.OTLPEndpoint))
		if err != nil {
			return nil, fmt.Errorf("create OTLP HTTP metric exporter: %w", err)
		}
		metricOptions = append(metricOptions, sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)))
	}

	provider := sdktrace.NewTracerProvider(options...)
	otel.SetTracerProvider(provider)
	metricProvider := sdkmetric.NewMeterProvider(metricOptions...)
	otel.SetMeterProvider(metricProvider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return func(ctx context.Context) error {
		return errors.Join(metricProvider.Shutdown(ctx), provider.Shutdown(ctx))
	}, nil
}
