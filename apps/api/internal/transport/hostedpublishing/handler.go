package hostedpublishinghttp

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/requestvalidation"
)

const (
	maxDocumentRequestBytes = 4 << 20
	// multipartOverheadBytes covers the MIME part headers and boundary markers
	// wrapping the Asset bytes themselves.
	multipartOverheadBytes              = 1 << 20
	idempotencyHeader                   = "Idempotency-Key"
	ifMatchHeader                       = "If-Match"
	deliveryContentType                 = "application/vnd.mosaic.configuration+json;version=1"
	commerceContentType                 = "application/vnd.mosaic.commerce-configuration+json;version=1"
	commerceContentTypeV2               = "application/vnd.mosaic.commerce-configuration+json;version=2"
	capabilitiesHeader                  = "Mosaic-Paywall-Capabilities"
	experimentAssignmentVersionsHeader  = "Mosaic-Experiment-Assignment-Versions"
	experimentFeaturesHeader            = "Mosaic-Experiment-Features"
	experimentBucketingAlgorithmsHeader = "Mosaic-Experiment-Bucketing-Algorithms"
	experimentSchedulePoliciesHeader    = "Mosaic-Experiment-Schedule-Policies"
	maxCapabilityHeaderSize             = 16 << 10
)

type DeliveryRateLimiter interface {
	Allow(string) (bool, time.Duration)
}

type Handler struct {
	service *hostedpublishing.Service
	limiter DeliveryRateLimiter
}

func RegisterRoutes(router chi.Router, service *hostedpublishing.Service, resolver authn.Resolver, limiters ...DeliveryRateLimiter) {
	router.Group(func(router chi.Router) {
		router.Use(authn.Middleware(resolver))
		router.Route("/projects/{projectId}", func(router chi.Router) {
			RegisterProjectRoutes(router, service)
		})
	})
	RegisterPublicRoutes(router, service, limiters...)
}

// RegisterProjectRoutes mounts the authenticated publishing routes.
// uploadMiddleware carries the per-route timeout override for asset upload,
// which must not be bounded by the global request budget.
func RegisterProjectRoutes(router chi.Router, service *hostedpublishing.Service, uploadMiddleware ...func(http.Handler) http.Handler) {
	handler := &Handler{service: service}
	upload := make([]func(http.Handler) http.Handler, 0, len(uploadMiddleware))
	for _, item := range uploadMiddleware {
		if item != nil {
			upload = append(upload, item)
		}
	}
	router.Get("/assets", handler.listAssets)
	router.With(upload...).Post("/assets", handler.uploadAsset)
	router.Get("/assets/{assetId}", handler.getAsset)
	router.Delete("/assets/{assetId}", handler.archiveAsset)
	router.Get("/assets/{assetId}/usage", handler.assetUsage)
	router.Get("/paywalls", handler.listPaywalls)
	router.Post("/paywalls", handler.createPaywall)
	router.Get("/paywalls/{paywallId}", handler.getPaywall)
	router.Patch("/paywalls/{paywallId}", handler.updatePaywall)
	router.Post("/paywalls/{paywallId}/drafts", handler.createDraft)
	router.Get("/paywalls/{paywallId}/drafts/active", handler.getActiveDraft)
	router.Get("/paywalls/{paywallId}/drafts/{draftId}", handler.getDraft)
	router.Put("/paywalls/{paywallId}/drafts/{draftId}", handler.updateDraft)
	router.Post("/paywalls/{paywallId}/drafts/{draftId}/validate", handler.validateDraft)
	router.Get("/paywalls/{paywallId}/versions", handler.listVersions)
	router.Get("/paywalls/{paywallId}/versions/{versionId}", handler.getVersion)
	router.Post("/paywalls/{paywallId}/versions/{versionId}/drafts", handler.cloneVersionDraft)
	router.Get("/placements", handler.listPlacements)
	router.Post("/placements", handler.createPlacement)
	router.Patch("/placements/{placementId}", handler.updatePlacement)
	router.Get("/environments/{environmentId}/placements/{placementId}/binding", handler.getPlacementBinding)
	router.Put("/environments/{environmentId}/placements/{placementId}/binding", handler.bindPlacement)
	router.Post("/environments/{environmentId}/publish", handler.publish)
	router.Get("/environments/{environmentId}/releases", handler.listReleases)
	router.Post("/environments/{environmentId}/releases/{releaseId}/rollback", handler.rollback)
}

