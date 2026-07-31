package billingmigration

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// The operator API and generated dashboard client share these exact wire
// names. This catches the Go default of exporting PascalCase fields or hiding
// evidence digests while OpenAPI promises lower-camel, closed records.
func TestOperationalRecordsUseClosedLowerCamelJSON(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	values := []any{
		CutoverProposal{ProposalID: "proposal", ProposedAt: now, ExpiresAt: now.Add(time.Hour)},
		MigrationCheckpoint{CheckpointID: "checkpoint", CheckpointDigest: FormatDigest(make([]byte, 32)), CohortDigest: FormatDigest(make([]byte, 32)), CreatedAt: now},
		CompletionPrerequisites{ProgramID: "program", ProjectID: "private-project", StabilizationEndsAt: now, RollbackWindowEndsAt: now},
		CompletionReport{ReportID: "report", ProgramID: "program", ProjectID: "private-project", CompletedAt: now},
		CredentialRemoval{RemovalID: "removal", ProjectID: "private-project", RemovedAt: now},
		LegalHoldProposal{ProposalID: "hold-proposal", ProjectID: "private-project", ProposedAt: now, ExpiresAt: now.Add(time.Hour)},
		LegalHold{HoldID: "hold", ProjectID: "private-project", CommandedAt: now},
		Redelivery{ID: "redelivery", IdempotencyKey: "private-key", CreatedAt: now},
		RepairPreview{PreviewID: "repair-preview", CreatedAt: now, ExpiresAt: now.Add(time.Hour)},
		RepairExecution{ExecutionID: "repair-execution", Status: "pending", ExecutedAt: now},
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("marshal operational records: %v", err)
	}
	wire := string(encoded)
	for _, forbidden := range []string{`"ProposedAt"`, `"ExpiresAt"`, `"CheckpointDigest"`, `"ProjectID"`, `"IdempotencyKey"`, "private-project", "private-key"} {
		if strings.Contains(wire, forbidden) {
			t.Fatalf("wire contains forbidden field/value %q: %s", forbidden, wire)
		}
	}
	for _, required := range []string{`"proposedAt"`, `"expiresAt"`, `"checkpointDigest"`, `"cohortDigest"`, `"stabilizationEndsAt"`, `"reportId"`, `"removalId"`, `"holdId"`, `"redeliveryId"`, `"previewId"`, `"executionStatus":"pending"`} {
		if !strings.Contains(wire, required) {
			t.Fatalf("wire missing required field %q: %s", required, wire)
		}
	}
}
