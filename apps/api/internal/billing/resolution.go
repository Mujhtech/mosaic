package billing

import (
	"sort"
	"time"
)

// maxChainHops bounds the replacement walk. UNIQUE (replaces_mapping_id) plus
// the self-reference CHECK added in migration 00022 already make the chain
// linear and acyclic, so this is a defensive stop rather than a correctness
// requirement: if it is ever reached the data violates a constraint, and
// treating that as ambiguity is safer than looping.
const maxChainHops = 32

// ResolutionInput is everything the resolver is allowed to consider.
//
// The absence of fields here is the point. There is no display name, no price,
// no billing period, and no fuzzy identifier, because Product resolution must
// never guess: an incorrect commerce Product attributed to a transaction is a
// named release blocker, and a near-match is indistinguishable from a correct
// match once it has been written to an append-only ledger.
type ResolutionInput struct {
	Provider                   string
	ProviderProductIdentifier  string
	ProviderBasePlanIdentifier string
	ProviderOfferIdentifier    string
	// OccurredAt is the transaction's own instant. Mapping history is evaluated
	// as of this moment, not as of now, so a transaction from before a mapping
	// was archived still resolves to what it meant at the time.
	OccurredAt      time.Time
	TransactionType string
	// Candidates are every mapping in the Environment/Application/platform scope
	// carrying this provider Product identifier, in any status.
	Candidates []MappingCandidate
	// Successors maps a mapping id to the mapping that replaces it.
	Successors map[string]MappingCandidate
}

// Resolution is the Resolution Snapshot: the exact mapping version used, so a
// replay months later reproduces the same answer.
type Resolution struct {
	Outcome string
	State   string
	// MosaicProductID is the Product whose meaning was adopted.
	MosaicProductID string
	// MappingID is the mapping the Product came from.
	MappingID string
	// MatchedMappingID is the mapping that actually matched the transaction,
	// which differs from MappingID when a replacement chain was followed. Both
	// are recorded so provenance is exact rather than merely useful.
	MatchedMappingID string
	MappingVersion   int64
	CandidateCount   int
	DiagnosticCode   string
}

// Resolve performs deterministic Product resolution.
//
// Order: an active mapping, then the mapping that was live at the transaction's
// own occurrence time, then the linear replacement chain forward from it.
// Everything else is `unknown` or `ambiguous`, and both quarantine.
func Resolve(input ResolutionInput) Resolution {
	candidates := filterByPlan(input)
	result := Resolution{CandidateCount: len(candidates)}

	current := make([]MappingCandidate, 0, len(candidates))
	historical := make([]MappingCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		switch {
		case candidate.ArchivedAt == nil && isCurrentStatus(candidate.Status):
			current = append(current, candidate)
		case candidate.ArchivedAt != nil && candidate.ArchivedAt.After(input.OccurredAt):
			// The mapping was still live when the transaction happened.
			historical = append(historical, candidate)
		}
	}

	switch {
	case len(current) > 1:
		result.Outcome = ResolutionAmbiguous
		result.DiagnosticCode = "multiple_current_mappings"
		return result
	case len(current) == 1:
		return finish(result, input, current[0], current[0], StateActiveMapping)
	}

	if len(historical) == 0 {
		result.Outcome = ResolutionUnknown
		result.DiagnosticCode = "no_mapping_for_provider_product"
		return result
	}

	// Oldest archival first: the mapping archived soonest after the transaction
	// is the one that was in force when it happened.
	sort.SliceStable(historical, func(i, j int) bool {
		if historical[i].ArchivedAt.Equal(*historical[j].ArchivedAt) {
			return historical[i].ID < historical[j].ID
		}
		return historical[i].ArchivedAt.Before(*historical[j].ArchivedAt)
	})
	if len(historical) > 1 && historical[0].ArchivedAt.Equal(*historical[1].ArchivedAt) {
		// Two mappings archived at the same instant cannot be ordered by intent.
		result.Outcome = ResolutionAmbiguous
		result.DiagnosticCode = "ambiguous_archived_mappings"
		return result
	}

	matched := historical[0]
	adopted, state, ok := walkChain(matched, input.Successors)
	if !ok {
		result.Outcome = ResolutionAmbiguous
		result.DiagnosticCode = "replacement_chain_exceeded"
		return result
	}
	return finish(result, input, adopted, matched, state)
}

