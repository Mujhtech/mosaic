package billingaccesspostgres

import (
	"context"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/billingpostgres"
)

// KeyAuthenticator adapts the ingestion repository's API-key authentication to
// the access package's port.
//
// The adapter exists so the access service depends on an interface it declares
// rather than on the ingestion service. There is exactly one implementation of
// key authentication in Mosaic — prefix lookup then constant-time digest
// comparison — and a second one would eventually disagree with the first about
// which keys are valid.
type KeyAuthenticator struct {
	repository *billingpostgres.Repository
}

func NewKeyAuthenticator(repository *billingpostgres.Repository) KeyAuthenticator {
	return KeyAuthenticator{repository: repository}
}

var _ billingaccess.KeyAuthenticator = KeyAuthenticator{}

// AuthenticateServerKey resolves a secret server key. This is the second
// consumer of that authentication, after trusted-server observations.
func (k KeyAuthenticator) AuthenticateServerKey(ctx context.Context, raw string) (billingaccess.KeyScope, error) {
	scope, err := k.repository.AuthenticateServerKey(ctx, raw)
	if err != nil {
		return billingaccess.KeyScope{}, billingaccess.ErrUnauthenticated
	}
	return billingaccess.KeyScope{
		APIKeyID:        scope.APIKeyID,
		OrganizationID:  scope.OrganizationID,
		ProjectID:       scope.ProjectID,
		EnvironmentID:   scope.EnvironmentID,
		EnvironmentMode: scope.EnvironmentMode,
		ApplicationID:   scope.ApplicationID,
		Platform:        scope.Platform,
	}, nil
}

// AuthenticateSDKKey resolves a public SDK key. It proves which Environment and
// Application are calling and nothing else — selecting a customer is the
// Customer Access Token's job, and a public key can never do it.
func (k KeyAuthenticator) AuthenticateSDKKey(ctx context.Context, raw string) (billingaccess.KeyScope, error) {
	scope, err := k.repository.AuthenticateSDKKey(ctx, raw)
	if err != nil {
		return billingaccess.KeyScope{}, billingaccess.ErrUnauthenticated
	}
	return billingaccess.KeyScope{
		APIKeyID:        scope.APIKeyID,
		OrganizationID:  scope.OrganizationID,
		ProjectID:       scope.ProjectID,
		EnvironmentID:   scope.EnvironmentID,
		EnvironmentMode: scope.EnvironmentMode,
		ApplicationID:   scope.ApplicationID,
		Platform:        scope.Platform,
	}, nil
}
