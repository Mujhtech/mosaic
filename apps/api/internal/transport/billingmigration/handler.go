// Package billingmigrationhttp exposes the Phase 9C operator foundation.
package billingmigrationhttp

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
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

// Mapping sets may contain up to 10,000 bounded entries. Sixteen MiB keeps
// that documented contract representable with JSON encoding overhead while
// retaining a strict transport cap.
const maxRequestBytes = 16 << 20

type Services struct {
	Program           *billingmigration.Service
	SourcePull        *billingmigration.SourcePullService
	Operations        *billingmigration.OperationsService
	Redelivery        *billingmigration.RedeliveryService
	Reads             *billingmigration.OperationalReadService
	Stabilization     *billingmigration.StabilizationService
	RollbackReadiness *billingmigration.RollbackReadinessService
	RepairOnline      bool
}

type Handler struct{ services Services }

func RegisterProjectRoutes(router chi.Router, services Services, expensive ...func(http.Handler) http.Handler) {
	handler := &Handler{services: services}
	router.Route("/billing/migration-programs", func(programs chi.Router) {
		programs.Get("/", handler.listPrograms)
		programs.With(nonNil(expensive)...).Post("/", handler.createProgram)
		programs.Get("/{programId}", handler.getProgram)
		programs.Get("/{programId}/manifests", handler.listManifests)
		programs.Get("/{programId}/mapping-sets", handler.listMappingSets)
		programs.With(nonNil(expensive)...).Post("/{programId}/mapping-sets", handler.createMappingSet)
		programs.Post("/{programId}/mapping-sets/{mappingSetId}/freeze", handler.freezeMappingSet)
		programs.Get("/{programId}/import-batches", handler.listImportBatches)
		programs.With(nonNil(expensive)...).Post("/{programId}/import-batches", handler.createImportBatch)
		programs.Get("/{programId}/import-batches/{batchId}", handler.getImportBatch)
		programs.With(nonNil(expensive)...).Post("/{programId}/dry-runs", handler.queueDryRun)
		programs.With(nonNil(expensive)...).Post("/{programId}/shadow-runs", handler.queueShadowRun)
		programs.Get("/{programId}/runs/{runJobId}", handler.getRunJob)
		programs.Get("/{programId}/divergences", handler.listDivergences)
		programs.Post("/{programId}/readiness-assessments", handler.assessReadiness)
		programs.Get("/{programId}/readiness-assessments/latest", handler.latestReadiness)
		registerOperationalRoutes(programs, handler, nonNil(expensive))
	})
}

type scopeRequest struct {
	ApplicationID string `json:"applicationId"`
	Platform      string `json:"platform"`
}

type createProgramRequest struct {
	EnvironmentID       string         `json:"environmentId"`
	Applications        []scopeRequest `json:"applications"`
	RevenueCatProjectID string         `json:"revenueCatProjectId"`
	RevenueCatAPIKey    string         `json:"revenueCatApiKey"`
	StabilizationDays   int            `json:"stabilizationDays,omitempty"`
	RollbackWindowDays  int            `json:"rollbackWindowDays,omitempty"`
}

