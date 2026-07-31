package analytics

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type batchVersionRepository struct{ Repository }

func protocolPath(t *testing.T, parts ...string) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../"))
	return filepath.Join(append([]string{root}, parts...)...)
}

func TestCanonicalAnalyticsEventFixturesCompileWithBackendValidator(t *testing.T) {
	schema, err := os.Open(protocolPath(t, "protocol/schema/analytics-event/v1/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer schema.Close()
	validator, err := CompileSchemaValidator(schema)
	if err != nil {
		t.Fatal(err)
	}
	fixtures, err := filepath.Glob(protocolPath(t, "protocol/fixtures/analytics-event/v1/*.json"))
	if err != nil || len(fixtures) == 0 {
		t.Fatalf("find canonical fixtures: %v", err)
	}
	for _, fixture := range fixtures {
		fixture := fixture
		t.Run(filepath.Base(fixture), func(t *testing.T) {
			document, err := os.ReadFile(fixture)
			if err != nil {
				t.Fatal(err)
			}
			if err = validator.ValidateEvent(document); err != nil {
				t.Fatalf("backend rejected canonical fixture: %v", err)
			}
		})
	}
}

func TestCanonicalAnalyticsV2ExperimentFixturesAndClosedAttribution(t *testing.T) {
	v1, err := os.Open(protocolPath(t, "protocol/schema/analytics-event/v1/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer v1.Close()
	v2, err := os.Open(protocolPath(t, "protocol/schema/analytics-event/v2/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer v2.Close()
	validator, err := CompileSchemaValidators(v1, v2)
	if err != nil {
		t.Fatal(err)
	}
	fixtures, err := filepath.Glob(protocolPath(t, "protocol/fixtures/analytics-event/v2/*.json"))
	if err != nil || len(fixtures) == 0 {
		t.Fatalf("find v2 fixtures: %v", err)
	}
	for _, fixture := range fixtures {
		document, readErr := os.ReadFile(fixture)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err = validator.ValidateEvent(document); err != nil {
			t.Fatalf("%s rejected: %v", filepath.Base(fixture), err)
		}
	}
	document, err := os.ReadFile(protocolPath(t, "protocol/fixtures/analytics-event/v2/experiment-exposed.json"))
	if err != nil {
		t.Fatal(err)
	}
	var event Event
	if err = json.Unmarshal(document, &event); err != nil {
		t.Fatal(err)
	}
	event.Attribution.ExperimentVariantID = ""
	now := time.Date(2026, 7, 26, 12, 1, 2, 0, time.UTC)
	if _, code := ValidateEvent(event, now, now); code != "experiment_attribution_incomplete" {
		t.Fatalf("partial tuple code=%q", code)
	}
}

func TestIngestionRejectsBatchAndEventContractVersionMismatch(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	service := NewService(batchVersionRepository{}, nil)
	service.now = func() time.Time { return now }
	for _, test := range []struct {
		name, batchVersion, eventVersion string
	}{
		{"v1 batch carrying v2 event", ContractVersion, EventSchemaVersionV2},
		{"v2 batch carrying v1 event", ContractVersionV2, EventSchemaVersion},
	} {
		t.Run(test.name, func(t *testing.T) {
			event := json.RawMessage(`{"eventId":"event_1","eventSchemaVersion":"` + test.eventVersion + `"}`)
			_, err := service.Ingest(t.Context(), "unused", Batch{ContractVersion: test.batchVersion, BatchID: "batch_1", SentAt: now.Format("2006-01-02T15:04:05.000Z"), Events: []json.RawMessage{event}})
			if !errors.Is(err, ErrInvalidBatch) {
				t.Fatalf("mismatched batch/event versions error = %v, want invalid batch", err)
			}
		})
	}
}

func TestPublicIngestionRejectsProviderAuthority(t *testing.T) {
	document, err := os.ReadFile(protocolPath(t, "protocol/fixtures/analytics-event/v1/invalid/public-sdk-provider-authority.json"))
	if err != nil {
		t.Fatal(err)
	}
	var event Event
	if err = json.Unmarshal(document, &event); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 26, 12, 0, 8, 0, time.UTC)
	_, code := ValidateEvent(event, now, now)
	if code != "authority_not_allowed" {
		t.Fatalf("expected authority_not_allowed, got %q", code)
	}
	if strings.Contains(string(document), "applicationId") {
		t.Fatal("public event fixture must remain application-neutral")
	}
}

func TestSemanticValidationAcceptsCanonicalOpaqueApplicationUserIDs(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	for _, applicationUserID := range []string{"auth0|abc", "customer / paid", "顧客・一号"} {
		event := validPlacementEvent(now)
		event.Identity.ApplicationUserID = applicationUserID
		if _, code := ValidateEvent(event, now, now); code != "" {
			t.Fatalf("applicationUserId %q rejected with %q", applicationUserID, code)
		}
	}
}

func TestSemanticValidationPermanentlyRejectsSensitiveApplicationUserIDs(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	for _, applicationUserID := range []string{"person@example.com", "+1 (415) 555-0123", "Bearer reusable-secret"} {
		event := validPlacementEvent(now)
		event.Identity.ApplicationUserID = applicationUserID
		if _, code := ValidateEvent(event, now, now); code != "sensitive_value_rejected" {
			t.Fatalf("applicationUserId %q code = %q, want sensitive_value_rejected", applicationUserID, code)
		}
	}
}

func TestSemanticValidationAcceptsRolloutAttributedNoPaywall(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	event := validPlacementEvent(now)
	event.EventName = "placement_no_paywall"
	event.Payload = json.RawMessage(`{"finalOutcome":"no_paywall","decisionContractVersion":"1","assignmentKeyType":"installation","bucketingAlgorithm":"sha256_length_prefixed_v1","rolloutBucket":1742}`)
	if _, code := ValidateEvent(event, now, now); code != "" {
		t.Fatalf("schema-valid rollout no-paywall rejected with %q", code)
	}
}

func validPlacementEvent(now time.Time) Event {
	timestamp := now.Format("2006-01-02T15:04:05.000Z")
	return Event{
		EventID: "event_1", EventSchemaVersion: EventSchemaVersion, EventName: "placement_requested",
		OccurredAt: timestamp, QueuedAt: timestamp, Authority: "client_observed",
		Identity: Identity{InstallationID: "installation_1"}, SessionID: "session_1",
		Context:     EventContext{Platform: "ios", SDKFamily: "ios", SDKVersion: "1.0.0", ApplicationVersion: "1.0.0", Locale: "en-US"},
		Correlation: Correlation{PlacementRequestID: "placement_request_1"}, Attribution: Attribution{PlacementID: "placement_1"},
		Payload: json.RawMessage(`{"decisionContractVersion":"1"}`),
	}
}

// The Phase 6 ingestion defect was a contract divergence: the canonical
// semantic validator rejected these fixtures while the API's own runtime path
// accepted them, so Mosaic collected identifiers the contract forbids. This
// test drives every canonical invalid fixture through the exact validation the
// batch endpoint uses and requires a permanent-rejection code for each.
func TestCanonicalInvalidFixturesAreRejectedByTheIngestionPath(t *testing.T) {
	v1, err := os.Open(protocolPath(t, "protocol/schema/analytics-event/v1/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer v1.Close()
	v2, err := os.Open(protocolPath(t, "protocol/schema/analytics-event/v2/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer v2.Close()
	validator, err := CompileSchemaValidators(v1, v2)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(batchVersionRepository{}, nil, validator)

	fixtures := make([]string, 0, 8)
	for _, pattern := range []string{
		"protocol/fixtures/analytics-event/v1/invalid/*.json",
		"protocol/fixtures/analytics-event/v2/invalid/*.json",
	} {
		matched, globErr := filepath.Glob(protocolPath(t, pattern))
		if globErr != nil {
			t.Fatal(globErr)
		}
		fixtures = append(fixtures, matched...)
	}
	if len(fixtures) == 0 {
		t.Fatal("no canonical invalid fixtures found")
	}

	// Fixed clock inside the fixtures' validity window so a rejection is caused
	// by the contract violation under test, not by expiry.
	now := time.Date(2026, 7, 26, 12, 5, 0, 0, time.UTC)
	for _, fixture := range fixtures {
		t.Run(filepath.Base(fixture), func(t *testing.T) {
			document, readErr := os.ReadFile(fixture)
			if readErr != nil {
				t.Fatal(readErr)
			}
			_, code := service.ValidateRawEvent(document, now, now)
			if code == "" {
				t.Fatalf("canonical invalid fixture %s was accepted by the ingestion path", filepath.Base(fixture))
			}
			t.Logf("rejected with %s", code)
		})
	}
}
