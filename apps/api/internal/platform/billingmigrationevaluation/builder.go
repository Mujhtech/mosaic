// Package billingmigrationevaluation builds immutable Phase 9C entitlement
// candidates from the ordinary validated-fact pipeline. It has no port capable
// of changing live entitlement or authority pointers.
package billingmigrationevaluation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingprojectionpostgres"
)

type Builder struct {
	pool       *pgxpool.Pool
	projection *billingprojectionpostgres.Repository
}

func New(pool *pgxpool.Pool) *Builder {
	return &Builder{pool: pool, projection: billingprojectionpostgres.New(pool)}
}

var _ billingmigration.PreparedSnapshotBuilder = (*Builder)(nil)
var _ billingmigration.FinalDeltaBuilder = (*Builder)(nil)

type frozenProgram struct {
	environmentID, manifestID, mappingID string
	programState                         string
	stateVersion, authorityEpoch         int64
	manifestDigest, mappingDigest        []byte
	policyDigest                         []byte
	evidenceDigest                       []byte
	sourceWatermark, capturedAt          time.Time
	scopes                               []evaluationScope
}

type evaluationScope struct{ applicationID, platform string }

type cohortItem struct {
	scope               evaluationScope
	customerID          string
	sourceDigests       [][]byte
	sourceCurrentAccess bool
}

type candidate struct {
	cohortItem
	snapshot            billingprojection.CustomerSnapshot
	snapshotID          string
	sourceDigest        []byte
	candidateDigest     []byte
	comparisonDigest    []byte
	mosaicCurrentAccess bool
}

func (b *Builder) Evaluate(ctx context.Context, lease billingmigration.ExecutionLease) (*billingmigration.RunExecutionResult, []billingmigration.PreparedPointer, []byte, error) {
	if lease.JobKind != "dry_run" && lease.JobKind != "shadow" {
		return nil, nil, nil, billingmigration.ErrInvalid
	}
	result, candidates, digest, frozen, err := b.build(ctx, lease)
	if err != nil {
		return nil, nil, nil, err
	}
	pointers := make([]billingmigration.PreparedPointer, 0, len(candidates))
	if lease.JobKind == "shadow" {
		for _, item := range candidates {
			pointers = append(pointers, billingmigration.PreparedPointer{EnvironmentID: frozen.environmentID, ApplicationID: item.scope.applicationID, Platform: item.scope.platform, BillingCustomerID: item.customerID, SnapshotID: item.snapshotID, PreparedDigest: item.candidateDigest})
			result.ShadowSnapshots = append(result.ShadowSnapshots, billingmigration.ShadowSnapshotWrite{
				ID:            stableID("mss", lease.ProgramID, lease.JobID, item.scope.applicationID, item.scope.platform, item.customerID),
				EnvironmentID: frozen.environmentID, ApplicationID: item.scope.applicationID, Platform: item.scope.platform,
				BillingCustomerID: item.customerID, SourceSnapshotID: "rcs_" + hex.EncodeToString(item.sourceDigest[:12]), MosaicSnapshotID: item.snapshotID, ShadowDigest: item.comparisonDigest,
			})
		}
	}
	return result, pointers, digest, nil
}

