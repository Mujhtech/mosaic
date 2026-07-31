//go:build billingdemo

// The Phase 9C drill driver is synthetic and isolated. It exercises Mosaic's
// real migration application services and PostgreSQL repositories, but it does
// not claim live RevenueCat, Apple/Google sandbox, SDK-device, webhook-receiver,
// scale, or elapsed seven-day stabilization evidence.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingmigrationpostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

type demo9CAssessor struct {
	now time.Time
	err error
}

func (a demo9CAssessor) AssessMigration(context.Context, string, []byte) (billingmigration.CapabilityResult, error) {
	if a.err != nil {
		return billingmigration.CapabilityResult{}, a.err
	}
	return billingmigration.CapabilityResult{
		ProviderAPIVersion: billingmigration.ProviderAPIV2,
		Capabilities: []string{
			"read_customers", "read_subscriptions", "read_products", "read_entitlements",
		},
		AssessedAt: a.now,
	}, nil
}

type demo9CState struct {
	now                                      time.Time
	organizationID, projectID, environmentID string
	applicationID, ownerID, adminID          string
	productID, entitlementID, customerID     string
	programID, mappingSetID, manifestID      string
	mappingDigest, manifestDigest            string
	service                                  *billingmigration.Service
	repository                               *billingmigrationpostgres.Repository
	cipher                                   providercredential.SubjectCipher
}

var phase9C demo9CState

func (d *demo) stages9C() []func() error {
	return []func() error{
		d.stage9CSetup,
		d.stage9CAssessment,
		d.stage9CMapping,
		d.stage9CHistoricalEvidence,
		d.stage9CWorkerResume,
		d.stage9CReadinessAndOutage,
		d.stage9CReport,
	}
}

