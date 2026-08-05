package projectoverview

import "errors"

// Stable domain errors. Callers compare with errors.Is, never by message.
//
// There is deliberately no "one source failed" error here: a source failure is
// reported inside the payload as an unavailable metric, not as a failed
// request. The errors below are the only conditions that stop the endpoint
// from answering at all, and every one of them is about who is asking rather
// than about what could be read.
var (
	ErrUnauthenticated = errors.New("an actor is required")
	ErrForbidden       = errors.New("actor may not read this Project")
	// ErrNotFound covers both an unknown Project or Environment and an
	// Environment that belongs to a different Project. Distinguishing them
	// would turn this endpoint into an existence oracle over other tenants.
	ErrNotFound    = errors.New("project or environment not found")
	ErrUnavailable = errors.New("overview metrics are unavailable")
)
