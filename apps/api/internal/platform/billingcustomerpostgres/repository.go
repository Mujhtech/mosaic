// Package billingcustomerpostgres is the PostgreSQL implementation of the
// billing-identity persistence port (plan §5, §5a; OD-3, OD-4, OD-7, OD-10).
//
// Three rules run through every statement in this package.
//
// Authorization is expressed in SQL next to the data it protects, exactly as
// billingpostgres does, so no read can reach another tenant by forgetting a
// check in Go. Absent membership is reported as ErrNotFound rather than
// ErrForbidden: answering "this Project exists but is not yours" is an
// existence oracle over the tenant list.
//
// The database is the arbiter of every identity uniqueness rule. A second live
// resolution for one alias digest, and a second open conflict for one disputed
// subject, are rejected by partial unique indexes rather than by a pre-check in
// Go that a concurrent request can lose.
//
// No alias value and no alias digest is ever logged or returned on an operator
// surface. An alias digest is still a stable per-person identifier, so exposing
// it would let one tenant's export be joined against another's. Digests are
// read only where the resolver itself consumes them.
package billingcustomerpostgres

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// Repository is the PostgreSQL billing-identity repository.
type Repository struct {
	pool *pgxpool.Pool
}

// New builds the repository over an existing pool. The pool is the composition
// root's, so the repository owns no connection lifecycle of its own.
func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingcustomer.Repository = (*Repository)(nil)

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// trustedActorPrefix is how billingcustomer's trusted-server surface renders a
// secret server key as an actor (see trusted.go's trustedActor).
const trustedActorPrefix = "apikey:"

// requireRole enforces the tenant boundary for one operator-facing read or
// write, in SQL, and returns the owning organization.
//
// Two principal shapes reach identity, and both are checked against the
// database rather than trusted from the caller:
//
//   - A human operator, identified by an actor id, must be a member of the
//     Project's organization with the owner or admin role. Billing is not a
//     member-level surface: identity conflicts decide who is granted a paid
//     entitlement, which is the same authority level the 9A credential and
//     ledger surfaces already require.
//   - A trusted server principal, rendered by the identity service as
//     "apikey:<id>", must present a secret server key that still resolves into
//     this very Project and has not been revoked. Without this branch every
//     trusted-server surface (alias listing, conflict detail, manual sync)
//     would fail closed, because an API key is deliberately not an
//     organization member.
//
// Every absent-authorization path returns ErrNotFound. ErrForbidden is reserved
// for a principal that is demonstrably inside the tenant but holds too low a
// role, which tells the caller nothing it did not already know.
func requireRole(ctx context.Context, q queryer, actor billingcustomer.Actor, projectID string, roles ...string) (string, error) {
	actorID := strings.TrimSpace(actor.ID)
	if actorID == "" || strings.TrimSpace(projectID) == "" {
		return "", billingcustomer.ErrUnauthenticated
	}

	if keyID, found := strings.CutPrefix(actorID, trustedActorPrefix); found {
		var organizationID string
		err := q.QueryRow(ctx,
			`SELECT p.organization_id
			 FROM api_keys k
			 JOIN environments e ON e.id = k.environment_id
			 JOIN projects p ON p.id = e.project_id
			 WHERE k.id = $1 AND p.id = $2 AND k.kind = 'secret_server' AND k.revoked_at IS NULL`,
			keyID, projectID).Scan(&organizationID)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", billingcustomer.ErrNotFound
		}
		if err != nil {
			return "", fmt.Errorf("resolve billing identity key scope: %w", err)
		}
		return organizationID, nil
	}

	var role, organizationID string
	err := q.QueryRow(ctx,
		`SELECT m.role, p.organization_id FROM projects p
		 JOIN organization_members m ON m.organization_id = p.organization_id
		 WHERE p.id = $1 AND m.actor_id = $2`, projectID, actorID).Scan(&role, &organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", billingcustomer.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("resolve billing identity role: %w", err)
	}
	for _, allowed := range roles {
		if role == allowed {
			return organizationID, nil
		}
	}
	return "", billingcustomer.ErrForbidden
}

