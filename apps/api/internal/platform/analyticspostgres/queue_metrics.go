package analyticspostgres

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// queueMetricTimeout bounds the observation query so a slow database cannot
// stall the metric export pipeline.
const queueMetricTimeout = 5 * time.Second

// analyticsQueues maps a metric queue label to its backing table. All four
// tables share the status/available_at/created_at job shape.
var analyticsQueues = map[string]string{
	"aggregate": "analytics_aggregation_jobs",
	"export":    "analytics_export_jobs",
	"deletion":  "analytics_deletion_jobs",
	"retention": "analytics_retention_runs",
}

// RegisterQueueMetrics publishes backlog depth and oldest-job age per analytics
// queue. Oldest age is the documented worker-backlog alert signal: depth alone
// does not distinguish a busy queue from a stuck one.
func (r *Repository) RegisterQueueMetrics() error {
	meter := otel.Meter("mosaic/analytics")
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
	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, queueMetricTimeout)
		defer cancel()
		for queue, table := range analyticsQueues {
			var count int64
			var age *float64
			row := r.pool.QueryRow(ctx,
				`SELECT count(*), max(extract(epoch from (now()-created_at))) FROM `+table+
					` WHERE status IN ('queued','leased')`)
			if err := row.Scan(&count, &age); err != nil {
				continue
			}
			attributes := metric.WithAttributes(
				attribute.String("family", "analytics"),
				attribute.String("queue", queue),
			)
			observer.ObserveInt64(depth, count, attributes)
			seconds := 0.0
			if age != nil {
				seconds = *age
			}
			observer.ObserveFloat64(oldest, seconds, attributes)
		}
		return nil
	}, depth, oldest)
	if err != nil {
		return fmt.Errorf("register queue metric callback: %w", err)
	}
	return nil
}
