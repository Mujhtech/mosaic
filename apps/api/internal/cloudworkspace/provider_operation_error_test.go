package cloudworkspace

import (
	"errors"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
)

// A cross-tenant POST /v1/provider-connections/{id}/test answered "the provider
// is temporarily unavailable" because every failure from the credential and
// scope lookup was rewritten into a provider error code. The authorization
// decision was therefore invisible: an unauthorized attempt looked like an
// outage, and an operator missing a permission had no way to learn that. Only a
// real provider-adapter failure may become a provider code.
func TestProviderOperationErrorPreservesAuthorizationDecisions(t *testing.T) {
	for name, sentinel := range map[string]error{
		"forbidden":       ErrForbidden,
		"not found":       ErrNotFound,
		"unauthenticated": ErrUnauthenticated,
		"feature off":     ErrProviderFeatureDisabled,
	} {
		t.Run(name, func(t *testing.T) {
			if got := providerOperationError(sentinel); !errors.Is(got, sentinel) {
				t.Fatalf("providerOperationError(%v) = %v, want the original decision", sentinel, got)
			}
			if errors.Is(providerOperationError(sentinel), ErrProviderUnavailable) &&
				!errors.Is(sentinel, ErrProviderUnavailable) {
				t.Fatal("an authorization decision was masked as a provider outage")
			}
		})
	}

	// A genuine adapter failure must still become a provider error code so the
	// caller learns the upstream is at fault and may retry.
	adapterFailure := &providercatalog.Error{Code: providercatalog.ErrorRateLimited, Retryable: true}
	if got := providerOperationError(adapterFailure); !errors.Is(got, ErrProviderRateLimited) {
		t.Fatalf("adapter failure = %v, want ErrProviderRateLimited", got)
	}
}