// operatorRoles is the single place the identity role set is stated.
var operatorRoles = []string{"owner", "admin"}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// BillingEnabled reports the Project's opt-in. An absent row means never
// configured, which is off: Mosaic Billing is opt-in and the identity service
// fails closed on top of this.
func (r *Repository) BillingEnabled(ctx context.Context, projectID string) (bool, error) {
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT billing_enabled FROM billing_project_settings WHERE project_id = $1`, projectID).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read billing settings: %w", err)
	}
	return enabled, nil
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const customerColumns = `id, project_id, status, current_projection_version, last_projected_at,
	diagnostics_status, created_at, updated_at`

func scanCustomer(row pgx.Row) (billingcustomer.Customer, error) {
	var customer billingcustomer.Customer
	err := row.Scan(&customer.ID, &customer.ProjectID, &customer.Status,
		&customer.CurrentProjectionVersion, &customer.LastProjectedAt, &customer.DiagnosticsStatus,
		&customer.CreatedAt, &customer.UpdatedAt)
	return customer, err
}

// CreateCustomer inserts a customer. It performs no authorization: it is
// reachable only from the two lazy-creation paths of plan §5a, both of which
// established the tenant before calling — a trusted server key, or a validated
// fact whose Project came from the credential that ingested it.
func (r *Repository) CreateCustomer(ctx context.Context, customer billingcustomer.Customer) (billingcustomer.Customer, error) {
	if customer.Status == "" {
		customer.Status = billingcustomer.StatusActive
	}
	if customer.DiagnosticsStatus == "" {
		customer.DiagnosticsStatus = "none"
	}
	created, err := scanCustomer(r.pool.QueryRow(ctx,
		`INSERT INTO billing_customers(id, project_id, status, diagnostics_status, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING `+customerColumns,
		customer.ID, customer.ProjectID, customer.Status, customer.DiagnosticsStatus,
		customer.CreatedAt, customer.UpdatedAt))
	if err != nil {
		if isUniqueViolation(err) {
			return billingcustomer.Customer{}, billingcustomer.ErrConflict
		}
		return billingcustomer.Customer{}, fmt.Errorf("insert billing customer: %w", err)
	}
	return created, nil
}

func (r *Repository) Customer(ctx context.Context, actor billingcustomer.Actor, projectID, customerID string) (billingcustomer.Customer, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return billingcustomer.Customer{}, err
	}
	customer, err := scanCustomer(r.pool.QueryRow(ctx,
		`SELECT `+customerColumns+` FROM billing_customers WHERE id=$1 AND project_id=$2`,
		customerID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingcustomer.Customer{}, billingcustomer.ErrNotFound
	}
	if err != nil {
		return billingcustomer.Customer{}, fmt.Errorf("read billing customer: %w", err)
	}
	return customer, nil
}

// CustomerForAlias resolves the customer an alias currently points at.
//
// It takes no actor because it is an internal resolution step, not an operator
// read: the caller supplies a digest it computed from a value it was already
// authorized to assert, and the Project is part of the predicate so a digest
// from one tenant cannot select another's customer.
func (r *Repository) CustomerForAlias(ctx context.Context, projectID, aliasType string, digest []byte) (billingcustomer.Customer, error) {
	customer, err := scanCustomer(r.pool.QueryRow(ctx,
		`SELECT `+prefixed("c", customerColumns)+`
		 FROM billing_customer_aliases a
		 JOIN billing_customers c ON c.id = a.billing_customer_id AND c.project_id = a.project_id
		 WHERE a.project_id=$1 AND a.alias_type=$2 AND a.alias_digest=$3 AND a.effective_end IS NULL`,
		projectID, aliasType, digest))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingcustomer.Customer{}, billingcustomer.ErrNotFound
	}
	if err != nil {
		return billingcustomer.Customer{}, fmt.Errorf("resolve customer for alias: %w", err)
	}
	return customer, nil
}

// ListCustomers pages a Project's customers newest first.
//
// The ordering is (created_at DESC, id ASC), which is exactly
// `billing_customers_project_idx`, so paging is an index scan rather than a
// sort. The keyset predicate is written out rather than as a row comparison
// because the two halves sort in opposite directions and `(a,b) < (x,y)` cannot
// express that.
func (r *Repository) ListCustomers(ctx context.Context, actor billingcustomer.Actor, projectID string, limit int, cursor string) ([]billingcustomer.Customer, string, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return nil, "", err
	}
	limit = pageLimit(limit)
	position := decodeCursor(cursor)
	rows, err := r.pool.Query(ctx,
		`SELECT `+customerColumns+` FROM billing_customers
		 WHERE project_id=$1
		   AND ($2::timestamptz IS NULL
		        OR created_at < $2::timestamptz
		        OR (created_at = $2::timestamptz AND id > $3))
		 ORDER BY created_at DESC, id
		 LIMIT $4`, projectID, position.At, position.ID, limit+1)
	if err != nil {
		return nil, "", fmt.Errorf("list billing customers: %w", err)
	}
	defer rows.Close()
	customers := make([]billingcustomer.Customer, 0, limit)
	for rows.Next() {
		customer, err := scanCustomer(rows)
		if err != nil {
			return nil, "", fmt.Errorf("scan billing customer: %w", err)
		}
		customers = append(customers, customer)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("read billing customers: %w", err)
	}
	next := ""
	if len(customers) > limit {
		customers = customers[:limit]
		last := customers[limit-1]
		next = encodeCursor(last.CreatedAt, last.ID)
	}
	return customers, next, nil
}

// SetCustomerStatus moves a customer between active and frozen (and, for the
// erasure path, anonymized).
//
// The anonymized timestamp is written in the same statement as the status
// because migration 00030 declares them equivalent by CHECK: setting one
// without the other is a constraint violation, and setting them in two
// statements would leave a window where the row is unwritable.
func (r *Repository) SetCustomerStatus(ctx context.Context, projectID, customerID, status string, now time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_customers
		 SET status=$3,
		     anonymized_at = CASE WHEN $3 = 'anonymized' THEN COALESCE(anonymized_at, $4) ELSE NULL END,
		     updated_at=$4
		 WHERE id=$1 AND project_id=$2`, customerID, projectID, status, now)
	if err != nil {
		return fmt.Errorf("set billing customer status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billingcustomer.ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

// aliasColumns deliberately omits alias_digest. Nothing an operator or a
// trusted backend reads back needs it, and a column that is never selected
// cannot leak into a response or a log line.
const aliasColumns = `id, project_id, billing_customer_id, alias_type, source_authority,
	verification_status, effective_start, effective_end, created_at`

func scanAlias(row pgx.Row) (billingcustomer.Alias, error) {
	var alias billingcustomer.Alias
	err := row.Scan(&alias.ID, &alias.ProjectID, &alias.BillingCustomerID, &alias.AliasType,
		&alias.SourceAuthority, &alias.VerificationStatus, &alias.EffectiveStart,
		&alias.EffectiveEnd, &alias.CreatedAt)
	return alias, err
}

// AttachAlias records one alias.
//
// `billing_customer_aliases_active_resolution_idx` is a partial unique index
// over (project, alias type, digest) where the row is still live, so a second
// live resolution loses at the database. There is deliberately no "does this
// digest already resolve?" read before the insert: a check-then-act pair loses
// to a concurrent login, and losing means one person's purchases split across
// two customers.
func (r *Repository) AttachAlias(ctx context.Context, alias billingcustomer.Alias) (billingcustomer.Alias, error) {
	digest := alias.Digest()
	if len(digest) != sha256.Size {
		return billingcustomer.Alias{}, billingcustomer.ErrInvalidAlias
	}
	if alias.VerificationStatus == "" {
		alias.VerificationStatus = "asserted"
	}
	stored, err := scanAlias(r.pool.QueryRow(ctx,
		`INSERT INTO billing_customer_aliases(
			id, project_id, billing_customer_id, alias_type, alias_digest,
			source_authority, verification_status, effective_start, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING `+aliasColumns,
		alias.ID, alias.ProjectID, alias.BillingCustomerID, alias.AliasType, digest,
		alias.SourceAuthority, alias.VerificationStatus, alias.EffectiveStart, alias.CreatedAt))
	if err != nil {
		if isUniqueViolation(err) {
			return billingcustomer.Alias{}, billingcustomer.ErrConflict
		}
		if isForeignKeyViolation(err) {
			// The named customer does not exist inside this Project. Reported as
			// not-found rather than as a database error so the caller cannot use
			// the difference to probe another tenant's customer identifiers.
			return billingcustomer.Alias{}, billingcustomer.ErrNotFound
		}
		return billingcustomer.Alias{}, fmt.Errorf("attach billing customer alias: %w", err)
	}
	// The digest is carried back on the domain value, not on the JSON surface;
	// it is the caller's own input, so nothing new is disclosed.
	return stored.WithDigest(digest), nil
}

// RevokeAlias end-dates the live resolution. Nothing is deleted: the row stays
// so the history of who was linked when survives a sign-out.
func (r *Repository) RevokeAlias(ctx context.Context, actor billingcustomer.Actor, projectID, aliasID string, now time.Time) error {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE billing_customer_aliases
		 SET effective_end = GREATEST($3, effective_start), revoked_by_actor_id = NULLIF($4,'')
		 WHERE id=$1 AND project_id=$2 AND effective_end IS NULL`,
		aliasID, projectID, now, actor.ID)
	if err != nil {
		return fmt.Errorf("revoke billing customer alias: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return billingcustomer.ErrNotFound
	}
	return nil
}

func (r *Repository) ListAliases(ctx context.Context, actor billingcustomer.Actor, projectID, customerID string) ([]billingcustomer.Alias, error) {
	if _, err := requireRole(ctx, r.pool, actor, projectID, operatorRoles...); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+aliasColumns+` FROM billing_customer_aliases
		 WHERE project_id=$1 AND billing_customer_id=$2
		 ORDER BY effective_start DESC, id`, projectID, customerID)
	if err != nil {
		return nil, fmt.Errorf("list billing customer aliases: %w", err)
	}
	defer rows.Close()
	aliases := make([]billingcustomer.Alias, 0, 4)
	for rows.Next() {
		alias, err := scanAlias(rows)
		if err != nil {
			return nil, fmt.Errorf("scan billing customer alias: %w", err)
		}
		aliases = append(aliases, alias)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read billing customer aliases: %w", err)
	}
	return aliases, nil
}

// ActiveAliasResolutions is the lookup the pure resolver consumes.
//
// The map is keyed by `string(digest)` — the raw bytes, not a hex rendering —
// because that is exactly how `billingcustomer.Resolve` indexes it
// (`activeAliases[string(observation.Digest)]`). A hex or base64 key would
// silently resolve nothing and every purchase would look unidentified.
//
// The alias type is not part of the key: `AliasDigest` folds the type into the
// hash under its own domain separation, so two alias families cannot collide on
// one digest.
func (r *Repository) ActiveAliasResolutions(ctx context.Context, projectID string, digests [][]byte) (map[string]string, error) {
	resolutions := make(map[string]string, len(digests))
	if len(digests) == 0 {
		return resolutions, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT alias_digest, billing_customer_id FROM billing_customer_aliases
		 WHERE project_id=$1 AND effective_end IS NULL AND alias_digest = ANY($2::bytea[])`,
		projectID, digests)
	if err != nil {
		return nil, fmt.Errorf("read active alias resolutions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var digest []byte
		var customerID string
		if err := rows.Scan(&digest, &customerID); err != nil {
			return nil, fmt.Errorf("scan active alias resolution: %w", err)
		}
		resolutions[string(digest)] = customerID
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read active alias resolutions: %w", err)
	}
	return resolutions, nil
}

// ---------------------------------------------------------------------------
// Association evidence
// ---------------------------------------------------------------------------

const evidenceColumns = `id, project_id, COALESCE(environment_id,''), COALESCE(purchase_lineage_id,''),
	evidence_type, evidence_digest, COALESCE(raw_input_id,''), transaction_reference_digest,
	COALESCE(billing_customer_id,''), resolver_version, outcome, COALESCE(diagnostic_code,''),
	observed_at, created_at`

func scanEvidence(row pgx.Row) (billingcustomer.Evidence, error) {
	var evidence billingcustomer.Evidence
	err := row.Scan(&evidence.ID, &evidence.ProjectID, &evidence.EnvironmentID,
		&evidence.PurchaseLineageID, &evidence.EvidenceType, &evidence.EvidenceDigest,
		&evidence.RawInputID, &evidence.TransactionReferenceDigest, &evidence.BillingCustomerID,
		&evidence.ResolverVersion, &evidence.Outcome, &evidence.DiagnosticCode,
		&evidence.ObservedAt, &evidence.CreatedAt)
	return evidence, err
}

// RecordEvidence appends one observation. The table carries an append-only
// trigger, so this is the only way a row ever changes.
func (r *Repository) RecordEvidence(ctx context.Context, evidence billingcustomer.Evidence) error {
	if evidence.ResolverVersion <= 0 {
		evidence.ResolverVersion = billingcustomer.ResolverVersion
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO billing_association_evidence(
			id, project_id, environment_id, purchase_lineage_id, evidence_type, evidence_digest,
			raw_input_id, transaction_reference_digest, billing_customer_id, resolver_version,
			outcome, diagnostic_code, observed_at, created_at)
		 VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,NULLIF($7,''),$8,NULLIF($9,''),$10,
			$11,NULLIF($12,''),$13,$14)
		 ON CONFLICT (id) DO NOTHING`,
		evidence.ID, evidence.ProjectID, evidence.EnvironmentID, evidence.PurchaseLineageID,
		evidence.EvidenceType, nullBytes(evidence.EvidenceDigest), evidence.RawInputID,
		nullBytes(evidence.TransactionReferenceDigest), evidence.BillingCustomerID,
		evidence.ResolverVersion, evidence.Outcome, evidence.DiagnosticCode,
		evidence.ObservedAt, evidence.CreatedAt)
	if err != nil {
		return fmt.Errorf("record association evidence: %w", err)
	}
	return nil
}

// EvidenceForReference reads every observation recorded against one transaction
// reference digest, oldest first.
//
// Fact provenance is first-writer-wins and therefore not authoritative about
// which input asserted an association, which is why authority is reconstructed
// by scanning inputs here rather than by trusting a fact's own source input.
func (r *Repository) EvidenceForReference(ctx context.Context, projectID string, referenceDigest []byte) ([]billingcustomer.Evidence, error) {
	if len(referenceDigest) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+evidenceColumns+` FROM billing_association_evidence
		 WHERE project_id=$1 AND transaction_reference_digest=$2
		 ORDER BY observed_at, id`, projectID, referenceDigest)
	if err != nil {
		return nil, fmt.Errorf("read association evidence for reference: %w", err)
	}
	defer rows.Close()
	entries := make([]billingcustomer.Evidence, 0, 4)
	for rows.Next() {
		evidence, err := scanEvidence(rows)
		if err != nil {
			return nil, fmt.Errorf("scan association evidence: %w", err)
		}
		entries = append(entries, evidence)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read association evidence: %w", err)
	}
	return entries, nil
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

// RecordAudit writes one identity action into the shared audit log, resolving
// the organization from the Project exactly as the projection repository's
// writeAudit does.
//
// The actor falls back to "system" because several identity paths are triggered
// by a validated fact rather than by a person, and `audit_events.actor_id` is
// NOT NULL. Metadata carries identifiers and enumerations only — never an alias
// value, a digest, or a correlator.
func (r *Repository) RecordAudit(ctx context.Context, actor billingcustomer.Actor, projectID, action, resourceType, resourceID string, metadata map[string]string, now time.Time) error {
	encoded := []byte("{}")
	if len(metadata) > 0 {
		if raw, err := json.Marshal(metadata); err == nil {
			encoded = raw
		}
	}
	var organizationID string
	if err := r.pool.QueryRow(ctx, `SELECT organization_id FROM projects WHERE id=$1`, projectID).
		Scan(&organizationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return billingcustomer.ErrNotFound
		}
		return fmt.Errorf("read organization for billing identity audit: %w", err)
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO audit_events(id, actor_id, organization_id, project_id, environment_id,
			action, resource_type, resource_id, metadata, created_at)
		 VALUES ($1,COALESCE(NULLIF($2,''),'system'),$3,$4,NULL,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO NOTHING`,
		"aud_"+hashID(resourceID, action, now.UnixNano()), actor.ID, organizationID, projectID,
		action, resourceType, resourceID, encoded, now)
	if err != nil {
		return fmt.Errorf("write billing identity audit event: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const (
	defaultPageLimit = 50
	maxPageLimit     = 100
)

func pageLimit(limit int) int {
	if limit <= 0 {
		return defaultPageLimit
	}
	if limit > maxPageLimit {
		return maxPageLimit
	}
	return limit
}

// listCursor is a keyset position: the ordering timestamp of the last row
// returned plus its id as the tie-break. Both halves are required — billing
// identifiers are sixteen random bytes and carry no time order, so a cursor
// holding only an id cannot express "after this row in timestamp order".
type listCursor struct {
	At *time.Time
	ID string
}

// encodeCursor renders a keyset position as one opaque token: base64url over
// "<unix-micros>:<id>", because it travels in a query string. Callers forward it
// unchanged and must never parse it.
//
// The resolution is microseconds, not the milliseconds billingpostgres uses.
// PostgreSQL stores timestamptz at microsecond precision, so a millisecond
// cursor is rounded *down* from the row it describes — and the tie-break half
// of the predicate then never matches, because the next row's `created_at`
// compares greater than the cursor it was derived from. The observable effect
// is a second page that silently omits every customer created in the same
// millisecond as the last one on page one, which on a lazily-created identity
// table is precisely the rows a bulk import produces.
func encodeCursor(at time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(strconv.FormatInt(at.UTC().UnixMicro(), 10) + ":" + id))
}

// decodeCursor parses an opaque cursor. A malformed value yields the zero
// cursor, which starts from the beginning: a caller that mangles a cursor gets
// the first page rather than a silently truncated list.
func decodeCursor(raw string) listCursor {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return listCursor{}
	}
	decoded, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return listCursor{}
	}
	millis, id, found := strings.Cut(string(decoded), ":")
	if !found || id == "" {
		return listCursor{}
	}
	value, err := strconv.ParseInt(millis, 10, 64)
	if err != nil {
		return listCursor{}
	}
	at := time.UnixMicro(value).UTC()
	return listCursor{At: &at, ID: id}
}

// prefixed qualifies a bare column list with a table alias, so one column
// constant can be reused in a join without being restated.
func prefixed(alias, columns string) string {
	parts := strings.Split(columns, ",")
	for index, part := range parts {
		parts[index] = alias + "." + strings.TrimSpace(part)
	}
	return strings.Join(parts, ", ")
}

func nullBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

// hashID derives a deterministic identifier so a retried write produces the
// same row id and the ON CONFLICT clauses stay meaningful.
func hashID(parts ...any) string {
	hasher := sha256.New()
	for _, part := range parts {
		// hash.Hash never reports a write error.
		_, _ = fmt.Fprintf(hasher, "%v\x00", part)
	}
	return fmt.Sprintf("%x", hasher.Sum(nil))[:24]
}

func isUniqueViolation(err error) bool { return hasSQLState(err, "23505") }

func isForeignKeyViolation(err error) bool { return hasSQLState(err, "23503") }

func hasSQLState(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
