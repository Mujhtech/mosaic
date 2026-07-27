package experimenthttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/experiment"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/requestvalidation"
)

type Handler struct{ service *experiment.Service }

func RegisterProjectRoutes(router chi.Router, service *experiment.Service) {
	h := &Handler{service: service}
	base := "/environments/{environmentId}/experiments"
	router.Get(base, h.list)
	router.Post(base, h.create)
	router.Get(base+"/metrics", h.metrics)
	router.Get(base+"/groups", h.groups)
	router.Post(base+"/groups", h.createGroup)
	router.Post(base+"/groups/{groupId}/versions", h.createGroupVersion)
	router.Get(base+"/groups/{groupId}/versions", h.groupVersions)
	router.Get(base+"/{experimentId}", h.get)
	router.Put(base+"/{experimentId}/draft", h.updateDraft)
	router.Post(base+"/{experimentId}/validate", h.validate)
	router.Post(base+"/{experimentId}/publish", h.publish)
	router.Get(base+"/{experimentId}/versions", h.versions)
	router.Get(base+"/{experimentId}/history", h.history)
	router.Get(base+"/{experimentId}/results", h.results)
	router.Get(base+"/{experimentId}/srm", h.srm)
	for _, action := range []string{"schedule", "start", "pause", "resume", "stop", "complete", "archive", "emergency-stop"} {
		router.Post(base+"/{experimentId}/"+action, h.transition(action))
	}
	router.Get(base+"/{experimentId}/qa-overrides", h.overrides)
	router.Post(base+"/{experimentId}/qa-overrides", h.createOverride)
	router.Delete(base+"/{experimentId}/qa-overrides/{overrideId}", h.revokeOverride)
}
func actor(r *http.Request) experiment.Actor {
	p, _ := authn.FromContext(r.Context())
	return experiment.Actor{ID: p.ActorID}
}
func params(r *http.Request) (string, string, string) {
	return chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "experimentId")
}

type createRequest struct {
	PlacementID string `json:"placementId"`
	Name        string `json:"name"`
	Hypothesis  string `json:"hypothesis"`
}

func (r createRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.PlacementID, validation.Required, validation.Length(1, 128)), validation.Field(&r.Name, validation.Required, validation.Length(1, 120)), validation.Field(&r.Hypothesis, validation.Length(0, 1000)))
}

type draftRequest struct {
	ExpectedRevision int64                    `json:"expectedRevision"`
	Document         experiment.DraftDocument `json:"document"`
}

func (r draftRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.ExpectedRevision, validation.Min(1)), validation.Field(&r.Document, validation.Required))
}

type publishRequest struct {
	ExpectedRevision int64 `json:"expectedRevision"`
}

func (r publishRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.ExpectedRevision, validation.Min(1)))
}

type transitionRequest struct {
	Reason string `json:"reason"`
}
type overrideRequest struct {
	ExperimentVersionID string    `json:"experimentVersionId"`
	VariantID           string    `json:"variantId"`
	IdentityType        string    `json:"identityType"`
	SafeLabel           string    `json:"safeLabel"`
	ExpiresAt           time.Time `json:"expiresAt"`
}
type groupRequest experiment.CreateGroupInput

func (r groupRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.Name, validation.Required, validation.Length(1, 120)), validation.Field(&r.AssignmentKeyPolicy, validation.Required, validation.In("installation", "identified_user", "identified_user_or_installation")), validation.Field(&r.Members, validation.Required, validation.Length(1, 32)), validation.Field(&r.HoldoutBasisPoints, validation.Min(0), validation.Max(9999)))
}

type groupVersionRequest struct {
	AssignmentKeyPolicy string                        `json:"assignmentKeyPolicy"`
	Members             []experiment.GroupMemberInput `json:"members"`
	HoldoutBasisPoints  int                           `json:"holdoutBasisPoints"`
}

func (r groupVersionRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.AssignmentKeyPolicy, validation.Required, validation.In("installation", "identified_user", "identified_user_or_installation")), validation.Field(&r.Members, validation.Required, validation.Length(1, 32)), validation.Field(&r.HoldoutBasisPoints, validation.Min(0), validation.Max(9999)))
}

