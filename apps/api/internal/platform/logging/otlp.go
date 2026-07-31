package logging

import (
	"context"
	"encoding/json"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/log/global"
)

// otlpWriter forwards every emitted log line to the OpenTelemetry Logs
// pipeline, in addition to the local stream it is teed with.
//
// It sits at the writer end of zerolog rather than at a hook because a zerolog
// hook cannot read the fields already attached to an event. The writer receives
// the finished JSON object, so the exported record keeps every structured field
// the local line has — which is the whole point of shipping logs rather than
// reading them out of a terminal.
type otlpWriter struct {
	// scope names the instrumentation scope on every exported record. It is
	// resolved to a logger per write because the global provider is installed
	// by telemetry.New, which runs after the logger exists; the global package
	// delegates to a no-op until then.
	scope string
}

// Fields the OTLP record models directly rather than as attributes, so a
// backend can filter on severity, time, and body without knowing zerolog's
// field names.
var structuralFields = map[string]struct{}{
	zerolog.LevelFieldName:     {},
	zerolog.TimestampFieldName: {},
	zerolog.MessageFieldName:   {},
}

func (w otlpWriter) Write(line []byte) (int, error) {
	return w.WriteLevel(zerolog.NoLevel, line)
}

func (w otlpWriter) WriteLevel(level zerolog.Level, line []byte) (int, error) {
	// A malformed line still reached the local stream, which is the record of
	// truth. Dropping it here keeps a logging problem from becoming a request
	// failure, and reporting an error would make zerolog complain on stderr for
	// every line.
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(line, &fields); err != nil {
		return len(line), nil
	}

	var record log.Record
	record.SetObservedTimestamp(time.Now())
	record.SetSeverity(severityOf(level))
	record.SetSeverityText(level.String())
	record.SetBody(log.StringValue(decodeString(fields[zerolog.MessageFieldName])))
	if timestamp, ok := decodeTimestamp(fields[zerolog.TimestampFieldName]); ok {
		record.SetTimestamp(timestamp)
	}

	attributes := make([]log.KeyValue, 0, len(fields))
	for key, raw := range fields {
		if _, structural := structuralFields[key]; structural {
			continue
		}
		attributes = append(attributes, attributeOf(key, raw))
	}
	if len(attributes) > 0 {
		record.AddAttributes(attributes...)
	}

	// The batch processor owns delivery from here: Emit hands the record off
	// without blocking on the collector, so an export stall cannot slow down
	// the request that produced the line.
	global.Logger(w.scope).Emit(context.Background(), record)
	return len(line), nil
}

// attributeOf preserves the JSON type of a field so a backend can range over
// numbers and filter on booleans. Objects and arrays keep their JSON encoding,
// which stays readable and avoids flattening nested context into new keys.
func attributeOf(key string, raw json.RawMessage) log.KeyValue {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return log.String(key, string(raw))
	}
	switch typed := value.(type) {
	case string:
		return log.String(key, typed)
	case bool:
		return log.Bool(key, typed)
	case float64:
		// JSON has one number type; keeping integers integral matters for IDs
		// and counts, which are most of Mosaic's numeric fields.
		if typed == float64(int64(typed)) {
			return log.Int64(key, int64(typed))
		}
		return log.Float64(key, typed)
	case nil:
		return log.String(key, "")
	default:
		return log.String(key, string(raw))
	}
}

func decodeString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func decodeTimestamp(raw json.RawMessage) (time.Time, bool) {
	if len(raw) == 0 {
		return time.Time{}, false
	}
	timestamp, err := time.Parse(time.RFC3339, decodeString(raw))
	if err != nil {
		return time.Time{}, false
	}
	return timestamp, true
}

// severityOf maps zerolog levels onto the OpenTelemetry severity range so
// backends that alert on severity see the same picture as a reader of the local
// stream. Panic sits above fatal because it carries a stack unwind with it.
func severityOf(level zerolog.Level) log.Severity {
	switch level {
	case zerolog.TraceLevel:
		return log.SeverityTrace1
	case zerolog.DebugLevel:
		return log.SeverityDebug1
	case zerolog.InfoLevel:
		return log.SeverityInfo1
	case zerolog.WarnLevel:
		return log.SeverityWarn1
	case zerolog.ErrorLevel:
		return log.SeverityError1
	case zerolog.FatalLevel:
		return log.SeverityFatal1
	case zerolog.PanicLevel:
		return log.SeverityFatal2
	default:
		return log.SeverityUndefined
	}
}
