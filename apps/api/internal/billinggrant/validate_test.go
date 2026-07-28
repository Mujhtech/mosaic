package billinggrant

import (
	"errors"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

func at(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return parsed.UTC()
}

func ptr(value string) *time.Time {
	parsed := at(value)
	return &parsed
}

func openVersion(number int, start string, policy billingprojection.Policy) Version {
	return Version{
		ID: "pegv_open", ProductID: "prod_pro", EntitlementID: "ent_pro",
		Version: number, EffectiveStart: at(start), Policy: policy,
		SupportedPurchaseTypes: DefaultPurchaseTypes(),
	}
}

func fullAccess() billingprojection.Policy {
	return billingprojection.Policy{
		GrantsInActive: true, GrantsInTrial: true, GrantsInGrace: true, GrantsInOneTime: true,
	}
}

// PlanPublish decides what a grant change does, and every rule it enforces is a
// rule about somebody's access. The failures below are all silent in
// production: each produces a grant history that reads as valid and makes the
// projection engine select a different version for purchases that were made
// before anyone published anything.
//
// It is a unit test because the decision is pure. The database enforces the
// same shape as a backstop, but a constraint violation is not a usable answer
// for an operator, and the interesting cases (prospective vs retroactive,
// additive superset) are not expressible as constraints at all.
func TestPlanPublishRules(t *testing.T) {
	now := at("2026-07-28T12:00:00Z")

	t.Run("first version for a pair starts the history", func(t *testing.T) {
		plan, err := PlanPublish(nil, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-08-01T00:00:00Z"), Policy: fullAccess(),
		}, now)
		if err != nil {
			t.Fatal(err)
		}
		if plan.NextVersion != 1 || plan.SupersededVersionID != "" {
			t.Fatalf("first publish planned %+v, want version 1 superseding nothing", plan)
		}
	})

	t.Run("publishing closes the open version at the new start", func(t *testing.T) {
		existing := []Version{openVersion(3, "2026-01-01T00:00:00Z", fullAccess())}
		start := at("2026-09-01T00:00:00Z")
		plan, err := PlanPublish(existing, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: start, Policy: fullAccess(),
		}, now)
		if err != nil {
			t.Fatal(err)
		}
		if plan.NextVersion != 4 {
			t.Fatalf("next version is %d, want 4", plan.NextVersion)
		}
		if plan.SupersededVersionID != "pegv_open" {
			t.Fatalf("superseded %q, want the open version", plan.SupersededVersionID)
		}
		// Abutting exactly is what keeps every instant covered by exactly one
		// version: a gap would strand purchases made inside it with no grant, an
		// overlap would make selection depend on row order.
		if !plan.SupersededAt.Equal(start) {
			t.Fatalf("closed the predecessor at %s, want the new start %s", plan.SupersededAt, start)
		}
	})

	t.Run("a prospective version may not be backdated", func(t *testing.T) {
		_, err := PlanPublish([]Version{openVersion(1, "2026-01-01T00:00:00Z", fullAccess())},
			PublishInput{
				ProductID: "prod_pro", EntitlementID: "ent_pro",
				EffectiveStart: at("2026-06-01T00:00:00Z"), Policy: fullAccess(),
			}, now)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("backdated prospective publish returned %v, want ErrInvalid", err)
		}
	})

	t.Run("no proposal may reach into a closed interval", func(t *testing.T) {
		closed := openVersion(1, "2026-01-01T00:00:00Z", fullAccess())
		closed.ID, closed.EffectiveEnd = "pegv_closed", ptr("2026-10-01T00:00:00Z")
		_, err := PlanPublish([]Version{closed}, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-09-01T00:00:00Z"), Retroactive: true, Policy: fullAccess(),
		}, now)
		if !errors.Is(err, ErrOverlap) {
			t.Fatalf("proposal inside a closed interval returned %v, want ErrOverlap", err)
		}
	})

	t.Run("a proposal may not start at or before the current version", func(t *testing.T) {
		existing := []Version{openVersion(1, "2026-01-01T00:00:00Z", fullAccess())}
		_, err := PlanPublish(existing, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-01-01T00:00:00Z"), Retroactive: true, Policy: fullAccess(),
		}, now)
		if !errors.Is(err, ErrOverlap) {
			t.Fatalf("proposal at the current version's own start returned %v, want ErrOverlap", err)
		}
	})

	t.Run("a retroactive version must widen access, never narrow it", func(t *testing.T) {
		existing := []Version{openVersion(1, "2026-01-01T00:00:00Z", fullAccess())}
		narrowed := fullAccess()
		narrowed.GrantsInGrace = false

		_, err := PlanPublish(existing, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-06-01T00:00:00Z"), Retroactive: true, Policy: narrowed,
		}, now)
		if !errors.Is(err, ErrNotAdditiveSuperset) {
			t.Fatalf("retroactive narrowing returned %v, want ErrNotAdditiveSuperset", err)
		}

		widened := fullAccess()
		widened.GrantsInBillingRetry = true
		if _, err := PlanPublish(existing, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-06-01T00:00:00Z"), Retroactive: true, Policy: widened,
		}, now); err != nil {
			t.Fatalf("retroactive widening was refused: %v", err)
		}
	})

	t.Run("the same narrowing is permitted prospectively", func(t *testing.T) {
		// The additive-superset rule is about retroactive change specifically.
		// Applying it to a prospective change would make a catalog whose meaning
		// can only ever grow, which is not the decision OD-8 records.
		existing := []Version{openVersion(1, "2026-01-01T00:00:00Z", fullAccess())}
		narrowed := fullAccess()
		narrowed.GrantsInGrace = false
		if _, err := PlanPublish(existing, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-09-01T00:00:00Z"), Policy: narrowed,
		}, now); err != nil {
			t.Fatalf("prospective narrowing was refused: %v", err)
		}
	})

	t.Run("another pair's history is not consulted", func(t *testing.T) {
		other := openVersion(9, "2027-01-01T00:00:00Z", fullAccess())
		other.EntitlementID = "ent_other"
		plan, err := PlanPublish([]Version{other}, PublishInput{
			ProductID: "prod_pro", EntitlementID: "ent_pro",
			EffectiveStart: at("2026-08-01T00:00:00Z"), Policy: fullAccess(),
		}, now)
		if err != nil {
			t.Fatal(err)
		}
		if plan.NextVersion != 1 || plan.SupersededVersionID != "" {
			t.Fatalf("planned %+v against another Entitlement's history, want a fresh version 1", plan)
		}
	})
}

// A paused-access override and an unsupported purchase type are refused before
// anything is read, so an operator gets a sentence rather than a constraint
// name from a failed insert.
func TestValidateShapeRefusesUnrepresentablePolicies(t *testing.T) {
	base := Normalize(PublishInput{
		ProductID: "prod_pro", EntitlementID: "ent_pro",
		EffectiveStart: at("2026-08-01T00:00:00Z"), Policy: fullAccess(),
	})
	if err := ValidateShape(base); err != nil {
		t.Fatalf("a plain proposal was refused: %v", err)
	}

	paused := base
	paused.GrantsInPaused = true
	if err := ValidateShape(paused); !errors.Is(err, ErrInvalid) {
		t.Fatalf("paused-access override returned %v, want ErrInvalid", err)
	}

	unsupported := base
	unsupported.SupportedPurchaseTypes = []string{"consumable"}
	if err := ValidateShape(unsupported); !errors.Is(err, ErrInvalid) {
		t.Fatalf("consumable purchase type returned %v, want ErrInvalid", err)
	}
}