func RegisterPublicRoutes(router chi.Router, service *hostedpublishing.Service, limiters ...DeliveryRateLimiter) {
	handler := &Handler{service: service}
	if len(limiters) > 0 {
		handler.limiter = limiters[0]
	}
	router.Get("/sdk/configuration", handler.sdkConfiguration)
	router.Get("/sdk/commerce-configuration", handler.sdkCommerceConfiguration)
	router.Get("/sdk/assets/{assetId}/{contentDigest}", handler.assetContent)
}

func actor(r *http.Request) hostedpublishing.Actor {
	principal, _ := authn.FromContext(r.Context())
	return hostedpublishing.Actor{ID: principal.ActorID}
}

type paywallRequest struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

func (request *paywallRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Key, validation.Required, validation.Length(2, 63)),
		validation.Field(&request.Name, validation.Required, validation.Length(1, 120)))
}

type paywallUpdateRequest struct {
	Name string `json:"name"`
}

func (request *paywallUpdateRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Name, validation.Required, validation.Length(1, 120)))
}

type draftRequest struct {
	EnvironmentID   string          `json:"environmentId"`
	SourceVersionID string          `json:"sourceVersionId"`
	Document        json.RawMessage `json:"document"`
}

func (request *draftRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.EnvironmentID, validation.Required),
		validation.Field(&request.Document, validation.Required))
}

type documentRequest struct {
	Document json.RawMessage `json:"document"`
}

func (request *documentRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Document, validation.Required))
}

type placementRequest struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (request *placementRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Key, validation.Required, validation.Length(2, 63), requestvalidation.PlacementKey()),
		validation.Field(&request.Name, validation.Required, validation.Length(1, 120)),
		validation.Field(&request.Description, validation.Length(0, 1000)))
}

type placementUpdateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (request *placementUpdateRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Name, validation.Required, validation.Length(1, 120)),
		validation.Field(&request.Description, validation.Length(0, 1000)))
}

type bindingRequest struct {
	PaywallID string `json:"paywallId"`
}

func (request *bindingRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.PaywallID, validation.Required))
}

type publishRequest struct {
	DraftID                 string `json:"draftId"`
	ExpectedRevision        int64  `json:"expectedRevision"`
	AcknowledgeMockProducts bool   `json:"acknowledgeMockProducts"`
}

func (request *publishRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.DraftID, validation.Required),
		validation.Field(&request.ExpectedRevision, validation.Min(int64(1))))
}

type emptyRequest struct{}

func (*emptyRequest) Validate() error { return nil }

