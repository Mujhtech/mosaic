package billingaccesspostgres

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/migrations"
)

func authorityTestPool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	url := os.Getenv("DATABASE_TEST_URL")
	if url == "" {
		t.Skip("DATABASE_TEST_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, ctx
}

// Exact Application/platform and customer selection is the security boundary:
// neither another Application's pointer nor the legacy global pointer may be
// used when the requested scope is missing or has a stale epoch.
func TestAuthoritySelectionIsExactAndEpochBound(t *testing.T) {
	pool, ctx := authorityTestPool(t)
	lockConnection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lockConnection.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended('billingaccess-authority-integration',0))`); err != nil {
		lockConnection.Release()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = lockConnection.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtextextended('billingaccess-authority-integration',0))`)
		lockConnection.Release()
	})
	now := time.Now().UTC()
	suffix := "_" + strconv.FormatInt(now.UnixNano(), 36)
	name := func(value string) string { return value + suffix }
	replacer := strings.NewReplacer(
		"app_auth_ios", name("app_auth_ios"), "app_auth_android", name("app_auth_android"),
		"brps_auth_ios", name("brps_auth_ios"), "brps_auth_android", name("brps_auth_android"),
		"bmc_auth", name("bmc_auth"), "bmp_auth", name("bmp_auth"), "brp_auth", name("brp_auth"),
	)
	z := make([]byte, 32)
	z[0] = 1
	org, project, environment, customer := name("org_auth_sel"), name("proj_auth_sel"), name("env_auth_sel"), name("bcu_auth_sel")
	cleanup := func() {
		for _, table := range []string{"billing_migration_v2_sync_observations", "billing_migration_authority_transitions", "billing_migration_readiness_policy_scopes", "billing_migration_readiness_policies", "customer_entitlement_snapshots"} {
			_, _ = pool.Exec(context.Background(), `ALTER TABLE `+table+` DISABLE TRIGGER USER`)
		}
		for _, query := range []string{
			`DELETE FROM billing_migration_v2_sync_observations WHERE project_id=$1`,
			`DELETE FROM billing_migration_scope_current_pointers WHERE project_id=$1`,
			`DELETE FROM billing_migration_authority_transitions WHERE project_id=$1`,
			`DELETE FROM billing_migration_authority_scopes WHERE project_id=$1`,
			`DELETE FROM billing_migration_readiness_policy_scopes WHERE project_id=$1`,
			`DELETE FROM billing_migration_readiness_policies WHERE project_id=$1`,
			`DELETE FROM billing_migration_program_scopes WHERE project_id=$1`,
			`DELETE FROM billing_migration_programs WHERE project_id=$1`,
			`DELETE FROM billing_migration_credentials WHERE project_id=$1`,
			`DELETE FROM customer_entitlement_pointers WHERE project_id=$1`,
			`DELETE FROM customer_entitlement_snapshots WHERE project_id=$1`,
			`DELETE FROM billing_customers WHERE project_id=$1`,
			`DELETE FROM applications WHERE project_id=$1`,
			`DELETE FROM environments WHERE project_id=$1`,
			`DELETE FROM projects WHERE id=$1`,
		} {
			_, _ = pool.Exec(context.Background(), query, project)
		}
		_, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, org)
		for _, table := range []string{"billing_migration_v2_sync_observations", "billing_migration_authority_transitions", "billing_migration_readiness_policy_scopes", "billing_migration_readiness_policies", "customer_entitlement_snapshots"} {
			_, _ = pool.Exec(context.Background(), `ALTER TABLE `+table+` ENABLE TRIGGER USER`)
		}
	}
	cleanup()
	t.Cleanup(cleanup)
	statements := []struct {
		q string
		a []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES($1,'Authority',$2,$2)`, []any{org, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at) VALUES($1,$2,$1,'Authority','active',$3,$3)`, []any{project, org, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at) VALUES($1,$2,'production','Production','production',$3,$3)`, []any{environment, project, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at) VALUES
		 ('app_auth_ios',$1,'iOS','ios','dev.auth.ios',$2,$2),('app_auth_android',$1,'Android','android','dev.auth.android',$2,$2)`, []any{project, now}},
		{`INSERT INTO billing_customers(id,project_id,status,diagnostics_status,created_at,updated_at) VALUES($1,$2,'active','none',$3,$3)`, []any{customer, project, now}},
		{`INSERT INTO billing_migration_credentials(id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_by_actor_id,created_at)
		 VALUES('bmc_auth',$1,'revenuecat','rc','active',1,'AES-256-GCM','key',decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),$2,'actor',$3)`, []any{project, z, now}},
		{`INSERT INTO billing_migration_programs(id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,idempotency_key,request_digest,created_by_actor_id,created_at,updated_at)
		 VALUES('bmp_auth',$1,$2,'revenuecat','1','bmc_auth','stabilizing',1,4,7,7,$3,$3,'idem',$3,'actor',$4,$4)`, []any{project, environment, z, now}},
		{`INSERT INTO billing_migration_program_scopes(program_id,project_id,environment_id,application_id,platform,created_at) VALUES
		 ('bmp_auth',$1,$2,'app_auth_ios','ios',$3),('bmp_auth',$1,$2,'app_auth_android','android',$3)`, []any{project, environment, now}},
		{`INSERT INTO billing_migration_readiness_policies(id,program_id,project_id,state_version,watermark_max_age_seconds,supported_version_window_start,application_version_digest,policy_digest,frozen_at)
		 VALUES('brp_auth','bmp_auth',$1,1,3600,$2,$3,$3,$2)`, []any{project, now, z}},
		{`INSERT INTO billing_migration_readiness_policy_scopes(id,policy_id,program_id,project_id,application_id,platform,minimum_app_version,maximum_app_version,traffic_window_started_at,traffic_window_ended_at,outside_window_accepted,minimum_sdk_version,required_capabilities,serving_requirements_digest) VALUES
		 ('brps_auth_ios','brp_auth','bmp_auth',$1,'app_auth_ios','ios','4.0.0','5.9.9',$2::timestamptz-interval '1 hour',$2::timestamptz+interval '1 hour',false,'2.0.0',ARRAY['authority_epoch','authority_scope'],$3),
		 ('brps_auth_android','brp_auth','bmp_auth',$1,'app_auth_android','android','4.0.0','5.9.9',$2::timestamptz-interval '1 hour',$2::timestamptz+interval '1 hour',false,'2.0.0',ARRAY['authority_epoch','authority_scope'],$3)`, []any{project, now, z}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, replacer.Replace(statement.q), statement.a...); err != nil {
			t.Fatal(err)
		}
	}

	for index, id := range []string{"ios", "android"} {
		if _, err := pool.Exec(ctx, `INSERT INTO customer_entitlement_snapshots(id,project_id,environment_id,billing_customer_id,snapshot_version,rule_version,computed_at,as_of,checksum,change_reason,created_at)
		 VALUES($1,$2,$3,$4,$5,1,$6,$6,$7,'initial_projection',$6)`, name("ces_auth_"+id), project, environment, customer, index+1, now, z); err != nil {
			t.Fatal(err)
		}
	}
	cutover := now.Add(-time.Hour)
	for _, row := range []struct {
		id, app, platform, snapshot string
		epoch                       int64
	}{{name("mas_auth_ios"), name("app_auth_ios"), "ios", name("ces_auth_ios"), 5}, {name("mas_auth_android"), name("app_auth_android"), "android", name("ces_auth_android"), 8}} {
		if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at) VALUES($1,$2,$3,$4,$5,'mosaic',$6,$7,$8,$9)`, row.id, project, environment, row.app, row.platform, row.epoch, name("bmp_auth"), z, now); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_authority_transitions(id,program_id,project_id,authority_scope_id,from_authority,to_authority,from_epoch,to_epoch,transition_kind,transition_digest,transitioned_at) VALUES($1,$2,$3,$4,'source','mosaic',$5,$6,'cutover',$7,$8)`, name("bat_"+row.platform), name("bmp_auth"), project, row.id, row.epoch-1, row.epoch, z, cutover); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO billing_migration_scope_current_pointers(project_id,environment_id,application_id,platform,billing_customer_id,current_snapshot_id,authority_epoch,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, project, environment, row.app, row.platform, customer, row.snapshot, row.epoch, now); err != nil {
			t.Fatal(err)
		}
	}
	repository := New(pool)
	iosScope := billingaccess.AuthorityScope{ProjectID: project, EnvironmentID: environment, ApplicationID: name("app_auth_ios"), Platform: "ios"}
	selection, err := repository.AuthoritySelection(ctx, iosScope, customer, now)
	if err != nil {
		t.Fatal(err)
	}
	if selection.AuthorityEpoch != 5 || selection.Snapshot.SnapshotID != name("ces_auth_ios") {
		t.Fatalf("cross-scope selection: %+v", selection)
	}
	if _, err := pool.Exec(ctx, `UPDATE billing_migration_scope_current_pointers SET authority_epoch=4 WHERE project_id=$1 AND application_id=$2`, project, name("app_auth_ios")); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.AuthoritySelection(ctx, iosScope, customer, now); !errors.Is(err, billingaccess.ErrNotFound) {
		t.Fatalf("epoch mismatch returned %v, want unavailable", err)
	}
}
