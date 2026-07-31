package billingwebhookpostgres

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const queueMetricTimeout = 5 * time.Second

// RegisterQueueMetrics publishes backlog depth, oldest-job age, and exhausted
// count for the webhook delivery queue.
//
// Same three signals and the same metric names as the billing queues, so the
// existing backlog and dead-letter runbooks apply to webhooks without a second
// vocabulary. Depth alone cannot distinguish a busy queue from a stuck one,
// which is why oldest age is the alerting signal.
//
// The exhausted gauge is the one that matters most here and has no equivalent
// elsewhere in Mosaic: an exhausted delivery is a customer's backend that was
// never told about an entitlement change, and nothing else in the system
// surfaces that. It is deliberately published from day one rather than added
// after the first "our access never updated" report.
func (r *Repository) RegisterQueueMetrics() error {
	meter := otel.Meter("mosaic/billingwebhook")
	depth, err := meter.Int64ObservableGauge("mosaic.worker.queue.depth",
		metric.WithDescription("Jobs waiting or leased in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register webhook queue depth gauge: %w", err)
	}
	oldest, err := meter.Float64ObservableGauge("mosaic.worker.queue.oldest_age_seconds",
		metric.WithDescription("Age of the oldest unfinished job in a Mosaic worker queue."),
		metric.WithUnit("s"))
	if err != nil {
		return fmt.Errorf("register webhook queue age gauge: %w", err)
	}
	deadLettered, err := meter.Int64ObservableGauge("mosaic.worker.queue.dead_lettered",
		metric.WithDescription("Jobs that exhausted their attempts in a Mosaic worker queue."))
	if err != nil {
		return fmt.Errorf("register webhook dead-letter gauge: %w", err)
	}
	disabled, err := meter.Int64ObservableGauge("mosaic.billing.webhook.destinations.disabled",
		metric.WithDescription("Webhook destinations Mosaic disabled automatically."))
	if err != nil {
		return fmt.Errorf("register webhook auto-disable gauge: %w", err)
	}

	attributes := metric.WithAttributes(
		attribute.String("family", "billing"),
		attribute.String("queue", "webhook_delivery"),
	)
	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, queueMetricTimeout)
		defer cancel()

		var count, exhausted int64
		var age *float64
		row := r.pool.QueryRow(ctx,
			`SELECT
				count(*) FILTER (WHERE status = 'pending'),
				max(extract(epoch from (now()-created_at))) FILTER (WHERE status = 'pending'),
				count(*) FILTER (WHERE status IN ('exhausted','failed'))
			 FROM webhook_deliveries`)
		if err := row.Scan(&count, &age, &exhausted); err == nil {
			observer.ObserveInt64(depth, count, attributes)
			observer.ObserveInt64(deadLettered, exhausted, attributes)
			seconds := 0.0
			if age != nil {
				seconds = *age
			}
			observer.ObserveFloat64(oldest, seconds, attributes)
		}

		var autoDisabled int64
		if err := r.pool.QueryRow(ctx,
			`SELECT count(*) FROM webhook_destinations WHERE auto_disabled_at IS NOT NULL`).
			Scan(&autoDisabled); err == nil {
			observer.ObserveInt64(disabled, autoDisabled)
		}
		return nil
	}, depth, oldest, deadLettered, disabled)
	if err != nil {
		return fmt.Errorf("register webhook queue metric callback: %w", err)
	}
	return nil
}
