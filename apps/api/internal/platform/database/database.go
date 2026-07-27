package database

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

type Config struct {
	URL            string
	MaxConnections int32
	MinConnections int32
	ConnectTimeout time.Duration
	// MaxConnLifetime, MaxConnIdleTime, and HealthCheckPeriod keep the pool from
	// pinning connections to a failed-over PostgreSQL instance indefinitely.
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
	// StatementTimeout and LockTimeout bound every session so one pathological
	// query cannot hold a connection or a lock for the life of the process.
	StatementTimeout time.Duration
	LockTimeout      time.Duration
}

func Open(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL is invalid")
	}
	poolConfig.MaxConns = cfg.MaxConnections
	poolConfig.MinConns = cfg.MinConnections
	if cfg.MaxConnLifetime > 0 {
		poolConfig.MaxConnLifetime = cfg.MaxConnLifetime
	}
	if cfg.MaxConnIdleTime > 0 {
		poolConfig.MaxConnIdleTime = cfg.MaxConnIdleTime
	}
	if cfg.HealthCheckPeriod > 0 {
		poolConfig.HealthCheckPeriod = cfg.HealthCheckPeriod
	}
	if poolConfig.ConnConfig.RuntimeParams == nil {
		poolConfig.ConnConfig.RuntimeParams = map[string]string{}
	}
	if cfg.StatementTimeout > 0 {
		setDefaultRuntimeParam(poolConfig, "statement_timeout", milliseconds(cfg.StatementTimeout))
	}
	if cfg.LockTimeout > 0 {
		setDefaultRuntimeParam(poolConfig, "lock_timeout", milliseconds(cfg.LockTimeout))
	}
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

// setDefaultRuntimeParam keeps an operator-supplied DATABASE_URL parameter as
// the authority; Mosaic only fills in a default when none was configured.
func setDefaultRuntimeParam(cfg *pgxpool.Config, name, value string) {
	if _, ok := cfg.ConnConfig.RuntimeParams[name]; ok {
		return
	}
	cfg.ConnConfig.RuntimeParams[name] = value
}

func milliseconds(value time.Duration) string {
	return strconv.FormatInt(value.Milliseconds(), 10)
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

// ErrMigrationsPending reports that the database schema is older than the
// schema this binary expects. Mosaic fails readiness rather than serving
// against an incompatible schema, and never migrates implicitly.
var ErrMigrationsPending = errors.New("database schema is behind the expected migration version")

// ErrSchemaAhead reports a database migrated past what this binary understands,
// which happens when a rollback was not accompanied by a restore.
var ErrSchemaAhead = errors.New("database schema is ahead of the expected migration version")

type RowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// AppliedMigrationVersion reads the highest applied Goose version. It returns
// zero when the Goose bookkeeping table does not exist yet.
func AppliedMigrationVersion(ctx context.Context, q RowQuerier) (int64, error) {
	var exists bool
	if err := q.QueryRow(ctx, `SELECT to_regclass('public.goose_db_version') IS NOT NULL`).Scan(&exists); err != nil {
		return 0, fmt.Errorf("inspect migration bookkeeping: %w", err)
	}
	if !exists {
		return 0, nil
	}
	var version *int64
	if err := q.QueryRow(ctx, `SELECT max(version_id) FROM goose_db_version WHERE is_applied`).Scan(&version); err != nil {
		return 0, fmt.Errorf("read applied migration version: %w", err)
	}
	if version == nil {
		return 0, nil
	}
	return *version, nil
}

// MigrationCompatibility verifies the applied schema matches the migrations
// embedded in this binary.
func MigrationCompatibility(ctx context.Context, q RowQuerier) error {
	expected, err := migrations.ExpectedVersion()
	if err != nil {
		return err
	}
	applied, err := AppliedMigrationVersion(ctx, q)
	if err != nil {
		return err
	}
	switch {
	case applied < expected:
		return fmt.Errorf("%w: applied %d, expected %d", ErrMigrationsPending, applied, expected)
	case applied > expected:
		return fmt.Errorf("%w: applied %d, expected %d", ErrSchemaAhead, applied, expected)
	}
	return nil
}
