package analytics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

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
