// Package billingmigrationvalidation adapts Phase 9C known provider references
// to the existing Phase 9A intake/validation pipeline.
package billingmigrationvalidation

import (
	"context"
	"crypto/sha256"
	"sort"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type ValidationService interface {
	AcceptMigrationValidation(context.Context, billing.MigrationValidationRequest) (billing.MigrationValidationAcceptance, error)
	MigrationValidationOutcome(context.Context, string, string, string) (billing.MigrationValidationBinding, error)
}

type Adapter struct{ validation ValidationService }

func New(validation ValidationService) *Adapter { return &Adapter{validation: validation} }

var _ billingmigration.ProviderEvidenceImporter = (*Adapter)(nil)

func (a *Adapter) RevalidateKnownReferences(ctx context.Context, projectID, programID string, references []billingmigration.KnownProviderReference) (billingmigration.ProviderEvidenceResult, error) {
	result := billingmigration.ProviderEvidenceResult{}
	digests := make([][]byte, 0, len(references))
	for _, ref := range references {
		acceptance, err := a.validation.AcceptMigrationValidation(ctx, billing.MigrationValidationRequest{
			ProgramID: programID, ProjectID: projectID, EnvironmentID: ref.EnvironmentID, ApplicationID: ref.ApplicationID,
			Provider: ref.Provider, ReferenceKind: ref.ReferenceKind, Reference: ref.Reference,
			ExpectedStoreProductIdentifier: ref.ExpectedStoreProductID, ExpectedMosaicProductID: ref.TargetProductID,
			ExpectedStoreEnvironment: ref.ExpectedStoreEnvironment,
		})
		if err != nil {
			return result, err
		}
		outcome, err := a.validation.MigrationValidationOutcome(ctx, projectID, programID, acceptance.BindingID)
		if err != nil {
			return result, err
		}
		switch outcome.Status {
		case billing.MigrationValidationAccepted:
			result.Accepted++
		case billing.MigrationValidationValidated:
			result.Validated++
			digests = append(digests, outcome.EvidenceDigest)
			if outcome.ProviderWatermark.After(result.ProviderWatermark) {
				result.ProviderWatermark = outcome.ProviderWatermark
			}
		case billing.MigrationValidationQuarantined:
			result.Quarantined++
			digests = append(digests, outcome.EvidenceDigest)
			if outcome.ProviderWatermark.After(result.ProviderWatermark) {
				result.ProviderWatermark = outcome.ProviderWatermark
			}
		default:
			return result, billingmigration.ErrInvalid
		}
	}
	result.EvidenceDigest = evidenceDigest(digests)
	if result.Accepted > 0 {
		return result, billingmigration.ErrValidationPending
	}
	return result, nil
}

func evidenceDigest(digests [][]byte) []byte {
	if len(digests) == 0 {
		sum := sha256.Sum256([]byte("mosaic-billing-migration-validation-pending-v1"))
		return sum[:]
	}
	sort.Slice(digests, func(i, j int) bool { return string(digests[i]) < string(digests[j]) })
	h := sha256.New()
	_, _ = h.Write([]byte("mosaic-billing-migration-validation-result-v1"))
	for _, digest := range digests {
		_, _ = h.Write([]byte{0})
		_, _ = h.Write(digest)
	}
	return h.Sum(nil)
}
