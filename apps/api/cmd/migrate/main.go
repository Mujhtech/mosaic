package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	platformconfig "github.com/Mujhtech/mosaic/apps/api/internal/platform/config"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "migration failed: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return errors.New("usage: migrate <up|down|status|version>")
	}
	action := os.Args[1]
	switch action {
	case "up", "down", "status", "version":
	default:
		return fmt.Errorf("unsupported migration action %q", action)
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("configure Goose: %w", err)
	}
	if err := goose.RunContext(ctx, action, db, "."); err != nil {
		return fmt.Errorf("goose %s: %w", action, err)
	}
	return nil
}
