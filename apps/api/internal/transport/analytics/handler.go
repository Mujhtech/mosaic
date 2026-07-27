package analyticshttp

import (
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/rs/zerolog"

	"github.com/Mujhtech/mosaic/apps/api/internal/analytics"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
)

type Limiter interface {
	Allow(string) (bool, time.Duration)
}
type EventLimiter interface {
	AllowN(string, int) (bool, time.Duration)
}
type Handler struct {
	service               *analytics.Service
	ipLimiter, keyLimiter Limiter
	eventLimiter          EventLimiter
}

func RegisterPublicRoutes(router chi.Router, service *analytics.Service, ip, key Limiter, events EventLimiter) {
	h := &Handler{service: service, ipLimiter: ip, keyLimiter: key, eventLimiter: events}
	router.Post("/sdk/events/batch", h.ingest)
}
func RegisterProjectRoutes(router chi.Router, service *analytics.Service) {
	h := &Handler{service: service}
	router.Route("/environments/{environmentId}/analytics", func(a chi.Router) {
		a.Get("/settings", h.settings)
		a.Put("/settings", h.updateSettings)
		a.Get("/overview", h.overview)
		a.Get("/funnels/{funnel}", h.funnel)
		a.Get("/paywall-version-comparison", h.paywallComparison)
		a.Get("/provider-errors", h.providerErrors)
		a.Get("/product-availability-failures", h.productFailures)
		a.Get("/breakdowns/{dimension}", h.breakdown)
		a.Get("/freshness", h.freshness)
		a.Post("/exports", h.eventExport)
	})
	router.Post("/environments/{environmentId}/experiments/{experimentId}/exports", h.experimentExport)
	router.Route("/analytics/privacy", func(p chi.Router) {
		p.Post("/preview", h.preview)
		p.Post("/exports", h.userExport)
		p.Post("/deletions", h.deletion)
	})
	router.Get("/analytics/jobs/{jobId}", h.job)
	router.Get("/analytics/jobs/{jobId}/download", h.download)
}

func actor(r *http.Request) analytics.Actor {
	principal, _ := authn.FromContext(r.Context())
	return analytics.Actor{ID: principal.ActorID}
}
func bearer(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(value) > 7 && strings.EqualFold(value[:7], "Bearer ") {
		return strings.TrimSpace(value[7:])
	}
	return ""
}
func limiterKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func (h *Handler) ingest(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Encoding") != "" && r.Header.Get("Content-Encoding") != "identity" {
		writeError(w, r, analytics.ErrInvalidBatch)
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if host == "" {
		host = r.RemoteAddr
	}
	if ok, retry := h.ipLimiter.Allow("ip:" + host); !ok {
		w.Header().Set("Retry-After", retryHeader(retry))
		writeError(w, r, analytics.ErrRateLimited)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, analytics.MaxBatchBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var batch analytics.Batch
	if err := decoder.Decode(&batch); err != nil {
		writeError(w, r, analytics.ErrInvalidBatch)
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, r, analytics.ErrInvalidBatch)
		return
	}
	key := bearer(r)
	hashed := "key:" + limiterKey(key)
	if ok, retry := h.keyLimiter.Allow(hashed); !ok {
		w.Header().Set("Retry-After", retryHeader(retry))
		writeError(w, r, analytics.ErrRateLimited)
		return
	}
	if ok, retry := h.eventLimiter.AllowN(hashed, len(batch.Events)); !ok {
		w.Header().Set("Retry-After", retryHeader(retry))
		writeError(w, r, analytics.ErrRateLimited)
		return
	}
	result, err := h.service.Ingest(r.Context(), key, batch)
	if err != nil {
		writeError(w, r, err)
		return
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Representation(w, http.StatusOK, "application/json", encoded)
}
func retryHeader(value time.Duration) string {
	seconds := int(value.Round(time.Second) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	if seconds > 300 {
		seconds = 300
	}
	return strconv.Itoa(seconds)
}

type settingsRequest struct {
	CollectionEnabled bool `json:"collectionEnabled"`
	RawRetentionDays  int  `json:"rawRetentionDays"`
}

func (v *settingsRequest) Validate() error {
	return validation.ValidateStruct(v, validation.Field(&v.RawRetentionDays, validation.Min(analytics.MinimumRetentionDays), validation.Max(analytics.MaximumRetentionDays)))
}

func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	value, err := h.service.Settings(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, value)
}
func (h *Handler) updateSettings(w http.ResponseWriter, r *http.Request) {
	var req settingsRequest
	if !decode(w, r, &req) {
		return
	}
	value, err := h.service.UpdateSettings(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), req.CollectionEnabled, req.RawRetentionDays)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, value)
}
func parseQuery(r *http.Request) (analytics.Query, error) {
	from, err := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	if err != nil {
		return analytics.Query{}, err
	}
	to, err := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if err != nil {
		return analytics.Query{}, err
	}
	return analytics.Query{ProjectID: chi.URLParam(r, "projectId"), EnvironmentID: chi.URLParam(r, "environmentId"), From: from, To: to, Timezone: r.URL.Query().Get("timezone"), Basis: r.URL.Query().Get("metricBasis"), Platform: r.URL.Query().Get("platform"), Locale: r.URL.Query().Get("locale"), ApplicationVersion: r.URL.Query().Get("applicationVersion")}, nil
}

