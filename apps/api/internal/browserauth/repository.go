package browserauth

import "context"

type Repository interface {
	CreateUserAndSession(context.Context, UserRecord, Session) error
	UserByEmail(context.Context, string) (UserRecord, bool, error)
	CreateSession(context.Context, Session) error
	SessionPrincipal(context.Context, []byte) (SessionPrincipal, bool, error)
	RevokeSession(context.Context, []byte) error
}
