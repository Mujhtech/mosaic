package billingmigrationpostgres

import (
	"bytes"
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

var _ billingmigration.CapabilityAssessmentRepository = (*Repository)(nil)

func (r *Repository) AppendCapabilityAssessment(ctx context.Context, command billingmigration.CapabilityAssessmentAppend) (billingmigration.CapabilityAssessment, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.CapabilityAssessment{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	assessment, appended, err := appendCapabilityAssessmentTx(ctx, tx, command)
	if err != nil {
		return assessment, appended, err
	}
	if err = tx.Commit(ctx); err != nil {
		return assessment, appended, err
	}
	return assessment, appended, nil
}

func appendCapabilityAssessmentTx(ctx context.Context, tx pgx.Tx, command billingmigration.CapabilityAssessmentAppend) (billingmigration.CapabilityAssessment, bool, error) {
	capabilities, err := billingmigration.NormalizeSourceCapabilities(command.Capabilities)
	if err != nil || command.AssessmentID == "" || len(command.SourceEvidenceDigest) != 32 || len(command.AssessmentDigest) != 32 {
		return billingmigration.CapabilityAssessment{}, false, billingmigration.ErrInvalid
	}
	expected := billingmigration.SourceCapabilityAssessmentDigest(command.ProgramID, command.ProjectID, command.StateVersion, command.ProviderAPIVersion, capabilities, command.SourceEvidenceDigest)
	if !bytes.Equal(expected, command.AssessmentDigest) {
		return billingmigration.CapabilityAssessment{}, false, billingmigration.ErrStaleDigest
	}
	var currentVersion int64
	if err = tx.QueryRow(ctx, `SELECT state_version FROM billing_migration_programs WHERE id=$1 AND project_id=$2 FOR UPDATE`, command.ProgramID, command.ProjectID).Scan(&currentVersion); errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.CapabilityAssessment{}, false, billingmigration.ErrNotFound
	} else if err != nil {
		return billingmigration.CapabilityAssessment{}, false, err
	}
	if currentVersion != command.StateVersion {
		return billingmigration.CapabilityAssessment{}, false, billingmigration.ErrStaleState
	}
	var latest billingmigration.CapabilityAssessment
	err = tx.QueryRow(ctx, `SELECT state_version,provider_api_version,capabilities,assessed_at FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 ORDER BY assessed_at DESC,id DESC LIMIT 1`, command.ProgramID, command.ProjectID).Scan(&latest.StateVersion, &latest.ProviderAPIVersion, &latest.Capabilities, &latest.AssessedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.CapabilityAssessment{}, false, err
	}
	if err == nil && !strictCapabilitySuperset(capabilities, latest.Capabilities) {
		latest.ProgramID, latest.Adapter = command.ProgramID, billingmigration.AdapterRevenueCat
		return latest, false, nil
	}
	var assessedAt time.Time
	tag, err := tx.Exec(ctx, `INSERT INTO billing_migration_capability_assessments(id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) ON CONFLICT(program_id,assessment_digest) DO NOTHING`, command.AssessmentID, command.ProgramID, command.ProjectID, command.StateVersion, command.ProviderAPIVersion, capabilities, command.AssessmentDigest)
	if err != nil {
		return billingmigration.CapabilityAssessment{}, false, translate(err, "append migration capability assessment")
	}
	if tag.RowsAffected() == 0 {
		err = tx.QueryRow(ctx, `SELECT assessed_at FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2 AND assessment_digest=$3`, command.ProgramID, command.ProjectID, command.AssessmentDigest).Scan(&assessedAt)
	} else {
		err = tx.QueryRow(ctx, `SELECT assessed_at FROM billing_migration_capability_assessments WHERE id=$1 AND program_id=$2 AND project_id=$3`, command.AssessmentID, command.ProgramID, command.ProjectID).Scan(&assessedAt)
	}
	if err != nil {
		return billingmigration.CapabilityAssessment{}, false, err
	}
	return billingmigration.CapabilityAssessment{ProgramID: command.ProgramID, StateVersion: command.StateVersion, Adapter: billingmigration.AdapterRevenueCat, ProviderAPIVersion: command.ProviderAPIVersion, Capabilities: capabilities, AssessedAt: assessedAt}, tag.RowsAffected() == 1, nil
}

func strictCapabilitySuperset(candidate, baseline []string) bool {
	if len(candidate) <= len(baseline) {
		return false
	}
	seen := make(map[string]bool, len(candidate))
	for _, capability := range candidate {
		seen[capability] = true
	}
	for _, capability := range baseline {
		if !seen[capability] {
			return false
		}
	}
	return true
}
