package billinggrant

import (
	"fmt"
	"sort"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// Normalize applies the transport-independent defaults and trims. It is
// separate from validation so that what is defaulted and what is refused are
// two readable lists rather than one function that does both.
func Normalize(input PublishInput) PublishInput {
	input.EffectiveStart = input.EffectiveStart.UTC()
	if len(input.SupportedPurchaseTypes) == 0 {
		input.SupportedPurchaseTypes = DefaultPurchaseTypes()
	}
	types := append([]string(nil), input.SupportedPurchaseTypes...)
	sort.Strings(types)
	deduped := types[:0]
	for index, value := range types {
		if index == 0 || value != types[index-1] {
			deduped = append(deduped, value)
		}
	}
	input.SupportedPurchaseTypes = deduped
	return input
}

// ValidateShape checks what can be decided without reading the pair's history.
func ValidateShape(input PublishInput) error {
	if input.ProductID == "" || input.EntitlementID == "" {
		return fmt.Errorf("%w: a grant version names one Product and one Entitlement", ErrInvalid)
	}
	if input.EffectiveStart.IsZero() {
		return fmt.Errorf("%w: a grant version must state when it takes effect", ErrInvalid)
	}
	if len(input.SupportedPurchaseTypes) == 0 {
		return fmt.Errorf("%w: a grant version must support at least one purchase type", ErrInvalid)
	}
	for _, purchaseType := range input.SupportedPurchaseTypes {
		switch purchaseType {
		case PurchaseTypeAutoRenewable, PurchaseTypeNonConsumable:
		default:
			return fmt.Errorf("%w: %q is not a purchase type Mosaic projects", ErrInvalid, purchaseType)
		}
	}
	// Google's pause is fixed at no-access with no override (plan §7), and the
	// schema CHECK says so too. Refusing it here rather than letting the insert
	// fail gives the operator a sentence instead of a constraint name.
	if input.GrantsInPaused {
		return fmt.Errorf("%w: paused subscriptions never grant access and the policy is not overridable", ErrInvalid)
	}
	if len(input.Reason) > 512 {
		return fmt.Errorf("%w: the reason is too long", ErrInvalid)
	}
	return nil
}

// PlanPublish decides whether a proposed version may join a pair's recorded
// history, and what publishing it does to the version it supersedes.
//
// It is pure: given the same history, the same proposal, and the same instant
// it always reaches the same decision. That is what makes it testable without a
// database, and it is called inside the publish transaction with the pair's
// advisory lock held, so the history it reasons about cannot move underneath
// the decision.
//
// The rules, in the order a reader most needs them:
//
//  1. A prospective version takes effect now or later. Publishing a change that
//     silently applies to yesterday is the failure grant versioning exists to
//     prevent, so backdating requires the caller to say so.
//  2. A retroactive version may name a past instant, but only inside the
//     currently open interval, and only if it widens access (OD-8's
//     additive-superset rule, evaluated by the projection engine's own
//     comparison rather than a second copy of it here).
//  3. No proposal may reach back into an interval that has already closed. A
//     closed interval is what a historical purchase selected; rewriting it would
//     change what a customer was entitled to at a moment that has passed, with
//     no way for them to have known.
//  4. Publishing closes the open version at the new version's start, so the two
//     abut exactly. There is never a gap (which would strand purchases made in
//     it) and never an overlap (which would make selection order-dependent).
func PlanPublish(existing []Version, input PublishInput, now time.Time) (Plan, error) {
	now = now.UTC()
	start := input.EffectiveStart.UTC()

	relevant := make([]Version, 0, len(existing))
	for _, version := range existing {
		if version.ProductID == input.ProductID && version.EntitlementID == input.EntitlementID {
			relevant = append(relevant, version)
		}
	}
	sort.Slice(relevant, func(i, j int) bool { return relevant[i].Version < relevant[j].Version })

	plan := Plan{NextVersion: 1, SupersededAt: start}
	var open *Version
	for index := range relevant {
		version := relevant[index]
		if version.Version >= plan.NextVersion {
			plan.NextVersion = version.Version + 1
		}
		if version.Current() {
			// The partial unique index permits one open version per pair. A
			// second one means the index is gone, and continuing would publish
			// against a history no rule in this function describes.
			if open != nil {
				return Plan{}, fmt.Errorf("%w: the pair has two open grant versions", ErrConflict)
			}
			open = &relevant[index]
			continue
		}
		// Rule 3: a closed interval is settled history.
		if version.EffectiveEnd.After(start) {
			return Plan{}, fmt.Errorf("%w: version %d already covers %s",
				ErrOverlap, version.Version, start.Format(time.RFC3339))
		}
	}

	if !input.Retroactive && start.Before(now) {
		return Plan{}, fmt.Errorf(
			"%w: a prospective grant version takes effect now or later; mark the change retroactive to backdate it",
			ErrInvalid)
	}

	if open == nil {
		// The pair currently grants nothing: there is no interval to close, and
		// the new version simply begins. Nothing above it can overlap, because
		// every closed interval was checked against the start.
		plan.SupersededVersionID = ""
		return plan, nil
	}

	if !start.After(open.EffectiveStart) {
		// Closing the open version at or before its own start would produce an
		// empty or inverted interval, which the schema refuses anyway. Saying so
		// here names the actual problem: the proposal is not a later statement
		// about the pair, it is an attempt to replace one.
		return Plan{}, fmt.Errorf("%w: the current version already takes effect at %s",
			ErrOverlap, open.EffectiveStart.Format(time.RFC3339))
	}

	if input.Retroactive {
		code, ok := billingprojection.ValidateAdditiveSuperset(
			grantVersionOf(*open), grantVersionOf(versionFromInput(input, plan.NextVersion)))
		if !ok {
			return Plan{}, fmt.Errorf("%w: %s", ErrNotAdditiveSuperset, code)
		}
	}

	plan.SupersededVersionID = open.ID
	plan.SupersededAt = start
	return plan, nil
}

// CheckAdditiveSuperset reports the widen-only comparison without deciding
// anything, for the impact preview. The preview never refuses — it reports, and
// the publish refuses — so an operator can see *why* a retroactive change would
// be rejected before they attempt it.
func CheckAdditiveSuperset(current Version, input PublishInput) (string, bool) {
	return billingprojection.ValidateAdditiveSuperset(
		grantVersionOf(current), grantVersionOf(versionFromInput(input, current.Version+1)))
}

// versionFromInput renders a proposal as the Version shape the comparison
// speaks, so the additive-superset rule is applied to exactly the row that would
// be written rather than to a parallel description of it.
func versionFromInput(input PublishInput, number int) Version {
	return Version{
		ProductID: input.ProductID, EntitlementID: input.EntitlementID,
		Version: number, EffectiveStart: input.EffectiveStart.UTC(),
		SupportedPurchaseTypes: input.SupportedPurchaseTypes,
		Policy:                 input.Policy,
		GrantPolicyVersion:     GrantPolicyVersion,
	}
}

// grantVersionOf adapts a management Version to the projection engine's own
// type. The adapter exists so the additive-superset rule has exactly one
// implementation: this package reuses the engine's comparison rather than
// keeping a second copy that could drift from the one access is derived under.
func grantVersionOf(version Version) billingprojection.GrantVersion {
	return billingprojection.GrantVersion{
		ID: version.ID, ProductID: version.ProductID, EntitlementID: version.EntitlementID,
		EntitlementKey: version.EntitlementKey, Version: version.Version,
		EffectiveStart: version.EffectiveStart, EffectiveEnd: version.EffectiveEnd,
		SupportedPurchaseTypes: version.SupportedPurchaseTypes, Policy: version.Policy,
	}
}
