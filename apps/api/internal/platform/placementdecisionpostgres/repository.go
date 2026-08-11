// Package placementdecisionpostgres persists Placement Decision v1 state in PostgreSQL.
package placementdecisionpostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
)

type Repository struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) View(ctx context.Context, fn func(placementdecision.Reader) error) error {
	state := &state{ctx: ctx, q: r.pool}
	callbackErr := fn(reader{state})
	if state.err != nil {
		return fmt.Errorf("read placement decisions: %w", state.err)
	}
	return callbackErr
}
func (r *Repository) Transact(ctx context.Context, fn func(placementdecision.Transaction) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin placement decision transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	state := &state{ctx: ctx, q: tx}
	transaction := &transaction{reader: reader{state}, tx: tx}
	callbackErr := fn(transaction)
	if state.err != nil {
		return persistenceError(state.err)
	}
	if callbackErr != nil {
		return callbackErr
	}
	if err := tx.Commit(ctx); err != nil {
		return persistenceError(err)
	}
	return nil
}

type querier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}
type state struct {
	ctx context.Context
	q   querier
	err error
}
type reader struct{ *state }

func (r reader) fail(err error) {
	if err != nil && r.err == nil {
		r.err = err
	}
}
func one[T any](r reader, query string, scan func(pgx.Row) (T, error), args ...any) (T, bool) {
	var zero T
	value, err := scan(r.q.QueryRow(r.ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return zero, false
	}
	if err != nil {
		r.fail(err)
		return zero, false
	}
	return value, true
}
func many[T any](r reader, query string, scan func(pgx.Row) (T, error), args ...any) []T {
	rows, err := r.q.Query(r.ctx, query, args...)
	if err != nil {
		r.fail(err)
		return nil
	}
	defer rows.Close()
	result := []T{}
	for rows.Next() {
		value, err := scan(rows)
		if err != nil {
			r.fail(err)
			return nil
		}
		result = append(result, value)
	}
	r.fail(rows.Err())
	return result
}

func (r reader) Scope(actorID, projectID, environmentID, placementID string) (placementdecision.Scope, bool) {
	return one(r, `SELECT project.id,project.organization_id,project.status,member.role,
		COALESCE(environment.id,''),COALESCE(environment.key,''),COALESCE(environment.mode,''),
		COALESCE(placement.id,''),COALESCE(placement.key,''),COALESCE(placement.status,'')
		FROM projects project
		JOIN organization_members member ON member.organization_id=project.organization_id AND member.actor_id=$1
		LEFT JOIN environments environment ON environment.id=NULLIF($3,'') AND environment.project_id=project.id
		LEFT JOIN placements placement ON placement.id=NULLIF($4,'') AND placement.project_id=project.id
		WHERE project.id=$2 AND ($3='' OR environment.id IS NOT NULL) AND ($4='' OR placement.id IS NOT NULL)`, func(row pgx.Row) (placementdecision.Scope, error) {
		var value placementdecision.Scope
		err := row.Scan(&value.ProjectID, &value.OrganizationID, &value.ProjectStatus, &value.Role, &value.EnvironmentID, &value.EnvironmentKey, &value.EnvironmentMode, &value.PlacementID, &value.PlacementKey, &value.PlacementStatus)
		return value, err
	}, actorID, projectID, environmentID, placementID)
}

func scanRuleSet(row pgx.Row) (placementdecision.RuleSet, error) {
	var value placementdecision.RuleSet
	var draftID, versionID *string
	var archivedAt *time.Time
	err := row.Scan(&value.ID, &value.ProjectID, &value.EnvironmentID, &value.PlacementID, &value.ContractVersion, &value.Status, &draftID, &versionID, &value.CreatedByActorID, &value.CreatedAt, &value.UpdatedAt, &archivedAt)
	if draftID != nil {
		value.CurrentDraftID = *draftID
	}
	if versionID != nil {
		value.CurrentPublishedVersionID = *versionID
	}
	value.ArchivedAt = archivedAt
	return value, err
}

const ruleSetColumns = `id,project_id,environment_id,placement_id,contract_version,status,current_draft_id,current_published_version_id,created_by_actor_id,created_at,updated_at,archived_at`

func (r reader) RuleSet(id string) (placementdecision.RuleSet, bool) {
	return one(r, `SELECT `+ruleSetColumns+` FROM placement_rule_sets WHERE id=$1`, scanRuleSet, id)
}
func (r reader) RuleSetForPlacement(environmentID, placementID string) (placementdecision.RuleSet, bool) {
	return one(r, `SELECT `+ruleSetColumns+` FROM placement_rule_sets WHERE environment_id=$1 AND placement_id=$2`, scanRuleSet, environmentID, placementID)
}

func scanDraft(row pgx.Row) (placementdecision.Draft, error) {
	var value placementdecision.Draft
	var source *string
	err := row.Scan(&value.ID, &value.RuleSetID, &value.ProjectID, &value.EnvironmentID, &value.Status, &value.CurrentRevision, &source, &value.CreatedByActorID, &value.UpdatedByActorID, &value.CreatedAt, &value.UpdatedAt)
	if source != nil {
		value.SourceVersionID = *source
	}
	return value, err
}

const draftColumns = `id,rule_set_id,project_id,environment_id,status,current_revision,source_version_id,created_by_actor_id,updated_by_actor_id,created_at,updated_at`

func (r reader) Draft(id string) (placementdecision.Draft, bool) {
	return one(r, `SELECT `+draftColumns+` FROM placement_rule_set_drafts WHERE id=$1`, scanDraft, id)
}

func scanRevision(row pgx.Row) (placementdecision.DraftRevision, error) {
	var value placementdecision.DraftRevision
	var validationBytes []byte
	err := row.Scan(&value.DraftID, &value.RuleSetID, &value.ProjectID, &value.EnvironmentID, &value.Revision, &value.Document, &value.DocumentHash, &validationBytes, &value.MutationHash, &value.RequestHash, &value.ActorID, &value.CreatedAt)
	if err == nil {
		err = json.Unmarshal(validationBytes, &value.Validation)
	}
	return value, err
}

const revisionColumns = `draft_id,rule_set_id,project_id,environment_id,revision,document_bytes,document_hash,validation,mutation_key_hash,request_hash,actor_id,created_at`

func (r reader) DraftRevision(id string, revision int64) (placementdecision.DraftRevision, bool) {
	return one(r, `SELECT `+revisionColumns+` FROM placement_rule_set_draft_revisions WHERE draft_id=$1 AND revision=$2`, scanRevision, id, revision)
}
func (r reader) DraftRevisionByMutation(id, mutation string) (placementdecision.DraftRevision, bool) {
	return one(r, `SELECT `+revisionColumns+` FROM placement_rule_set_draft_revisions WHERE draft_id=$1 AND mutation_key_hash=$2`, scanRevision, id, mutation)
}

func scanVersion(row pgx.Row) (placementdecision.Version, error) {
	var value placementdecision.Version
	var validationBytes []byte
	err := row.Scan(&value.ID, &value.RuleSetID, &value.ProjectID, &value.EnvironmentID, &value.PlacementID, &value.VersionNumber, &value.SourceDraftID, &value.SourceRevision, &value.ContractVersion, &value.Document, &value.DocumentHash, &validationBytes, &value.PublishedByActorID, &value.PublishedAt)
	if err == nil {
		err = json.Unmarshal(validationBytes, &value.Validation)
	}
	return value, err
}

const versionColumns = `id,rule_set_id,project_id,environment_id,placement_id,version_number,source_draft_id,source_revision,contract_version,document_bytes,document_hash,validation,published_by_actor_id,published_at`

func (r reader) Version(id string) (placementdecision.Version, bool) {
	return one(r, `SELECT `+versionColumns+` FROM placement_rule_set_versions WHERE id=$1`, scanVersion, id)
}
func (r reader) Versions(ruleSetID string) []placementdecision.Version {
	return many(r, `SELECT `+versionColumns+` FROM placement_rule_set_versions WHERE rule_set_id=$1 ORDER BY version_number DESC`, scanVersion, ruleSetID)
}

func scanAttribute(row pgx.Row) (placementdecision.AttributeDefinition, error) {
	var value placementdecision.AttributeDefinition
	var archivedAt *time.Time
	err := row.Scan(&value.ID, &value.ProjectID, &value.Key, &value.ValueType, &value.Description, &value.AllowedOperators, &value.Sensitivity, &value.Status, &value.Revision, &value.CreatedByActorID, &value.UpdatedByActorID, &value.CreatedAt, &value.UpdatedAt, &archivedAt)
	value.ArchivedAt = archivedAt
	return value, err
}

const attributeColumns = `id,project_id,key,value_type,description,allowed_operators,sensitivity,status,revision,created_by_actor_id,updated_by_actor_id,created_at,updated_at,archived_at`

func (r reader) AttributeScoped(key, projectID string) (placementdecision.AttributeDefinition, bool) {
	return one(r, `SELECT `+attributeColumns+` FROM placement_attribute_definitions WHERE key=$1 AND project_id=$2`, scanAttribute, key, projectID)
}
func (r reader) Attributes(projectID string) []placementdecision.AttributeDefinition {
	return many(r, `SELECT `+attributeColumns+` FROM placement_attribute_definitions WHERE project_id=$1 ORDER BY key`, scanAttribute, projectID)
}
func (r reader) PaywallVersionScoped(id, projectID, environmentID string) bool {
	var exists bool
	err := r.q.QueryRow(r.ctx, `SELECT EXISTS(SELECT 1 FROM paywall_versions WHERE id=$1 AND project_id=$2 AND environment_id=$3)`, id, projectID, environmentID).Scan(&exists)
	r.fail(err)
	return exists
}
func (r reader) ProductScoped(id, projectID string) bool {
	var exists bool
	err := r.q.QueryRow(r.ctx, `SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND project_id=$2 AND status<>'archived')`, id, projectID).Scan(&exists)
	r.fail(err)
	return exists
}
func (r reader) EntitlementScoped(key, projectID string) bool {
	var exists bool
	err := r.q.QueryRow(r.ctx, `SELECT EXISTS(SELECT 1 FROM entitlements WHERE key=$1 AND project_id=$2)`, key, projectID).Scan(&exists)
	r.fail(err)
	return exists
}

func scanAlias(row pgx.Row) (placementdecision.Alias, error) {
	var value placementdecision.Alias
	var archivedAt *time.Time
	err := row.Scan(&value.ID, &value.ProjectID, &value.PlacementID, &value.Key, &value.Status, &value.CreatedByActorID, &value.CreatedAt, &archivedAt)
	value.ArchivedAt = archivedAt
	return value, err
}
func (r reader) Aliases(placementID string) []placementdecision.Alias {
	return many(r, `SELECT id,project_id,placement_id,key,status,created_by_actor_id,created_at,archived_at FROM placement_aliases WHERE placement_id=$1 ORDER BY created_at`, scanAlias, placementID)
}
func (r reader) Usage(placementID string) placementdecision.Usage {
	var value placementdecision.Usage
	err := r.q.QueryRow(r.ctx, `SELECT (SELECT count(*) FROM placement_rule_sets WHERE placement_id=$1 AND status='active'),(SELECT count(*) FROM placement_aliases WHERE placement_id=$1 AND status='active'),(SELECT count(*) FROM placement_rule_version_rules rule JOIN placement_rule_set_versions version ON version.id=rule.rule_set_version_id WHERE version.placement_id=$1)`, placementID).Scan(&value.RuleSetCount, &value.AliasCount, &value.PublishedRuleCount)
	r.fail(err)
	return value
}

func scanOverride(row pgx.Row) (placementdecision.QAOverride, error) {
	var value placementdecision.QAOverride
	var outcomeBytes []byte
	var tokenDigest []byte
	var revokedAt *time.Time
	err := row.Scan(&value.ID, &value.ProjectID, &value.EnvironmentID, &value.PlacementID, &value.SafeLabel, &tokenDigest, &outcomeBytes, &value.Status, &value.CreatedByActorID, &value.CreatedAt, &value.ExpiresAt, &revokedAt)
	if err == nil {
		err = json.Unmarshal(outcomeBytes, &value.Outcome)
	}
	value.SelectorDigest = "sha256:" + fmt.Sprintf("%x", tokenDigest)
	value.RevokedAt = revokedAt
	return value, err
}
func (r reader) Overrides(environmentID, placementID string, now time.Time) []placementdecision.QAOverride {
	return many(r, `SELECT id,project_id,environment_id,placement_id,safe_label,token_digest,outcome,status,created_by_actor_id,created_at,expires_at,revoked_at FROM placement_qa_overrides WHERE environment_id=$1 AND placement_id=$2 AND status='active' AND expires_at>$3 ORDER BY expires_at`, scanOverride, environmentID, placementID, now)
}
func (r reader) OverrideScoped(id, projectID, environmentID, placementID string) (placementdecision.QAOverride, bool) {
	return one(r, `SELECT id,project_id,environment_id,placement_id,safe_label,token_digest,outcome,status,created_by_actor_id,created_at,expires_at,revoked_at FROM placement_qa_overrides WHERE id=$1 AND project_id=$2 AND environment_id=$3 AND placement_id=$4 AND status='active'`, scanOverride, id, projectID, environmentID, placementID)
}

type transaction struct {
	reader
	tx pgx.Tx
}

// marshalJSON encodes a value destined for a JSON column and routes a failure
// into the transaction's error rather than writing what a discarded error left
// behind.
//
// `_ = json.Marshal` wrote a nil slice into the column, which reads back as an
// absent structure: a rule with no condition tree, a published version with no
// validation record, a QA override with no outcome, an audit event with no
// metadata. Every one of those is evaluated later as if the author had authored
// nothing — the failure mode is a wrong decision, not a failed write. Setting
// t.err makes the enclosing transaction roll back, so the write either records
// what the caller meant or does not happen.
func (t *transaction) marshalJSON(value any) []byte {
	if t.err != nil {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.fail(err)
		return nil
	}
	return encoded
}

func (t *transaction) exec(query string, args ...any) {
	if t.err != nil {
		return
	}
	_, err := t.tx.Exec(t.ctx, query, args...)
	t.fail(err)
}
func (t *transaction) Lock(scope string) {
	t.exec(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, scope)
}
func (t *transaction) NextID(prefix string) string {
	if t.err != nil {
		return ""
	}
	var value int64
	err := t.tx.QueryRow(t.ctx, `INSERT INTO id_sequences(prefix,value) VALUES($1,1) ON CONFLICT(prefix) DO UPDATE SET value=id_sequences.value+1 RETURNING value`, prefix).Scan(&value)
	t.fail(err)
	return fmt.Sprintf("%s_%06d", prefix, value)
}
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func (t *transaction) SaveRuleSet(value placementdecision.RuleSet) {
	t.exec(`INSERT INTO placement_rule_sets(id,project_id,environment_id,placement_id,contract_version,status,current_draft_id,current_published_version_id,created_by_actor_id,created_at,updated_at,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_draft_id=excluded.current_draft_id,current_published_version_id=excluded.current_published_version_id,updated_at=excluded.updated_at,archived_at=excluded.archived_at`, value.ID, value.ProjectID, value.EnvironmentID, value.PlacementID, value.ContractVersion, value.Status, nullable(value.CurrentDraftID), nullable(value.CurrentPublishedVersionID), value.CreatedByActorID, value.CreatedAt, value.UpdatedAt, value.ArchivedAt)
}
func (t *transaction) SaveDraft(value placementdecision.Draft) {
	t.exec(`INSERT INTO placement_rule_set_drafts(id,rule_set_id,project_id,environment_id,status,current_revision,source_version_id,created_by_actor_id,updated_by_actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_revision=excluded.current_revision,updated_by_actor_id=excluded.updated_by_actor_id,updated_at=excluded.updated_at`, value.ID, value.RuleSetID, value.ProjectID, value.EnvironmentID, value.Status, value.CurrentRevision, nullable(value.SourceVersionID), value.CreatedByActorID, value.UpdatedByActorID, value.CreatedAt, value.UpdatedAt)
}
func (t *transaction) SaveDraftRevision(value placementdecision.DraftRevision) {
	validationBytes := t.marshalJSON(value.Validation)
	t.exec(`INSERT INTO placement_rule_set_draft_revisions(draft_id,rule_set_id,project_id,environment_id,revision,document,document_bytes,document_hash,validation,mutation_key_hash,request_hash,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, value.DraftID, value.RuleSetID, value.ProjectID, value.EnvironmentID, value.Revision, string(value.Document), []byte(value.Document), value.DocumentHash, string(validationBytes), value.MutationHash, value.RequestHash, value.ActorID, value.CreatedAt)
}
func (t *transaction) SaveVersion(value placementdecision.Version, rules []placementdecision.Rule) {
	validationBytes := t.marshalJSON(value.Validation)
	t.exec(`INSERT INTO placement_rule_set_versions(id,rule_set_id,project_id,environment_id,placement_id,version_number,source_draft_id,source_revision,contract_version,document,document_bytes,document_hash,validation,published_by_actor_id,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, value.ID, value.RuleSetID, value.ProjectID, value.EnvironmentID, value.PlacementID, value.VersionNumber, value.SourceDraftID, value.SourceRevision, value.ContractVersion, string(value.Document), []byte(value.Document), value.DocumentHash, string(validationBytes), value.PublishedByActorID, value.PublishedAt)
	for _, rule := range rules {
		condition := t.marshalJSON(rule.Condition)
		outcome := t.marshalJSON(rule.Outcome)
		var rollout any
		if rule.Rollout != nil {
			rollout = t.marshalJSON(rule.Rollout)
		}
		t.exec(`INSERT INTO placement_rule_version_rules(rule_set_version_id,project_id,environment_id,rule_id,priority,enabled,condition_tree,outcome,rollout) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, value.ID, value.ProjectID, value.EnvironmentID, rule.ID, rule.Priority, rule.Enabled, string(condition), string(outcome), rollout)
	}
}
func (t *transaction) SaveAttribute(value placementdecision.AttributeDefinition) {
	t.exec(`INSERT INTO placement_attribute_definitions(id,project_id,key,value_type,description,allowed_operators,sensitivity,status,revision,created_by_actor_id,updated_by_actor_id,created_at,updated_at,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET description=excluded.description,allowed_operators=excluded.allowed_operators,sensitivity=excluded.sensitivity,status=excluded.status,revision=excluded.revision,updated_by_actor_id=excluded.updated_by_actor_id,updated_at=excluded.updated_at,archived_at=excluded.archived_at`, value.ID, value.ProjectID, value.Key, value.ValueType, value.Description, value.AllowedOperators, value.Sensitivity, value.Status, value.Revision, value.CreatedByActorID, value.UpdatedByActorID, value.CreatedAt, value.UpdatedAt, value.ArchivedAt)
}
func (t *transaction) ArchiveAttribute(id, projectID, actorID string, at time.Time) bool {
	tag, err := t.tx.Exec(t.ctx, `UPDATE placement_attribute_definitions SET status='archived',archived_by_actor_id=$3,archived_at=$4,updated_by_actor_id=$3,updated_at=$4,revision=revision+1 WHERE id=$1 AND project_id=$2 AND status='active'`, id, projectID, actorID, at)
	t.fail(err)
	return err == nil && tag.RowsAffected() == 1
}
func (t *transaction) SaveAlias(value placementdecision.Alias) {
	t.exec(`INSERT INTO placement_aliases(id,project_id,placement_id,key,status,created_by_actor_id,created_at,archived_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, value.ID, value.ProjectID, value.PlacementID, value.Key, value.Status, value.CreatedByActorID, value.CreatedAt, value.ArchivedAt)
}
func (t *transaction) ArchiveRuleSet(id, actor string, at time.Time) bool {
	t.exec(`UPDATE placement_rule_set_drafts SET status='superseded',updated_by_actor_id=$2,updated_at=$3 WHERE rule_set_id=$1 AND status='active'`, id, actor, at)
	if t.err != nil {
		return false
	}
	tag, err := t.tx.Exec(t.ctx, `UPDATE placement_rule_sets SET status='archived',current_draft_id=NULL,archived_by_actor_id=$2,archived_at=$3,updated_at=$3 WHERE id=$1 AND status='active'`, id, actor, at)
	t.fail(err)
	return err == nil && tag.RowsAffected() == 1
}
func (t *transaction) ArchivePlacement(id, actor string, at time.Time) {
	t.exec(`UPDATE placements SET status='archived',archived_at=$2,updated_at=$2 WHERE id=$1 AND status='active'`, id, at)
}
func (t *transaction) SaveOverride(value placementdecision.QAOverride, selectorDigest, tokenDigest []byte) {
	outcome := t.marshalJSON(value.Outcome)
	t.exec(`INSERT INTO placement_qa_overrides(id,project_id,environment_id,placement_id,selector_digest,token_digest,safe_label,outcome,status,created_by_actor_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, value.ID, value.ProjectID, value.EnvironmentID, value.PlacementID, selectorDigest, tokenDigest, value.SafeLabel, outcome, value.Status, value.CreatedByActorID, value.CreatedAt, value.ExpiresAt)
}
func (t *transaction) RevokeOverride(id, projectID, environmentID, placementID, actor string, at time.Time) bool {
	tag, err := t.tx.Exec(t.ctx, `UPDATE placement_qa_overrides SET status='revoked',revoked_by_actor_id=$5,revoked_at=$6 WHERE id=$1 AND project_id=$2 AND environment_id=$3 AND placement_id=$4 AND status='active'`, id, projectID, environmentID, placementID, actor, at)
	t.fail(err)
	return err == nil && tag.RowsAffected() == 1
}
func (t *transaction) SaveAudit(value placementdecision.AuditEvent) {
	metadata := t.marshalJSON(value.Metadata)
	t.exec(`INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, value.ID, value.ActorID, value.OrganizationID, nullable(value.ProjectID), nullable(value.EnvironmentID), value.Action, value.ResourceType, value.ResourceID, metadata, value.CreatedAt)
}

func persistenceError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "23505" {
			return placementdecision.ErrConflict
		}
		if pgErr.Code == "55000" {
			return placementdecision.ErrConflict
		}
		if pgErr.Code == "23503" || pgErr.Code == "23514" {
			return placementdecision.ErrValidation
		}
	}
	return fmt.Errorf("persist placement decisions: %w", err)
}
