package billingrestorepostgres

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const queueMetricTimeout = 5 * time.Second

// RegisterQueueMetrics publishes backlog depth, oldest-job age, and dead-letter
// count for the restore queue, under the same instrument names and the same
// `family`/`queue` attributes every other Mosaic queue uses. One dashboard, one
// alert rule, one place to look.
//
// Oldest age is the signal that matters here more than anywhere else in
// billing: a restore is the one job a person is actually waiting on, and depth
// alone cannot tell a busy queue from one that has stopped moving.
//
// The age is measured from requested_at rather than from a created_at column,
// because the restore table dates a job from the moment the caller asked — the
// number a user would recognize as how long they have been waiting.
func (r *Repository) RegisterQueueMetrics() error {
	meter := otel.Meter("mosaic/billingrestore")
	depth, err := meter.Int64ObservableGauge("mosaic.worker.queue.depth",
		metric.WithDescription("Jobs waiting or leased in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register restore queue depth gauge: %w", err)
	}
	oldest, err := meter.Float64ObservableGauge("mosaic.worker.queue.oldest_age_seconds",
		metric.WithDescription("Age of the oldest unfinished job in a Mosaic worker queue."),
		metric.WithUnit("s"))
	if err != nil {
		return fmt.Errorf("register restore queue age gauge: %w", err)
	}
	deadLettered, err := meter.Int64ObservableGauge("mosaic.worker.queue.dead_lettered",
		metric.WithDescription("Jobs that exhausted their attempts in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register restore dead-letter gauge: %w", err)
	}
	// An uncertain outcome is not a failure, so it never shows up in the
	// dead-letter gauge — but a Project whose restores all end
	// `identity_unresolved` has a real problem an operator must be able to see.
	uncertain, err := meter.Int64ObservableGauge("mosaic.billing.restore.uncertain",
		metric.WithDescription("Completed restores that ended on a non-definite outcome, by outcome."))
	if err != nil {
		return fmt.Errorf("register restore uncertainty gauge: %w", err)
	}

	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, queueMetricTimeout)
		defer cancel()

		var count, failed int64
		var age *float64
		row := r.pool.QueryRow(ctx,
			`SELECT
				count(*) FILTER (WHERE status IN ('queued','leased')),
				max(extract(epoch from (now()-requested_at))) FILTER (WHERE status IN ('queued','leased')),
				count(*) FILTER (WHERE status = 'failed')
			 FROM restore_sync_jobs`)
		if err := row.Scan(&count, &age, &failed); err == nil {
			attributes := metric.WithAttributes(
				attribute.String("family", "billing"),
				attribute.String("queue", "restore_sync"),
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
			`SELECT outcome, count(*) FROM restore_sync_jobs
			 WHERE status IN ('completed','failed')
			   AND outcome IS NOT NULL
			   AND outcome NOT IN ('restored','no_additional_purchases')
			   AND completed_at > now() - interval '24 hours'
			 GROUP BY outcome`)
		if err != nil {
			return nil
		}
		defer rows.Close()
		for rows.Next() {
			var outcome string
			var total int64
			if err := rows.Scan(&outcome, &total); err != nil {
				continue
			}
			observer.ObserveInt64(uncertain, total, metric.WithAttributes(
				attribute.String("outcome", outcome)))
		}
		return nil
	}, depth, oldest, deadLettered, uncertain)
	if err != nil {
		return fmt.Errorf("register restore queue metric callback: %w", err)
	}
	return nil
}
