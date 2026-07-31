package billingwebhook

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// This test protects the producer contract: the Go model must keep rendering
// the canonical protocol fixture's structure, and the persisted digest must be
// over the exact bytes that delivery later signs.
func TestCanonicalEventV2MatchesCutoverFixtureAndDigest(t *testing.T) {
	_, source, _, _ := runtime.Caller(0)
	fixturePath := filepath.Join(filepath.Dir(source), "..", "..", "..", "..", "protocol", "fixtures", "billing-state-webhook", "v2", "events", "cutover-completed.json")
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	cutover := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	created := cutover.Add(time.Second)
	previous := int64(41)
	event := EventV2{EventID: "event-cutover-001", EventType: EventTypeAuthorityCutoverCompleted,
		BillingCustomerID: "customer-001", SnapshotVersion: 42, PreviousSnapshotVersion: &previous,
		OccurredAt: cutover, CreatedAt: created, CorrelationID: "correlation-cutover-001",
		ChangedEntitlements: []ChangedEntitlement{}, Authority: EventAuthority{AuthorityEpoch: 5,
			AuthorityKind: "mosaic", TransitionState: "stabilizing", CutoverAt: &cutover,
			SnapshotAuthorityDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			Scope:                   AuthorityScope{ProjectID: "project-001", EnvironmentID: "env-production", ApplicationID: "app-ios", Platform: "ios"}}}
	body, digest, err := CanonicalEventV2(event)
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if err = json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(fixture, &want); err != nil {
		t.Fatal(err)
	}
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if !bytes.Equal(gotJSON, wantJSON) {
		t.Fatalf("canonical event mismatch\n got %s\nwant %s", gotJSON, wantJSON)
	}
	sum := sha256.Sum256(body)
	if !bytes.Equal(digest, sum[:]) {
		t.Fatalf("digest %x does not cover stored bytes", digest)
	}
	bodyAgain, digestAgain, err := CanonicalEventV2(event)
	if err != nil || !bytes.Equal(body, bodyAgain) || !bytes.Equal(digest, digestAgain) {
		t.Fatalf("render is not deterministic: %v", err)
	}
}

func TestCanonicalEventV2RejectsAuthorityBindingMismatch(t *testing.T) {
	now := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	_, _, err := CanonicalEventV2(EventV2{EventID: "event-1", EventType: EventTypeAuthorityRollbackCompleted,
		BillingCustomerID: "customer-1", SnapshotVersion: 1, OccurredAt: now, CreatedAt: now, CorrelationID: "transition-1",
		ChangedEntitlements: []ChangedEntitlement{}, Authority: EventAuthority{AuthorityEpoch: 2,
			AuthorityKind: "mosaic", TransitionState: "rolled_back", CutoverAt: &now,
			SnapshotAuthorityDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			Scope:                   AuthorityScope{ProjectID: "project-1", EnvironmentID: "environment-1", ApplicationID: "app-1", Platform: "ios"}}})
	if err == nil {
		t.Fatal("rollback event with Mosaic authority was accepted")
	}
}

