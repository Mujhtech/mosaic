package billingmigrationrepair

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

var _ RepairStore = (*PostgresStore)(nil)

func (s *PostgresStore) ProgramProject(ctx context.Context, programID string) (string, error) {
	if s == nil || s.pool == nil {
		return "", billingmigration.ErrUnavailable
	}
	var projectID string
	err := s.pool.QueryRow(ctx, `SELECT project_id FROM billing_migration_programs WHERE id=$1`, programID).Scan(&projectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billingmigration.ErrNotFound
	}
	return projectID, err
}

func (s *PostgresStore) ProviderReference(ctx context.Context, programID, sourceRecordID string) (ProviderReferenceEvidence, error) {
	if s == nil || s.pool == nil {
		return ProviderReferenceEvidence{}, billingmigration.ErrUnavailable
	}
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT
		b.project_id,r.provider,r.environment_id,r.application_id,r.provider_reference,r.reference_kind,
		coalesce(r.source_product_identifier,''),coalesce(r.mosaic_product_id,''),
		coalesce(r.expected_store_product_identifier,''),r.expected_store_environment,sr.record_digest
		FROM billing_migration_import_batch_records r
		JOIN billing_migration_import_batches b ON b.id=r.import_batch_id AND b.program_id=r.program_id AND b.project_id=r.project_id
		JOIN billing_migration_source_records sr ON sr.id=r.source_record_id AND sr.program_id=r.program_id AND sr.project_id=r.project_id
		WHERE r.program_id=$1 AND r.source_record_id=$2`, programID, sourceRecordID)
	if err != nil {
		return ProviderReferenceEvidence{}, err
	}
	defer rows.Close()
	items := make([]ProviderReferenceEvidence, 0, 2)
	for rows.Next() {
		var item ProviderReferenceEvidence
		err = rows.Scan(&item.ProjectID, &item.Reference.Provider, &item.Reference.EnvironmentID, &item.Reference.ApplicationID,
			&item.Reference.Reference, &item.Reference.ReferenceKind, &item.Reference.SourceProductID,
			&item.Reference.TargetProductID, &item.Reference.ExpectedStoreProductID,
			&item.Reference.ExpectedStoreEnvironment, &item.Digest)
		if err != nil {
			return ProviderReferenceEvidence{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ProviderReferenceEvidence{}, err
	}
	if len(items) == 0 {
		return ProviderReferenceEvidence{}, billingmigration.ErrNotFound
	}
	if len(items) != 1 {
		return ProviderReferenceEvidence{}, billingmigration.ErrUnavailable
	}
	if len(items[0].Digest) != sha256DigestBytes {
		return ProviderReferenceEvidence{}, billingmigration.ErrInvalid
	}
	return items[0], nil
}

func (s *PostgresStore) QuarantinedSourceReference(ctx context.Context, programID, sourceRecordID string) (ProviderReferenceEvidence, error) {
	if s == nil || s.pool == nil {
		return ProviderReferenceEvidence{}, billingmigration.ErrUnavailable
	}
	evidence, err := s.ProviderReference(ctx, programID, sourceRecordID)
	if err != nil {
		return ProviderReferenceEvidence{}, err
	}
	digest, err := providerReferenceDigest(evidence.Reference)
	if err != nil {
		return ProviderReferenceEvidence{}, err
	}
	var terminalDigest []byte
	err = s.pool.QueryRow(ctx, `SELECT evidence_digest FROM billing_migration_validation_bindings
		WHERE program_id=$1 AND project_id=$2 AND provider=$3 AND reference_kind=$4
		  AND reference_digest=$5 AND status='quarantined'`,
		programID, evidence.ProjectID, evidence.Reference.Provider, evidence.Reference.ReferenceKind, digest).Scan(&terminalDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProviderReferenceEvidence{}, billingmigration.ErrRollbackPrerequisite
	}
	if err != nil {
		return ProviderReferenceEvidence{}, err
	}
	if len(terminalDigest) != sha256DigestBytes {
		return ProviderReferenceEvidence{}, billingmigration.ErrInvalid
	}
	evidence.Digest = terminalDigest
	return evidence, nil
}

func (s *PostgresStore) MappingReplacement(ctx context.Context, programID, mappingSetID string) (MappingReplacementEvidence, error) {
	if s == nil || s.pool == nil {
		return MappingReplacementEvidence{}, billingmigration.ErrUnavailable
	}
	var latestID, candidateID, projectID string
	var latestDigest, candidateDigest []byte
	err := s.pool.QueryRow(ctx, `SELECT id,project_id,mapping_digest FROM billing_migration_mapping_sets
		WHERE program_id=$1 AND status='frozen' ORDER BY version DESC LIMIT 1`, programID).
		Scan(&latestID, &projectID, &latestDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingReplacementEvidence{}, billingmigration.ErrRollbackPrerequisite
	}
	if err != nil {
		return MappingReplacementEvidence{}, err
	}
	err = s.pool.QueryRow(ctx, `SELECT id,project_id,mapping_digest FROM billing_migration_mapping_sets
		WHERE program_id=$1 AND id=$2 AND status='frozen'`, programID, mappingSetID).
		Scan(&candidateID, &projectID, &candidateDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return MappingReplacementEvidence{}, billingmigration.ErrRollbackPrerequisite
	}
	if err != nil {
		return MappingReplacementEvidence{}, err
	}
	if candidateID != latestID {
		return MappingReplacementEvidence{}, billingmigration.ErrRollbackPrerequisite
	}
	var affected int
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM (
		SELECT id FROM billing_migration_run_jobs WHERE program_id=$1
		UNION ALL SELECT id FROM billing_migration_readiness_assessments WHERE program_id=$1
		UNION ALL SELECT id FROM billing_migration_checkpoints WHERE program_id=$1
		UNION ALL SELECT id FROM billing_migration_approvals WHERE program_id=$1
	)x`, programID).Scan(&affected)
	if err != nil {
		return MappingReplacementEvidence{}, err
	}
	before := candidateDigest
	var boundDigest []byte
	err = s.pool.QueryRow(ctx, `SELECT mapping_digest FROM (
		SELECT mapping_digest,completed_at AS at,id FROM billing_migration_runs WHERE program_id=$1
		UNION ALL SELECT mapping_digest,completed_at AS at,id FROM billing_migration_final_deltas WHERE program_id=$1
		UNION ALL SELECT mapping_digest,created_at AS at,id FROM billing_migration_run_jobs WHERE program_id=$1
		UNION ALL SELECT mapping_digest,created_at AS at,id FROM billing_migration_final_delta_jobs WHERE program_id=$1
		UNION ALL SELECT mapping.mapping_digest,pull.created_at AS at,pull.id FROM billing_migration_source_pull_jobs pull JOIN billing_migration_mapping_sets mapping ON mapping.id=pull.mapping_set_id AND mapping.program_id=pull.program_id AND mapping.project_id=pull.project_id WHERE pull.program_id=$1
		UNION ALL SELECT mapping.mapping_digest,batch.created_at AS at,batch.id FROM billing_migration_import_batches batch JOIN billing_migration_mapping_sets mapping ON mapping.id=batch.mapping_set_id AND mapping.program_id=batch.program_id AND mapping.project_id=batch.project_id WHERE batch.program_id=$1
		UNION ALL SELECT mapping_digest,proposed_at AS at,id FROM billing_migration_cutover_proposals WHERE program_id=$1
		UNION ALL SELECT mapping_digest,created_at AS at,id FROM billing_migration_checkpoints WHERE program_id=$1
	) bound ORDER BY at DESC,id DESC LIMIT 1`, programID).Scan(&boundDigest)
	if err == nil {
		before = boundDigest
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return MappingReplacementEvidence{}, err
	}
	return MappingReplacementEvidence{
		ProjectID: projectID, CurrentMappingID: latestID, NextMappingID: candidateID,
		BeforeDigest: before, AfterDigest: candidateDigest, AffectedCount: affected,
	}, nil
}

