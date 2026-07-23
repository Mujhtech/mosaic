package authn

import (
	"errors"
	"net/http"

	"github.com/Mujhtech/mosaic/apps/api/internal/browserauth"
)

type BrowserSessionResolver struct{ service *browserauth.Service }

func NewBrowserSessionResolver(service *browserauth.Service) BrowserSessionResolver {
	return BrowserSessionResolver{service: service}
}

func (resolver BrowserSessionResolver) Resolve(r *http.Request) (Principal, error) {
	cookie, err := r.Cookie(browserauth.SessionCookieName)
	if err != nil {
		return Principal{}, ErrUnauthenticated
	}
	principal, err := resolver.service.Authenticate(r.Context(), cookie.Value)
	if errors.Is(err, browserauth.ErrUnauthenticated) {
		return Principal{}, ErrUnauthenticated
	}
	if err != nil {
		return Principal{}, err
	}
	return Principal{ActorID: principal.User.ID, Method: "browser_session", AuthenticatedAt: principal.AuthenticatedAt}, nil
}

var _ Resolver = BrowserSessionResolver{}
