// Command migrate is the only supported way to change the Mosaic schema. The
// API never migrates during normal startup.
//
//	migrate preflight              report current/expected version and verdict
//	migrate status                 list applied and pending migrations
//	migrate version                print the current version
//	migrate up                     apply all pending migrations
//	migrate up-to <version>        apply migrations through <version>
//	migrate down --confirm         roll back exactly one migration
//	migrate down-to <version> --confirm
//	migrate redo --confirm         roll back and reapply the latest migration
//
// Exit codes:
//
//	0  success; for preflight, the schema is compatible
//	1  the command failed
//	3  preflight found pending migrations (upgrade required)
//	4  preflight found an incompatible or dirty schema (manual recovery required)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	platformconfig "github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

const (
	exitFailure         = 1
	exitPendingUpgrade  = 3
	exitIncompatible    = 4
	defaultStepTimeout  = 30 * time.Minute
	connectTimeoutLimit = 30 * time.Second
)

// exitError carries a specific process exit code out of run.
type exitError struct {
	code int
	err  error
}

func (e *exitError) Error() string { return e.err.Error() }
func (e *exitError) Unwrap() error { return e.err }

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "migration failed: %v\n", err)
		var exit *exitError
		if errors.As(err, &exit) {
			os.Exit(exit.code)
		}
		os.Exit(exitFailure)
	}
}

func run(args []string) error {
	action, flagArguments, positional := splitArguments(args)
	flags := flag.NewFlagSet("migrate", flag.ContinueOnError)
	confirm := flags.Bool("confirm", false, "confirm a destructive rollback (required for down, down-to, and redo)")
	// The old command wrapped the entire run in a fixed 10s context, which
	// aborted any real migration on a populated database mid-flight. The
	// timeout is now generous, configurable, and applied per Goose call.
	stepTimeout := flags.Duration("timeout", stepTimeoutFromEnvironment(), "maximum duration for a single migration step")
	lockTimeout := flags.Duration("lock-timeout", 5*time.Minute, "maximum time to wait for the migration advisory lock")
	if err := flags.Parse(flagArguments); err != nil {
		return err
	}
	if action == "" {
		return errors.New("usage: migrate <preflight|status|version|up|up-to|down|down-to|redo> [version] [flags]")
	}
	if remaining := flags.Args(); len(remaining) > 0 {
		return fmt.Errorf("unexpected argument %q", remaining[0])
	}

	var target int64
	switch action {
	case "up-to", "down-to":
		if len(positional) != 1 {
			return fmt.Errorf("%s requires a target version", action)
		}
		parsed, err := strconv.ParseInt(positional[0], 10, 64)
		if err != nil {
			return fmt.Errorf("%s target version must be numeric", action)
		}
		target = parsed
	case "preflight", "status", "version", "up", "down", "redo":
		if len(positional) != 0 {
			return fmt.Errorf("%s does not take a positional argument", action)
		}
	default:
		return fmt.Errorf("unsupported migration action %q", action)
	}

	destructive := action == "down" || action == "down-to" || action == "redo"
	if destructive && !*confirm {
		return fmt.Errorf(
			"%s rolls the schema back and can be refused by irreversible migrations; pass --confirm to proceed. "+
				"Rollback is not a substitute for restore-from-backup", action)
	}

	applicationConfig, err := platformconfig.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	postgresConfig, err := pgx.ParseConfig(applicationConfig.Database.URL)
	if err != nil {
		return errors.New("DATABASE_URL is invalid")
	}
	db := stdlib.OpenDB(*postgresConfig)
	defer db.Close()
	db.SetMaxOpenConns(1)

	connectContext, cancelConnect := context.WithTimeout(context.Background(), connectTimeoutLimit)
	defer cancelConnect()
	if err := db.PingContext(connectContext); err != nil {
		return fmt.Errorf("connect to PostgreSQL: %w", err)
	}

	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("configure Goose: %w", err)
	}
	// A session-scoped advisory lock keeps two concurrent deployments (or a
	// retried Compose migrate step) from applying migrations at the same time.
	sessionLocker, err := newSessionLocker(*lockTimeout)
	if err != nil {
		return fmt.Errorf("configure migration locking: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.Files,
		goose.WithSessionLocker(sessionLocker))
	if err != nil {
		return fmt.Errorf("configure migration provider: %w", err)
	}

	switch action {
	case "preflight":
		return preflight(context.Background(), provider, *stepTimeout)
	case "status":
		return status(context.Background(), provider, *stepTimeout)
	case "version":
		ctx, cancel := context.WithTimeout(context.Background(), *stepTimeout)
		defer cancel()
		version, err := provider.GetDBVersion(ctx)
		if err != nil {
			return fmt.Errorf("read current version: %w", err)
		}
		fmt.Printf("%d\n", version)
		return nil
	case "up":
		return report(runWithTimeout(*stepTimeout, provider.Up))
	case "up-to":
		return report(runWithTimeoutTo(*stepTimeout, provider.UpTo, target))
	case "down":
		return report(runWithTimeout(*stepTimeout, func(ctx context.Context) ([]*goose.MigrationResult, error) {
			result, err := provider.Down(ctx)
			return single(result), err
		}))
	case "down-to":
		return report(runWithTimeoutTo(*stepTimeout, provider.DownTo, target))
	case "redo":
		return report(runWithTimeout(*stepTimeout, func(ctx context.Context) ([]*goose.MigrationResult, error) {
			down, err := provider.Down(ctx)
			if err != nil {
				return single(down), err
			}
			up, err := provider.UpByOne(ctx)
			return append(single(down), single(up)...), err
		}))
	}
	return fmt.Errorf("unsupported migration action %q", action)
}

