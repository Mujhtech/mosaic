package placementdecisionhttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/requestvalidation"
)

const maxRequestBytes = 300 << 10

type Handler struct{ service *placementdecision.Service }

func RegisterProjectRoutes(router chi.Router, service *placementdecision.Service) {
	h := &Handler{service: service}
	router.Get("/placement-attributes", h.listAttributes)
	router.Post("/placement-attributes", h.createAttribute)
	router.Delete("/placement-attributes/{attributeId}", h.archiveAttribute)
	router.Get("/placements/{placementId}/usage", h.usage)
	router.Get("/placements/{placementId}/aliases", h.listAliases)
	router.Post("/placements/{placementId}/aliases", h.createAlias)
	router.Post("/placements/{placementId}/archive", h.archivePlacement)
	router.Get("/environments/{environmentId}/placements/{placementId}/rule-set", h.getRuleSet)
	router.Post("/environments/{environmentId}/placements/{placementId}/rule-set", h.createRuleSet)
	router.Put("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/draft", h.updateDraft)
	router.Post("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/validate", h.validateDraft)
	router.Post("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/publish", h.publish)
	router.Post("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/archive", h.archiveRuleSet)
	router.Get("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/versions", h.versions)
	router.Post("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/versions/{versionId}/draft", h.cloneVersion)
	router.Post("/environments/{environmentId}/placements/{placementId}/rule-sets/{ruleSetId}/simulate", h.simulate)
	router.Post("/environments/{environmentId}/placements/{placementId}/qa-overrides", h.createOverride)
	router.Get("/environments/{environmentId}/placements/{placementId}/qa-overrides", h.listOverrides)
	router.Delete("/environments/{environmentId}/placements/{placementId}/qa-overrides/{overrideId}", h.revokeOverride)
}

func actor(r *http.Request) placementdecision.Actor {
	principal, _ := authn.FromContext(r.Context())
	return placementdecision.Actor{ID: principal.ActorID}
}
func params(r *http.Request) (string, string, string, string) {
	return chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "placementId"), chi.URLParam(r, "ruleSetId")
}

type documentRequest struct {
	Document json.RawMessage `json:"document"`
}

func (r *documentRequest) Validate() error {
	return validation.ValidateStruct(r, validation.Field(&r.Document, validation.Required))
}

type publishRequest struct {
	ExpectedRevision int64 `json:"expectedRevision"`
}

func (r *publishRequest) Validate() error {
	return validation.ValidateStruct(r, validation.Field(&r.ExpectedRevision, validation.Min(1)))
}

type attributeRequest struct {
	Key              string   `json:"key"`
	Type             string   `json:"type"`
	Description      string   `json:"description"`
	AllowedOperators []string `json:"allowedOperators"`
	Sensitivity      string   `json:"sensitivity"`
}

func (r *attributeRequest) Validate() error {
	return validation.ValidateStruct(r, validation.Field(&r.Key, validation.Required, validation.Length(1, 64), requestvalidation.PlacementKey()), validation.Field(&r.Type, validation.Required, validation.In("string", "boolean", "number", "timestamp", "semantic_version", "string_list")), validation.Field(&r.Description, validation.Length(0, 500)), validation.Field(&r.AllowedOperators, validation.Required, validation.Length(1, 13)), validation.Field(&r.Sensitivity, validation.Required, validation.In("standard", "sensitive")))
}

type aliasRequest struct {
	Key string `json:"key"`
}

func (r *aliasRequest) Validate() error {
	return validation.ValidateStruct(r, validation.Field(&r.Key, validation.Required, validation.Length(1, 64), requestvalidation.PlacementKey()))
}

type overrideRequest struct {
	SafeLabel string                    `json:"safeLabel"`
	Selector  string                    `json:"selector"`
	Outcome   placementdecision.Outcome `json:"outcome"`
	ExpiresAt time.Time                 `json:"expiresAt"`
}
type simulationRequest placementdecision.EvaluationContext