func (b *Builder) BuildFinalDelta(ctx context.Context, lease billingmigration.ExecutionLease) (*billingmigration.FinalDeltaResult, []billingmigration.PreparedPointer, []byte, error) {
	if lease.JobKind != "final_delta" {
		return nil, nil, nil, billingmigration.ErrInvalid
	}
	run, candidates, digest, frozen, err := b.build(ctx, lease)
	if err != nil {
		return nil, nil, nil, err
	}
	pointers := make([]billingmigration.PreparedPointer, 0, len(candidates))
	customerCandidates := map[string][][]byte{}
	for _, item := range candidates {
		pointers = append(pointers, billingmigration.PreparedPointer{EnvironmentID: frozen.environmentID, ApplicationID: item.scope.applicationID, Platform: item.scope.platform, BillingCustomerID: item.customerID, SnapshotID: item.snapshotID, PreparedDigest: item.candidateDigest})
		customerCandidates[item.customerID] = append(customerCandidates[item.customerID], item.candidateDigest)
	}
	ids := make([]string, 0, len(customerCandidates))
	for id := range customerCandidates {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	cohort := make([]billingmigration.CohortCustomer, 0, len(ids))
	cohortParts := [][]byte{}
	for _, id := range ids {
		customerDigest := hash("mosaic-migration-final-customer-v1", []byte(id), hashSorted("mosaic-migration-final-customer-scopes-v1", customerCandidates[id]))
		cohort = append(cohort, billingmigration.CohortCustomer{BillingCustomerID: id, CustomerDigest: customerDigest})
		cohortParts = append(cohortParts, []byte(id), customerDigest)
	}
	cohortDigest := hash("mosaic-migration-final-cohort-v1", cohortParts...)
	sourceTime, _ := time.Parse(time.RFC3339Nano, run.SourceWatermark)
	providerTime, _ := time.Parse(time.RFC3339Nano, run.ProviderWatermark)
	shadowTime, _ := time.Parse(time.RFC3339Nano, run.ShadowWatermark)
	watermarkDigest := hash("mosaic-migration-final-watermarks-v1", []byte(sourceTime.Format(time.RFC3339Nano)), []byte(providerTime.Format(time.RFC3339Nano)), []byte(shadowTime.Format(time.RFC3339Nano)))
	deltaDigest := hash("mosaic-migration-final-delta-v1", digest, cohortDigest, watermarkDigest)
	result := &billingmigration.FinalDeltaResult{ID: stableID("mfd", lease.ProgramID, lease.JobID, hex.EncodeToString(deltaDigest)), StateVersion: lease.ExpectedStateVersion, ManifestDigest: lease.ManifestDigest, MappingDigest: lease.MappingDigest, EvidenceDigest: lease.EvidenceDigest, FinalWatermarkDigest: watermarkDigest, DeltaDigest: deltaDigest, CohortDigest: cohortDigest, SourceWatermark: sourceTime, ProviderWatermark: providerTime, ShadowWatermark: shadowTime, Cohort: cohort}
	return result, pointers, deltaDigest, nil
}

func (b *Builder) build(ctx context.Context, lease billingmigration.ExecutionLease) (*billingmigration.RunExecutionResult, []candidate, []byte, frozenProgram, error) {
	if b == nil || b.pool == nil || lease.ProjectID == "" || lease.ProgramID == "" || lease.JobID == "" || lease.ExpectedStateVersion < 1 || len(lease.ManifestDigest) != sha256.Size || len(lease.MappingDigest) != sha256.Size || (lease.JobKind != "final_delta" && len(lease.PolicyDigest) != sha256.Size) || (lease.JobKind == "final_delta" && len(lease.EvidenceDigest) != sha256.Size) {
		return nil, nil, nil, frozenProgram{}, billingmigration.ErrInvalid
	}
	frozen, err := b.loadFrozen(ctx, lease)
	if err != nil {
		return nil, nil, nil, frozenProgram{}, err
	}
	cohort, divergences, providerWatermark, evidenceDigest, allowedFacts, err := b.loadEvidence(ctx, lease, frozen)
	if err != nil {
		return nil, nil, nil, frozenProgram{}, err
	}
	frozen.evidenceDigest = evidenceDigest
	if lease.JobKind == "final_delta" && !bytes.Equal(lease.EvidenceDigest, evidenceDigest) {
		return nil, nil, nil, frozenProgram{}, billingmigration.ErrStaleDigest
	}
	if lease.JobKind == "final_delta" {
		cohort = expandFinalCohort(cohort, frozen.scopes)
	}
	asOf := frozen.sourceWatermark
	if providerWatermark.After(asOf) {
		asOf = providerWatermark
	}
	if asOf.IsZero() {
		return nil, nil, nil, frozenProgram{}, billingmigration.ErrConflict
	}
	candidates := make([]candidate, 0, len(cohort))
	for _, item := range cohort {
		input, loadErr := b.projection.LoadInput(ctx, billingprojection.Scope{ProjectID: lease.ProjectID, EnvironmentID: frozen.environmentID, CustomerID: item.customerID})
		if loadErr != nil {
			return nil, nil, nil, frozenProgram{}, loadErr
		}
		input = prepareProjectionInput(input, allowedFacts[item.scope.applicationID])
		if divergence := missingCustomerFactDivergence(lease, item, input, asOf); divergence != nil {
			divergences = append(divergences, *divergence)
		}
		output := billingprojection.Compute(input, asOf)
		if output.CustomerSnapshot == nil && !item.sourceCurrentAccess && len(input.Lineages) == 0 {
			empty := billingprojection.ProjectEntitlements(billingprojection.CustomerProjection{}, asOf)
			output.CustomerSnapshot = &empty
		}
		if output.CustomerSnapshot == nil {
			return nil, nil, nil, frozenProgram{}, fmt.Errorf("candidate projection produced no snapshot: %w", billingmigration.ErrConflict)
		}
		mosaicActive := false
		for _, entry := range output.CustomerSnapshot.Entries {
			if entry.State == billingprojection.AccessActive {
				mosaicActive = true
				break
			}
		}
		sourceDigest := hashSorted("mosaic-migration-source-current-access-v1", item.sourceDigests)
		candidateDigest := hash("mosaic-migration-candidate-v1", []byte(item.scope.applicationID), []byte(item.scope.platform), []byte(item.customerID), sourceDigest, output.CustomerSnapshot.Checksum)
		comparison := hash("mosaic-migration-comparison-v1", sourceDigest, candidateDigest, []byte(fmt.Sprint(item.sourceCurrentAccess)), []byte(fmt.Sprint(mosaicActive)))
		c := candidate{cohortItem: item, snapshot: *output.CustomerSnapshot, sourceDigest: sourceDigest, candidateDigest: candidateDigest, comparisonDigest: comparison, mosaicCurrentAccess: mosaicActive}
		if divergence := accessComparisonDivergence(lease, item.sourceCurrentAccess, mosaicActive, comparison, asOf); divergence != nil {
			divergences = append(divergences, *divergence)
		}
		candidates = append(candidates, c)
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.scope.applicationID != b.scope.applicationID {
			return a.scope.applicationID < b.scope.applicationID
		}
		if a.scope.platform != b.scope.platform {
			return a.scope.platform < b.scope.platform
		}
		return a.customerID < b.customerID
	})
	evalParts := [][]byte{lease.ManifestDigest, lease.MappingDigest, frozen.policyDigest, evidenceDigest}
	for _, c := range candidates {
		evalParts = append(evalParts, c.candidateDigest, c.comparisonDigest)
	}
	for _, d := range divergences {
		evalParts = append(evalParts, d.EvidenceDigest)
	}
	evaluationDigest := hash("mosaic-migration-candidate-evaluation-v1", evalParts...)
	evaluationID := stableID("mce", lease.ProgramID, lease.JobID)
	if err = b.persist(ctx, lease, frozen, evaluationID, evaluationDigest, providerWatermark, asOf, candidates); err != nil {
		return nil, nil, nil, frozenProgram{}, err
	}
	for i := range candidates {
		candidates[i].snapshotID = stableID("cesm", evaluationID, candidates[i].scope.applicationID, candidates[i].scope.platform, candidates[i].customerID)
	}
	result := &billingmigration.RunExecutionResult{SourceWatermark: frozen.sourceWatermark.Format(time.RFC3339Nano), ProviderWatermark: providerWatermark.Format(time.RFC3339Nano), ShadowWatermark: asOf.Format(time.RFC3339Nano), Divergences: divergences}
	return result, candidates, evaluationDigest, frozen, nil
}

