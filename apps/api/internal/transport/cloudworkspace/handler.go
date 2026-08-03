package cloudworkspacehttp

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/requestvalidation"
)

const maxRequestBodyBytes = 1 << 20

type Handler struct{ service *cloudworkspace.Service }

func Routes(service *cloudworkspace.Service, resolver authn.Resolver) http.Handler {
	router := chi.NewRouter()
	RegisterRoutes(router, service, resolver)
	return router
}

func RegisterProjectDetailRoute(router chi.Router, service *cloudworkspace.Service, resolver authn.Resolver) {
	handler := &Handler{service: service}
	router.With(authn.Middleware(resolver)).Get("/projects/{projectId}", handler.getProject)
}

func RegisterRoutes(router chi.Router, service *cloudworkspace.Service, resolver authn.Resolver) {
	router.Group(func(router chi.Router) {
		router.Use(authn.Middleware(resolver))
		RegisterWorkspaceRoutes(router, service)
		router.Route("/projects/{projectId}", func(router chi.Router) {
			RegisterProjectRoutes(router, service)
		})
	})
}

func RegisterWorkspaceRoutes(router chi.Router, service *cloudworkspace.Service) {
	handler := &Handler{service: service}
	router.Get("/workspace/bootstrap", handler.getWorkspaceBootstrap)
	router.Route("/organizations", func(router chi.Router) {
		router.Get("/", handler.listOrganizations)
		router.Post("/", handler.createOrganization)
		router.Route("/{organizationId}", func(router chi.Router) {
			router.Get("/", handler.getOrganization)
			router.Patch("/", handler.updateOrganization)
			router.Get("/members", handler.listMembers)
			router.Post("/members", handler.addMember)
			router.Patch("/members/{actorId}", handler.updateMember)
			router.Delete("/members/{actorId}", handler.removeMember)
			router.Get("/audit-events", handler.listAuditEvents)
		})
	})
	router.Route("/projects", func(router chi.Router) {
		router.Get("/", handler.listProjects)
		router.Post("/", handler.createProject)
	})
	router.Route("/environments/{environmentId}/api-keys", func(router chi.Router) {
		router.Get("/", handler.listAPIKeys)
		router.Post("/", handler.createAPIKey)
	})
	router.Patch("/environments/{environmentId}", handler.updateEnvironment)
	router.Put("/environments/{environmentId}/mode", handler.setEnvironmentMode)
	router.Route("/environments/{environmentId}/applications/{applicationId}/active-provider", func(router chi.Router) {
		router.Get("/", handler.getActiveProviderAssignment)
		router.Put("/", handler.setActiveProviderAssignment)
		router.Delete("/", handler.clearActiveProviderAssignment)
	})
	router.Post("/api-keys/{apiKeyId}/rotate", handler.rotateAPIKey)
	router.Post("/api-keys/{apiKeyId}/revoke", handler.revokeAPIKey)
	router.Route("/provider-connections/{connectionId}", func(router chi.Router) {
		router.Get("/", handler.getProviderConnection)
		router.Put("/scopes", handler.replaceProviderConnectionScopes)
		router.Post("/test", handler.testProviderConnection)
		router.Get("/health", handler.getProviderConnectionHealth)
		router.Get("/capabilities", handler.getProviderConnectionCapabilities)
		router.Get("/diagnostics", handler.getProviderConnectionDiagnostics)
		router.Get("/catalog-preview", handler.previewProviderCatalog)
		router.Post("/rotate-credential", handler.rotateProviderCredential)
		router.Post("/reconnect", handler.reconnectProviderConnection)
		router.Post("/sync", handler.enqueueProviderSync)
		router.Get("/sync-runs", handler.listProviderSyncRuns)
		router.Post("/revoke", handler.revokeProviderConnection)
	})
	router.Post("/provider-mappings/{mappingId}/archive", handler.archiveProviderMapping)
	router.Post("/provider-mappings/{mappingId}/replace", handler.replaceProviderMapping)
	router.Get("/provider-mappings/{mappingId}/metadata", handler.getProviderMappingMetadata)
	router.Get("/provider-mappings/{mappingId}/usage", handler.getProviderMappingUsage)
	router.Get("/provider-mappings/{mappingId}/observations", handler.listProviderMappingObservations)
	router.Post("/provider-mappings/{mappingId}/observations", handler.createProviderMappingObservation)
	router.Get("/native-providers/{provider}/profile", handler.getNativeProviderProfile)
	router.Get("/plans/{planId}", handler.getPlan)
	router.Patch("/plans/{planId}", handler.updatePlan)
	router.Get("/plans/{planId}/products", handler.listPlanProducts)
	router.Post("/plans/{planId}/products", handler.addPlanProduct)
	router.Delete("/plans/{planId}/products/{productId}", handler.removePlanProduct)
	router.Route("/products/{productId}", func(router chi.Router) {
		router.Get("/", handler.getProduct)
		router.Patch("/", handler.updateProduct)
		router.Delete("/", handler.deleteProduct)
		router.Post("/archive", handler.archiveProduct)
		router.Post("/restore", handler.restoreProduct)
		router.Put("/replacement", handler.setProductReplacement)
		router.Get("/usage", handler.getProductUsage)
		router.Get("/readiness", handler.getProductReadiness)
		router.Get("/provider-mappings", handler.listProviderMappings)
		router.Post("/provider-mappings", handler.createProviderMapping)
		router.Post("/provider-mapping-drafts", handler.createProviderMappingDraft)
		router.Get("/provider-readiness", handler.getProviderReadiness)
		router.Get("/entitlements", handler.listProductEntitlements)
		router.Post("/entitlements", handler.addProductEntitlement)
		router.Delete("/entitlements/{entitlementId}", handler.removeProductEntitlement)
	})
	router.Get("/entitlements/{entitlementId}", handler.getEntitlement)
	router.Patch("/entitlements/{entitlementId}", handler.updateEntitlement)
}

