// Package jobtelemetry stamps the identity of a background job onto the log
// context the worker already carries.
//
// Worker log lines used to name only the job family and the worker id, so an
// operator reading "background job finished, failed=true" could not tell which
// job, which tenant, or which trace it belonged to — the three things every
// worker runbook step needs. Each job family calls Annotate once it knows what
// it leased; the worker's own completion line then carries the same fields
// because it reads the logger back out of the job context.
package jobtelemetry

import (
	"context"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/trace"
)

// Identity is the safe identity of one background job. Every field is an
// internal identifier: no personal data, no credentials, no payload content.
type Identity struct {
	JobID         string
	JobKind       string
	ProjectID     string
	EnvironmentID string
	// ResourceID is the domain object the job acts on (an Experiment, a
	// provider connection) when the job family has one.
	ResourceID string
}

// Annotate adds the job identity, and the active trace id when a span is
// recording, to the logger carried by ctx. It is a no-op when the context has
// no Mosaic logger, so unit tests calling a service directly are unaffected.
func Annotate(ctx context.Context, identity Identity) {
	logger := zerolog.Ctx(ctx)
	if logger == nil || logger.GetLevel() == zerolog.Disabled {
		return
	}
	logger.UpdateContext(func(logContext zerolog.Context) zerolog.Context {
		logContext = appendField(logContext, "job_id", identity.JobID)
		logContext = appendField(logContext, "job_kind", identity.JobKind)
		logContext = appendField(logContext, "project_id", identity.ProjectID)
		logContext = appendField(logContext, "environment_id", identity.EnvironmentID)
		logContext = appendField(logContext, "resource_id", identity.ResourceID)
		if span := trace.SpanContextFromContext(ctx); span.IsValid() {
			logContext = appendField(logContext, "trace_id", span.TraceID().String())
		}
		return logContext
	})
}

func appendField(logContext zerolog.Context, key, value string) zerolog.Context {
	if value == "" {
		return logContext
	}
	return logContext.Str(key, value)
}
