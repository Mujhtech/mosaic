package billingmigrationpostgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
)

var _ billingmigration.TransitionDeliveryRepository = (*Repository)(nil)
var _ billingmigration.RedeliveryRepository = (*Repository)(nil)

func scanTransition(row pgx.Row) (billingmigration.TransitionOutbox, error) {
	var out billingmigration.TransitionOutbox
	var checkpoint, transition, completion *string
	err := row.Scan(&out.ID, &out.ProgramID, &out.ProjectID, &out.AuthorityScopeID,
		&checkpoint, &transition, &completion, &out.EventKind, &out.CorrelationID,
		&out.AuthorityEpoch, &out.AttemptCount, &out.MaxAttempts, &out.LeaseGeneration,
		&out.LeaseOwner, &out.LeaseExpiresAt, &out.CreatedAt, &out.DueAt)
	if checkpoint != nil {
		out.CheckpointID = *checkpoint
	}
	if transition != nil {
		out.TransitionID = *transition
	}
	if completion != nil {
		out.CompletionReportID = *completion
	}
	return out, err
}

const transitionColumns = `id,program_id,project_id,authority_scope_id,checkpoint_id,transition_id,
	completion_report_id,event_kind,correlation_id,authority_epoch,attempt_count,max_attempts,
	lease_generation,coalesce(lease_owner,''),coalesce(lease_expires_at,'epoch'::timestamptz),created_at,due_at`

func (r *Repository) AppendTransition(ctx context.Context, input billingmigration.AppendTransition) (billingmigration.TransitionOutbox, bool, error) {
	if input.ID == "" {
		sum := sha256.Sum256([]byte(input.ProgramID + "\x00" + input.AuthorityScopeID + "\x00" + input.EventKind + "\x00" + input.CorrelationID))
		input.ID = "mto_" + fmt.Sprintf("%x", sum[:16])
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	}
	if input.DueAt.IsZero() {
		input.DueAt = input.CreatedAt
	}
	tag, err := r.pool.Exec(ctx, `INSERT INTO billing_migration_transition_outbox(
		id,program_id,project_id,authority_scope_id,checkpoint_id,transition_id,completion_report_id,
		event_kind,correlation_id,authority_epoch,status,due_at,created_at,updated_at)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$10,'pending',$11,$12,$12)
		ON CONFLICT(program_id,authority_scope_id,event_kind,correlation_id) DO NOTHING`,
		input.ID, input.ProgramID, input.ProjectID, input.AuthorityScopeID, input.CheckpointID,
		input.TransitionID, input.CompletionReportID, input.EventKind, input.CorrelationID, input.AuthorityEpoch, input.DueAt, input.CreatedAt)
	if err != nil {
		return billingmigration.TransitionOutbox{}, false, translate(err, "append transition notification")
	}
	out, err := scanTransition(r.pool.QueryRow(ctx, `SELECT `+transitionColumns+` FROM billing_migration_transition_outbox
		WHERE program_id=$1 AND authority_scope_id=$2 AND event_kind=$3 AND correlation_id=$4`,
		input.ProgramID, input.AuthorityScopeID, input.EventKind, input.CorrelationID))
	if err != nil {
		return out, false, err
	}
	replay := tag.RowsAffected() == 0
	if out.ProjectID != input.ProjectID || out.CheckpointID != input.CheckpointID || out.TransitionID != input.TransitionID ||
		out.CompletionReportID != input.CompletionReportID || out.AuthorityEpoch != input.AuthorityEpoch {
		return billingmigration.TransitionOutbox{}, replay, billingmigration.ErrIdempotencyConflict
	}
	return out, replay, nil
}

