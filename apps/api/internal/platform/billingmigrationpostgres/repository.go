// Package billingmigrationpostgres persists Phase 9C migration evidence.
package billingmigrationpostgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type Repository struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ billingmigration.Repository = (*Repository)(nil)

var capabilityRoles = map[string]map[string]bool{
	billingmigration.CapabilityView:              {"member": true, "admin": true, "owner": true},
	billingmigration.CapabilityManageSource:      {"owner": true},
	billingmigration.CapabilityManageMappings:    {"admin": true, "owner": true},
	billingmigration.CapabilityRunImport:         {"admin": true, "owner": true},
	billingmigration.CapabilityAssessReadiness:   {"owner": true},
	billingmigration.CapabilityProposeCutover:    {"admin": true, "owner": true},
	billingmigration.CapabilityApproveCutover:    {"owner": true},
	billingmigration.CapabilityExecuteCutover:    {"owner": true},
	billingmigration.CapabilityExecuteRollback:   {"owner": true},
	billingmigration.CapabilityResolveCases:      {"admin": true, "owner": true},
	billingmigration.CapabilityExecuteRepair:     {"owner": true},
	billingmigration.CapabilityDeleteSource:      {"owner": true},
	billingmigration.CapabilityRemoveCredential:  {"owner": true},
	billingmigration.CapabilityManageLegalHold:   {"owner": true},
	billingmigration.CapabilityCompleteMigration: {"owner": true},
}

var orderedOperatorCapabilities = []string{
	billingmigration.CapabilityView, billingmigration.CapabilityManageSource, billingmigration.CapabilityManageMappings,
	billingmigration.CapabilityRunImport, billingmigration.CapabilityAssessReadiness, billingmigration.CapabilityProposeCutover,
	billingmigration.CapabilityApproveCutover, billingmigration.CapabilityExecuteCutover, billingmigration.CapabilityExecuteRollback,
	billingmigration.CapabilityResolveCases, billingmigration.CapabilityExecuteRepair, billingmigration.CapabilityDeleteSource,
	billingmigration.CapabilityRemoveCredential, billingmigration.CapabilityManageLegalHold, billingmigration.CapabilityCompleteMigration,
}

func (r *Repository) AllowedCapabilities(ctx context.Context, actor billingmigration.Actor, projectID string) ([]string, error) {
	if strings.TrimSpace(actor.ID) == "" {
		return nil, billingmigration.ErrUnauthenticated
	}
	var role string
	err := r.pool.QueryRow(ctx, `SELECT m.role FROM projects p JOIN organization_members m ON m.organization_id=p.organization_id WHERE p.id=$1 AND m.actor_id=$2`, projectID, actor.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, billingmigration.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read billing migration operator capabilities: %w", err)
	}
	allowed := make([]string, 0, len(orderedOperatorCapabilities))
	for _, capability := range orderedOperatorCapabilities {
		if capabilityRoles[capability][role] {
			allowed = append(allowed, capability)
		}
	}
	return allowed, nil
}

func (r *Repository) Authorize(ctx context.Context, actor billingmigration.Actor, projectID, capability string) (billingmigration.Authorization, error) {
	if strings.TrimSpace(actor.ID) == "" {
		return billingmigration.Authorization{}, billingmigration.ErrUnauthenticated
	}
	var authorization billingmigration.Authorization
	err := r.pool.QueryRow(ctx, `SELECT p.organization_id, m.role FROM projects p
		JOIN organization_members m ON m.organization_id=p.organization_id
		WHERE p.id=$1 AND m.actor_id=$2`, projectID, actor.ID).
		Scan(&authorization.OrganizationID, &authorization.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.Authorization{}, billingmigration.ErrNotFound
	}
	if err != nil {
		return billingmigration.Authorization{}, fmt.Errorf("authorize billing migration: %w", err)
	}
	roles, knownCapability := capabilityRoles[capability]
	if !knownCapability || !roles[authorization.Role] {
		return billingmigration.Authorization{}, billingmigration.ErrForbidden
	}
	return authorization, nil
}

