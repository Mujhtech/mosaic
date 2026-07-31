package billingpostgres

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const queueMetricTimeout = 5 * time.Second

// billingQueues maps a metric queue label to its backing table. All three share
// the status/available_at/created_at job shape the rest of Mosaic uses.
var billingQueues = map[string]string{
	"validation":     "billing_validation_jobs",
	"reconciliation": "billing_reconciliation_runs",
	"replay":         "billing_replay_jobs",
}

// RegisterQueueMetrics publishes backlog depth, oldest-job age, and dead-letter
// count for every billing queue.
//
// Depth alone cannot distinguish a busy queue from a stuck one, which is why
// oldest age is the alerting signal. The dead-letter gauge is included from day
// one deliberately: provider_sync_jobs shipped without queue metrics and the
// gap only became visible during an incident, so billing does not repeat it.
func (r *Repository) RegisterQueueMetrics() error {
	meter := otel.Meter("mosaic/billing")
	depth, err := meter.Int64ObservableGauge("mosaic.worker.queue.depth",
		metric.WithDescription("Jobs waiting or leased in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register billing queue depth gauge: %w", err)
	}
	oldest, err := meter.Float64ObservableGauge("mosaic.worker.queue.oldest_age_seconds",
		metric.WithDescription("Age of the oldest unfinished job in a Mosaic worker queue."),
		metric.WithUnit("s"))
	if err != nil {
		return fmt.Errorf("register billing queue age gauge: %w", err)
	}
	deadLettered, err := meter.Int64ObservableGauge("mosaic.worker.queue.dead_lettered",
		metric.WithDescription("Jobs that exhausted their attempts in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register billing dead-letter gauge: %w", err)
	}
	quarantine, err := meter.Int64ObservableGauge("mosaic.billing.quarantine.depth",
		metric.WithDescription("Open Mosaic Billing quarantine records by reason."))
	if err != nil {
		return fmt.Errorf("register billing quarantine gauge: %w", err)
	}

	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, queueMetricTimeout)
		defer cancel()
		for queue, table := range billingQueues {
			var count, failed int64
			var age *float64
			row := r.pool.QueryRow(ctx,
				`SELECT
					count(*) FILTER (WHERE status IN ('queued','leased')),
					max(extract(epoch from (now()-created_at))) FILTER (WHERE status IN ('queued','leased')),
					count(*) FILTER (WHERE status = 'failed')
				 FROM `+table)
			if err := row.Scan(&count, &age, &failed); err != nil {
				continue
			}
			attributes := metric.WithAttributes(
				attribute.String("family", "billing"),
				attribute.String("queue", queue),
			)
			observer.ObserveInt64(depth, count, attributes)
			observer.ObserveInt64(deadLettered, failed, attributes)
			seconds := 0.0
			if age != nil {
				seconds = *age
			}
			observer.ObserveFloat64(oldest, seconds, attributes)
		}

		rows, err := r.pool.Query(ctx,
			`SELECT reason_code, count(*) FROM billing_quarantine_records
			 WHERE status IN ('open','retrying') GROUP BY reason_code`)
		if err != nil {
			return nil
		}
		defer rows.Close()
		for rows.Next() {
			var reason string
			var count int64
			if err := rows.Scan(&reason, &count); err != nil {
				continue
			}
			observer.ObserveInt64(quarantine, count, metric.WithAttributes(
				attribute.String("reason_code", reason)))
		}
		return nil
	}, depth, oldest, deadLettered, quarantine)
	if err != nil {
		return fmt.Errorf("register billing queue metric callback: %w", err)
	}
	return nil
}
