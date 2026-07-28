package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The identifiers below are fixed so the evidence document can quote them and a
// second run reproduces the same rows.
const (
	organizationID = "org_demo9a"
	projectID      = "proj_demo9a"
	environmentID  = "env_demo9a"
	ownerActorID   = "actor_demo9a_owner"

	iosApplicationID     = "app_demo9a_ios"
	androidApplicationID = "app_demo9a_android"

	appleBundleID     = "com.mosaic.demo"
	googlePackageName = "com.mosaic.demo.android"

	appleMonthlyProductID = "com.mosaic.demo.pro.monthly"
	appleYearlyProductID  = "com.mosaic.demo.pro.yearly"
	googleSubscriptionID  = "sub.pro.monthly"
	googleBasePlanID      = "monthly"

	mosaicMonthlyProduct = "prd_demo9a_monthly"
	mosaicYearlyProduct  = "prd_demo9a_yearly"
	mosaicAndroidProduct = "prd_demo9a_android_monthly"

	appleMonthlyMapping    = "ppm_demo9a_ios_monthly"
	appleYearlyMapping     = "ppm_demo9a_ios_yearly"
	googleMonthlyMapping   = "ppm_demo9a_android_monthly"
	pubSubProjectID        = "mosaic-demo-play"
	pubSubSubscriptionID   = "mosaic-rtdn-sub"
	googleServiceAccount   = "mosaic-rtdn@mosaic-demo-play.iam.gserviceaccount.com"
	demoNotificationOrigin = "https://billing.demo.mosaic.local"
)

type apiKey struct {
	id     string
	prefix string
	raw    string
}

func newAPIKey(prefix string) (apiKey, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return apiKey{}, err
	}
	secret := base64.RawURLEncoding.EncodeToString(buffer)
	return apiKey{id: "key_" + prefix, prefix: prefix, raw: prefix + "." + secret}, nil
}