func decodeAndValidate(w http.ResponseWriter, r *http.Request, target interface{ Validate() error }) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxDocumentRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"_request": {"Request body must be valid JSON with only supported fields."}}))
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"_request": {"Request body must contain one JSON object."}}))
		return false
	}
	if err := target.Validate(); err != nil {
		fields, ok := requestvalidation.FieldErrors(err)
		if !ok {
			response.Error(w, r, err)
			return false
		}
		response.Error(w, r, response.ValidationFailed(fields))
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	apiError := &response.APIError{Cause: err}
	switch {
	case errors.Is(err, hostedpublishing.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, hostedpublishing.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "You do not have permission to perform this action."
	case errors.Is(err, hostedpublishing.ErrNotFound), errors.Is(err, hostedpublishing.ErrNoCurrentRelease):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, hostedpublishing.ErrArchived):
		status, code, message = http.StatusConflict, "resource_archived", "The archived resource cannot be changed."
	case errors.Is(err, hostedpublishing.ErrPreconditionRequired):
		status, code, message = http.StatusPreconditionRequired, "precondition_required", "The required revision or idempotency precondition is missing."
	case errors.Is(err, hostedpublishing.ErrDraftRevisionConflict):
		status, code, message = http.StatusPreconditionFailed, "draft_revision_conflict", "The Draft has a newer server revision."
		var conflict *hostedpublishing.ConflictError
		if errors.As(err, &conflict) {
			apiError.Details = map[string]any{"currentRevision": conflict.Revision, "etag": conflict.ETag, "updatedAt": conflict.UpdatedAt, "updatedByActorId": conflict.ActorID}
		}
	case errors.Is(err, hostedpublishing.ErrIdempotencyConflict):
		status, code, message = http.StatusConflict, "idempotency_conflict", "The idempotency key was already used for another request."
	case errors.Is(err, hostedpublishing.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The resource conflicts with existing data."
	case errors.Is(err, hostedpublishing.ErrAssetStorageUnavailable):
		status, code, message = http.StatusConflict, "asset_storage_unavailable", "Hosted Asset publishing is unavailable until object storage is configured."
	case errors.Is(err, hostedpublishing.ErrAssetInvalid):
		status, code, message = http.StatusUnprocessableEntity, "asset_invalid", "The Asset is empty, too large, or uses an unsupported media type."
	case errors.Is(err, hostedpublishing.ErrAssetNotReady):
		status, code, message = http.StatusConflict, "asset_not_ready", "The Asset is not ready for this operation."
	case errors.Is(err, hostedpublishing.ErrAssetReferenced):
		status, code, message = http.StatusConflict, "asset_referenced", "The Asset is referenced and its bytes must be retained."
	case errors.Is(err, hostedpublishing.ErrAssetStorage):
		status, code, message = http.StatusServiceUnavailable, "asset_storage_failed", "Asset storage is temporarily unavailable."
	case errors.Is(err, hostedpublishing.ErrPlacementUnpublished):
		status, code, message = http.StatusConflict, "placement_unpublished", "Every active Placement binding must resolve to a published Paywall."
	case errors.Is(err, hostedpublishing.ErrProductInvalid):
		status, code, message = http.StatusConflict, "product_invalid", "A referenced Product is missing, archived, or outside the Project."
	case errors.Is(err, hostedpublishing.ErrProviderReadiness):
		status, code, message = http.StatusConflict, "provider_readiness_unavailable", "Production publishing requires every referenced Product to be connected for every Project Application."
		var readinessError *hostedpublishing.ProviderReadinessError
		if errors.As(err, &readinessError) {
			apiError.Details = map[string]any{"blockers": readinessError.Blockers}
		}
	case errors.Is(err, hostedpublishing.ErrValidationFailed):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The Draft cannot be published until validation errors are resolved."
		var validationError *hostedpublishing.ValidationError
		if errors.As(err, &validationError) {
			apiError.Details = map[string]any{"errors": validationError.Errors}
		}
	case errors.Is(err, hostedpublishing.ErrUnsupportedCapability):
		status, code, message = http.StatusNotAcceptable, "unsupported_capability", "The SDK does not support this Configuration Release."
	}
	apiError.Status, apiError.Code, apiError.Message = status, code, message
	response.Error(w, r, apiError)
}

func (h *Handler) uploadAsset(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, h.service.AssetUploadLimit()+multipartOverheadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"file": {"A multipart file upload is required."}}))
		return
	}
	var uploaded bool
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			response.Error(w, r, response.ValidationFailed(map[string][]string{"file": {"The upload could not be read."}}))
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			_ = part.Close()
			continue
		}
		if uploaded {
			_ = part.Close()
			response.Error(w, r, response.ValidationFailed(map[string][]string{"file": {"Upload exactly one file."}}))
			return
		}
		asset, uploadErr := h.service.UploadAsset(r.Context(), actor(r), chi.URLParam(r, "projectId"), part.FileName(), part.Header.Get("Content-Type"), part)
		_ = part.Close()
		if uploadErr != nil {
			writeError(w, r, uploadErr)
			return
		}
		uploaded = true
		response.Created(w, r, asset)
		return
	}
	if !uploaded {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"file": {"Upload exactly one file."}}))
	}
}

