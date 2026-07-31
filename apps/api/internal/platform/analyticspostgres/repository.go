package analyticspostgres

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

type Repository struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func digest(value string) []byte { sum := sha256.Sum256([]byte(value)); return sum[:] }
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func nullableInt64(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}
func nextID(ctx context.Context, tx pgx.Tx, prefix string) (string, error) {
	var n int64
	err := tx.QueryRow(ctx, `INSERT INTO id_sequences(prefix,value) VALUES($1,1) ON CONFLICT(prefix) DO UPDATE SET value=id_sequences.value+1 RETURNING value`, prefix).Scan(&n)
	return fmt.Sprintf("%s_%06d", prefix, n), err
}

func (r *Repository) AuthenticateSDKKey(ctx context.Context, raw string) (analytics.Scope, error) {
	parts := strings.SplitN(strings.TrimSpace(raw), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return analytics.Scope{}, analytics.ErrUnauthenticated
	}
	var scope analytics.Scope
	var stored []byte
	var kind string
	var revoked *time.Time
	err := r.pool.QueryRow(ctx, `SELECT k.id,p.organization_id,e.project_id,e.id,e.mode,COALESCE(k.application_id,''),k.kind,k.secret_digest,k.revoked_at FROM api_keys k JOIN environments e ON e.id=k.environment_id JOIN projects p ON p.id=e.project_id WHERE k.prefix=$1`, parts[0]).Scan(&scope.APIKeyID, &scope.OrganizationID, &scope.ProjectID, &scope.EnvironmentID, &scope.EnvironmentMode, &scope.ApplicationID, &kind, &stored, &revoked)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (kind != "public_sdk" || revoked != nil || scope.ApplicationID == "" || subtle.ConstantTimeCompare(digest(raw), stored) != 1) {
		return analytics.Scope{}, analytics.ErrUnauthenticated
	}
	if err != nil {
		return analytics.Scope{}, fmt.Errorf("authenticate analytics SDK key: %w", err)
	}
	return scope, nil
}

func (r *Repository) Settings(ctx context.Context, projectID, environmentID string) (analytics.Settings, error) {
	var value analytics.Settings
	err := r.pool.QueryRow(ctx, `SELECT project_id,environment_id,collection_enabled,raw_retention_days,updated_at FROM analytics_environment_settings WHERE project_id=$1 AND environment_id=$2`, projectID, environmentID).Scan(&value.ProjectID, &value.EnvironmentID, &value.CollectionEnabled, &value.RawRetentionDays, &value.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return value, analytics.ErrNotFound
	}
	if err != nil {
		return value, fmt.Errorf("read analytics settings: %w", err)
	}
	return value, nil
}

func (r *Repository) SettingsForActor(ctx context.Context, actor analytics.Actor, projectID, environmentID string) (analytics.Settings, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, "owner", "admin", "member"); err != nil {
		return analytics.Settings{}, err
	}
	return r.Settings(ctx, projectID, environmentID)
}

func role(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, actorID, projectID string) (string, string, error) {
	var role, org string
	err := q.QueryRow(ctx, `SELECT m.role,p.organization_id FROM projects p JOIN organization_members m ON m.organization_id=p.organization_id WHERE p.id=$1 AND m.actor_id=$2`, projectID, actorID).Scan(&role, &org)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", analytics.ErrForbidden
	}
	return role, org, err
}
func requireRole(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, actor analytics.Actor, projectID string, allowed ...string) (string, error) {
	if actor.ID == "" {
		return "", analytics.ErrUnauthenticated
	}
	got, org, err := role(ctx, q, actor.ID, projectID)
	if err != nil {
		return "", err
	}
	for _, value := range allowed {
		if got == value {
			return org, nil
		}
	}
	return "", analytics.ErrForbidden
}

