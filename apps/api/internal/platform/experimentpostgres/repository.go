package experimentpostgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
)

type Repository struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func persistence(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return experiment.ErrNotFound
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch pe.Code {
		case "23505":
			return experiment.ErrConflict
		case "23503":
			return experiment.ErrNotFound
		case "23514", "55000":
			return fmt.Errorf("%s: %w", pe.Message, experiment.ErrInvalid)
		}
	}
	return fmt.Errorf("experiment persistence: %w", err)
}
func nextID(ctx context.Context, tx pgx.Tx, prefix string) (string, error) {
	var n int64
	e := tx.QueryRow(ctx, `INSERT INTO id_sequences(prefix,value) VALUES($1,1) ON CONFLICT(prefix) DO UPDATE SET value=id_sequences.value+1 RETURNING value`, prefix).Scan(&n)
	return fmt.Sprintf("%s_%06d", prefix, n), e
}
func audit(ctx context.Context, tx pgx.Tx, scope experiment.Scope, actor experiment.Actor, action, kind, id string, metadata any, now time.Time) error {
	auditID, e := nextID(ctx, tx, "audit")
	if e != nil {
		return e
	}
	raw, _ := json.Marshal(metadata)
	_, e = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, auditID, actor.ID, scope.OrganizationID, scope.ProjectID, scope.EnvironmentID, action, kind, id, raw, now)
	return e
}

func (r *Repository) Scope(ctx context.Context, actor experiment.Actor, projectID, environmentID string) (experiment.Scope, error) {
	if actor.ID == "" {
		return experiment.Scope{}, experiment.ErrUnauthenticated
	}
	var s experiment.Scope
	e := r.pool.QueryRow(ctx, `SELECT p.organization_id,p.id,e.id,COALESCE(e.mode,'development'),om.role FROM projects p JOIN environments e ON e.project_id=p.id JOIN organization_members om ON om.organization_id=p.organization_id AND om.actor_id=$1 WHERE p.id=$2 AND e.id=$3 AND p.status='active'`, actor.ID, projectID, environmentID).Scan(&s.OrganizationID, &s.ProjectID, &s.EnvironmentID, &s.EnvironmentMode, &s.Role)
	return s, persistence(e)
}