var overviewMetrics = []string{"placement_requests", "paywall_presentations", "product_selections", "purchase_starts", "client_completed_purchases", "provider_confirmed_purchases", "purchase_cancelled", "purchase_failed"}
var funnelMetrics = map[string][]string{"placements": {"placement_requests", "placement_paywall_selected", "placement_no_paywall", "placement_fallback_used", "placement_unavailable"}, "paywalls": {"paywall_presentations", "presentation_to_product_selection_rate", "presentation_to_purchase_start_rate", "presentation_to_client_completed_purchase_rate", "presentation_to_provider_confirmed_purchase_rate"}, "products": {"product_selections", "product_selection_to_purchase_start_rate", "product_unavailable_rate"}, "purchases": {"purchase_starts", "client_completed_purchases", "provider_confirmed_purchases", "purchase_cancellation_rate", "purchase_pending_rate", "purchase_deferred_rate", "purchase_failure_rate", "restore_completed", "restore_nothing_found", "restore_cancelled", "restore_failed"}}

func (h *Handler) overview(w http.ResponseWriter, r *http.Request) { h.runQuery(w, r, overviewMetrics) }
func (h *Handler) funnel(w http.ResponseWriter, r *http.Request) {
	metrics, ok := funnelMetrics[chi.URLParam(r, "funnel")]
	if !ok {
		writeError(w, r, analytics.ErrNotFound)
		return
	}
	h.runQuery(w, r, metrics)
}
func (h *Handler) paywallComparison(w http.ResponseWriter, r *http.Request) {
	h.runQuery(w, r, []string{"__paywall_versions"})
}
func (h *Handler) providerErrors(w http.ResponseWriter, r *http.Request) {
	h.runQuery(w, r, []string{"__provider_errors"})
}
func (h *Handler) productFailures(w http.ResponseWriter, r *http.Request) {
	h.runQuery(w, r, []string{"__product_failures"})
}
func (h *Handler) freshness(w http.ResponseWriter, r *http.Request) {
	h.runQuery(w, r, []string{"__freshness"})
}
func (h *Handler) breakdown(w http.ResponseWriter, r *http.Request) {
	dimension := chi.URLParam(r, "dimension")
	if dimension != "platforms" && dimension != "locales" {
		writeError(w, r, analytics.ErrNotFound)
		return
	}
	h.runQuery(w, r, []string{"__" + dimension})
}
func (h *Handler) runQuery(w http.ResponseWriter, r *http.Request, ids []string) {
	query, err := parseQuery(r)
	if err != nil {
		writeError(w, r, analytics.ErrInvalidBatch)
		return
	}
	value, err := h.service.Query(r.Context(), actor(r), query, ids)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, value)
}

type eventExportRequest struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Format string `json:"format"`
}

func (v *eventExportRequest) Validate() error {
	return validation.ValidateStruct(v, validation.Field(&v.From, validation.Required), validation.Field(&v.To, validation.Required), validation.Field(&v.Format, validation.Required, validation.In("ndjson", "csv")))
}

func (h *Handler) eventExport(w http.ResponseWriter, r *http.Request) {
	var req eventExportRequest
	if !decode(w, r, &req) {
		return
	}
	from, e1 := time.Parse(time.RFC3339, req.From)
	to, e2 := time.Parse(time.RFC3339, req.To)
	if e1 != nil || e2 != nil {
		writeError(w, r, analytics.ErrInvalidBatch)
		return
	}
	value, err := h.service.CreateEventExport(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), req.Format, from, to)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, value)
}

