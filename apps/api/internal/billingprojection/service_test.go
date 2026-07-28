package billingprojection

import (
	"testing"
)

// The projection command is where a correct engine can still produce wrong
// persisted state: by minting a snapshot when nothing changed, by advancing a
// checkpoint it should have invalidated, by projecting a frozen lineage, or by
// treating the same command as new work on retry. These tests pin those.

func activeLineage(id string) LineageInput {
	return LineageInput{
		LineageID: id, InstanceID: "sub_" + id, Type: "subscription",
		CustomerResolved: true,
		Facts: []Fact{
			purchase(id+"-t1", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
			renewal(id+"-t2", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"),
		},
	}
}

func proGrant() GrantVersion {
	return GrantVersion{
		ID: "pegv_1", ProductID: "prod_pro", EntitlementID: "ent_pro", EntitlementKey: "pro",
		Version: 1, EffectiveStart: at("2025-01-01T00:00:00Z"), Policy: DefaultPolicy(),
	}
}

// A projection whose recomputed state matches the committed state must mint no
// snapshot and emit no change. Without this, every reprojection would advance
// the snapshot version and force every SDK in the Project to refetch.
func TestNoChangeProjectionMintsNoSnapshot(t *testing.T) {
	input := Input{
		Scope:                  Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:               []LineageInput{activeLineage("lin_1")},
		GrantVersions:          []GrantVersion{proGrant()},
		CurrentSnapshotVersion: 4,
	}
	// Seed the lineage checkpoint with the checksum the engine will recompute,
	// and the prior customer snapshot with the state it will re-derive.
	first := Compute(input, at("2026-02-15T00:00:00Z"))
	if first.Outcome != OutcomeProjected || first.CustomerSnapshot == nil {
		t.Fatalf("first projection outcome %q, want projected with a snapshot", first.Outcome)
	}
	if first.SnapshotVersion != 5 {
		t.Fatalf("snapshot version %d, want the prior version plus one", first.SnapshotVersion)
	}

	input.Lineages[0].CheckpointChecksum = first.Checkpoints[0].Checksum
	input.PriorCustomerSnapshot = first.CustomerSnapshot
	second := Compute(input, at("2026-02-16T00:00:00Z"))

	if second.Outcome != OutcomeNoChange {
		t.Fatalf("re-projection outcome %q, want no_change", second.Outcome)
	}
	if second.CustomerSnapshot != nil {
		t.Fatal("a no-change projection minted a customer snapshot")
	}
	if len(second.Subscriptions) != 0 {
		t.Fatal("a no-change projection minted a subscription snapshot")
	}
	// The checkpoint must still advance: those facts were examined and must
	// not be examined again.
	if len(second.Checkpoints) != 1 || second.Checkpoints[0].HighWatermark == "" {
		t.Fatal("a no-change projection did not advance the checkpoint")
	}
}

// The idempotency key must be identical for a repeated command and different
// once the facts, rule version, or grant set move. It is what makes a retry
// after a crash recognisable as the same work.
func TestIdempotencyKeyIdentifiesTheCommand(t *testing.T) {
	scope := Scope{ProjectID: "proj_1", CustomerID: "bcu_1"}
	base := IdempotencyKey(scope, []string{"w2", "w1"}, []string{"g2", "g1"})

	// Input order must not matter: the same logical command computed twice
	// must key identically.
	reordered := IdempotencyKey(scope, []string{"w1", "w2"}, []string{"g1", "g2"})
	if string(base) != string(reordered) {
		t.Fatal("idempotency key depends on input ordering")
	}

	if string(base) == string(IdempotencyKey(scope, []string{"w1", "w3"}, []string{"g1", "g2"})) {
		t.Fatal("a new fact did not change the idempotency key")
	}
	if string(base) == string(IdempotencyKey(scope, []string{"w1", "w2"}, []string{"g1", "g3"})) {
		t.Fatal("a different grant version set did not change the idempotency key")
	}
	if string(base) == string(IdempotencyKey(Scope{ProjectID: "proj_1", CustomerID: "bcu_2"},
		[]string{"w1", "w2"}, []string{"g1", "g2"})) {
		t.Fatal("two customers share an idempotency key")
	}
}

// A frozen lineage must contribute no access and must not be projected: an
// open identity conflict means Mosaic does not know whose purchase it is, and
// granting either candidate is the double-grant the freeze exists to prevent.
func TestFrozenLineageIsNotProjected(t *testing.T) {
	frozen := activeLineage("lin_1")
	frozen.Frozen = true

	output := Compute(Input{
		Scope:         Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:      []LineageInput{frozen},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-02-15T00:00:00Z"))

	if len(output.Subscriptions) != 0 {
		t.Fatal("a frozen lineage produced a subscription snapshot")
	}
	if len(output.Checkpoints) != 0 {
		t.Fatal("a frozen lineage advanced its checkpoint")
	}
	if output.CustomerSnapshot != nil {
		for _, entry := range output.CustomerSnapshot.Entries {
			if entry.State == AccessActive {
				t.Fatal("a frozen lineage granted access")
			}
		}
	}
}

// A lineage with no accepted association keeps its facts but projects to no
// customer, and its uncertainty must reach the entitlement entry as `unknown`
// rather than `inactive`.
func TestUnresolvedLineageDoesNotGrantAccess(t *testing.T) {
	unresolved := activeLineage("lin_1")
	unresolved.CustomerResolved = false

	output := Compute(Input{
		Scope:         Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:      []LineageInput{unresolved},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-02-15T00:00:00Z"))

	if len(output.Subscriptions) != 0 {
		t.Fatal("an unresolved lineage was projected to a customer")
	}
	if output.CustomerSnapshot != nil && len(output.CustomerSnapshot.Entries) > 0 {
		for _, entry := range output.CustomerSnapshot.Entries {
			if entry.State == AccessActive {
				t.Fatal("an unresolved lineage granted access")
			}
		}
	}
}

// An out-of-order fact must mark the checkpoint invalidated so the lineage
// reprojects from zero rather than resuming from a watermark that no longer
// describes a prefix of the timeline.
func TestOutOfOrderArrivalInvalidatesCheckpointOnCommit(t *testing.T) {
	lineage := activeLineage("lin_1")
	// A checkpoint already past everything the lineage now holds.
	lineage.Checkpoint = Position(renewal("lin_1-t9", "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z"))

	output := Compute(Input{
		Scope:         Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:      []LineageInput{lineage},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-02-15T00:00:00Z"))

	if len(output.Checkpoints) != 1 {
		t.Fatalf("got %d checkpoints, want one", len(output.Checkpoints))
	}
	if !output.Checkpoints[0].Invalidated {
		t.Fatal("out-of-order facts did not invalidate the checkpoint")
	}
}

// Scope keys drive advisory locking and job coalescing. A customer scope must
// subsume its lineages, or two jobs for the same customer would run
// concurrently and race on the pointer.
func TestScopeKeyPrefersCustomerAndNamesTheLock(t *testing.T) {
	both := Scope{ProjectID: "proj_1", CustomerID: "bcu_1", LineageID: "lin_1"}
	if both.Key() != "customer:bcu_1" {
		t.Fatalf("scope key %q, want the customer scope to win", both.Key())
	}
	if both.LockScope() != "billing-projection:customer:bcu_1" {
		t.Fatalf("lock scope %q", both.LockScope())
	}
	lineageOnly := Scope{ProjectID: "proj_1", LineageID: "lin_1"}
	if lineageOnly.Key() != "lineage:lin_1" {
		t.Fatalf("lineage scope key %q", lineageOnly.Key())
	}
}

// A late-arriving fact for an already-projected customer must produce the same
// state as projecting the whole history from scratch, otherwise reprojection
// after out-of-order delivery would drift from the truth.
func TestReprojectionMatchesFullHistory(t *testing.T) {
	lineage := activeLineage("lin_1")
	withLate := lineage
	withLate.Facts = append(append([]Fact(nil), lineage.Facts...),
		renewal("lin_1-t3", "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"))

	incremental := Compute(Input{
		Scope: Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages: []LineageInput{{
			LineageID: withLate.LineageID, InstanceID: withLate.InstanceID, Type: withLate.Type,
			CustomerResolved: true, Facts: withLate.Facts,
			Checkpoint: HighWatermark(Sort(append([]Fact(nil), lineage.Facts...))),
		}},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-03-15T00:00:00Z"))

	fromScratch := Compute(Input{
		Scope:         Scope{ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1"},
		Lineages:      []LineageInput{withLate},
		GrantVersions: []GrantVersion{proGrant()},
	}, at("2026-03-15T00:00:00Z"))

	if len(incremental.Subscriptions) != 1 || len(fromScratch.Subscriptions) != 1 {
		t.Fatalf("expected one subscription commit each, got %d and %d",
			len(incremental.Subscriptions), len(fromScratch.Subscriptions))
	}
	if string(incremental.Subscriptions[0].Snapshot.Checksum) !=
		string(fromScratch.Subscriptions[0].Snapshot.Checksum) {
		t.Fatal("resuming from a checkpoint diverged from projecting the full history")
	}
}