func (r *Repository) Idempotency(ctx context.Context, projectID, key string) (billingmigration.StoredIdempotency, error) {
	var stored billingmigration.StoredIdempotency
	err := r.pool.QueryRow(ctx, `SELECT id, request_digest FROM billing_migration_programs
		WHERE project_id=$1 AND idempotency_key=$2`, projectID, key).
		Scan(&stored.ProgramID, &stored.RequestDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return stored, billingmigration.ErrNotFound
	}
	if err != nil {
		return stored, fmt.Errorf("read migration idempotency: %w", err)
	}
	return stored, nil
}

func (r *Repository) CreateProgram(ctx context.Context, command billingmigration.CreateProgramCommand) (billingmigration.ProgramDetail, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return billingmigration.ProgramDetail{}, fmt.Errorf("begin migration program: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var organizationID, role string
	if err := tx.QueryRow(ctx, `SELECT p.organization_id,m.role FROM projects p
		JOIN environments e ON e.project_id=p.id
		JOIN organization_members m ON m.organization_id=p.organization_id AND m.actor_id=$3
		WHERE p.id=$1 AND e.id=$2`, command.Program.Scope.ProjectID,
		command.Program.Scope.EnvironmentID, command.ActorID).Scan(&organizationID, &role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return billingmigration.ProgramDetail{}, billingmigration.ErrNotFound
		}
		return billingmigration.ProgramDetail{}, fmt.Errorf("validate migration environment: %w", err)
	}
	if organizationID != command.OrganizationID {
		return billingmigration.ProgramDetail{}, billingmigration.ErrConflict
	}
	if !capabilityRoles[billingmigration.CapabilityManageSource][role] {
		return billingmigration.ProgramDetail{}, billingmigration.ErrForbidden
	}
	for _, scope := range command.Program.Scope.Applications {
		var exists bool
		err := tx.QueryRow(ctx, `SELECT true FROM applications WHERE id=$1 AND project_id=$2 AND platform=$3`,
			scope.ApplicationID, command.Program.Scope.ProjectID, scope.Platform).Scan(&exists)
		if errors.Is(err, pgx.ErrNoRows) {
			return billingmigration.ProgramDetail{}, billingmigration.ErrInvalid
		}
		if err != nil {
			return billingmigration.ProgramDetail{}, fmt.Errorf("validate migration application: %w", err)
		}
	}
	program := command.Program
	var commonEpoch *int64
	for _, scope := range program.Scope.Applications {
		authoritySum := sha256.Sum256([]byte(program.Scope.ProjectID + "\x00" + program.Scope.EnvironmentID + "\x00" + scope.ApplicationID + "\x00" + scope.Platform + "\x00source\x000"))
		authorityID := "mas_" + hex.EncodeToString(authoritySum[:8])
		if _, err := tx.Exec(ctx, `INSERT INTO billing_migration_authority_scopes(id,project_id,environment_id,application_id,platform,current_authority,current_epoch,active_program_id,authority_digest,updated_at) VALUES($1,$2,$3,$4,$5,'source',0,NULL,$6,$7) ON CONFLICT(project_id,environment_id,application_id,platform) DO NOTHING`, authorityID, program.Scope.ProjectID, program.Scope.EnvironmentID, scope.ApplicationID, scope.Platform, authoritySum[:], command.Now); err != nil {
			return billingmigration.ProgramDetail{}, translate(err, "initialize migration authority scope")
		}
		var activeProgramID *string
		var currentAuthority string
		var currentEpoch int64
		if err := tx.QueryRow(ctx, `SELECT current_authority,current_epoch,active_program_id FROM billing_migration_authority_scopes WHERE project_id=$1 AND environment_id=$2 AND application_id=$3 AND platform=$4 FOR UPDATE`, program.Scope.ProjectID, program.Scope.EnvironmentID, scope.ApplicationID, scope.Platform).Scan(&currentAuthority, &currentEpoch, &activeProgramID); err != nil {
			return billingmigration.ProgramDetail{}, translate(err, "lock migration authority scope")
		}
		if currentAuthority != "source" || (activeProgramID != nil && *activeProgramID != program.ProgramID) || (commonEpoch != nil && *commonEpoch != currentEpoch) {
			return billingmigration.ProgramDetail{}, billingmigration.ErrConflict
		}
		if commonEpoch == nil {
			epoch := currentEpoch
			commonEpoch = &epoch
		}
	}
	if commonEpoch == nil {
		return billingmigration.ProgramDetail{}, billingmigration.ErrInvalid
	}
	program.AuthorityEpochBefore = *commonEpoch
	credential := command.Credential
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_credentials(
		id,project_id,provider,external_project_id,status,envelope_version,algorithm,key_id,nonce,ciphertext,
		fingerprint,created_by_actor_id,created_at) VALUES($1,$2,'revenuecat',$3,'active',$4,$5,$6,$7,$8,$9,$10,$11)`,
		credential.ID, credential.ProjectID, credential.ExternalProjectID, credential.EnvelopeVersion,
		credential.Algorithm, credential.KeyID, credential.Nonce, credential.Ciphertext,
		credential.Fingerprint, credential.CreatedByActorID, credential.CreatedAt)
	if err != nil {
		return billingmigration.ProgramDetail{}, translate(err, "insert migration credential")
	}
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_programs(
		id,project_id,environment_id,source_adapter,source_adapter_version,credential_id,state,state_version,
		authority_epoch_before,stabilization_days,rollback_window_days,scope_digest,policy_digest,
		idempotency_key,request_digest,created_by_actor_id,created_at,updated_at)
		VALUES($1,$2,$3,'revenuecat',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
		program.ProgramID, program.Scope.ProjectID, program.Scope.EnvironmentID, program.Source.AdapterVersion,
		credential.ID, program.State, program.StateVersion, program.AuthorityEpochBefore,
		program.StabilizationDays, program.RollbackWindowDays, command.ScopeDigest, command.PolicyDigest,
		command.IdempotencyKey, command.RequestDigest, command.ActorID, command.Now)
	if err != nil {
		return billingmigration.ProgramDetail{}, translate(err, "insert migration program")
	}
	for _, scope := range program.Scope.Applications {
		if _, err := tx.Exec(ctx, `INSERT INTO billing_migration_program_scopes(
			program_id,project_id,environment_id,application_id,platform,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
			program.ProgramID, program.Scope.ProjectID, program.Scope.EnvironmentID,
			scope.ApplicationID, scope.Platform, command.Now); err != nil {
			return billingmigration.ProgramDetail{}, translate(err, "insert migration scope")
		}
		tag, err := tx.Exec(ctx, `UPDATE billing_migration_authority_scopes SET active_program_id=$5,updated_at=$6 WHERE project_id=$1 AND environment_id=$2 AND application_id=$3 AND platform=$4 AND (active_program_id IS NULL OR active_program_id=$5)`, program.Scope.ProjectID, program.Scope.EnvironmentID, scope.ApplicationID, scope.Platform, program.ProgramID, command.Now)
		if err != nil {
			return billingmigration.ProgramDetail{}, translate(err, "claim migration authority scope")
		}
		if tag.RowsAffected() != 1 {
			return billingmigration.ProgramDetail{}, billingmigration.ErrConflict
		}
	}
	assessment := command.Assessment
	_, err = tx.Exec(ctx, `INSERT INTO billing_migration_capability_assessments(
		id,program_id,project_id,state_version,provider_api_version,capabilities,assessment_digest,assessed_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, command.AssessmentID, program.ProgramID,
		program.Scope.ProjectID, assessment.StateVersion, assessment.ProviderAPIVersion,
		assessment.Capabilities, command.AssessmentDigest, assessment.AssessedAt)
	if err != nil {
		return billingmigration.ProgramDetail{}, translate(err, "insert migration assessment")
	}
	metadata, _ := json.Marshal(map[string]any{"scopeDigest": billingmigration.FormatDigest(command.ScopeDigest), "sourceAdapter": "revenuecat"})
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,organization_id,project_id,environment_id,
		action,resource_type,resource_id,metadata,created_at)
		VALUES($1,$2,$3,$4,$5,'billing.migration.program.created','billing_migration_program',$6,$7,$8)`,
		"aud_"+program.ProgramID, command.ActorID, organizationID, program.Scope.ProjectID,
		program.Scope.EnvironmentID, program.ProgramID, metadata, command.Now)
	if err != nil {
		return billingmigration.ProgramDetail{}, fmt.Errorf("insert migration audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return billingmigration.ProgramDetail{}, translate(err, "commit migration program")
	}
	return billingmigration.ProgramDetail{Program: program, SourceCapabilityAssessment: &assessment}, nil
}