// finish applies the checks that depend on the adopted Product rather than on
// which mapping matched.
func finish(result Resolution, input ResolutionInput, adopted, matched MappingCandidate, state string) Resolution {
	if adopted.MosaicProductID == "" {
		result.Outcome = ResolutionUnknown
		result.DiagnosticCode = "mapping_has_no_product"
		return result
	}
	// A subscription transaction that resolves to a one-time Product, or the
	// reverse, is a configuration error rather than a fact. Recording it would
	// put a contradiction into an append-only ledger.
	if !typeCompatible(input.TransactionType, adopted.MosaicProductType) {
		result.Outcome = ResolutionUnsupportedProductType
		result.DiagnosticCode = "product_type_mismatch"
		return result
	}
	result.Outcome = ResolutionResolved
	result.State = state
	result.MosaicProductID = adopted.MosaicProductID
	result.MappingID = adopted.ID
	result.MatchedMappingID = matched.ID
	result.MappingVersion = adopted.Version
	return result
}

// walkChain follows replaces_mapping_id forward from a matched archived mapping
// to the operator's current declared intent.
func walkChain(matched MappingCandidate, successors map[string]MappingCandidate) (MappingCandidate, string, bool) {
	adopted := matched
	state := StateArchivedMapping
	seen := map[string]struct{}{matched.ID: {}}
	for hop := 0; hop < maxChainHops; hop++ {
		successor, ok := successors[adopted.ID]
		if !ok {
			return adopted, state, true
		}
		if _, repeated := seen[successor.ID]; repeated {
			return MappingCandidate{}, "", false
		}
		seen[successor.ID] = struct{}{}
		adopted = successor
		state = StateReplacementChain
	}
	return MappingCandidate{}, "", false
}

// filterByPlan narrows Google candidates by base plan when the mapping declares
// one. A mapping that declares a base plan is a statement that it only covers
// that plan, so a transaction on a different plan must not match it.
func filterByPlan(input ResolutionInput) []MappingCandidate {
	if input.Provider != ProviderGooglePlay {
		return input.Candidates
	}
	filtered := make([]MappingCandidate, 0, len(input.Candidates))
	for _, candidate := range input.Candidates {
		if candidate.ProviderBasePlanIdentifier != "" &&
			candidate.ProviderBasePlanIdentifier != input.ProviderBasePlanIdentifier {
			continue
		}
		if candidate.ProviderOfferIdentifier != "" &&
			candidate.ProviderOfferIdentifier != input.ProviderOfferIdentifier {
			continue
		}
		filtered = append(filtered, candidate)
	}
	return filtered
}

func isCurrentStatus(status string) bool {
	switch status {
	case "draft", "active", "attention_required":
		return true
	default:
		return false
	}
}

// typeCompatible pairs a store transaction type with a Mosaic Product type.
func typeCompatible(transactionType, productType string) bool {
	switch transactionType {
	case TypeAutoRenewableSubscription:
		return productType == "subscription"
	case TypeNonConsumable:
		return productType == "one_time_non_consumable"
	default:
		return false
	}
}

// QuarantineReasonFor maps a non-resolved outcome onto the quarantine reason it
// produces. Resolution failures always quarantine: an unresolved Product means
// Mosaic saw a real purchase of something it does not recognise, which is an
// operator action, not a discardable event.
func QuarantineReasonFor(outcome string) (string, bool) {
	switch outcome {
	case ResolutionUnknown:
		return QuarantineProductUnknown, true
	case ResolutionAmbiguous:
		return QuarantineProductAmbiguous, true
	case ResolutionCrossEnvironmentMismatch:
		return QuarantineCrossEnvironmentMismatch, true
	case ResolutionUnsupportedProductType:
		return QuarantineUnsupportedProductType, true
	default:
		return "", false
	}
}