type experimentExportRequest struct {
	Format          string `json:"format"`
	IncludeIdentity bool   `json:"includeIdentity"`
}

func (v *experimentExportRequest) Validate() error {
	return validation.ValidateStruct(v, validation.Field(&v.Format, validation.Required, validation.In("ndjson", "csv")))
}
func (h *Handler) experimentExport(w http.ResponseWriter, r *http.Request) {
	var req experimentExportRequest
	if !decode(w, r, &req) {
		return
	}
	value, err := h.service.CreateExperimentExport(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "environmentId"), chi.URLParam(r, "experimentId"), req.Format, req.IncludeIdentity)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, value)
}

type identityRequest struct {
	Kind          string `json:"kind"`
	Identity      string `json:"identity"`
	Format        string `json:"format,omitempty"`
	RequestDigest string `json:"requestDigest,omitempty"`
	Confirm       bool   `json:"confirm,omitempty"`
}

func (v *identityRequest) Validate() error {
	return validation.ValidateStruct(v, validation.Field(&v.Kind, validation.Required, validation.In("application_user", "installation")), validation.Field(&v.Identity, validation.Required, validation.RuneLength(1, 256)), validation.Field(&v.Format, validation.When(v.Format != "", validation.In("ndjson", "csv"))))
}

func (h *Handler) preview(w http.ResponseWriter, r *http.Request) {
	var req identityRequest
	if !decode(w, r, &req) {
		return
	}
	value, err := h.service.PreviewIdentity(r.Context(), actor(r), chi.URLParam(r, "projectId"), req.Kind, req.Identity)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, value)
}
func (h *Handler) userExport(w http.ResponseWriter, r *http.Request) {
	var req identityRequest
	if !decode(w, r, &req) {
		return
	}
	value, err := h.service.CreateUserExport(r.Context(), actor(r), chi.URLParam(r, "projectId"), req.Kind, req.Identity, req.Format)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, value)
}
func (h *Handler) deletion(w http.ResponseWriter, r *http.Request) {
	var req identityRequest
	if !decode(w, r, &req) {
		return
	}
	if !req.Confirm {
		writeError(w, r, analytics.ErrInvalidBatch)
		return
	}
	value, err := h.service.CreateDeletion(r.Context(), actor(r), chi.URLParam(r, "projectId"), req.Kind, req.Identity, req.RequestDigest)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.Accepted(w, r, value)
}
func (h *Handler) job(w http.ResponseWriter, r *http.Request) {
	value, err := h.service.Job(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "jobId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, value)
}
func (h *Handler) download(w http.ResponseWriter, r *http.Request) {
	reader, media, err := h.service.Download(r.Context(), actor(r), chi.URLParam(r, "projectId"), chi.URLParam(r, "jobId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer reader.Close()
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Disposition", "attachment; filename=analytics-export")
	_, _ = io.Copy(w, reader)
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, r, analytics.ErrInvalidBatch)
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, r, analytics.ErrInvalidBatch)
		return false
	}
	if validatable, ok := target.(interface{ Validate() error }); ok {
		if err := validatable.Validate(); err != nil {
			writeError(w, r, analytics.ErrInvalidBatch)
			return false
		}
	}
	return true
}
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "An unexpected error occurred."
	switch {
	case errors.Is(err, analytics.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, "unauthenticated", "Authentication is required."
	case errors.Is(err, analytics.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "You do not have permission to perform this action."
	case errors.Is(err, analytics.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found."
	case errors.Is(err, analytics.ErrCollectionDisabled):
		status, code, message = http.StatusConflict, "analytics_collection_disabled", "Analytics collection is disabled for this Environment."
	case errors.Is(err, analytics.ErrRateLimited):
		status, code, message = http.StatusTooManyRequests, "rate_limited", "Analytics ingestion is temporarily rate limited."
	case errors.Is(err, analytics.ErrInvalidBatch):
		status, code, message = http.StatusUnprocessableEntity, "validation_failed", "The analytics request is invalid."
	case errors.Is(err, analytics.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "The request conflicts with current analytics state."
	default:
		zerolog.Ctx(r.Context()).Error().Err(err).Msg("analytics request failed")
	}
	response.Error(w, r, &response.APIError{Status: status, Code: code, Message: message, Cause: err})
}