func validationBytes(v experiment.ValidationResult) []byte { b, _ := json.Marshal(v); return b }
func documentBytes(v experiment.DraftDocument) []byte      { b, _ := json.Marshal(v); return b }
func (r *Repository) Create(ctx context.Context, scope experiment.Scope, actor experiment.Actor, placementID, name, hypothesis string, doc experiment.DraftDocument, validation experiment.ValidationResult, mutation, request []byte, now time.Time) (experiment.Experiment, experiment.DraftResource, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return experiment.Experiment{}, experiment.DraftResource{}, persistence(e)
	}
	defer tx.Rollback(ctx)
	var exists bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM placements WHERE id=$1 AND project_id=$2 AND status='active')`, placementID, scope.ProjectID).Scan(&exists)
	if e != nil || !exists {
		return experiment.Experiment{}, experiment.DraftResource{}, experiment.ErrNotFound
	}
	expID, e := nextID(ctx, tx, "experiment")
	if e != nil {
		return experiment.Experiment{}, experiment.DraftResource{}, persistence(e)
	}
	draftID, e := nextID(ctx, tx, "experiment_draft")
	if e != nil {
		return experiment.Experiment{}, experiment.DraftResource{}, persistence(e)
	}
	item := experiment.Experiment{ID: expID, ProjectID: scope.ProjectID, EnvironmentID: scope.EnvironmentID, PlacementID: placementID, Name: name, Hypothesis: hypothesis, State: "draft", CurrentDraftID: draftID, CreatedByActorID: actor.ID, UpdatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
	_, e = tx.Exec(ctx, `INSERT INTO experiments(id,project_id,environment_id,placement_id,name,hypothesis,state,current_draft_id,created_by_actor_id,updated_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7,NULL,$8,$8,$9,$9)`, item.ID, item.ProjectID, item.EnvironmentID, item.PlacementID, item.Name, item.Hypothesis, item.State, actor.ID, now)
	if e != nil {
		return experiment.Experiment{}, experiment.DraftResource{}, persistence(e)
	}
	_, e = tx.Exec(ctx, `INSERT INTO experiment_drafts(id,experiment_id,project_id,environment_id,current_revision,status,created_by_actor_id,updated_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,1,'active',$5,$5,$6,$6)`, draftID, expID, scope.ProjectID, scope.EnvironmentID, actor.ID, now)
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE experiments SET current_draft_id=$2 WHERE id=$1`, expID, draftID)
	}
	if e == nil {
		_, e = tx.Exec(ctx, `INSERT INTO experiment_draft_revisions(draft_id,revision,experiment_id,project_id,document,canonical_digest,validation,mutation_key_digest,request_digest,actor_id,created_at) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, draftID, expID, scope.ProjectID, documentBytes(doc), request, validationBytes(validation), mutation, request, actor.ID, now)
	}
	if e == nil {
		e = audit(ctx, tx, scope, actor, "experiment.created", "experiment", expID, map[string]any{"revision": 1, "placementId": placementID}, now)
	}
	if e != nil {
		return experiment.Experiment{}, experiment.DraftResource{}, persistence(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return experiment.Experiment{}, experiment.DraftResource{}, persistence(e)
	}
	draft := experiment.DraftResource{ID: draftID, Revision: 1, Status: "active", Document: doc, Validation: validation, UpdatedAt: now, ETag: fmt.Sprintf("\"experiment-draft:%s:1\"", draftID)}
	return item, draft, nil
}

func scanExperiment(row pgx.Row) (experiment.Experiment, error) {
	var v experiment.Experiment
	var hypothesis, current, active *string
	e := row.Scan(&v.ID, &v.ProjectID, &v.EnvironmentID, &v.PlacementID, &v.Name, &hypothesis, &v.State, &current, &active, &v.CreatedByActorID, &v.UpdatedByActorID, &v.CreatedAt, &v.UpdatedAt, &v.ArchivedAt)
	if hypothesis != nil {
		v.Hypothesis = *hypothesis
	}
	if current != nil {
		v.CurrentDraftID = *current
	}
	if active != nil {
		v.ActiveVersionID = *active
	}
	return v, e
}

const experimentColumns = `id,project_id,environment_id,placement_id,name,hypothesis,state,current_draft_id,active_version_id,created_by_actor_id,updated_by_actor_id,created_at,updated_at,archived_at`

func (r *Repository) List(ctx context.Context, scope experiment.Scope) ([]experiment.Experiment, error) {
	rows, e := r.pool.Query(ctx, `SELECT `+experimentColumns+` FROM experiments WHERE project_id=$1 AND environment_id=$2 ORDER BY updated_at DESC,id`, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return nil, persistence(e)
	}
	defer rows.Close()
	out := []experiment.Experiment{}
	for rows.Next() {
		v, e := scanExperiment(rows)
		if e != nil {
			return nil, persistence(e)
		}
		out = append(out, v)
	}
	return out, persistence(rows.Err())
}

func readRevision(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, draftID string) (*experiment.RevisionRecord, error) {
	var d experiment.Draft
	var raw, valid []byte
	e := q.QueryRow(ctx, `SELECT d.id,d.experiment_id,d.project_id,d.environment_id,d.current_revision,d.status,d.updated_by_actor_id,d.created_at,d.updated_at,r.document,r.validation,r.mutation_key_digest,r.request_digest FROM experiment_drafts d JOIN experiment_draft_revisions r ON r.draft_id=d.id AND r.revision=d.current_revision WHERE d.id=$1`, draftID).Scan(&d.ID, &d.ExperimentID, &d.ProjectID, &d.EnvironmentID, &d.Revision, &d.Status, &d.UpdatedByActorID, &d.CreatedAt, &d.UpdatedAt, &raw, &valid, &dummBytes, &dummBytes2)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var doc experiment.DraftDocument
	var vr experiment.ValidationResult
	if e = json.Unmarshal(raw, &doc); e != nil {
		return nil, e
	}
	if e = json.Unmarshal(valid, &vr); e != nil {
		return nil, e
	}
	return &experiment.RevisionRecord{Draft: d, Document: doc, Validation: vr}, nil
}

var dummBytes, dummBytes2 []byte

func (r *Repository) Get(ctx context.Context, scope experiment.Scope, id string) (experiment.Experiment, *experiment.RevisionRecord, *experiment.VersionResponse, error) {
	v, e := scanExperiment(r.pool.QueryRow(ctx, `SELECT `+experimentColumns+` FROM experiments WHERE id=$1 AND project_id=$2 AND environment_id=$3`, id, scope.ProjectID, scope.EnvironmentID))
	if e != nil {
		return v, nil, nil, persistence(e)
	}
	var rev *experiment.RevisionRecord
	if v.CurrentDraftID != "" {
		rev, e = readRevision(ctx, r.pool, v.CurrentDraftID)
		if e != nil {
			return v, nil, nil, persistence(e)
		}
	}
	var version *experiment.VersionResponse
	if v.ActiveVersionID != "" {
		x, e := r.version(ctx, r.pool, v.ActiveVersionID, scope.ProjectID)
		if e != nil {
			return v, nil, nil, e
		}
		version = &x
	}
	return v, rev, version, nil
}

func (r *Repository) UpdateDraft(ctx context.Context, scope experiment.Scope, actor experiment.Actor, id string, expected int64, mutation, request []byte, doc experiment.DraftDocument, validation experiment.ValidationResult, now time.Time) (experiment.DraftResource, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return experiment.DraftResource{}, persistence(e)
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `experiment:`+id)
	if e != nil {
		return experiment.DraftResource{}, persistence(e)
	}
	var draftID, status, experimentState string
	var current int64
	e = tx.QueryRow(ctx, `SELECT d.id,d.current_revision,d.status,e.state FROM experiments e JOIN experiment_drafts d ON d.id=e.current_draft_id WHERE e.id=$1 AND e.project_id=$2 AND e.environment_id=$3 FOR UPDATE`, id, scope.ProjectID, scope.EnvironmentID).Scan(&draftID, &current, &status, &experimentState)
	if e != nil {
		return experiment.DraftResource{}, persistence(e)
	}
	if experimentState != "draft" || status != "active" {
		return experiment.DraftResource{}, experiment.ErrConflict
	}
	var replayRevision int64
	var replayRequest, raw, valid []byte
	e = tx.QueryRow(ctx, `SELECT revision,request_digest,document,validation FROM experiment_draft_revisions WHERE draft_id=$1 AND mutation_key_digest=$2`, draftID, mutation).Scan(&replayRevision, &replayRequest, &raw, &valid)
	if e == nil {
		if string(replayRequest) != string(request) {
			return experiment.DraftResource{}, experiment.ErrIdempotencyConflict
		}
		var rd experiment.DraftDocument
		var rv experiment.ValidationResult
		_ = json.Unmarshal(raw, &rd)
		_ = json.Unmarshal(valid, &rv)
		return experiment.DraftResource{ID: draftID, Revision: replayRevision, Status: status, Document: rd, Validation: rv, UpdatedAt: now, ETag: fmt.Sprintf("\"experiment-draft:%s:%d\"", draftID, replayRevision)}, nil
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return experiment.DraftResource{}, persistence(e)
	}
	if current != expected {
		return experiment.DraftResource{}, &experiment.ConflictError{Revision: current, ETag: fmt.Sprintf("\"experiment-draft:%s:%d\"", draftID, current)}
	}
	next := current + 1
	_, e = tx.Exec(ctx, `INSERT INTO experiment_draft_revisions(draft_id,revision,experiment_id,project_id,document,canonical_digest,validation,mutation_key_digest,request_digest,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, draftID, next, id, scope.ProjectID, documentBytes(doc), request, validationBytes(validation), mutation, request, actor.ID, now)
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE experiment_drafts SET current_revision=$2,updated_by_actor_id=$3,updated_at=$4 WHERE id=$1`, draftID, next, actor.ID, now)
	}
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE experiments SET updated_by_actor_id=$2,updated_at=$3 WHERE id=$1`, id, actor.ID, now)
	}
	if e == nil {
		e = audit(ctx, tx, scope, actor, "experiment.draft_updated", "experiment", id, map[string]any{"revision": next, "valid": validation.Valid}, now)
	}
	if e != nil {
		return experiment.DraftResource{}, persistence(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return experiment.DraftResource{}, persistence(e)
	}
	return experiment.DraftResource{ID: draftID, Revision: next, Status: status, Document: doc, Validation: validation, UpdatedAt: now, ETag: fmt.Sprintf("\"experiment-draft:%s:%d\"", draftID, next)}, nil
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (r *Repository) version(ctx context.Context, q rowQuerier, id, projectID string) (experiment.VersionResponse, error) {
	var v experiment.VersionResponse
	var starts, ends *time.Time
	var group *string
	var metricID string
	var metricVersion int
	e := q.QueryRow(ctx, `SELECT id,experiment_id,placement_id,version_number,source_revision,assignment_key_policy,bucketing_algorithm,allocation_version,primary_metric_id,primary_metric_version,group_version_id,starts_at,ends_at,published_at FROM experiment_versions WHERE id=$1 AND project_id=$2`, id, projectID).Scan(&v.ID, &v.ExperimentID, &v.PlacementID, &v.VersionNumber, &v.SourceRevision, &v.AssignmentKeyPolicy, &v.BucketingAlgorithm, &v.AllocationVersion, &metricID, &metricVersion, &group, &starts, &ends, &v.PublishedAt)
	if e != nil {
		return v, persistence(e)
	}
	v.PrimaryMetricVersionID = fmt.Sprintf("%s@%d", metricID, metricVersion)
	if group != nil {
		v.MutualExclusionGroupVersionID = *group
	}
	v.Schedule = experiment.Schedule{StartsAt: starts, EndsAt: ends}
	rows, e := q.Query(ctx, `SELECT id,role,name,paywall_id,paywall_version_id,allocation_start,allocation_end FROM experiment_variants WHERE experiment_version_id=$1 ORDER BY allocation_start`, id)
	if e != nil {
		return v, persistence(e)
	}
	defer rows.Close()
	for rows.Next() {
		var x experiment.VariantResponse
		if e = rows.Scan(&x.ID, &x.Role, &x.Name, &x.PaywallID, &x.PaywallVersionID, &x.AllocationStart, &x.AllocationEnd); e != nil {
			return v, persistence(e)
		}
		v.Variants = append(v.Variants, x)
	}
	rows2, e := q.Query(ctx, `SELECT metric_id,metric_version FROM experiment_metric_snapshots WHERE experiment_version_id=$1 AND kind='guardrail' ORDER BY metric_id`, id)
	if e != nil {
		return v, persistence(e)
	}
	defer rows2.Close()
	for rows2.Next() {
		var mid string
		var mv int
		if e = rows2.Scan(&mid, &mv); e != nil {
			return v, persistence(e)
		}
		v.GuardrailMetricVersionIDs = append(v.GuardrailMetricVersionIDs, fmt.Sprintf("%s@%d", mid, mv))
	}
	return v, persistence(rows2.Err())
}

func metricParts(value string) (string, int) {
	var id string
	var version int
	fmt.Sscanf(value, "%[^@]@%d", &id, &version)
	if id == "" {
		parts := []rune(value)
		for i, c := range parts {
			if c == '@' {
				id = string(parts[:i])
				fmt.Sscanf(string(parts[i+1:]), "%d", &version)
				break
			}
		}
	}
	return id, version
}
func (r *Repository) Publish(ctx context.Context, scope experiment.Scope, input experiment.PublishInput) (experiment.PublishOutput, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `experiment-publish:`+input.Experiment.ID)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	var state string
	var current int64
	e = tx.QueryRow(ctx, `SELECT e.state,d.current_revision FROM experiments e JOIN experiment_drafts d ON d.id=e.current_draft_id WHERE e.id=$1 AND e.project_id=$2 AND e.environment_id=$3 FOR UPDATE`, input.Experiment.ID, scope.ProjectID, scope.EnvironmentID).Scan(&state, &current)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	if state != "draft" || current != input.Draft.Revision {
		return experiment.PublishOutput{}, experiment.ErrConflict
	}
	compiledSchedule, e := experiment.CompileSchedule(input.Document.Schedule, input.Now)
	if e != nil {
		return experiment.PublishOutput{}, e
	}
	// Validate immutable same-scope Paywall Versions and block overlap outside one group.
	for _, variant := range input.Document.Variants {
		var ok bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM paywall_versions v JOIN paywalls p ON p.id=v.paywall_id WHERE v.id=$1 AND v.paywall_id=$2 AND v.project_id=$3 AND v.environment_id=$4 AND p.status='active')`, variant.PaywallVersionID, variant.PaywallID, scope.ProjectID, scope.EnvironmentID).Scan(&ok)
		if e != nil || !ok {
			return experiment.PublishOutput{}, fmt.Errorf("paywall version is not publishable: %w", experiment.ErrInvalid)
		}
		var unsafe int
		e = tx.QueryRow(ctx, `SELECT count(*) FROM paywall_version_products pvp
			JOIN products product ON product.id=pvp.product_id AND product.project_id=pvp.project_id
			WHERE pvp.version_id=$1 AND (
				product.status<>'connected' OR product.readiness_ready=false
				OR NOT EXISTS (SELECT 1 FROM product_entitlement_grants grant_row WHERE grant_row.product_id=product.id)
				OR NOT EXISTS (SELECT 1 FROM active_provider_assignments active_assignment WHERE active_assignment.environment_id=$2)
				OR EXISTS (
					SELECT 1 FROM active_provider_assignments assignment
					LEFT JOIN provider_connections connection ON connection.id=assignment.connection_id
					WHERE assignment.environment_id=$2 AND (
						(assignment.connection_id IS NOT NULL AND (connection.status<>'active' OR connection.health_status<>'healthy'))
						OR NOT EXISTS (
							SELECT 1 FROM provider_product_mappings mapping
							WHERE mapping.product_id=product.id AND mapping.environment_id=assignment.environment_id
							AND mapping.application_id=assignment.application_id AND mapping.platform=assignment.platform
							AND mapping.provider=assignment.provider AND mapping.connection_id IS NOT DISTINCT FROM assignment.connection_id
							AND mapping.status='active' AND mapping.availability='available' AND mapping.sync_state='current'
						)
					)
				)
			)`, variant.PaywallVersionID, scope.EnvironmentID).Scan(&unsafe)
		if e != nil || unsafe > 0 {
			return experiment.PublishOutput{}, fmt.Errorf("paywall version has unsafe products: %w", experiment.ErrInvalid)
		}
	}
	var overlap int
	e = tx.QueryRow(ctx, `SELECT count(*) FROM experiments WHERE environment_id=$1 AND placement_id=$2 AND state IN ('scheduled','running','paused') AND id<>$3`, scope.EnvironmentID, input.Experiment.PlacementID, input.Experiment.ID).Scan(&overlap)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	if overlap > 0 && input.Document.MutualExclusionGroupVersionID == "" {
		return experiment.PublishOutput{}, experiment.ErrConflict
	}
	if input.Document.MutualExclusionGroupVersionID != "" {
		var groupValid bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM experiment_group_versions gv
			JOIN experiment_group_memberships gm ON gm.group_version_id=gv.id
			WHERE gv.id=$1 AND gv.project_id=$2 AND gv.environment_id=$3
			AND gv.assignment_key_policy=$4 AND gm.experiment_id=$5
		)`, input.Document.MutualExclusionGroupVersionID, scope.ProjectID, scope.EnvironmentID, input.Document.AssignmentKeyPolicy, input.Experiment.ID).Scan(&groupValid)
		if e != nil {
			return experiment.PublishOutput{}, persistence(e)
		}
		if !groupValid {
			return experiment.PublishOutput{}, fmt.Errorf("mutual exclusion group is invalid: %w", experiment.ErrInvalid)
		}
		var outsideGroup int
		e = tx.QueryRow(ctx, `SELECT count(*) FROM experiments other
			LEFT JOIN experiment_versions active ON active.id=other.active_version_id
			LEFT JOIN experiment_group_memberships membership ON membership.group_version_id=$4 AND membership.experiment_id=other.id
			WHERE other.environment_id=$1 AND other.placement_id=$2
			AND other.state IN ('scheduled','running','paused') AND other.id<>$3
			AND (active.group_version_id IS DISTINCT FROM $4 OR membership.experiment_id IS NULL)`, scope.EnvironmentID, input.Experiment.PlacementID, input.Experiment.ID, input.Document.MutualExclusionGroupVersionID).Scan(&outsideGroup)
		if e != nil {
			return experiment.PublishOutput{}, persistence(e)
		}
		if outsideGroup > 0 {
			return experiment.PublishOutput{}, experiment.ErrConflict
		}
	}
	versionID, e := nextID(ctx, tx, "experiment_version")
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	var number int64
	e = tx.QueryRow(ctx, `SELECT COALESCE(max(version_number),0)+1 FROM experiment_versions WHERE experiment_id=$1`, input.Experiment.ID).Scan(&number)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	primaryID, primaryVersion := metricParts(input.Document.PrimaryMetricVersionID)
	allocationID, e := nextID(ctx, tx, "experiment_allocation")
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	_, e = tx.Exec(ctx, `INSERT INTO experiment_versions(id,experiment_id,project_id,environment_id,placement_id,version_number,source_draft_id,source_revision,canonical_digest,assignment_key_policy,bucketing_algorithm,allocation_version,primary_metric_id,primary_metric_version,group_version_id,starts_at,ends_at,fallback,compatibility,published_by_actor_id,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULLIF($15,''),$16,$17,'normal_placement',$18,$19,$20)`, versionID, input.Experiment.ID, scope.ProjectID, scope.EnvironmentID, input.Experiment.PlacementID, number, input.Draft.ID, input.Draft.Revision, input.Digest, input.Document.AssignmentKeyPolicy, experiment.BucketingAlgorithm, allocationID, primaryID, primaryVersion, input.Document.MutualExclusionGroupVersionID, compiledSchedule.StartsAt, compiledSchedule.EndsAt, []byte(`{"requiredFeatures":[]}`), input.ActorID, input.Now)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	start := 0
	version := experiment.VersionResponse{ID: versionID, ExperimentID: input.Experiment.ID, PlacementID: input.Experiment.PlacementID, VersionNumber: number, SourceRevision: input.Draft.Revision, AssignmentKeyPolicy: input.Document.AssignmentKeyPolicy, BucketingAlgorithm: experiment.BucketingAlgorithm, AllocationVersion: allocationID, PrimaryMetricVersionID: input.Document.PrimaryMetricVersionID, GuardrailMetricVersionIDs: input.Document.GuardrailMetricVersionIDs, Schedule: compiledSchedule, MutualExclusionGroupVersionID: input.Document.MutualExclusionGroupVersionID, PublishedAt: input.Now}
	for i, v := range input.Document.Variants {
		id := v.ID
		if id == "" {
			id, e = nextID(ctx, tx, "experiment_variant")
			if e != nil {
				return experiment.PublishOutput{}, persistence(e)
			}
		}
		end := start + v.AllocationBasisPoints
		_, e = tx.Exec(ctx, `INSERT INTO experiment_variants(id,experiment_version_id,project_id,role,name,paywall_id,paywall_version_id,allocation_start,allocation_end,compatibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}')`, id, versionID, scope.ProjectID, v.Role, v.Name, v.PaywallID, v.PaywallVersionID, start, end)
		if e != nil {
			return experiment.PublishOutput{}, persistence(e)
		}
		version.Variants = append(version.Variants, experiment.VariantResponse{ID: id, Role: v.Role, Name: v.Name, PaywallID: v.PaywallID, PaywallVersionID: v.PaywallVersionID, AllocationStart: start, AllocationEnd: end})
		start = end
		_ = i
	}
	for _, metric := range append([]string{input.Document.PrimaryMetricVersionID}, input.Document.GuardrailMetricVersionIDs...) {
		id, mv := metricParts(metric)
		kind := "guardrail"
		if metric == input.Document.PrimaryMetricVersionID {
			kind = "primary"
		}
		var snapshot []byte
		e = tx.QueryRow(ctx, `SELECT jsonb_build_object('id',id,'version',version,'name',name,'numeratorEvent',numerator_event,'denominatorEvent',denominator_event,'assignmentUnit',assignment_unit,'authority',authority,'availability',availability,'eventFilter',event_filter,'attributionWindowSeconds',attribution_window_seconds,'freshnessSeconds',freshness_seconds,'definition',definition) FROM experiment_metric_definitions WHERE id=$1 AND version=$2 AND availability='available' AND (($3='primary' AND primary_eligible) OR ($3='guardrail' AND guardrail_eligible))`, id, mv, kind).Scan(&snapshot)
		if e != nil {
			return experiment.PublishOutput{}, fmt.Errorf("metric snapshot is unavailable: %w", experiment.ErrInvalid)
		}
		_, e = tx.Exec(ctx, `INSERT INTO experiment_metric_snapshots(experiment_version_id,project_id,metric_id,metric_version,kind,snapshot) VALUES($1,$2,$3,$4,$5,$6)`, versionID, scope.ProjectID, id, mv, kind, snapshot)
		if e != nil {
			return experiment.PublishOutput{}, persistence(e)
		}
	}
	_, e = tx.Exec(ctx, `UPDATE experiment_drafts SET status='published',updated_at=$2 WHERE id=$1`, input.Draft.ID, input.Now)
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE experiments SET active_version_id=$2,updated_by_actor_id=$3,updated_at=$4 WHERE id=$1`, input.Experiment.ID, versionID, input.ActorID, input.Now)
	}
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	publishedState := "running"
	if version.Schedule.StartsAt != nil && version.Schedule.StartsAt.After(input.Now) {
		publishedState = "scheduled"
	}
	_, e = tx.Exec(ctx, `UPDATE experiments SET state=$2 WHERE id=$1`, input.Experiment.ID, publishedState)
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	if publishedState == "scheduled" {
		jobID, jobErr := nextID(ctx, tx, "experiment_schedule")
		if jobErr != nil {
			return experiment.PublishOutput{}, persistence(jobErr)
		}
		_, e = tx.Exec(ctx, `INSERT INTO experiment_scheduling_jobs(id,experiment_id,project_id,environment_id,action,scheduled_at,status,actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,'start',$5,'queued',$6,$7,$7)`, jobID, input.Experiment.ID, scope.ProjectID, scope.EnvironmentID, input.Document.Schedule.StartsAt, input.ActorID, input.Now)
		if e != nil {
			return experiment.PublishOutput{}, persistence(e)
		}
	}
	if input.Document.Schedule.EndsAt != nil {
		jobID, jobErr := nextID(ctx, tx, "experiment_schedule")
		if jobErr != nil {
			return experiment.PublishOutput{}, persistence(jobErr)
		}
		_, e = tx.Exec(ctx, `INSERT INTO experiment_scheduling_jobs(id,experiment_id,project_id,environment_id,action,scheduled_at,status,actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,'complete',$5,'queued',$6,$7,$7)`, jobID, input.Experiment.ID, scope.ProjectID, scope.EnvironmentID, input.Document.Schedule.EndsAt, input.ActorID, input.Now)
		if e != nil {
			return experiment.PublishOutput{}, persistence(e)
		}
	}
	releaseID, e := r.publishRelease(ctx, tx, scope, input.ActorID, input.Now, version, publishedState)
	if e != nil {
		return experiment.PublishOutput{}, e
	}
	historyID, _ := nextID(ctx, tx, "experiment_history")
	_, e = tx.Exec(ctx, `INSERT INTO experiment_lifecycle_history(id,experiment_id,project_id,environment_id,from_state,to_state,reason,release_id,actor_id,created_at) VALUES($1,$2,$3,$4,'draft',$5,'published',$6,$7,$8)`, historyID, input.Experiment.ID, scope.ProjectID, scope.EnvironmentID, publishedState, releaseID, input.ActorID, input.Now)
	if e == nil {
		e = audit(ctx, tx, scope, experiment.Actor{ID: input.ActorID}, "experiment.published", "experiment", input.Experiment.ID, map[string]any{"versionId": versionID, "releaseId": releaseID, "sourceRevision": input.Draft.Revision}, input.Now)
	}
	if e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return experiment.PublishOutput{}, persistence(e)
	}
	return experiment.PublishOutput{Version: version, ReleaseID: releaseID}, nil
}

func (r *Repository) publishRelease(ctx context.Context, tx pgx.Tx, scope experiment.Scope, actorID string, now time.Time, version experiment.VersionResponse, lifecycle string) (string, error) {
	var oldID string
	var number int64
	e := tx.QueryRow(ctx, `SELECT current_release_id,last_release_number FROM environment_release_state WHERE environment_id=$1 FOR UPDATE`, scope.EnvironmentID).Scan(&oldID, &number)
	if e != nil || oldID == "" {
		return "", fmt.Errorf("environment has no current release: %w", experiment.ErrInvalid)
	}
	var base []byte
	e = tx.QueryRow(ctx, `SELECT COALESCE((SELECT payload_bytes FROM configuration_release_representations WHERE release_id=$1 AND delivery_contract_version='2'),(SELECT payload_bytes FROM configuration_releases WHERE id=$1))`, oldID).Scan(&base)
	if e != nil {
		return "", persistence(e)
	}
	var envelope map[string]any
	if e = json.Unmarshal(base, &envelope); e != nil {
		return "", fmt.Errorf("current release bytes are invalid: %w", experiment.ErrInvalid)
	}
	release, ok := envelope["release"].(map[string]any)
	if !ok {
		return "", fmt.Errorf("current release envelope is missing release metadata: %w", experiment.ErrInvalid)
	}
	releaseID, e := nextID(ctx, tx, "release")
	if e != nil {
		return "", persistence(e)
	}
	release["id"], release["number"], release["publishedAt"] = releaseID, number+1, now.Format("2006-01-02T15:04:05.000Z")
	if e = setReleaseContentDigest(release); e != nil {
		return "", e
	}
	v2, e := json.Marshal(envelope)
	if e != nil {
		return "", fmt.Errorf("marshal delivery v2: %w", e)
	}
	if e = validateDeliveryPayload(v2, "2"); e != nil {
		return "", e
	}
	type activeExperiment struct {
		experimentID, versionID, lifecycle string
	}
	rows, e := tx.Query(ctx, `SELECT id,active_version_id,state FROM experiments WHERE project_id=$1 AND environment_id=$2 AND active_version_id IS NOT NULL AND state IN ('scheduled','running','paused') ORDER BY id`, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return "", persistence(e)
	}
	active := []activeExperiment{}
	for rows.Next() {
		var item activeExperiment
		if e = rows.Scan(&item.experimentID, &item.versionID, &item.lifecycle); e != nil {
			rows.Close()
			return "", persistence(e)
		}
		if item.experimentID == version.ExperimentID {
			item.lifecycle = lifecycle
			item.versionID = version.ID
		}
		active = append(active, item)
	}
	rows.Close()
	if e = rows.Err(); e != nil {
		return "", persistence(e)
	}
	assignments := []any{}
	activeVersions := []string{}
	contractFeatureSet := map[string]bool{}
	algorithmSet := map[string]bool{}
	for _, item := range active {
		if item.lifecycle != "scheduled" && item.lifecycle != "running" && item.lifecycle != "paused" && item.lifecycle != "stopped" && item.lifecycle != "completed" {
			continue
		}
		itemVersion := version
		if item.versionID != version.ID {
			itemVersion, e = r.version(ctx, tx, item.versionID, scope.ProjectID)
			if e != nil {
				return "", e
			}
		}
		assignment, assignmentErr := r.assignmentPayload(ctx, tx, scope, itemVersion, item.lifecycle, now)
		if assignmentErr != nil {
			return "", assignmentErr
		}
		assignments = append(assignments, assignment)
		activeVersions = append(activeVersions, itemVersion.ID)
		if compatibility, ok := assignment["compatibility"].(map[string]any); ok {
			if required, ok := compatibility["requiredFeatures"].([]string); ok {
				for _, feature := range required {
					contractFeatureSet[feature] = true
				}
			}
			if algorithms, ok := compatibility["bucketingAlgorithms"].([]string); ok {
				for _, algorithm := range algorithms {
					algorithmSet[algorithm] = true
				}
			}
		}
	}
	release["experimentAssignments"] = assignments
	compat, _ := release["compatibility"].(map[string]any)
	if compat == nil {
		compat = map[string]any{}
		release["compatibility"] = compat
	}
	contractFeatures := make([]string, 0, len(contractFeatureSet))
	for feature := range contractFeatureSet {
		contractFeatures = append(contractFeatures, feature)
	}
	sort.Strings(contractFeatures)
	algorithms := make([]string, 0, len(algorithmSet))
	for algorithm := range algorithmSet {
		algorithms = append(algorithms, algorithm)
	}
	sort.Strings(algorithms)
	contracts := []any{}
	if len(assignments) != 0 {
		contracts = append(contracts, map[string]any{"version": "1", "requiredFeatures": contractFeatures, "bucketingAlgorithms": algorithms, "schedulePolicies": []string{"trusted_server_time_v1"}})
	}
	compat["experimentAssignmentContracts"] = contracts
	envelope["configurationDeliveryVersion"] = "3"
	if e = r.ensureExperimentReleaseClosure(ctx, tx, scope, release, assignments); e != nil {
		return "", e
	}
	if e = setReleaseContentDigest(release); e != nil {
		return "", e
	}
	v3, e := json.Marshal(envelope)
	if e != nil {
		return "", fmt.Errorf("marshal delivery v3: %w", e)
	}
	if e = validateExperimentDeliveryPayload(v3); e != nil {
		return "", e
	}
	sum := sha256.Sum256(v3)
	hash := hex.EncodeToString(sum[:])
	_, e = tx.Exec(ctx, `INSERT INTO configuration_releases(id,project_id,environment_id,release_number,delivery_contract_version,payload,payload_bytes,content_hash,source_release_id,published_by_actor_id,published_at) VALUES($1,$2,$3,$4,'3',$5::jsonb,$6::bytea,$7,$8,$9,$10)`, releaseID, scope.ProjectID, scope.EnvironmentID, number+1, string(v3), v3, hash, oldID, actorID, now)
	if e != nil {
		return "", persistence(e)
	}
	sum2 := sha256.Sum256(v2)
	_, e = tx.Exec(ctx, `INSERT INTO configuration_release_representations(release_id,environment_id,delivery_contract_version,payload,payload_bytes,content_hash,created_at) VALUES($1,$2,'2',$3::jsonb,$4::bytea,$5,$6),($1,$2,'3',$7::jsonb,$8::bytea,$9,$6)`, releaseID, scope.EnvironmentID, string(v2), v2, hex.EncodeToString(sum2[:]), now, string(v3), v3, hash)
	if e != nil {
		return "", persistence(e)
	}
	_, e = tx.Exec(ctx, `INSERT INTO configuration_release_placements SELECT $1,project_id,environment_id,placement_id,placement_key,paywall_version_id FROM configuration_release_placements WHERE release_id=$2; INSERT INTO configuration_release_products SELECT $1,environment_id,project_id,product_id FROM configuration_release_products WHERE release_id=$2; INSERT INTO configuration_release_assets SELECT $1,environment_id,project_id,asset_id FROM configuration_release_assets WHERE release_id=$2; INSERT INTO configuration_release_rule_set_versions SELECT $1,environment_id,project_id,rule_set_version_id,placement_id FROM configuration_release_rule_set_versions WHERE release_id=$2`, releaseID, oldID)
	if e != nil {
		return "", persistence(e)
	}
	_, e = tx.Exec(ctx, `
		INSERT INTO configuration_release_products(release_id,environment_id,project_id,product_id)
		SELECT DISTINCT $1,$2,$3,pvp.product_id FROM experiment_versions ev
		JOIN experiment_variants variant ON variant.experiment_version_id=ev.id
		JOIN paywall_version_products pvp ON pvp.version_id=variant.paywall_version_id
		WHERE ev.id=ANY($4::text[]) ON CONFLICT DO NOTHING;
		INSERT INTO configuration_release_assets(release_id,environment_id,project_id,asset_id)
		SELECT DISTINCT $1,$2,$3,pva.asset_id FROM experiment_versions ev
		JOIN experiment_variants variant ON variant.experiment_version_id=ev.id
		JOIN paywall_version_assets pva ON pva.version_id=variant.paywall_version_id
		WHERE ev.id=ANY($4::text[]) ON CONFLICT DO NOTHING`, releaseID, scope.EnvironmentID, scope.ProjectID, activeVersions)
	if e != nil {
		return "", persistence(e)
	}
	for _, versionID := range activeVersions {
		if _, e = tx.Exec(ctx, `INSERT INTO configuration_release_experiment_versions(release_id,experiment_version_id,project_id,environment_id) VALUES($1,$2,$3,$4)`, releaseID, versionID, scope.ProjectID, scope.EnvironmentID); e != nil {
			return "", persistence(e)
		}
	}
	_, e = tx.Exec(ctx, `UPDATE environment_release_state SET current_release_id=$1,last_release_number=$2,updated_at=$3 WHERE environment_id=$4`, releaseID, number+1, now, scope.EnvironmentID)
	return releaseID, persistence(e)
}

func setReleaseContentDigest(release map[string]any) error {
	delete(release, "contentDigest")
	canonical, err := json.Marshal(release)
	if err != nil {
		return fmt.Errorf("canonicalize release metadata: %w", err)
	}
	digest := sha256.Sum256(canonical)
	release["contentDigest"] = "sha256:" + hex.EncodeToString(digest[:])
	return nil
}

func objectArray(value any) []map[string]any {
	raw, _ := value.([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if object, ok := item.(map[string]any); ok {
			out = append(out, object)
		}
	}
	return out
}

func (r *Repository) ensureExperimentReleaseClosure(ctx context.Context, tx pgx.Tx, scope experiment.Scope, release map[string]any, assignments []any) error {
	paywalls := objectArray(release["paywallVersions"])
	products := objectArray(release["productReferences"])
	entitlements := objectArray(release["entitlementReferences"])
	assets := objectArray(release["assetReferences"])
	paywallSet, productSet, entitlementSet, assetSet := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, value := range paywalls {
		id, _ := value["id"].(string)
		paywallSet[id] = true
	}
	for _, value := range products {
		id, _ := value["id"].(string)
		productSet[id] = true
	}
	for _, value := range entitlements {
		id, _ := value["id"].(string)
		entitlementSet[id] = true
	}
	for _, value := range assets {
		id, _ := value["id"].(string)
		assetSet[id] = true
	}
	requiredPaywalls := map[string]bool{}
	for _, rawAssignment := range assignments {
		assignment, _ := rawAssignment.(map[string]any)
		for _, variant := range objectArray(assignment["variants"]) {
			id, _ := variant["paywallVersionId"].(string)
			requiredPaywalls[id] = true
		}
	}
	ids := make([]string, 0, len(requiredPaywalls))
	for id := range requiredPaywalls {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if paywallSet[id] {
			continue
		}
		var paywallID, protocolVersion, documentHash string
		var document []byte
		if err := tx.QueryRow(ctx, `SELECT paywall_id,protocol_version,document,document_hash FROM paywall_versions WHERE id=$1 AND project_id=$2 AND environment_id=$3`, id, scope.ProjectID, scope.EnvironmentID).Scan(&paywallID, &protocolVersion, &document, &documentHash); err != nil {
			return persistence(err)
		}
		productIDs := []string{}
		rows, err := tx.Query(ctx, `SELECT p.id,p.type,p.internal_name,p.readiness_ready FROM paywall_version_products pvp JOIN products p ON p.id=pvp.product_id AND p.project_id=pvp.project_id WHERE pvp.version_id=$1 ORDER BY p.id`, id)
		if err != nil {
			return persistence(err)
		}
		for rows.Next() {
			var productID, productType, name string
			var ready bool
			if err = rows.Scan(&productID, &productType, &name, &ready); err != nil {
				rows.Close()
				return persistence(err)
			}
			productIDs = append(productIDs, productID)
			if !productSet[productID] {
				readiness := "not_ready"
				if ready {
					readiness = "ready"
				}
				products = append(products, map[string]any{"id": productID, "type": productType, "fallbackDisplayName": name, "readiness": readiness})
				productSet[productID] = true
			}
		}
		rows.Close()
		bindings := []any{}
		rows, err = tx.Query(ctx, `SELECT pva.document_asset_id,a.id,a.kind,a.media_type,a.byte_length,a.content_digest,a.url FROM paywall_version_assets pva JOIN assets a ON a.id=pva.asset_id AND a.project_id=pva.project_id WHERE pva.version_id=$1 ORDER BY pva.document_asset_id`, id)
		if err != nil {
			return persistence(err)
		}
		for rows.Next() {
			var documentAssetID, assetID, kind, mediaType, digest, url string
			var byteLength int64
			if err = rows.Scan(&documentAssetID, &assetID, &kind, &mediaType, &byteLength, &digest, &url); err != nil {
				rows.Close()
				return persistence(err)
			}
			bindings = append(bindings, map[string]any{"documentAssetId": documentAssetID, "assetReferenceId": assetID})
			if !assetSet[assetID] {
				assets = append(assets, map[string]any{"id": assetID, "kind": kind, "mediaType": mediaType, "byteLength": byteLength, "contentDigest": digest, "url": url})
				assetSet[assetID] = true
			}
		}
		rows.Close()
		var decoded any
		if err = json.Unmarshal(document, &decoded); err != nil {
			return fmt.Errorf("decode experiment paywall document: %w", err)
		}
		paywalls = append(paywalls, map[string]any{"id": id, "paywallId": paywallID, "protocolVersion": protocolVersion, "documentDigest": "sha256:" + documentHash, "document": decoded, "productReferenceIds": productIDs, "assetBindings": bindings})
		paywallSet[id] = true
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT e.id,e.key FROM product_entitlement_grants peg JOIN entitlements e ON e.id=peg.entitlement_id AND e.project_id=peg.project_id WHERE peg.product_id=ANY($1::text[]) ORDER BY e.id`, mapKeys(productSet))
	if err != nil {
		return persistence(err)
	}
	for rows.Next() {
		var id, key string
		if err = rows.Scan(&id, &key); err != nil {
			rows.Close()
			return persistence(err)
		}
		if !entitlementSet[id] {
			entitlements = append(entitlements, map[string]any{"id": id, "key": key})
			entitlementSet[id] = true
		}
	}
	rows.Close()
	sort.Slice(paywalls, func(i, j int) bool { return fmt.Sprint(paywalls[i]["id"]) < fmt.Sprint(paywalls[j]["id"]) })
	sort.Slice(products, func(i, j int) bool { return fmt.Sprint(products[i]["id"]) < fmt.Sprint(products[j]["id"]) })
	sort.Slice(entitlements, func(i, j int) bool { return fmt.Sprint(entitlements[i]["id"]) < fmt.Sprint(entitlements[j]["id"]) })
	sort.Slice(assets, func(i, j int) bool { return fmt.Sprint(assets[i]["id"]) < fmt.Sprint(assets[j]["id"]) })
	release["paywallVersions"], release["productReferences"], release["entitlementReferences"], release["assetReferences"] = paywalls, products, entitlements, assets
	return nil
}

func mapKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for id := range values {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

func validateExperimentDeliveryPayload(payload []byte) error {
	if err := validateDeliveryPayload(payload, "3"); err != nil {
		return err
	}
	var envelope struct {
		Version string `json:"configurationDeliveryVersion"`
		Release struct {
			ContentDigest     string           `json:"contentDigest"`
			PaywallVersions   []map[string]any `json:"paywallVersions"`
			ProductReferences []map[string]any `json:"productReferences"`
			Assignments       []struct {
				Variants []struct {
					PaywallVersionID string `json:"paywallVersionId"`
					Compatibility    struct {
						ProductIDs []string `json:"requiredProductIds"`
					} `json:"compatibility"`
				} `json:"variants"`
			} `json:"experimentAssignments"`
		} `json:"release"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.Version != "3" {
		return fmt.Errorf("emitted delivery v3 is invalid: %w", experiment.ErrInvalid)
	}
	paywalls, products := map[string]bool{}, map[string]bool{}
	for _, value := range envelope.Release.PaywallVersions {
		id, _ := value["id"].(string)
		paywalls[id] = true
	}
	for _, value := range envelope.Release.ProductReferences {
		id, _ := value["id"].(string)
		products[id] = true
	}
	for _, assignment := range envelope.Release.Assignments {
		for _, variant := range assignment.Variants {
			if !paywalls[variant.PaywallVersionID] {
				return fmt.Errorf("experiment paywall closure is incomplete: %w", experiment.ErrInvalid)
			}
			for _, id := range variant.Compatibility.ProductIDs {
				if !products[id] {
					return fmt.Errorf("experiment product closure is incomplete: %w", experiment.ErrInvalid)
				}
			}
		}
	}
	return nil
}

func validateDeliveryPayload(payload []byte, expectedVersion string) error {
	var root map[string]any
	if err := json.Unmarshal(payload, &root); err != nil || root["configurationDeliveryVersion"] != expectedVersion {
		return fmt.Errorf("emitted delivery v%s is invalid: %w", expectedVersion, experiment.ErrInvalid)
	}
	release, ok := root["release"].(map[string]any)
	if !ok {
		return fmt.Errorf("emitted delivery v%s has no release: %w", expectedVersion, experiment.ErrInvalid)
	}
	declared, _ := release["contentDigest"].(string)
	if err := setReleaseContentDigest(release); err != nil || release["contentDigest"] != declared {
		return fmt.Errorf("emitted delivery v%s digest is invalid: %w", expectedVersion, experiment.ErrInvalid)
	}
	return nil
}

func (r *Repository) assignmentPayload(ctx context.Context, tx pgx.Tx, scope experiment.Scope, version experiment.VersionResponse, lifecycle string, now time.Time) (map[string]any, error) {
	features := []string{"allocation.ranges", "assignment." + version.AssignmentKeyPolicy, "fallback.normal_placement", "schedule.trusted_server_time"}
	algorithms := []string{experiment.BucketingAlgorithm}
	variants := make([]any, 0, len(version.Variants))
	for _, value := range version.Variants {
		rows, err := tx.Query(ctx, `SELECT product_id FROM paywall_version_products WHERE version_id=$1 ORDER BY product_id`, value.PaywallVersionID)
		if err != nil {
			return nil, persistence(err)
		}
		products := []string{}
		for rows.Next() {
			var product string
			if err = rows.Scan(&product); err != nil {
				rows.Close()
				return nil, persistence(err)
			}
			products = append(products, product)
		}
		rows.Close()
		capabilities := []string{}
		if len(products) != 0 {
			capabilities = []string{"product_load", "purchase"}
		}
		variants = append(variants, map[string]any{"id": value.ID, "name": value.Name, "role": value.Role, "paywallId": value.PaywallID, "paywallVersionId": value.PaywallVersionID, "rangeStart": value.AllocationStart, "rangeEnd": value.AllocationEnd, "compatibility": map[string]any{"requiredProductIds": products, "requiredProviderCapabilities": capabilities}})
	}
	schedule := map[string]any{"startsAt": version.Schedule.StartsAt.UTC().Format("2006-01-02T15:04:05.000Z"), "timePolicy": "trusted_server_time_v1", "unreliableTimeBehavior": "normal_placement"}
	if version.Schedule.EndsAt != nil {
		schedule["endsAt"] = version.Schedule.EndsAt.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	assignment := map[string]any{"projectId": scope.ProjectID, "environmentId": scope.EnvironmentID, "experimentId": version.ExperimentID, "experimentVersionId": version.ID, "placementId": version.PlacementID, "controlPaywallVersionId": controlPaywall(version), "allocationVersion": version.AllocationVersion, "variants": variants, "assignmentKeyPolicy": version.AssignmentKeyPolicy, "bucketingAlgorithm": version.BucketingAlgorithm, "lifecycle": lifecycle, "schedule": schedule, "qaOverrides": []any{}, "fallback": "normal_placement"}
	if version.MutualExclusionGroupVersionID != "" {
		var groupID string
		var holdoutStart, holdoutEnd *int
		if err := tx.QueryRow(ctx, `SELECT group_id,holdout_start,holdout_end FROM experiment_group_versions WHERE id=$1 AND project_id=$2 AND environment_id=$3`, version.MutualExclusionGroupVersionID, scope.ProjectID, scope.EnvironmentID).Scan(&groupID, &holdoutStart, &holdoutEnd); err != nil {
			return nil, persistence(err)
		}
		memberRows, err := tx.Query(ctx, `SELECT experiment_id,range_start,range_end FROM experiment_group_memberships WHERE group_version_id=$1 ORDER BY range_start`, version.MutualExclusionGroupVersionID)
		if err != nil {
			return nil, persistence(err)
		}
		members := []any{}
		containsExperiment := false
		for memberRows.Next() {
			var experimentID string
			var start, end int
			if err = memberRows.Scan(&experimentID, &start, &end); err != nil {
				memberRows.Close()
				return nil, persistence(err)
			}
			containsExperiment = containsExperiment || experimentID == version.ExperimentID
			members = append(members, map[string]any{"experimentId": experimentID, "rangeStart": start, "rangeEnd": end})
		}
		memberRows.Close()
		if err = memberRows.Err(); err != nil {
			return nil, persistence(err)
		}
		if !containsExperiment {
			return nil, experiment.ErrInvalid
		}
		group := map[string]any{"id": groupID, "versionId": version.MutualExclusionGroupVersionID, "members": members, "bucketingAlgorithm": experiment.GroupBucketingAlgorithm}
		if holdoutStart != nil && holdoutEnd != nil {
			group["normalPlacementRange"] = map[string]any{"rangeStart": *holdoutStart, "rangeEnd": *holdoutEnd}
		}
		assignment["mutualExclusionGroup"] = group
		features = append(features, "group.mutual_exclusion")
		algorithms = append(algorithms, experiment.GroupBucketingAlgorithm)
	}
	rows, err := tx.Query(ctx, `SELECT id,variant_id,identity_type,selector_digest,safe_label,created_at,expires_at FROM experiment_qa_overrides WHERE experiment_version_id=$1 AND status='active' AND expires_at>$2 ORDER BY id`, version.ID, now)
	if err != nil {
		return nil, persistence(err)
	}
	overrides := []any{}
	for rows.Next() {
		var id, variantID, identityType, label string
		var digest []byte
		var starts, expires time.Time
		if err = rows.Scan(&id, &variantID, &identityType, &digest, &label, &starts, &expires); err != nil {
			rows.Close()
			return nil, persistence(err)
		}
		overrides = append(overrides, map[string]any{"id": id, "variantId": variantID, "assignmentKeyType": identityType, "selectorDigest": "sha256:" + hex.EncodeToString(digest), "safeLabel": label, "startsAt": starts.UTC().Format("2006-01-02T15:04:05.000Z"), "expiresAt": expires.UTC().Format("2006-01-02T15:04:05.000Z"), "visibility": "diagnostic"})
	}
	rows.Close()
	if len(overrides) != 0 {
		features = append(features, "override.qa")
		assignment["qaOverrides"] = overrides
	}
	sort.Strings(features)
	assignment["compatibility"] = map[string]any{"requiredFeatures": features, "bucketingAlgorithms": algorithms, "schedulePolicies": []string{"trusted_server_time_v1"}}
	return assignment, nil
}

func controlPaywall(v experiment.VersionResponse) string {
	for _, x := range v.Variants {
		if x.Role == "control" {
			return x.PaywallVersionID
		}
	}
	return ""
}

func (r *Repository) Transition(ctx context.Context, scope experiment.Scope, actor experiment.Actor, id, target, reason string, now time.Time) (experiment.Experiment, string, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return experiment.Experiment{}, "", persistence(e)
	}
	defer tx.Rollback(ctx)
	current, e := scanExperiment(tx.QueryRow(ctx, `SELECT `+experimentColumns+` FROM experiments WHERE id=$1 AND project_id=$2 AND environment_id=$3 FOR UPDATE`, id, scope.ProjectID, scope.EnvironmentID))
	if e != nil {
		return current, "", persistence(e)
	}
	version, e := r.version(ctx, tx, current.ActiveVersionID, scope.ProjectID)
	if e != nil {
		return current, "", e
	}
	releaseID, e := r.publishRelease(ctx, tx, scope, actor.ID, now, version, target)
	if e != nil {
		return current, "", e
	}
	var archived *time.Time
	if target == "archived" {
		archived = &now
	}
	_, e = tx.Exec(ctx, `UPDATE experiments SET state=$2,updated_by_actor_id=$3,updated_at=$4,archived_at=$5 WHERE id=$1`, id, target, actor.ID, now, archived)
	if e != nil {
		return current, "", persistence(e)
	}
	historyID, _ := nextID(ctx, tx, "experiment_history")
	_, e = tx.Exec(ctx, `INSERT INTO experiment_lifecycle_history(id,experiment_id,project_id,environment_id,from_state,to_state,reason,release_id,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10)`, historyID, id, scope.ProjectID, scope.EnvironmentID, current.State, target, reason, releaseID, actor.ID, now)
	if e == nil {
		e = audit(ctx, tx, scope, actor, "experiment."+target, "experiment", id, map[string]any{"from": current.State, "to": target, "reason": reason, "releaseId": releaseID}, now)
	}
	if e != nil {
		return current, "", persistence(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return current, "", persistence(e)
	}
	current.State, current.UpdatedAt, current.UpdatedByActorID, current.ArchivedAt = target, now, actor.ID, archived
	return current, releaseID, nil
}

func (r *Repository) Versions(ctx context.Context, scope experiment.Scope, id string) ([]experiment.VersionResponse, error) {
	rows, e := r.pool.Query(ctx, `SELECT id FROM experiment_versions WHERE experiment_id=$1 AND project_id=$2 AND environment_id=$3 ORDER BY version_number DESC`, id, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return nil, persistence(e)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var x string
		if e = rows.Scan(&x); e != nil {
			return nil, persistence(e)
		}
		ids = append(ids, x)
	}
	out := []experiment.VersionResponse{}
	for _, x := range ids {
		v, e := r.version(ctx, r.pool, x, scope.ProjectID)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, nil
}
func (r *Repository) History(ctx context.Context, scope experiment.Scope, id string) ([]experiment.HistoryEntry, error) {
	rows, e := r.pool.Query(ctx, `SELECT h.id,h.from_state,h.to_state,COALESCE(h.reason,''),COALESCE(h.release_id,''),h.actor_id,h.created_at FROM experiment_lifecycle_history h JOIN experiments e ON e.id=h.experiment_id WHERE h.experiment_id=$1 AND e.project_id=$2 AND e.environment_id=$3 ORDER BY h.created_at DESC`, id, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return nil, persistence(e)
	}
	defer rows.Close()
	out := []experiment.HistoryEntry{}
	for rows.Next() {
		var v experiment.HistoryEntry
		if e = rows.Scan(&v.ID, &v.FromState, &v.ToState, &v.Reason, &v.ReleaseID, &v.ActorID, &v.CreatedAt); e != nil {
			return nil, persistence(e)
		}
		out = append(out, v)
	}
	return out, persistence(rows.Err())
}
func (r *Repository) Metrics(ctx context.Context) ([]experiment.MetricDefinition, error) {
	rows, e := r.pool.Query(ctx, `SELECT id,version,name,numerator_event,denominator_event,assignment_unit,authority,availability,event_filter,attribution_window_seconds,freshness_seconds,definition,primary_eligible,guardrail_eligible FROM experiment_metric_definitions ORDER BY id,version`)
	if e != nil {
		return nil, persistence(e)
	}
	defer rows.Close()
	out := []experiment.MetricDefinition{}
	for rows.Next() {
		var v experiment.MetricDefinition
		if e = rows.Scan(&v.ID, &v.Version, &v.Name, &v.NumeratorEvent, &v.DenominatorEvent, &v.AssignmentUnit, &v.Authority, &v.Availability, &v.EventFilter, &v.AttributionWindowSeconds, &v.FreshnessSeconds, &v.Definition, &v.PrimaryEligible, &v.GuardrailEligible); e != nil {
			return nil, persistence(e)
		}
		out = append(out, v)
	}
	return out, persistence(rows.Err())
}
func (r *Repository) Aggregates(ctx context.Context, scope experiment.Scope, id string) (experiment.Experiment, experiment.VersionResponse, []experiment.VariantAggregate, error) {
	item, _, version, e := r.Get(ctx, scope, id)
	if e != nil || version == nil {
		return item, experiment.VersionResponse{}, nil, e
	}
	rows, e := r.pool.Query(ctx, `SELECT v.id,v.role,(v.allocation_end-v.allocation_start),COALESCE(sum(a.unique_exposures),0),COALESCE(sum(a.unique_conversions),0),COALESCE(sum(a.raw_exposure_events),0),COALESCE(sum(a.fallback_presentations),0),max(a.latest_received_at) FROM experiment_variants v LEFT JOIN experiment_daily_unique_units a ON a.experiment_version_id=v.experiment_version_id AND a.variant_id=v.id AND a.metric_id=$2 WHERE v.experiment_version_id=$1 GROUP BY v.id,v.role,v.allocation_start,v.allocation_end ORDER BY v.allocation_start`, version.ID, metricPartsFirst(version.PrimaryMetricVersionID))
	if e != nil {
		return item, *version, nil, persistence(e)
	}
	defer rows.Close()
	out := []experiment.VariantAggregate{}
	for rows.Next() {
		var v experiment.VariantAggregate
		if e = rows.Scan(&v.VariantID, &v.Role, &v.AllocationBasisPoints, &v.UniqueExposures, &v.UniqueConversions, &v.RawExposureEvents, &v.FallbackPresentations, &v.LatestReceivedAt); e != nil {
			return item, *version, nil, persistence(e)
		}
		out = append(out, v)
	}
	return item, *version, out, persistence(rows.Err())
}

func (r *Repository) GuardrailAggregates(ctx context.Context, scope experiment.Scope, versionID string) ([]experiment.GuardrailAggregate, error) {
	rows, err := r.pool.Query(ctx, `SELECT definition.id,definition.version,definition.name,definition.numerator_event,definition.denominator_event,definition.assignment_unit,definition.authority,definition.availability,definition.event_filter,definition.attribution_window_seconds,definition.freshness_seconds,definition.definition,definition.primary_eligible,definition.guardrail_eligible,
		variant.id,variant.role,(variant.allocation_end-variant.allocation_start),COALESCE(sum(aggregate.unique_exposures),0),COALESCE(sum(aggregate.unique_conversions),0),COALESCE(sum(aggregate.raw_exposure_events),0),COALESCE(sum(aggregate.fallback_presentations),0),max(aggregate.latest_received_at)
		FROM experiment_metric_snapshots snapshot
		JOIN experiment_versions version ON version.id=snapshot.experiment_version_id
		JOIN experiment_metric_definitions definition ON definition.id=snapshot.metric_id AND definition.version=snapshot.metric_version
		JOIN experiment_variants variant ON variant.experiment_version_id=snapshot.experiment_version_id
		LEFT JOIN experiment_daily_unique_units aggregate ON aggregate.experiment_version_id=variant.experiment_version_id AND aggregate.variant_id=variant.id AND aggregate.metric_id=snapshot.metric_id AND aggregate.metric_version=snapshot.metric_version AND aggregate.authority=definition.authority
		WHERE snapshot.experiment_version_id=$1 AND snapshot.project_id=$2 AND version.environment_id=$3 AND snapshot.kind='guardrail'
		GROUP BY definition.id,definition.version,definition.name,definition.numerator_event,definition.denominator_event,definition.assignment_unit,definition.authority,definition.availability,definition.event_filter,definition.attribution_window_seconds,definition.freshness_seconds,definition.definition,definition.primary_eligible,definition.guardrail_eligible,variant.id,variant.role,variant.allocation_start,variant.allocation_end
		ORDER BY definition.id,definition.version,variant.allocation_start`, versionID, scope.ProjectID, scope.EnvironmentID)
	if err != nil {
		return nil, persistence(err)
	}
	defer rows.Close()
	out := []experiment.GuardrailAggregate{}
	indexes := map[string]int{}
	for rows.Next() {
		var definition experiment.MetricDefinition
		var aggregate experiment.VariantAggregate
		if err = rows.Scan(&definition.ID, &definition.Version, &definition.Name, &definition.NumeratorEvent, &definition.DenominatorEvent, &definition.AssignmentUnit, &definition.Authority, &definition.Availability, &definition.EventFilter, &definition.AttributionWindowSeconds, &definition.FreshnessSeconds, &definition.Definition, &definition.PrimaryEligible, &definition.GuardrailEligible, &aggregate.VariantID, &aggregate.Role, &aggregate.AllocationBasisPoints, &aggregate.UniqueExposures, &aggregate.UniqueConversions, &aggregate.RawExposureEvents, &aggregate.FallbackPresentations, &aggregate.LatestReceivedAt); err != nil {
			return nil, persistence(err)
		}
		key := fmt.Sprintf("%s@%d", definition.ID, definition.Version)
		index, ok := indexes[key]
		if !ok {
			index = len(out)
			indexes[key] = index
			out = append(out, experiment.GuardrailAggregate{Definition: definition, Variants: []experiment.VariantAggregate{}})
		}
		out[index].Variants = append(out[index].Variants, aggregate)
	}
	return out, persistence(rows.Err())
}
func metricPartsFirst(v string) string { id, _ := metricParts(v); return id }
func (r *Repository) Groups(ctx context.Context, scope experiment.Scope) ([]experiment.Group, error) {
	rows, e := r.pool.Query(ctx, `SELECT g.id,g.name,g.status,COALESCE((SELECT gv.id FROM experiment_group_versions gv WHERE gv.group_id=g.id ORDER BY version_number DESC LIMIT 1),''),g.created_at FROM experiment_groups g WHERE g.project_id=$1 AND g.environment_id=$2 ORDER BY g.name`, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return nil, persistence(e)
	}
	defer rows.Close()
	out := []experiment.Group{}
	for rows.Next() {
		var v experiment.Group
		if e = rows.Scan(&v.ID, &v.Name, &v.Status, &v.ActiveVersionID, &v.CreatedAt); e != nil {
			return nil, persistence(e)
		}
		out = append(out, v)
	}
	return out, persistence(rows.Err())
}
func (r *Repository) CreateGroup(ctx context.Context, scope experiment.Scope, actor experiment.Actor, input experiment.CreateGroupInput, now time.Time) (experiment.GroupCreated, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	defer tx.Rollback(ctx)
	groupID, err := nextID(ctx, tx, "experiment_group")
	if err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	versionID, err := nextID(ctx, tx, "experiment_group_version")
	if err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO experiment_groups(id,project_id,environment_id,name,status,created_by_actor_id,created_at) VALUES($1,$2,$3,$4,'active',$5,$6)`, groupID, scope.ProjectID, scope.EnvironmentID, input.Name, actor.ID, now)
	if err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	var holdoutStart, holdoutEnd any
	if input.HoldoutBasisPoints > 0 {
		holdoutStart = 10000 - input.HoldoutBasisPoints
		holdoutEnd = 10000
	}
	_, err = tx.Exec(ctx, `INSERT INTO experiment_group_versions(id,group_id,project_id,environment_id,version_number,assignment_key_policy,algorithm,holdout_start,holdout_end,created_by_actor_id,created_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`, versionID, groupID, scope.ProjectID, scope.EnvironmentID, input.AssignmentKeyPolicy, experiment.GroupBucketingAlgorithm, holdoutStart, holdoutEnd, actor.ID, now)
	if err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	start := 0
	for _, member := range input.Members {
		var ok bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM experiments WHERE id=$1 AND project_id=$2 AND environment_id=$3 AND state<>'archived')`, member.ExperimentID, scope.ProjectID, scope.EnvironmentID).Scan(&ok)
		if err != nil || !ok {
			return experiment.GroupCreated{}, experiment.ErrNotFound
		}
		end := start + member.AllocationBasisPoints
		_, err = tx.Exec(ctx, `INSERT INTO experiment_group_memberships(group_version_id,experiment_id,project_id,range_start,range_end) VALUES($1,$2,$3,$4,$5)`, versionID, member.ExperimentID, scope.ProjectID, start, end)
		if err != nil {
			return experiment.GroupCreated{}, persistence(err)
		}
		start = end
	}
	if err = audit(ctx, tx, scope, actor, "experiment_group.created", "experiment_group", groupID, map[string]any{"versionId": versionID, "memberCount": len(input.Members), "holdoutBasisPoints": input.HoldoutBasisPoints}, now); err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return experiment.GroupCreated{}, persistence(err)
	}
	group := experiment.Group{ID: groupID, Name: input.Name, Status: "active", ActiveVersionID: versionID, CreatedAt: now}
	version := experiment.GroupVersion{ID: versionID, GroupID: groupID, VersionNumber: 1, AssignmentKeyPolicy: input.AssignmentKeyPolicy, BucketingAlgorithm: experiment.GroupBucketingAlgorithm, Members: input.Members, HoldoutBasisPoints: input.HoldoutBasisPoints, CreatedAt: now}
	return experiment.GroupCreated{Group: group, Version: version}, nil
}
func (r *Repository) CreateGroupVersion(ctx context.Context, scope experiment.Scope, actor experiment.Actor, groupID string, input experiment.CreateGroupInput, now time.Time) (experiment.GroupVersion, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `experiment-group:`+groupID)
	if err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	var number int
	err = tx.QueryRow(ctx, `SELECT COALESCE(max(gv.version_number),0)+1 FROM experiment_groups g LEFT JOIN experiment_group_versions gv ON gv.group_id=g.id WHERE g.id=$1 AND g.project_id=$2 AND g.environment_id=$3 AND g.status='active' GROUP BY g.id`, groupID, scope.ProjectID, scope.EnvironmentID).Scan(&number)
	if err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	versionID, err := nextID(ctx, tx, "experiment_group_version")
	if err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	var holdoutStart, holdoutEnd any
	if input.HoldoutBasisPoints > 0 {
		holdoutStart = 10000 - input.HoldoutBasisPoints
		holdoutEnd = 10000
	}
	_, err = tx.Exec(ctx, `INSERT INTO experiment_group_versions(id,group_id,project_id,environment_id,version_number,assignment_key_policy,algorithm,holdout_start,holdout_end,created_by_actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, versionID, groupID, scope.ProjectID, scope.EnvironmentID, number, input.AssignmentKeyPolicy, experiment.GroupBucketingAlgorithm, holdoutStart, holdoutEnd, actor.ID, now)
	if err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	start := 0
	for _, member := range input.Members {
		var ok bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM experiments WHERE id=$1 AND project_id=$2 AND environment_id=$3 AND state<>'archived')`, member.ExperimentID, scope.ProjectID, scope.EnvironmentID).Scan(&ok)
		if err != nil || !ok {
			return experiment.GroupVersion{}, experiment.ErrNotFound
		}
		end := start + member.AllocationBasisPoints
		_, err = tx.Exec(ctx, `INSERT INTO experiment_group_memberships(group_version_id,experiment_id,project_id,range_start,range_end) VALUES($1,$2,$3,$4,$5)`, versionID, member.ExperimentID, scope.ProjectID, start, end)
		if err != nil {
			return experiment.GroupVersion{}, persistence(err)
		}
		start = end
	}
	if err = audit(ctx, tx, scope, actor, "experiment_group.version_created", "experiment_group", groupID, map[string]any{"versionId": versionID, "versionNumber": number}, now); err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return experiment.GroupVersion{}, persistence(err)
	}
	return experiment.GroupVersion{ID: versionID, GroupID: groupID, VersionNumber: number, AssignmentKeyPolicy: input.AssignmentKeyPolicy, BucketingAlgorithm: experiment.GroupBucketingAlgorithm, Members: input.Members, HoldoutBasisPoints: input.HoldoutBasisPoints, CreatedAt: now}, nil
}
func (r *Repository) GroupVersions(ctx context.Context, scope experiment.Scope, groupID string) ([]experiment.GroupVersion, error) {
	rows, err := r.pool.Query(ctx, `SELECT gv.id,gv.version_number,gv.assignment_key_policy,gv.algorithm,COALESCE(gv.holdout_end-gv.holdout_start,0),gv.created_at FROM experiment_group_versions gv JOIN experiment_groups g ON g.id=gv.group_id WHERE gv.group_id=$1 AND gv.project_id=$2 AND gv.environment_id=$3 ORDER BY gv.version_number DESC`, groupID, scope.ProjectID, scope.EnvironmentID)
	if err != nil {
		return nil, persistence(err)
	}
	defer rows.Close()
	out := []experiment.GroupVersion{}
	for rows.Next() {
		var v experiment.GroupVersion
		v.GroupID = groupID
		if err = rows.Scan(&v.ID, &v.VersionNumber, &v.AssignmentKeyPolicy, &v.BucketingAlgorithm, &v.HoldoutBasisPoints, &v.CreatedAt); err != nil {
			return nil, persistence(err)
		}
		members, memberErr := r.pool.Query(ctx, `SELECT experiment_id,range_end-range_start FROM experiment_group_memberships WHERE group_version_id=$1 ORDER BY range_start`, v.ID)
		if memberErr != nil {
			return nil, persistence(memberErr)
		}
		for members.Next() {
			var m experiment.GroupMemberInput
			if memberErr = members.Scan(&m.ExperimentID, &m.AllocationBasisPoints); memberErr != nil {
				members.Close()
				return nil, persistence(memberErr)
			}
			v.Members = append(v.Members, m)
		}
		members.Close()
		out = append(out, v)
	}
	return out, persistence(rows.Err())
}
func (r *Repository) CreateOverride(ctx context.Context, scope experiment.Scope, actor experiment.Actor, id, versionID, variantID, identityType, label string, digest []byte, now, expires time.Time) (experiment.QAOverride, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return experiment.QAOverride{}, persistence(e)
	}
	defer tx.Rollback(ctx)
	overrideID, e := nextID(ctx, tx, "experiment_qa")
	if e != nil {
		return experiment.QAOverride{}, persistence(e)
	}
	tag, e := tx.Exec(ctx, `INSERT INTO experiment_qa_overrides(id,experiment_version_id,variant_id,project_id,environment_id,identity_type,safe_label,selector_digest,status,created_by_actor_id,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11 FROM experiment_versions v WHERE v.id=$2 AND v.experiment_id=$12 AND v.project_id=$4 AND EXISTS(SELECT 1 FROM experiment_variants x WHERE x.experiment_version_id=$2 AND x.id=$3)`, overrideID, versionID, variantID, scope.ProjectID, scope.EnvironmentID, identityType, label, digest, actor.ID, now, expires, id)
	if e != nil || tag.RowsAffected() != 1 {
		return experiment.QAOverride{}, experiment.ErrNotFound
	}
	e = audit(ctx, tx, scope, actor, "experiment.qa_override_created", "experiment", id, map[string]any{"overrideId": overrideID, "versionId": versionID, "variantId": variantID, "expiresAt": expires}, now)
	if e != nil {
		return experiment.QAOverride{}, persistence(e)
	}
	if e = tx.Commit(ctx); e != nil {
		return experiment.QAOverride{}, persistence(e)
	}
	return experiment.QAOverride{ID: overrideID, ExperimentVersionID: versionID, VariantID: variantID, IdentityType: identityType, SafeLabel: label, SelectorDigest: "sha256:" + hex.EncodeToString(digest), Status: "active", CreatedAt: now, ExpiresAt: expires}, nil
}
func (r *Repository) Overrides(ctx context.Context, scope experiment.Scope, id string, now time.Time) ([]experiment.QAOverride, error) {
	rows, e := r.pool.Query(ctx, `SELECT o.id,o.experiment_version_id,o.variant_id,o.identity_type,o.safe_label,o.status,o.created_at,o.expires_at,o.revoked_at FROM experiment_qa_overrides o JOIN experiment_versions v ON v.id=o.experiment_version_id WHERE v.experiment_id=$1 AND o.project_id=$2 AND o.environment_id=$3 ORDER BY o.created_at DESC`, id, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return nil, persistence(e)
	}
	defer rows.Close()
	out := []experiment.QAOverride{}
	for rows.Next() {
		var v experiment.QAOverride
		if e = rows.Scan(&v.ID, &v.ExperimentVersionID, &v.VariantID, &v.IdentityType, &v.SafeLabel, &v.Status, &v.CreatedAt, &v.ExpiresAt, &v.RevokedAt); e != nil {
			return nil, persistence(e)
		}
		if v.Status == "active" && !v.ExpiresAt.After(now) {
			v.Status = "expired"
		}
		out = append(out, v)
	}
	return out, persistence(rows.Err())
}
func (r *Repository) RevokeOverride(ctx context.Context, scope experiment.Scope, actor experiment.Actor, id, overrideID string, now time.Time) error {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return persistence(e)
	}
	defer tx.Rollback(ctx)
	tag, e := tx.Exec(ctx, `UPDATE experiment_qa_overrides o SET status='revoked',revoked_at=$1 FROM experiment_versions v WHERE o.id=$2 AND o.experiment_version_id=v.id AND v.experiment_id=$3 AND o.project_id=$4 AND o.environment_id=$5 AND o.status='active'`, now, overrideID, id, scope.ProjectID, scope.EnvironmentID)
	if e != nil {
		return persistence(e)
	}
	if tag.RowsAffected() != 1 {
		return experiment.ErrNotFound
	}
	if e = audit(ctx, tx, scope, actor, "experiment.qa_override_revoked", "experiment", id, map[string]any{"overrideId": overrideID}, now); e != nil {
		return persistence(e)
	}
	return persistence(tx.Commit(ctx))
}

// LeaseSchedule claims the next due scheduling job. It also reclaims leases
// whose owner died before finishing, which the original query could not do: an
// expired lease left the row stuck in 'leased' forever and the scheduled
// Experiment start or completion was silently lost.
func (r *Repository) LeaseSchedule(ctx context.Context, worker string, now, expires time.Time) (experiment.ScheduleJob, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return experiment.ScheduleJob{}, false, persistence(err)
	}
	defer tx.Rollback(ctx)
	var job experiment.ScheduleJob
	err = tx.QueryRow(ctx, `SELECT id,experiment_id,project_id,environment_id,action,actor_id,attempt_count,max_attempts
		FROM experiment_scheduling_jobs
		WHERE (status='queued' OR (status='leased' AND lease_expires_at<=$1))
		  AND scheduled_at<=$1 AND available_at<=$1 AND attempt_count<max_attempts
		ORDER BY available_at,scheduled_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).
		Scan(&job.ID, &job.ExperimentID, &job.ProjectID, &job.EnvironmentID, &job.Action, &job.ActorID, &job.AttemptCount, &job.MaxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return job, false, nil
	}
	if err != nil {
		return job, false, persistence(err)
	}
	_, err = tx.Exec(ctx, `UPDATE experiment_scheduling_jobs SET status='leased',lease_owner=$2,lease_expires_at=$3,attempt_count=attempt_count+1,updated_at=$4 WHERE id=$1`, job.ID, worker, expires, now)
	if err != nil {
		return job, false, persistence(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return job, false, persistence(err)
	}
	job.AttemptCount++
	return job, true, nil
}

// scheduleBackoff is the requeue delay for attempt n, capped so a repeatedly
// failing job still retries within a scheduling window an operator would notice.
func scheduleBackoff(attempt int) time.Duration {
	const base = 15 * time.Second
	const cap = 10 * time.Minute
	delay := base << min(attempt, 6)
	if delay > cap {
		return cap
	}
	return delay
}

// FinishSchedule closes out a leased job. A transient failure is requeued with
// backoff until the retry budget is spent, at which point the job is terminally
// failed with a diagnostic code instead of disappearing.
func (r *Repository) FinishSchedule(ctx context.Context, job experiment.ScheduleJob, success bool, code string, now time.Time) error {
	if success {
		tag, err := r.pool.Exec(ctx, `UPDATE experiment_scheduling_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$2 WHERE id=$1 AND status='leased'`, job.ID, now)
		if err != nil {
			return persistence(err)
		}
		if tag.RowsAffected() != 1 {
			return experiment.ErrConflict
		}
		return nil
	}
	if code == "" {
		code = "schedule_transition_failed"
	}
	tag, err := r.pool.Exec(ctx, `UPDATE experiment_scheduling_jobs
		SET status=CASE WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'queued' END,
		    lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2,
		    available_at=$3::timestamptz+$4::interval,updated_at=$3
		WHERE id=$1 AND status='leased'`,
		job.ID, code, now, scheduleBackoff(job.AttemptCount).String())
	if err != nil {
		return persistence(err)
	}
	if tag.RowsAffected() != 1 {
		return experiment.ErrConflict
	}
	return nil
}

var _ experiment.Repository = (*Repository)(nil)
var _ = sort.Strings