func (d *demo) stage9CSetup() error {
	d.section("9C-0", "Isolated synthetic tenant and real PostgreSQL migration seams")
	phase9C.now = time.Now().UTC().Truncate(time.Microsecond)
	suffix := strconv.FormatInt(phase9C.now.UnixNano(), 36)
	phase9C.organizationID = "org_demo9c_" + suffix
	phase9C.projectID = "proj_demo9c_" + suffix
	phase9C.environmentID = "env_demo9c_" + suffix
	phase9C.applicationID = "app_demo9c_" + suffix
	phase9C.ownerID = "actor_demo9c_owner_" + suffix
	phase9C.adminID = "actor_demo9c_admin_" + suffix
	phase9C.productID = "prd_demo9c_" + suffix
	phase9C.entitlementID = "ent_demo9c_" + suffix
	phase9C.customerID = "cus_demo9c_" + suffix

	_, err := d.pool.Exec(d.ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at) VALUES($1,'Mosaic Phase 9C Drill',$9,$9);
		INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES
			($1,$5,'owner',$9,$9),($1,$6,'admin',$9,$9);
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
			VALUES($2,$1,$10,'Phase 9C Drill','active',$9,$9);
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
			VALUES($3,$2,'staging','Staging','staging',$9,$9);
		INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
			VALUES($4,$2,'Phase 9C iOS','ios',$11,$9,$9);
		INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
			VALUES($7,$2,'pro-monthly','Pro Monthly','subscription','connected','mock',true,$9,$9);
		INSERT INTO entitlements(id,project_id,key,name,description,created_at,updated_at)
			VALUES($8,$2,'pro','Pro','Phase 9C synthetic Entitlement',$9,$9);
		INSERT INTO billing_customers(id,project_id,status,created_at,updated_at)
			VALUES($12,$2,'active',$9,$9)`,
		phase9C.organizationID, phase9C.projectID, phase9C.environmentID, phase9C.applicationID,
		phase9C.ownerID, phase9C.adminID, phase9C.productID, phase9C.entitlementID, phase9C.now,
		"demo9c-"+suffix, "com.mosaic.demo9c."+suffix, phase9C.customerID)
	if err != nil {
		return fmt.Errorf("seed Phase 9C drill tenant: %w", err)
	}

	keyring, err := newDemoKeyring()
	if err != nil {
		return err
	}
	cipher, err := providercredential.NewAESGCMCipher(keyring, rand.Reader)
	if err != nil {
		return err
	}
	phase9C.repository = billingmigrationpostgres.New(d.pool)
	phase9C.cipher = cipher
	phase9C.service = billingmigration.NewService(
		phase9C.repository, cipher, demo9CAssessor{now: phase9C.now},
		billingmigration.WithClock(func() time.Time { return phase9C.now }),
	)
	d.note("created isolated staging tenant %s; evidence is retained for audit and the run prints its IDs", phase9C.projectID)
	d.note("synthetic boundaries: local assessor result and fake credential bytes; no provider or SDK evidence is claimed")
	return nil
}

func (d *demo) stage9CAssessment() error {
	d.section("9C-1", "Synthetic RevenueCat capability assessment (Drill 1 partial)")
	detail, replay, err := phase9C.service.CreateProgram(d.ctx, billingmigration.Actor{ID: phase9C.ownerID}, billingmigration.CreateProgramInput{
		ProjectID: phase9C.projectID, EnvironmentID: phase9C.environmentID,
		Applications:      []billingmigration.ScopeItem{{ApplicationID: phase9C.applicationID, Platform: "ios"}},
		ExternalProjectID: "rc_demo9c_synthetic", Credential: []byte("synthetic-not-a-live-provider-secret"),
		IdempotencyKey: "demo9c-create-program", StabilizationDays: 7, RollbackWindowDays: 7,
	})
	if err != nil || replay {
		return fmt.Errorf("create migration program: replay=%v: %w", replay, err)
	}
	phase9C.programID = detail.Program.ProgramID
	if detail.SourceCapabilityAssessment == nil || detail.Program.State != billingmigration.StateMapping {
		return errors.New("program did not retain its capability assessment or enter mapping")
	}
	d.note("program %s created in state=%s with adapter=%s/%s", phase9C.programID, detail.Program.State, detail.Program.Source.Adapter, detail.Program.Source.AdapterVersion)
	d.note("capabilities=%v (synthetic assessor; customer/alias/Product counts are not claimed)", detail.SourceCapabilityAssessment.Capabilities)

	var ciphertext []byte
	var currentAuthority string
	var epoch int64
	if err = d.pool.QueryRow(d.ctx, `SELECT ciphertext FROM billing_migration_credentials WHERE id=$1`, detail.Program.Source.CredentialReference).Scan(&ciphertext); err != nil {
		return err
	}
	if string(ciphertext) == "synthetic-not-a-live-provider-secret" {
		return errors.New("migration credential persisted in plaintext")
	}
	if err = d.pool.QueryRow(d.ctx, `SELECT current_authority,current_epoch FROM billing_migration_authority_scopes WHERE project_id=$1 AND environment_id=$2 AND application_id=$3 AND platform='ios'`, phase9C.projectID, phase9C.environmentID, phase9C.applicationID).Scan(&currentAuthority, &epoch); err != nil {
		return err
	}
	d.note("credential is AES-GCM ciphertext (%d bytes); authority remains %s epoch %d", len(ciphertext), currentAuthority, epoch)
	return nil
}

func (d *demo) stage9CMapping() error {
	d.section("9C-2", "Exact immutable mapping set (Drill 2 partial)")
	mapping, err := phase9C.service.CreateMappingSet(d.ctx, billingmigration.Actor{ID: phase9C.adminID}, billingmigration.CreateMappingSetInput{
		ProjectID: phase9C.projectID, ProgramID: phase9C.programID, ExpectedStateVersion: 1, Version: 1,
		Entries: []billingmigration.MappingEntry{
			{SourceKind: "customer_id", SourceIdentifier: "rc_customer_alpha", TargetID: phase9C.customerID, MatchKind: "exact"},
			{SourceKind: "audited_alias", SourceIdentifier: "rc_alias_alpha", TargetID: phase9C.customerID, MatchKind: "audited_alias"},
			{SourceKind: "product", SourceIdentifier: "rc_product_monthly", TargetID: phase9C.productID, MatchKind: "exact"},
			{SourceKind: "entitlement", SourceIdentifier: "rc_entitlement_pro", TargetID: phase9C.entitlementID, MatchKind: "exact"},
		},
	})
	if err != nil {
		return err
	}
	if err = phase9C.service.FreezeMappingSet(d.ctx, billingmigration.Actor{ID: phase9C.adminID}, phase9C.projectID, phase9C.programID, mapping.MappingSetID, 1); err != nil {
		return err
	}
	phase9C.mappingSetID, phase9C.mappingDigest = mapping.MappingSetID, mapping.MappingDigest
	if _, err = d.pool.Exec(d.ctx, `UPDATE billing_migration_mapping_entries SET target_id='forbidden-edit' WHERE mapping_set_id=$1`, mapping.MappingSetID); err == nil {
		return errors.New("frozen mapping entry accepted an in-place edit")
	}
	d.note("mapping %s frozen with exact customer/Product/Entitlement mappings and one audited alias", mapping.MappingSetID)
	d.note("an attempted in-place mapping edit was rejected by the immutable-evidence trigger")
	d.note("alias-conflict detection, unmapped-Product repair, and Package/Offering preservation require a source pull and are not claimed here")
	return nil
}

func (d *demo) stage9CHistoricalEvidence() error {
	d.section("9C-3", "Lower-confidence historical evidence cannot grant access (Drill 6 partial)")
	manifestRaw := bytes9C(0x31)
	phase9C.manifestDigest = billingmigration.FormatDigest(manifestRaw)
	phase9C.manifestID = "msm_demo9c_" + strconv.FormatInt(phase9C.now.UnixNano(), 36)
	if err := phase9C.repository.AppendManifest(d.ctx, 2, billingmigration.ManifestWrite{
		ProjectID: phase9C.projectID,
		Manifest: billingmigration.SourceManifest{ProgramID: phase9C.programID, StateVersion: 2,
			ManifestID: phase9C.manifestID, AdapterVersion: billingmigration.AdapterVersion,
			ProviderAPIVersion: billingmigration.ProviderAPIV2, SchemaVersion: "demo9c-v1",
			RecordCount: 1, CurrentAccessRecordCount: 0, CapturedAt: phase9C.now},
		ObjectKey: "private/demo9c/synthetic.enc", ObjectChecksum: bytes9C(0x30), ObjectSizeBytes: 128,
		ManifestDigest: manifestRaw, SourceWatermark: "demo9c-historical-watermark",
	}); err != nil {
		return err
	}
	recordID := "msr_demo9c_" + strconv.FormatInt(phase9C.now.UnixNano(), 36)
	_, err := d.pool.Exec(d.ctx, `INSERT INTO billing_migration_source_records(
		id,program_id,project_id,manifest_id,source_kind,source_identifier,source_revision,source_cursor,
		record_digest,current_access,normalization_schema_version,evidence_kind,observed_at,created_at)
		VALUES($1,$2,$3,$4,'transaction','expired_unrevalidatable','1','historical-cursor',$5,false,
		'demo9c-v1','historical_informational',$6,$6)`, recordID, phase9C.programID, phase9C.projectID,
		phase9C.manifestID, bytes9C(0x32), phase9C.now.Add(-365*24*time.Hour))
	if err != nil {
		return err
	}
	var current bool
	var factCount, pointerCount int
	if err = d.pool.QueryRow(d.ctx, `SELECT current_access FROM billing_migration_source_records WHERE id=$1`, recordID).Scan(&current); err != nil {
		return err
	}
	if err = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM billing_transaction_facts WHERE project_id=$1`, phase9C.projectID).Scan(&factCount); err != nil {
		return err
	}
	if err = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM billing_migration_scope_current_pointers WHERE project_id=$1`, phase9C.projectID).Scan(&pointerCount); err != nil {
		return err
	}
	if current || factCount != 0 || pointerCount != 0 {
		return fmt.Errorf("historical evidence affected authority: current=%v facts=%d pointers=%d", current, factCount, pointerCount)
	}
	d.note("historical source record %s retained as informational evidence", recordID)
	d.note("it created zero Transaction Facts and zero live migration pointers")
	return nil
}

func (d *demo) stage9CWorkerResume() error {
	d.section("9C-4", "Expired import lease resumes without stale-worker settlement (Drill 16 import subset)")
	var foreignPending int
	if err := d.pool.QueryRow(d.ctx, `SELECT count(*) FROM billing_migration_import_batches
		WHERE project_id<>$1 AND (status='pending' OR (status='running' AND lease_expires_at<=now()))`,
		phase9C.projectID).Scan(&foreignPending); err != nil {
		return err
	}
	if foreignPending != 0 {
		return fmt.Errorf("isolated drill database required: found %d claimable foreign import batches", foreignPending)
	}
	batch, replay, err := phase9C.service.CreateImportBatch(d.ctx, billingmigration.Actor{ID: phase9C.adminID}, billingmigration.CreateImportBatchInput{
		ProjectID: phase9C.projectID, ProgramID: phase9C.programID, ManifestID: phase9C.manifestID,
		MappingSetID: phase9C.mappingSetID, IdempotencyKey: "demo9c-import-batch", ExpectedStateVersion: 2,
		RecordCount: 1, CursorBefore: "historical-cursor-before",
	})
	if err != nil || replay {
		return fmt.Errorf("create import batch: replay=%v: %w", replay, err)
	}
	first, leased, err := phase9C.repository.LeaseImportBatch(d.ctx, "demo9c-worker-crashed", phase9C.now, phase9C.now.Add(time.Second))
	if err != nil || !leased || first.BatchID != batch.BatchID {
		return fmt.Errorf("first lease: leased=%v batch=%s err=%w", leased, first.BatchID, err)
	}
	second, leased, err := phase9C.repository.LeaseImportBatch(d.ctx, "demo9c-worker-resumed", phase9C.now.Add(2*time.Second), phase9C.now.Add(time.Minute))
	if err != nil || !leased || second.LeaseGeneration <= first.LeaseGeneration {
		return fmt.Errorf("resumed lease: leased=%v generations=%d/%d err=%w", leased, first.LeaseGeneration, second.LeaseGeneration, err)
	}
	staleErr := phase9C.repository.CompleteImportBatch(d.ctx, phase9C.projectID, phase9C.programID, batch.BatchID,
		"demo9c-worker-crashed", first.LeaseGeneration, "stale-cursor", 0, 0, phase9C.now.Add(3*time.Second))
	if !errors.Is(staleErr, billingmigration.ErrConflict) {
		return fmt.Errorf("stale worker settlement error=%v", staleErr)
	}
	if err = phase9C.repository.CompleteImportBatch(d.ctx, phase9C.projectID, phase9C.programID, batch.BatchID,
		"demo9c-worker-resumed", second.LeaseGeneration, "historical-cursor-after", 0, 0, phase9C.now.Add(3*time.Second)); err != nil {
		return err
	}
	d.note("lease generation advanced %d -> %d after simulated crash/expiry", first.LeaseGeneration, second.LeaseGeneration)
	d.note("the stale owner was rejected; the resumed owner committed the checkpoint once")
	d.note("validation, shadow, divergence, and Repair worker crash paths are not exercised by this subset")
	return nil
}

func (d *demo) stage9CReadinessAndOutage() error {
	d.section("9C-5", "Fail-closed readiness and source outage (Drills 12/18 partial)")
	readyExceptClient := billingmigration.ReadinessInput{
		CurrentAccessMappingPercent: 100, CurrentAccessEvidencePercent: 100,
		FinalDeltaCompleted: true, WatermarksFresh: true, SupportedVersionsAuthorityAware: false,
	}
	assessment, err := billingmigration.AssessReadiness(phase9C.programID, 2, readyExceptClient)
	if err != nil || assessment.Ready {
		return fmt.Errorf("old-client readiness gate: ready=%v err=%w", assessment.Ready, err)
	}
	d.note("with every other readiness input satisfied, an unsupported application version still returns ready=false")

	before := 0
	if err = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM billing_migration_programs WHERE project_id=$1`, phase9C.projectID).Scan(&before); err != nil {
		return err
	}
	outageService := billingmigration.NewService(phase9C.repository, phase9C.cipher,
		demo9CAssessor{now: phase9C.now, err: billingmigration.ErrUnavailable},
		billingmigration.WithClock(func() time.Time { return phase9C.now.Add(time.Minute) }))
	_, _, outageErr := outageService.CreateProgram(d.ctx, billingmigration.Actor{ID: phase9C.ownerID}, billingmigration.CreateProgramInput{
		ProjectID: phase9C.projectID, EnvironmentID: phase9C.environmentID,
		Applications:      []billingmigration.ScopeItem{{ApplicationID: phase9C.applicationID, Platform: "ios"}},
		ExternalProjectID: "rc_demo9c_outage", Credential: []byte("synthetic-outage-secret"),
		IdempotencyKey: "demo9c-source-outage", StabilizationDays: 7, RollbackWindowDays: 7,
	})
	if !errors.Is(outageErr, billingmigration.ErrUnavailable) {
		return fmt.Errorf("source outage error=%v", outageErr)
	}
	after := 0
	var authority string
	var epoch int64
	if err = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM billing_migration_programs WHERE project_id=$1`, phase9C.projectID).Scan(&after); err != nil {
		return err
	}
	if err = d.pool.QueryRow(d.ctx, `SELECT current_authority,current_epoch FROM billing_migration_authority_scopes WHERE project_id=$1 AND application_id=$2`, phase9C.projectID, phase9C.applicationID).Scan(&authority, &epoch); err != nil {
		return err
	}
	if after != before || authority != "source" || epoch != 0 {
		return fmt.Errorf("source outage changed state: programs=%d/%d authority=%s/%d", before, after, authority, epoch)
	}
	d.note("synthetic source assessment outage returned dependency_unavailable without creating a program or changing source authority")
	d.note("cursor preservation and retry-after-recovery require a queued source-pull job and are not claimed")
	return nil
}

func (d *demo) stage9CReport() error {
	d.section("9C-6", "Truthful drill coverage report")
	d.note("exercised risk controls (not full drill acceptance): Drill 6 access isolation; Drill 16 import lease crash/resume")
	d.note("partial only: Drill 1 synthetic assessment; Drill 2 exact immutable mappings; Drill 12 readiness gate; Drill 18 fail-closed assessment outage")
	d.note("not exercised: Drills 3-5, 7-11, 13-15, 17, 19-20")
	d.note("required external evidence still absent: live RevenueCat/API data, Apple/Google sandboxes, three SDK runtimes, real webhook receiver, representative scale, and elapsed stabilization/retention windows")
	d.note("audit coordinates: project=%s program=%s manifest=%s mapping=%s", phase9C.projectID, phase9C.programID, phase9C.manifestID, phase9C.mappingSetID)
	return nil
}

func bytes9C(value byte) []byte {
	result := make([]byte, 32)
	for index := range result {
		result[index] = value
	}
	return result
}
