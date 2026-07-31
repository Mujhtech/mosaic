package analyticspostgres

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
)

func (r *Repository) LeaseAggregation(ctx context.Context, worker string, now, expires time.Time) (analytics.Job, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Job{}, false, err
	}
	defer tx.Rollback(ctx)
	var job analytics.Job
	err = tx.QueryRow(ctx, `SELECT id,project_id,environment_id,bucket_date FROM analytics_aggregation_jobs WHERE (status='queued' OR status='leased' AND lease_expires_at<=$1) AND available_at<=$1 AND attempt_count<max_attempts ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &job.BucketDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return job, false, nil
	}
	if err != nil {
		return job, false, err
	}
	_, err = tx.Exec(ctx, `UPDATE analytics_aggregation_jobs SET status='leased',attempt_count=attempt_count+1,lease_owner=$2,lease_expires_at=$3,updated_at=$4 WHERE id=$1`, job.ID, worker, expires, now)
	if err != nil {
		return job, false, err
	}
	job.Kind, job.Status = "aggregate", "leased"
	return job, true, tx.Commit(ctx)
}

func (r *Repository) RunAggregation(ctx context.Context, job analytics.Job, now time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var lease time.Time
	if err = tx.QueryRow(ctx, `SELECT lease_expires_at FROM analytics_aggregation_jobs WHERE id=$1 AND status='leased' FOR UPDATE`, job.ID).Scan(&lease); err != nil {
		return err
	}
	if !lease.After(now) {
		return analytics.ErrConflict
	}
	start, end := job.BucketDate.UTC(), job.BucketDate.UTC().Add(24*time.Hour)
	if _, err = tx.Exec(ctx, `DELETE FROM analytics_daily_event_counts WHERE environment_id=$1 AND bucket_date=$2`, job.EnvironmentID, start); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_daily_event_counts(project_id,environment_id,bucket_date,event_name,authority,platform,locale,application_version,placement_id,paywall_version_id,product_id,provider,event_count,latest_received_at) SELECT project_id,environment_id,$2::date,event_name,authority,platform,COALESCE(locale,''),COALESCE(application_version,''),placement_id,paywall_version_id,product_id,provider,COUNT(*),MAX(received_at) FROM analytics_events WHERE environment_id=$1 AND occurred_at>=$2 AND occurred_at<$3 GROUP BY project_id,environment_id,event_name,authority,platform,locale,application_version,placement_id,paywall_version_id,product_id,provider`, job.EnvironmentID, start, end)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM analytics_daily_funnel_counts WHERE environment_id=$1 AND bucket_date=$2`, job.EnvironmentID, start); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `WITH source AS (SELECT * FROM analytics_events WHERE environment_id=$1 AND occurred_at>=$2 AND occurred_at<$3), window_source AS (SELECT * FROM analytics_events WHERE environment_id=$1 AND occurred_at>=$2 AND occurred_at<$3::timestamptz+interval '24 hours'), metrics(metric_id,numerator,denominator,authority) AS (
		SELECT 'placement_requests',COUNT(*) FILTER(WHERE event_name='placement_requested'),NULL::bigint,'client_observed' FROM source UNION ALL
		SELECT 'placement_paywall_selected',COUNT(*) FILTER(WHERE event_name='placement_paywall_selected'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'placement_no_paywall',COUNT(*) FILTER(WHERE event_name='placement_no_paywall'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'placement_fallback_used',COUNT(*) FILTER(WHERE event_name='placement_fallback_used'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'placement_unavailable',COUNT(*) FILTER(WHERE event_name='placement_unavailable'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'paywall_presentations',COUNT(*) FILTER(WHERE event_name='paywall_presented'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'product_selections',COUNT(*) FILTER(WHERE event_name='product_selected'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'purchase_starts',COUNT(*) FILTER(WHERE event_name='purchase_started'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'client_completed_purchases',COUNT(*) FILTER(WHERE event_name='purchase_completed_client' AND payload->>'outcome'='purchased'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'provider_confirmed_purchases',COUNT(*) FILTER(WHERE event_name='purchase_completed_provider' AND authority='provider_confirmed'),NULL,'provider_confirmed' FROM source UNION ALL
		SELECT 'purchase_cancelled',COUNT(*) FILTER(WHERE event_name='purchase_cancelled'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'purchase_failed',COUNT(*) FILTER(WHERE event_name='purchase_failed'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'presentation_to_product_selection_rate',COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='product_selected' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented'),'client_observed' FROM source s UNION ALL
		SELECT 'product_selection_to_purchase_start_rate',COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='product_selected' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_started' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='product_selected'),'client_observed' FROM source s UNION ALL
		SELECT 'presentation_to_purchase_start_rate',COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_started' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented'),'client_observed' FROM source s UNION ALL
		SELECT 'presentation_to_client_completed_purchase_rate',COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_completed_client' AND d.payload->>'outcome'='purchased' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented'),'client_observed' FROM source s UNION ALL
		SELECT 'presentation_to_provider_confirmed_purchase_rate',COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_completed_provider' AND d.authority='provider_confirmed' AND d.paywall_presentation_id=s.paywall_presentation_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.paywall_presentation_id) FILTER(WHERE s.event_name='paywall_presented'),'provider_confirmed' FROM source s UNION ALL
		SELECT 'purchase_cancellation_rate',COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_cancelled' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started'),'client_observed' FROM source s UNION ALL
		SELECT 'purchase_pending_rate',COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_pending' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started'),'client_observed' FROM source s UNION ALL
		SELECT 'purchase_deferred_rate',COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_deferred' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started'),'client_observed' FROM source s UNION ALL
		SELECT 'purchase_failure_rate',COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started' AND EXISTS(SELECT 1 FROM window_source d WHERE d.event_name='purchase_failed' AND d.purchase_attempt_id=s.purchase_attempt_id AND d.occurred_at>=s.occurred_at AND d.occurred_at<=s.occurred_at+interval '24 hours')),COUNT(DISTINCT s.purchase_attempt_id) FILTER(WHERE s.event_name='purchase_started'),'client_observed' FROM source s UNION ALL
		SELECT 'product_unavailable_rate',COUNT(*) FILTER(WHERE event_name='product_unavailable'),COUNT(*) FILTER(WHERE event_name IN('product_load_completed','product_load_failed')),'client_observed' FROM source UNION ALL
		SELECT 'restore_completed',COUNT(*) FILTER(WHERE event_name='restore_completed'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'restore_nothing_found',COUNT(*) FILTER(WHERE event_name='restore_nothing_found'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'restore_cancelled',COUNT(*) FILTER(WHERE event_name='restore_cancelled'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'restore_failed',COUNT(*) FILTER(WHERE event_name='restore_failed'),NULL,'client_observed' FROM source UNION ALL
		SELECT 'provider_errors',COUNT(*) FILTER(WHERE event_name IN('product_load_failed','purchase_failed','restore_failed') AND provider IS NOT NULL),NULL,'client_observed' FROM source)
		INSERT INTO analytics_daily_funnel_counts(project_id,environment_id,bucket_date,metric_id,authority,numerator,denominator,latest_received_at) SELECT $4,$1,$2::date,metric_id,authority,numerator,denominator,COALESCE((SELECT MAX(received_at) FROM source),$5) FROM metrics`, job.EnvironmentID, start, end, job.ProjectID, now)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO analytics_aggregate_watermarks(environment_id,project_id,latest_received_at,latest_aggregated_at,latest_bucket_date,updated_at) VALUES($1,$2,(SELECT MAX(received_at) FROM analytics_events WHERE environment_id=$1),$3,$4,$3) ON CONFLICT(environment_id) DO UPDATE SET latest_received_at=excluded.latest_received_at,latest_aggregated_at=excluded.latest_aggregated_at,latest_bucket_date=GREATEST(analytics_aggregate_watermarks.latest_bucket_date,excluded.latest_bucket_date),updated_at=excluded.updated_at`, job.EnvironmentID, job.ProjectID, now, start)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM analytics_dirty_buckets WHERE environment_id=$1 AND bucket_date=$2`, job.EnvironmentID, start); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE analytics_aggregation_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$2 WHERE id=$1`, job.ID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) LeaseExport(ctx context.Context, worker string, now, expires time.Time) (analytics.Job, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Job{}, false, err
	}
	defer tx.Rollback(ctx)
	var job analytics.Job
	var identity []byte
	err = tx.QueryRow(ctx, `SELECT id,project_id,COALESCE(environment_id,''),kind,format,COALESCE(identity_reference_id,''),COALESCE(identity_digest,'\\x'::bytea),requested_by_actor_id,created_at,updated_at FROM analytics_export_jobs WHERE (status='queued' OR status='leased' AND lease_expires_at<=$1) AND available_at<=$1 AND attempt_count<max_attempts ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &job.Kind, &job.Format, &job.IdentityReferenceID, &identity, &job.RequestedByActorID, &job.CreatedAt, &job.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return job, false, nil
	}
	if err != nil {
		return job, false, err
	}
	copy(job.IdentityDigest[:], identity)
	_, err = tx.Exec(ctx, `UPDATE analytics_export_jobs SET status='leased',attempt_count=attempt_count+1,lease_owner=$2,lease_expires_at=$3,updated_at=$4 WHERE id=$1`, job.ID, worker, expires, now)
	if err != nil {
		return job, false, err
	}
	job.Status = "leased"
	return job, true, tx.Commit(ctx)
}

func (r *Repository) ExportRows(ctx context.Context, job analytics.Job, writer io.Writer) (int64, error) {
	query := `SELECT jsonb_build_object('eventId',event_id,'eventSchemaVersion',event_schema_version,'eventName',event_name,'occurredAt',occurred_at,'receivedAt',received_at,'environmentId',environment_id,'applicationId',application_id,'identity',jsonb_build_object('installationReferenceId',installation_id,'applicationUserReferenceId',application_user_id),'sessionReferenceId',session_id,'platform',platform,'sdkVersion',sdk_version,'applicationVersion',application_version,'locale',locale,'correlation',jsonb_build_object('placementRequestId',placement_request_id,'paywallPresentationId',paywall_presentation_id,'productLoadAttemptId',product_load_attempt_id,'purchaseAttemptId',purchase_attempt_id,'restoreAttemptId',restore_attempt_id),'attribution',jsonb_build_object('configurationReleaseId',configuration_release_id,'placementId',placement_id,'paywallId',paywall_id,'paywallVersionId',paywall_version_id,'mosaicProductId',product_id,'providerId',provider),'payload',payload)::text FROM analytics_events WHERE project_id=$1`
	args := []any{job.ProjectID}
	if job.Kind == "events" {
		parts := strings.SplitN(job.IdentityReferenceID, "/", 2)
		if len(parts) != 2 {
			return 0, analytics.ErrInvalidBatch
		}
		from, e1 := time.Parse(time.RFC3339Nano, parts[0])
		to, e2 := time.Parse(time.RFC3339Nano, parts[1])
		if e1 != nil || e2 != nil {
			return 0, analytics.ErrInvalidBatch
		}
		query += ` AND environment_id=$2 AND occurred_at>=$3 AND occurred_at<$4`
		args = append(args, job.EnvironmentID, from, to)
	} else if job.Kind == "application_user" {
		query += ` AND application_user_id=$2`
		args = append(args, job.IdentityReferenceID)
	} else {
		query += ` AND installation_id=$2`
		args = append(args, job.IdentityReferenceID)
	}
	query += ` ORDER BY occurred_at,event_id`
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	count := int64(0)
	if job.Format == "csv" {
		out := csv.NewWriter(writer)
		if err = out.Write([]string{"event"}); err != nil {
			return 0, err
		}
		for rows.Next() {
			var value string
			if err = rows.Scan(&value); err != nil {
				return 0, err
			}
			if err = out.Write([]string{value}); err != nil {
				return 0, err
			}
			count++
		}
		out.Flush()
		if err = out.Error(); err != nil {
			return 0, err
		}
	} else {
		for rows.Next() {
			var value string
			if err = rows.Scan(&value); err != nil {
				return 0, err
			}
			var document any
			if err = json.Unmarshal([]byte(value), &document); err != nil {
				return 0, err
			}
			encoded, err := json.Marshal(document)
			if err != nil {
				return 0, err
			}
			if _, err = fmt.Fprintf(writer, "%s\n", encoded); err != nil {
				return 0, err
			}
			count++
		}
	}
	return count, rows.Err()
}

func (r *Repository) CompleteExport(ctx context.Context, job analytics.Job, key, media string, size, rows int64, now, expires time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE analytics_export_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,object_key=$2,media_type=$3,byte_length=$4,row_count=$5,expires_at=$6,updated_at=$7 WHERE id=$1 AND status='leased'`, job.ID, key, media, size, rows, expires, now)
	if err != nil || tag.RowsAffected() != 1 {
		return analytics.ErrConflict
	}
	var org string
	if err = tx.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, job.ProjectID).Scan(&org); err != nil {
		return err
	}
	if err = audit(ctx, tx, org, job.ProjectID, job.EnvironmentID, "system:analytics-worker", "analytics.export_completed", job.ID, nil, &rows, nil, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) LeaseDeletion(ctx context.Context, worker string, now, expires time.Time) (analytics.Job, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Job{}, false, err
	}
	defer tx.Rollback(ctx)
	var job analytics.Job
	var identity []byte
	err = tx.QueryRow(ctx, `SELECT id,project_id,kind,identity_reference_id,identity_digest,requested_by_actor_id,confirmed_by_actor_id,created_at,updated_at FROM analytics_deletion_jobs WHERE (status IN('queued','recomputing') OR status='leased' AND lease_expires_at<=$1) AND available_at<=$1 AND attempt_count<max_attempts ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&job.ID, &job.ProjectID, &job.IdentityKind, &job.IdentityReferenceID, &identity, &job.RequestedByActorID, &job.ConfirmedByActorID, &job.CreatedAt, &job.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return job, false, nil
	}
	if err != nil {
		return job, false, err
	}
	copy(job.IdentityDigest[:], identity)
	_, err = tx.Exec(ctx, `UPDATE analytics_deletion_jobs SET status='leased',attempt_count=attempt_count+1,lease_owner=$2,lease_expires_at=$3,updated_at=$4 WHERE id=$1`, job.ID, worker, expires, now)
	if err != nil {
		return job, false, err
	}
	job.Kind, job.Status = "deletion", "leased"
	return job, true, tx.Commit(ctx)
}

func (r *Repository) RunDeletion(ctx context.Context, job analytics.Job, now time.Time) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var deletionAppliedAt *time.Time
	if err = tx.QueryRow(ctx, `SELECT deletion_applied_at FROM analytics_deletion_jobs WHERE id=$1 FOR UPDATE`, job.ID).Scan(&deletionAppliedAt); err != nil {
		return false, err
	}
	if deletionAppliedAt == nil {
		dateEnvironments := map[string]time.Time{}
		query := `SELECT DISTINCT environment_id,date_trunc('day',occurred_at) FROM analytics_events WHERE project_id=$1 AND `
		if job.IdentityKind == "application_user" {
			query += `application_user_id=$2`
		} else {
			query += `installation_id=$2`
		}
		rows, e := tx.Query(ctx, query, job.ProjectID, job.IdentityReferenceID)
		if e != nil {
			return false, e
		}
		for rows.Next() {
			var env string
			var date time.Time
			if e = rows.Scan(&env, &date); e != nil {
				return false, e
			}
			dateEnvironments[env+"\x00"+date.Format("2006-01-02")] = date
		}
		rows.Close()
		var subject string
		if job.IdentityKind == "application_user" {
			_ = tx.QueryRow(ctx, `SELECT subject_id FROM analytics_application_users WHERE id=$1 AND project_id=$2`, job.IdentityReferenceID, job.ProjectID).Scan(&subject)
			tag, e := tx.Exec(ctx, `DELETE FROM analytics_events WHERE project_id=$1 AND application_user_id=$2`, job.ProjectID, job.IdentityReferenceID)
			if e != nil {
				return false, e
			}
			job.AffectedEventCount = tag.RowsAffected()
			tag, e = tx.Exec(ctx, `DELETE FROM analytics_sessions WHERE project_id=$1 AND application_user_id=$2`, job.ProjectID, job.IdentityReferenceID)
			if e != nil {
				return false, e
			}
			job.AffectedSessionCount = tag.RowsAffected()
			_, e = tx.Exec(ctx, `DELETE FROM analytics_identity_aliases WHERE project_id=$1 AND application_user_id=$2`, job.ProjectID, job.IdentityReferenceID)
			if e == nil {
				_, e = tx.Exec(ctx, `DELETE FROM analytics_application_users WHERE id=$1 AND project_id=$2`, job.IdentityReferenceID, job.ProjectID)
			}
			if e == nil && subject != "" {
				_, e = tx.Exec(ctx, `DELETE FROM analytics_subjects WHERE id=$1 AND project_id=$2`, subject, job.ProjectID)
			}
			if e != nil {
				return false, e
			}
		} else {
			_ = tx.QueryRow(ctx, `SELECT subject_id FROM analytics_installations WHERE id=$1 AND project_id=$2`, job.IdentityReferenceID, job.ProjectID).Scan(&subject)
			tag, e := tx.Exec(ctx, `DELETE FROM analytics_events WHERE project_id=$1 AND installation_id=$2`, job.ProjectID, job.IdentityReferenceID)
			if e != nil {
				return false, e
			}
			job.AffectedEventCount = tag.RowsAffected()
			tag, e = tx.Exec(ctx, `DELETE FROM analytics_sessions WHERE project_id=$1 AND installation_id=$2`, job.ProjectID, job.IdentityReferenceID)
			if e != nil {
				return false, e
			}
			job.AffectedSessionCount = tag.RowsAffected()
			_, e = tx.Exec(ctx, `DELETE FROM analytics_identity_aliases WHERE project_id=$1 AND installation_id=$2`, job.ProjectID, job.IdentityReferenceID)
			if e == nil {
				_, e = tx.Exec(ctx, `DELETE FROM analytics_installations WHERE id=$1 AND project_id=$2`, job.IdentityReferenceID, job.ProjectID)
			}
			if e == nil && subject != "" {
				_, e = tx.Exec(ctx, `DELETE FROM analytics_subjects WHERE id=$1 AND project_id=$2`, subject, job.ProjectID)
			}
			if e != nil {
				return false, e
			}
		}
		for key, date := range dateEnvironments {
			env := strings.SplitN(key, "\x00", 2)[0]
			_, _ = tx.Exec(ctx, `INSERT INTO analytics_deletion_job_buckets(job_id,project_id,environment_id,bucket_date) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, job.ID, job.ProjectID, env, date)
			_, _ = tx.Exec(ctx, `INSERT INTO analytics_dirty_buckets(environment_id,project_id,bucket_date,reason,marked_at) VALUES($1,$2,$3,'privacy_deletion',$4) ON CONFLICT(environment_id,bucket_date) DO UPDATE SET reason='privacy_deletion',marked_at=excluded.marked_at`, env, job.ProjectID, date, now)
			id, _ := nextID(ctx, tx, "analytics_aggregate")
			_, _ = tx.Exec(ctx, `INSERT INTO analytics_aggregation_jobs(id,project_id,environment_id,bucket_date,status,available_at,created_at,updated_at) VALUES($1,$2,$3,$4,'queued',$5,$5,$5) ON CONFLICT(environment_id,bucket_date) DO UPDATE SET status='queued',available_at=excluded.available_at,updated_at=excluded.updated_at`, id, job.ProjectID, env, date, now)
		}
		_, err = tx.Exec(ctx, `UPDATE analytics_deletion_jobs SET status='recomputing',affected_event_count=$2,affected_session_count=$3,deletion_applied_at=$4,lease_owner=NULL,lease_expires_at=NULL,available_at=$4::timestamptz+interval '2 seconds',updated_at=$4 WHERE id=$1`, job.ID, job.AffectedEventCount, job.AffectedSessionCount, now)
		if err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
	}
	var pending bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM analytics_deletion_job_buckets b
		JOIN analytics_dirty_buckets d ON d.environment_id=b.environment_id AND d.bucket_date=b.bucket_date
		WHERE b.job_id=$1 AND b.project_id=$2
	)`, job.ID, job.ProjectID).Scan(&pending); err != nil {
		return false, err
	}
	if pending {
		_, err = tx.Exec(ctx, `UPDATE analytics_deletion_jobs SET status='recomputing',lease_owner=NULL,lease_expires_at=NULL,available_at=$2::timestamptz+interval '2 seconds',updated_at=$2 WHERE id=$1`, job.ID, now)
		if err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
	}
	var org, requester string
	var requestDigest []byte
	var events, sessions int64
	err = tx.QueryRow(ctx, `UPDATE analytics_deletion_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,completed_at=$2,updated_at=$2 WHERE id=$1 RETURNING organization_id,requested_by_actor_id,request_digest,affected_event_count,affected_session_count`, job.ID, now).Scan(&org, &requester, &requestDigest, &events, &sessions)
	if err != nil {
		return false, err
	}
	if err = audit(ctx, tx, org, job.ProjectID, "", requester, "analytics.deletion_completed", job.ID, requestDigest, &events, &sessions, now); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

func (r *Repository) LeaseRetention(ctx context.Context, worker string, now, expires time.Time) (analytics.Job, bool, error) {
	_, _ = r.pool.Exec(ctx, `INSERT INTO analytics_retention_runs(id,project_id,environment_id,status,cutoff_at,available_at,created_at,updated_at) SELECT 'retention_'||md5(s.environment_id||date_trunc('day',$1)::text),s.project_id,s.environment_id,'queued',date_trunc('day',$1)-make_interval(days=>s.raw_retention_days),$1,$1,$1 FROM analytics_environment_settings s ON CONFLICT(environment_id,cutoff_at) DO NOTHING`, now)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return analytics.Job{}, false, err
	}
	defer tx.Rollback(ctx)
	var job analytics.Job
	err = tx.QueryRow(ctx, `SELECT id,project_id,environment_id,cutoff_at FROM analytics_retention_runs WHERE (status='queued' OR status='leased' AND lease_expires_at<=$1) AND available_at<=$1 AND attempt_count<max_attempts ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&job.ID, &job.ProjectID, &job.EnvironmentID, &job.BucketDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return job, false, nil
	}
	if err != nil {
		return job, false, err
	}
	_, err = tx.Exec(ctx, `UPDATE analytics_retention_runs SET status='leased',attempt_count=attempt_count+1,lease_owner=$2,lease_expires_at=$3,updated_at=$4 WHERE id=$1`, job.ID, worker, expires, now)
	if err != nil {
		return job, false, err
	}
	job.Kind = "retention"
	return job, true, tx.Commit(ctx)
}