// These cases protect the producer boundary from persisting bytes that the
// owned JSON Schema rejects. The database cannot repair an invalid canonical
// body after its digest has been committed.
func TestCanonicalEventV2RejectsSchemaInvariantViolations(t *testing.T) {
	now := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	previous := int64(8)
	valid := EventV2{EventID: "event-1", EventType: EventTypeEntitlementsChanged,
		BillingCustomerID: "customer-1", SnapshotVersion: 9, PreviousSnapshotVersion: &previous,
		OccurredAt: now, CreatedAt: now.Add(time.Second), CorrelationID: "correlation-1",
		ChangedEntitlements: []ChangedEntitlement{{EntitlementKey: "premium_access", PreviousState: "inactive", CurrentState: "active"}},
		Authority: EventAuthority{AuthorityEpoch: 2, AuthorityKind: "mosaic", TransitionState: "stabilizing", CutoverAt: &now,
			SnapshotAuthorityDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			Scope:                   AuthorityScope{ProjectID: "project-1", EnvironmentID: "environment-1", ApplicationID: "application-1", Platform: "ios"}}}

	tests := []struct {
		name   string
		mutate func(*EventV2)
	}{
		{"invalid id", func(e *EventV2) { e.EventID = "bad id" }},
		{"invalid platform", func(e *EventV2) { e.Authority.Scope.Platform = "web" }},
		{"negative epoch", func(e *EventV2) { e.Authority.AuthorityEpoch = -1 }},
		{"epoch above schema maximum", func(e *EventV2) { e.Authority.AuthorityEpoch = maxContractInteger + 1 }},
		{"negative previous version", func(e *EventV2) { value := int64(-1); e.PreviousSnapshotVersion = &value }},
		{"snapshot above schema maximum", func(e *EventV2) { e.SnapshotVersion = maxContractInteger + 1 }},
		{"invalid entitlement key", func(e *EventV2) { e.ChangedEntitlements[0].EntitlementKey = "Premium Access" }},
		{"invalid previous state", func(e *EventV2) { e.ChangedEntitlements[0].PreviousState = "trial" }},
		{"absent current state", func(e *EventV2) { e.ChangedEntitlements[0].CurrentState = "absent" }},
		{"too many entitlement changes", func(e *EventV2) {
			e.ChangedEntitlements = make([]ChangedEntitlement, 201)
			for index := range e.ChangedEntitlements {
				e.ChangedEntitlements[index] = ChangedEntitlement{EntitlementKey: "key", PreviousState: "absent", CurrentState: "inactive"}
			}
		}},
		{"invalid occurrence timestamp", func(e *EventV2) { e.OccurredAt = time.Time{} }},
		{"invalid cutover timestamp", func(e *EventV2) {
			value := time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
			e.Authority.CutoverAt = &value
		}},
		{"uppercase digest", func(e *EventV2) {
			e.Authority.SnapshotAuthorityDigest = "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			event := valid
			event.ChangedEntitlements = append([]ChangedEntitlement(nil), valid.ChangedEntitlements...)
			test.mutate(&event)
			if _, _, err := CanonicalEventV2(event); err == nil {
				t.Fatal("invalid event was accepted")
			}
		})
	}
}

func TestCanonicalEventV2AbsentBaselineIsRollbackOnly(t *testing.T) {
	now := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	previous := int64(4)
	event := EventV2{EventID: "event-rollback", EventType: EventTypeAuthorityRollbackCompleted,
		BillingCustomerID: "customer-1", SnapshotVersion: 0, PreviousSnapshotVersion: &previous,
		OccurredAt: now, CreatedAt: now, CorrelationID: "rollback-1", ChangedEntitlements: []ChangedEntitlement{},
		Authority: EventAuthority{AuthorityEpoch: 6, AuthorityKind: "source_rollback", TransitionState: "rolled_back", CutoverAt: &now,
			SnapshotAuthorityDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			Scope:                   AuthorityScope{ProjectID: "project-1", EnvironmentID: "environment-1", ApplicationID: "application-1", Platform: "android"}}}
	if _, _, err := CanonicalEventV2(event); err != nil {
		t.Fatalf("valid absent rollback baseline rejected: %v", err)
	}
	event.EventType = EventTypeAuthorityCutoverCompleted
	event.Authority.AuthorityKind = "mosaic"
	event.Authority.TransitionState = "stabilizing"
	if _, _, err := CanonicalEventV2(event); err == nil {
		t.Fatal("zero-version non-rollback event was accepted")
	}
	event.EventType = EventTypeAuthorityRollbackCompleted
	event.Authority.AuthorityKind = "source_rollback"
	event.Authority.TransitionState = "rolled_back"
	event.PreviousSnapshotVersion = nil
	if _, _, err := CanonicalEventV2(event); err == nil {
		t.Fatal("absent rollback baseline without replaced version was accepted")
	}
}