func (r *Repository) ListPrograms(ctx context.Context, projectID string, limit int) ([]billingmigration.ProgramDetail, error) {
	rows, err := r.pool.Query(ctx, programSelect+` WHERE p.project_id=$1 ORDER BY p.created_at DESC,p.id LIMIT $2`, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("list migration programs: %w", err)
	}
	defer rows.Close()
	programs := make([]billingmigration.ProgramDetail, 0, limit)
	for rows.Next() {
		program, err := scanProgram(rows)
		if err != nil {
			return nil, fmt.Errorf("scan migration program: %w", err)
		}
		detail, err := r.hydrate(ctx, program)
		if err != nil {
			return nil, err
		}
		programs = append(programs, detail)
	}
	return programs, rows.Err()
}

func (r *Repository) Program(ctx context.Context, projectID, programID string) (billingmigration.ProgramDetail, error) {
	program, err := scanProgram(r.pool.QueryRow(ctx, programSelect+` WHERE p.project_id=$1 AND p.id=$2`, projectID, programID))
	if errors.Is(err, pgx.ErrNoRows) {
		return billingmigration.ProgramDetail{}, billingmigration.ErrNotFound
	}
	if err != nil {
		return billingmigration.ProgramDetail{}, fmt.Errorf("read migration program: %w", err)
	}
	return r.hydrate(ctx, program)
}