func (r overrideRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.ExperimentVersionID, validation.Required), validation.Field(&r.VariantID, validation.Required), validation.Field(&r.IdentityType, validation.Required, validation.In("installation", "identified_user")), validation.Field(&r.SafeLabel, validation.Required, validation.Length(1, 80)), validation.Field(&r.ExpiresAt, validation.Required))
}
func decode(w http.ResponseWriter, r *http.Request, target interface{ Validate() error }) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 300<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(target); e != nil {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"body": {"The request body must be valid JSON with known fields."}}))
		return false
	}
	if e := target.Validate(); e != nil {
		fields, ok := requestvalidation.FieldErrors(e)
		if !ok {
			fields = map[string][]string{"body": {"The request is invalid."}}
		}
		response.Error(w, r, response.ValidationFailed(fields))
		return false
	}
	var trailing any
	if e := decoder.Decode(&trailing); e != io.EOF {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"body": {"Only one JSON object is allowed."}}))
		return false
	}
	return true
}
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var q createRequest
	if !decode(w, r, &q) {
		return
	}
	p, e, _ := params(r)
	v, x := h.service.Create(r.Context(), actor(r), p, e, q.PlacementID, q.Name, q.Hypothesis, r.Header.Get("Idempotency-Key"))
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.Created(w, r, v)
}
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	p, e, _ := params(r)
	v, x := h.service.List(r.Context(), actor(r), p, e)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.Get(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	if v.CurrentDraft != nil {
		w.Header().Set("ETag", v.CurrentDraft.ETag)
	}
	response.OK(w, r, v)
}
func (h *Handler) updateDraft(w http.ResponseWriter, r *http.Request) {
	var q draftRequest
	if !decode(w, r, &q) {
		return
	}
	p, e, id := params(r)
	v, x := h.service.UpdateDraft(r.Context(), actor(r), p, e, id, r.Header.Get("If-Match"), r.Header.Get("Idempotency-Key"), q.Document)
	if x != nil {
		writeError(w, r, x)
		return
	}
	w.Header().Set("ETag", v.ETag)
	response.OK(w, r, v)
}
func (h *Handler) validate(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.Validate(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) publish(w http.ResponseWriter, r *http.Request) {
	var q publishRequest
	if !decode(w, r, &q) {
		return
	}
	p, e, id := params(r)
	v, x := h.service.Publish(r.Context(), actor(r), p, e, id, q.ExpectedRevision)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.Created(w, r, v)
}
func (h *Handler) versions(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.Versions(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) history(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.History(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) metrics(w http.ResponseWriter, r *http.Request) {
	p, e, _ := params(r)
	v, x := h.service.Metrics(r.Context(), actor(r), p, e)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) groups(w http.ResponseWriter, r *http.Request) {
	p, e, _ := params(r)
	v, x := h.service.Groups(r.Context(), actor(r), p, e)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) createGroup(w http.ResponseWriter, r *http.Request) {
	var q groupRequest
	if !decode(w, r, &q) {
		return
	}
	p, e, _ := params(r)
	v, x := h.service.CreateGroup(r.Context(), actor(r), p, e, experiment.CreateGroupInput(q))
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.Created(w, r, v)
}
func (h *Handler) createGroupVersion(w http.ResponseWriter, r *http.Request) {
	var q groupVersionRequest
	if !decode(w, r, &q) {
		return
	}
	p, e, _ := params(r)
	input := experiment.CreateGroupInput{AssignmentKeyPolicy: q.AssignmentKeyPolicy, Members: q.Members, HoldoutBasisPoints: q.HoldoutBasisPoints}
	v, x := h.service.CreateGroupVersion(r.Context(), actor(r), p, e, chi.URLParam(r, "groupId"), input)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.Created(w, r, v)
}
func (h *Handler) groupVersions(w http.ResponseWriter, r *http.Request) {
	p, e, _ := params(r)
	v, x := h.service.GroupVersions(r.Context(), actor(r), p, e, chi.URLParam(r, "groupId"))
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) results(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.Results(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) srm(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.Results(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, v.SRM)
}
func target(action string) string {
	switch action {
	case "schedule":
		return "scheduled"
	case "start", "resume":
		return "running"
	case "pause":
		return "paused"
	case "stop", "emergency-stop":
		return "stopped"
	case "complete":
		return "completed"
	case "archive":
		return "archived"
	}
	return action
}
func (h *Handler) transition(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var q transitionRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if r.ContentLength > 0 {
			if x := decoder.Decode(&q); x != nil {
				response.Error(w, r, response.ValidationFailed(map[string][]string{"body": {"The request body must be valid JSON."}}))
				return
			}
		}
		p, e, id := params(r)
		reason := q.Reason
		if action == "emergency-stop" && reason == "" {
			response.Error(w, r, response.ValidationFailed(map[string][]string{"reason": {"A safe emergency-stop reason is required."}}))
			return
		}
		v, x := h.service.Transition(r.Context(), actor(r), p, e, id, target(action), reason)
		if x != nil {
			writeError(w, r, x)
			return
		}
		response.OK(w, r, v)
	}
}
func (h *Handler) overrides(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	v, x := h.service.Overrides(r.Context(), actor(r), p, e, id)
	if x != nil {
		writeError(w, r, x)
		return
	}
	response.OK(w, r, map[string]any{"items": v})
}
func (h *Handler) createOverride(w http.ResponseWriter, r *http.Request) {
	var q overrideRequest
	if !decode(w, r, &q) {
		return
	}
	p, e, id := params(r)
	v, x := h.service.CreateOverride(r.Context(), actor(r), p, e, id, q.ExperimentVersionID, q.VariantID, q.IdentityType, q.SafeLabel, q.ExpiresAt)
	if x != nil {
		writeError(w, r, x)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	response.Created(w, r, v)
}
func (h *Handler) revokeOverride(w http.ResponseWriter, r *http.Request) {
	p, e, id := params(r)
	if x := h.service.RevokeOverride(r.Context(), actor(r), p, e, id, chi.URLParam(r, "overrideId")); x != nil {
		writeError(w, r, x)
		return
	}
	response.NoContent(w, r)
}
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var conflict *experiment.ConflictError
	var invalid *experiment.ValidationError
	switch {
	case errors.Is(err, experiment.ErrUnauthenticated):
		response.Error(w, r, response.NewAPIError(401, "unauthenticated", "Authentication is required."))
	case errors.Is(err, experiment.ErrForbidden):
		response.Error(w, r, response.NewAPIError(403, "forbidden", "You do not have permission for this Experiment action."))
	case errors.Is(err, experiment.ErrNotFound):
		response.Error(w, r, response.NewAPIError(404, "experiment_not_found", "The Experiment was not found."))
	case errors.As(err, &conflict):
		x := response.NewAPIError(409, "experiment_draft_conflict", "The Experiment Draft changed on the server.")
		x.Details = map[string]any{"currentRevision": conflict.Revision, "etag": conflict.ETag}
		response.Error(w, r, x)
	case errors.As(err, &invalid):
		x := response.NewAPIError(422, "experiment_validation_failed", "The Experiment is not eligible for publication.")
		x.Details = map[string]any{"validation": invalid.Result}
		response.Error(w, r, x)
	case errors.Is(err, experiment.ErrPreconditionRequired):
		response.Error(w, r, response.NewAPIError(428, "precondition_required", "If-Match and Idempotency-Key are required."))
	case errors.Is(err, experiment.ErrIdempotencyConflict):
		response.Error(w, r, response.NewAPIError(409, "idempotency_conflict", "The idempotency key was already used for different input."))
	case errors.Is(err, experiment.ErrConflict):
		response.Error(w, r, response.NewAPIError(409, "experiment_transition_blocked", "The Experiment action is not valid in its current state."))
	case errors.Is(err, experiment.ErrInvalid):
		x := response.NewAPIError(422, "experiment_invalid", "The Experiment request is not valid.")
		// Name the precondition that refused. Without it every one of the
		// publish preconditions answers with the same opaque code.
		if reason, ok := experiment.InvalidReason(err); ok {
			x.Details = map[string]any{"reason": reason}
		}
		response.Error(w, r, x)
	default:
		response.Error(w, r, err)
	}
}
