// Package pgtest provides the schema setup PostgreSQL integration tests share.
//
// It exists to keep one property true everywhere: bringing the schema up is a
// separate phase from asserting behaviour, with its own deadline. Sharing one
// deadline across both made failures lie — whichever migration happened to hold
// the clock when it expired was named as the cause, which reads as "that
// migration is broken" rather than "this database is slow". That misdirection
// cost a wrong diagnosis in review, so the honest message lives in one place
// rather than in fifteen copies that can drift apart.
//
// The package deliberately does not import testing: it returns errors and each
// caller fails its own test. Callers must create their assertion context AFTER
// these functions return, because a deadline created beforehand is spent by the
// migration rather than by the assertions it was sized for.
package pgtest

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// MigrationBudget is deliberately generous and separate from any assertion
// budget. Bringing a schema up from empty is slow on a cold container and its
// duration says nothing about the behaviour under test.
const MigrationBudget = 5 * time.Minute

// ResetSchema drops and recreates the public schema.
//
// Resetting this way rather than rolling migrations down is deliberate: since
// Phase 8, irreversible down migrations correctly refuse when affected data
// exists, so a rollback is not a usable test reset. DATABASE_TEST_URL is
// documented as a throwaway database.
func ResetSchema(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), MigrationBudget)
	defer cancel()
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		return describe(ctx, err, "reset the test schema (DATABASE_TEST_URL must be a throwaway database)")
	}
	return nil
}

// Migrate applies migrations under MigrationBudget. Pass upTo 0 to apply every
// migration, or a version to stop there.
func Migrate(db *sql.DB, upTo int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), MigrationBudget)
	defer cancel()
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	// Exactly one of these. Running the full set first and then stopping at
	// upTo is not a stop at all: the schema would already be past it, and a
	// test that pins an older schema would silently run against the newest one.
	var err error
	if upTo > 0 {
		err = goose.UpToContext(ctx, db, ".", upTo)
	} else {
		err = goose.UpContext(ctx, db, ".")
	}
	if err != nil {
		return describe(ctx, err, "apply migrations")
	}
	return nil
}

// ResetAndMigrate resets the schema and then applies migrations.
func ResetAndMigrate(db *sql.DB, upTo int64) error {
	if err := ResetSchema(db); err != nil {
		return err
	}
	return Migrate(db, upTo)
}

// describe reports a blown budget as a blown budget. Naming only the statement
// that happened to be running would point at migration code that is not at
// fault, which is the misdirection this package exists to remove.
func describe(ctx context.Context, err error, action string) error {
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf(
			"schema setup exceeded its %s budget before the test began; the database is too slow or unavailable, and the statement named below merely held the clock: %w",
			MigrationBudget, err)
	}
	return fmt.Errorf("%s: %w", action, err)
}
