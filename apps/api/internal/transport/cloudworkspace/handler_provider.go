package cloudworkspacehttp

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

func (h *Handler) setEnvironmentMode(w http.ResponseWriter, r *http.Request) {
	request := new(environmentModeRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.SetEnvironmentMode(r.Context(), actor(r), chi.URLParam(r, "environmentId"), request.Mode)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) createProviderConnection(w http.ResponseWriter, r *http.Request) {
	request := new(providerConnectionRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateProviderConnection(r.Context(), actor(r), chi.URLParam(r, "projectId"), cloudworkspace.CreateProviderConnectionInput{
		Name:              request.Name,
		Provider:          request.Provider,
		IntegrationMode:   request.IntegrationMode,
		Mode:              request.Mode,
		ExternalProjectID: request.ExternalProjectID,
		EnvironmentIDs:    request.EnvironmentIDs,
		ApplicationIDs:    request.ApplicationIDs,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) listProviderConnections(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListProviderConnections(r.Context(), actor(r), chi.URLParam(r, "projectId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getProviderConnection(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetProviderConnection(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) replaceProviderConnectionScopes(w http.ResponseWriter, r *http.Request) {
	request := new(providerConnectionScopesRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.ReplaceProviderConnectionScopes(r.Context(), actor(r), chi.URLParam(r, "connectionId"), cloudworkspace.ReplaceProviderConnectionScopesInput{
		EnvironmentIDs: request.EnvironmentIDs,
		ApplicationIDs: request.ApplicationIDs,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) revokeProviderConnection(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.RevokeProviderConnection(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) setActiveProviderAssignment(w http.ResponseWriter, r *http.Request) {
	request := new(providerAssignmentRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.SetActiveProviderAssignment(
		r.Context(),
		actor(r),
		chi.URLParam(r, "environmentId"),
		chi.URLParam(r, "applicationId"),
		request.ConnectionID,
		request.AcknowledgeProductionConnectionUse,
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getActiveProviderAssignment(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetActiveProviderAssignment(
		r.Context(),
		actor(r),
		chi.URLParam(r, "environmentId"),
		chi.URLParam(r, "applicationId"),
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) clearActiveProviderAssignment(w http.ResponseWriter, r *http.Request) {
	err := h.service.ClearActiveProviderAssignment(
		r.Context(),
		actor(r),
		chi.URLParam(r, "environmentId"),
		chi.URLParam(r, "applicationId"),
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.NoContent(w, r)
}

func (h *Handler) createProviderMappingDraft(w http.ResponseWriter, r *http.Request) {
	request := new(providerMappingDraftRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateProviderMappingDraft(r.Context(), actor(r), chi.URLParam(r, "productId"), cloudworkspace.CreateProviderMappingDraftInput{
		ConnectionID:               request.ConnectionID,
		EnvironmentID:              request.EnvironmentID,
		ApplicationID:              request.ApplicationID,
		ProviderProductIdentifier:  request.ProviderProductIdentifier,
		ProviderPackageIdentifier:  request.ProviderPackageIdentifier,
		ProviderOfferingIdentifier: request.ProviderOfferingIdentifier,
		ExpectedStoreProductID:     request.ExpectedStoreProductID,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) archiveProviderMapping(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ArchiveProviderMapping(r.Context(), actor(r), chi.URLParam(r, "mappingId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getProviderReadiness(w http.ResponseWriter, r *http.Request) {
	environmentID := r.URL.Query().Get("environmentId")
	applicationID := r.URL.Query().Get("applicationId")
	fields := make(map[string][]string)
	if environmentID == "" {
		fields["environmentId"] = []string{"Environment ID is required."}
	}
	if applicationID == "" {
		fields["applicationId"] = []string{"Application ID is required."}
	}
	if len(fields) != 0 {
		writeValidationError(w, r, fields)
		return
	}
	result, err := h.service.ProviderReadiness(r.Context(), actor(r), chi.URLParam(r, "productId"), environmentID, applicationID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
