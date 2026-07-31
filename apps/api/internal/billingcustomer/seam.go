package billingcustomer

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

// FactAttachment is one committed Transaction Fact's claim on an identity.
//
// It carries digests only. The raw correlators were hashed in the validator, at
// the point they were parsed off the provider's authoritative response, and
// nothing in this package has ever been in a position to see one.
type FactAttachment struct {
	ProjectID     string
	EnvironmentID string
	Provider      string
	// LineageKeyDigest is the chain root the fact-commit transaction keyed the
	// lineage on.
	LineageKeyDigest []byte
	// FactChainDigest is the fact's *own* chain digest, which differs from the
	// root when the purchase chain has been handed a new provider token.
	FactChainDigest []byte
	RawInputID      string
	// ReferenceDigests are the transaction-reference digests under which a
	// submitted observation may have recorded submission-context evidence.
	ReferenceDigests [][]byte
	// Correlators are the hashed provider correlators, in the evidence
	// vocabulary.
	Correlators []AttachmentCorrelator
	ObservedAt  time.Time
}

// AttachmentCorrelator is one hashed provider correlator.
type AttachmentCorrelator struct {
	EvidenceType string
	AliasType    string
	Digest       []byte
}

// provesPossession reports whether a submission recorded under `referenceDigest`
// demonstrated possession of the purchase chain's own provider secret.
//
// Only Google qualifies, and the asymmetry is not an oversight. A Google
// transaction reference IS the SHA-256 of the purchase token — an unguessable
// secret the store issued to the purchasing device — so a submission keyed on it
// could only have come from something that held the token. An Apple reference is
// derived from a transaction identifier: a short decimal number, enumerable by
// anyone, which proves nothing about who bought anything. Accepting Apple
// possession as proof would turn adoption into a guessing game against every
// purchase-anchored customer in the Environment.
func (a FactAttachment) provesPossession(referenceDigest []byte) bool {
	if a.Provider != billing.ProviderGooglePlay || len(referenceDigest) == 0 {
		return false
	}
	return SameLineage(referenceDigest, a.LineageKeyDigest) ||
		SameLineage(referenceDigest, a.FactChainDigest)
}

// AttachLineageForFact decides which Billing Customer owns the Purchase Lineage
// a newly committed fact belongs to, and applies the decision.
//
// This is the identity half of the Phase 9A→9B seam. It is the production
// caller `ResolveLineageCustomer`, `RecordSupersession`, and
// `EvidenceForReference` never had (defect D-1).
//
// The evidence ladder is OD-2's, in authority order, and the resolver — not this
// method — decides which rung wins:
//
//  1. Submission-context evidence. An SDK or an application backend that
//     submitted an observation for this transaction while holding a Customer
//     Access Token stated who it belongs to. This is the only thing in a
//     deployed system that can attach a *first* purchase to an identified
//     customer, because a store notification arrives out of band and names
//     nobody.
//  2. Provider correlators — Apple's `appAccountToken`, Google's
//     `obfuscatedExternalAccountId` — matched against alias digests a backend
//     already attached. They rank below a submission because they say the app
//     believed the purchase belonged to someone, not that the store agrees.
//  3. A prior association on the lineage itself, which `ResolveLineageCustomer`
//     contributes. This is why a renewal on an established subscription does
//     not have to re-prove identity.
//  4. Failing all of those, a purchase-anchored Billing Customer is created to
//     hold the purchase (plan §5a rules 1 and 2).
//
// Conflicting evidence takes the existing conflict path: the lineage freezes,
// nobody is granted anything, and an operator resolves it (OD-10(a)).
//
// The whole method is idempotent. Re-running it for the same fact re-reads the
// same evidence, reaches the same verdict, and an association that already names
// the same customer is a no-op — which is what makes it safe to call after the
// fact's own transaction has already committed.
func (s *Service) AttachLineageForFact(ctx context.Context, attachment FactAttachment) (Resolution, error) {
	ctx, span := s.tracer.Start(ctx, "billing.customer.attach_fact")
	defer span.End()

	if err := s.requireEnabled(ctx, attachment.ProjectID); err != nil {
		return Resolution{}, err
	}
	lineage, err := s.repository.LineageByKey(ctx, attachment.EnvironmentID,
		attachment.Provider, attachment.LineageKeyDigest)
	if err != nil {
		// A fact with no lineage is not an error here. The fact-commit
		// transaction creates one for every fact that names a purchase chain, so
		// reaching this means the fact named none.
		if errors.Is(err, ErrNotFound) {
			return Resolution{Outcome: OutcomeUnresolved, DiagnosticCode: "no_lineage_for_fact"}, nil
		}
		return Resolution{}, ErrUnavailable
	}
	span.SetAttributes(attribute.String("mosaic.billing.lineage.id", lineage.ID))

	if lineage.ProjectionFrozen {
		// An operator owns this lineage's identity right now. Adding evidence to
		// a dispute that is already open would neither help them nor change the
		// answer, and re-running the resolver could open a second conflict for
		// the same lineage.
		return Resolution{Outcome: OutcomeConflicting, CustomerID: lineage.BillingCustomerID,
			DiagnosticCode: "lineage_frozen_pending_operator"}, nil
	}

	s.recordChainSupersession(ctx, attachment, lineage)

	observations, err := s.observationsFor(ctx, attachment)
	if err != nil {
		return Resolution{}, err
	}
	resolution, err := s.ResolveLineageCustomer(ctx, attachment.ProjectID, lineage.ID, observations)
	if err != nil {
		return Resolution{}, err
	}
	if resolution.Outcome != OutcomeUnresolved || lineage.BillingCustomerID != "" {
		return resolution, nil
	}
	return s.anchorToNewCustomer(ctx, attachment, lineage)
}