// seedTenant creates the workspace a billing demonstration needs. It writes only
// tables that other Mosaic phases already own (organizations, projects,
// environments, applications, products, provider product mappings, API keys,
// organization membership). Nothing under billing_* is written here: every
// billing row in this demonstration is produced by the API, the service, or the
// worker job functions.
func seedTenant(ctx context.Context, pool *pgxpool.Pool) (publicKey, serverKey apiKey, err error) {
	now := time.Now().UTC()
	if err = resetTenant(ctx, pool); err != nil {
		return apiKey{}, apiKey{}, err
	}

	publicKey, err = newAPIKey("mos_pk_demo9a")
	if err != nil {
		return apiKey{}, apiKey{}, err
	}
	serverKey, err = newAPIKey("mos_sk_demo9a")
	if err != nil {
		return apiKey{}, apiKey{}, err
	}
	publicDigest := sha256.Sum256([]byte(publicKey.raw))
	serverDigest := sha256.Sum256([]byte(serverKey.raw))

	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Mosaic Demo 9A',$2,$2) ON CONFLICT (id) DO NOTHING`,
			[]any{organizationID, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,$2,'owner',$3,$3) ON CONFLICT (organization_id,actor_id) DO NOTHING`, []any{organizationID, ownerActorID, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,'demo9a','Phase 9A Demo','active',$3,$3) ON CONFLICT (id) DO NOTHING`, []any{projectID, organizationID, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`, []any{environmentID, projectID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Demo iOS','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`, []any{iosApplicationID, projectID, appleBundleID, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Demo Android','android',$3,$4,$4) ON CONFLICT (id) DO NOTHING`, []any{androidApplicationID, projectID, googlePackageName, now}},

		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,'pro-monthly','Pro Monthly','subscription','connected','mock',true,$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{mosaicMonthlyProduct, projectID, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,'pro-yearly','Pro Yearly','subscription','connected','mock',true,$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{mosaicYearlyProduct, projectID, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,'android-monthly','Android Pro Monthly','subscription','connected','mock',true,$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{mosaicAndroidProduct, projectID, now}},

		// The iOS monthly and Android mappings exist from the start. The iOS
		// yearly mapping is deliberately absent so the quarantine demonstration
		// has a genuinely unmapped provider Product.
		{`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,availability,sync_state,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'app_store',$5,'active',$6,'ios','available','current',$7,$7)`,
			[]any{appleMonthlyMapping, projectID, mosaicMonthlyProduct, iosApplicationID, appleMonthlyProductID, environmentID, now}},
		{`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,provider_base_plan_identifier,availability,sync_state,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'google_play',$5,'active',$6,'android',$7,'available','current',$8,$8)`,
			[]any{googleMonthlyMapping, projectID, mosaicAndroidProduct, androidApplicationID, googleSubscriptionID, environmentID, googleBasePlanID, now}},

		{`INSERT INTO api_keys(id,environment_id,kind,prefix,secret_digest,created_by_actor_id,created_at,application_id,application_project_id)
		  VALUES ($1,$2,'public_sdk',$3,$4,$5,$6,$7,$8)`,
			[]any{publicKey.id, environmentID, publicKey.prefix, publicDigest[:], ownerActorID, now, iosApplicationID, projectID}},
		{`INSERT INTO api_keys(id,environment_id,kind,prefix,secret_digest,created_by_actor_id,created_at)
		  VALUES ($1,$2,'secret_server',$3,$4,$5,$6)`,
			[]any{serverKey.id, environmentID, serverKey.prefix, serverDigest[:], ownerActorID, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			return apiKey{}, apiKey{}, fmt.Errorf("seed: %s: %w", statement.query[:40], err)
		}
	}
	return publicKey, serverKey, nil
}

// addAppleYearlyMapping is the operator repair the quarantine demonstration
// performs between the failed and successful resolutions.
func addAppleYearlyMapping(ctx context.Context, pool *pgxpool.Pool) error {
	now := time.Now().UTC()
	_, err := pool.Exec(ctx,
		`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,availability,sync_state,created_at,updated_at)
		 VALUES ($1,$2,$3,$4,'app_store',$5,'active',$6,'ios','available','current',$7,$7)`,
		appleYearlyMapping, projectID, mosaicYearlyProduct, iosApplicationID, appleYearlyProductID, environmentID, now)
	return err
}

// resetTenant clears any previous run. The append-only triggers are disabled for
// the duration of the delete only — the demonstration itself never touches them,
// and every append-only guarantee is exercised with the triggers in place.
func resetTenant(ctx context.Context, pool *pgxpool.Pool) error {
	disable := []string{
		`ALTER TABLE billing_ledger_entries DISABLE TRIGGER billing_ledger_entries_append_only`,
		`ALTER TABLE billing_transaction_facts DISABLE TRIGGER billing_transaction_facts_append_only`,
		`ALTER TABLE billing_product_resolutions DISABLE TRIGGER billing_product_resolutions_append_only`,
		`ALTER TABLE billing_validation_attempts DISABLE TRIGGER billing_validation_attempts_append_only`,
		`ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only`,
		`ALTER TABLE billing_raw_inputs DISABLE TRIGGER billing_raw_inputs_append_only`,
		`ALTER TABLE store_server_credential_events DISABLE TRIGGER store_server_credential_events_no_change`,
	}
	deletes := []struct {
		query string
		arg   string
	}{
		{`DELETE FROM billing_ledger_entries WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_replay_jobs WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_reconciliation_runs WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_quarantine_actions WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_quarantine_records WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_transaction_facts WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_product_resolutions WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_validation_jobs WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_validation_attempts WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_raw_inputs WHERE project_id=$1`, projectID},
		{`DELETE FROM store_server_credential_events WHERE project_id=$1`, projectID},
		{`DELETE FROM store_server_credential_applications WHERE project_id=$1`, projectID},
		{`DELETE FROM store_server_credentials WHERE project_id=$1`, projectID},
		{`DELETE FROM billing_project_settings WHERE project_id=$1`, projectID},
		{`DELETE FROM provider_product_mappings WHERE project_id=$1`, projectID},
		{`DELETE FROM api_keys WHERE environment_id=$1`, environmentID},
	}
	enable := []string{
		`ALTER TABLE billing_ledger_entries ENABLE TRIGGER billing_ledger_entries_append_only`,
		`ALTER TABLE billing_transaction_facts ENABLE TRIGGER billing_transaction_facts_append_only`,
		`ALTER TABLE billing_product_resolutions ENABLE TRIGGER billing_product_resolutions_append_only`,
		`ALTER TABLE billing_validation_attempts ENABLE TRIGGER billing_validation_attempts_append_only`,
		`ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only`,
		`ALTER TABLE billing_raw_inputs ENABLE TRIGGER billing_raw_inputs_append_only`,
		`ALTER TABLE store_server_credential_events ENABLE TRIGGER store_server_credential_events_no_change`,
	}
	for _, statement := range disable {
		_, _ = pool.Exec(ctx, statement)
	}
	for _, statement := range deletes {
		if _, err := pool.Exec(ctx, statement.query, statement.arg); err != nil {
			return fmt.Errorf("reset: %s: %w", statement.query, err)
		}
	}
	for _, statement := range enable {
		_, _ = pool.Exec(ctx, statement)
	}
	return nil
}