func accessComparisonDivergence(lease billingmigration.ExecutionLease, sourceActive, mosaicActive bool, evidence []byte, at time.Time) *billingmigration.DivergenceWrite {
	if sourceActive == mosaicActive {
		return nil
	}
	reason := "source_grants_mosaic_denies"
	if mosaicActive {
		reason = "mosaic_grants_source_denies"
	}
	result := newDivergence(lease, "critical", reason, evidence, at)
	return &result
}

func missingCustomerFactDivergence(lease billingmigration.ExecutionLease, item cohortItem, input billingprojection.Input, at time.Time) *billingmigration.DivergenceWrite {
	if !item.sourceCurrentAccess {
		return nil
	}
	for _, lineage := range input.Lineages {
		if len(lineage.Facts) > 0 {
			return nil
		}
	}
	d := hash("mosaic-migration-current-access-without-fact-v1", []byte(item.scope.applicationID), []byte(item.scope.platform), []byte(item.customerID))
	result := newDivergence(lease, "blocking", "provider_validation_missing", d, at)
	return &result
}

// expandFinalCohort guarantees the checkpoint has one prepared pointer for
// every final-cohort customer in every exact program scope. Source evidence is
// retained only on its originating scope; synthetic scope rows start with no
// source access, preventing facts from one application leaking into another.
func expandFinalCohort(cohort []cohortItem, scopes []evaluationScope) []cohortItem {
	type key struct{ app, platform, customer string }
	items := make(map[key]cohortItem, len(cohort))
	customers := map[string]bool{}
	for _, item := range cohort {
		items[key{item.scope.applicationID, item.scope.platform, item.customerID}] = item
		customers[item.customerID] = true
	}
	for customer := range customers {
		for _, scope := range scopes {
			k := key{scope.applicationID, scope.platform, customer}
			if _, exists := items[k]; !exists {
				items[k] = cohortItem{scope: scope, customerID: customer}
			}
		}
	}
	out := make([]cohortItem, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].scope.applicationID != out[j].scope.applicationID {
			return out[i].scope.applicationID < out[j].scope.applicationID
		}
		if out[i].scope.platform != out[j].scope.platform {
			return out[i].scope.platform < out[j].scope.platform
		}
		return out[i].customerID < out[j].customerID
	})
	return out
}

