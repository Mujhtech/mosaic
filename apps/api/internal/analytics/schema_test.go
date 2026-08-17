package analytics

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

type batchVersionRepository struct{ Repository }

// Ingest authenticates before it validates events, so the fake must answer
// the auth and settings reads that now precede the per-event rejections these
// tests assert.
func (batchVersionRepository) AuthenticateSDKKey(context.Context, string) (Scope, error) {
	return Scope{APIKeyID: "key_test", ProjectID: "project_test", EnvironmentID: "environment_test", ApplicationID: "application_test"}, nil
}

func (batchVersionRepository) Settings(context.Context, string, string) (Settings, error) {
	return Settings{CollectionEnabled: true}, nil
}

func protocolPath(t *testing.T, parts ...string) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../../"))
	return filepath.Join(append([]string{root}, parts...)...)
}

func compileCanonicalValidator(t *testing.T) *SchemaValidator {
	t.Helper()
	schema, err := os.Open(protocolPath(t, "protocol/schema/analytics-event/v2/event.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer schema.Close()
	validator, err := CompileSchemaValidator(schema)
	if err != nil {
		t.Fatal(err)
	}
	return validator
}

func TestCanonicalAnalyticsEventFixturesCompileWithBackendValidator(t *testing.T) {
	validator := compileCanonicalValidator(t)
	fixtures, err := filepath.Glob(protocolPath(t, "protocol/fixtures/analytics-event/v2/*.json"))
	if err != nil || len(fixtures) == 0 {
		t.Fatalf("find canonical fixtures: %v", err)
	}
	for _, fixture := range fixtures {
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

func TestExperimentAttributionTupleIsClosed(t *testing.T) {
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

// There is exactly one Analytics Event contract version (ADR-0028). A batch or
// event claiming the deleted v1 — or any other version — must be rejected
// whole, exactly as an unknown version is.
func TestIngestionRejectsDeletedAndUnknownContractVersions(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	service := NewService(batchVersionRepository{}, nil)
	service.now = func() time.Time { return now }
	for _, test := range []struct {
		name, batchVersion, eventVersion string
	}{
		{"batch claiming the deleted v1 contract", "1", EventSchemaVersion},
		{"event claiming the deleted v1 schema", ContractVersion, "1"},
		{"batch claiming an unknown contract", "3", EventSchemaVersion},
	} {
		t.Run(test.name, func(t *testing.T) {
			event := json.RawMessage(`{"eventId":"event_1","eventSchemaVersion":"` + test.eventVersion + `"}`)
			_, err := service.Ingest(t.Context(), "unused", Batch{ContractVersion: test.batchVersion, BatchID: "batch_1", SentAt: now.Format("2006-01-02T15:04:05.000Z"), Events: []json.RawMessage{event}})
			if !errors.Is(err, ErrInvalidBatch) {
				t.Fatalf("deleted/unknown contract version error = %v, want invalid batch", err)
			}
		})
	}
}

func TestPublicIngestionRejectsProviderAuthority(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 8, 0, time.UTC)
	event := validPlacementEvent(now)
	event.Authority = "provider_verified"
	if _, code := ValidateEvent(event, now, now); code != "authority_not_allowed" {
		t.Fatalf("expected authority_not_allowed, got %q", code)
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
	validator := compileCanonicalValidator(t)
	service := NewService(batchVersionRepository{}, nil, validator)

	fixtures, err := filepath.Glob(protocolPath(t, "protocol/fixtures/analytics-event/v2/invalid/*.json"))
	if err != nil {
		t.Fatal(err)
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
