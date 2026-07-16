package httpmiddleware

import (
	"errors"
	"net/http"
	"reflect"

	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

var errRecoveredPanic = errors.New("recovered panic")

func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}

			panicType := "unknown"
			if reflectedType := reflect.TypeOf(recovered); reflectedType != nil {
				panicType = reflectedType.String()
			}
			zerolog.Ctx(r.Context()).Error().
				Str("panic_type", panicType).
				Msg("http panic recovered")
			response.Error(w, r, errRecoveredPanic)
		}()

		next.ServeHTTP(w, r)
	})
}
