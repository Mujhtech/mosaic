package billingcustomer

import (
	"context"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// KeyScope is the tenant a secret server key authenticates into. It mirrors the
// scope the access surfaces already resolve; identity deliberately declares its
// own port rather than importing the access module, because access is expected
// to depend on identity and not the other way around.
type KeyScope struct {
	APIKeyID        string
	OrganizationID  string
	ProjectID       string
	EnvironmentID   string
	EnvironmentMode string
	ApplicationID   string
}

// ServerKeyAuthenticator resolves a secret server key into a tenant.
//
// Only a secret server key is accepted anywhere in this package. There is
// deliberately no public-SDK-key authenticator here: an application-user alias
// is assertable only by the customer's own backend, so a surface that could
// accept a public key would be an impersonate-anyone vulnerability regardless
// of what the handler in front of it checked (plan §5a security corollaries).
type ServerKeyAuthenticator interface {
	AuthenticateServerKey(ctx context.Context, raw string) (KeyScope, error)
}

// ServerKeyAuthenticatorFunc adapts a function into the port. It exists so the
// composition root can bridge an existing key authenticator in one line without
// either module depending on the other.
type ServerKeyAuthenticatorFunc func(ctx context.Context, raw string) (KeyScope, error)

func (f ServerKeyAuthenticatorFunc) AuthenticateServerKey(ctx context.Context, raw string) (KeyScope, error) {
	return f(ctx, raw)
}

// Reprojector schedules recomputation of a customer's committed entitlement
// aggregate.
//
// Identity owns *who* a purchase belongs to; the moment that answer changes,
// the previously computed aggregate is stale and keeps granting whatever it
// last decided. Identity therefore has to be able to say "recompute that", and
// this narrow port is the whole of that dependency: it cannot read, project, or
// commit anything.
type Reprojector interface {
	Enqueue(ctx context.Context, scope billingprojection.Scope, kind string) error
}
