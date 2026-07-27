package placementdecisionpostgres

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func TestArchiveRuleSetPreservesVersionsAndClearsActiveUsage(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	// Reset by dropping the schema rather than rolling migrations down: since
	// Phase 8, irreversible down migrations correctly refuse when affected data
	// exists, so a rollback is not a usable test reset. DATABASE_TEST_URL is
	// documented as a throwaway database.
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset the test schema (DATABASE_TEST_URL must be a throwaway database): %v", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at) VALUES('archive_org','Archive','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES('archive_org','archive_actor','owner','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES('archive_project','archive_org','archive','Archive','active','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES('archive_environment','archive_project','staging','Staging','staging','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO placements(id,project_id,key,name,status,created_by_actor_id,created_at,updated_at) VALUES('archive_placement','archive_project','upgrade','Upgrade','active','archive_actor','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO placement_rule_sets(id,project_id,environment_id,placement_id,contract_version,status,created_by_actor_id,created_at,updated_at) VALUES('archive_ruleset','archive_project','archive_environment','archive_placement','1','active','archive_actor','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO placement_rule_set_drafts(id,rule_set_id,project_id,environment_id,status,current_revision,created_by_actor_id,updated_by_actor_id,created_at,updated_at) VALUES('archive_draft','archive_ruleset','archive_project','archive_environment','active',1,'archive_actor','archive_actor','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		UPDATE placement_rule_sets SET current_draft_id='archive_draft' WHERE id='archive_ruleset';
		INSERT INTO placement_rule_set_draft_revisions(draft_id,rule_set_id,project_id,environment_id,revision,document,document_bytes,document_hash,validation,mutation_key_hash,request_hash,actor_id,created_at) VALUES('archive_draft','archive_ruleset','archive_project','archive_environment',1,'{}','{}','0000000000000000000000000000000000000000000000000000000000000000','{"valid":true,"issues":[]}','1111111111111111111111111111111111111111111111111111111111111111','2222222222222222222222222222222222222222222222222222222222222222','archive_actor','2026-07-26T12:00:00Z');
		INSERT INTO placement_rule_set_versions(id,rule_set_id,project_id,environment_id,placement_id,version_number,source_draft_id,source_revision,contract_version,document,document_bytes,document_hash,validation,published_by_actor_id,published_at) VALUES('archive_version','archive_ruleset','archive_project','archive_environment','archive_placement',1,'archive_draft',1,'1','{}','{}','3333333333333333333333333333333333333333333333333333333333333333','{"valid":true,"issues":[]}','archive_actor','2026-07-26T12:00:00Z');
		UPDATE placement_rule_sets SET current_published_version_id='archive_version' WHERE id='archive_ruleset';
	`)
	if err != nil {
		t.Fatalf("seed archive lifecycle: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repository := New(pool)
	err = repository.Transact(ctx, func(tx placementdecision.Transaction) error {
		if !tx.ArchiveRuleSet("archive_ruleset", "archive_actor", time.Date(2026, 7, 26, 13, 0, 0, 0, time.UTC)) {
			return errors.New("active Rule Set was not archived")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var status, draftStatus string
	var currentDraft *string
	if err := pool.QueryRow(ctx, `SELECT rule_set.status,rule_set.current_draft_id,draft.status FROM placement_rule_sets rule_set JOIN placement_rule_set_drafts draft ON draft.rule_set_id=rule_set.id WHERE rule_set.id='archive_ruleset'`).Scan(&status, &currentDraft, &draftStatus); err != nil {
		t.Fatal(err)
	}
	var usage placementdecision.Usage
	versionPreserved := false
	if err := repository.View(ctx, func(reader placementdecision.Reader) error {
		usage = reader.Usage("archive_placement")
		_, versionPreserved = reader.Version("archive_version")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if status != "archived" || currentDraft != nil || draftStatus != "superseded" || !versionPreserved || usage.RuleSetCount != 0 {
		t.Fatalf("archive persistence status=%q currentDraft=%v draft=%q versionPreserved=%t usage=%#v", status, currentDraft, draftStatus, versionPreserved, usage)
	}
}

func TestRevokeOverrideIsTenantScoped(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_TEST_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_TEST_URL is required for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	// Reset by dropping the schema rather than rolling migrations down: since
	// Phase 8, irreversible down migrations correctly refuse when affected data
	// exists, so a rollback is not a usable test reset. DATABASE_TEST_URL is
	// documented as a throwaway database.
	if _, err := db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset the test schema (DATABASE_TEST_URL must be a throwaway database): %v", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO organizations(id,name,created_at,updated_at) VALUES
			('override_org_a','Override A','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z'),
			('override_org_b','Override B','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at) VALUES
			('override_org_a','override_actor','owner','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z'),
			('override_org_b','override_actor','owner','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES
			('override_project_a','override_org_a','project-a','Project A','active','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z'),
			('override_project_b','override_org_b','project-b','Project B','active','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES
			('override_environment_a','override_project_a','staging','Staging A','staging','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z'),
			('override_environment_b','override_project_b','staging','Staging B','staging','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO placements(id,project_id,key,name,status,created_by_actor_id,created_at,updated_at) VALUES
			('override_placement_a','override_project_a','upgrade_a','Upgrade A','active','override_actor','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z'),
			('override_placement_b','override_project_b','upgrade_b','Upgrade B','active','override_actor','2026-07-26T12:00:00Z','2026-07-26T12:00:00Z');
		INSERT INTO placement_qa_overrides(id,project_id,environment_id,placement_id,selector_digest,token_digest,safe_label,outcome,status,created_by_actor_id,created_at,expires_at) VALUES
			('override_target','override_project_a','override_environment_a','override_placement_a',decode(repeat('11',32),'hex'),decode(repeat('22',32),'hex'),'Target','{"type":"no_paywall"}','active','override_actor','2026-07-26T12:00:00Z','2026-07-27T12:00:00Z');
	`)
	if err != nil {
		t.Fatalf("seed tenant override: %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	service := placementdecision.NewService(New(pool))
	actor := placementdecision.Actor{ID: "override_actor"}

	err = service.RevokeOverride(ctx, actor, "override_project_b", "override_environment_b", "override_placement_b", "override_target")
	if !errors.Is(err, placementdecision.ErrNotFound) {
		t.Fatalf("cross-scope revoke error = %v, want not found", err)
	}
	var status string
	var revokeAuditCount int
	if err := pool.QueryRow(ctx, `SELECT status FROM placement_qa_overrides WHERE id='override_target'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action='placement_qa_override.revoked' AND resource_id='override_target'`).Scan(&revokeAuditCount); err != nil {
		t.Fatal(err)
	}
	if status != "active" || revokeAuditCount != 0 {
		t.Fatalf("cross-scope revoke changed target: status=%q audit_count=%d", status, revokeAuditCount)
	}

	if err := service.RevokeOverride(ctx, actor, "override_project_a", "override_environment_a", "override_placement_a", "override_target"); err != nil {
		t.Fatalf("same-scope revoke: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM placement_qa_overrides WHERE id='override_target'`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action='placement_qa_override.revoked' AND resource_id='override_target'`).Scan(&revokeAuditCount); err != nil {
		t.Fatal(err)
	}
	if status != "revoked" || revokeAuditCount != 1 {
		t.Fatalf("same-scope revoke not persisted atomically: status=%q audit_count=%d", status, revokeAuditCount)
	}
}
