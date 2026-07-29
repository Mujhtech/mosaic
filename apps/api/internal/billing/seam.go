package billing

import (
	"context"
	"time"
)

// This file is the Phase 9A → Phase 9B seam, expressed as two ports.
//
// Phase 9A ends with a validated Transaction Fact in an append-only ledger.
// Phase 9B begins with a Purchase Lineage that a Billing Customer owns. Nothing
// used to join those two halves: `LocateLineage`, `ResolveLineageCustomer`,
// `RecordSupersession`, and `EvidenceForReference` all existed and all had zero
// production callers, so in a deployed system a purchase produced no lineage, no
// instance, no association, no projection, and no answer on any entitlement
// surface. That was defect D-1.
//
// The seam is two steps, in two different places, for a reason:
//
//   - The *structural* half — the lineage row and the projection instance it
//     owns — is written inside the same transaction that records the fact, in
//     the repository. It is a deterministic function of the fact's own chain
//     digest, it decides nothing, and it must be exactly as durable as the fact,
//     because the projection trigger is written in that transaction too.
//
//   - The *identity* half — which customer owns the lineage — is a decision, so
//     it belongs to the identity application service and runs after the commit
//     through the port below. It is idempotent: locating the lineage re-reads
//     the row the transaction created, and an association that already names the
//     same customer is a no-op.
//
// The ports live here rather than in the identity module because the direction
// of dependency has to be this way round: the identity module already imports
// this one, so this one may not import it back.

// LineageBinder decides which Billing Customer owns the Purchase Lineage a
// newly committed fact belongs to.
//
// Implemented by an adapter over the billing identity application service. When
// no binder is wired the validator records facts exactly as Phase 9A did and
// says so once at startup, so a deployment that has not finished wiring 9B
// degrades to 9A rather than failing.
type LineageBinder interface {
	BindFact(ctx context.Context, binding FactBinding) error
}

// FactBinding is everything the identity module needs to attach one lineage,
// and nothing more. In particular it carries no raw correlator and no provider
// token: the digests were taken in the validator.
type FactBinding struct {
	ProjectID     string
	EnvironmentID string
	Provider      string
	// FactChainDigest is the fact's own chain digest. It differs from the
	// lineage key when the provider has handed the purchase chain a new token,
	// and the difference is what a lineage-level supersession edge is derived
	// from.
	FactChainDigest []byte
	// LineageKeyDigest is the *root* of the provider purchase chain, already
	// resolved by walking supersession edges backwards. It is the fact's own
	// digest domain, which is the one every fact-to-lineage join compares.
	LineageKeyDigest []byte
	// RawInputID is the input whose validation produced the fact. It is recorded
	// on the evidence so a decision can be traced back to what triggered it.
	RawInputID string
	// ReferenceDigests are every transaction-reference digest that could name
	// this transaction, used to find submission-context evidence recorded when a
	// device or a backend submitted an observation for it. There is more than
	// one because a client observation cannot state a Store Environment and is
	// therefore recorded under `unclassified`, while a notification is recorded
	// under the environment the store confirmed.
	ReferenceDigests [][]byte
	// Correlators are the hashed provider correlators from the authoritative
	// response.
	Correlators []AssociationCorrelator
	// AcquiredAt dates the purchase for the one-time instance row.
	AcquiredAt time.Time
}

// SubmissionBinder records the association a submitted observation carries.
//
// An SDK or an application backend that submits an observation while holding a
// Customer Access Token is stating "this transaction belongs to the customer
// this token names". That statement is the only thing in a deployed system that
// can attach a *first* purchase to an identified customer: a store notification
// arrives out of band and names nobody, and the observation contract carries no
// customer member. The token is the assertion, and it is trustworthy because
// only the application's own backend can mint one.
//
// The evidence is keyed on the transaction reference rather than on a lineage,
// because at submission time no lineage exists yet — the purchase has not been
// validated. `EvidenceForReference` is how the seam finds it later.
type SubmissionBinder interface {
	// BindSubmission authenticates the Customer Access Token and records the
	// evidence. An empty token is not an error: most observations carry none.
	// It returns the customer the token named, or "" when there was no token.
	BindSubmission(ctx context.Context, token string, submission SubmissionBinding) (string, error)
}

// SubmissionBinding names one submitted observation.
type SubmissionBinding struct {
	ProjectID     string
	EnvironmentID string
	RawInputID    string
	// TransactionReferenceDigest is the reference the observation named. It is
	// the join key the seam reads back.
	TransactionReferenceDigest []byte
	ObservedAt                 time.Time
}
