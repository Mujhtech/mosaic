package billingmigrationevaluation

import (
	"bytes"
	"context"
	"sort"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type importEvidence struct {
	applicationID, provider, reference, referenceKind       string
	expectedStoreEnvironment                                string
	sourceRecordID, expectedStoreProductID, mosaicProductID string
}

type cohortRecord struct {
	scope                                         evaluationScope
	recordID, sourceID                            string
	digest                                        []byte
	targets                                       []string
	currentAccess                                 bool
	providerEnvironment, expectedStoreEnvironment string
}

// loadEvidence accepts only facts produced by a terminal validated Package E
// binding whose frozen expectations still match the current-manifest import
// row. Missing, quarantined, or mismatched evidence becomes a blocking
// divergence and is never offered to the projection engine.
func (b *Builder) loadEvidence(ctx context.Context, lease billingmigration.ExecutionLease, frozen frozenProgram) ([]cohortItem, []billingmigration.DivergenceWrite, time.Time, []byte, map[string]map[string]bool, error) {
	rows, err := b.pool.Query(ctx, `SELECT r.source_record_id,r.application_id,r.provider,r.provider_reference,r.reference_kind,
		coalesce(r.expected_store_product_identifier,''),coalesce(r.mosaic_product_id,''),r.expected_store_environment
		FROM billing_migration_import_batch_records r
		JOIN billing_migration_import_batches batch ON batch.id=r.import_batch_id AND batch.program_id=r.program_id AND batch.project_id=r.project_id
		WHERE r.program_id=$1 AND r.project_id=$2 AND batch.manifest_id=$3
		ORDER BY r.application_id,r.ordinal,r.source_record_id`, lease.ProgramID, lease.ProjectID, frozen.manifestID)
	if err != nil {
		return nil, nil, time.Time{}, nil, nil, err
	}
	defer rows.Close()
	imports := []importEvidence{}
	for rows.Next() {
		var v importEvidence
		if err = rows.Scan(&v.sourceRecordID, &v.applicationID, &v.provider, &v.reference, &v.referenceKind, &v.expectedStoreProductID, &v.mosaicProductID, &v.expectedStoreEnvironment); err != nil {
			return nil, nil, time.Time{}, nil, nil, err
		}
		imports = append(imports, v)
	}
	if err = rows.Err(); err != nil {
		return nil, nil, time.Time{}, nil, nil, err
	}

	// Facts are admitted by the exact terminal validation attempt, not merely by
	// the raw input. A later retry may append different facts for the same raw
	// input and must not silently change frozen migration evidence.
	allowedAttempts := map[string]map[string]bool{}
	providerWatermark := time.Time{}
	divergences := []billingmigration.DivergenceWrite{}
	terminalEvidence := [][]byte{}
	for _, scope := range frozen.scopes {
		allowedAttempts[scope.applicationID] = map[string]bool{}
	}
	for _, item := range imports {
		digest := migrationReferenceDigest(item.provider, item.referenceKind, item.reference)
		var rawID, validationAttemptID, status, application, storeProduct, mosaicProduct, storeEnvironment string
		var evidence []byte
		var watermark *time.Time
		err = b.pool.QueryRow(ctx, `SELECT raw_input_id,validation_attempt_id,status,expected_application_id,expected_store_product_identifier,expected_mosaic_product_id,expected_store_environment,evidence_digest,provider_watermark
			FROM billing_migration_validation_bindings WHERE program_id=$1 AND project_id=$2 AND provider=$3 AND reference_kind=$4 AND reference_digest=$5`,
			lease.ProgramID, lease.ProjectID, item.provider, item.referenceKind, digest).Scan(&rawID, &validationAttemptID, &status, &application, &storeProduct, &mosaicProduct, &storeEnvironment, &evidence, &watermark)
		valid := err == nil && status == "validated" && validationAttemptID != "" && application == item.applicationID && storeProduct == item.expectedStoreProductID && mosaicProduct == item.mosaicProductID && storeEnvironment == item.expectedStoreEnvironment && len(evidence) == 32 && watermark != nil
		if err == nil && (status == "validated" || status == "quarantined") && len(evidence) == 32 {
			terminalEvidence = append(terminalEvidence, evidence)
			if watermark != nil && watermark.After(providerWatermark) {
				providerWatermark = watermark.UTC()
			}
		}
		if !valid {
			reasonDigest := hash("mosaic-migration-provider-validation-missing-v1", []byte(item.sourceRecordID), digest)
			divergences = append(divergences, newDivergence(lease, "blocking", "provider_validation_missing", reasonDigest, frozen.capturedAt))
			continue
		}
		applicationEvidence, inScope := allowedAttempts[item.applicationID]
		if !inScope {
			reasonDigest := hash("mosaic-migration-authority-scope-conflict-v1", []byte(item.sourceRecordID), []byte(item.applicationID))
			divergences = append(divergences, newDivergence(lease, "blocking", "authority_scope_conflict", reasonDigest, frozen.capturedAt))
			continue
		}
		applicationEvidence[rawID+"\x00"+validationAttemptID] = true
	}
	if providerWatermark.IsZero() {
		providerWatermark = frozen.capturedAt.UTC()
	}

	allowedFacts := map[string]map[string]bool{}
	for _, scope := range frozen.scopes {
		allowedFacts[scope.applicationID] = map[string]bool{}
		if len(allowedAttempts[scope.applicationID]) == 0 {
			continue
		}
		factRows, qerr := b.pool.Query(ctx, `SELECT id,resolution_state,mosaic_product_id IS NOT NULL,source_raw_input_id,validation_attempt_id FROM billing_transaction_facts WHERE project_id=$1 AND environment_id=$2 AND application_id=$3 AND source_raw_input_id IS NOT NULL AND validation_attempt_id IS NOT NULL ORDER BY id`, lease.ProjectID, frozen.environmentID, scope.applicationID)
		if qerr != nil {
			return nil, nil, time.Time{}, nil, nil, qerr
		}
		for factRows.Next() {
			var id, state, rawID, attemptID string
			var resolved bool
			if qerr = factRows.Scan(&id, &state, &resolved, &rawID, &attemptID); qerr != nil {
				factRows.Close()
				return nil, nil, time.Time{}, nil, nil, qerr
			}
			if !allowedAttempts[scope.applicationID][rawID+"\x00"+attemptID] {
				continue
			}
			if resolved && (state == "active_mapping" || state == "archived_mapping" || state == "replacement_chain") {
				allowedFacts[scope.applicationID][id] = true
			} else {
				d := hash("mosaic-migration-unresolved-fact-v1", []byte(scope.applicationID), []byte(id), []byte(state))
				divergences = append(divergences, newDivergence(lease, "blocking", "mapping_missing", d, frozen.capturedAt))
			}
		}
		qerr = factRows.Err()
		factRows.Close()
		if qerr != nil {
			return nil, nil, time.Time{}, nil, nil, qerr
		}
	}

	// Import rows are intentionally absent for source-pull records quarantined
	// before import. Inspect the manifest directly so those current-access
	// records cannot disappear from readiness evidence through an inner join.
	unusableRows, err := b.pool.Query(ctx, `SELECT s.id,s.record_digest,coalesce(r.quarantine_reason,''),coalesce(r.customer_source_identifier,'')
		FROM billing_migration_source_records s
		LEFT JOIN billing_migration_source_record_relationships r ON r.source_record_id=s.id AND r.program_id=s.program_id AND r.project_id=s.project_id
		WHERE s.program_id=$1 AND s.project_id=$2 AND s.manifest_id=$3 AND s.current_access
		AND (r.source_record_id IS NULL OR r.quarantine_reason IS NOT NULL OR r.customer_source_identifier IS NULL OR NOT EXISTS (
			SELECT 1 FROM billing_migration_import_batch_records ir JOIN billing_migration_import_batches batch
			ON batch.id=ir.import_batch_id AND batch.program_id=ir.program_id AND batch.project_id=ir.project_id
			WHERE ir.source_record_id=s.id AND ir.program_id=s.program_id AND ir.project_id=s.project_id AND batch.manifest_id=s.manifest_id))
		ORDER BY s.id`, lease.ProgramID, lease.ProjectID, frozen.manifestID)
	if err != nil {
		return nil, nil, time.Time{}, nil, nil, err
	}
	for unusableRows.Next() {
		var recordID, quarantineReason, sourceID string
		var recordDigest []byte
		if err = unusableRows.Scan(&recordID, &recordDigest, &quarantineReason, &sourceID); err != nil {
			unusableRows.Close()
			return nil, nil, time.Time{}, nil, nil, err
		}
		d := hash("mosaic-migration-unusable-current-access-v1", []byte(recordID), recordDigest, []byte(quarantineReason), []byte(sourceID))
		divergences = append(divergences, newDivergence(lease, "blocking", "provider_validation_missing", d, frozen.capturedAt))
	}
	if err = unusableRows.Err(); err != nil {
		unusableRows.Close()
		return nil, nil, time.Time{}, nil, nil, err
	}
	unusableRows.Close()

	recordRows, err := b.pool.Query(ctx, `SELECT ps.application_id,ps.platform,s.id,s.record_digest,s.current_access,r.customer_source_identifier,
		coalesce(r.provider_environment,''),ir.expected_store_environment,
		array_agg(m.target_id ORDER BY m.target_id) FILTER (WHERE m.target_id IS NOT NULL)
		FROM billing_migration_source_records s
		JOIN billing_migration_source_record_relationships r ON r.source_record_id=s.id AND r.program_id=s.program_id AND r.project_id=s.project_id
		JOIN billing_migration_import_batch_records ir ON ir.source_record_id=s.id AND ir.program_id=s.program_id AND ir.project_id=s.project_id
		JOIN billing_migration_import_batches batch ON batch.id=ir.import_batch_id AND batch.program_id=ir.program_id AND batch.project_id=ir.project_id AND batch.manifest_id=s.manifest_id
		JOIN applications app ON app.id=ir.application_id AND app.project_id=ir.project_id
		JOIN billing_migration_program_scopes ps ON ps.program_id=s.program_id AND ps.application_id=ir.application_id AND ps.platform=app.platform
		LEFT JOIN billing_migration_mapping_entries m ON m.mapping_set_id=$4 AND m.source_identifier=r.customer_source_identifier
		 AND m.source_kind IN ('customer_id','original_customer_id','audited_alias') AND (m.application_id IS NULL OR (m.application_id=ps.application_id AND m.platform=ps.platform))
		WHERE s.program_id=$1 AND s.project_id=$2 AND s.manifest_id=$3 AND r.customer_source_identifier IS NOT NULL
		GROUP BY ps.application_id,ps.platform,s.id,s.record_digest,r.customer_source_identifier,r.provider_environment,ir.expected_store_environment ORDER BY ps.application_id,ps.platform,s.id`, lease.ProgramID, lease.ProjectID, frozen.manifestID, frozen.mappingID)
	if err != nil {
		return nil, nil, time.Time{}, nil, nil, err
	}
	defer recordRows.Close()
	records := []cohortRecord{}
	for recordRows.Next() {
		var record cohortRecord
		if err = recordRows.Scan(&record.scope.applicationID, &record.scope.platform, &record.recordID, &record.digest, &record.currentAccess, &record.sourceID, &record.providerEnvironment, &record.expectedStoreEnvironment, &record.targets); err != nil {
			return nil, nil, time.Time{}, nil, nil, err
		}
		records = append(records, record)
	}
	if err = recordRows.Err(); err != nil {
		return nil, nil, time.Time{}, nil, nil, err
	}
	cohort, mappingDivergences := groupCohortRecords(lease, records, frozen.capturedAt)
	divergences = append(divergences, mappingDivergences...)
	sort.Slice(divergences, func(i, j int) bool {
		return bytes.Compare(divergences[i].EvidenceDigest, divergences[j].EvidenceDigest) < 0
	})
	evidenceDigest := hashSorted("mosaic-billing-migration-validation-result-v1", terminalEvidence)
	if len(terminalEvidence) == 0 {
		evidenceDigest = hash("mosaic-billing-migration-validation-pending-v1")
	}
	return cohort, divergences, providerWatermark, evidenceDigest, allowedFacts, nil
}

func groupCohortRecords(lease billingmigration.ExecutionLease, records []cohortRecord, at time.Time) ([]cohortItem, []billingmigration.DivergenceWrite) {
	type key struct{ app, platform, customer string }
	grouped := map[key]*cohortItem{}
	divergences := []billingmigration.DivergenceWrite{}
	for _, record := range records {
		if record.providerEnvironment != record.expectedStoreEnvironment {
			d := hash("mosaic-migration-source-environment-mismatch-v1", []byte(record.scope.applicationID), []byte(record.recordID), []byte(record.providerEnvironment), []byte(record.expectedStoreEnvironment))
			divergences = append(divergences, newDivergence(lease, "blocking", "normalization_difference", d, at))
			continue
		}
		unique := uniqueStrings(record.targets)
		if len(unique) != 1 {
			d := hash("mosaic-migration-mapping-missing-v1", []byte(record.scope.applicationID), []byte(record.scope.platform), []byte(record.recordID), []byte(record.sourceID))
			divergences = append(divergences, newDivergence(lease, "blocking", "mapping_missing", d, at))
			continue
		}
		k := key{record.scope.applicationID, record.scope.platform, unique[0]}
		g := grouped[k]
		if g == nil {
			g = &cohortItem{scope: record.scope, customerID: unique[0]}
			grouped[k] = g
		}
		g.sourceDigests = append(g.sourceDigests, record.digest)
		g.sourceCurrentAccess = g.sourceCurrentAccess || record.currentAccess
	}
	cohort := make([]cohortItem, 0, len(grouped))
	for _, v := range grouped {
		cohort = append(cohort, *v)
	}
	sort.Slice(cohort, func(i, j int) bool {
		a, c := cohort[i], cohort[j]
		if a.scope.applicationID != c.scope.applicationID {
			return a.scope.applicationID < c.scope.applicationID
		}
		if a.scope.platform != c.scope.platform {
			return a.scope.platform < c.scope.platform
		}
		return a.customerID < c.customerID
	})
	return cohort, divergences
}

func uniqueStrings(values []string) []string {
	sort.Strings(values)
	out := values[:0]
	for _, v := range values {
		if v != "" && (len(out) == 0 || out[len(out)-1] != v) {
			out = append(out, v)
		}
	}
	return out
}
