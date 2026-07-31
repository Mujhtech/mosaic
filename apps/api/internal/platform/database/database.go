package database

import (
	"context"
	"fmt"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type Config struct {
	URL            string
	MaxConnections int32
	MinConnections int32
	ConnectTimeout time.Duration
}

func Open(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL is invalid")
	}
	poolConfig.MaxConns = cfg.MaxConnections
	poolConfig.MinConns = cfg.MinConnections
	poolConfig.ConnConfig.Tracer = otelpgx.NewTracer()
	connectCtx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(connectCtx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	if err := Ping(connectCtx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("verify PostgreSQL connectivity: %w", err)
	}
	return pool, nil
}

type Pinger interface{ Ping(context.Context) error }

type HealthChecker struct{ Pinger Pinger }

func (checker HealthChecker) Ping(ctx context.Context) error { return Ping(ctx, checker.Pinger) }

func Ping(ctx context.Context, pinger Pinger) error {
	ctx, span := otel.Tracer("github.com/Mujhtech/mosaic/apps/api/database").Start(ctx, "db.ping", trace.WithAttributes(attribute.String("db.system", "postgresql")))
	defer span.End()
	if err := pinger.Ping(ctx); err != nil {
		span.RecordError(err)
		return fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return nil
}
