package billingmigrationpostgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (r *Repository) RemoveCredential(ctx context.Context, w billingmigration.CredentialRemovalWrite) (billingmigration.CredentialRemoval, bool, error) {
	if !w.IrreversibleAck {
		return billingmigration.CredentialRemoval{}, false, billingmigration.ErrInvalid
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.CredentialRemoval{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, w.Removal.ProgramID, "remove_credential", w.IdempotencyKey, w.RequestDigest)
	if err != nil {
		return billingmigration.CredentialRemoval{}, false, err
	}
	if replay {
		var out billingmigration.CredentialRemoval
		err = scanRemoval(tx.QueryRow(ctx, `SELECT id,program_id,project_id,credential_id,reason,actor_id,early_removal,removal_digest,removed_at FROM billing_migration_credential_removals WHERE id=$1`, resource), &out)
		return out, true, err
	}
	var state, credentialID, environment, organization string
	var stateVersion int64
	var nonce, ciphertext []byte
	var removedAt *time.Time
	var rollbackDays int
	var transitionedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT p.state,p.state_version,p.credential_id,p.environment_id,pr.organization_id,p.rollback_window_days,c.nonce,c.ciphertext,c.removed_at,(SELECT max(transitioned_at) FROM billing_migration_authority_transitions WHERE program_id=p.id AND transition_kind='cutover') FROM billing_migration_programs p JOIN projects pr ON pr.id=p.project_id JOIN billing_migration_credentials c ON c.id=p.credential_id AND c.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2 FOR UPDATE OF p,c`, w.Removal.ProgramID, w.Removal.ProjectID).Scan(&state, &stateVersion, &credentialID, &environment, &organization, &rollbackDays, &nonce, &ciphertext, &removedAt, &transitionedAt)
	if err != nil {
		return billingmigration.CredentialRemoval{}, false, translate(err, "lock migration credential")
	}
	if stateVersion != w.ExpectedState {
		return billingmigration.CredentialRemoval{}, false, billingmigration.ErrStaleState
	}
	if removedAt != nil {
		return billingmigration.CredentialRemoval{}, false, billingmigration.ErrConflict
	}
	if state != "stabilizing" && state != "rolled_back" && state != "ready" && state != "cutover_pending" {
		return billingmigration.CredentialRemoval{}, false, billingmigration.ErrConflict
	}
	envelope := sha256.Sum256(append(append([]byte(nil), nonce...), ciphertext...))
	early := transitionedAt != nil && w.Removal.RemovedAt.Before(transitionedAt.Add(time.Duration(rollbackDays)*24*time.Hour))
	removalRaw, _ := billingmigration.ParseDigest(w.Removal.RemovalDigest)
	w.Removal.CredentialID = credentialID
	w.Removal.Early = early
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_credentials SET nonce=NULL,ciphertext=NULL,removed_at=$2,removed_by_actor_id=$3,removal_digest=$4 WHERE id=$1 AND removed_at IS NULL AND nonce IS NOT NULL AND ciphertext IS NOT NULL`, credentialID, w.Removal.RemovedAt, w.Removal.ActorID, removalRaw)
	if err != nil || tag.RowsAffected() != 1 {
		if err == nil {
			return billingmigration.CredentialRemoval{}, false, billingmigration.ErrConflict
		}
		return billingmigration.CredentialRemoval{}, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_credential_removals(id,program_id,project_id,credential_id,idempotency_key,expected_state_version,reason,early_removal,irreversible_acknowledged,actor_id,envelope_digest,removal_digest,removed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12)`, w.Removal.RemovalID, w.Removal.ProgramID, w.Removal.ProjectID, credentialID, w.IdempotencyKey, w.ExpectedState, w.Removal.Reason, early, w.Removal.ActorID, envelope[:], removalRaw, w.Removal.RemovedAt)
	if err != nil {
		return billingmigration.CredentialRemoval{}, false, translate(err, "append credential removal")
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'remove_credential',$4,$5,$1,$6)`, w.Removal.RemovalID, w.Removal.ProgramID, w.Removal.ProjectID, w.IdempotencyKey, w.RequestDigest, w.Removal.RemovedAt)
	if err != nil {
		return billingmigration.CredentialRemoval{}, false, err
	}
	metadata, _ := json.Marshal(map[string]any{"earlyRemoval": early, "irreversible": true, "reason": w.Removal.Reason})
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES('aud_'||$1,$2,$3,$4,$5,'billing.migration.credential.removed','billing_migration_credential',$6,$7,$8)`, w.Removal.RemovalID, w.Removal.ActorID, organization, w.Removal.ProjectID, environment, credentialID, metadata, w.Removal.RemovedAt)
	if err != nil {
		return billingmigration.CredentialRemoval{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.CredentialRemoval{}, false, err
	}
	return w.Removal, false, nil
}
func scanRemoval(row pgx.Row, out *billingmigration.CredentialRemoval) error {
	var raw []byte
	err := row.Scan(&out.RemovalID, &out.ProgramID, &out.ProjectID, &out.CredentialID, &out.Reason, &out.ActorID, &out.Early, &raw, &out.RemovedAt)
	out.RemovalDigest = billingmigration.FormatDigest(raw)
	return err
}

func (r *Repository) ProposeLegalHold(ctx context.Context, w billingmigration.LegalHoldProposalWrite) (billingmigration.LegalHoldProposal, bool, error) {
	if (len(w.ExpectedPreviousDigest) == 0 && w.Proposal.ExpectedPreviousCommandDigest != "") || (len(w.ExpectedPreviousDigest) == 32 && billingmigration.FormatDigest(w.ExpectedPreviousDigest) != w.Proposal.ExpectedPreviousCommandDigest) || (len(w.ExpectedPreviousDigest) != 0 && len(w.ExpectedPreviousDigest) != 32) {
		return billingmigration.LegalHoldProposal{}, false, billingmigration.ErrInvalid
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.LegalHoldProposal{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	var stored []byte
	err = tx.QueryRow(ctx, `SELECT id,request_digest FROM billing_migration_legal_hold_proposals WHERE program_id=$1 AND idempotency_key=$2`, w.Proposal.ProgramID, w.IdempotencyKey).Scan(&id, &stored)
	if err == nil {
		if !bytes.Equal(stored, w.RequestDigest) {
			return billingmigration.LegalHoldProposal{}, false, billingmigration.ErrIdempotencyConflict
		}
		p, e := legalHoldProposalByID(ctx, tx, id)
		return p, true, e
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.LegalHoldProposal{}, false, err
	}
	var previousCommand string
	var previousDigest []byte
	err = tx.QueryRow(ctx, `SELECT COALESCE(h.command,''),h.command_digest FROM billing_migration_programs p LEFT JOIN LATERAL(SELECT command,command_digest FROM billing_migration_legal_hold_commands WHERE program_id=p.id ORDER BY commanded_at DESC,id DESC LIMIT 1)h ON true WHERE p.id=$1 AND p.project_id=$2 FOR UPDATE OF p`, w.Proposal.ProgramID, w.Proposal.ProjectID).Scan(&previousCommand, &previousDigest)
	if err != nil {
		return billingmigration.LegalHoldProposal{}, false, translate(err, "lock legal hold chain")
	}
	if (previousCommand == "" && len(w.ExpectedPreviousDigest) != 0) || (previousCommand != "" && !bytes.Equal(previousDigest, w.ExpectedPreviousDigest)) {
		return billingmigration.LegalHoldProposal{}, false, billingmigration.ErrStaleDigest
	}
	if (w.Proposal.Command == "set" && previousCommand == "set") || (w.Proposal.Command == "release" && previousCommand != "set") {
		return billingmigration.LegalHoldProposal{}, false, billingmigration.ErrConflict
	}
	raw, _ := billingmigration.ParseDigest(w.Proposal.ProposalDigest)
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_legal_hold_proposals(id,program_id,project_id,command,reason,external_compliance_reference,proposer_actor_id,expected_previous_command_digest,proposal_digest,idempotency_key,request_digest,status,proposed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13)`, w.Proposal.ProposalID, w.Proposal.ProgramID, w.Proposal.ProjectID, w.Proposal.Command, w.Proposal.Reason, w.Proposal.ExternalComplianceReference, w.Proposal.ProposerActorID, w.ExpectedPreviousDigest, raw, w.IdempotencyKey, w.RequestDigest, w.Proposal.ProposedAt, w.Proposal.ExpiresAt)
	if err != nil {
		return billingmigration.LegalHoldProposal{}, false, translate(err, "insert legal hold proposal")
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.LegalHoldProposal{}, false, err
	}
	return w.Proposal, false, nil
}

