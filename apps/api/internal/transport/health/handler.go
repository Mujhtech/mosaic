package health

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

type payload struct {
	Status string `json:"status"`
}

func Routes() http.Handler {
	router := chi.NewRouter()
	router.Get("/", handle)
	return router
}

func handle(w http.ResponseWriter, r *http.Request) {
	response.OK(w, r, payload{Status: "ok"})
}