func (s *PostgresStore) ProvenAlias(ctx context.Context, programID, mappingEntryID string) (ProvenAliasEvidence, error) {
	if s == nil || s.pool == nil {
		return ProvenAliasEvidence{}, billingmigration.ErrUnavailable
	}
	var evidence ProvenAliasEvidence
	var sourceIdentifier string
	err := s.pool.QueryRow(ctx, `SELECT e.project_id,e.id,e.target_id,e.source_identifier,m.mapping_digest
		FROM billing_migration_mapping_entries e
		JOIN billing_migration_mapping_sets m ON m.id=e.mapping_set_id AND m.program_id=e.program_id AND m.project_id=e.project_id
		JOIN billing_customers c ON c.id=e.target_id AND c.project_id=e.project_id AND c.status='active'
		WHERE e.program_id=$1 AND e.id=$2 AND e.source_kind='audited_alias'
		  AND e.match_kind='audited_alias' AND m.status='frozen'`, programID, mappingEntryID).
		Scan(&evidence.ProjectID, &evidence.MappingEntryID, &evidence.BillingCustomerID, &sourceIdentifier, &evidence.Digest)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProvenAliasEvidence{}, billingmigration.ErrRollbackPrerequisite
	}
	if err != nil {
		return ProvenAliasEvidence{}, err
	}
	aliasValue := strings.TrimPrefix(sourceIdentifier, applicationUserAliasPrefix)
	if aliasValue == "" || aliasValue == sourceIdentifier {
		return ProvenAliasEvidence{}, billingmigration.ErrUnavailable
	}
	evidence.ApplicationUserID = aliasValue
	return evidence, nil
}