func (r *Repository) ApproveLegalHold(ctx context.Context, w billingmigration.LegalHoldApprovalWrite) (billingmigration.LegalHold, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, w.ProgramID, "legal_hold_approve", w.IdempotencyKey, w.RequestDigest)
	if err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	if replay {
		h, e := legalHoldByID(ctx, tx, resource)
		return h, true, e
	}
	var p billingmigration.LegalHoldProposal
	var proposalRaw, expectedPrevious []byte
	var mode, previousID, previousCommand string
	var previousDigest []byte
	err = tx.QueryRow(ctx, `SELECT lp.id,lp.program_id,lp.project_id,lp.command,lp.reason,lp.external_compliance_reference,lp.proposer_actor_id,lp.proposal_digest,lp.status,lp.proposed_at,lp.expires_at,lp.expected_previous_command_digest,e.mode,COALESCE(h.id,''),COALESCE(h.command,''),h.command_digest FROM billing_migration_legal_hold_proposals lp JOIN billing_migration_programs mp ON mp.id=lp.program_id JOIN environments e ON e.id=mp.environment_id AND e.project_id=mp.project_id LEFT JOIN LATERAL(SELECT id,command,command_digest FROM billing_migration_legal_hold_commands WHERE program_id=lp.program_id ORDER BY commanded_at DESC,id DESC LIMIT 1)h ON true WHERE lp.id=$1 AND lp.program_id=$2 AND lp.project_id=$3 FOR UPDATE OF lp,mp`, w.ProposalID, w.ProgramID, w.ProjectID).Scan(&p.ProposalID, &p.ProgramID, &p.ProjectID, &p.Command, &p.Reason, &p.ExternalComplianceReference, &p.ProposerActorID, &proposalRaw, &p.Status, &p.ProposedAt, &p.ExpiresAt, &expectedPrevious, &mode, &previousID, &previousCommand, &previousDigest)
	if err != nil {
		return billingmigration.LegalHold{}, false, translate(err, "lock legal hold proposal")
	}
	if p.Status != "pending" {
		return billingmigration.LegalHold{}, false, billingmigration.ErrConflict
	}
	if !p.ExpiresAt.After(w.At) {
		if _, err = tx.Exec(ctx, `UPDATE billing_migration_legal_hold_proposals SET status='expired' WHERE id=$1 AND status='pending'`, w.ProposalID); err != nil {
			return billingmigration.LegalHold{}, false, err
		}
		if err = tx.Commit(ctx); err != nil {
			return billingmigration.LegalHold{}, false, err
		}
		return billingmigration.LegalHold{}, false, billingmigration.ErrExpiredApproval
	}
	if !bytes.Equal(proposalRaw, w.ExpectedProposalDigest) {
		return billingmigration.LegalHold{}, false, billingmigration.ErrStaleDigest
	}
	if (previousID == "" && len(expectedPrevious) != 0) || (previousID != "" && !bytes.Equal(previousDigest, expectedPrevious)) {
		return billingmigration.LegalHold{}, false, billingmigration.ErrStaleDigest
	}
	production := mode == "production"
	if (production && p.ProposerActorID == w.ApproverActorID) || (!production && p.ProposerActorID != w.ApproverActorID) {
		return billingmigration.LegalHold{}, false, billingmigration.ErrForbidden
	}
	var running bool
	err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT status='running' FROM billing_migration_retention_jobs WHERE program_id=$1 FOR UPDATE),false)`, w.ProgramID).Scan(&running)
	if err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	if running {
		return billingmigration.LegalHold{}, false, billingmigration.ErrConflict
	}
	sum := sha256.Sum256(append(proposalRaw, []byte("\x1f"+w.ApproverActorID)...))
	holdID := "mlh_" + hex.EncodeToString(sum[:12])
	commandRaw := sha256.Sum256(append(sum[:], []byte("\x1f"+previousID)...))
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_legal_hold_commands(id,program_id,project_id,proposal_id,command,reason,external_compliance_reference,proposer_actor_id,approver_actor_id,production,previous_command_id,command_digest,commanded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''),$12,$13)`, holdID, w.ProgramID, w.ProjectID, w.ProposalID, p.Command, p.Reason, p.ExternalComplianceReference, p.ProposerActorID, w.ApproverActorID, production, previousID, commandRaw[:], w.At)
	if err != nil {
		return billingmigration.LegalHold{}, false, translate(err, "append legal hold command")
	}
	_, err = tx.Exec(ctx, `UPDATE billing_migration_legal_hold_proposals SET status='approved' WHERE id=$1 AND status='pending'`, w.ProposalID)
	if err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	_, err = tx.Exec(ctx, `UPDATE billing_migration_retention_jobs SET legal_hold=$2,due_at=CASE WHEN $2 THEN due_at ELSE GREATEST(original_due_at,$3) END,updated_at=$3 WHERE program_id=$1`, w.ProgramID, p.Command == "set", w.At)
	if err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'legal_hold_approve',$4,$5,$1,$6)`, holdID, w.ProgramID, w.ProjectID, w.IdempotencyKey, w.RequestDigest, w.At)
	if err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.LegalHold{}, false, err
	}
	return billingmigration.LegalHold{HoldID: holdID, ProposalID: w.ProposalID, ProgramID: w.ProgramID, ProjectID: w.ProjectID, Command: p.Command, Reason: p.Reason, ExternalComplianceReference: p.ExternalComplianceReference, ProposerActorID: p.ProposerActorID, ApproverActorID: w.ApproverActorID, PreviousCommandID: previousID, CommandDigest: billingmigration.FormatDigest(commandRaw[:]), Production: production, CommandedAt: w.At}, false, nil
}

func legalHoldProposalByID(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (billingmigration.LegalHoldProposal, error) {
	var p billingmigration.LegalHoldProposal
	var raw, previous []byte
	err := q.QueryRow(ctx, `SELECT id,program_id,project_id,command,reason,external_compliance_reference,proposer_actor_id,expected_previous_command_digest,proposal_digest,status,proposed_at,expires_at FROM billing_migration_legal_hold_proposals WHERE id=$1`, id).Scan(&p.ProposalID, &p.ProgramID, &p.ProjectID, &p.Command, &p.Reason, &p.ExternalComplianceReference, &p.ProposerActorID, &previous, &raw, &p.Status, &p.ProposedAt, &p.ExpiresAt)
	if len(previous) == 32 {
		p.ExpectedPreviousCommandDigest = billingmigration.FormatDigest(previous)
	}
	p.ProposalDigest = billingmigration.FormatDigest(raw)
	return p, err
}
func legalHoldByID(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (billingmigration.LegalHold, error) {
	var h billingmigration.LegalHold
	var raw []byte
	err := q.QueryRow(ctx, `SELECT id,proposal_id,program_id,project_id,command,reason,external_compliance_reference,proposer_actor_id,approver_actor_id,production,COALESCE(previous_command_id,''),command_digest,commanded_at FROM billing_migration_legal_hold_commands WHERE id=$1`, id).Scan(&h.HoldID, &h.ProposalID, &h.ProgramID, &h.ProjectID, &h.Command, &h.Reason, &h.ExternalComplianceReference, &h.ProposerActorID, &h.ApproverActorID, &h.Production, &h.PreviousCommandID, &raw, &h.CommandedAt)
	h.CommandDigest = billingmigration.FormatDigest(raw)
	return h, err
}

func (r *Repository) CompletionPrerequisites(ctx context.Context, projectID, programID string, now time.Time) (billingmigration.CompletionPrerequisites, error) {
	var p billingmigration.CompletionPrerequisites
	p.ProgramID, p.ProjectID = programID, projectID
	var policy []byte
	var removedAt *time.Time
	var transitionAt time.Time
	var stabilizationDays, rollbackDays, maxAge int
	err := r.pool.QueryRow(ctx, `SELECT p.state,p.state_version,p.policy_digest,c.removed_at,p.stabilization_days,p.rollback_window_days,(SELECT max(transitioned_at) FROM billing_migration_authority_transitions WHERE program_id=p.id AND transition_kind='cutover'),rp.watermark_max_age_seconds FROM billing_migration_programs p JOIN billing_migration_credentials c ON c.id=p.credential_id AND c.project_id=p.project_id JOIN billing_migration_readiness_policies rp ON rp.program_id=p.id AND rp.policy_digest=p.policy_digest WHERE p.id=$1 AND p.project_id=$2`, programID, projectID).Scan(&p.State, &p.StateVersion, &policy, &removedAt, &stabilizationDays, &rollbackDays, &transitionAt, &maxAge)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, billingmigration.ErrNotFound
	}
	if err != nil {
		return p, translate(err, "inspect completion prerequisites")
	}
	p.PolicyDigest = billingmigration.FormatDigest(policy)
	p.CredentialRemoved = removedAt != nil
	p.StabilizationEndsAt = transitionAt.Add(time.Duration(stabilizationDays) * 24 * time.Hour)
	p.RollbackWindowEndsAt = transitionAt.Add(time.Duration(rollbackDays) * 24 * time.Hour)
	err = r.pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_cases WHERE program_id=$1 AND classification IN('critical','blocking') AND status IN('open','in_progress')`, programID).Scan(&p.UnresolvedCriticalBlocking)
	if err != nil {
		return p, err
	}
	var authority, stability []byte
	err = r.pool.QueryRow(ctx, `WITH current_scopes AS (SELECT a.application_id,a.platform,a.current_epoch,a.authority_digest FROM billing_migration_authority_scopes a WHERE a.active_program_id=$1 AND a.current_authority='mosaic'),latest_sync AS (SELECT DISTINCT ON(o.application_id,o.platform)o.application_id,o.platform,o.observation_digest FROM billing_migration_v2_sync_observations o JOIN current_scopes s USING(application_id,platform) WHERE o.program_id=$1 AND o.sync_result='accepted' AND o.authority_epoch=s.current_epoch AND o.observed_at BETWEEN ($2::timestamptz-($3::integer*interval '1 second')) AND $2::timestamptz ORDER BY o.application_id,o.platform,o.observed_at DESC,o.id DESC) SELECT sha256(convert_to(string_agg(encode(s.authority_digest,'hex'),'' ORDER BY s.application_id,s.platform),'UTF8')),sha256(convert_to(string_agg(encode(o.observation_digest,'hex'),'' ORDER BY o.application_id,o.platform),'UTF8')) FROM current_scopes s JOIN latest_sync o USING(application_id,platform) HAVING count(*)=(SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1)`, programID, now, maxAge).Scan(&authority, &stability)
	if err == nil {
		p.AuthorityDigest = billingmigration.FormatDigest(authority)
		p.StabilityEvidenceDigest = billingmigration.FormatDigest(stability)
		p.AuthorityStable = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return p, err
	}
	err = r.pool.QueryRow(ctx, `SELECT NOT EXISTS(
		SELECT 1 FROM webhook_destinations
		WHERE project_id=$1
		  AND environment_id=(SELECT environment_id FROM billing_migration_programs WHERE id=$2)
		  AND status='active'
		  AND (contract_version=2
		       AND last_successful_test_at >= ($3::timestamptz - ($4::integer * interval '1 second'))
		       AND last_successful_test_at <= $3::timestamptz) IS NOT TRUE
	)`, projectID, programID, now, maxAge).Scan(&p.WebhookReady)
	if err != nil {
		return p, err
	}
	p.Eligible = p.State == "stabilizing" && p.CredentialRemoved && p.UnresolvedCriticalBlocking == 0 && p.AuthorityStable && p.WebhookReady && !now.Before(p.StabilizationEndsAt) && !now.Before(p.RollbackWindowEndsAt)
	return p, nil
}

