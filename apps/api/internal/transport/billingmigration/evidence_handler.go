package billingmigrationhttp

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

var sha256DigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

func (h *Handler) listManifests(w http.ResponseWriter, r *http.Request) {
	limit, ok := readLimit(w, r)
	if !ok {
		return
	}
	items, err := h.services.Program.ListManifests(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), limit)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, recordItems("sourceManifest", items))
}

type mappingSetRequest struct {
	ExpectedStateVersion int64                           `json:"expectedStateVersion"`
	Version              int                             `json:"version"`
	Entries              []billingmigration.MappingEntry `json:"entries"`
}

func (r mappingSetRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.ExpectedStateVersion, validation.Min(1)), validation.Field(&r.Version, validation.Min(1)), validation.Field(&r.Entries, validation.Required, validation.Length(1, 10000)))
}
func (h *Handler) createMappingSet(w http.ResponseWriter, r *http.Request) {
	var request mappingSetRequest
	if !decode(w, r, &request) {
		return
	}
	item, err := h.services.Program.CreateMappingSet(r.Context(), actor(r), billingmigration.CreateMappingSetInput{ProjectID: chi.URLParam(r, "projectId"), ProgramID: chi.URLParam(r, "programId"), ExpectedStateVersion: request.ExpectedStateVersion, Version: request.Version, Entries: request.Entries})
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, record("mappingSet", item))
}
func (h *Handler) listMappingSets(w http.ResponseWriter, r *http.Request) {
	limit, ok := readLimit(w, r)
	if !ok {
		return
	}
	items, err := h.services.Program.ListMappingSets(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), limit)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, recordItems("mappingSet", items))
}

type stateVersionRequest struct {
	ExpectedStateVersion int64 `json:"expectedStateVersion"`
}

func (r stateVersionRequest) Validate() error {
	return validation.Validate(&r.ExpectedStateVersion, validation.Min(1))
}
func (h *Handler) freezeMappingSet(w http.ResponseWriter, r *http.Request) {
	var request stateVersionRequest
	if !decode(w, r, &request) {
		return
	}
	err := h.services.Program.FreezeMappingSet(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), chi.URLParam(r, "mappingSetId"), request.ExpectedStateVersion)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, map[string]any{"status": "frozen"})
}

type importBatchRequest struct {
	ExpectedStateVersion int64  `json:"expectedStateVersion"`
	ManifestID           string `json:"manifestId"`
	MappingSetID         string `json:"mappingSetId"`
	RecordCount          int    `json:"recordCount"`
	CursorBefore         string `json:"cursorBefore"`
}