func (r *Repository) LeaseTransition(ctx context.Context, workerID string, now, leaseUntil time.Time) (billingmigration.TransitionOutbox, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingmigration.TransitionOutbox{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `UPDATE billing_migration_transition_outbox SET status='failed',lease_owner=NULL,
		lease_expires_at=NULL,last_error_code='attempts_exhausted',updated_at=$1
		WHERE status IN('pending','running') AND attempt_count>=max_attempts
		AND (status='pending' OR lease_expires_at<=$1)`, now)
	if err != nil {
		return billingmigration.TransitionOutbox{}, false, err
	}
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM billing_migration_transition_outbox
		WHERE status IN('pending','running') AND due_at<=$1 AND attempt_count<max_attempts
		AND (status='pending' OR lease_expires_at<=$1)
		ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return billingmigration.TransitionOutbox{}, false, commitErr
		}
		return billingmigration.TransitionOutbox{}, false, nil
	}
	if err != nil {
		return billingmigration.TransitionOutbox{}, false, err
	}
	out, err := scanTransition(tx.QueryRow(ctx, `UPDATE billing_migration_transition_outbox
		SET status='running',lease_owner=$2,lease_expires_at=$3,lease_generation=lease_generation+1,
		attempt_count=attempt_count+1,updated_at=$4 WHERE id=$1 RETURNING `+transitionColumns,
		id, workerID, leaseUntil, now))
	if err != nil {
		return out, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, false, err
	}
	return out, true, nil
}

