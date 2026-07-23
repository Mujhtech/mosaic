package browserauthpostgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
)

type Repository struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) CreateUserAndSession(ctx context.Context, user browserauth.UserRecord, session browserauth.Session) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin browser signup: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `INSERT INTO users(id,email,name,password_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`, user.ID, user.Email, user.Name, user.PasswordHash, user.CreatedAt); err != nil {
		return persistenceError(err)
	}
	if err := insertSession(ctx, tx, session); err != nil {
		return persistenceError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return persistenceError(err)
	}
	return nil
}

func (r *Repository) UserByEmail(ctx context.Context, email string) (browserauth.UserRecord, bool, error) {
	var value browserauth.UserRecord
	err := r.pool.QueryRow(ctx, `SELECT id,email,name,password_hash,created_at FROM users WHERE lower(email)=lower($1)`, email).Scan(&value.ID, &value.Email, &value.Name, &value.PasswordHash, &value.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return value, false, nil
	}
	if err != nil {
		return value, false, fmt.Errorf("read browser user: %w", err)
	}
	return value, true, nil
}

func insertSession(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, value browserauth.Session) error {
	_, err := q.Exec(ctx, `INSERT INTO browser_sessions(id,user_id,token_digest,authenticated_at,expires_at,last_seen_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, value.ID, value.UserID, value.TokenDigest, value.AuthenticatedAt, value.ExpiresAt, value.LastSeenAt, value.CreatedAt)
	return err
}

func (r *Repository) CreateSession(ctx context.Context, value browserauth.Session) error {
	return persistenceError(insertSession(ctx, r.pool, value))
}

func (r *Repository) SessionPrincipal(ctx context.Context, digest []byte) (browserauth.SessionPrincipal, bool, error) {
	var value browserauth.SessionPrincipal
	err := r.pool.QueryRow(ctx, `SELECT u.id,u.email,u.name,u.created_at,s.id,s.authenticated_at FROM browser_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, digest).Scan(&value.User.ID, &value.User.Email, &value.User.Name, &value.User.CreatedAt, &value.SessionID, &value.AuthenticatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return value, false, nil
	}
	if err != nil {
		return value, false, fmt.Errorf("resolve browser session: %w", err)
	}
	return value, true, nil
}

func (r *Repository) RevokeSession(ctx context.Context, digest []byte) error {
	command, err := r.pool.Exec(ctx, `UPDATE browser_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE token_digest=$1`, digest)
	if err != nil {
		return fmt.Errorf("revoke browser session: %w", err)
	}
	if command.RowsAffected() == 0 {
		return browserauth.ErrInvalidSession
	}
	return nil
}

func persistenceError(err error) error {
	if err == nil {
		return nil
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return browserauth.ErrEmailInUse
	}
	return fmt.Errorf("%w: %v", browserauth.ErrPersistence, err)
}

var _ browserauth.Repository = (*Repository)(nil)
