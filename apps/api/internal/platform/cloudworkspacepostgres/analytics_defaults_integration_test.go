package cloudworkspacepostgres_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/analyticspostgres"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/cloudworkspacepostgres"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

// A new Project must collect its own monetization events with no operator step:
// that is the whole of the default-on decision, and it is only true if the
// Environment write and the analytics settings row agree. They are written by
// different modules — cloudworkspace creates the Environment, analytics reads
// the settings — so nothing below this level can catch a seed that is missing,
// disabled, or committed in a different transaction from the Environment.
//
// The assertion runs the real ingestion path rather than reading the settings
// row twice, because "collection_enabled is true" and "a batch is accepted" have
// been separately true and jointly false before: ingestion reads the row through
// the SDK key's scope, and a row seeded against the wrong Project or Environment
// still reads as enabled while every batch is refused.
func TestNewEnvironmentsCollectAnalyticsWithoutOperatorAction(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openSQL(t, databaseURL)
	defer db.Close()
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	// Reset by dropping the schema: irreversible down migrations correctly refuse
	// when affected data exists, so a rollback is not a usable reset.
	// DATABASE_TEST_URL is documented as a throwaway database.
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset the test schema (DATABASE_TEST_URL must be a throwaway database): %v", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()

	owner := cloudworkspace.Actor{ID: "actor-owner"}
	workspace := cloudworkspace.NewService(cloudworkspacepostgres.New(pool))
	organization, err := workspace.CreateOrganization(ctx, owner, "Acme")
	if err != nil {
		t.Fatalf("create organization: %v", err)
	}
	project, err := workspace.CreateProject(ctx, owner, organization.ID, "analytics", "Analytics")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	analyticsRepository := analyticspostgres.New(pool)
	environments, err := workspace.ListEnvironments(ctx, owner, project.ID, cloudworkspace.ListOptions{})
	if err != nil {
		t.Fatalf("list environments: %v", err)
	}
	if len(environments.Items) != 3 {
		t.Fatalf("environments created with the Project = %d, want the three defaults", len(environments.Items))
	}
	var development cloudworkspace.Environment
	for _, environment := range environments.Items {
		settings, err := analyticsRepository.Settings(ctx, project.ID, environment.ID)
		if err != nil {
			t.Fatalf("read analytics settings for %s: %v", environment.Key, err)
		}
		if !settings.CollectionEnabled {
			t.Fatalf("%s was created with collection disabled", environment.Key)
		}
		if settings.RawRetentionDays != analytics.DefaultRetentionDays {
			t.Fatalf("%s raw retention = %d, want the %d-day default",
				environment.Key, settings.RawRetentionDays, analytics.DefaultRetentionDays)
		}
		if environment.Mode == cloudworkspace.EnvironmentDevelopment {
			development = environment
		}
	}
	if development.ID == "" {
		t.Fatal("the Project has no development Environment to ingest against")
	}

	application, err := workspace.CreateApplication(ctx, owner, project.ID, "Acme iOS",
		cloudworkspace.PlatformIOS, "dev.mosaic.acme")
	if err != nil {
		t.Fatalf("create application: %v", err)
	}
	key, err := workspace.CreateAPIKey(ctx, owner, development.ID, cloudworkspace.APIKeyPublicSDK, application.ID)
	if err != nil {
		t.Fatalf("create public SDK key: %v", err)
	}

	now := time.Now().UTC()
	stamp := now.Format("2006-01-02T15:04:05.000Z")
	// restore_started carries no attribution to a Paywall, Placement, or Product,
	// so acceptance here turns on the settings row and nothing else.
	event, err := json.Marshal(analytics.Event{
		EventID:            "event_default_on",
		EventSchemaVersion: analytics.EventSchemaVersion,
		EventName:          "restore_started",
		OccurredAt:         stamp,
		QueuedAt:           stamp,
		Authority:          "client_observed",
		Identity:           analytics.Identity{InstallationID: "installation_default_on"},
		SessionID:          "session_default_on",
		Context: analytics.EventContext{
			Platform: "ios", SDKFamily: "ios", SDKVersion: "1.0.0",
			ApplicationVersion: "1.0.0", Locale: "en-US",
		},
		Correlation: analytics.Correlation{RestoreAttemptID: "restore_default_on"},
		Payload:     json.RawMessage(`{"providerId":"app_store"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := analytics.NewService(analyticsRepository, nil).Ingest(ctx, key.Secret, analytics.Batch{
		ContractVersion: analytics.ContractVersion,
		BatchID:         "batch_default_on",
		SentAt:          stamp,
		Events:          []json.RawMessage{event},
	})
	if errors.Is(err, analytics.ErrCollectionDisabled) {
		t.Fatal("a newly created Environment refused its first batch; collection is not on by default")
	}
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	if len(response.Results) != 1 || response.Results[0].Status != "accepted" {
		t.Fatalf("ingestion results = %#v, want the event accepted", response.Results)
	}
}
