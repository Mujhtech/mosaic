package cloudworkspacepostgres

import (
	"context"
	"fmt"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

const credentialColumns = `connection_id,project_id,organization_id,credential_class,envelope_version,algorithm,key_id,nonce,ciphertext,fingerprint,created_at,rotated_at,revoked_at,updated_at`

// CredentialCountsByKeyID reports how many provider-credential envelopes are
// sealed under each keyring key. It supports the keyring inspect command and
// never returns key material or ciphertext.
func (r *Repository) CredentialCountsByKeyID(ctx context.Context) (map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT key_id, count(*) FROM provider_connection_credentials GROUP BY key_id ORDER BY key_id`)
	if err != nil {
		return nil, fmt.Errorf("count credential envelopes: %w", err)
	}
	defer rows.Close()
	counts := make(map[string]int64)
	for rows.Next() {
		var keyID string
		var count int64
		if err := rows.Scan(&keyID, &count); err != nil {
			return nil, fmt.Errorf("scan credential envelope count: %w", err)
		}
		counts[keyID] = count
	}
	return counts, rows.Err()
}

// CredentialsNotUnderKey returns up to limit envelopes sealed under a key other
// than keyID, ordered stably so rotation can page deterministically.
func (r *Repository) CredentialsNotUnderKey(ctx context.Context, keyID string, limit int) ([]cloudworkspace.ProviderCredentialRecord, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+credentialColumns+` FROM provider_connection_credentials
		 WHERE key_id <> $1 AND revoked_at IS NULL ORDER BY connection_id LIMIT $2`, keyID, limit)
	if err != nil {
		return nil, fmt.Errorf("read credential envelopes: %w", err)
	}
	defer rows.Close()
	records := make([]cloudworkspace.ProviderCredentialRecord, 0, limit)
	for rows.Next() {
		record, err := scanProviderCredential(rows)
		if err != nil {
			return nil, fmt.Errorf("scan credential envelope: %w", err)
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

// ReplaceCredentialEnvelopes rewrites a batch of envelopes in one transaction.
// A batch either lands completely or not at all, so an interrupted rotation can
// be resumed without leaving a connection with a half-written envelope.
func (r *Repository) ReplaceCredentialEnvelopes(ctx context.Context, records []cloudworkspace.ProviderCredentialRecord, now time.Time) error {
	if len(records) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin credential rotation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, record := range records {
		tag, err := tx.Exec(ctx,
			`UPDATE provider_connection_credentials
			 SET envelope_version=$2,algorithm=$3,key_id=$4,nonce=$5,ciphertext=$6,fingerprint=$7,rotated_at=$8,updated_at=$8
			 WHERE connection_id=$1`,
			record.ConnectionID, record.Version, record.Algorithm, record.KeyID,
			record.Nonce, record.Ciphertext, record.Fingerprint, now)
		if err != nil {
			return fmt.Errorf("rewrite credential envelope: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("credential envelope for connection %s disappeared during rotation", record.ConnectionID)
		}
	}
	return tx.Commit(ctx)
}
