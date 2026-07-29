package billingaccess

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// The canonical serialization is the one thing five implementations must agree
// on byte for byte: an SDK recomputes contentDigest over what it received, and a
// disagreement is reported to a user as cache corruption rather than as the
// serialization bug it is. These vectors are the shared cross-implementation
// reference set, so this test is the Go side of that agreement.

type digestVectorFile struct {
	Vectors []struct {
		ID string `json:"id"`
		// The vector payloads are already reduced: the excluded member
		// (contentDigest or checksum) has been removed by the generator, so the
		// digest is taken over the payload exactly as given.
		Payload   map[string]any `json:"payload"`
		Canonical string         `json:"canonicalSerialization"`
		Digest    string         `json:"digest"`
		ByteLen   int            `json:"canonicalByteLength"`
	} `json:"vectors"`
}

func repositoryFile(t *testing.T, relative string) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for range 8 {
		candidate := filepath.Join(directory, relative)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	t.Fatalf("could not locate %s from the test working directory", relative)
	return ""
}

func TestCanonicalSerializationMatchesReferenceVectors(t *testing.T) {
	path := repositoryFile(t, "packages/test-fixtures/src/entitlement-snapshot-digest-vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var file digestVectorFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Vectors) == 0 {
		t.Fatal("the reference vector file carried no vectors")
	}

	checked := 0
	for _, vector := range file.Vectors {
		if vector.Digest == "" || vector.Canonical == "" {
			t.Fatalf("%s: the reference vector carried no digest or canonical form", vector.ID)
		}
		encoded, err := CanonicalJSON(vector.Payload)
		if err != nil {
			t.Fatalf("%s: %v", vector.ID, err)
		}
		if string(encoded) != vector.Canonical {
			t.Fatalf("%s: canonical form\n got %s\nwant %s", vector.ID, encoded, vector.Canonical)
		}
		if vector.ByteLen != 0 && len(encoded) != vector.ByteLen {
			t.Fatalf("%s: canonical length %d, want %d", vector.ID, len(encoded), vector.ByteLen)
		}
		// contentDigest is taken over the same bytes with the excluded member
		// already absent, so the two derivations must agree.
		digest, err := contentDigest(vector.Payload, "contentDigest")
		if err != nil {
			t.Fatalf("%s: %v", vector.ID, err)
		}
		if digest != vector.Digest {
			t.Fatalf("%s: digest %s, want %s", vector.ID, digest, vector.Digest)
		}
		checked++
	}
	if checked < len(file.Vectors) {
		t.Fatalf("only %d of %d vectors were checked", checked, len(file.Vectors))
	}
}

func instant(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed.UTC()
}

func at(value string) *time.Time {
	parsed := instant(value)
	return &parsed
}

func sampleView() SnapshotView {
	return SnapshotView{
		SnapshotID: "ces_1", ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1",
		SnapshotVersion: 4, PreviousSnapshotVersion: 3, RuleVersion: 1,
		ComputedAt: instant("2026-07-28T11:59:58Z"), AsOf: instant("2026-07-28T11:59:58Z"),
		Checksum: []byte("0123456789abcdef0123456789abcdef"), ChangeReason: "entitlements_changed",
		Entries: []SnapshotEntry{
			{
				EntitlementID: "ent_pro", EntitlementKey: "pro", State: "active",
				EffectiveStart: at("2026-07-01T09:00:00Z"), EffectiveEnd: at("2026-08-01T09:00:00Z"),
				EndKnown: true, SourceCount: 1, UncertaintyReason: "none",
				ExplanationCode: "subscription_active", SourceIDs: []string{"esr_1"},
			},
			{
				EntitlementID: "ent_beta", EntitlementKey: "beta", State: "unknown",
				EndKnown: true, SourceCount: 0, UncertaintyReason: "identity_unresolved",
				ExplanationCode: "unresolved_evidence",
			},
		},
		Sources: []SnapshotSource{{
			RowID: "esr_1", EntitlementID: "ent_pro", PurchaseLineageID: "plin_1",
			ProductID: "prod_pro", GrantVersionID: "pegv_1", SubscriptionInstanceID: "sub_1",
			SourceSnapshotID: "bss_1", StorePlatform: "app_store", SourceType: "active_subscription",
			SourceState: "active", SourceStart: at("2026-07-01T09:00:00Z"),
			SourceEnd: at("2026-08-01T09:00:00Z"), EndKnown: true, UncertaintyReason: "none",
			ExplanationCode: "subscription_active",
		}},
		Projection: ProjectionStatus{State: ProjectionCurrent, LastProjectedAt: instant("2026-07-28T11:59:58Z")},
	}
}

