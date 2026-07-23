package browserauth

import "time"

const SessionCookieName = "mosaic_session"

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type UserRecord struct {
	User
	PasswordHash string
}

type Session struct {
	ID              string
	UserID          string
	TokenDigest     []byte
	AuthenticatedAt time.Time
	ExpiresAt       time.Time
	LastSeenAt      time.Time
	RevokedAt       *time.Time
	CreatedAt       time.Time
}

type SessionPrincipal struct {
	User            User
	SessionID       string
	AuthenticatedAt time.Time
}

type SignInResult struct {
	User      User
	Token     string
	ExpiresAt time.Time
}