func (r *Repository) UpdateSettings(ctx context.Context, actor analytics.Actor, projectID, environmentID string, enabled bool, days int) (analytics.Settings, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Settings{}, err
	}
	defer tx.Rollback(ctx)
	org, err := requireRole(ctx, tx, actor, projectID, "owner", "admin")
	if err != nil {
		return analytics.Settings{}, err
	}
	var value analytics.Settings
	now := time.Now().UTC()
	err = tx.QueryRow(ctx, `UPDATE analytics_environment_settings SET collection_enabled=$3,raw_retention_days=$4,updated_by_actor_id=$5,updated_at=$6 WHERE project_id=$1 AND environment_id=$2 RETURNING project_id,environment_id,collection_enabled,raw_retention_days,updated_at`, projectID, environmentID, enabled, days, actor.ID, now).Scan(&value.ProjectID, &value.EnvironmentID, &value.CollectionEnabled, &value.RawRetentionDays, &value.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return value, analytics.ErrNotFound
	}
	if err != nil {
		return value, err
	}
	auditID, err := nextID(ctx, tx, "privacy_audit")
	if err != nil {
		return value, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_privacy_audit_events(id,organization_id,project_id,environment_id,actor_id,action,metadata,created_at,expires_at) VALUES($1,$2,$3,$4,$5,'analytics.settings_changed',jsonb_build_object('collectionEnabled',$6::boolean,'rawRetentionDays',$7::integer),$8,$9)`, auditID, org, projectID, environmentID, actor.ID, enabled, days, now, now.Add(analytics.AuditRetention))
	if err != nil {
		return value, err
	}
	if err = tx.Commit(ctx); err != nil {
		return value, err
	}
	return value, nil
}

func attributionExists(ctx context.Context, tx pgx.Tx, scope analytics.Scope, event analytics.Event) bool {
	checks := []struct{ value, query string }{
		{event.Attribution.ConfigurationReleaseID, `SELECT 1 FROM configuration_releases WHERE id=$1 AND environment_id=$2`},
		{event.Attribution.PlacementID, `SELECT 1 FROM placements WHERE id=$1 AND project_id=$2`},
		{event.Attribution.PlacementRuleSetID, `SELECT 1 FROM placement_rule_sets WHERE id=$1 AND project_id=$2 AND environment_id=$3`},
		{event.Attribution.PaywallID, `SELECT 1 FROM paywalls WHERE id=$1 AND project_id=$2`},
		{event.Attribution.PaywallVersionID, `SELECT 1 FROM paywall_versions WHERE id=$1 AND project_id=$2`},
		{event.Attribution.ProductID, `SELECT 1 FROM products WHERE id=$1 AND project_id=$2`},
		{event.Attribution.PlanID, `SELECT 1 FROM plans WHERE id=$1 AND project_id=$2`},
		{event.Attribution.ProviderMappingID, `SELECT 1 FROM provider_product_mappings WHERE id=$1 AND project_id=$2`},
	}
	if event.Attribution.PlacementRuleSetVersion > 0 {
		var one int
		if err := tx.QueryRow(ctx, `SELECT 1 FROM placement_rule_set_versions WHERE rule_set_id=$1 AND version_number=$2 AND project_id=$3 AND environment_id=$4`, event.Attribution.PlacementRuleSetID, event.Attribution.PlacementRuleSetVersion, scope.ProjectID, scope.EnvironmentID).Scan(&one); err != nil {
			return false
		}
	}
	for _, check := range checks {
		if check.value == "" {
			continue
		}
		args := []any{check.value, scope.ProjectID}
		if strings.Contains(check.query, "environment_id=$3") {
			args = append(args, scope.EnvironmentID)
		}
		if check.query == checks[0].query {
			args = []any{check.value, scope.EnvironmentID}
		}
		var one int
		if err := tx.QueryRow(ctx, check.query, args...).Scan(&one); err != nil {
			return false
		}
	}
	return true
}

func (r *Repository) Ingest(ctx context.Context, scope analytics.Scope, batchID string, candidates []analytics.Candidate, now time.Time) (map[string]analytics.EventResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	results := make(map[string]analytics.EventResult, len(candidates))
	internalBatchID, err := nextID(ctx, tx, "analytics_batch")
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_ingestion_batches(id,project_id,environment_id,api_key_id,client_batch_id,event_count,received_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(environment_id,client_batch_id) DO NOTHING`, internalBatchID, scope.ProjectID, scope.EnvironmentID, scope.APIKeyID, batchID, len(candidates), now)
	if err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, `SELECT id FROM analytics_ingestion_batches WHERE environment_id=$1 AND client_batch_id=$2`, scope.EnvironmentID, batchID).Scan(&internalBatchID)
	if err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		e := candidate.Event
		var platform string
		err = tx.QueryRow(ctx, `SELECT platform FROM applications WHERE id=$1 AND project_id=$2`, scope.ApplicationID, scope.ProjectID).Scan(&platform)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && platform != e.Context.Platform {
			results[e.EventID] = analytics.EventResult{EventID: e.EventID, Status: "permanently_rejected", Code: "attribution_scope_mismatch"}
			continue
		}
		if err != nil {
			return nil, err
		}
		if !attributionExists(ctx, tx, scope, e) {
			results[e.EventID] = analytics.EventResult{EventID: e.EventID, Status: "permanently_rejected", Code: "attribution_not_found"}
			continue
		}
		installationID, installationSubject, generation, err := upsertInstallation(ctx, tx, scope.ProjectID, scope.ApplicationID, e.Identity.InstallationID, e.Identity.Generation, now)
		if err != nil {
			return nil, err
		}
		userID, userSubject := "", ""
		if e.Identity.ApplicationUserID != "" {
			userID, userSubject, err = upsertUser(ctx, tx, scope.ProjectID, e.Identity.ApplicationUserID, now)
			if err != nil {
				return nil, err
			}
		}
		if e.Identity.Generation >= generation {
			if err = transitionAlias(ctx, tx, scope.ProjectID, installationID, userID, e.Identity.Generation, candidate.OccurredAt, now); err != nil {
				return nil, err
			}
			_, err = tx.Exec(ctx, `UPDATE analytics_installations SET last_identity_generation=$2 WHERE id=$1 AND last_identity_generation<=$2`, installationID, e.Identity.Generation)
			if err != nil {
				return nil, err
			}
		}
		subjectID := installationSubject
		if userSubject != "" {
			subjectID = userSubject
		}
		sessionID, err := upsertSession(ctx, tx, scope, e, installationID, userID, candidate, now)
		if err != nil {
			if errors.Is(err, analytics.ErrConflict) {
				results[e.EventID] = analytics.EventResult{EventID: e.EventID, Status: "permanently_rejected", Code: "event_schema_invalid"}
				continue
			}
			return nil, err
		}
		command, err := tx.Exec(ctx, `INSERT INTO analytics_events(event_id,project_id,environment_id,application_id,ingestion_batch_id,api_key_id,event_schema_version,event_name,authority,occurred_at,queued_at,sent_at,received_at,expires_at,installation_id,application_user_id,subject_id,session_id,identity_generation,platform,sdk_version,operating_system_version,application_version,locale,configuration_release_id,placement_id,placement_rule_set_id,placement_rule_set_version,winning_rule_id,paywall_id,paywall_version_id,product_id,plan_id,provider,provider_mapping_id,placement_request_id,paywall_presentation_id,product_load_attempt_id,purchase_attempt_id,restore_attempt_id,provider_operation_id,provider_update_id,payload,canonical_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'client_observed',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43) ON CONFLICT(environment_id,event_id) DO NOTHING`, e.EventID, scope.ProjectID, scope.EnvironmentID, scope.ApplicationID, internalBatchID, scope.APIKeyID, e.EventSchemaVersion, e.EventName, candidate.OccurredAt, candidate.QueuedAt, candidate.SentAt, now, candidate.ExpiresAt, installationID, nullable(userID), subjectID, sessionID, e.Identity.Generation, e.Context.Platform, e.Context.SDKVersion, nullable(e.Context.OperatingSystemVersion), nullable(e.Context.ApplicationVersion), nullable(e.Context.Locale), nullable(e.Attribution.ConfigurationReleaseID), nullable(e.Attribution.PlacementID), nullable(e.Attribution.PlacementRuleSetID), nullableInt64(e.Attribution.PlacementRuleSetVersion), nullable(e.Attribution.WinningRuleID), nullable(e.Attribution.PaywallID), nullable(e.Attribution.PaywallVersionID), nullable(e.Attribution.ProductID), nullable(e.Attribution.PlanID), nullable(e.Attribution.Provider), nullable(e.Attribution.ProviderMappingID), nullable(e.Correlation.PlacementRequestID), nullable(e.Correlation.PaywallPresentationID), nullable(e.Correlation.ProductLoadAttemptID), nullable(e.Correlation.PurchaseAttemptID), nullable(e.Correlation.RestoreAttemptID), nullable(e.Correlation.ProviderOperationID), nullable(e.Correlation.ProviderUpdateID), e.Payload, candidate.Digest[:])
		if err != nil {
			return nil, err
		}
		if command.RowsAffected() == 0 {
			var existing []byte
			err = tx.QueryRow(ctx, `SELECT canonical_digest FROM analytics_events WHERE environment_id=$1 AND event_id=$2`, scope.EnvironmentID, e.EventID).Scan(&existing)
			if err != nil {
				return nil, err
			}
			if subtle.ConstantTimeCompare(existing, candidate.Digest[:]) == 1 {
				results[e.EventID] = analytics.EventResult{EventID: e.EventID, Status: "duplicate"}
			} else {
				results[e.EventID] = analytics.EventResult{EventID: e.EventID, Status: "permanently_rejected", Code: "event_id_conflict"}
			}
			continue
		}
		bucket := candidate.OccurredAt.UTC().Truncate(24 * time.Hour)
		reason := "ingestion"
		if bucket.Before(now.UTC().Truncate(24 * time.Hour)) {
			reason = "late_event"
		}
		if err = enqueueBucket(ctx, tx, scope, bucket, reason, now); err != nil {
			return nil, err
		}
		if affectsPriorCorrelationBucket(e.EventName) {
			if err = enqueueBucket(ctx, tx, scope, bucket.Add(-24*time.Hour), "late_event", now); err != nil {
				return nil, err
			}
		}
		results[e.EventID] = analytics.EventResult{EventID: e.EventID, Status: "accepted"}
	}
	_, err = tx.Exec(ctx, `UPDATE api_keys SET last_used_at=$2 WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < $2::timestamptz - interval '15 minutes')`, scope.APIKeyID, now)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return results, nil
}

