package logging

import (
	"fmt"
	"io"
	"time"

	"github.com/rs/zerolog"
)

// New builds a logger that writes only to output. Telemetry's own SDK errors go
// to a logger built this way: a logger that exported would feed export failures
// back into the exporter that produced them.
func New(level string, format string, output io.Writer) (zerolog.Logger, error) {
	return build(level, format, output)
}

// NewExporting builds a logger that writes to output and also emits every
// record to the OpenTelemetry Logs pipeline under the given scope name. The
// local stream is never given up: it stays the record of truth when the
// collector is unreachable, and it is what `docker logs` and `kubectl logs`
// show.
//
// Records are exported through the global logger provider, which telemetry.New
// installs. Building this logger before that call is safe — records emitted in
// between go to the no-op provider and appear locally only.
func NewExporting(level string, format string, output io.Writer, scope string) (zerolog.Logger, error) {
	return build(level, format, output, otlpWriter{scope: scope})
}

func build(level string, format string, output io.Writer, extra ...io.Writer) (zerolog.Logger, error) {
	parsedLevel, err := zerolog.ParseLevel(level)
	if err != nil {
		return zerolog.Logger{}, fmt.Errorf("parse log level: %w", err)
	}

	writer := output
	if format == "console" {
		writer = zerolog.ConsoleWriter{
			Out:        output,
			TimeFormat: time.RFC3339,
		}
	}
	if len(extra) > 0 {
		// Every writer in the tee receives the same JSON object; console
		// rendering happens inside ConsoleWriter, so the OTLP writer still sees
		// structured fields even in development format.
		writer = zerolog.MultiLevelWriter(append([]io.Writer{writer}, extra...)...)
	}

	return zerolog.New(writer).
		Level(parsedLevel).
		With().
		Timestamp().
		Logger(), nil
}
