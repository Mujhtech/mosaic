package logging

import (
	"fmt"
	"io"
	"time"

	"github.com/rs/zerolog"
)

func New(level string, format string, output io.Writer) (zerolog.Logger, error) {
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

	return zerolog.New(writer).
		Level(parsedLevel).
		With().
		Timestamp().
		Logger(), nil
}
