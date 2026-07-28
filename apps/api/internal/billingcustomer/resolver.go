package billingcustomer

import (
	"crypto/sha256"
	"sort"
)

// AliasDigest is the one-way representation of an alias value.
//
// The domain separation matters more than usual here. An application user id
// and an Apple app-account token are both opaque strings chosen by someone
// else; without a domain prefix, a value that happened to be identical across
// two alias types would collapse into one active resolution and silently join
// two people. The alias type is folded in for the same reason.
func AliasDigest(aliasType, value string) []byte {
	hasher := sha256.New()
	hasher.Write([]byte("mosaic-billing-alias-v1"))
	hasher.Write([]byte{0})
	hasher.Write([]byte(aliasType))
	hasher.Write([]byte{0})
	hasher.Write([]byte(value))
	return hasher.Sum(nil)
}

// Observation is one piece of evidence offered to the resolver.
type Observation struct {
	EvidenceType string
	// Digest is the alias digest of the correlator value, computed
	// server-side. The resolver never receives a raw correlator.
	Digest []byte
	// CustomerID is set only for evidence that names a customer directly: a
	// trusted server observation, a restore link, an operator repair, or a
	// prior association already recorded on the lineage.
	CustomerID string
	// AliasType is the alias the digest belongs to, used to look up an
	// existing active resolution.
	AliasType  string
	RawInputID string
}

// Resolution is the deterministic verdict for one lineage.
type Resolution struct {
	Outcome    string
	CustomerID string
	// ConflictWith is the second candidate when the outcome is conflicting.
	ConflictWith   string
	DiagnosticCode string
	// Considered is every observation the resolver examined, in the order it
	// examined them, each stamped with the outcome it produced. It is
	// persisted as association evidence so the decision is reconstructable.
	Considered []Observation
}

// authorityRank orders evidence types by how much authority they carry. The
// ranking is explicit rather than implied by evaluation order, because an
// implicit ranking is one refactor away from silently changing which evidence
// wins.
//
// A trusted server observation outranks a provider correlator because the
// application backend knows who its user is, while a correlator only says two
// purchases came from the same store account. An installation observation
// carries no authority at all and is listed to make that explicit: it is
// evidence for attribution and can never select a customer (OD-4(a)), because
// a client-generated identifier that could select a customer is a
// read-someone-else's-entitlements vulnerability.
func authorityRank(evidenceType string) int {
	switch evidenceType {
	case EvidenceOperatorRepair:
		return 100
	case EvidenceTrustedServer:
		return 90
	case EvidenceRestoreLink:
		return 80
	case EvidencePriorLineage:
		return 70
	case EvidenceAppAccountToken, EvidenceObfuscatedAccount:
		return 60
	default:
		// Including installation observations.
		return 0
	}
}

// Resolve decides which Billing Customer a lineage belongs to.
//
// It is a pure function of the observations and the currently active alias
// resolutions, so a dry run has no side effects and a replay reaches the same
// verdict. It never guesses: two candidates of equal authority conflict rather
// than one being picked.
//
// `activeAliases` maps an alias digest (hex-free, compared by value) to the
// customer that alias currently resolves to.
func Resolve(observations []Observation, activeAliases map[string]string) Resolution {
	resolution := Resolution{Outcome: OutcomeUnresolved, DiagnosticCode: "no_accepted_evidence"}

	ranked := append([]Observation(nil), observations...)
	sort.SliceStable(ranked, func(i, j int) bool {
		return authorityRank(ranked[i].EvidenceType) > authorityRank(ranked[j].EvidenceType)
	})
	resolution.Considered = ranked

	// Candidates at the highest authority level that produced any candidate.
	bestRank := -1
	candidates := map[string]struct{}{}
	for _, observation := range ranked {
		rank := authorityRank(observation.EvidenceType)
		if rank == 0 {
			// Zero-authority evidence is recorded and ignored. This is the
			// structural guarantee that an installation id cannot select a
			// customer.
			continue
		}
		candidate := observation.CustomerID
		if candidate == "" && len(observation.Digest) > 0 {
			candidate = activeAliases[string(observation.Digest)]
		}
		if candidate == "" {
			continue
		}
		if rank > bestRank {
			bestRank, candidates = rank, map[string]struct{}{candidate: {}}
			continue
		}
		if rank == bestRank {
			candidates[candidate] = struct{}{}
		}
	}

	switch len(candidates) {
	case 0:
		return resolution
	case 1:
		for candidate := range candidates {
			resolution.Outcome, resolution.CustomerID = OutcomeResolved, candidate
			resolution.DiagnosticCode = ""
		}
		return resolution
	default:
		// Two equally authoritative pieces of evidence naming different
		// customers. Neither is granted anything: the lineage freezes and an
		// operator resolves it (OD-10(a)).
		names := make([]string, 0, len(candidates))
		for candidate := range candidates {
			names = append(names, candidate)
		}
		sort.Strings(names)
		resolution.Outcome = OutcomeConflicting
		resolution.CustomerID, resolution.ConflictWith = names[0], names[1]
		resolution.DiagnosticCode = "multiple_customers_claim_lineage"
		return resolution
	}
}
