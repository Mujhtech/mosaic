// Package authn defines the provider-neutral HTTP authentication boundary.
package authn

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

var ErrUnauthenticated = errors.New("request is unauthenticated")

type Principal struct {
	ActorID         string
	Method          string
	AuthenticatedAt time.Time
}

func (p Principal) Authenticated() bool {
	return p.ActorID != ""
}

// Resolver is implemented by the eventually approved dashboard-session
// adapter. SDK and server API-key authenticators use distinct boundaries.
type Resolver interface {
	Resolve(*http.Request) (Principal, error)
}

type ResolverFunc func(*http.Request) (Principal, error)

func (resolve ResolverFunc) Resolve(r *http.Request) (Principal, error) {
	return resolve(r)
}

type AnonymousResolver struct{}

func (AnonymousResolver) Resolve(*http.Request) (Principal, error) {
	return Principal{}, ErrUnauthenticated
}

type contextKey struct{}

func Middleware(resolver Resolver) func(http.Handler) http.Handler {
	if resolver == nil {
		resolver = AnonymousResolver{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, err := resolver.Resolve(r)
			if err != nil && !errors.Is(err, ErrUnauthenticated) {
				// The resolver error is deliberately reduced to its type here:
				// an authentication resolver failure can carry connection
				// strings or credential fragments in its message. Because
				// response.Error logs the cause behind every 5xx, handing it
				// the raw error would put exactly what this line redacts into
				// the operator log. Respond with a cause-free internal error.
				zerolog.Ctx(r.Context()).Error().
					Str("resolver_error_type", fmt.Sprintf("%T", err)).
					Msg("authentication resolver failed")
				response.Error(w, r, &response.APIError{
					Status: http.StatusInternalServerError, Code: "internal_error",
					Message: "An unexpected error occurred.",
				})
				return
			}
			if err == nil && principal.Authenticated() {
				ctx := context.WithValue(r.Context(), contextKey{}, principal)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func FromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(contextKey{}).(Principal)
	return principal, ok && principal.Authenticated()
}
