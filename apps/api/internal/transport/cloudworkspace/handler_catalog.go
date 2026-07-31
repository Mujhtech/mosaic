package cloudworkspacehttp

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

func (h *Handler) createPlan(w http.ResponseWriter, r *http.Request) {
	request := new(catalogResourceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreatePlan(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Key, request.Name, request.Description)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listPlans(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListPlans(r.Context(), actor(r), chi.URLParam(r, "projectId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getPlan(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetPlan(r.Context(), actor(r), chi.URLParam(r, "planId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) updatePlan(w http.ResponseWriter, r *http.Request) {
	request := new(catalogResourceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdatePlan(r.Context(), actor(r), chi.URLParam(r, "planId"), request.Key, request.Name, request.Description)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) addPlanProduct(w http.ResponseWriter, r *http.Request) {
	request := new(productReferenceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.AddPlanProduct(r.Context(), actor(r), chi.URLParam(r, "planId"), request.ProductID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listPlanProducts(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListPlanProducts(r.Context(), actor(r), chi.URLParam(r, "planId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) removePlanProduct(w http.ResponseWriter, r *http.Request) {
	err := h.service.RemovePlanProduct(r.Context(), actor(r), chi.URLParam(r, "planId"), chi.URLParam(r, "productId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) createProduct(w http.ResponseWriter, r *http.Request) {
	request := new(productRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateProduct(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Key, request.InternalName, request.Description, request.Type)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listProducts(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	status := cloudworkspace.ProductStatus(r.URL.Query().Get("status"))
	if status != "" && status != cloudworkspace.ProductDraft && status != cloudworkspace.ProductConnected && status != cloudworkspace.ProductAttentionRequired && status != cloudworkspace.ProductArchived {
		writeValidationError(w, r, map[string][]string{"status": {"Unsupported Product status."}})
		return
	}
	productType := cloudworkspace.ProductType(r.URL.Query().Get("type"))
	if productType != "" && productType != cloudworkspace.ProductSubscription && productType != cloudworkspace.ProductOneTimeNonConsumable {
		writeValidationError(w, r, map[string][]string{"type": {"Unsupported Product type."}})
		return
	}
	filters := cloudworkspace.ProductFilters{ListOptions: options, Status: status, Type: productType, Search: r.URL.Query().Get("search")}
	result, err := h.service.ListProducts(r.Context(), actor(r), chi.URLParam(r, "projectId"), filters)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getProduct(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetProduct(r.Context(), actor(r), chi.URLParam(r, "productId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) updateProduct(w http.ResponseWriter, r *http.Request) {
	request := new(productRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateProduct(r.Context(), actor(r), chi.URLParam(r, "productId"), request.Key, request.InternalName, request.Description, request.Type)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) archiveProduct(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ArchiveProduct(r.Context(), actor(r), chi.URLParam(r, "productId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) restoreProduct(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.RestoreProduct(r.Context(), actor(r), chi.URLParam(r, "productId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) deleteProduct(w http.ResponseWriter, r *http.Request) {
	err := h.service.DeleteProduct(r.Context(), actor(r), chi.URLParam(r, "productId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) setProductReplacement(w http.ResponseWriter, r *http.Request) {
	request := new(productReferenceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.SetProductReplacement(r.Context(), actor(r), chi.URLParam(r, "productId"), request.ProductID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getProductUsage(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ProductUsage(r.Context(), actor(r), chi.URLParam(r, "productId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getProductReadiness(w http.ResponseWriter, r *http.Request) {
	h.getProviderReadiness(w, r)
}
func (h *Handler) createEntitlement(w http.ResponseWriter, r *http.Request) {
	request := new(catalogResourceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateEntitlement(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Key, request.Name, request.Description)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listEntitlements(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListEntitlements(r.Context(), actor(r), chi.URLParam(r, "projectId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getEntitlement(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetEntitlement(r.Context(), actor(r), chi.URLParam(r, "entitlementId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) updateEntitlement(w http.ResponseWriter, r *http.Request) {
	request := new(catalogResourceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateEntitlement(r.Context(), actor(r), chi.URLParam(r, "entitlementId"), request.Key, request.Name, request.Description)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) addProductEntitlement(w http.ResponseWriter, r *http.Request) {
	request := new(entitlementReferenceRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.AddProductEntitlement(r.Context(), actor(r), chi.URLParam(r, "productId"), request.EntitlementID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listProductEntitlements(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListProductEntitlements(r.Context(), actor(r), chi.URLParam(r, "productId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) removeProductEntitlement(w http.ResponseWriter, r *http.Request) {
	err := h.service.RemoveProductEntitlement(r.Context(), actor(r), chi.URLParam(r, "productId"), chi.URLParam(r, "entitlementId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) createProviderMapping(w http.ResponseWriter, r *http.Request) {
	request := new(providerMappingRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateProviderMapping(r.Context(), actor(r), chi.URLParam(r, "productId"), request.ApplicationID, request.Provider, request.ProviderProductIdentifier)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listProviderMappings(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListProviderMappings(r.Context(), actor(r), chi.URLParam(r, "productId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