const programSelect = `SELECT p.id,p.state_version,p.state,p.project_id,p.environment_id,
	p.source_adapter,p.source_adapter_version,p.credential_id,p.authority_epoch_before,
	p.stabilization_days,p.rollback_window_days,p.scope_digest,p.policy_digest,p.created_at,p.updated_at
	FROM billing_migration_programs p`

type rowScanner interface{ Scan(...any) error }

func scanProgram(row rowScanner) (billingmigration.Program, error) {
	var program billingmigration.Program
	var scopeDigest, policyDigest []byte
	err := row.Scan(&program.ProgramID, &program.StateVersion, &program.State,
		&program.Scope.ProjectID, &program.Scope.EnvironmentID, &program.Source.Adapter,
		&program.Source.AdapterVersion, &program.Source.CredentialReference,
		&program.AuthorityEpochBefore, &program.StabilizationDays, &program.RollbackWindowDays,
		&scopeDigest, &policyDigest, &program.CreatedAt, &program.UpdatedAt)
	program.ScopeDigest, program.PolicyDigest = billingmigration.FormatDigest(scopeDigest), billingmigration.FormatDigest(policyDigest)
	return program, err
}

func (r *Repository) hydrate(ctx context.Context, program billingmigration.Program) (billingmigration.ProgramDetail, error) {
	rows, err := r.pool.Query(ctx, `SELECT application_id,platform FROM billing_migration_program_scopes
		WHERE program_id=$1 AND project_id=$2 ORDER BY application_id,platform`, program.ProgramID, program.Scope.ProjectID)
	if err != nil {
		return billingmigration.ProgramDetail{}, fmt.Errorf("read migration scopes: %w", err)
	}
	for rows.Next() {
		var scope billingmigration.ScopeItem
		if err := rows.Scan(&scope.ApplicationID, &scope.Platform); err != nil {
			rows.Close()
			return billingmigration.ProgramDetail{}, err
		}
		program.Scope.Applications = append(program.Scope.Applications, scope)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return billingmigration.ProgramDetail{}, err
	}
	rows.Close()
	detail := billingmigration.ProgramDetail{Program: program}
	var assessment billingmigration.CapabilityAssessment
	err = r.pool.QueryRow(ctx, `SELECT state_version,provider_api_version,capabilities,assessed_at
		FROM billing_migration_capability_assessments WHERE program_id=$1 AND project_id=$2
		ORDER BY assessed_at DESC,id DESC LIMIT 1`, program.ProgramID, program.Scope.ProjectID).
		Scan(&assessment.StateVersion, &assessment.ProviderAPIVersion, &assessment.Capabilities, &assessment.AssessedAt)
	if err == nil {
		assessment.ProgramID, assessment.Adapter = program.ProgramID, billingmigration.AdapterRevenueCat
		detail.SourceCapabilityAssessment = &assessment
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return detail, fmt.Errorf("read migration assessment: %w", err)
	}
	return detail, nil
}

func translate(err error, operation string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505", "40001":
			return billingmigration.ErrConflict
		case "23503", "23514", "22001":
			return billingmigration.ErrInvalid
		}
	}
	return fmt.Errorf("%s: %w", operation, err)
}
