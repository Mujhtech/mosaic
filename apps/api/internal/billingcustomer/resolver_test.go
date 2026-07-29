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

// Adoption moves an already-granting purchase, so each accepted proof needs a
// pinning test. These cases protect against weakening Apple reference handling
// to match Google's bearer-grade token semantics.
func TestOwnershipProofForAnchorAdoption(t *testing.T) {
	appleCorrelator := AliasDigest(AliasAppleAppAccountToken, "apple-account-token")
	googleCorrelator := AliasDigest(AliasGoogleObfuscatedAcount, "google-account")
	tests := []struct {
		name         string
		observations []Observation
		aliases      map[string]string
		wantProof    string
		wantProven   bool
	}{
		{
			name: "google purchase token possession",
			observations: []Observation{{EvidenceType: EvidenceTokenBoundSubmission,
				CustomerID: "bcu_person", PossessionProof: true}},
			wantProof: ProofPurchaseTokenPossession, wantProven: true,
		},
		{
			name:         "google provider correlator",
			observations: []Observation{{EvidenceType: EvidenceObfuscatedAccount, Digest: googleCorrelator}},
			aliases:      map[string]string{string(googleCorrelator): "bcu_person"},
			wantProof:    ProofProviderCorrelator, wantProven: true,
		},
		{
			name:         "apple provider correlator",
			observations: []Observation{{EvidenceType: EvidenceAppAccountToken, Digest: appleCorrelator}},
			aliases:      map[string]string{string(appleCorrelator): "bcu_person"},
			wantProof:    ProofProviderCorrelator, wantProven: true,
		},
		{
			name:         "secret server submission",
			observations: []Observation{{EvidenceType: EvidenceTrustedServer, CustomerID: "bcu_person"}},
			wantProof:    ProofTrustedServer, wantProven: true,
		},
		{
			name: "apple transaction reference possession is not proof",
			observations: []Observation{{EvidenceType: EvidenceTokenBoundSubmission,
				CustomerID: "bcu_person", PossessionProof: false}},
			wantProven: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			proof, proven := OwnershipProof(test.observations, test.aliases, "bcu_person")
			if proven != test.wantProven || proof != test.wantProof {
				t.Fatalf("proof = %q/%v, want %q/%v", proof, proven, test.wantProof, test.wantProven)
			}
		})
	}
}
