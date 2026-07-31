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
		Credential:        request.Credential,
	})
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) testProviderConnection(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.TestProviderConnection(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getProviderConnectionHealth(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ProviderConnectionHealth(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getProviderConnectionCapabilities(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ProviderConnectionHealth(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{
		"connectionId":        result.ConnectionID,
		"capabilities":        result.Capabilities,
		"requiredPermissions": result.RequiredPermissions,
	})
}

func (h *Handler) getProviderConnectionDiagnostics(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ProviderConnectionDiagnostics(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": result})
}

func (h *Handler) previewProviderCatalog(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.PreviewProviderCatalog(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) rotateProviderCredential(w http.ResponseWriter, r *http.Request) {
	request := new(providerCredentialRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.RotateProviderCredential(r.Context(), actor(r), chi.URLParam(r, "connectionId"), request.Credential)
	request.Credential = ""
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) reconnectProviderConnection(w http.ResponseWriter, r *http.Request) {
	request := new(providerCredentialRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.ReconnectProviderConnection(r.Context(), actor(r), chi.URLParam(r, "connectionId"), request.Credential)
	request.Credential = ""
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) enqueueProviderSync(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.EnqueueProviderSync(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Accepted(w, r, result)
}

func (h *Handler) listProviderSyncRuns(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListProviderSyncRuns(r.Context(), actor(r), chi.URLParam(r, "connectionId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"items": result})
}

func (h *Handler) importProviderProducts(w http.ResponseWriter, r *http.Request) {
	request := new(providerImportRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	items := make([]cloudworkspace.ProviderProductImportInput, 0, len(request.Items))
	for _, item := range request.Items {
		entitlements := make([]cloudworkspace.ProviderEntitlementImportInput, 0, len(item.Entitlements))
		for _, entitlement := range item.Entitlements {
			entitlements = append(entitlements, cloudworkspace.ProviderEntitlementImportInput{
				ProviderIdentifier:    entitlement.ProviderIdentifier,
				ExistingEntitlementID: entitlement.ExistingEntitlementID,
				Key:                   entitlement.Key, Name: entitlement.Name,
			})
		}
		items = append(items, cloudworkspace.ProviderProductImportInput{
			ProviderProductIdentifier:  item.ProviderProductIdentifier,
			ProviderPackageIdentifier:  item.ProviderPackageIdentifier,
			ProviderOfferingIdentifier: item.ProviderOfferingIdentifier,
			ExistingProductID:          item.ExistingProductID, Key: item.Key,
			InternalName: item.InternalName, EnvironmentID: item.EnvironmentID,
			ApplicationID: item.ApplicationID, Entitlements: entitlements,
		})
	}
	result, err := h.service.ImportProviderProducts(
		r.Context(), actor(r), chi.URLParam(r, "projectId"), request.ConnectionID,
		cloudworkspace.ImportProviderProductsInput{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), Items: items,
		},
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
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
		cloudworkspace.SetActiveProviderAssignmentInput{
			Provider: request.Provider, ActivationKind: request.ActivationKind,
			ConnectionID:             request.ConnectionID,
			AcknowledgeProductionUse: request.AcknowledgeProductionConnectionUse,
		},
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
		Provider:                   request.Provider,
		EnvironmentID:              request.EnvironmentID,
		ApplicationID:              request.ApplicationID,
		ProviderProductIdentifier:  request.ProviderProductIdentifier,
		ProviderPackageIdentifier:  request.ProviderPackageIdentifier,
		ProviderOfferingIdentifier: request.ProviderOfferingIdentifier,
		ExpectedStoreProductID:     request.ExpectedStoreProductID,
		ProviderBasePlanIdentifier: request.ProviderBasePlanIdentifier,
		ProviderOfferIdentifier:    request.ProviderOfferIdentifier,
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

func (h *Handler) replaceProviderMapping(w http.ResponseWriter, r *http.Request) {
	request := new(providerMappingReplacementRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.ReplaceProviderMapping(
		r.Context(), actor(r), chi.URLParam(r, "mappingId"),
		cloudworkspace.ReplaceProviderMappingInput{
			ProviderProductIdentifier:  request.ProviderProductIdentifier,
			ProviderPackageIdentifier:  request.ProviderPackageIdentifier,
			ProviderOfferingIdentifier: request.ProviderOfferingIdentifier,
			ProviderBasePlanIdentifier: request.ProviderBasePlanIdentifier,
			ProviderOfferIdentifier:    request.ProviderOfferIdentifier,
		},
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) createProviderMappingObservation(w http.ResponseWriter, r *http.Request) {
	request := new(providerMappingObservationRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateProviderMappingObservation(
		r.Context(), actor(r), chi.URLParam(r, "mappingId"),
		cloudworkspace.CreateProviderMappingObservationInput{
			AdapterVersion: request.AdapterVersion, StoreContext: request.StoreContext,
			Result: request.Result, DiagnosticCode: request.DiagnosticCode,
			CorrelationID: request.CorrelationID, Metadata: request.Metadata.domain(),
			ObservedAt: request.ObservedAt, ExpiresAt: request.ExpiresAt,
		},
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}

func (h *Handler) listProviderMappingObservations(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ListProviderMappingObservations(r.Context(), actor(r), chi.URLParam(r, "mappingId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getProviderMappingUsage(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ProviderMappingUsage(r.Context(), actor(r), chi.URLParam(r, "mappingId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getNativeProviderProfile(w http.ResponseWriter, r *http.Request) {
	platform := cloudworkspace.Platform(r.URL.Query().Get("platform"))
	if platform != cloudworkspace.PlatformIOS && platform != cloudworkspace.PlatformAndroid {
		writeValidationError(w, r, map[string][]string{"platform": []string{"Platform must be ios or android."}})
		return
	}
	result, err := h.service.NativeProviderProfile(
		r.Context(), cloudworkspace.ProviderKind(chi.URLParam(r, "provider")), platform,
	)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}

func (h *Handler) getProviderMappingMetadata(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetProviderMappingMetadata(
		r.Context(), actor(r), chi.URLParam(r, "mappingId"),
	)
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
