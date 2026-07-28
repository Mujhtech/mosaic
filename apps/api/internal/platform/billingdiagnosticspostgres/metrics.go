package billingdiagnosticspostgres

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const metricTimeout = 5 * time.Second

// phase9BTables are the tables whose row counts are published from day one.
//
// Plan §15 decided snapshot retention without a drill baseline to extrapolate
// from, because Phase 8 drills 4 and 5 were never run and nothing is
// partitioned. The mitigation recorded there is this: publish per-table row
// counts from the first deployment so the first post-9B drill has a trend
// rather than a single reading. Adding the metric after growth becomes a
// problem is exactly the mistake provider_sync_jobs already made once.
//
// The list is explicit rather than derived from the catalog so a table added
// later is a deliberate decision to observe it, and so this gauge can never
// start reporting a table that holds something it should not.
var phase9BTables = []string{
	"billing_customers",
	"billing_customer_aliases",
	"billing_association_evidence",
	"billing_identity_conflicts",
	"purchase_lineages",
	"subscription_instances",
	"one_time_purchase_instances",
	"subscription_snapshots",
	"subscription_snapshot_facts",
	"subscription_timeline_entries",
	"projection_checkpoints",
	"projection_rule_versions",
	"projection_jobs",
	"projection_attempts",
	"product_entitlement_grant_versions",
	"entitlement_sources",
	"customer_entitlement_snapshots",
	"customer_entitlement_snapshot_entries",
	"customer_entitlement_pointers",
	"customer_access_tokens",
	"webhook_destinations",
	"webhook_signing_secrets",
	"webhook_events",
	"webhook_deliveries",
	"webhook_delivery_attempts",
	"restore_sync_jobs",
	"restore_sync_job_inputs",
	"purchase_chain_digest_links",
}

// RegisterRowCountMetrics publishes an approximate row count per Phase 9B table.
//
// The counts come from the planner statistics (`pg_class.reltuples`) rather
// than from `count(*)`. An exact count of every table on every scrape is a
// sequential scan of the whole 9B schema on a fixed interval, which is a
// self-inflicted load problem on the largest tables — and the question this
// metric answers ("is this table growing in a way retention has to catch up
// with?") is a trend question that an estimate answers just as well.
func (r *Repository) RegisterRowCountMetrics() error {
	meter := otel.Meter("mosaic/billingdiagnostics")
	rows, err := meter.Int64ObservableGauge("mosaic.billing.table.rows",
		metric.WithDescription("Approximate row count of a Mosaic Billing table, from planner statistics."))
	if err != nil {
		return fmt.Errorf("register billing table row gauge: %w", err)
	}

	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, metricTimeout)
		defer cancel()
		result, err := r.pool.Query(ctx,
			`SELECT relname, GREATEST(reltuples, 0)::bigint
			 FROM pg_class
			 WHERE relkind = 'r' AND relname = ANY($1)`, phase9BTables)
		if err != nil {
			// A metric scrape must never surface as an error the collector
			// retries in a tight loop; the next scrape will try again.
			return nil
		}
		defer result.Close()
		for result.Next() {
			var table string
			var count int64
			if err := result.Scan(&table, &count); err != nil {
				continue
			}
			observer.ObserveInt64(rows, count, metric.WithAttributes(
				attribute.String("phase", "9b"),
				attribute.String("table", table)))
		}
		return nil
	}, rows)
	if err != nil {
		return fmt.Errorf("register billing table row metric callback: %w", err)
	}
	return nil
}
