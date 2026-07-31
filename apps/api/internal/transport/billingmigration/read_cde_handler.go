package billingmigrationhttp

import (
	"net/http"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/httpserver/response"
	"github.com/go-chi/chi/v5"
)

func registerOperationalReadRoutes(programs chi.Router, h *Handler) {
	programs.Get("/{programId}/proposals", h.listProposals)
	programs.Get("/{programId}/proposals/{proposalId}", h.getProposal)
	programs.Get("/{programId}/approvals", h.listApprovals)
	programs.Get("/{programId}/approvals/{approvalId}", h.getApproval)
	programs.Get("/{programId}/checkpoints", h.listCheckpoints)
	programs.Get("/{programId}/checkpoints/latest", h.getLatestCheckpoint)
	programs.Get("/{programId}/checkpoints/{checkpointId}", h.getCheckpoint)
	programs.Get("/{programId}/authority-executions", h.listAuthorityExecutions)
	programs.Get("/{programId}/authority-executions/{executionId}", h.getAuthorityExecution)
	programs.Get("/{programId}/cases", h.listCases)
	programs.Get("/{programId}/cases/{caseId}", h.getCase)
	programs.Get("/{programId}/cases/{caseId}/actions", h.listCaseActions)
	programs.Get("/{programId}/repair-previews", h.listRepairPreviews)
	programs.Get("/{programId}/repair-previews/{previewId}", h.getRepairPreview)
	programs.Get("/{programId}/repair-executions", h.listRepairExecutions)
	programs.Get("/{programId}/repair-executions/{executionId}", h.getRepairExecution)
	programs.Get("/{programId}/webhook-redeliveries", h.listWebhookRedeliveries)
	programs.Get("/{programId}/webhook-redeliveries/{redeliveryId}", h.getWebhookRedelivery)
	programs.Get("/{programId}/credential-removals", h.listCredentialRemovals)
	programs.Get("/{programId}/credential-removals/current", h.getCurrentCredentialRemoval)
	programs.Get("/{programId}/credential-removals/{removalId}", h.getCredentialRemoval)
	programs.Get("/{programId}/legal-hold-proposals", h.listLegalHoldProposals)
	programs.Get("/{programId}/legal-hold-proposals/{proposalId}", h.getLegalHoldProposal)
	programs.Get("/{programId}/legal-holds", h.listLegalHolds)
	programs.Get("/{programId}/legal-holds/current", h.getCurrentLegalHold)
	programs.Get("/{programId}/legal-holds/{holdId}", h.getLegalHold)
	programs.Get("/{programId}/completion-history", h.listCompletionReports)
	programs.Get("/{programId}/completion-history/{reportId}", h.getCompletionReport)
}

func registerStabilizationRoutes(programs chi.Router, h *Handler) {
	programs.Post("/{programId}/stabilization-policy", h.freezeStabilizationPolicy)
	programs.Get("/{programId}/stabilization-policy/current", h.getCurrentStabilizationPolicy)
	programs.Post("/{programId}/stabilization-observations", h.observeStabilization)
	programs.Get("/{programId}/stabilization-observations", h.listStabilizationObservations)
	programs.Get("/{programId}/stabilization-observations/latest", h.getLatestStabilizationObservation)
	programs.Post("/{programId}/rollback-readiness-assessments", h.assessRollbackReadiness)
	programs.Get("/{programId}/rollback-readiness-assessments", h.listRollbackReadinessAssessments)
	programs.Get("/{programId}/rollback-readiness-assessments/latest", h.getLatestRollbackReadinessAssessment)
	programs.Get("/{programId}/rollback-readiness-checkpoints/latest", h.getLatestRollbackReadinessCheckpoint)
}

