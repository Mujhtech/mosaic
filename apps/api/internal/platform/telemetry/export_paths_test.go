package telemetry_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/logging"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/telemetry"
	"go.opentelemetry.io/otel"
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
