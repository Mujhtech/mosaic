// Package billingwebhookhttp exposes webhook destination management and
// delivery history over the authenticated operator API.
//
// Handlers here are strictly thin: read the request, decode, validate the
// transport shape, call the application service, write a standardized
// response. No handler screens a URL, decides an authorization question,
// constructs SQL, or calls render.JSON directly.
package billingwebhookhttp

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/go-ozzo/ozzo-validation/v4/is"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingwebhook"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// maxRequestBytes bounds a destination request body. Every field is short; the
// largest legitimate value is a 2048-character URL.
const maxRequestBytes = 8 << 10

type Handler struct {
	service *billingwebhook.Service
}

// RegisterProjectRoutes mounts the operator API under a project router, in the
// same shape as the billing operator routes: Project-scoped resources at the
// top and Environment-scoped collections under /environments/{environmentId}.
//
// A destination belongs to one Environment, so creating and listing them is an
// Environment-scoped operation; addressing one afterwards is not, because the
// destination id already names its Environment. The `expensive` middleware
// covers the two actions that do real work per call: creating or re-pointing a
// destination performs a DNS resolution against an operator-supplied host, and
// a replay re-queues delivery work.
// RegisterEnvironmentRoutes mounts destination creation and listing on the
// shared `/environments/{environmentId}/billing` subrouter. The subrouter is
// created once by the composition because three modules publish routes beneath
// it, and chi refuses to Mount() two handlers on one path (defect D-3). The
// resulting URLs are unchanged.
func RegisterEnvironmentRoutes(environment chi.Router, service *billingwebhook.Service, expensive ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	guarded := nonNil(expensive)

	environment.Route("/webhook-destinations", func(destinations chi.Router) {
		destinations.Get("/", h.listDestinations)
		destinations.With(guarded...).Post("/", h.createDestination)
	})
}

func RegisterProjectRoutes(router chi.Router, service *billingwebhook.Service, expensive ...func(http.Handler) http.Handler) {
	h := &Handler{service: service}
	guarded := nonNil(expensive)

	router.Route("/billing/webhook-destinations/{destinationId}", func(destination chi.Router) {
		destination.Get("/", h.getDestination)
		destination.With(guarded...).Patch("/", h.updateDestination)
		destination.Delete("/", h.deleteDestination)
		destination.Post("/status", h.setStatus)
		destination.Get("/secrets", h.listSecrets)
		destination.Post("/secrets/rotate", h.rotateSecret)
		destination.Post("/secrets/{secretId}/retire", h.retireSecret)
	})
	router.Route("/billing/webhook-deliveries", func(deliveries chi.Router) {
		deliveries.Get("/", h.listDeliveries)
		deliveries.Get("/{deliveryId}", h.getDelivery)
		deliveries.Get("/{deliveryId}/attempts", h.listAttempts)
		deliveries.With(guarded...).Post("/{deliveryId}/replay", h.replayDelivery)
	})
}

func nonNil(middleware []func(http.Handler) http.Handler) []func(http.Handler) http.Handler {
	result := make([]func(http.Handler) http.Handler, 0, len(middleware))
	for _, item := range middleware {
		if item != nil {
			result = append(result, item)
		}
	}
	return result
}

