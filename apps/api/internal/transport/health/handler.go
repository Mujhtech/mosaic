package health

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

type Checker interface{ Ping(context.Context) error }

type payload struct {
	Status string `json:"status"`
}

func LiveRoutes() http.Handler {
	router := chi.NewRouter()
	router.Get("/", live)
	return router
}

func ReadyRoutes(checker Checker) http.Handler {
	router := chi.NewRouter()
	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		if checker == nil || checker.Ping(r.Context()) != nil {
			response.ServiceUnavailable(w, r, "not_ready", "A required dependency is unavailable.")
			return
		}
		response.OK(w, r, payload{Status: "ready"})
	})
	return router
}

func live(w http.ResponseWriter, r *http.Request) {
	response.OK(w, r, payload{Status: "ok"})
}
