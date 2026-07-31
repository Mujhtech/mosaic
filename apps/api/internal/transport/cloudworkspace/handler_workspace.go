package cloudworkspacehttp

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

func (h *Handler) getWorkspaceBootstrap(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Bootstrap(r.Context(), actor(r))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) createOrganization(w http.ResponseWriter, r *http.Request) {
	request := new(organizationRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateOrganization(r.Context(), actor(r), request.Name)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listOrganizations(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListOrganizations(r.Context(), actor(r), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getOrganization(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetOrganization(r.Context(), actor(r), chi.URLParam(r, "organizationId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) updateOrganization(w http.ResponseWriter, r *http.Request) {
	request := new(organizationRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateOrganization(r.Context(), actor(r), chi.URLParam(r, "organizationId"), request.Name)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListMembers(r.Context(), actor(r), chi.URLParam(r, "organizationId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) addMember(w http.ResponseWriter, r *http.Request) {
	request := new(memberRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.AddMember(r.Context(), actor(r), chi.URLParam(r, "organizationId"), request.ActorID, request.Role)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) updateMember(w http.ResponseWriter, r *http.Request) {
	request := new(memberRoleRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateMember(r.Context(), actor(r), chi.URLParam(r, "organizationId"), chi.URLParam(r, "actorId"), request.Role)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) {
	err := h.service.RemoveMember(r.Context(), actor(r), chi.URLParam(r, "organizationId"), chi.URLParam(r, "actorId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.NoContent(w, r)
}
func (h *Handler) listAuditEvents(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	filters := cloudworkspace.AuditFilters{ListOptions: options, ProjectID: r.URL.Query().Get("projectId"), Action: r.URL.Query().Get("action")}
	result, err := h.service.ListAuditEvents(r.Context(), actor(r), chi.URLParam(r, "organizationId"), filters)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) createProject(w http.ResponseWriter, r *http.Request) {
	request := new(projectRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateProject(r.Context(), actor(r), request.OrganizationID, request.Key, request.Name)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listProjects(w http.ResponseWriter, r *http.Request) {
	organizationID := r.URL.Query().Get("organizationId")
	if organizationID == "" {
		writeValidationError(w, r, map[string][]string{"organizationId": {"Organization ID is required."}})
		return
	}
	status := cloudworkspace.ProjectStatus(r.URL.Query().Get("status"))
	if status != "" && status != cloudworkspace.ProjectActive && status != cloudworkspace.ProjectArchived {
		writeValidationError(w, r, map[string][]string{"status": {"Status must be active or archived."}})
		return
	}
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListProjects(r.Context(), actor(r), organizationID, status, options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) getProject(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetProject(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) updateProject(w http.ResponseWriter, r *http.Request) {
	request := new(organizationRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateProject(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Name)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) archiveProject(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.ArchiveProject(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) restoreProject(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.RestoreProject(r.Context(), actor(r), chi.URLParam(r, "projectId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) createApplication(w http.ResponseWriter, r *http.Request) {
	request := new(applicationRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateApplication(r.Context(), actor(r), chi.URLParam(r, "projectId"), request.Name, request.Platform, request.Identifier)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listApplications(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListApplications(r.Context(), actor(r), chi.URLParam(r, "projectId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) listEnvironments(w http.ResponseWriter, r *http.Request) {
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListEnvironments(r.Context(), actor(r), chi.URLParam(r, "projectId"), options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) updateEnvironment(w http.ResponseWriter, r *http.Request) {
	request := new(organizationRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.UpdateEnvironment(r.Context(), actor(r), chi.URLParam(r, "environmentId"), request.Name)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) createAPIKey(w http.ResponseWriter, r *http.Request) {
	request := new(apiKeyRequest)
	if !decodeAndValidate(w, r, request) {
		return
	}
	result, err := h.service.CreateAPIKey(r.Context(), actor(r), chi.URLParam(r, "environmentId"), request.Kind, request.ApplicationID)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.Created(w, r, result)
}
func (h *Handler) listAPIKeys(w http.ResponseWriter, r *http.Request) {
	kind := cloudworkspace.APIKeyKind(r.URL.Query().Get("kind"))
	if kind != "" && kind != cloudworkspace.APIKeyPublicSDK && kind != cloudworkspace.APIKeySecretServer {
		writeValidationError(w, r, map[string][]string{"kind": {"Kind must be public_sdk or secret_server."}})
		return
	}
	state := r.URL.Query().Get("state")
	if state != "" && state != "active" && state != "revoked" {
		writeValidationError(w, r, map[string][]string{"state": {"State must be active or revoked."}})
		return
	}
	options, ok := requireListOptions(w, r)
	if !ok {
		return
	}
	result, err := h.service.ListAPIKeys(r.Context(), actor(r), chi.URLParam(r, "environmentId"), kind, state, options)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) rotateAPIKey(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.RotateAPIKey(r.Context(), actor(r), chi.URLParam(r, "apiKeyId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
func (h *Handler) revokeAPIKey(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.RevokeAPIKey(r.Context(), actor(r), chi.URLParam(r, "apiKeyId"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	response.OK(w, r, result)
}