func RegisterProjectRoutes(router chi.Router, service *cloudworkspace.Service) {
	handler := &Handler{service: service}
	router.Get("/", handler.getProject)
	router.Patch("/", handler.updateProject)
	router.Post("/archive", handler.archiveProject)
	router.Post("/restore", handler.restoreProject)
	router.Get("/applications", handler.listApplications)
	router.Post("/applications", handler.createApplication)
	router.Get("/environments", handler.listEnvironments)
	router.Get("/provider-connections", handler.listProviderConnections)
	router.Post("/provider-connections", handler.createProviderConnection)
	router.Post("/provider-imports", handler.importProviderProducts)
	router.Get("/plans", handler.listPlans)
	router.Post("/plans", handler.createPlan)
	router.Get("/products", handler.listProducts)
	router.Post("/products", handler.createProduct)
	router.Get("/entitlements", handler.listEntitlements)
	router.Post("/entitlements", handler.createEntitlement)
}

func actor(r *http.Request) cloudworkspace.Actor {
	principal, _ := authn.FromContext(r.Context())
	return cloudworkspace.Actor{ID: principal.ActorID}
}

func decodeAndValidate(w http.ResponseWriter, r *http.Request, target interface{ Validate() error }) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeValidationError(w, r, map[string][]string{"_request": {"Request body must be valid JSON with only supported fields."}})
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeValidationError(w, r, map[string][]string{"_request": {"Request body must contain one JSON object."}})
		return false
	}
	if err := target.Validate(); err != nil {
		fields, ok := requestvalidation.FieldErrors(err)
		if !ok {
			response.Error(w, r, err)
			return false
		}
		writeValidationError(w, r, fields)
		return false
	}
	return true
}

func writeValidationError(w http.ResponseWriter, r *http.Request, fields map[string][]string) {
	response.Error(w, r, response.ValidationFailed(fields))
}