func serveTypedList[T any](h *Handler, w http.ResponseWriter, r *http.Request, read func(string, string, string, int) (T, error)) {
	if !h.readReady(w, r) {
		return
	}
	limit, ok := readLimit(w, r)
	if !ok {
		return
	}
	projectID, programID := projectProgram(r)
	page, err := read(projectID, programID, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, page)
}
func serveTypedDetail[T any](h *Handler, w http.ResponseWriter, r *http.Request, kind string, read func(string, string) (T, error)) {
	if !h.readReady(w, r) {
		return
	}
	projectID, programID := projectProgram(r)
	item, err := read(projectID, programID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	response.OK(w, r, record(kind, item))
}

func (h *Handler) listCases(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.CasePage, error) {
		return h.services.Reads.Cases(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getCase(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "migrationCase", func(p, g string) (billingmigration.MigrationCase, error) {
		return h.services.Reads.Case(r.Context(), actor(r), p, g, chi.URLParam(r, "caseId"))
	})
}
func (h *Handler) listCaseActions(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.CaseActionPage, error) {
		return h.services.Reads.CaseActions(r.Context(), actor(r), p, g, chi.URLParam(r, "caseId"), c, l)
	})
}
func (h *Handler) listRepairPreviews(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.RepairPreviewPage, error) {
		return h.services.Reads.RepairPreviews(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getRepairPreview(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "repairPreview", func(p, g string) (billingmigration.RepairPreviewRecord, error) {
		return h.services.Reads.RepairPreview(r.Context(), actor(r), p, g, chi.URLParam(r, "previewId"))
	})
}
func (h *Handler) listRepairExecutions(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.RepairExecutionPage, error) {
		return h.services.Reads.RepairExecutions(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getRepairExecution(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "repairExecution", func(p, g string) (billingmigration.RepairExecutionRecord, error) {
		return h.services.Reads.RepairExecution(r.Context(), actor(r), p, g, chi.URLParam(r, "executionId"))
	})
}
func (h *Handler) listWebhookRedeliveries(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.RedeliveryPage, error) {
		return h.services.Reads.Redeliveries(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getWebhookRedelivery(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "webhookRedelivery", func(p, g string) (billingmigration.RedeliveryRecord, error) {
		return h.services.Reads.Redelivery(r.Context(), actor(r), p, g, chi.URLParam(r, "redeliveryId"))
	})
}
func (h *Handler) listCredentialRemovals(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.CredentialRemovalPage, error) {
		return h.services.Reads.CredentialRemovals(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getCredentialRemoval(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "credentialRemoval", func(p, g string) (billingmigration.CredentialRemovalRecord, error) {
		return h.services.Reads.CredentialRemoval(r.Context(), actor(r), p, g, chi.URLParam(r, "removalId"))
	})
}
func (h *Handler) getCurrentCredentialRemoval(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "credentialRemoval", func(p, g string) (billingmigration.CredentialRemovalRecord, error) {
		return h.services.Reads.CurrentCredentialRemoval(r.Context(), actor(r), p, g)
	})
}
func (h *Handler) listLegalHoldProposals(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.LegalHoldProposalPage, error) {
		return h.services.Reads.LegalHoldProposals(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getLegalHoldProposal(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "legalHoldProposal", func(p, g string) (billingmigration.LegalHoldProposalRecord, error) {
		return h.services.Reads.LegalHoldProposal(r.Context(), actor(r), p, g, chi.URLParam(r, "proposalId"))
	})
}
func (h *Handler) listLegalHolds(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.LegalHoldPage, error) {
		return h.services.Reads.LegalHolds(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getLegalHold(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "legalHold", func(p, g string) (billingmigration.LegalHoldRecord, error) {
		return h.services.Reads.LegalHold(r.Context(), actor(r), p, g, chi.URLParam(r, "holdId"))
	})
}
func (h *Handler) getCurrentLegalHold(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "legalHold", func(p, g string) (billingmigration.LegalHoldRecord, error) {
		return h.services.Reads.CurrentLegalHold(r.Context(), actor(r), p, g)
	})
}
func (h *Handler) listCompletionReports(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.CompletionReportPage, error) {
		return h.services.Reads.CompletionReports(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getCompletionReport(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "completionReport", func(p, g string) (billingmigration.CompletionReportRecord, error) {
		return h.services.Reads.CompletionReport(r.Context(), actor(r), p, g, chi.URLParam(r, "reportId"))
	})
}
func (h *Handler) getCurrentStabilizationPolicy(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "stabilizationPolicy", func(p, g string) (billingmigration.StabilizationPolicyRecord, error) {
		return h.services.Reads.CurrentStabilizationPolicy(r.Context(), actor(r), p, g)
	})
}
func (h *Handler) listStabilizationObservations(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.StabilizationObservationPage, error) {
		return h.services.Reads.StabilizationObservations(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getLatestStabilizationObservation(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "stabilizationObservation", func(p, g string) (billingmigration.StabilizationObservationRecord, error) {
		return h.services.Reads.LatestStabilizationObservation(r.Context(), actor(r), p, g)
	})
}
func (h *Handler) listRollbackReadinessAssessments(w http.ResponseWriter, r *http.Request) {
	serveTypedList(h, w, r, func(p, g, c string, l int) (billingmigration.RollbackReadinessAssessmentPage, error) {
		return h.services.Reads.RollbackReadinessAssessments(r.Context(), actor(r), p, g, c, l)
	})
}
func (h *Handler) getLatestRollbackReadinessAssessment(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "rollbackReadinessAssessment", func(p, g string) (billingmigration.RollbackReadinessAssessmentRecord, error) {
		return h.services.Reads.LatestRollbackReadinessAssessment(r.Context(), actor(r), p, g)
	})
}
func (h *Handler) getLatestRollbackReadinessCheckpoint(w http.ResponseWriter, r *http.Request) {
	serveTypedDetail(h, w, r, "rollbackReadinessCheckpoint", func(p, g string) (billingmigration.RollbackReadinessCheckpointRecord, error) {
		return h.services.Reads.LatestRollbackReadinessCheckpoint(r.Context(), actor(r), p, g)
	})
}