func affectsPriorCorrelationBucket(eventName string) bool {
	switch eventName {
	case "product_selected", "purchase_started", "purchase_completed_client", "purchase_completed_provider", "purchase_pending", "purchase_deferred", "purchase_cancelled", "purchase_failed":
		return true
	default:
		return false
	}
}

func enqueueBucket(ctx context.Context, tx pgx.Tx, scope analytics.Scope, bucket time.Time, reason string, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO analytics_dirty_buckets(environment_id,project_id,bucket_date,reason,marked_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(environment_id,bucket_date) DO UPDATE SET reason=CASE WHEN excluded.reason IN('privacy_deletion','retention') THEN excluded.reason ELSE analytics_dirty_buckets.reason END,marked_at=excluded.marked_at`, scope.EnvironmentID, scope.ProjectID, bucket, reason, now)
	if err != nil {
		return err
	}
	jobID, err := nextID(ctx, tx, "analytics_aggregate")
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_aggregation_jobs(id,project_id,environment_id,bucket_date,status,available_at,created_at,updated_at) VALUES($1,$2,$3,$4,'queued',$5,$5,$5) ON CONFLICT(environment_id,bucket_date) DO UPDATE SET status=CASE WHEN analytics_aggregation_jobs.status='leased' THEN 'leased' ELSE 'queued' END,available_at=excluded.available_at,updated_at=excluded.updated_at`, jobID, scope.ProjectID, scope.EnvironmentID, bucket, now)
	return err
}