func single(result *goose.MigrationResult) []*goose.MigrationResult {
	if result == nil {
		return nil
	}
	return []*goose.MigrationResult{result}
}

func stepTimeoutFromEnvironment() time.Duration {
	if raw := os.Getenv("MOSAIC_MIGRATION_TIMEOUT"); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultStepTimeout
}

func runWithTimeout(timeout time.Duration, fn func(context.Context) ([]*goose.MigrationResult, error)) ([]*goose.MigrationResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return fn(ctx)
}

func runWithTimeoutTo(timeout time.Duration, fn func(context.Context, int64) ([]*goose.MigrationResult, error), target int64) ([]*goose.MigrationResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return fn(ctx, target)
}

func report(results []*goose.MigrationResult, err error) error {
	for _, result := range results {
		if result == nil {
			continue
		}
		direction := "applied"
		if result.Direction == "down" {
			direction = "rolled back"
		}
		fmt.Printf("%s %d %s in %s\n", direction, result.Source.Version, result.Source.Path, result.Duration)
	}
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

func status(ctx context.Context, provider *goose.Provider, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	states, err := provider.Status(ctx)
	if err != nil {
		return fmt.Errorf("read migration status: %w", err)
	}
	pending := 0
	fmt.Printf("%-10s %-12s %s\n", "VERSION", "STATE", "SOURCE")
	for _, state := range states {
		if state.State == goose.StatePending {
			pending++
		}
		fmt.Printf("%-10d %-12s %s\n", state.Source.Version, state.State, state.Source.Path)
	}
	fmt.Printf("\n%d pending migration(s)\n", pending)
	return nil
}

func preflight(ctx context.Context, provider *goose.Provider, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	expected, err := migrations.ExpectedVersion()
	if err != nil {
		return err
	}
	current, err := provider.GetDBVersion(ctx)
	if err != nil {
		return fmt.Errorf("read current version: %w", err)
	}
	states, err := provider.Status(ctx)
	if err != nil {
		return fmt.Errorf("read migration status: %w", err)
	}

	var pending []int64
	var appliedOutOfOrder []int64
	for _, state := range states {
		switch {
		case state.State == goose.StatePending:
			pending = append(pending, state.Source.Version)
		case state.State == goose.StateApplied && state.Source.Version > expected:
			appliedOutOfOrder = append(appliedOutOfOrder, state.Source.Version)
		}
	}
	// A "dirty" schema for Goose is one where a version below the reported
	// current version is still pending: an interrupted or partially applied run.
	dirty := false
	for _, version := range pending {
		if version < current {
			dirty = true
			break
		}
	}

	fmt.Printf("current version:  %d\n", current)
	fmt.Printf("expected version: %d\n", expected)
	fmt.Printf("pending:          %v\n", pending)
	fmt.Printf("dirty:            %t\n", dirty)

	switch {
	case dirty:
		fmt.Println("verdict:          incompatible (interrupted migration run detected)")
		return &exitError{code: exitIncompatible, err: errors.New(
			"the schema has pending migrations below the current version; " +
				"see docs/backend/operations/upgrade.md for failed-migration recovery")}
	case len(appliedOutOfOrder) > 0 || current > expected:
		fmt.Println("verdict:          incompatible (database is ahead of this binary)")
		return &exitError{code: exitIncompatible, err: fmt.Errorf(
			"database version %d is ahead of the version %d this binary ships; "+
				"deploy the matching release or restore from backup", current, expected)}
	case len(pending) > 0:
		fmt.Println("verdict:          upgrade required")
		return &exitError{code: exitPendingUpgrade, err: fmt.Errorf("%d migration(s) pending", len(pending))}
	}
	fmt.Println("verdict:          compatible")
	return nil
}

// newSessionLocker wraps Goose's advisory session lock with a bounded wait so a
// stuck deployment fails with a clear error instead of hanging forever. Goose
// expresses the wait as a retry period times a failure threshold; Mosaic polls
// every five seconds for the requested duration.
func newSessionLocker(wait time.Duration) (lock.SessionLocker, error) {
	const probeSeconds = 5
	attempts := uint64(wait.Seconds()) / probeSeconds
	if attempts < 1 {
		attempts = 1
	}
	return lock.NewPostgresSessionLocker(lock.WithLockTimeout(probeSeconds, attempts))
}

// valueFlags are the migrate flags whose value is a separate argument, so
// `--timeout 30m` is not mistaken for a subcommand or a target version.
var valueFlags = map[string]bool{"timeout": true, "lock-timeout": true}

// splitArguments separates the subcommand and its target version from its
// flags, so every documented form works:
//
//	migrate down --confirm
//	migrate --confirm down
//	migrate down-to 17 --confirm
//	migrate up-to 18 --timeout 30m
//
// Go's flag package stops parsing at the first positional argument, so
// `down-to 17 --confirm` used to leave `--confirm` unparsed AND count it as a
// second positional: the documented rollback form always failed with
// "down-to requires a target version", and the recovery runbook could not be
// followed as written.
func splitArguments(args []string) (string, []string, []string) {
	action := ""
	flags := make([]string, 0, len(args))
	positional := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		argument := args[index]
		if argument == "" {
			continue
		}
		if argument[0] == '-' {
			flags = append(flags, argument)
			name := strings.TrimLeft(argument, "-")
			if !strings.Contains(argument, "=") && valueFlags[name] && index+1 < len(args) {
				index++
				flags = append(flags, args[index])
			}
			continue
		}
		if action == "" {
			action = argument
			continue
		}
		positional = append(positional, argument)
	}
	return action, flags, positional
}