func (r *Repository) CompleteMigration(ctx context.Context, w billingmigration.CompletionWrite) (billingmigration.CompletionReport, bool, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.CompletionReport{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	resource, replay, err := operationCommandReplay(ctx, tx, w.Report.ProgramID, "complete_migration", w.IdempotencyKey, w.RequestDigest)
	if err != nil {
		return billingmigration.CompletionReport{}, false, err
	}
	if replay {
		report, err := completionByID(ctx, tx, resource)
		return report, true, err
	}
	var state, credentialID, environment, organization string
	var version int64
	var stabilizationDays, rollbackDays, maxAge int
	var policy []byte
	var removedAt *time.Time
	var transitionAt time.Time
	err = tx.QueryRow(ctx, `SELECT p.state,p.state_version,p.credential_id,p.environment_id,pr.organization_id,p.stabilization_days,p.rollback_window_days,p.policy_digest,c.removed_at,rp.watermark_max_age_seconds FROM billing_migration_programs p JOIN projects pr ON pr.id=p.project_id JOIN billing_migration_credentials c ON c.id=p.credential_id AND c.project_id=p.project_id JOIN billing_migration_readiness_policies rp ON rp.program_id=p.id AND rp.policy_digest=p.policy_digest WHERE p.id=$1 AND p.project_id=$2 FOR UPDATE OF p,c`, w.Report.ProgramID, w.Report.ProjectID).Scan(&state, &version, &credentialID, &environment, &organization, &stabilizationDays, &rollbackDays, &policy, &removedAt, &maxAge)
	if err != nil {
		return billingmigration.CompletionReport{}, false, translate(err, "lock completion prerequisites")
	}
	err = tx.QueryRow(ctx, `SELECT max(transitioned_at) FROM billing_migration_authority_transitions WHERE program_id=$1 AND transition_kind='cutover'`, w.Report.ProgramID).Scan(&transitionAt)
	if err != nil {
		return billingmigration.CompletionReport{}, false, translate(err, "read completion cutover time")
	}
	if state != "stabilizing" || version != w.ExpectedStateVersion || !bytes.Equal(policy, w.ExpectedPolicyDigest) || removedAt == nil {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrConflict
	}
	stabilizationEnd := transitionAt.Add(time.Duration(stabilizationDays) * 24 * time.Hour)
	rollbackEnd := transitionAt.Add(time.Duration(rollbackDays) * 24 * time.Hour)
	if w.Report.CompletedAt.Before(stabilizationEnd) || w.Report.CompletedAt.Before(rollbackEnd) {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrRollbackWindow
	}
	var unhealthy int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM billing_migration_cases WHERE program_id=$1 AND classification IN('critical','blocking') AND status IN('open','in_progress')`, w.Report.ProgramID).Scan(&unhealthy)
	if err != nil || unhealthy != 0 {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrConflict
	}
	var authorityRaw, stabilityRaw []byte
	err = tx.QueryRow(ctx, `WITH current_scopes AS (
        SELECT a.application_id,a.platform,a.current_epoch,a.authority_digest
        FROM billing_migration_authority_scopes a WHERE a.active_program_id=$1 AND a.current_authority='mosaic'
    ), latest_sync AS (
        SELECT DISTINCT ON (o.application_id,o.platform) o.application_id,o.platform,o.observation_digest
        FROM billing_migration_v2_sync_observations o JOIN current_scopes s USING(application_id,platform)
		WHERE o.program_id=$1 AND o.sync_result='accepted' AND o.authority_epoch=s.current_epoch AND o.observed_at BETWEEN ($2::timestamptz-($3::integer*interval '1 second')) AND $2::timestamptz
        ORDER BY o.application_id,o.platform,o.observed_at DESC,o.id DESC
    ) SELECT
        sha256(convert_to(string_agg(encode(s.authority_digest,'hex'),'' ORDER BY s.application_id,s.platform),'UTF8')),
        sha256(convert_to(string_agg(encode(o.observation_digest,'hex'),'' ORDER BY o.application_id,o.platform),'UTF8'))
    FROM current_scopes s JOIN latest_sync o USING(application_id,platform)
	HAVING count(*)=(SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1)`, w.Report.ProgramID, w.Report.CompletedAt, maxAge).Scan(&authorityRaw, &stabilityRaw)
	if err != nil || !bytes.Equal(authorityRaw, w.AuthorityDigest) || !bytes.Equal(stabilityRaw, w.StabilityDigest) {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrStaleDigest
	}
	var webhookReady bool
	err = tx.QueryRow(ctx, `SELECT NOT EXISTS(
		SELECT 1 FROM webhook_destinations
		WHERE project_id=$1 AND environment_id=$2 AND status='active'
		  AND (contract_version=2
		       AND last_successful_test_at >= ($3::timestamptz - ($4::integer * interval '1 second'))
		       AND last_successful_test_at <= $3::timestamptz) IS NOT TRUE
	)`, w.Report.ProjectID, environment, w.Report.CompletedAt, maxAge).Scan(&webhookReady)
	if err != nil || !webhookReady {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrConflict
	}
	var hold bool
	_ = tx.QueryRow(ctx, `SELECT COALESCE((SELECT command='set' FROM billing_migration_legal_hold_commands WHERE program_id=$1 ORDER BY commanded_at DESC,id DESC LIMIT 1),false)`, w.Report.ProgramID).Scan(&hold)
	w.Report.StabilizationEndedAt = stabilizationEnd
	w.Report.RollbackWindowEndedAt = rollbackEnd
	w.Report.CredentialRemovedAt = *removedAt
	w.Report.LegalHold = hold
	if !hold {
		due := w.Report.CompletedAt.Add(30 * 24 * time.Hour)
		w.Report.SourceObjectsDeleteAt = &due
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_completion_reports(id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest,authority_digest,stability_evidence_digest,completion_policy_digest) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14)`, w.Report.ReportID, w.Report.ProgramID, w.Report.ProjectID, w.Report.StateVersion, w.Report.CompletedAt, stabilizationEnd, rollbackEnd, *removedAt, hold, w.Report.SourceObjectsDeleteAt, w.CompletionDigest, w.AuthorityDigest, w.StabilityDigest, w.ExpectedPolicyDigest)
	if err != nil {
		return billingmigration.CompletionReport{}, false, translate(err, "append completion report")
	}
	due := w.Report.CompletedAt.Add(30 * 24 * time.Hour)
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_retention_jobs(id,program_id,project_id,status,legal_hold,due_at,lease_generation,created_at,updated_at,completion_report_id,attempt_count,max_attempts,deletion_identity,original_due_at) VALUES($1,$2,$3,'pending',$4,$5,0,$6,$6,$7,0,8,$8,$5)`, w.RetentionJobID, w.Report.ProgramID, w.Report.ProjectID, hold, due, w.Report.CompletedAt, w.Report.ReportID, w.DeletionIdentity)
	if err != nil {
		return billingmigration.CompletionReport{}, false, translate(err, "enqueue raw source retention")
	}
	tag, err := tx.Exec(ctx, `UPDATE billing_migration_programs SET state='completed',state_version=state_version+1,updated_at=$3 WHERE id=$1 AND state_version=$2 AND state='stabilizing'`, w.Report.ProgramID, w.ExpectedStateVersion, w.Report.CompletedAt)
	if err != nil || tag.RowsAffected() != 1 {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrStaleState
	}
	outboxTag, err := tx.Exec(ctx, `INSERT INTO billing_migration_transition_outbox(id,program_id,project_id,authority_scope_id,transition_id,event_kind,authority_epoch,status,attempt_count,lease_owner,lease_expires_at,created_at,updated_at,checkpoint_id,completion_report_id,correlation_id,due_at,lease_generation,max_attempts,legacy_event_kind) SELECT 'mto_'||substr(md5($1||':'||a.id),1,20),$2,$3,a.id,NULL,'stabilization_completed',a.current_epoch,'pending',0,NULL,NULL,$4,$4,c.id,$1,$1,$4,0,8,false FROM billing_migration_authority_scopes a CROSS JOIN LATERAL(SELECT id FROM billing_migration_checkpoints WHERE program_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1)c WHERE a.active_program_id=$2`, w.Report.ReportID, w.Report.ProgramID, w.Report.ProjectID, w.Report.CompletedAt)
	if err != nil {
		return billingmigration.CompletionReport{}, false, translate(err, "enqueue stabilization completion")
	}
	var scopeCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM billing_migration_program_scopes WHERE program_id=$1`, w.Report.ProgramID).Scan(&scopeCount); err != nil || outboxTag.RowsAffected() != scopeCount {
		return billingmigration.CompletionReport{}, false, billingmigration.ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_command_idempotency(id,program_id,project_id,command_kind,idempotency_key,request_digest,resource_id,created_at) VALUES('mci_'||$1,$2,$3,'complete_migration',$4,$5,$1,$6)`, w.Report.ReportID, w.Report.ProgramID, w.Report.ProjectID, w.IdempotencyKey, w.RequestDigest, w.Report.CompletedAt)
	if err != nil {
		return billingmigration.CompletionReport{}, false, err
	}
	metadata, _ := json.Marshal(map[string]any{"retentionDueAt": due, "legalHold": hold})
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,action,resource_type,resource_id,metadata,created_at) VALUES('aud_'||$1,$2,$3,$4,$5,'billing.migration.completed','billing_migration_program',$6,$7,$8)`, w.Report.ReportID, w.ActorID, organization, w.Report.ProjectID, environment, w.Report.ProgramID, metadata, w.Report.CompletedAt)
	if err != nil {
		return billingmigration.CompletionReport{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return billingmigration.CompletionReport{}, false, err
	}
	return w.Report, false, nil
}

