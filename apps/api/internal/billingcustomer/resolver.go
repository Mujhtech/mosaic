package billingcustomer

import (
	"sort"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

// AliasDigest is the one-way representation of an alias value.
//
// The domain separation matters more than usual here. An application user id
// and an Apple app-account token are both opaque strings chosen by someone
// else; without a domain prefix, a value that happened to be identical across
// two alias types would collapse into one active resolution and silently join
// two people. The alias type is folded in for the same reason.
// It delegates to the billing module's implementation rather than repeating the
// hash. The validator has to produce the identical digest for a provider
// correlator it parses, and two copies of a persisted digest domain is one edit
// away from two records of the same person that no longer match.
func AliasDigest(aliasType, value string) []byte {
	return billing.AliasDigest(aliasType, value)
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
	// PossessionProof is true when this observation was recorded under a
	// transaction reference that IS the purchase chain's own unguessable
	// provider secret — a Google purchase token. It is never set for Apple,
	// whose transaction identifiers are short decimal numbers that prove
	// nothing about who made the purchase.
	//
	// It does not raise the observation's authority. It is consulted only by
	// the anchored-customer adoption path, which needs proof of ownership
	// rather than an ordering.
	PossessionProof bool
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
	// DecidingRank is the authority rank the winning candidates were drawn
	// from. The caller needs it because what a verdict is allowed to *do*
	// depends on how it was reached: a verdict carried only by a token-bound
	// public-SDK-key submission may attach an unattached lineage but may never
	// move or freeze an attached one.
	DecidingRank int
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
// A token-bound submission over a *public SDK key* sits below
// prior_lineage_association on purpose. Rank 90 is reserved for a submission
// authenticated by the application's secret server key, which is the only
// credential that proves the application's own backend is speaking. A public
// SDK key ships inside every install, so a caller presenting one plus a
// Customer Access Token is making a weaker claim than the association a lineage
// already carries — and if it outranked that association it could take a
// purchase away from its owner, or freeze it in a conflict, from any device
// that ever held a token. Both are remote denial-of-access primitives.
func authorityRank(evidenceType string) int {
	switch evidenceType {
	case EvidenceOperatorRepair:
		return 100
	case EvidenceTrustedServer:
		return 90
	case EvidenceRestoreLink:
		return 80
	case EvidenceAnchorAdoption:
		return 75
	case EvidencePriorLineage:
		return 70
	case EvidenceTokenBoundSubmission:
		return 65
	case EvidenceAppAccountToken, EvidenceObfuscatedAccount:
		return 60
	default:
		// Including installation observations.
		return 0
	}
}

// RankTokenBoundSubmission is the authority a token-bound public-SDK-key
// submission carries. It is exported so the application service can recognise a
// verdict that was reached on that evidence alone without restating the number.
var RankTokenBoundSubmission = authorityRank(EvidenceTokenBoundSubmission)

// OwnershipProof reports the proof, if any, that `candidate` owns the purchase
// chain these observations describe.
//
// This is a different question from "which customer does the evidence name",
// which Resolve answers. Adoption takes a lineage away from a customer that
// already holds it, so naming is not enough: something has to demonstrate that
// the claimant is the buyer. Three things do, and the Apple/Google asymmetry is
// the reason there are three rather than one:
//
//   - Possession of the Google purchase token. The token is an unguessable
//     secret the store issued to the purchasing device; presenting it is proof.
//     Apple has no equivalent — its transaction identifiers are short decimal
//     numbers — so possession is never accepted for Apple.
//   - A provider correlator (Apple `appAccountToken`, Google
//     `obfuscatedExternalAccountId`) that already resolves to the candidate.
//     The store itself echoed a value the candidate's backend chose.
//   - A submission authenticated by the secret server key, which is the
//     application's own backend speaking.
func OwnershipProof(observations []Observation, activeAliases map[string]string, candidate string) (string, bool) {
	if candidate == "" {
		return "", false
	}
	correlator := false
	trusted := false
	for _, observation := range observations {
		switch observation.EvidenceType {
		case EvidenceTokenBoundSubmission, EvidenceTrustedServer:
			if observation.CustomerID != candidate {
				continue
			}
			if observation.PossessionProof {
				return ProofPurchaseTokenPossession, true
			}
			if observation.EvidenceType == EvidenceTrustedServer {
				trusted = true
			}
		case EvidenceAppAccountToken, EvidenceObfuscatedAccount:
			if len(observation.Digest) > 0 && activeAliases[string(observation.Digest)] == candidate {
				correlator = true
			}
		}
	}
	switch {
	case correlator:
		return ProofProviderCorrelator, true
	case trusted:
		return ProofTrustedServer, true
	default:
		return "", false
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

	resolution.DecidingRank = bestRank
	switch len(candidates) {
	case 0:
		resolution.DecidingRank = 0
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
