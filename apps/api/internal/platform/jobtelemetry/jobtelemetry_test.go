package jobtelemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"
)

// The worker writes its completion line through the logger it reads back out of
// the job context, because only the job family knows which job it leased. That
// read-back is the whole mechanism: if Annotate wrote to a copy instead of the
// logger stored in the context, worker logs would silently lose the job,
// tenant, and trace identifiers every runbook step depends on, and nothing else
// would fail. This test pins the contract end to end in the worker's own shape.
func TestAnnotateReachesTheLoggerTheWorkerReadsBack(t *testing.T) {
	var output bytes.Buffer
	logger := zerolog.New(&output).With().Str("job_family", "analytics").Logger()
	jobContext := logger.WithContext(context.Background())

	// Stands in for a job family: it annotates what it leased.
	Annotate(jobContext, Identity{
		JobID: "analytics_job_000007", JobKind: "aggregation",
		ProjectID: "project_000001", EnvironmentID: "env_000003",
	})

	// Stands in for the worker's completion line.
	zerolog.Ctx(jobContext).Info().Msg("background job finished")

	var line map[string]any
	if err := json.Unmarshal(output.Bytes(), &line); err != nil {
		t.Fatalf("worker log line was not JSON: %v (%s)", err, output.String())
	}
	for key, want := range map[string]string{
		"job_family":     "analytics",
		"job_id":         "analytics_job_000007",
		"job_kind":       "aggregation",
		"project_id":     "project_000001",
		"environment_id": "env_000003",
		"message":        "background job finished",
	} {
		if line[key] != want {
			t.Fatalf("log field %q = %v, want %q (line: %s)", key, line[key], want, output.String())
		}
	}
	// A job family with no Environment must not emit an empty field that reads
	// as "the environment is blank" in a log query.
	if _, present := line["resource_id"]; present {
		t.Fatalf("an unset identity field was emitted: %s", output.String())
	}
}