func completionByID(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (billingmigration.CompletionReport, error) {
	var r billingmigration.CompletionReport
	var completion, authority, stability, policy []byte
	err := q.QueryRow(ctx, `SELECT id,program_id,project_id,state_version,completed_at,stabilization_ended_at,rollback_window_ended_at,credential_removed_at,legal_hold,source_objects_delete_at,completion_digest,authority_digest,stability_evidence_digest,completion_policy_digest FROM billing_migration_completion_reports WHERE id=$1`, id).Scan(&r.ReportID, &r.ProgramID, &r.ProjectID, &r.StateVersion, &r.CompletedAt, &r.StabilizationEndedAt, &r.RollbackWindowEndedAt, &r.CredentialRemovedAt, &r.LegalHold, &r.SourceObjectsDeleteAt, &completion, &authority, &stability, &policy)
	r.CompletionDigest = billingmigration.FormatDigest(completion)
	r.AuthorityDigest = billingmigration.FormatDigest(authority)
	r.StabilityEvidenceDigest = billingmigration.FormatDigest(stability)
	r.PolicyDigest = billingmigration.FormatDigest(policy)
	return r, err
}

func (r *Repository) ClaimRetention(ctx context.Context, c billingmigration.RetentionClaim) (billingmigration.RetentionLease, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return billingmigration.RetentionLease{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var l billingmigration.RetentionLease
	err = tx.QueryRow(ctx, `SELECT id,program_id,project_id,lease_generation+1,attempt_count+1,max_attempts,legal_hold FROM billing_migration_retention_jobs WHERE NOT legal_hold AND status IN('pending','running') AND due_at<=$1 AND attempt_count<max_attempts AND (status='pending' OR lease_expires_at<=$1) ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, c.Now).Scan(&l.JobID, &l.ProgramID, &l.ProjectID, &l.Generation, &l.AttemptNumber, &l.MaxAttempts, &l.LegalHold)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, billingmigration.ErrNotFound
	}
	if err != nil {
		return l, err
	}
	_, err = tx.Exec(ctx, `UPDATE billing_migration_retention_jobs SET status='running',lease_owner=$2,lease_expires_at=$3,lease_generation=$4,attempt_count=$5,updated_at=$1 WHERE id=$6`, c.Now, c.WorkerID, c.Now.Add(c.LeaseFor), l.Generation, l.AttemptNumber, l.JobID)
	if err != nil {
		return l, err
	}
	rows, err := tx.Query(ctx, `SELECT object_key FROM billing_migration_source_objects WHERE program_id=$1 AND project_id=$2 AND state='verified' ORDER BY object_key`, l.ProgramID, l.ProjectID)
	if err != nil {
		return l, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			return l, err
		}
		l.ObjectKeys = append(l.ObjectKeys, key)
	}
	if err = rows.Err(); err != nil {
		return l, err
	}
	if err = tx.Commit(ctx); err != nil {
		return l, err
	}
	return l, nil
}

func (r *Repository) SettleRetentionObject(ctx context.Context, s billingmigration.RetentionObjectSettlement) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var generation int64
	var status string
	err = tx.QueryRow(ctx, `SELECT lease_generation,status FROM billing_migration_retention_jobs WHERE id=$1 FOR UPDATE`, s.JobID).Scan(&generation, &status)
	if err != nil {
		return err
	}
	if generation != s.Generation || status != "running" {
		return billingmigration.ErrConflict
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x1f%x\x1f%d", s.JobID, s.ObjectKeyDigest, s.AttemptNumber)))
	id := "mod_" + hex.EncodeToString(sum[:12])
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_object_deletions(id,program_id,project_id,manifest_id,object_key_digest,deletion_result,deletion_digest,deleted_at,retention_job_id,attempt_number) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9) ON CONFLICT(retention_job_id,object_key_digest,attempt_number) DO NOTHING`, id, s.ProgramID, s.ProjectID, s.ObjectKeyDigest, s.Result, s.DeletionDigest, s.At, s.JobID, s.AttemptNumber)
	if err != nil {
		return err
	}
	if s.Result == "deleted" || s.Result == "not_found" {
		_, err = tx.Exec(ctx, `UPDATE billing_migration_source_objects SET state='deleted',deleted_at=$4,deletion_actor_id='retention:'||$5 WHERE program_id=$1 AND project_id=$2 AND object_key=$3 AND state='verified'`, s.ProgramID, s.ProjectID, s.ObjectKey, s.At, s.JobID)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) FinishRetention(ctx context.Context, f billingmigration.RetentionFinish) error {
	var tag pgconn.CommandTag
	var tagErr error
	if f.ErrorCode == "" {
		tag, tagErr = r.pool.Exec(ctx, `UPDATE billing_migration_retention_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$3 WHERE id=$1 AND lease_generation=$2 AND status='running'`, f.JobID, f.Generation, f.At)
	} else if f.ErrorCode == "legal_hold" {
		tag, tagErr = r.pool.Exec(ctx, `UPDATE billing_migration_retention_jobs SET status='pending',legal_hold=true,due_at=$3+interval '24 hours',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$3 WHERE id=$1 AND lease_generation=$2 AND status='running'`, f.JobID, f.Generation, f.At)
	} else {
		tag, tagErr = r.pool.Exec(ctx, `UPDATE billing_migration_retention_jobs SET status=CASE WHEN attempt_count>=max_attempts THEN 'failed' ELSE 'pending' END,due_at=CASE WHEN attempt_count>=max_attempts THEN due_at ELSE $3 END,lease_owner=NULL,lease_expires_at=NULL,last_error_code=CASE WHEN attempt_count>=max_attempts THEN $4 ELSE NULL END,updated_at=$5 WHERE id=$1 AND lease_generation=$2 AND status='running'`, f.JobID, f.Generation, f.RetryAt, f.ErrorCode, f.At)
	}
	if tagErr != nil {
		return tagErr
	}
	if tag.RowsAffected() != 1 {
		return billingmigration.ErrConflict
	}
	return nil
}
