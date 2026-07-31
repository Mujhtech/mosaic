package billingmigrationpostgres

import (
	"context"
	"fmt"
)

// SourceObjectEnvelopeCountsByKeyID reports the database inventory of retained,
// immutable migration source objects. Deleted objects keep their ledger
// metadata but no longer require ciphertext keys, so they are intentionally
// excluded. This operation never reads object keys, ciphertext, or customer
// data.
func (r *Repository) SourceObjectEnvelopeCountsByKeyID(ctx context.Context) (map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT key_id,count(*)
		FROM billing_migration_source_objects
		WHERE state='verified' AND key_id IS NOT NULL
		GROUP BY key_id`)
	if err != nil {
		return nil, fmt.Errorf("count migration source-object envelopes: %w", err)
	}
	defer rows.Close()
	counts := make(map[string]int64)
	for rows.Next() {
		var keyID string
		var count int64
		if err := rows.Scan(&keyID, &count); err != nil {
			return nil, fmt.Errorf("scan migration source-object envelope count: %w", err)
		}
		counts[keyID] = count
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read migration source-object envelope counts: %w", err)
	}
	return counts, nil
}
