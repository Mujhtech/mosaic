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
	router.Post("/api-keys/{apiKeyId}/rotate", handler.rotateAPIKey)
	router.Post("/api-keys/{apiKeyId}/revoke", handler.revokeAPIKey)
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