func (s *PostgresStore) ActiveApplicationAliasCustomer(ctx context.Context, projectID string, digest []byte) (string, error) {
	if s == nil || s.pool == nil {
		return "", billingmigration.ErrUnavailable
	}
	var customerID string
	err := s.pool.QueryRow(ctx, `SELECT billing_customer_id FROM billing_customer_aliases
		WHERE project_id=$1 AND alias_type=$2 AND alias_digest=$3 AND effective_end IS NULL`,
		projectID, billingcustomer.AliasApplicationUser, digest).Scan(&customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return customerID, err
}

func (s *PostgresStore) AttachApplicationAlias(ctx context.Context, executionID string, evidence ProvenAliasEvidence, digest []byte) ([]byte, error) {
	if s == nil || s.pool == nil {
		return nil, billingmigration.ErrUnavailable
	}
	if executionID == "" || len(digest) != sha256DigestBytes || evidence.ProjectID == "" || evidence.BillingCustomerID == "" || evidence.ApplicationUserID == "" {
		return nil, billingmigration.ErrInvalid
	}
	aliasID := deterministicID("bca", executionID, evidence.MappingEntryID, evidence.ProjectID, evidence.BillingCustomerID)
	now := time.Now().UTC()
	_, err := s.pool.Exec(ctx, `INSERT INTO billing_customer_aliases(
		id,project_id,billing_customer_id,alias_type,alias_digest,source_authority,verification_status,effective_start,created_at)
		VALUES($1,$2,$3,$4,$5,'operator','verified',$6,$6)
		ON CONFLICT(id) DO NOTHING`,
		aliasID, evidence.ProjectID, evidence.BillingCustomerID, billingcustomer.AliasApplicationUser, digest, now)
	if err != nil {
		return nil, err
	}
	var storedCustomerID string
	var storedDigest []byte
	err = s.pool.QueryRow(ctx, `SELECT billing_customer_id,alias_digest FROM billing_customer_aliases
		WHERE id=$1 AND project_id=$2 AND alias_type=$3 AND effective_end IS NULL`,
		aliasID, evidence.ProjectID, billingcustomer.AliasApplicationUser).Scan(&storedCustomerID, &storedDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, billingmigration.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if storedCustomerID != evidence.BillingCustomerID || string(storedDigest) != string(digest) {
		return nil, billingmigration.ErrConflict
	}
	return hashStrings("mosaic-migration-repair-alias-attached-v1", aliasID, evidence.MappingEntryID, string(digest)), nil
}

func providerReferenceDigest(reference billingmigration.KnownProviderReference) ([]byte, error) {
	switch {
	case reference.Provider == billing.ProviderAppStore && reference.ReferenceKind == billing.ReferenceAppStoreTransactionID:
		return billing.AppleTransactionKey(billing.StoreUnclassified, reference.Reference), nil
	case reference.Provider == billing.ProviderGooglePlay && reference.ReferenceKind == "google_play_purchase_token":
		return billing.TokenDigest(reference.Reference), nil
	case reference.Provider == billing.ProviderGooglePlay && reference.ReferenceKind == billing.ReferenceGooglePlayOrderID:
		sum := sha256.Sum256([]byte("mosaic-billing-google-order-v1\x00" + reference.Reference))
		return sum[:], nil
	default:
		return nil, billingmigration.ErrInvalid
	}
}