// The contract's invalid-fixture set names these three defects explicitly:
// entries out of canonical order, a source count that disagrees with the source
// list, and an entry referencing a source the snapshot does not carry. All three
// are producer bugs a schema check alone would not catch here, because the
// producer is this code.
func TestSnapshotRecordSatisfiesStructuralInvariants(t *testing.T) {
	record, err := SnapshotRecord(sampleView(), instant("2026-07-28T12:00:00Z"),
		DefaultFreshness(), "corr-1", nil)
	if err != nil {
		t.Fatal(err)
	}

	entries, _ := record["entries"].([]map[string]any)
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}
	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		keys = append(keys, entry["entitlementKey"].(string))
	}
	if !sort.StringsAreSorted(keys) {
		t.Fatalf("entries are not ascending by entitlementKey: %v", keys)
	}

	sources, _ := record["sources"].([]map[string]any)
	known := map[string]bool{}
	for _, source := range sources {
		known[source["sourceId"].(string)] = true
	}
	for _, entry := range entries {
		ids, _ := entry["sourceIds"].([]string)
		if entry["sourceCount"].(int) != len(ids) {
			t.Fatalf("entry %v reports sourceCount %v with %d source ids",
				entry["entitlementKey"], entry["sourceCount"], len(ids))
		}
		for _, id := range ids {
			if !known[id] {
				t.Fatalf("entry %v references source %q that the snapshot does not carry",
					entry["entitlementKey"], id)
			}
		}
	}

	// An unknown entry must remain explainable, and its uncertainty must carry
	// an instant: a definite state carries no `since`, so a non-definite one
	// that also lacks it is unreadable.
	unknown := entries[0]
	if unknown["entitlementKey"] != "beta" {
		unknown = entries[1]
	}
	uncertainty, ok := unknown["uncertainty"].(map[string]any)
	if !ok || uncertainty["reason"] == "none" || uncertainty["since"] == nil {
		t.Fatalf("an unknown entry carried no definite uncertainty: %v", unknown["uncertainty"])
	}

	// The digest must cover the binding fields, so a snapshot cannot be
	// accepted into another customer's cache.
	digest, _ := record["contentDigest"].(string)
	moved := sampleView()
	moved.CustomerID = "bcu_2"
	movedRecord, err := SnapshotRecord(moved, instant("2026-07-28T12:00:00Z"), DefaultFreshness(), "corr-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	if movedRecord["contentDigest"] == digest {
		t.Fatal("the content digest did not change when the snapshot named a different customer")
	}
}

// A narrowed request must not leave a source behind that no entry references —
// the contract's orphan-source rejection.
func TestNarrowedSnapshotCarriesNoOrphanSources(t *testing.T) {
	record, err := SnapshotRecord(sampleView(), instant("2026-07-28T12:00:00Z"),
		DefaultFreshness(), "corr-1", []string{"beta"})
	if err != nil {
		t.Fatal(err)
	}
	entries, _ := record["entries"].([]map[string]any)
	if len(entries) != 1 || entries[0]["entitlementKey"] != "beta" {
		t.Fatalf("narrowing returned %d entries", len(entries))
	}
	sources, _ := record["sources"].([]map[string]any)
	if len(sources) != 0 {
		t.Fatalf("narrowing left %d sources no entry references", len(sources))
	}
}

// The combined horizon — validity plus bounded grace — may never exceed thirty
// days. Past that a device that never reconnects holds an entitlement forever,
// which is the failure the whole bounded-grace policy exists to prevent.
func TestFreshnessHorizonIsBounded(t *testing.T) {
	bounded := Freshness{
		RefreshAfter: time.Hour,
		ValidFor:     25 * 24 * time.Hour,
		StaleGrace:   25 * 24 * time.Hour,
	}.Bounded()

	if bounded.ValidFor+bounded.StaleGrace > MaxCombinedHorizon {
		t.Fatalf("combined horizon %v exceeds the contract maximum", bounded.ValidFor+bounded.StaleGrace)
	}
	if bounded.ValidFor != 25*24*time.Hour {
		t.Fatalf("validity was shortened to %v; the grace window should absorb the overflow", bounded.ValidFor)
	}
	if bounded.RefreshAfter > bounded.ValidFor {
		t.Fatal("refreshAfter is later than validUntil")
	}
}

// The source id must be stable across snapshots and derived from the source's
// identity rather than from a per-generation row or a fact.
func TestSourceIdentityIsStableAndDerivedFromIdentity(t *testing.T) {
	first := SourceIdentity("plin_1", "prd_pro", "pegv_1")
	second := SourceIdentity("plin_1", "prd_pro", "pegv_1")
	if first != second {
		t.Fatal("source identity is not deterministic")
	}
	if SourceIdentity("plin_1", "prd_pro", "pegv_2") == first {
		t.Fatal("a different grant version produced the same source identity")
	}
	if SourceIdentity("plin_1", "prd_other", "pegv_1") == first {
		t.Fatal("a different Mosaic Product produced the same source identity")
	}
	sum := sha256.Sum256([]byte("unrelated"))
	if first == hex.EncodeToString(sum[:]) {
		t.Fatal("source identity collided with an unrelated digest")
	}
}