// observationsFor assembles rungs 1 and 2 of the ladder. Rung 3 is contributed
// by ResolveLineageCustomer from the lineage row itself.
func (s *Service) observationsFor(ctx context.Context, attachment FactAttachment) ([]Observation, error) {
	observations := make([]Observation, 0, 4)

	seen := map[string]struct{}{}
	for _, digest := range attachment.ReferenceDigests {
		if len(digest) == 0 {
			continue
		}
		if _, duplicate := seen[string(digest)]; duplicate {
			continue
		}
		seen[string(digest)] = struct{}{}
		entries, err := s.repository.EvidenceForReference(ctx, attachment.ProjectID, digest)
		if err != nil {
			return nil, ErrUnavailable
		}
		possession := attachment.provesPossession(digest)
		for _, entry := range entries {
			// Only evidence that named a customer is a candidate. An entry the
			// resolver already refused, or one recorded for attribution alone,
			// is history rather than a claim.
			if entry.BillingCustomerID == "" || entry.PurchaseLineageID != "" {
				continue
			}
			observations = append(observations, Observation{
				EvidenceType:    entry.EvidenceType,
				CustomerID:      entry.BillingCustomerID,
				RawInputID:      entry.RawInputID,
				PossessionProof: possession,
			})
		}
	}

	for _, correlator := range attachment.Correlators {
		if len(correlator.Digest) == 0 {
			continue
		}
		observations = append(observations, Observation{
			EvidenceType: correlator.EvidenceType,
			AliasType:    correlator.AliasType,
			Digest:       correlator.Digest,
			RawInputID:   attachment.RawInputID,
		})
	}
	return observations, nil
}

// recordChainSupersession records a lineage-level supersession edge when the
// fact's own chain digest already had a lineage of its own that is not the root.
//
// A provider token handover inside one chain is *not* a lineage replacement —
// the projection loader walks those edges forward from the root and the whole
// chain is one lineage — so in the ordinary case there is no edge to record and
// this does nothing. The case it exists for is a link observed late: the
// successor token arrived first and was materialized as its own lineage, and
// only a later fact stated that it supersedes an earlier chain. Both lineages
// then exist, and the earlier one is the root. Nothing is deleted: the
// superseded lineage stops granting access and stays fully visible in history.
//
// A failure here is logged rather than returned. The edge is a refinement of
// history; refusing to attach a customer because it could not be written would
// deny access over a bookkeeping detail.
func (s *Service) recordChainSupersession(ctx context.Context, attachment FactAttachment, root Lineage) {
	if len(attachment.FactChainDigest) == 0 || SameLineage(attachment.FactChainDigest, attachment.LineageKeyDigest) {
		return
	}
	successor, err := s.repository.LineageByKey(ctx, attachment.EnvironmentID,
		attachment.Provider, attachment.FactChainDigest)
	if err != nil || successor.ID == "" || successor.ID == root.ID {
		return
	}
	if successor.SupersededByLineageID == root.ID {
		return
	}
	if err := s.RecordSupersession(ctx, attachment.ProjectID, successor.ID, root.ID); err != nil {
		logSafely(ctx, "purchase lineage supersession edge could not be recorded", map[string]string{
			"project_id": attachment.ProjectID, "purchase_lineage_id": successor.ID,
		})
	}
}

