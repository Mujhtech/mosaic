// Package billingseam adapts the Phase 9B billing identity application service
// to the two ports the Phase 9A ingestion module declares.
//
// It exists so neither module has to import the other in the wrong direction.
// The identity module already depends on the ingestion module for digest
// domains and provider vocabulary, so the ingestion module declares interfaces
// (`billing.LineageBinder`, `billing.SubmissionBinder`) and this package
// satisfies them. Nothing here makes a decision: every rule about which customer
// owns a lineage lives in `billingcustomer`, and every rule about what a
// Customer Access Token proves lives in `billingaccess`.
package billingseam

import (
	"context"
	"errors"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// Identity is the slice of the billing identity service this adapter needs.
type Identity interface {
	AttachLineageForFact(ctx context.Context, attachment billingcustomer.FactAttachment) (billingcustomer.Resolution, error)
	RecordSubmissionEvidence(ctx context.Context, projectID, environmentID, rawInputID, customerID string, referenceDigest []byte, secretServerKey bool) error
}

// Tokens is the slice of the entitlement access service this adapter needs: the
// authority on what a Customer Access Token proves.
type Tokens interface {
	AuthenticateCustomerTokenForTenant(ctx context.Context, rawToken, projectID, environmentID string) (billingaccess.Token, error)
}

// Binder implements both seam ports.
type Binder struct {
	identity Identity
	tokens   Tokens
}

func New(identity Identity, tokens Tokens) *Binder {
	return &Binder{identity: identity, tokens: tokens}
}

var (
	_ billing.LineageBinder    = (*Binder)(nil)
	_ billing.SubmissionBinder = (*Binder)(nil)
)

// BindFact hands a committed fact's lineage to the identity service.
func (b *Binder) BindFact(ctx context.Context, binding billing.FactBinding) error {
	if b == nil || b.identity == nil || len(binding.LineageKeyDigest) == 0 {
		return nil
	}
	correlators := make([]billingcustomer.AttachmentCorrelator, 0, len(binding.Correlators))
	for _, correlator := range binding.Correlators {
		correlators = append(correlators, billingcustomer.AttachmentCorrelator{
			EvidenceType: correlator.EvidenceType,
			AliasType:    correlator.AliasType,
			Digest:       correlator.Digest,
		})
	}
	observedAt := binding.AcquiredAt
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	_, err := b.identity.AttachLineageForFact(ctx, billingcustomer.FactAttachment{
		ProjectID:        binding.ProjectID,
		EnvironmentID:    binding.EnvironmentID,
		Provider:         binding.Provider,
		LineageKeyDigest: binding.LineageKeyDigest,
		FactChainDigest:  binding.FactChainDigest,
		RawInputID:       binding.RawInputID,
		ReferenceDigests: binding.ReferenceDigests,
		Correlators:      correlators,
		ObservedAt:       observedAt,
	})
	if errors.Is(err, billingcustomer.ErrBillingDisabled) {
		// The Project turned billing off between the fact being recorded and the
		// association being decided. There is no identity to hold and nothing to
		// report: the fact stands, exactly as Phase 9A leaves it.
		return nil
	}
	return err
}

// BindSubmission records the association a token-bound observation carries.
//
// An absent token is the ordinary case and is not an error. A token that fails
// to authenticate is also not an error *for the submission*: the observation
// itself was authenticated by an API key and is perfectly valid, and refusing to
// record it because an expired token rode along would turn a stale cache on one
// device into a dropped purchase. The submission simply carries no association.
func (b *Binder) BindSubmission(ctx context.Context, token string, submission billing.SubmissionBinding) (string, error) {
	if b == nil || b.identity == nil || b.tokens == nil || token == "" {
		return "", nil
	}
	// The tenant is the one the API key already authenticated, so a token minted
	// for another Project or Environment is refused rather than used: attaching
	// a purchase across that boundary would be a route to writing evidence about
	// someone else's customer.
	authenticated, err := b.tokens.AuthenticateCustomerTokenForTenant(ctx, token,
		submission.ProjectID, submission.EnvironmentID)
	if err != nil {
		return "", nil
	}
	customerID := authenticated.CustomerID
	if customerID == "" {
		return "", nil
	}
	if err := b.identity.RecordSubmissionEvidence(ctx, submission.ProjectID, submission.EnvironmentID,
		submission.RawInputID, customerID, submission.TransactionReferenceDigest,
		submission.SecretServerKey); err != nil {
		if errors.Is(err, billingcustomer.ErrBillingDisabled) {
			return "", nil
		}
		return "", err
	}
	return customerID, nil
}
