// Package projectoverviewhttp exposes the Project overview summary.
//
// The handler is deliberately thin: it reads the two path parameters, resolves
// the principal, calls the application service, and maps the result. There is
// no query parameter to validate — the window is the UTC calendar day and is
// not caller-selectable, which is what lets the response state the window as a
// fact rather than echo one back.
package projectoverviewhttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/projectoverview"
)

type Handler struct {
	service *projectoverview.Service
}

// RegisterProjectRoutes mounts the overview reads onto the authenticated
// Project subrouter. They take the baseline API bucket the whole subtree
// already carries: each endpoint runs a handful of bounded grouped queries,
// which is a dashboard read rather than history-scanning work. The series
// endpoint's cost does not grow with the requested length — the extra days are
// extra rows in the same grouped statements, and the length is clamped here
// rather than trusted.
func RegisterProjectRoutes(router chi.Router, service *projectoverview.Service) {
	handler := &Handler{service: service}
	router.Get("/environments/{environmentId}/overview-metrics", handler.overview)
	router.Get("/environments/{environmentId}/overview-metrics/series", handler.series)
}

func (h *Handler) overview(w http.ResponseWriter, r *http.Request) {
	principal, _ := authn.FromContext(r.Context())
	result, err := h.service.Overview(r.Context(),
		projectoverview.Actor{ID: principal.ActorID},
		chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

// series answers the daily time series behind the overview chart.
//
// `days` is the one caller-selectable input on this surface, and it is clamped
// rather than validated: the length of a chart is a presentation choice, and
// refusing a landing page over a number the dashboard chose badly would be a
// worse answer than drawing the nearest permitted length. The clamped value is
// echoed in the response so the caller can see what it actually got. A value
// that is not an integer at all is a different matter — it means the caller
// asked for something Mosaic cannot interpret — and is rejected.
func (h *Handler) series(w http.ResponseWriter, r *http.Request) {
	days := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			response.Error(w, r, response.ValidationFailed(map[string][]string{
				"days": {"Days must be a whole number."},
			}))
			return
		}
		days = parsed
	}

	principal, _ := authn.FromContext(r.Context())
	result, err := h.service.OverviewSeries(r.Context(),
		projectoverview.Actor{ID: principal.ActorID},
		chi.URLParam(r, "projectId"),
		chi.URLParam(r, "environmentId"),
		days)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, projectoverview.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, projectoverview.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "You do not have permission to perform this action."
	case errors.Is(err, projectoverview.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, projectoverview.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "overview_unavailable", "Overview metrics are temporarily unavailable."
	default:
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("project overview request failed")
	}
	response.Error(w, r, &response.APIError{Status: status, Code: code, Message: message, Cause: err})
}