func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, cloudworkspace.ErrInvalidCursor) {
		writeValidationError(w, r, map[string][]string{
			"cursor": {"Cursor is malformed, expired, or no longer available."},
		})
		return
	}
	status := http.StatusInternalServerError
	code, message := "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, cloudworkspace.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, cloudworkspace.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "You do not have permission to perform this action."
	case errors.Is(err, cloudworkspace.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, cloudworkspace.ErrLastOwner):
		status, code, message = http.StatusConflict, "last_owner", "Every organization must retain at least one owner."
	case errors.Is(err, cloudworkspace.ErrResourceArchived):
		status, code, message = http.StatusConflict, "resource_archived", "The archived resource cannot be changed."
	case errors.Is(err, cloudworkspace.ErrProductReferenced):
		status, code, message = http.StatusConflict, "product_referenced", "The Product is referenced; archive it or configure a replacement."
	case errors.Is(err, cloudworkspace.ErrReplacementInvalid):
		status, code, message = http.StatusConflict, "replacement_invalid", "The replacement or relationship is invalid."
	case errors.Is(err, cloudworkspace.ErrKeyRevoked):
		status, code, message = http.StatusConflict, "key_revoked", "A revoked API key cannot be rotated."
	case errors.Is(err, cloudworkspace.ErrSecretUnavailable):
		status, code, message = http.StatusConflict, "secret_unavailable", "The secret is available only when created or rotated."
	case errors.Is(err, cloudworkspace.ErrScopeMismatch):
		status, code, message = http.StatusConflict, string(cloudworkspace.ProviderErrorScopeMismatch), "The provider connection does not cover the requested project scope."
	case errors.Is(err, cloudworkspace.ErrModeMismatch):
		status, code, message = http.StatusConflict, string(cloudworkspace.ProviderErrorModeMismatch), "The provider connection mode is incompatible with the Environment mode."
	case errors.Is(err, cloudworkspace.ErrConnectionRevoked):
		status, code, message = http.StatusConflict, string(cloudworkspace.ProviderErrorConnectionRevoked), "The provider connection has been revoked."
	case errors.Is(err, cloudworkspace.ErrProductionConnectionAcknowledgementRequired):
		status, code, message = http.StatusConflict, "productionConnectionAcknowledgementRequired", "Production provider use outside a production Environment requires explicit acknowledgement."
	case errors.Is(err, cloudworkspace.ErrProviderNativeActivationRequired):
		status, code, message = http.StatusUnprocessableEntity, "providerNativeActivationRequired",
			"App Store Connect connections import the catalog; purchases run through the native App Store activation. Activate the native store instead."
	case errors.Is(err, cloudworkspace.ErrProviderUnsupported):
		status, code, message = http.StatusUnprocessableEntity, "providerIntegrationUnsupported", "The provider and integration mode combination is not supported."
	case errors.Is(err, cloudworkspace.ErrProviderFeatureDisabled):
		status, code, message = http.StatusServiceUnavailable, "providerFeatureDisabled", "Server-connected commerce providers are not enabled."
	case errors.Is(err, cloudworkspace.ErrProviderProjectInvalid):
		status, code, message = http.StatusUnprocessableEntity, "providerProjectInvalid", "The external project identifier is not valid for the selected provider."
	case errors.Is(err, cloudworkspace.ErrProviderCredentialInvalid):
		status, code, message = http.StatusUnprocessableEntity, string(cloudworkspace.ProviderErrorCredentialInvalid), "The provider credential is invalid or unavailable."
	case errors.Is(err, cloudworkspace.ErrProviderPermissionDenied):
		status, code, message = http.StatusUnprocessableEntity, string(cloudworkspace.ProviderErrorPermissionDenied), "The provider credential does not have the required read permissions."
	case errors.Is(err, cloudworkspace.ErrProviderRateLimited):
		status, code, message = http.StatusTooManyRequests, string(cloudworkspace.ProviderErrorRateLimited), "The provider rate limit was reached. Retry later."
	case errors.Is(err, cloudworkspace.ErrProviderUnavailable):
		status, code, message = http.StatusServiceUnavailable, string(cloudworkspace.ProviderErrorProviderUnavailable), "The provider is temporarily unavailable."
	case errors.Is(err, cloudworkspace.ErrProviderInvalidResponse):
		status, code, message = http.StatusBadGateway, string(cloudworkspace.ProviderErrorInvalidResponse), "The provider returned an invalid response."
	case errors.Is(err, cloudworkspace.ErrProviderSyncInProgress):
		status, code, message = http.StatusConflict, string(cloudworkspace.ProviderErrorSyncInProgress), "A synchronization is already queued or running."
	case errors.Is(err, cloudworkspace.ErrProviderImportInProgress):
		status, code, message = http.StatusConflict, "importInProgress", "The matching import is still in progress."
	case errors.Is(err, cloudworkspace.ErrIdempotencyConflict):
		status, code, message = http.StatusConflict, string(cloudworkspace.ProviderErrorIdempotencyConflict), "The Idempotency-Key was already used with different input."
	case errors.Is(err, cloudworkspace.ErrMappingAmbiguous):
		status, code, message = http.StatusConflict, string(cloudworkspace.ProviderErrorMappingAmbiguous), "More than one provider mapping matches the requested scope."
	case errors.Is(err, cloudworkspace.ErrMappingTargetInvalid):
		status, code, message = http.StatusUnprocessableEntity, "mappingTargetInvalid", "The provider mapping target is invalid for the selected provider."
	case errors.Is(err, cloudworkspace.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The resource conflicts with existing data."
	}
	response.Error(w, r, &response.APIError{Status: status, Code: code, Message: message, Cause: err})
}

func listOptions(r *http.Request) (cloudworkspace.ListOptions, error) {
	options := cloudworkspace.ListOptions{Cursor: r.URL.Query().Get("cursor"), Limit: 25}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			return options, fmt.Errorf("limit must be between 1 and 100")
		}
		options.Limit = limit
	}
	return options, nil
}

func requireListOptions(w http.ResponseWriter, r *http.Request) (cloudworkspace.ListOptions, bool) {
	options, err := listOptions(r)
	if err != nil {
		writeValidationError(w, r, map[string][]string{"limit": {err.Error()}})
		return options, false
	}
	return options, true
}
