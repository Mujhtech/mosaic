package billingcustomer

import "testing"

// Association decides whose entitlements a purchase becomes. A wrong verdict
// is either a customer reading someone else's paid access or a paying customer
// silently losing theirs, so these tests pin the rules that prevent both.

// An installation identifier is client-generated and guessable. If it could
// select a customer, anyone able to forge one could read another person's
// entitlements. It must be recorded and ignored (OD-4(a)).
func TestInstallationEvidenceCannotSelectCustomer(t *testing.T) {
	digest := AliasDigest(AliasInstallation, "install-abc")
	resolution := Resolve(
		[]Observation{{EvidenceType: EvidenceInstallation, Digest: digest, AliasType: AliasInstallation}},
		map[string]string{string(digest): "bcu_victim"},
	)

	if resolution.Outcome != OutcomeUnresolved {
		t.Fatalf("installation evidence resolved to %q/%q; it must never select a customer",
			resolution.Outcome, resolution.CustomerID)
	}
	if resolution.CustomerID != "" {
		t.Fatalf("installation evidence selected customer %q", resolution.CustomerID)
	}
	if len(resolution.Considered) != 1 {
		t.Fatal("ignored evidence must still be recorded for attribution and diagnostics")
	}
}

// A trusted server observation outranks a provider correlator: the application
// backend knows who its user is, while a store correlator only proves two
// purchases share a store account (which Family Sharing and shared devices
// make an unreliable person identifier).
func TestTrustedServerOutranksProviderCorrelator(t *testing.T) {
	correlator := AliasDigest(AliasAppleAppAccountToken, "token-1")
	resolution := Resolve([]Observation{
		{EvidenceType: EvidenceAppAccountToken, Digest: correlator, AliasType: AliasAppleAppAccountToken},
		{EvidenceType: EvidenceTrustedServer, CustomerID: "bcu_trusted"},
	}, map[string]string{string(correlator): "bcu_correlator"})

	if resolution.Outcome != OutcomeResolved || resolution.CustomerID != "bcu_trusted" {
		t.Fatalf("got %q/%q, want resolved/bcu_trusted", resolution.Outcome, resolution.CustomerID)
	}
}

// Two equally authoritative pieces of evidence naming different customers must
// conflict, not pick one. Picking would put one customer's purchase on another
// customer's account, which no later repair fully undoes.
func TestEqualAuthorityDisagreementConflicts(t *testing.T) {
	resolution := Resolve([]Observation{
		{EvidenceType: EvidenceTrustedServer, CustomerID: "bcu_one"},
		{EvidenceType: EvidenceTrustedServer, CustomerID: "bcu_two"},
	}, nil)

	if resolution.Outcome != OutcomeConflicting {
		t.Fatalf("outcome %q, want conflicting", resolution.Outcome)
	}
	if resolution.CustomerID == "" || resolution.ConflictWith == "" ||
		resolution.CustomerID == resolution.ConflictWith {
		t.Fatalf("conflict did not name two distinct candidates: %+v", resolution)
	}
	if resolution.DiagnosticCode == "" {
		t.Fatal("a conflict must carry a diagnostic an operator can act on")
	}
}

// The resolver must be deterministic and order-independent, or a replay could
// reach a different owner for the same purchase than the original run did.
func TestResolutionIsOrderIndependent(t *testing.T) {
	correlator := AliasDigest(AliasGoogleObfuscatedAcount, "obf-1")
	aliases := map[string]string{string(correlator): "bcu_correlator"}
	observations := []Observation{
		{EvidenceType: EvidenceAppAccountToken, Digest: correlator, AliasType: AliasGoogleObfuscatedAcount},
		{EvidenceType: EvidencePriorLineage, CustomerID: "bcu_prior"},
		{EvidenceType: EvidenceInstallation, Digest: []byte("ignored")},
	}
	reversed := []Observation{observations[2], observations[1], observations[0]}

	forward := Resolve(observations, aliases)
	backward := Resolve(reversed, aliases)
	if forward.Outcome != backward.Outcome || forward.CustomerID != backward.CustomerID {
		t.Fatalf("resolution depends on input order: %+v vs %+v", forward, backward)
	}
	// A prior accepted association outranks a bare correlator.
	if forward.CustomerID != "bcu_prior" {
		t.Fatalf("resolved to %q, want the prior lineage association", forward.CustomerID)
	}
}

// Alias digests are domain-separated by type. Without that, one person's
// application user id colliding with another's store correlator would collapse
// two people into one active resolution.
func TestAliasDigestIsDomainSeparatedByType(t *testing.T) {
	value := "same-value"
	if string(AliasDigest(AliasApplicationUser, value)) == string(AliasDigest(AliasInstallation, value)) {
		t.Fatal("the same value digests identically across alias types")
	}
	if string(AliasDigest(AliasApplicationUser, value)) != string(AliasDigest(AliasApplicationUser, value)) {
		t.Fatal("alias digest is not stable")
	}
}

// A Google lineage is keyed by the root of its token chain. Keying by the
// current token instead would mint a new lineage on every plan change and
// fragment one subscription's history into unconnected pieces.
func TestChainWalkFindsRootAndSurvivesCycles(t *testing.T) {
	root, middle, latest := []byte("root"), []byte("middle"), []byte("latest")
	links := []ChainLink{
		{ChainDigest: latest, SupersedesDigest: middle},
		{ChainDigest: middle, SupersedesDigest: root},
	}
	if got := WalkChainRoot(latest, links); string(got) != "root" {
		t.Fatalf("chain root %q, want root", got)
	}

	// Provider data cannot contain a cycle; if one appears the data is already
	// wrong and the walk must terminate rather than hang.
	cyclic := []ChainLink{
		{ChainDigest: []byte("a"), SupersedesDigest: []byte("b")},
		{ChainDigest: []byte("b"), SupersedesDigest: []byte("a")},
	}
	if got := WalkChainRoot([]byte("a"), cyclic); len(got) == 0 {
		t.Fatal("cyclic chain walk produced no root")
	}
}
