package billingpostgres

import (
	"context"
	"fmt"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

// Phase 9A introduced two new envelope-bearing tables. Both must be reachable
// by `keyring rotate`, because a key that still seals rows cannot be removed
// from the keyring, and an operator who removes it anyway makes those rows
// permanently undecryptable. The functions below give the rotation command the
// same three operations it already has for Provider Connection credentials:
// count by key, page rows not under the active key, and reseal a batch
// atomically.

// BillingEnvelope is one resealable row. It carries the subject scope rather
// than a connection id, because Phase 9A envelopes are bound to a (kind, id)
// subject under the v2 additional-data domain.
type BillingEnvelope struct {
	Table           string
	RowID           string
	OrganizationID  string
	ProjectID       string
	SubjectKind     string
	CredentialClass string
	Version         int
	Algorithm       string
	KeyID           string
	Nonce           []byte
	Ciphertext      []byte
	Fingerprint     []byte
}

// Scope rebuilds the additional-data scope this envelope was sealed under.
func (e BillingEnvelope) Scope() providercredential.SubjectScope {
	return providercredential.SubjectScope{
		OrganizationID:  e.OrganizationID,
		ProjectID:       e.ProjectID,
		SubjectKind:     e.SubjectKind,
		SubjectID:       e.RowID,
		CredentialClass: e.CredentialClass,
	}
}

// EnvelopeCountsByKeyID reports how many Phase 9A envelopes each key seals,
// across both tables. It never returns key material or ciphertext.
func (r *Repository) EnvelopeCountsByKeyID(ctx context.Context) (map[string]int64, error) {
	counts := make(map[string]int64)
	rows, err := r.pool.Query(ctx,
		`SELECT key_id, count(*) FROM store_server_credentials WHERE revoked_at IS NULL GROUP BY key_id
		 UNION ALL
		 SELECT key_id, count(*) FROM billing_raw_inputs WHERE body_state = 'stored' AND key_id IS NOT NULL GROUP BY key_id`)
	if err != nil {
		return nil, fmt.Errorf("count billing envelopes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var keyID string
		var count int64
		if err := rows.Scan(&keyID, &count); err != nil {
			return nil, fmt.Errorf("scan billing envelope count: %w", err)
		}
		counts[keyID] += count
	}
	return counts, rows.Err()
}

// EnvelopesNotUnderKey pages envelopes sealed under a retired key, ordered
// stably so an interrupted rotation resumes deterministically.
//
// Credentials are returned before raw-input bodies. A credential that cannot be
// decrypted stops ingestion for a whole tenant, while an unrotatable body only
// affects replay of one input, so credentials are the ones worth resealing
// first when a rotation is interrupted.
func (r *Repository) EnvelopesNotUnderKey(ctx context.Context, keyID string, limit int) ([]BillingEnvelope, error) {
	if limit <= 0 {
		limit = 100
	}
	envelopes := make([]BillingEnvelope, 0, limit)

	rows, err := r.pool.Query(ctx,
		`SELECT id, organization_id, project_id, credential_class, envelope_version, algorithm, key_id,
		        nonce, ciphertext, fingerprint
		 FROM store_server_credentials
		 WHERE key_id <> $1 AND revoked_at IS NULL ORDER BY id LIMIT $2`, keyID, limit)
	if err != nil {
		return nil, fmt.Errorf("read credential envelopes: %w", err)
	}
	for rows.Next() {
		envelope := BillingEnvelope{Table: "store_server_credentials", SubjectKind: providercredential.SubjectStoreServerCredential}
		if err := rows.Scan(&envelope.RowID, &envelope.OrganizationID, &envelope.ProjectID,
			&envelope.CredentialClass, &envelope.Version, &envelope.Algorithm, &envelope.KeyID,
			&envelope.Nonce, &envelope.Ciphertext, &envelope.Fingerprint); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan credential envelope: %w", err)
		}
		envelopes = append(envelopes, envelope)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read credential envelopes: %w", err)
	}
	if len(envelopes) >= limit {
		return envelopes, nil
	}

	remaining := limit - len(envelopes)
	bodyRows, err := r.pool.Query(ctx,
		`SELECT id, organization_id, project_id, envelope_version, algorithm, key_id, nonce, ciphertext, fingerprint
		 FROM billing_raw_inputs
		 WHERE key_id IS NOT NULL AND key_id <> $1 AND body_state = 'stored'
		 ORDER BY id LIMIT $2`, keyID, remaining)
	if err != nil {
		return nil, fmt.Errorf("read raw input envelopes: %w", err)
	}
	defer bodyRows.Close()
	for bodyRows.Next() {
		envelope := BillingEnvelope{
			Table: "billing_raw_inputs", SubjectKind: providercredential.SubjectBillingRawInput,
			CredentialClass: "billingRawPayload",
		}
		if err := bodyRows.Scan(&envelope.RowID, &envelope.OrganizationID, &envelope.ProjectID,
			&envelope.Version, &envelope.Algorithm, &envelope.KeyID, &envelope.Nonce,
			&envelope.Ciphertext, &envelope.Fingerprint); err != nil {
			return nil, fmt.Errorf("scan raw input envelope: %w", err)
		}
		envelopes = append(envelopes, envelope)
	}
	return envelopes, bodyRows.Err()
}

// ReplaceEnvelopes rewrites a batch in one transaction, so an interrupted
// rotation never leaves a row with a half-written envelope.
//
// The raw-input UPDATE only touches envelope columns, which is exactly what the
// append-only trigger on that table permits; any other column in the statement
// would raise 55000 and abort the batch.
func (r *Repository) ReplaceEnvelopes(ctx context.Context, envelopes []BillingEnvelope, now time.Time) error {
	if len(envelopes) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin billing envelope rotation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, envelope := range envelopes {
		var statement string
		switch envelope.Table {
		case "store_server_credentials":
			statement = `UPDATE store_server_credentials
				SET envelope_version=$2, algorithm=$3, key_id=$4, nonce=$5, ciphertext=$6,
				    fingerprint=$7, updated_at=$8
				WHERE id=$1`
		case "billing_raw_inputs":
			statement = `UPDATE billing_raw_inputs
				SET envelope_version=$2, algorithm=$3, key_id=$4, nonce=$5, ciphertext=$6,
				    fingerprint=$7, envelope_rotated_at=$8
				WHERE id=$1`
		default:
			return fmt.Errorf("unsupported billing envelope table %q", envelope.Table)
		}
		tag, err := tx.Exec(ctx, statement, envelope.RowID, envelope.Version, envelope.Algorithm,
			envelope.KeyID, envelope.Nonce, envelope.Ciphertext, envelope.Fingerprint, now)
		if err != nil {
			return fmt.Errorf("rewrite billing envelope: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("billing envelope %s/%s disappeared during rotation", envelope.Table, envelope.RowID)
		}
	}
	return tx.Commit(ctx)
}