// anchorToNewCustomer creates the Billing Customer a purchase with no
// identifying evidence attaches to (plan §5a rules 1 and 2).
//
// This is the second of exactly two ways a Billing Customer comes into
// existence, and it is what keeps an anonymous purchase from being lost: the
// store confirmed a real transaction, and Mosaic has to be able to answer for it
// on every entitlement surface whether or not anyone has said who bought it.
// Anchoring to the *lineage* rather than to the device is what makes it safe —
// the chain key survives reinstall, clear-data, and device change, so a
// reinstalling customer who restores resolves back to this same customer rather
// than accumulating a new one per install. That is the duplicate-customer trap
// plan §5a exists to avoid, and the reason installation identifiers are evidence
// and never anchors.
//
// When the person is identified later, `AttachApplicationUserAlias` appends the
// alias to this same customer. Login attaches; it never merges.
func (s *Service) anchorToNewCustomer(ctx context.Context, attachment FactAttachment, lineage Lineage) (Resolution, error) {
	now := s.now()
	customerID, err := s.newID("bcu")
	if err != nil {
		return Resolution{}, ErrUnavailable
	}
	customer, err := s.repository.CreateCustomer(ctx, Customer{
		ID: customerID, ProjectID: attachment.ProjectID, Status: StatusActive,
		DiagnosticsStatus: "none", CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		return Resolution{}, ErrUnavailable
	}
	if err := s.repository.AttachLineageCustomer(ctx, attachment.ProjectID, lineage.ID, customer.ID, now); err != nil {
		// The lineage was frozen or removed between the read above and here.
		// The customer row that was just created is left in place rather than
		// deleted: it holds nothing, it grants nothing, and deleting rows on a
		// race is how an audit trail acquires holes.
		return Resolution{}, ErrUnavailable
	}

	evidenceID, err := s.newID("bae")
	if err != nil {
		return Resolution{}, ErrUnavailable
	}
	// No correlator digest, because the whole meaning of this row is that there
	// was no correlator.
	if err := s.repository.RecordEvidence(ctx, Evidence{
		ID: evidenceID, ProjectID: attachment.ProjectID, EnvironmentID: lineage.EnvironmentID,
		PurchaseLineageID: lineage.ID, EvidenceType: EvidencePurchaseAnchor,
		RawInputID: attachment.RawInputID, BillingCustomerID: customer.ID,
		ResolverVersion: ResolverVersion, Outcome: OutcomeResolved,
		DiagnosticCode: "no_identifying_evidence_purchase_anchored",
		ObservedAt:     now, CreatedAt: now,
	}); err != nil {
		return Resolution{}, ErrUnavailable
	}
	_ = s.repository.RecordAudit(ctx, Actor{}, attachment.ProjectID, "billing.customer.created",
		"billing_customer", customer.ID, map[string]string{"creationPath": "purchase_anchor"}, now)
	logSafely(ctx, "billing customer created", map[string]string{
		"project_id": attachment.ProjectID, "billing_customer_id": customer.ID,
		"purchase_lineage_id": lineage.ID, "creation_path": "purchase_anchor",
	})

	// The projection job the fact-commit transaction enqueued was lineage-scoped,
	// because at that moment the lineage had no customer. The aggregate that can
	// actually mint an entitlement snapshot is the customer one, so it is
	// enqueued now.
	if err := s.scheduleReprojection(ctx, attachment.ProjectID, lineage.EnvironmentID, customer.ID); err != nil {
		return Resolution{}, err
	}
	return Resolution{Outcome: OutcomeResolved, CustomerID: customer.ID,
		DiagnosticCode: "purchase_anchored"}, nil
}

// RecordSubmissionEvidence records that an observation was submitted by a caller
// holding a Customer Access Token for a named customer.
//
// It is keyed on the transaction reference rather than on a lineage because at
// submission time no lineage exists: the purchase has not been validated yet.
// `AttachLineageForFact` reads it back through `EvidenceForReference` once the
// fact commits, which is how a first purchase reaches an identified customer.
//
// The authority recorded depends on the credential that authenticated the
// request, and that distinction is the whole point of the parameter.
//
// `trusted_server_observation` (rank 90) is recorded only when the request
// itself was authenticated by the application's secret server key. That key
// lives on a server the application controls, so a submission carrying it is the
// application's own backend speaking.
//
// A request authenticated by the *public SDK key* records
// `token_bound_submission` instead, which ranks below a prior lineage
// association. The public key ships inside every install, so the only thing
// such a request proves is that the caller holds a Customer Access Token — and
// a device that legitimately held one keeps holding it after it stops being that
// person's device. Recording it at rank 90, as this used to, meant anyone able
// to present a token could take an established purchase away from its owner or
// freeze it in an identity conflict. Both were remote denial-of-access
// primitives against a paying customer.
func (s *Service) RecordSubmissionEvidence(ctx context.Context, projectID, environmentID,
	rawInputID, customerID string, referenceDigest []byte, secretServerKey bool) error {

	if err := s.requireEnabled(ctx, projectID); err != nil {
		return err
	}
	if customerID == "" || len(referenceDigest) == 0 {
		return nil
	}
	id, err := s.newID("bae")
	if err != nil {
		return ErrUnavailable
	}
	evidenceType, diagnostic := EvidenceTokenBoundSubmission, "customer_access_token_submission_public_key"
	if secretServerKey {
		evidenceType, diagnostic = EvidenceTrustedServer, "customer_access_token_submission"
	}
	now := s.now()
	return s.repository.RecordEvidence(ctx, Evidence{
		ID: id, ProjectID: projectID, EnvironmentID: environmentID,
		EvidenceType: evidenceType, RawInputID: rawInputID,
		TransactionReferenceDigest: referenceDigest, BillingCustomerID: customerID,
		ResolverVersion: ResolverVersion, Outcome: OutcomeResolved,
		DiagnosticCode: diagnostic,
		ObservedAt:     now, CreatedAt: now,
	})
}
