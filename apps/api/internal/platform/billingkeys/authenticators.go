// Package billingkeys bridges Mosaic's single API-key authentication into the
// key ports the Phase 9B billing modules declare.
//
// Each 9B module declares its own narrow authenticator port rather than
// importing a sibling module's, which is what keeps identity from depending on
// access and access from depending on restore. The cost of that is a small
// amount of translation at the composition root, and this package is where it
// lives — in one place, so there is exactly one implementation of "is this key
// valid?" behind every one of those ports. A second implementation would
// eventually disagree with the first about which keys are valid, and the
// disagreement would be a tenant boundary.
//
// Nothing here decides anything. It authenticates and copies a scope; every
// authorization decision belongs to the service that received it.
package billingkeys

import (
	"context"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingrestore"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
)

// Authenticator wraps the ingestion repository, which owns the one prefix
// lookup and constant-time digest comparison Mosaic performs on an API key.
type Authenticator struct {
	repository *billingpostgres.Repository
}

func New(repository *billingpostgres.Repository) Authenticator {
	return Authenticator{repository: repository}
}

// Identity adapts the authenticator to the billing-identity port.
//
// Only the secret server key is exposed. The identity module has no public-key
// path at all: an application-user alias is assertable only by the customer's
// own backend, so an authenticator that could resolve a public SDK key would be
// an impersonate-anyone vulnerability regardless of what the handler in front
// of it checked.
func (a Authenticator) Identity() billingcustomer.ServerKeyAuthenticator {
	return billingcustomer.ServerKeyAuthenticatorFunc(
		func(ctx context.Context, raw string) (billingcustomer.KeyScope, error) {
			scope, err := a.repository.AuthenticateServerKey(ctx, raw)
			if err != nil {
				return billingcustomer.KeyScope{}, billingcustomer.ErrUnauthenticated
			}
			return billingcustomer.KeyScope{
				APIKeyID:        scope.APIKeyID,
				OrganizationID:  scope.OrganizationID,
				ProjectID:       scope.ProjectID,
				EnvironmentID:   scope.EnvironmentID,
				EnvironmentMode: scope.EnvironmentMode,
				ApplicationID:   scope.ApplicationID,
			}, nil
		})
}

// Restore adapts the authenticator to the restore port, which needs both key
// classes: a restore may be requested by an application backend or by an SDK,
// and in neither case does the key select a customer — identity is resolved
// server-side from validated store lineage.
func (a Authenticator) Restore() billingrestore.KeyAuthenticator { return restoreKeys(a) }

type restoreKeys Authenticator

var _ billingrestore.KeyAuthenticator = restoreKeys{}

func (k restoreKeys) AuthenticateServerKey(ctx context.Context, raw string) (billingrestore.KeyScope, error) {
	scope, err := k.repository.AuthenticateServerKey(ctx, raw)
	if err != nil {
		return billingrestore.KeyScope{}, billingrestore.ErrUnauthenticated
	}
	return restoreScope(scope), nil
}

func (k restoreKeys) AuthenticateSDKKey(ctx context.Context, raw string) (billingrestore.KeyScope, error) {
	scope, err := k.repository.AuthenticateSDKKey(ctx, raw)
	if err != nil {
		return billingrestore.KeyScope{}, billingrestore.ErrUnauthenticated
	}
	return restoreScope(scope), nil
}

func restoreScope(scope billing.ObservationScope) billingrestore.KeyScope {
	return billingrestore.KeyScope{
		APIKeyID:        scope.APIKeyID,
		OrganizationID:  scope.OrganizationID,
		ProjectID:       scope.ProjectID,
		EnvironmentID:   scope.EnvironmentID,
		EnvironmentMode: scope.EnvironmentMode,
		ApplicationID:   scope.ApplicationID,
	}
}
