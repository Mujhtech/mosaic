// Package billingdiagnosticshttp exposes the Phase 9B projection health surface
// over HTTP.
//
// The handler is a transport adapter and nothing else: it reads the path,
// calls the application service, and writes a standardized response. It makes
// no authorization decision — the repository does, against organization
// membership — and it never calls render.JSON.
package billingdiagnosticshttp

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingdiagnostics"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

type Handler struct {
	service *billingdiagnostics.Service
}

// RegisterProjectRoutes mounts the operator surface. It is a sibling of the
// Phase 9A billing health route (`/billing/health`) rather than a field on it,
// because the two summaries are read by operators answering different
// questions and merging them would make one page that is wrong for both.
func RegisterProjectRoutes(router chi.Router, service *billingdiagnostics.Service) {
	h := &Handler{service: service}
	router.Get("/environments/{environmentId}/billing/projection-health", h.projectionHealth)
}

func (h *Handler) projectionHealth(w http.ResponseWriter, r *http.Request) {
	principal, _ := authn.FromContext(r.Context())
	health, err := h.service.ProjectionHealth(r.Context(),
		billingdiagnostics.Actor{ID: principal.ActorID},
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, health)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingdiagnostics.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingdiagnostics.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "The actor may not read this resource."
	case errors.Is(err, billingdiagnostics.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingdiagnostics.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "billing_storage_unavailable",
			"Projection health could not be read."
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}
