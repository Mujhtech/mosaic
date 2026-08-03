package billingprojection

import (
	"sort"
	"time"
)

// GrantVersion is one immutable Product-to-Entitlement grant interval.
type GrantVersion struct {
	ID             string
	ProductID      string
	EntitlementID  string
	EntitlementKey string
	Version        int
	EffectiveStart time.Time
	// EffectiveEnd is nil for the current open-ended version. Intervals are
	// half-open: [start, end).
	EffectiveEnd *time.Time

	SupportedPurchaseTypes []string
	Policy                 Policy
}

// SelectGrantVersions returns the grant versions in force for one Product at
// one instant — the purchase source's period effective time, not "now" (OD-8,
// prospective by period effective time).
//
// Selecting by current time instead would silently rewrite historical access
// meaning every time an operator edits their catalog, which is the specific
// failure the versioning exists to prevent.
//
// Earliest-version rule: a purchase whose effective time predates the earliest
// recorded version selects that earliest version. Without it, every purchase
// made before the 9B backfill boundary would strand with no grant and drop to
// `unknown` — an artefact of when Mosaic started versioning, not of anything
// the customer did.
func SelectGrantVersions(versions []GrantVersion, productID string, at time.Time, purchaseType string) []GrantVersion {
	at = at.UTC()
	byEntitlement := map[string][]GrantVersion{}
	for _, version := range versions {
		if version.ProductID != productID || !supportsPurchaseType(version, purchaseType) {
			continue
		}
		byEntitlement[version.EntitlementID] = append(byEntitlement[version.EntitlementID], version)
	}

	selected := make([]GrantVersion, 0, len(byEntitlement))
	for _, candidates := range byEntitlement {
		sort.Slice(candidates, func(i, j int) bool {
			if !candidates[i].EffectiveStart.Equal(candidates[j].EffectiveStart) {
				return candidates[i].EffectiveStart.Before(candidates[j].EffectiveStart)
			}
			return candidates[i].Version < candidates[j].Version
		})
		if chosen, ok := selectOne(candidates, at); ok {
			selected = append(selected, chosen)
		}
	}
	// Deterministic output order: the caller derives a checksum from it.
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].EntitlementID != selected[j].EntitlementID {
			return selected[i].EntitlementID < selected[j].EntitlementID
		}
		return selected[i].Version < selected[j].Version
	})
	return selected
}

func selectOne(candidates []GrantVersion, at time.Time) (GrantVersion, bool) {
	if len(candidates) == 0 {
		return GrantVersion{}, false
	}
	for _, candidate := range candidates {
		if candidate.EffectiveStart.After(at) {
			continue
		}
		if candidate.EffectiveEnd == nil || candidate.EffectiveEnd.After(at) {
			return candidate, true
		}
	}
	// The purchase predates every recorded version: take the earliest
	// (backfill boundary rule above). A purchase that falls in a closed gap
	// between two versions — the pair was granted, removed, and never
	// re-granted — correctly selects nothing, because at that instant the
	// Product genuinely granted nothing.
	if at.Before(candidates[0].EffectiveStart) {
		return candidates[0], true
	}
	return GrantVersion{}, false
}

// supportsPurchaseType reports whether a grant version covers a purchase type.
//
// Both under-specified shapes refuse rather than match. An empty
// SupportedPurchaseTypes used to match every purchase type, which made an
// under-specified grant row the widest possible grant: the one row shape most
// likely to be produced by a bug or a partial write granted the most access.
// The list is enumerative by contract — `billinggrant.ValidateShape` refuses an
// empty one and migration 00063 enforces the same invariant in the schema — so
// an empty list here can only mean a row that predates or evades that
// invariant, and the honest reading of it is "this version states nothing about
// what it covers", not "everything".
//
// An empty purchaseType is refused for the same reason: it means the purchase's
// type is unknown, and an unknown purchase must not select a grant.
func supportsPurchaseType(version GrantVersion, purchaseType string) bool {
	if purchaseType == "" {
		return false
	}
	for _, supported := range version.SupportedPurchaseTypes {
		if supported == purchaseType {
			return true
		}
	}
	return false
}

// ValidateAdditiveSuperset reports whether a proposed grant version is a
// permitted retroactive correction: it may add Entitlements or widen access
// policy, never remove or narrow either.
//
// Retroactive change is the one operation that can take access away from a
// customer who did nothing wrong, so the only retroactive shape Mosaic accepts
// is the one that cannot: a superset.
func ValidateAdditiveSuperset(current, proposed GrantVersion) (string, bool) {
	if current.EntitlementID != proposed.EntitlementID || current.ProductID != proposed.ProductID {
		return "grant_identity_changed", false
	}
	checks := []struct {
		code             string
		before, proposed bool
	}{
		{"active_access_narrowed", current.Policy.GrantsInActive, proposed.Policy.GrantsInActive},
		{"trial_access_narrowed", current.Policy.GrantsInTrial, proposed.Policy.GrantsInTrial},
		{"grace_access_narrowed", current.Policy.GrantsInGrace, proposed.Policy.GrantsInGrace},
		{"billing_retry_access_narrowed", current.Policy.GrantsInBillingRetry, proposed.Policy.GrantsInBillingRetry},
		{"one_time_access_narrowed", current.Policy.GrantsInOneTime, proposed.Policy.GrantsInOneTime},
	}
	for _, check := range checks {
		if check.before && !check.proposed {
			return check.code, false
		}
	}
	for _, supported := range current.SupportedPurchaseTypes {
		if !supportsPurchaseType(proposed, supported) {
			return "purchase_type_support_narrowed", false
		}
	}
	return "", true
}
