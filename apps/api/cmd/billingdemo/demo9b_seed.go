//go:build billingdemo

// This file belongs to the build-tagged demonstration driver and is excluded
// from every ordinary build. See demo9b_stubs.go for why that matters.
package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The Phase 9B demonstration owns its own tenant so it can be run on its own,
// repeatedly, without disturbing the Phase 9A tenant or being disturbed by it.
const (
	organizationID9B = "org_demo9b"
	projectID9B      = "proj_demo9b"
	environmentID9B  = "env_demo9b"
	ownerActorID9B   = "actor_demo9b_owner"

	iosApplicationID9B = "app_demo9b_ios"
	appleBundleID9B    = "com.mosaic.demo9b"

	// Provider products.
	appleMonthly9B  = "com.mosaic.demo9b.pro.monthly"
	appleYearly9B   = "com.mosaic.demo9b.pro.yearly"
	appleLifetime9B = "com.mosaic.demo9b.pro.lifetime"

	// Mosaic products.
	productMonthly9B  = "prd_demo9b_monthly"
	productYearly9B   = "prd_demo9b_yearly"
	productLifetime9B = "prd_demo9b_lifetime"

	// The single Entitlement every source in this demonstration grants. One key
	// is the point: demonstration 5 needs two independent sources granting the
	// same Entitlement.
	entitlementID9B  = "ent_demo9b_pro"
	entitlementKey9B = "pro"

	mappingMonthly9B  = "ppm_demo9b_monthly"
	mappingYearly9B   = "ppm_demo9b_yearly"
	mappingLifetime9B = "ppm_demo9b_lifetime"

	applicationUserA9B = "user-alpha@demo.mosaic.local"
	applicationUserB9B = "user-bravo@demo.mosaic.local"
)

