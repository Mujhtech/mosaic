package analytics

import "errors"

var (
	ErrUnauthenticated        = errors.New("unauthenticated")
	ErrForbidden              = errors.New("forbidden")
	ErrNotFound               = errors.New("not found")
	ErrCollectionDisabled     = errors.New("analytics collection disabled")
	ErrInvalidBatch           = errors.New("invalid analytics batch")
	ErrRateLimited            = errors.New("analytics rate limited")
	ErrConflict               = errors.New("analytics conflict")
	ErrTemporarilyUnavailable = errors.New("analytics temporarily unavailable")
)
