package billingmigrationhttp

import (
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/go-chi/chi/v5"
	"net/http"
)

func (h *Handler) readReady(w http.ResponseWriter, r *http.Request) bool {
	if h.services.Reads == nil {
		writeError(w, r, billingmigration.ErrUnavailable)
		return false
	}
	return true
}
func (h *Handler) listSourcePulls(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	limit, ok := readLimit(w, r)
	if !ok {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.SourcePulls(r.Context(), actor(r), p, g, r.URL.Query().Get("cursor"), limit)
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) getSourcePull(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.SourcePull(r.Context(), actor(r), p, g, chi.URLParam(r, "sourcePullId"))
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, record("sourcePullJob", v))
}
func (h *Handler) listProposals(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	l, o := readLimit(w, r)
	if !o {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.Proposals(r.Context(), actor(r), p, g, r.URL.Query().Get("cursor"), l)
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) getProposal(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.Proposal(r.Context(), actor(r), p, g, chi.URLParam(r, "proposalId"))
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, record("migrationProposal", v))
}
func (h *Handler) listApprovals(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	l, o := readLimit(w, r)
	if !o {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.Approvals(r.Context(), actor(r), p, g, r.URL.Query().Get("cursor"), l)
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) getApproval(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.Approval(r.Context(), actor(r), p, g, chi.URLParam(r, "approvalId"))
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, record("migrationApproval", v))
}
func (h *Handler) listCheckpoints(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	l, o := readLimit(w, r)
	if !o {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.Checkpoints(r.Context(), actor(r), p, g, r.URL.Query().Get("cursor"), l)
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) getCheckpoint(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.Checkpoint(r.Context(), actor(r), p, g, chi.URLParam(r, "checkpointId"))
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, record("migrationCheckpoint", v))
}
func (h *Handler) getLatestCheckpoint(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.LatestCheckpoint(r.Context(), actor(r), p, g)
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, record("migrationCheckpoint", v))
}
func (h *Handler) listAuthorityExecutions(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	l, o := readLimit(w, r)
	if !o {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.AuthorityExecutions(r.Context(), actor(r), p, g, r.URL.Query().Get("cursor"), l)
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, v)
}
func (h *Handler) getAuthorityExecution(w http.ResponseWriter, r *http.Request) {
	if !h.readReady(w, r) {
		return
	}
	p, g := projectProgram(r)
	v, e := h.services.Reads.AuthorityExecution(r.Context(), actor(r), p, g, chi.URLParam(r, "executionId"))
	if e != nil {
		writeError(w, r, e)
		return
	}
	response.OK(w, r, record("authorityExecution", v))
}
