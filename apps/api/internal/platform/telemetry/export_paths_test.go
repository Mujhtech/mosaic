package telemetry_test

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
	"go.opentelemetry.io/otel"
	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	colmetricpb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
)

// An OTLP collector that records the paths it is asked for, and 404s anything that is
// not a real OTLP signal path — the same way the live collector did.
func TestExportersPostToSignalPaths(t *testing.T) {
	var mutex sync.Mutex
	seen := map[string]int{}
	valid := map[string]bool{"/v1/traces": true, "/v1/metrics": true, "/v1/logs": true}

	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mutex.Lock()
		seen[r.URL.Path]++
		mutex.Unlock()
		if !valid[r.URL.Path] {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer collector.Close()

	shutdown, err := telemetry.New(context.Background(), telemetry.Config{
		ServiceName:  "mosaic-api-test",
		Environment:  "test",
		OTLPEndpoint: collector.URL,
	})
	if err != nil {
		t.Fatalf("configure telemetry: %v", err)
	}

	logger, err := logging.NewExporting("info", "json", &discard{}, "mosaic-api-test")
	if err != nil {
		t.Fatalf("build exporting logger: %v", err)
	}
	logger.Info().Str("check", "paths").Msg("hello collector")

	_, span := otel.Tracer("mosaic-api-test").Start(context.Background(), "check")
	span.End()

	counter, err := otel.Meter("mosaic-api-test").Int64Counter("pathcheck.runs")
	if err != nil {
		t.Fatalf("create counter: %v", err)
	}
	counter.Add(context.Background(), 1)

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := shutdown(shutdownContext); err != nil {
		t.Fatalf("shutdown telemetry: %v", err)
	}

	mutex.Lock()
	defer mutex.Unlock()
	paths := make([]string, 0, len(seen))
	for path := range seen {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	t.Logf("collector received: %v", paths)
	for _, want := range []string{"/v1/logs", "/v1/metrics", "/v1/traces"} {
		if seen[want] == 0 {
			t.Fatalf("collector never received %s; got %v", want, paths)
		}
	}
	for path := range seen {
		if !valid[path] {
			t.Fatalf("collector received a request on %s, which it 404s", path)
		}
	}
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// The gRPC transport takes the same base endpoint. Its exporters are handed the
// signal URL the HTTP transport needs, so this pins the fact that the appended
// signal path is inert over gRPC: the RPC still lands on the collector's fixed
// service method rather than a path the server has never heard of.
func TestGRPCExportersReachTheCollectorFromABaseEndpoint(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	exported := make(chan string, 3)
	server := grpc.NewServer()
	coltracepb.RegisterTraceServiceServer(server, traceCollector{exported: exported})
	colmetricpb.RegisterMetricsServiceServer(server, metricCollector{exported: exported})
	collogspb.RegisterLogsServiceServer(server, logCollector{exported: exported})
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()

	shutdown, err := telemetry.New(context.Background(), telemetry.Config{
		ServiceName:  "mosaic-api-test",
		Environment:  "test",
		OTLPEndpoint: "http://" + listener.Addr().String(),
		OTLPProtocol: telemetry.ProtocolGRPC,
	})
	if err != nil {
		t.Fatalf("configure telemetry: %v", err)
	}

	logger, err := logging.NewExporting("info", "json", &discard{}, "mosaic-api-test")
	if err != nil {
		t.Fatalf("build exporting logger: %v", err)
	}
	logger.Info().Str("check", "grpc").Msg("hello collector")

	_, span := otel.Tracer("mosaic-api-test").Start(context.Background(), "check")
	span.End()

	counter, err := otel.Meter("mosaic-api-test").Int64Counter("grpccheck.runs")
	if err != nil {
		t.Fatalf("create counter: %v", err)
	}
	counter.Add(context.Background(), 1)

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := shutdown(shutdownContext); err != nil {
		t.Fatalf("shutdown telemetry: %v", err)
	}

	received := map[string]bool{}
	for len(received) < 3 {
		select {
		case signal := <-exported:
			received[signal] = true
		case <-time.After(5 * time.Second):
			t.Fatalf("collector received %v over gRPC, want traces, metrics, and logs", received)
		}
	}
}

// The three collectors share one channel; a service per type because the OTLP
// export RPCs all have the same method name.
type traceCollector struct {
	coltracepb.UnimplementedTraceServiceServer
	exported chan string
}

func (c traceCollector) Export(
	_ context.Context, _ *coltracepb.ExportTraceServiceRequest,
) (*coltracepb.ExportTraceServiceResponse, error) {
	c.exported <- "traces"
	return &coltracepb.ExportTraceServiceResponse{}, nil
}

type metricCollector struct {
	colmetricpb.UnimplementedMetricsServiceServer
	exported chan string
}

func (c metricCollector) Export(
	_ context.Context, _ *colmetricpb.ExportMetricsServiceRequest,
) (*colmetricpb.ExportMetricsServiceResponse, error) {
	c.exported <- "metrics"
	return &colmetricpb.ExportMetricsServiceResponse{}, nil
}

type logCollector struct {
	collogspb.UnimplementedLogsServiceServer
	exported chan string
}

func (c logCollector) Export(
	_ context.Context, _ *collogspb.ExportLogsServiceRequest,
) (*collogspb.ExportLogsServiceResponse, error) {
	c.exported <- "logs"
	return &collogspb.ExportLogsServiceResponse{}, nil
}