func upsertInstallation(ctx context.Context, tx pgx.Tx, projectID, applicationID, external string, generation int64, now time.Time) (string, string, int64, error) {
	var id, subject string
	var existingGeneration int64
	err := tx.QueryRow(ctx, `SELECT id,subject_id,last_identity_generation FROM analytics_installations WHERE project_id=$1 AND application_id=$2 AND external_id=$3 FOR UPDATE`, projectID, applicationID, external).Scan(&id, &subject, &existingGeneration)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE analytics_installations SET last_seen_at=GREATEST(last_seen_at,$2) WHERE id=$1`, id, now)
		return id, subject, existingGeneration, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", 0, err
	}
	subject, err = nextID(ctx, tx, "analytics_subject")
	if err != nil {
		return "", "", 0, err
	}
	id, err = nextID(ctx, tx, "analytics_installation")
	if err != nil {
		return "", "", 0, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO analytics_subjects(id,project_id,kind,created_at) VALUES($1,$2,'installation',$3)`, subject, projectID, now); err != nil {
		return "", "", 0, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_installations(id,subject_id,project_id,application_id,external_id,first_seen_at,last_seen_at,last_identity_generation) VALUES($1,$2,$3,$4,$5,$6,$6,$7)`, id, subject, projectID, applicationID, external, now, generation)
	return id, subject, generation, err
}
func upsertUser(ctx context.Context, tx pgx.Tx, projectID, external string, now time.Time) (string, string, error) {
	var id, subject string
	err := tx.QueryRow(ctx, `SELECT id,subject_id FROM analytics_application_users WHERE project_id=$1 AND external_id=$2 FOR UPDATE`, projectID, external).Scan(&id, &subject)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE analytics_application_users SET last_seen_at=GREATEST(last_seen_at,$2) WHERE id=$1`, id, now)
		return id, subject, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", err
	}
	subject, err = nextID(ctx, tx, "analytics_subject")
	if err != nil {
		return "", "", err
	}
	id, err = nextID(ctx, tx, "analytics_user")
	if err != nil {
		return "", "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO analytics_subjects(id,project_id,kind,created_at) VALUES($1,$2,'application_user',$3)`, subject, projectID, now); err != nil {
		return "", "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_application_users(id,subject_id,project_id,external_id,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$5)`, id, subject, projectID, external, now)
	return id, subject, err
}
func transitionAlias(ctx context.Context, tx pgx.Tx, projectID, installationID, userID string, generation int64, effective, now time.Time) error {
	var activeID, activeUser string
	err := tx.QueryRow(ctx, `SELECT id,application_user_id FROM analytics_identity_aliases WHERE installation_id=$1 AND ended_at IS NULL FOR UPDATE`, installationID).Scan(&activeID, &activeUser)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && activeUser == userID {
		return nil
	}
	if activeID != "" {
		_, err = tx.Exec(ctx, `UPDATE analytics_identity_aliases SET ended_at=GREATEST(effective_at,$2) WHERE id=$1`, activeID, effective)
		if err != nil {
			return err
		}
	}
	if userID == "" {
		return nil
	}
	id, err := nextID(ctx, tx, "analytics_alias")
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_identity_aliases(id,project_id,installation_id,application_user_id,identity_generation,effective_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, projectID, installationID, userID, generation, effective, now)
	return err
}
func upsertSession(ctx context.Context, tx pgx.Tx, scope analytics.Scope, e analytics.Event, installationID, userID string, c analytics.Candidate, now time.Time) (string, error) {
	var id, existingInstall string
	var existingUser *string
	var generation int64
	err := tx.QueryRow(ctx, `SELECT id,installation_id,application_user_id,identity_generation FROM analytics_sessions WHERE environment_id=$1 AND client_session_id=$2 FOR UPDATE`, scope.EnvironmentID, e.SessionID).Scan(&id, &existingInstall, &existingUser, &generation)
	if err == nil {
		currentUser := ""
		if existingUser != nil {
			currentUser = *existingUser
		}
		if existingInstall != installationID || currentUser != userID || generation != e.Identity.Generation {
			return "", analytics.ErrConflict
		}
		_, err = tx.Exec(ctx, `UPDATE analytics_sessions SET last_occurred_at=GREATEST(last_occurred_at,$2),last_received_at=$3 WHERE id=$1`, id, c.OccurredAt, now)
		return id, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	id, err = nextID(ctx, tx, "analytics_session")
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_sessions(id,project_id,environment_id,application_id,client_session_id,installation_id,application_user_id,identity_generation,started_at,last_occurred_at,last_received_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10)`, id, scope.ProjectID, scope.EnvironmentID, scope.ApplicationID, e.SessionID, installationID, nullable(userID), e.Identity.Generation, c.OccurredAt, now)
	return id, err
}
