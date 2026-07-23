package browserauth

import "errors"

var (
	ErrEmailInUse      = errors.New("email is already registered")
	ErrInvalidLogin    = errors.New("email or password is invalid")
	ErrUnauthenticated = errors.New("browser session is unauthenticated")
	ErrInvalidSession  = errors.New("browser session is invalid")
	ErrPersistence     = errors.New("browser authentication persistence failed")
)