func prepareProjectionInput(input billingprojection.Input, allowed map[string]bool) billingprojection.Input {
	for i := range input.Lineages {
		filtered := input.Lineages[i].Facts[:0]
		for _, fact := range input.Lineages[i].Facts {
			if allowed[fact.ID] {
				filtered = append(filtered, fact)
			}
		}
		input.Lineages[i].Facts = filtered
		input.Lineages[i].Checkpoint = ""
		input.Lineages[i].CheckpointChecksum = nil
		input.Lineages[i].CheckpointFacts = 0
		input.Lineages[i].SnapshotID = ""
	}
	kept := input.Lineages[:0]
	for _, lineage := range input.Lineages {
		if len(lineage.Facts) > 0 {
			kept = append(kept, lineage)
		}
	}
	input.Lineages = kept
	input.PriorCustomerSnapshot = nil
	input.RuleVersion = billingprojection.ActiveRuleVersion
	return input
}

func (b *Builder) loadFrozen(ctx context.Context, lease billingmigration.ExecutionLease) (frozenProgram, error) {
	var f frozenProgram
	var sourceWatermark string
	err := b.pool.QueryRow(ctx, `SELECT p.environment_id,p.state,p.state_version,p.authority_epoch_before,p.policy_digest,
		m.id,m.mapping_digest,s.id,s.manifest_digest,s.source_watermark,s.captured_at
		FROM billing_migration_programs p
		JOIN LATERAL (SELECT id,mapping_digest FROM billing_migration_mapping_sets WHERE program_id=p.id AND project_id=p.project_id AND status='frozen' ORDER BY version DESC LIMIT 1) m ON true
		JOIN LATERAL (SELECT id,manifest_digest,source_watermark,captured_at FROM billing_migration_source_manifests WHERE program_id=p.id AND project_id=p.project_id ORDER BY captured_at DESC,id DESC LIMIT 1) s ON true
		WHERE p.id=$1 AND p.project_id=$2`, lease.ProgramID, lease.ProjectID).Scan(&f.environmentID, &f.programState, &f.stateVersion, &f.authorityEpoch, &f.policyDigest, &f.mappingID, &f.mappingDigest, &f.manifestID, &f.manifestDigest, &sourceWatermark, &f.capturedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return f, billingmigration.ErrStaleState
	}
	if err != nil {
		return f, err
	}
	f.sourceWatermark = f.capturedAt.UTC()
	if parsed, parseErr := time.Parse(time.RFC3339Nano, sourceWatermark); parseErr == nil {
		f.sourceWatermark = parsed.UTC()
	}
	if !validProgramBinding(lease, f.programState, f.stateVersion) {
		return f, billingmigration.ErrStaleState
	}
	if !bytes.Equal(f.manifestDigest, lease.ManifestDigest) || !bytes.Equal(f.mappingDigest, lease.MappingDigest) || (lease.JobKind != "final_delta" && !bytes.Equal(f.policyDigest, lease.PolicyDigest)) {
		return f, billingmigration.ErrStaleDigest
	}
	if lease.JobKind == "final_delta" {
		var evidence []byte
		err = b.pool.QueryRow(ctx, `SELECT evidence_digest FROM billing_migration_final_delta_jobs WHERE id=$1 AND program_id=$2 AND project_id=$3 AND status='running' AND lease_owner=$4 AND lease_generation=$5 AND lease_expires_at=$6`, lease.JobID, lease.ProgramID, lease.ProjectID, lease.Owner, lease.Generation, lease.ExpiresAt).Scan(&evidence)
		if errors.Is(err, pgx.ErrNoRows) {
			return f, billingmigration.ErrLeaseLost
		}
		if err != nil {
			return f, err
		}
		if !bytes.Equal(evidence, lease.EvidenceDigest) {
			return f, billingmigration.ErrStaleDigest
		}
	} else {
		var manifest, mapping, policy []byte
		err = b.pool.QueryRow(ctx, `SELECT manifest_digest,mapping_digest,policy_digest FROM billing_migration_run_jobs WHERE id=$1 AND program_id=$2 AND project_id=$3 AND run_kind=$4 AND status='running' AND lease_owner=$5 AND lease_generation=$6 AND lease_expires_at=$7`, lease.JobID, lease.ProgramID, lease.ProjectID, lease.JobKind, lease.Owner, lease.Generation, lease.ExpiresAt).Scan(&manifest, &mapping, &policy)
		if errors.Is(err, pgx.ErrNoRows) {
			return f, billingmigration.ErrLeaseLost
		}
		if err != nil {
			return f, err
		}
		if !bytes.Equal(manifest, lease.ManifestDigest) || !bytes.Equal(mapping, lease.MappingDigest) || !bytes.Equal(policy, lease.PolicyDigest) {
			return f, billingmigration.ErrStaleDigest
		}
	}
	rows, err := b.pool.Query(ctx, `SELECT ps.application_id,ps.platform,coalesce(a.current_authority,''),coalesce(a.current_epoch,-1),coalesce(a.active_program_id,'')
		FROM billing_migration_program_scopes ps LEFT JOIN billing_migration_authority_scopes a ON a.project_id=$2 AND a.environment_id=$3 AND a.application_id=ps.application_id AND a.platform=ps.platform
		WHERE ps.program_id=$1 ORDER BY ps.application_id,ps.platform`, lease.ProgramID, lease.ProjectID, f.environmentID)
	if err != nil {
		return f, err
	}
	defer rows.Close()
	for rows.Next() {
		var s evaluationScope
		var authority, active string
		var epoch int64
		if err = rows.Scan(&s.applicationID, &s.platform, &authority, &epoch, &active); err != nil {
			return f, err
		}
		if authority != "source" || epoch != f.authorityEpoch || active != lease.ProgramID {
			return f, billingmigration.ErrAuthorityEpoch
		}
		f.scopes = append(f.scopes, s)
	}
	if err = rows.Err(); err != nil {
		return f, err
	}
	if len(f.scopes) == 0 {
		return f, billingmigration.ErrPointerCoverage
	}
	return f, nil
}

