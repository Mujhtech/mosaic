package experimentpostgres

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const queueMetricTimeout = 5 * time.Second

// RegisterQueueMetrics publishes backlog depth, oldest-job age, and the
// dead-letter count for Experiment scheduling. A scheduled start or completion
// that never runs silently invalidates an Experiment, so the backlog needs to
// be visible without inspecting the database.
func (r *Repository) RegisterQueueMetrics() error {
	meter := otel.Meter("mosaic/experiment")
	depth, err := meter.Int64ObservableGauge("mosaic.worker.queue.depth",
		metric.WithDescription("Jobs waiting or leased in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register queue depth gauge: %w", err)
	}
	oldest, err := meter.Float64ObservableGauge("mosaic.worker.queue.oldest_age_seconds",
		metric.WithDescription("Age of the oldest unfinished job in a Mosaic worker queue."),
		metric.WithUnit("s"))
	if err != nil {
		return fmt.Errorf("register queue age gauge: %w", err)
	}
	deadLettered, err := meter.Int64ObservableGauge("mosaic.worker.queue.dead_lettered",
		metric.WithDescription("Jobs that exhausted their retry budget and stopped retrying."))
	if err != nil {
		return fmt.Errorf("register dead-letter gauge: %w", err)
	}
	attributes := metric.WithAttributes(
		attribute.String("family", "experiment"),
		attribute.String("queue", "schedule"),
	)
	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, queueMetricTimeout)
		defer cancel()
		var pending, failed int64
		var age *float64
		err := r.pool.QueryRow(ctx, `SELECT
			count(*) FILTER (WHERE status IN ('queued','leased')),
			count(*) FILTER (WHERE status='failed'),
			max(extract(epoch from (now()-scheduled_at))) FILTER (WHERE status IN ('queued','leased'))
			FROM experiment_scheduling_jobs`).Scan(&pending, &failed, &age)
		if err != nil {
			return nil
		}
		observer.ObserveInt64(depth, pending, attributes)
		observer.ObserveInt64(deadLettered, failed, attributes)
		seconds := 0.0
		if age != nil {
			seconds = *age
		}
		observer.ObserveFloat64(oldest, seconds, attributes)
		return nil
	}, depth, oldest, deadLettered)
	if err != nil {
		return fmt.Errorf("register queue metric callback: %w", err)
	}
	return nil
}
