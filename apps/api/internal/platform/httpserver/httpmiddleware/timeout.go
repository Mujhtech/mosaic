package httpmiddleware

import (
	"context"
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// Timeout cancels cooperative handlers at the configured deadline and keeps
// timeout failures inside Mosaic's stable error envelope.
func Timeout(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()

			wrapped := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(wrapped, r.WithContext(ctx))

			if ctx.Err() == context.DeadlineExceeded && wrapped.Status() == 0 {
				response.RequestTimeout(wrapped, r)
			}
		})
	}
}
