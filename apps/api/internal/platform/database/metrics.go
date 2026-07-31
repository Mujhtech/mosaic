package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
)

// Stats is the subset of pgxpool.Stat Mosaic publishes. The interface keeps the
// observer testable without a live pool.
type Stats interface{ Stat() *pgxpool.Stat }

// RegisterPoolMetrics publishes connection-pool gauges so operators can see
// saturation before it turns into request latency. EmptyAcquireCount rising is
// the documented pool-exhaustion alert signal.
func RegisterPoolMetrics(pool Stats) error {
	if pool == nil {
		return nil
	}
	meter := otel.Meter("mosaic/database")

	acquired, err := meter.Int64ObservableGauge("mosaic.db.pool.acquired_connections",
		metric.WithDescription("Connections currently checked out of the pool."))
	if err != nil {
		return fmt.Errorf("register pool gauge: %w", err)
	}
	idle, err := meter.Int64ObservableGauge("mosaic.db.pool.idle_connections",
		metric.WithDescription("Connections currently idle in the pool."))
	if err != nil {
		return fmt.Errorf("register pool gauge: %w", err)
	}
	total, err := meter.Int64ObservableGauge("mosaic.db.pool.total_connections",
		metric.WithDescription("Connections currently owned by the pool."))
	if err != nil {
		return fmt.Errorf("register pool gauge: %w", err)
	}
	maximum, err := meter.Int64ObservableGauge("mosaic.db.pool.max_connections",
		metric.WithDescription("Configured maximum pool size."))
	if err != nil {
		return fmt.Errorf("register pool gauge: %w", err)
	}
	emptyAcquires, err := meter.Int64ObservableCounter("mosaic.db.pool.empty_acquire_count",
		metric.WithDescription("Acquires that had to wait because the pool was empty."))
	if err != nil {
		return fmt.Errorf("register pool counter: %w", err)
	}
	canceledAcquires, err := meter.Int64ObservableCounter("mosaic.db.pool.canceled_acquire_count",
		metric.WithDescription("Acquires cancelled before a connection became available."))
	if err != nil {
		return fmt.Errorf("register pool counter: %w", err)
	}
	acquireDuration, err := meter.Float64ObservableCounter("mosaic.db.pool.acquire_duration_seconds",
		metric.WithDescription("Cumulative time spent waiting to acquire a connection."),
		metric.WithUnit("s"))
	if err != nil {
		return fmt.Errorf("register pool counter: %w", err)
	}

	_, err = meter.RegisterCallback(func(_ context.Context, observer metric.Observer) error {
		stat := pool.Stat()
		if stat == nil {
			return nil
		}
		observer.ObserveInt64(acquired, int64(stat.AcquiredConns()))
		observer.ObserveInt64(idle, int64(stat.IdleConns()))
		observer.ObserveInt64(total, int64(stat.TotalConns()))
		observer.ObserveInt64(maximum, int64(stat.MaxConns()))
		observer.ObserveInt64(emptyAcquires, stat.EmptyAcquireCount())
		observer.ObserveInt64(canceledAcquires, stat.CanceledAcquireCount())
		observer.ObserveFloat64(acquireDuration, stat.AcquireDuration().Seconds())
		return nil
	}, acquired, idle, total, maximum, emptyAcquires, canceledAcquires, acquireDuration)
	if err != nil {
		return fmt.Errorf("register pool metric callback: %w", err)
	}
	return nil
}
