package billingwebhookpostgres

import (
	"context"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
)

var _ billingwebhook.DestinationReadinessReader = (*Repository)(nil)

// DestinationReadiness is a narrow, read-only seam for migration readiness.
// A recent successful v2 authority-event delivery proves both that signing
// material opened and that this receiver configuration accepted the signed
// authority-aware bytes. Entitlement-only and v1 deliveries are deliberately
// insufficient. No destination is a valid configuration and therefore does
// not block readiness.
func (r *Repository) DestinationReadiness(ctx context.Context, projectID, environmentID string, recentAfter time.Time) (billingwebhook.DestinationReadiness, error) {
	var result billingwebhook.DestinationReadiness
	err := r.pool.QueryRow(ctx, `SELECT count(*),count(*) FILTER (WHERE d.contract_version=2
		AND EXISTS(SELECT 1 FROM webhook_signing_secrets secret WHERE secret.webhook_destination_id=d.id
		 AND secret.project_id=d.project_id AND secret.status='active')
		AND EXISTS(SELECT 1 FROM webhook_delivery_attempts attempt
		 JOIN webhook_events event ON event.id=attempt.webhook_event_id AND event.project_id=attempt.project_id
		 WHERE attempt.webhook_destination_id=d.id AND attempt.project_id=d.project_id
		 AND attempt.outcome='delivered' AND attempt.attempted_at >= $3
		 AND attempt.attempted_at >= d.updated_at
		 AND event.contract_version=2 AND event.event_type LIKE 'authority.%'
		 AND event.event_type=ANY(d.event_types)))
		FROM webhook_destinations d JOIN environments environment ON environment.id=d.environment_id AND environment.project_id=d.project_id
		WHERE d.project_id=$1 AND d.environment_id=$2 AND d.status='active' AND environment.mode='production'`,
		projectID, environmentID, recentAfter).Scan(&result.ActiveDestinationCount, &result.HealthyV2Count)
	return result, err
}