func actor(r *http.Request) billingwebhook.Actor {
	principal, _ := authn.FromContext(r.Context())
	return billingwebhook.Actor{ID: principal.ActorID}
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

type destinationRequest struct {
	URL         string   `json:"url"`
	EventTypes  []string `json:"eventTypes,omitempty"`
	Description string   `json:"description,omitempty"`
}

// Validate covers transport shape only. Whether the URL resolves to a
// permitted address is an application decision that needs the network and the
// deployment's self-hosted flag, and it lives in the SSRF policy.
func (v *destinationRequest) Validate() error {
	return validation.ValidateStruct(v,
		validation.Field(&v.URL, validation.Required, validation.Length(1, 2048), is.RequestURI),
		validation.Field(&v.EventTypes, validation.Length(0, 10),
			validation.Each(validation.In(billingwebhook.EventTypeEntitlementsChanged))),
		validation.Field(&v.Description, validation.Length(0, 500)),
	)
}

func (h *Handler) createDestination(w http.ResponseWriter, r *http.Request) {
	var request destinationRequest
	if !decode(w, r, &request) {
		return
	}
	created, err := h.service.CreateDestination(r.Context(), actor(r), billingwebhook.DestinationInput{
		ProjectID:     chi.URLParam(r, "projectId"),
		EnvironmentID: chi.URLParam(r, "environmentId"),
		URL:           request.URL,
		EventTypes:    request.EventTypes,
		Description:   request.Description,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	// The signing secret is in this response and in no other. There is no read
	// that returns it again, because Mosaic keeps only the sealed form.
	response.Created(w, r, created)
}

func (h *Handler) listDestinations(w http.ResponseWriter, r *http.Request) {
	destinations, err := h.service.ListDestinations(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, destinations)
}

func (h *Handler) getDestination(w http.ResponseWriter, r *http.Request) {
	destination, err := h.service.Destination(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "destinationId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, destination)
}

type updateDestinationRequest struct {
	URL         *string  `json:"url,omitempty"`
	EventTypes  []string `json:"eventTypes,omitempty"`
	Description *string  `json:"description,omitempty"`
}

func (v *updateDestinationRequest) Validate() error {
	return validation.ValidateStruct(v,
		validation.Field(&v.URL, validation.Length(1, 2048), is.RequestURI),
		validation.Field(&v.EventTypes, validation.Length(0, 10),
			validation.Each(validation.In(billingwebhook.EventTypeEntitlementsChanged))),
		validation.Field(&v.Description, validation.Length(0, 500)),
	)
}

func (h *Handler) updateDestination(w http.ResponseWriter, r *http.Request) {
	var request updateDestinationRequest
	if !decode(w, r, &request) {
		return
	}
	updated, err := h.service.UpdateDestination(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "destinationId"),
		billingwebhook.DestinationUpdate{
			URL: request.URL, EventTypes: request.EventTypes, Description: request.Description,
		})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, updated)
}

type statusRequest struct {
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

func (v *statusRequest) Validate() error {
	return validation.ValidateStruct(v,
		validation.Field(&v.Status, validation.Required, validation.In(
			billingwebhook.DestinationActive, billingwebhook.DestinationPaused,
			billingwebhook.DestinationDisabled)),
		validation.Field(&v.Reason, validation.Length(0, 128)),
	)
}

func (h *Handler) setStatus(w http.ResponseWriter, r *http.Request) {
	var request statusRequest
	if !decode(w, r, &request) {
		return
	}
	updated, err := h.service.SetStatus(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "destinationId"), request.Status, request.Reason)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, updated)
}

func (h *Handler) deleteDestination(w http.ResponseWriter, r *http.Request) {
	err := h.service.DeleteDestination(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "destinationId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.NoContent(w, r)
}

// ---------------------------------------------------------------------------
// Signing secrets
// ---------------------------------------------------------------------------

func (h *Handler) rotateSecret(w http.ResponseWriter, r *http.Request) {
	rotated, err := h.service.RotateSecret(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "destinationId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	// The response carries the new secret once and the instant the superseded
	// one stops signing, which is the whole information an integrator needs to
	// schedule their own side of the rotation.
	response.Created(w, r, rotated)
}

func (h *Handler) listSecrets(w http.ResponseWriter, r *http.Request) {
	secrets, err := h.service.ListSecrets(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "destinationId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, secrets)
}

func (h *Handler) retireSecret(w http.ResponseWriter, r *http.Request) {
	retired, err := h.service.RetireSecret(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		chi.URLParam(r, "destinationId"), chi.URLParam(r, "secretId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, retired)
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

func (h *Handler) listDeliveries(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	deliveries, err := h.service.ListDeliveries(r.Context(), actor(r), chi.URLParam(r, "projectId"),
		billingwebhook.DeliveryFilter{
			EnvironmentID: strings.TrimSpace(query.Get("environmentId")),
			EventID:       strings.TrimSpace(query.Get("eventId")),
			DestinationID: strings.TrimSpace(query.Get("destinationId")),
			Status:        allowed(query.Get("status")),
			Limit:         limit,
		})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, deliveries)
}

// allowed drops a status the schema does not define rather than passing it to
// the query, so a filter value can never widen a result set by accident.
func allowed(value string) string {
	switch strings.TrimSpace(value) {
	case billingwebhook.DeliveryPending, billingwebhook.DeliverySucceeded,
		billingwebhook.DeliveryFailed, billingwebhook.DeliveryExhausted,
		billingwebhook.DeliverySkipped:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func (h *Handler) getDelivery(w http.ResponseWriter, r *http.Request) {
	delivery, err := h.service.Delivery(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "deliveryId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, delivery)
}

func (h *Handler) listAttempts(w http.ResponseWriter, r *http.Request) {
	attempts, err := h.service.ListAttempts(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "deliveryId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, attempts)
}

func (h *Handler) replayDelivery(w http.ResponseWriter, r *http.Request) {
	delivery, err := h.service.ReplayDelivery(r.Context(), actor(r),
		chi.URLParam(r, "projectId"), chi.URLParam(r, "deliveryId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	// 202: the delivery is queued, not performed. The worker owns the attempt.
	response.Accepted(w, r, delivery)
}

// ---------------------------------------------------------------------------
// Decoding and error mapping
// ---------------------------------------------------------------------------

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeError(w, r, billingwebhook.ErrInvalid)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, r, billingwebhook.ErrInvalid)
		return false
	}
	// A second decode asserting EOF rejects trailing JSON, which would
	// otherwise let a caller smuggle a second document past the first.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, r, billingwebhook.ErrInvalid)
		return false
	}
	if validatable, ok := target.(interface{ Validate() error }); ok {
		if err := validatable.Validate(); err != nil {
			response.Error(w, r, response.ValidationFailed(fields(err)))
			return false
		}
	}
	return true
}

// fields turns an ozzo validation error into the response envelope's field map.
func fields(err error) map[string][]string {
	errs, ok := err.(validation.Errors)
	if !ok {
		return nil
	}
	result := make(map[string][]string, len(errs))
	for field, fieldErr := range errs {
		result[field] = []string{fieldErr.Error()}
	}
	return result
}

// writeError maps domain errors onto responses in one place. Nothing here
// reads an error message string, and no internal error, SQL error, destination
// URL, or response body reaches the client.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingwebhook.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingwebhook.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, billingwebhook.ErrDestinationRefused):
		// A refused destination is the operator's own configuration, so it is
		// reported precisely. The message names the policy, never the resolved
		// address: which address a hostname resolved to inside Mosaic's network
		// is information about Mosaic's network.
		status, code = http.StatusUnprocessableEntity, "webhook_destination_refused"
		message = "The destination must be an https URL that resolves to a public address. " +
			"Private, loopback, link-local, shared, and unique-local addresses are not permitted."
	case errors.Is(err, billingwebhook.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The request conflicts with the current state of this resource."
	case errors.Is(err, billingwebhook.ErrBillingDisabled):
		status, code, message = http.StatusConflict, "billing_not_enabled", "Mosaic Billing is not enabled for this Project."
	case errors.Is(err, billingwebhook.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The request contains invalid fields."
	case errors.Is(err, billingwebhook.ErrSecretUnavailable):
		status, code, message = http.StatusServiceUnavailable, "webhook_secret_unavailable", "The signing secret could not be prepared."
	case errors.Is(err, billingwebhook.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "webhook_storage_unavailable", "Webhook storage is temporarily unavailable."
	default:
		zerolog.Ctx(r.Context()).Error().
			Str("webhook_error_kind", errorTypeName(err)).
			Msg("webhook request failed")
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
}

// errorTypeName reports the Go type of an error and nothing else.
//
// The message is deliberately not logged. On this surface an error message can
// quote an operator-supplied destination URL, a resolved internal address, or
// a wrapped SQL statement, and the one thing this value must never be is
// caller content. %T is the precedent already used by the billing handler for
// the same reason.
func errorTypeName(err error) string {
	if err == nil {
		return ""
	}
	return fmt.Sprintf("%T", err)
}