func (request *simulationRequest) Validate() error {
	attributeBytes, _ := json.Marshal(request.Attributes)
	if len(attributeBytes) > 8<<10 {
		return validation.Errors{"attributes": validation.NewError("validation_length", "attributes must serialize to at most 8192 bytes")}
	}
	return validation.ValidateStruct(request,
		validation.Field(&request.Attributes, validation.Length(0, 32)),
		validation.Field(&request.Country, validation.Length(0, 2)),
		validation.Field(&request.Locale, validation.Length(0, 64)),
		validation.Field(&request.InstallationID, validation.Length(0, 256)),
		validation.Field(&request.UserID, validation.Length(0, 256)),
	)
}

func (r *overrideRequest) Validate() error {
	return validation.ValidateStruct(r, validation.Field(&r.SafeLabel, validation.Required, validation.Length(1, 80)), validation.Field(&r.Selector, validation.Required, validation.Length(16, 512)), validation.Field(&r.ExpiresAt, validation.Required))
}

func (h *Handler) createRuleSet(w http.ResponseWriter, r *http.Request) {
	request := new(documentRequest)
	if !decode(w, r, request) {
		return
	}
	project, environment, placement, _ := params(r)
	result, err := h.service.CreateRuleSet(r.Context(), actor(r), project, environment, placement, r.Header.Get("Idempotency-Key"), request.Document)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.Created(w, r, result)
}
func (h *Handler) getRuleSet(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, _ := params(r)
	result, err := h.service.GetRuleSet(r.Context(), actor(r), project, environment, placement)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.OK(w, r, result)
}
func (h *Handler) updateDraft(w http.ResponseWriter, r *http.Request) {
	request := new(documentRequest)
	if !decode(w, r, request) {
		return
	}
	project, environment, placement, ruleSet := params(r)
	result, err := h.service.UpdateDraft(r.Context(), actor(r), project, environment, placement, ruleSet, r.Header.Get("If-Match"), r.Header.Get("Idempotency-Key"), request.Document)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.OK(w, r, result)
}
func (h *Handler) validateDraft(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, ruleSet := params(r)
	result, err := h.service.ValidateDraft(r.Context(), actor(r), project, environment, placement, ruleSet)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) publish(w http.ResponseWriter, r *http.Request) {
	request := new(publishRequest)
	if !decode(w, r, request) {
		return
	}
	project, environment, placement, ruleSet := params(r)
	result, err := h.service.Publish(r.Context(), actor(r), project, environment, placement, ruleSet, request.ExpectedRevision)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) archiveRuleSet(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, ruleSet := params(r)
	if err := h.service.ArchiveRuleSet(r.Context(), actor(r), project, environment, placement, ruleSet); err != nil {
		writeError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) versions(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, ruleSet := params(r)
	result, err := h.service.Versions(r.Context(), actor(r), project, environment, placement, ruleSet)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": result})
}
func (h *Handler) cloneVersion(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, ruleSet := params(r)
	result, err := h.service.CloneVersion(r.Context(), actor(r), project, environment, placement, ruleSet, chi.URLParam(r, "versionId"), r.Header.Get("Idempotency-Key"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.Created(w, r, result)
}
func (h *Handler) simulate(w http.ResponseWriter, r *http.Request) {
	var request simulationRequest
	if !decode(w, r, &request) {
		return
	}
	input := placementdecision.EvaluationContext(request)
	project, environment, placement, ruleSet := params(r)
	result, err := h.service.Simulate(r.Context(), actor(r), project, environment, placement, ruleSet, input)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.OK(w, r, result)
}
func (h *Handler) createAttribute(w http.ResponseWriter, r *http.Request) {
	request := new(attributeRequest)
	if !decode(w, r, request) {
		return
	}
	result, err := h.service.CreateAttribute(r.Context(), actor(r), chi.URLParam(r, "projectId"), placementdecision.AttributeDefinition{Key: request.Key, ValueType: request.Type, Description: request.Description, AllowedOperators: request.AllowedOperators, Sensitivity: request.Sensitivity})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listAttributes(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Attributes(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": result})
}
func (h *Handler) archiveAttribute(w http.ResponseWriter, r *http.Request) {
	if err := h.service.ArchiveAttribute(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "attributeId")); err != nil {
		writeError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) createAlias(w http.ResponseWriter, r *http.Request) {
	request := new(aliasRequest)
	if !decode(w, r, request) {
		return
	}
	result, err := h.service.CreateAlias(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "placementId"), request.Key)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listAliases(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Aliases(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "placementId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": result})
}
func (h *Handler) usage(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Usage(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "placementId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) archivePlacement(w http.ResponseWriter, r *http.Request) {
	if err := h.service.ArchivePlacement(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "placementId")); err != nil {
		writeError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) createOverride(w http.ResponseWriter, r *http.Request) {
	request := new(overrideRequest)
	if !decode(w, r, request) {
		return
	}
	project, environment, placement, _ := params(r)
	result, err := h.service.CreateOverride(r.Context(), actor(r), project, environment, placement, request.SafeLabel, request.Selector, request.Outcome, request.ExpiresAt)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.Created(w, r, result)
}
func (h *Handler) revokeOverride(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, _ := params(r)
	if err := h.service.RevokeOverride(r.Context(), actor(r), project, environment, placement, chi.URLParam(r, "overrideId")); err != nil {
		writeError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) listOverrides(w http.ResponseWriter, r *http.Request) {
	project, environment, placement, _ := params(r)
	result, err := h.service.Overrides(r.Context(), actor(r), project, environment, placement)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": result})
}

type validatable interface{ Validate() error }

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"_request": {"Request body must be valid JSON with only supported fields."}}))
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"_request": {"Request body must contain one JSON object."}}))
		return false
	}
	if value, ok := target.(validatable); ok {
		if err := value.Validate(); err != nil {
			fields, converted := requestvalidation.FieldErrors(err)
			if !converted {
				zerolog.Ctx(r.Context()).Error().Err(err).Msg("placement decision request validation failed")
				response.Error(w, r, err)
				return false
			}
			response.Error(w, r, response.ValidationFailed(fields))
			return false
		}
	}
	return true
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	apiError := &response.APIError{Cause: err}
	switch {
	case errors.Is(err, placementdecision.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, placementdecision.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "You do not have permission to perform this action."
	case errors.Is(err, placementdecision.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, placementdecision.ErrArchived):
		status, code, message = http.StatusConflict, "resource_archived", "The archived resource cannot be changed."
	case errors.Is(err, placementdecision.ErrPreconditionRequired):
		status, code, message = http.StatusPreconditionRequired, "precondition_required", "If-Match and Idempotency-Key preconditions are required."
	case errors.Is(err, placementdecision.ErrRevisionConflict):
		status, code, message = http.StatusPreconditionFailed, "draft_revision_conflict", "The Rule Set Draft has a newer server revision."
		var conflict *placementdecision.ConflictError
		if errors.As(err, &conflict) {
			apiError.Details = map[string]any{"currentRevision": conflict.Revision, "etag": conflict.ETag, "updatedAt": conflict.UpdatedAt, "updatedByActorId": conflict.ActorID}
		}
	case errors.Is(err, placementdecision.ErrIdempotencyConflict):
		status, code, message = http.StatusConflict, "idempotency_conflict", "The idempotency key was used for different content."
	case errors.Is(err, placementdecision.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The resource conflicts with current state."
	case errors.Is(err, placementdecision.ErrProductionOverride):
		status, code, message = http.StatusUnprocessableEntity, "production_override_unsupported", "QA overrides are limited to development and staging."
	case errors.Is(err, placementdecision.ErrValidation):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The Placement decision contains blocking issues."
		var validationErr *placementdecision.ValidationError
		if errors.As(err, &validationErr) {
			apiError.Details = map[string]any{"validation": validationErr.Result}
		}
	}
	if status == http.StatusInternalServerError {
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("placement decision request failed")
	}
	apiError.Status, apiError.Code, apiError.Message = status, code, message
	response.Error(w, r, apiError)
}