func (r *Repository) TransitionAudience(ctx context.Context, out billingmigration.TransitionOutbox) ([]billingmigration.TransitionAudienceMember, error) {
	currentRole, previousRole := "prepared_activation", "rollback_baseline"
	authorityKind, state := "mosaic", "stabilizing"
	useLivePointer := false
	switch out.EventKind {
	case billingmigration.TransitionCutoverPending:
		currentRole, previousRole, authorityKind, state = "rollback_baseline", "", "source", "cutover_pending"
	case billingmigration.TransitionRollbackCompleted, billingmigration.TransitionLegacyRollbackCompleted:
		currentRole, previousRole, authorityKind, state = "rollback_baseline", "prepared_activation", "source_rollback", "rolled_back"
	case billingmigration.TransitionStabilizationCompleted:
		authorityKind, state = "mosaic", "stable"
		useLivePointer = true
	}
	rows, err := r.pool.Query(ctx, `SELECT current.billing_customer_id,
		CASE WHEN $5 THEN live.current_snapshot_id ELSE current.snapshot_id END,
		coalesce(snapshot.snapshot_version,0),snapshot.checksum,
		previous.snapshot_id,coalesce(previous_snapshot.snapshot_version,0),
		scope.project_id,scope.environment_id,scope.application_id,scope.platform,
		coalesce(transition.transitioned_at,completion.completed_at,outbox.created_at),
		CASE WHEN $4='source' THEN NULL ELSE coalesce(
			(SELECT t.transitioned_at FROM billing_migration_authority_transitions t
			 WHERE t.program_id=outbox.program_id AND t.authority_scope_id=outbox.authority_scope_id
			 AND t.transition_kind='cutover' ORDER BY t.transitioned_at LIMIT 1),transition.transitioned_at) END
		FROM billing_migration_transition_outbox outbox
		JOIN billing_migration_authority_scopes scope ON scope.id=outbox.authority_scope_id AND scope.project_id=outbox.project_id
		JOIN billing_migration_checkpoint_pointer_maps current ON current.checkpoint_id=outbox.checkpoint_id
		 AND current.program_id=outbox.program_id AND current.application_id=scope.application_id
		 AND current.platform=scope.platform AND current.pointer_role=$2
		LEFT JOIN billing_migration_scope_current_pointers live ON live.project_id=current.project_id
		 AND live.environment_id=current.environment_id AND live.application_id=current.application_id
		 AND live.platform=current.platform AND live.billing_customer_id=current.billing_customer_id
		LEFT JOIN customer_entitlement_snapshots snapshot ON snapshot.id=CASE WHEN $5 THEN live.current_snapshot_id ELSE current.snapshot_id END
		 AND snapshot.project_id=current.project_id
		LEFT JOIN billing_migration_checkpoint_pointer_maps previous ON previous.checkpoint_id=current.checkpoint_id
		 AND previous.program_id=current.program_id AND previous.application_id=current.application_id
		 AND previous.platform=current.platform AND previous.billing_customer_id=current.billing_customer_id
		 AND previous.pointer_role=NULLIF($3,'')
		LEFT JOIN customer_entitlement_snapshots previous_snapshot ON previous_snapshot.id=previous.snapshot_id AND previous_snapshot.project_id=previous.project_id
		LEFT JOIN billing_migration_authority_transitions transition ON transition.id=outbox.transition_id
		LEFT JOIN billing_migration_completion_reports completion ON completion.id=outbox.completion_report_id
		WHERE outbox.id=$1 ORDER BY current.billing_customer_id`, out.ID, currentRole, previousRole, authorityKind, useLivePointer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	audience := []billingmigration.TransitionAudienceMember{}
	for rows.Next() {
		var m billingmigration.TransitionAudienceMember
		var snapshotID, previousID *string
		var previousVersion int64
		if err := rows.Scan(&m.BillingCustomerID, &snapshotID, &m.SnapshotVersion, &m.SnapshotChecksum,
			&previousID, &previousVersion, &m.ProjectID, &m.EnvironmentID, &m.ApplicationID, &m.Platform,
			&m.OccurredAt, &m.CutoverAt); err != nil {
			return nil, err
		}
		if snapshotID != nil {
			m.CustomerSnapshotID = *snapshotID
		}
		if useLivePointer && snapshotID == nil {
			return nil, billingmigration.ErrPointerCoverage
		}
		if previousRole != "" {
			m.PreviousSnapshotVersion = &previousVersion
		}
		m.AuthorityKind, m.TransitionState, m.AuthorityEpoch = authorityKind, state, out.AuthorityEpoch
		d := sha256.Sum256([]byte(m.ProjectID + "\x00" + m.EnvironmentID + "\x00" + m.ApplicationID + "\x00" + m.Platform + "\x00" + authorityKind + fmt.Sprint(out.AuthorityEpoch)))
		m.AuthorityDigest = d[:]
		audience = append(audience, m)
	}
	return audience, rows.Err()
}

func (r *Repository) CommitTransition(ctx context.Context, out billingmigration.TransitionOutbox, events []billingwebhook.StoredEventV2, completedAt time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status, owner string
	var generation int64
	if err = tx.QueryRow(ctx, `SELECT status,coalesce(lease_owner,''),lease_generation FROM billing_migration_transition_outbox WHERE id=$1 FOR UPDATE`, out.ID).Scan(&status, &owner, &generation); err != nil {
		return err
	}
	if status != "running" || owner != out.LeaseOwner || generation != out.LeaseGeneration {
		return billingmigration.ErrConflict
	}
	for _, stored := range events {
		e := stored.Event
		var snapshotID any
		if stored.CustomerSnapshotID != "" {
			snapshotID = stored.CustomerSnapshotID
		}
		_, err = tx.Exec(ctx, `INSERT INTO webhook_events(id,project_id,environment_id,event_type,billing_customer_id,
			customer_entitlement_snapshot_id,snapshot_version,payload,payload_bytes,payload_digest,contract_version,
			authority_scope_id,authority_epoch,authority_kind,transition_state,correlation_id,snapshot_authority_digest,
			transition_outbox_id,occurred_at,created_at)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,2,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
			e.EventID, e.Authority.Scope.ProjectID, e.Authority.Scope.EnvironmentID, e.EventType, e.BillingCustomerID,
			snapshotID, e.SnapshotVersion, string(stored.Body), stored.Body, stored.Digest, stored.AuthorityScopeID, e.Authority.AuthorityEpoch,
			e.Authority.AuthorityKind, e.Authority.TransitionState, e.CorrelationID,
			parseEventDigest(e.Authority.SnapshotAuthorityDigest), stored.TransitionOutboxID, e.OccurredAt, e.CreatedAt)
		if err != nil {
			return translate(err, "insert transition webhook event")
		}
		_, err = tx.Exec(ctx, `INSERT INTO webhook_deliveries(id,project_id,environment_id,webhook_event_id,webhook_destination_id,
			status,attempt_count,max_attempts,next_attempt_at,created_at,updated_at)
			SELECT 'whdl_'||md5($1||':'||d.id),$2,$3,$1,d.id,'pending',0,$5,$4,$4,$4
			FROM webhook_destinations d WHERE d.project_id=$2 AND d.environment_id=$3 AND d.status='active'
			AND d.contract_version=2 AND $6=ANY(d.event_types)`, e.EventID, e.Authority.Scope.ProjectID,
			e.Authority.Scope.EnvironmentID, completedAt, billingwebhook.DefaultMaxAttempts, e.EventType)
		if err != nil {
			return translate(err, "fan out transition webhook event")
		}
		_, err = tx.Exec(ctx, `INSERT INTO webhook_event_fanouts(webhook_event_id,project_id,delivery_count,skipped_count,fanned_out_at)
			SELECT $1,$2,count(*),0,$3 FROM webhook_deliveries WHERE webhook_event_id=$1`, e.EventID, e.Authority.Scope.ProjectID, completedAt)
		if err != nil {
			return translate(err, "mark transition webhook fanout")
		}
	}
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_transition_outbox SET status='completed',lease_owner=NULL,
		lease_expires_at=NULL,last_error_code=NULL,updated_at=$4 WHERE id=$1 AND status='running'
		AND lease_owner=$2 AND lease_generation=$3`, out.ID, out.LeaseOwner, out.LeaseGeneration, completedAt)
	if err != nil || tag.RowsAffected() != 1 {
		if err != nil {
			return err
		}
		return billingmigration.ErrConflict
	}
	return tx.Commit(ctx)
}

func parseEventDigest(value string) []byte { raw, _ := billingmigration.ParseDigest(value); return raw }

func (r *Repository) FailTransition(ctx context.Context, failure billingmigration.TransitionFailure) error {
	status := "pending"
	var retry any = failure.RetryAt
	var owner, expires any
	if failure.RetryAt.IsZero() {
		status = "failed"
		retry = failure.FailedAt
	}
	tag, err := r.pool.Exec(ctx, `UPDATE billing_migration_transition_outbox SET status=$4,due_at=$5,
		lease_owner=$6,lease_expires_at=$7,last_error_code=$8,updated_at=$9
		WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_generation=$3`, failure.OutboxID,
		failure.LeaseOwner, failure.LeaseGeneration, status, retry, owner, expires, failure.ErrorCode, failure.FailedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return nil
}

func (r *Repository) AuthorizeRedelivery(ctx context.Context, actor billingmigration.Actor, projectID, programID string) error {
	if actor.ID == "" {
		return billingmigration.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx, `SELECT member.role FROM billing_migration_programs program
		JOIN projects project ON project.id=program.project_id
		JOIN organization_members member ON member.organization_id=project.organization_id AND member.actor_id=$3
		WHERE program.id=$1 AND program.project_id=$2`, programID, projectID, actor.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ErrNotFound
	}
	if err != nil {
		return err
	}
	if role != "owner" {
		return billingmigration.ErrForbidden
	}
	return nil
}

func (r *Repository) RedeliverWebhook(ctx context.Context, write billingmigration.RedeliveryWrite) (billingmigration.Redelivery, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return billingmigration.Redelivery{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var existing billingmigration.Redelivery
	var storedRequest []byte
	err = tx.QueryRow(ctx, `SELECT id,program_id,webhook_event_id,webhook_destination_id,webhook_delivery_id,
		idempotency_key,reason,expected_state_version,created_at,request_digest FROM billing_migration_webhook_redeliveries
		WHERE program_id=$1 AND idempotency_key=$2`, write.Input.ProgramID, write.Input.IdempotencyKey).Scan(
		&existing.ID, &existing.ProgramID, &existing.EventID, &existing.DestinationID, &existing.DeliveryID,
		&existing.IdempotencyKey, &existing.Reason, &existing.ExpectedStateVersion, &existing.CreatedAt, &storedRequest)
	if err == nil {
		if !bytes.Equal(storedRequest, write.RequestDigest) {
			return billingmigration.Redelivery{}, true, billingmigration.ErrIdempotencyConflict
		}
		return existing, true, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.Redelivery{}, false, err
	}
	var stateVersion int64
	var eventDigest []byte
	var deliveryID, status string
	var attempts int
	err = tx.QueryRow(ctx, `SELECT program.state_version,event.payload_digest,delivery.id,delivery.status,delivery.attempt_count
		FROM billing_migration_programs program
		JOIN billing_migration_transition_outbox outbox ON outbox.program_id=program.id AND outbox.project_id=program.project_id
		JOIN webhook_events event ON event.transition_outbox_id=outbox.id AND event.id=$3 AND event.project_id=program.project_id
		JOIN webhook_destinations destination ON destination.id=$4 AND destination.project_id=program.project_id
		 AND destination.environment_id=event.environment_id AND destination.contract_version=2
		JOIN webhook_deliveries delivery ON delivery.webhook_event_id=event.id AND delivery.webhook_destination_id=destination.id
		WHERE program.id=$1 AND program.project_id=$2 FOR UPDATE OF program,delivery`, write.Input.ProgramID, write.Input.ProjectID,
		write.Input.EventID, write.Input.DestinationID).Scan(&stateVersion, &eventDigest, &deliveryID, &status, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.Redelivery{}, false, billingmigration.ErrNotFound
	}
	if err != nil {
		return billingmigration.Redelivery{}, false, err
	}
	if stateVersion != write.Input.ExpectedStateVersion {
		return billingmigration.Redelivery{}, false, billingmigration.ErrStaleState
	}
	if !bytes.Equal(eventDigest, write.EventDigest) {
		return billingmigration.Redelivery{}, false, billingmigration.ErrStaleDigest
	}
	if status == billingwebhook.DeliveryPending || attempts >= billingwebhook.MaxAttemptsCeiling {
		return billingmigration.Redelivery{}, false, billingmigration.ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_webhook_redeliveries(id,program_id,project_id,webhook_event_id,
		webhook_destination_id,webhook_delivery_id,idempotency_key,request_digest,expected_state_version,
		expected_event_digest,reason,actor_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		write.RedeliveryID, write.Input.ProgramID, write.Input.ProjectID, write.Input.EventID, write.Input.DestinationID,
		deliveryID, write.Input.IdempotencyKey, write.RequestDigest, write.Input.ExpectedStateVersion, write.EventDigest,
		write.Input.Reason, write.ActorID, write.CreatedAt)
	if err != nil {
		return billingmigration.Redelivery{}, false, translate(err, "record migration webhook redelivery")
	}
	_, err = tx.Exec(ctx, `UPDATE webhook_deliveries SET status='pending',skipped_reason=NULL,next_attempt_at=$3,
		completed_at=NULL,max_attempts=LEAST($4,attempt_count+$5),leased_by=NULL,leased_until=NULL,updated_at=$3
		WHERE id=$1 AND project_id=$2`, deliveryID, write.Input.ProjectID, write.CreatedAt,
		billingwebhook.MaxAttemptsCeiling, billingwebhook.DefaultMaxAttempts)
	if err != nil {
		return billingmigration.Redelivery{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.Redelivery{}, false, err
	}
	return billingmigration.Redelivery{ID: write.RedeliveryID, ProgramID: write.Input.ProgramID, EventID: write.Input.EventID,
		DestinationID: write.Input.DestinationID, DeliveryID: deliveryID, IdempotencyKey: write.Input.IdempotencyKey,
		Reason: write.Input.Reason, ExpectedStateVersion: write.Input.ExpectedStateVersion, CreatedAt: write.CreatedAt}, false, nil
}
