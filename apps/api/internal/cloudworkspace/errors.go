package cloudworkspace

import "errors"

var (
	ErrUnauthenticated    = errors.New("unauthenticated")
	ErrForbidden          = errors.New("forbidden")
	ErrNotFound           = errors.New("not found")
	ErrConflict           = errors.New("conflict")
	ErrLastOwner          = errors.New("last owner")
	ErrResourceArchived   = errors.New("resource archived")
	ErrProductReferenced  = errors.New("product referenced")
	ErrReplacementInvalid = errors.New("replacement invalid")
	ErrKeyRevoked         = errors.New("key revoked")
	ErrSecretUnavailable  = errors.New("secret unavailable")
	ErrInvalidCursor      = errors.New("invalid cursor")
)

type ConflictError struct {
	Resource string
	Field    string
}

func (e *ConflictError) Error() string { return e.Resource + " conflicts on " + e.Field }
func (e *ConflictError) Unwrap() error { return ErrConflict }