func validProgramBinding(lease billingmigration.ExecutionLease, state string, version int64) bool {
	if lease.JobKind == "final_delta" {
		return (state == "shadowing" || state == "ready") && version == lease.ExpectedStateVersion
	}
	want := "dry_run"
	if lease.JobKind == "shadow" {
		want = "shadowing"
	}
	return state == want && (version == lease.ExpectedStateVersion || version == lease.ExpectedStateVersion+1)
}

func stableID(prefix string, parts ...string) string {
	h := sha256.New()
	h.Write([]byte(prefix))
	for _, p := range parts {
		h.Write([]byte{0})
		h.Write([]byte(p))
	}
	return prefix + "_" + hex.EncodeToString(h.Sum(nil)[:12])
}
func hash(domain string, parts ...[]byte) []byte {
	h := sha256.New()
	h.Write([]byte(domain))
	for _, p := range parts {
		h.Write([]byte{0})
		h.Write(p)
	}
	return h.Sum(nil)
}
func hashSorted(domain string, parts [][]byte) []byte {
	sort.Slice(parts, func(i, j int) bool { return bytes.Compare(parts[i], parts[j]) < 0 })
	return hash(domain, parts...)
}
func newDivergence(lease billingmigration.ExecutionLease, class, reason string, evidence []byte, at time.Time) billingmigration.DivergenceWrite {
	return billingmigration.DivergenceWrite{Divergence: billingmigration.Divergence{ProgramID: lease.ProgramID, StateVersion: lease.ExpectedStateVersion, DivergenceID: stableID("mdv", lease.JobID, reason, hex.EncodeToString(evidence)), Classification: class, Reason: reason, ObservedAt: at, ClassificationRuleVersion: "phase-9c-candidate-v1"}, EvidenceDigest: evidence}
}

// migrationReferenceDigest reproduces the persisted Phase 9A reference-key
// contract without retaining the provider reference beyond this read.
func migrationReferenceDigest(provider, kind, reference string) []byte {
	if provider == billing.ProviderAppStore {
		return billing.AppleTransactionKey(billing.StoreUnclassified, reference)
	}
	if kind == "google_play_purchase_token" {
		return billing.TokenDigest(reference)
	}
	return hash("mosaic-billing-google-order-v1", []byte(reference))
}