func (h *Handler) listAssets(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListAssets(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getAsset(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetAsset(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) archiveAsset(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ArchiveAsset(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) assetUsage(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetAssetUsage(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) assetContent(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.OpenAsset(r.Context(), chi.URLParam(r, "assetId"), chi.URLParam(r, "contentDigest"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer result.Body.Close()
	w.Header().Set("Content-Type", result.Asset.MediaType)
	w.Header().Set("Content-Length", formatInt64(result.Asset.ByteLength))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+strings.TrimPrefix(result.Asset.ContentDigest, "sha256:")+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, result.Body)
}

func formatInt64(value int64) string { return strconv.FormatInt(value, 10) }

func (h *Handler) createPaywall(w http.ResponseWriter, r *http.Request) {
	request := new(paywallRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreatePaywall(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Key, request.Name)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) listPaywalls(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListPaywalls(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getPaywall(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetPaywall(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) updatePaywall(w http.ResponseWriter, r *http.Request) {
	request := new(paywallUpdateRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdatePaywall(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), request.Name)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) createDraft(w http.ResponseWriter, r *http.Request) {
	request := new(draftRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateDraft(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), request.EnvironmentID, request.Document, request.SourceVersionID, r.Header.Get(idempotencyHeader))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.Created(w, r, result)
}

func (h *Handler) getDraft(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetDraft(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), chi.URLParam(r, "draftId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.OK(w, r, result)
}

func (h *Handler) getActiveDraft(w http.ResponseWriter, r *http.Request) {
	environmentID := strings.TrimSpace(r.URL.Query().Get("environmentId"))
	if environmentID == "" {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"environmentId": {"Environment ID is required."}}))
		return
	}
	result, err := h.service.GetActiveDraft(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), environmentID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.OK(w, r, result)
}

func (h *Handler) updateDraft(w http.ResponseWriter, r *http.Request) {
	request := new(documentRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateDraft(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), chi.URLParam(r, "draftId"), r.Header.Get(ifMatchHeader), r.Header.Get(idempotencyHeader), request.Document)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.OK(w, r, result)
}

func (h *Handler) validateDraft(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ValidateDraft(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), chi.URLParam(r, "draftId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) listVersions(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListVersions(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getVersion(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetVersion(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), chi.URLParam(r, "versionId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) cloneVersionDraft(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.CloneVersionDraft(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "paywallId"), chi.URLParam(r, "versionId"), r.Header.Get(idempotencyHeader))
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("ETag", result.ETag)
	response.Created(w, r, result)
}

func (h *Handler) createPlacement(w http.ResponseWriter, r *http.Request) {
	request := new(placementRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreatePlacement(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Key, request.Name, request.Description)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) listPlacements(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListPlacements(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) updatePlacement(w http.ResponseWriter, r *http.Request) {
	request := new(placementUpdateRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdatePlacement(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "placementId"), request.Name, request.Description)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) bindPlacement(w http.ResponseWriter, r *http.Request) {
	request := new(bindingRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.BindPlacement(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "placementId"), request.PaywallID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getPlacementBinding(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetPlacementBinding(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "placementId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) publish(w http.ResponseWriter, r *http.Request) {
	request := new(publishRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.Publish(r.Context(), actor(r), hostedpublishing.PublishCommand{ProjectID: chi.URLParam(r, "projectId"), EnvironmentID: chi.URLParam(r, "environmentId"), DraftID: request.DraftID, ExpectedRevision: request.ExpectedRevision, AcknowledgeMockProducts: request.AcknowledgeMockProducts, IdempotencyKey: r.Header.Get(idempotencyHeader)})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) listReleases(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListReleases(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) rollback(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Rollback(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "releaseId"), r.Header.Get(idempotencyHeader))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func capabilityRequestFromHeaders(r *http.Request) (hostedpublishing.SDKCapabilityRequest, error) {
	capabilityHeader := r.Header.Get(capabilitiesHeader)
	if len(capabilityHeader) == 0 || len(capabilityHeader) > maxCapabilityHeaderSize {
		return hostedpublishing.SDKCapabilityRequest{}, hostedpublishing.ErrUnsupportedCapability
	}
	capabilities := make([]hostedpublishing.SDKCapability, 0)
	for _, item := range strings.Split(capabilityHeader, ",") {
		name, version, ok := strings.Cut(strings.TrimSpace(item), "@")
		if !ok || name == "" || version == "" || strings.Contains(version, "@") {
			return hostedpublishing.SDKCapabilityRequest{}, hostedpublishing.ErrUnsupportedCapability
		}
		capabilities = append(capabilities, hostedpublishing.SDKCapability{Name: name, Version: version})
	}
	request := hostedpublishing.SDKCapabilityRequest{
		Platform:                               strings.TrimSpace(r.Header.Get("Mosaic-SDK-Platform")),
		SDKVersion:                             strings.TrimSpace(r.Header.Get("Mosaic-SDK-Version")),
		SupportedConfigurationDeliveryVersions: headerValues(r.Header.Get("Mosaic-Configuration-Versions")),
		SupportedPaywallProtocols: []hostedpublishing.SDKPaywallProtocolSupport{{
			Version: strings.TrimSpace(r.Header.Get("Mosaic-Paywall-Protocol-Versions")), Capabilities: capabilities,
		}},
		ApplicationVersion:                     strings.TrimSpace(r.Header.Get("Mosaic-App-Version")),
		SupportedPlacementDecisionContracts:    headerValues(r.Header.Get("Mosaic-Placement-Decision-Versions")),
		SupportedDecisionFeatures:              headerValues(r.Header.Get("Mosaic-Decision-Features")),
		SupportedBucketingAlgorithms:           headerValues(r.Header.Get("Mosaic-Bucketing-Algorithms")),
		SupportedExperimentAssignmentContracts: headerValues(r.Header.Get(experimentAssignmentVersionsHeader)),
		SupportedExperimentFeatures:            headerValues(r.Header.Get(experimentFeaturesHeader)),
		SupportedExperimentBucketingAlgorithms: headerValues(r.Header.Get(experimentBucketingAlgorithmsHeader)),
		SupportedExperimentSchedulePolicies:    headerValues(r.Header.Get(experimentSchedulePoliciesHeader)),
	}
	for _, name := range []string{experimentAssignmentVersionsHeader, experimentFeaturesHeader, experimentBucketingAlgorithmsHeader, experimentSchedulePoliciesHeader} {
		if len(r.Header.Get(name)) > maxCapabilityHeaderSize {
			return hostedpublishing.SDKCapabilityRequest{}, hostedpublishing.ErrUnsupportedCapability
		}
	}
	return request, nil
}

func headerContains(raw, expected string) bool {
	for _, item := range strings.Split(raw, ",") {
		if strings.TrimSpace(item) == expected {
			return true
		}
	}
	return false
}

func headerValues(raw string) []string {
	values := make([]string, 0)
	for _, item := range strings.Split(raw, ",") {
		values = append(values, strings.TrimSpace(item))
	}
	return values
}

func bearer(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(value) < 8 || !strings.EqualFold(value[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(value[7:])
}

func gzipRepresentation(payload []byte) ([]byte, error) {
	buffer := new(bytes.Buffer)
	writer, err := gzip.NewWriterLevel(buffer, gzip.DefaultCompression)
	if err != nil {
		return nil, err
	}
	writer.Header.ModTime = time.Unix(0, 0)
	writer.Header.OS = 255
	if _, err := writer.Write(payload); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func representationETag(payload []byte) string {
	return `"sha256-` + digestBytes(payload) + `"`
}

func digestBytes(payload []byte) string {
	// Reuse the domain's stable digest without exporting key material.
	return hostedpublishing.ContentHash(payload)
}

// deliveryResponses counts Configuration Release deliveries split by whether
// the SDK's cached representation was still current. The 304 ratio is the
// documented signal for delivery efficiency and cache correctness.
var deliveryResponses = func() metric.Int64Counter {
	counter, _ := otel.Meter("mosaic/hostedpublishing").Int64Counter(
		"mosaic.delivery.responses",
		metric.WithDescription("Configuration delivery responses, split by cache outcome."),
	)
	return counter
}()

func recordDelivery(r *http.Request, surface string, notModified bool) {
	deliveryResponses.Add(r.Context(), 1, metric.WithAttributes(
		attribute.String("surface", surface),
		attribute.Bool("not_modified", notModified),
	))
}

func (h *Handler) sdkConfiguration(w http.ResponseWriter, r *http.Request) {
	if !h.allowDelivery(w, r, "ip:"+requestIP(r)) {
		return
	}
	capabilities, err := capabilityRequestFromHeaders(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if hostedpublishing.PreferredDeliveryVersion(capabilities.SupportedConfigurationDeliveryVersions) == "" {
		writeError(w, r, hostedpublishing.ErrUnsupportedCapability)
		return
	}
	configuration, err := h.service.AuthenticateSDKKeyVersions(r.Context(), bearer(r), capabilities.SupportedConfigurationDeliveryVersions)
	if err != nil {
		writeError(w, r, err)
		return
	}
	deliveryVersion := configuration.DeliveryContractVersion
	if err := hostedpublishing.ValidateSDKCapabilityPayload(capabilities, configuration.Payload, deliveryVersion); err != nil {
		writeError(w, r, err)
		return
	}
	if !h.allowDelivery(w, r, "key:"+configuration.APIKeyID) {
		return
	}
	payload := []byte(configuration.Payload)
	encoding := ""
	if len(payload) >= 1024 && headerContains(r.Header.Get("Accept-Encoding"), "gzip") {
		payload, err = gzipRepresentation(payload)
		if err != nil {
			writeError(w, r, err)
			return
		}
		encoding = "gzip"
	}
	etag := representationETag(payload)
	w.Header().Set("Cache-Control", "private, max-age=60, stale-if-error=86400")
	w.Header().Set("ETag", etag)
	w.Header().Set("Vary", "Authorization, Accept-Encoding, Mosaic-SDK-Platform, Mosaic-SDK-Version, Mosaic-Configuration-Versions, Mosaic-Paywall-Protocol-Versions, Mosaic-Paywall-Capabilities, Mosaic-Placement-Decision-Versions, Mosaic-Decision-Features, Mosaic-Bucketing-Algorithms, Mosaic-Experiment-Assignment-Versions, Mosaic-Experiment-Features, Mosaic-Experiment-Bucketing-Algorithms, Mosaic-Experiment-Schedule-Policies, Mosaic-App-Version")
	if encoding != "" {
		w.Header().Set("Content-Encoding", encoding)
	}
	if r.Header.Get("If-None-Match") == etag {
		recordDelivery(r, "configuration", true)
		response.Representation(w, http.StatusNotModified, "application/vnd.mosaic.configuration+json;version="+deliveryVersion, nil)
		return
	}
	recordDelivery(r, "configuration", false)
	response.Representation(w, http.StatusOK, "application/vnd.mosaic.configuration+json;version="+deliveryVersion, payload)
}

func (h *Handler) sdkCommerceConfiguration(w http.ResponseWriter, r *http.Request) {
	if !h.allowDelivery(w, r, "ip:"+requestIP(r)) {
		return
	}
	if !headerContains(r.Header.Get("Accept"), commerceContentType) &&
		!headerContains(r.Header.Get("Accept"), commerceContentTypeV2) {
		writeError(w, r, hostedpublishing.ErrUnsupportedCapability)
		return
	}
	sdkPlatform := strings.TrimSpace(r.Header.Get("Mosaic-SDK-Platform"))
	if err := hostedpublishing.ValidateSDKCommerceCapabilityRequest(
		sdkPlatform,
		strings.TrimSpace(r.Header.Get("Mosaic-SDK-Version")),
		headerValues(r.Header.Get("Mosaic-Commerce-Configuration-Versions")),
		headerValues(r.Header.Get("Mosaic-Commerce-Provider-Contract-Versions")),
	); err != nil {
		writeError(w, r, err)
		return
	}
	applicationID := strings.TrimSpace(r.URL.Query().Get("applicationId"))
	if applicationID == "" {
		response.Error(w, r, response.ValidationFailed(map[string][]string{
			"applicationId": {"Application ID is required."},
		}))
		return
	}
	configuration, err := h.service.AuthenticateSDKCommerceKey(
		r.Context(), bearer(r), applicationID, sdkPlatform,
	)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if !h.allowDelivery(w, r, "key:"+configuration.APIKeyID) {
		return
	}
	var envelope struct {
		Version string `json:"commerceConfigurationVersion"`
	}
	if err := json.Unmarshal(configuration.Snapshot.Payload, &envelope); err != nil {
		writeError(w, r, hostedpublishing.ErrUnsupportedCapability)
		return
	}
	if err := hostedpublishing.ValidateSDKCommerceSnapshotCapability(
		envelope.Version,
		headerValues(r.Header.Get("Mosaic-Commerce-Configuration-Versions")),
		headerValues(r.Header.Get("Mosaic-Commerce-Provider-Contract-Versions")),
	); err != nil {
		writeError(w, r, err)
		return
	}
	etag := `"` + configuration.Snapshot.ContentDigest + `"`
	w.Header().Set("Cache-Control", "private, max-age=60, stale-if-error=86400")
	w.Header().Set("ETag", etag)
	w.Header().Set("Mosaic-Configuration-Release-Id", configuration.Snapshot.ConfigurationReleaseID)
	w.Header().Set("Vary", "Authorization, Accept, Mosaic-SDK-Platform, Mosaic-SDK-Version, Mosaic-Commerce-Configuration-Versions, Mosaic-Commerce-Provider-Contract-Versions")
	contentType := "application/vnd.mosaic.commerce-configuration+json;version=" + envelope.Version
	if r.Header.Get("If-None-Match") == etag {
		recordDelivery(r, "commerce-configuration", true)
		response.Representation(w, http.StatusNotModified, contentType, nil)
		return
	}
	recordDelivery(r, "commerce-configuration", false)
	response.Representation(w, http.StatusOK, contentType, configuration.Snapshot.Payload)
}

func (h *Handler) allowDelivery(w http.ResponseWriter, r *http.Request, key string) bool {
	if h.limiter == nil {
		return true
	}
	allowed, retryAfter := h.limiter.Allow(key)
	if allowed {
		return true
	}
	seconds := int64(retryAfter/time.Second) + 1
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
	response.Error(w, r, response.NewAPIError(http.StatusTooManyRequests, "rate_limited", "Too many configuration requests. Retry later."))
	return false
}

func requestIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