func (r importBatchRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.ExpectedStateVersion, validation.Min(1)), validation.Field(&r.ManifestID, validation.Required, validation.Length(1, 128)), validation.Field(&r.MappingSetID, validation.Required, validation.Length(1, 128)), validation.Field(&r.RecordCount, validation.Min(0), validation.Max(1000)), validation.Field(&r.CursorBefore, validation.Length(0, 512)))
}
func (h *Handler) createImportBatch(w http.ResponseWriter, r *http.Request) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request importBatchRequest
	if !decode(w, r, &request) {
		return
	}
	item, replay, err := h.services.Program.CreateImportBatch(r.Context(), actor(r), billingmigration.CreateImportBatchInput{ProjectID: chi.URLParam(r, "projectId"), ProgramID: chi.URLParam(r, "programId"), ManifestID: request.ManifestID, MappingSetID: request.MappingSetID, IdempotencyKey: key, CursorBefore: request.CursorBefore, ExpectedStateVersion: request.ExpectedStateVersion, RecordCount: request.RecordCount})
	if err != nil {
		writeError(w, r, err)
		return
	}
	if replay {
		response.OK(w, r, record("importBatch", item))
		return
	}
	response.Accepted(w, r, record("importBatch", item))
}
func (h *Handler) listImportBatches(w http.ResponseWriter, r *http.Request) {
	limit, ok := readLimit(w, r)
	if !ok {
		return
	}
	items, err := h.services.Program.ListImportBatches(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), limit)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, recordItems("importBatch", items))
}
func (h *Handler) getImportBatch(w http.ResponseWriter, r *http.Request) {
	item, err := h.services.Program.ImportBatch(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), chi.URLParam(r, "batchId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record("importBatch", item))
}

type runRequest struct {
	ExpectedStateVersion int64  `json:"expectedStateVersion"`
	ManifestDigest       string `json:"manifestDigest"`
	MappingDigest        string `json:"mappingDigest"`
}

func (r runRequest) Validate() error {
	return validation.ValidateStruct(&r, validation.Field(&r.ExpectedStateVersion, validation.Min(1)), validation.Field(&r.ManifestDigest, validation.Required, validation.Match(sha256DigestPattern)), validation.Field(&r.MappingDigest, validation.Required, validation.Match(sha256DigestPattern)))
}
func (h *Handler) queueDryRun(w http.ResponseWriter, r *http.Request)    { h.queueRun(w, r, "dry_run") }
func (h *Handler) queueShadowRun(w http.ResponseWriter, r *http.Request) { h.queueRun(w, r, "shadow") }
func (h *Handler) queueRun(w http.ResponseWriter, r *http.Request, kind string) {
	key, ok := idempotencyKey(w, r)
	if !ok {
		return
	}
	var request runRequest
	if !decode(w, r, &request) {
		return
	}
	item, replay, err := h.services.Program.QueueRun(r.Context(), actor(r), billingmigration.QueueRunInput{ProjectID: chi.URLParam(r, "projectId"), ProgramID: chi.URLParam(r, "programId"), RunKind: kind, IdempotencyKey: key, ExpectedStateVersion: request.ExpectedStateVersion, ManifestDigest: request.ManifestDigest, MappingDigest: request.MappingDigest})
	if err != nil {
		writeError(w, r, err)
		return
	}
	if replay {
		response.OK(w, r, item)
		return
	}
	response.Accepted(w, r, item)
}
func (h *Handler) getRunJob(w http.ResponseWriter, r *http.Request) {
	item, err := h.services.Program.RunJob(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), chi.URLParam(r, "runJobId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, item)
}
func (h *Handler) listDivergences(w http.ResponseWriter, r *http.Request) {
	limit, ok := readLimit(w, r)
	if !ok {
		return
	}
	items, err := h.services.Program.ListDivergences(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), limit)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, recordItems("divergence", items))
}
func (h *Handler) assessReadiness(w http.ResponseWriter, r *http.Request) {
	var request stateVersionRequest
	if !decode(w, r, &request) {
		return
	}
	item, err := h.services.Program.AssessCurrentReadiness(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"), request.ExpectedStateVersion)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Created(w, r, record("readinessAssessment", item))
}
func (h *Handler) latestReadiness(w http.ResponseWriter, r *http.Request) {
	item, err := h.services.Program.LatestReadiness(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "programId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record("readinessAssessment", item))
}

func idempotencyKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 128 {
		response.Error(w, r, response.ValidationFailed(map[string][]string{"Idempotency-Key": {"must be between 1 and 128 characters"}}))
		return "", false
	}
	return key, true
}
func readLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 50, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 100 {
		writeError(w, r, billingmigration.ErrInvalid)
		return 0, false
	}
	return limit, true
}
func record[T any](kind string, payload T) billingmigration.ContractRecord[T] {
	return billingmigration.ContractRecord[T]{BillingMigrationOperationsContractVersion: billingmigration.ContractVersion, RecordType: kind, Payload: payload}
}
func recordItems[T any](kind string, items []T) map[string]any {
	records := make([]billingmigration.ContractRecord[T], 0, len(items))
	for _, item := range items {
		records = append(records, record(kind, item))
	}
	return map[string]any{"items": records}
}
