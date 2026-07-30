package logging

import (
	"bytes"
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/rs/zerolog"
	otellog "go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/log/global"
	sdklog "go.opentelemetry.io/otel/sdk/log"
)

// recordingExporter stands in for a collector so a test can assert on what
// would go over the wire.
type recordingExporter struct {
	mutex   sync.Mutex
	records []sdklog.Record
}

func (e *recordingExporter) Export(_ context.Context, records []sdklog.Record) error {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	for _, record := range records {
		e.records = append(e.records, record.Clone())
	}
	return nil
}

func (e *recordingExporter) Shutdown(context.Context) error   { return nil }
func (e *recordingExporter) ForceFlush(context.Context) error { return nil }

func (e *recordingExporter) collected() []sdklog.Record {
	e.mutex.Lock()
	defer e.mutex.Unlock()
	return append([]sdklog.Record(nil), e.records...)
}

// installRecordingProvider points the global logger provider at an exporter for
// the duration of a test, restoring a no-op provider afterwards so a test that
// asserts nothing is exported cannot be polluted by an earlier one.
func installRecordingProvider(t *testing.T) *recordingExporter {
	t.Helper()
	exporter := &recordingExporter{}
	provider := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewSimpleProcessor(exporter)))
	global.SetLoggerProvider(provider)
	t.Cleanup(func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Fatalf("shutdown recording provider: %v", err)
		}
		global.SetLoggerProvider(sdklog.NewLoggerProvider())
	})
	return exporter
}

func attributesOf(t *testing.T, record sdklog.Record) map[string]string {
	t.Helper()
	attributes := make(map[string]string)
	record.WalkAttributes(func(attribute otellog.KeyValue) bool {
		attributes[attribute.Key] = attribute.Value.String()
		return true
	})
	return attributes
}

// The exported record must carry the same structured fields as the local line.
// Shipping level and message alone would leave an operator back at the terminal
// they were trying not to open.
func TestExportingLoggerKeepsLocalStreamAndStructuredFields(t *testing.T) {
	exporter := installRecordingProvider(t)
	var local bytes.Buffer

	logger, err := NewExporting("info", "json", &local, "mosaic-api-test")
	if err != nil {
		t.Fatalf("build exporting logger: %v", err)
	}
	logger.Info().
		Str("project_id", "prj_123").
		Int("attempt", 3).
		Bool("retryable", true).
		Msg("published release")

	if !strings.Contains(local.String(), `"message":"published release"`) {
		t.Fatalf("local stream = %q, want the log line", local.String())
	}

	records := exporter.collected()
	if len(records) != 1 {
		t.Fatalf("exported %d records, want 1", len(records))
	}
	record := records[0]
	if body := record.Body().AsString(); body != "published release" {
		t.Fatalf("body = %q, want the message", body)
	}
	if record.Severity() != otellog.SeverityInfo1 {
		t.Fatalf("severity = %v, want info", record.Severity())
	}
	if record.Timestamp().IsZero() {
		t.Fatal("record has no timestamp")
	}

	attributes := attributesOf(t, record)
	for key, want := range map[string]string{
		"project_id": "prj_123",
		"attempt":    "3",
		"retryable":  "true",
	} {
		if attributes[key] != want {
			t.Fatalf("attribute %s = %q, want %q", key, attributes[key], want)
		}
	}
	// Level, time, and message are modelled as record structure, so repeating
	// them as attributes would duplicate them in every backend.
	for _, key := range []string{zerolog.LevelFieldName, zerolog.TimestampFieldName, zerolog.MessageFieldName} {
		if _, duplicated := attributes[key]; duplicated {
			t.Fatalf("structural field %s was also exported as an attribute", key)
		}
	}
}

func TestNonExportingLoggerStaysLocal(t *testing.T) {
	exporter := installRecordingProvider(t)
	var local bytes.Buffer

	logger, err := New("info", "json", &local)
	if err != nil {
		t.Fatalf("build logger: %v", err)
	}
	logger.Info().Msg("published release")

	if local.Len() == 0 {
		t.Fatal("local stream is empty")
	}
	if records := exporter.collected(); len(records) != 0 {
		t.Fatalf("exported %d records, want none from a local-only logger", len(records))
	}
}

// Console format renders for humans at the local writer, but the exported
// record must still be built from the structured JSON.
func TestExportingLoggerKeepsFieldsInConsoleFormat(t *testing.T) {
	exporter := installRecordingProvider(t)
	var local bytes.Buffer

	logger, err := NewExporting("debug", "console", &local, "mosaic-api-test")
	if err != nil {
		t.Fatalf("build exporting logger: %v", err)
	}
	logger.Warn().Str("project_id", "prj_123").Msg("slow publish")

	records := exporter.collected()
	if len(records) != 1 {
		t.Fatalf("exported %d records, want 1", len(records))
	}
	if records[0].Severity() != otellog.SeverityWarn1 {
		t.Fatalf("severity = %v, want warn", records[0].Severity())
	}
	if attributes := attributesOf(t, records[0]); attributes["project_id"] != "prj_123" {
		t.Fatalf("attributes = %#v, want the project id", attributes)
	}
}

func TestSeverityMapsAcrossLevels(t *testing.T) {
	for level, want := range map[zerolog.Level]otellog.Severity{
		zerolog.TraceLevel: otellog.SeverityTrace1,
		zerolog.DebugLevel: otellog.SeverityDebug1,
		zerolog.InfoLevel:  otellog.SeverityInfo1,
		zerolog.WarnLevel:  otellog.SeverityWarn1,
		zerolog.ErrorLevel: otellog.SeverityError1,
		zerolog.FatalLevel: otellog.SeverityFatal1,
		zerolog.PanicLevel: otellog.SeverityFatal2,
		zerolog.NoLevel:    otellog.SeverityUndefined,
	} {
		if got := severityOf(level); got != want {
			t.Fatalf("severity of %s = %v, want %v", level, got, want)
		}
	}
}

// A line the writer cannot parse has already reached the local stream. It must
// not surface as a write error, which zerolog would report on stderr for every
// subsequent line.
func TestWriterDropsUnparsableLinesWithoutError(t *testing.T) {
	installRecordingProvider(t)
	writer := otlpWriter{scope: "mosaic-api-test"}
	line := []byte("not json\n")
	written, err := writer.WriteLevel(zerolog.InfoLevel, line)
	if err != nil || written != len(line) {
		t.Fatalf("write = %d, %v; want %d and no error", written, err, len(line))
	}
}