// seedTenant9B creates the workspace the Phase 9B demonstration needs.
//
// It writes only tables other phases already own: organizations, membership,
// projects, environments, applications, products, entitlements, provider
// product mappings, and API keys. Nothing under billing_*, purchase_lineages,
// subscription_*, customer_entitlement_*, product_entitlement_grant_versions,
// or webhook_* is written here — every one of those rows is produced during the
// run by an HTTP handler, an application service, or a worker job function.
func seedTenant9B(ctx context.Context, pool *pgxpool.Pool) (publicKey, serverKey apiKey, err error) {
	now := time.Now().UTC()
	if err = resetTenant9B(ctx, pool); err != nil {
		return apiKey{}, apiKey{}, err
	}

	publicKey, err = newAPIKey("mos_pk_demo9b")
	if err != nil {
		return apiKey{}, apiKey{}, err
	}
	serverKey, err = newAPIKey("mos_sk_demo9b")
	if err != nil {
		return apiKey{}, apiKey{}, err
	}
	publicDigest := sha256.Sum256([]byte(publicKey.raw))
	serverDigest := sha256.Sum256([]byte(serverKey.raw))

	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organizations(id,name,created_at,updated_at) VALUES ($1,'Mosaic Demo 9B',$2,$2)
		  ON CONFLICT (id) DO NOTHING`, []any{organizationID9B, now}},
		{`INSERT INTO organization_members(organization_id,actor_id,role,created_at,updated_at)
		  VALUES ($1,$2,'owner',$3,$3) ON CONFLICT (organization_id,actor_id) DO NOTHING`,
			[]any{organizationID9B, ownerActorID9B, now}},
		{`INSERT INTO projects(id,organization_id,key,name,status,created_at,updated_at)
		  VALUES ($1,$2,'demo9b','Phase 9B Demo','active',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{projectID9B, organizationID9B, now}},
		{`INSERT INTO environments(id,project_id,key,name,mode,created_at,updated_at)
		  VALUES ($1,$2,'production','Production','production',$3,$3) ON CONFLICT (id) DO NOTHING`,
			[]any{environmentID9B, projectID9B, now}},
		{`INSERT INTO applications(id,project_id,name,platform,identifier,created_at,updated_at)
		  VALUES ($1,$2,'Demo 9B iOS','ios',$3,$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{iosApplicationID9B, projectID9B, appleBundleID9B, now}},

		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,'pro-monthly','Pro Monthly','subscription','connected','mock',true,$3,$3)
		  ON CONFLICT (id) DO NOTHING`, []any{productMonthly9B, projectID9B, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,'pro-yearly','Pro Yearly','subscription','connected','mock',true,$3,$3)
		  ON CONFLICT (id) DO NOTHING`, []any{productYearly9B, projectID9B, now}},
		{`INSERT INTO products(id,project_id,key,internal_name,type,status,metadata_source,readiness_ready,created_at,updated_at)
		  VALUES ($1,$2,'pro-lifetime','Pro Lifetime','one_time_non_consumable','connected','mock',true,$3,$3)
		  ON CONFLICT (id) DO NOTHING`, []any{productLifetime9B, projectID9B, now}},

		{`INSERT INTO entitlements(id,project_id,key,name,description,created_at,updated_at)
		  VALUES ($1,$2,$3,'Pro','Everything in Pro',$4,$4) ON CONFLICT (id) DO NOTHING`,
			[]any{entitlementID9B, projectID9B, entitlementKey9B, now}},

		{`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,availability,sync_state,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'app_store',$5,'active',$6,'ios','available','current',$7,$7)`,
			[]any{mappingMonthly9B, projectID9B, productMonthly9B, iosApplicationID9B, appleMonthly9B, environmentID9B, now}},
		{`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,availability,sync_state,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'app_store',$5,'active',$6,'ios','available','current',$7,$7)`,
			[]any{mappingYearly9B, projectID9B, productYearly9B, iosApplicationID9B, appleYearly9B, environmentID9B, now}},
		{`INSERT INTO provider_product_mappings(
			id,project_id,product_id,application_id,provider,provider_product_identifier,status,
			environment_id,platform,availability,sync_state,created_at,updated_at)
		  VALUES ($1,$2,$3,$4,'app_store',$5,'active',$6,'ios','available','current',$7,$7)`,
			[]any{mappingLifetime9B, projectID9B, productLifetime9B, iosApplicationID9B, appleLifetime9B, environmentID9B, now}},

		{`INSERT INTO api_keys(id,environment_id,kind,prefix,secret_digest,created_by_actor_id,created_at,application_id,application_project_id)
		  VALUES ($1,$2,'public_sdk',$3,$4,$5,$6,$7,$8)`,
			[]any{publicKey.id, environmentID9B, publicKey.prefix, publicDigest[:], ownerActorID9B, now, iosApplicationID9B, projectID9B}},
		{`INSERT INTO api_keys(id,environment_id,kind,prefix,secret_digest,created_by_actor_id,created_at)
		  VALUES ($1,$2,'secret_server',$3,$4,$5,$6)`,
			[]any{serverKey.id, environmentID9B, serverKey.prefix, serverDigest[:], ownerActorID9B, now}},
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement.query, statement.args...); err != nil {
			return apiKey{}, apiKey{}, fmt.Errorf("seed 9b: %s: %w", statement.query[:48], err)
		}
	}
	return publicKey, serverKey, nil
}

// resetTenant9B clears a previous run of this demonstration.
//
// The append-only triggers are disabled for the duration of the delete only.
// The demonstration itself never touches them, so every append-only guarantee
// below is exercised with the triggers in place.
func resetTenant9B(ctx context.Context, pool *pgxpool.Pool) error {
	disable := []string{
		`ALTER TABLE billing_ledger_entries DISABLE TRIGGER billing_ledger_entries_append_only`,
		`ALTER TABLE billing_transaction_facts DISABLE TRIGGER billing_transaction_facts_append_only`,
		`ALTER TABLE billing_product_resolutions DISABLE TRIGGER billing_product_resolutions_append_only`,
		`ALTER TABLE billing_validation_attempts DISABLE TRIGGER billing_validation_attempts_append_only`,
		`ALTER TABLE billing_quarantine_actions DISABLE TRIGGER billing_quarantine_actions_append_only`,
		`ALTER TABLE billing_raw_inputs DISABLE TRIGGER billing_raw_inputs_append_only`,
		`ALTER TABLE store_server_credential_events DISABLE TRIGGER store_server_credential_events_no_change`,
		`ALTER TABLE billing_association_evidence DISABLE TRIGGER billing_association_evidence_append_only`,
		`ALTER TABLE subscription_snapshots DISABLE TRIGGER subscription_snapshots_append_only`,
		`ALTER TABLE subscription_snapshot_facts DISABLE TRIGGER subscription_snapshot_facts_append_only`,
		`ALTER TABLE subscription_timeline_entries DISABLE TRIGGER subscription_timeline_entries_append_only`,
		`ALTER TABLE projection_attempts DISABLE TRIGGER projection_attempts_append_only`,
		`ALTER TABLE customer_entitlement_snapshots DISABLE TRIGGER customer_entitlement_snapshots_append_only`,
		`ALTER TABLE customer_entitlement_snapshot_entries DISABLE TRIGGER customer_entitlement_snapshot_entries_append_only`,
		`ALTER TABLE entitlement_sources DISABLE TRIGGER entitlement_sources_append_only`,
		`ALTER TABLE webhook_events DISABLE TRIGGER webhook_events_append_only`,
		`ALTER TABLE webhook_delivery_attempts DISABLE TRIGGER webhook_delivery_attempts_append_only`,
		`ALTER TABLE product_entitlement_grant_versions DISABLE TRIGGER product_entitlement_grant_versions_append_only`,
		`ALTER TABLE restore_sync_job_inputs DISABLE TRIGGER restore_sync_job_inputs_append_only`,
		`ALTER TABLE customer_access_tokens DISABLE TRIGGER customer_access_tokens_preserve_revocation`,
	}
	deletes := []struct {
		query string
		arg   string
	}{
		{`DELETE FROM webhook_delivery_attempts WHERE project_id=$1`, projectID9B},
		{`DELETE FROM webhook_event_fanouts WHERE project_id=$1`, projectID9B},
		{`DELETE FROM webhook_deliveries WHERE project_id=$1`, projectID9B},
		{`DELETE FROM webhook_events WHERE project_id=$1`, projectID9B},
		{`DELETE FROM webhook_signing_secrets WHERE project_id=$1`, projectID9B},
		{`DELETE FROM webhook_destinations WHERE project_id=$1`, projectID9B},

		{`DELETE FROM restore_sync_job_inputs WHERE project_id=$1`, projectID9B},
		{`DELETE FROM restore_sync_jobs WHERE project_id=$1`, projectID9B},

		{`DELETE FROM customer_entitlement_pointers WHERE project_id=$1`, projectID9B},
		{`DELETE FROM customer_entitlement_snapshot_entries WHERE project_id=$1`, projectID9B},
		{`DELETE FROM entitlement_sources WHERE project_id=$1`, projectID9B},
		{`DELETE FROM customer_entitlement_snapshots WHERE project_id=$1`, projectID9B},

		{`DELETE FROM projection_attempts WHERE project_id=$1`, projectID9B},
		{`DELETE FROM projection_jobs WHERE project_id=$1`, projectID9B},
		{`DELETE FROM projection_checkpoints WHERE project_id=$1`, projectID9B},
		{`DELETE FROM subscription_timeline_entries WHERE project_id=$1`, projectID9B},
		{`UPDATE subscription_instances SET current_snapshot_id=NULL WHERE project_id=$1`, projectID9B},
		{`DELETE FROM subscription_snapshot_facts WHERE snapshot_id IN (SELECT id FROM subscription_snapshots WHERE project_id=$1)`, projectID9B},
		{`DELETE FROM subscription_snapshots WHERE project_id=$1`, projectID9B},
		{`DELETE FROM subscription_instances WHERE project_id=$1`, projectID9B},
		{`DELETE FROM one_time_purchase_instances WHERE project_id=$1`, projectID9B},

		{`DELETE FROM customer_access_tokens WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_identity_conflicts WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_association_evidence WHERE project_id=$1`, projectID9B},
		{`UPDATE purchase_lineages SET superseded_by_lineage_id=NULL, billing_customer_id=NULL WHERE project_id=$1`, projectID9B},
		{`DELETE FROM purchase_lineages WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_customer_aliases WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_customers WHERE project_id=$1`, projectID9B},

		{`DELETE FROM billing_ledger_entries WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_replay_jobs WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_reconciliation_runs WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_quarantine_actions WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_quarantine_records WHERE project_id=$1`, projectID9B},
		{`DELETE FROM purchase_chain_digest_links WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_transaction_facts WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_product_resolutions WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_validation_jobs WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_validation_attempts WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_raw_inputs WHERE project_id=$1`, projectID9B},
		{`DELETE FROM store_server_credential_events WHERE project_id=$1`, projectID9B},
		{`DELETE FROM store_server_credential_applications WHERE project_id=$1`, projectID9B},
		{`DELETE FROM store_server_credentials WHERE project_id=$1`, projectID9B},
		{`DELETE FROM billing_project_settings WHERE project_id=$1`, projectID9B},

		{`DELETE FROM product_entitlement_grant_versions WHERE project_id=$1`, projectID9B},
		{`DELETE FROM product_entitlement_grants WHERE project_id=$1`, projectID9B},
		{`DELETE FROM provider_product_mappings WHERE project_id=$1`, projectID9B},
		{`DELETE FROM entitlements WHERE project_id=$1`, projectID9B},
		{`DELETE FROM api_keys WHERE environment_id=$1`, environmentID9B},
		{`DELETE FROM audit_events WHERE project_id=$1`, projectID9B},
	}
	enable := []string{
		`ALTER TABLE billing_ledger_entries ENABLE TRIGGER billing_ledger_entries_append_only`,
		`ALTER TABLE billing_transaction_facts ENABLE TRIGGER billing_transaction_facts_append_only`,
		`ALTER TABLE billing_product_resolutions ENABLE TRIGGER billing_product_resolutions_append_only`,
		`ALTER TABLE billing_validation_attempts ENABLE TRIGGER billing_validation_attempts_append_only`,
		`ALTER TABLE billing_quarantine_actions ENABLE TRIGGER billing_quarantine_actions_append_only`,
		`ALTER TABLE billing_raw_inputs ENABLE TRIGGER billing_raw_inputs_append_only`,
		`ALTER TABLE store_server_credential_events ENABLE TRIGGER store_server_credential_events_no_change`,
		`ALTER TABLE billing_association_evidence ENABLE TRIGGER billing_association_evidence_append_only`,
		`ALTER TABLE subscription_snapshots ENABLE TRIGGER subscription_snapshots_append_only`,
		`ALTER TABLE subscription_snapshot_facts ENABLE TRIGGER subscription_snapshot_facts_append_only`,
		`ALTER TABLE subscription_timeline_entries ENABLE TRIGGER subscription_timeline_entries_append_only`,
		`ALTER TABLE projection_attempts ENABLE TRIGGER projection_attempts_append_only`,
		`ALTER TABLE customer_entitlement_snapshots ENABLE TRIGGER customer_entitlement_snapshots_append_only`,
		`ALTER TABLE customer_entitlement_snapshot_entries ENABLE TRIGGER customer_entitlement_snapshot_entries_append_only`,
		`ALTER TABLE entitlement_sources ENABLE TRIGGER entitlement_sources_append_only`,
		`ALTER TABLE webhook_events ENABLE TRIGGER webhook_events_append_only`,
		`ALTER TABLE webhook_delivery_attempts ENABLE TRIGGER webhook_delivery_attempts_append_only`,
		`ALTER TABLE product_entitlement_grant_versions ENABLE TRIGGER product_entitlement_grant_versions_append_only`,
		`ALTER TABLE restore_sync_job_inputs ENABLE TRIGGER restore_sync_job_inputs_append_only`,
		`ALTER TABLE customer_access_tokens ENABLE TRIGGER customer_access_tokens_preserve_revocation`,
	}
	for _, statement := range disable {
		_, _ = pool.Exec(ctx, statement)
	}
	for _, statement := range deletes {
		if _, err := pool.Exec(ctx, statement.query, statement.arg); err != nil {
			return fmt.Errorf("reset 9b: %s: %w", statement.query, err)
		}
	}
	for _, statement := range enable {
		_, _ = pool.Exec(ctx, statement)
	}
	return nil
}