func (r *Repository) RunRetention(ctx context.Context, job analytics.Job, now time.Time, limit int) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT row_id,date_trunc('day',occurred_at) FROM analytics_events WHERE environment_id=$1 AND received_at<$2 ORDER BY received_at,row_id LIMIT $3 FOR UPDATE`, job.EnvironmentID, job.BucketDate, limit)
	if err != nil {
		return false, err
	}
	ids := []int64{}
	dates := []time.Time{}
	for rows.Next() {
		var id int64
		var date time.Time
		if err = rows.Scan(&id, &date); err != nil {
			return false, err
		}
		ids = append(ids, id)
		dates = append(dates, date)
	}
	rows.Close()
	if len(ids) > 0 {
		_, err = tx.Exec(ctx, `DELETE FROM analytics_events WHERE environment_id=$1 AND row_id=ANY($2)`, job.EnvironmentID, ids)
		if err != nil {
			return false, err
		}
		for _, date := range dates {
			_, _ = tx.Exec(ctx, `INSERT INTO analytics_dirty_buckets(environment_id,project_id,bucket_date,reason,marked_at) VALUES($1,$2,$3,'retention',$4) ON CONFLICT(environment_id,bucket_date) DO UPDATE SET reason='retention',marked_at=excluded.marked_at`, job.EnvironmentID, job.ProjectID, date, now)
		}
	}
	done := len(ids) < limit
	status := "queued"
	if done {
		status = "completed"
	}
	_, err = tx.Exec(ctx, `UPDATE analytics_retention_runs SET status=$2,deleted_event_count=deleted_event_count+$3,lease_owner=NULL,lease_expires_at=NULL,available_at=$4::timestamptz+interval '1 second',updated_at=$4 WHERE id=$1`, job.ID, status, len(ids), now)
	if err != nil {
		return false, err
	}
	return done, tx.Commit(ctx)
}

func (r *Repository) FailJob(ctx context.Context, job analytics.Job, code string, now time.Time) error {
	table := "analytics_export_jobs"
	switch job.Kind {
	case "aggregate":
		table = "analytics_aggregation_jobs"
	case "retention":
		table = "analytics_retention_runs"
	case "deletion":
		table = "analytics_deletion_jobs"
	}
	allowed := map[string]bool{"analytics_export_jobs": true, "analytics_aggregation_jobs": true, "analytics_retention_runs": true, "analytics_deletion_jobs": true}
	if !allowed[table] {
		return fmt.Errorf("unknown analytics job type")
	}
	_, err := r.pool.Exec(ctx, `UPDATE `+table+` SET status=CASE WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'queued' END,lease_owner=NULL,lease_expires_at=NULL,last_error_code=$2,available_at=$3::timestamptz+interval '5 seconds',updated_at=$3 WHERE id=$1`, job.ID, code, now)
	return err
}