func (request createProgramRequest) Validate() error {
	err := validation.ValidateStruct(&request,
		validation.Field(&request.EnvironmentID, validation.Required, validation.Length(1, 128)),
		validation.Field(&request.Applications, validation.Required, validation.Length(1, 100)),
		validation.Field(&request.RevenueCatProjectID, validation.Required, validation.Length(1, 256)),
		validation.Field(&request.RevenueCatAPIKey, validation.Required, validation.Length(1, 4096)),
		validation.Field(&request.StabilizationDays, validation.Min(0), validation.Max(30)),
		validation.Field(&request.RollbackWindowDays, validation.Min(0), validation.Max(30)),
	)
	if err != nil {
		return err
	}
	for _, item := range request.Applications {
		if err := validation.ValidateStruct(&item,
			validation.Field(&item.ApplicationID, validation.Required, validation.Length(1, 128)),
			validation.Field(&item.Platform, validation.Required, validation.In("ios", "android")),
		); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) createProgram(w http.ResponseWriter, r *http.Request) {
	var request createProgramRequest
	if !decode(w, r, &request) {
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" || len(idempotencyKey) > 128 {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"Idempotency-Key": {"must be between 1 and 128 characters"}}))
		return
	}
	scopes := make([]billingmigration.ScopeItem, 0, len(request.Applications))
	for _, item := range request.Applications {
		scopes = append(scopes, billingmigration.ScopeItem{ApplicationID: item.ApplicationID, Platform: item.Platform})
	}
	created, replayed, err := h.services.Program.CreateProgram(r.Context(), actor(r), billingmigration.CreateProgramInput{
		ProjectID: chi.URLParam(r, "projectId"), EnvironmentID: request.EnvironmentID,
		Applications: scopes, ExternalProjectID: request.RevenueCatProjectID,
		Credential: []byte(request.RevenueCatAPIKey), IdempotencyKey: idempotencyKey,
		StabilizationDays: request.StabilizationDays, RollbackWindowDays: request.RollbackWindowDays,
	})
	request.RevenueCatAPIKey = ""
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Location", "/v1/projects/"+chi.URLParam(r, "projectId")+"/billing/migration-programs/"+created.Program.ProgramID)
	record := record("migrationProgram", created)
	if replayed {
		response.OK(w, r, record)
		return
	}
	response.Created(w, r, record)
}

func (h *Handler) listPrograms(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, r, billingmigration.ErrInvalid)
			return
		}
		limit = parsed
	}
	programs, err := h.services.Program.ListPrograms(r.Context(), actor(r), chi.URLParam(r, "projectId"), limit)
	if err != nil {
		writeError(w, r, err)
		return
	}
	records := make([]billingmigration.ContractRecord[billingmigration.ProgramDetail], 0, len(programs))
	for _, program := range programs {
		records = append(records, record("migrationProgram", program))
	}
	response.OK(w, r, map[string]any{"items": records})
}

func (h *Handler) getProgram(w http.ResponseWriter, r *http.Request) {
	program, err := h.services.Program.Program(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record("migrationProgram", program))
}

func actor(r *http.Request) billingmigration.Actor {
	principal, _ := authn.FromContext(r.Context())
	return billingmigration.Actor{ID: principal.ActorID}
}

func decode(w http.ResponseWriter, r *http.Request, target interface{ Validate() error }) bool {
	if encoding := r.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
		writeError(w, r, billingmigration.ErrInvalid)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, r, billingmigration.ErrInvalid)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, r, billingmigration.ErrInvalid)
		return false
	}
	if err := target.Validate(); err != nil {
		response.Error(w, r, response.ValidationFailed(validationFields(err)))
		return false
	}
	return true
}

func validationFields(err error) map[string][]string {
	errorsByField, ok := err.(validation.Errors)
	if !ok {
		return nil
	}
	result := make(map[string][]string, len(errorsByField))
	for field, fieldError := range errorsByField {
		result[field] = []string{fieldError.Error()}
	}
	return result
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, billingmigration.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, billingmigration.ErrForbidden):
		status, code, message = http.StatusForbidden, "migration_capability_denied", "You do not have permission to perform this migration command."
	case errors.Is(err, billingmigration.ErrNotFound):
		status, code, message = http.StatusNotFound, "migration_program_not_found", "The migration program was not found."
	case errors.Is(err, billingmigration.ErrConflict):
		status, code, message = http.StatusConflict, "migration_state_conflict", "The command conflicts with the current migration state or idempotency record."
	case errors.Is(err, billingmigration.ErrIdempotencyConflict), errors.Is(err, billingmigration.ErrStaleState), errors.Is(err, billingmigration.ErrStaleDigest), errors.Is(err, billingmigration.ErrPointerCoverage):
		status, code, message = http.StatusConflict, "migration_state_conflict", "The command conflicts with the current migration state or immutable evidence."
	case errors.Is(err, billingmigration.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The migration request is invalid."
	case errors.Is(err, billingmigration.ErrUnavailable):
		status, code, message = http.StatusServiceUnavailable, "migration_dependency_unavailable", "A required migration dependency is unavailable."
	default:
		zerolog.Ctx(r.Context()).Error().Str("migration_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing migration request failed")
	}
	response.Error(w, r, response.NewAPIError(status, code, message))
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
