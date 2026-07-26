package placementdecision

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type Service struct {
	repository      Repository
	now             func() time.Time
	telemetryTracer trace.Tracer
	random          func([]byte) error
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, telemetryTracer: otel.Tracer("github.com/Mujhtech/mosaic/apps/api/placementdecision"), random: func(buffer []byte) error { _, err := rand.Read(buffer); return err }}
}

func (s *Service) operation(ctx context.Context, name string, actor Actor, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	attrs = append(attrs, attribute.String("mosaic.actor.id", actor.ID))
	return s.telemetryTracer.Start(ctx, name, trace.WithAttributes(attrs...))
}

func requireScope(reader Reader, actor Actor, projectID, environmentID, placementID string, write bool) (Scope, error) {
	if actor.ID == "" {
		return Scope{}, ErrUnauthenticated
	}
	scope, ok := reader.Scope(actor.ID, projectID, environmentID, placementID)
	if !ok {
		return Scope{}, ErrNotFound
	}
	if scope.Role == "" {
		return Scope{}, ErrForbidden
	}
	if write && scope.Role != "owner" && scope.Role != "admin" {
		return Scope{}, ErrForbidden
	}
	if write && (scope.ProjectStatus == "archived" || scope.PlacementStatus == "archived") {
		return Scope{}, ErrArchived
	}
	return scope, nil
}

func (s *Service) audit(tx Transaction, actor Actor, scope Scope, action, resourceType, resourceID string, metadata map[string]string) {
	tx.SaveAudit(AuditEvent{ID: tx.NextID("audit"), ActorID: actor.ID, OrganizationID: scope.OrganizationID, ProjectID: scope.ProjectID, EnvironmentID: scope.EnvironmentID, Action: action, ResourceType: resourceType, ResourceID: resourceID, Metadata: metadata, CreatedAt: s.now()})
}

func (s *Service) CreateRuleSet(ctx context.Context, actor Actor, projectID, environmentID, placementID, mutationKey string, raw json.RawMessage) (DraftResource, error) {
	ctx, span := s.operation(ctx, "placement_rule_set.create", actor, attribute.String("mosaic.project.id", projectID), attribute.String("mosaic.environment.id", environmentID), attribute.String("mosaic.placement.id", placementID))
	defer span.End()
	if strings.TrimSpace(mutationKey) == "" {
		return DraftResource{}, ErrPreconditionRequired
	}
	document, canonical, hash, parseErr := Canonicalize(raw)
	if parseErr != nil {
		return DraftResource{}, &ValidationError{Result: invalidDocument(parseErr)}
	}
	var result DraftResource
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		if _, exists := tx.RuleSetForPlacement(environmentID, placementID); exists {
			return ErrConflict
		}
		now := s.now()
		ruleSetID := tx.NextID("ruleset")
		document.RuleSetID, document.Version, document.ProjectID, document.EnvironmentID, document.EnvironmentKey, document.PlacementID, document.PlacementKey = ruleSetID, 1, projectID, environmentID, scope.EnvironmentKey, placementID, scope.PlacementKey
		canonical = MarshalDocument(document)
		hash = digest(canonical)
		validation := Validate(document, catalog{Reader: tx, projectID: projectID, environmentID: environmentID})
		ruleSet := RuleSet{ID: ruleSetID, ProjectID: projectID, EnvironmentID: environmentID, PlacementID: placementID, ContractVersion: ContractVersion, Status: "active", CreatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
		draft := Draft{ID: tx.NextID("ruleset_draft"), RuleSetID: ruleSet.ID, ProjectID: projectID, EnvironmentID: environmentID, Status: "active", CurrentRevision: 1, CreatedByActorID: actor.ID, UpdatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
		ruleSet.CurrentDraftID = draft.ID
		ruleSet.CurrentDraftID = ""
		tx.SaveRuleSet(ruleSet)
		tx.SaveDraft(draft)
		tx.SaveDraftRevision(DraftRevision{DraftID: draft.ID, RuleSetID: ruleSet.ID, ProjectID: projectID, EnvironmentID: environmentID, Revision: 1, Document: canonical, DocumentHash: hash, Validation: validation, MutationHash: digest([]byte(mutationKey)), RequestHash: hash, ActorID: actor.ID, CreatedAt: now})
		ruleSet.CurrentDraftID = draft.ID
		tx.SaveRuleSet(ruleSet)
		s.audit(tx, actor, scope, "placement_rule_set.created", "placement_rule_set", ruleSet.ID, map[string]string{"revision": "1"})
		result = DraftResource{RuleSet: ruleSet, Draft: draft, Document: canonical, Validation: validation, ETag: DraftETag(draft.ID, 1)}
		return nil
	})
	if err != nil {
		span.RecordError(err)
	}
	return result, err
}

func (s *Service) GetRuleSet(ctx context.Context, actor Actor, projectID, environmentID, placementID string) (DraftResource, error) {
	var result DraftResource
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, environmentID, placementID, false); err != nil {
			return err
		}
		ruleSet, ok := reader.RuleSetForPlacement(environmentID, placementID)
		if !ok {
			return ErrNotFound
		}
		draft, ok := reader.Draft(ruleSet.CurrentDraftID)
		if !ok {
			return ErrNotFound
		}
		revision, ok := reader.DraftRevision(draft.ID, draft.CurrentRevision)
		if !ok {
			return ErrNotFound
		}
		result = DraftResource{RuleSet: ruleSet, Draft: draft, Document: revision.Document, Validation: revision.Validation, ETag: DraftETag(draft.ID, draft.CurrentRevision)}
		return nil
	})
	return result, err
}

func (s *Service) UpdateDraft(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID, ifMatch, mutationKey string, raw json.RawMessage) (DraftResource, error) {
	ctx, span := s.operation(ctx, "placement_rule_set.update", actor, attribute.String("mosaic.rule_set.id", ruleSetID))
	defer span.End()
	if strings.TrimSpace(ifMatch) == "" || strings.TrimSpace(mutationKey) == "" {
		return DraftResource{}, ErrPreconditionRequired
	}
	document, canonical, hash, parseErr := Canonicalize(raw)
	if parseErr != nil {
		return DraftResource{}, &ValidationError{Result: invalidDocument(parseErr)}
	}
	var result DraftResource
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		tx.Lock("ruleset:" + ruleSetID)
		ruleSet, ok := tx.RuleSet(ruleSetID)
		if !ok || ruleSet.ProjectID != projectID || ruleSet.EnvironmentID != environmentID || ruleSet.PlacementID != placementID {
			return ErrNotFound
		}
		if ruleSet.Status != "active" {
			return ErrArchived
		}
		draft, ok := tx.Draft(ruleSet.CurrentDraftID)
		if !ok || draft.Status != "active" {
			return ErrConflict
		}
		mutationHash := digest([]byte(mutationKey))
		requestHash := hash
		if replay, ok := tx.DraftRevisionByMutation(draft.ID, mutationHash); ok {
			if replay.RequestHash != requestHash {
				return ErrIdempotencyConflict
			}
			result = DraftResource{RuleSet: ruleSet, Draft: draft, Document: replay.Document, Validation: replay.Validation, ETag: DraftETag(draft.ID, replay.Revision)}
			return nil
		}
		if ifMatch != DraftETag(draft.ID, draft.CurrentRevision) {
			return &ConflictError{Revision: draft.CurrentRevision, ETag: DraftETag(draft.ID, draft.CurrentRevision), UpdatedAt: draft.UpdatedAt, ActorID: draft.UpdatedByActorID}
		}
		if document.RuleSetID != ruleSet.ID || document.ProjectID != projectID || document.EnvironmentID != environmentID || document.PlacementID != placementID {
			return &ValidationError{Result: oneIssue("rule_set_identity_mismatch", "restore_rule_set_identity")}
		}
		validation := Validate(document, catalog{Reader: tx, projectID: projectID, environmentID: environmentID})
		now := s.now()
		draft.CurrentRevision++
		draft.UpdatedByActorID, draft.UpdatedAt = actor.ID, now
		ruleSet.UpdatedAt = now
		tx.SaveDraftRevision(DraftRevision{DraftID: draft.ID, RuleSetID: ruleSet.ID, ProjectID: projectID, EnvironmentID: environmentID, Revision: draft.CurrentRevision, Document: canonical, DocumentHash: hash, Validation: validation, MutationHash: mutationHash, RequestHash: requestHash, ActorID: actor.ID, CreatedAt: now})
		tx.SaveDraft(draft)
		tx.SaveRuleSet(ruleSet)
		s.audit(tx, actor, scope, "placement_rule_set.draft_updated", "placement_rule_set", ruleSet.ID, map[string]string{"revision": fmt.Sprint(draft.CurrentRevision), "issueCount": fmt.Sprint(len(validation.Issues))})
		result = DraftResource{RuleSet: ruleSet, Draft: draft, Document: canonical, Validation: validation, ETag: DraftETag(draft.ID, draft.CurrentRevision)}
		return nil
	})
	if err != nil {
		span.RecordError(err)
	}
	return result, err
}

func (s *Service) ValidateDraft(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID string) (ValidationResult, error) {
	ctx, span := s.operation(ctx, "placement_rule_set.validate", actor, attribute.String("mosaic.rule_set.id", ruleSetID))
	defer span.End()
	var result ValidationResult
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, environmentID, placementID, false); err != nil {
			return err
		}
		ruleSet, ok := reader.RuleSet(ruleSetID)
		if !ok || ruleSet.PlacementID != placementID || ruleSet.EnvironmentID != environmentID {
			return ErrNotFound
		}
		draft, ok := reader.Draft(ruleSet.CurrentDraftID)
		if !ok {
			return ErrNotFound
		}
		revision, ok := reader.DraftRevision(draft.ID, draft.CurrentRevision)
		if !ok {
			return ErrNotFound
		}
		document, _, _, err := Canonicalize(revision.Document)
		if err != nil {
			return err
		}
		result = Validate(document, catalog{Reader: reader, projectID: projectID, environmentID: environmentID})
		return nil
	})
	if !result.Valid {
		zerolog.Ctx(ctx).Info().Str("rule_set_id", ruleSetID).Int("issue_count", len(result.Issues)).Msg("placement decision validation failed")
	}
	return result, err
}

func (s *Service) Publish(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID string, expectedRevision int64) (Version, error) {
	ctx, span := s.operation(ctx, "placement_rule_set.publish", actor, attribute.String("mosaic.rule_set.id", ruleSetID))
	defer span.End()
	var result Version
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		tx.Lock("ruleset:" + ruleSetID)
		ruleSet, ok := tx.RuleSet(ruleSetID)
		if !ok || ruleSet.PlacementID != placementID || ruleSet.EnvironmentID != environmentID {
			return ErrNotFound
		}
		if ruleSet.Status != "active" {
			return ErrArchived
		}
		draft, ok := tx.Draft(ruleSet.CurrentDraftID)
		if !ok || draft.Status != "active" {
			return ErrConflict
		}
		if draft.CurrentRevision != expectedRevision {
			return &ConflictError{Revision: draft.CurrentRevision, ETag: DraftETag(draft.ID, draft.CurrentRevision), UpdatedAt: draft.UpdatedAt, ActorID: draft.UpdatedByActorID}
		}
		revision, ok := tx.DraftRevision(draft.ID, expectedRevision)
		if !ok {
			return ErrNotFound
		}
		document, canonical, hash, err := Canonicalize(revision.Document)
		if err != nil {
			return err
		}
		validation := Validate(document, catalog{Reader: tx, projectID: projectID, environmentID: environmentID})
		if !validation.Valid {
			return &ValidationError{Result: validation}
		}
		versions := tx.Versions(ruleSetID)
		number := int64(len(versions) + 1)
		now := s.now()
		document.Version = number
		document.AttributeDefinitions = contractAttributes(tx.Attributes(projectID))
		document.QAOverrides = contractOverrides(tx.Overrides(environmentID, placementID, now))
		document.Compatibility = DeriveCompatibility(document)
		canonical = MarshalDocument(document)
		finalDocument, finalCanonical, finalHash, err := Canonicalize(canonical)
		if err != nil {
			return &ValidationError{Result: invalidDocument(err)}
		}
		validation = Validate(finalDocument, catalog{Reader: tx, projectID: projectID, environmentID: environmentID})
		if !validation.Valid {
			return &ValidationError{Result: validation}
		}
		document, canonical, hash = finalDocument, finalCanonical, finalHash
		result = Version{ID: tx.NextID("ruleset_version"), RuleSetID: ruleSetID, ProjectID: projectID, EnvironmentID: environmentID, PlacementID: placementID, VersionNumber: number, SourceDraftID: draft.ID, SourceRevision: expectedRevision, ContractVersion: ContractVersion, Document: canonical, DocumentHash: hash, Validation: validation, PublishedByActorID: actor.ID, PublishedAt: now}
		tx.SaveVersion(result, document.Rules)
		draft.Status, draft.UpdatedByActorID, draft.UpdatedAt = "published", actor.ID, now
		ruleSet.CurrentPublishedVersionID, ruleSet.UpdatedAt = result.ID, now
		tx.SaveDraft(draft)
		tx.SaveRuleSet(ruleSet)
		s.audit(tx, actor, scope, "placement_rule_set.published", "placement_rule_set_version", result.ID, map[string]string{"version": fmt.Sprint(number), "ruleCount": fmt.Sprint(len(document.Rules))})
		return nil
	})
	if err != nil {
		span.RecordError(err)
	} else {
		zerolog.Ctx(ctx).Info().Str("rule_set_id", ruleSetID).Str("rule_set_version_id", result.ID).Msg("placement rule set published")
	}
	return result, err
}

func (s *Service) CloneVersion(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID, versionID, mutationKey string) (DraftResource, error) {
	if mutationKey == "" {
		return DraftResource{}, ErrPreconditionRequired
	}
	var result DraftResource
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		tx.Lock("ruleset:" + ruleSetID)
		ruleSet, ok := tx.RuleSet(ruleSetID)
		if !ok || ruleSet.PlacementID != placementID {
			return ErrNotFound
		}
		if ruleSet.Status != "active" {
			return ErrArchived
		}
		version, ok := tx.Version(versionID)
		if !ok || version.RuleSetID != ruleSetID {
			return ErrNotFound
		}
		if current, ok := tx.Draft(ruleSet.CurrentDraftID); ok && current.Status == "active" {
			return ErrConflict
		}
		now := s.now()
		draft := Draft{ID: tx.NextID("ruleset_draft"), RuleSetID: ruleSetID, ProjectID: projectID, EnvironmentID: environmentID, Status: "active", CurrentRevision: 1, SourceVersionID: version.ID, CreatedByActorID: actor.ID, UpdatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
		tx.SaveDraft(draft)
		tx.SaveDraftRevision(DraftRevision{DraftID: draft.ID, RuleSetID: ruleSetID, ProjectID: projectID, EnvironmentID: environmentID, Revision: 1, Document: version.Document, DocumentHash: version.DocumentHash, Validation: version.Validation, MutationHash: digest([]byte(mutationKey)), RequestHash: version.DocumentHash, ActorID: actor.ID, CreatedAt: now})
		ruleSet.CurrentDraftID, ruleSet.UpdatedAt = draft.ID, now
		tx.SaveRuleSet(ruleSet)
		s.audit(tx, actor, scope, "placement_rule_set.draft_cloned", "placement_rule_set", ruleSetID, map[string]string{"sourceVersionId": versionID})
		result = DraftResource{RuleSet: ruleSet, Draft: draft, Document: version.Document, Validation: version.Validation, ETag: DraftETag(draft.ID, 1)}
		return nil
	})
	return result, err
}

func (s *Service) Versions(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID string) ([]Version, error) {
	result := []Version{}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, environmentID, placementID, false); err != nil {
			return err
		}
		ruleSet, ok := reader.RuleSet(ruleSetID)
		if !ok || ruleSet.PlacementID != placementID {
			return ErrNotFound
		}
		result = reader.Versions(ruleSetID)
		return nil
	})
	return result, err
}

func (s *Service) Simulate(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID string, input EvaluationContext) (EvaluationResult, error) {
	ctx, span := s.operation(ctx, "placement_decision.simulate", actor, attribute.String("mosaic.rule_set.id", ruleSetID))
	defer span.End()
	var result EvaluationResult
	err := s.repository.View(ctx, func(reader Reader) error {
		scope, err := requireScope(reader, actor, projectID, environmentID, placementID, false)
		if err != nil {
			return err
		}
		ruleSet, ok := reader.RuleSet(ruleSetID)
		if !ok || ruleSet.PlacementID != placementID {
			return ErrNotFound
		}
		draft, ok := reader.Draft(ruleSet.CurrentDraftID)
		if !ok {
			return ErrNotFound
		}
		revision, ok := reader.DraftRevision(draft.ID, draft.CurrentRevision)
		if !ok {
			return ErrNotFound
		}
		document, _, _, err := Canonicalize(revision.Document)
		if err != nil {
			return err
		}
		validation := Validate(document, catalog{Reader: reader, projectID: projectID, environmentID: environmentID})
		if !validation.Valid {
			return &ValidationError{Result: validation}
		}
		document.QAOverrides = contractOverrides(reader.Overrides(environmentID, placementID, s.now()))
		input.ProjectID, input.EnvironmentID, input.EnvironmentKey, input.PlacementID = projectID, environmentID, scope.EnvironmentKey, placementID
		input.EvaluationTime = s.now()
		result = Evaluate(document, input)
		return nil
	})
	if err != nil {
		span.RecordError(err)
		zerolog.Ctx(ctx).Error().Err(err).Str("rule_set_id", ruleSetID).Msg("placement decision simulation failed")
		return EvaluationResult{}, err
	}
	zerolog.Ctx(ctx).Info().Str("rule_set_id", ruleSetID).Str("winning_rule_id", result.WinningRuleID).Str("outcome", result.FinalOutcome.Type).Msg("placement decision simulated")
	return result, nil
}

func DraftETag(draftID string, revision int64) string {
	return fmt.Sprintf("\"ruleset-draft:%s:%d\"", draftID, revision)
}
func invalidDocument(err error) ValidationResult {
	return ValidationResult{Valid: false, Issues: []ValidationIssue{{Severity: "error", Code: "malformed_rule_set", RecoveryAction: "repair_rule_set_document", ResourceID: err.Error()}}}
}
func oneIssue(code, action string) ValidationResult {
	return ValidationResult{Valid: false, Issues: []ValidationIssue{{Severity: "error", Code: code, RecoveryAction: action}}}
}

type catalog struct {
	Reader
	projectID     string
	environmentID string
}

func (c catalog) Attribute(key string) (AttributeDefinition, bool) {
	return c.AttributeScoped(key, c.projectID)
}
func (c catalog) PaywallVersion(id string) bool {
	return c.PaywallVersionScoped(id, c.projectID, c.environmentID)
}
func (c catalog) Product(id string) bool      { return c.ProductScoped(id, c.projectID) }
func (c catalog) Entitlement(key string) bool { return c.EntitlementScoped(key, c.projectID) }

func (s *Service) CreateAttribute(ctx context.Context, actor Actor, projectID string, definition AttributeDefinition) (AttributeDefinition, error) {
	var result AttributeDefinition
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, "", "", true)
		if err != nil {
			return err
		}
		if !keyPattern.MatchString(definition.Key) || !validAttributeType(definition.ValueType) || (definition.Sensitivity != "standard" && definition.Sensitivity != "sensitive") || len(definition.AllowedOperators) == 0 {
			return &ValidationError{Result: oneIssue("invalid_attribute_definition", "correct_attribute_definition")}
		}
		if _, exists := tx.AttributeScoped(definition.Key, projectID); exists {
			return ErrConflict
		}
		now := s.now()
		definition.ID, definition.ProjectID, definition.Status, definition.Revision, definition.CreatedByActorID, definition.UpdatedByActorID, definition.CreatedAt, definition.UpdatedAt = tx.NextID("attribute"), projectID, "active", 1, actor.ID, actor.ID, now, now
		definition.AllowedOperators = normalizedOperators(definition.AllowedOperators)
		tx.SaveAttribute(definition)
		s.audit(tx, actor, scope, "placement_attribute.created", "placement_attribute_definition", definition.ID, map[string]string{"key": definition.Key, "type": definition.ValueType, "sensitivity": definition.Sensitivity})
		result = definition
		return nil
	})
	return result, err
}
func (s *Service) Attributes(ctx context.Context, actor Actor, projectID string) ([]AttributeDefinition, error) {
	result := []AttributeDefinition{}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, "", "", false); err != nil {
			return err
		}
		result = reader.Attributes(projectID)
		return nil
	})
	return result, err
}
func (s *Service) ArchiveAttribute(ctx context.Context, actor Actor, projectID, attributeID string) error {
	return s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, "", "", true)
		if err != nil {
			return err
		}
		if !tx.ArchiveAttribute(attributeID, projectID, actor.ID, s.now()) {
			return ErrNotFound
		}
		s.audit(tx, actor, scope, "placement_attribute.archived", "placement_attribute_definition", attributeID, map[string]string{})
		return nil
	})
}
func validAttributeType(value string) bool {
	return value == "string" || value == "boolean" || value == "number" || value == "timestamp" || value == "semantic_version" || value == "string_list"
}

func contractAttributes(values []AttributeDefinition) []ContractAttributeDefinition {
	result := []ContractAttributeDefinition{}
	for _, value := range values {
		if value.Status == "active" {
			result = append(result, ContractAttributeDefinition{Key: value.Key, ValueType: value.ValueType, Sensitivity: value.Sensitivity, AllowedOperators: value.AllowedOperators})
		}
	}
	return result
}
func contractOverrides(values []QAOverride) []PublishedOverride {
	result := make([]PublishedOverride, 0, len(values))
	for _, value := range values {
		result = append(result, PublishedOverride{ID: value.ID, SelectorDigest: value.SelectorDigest, SafeLabel: value.SafeLabel, StartsAt: value.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"), ExpiresAt: value.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z"), Outcome: value.Outcome})
	}
	return result
}

func (s *Service) CreateAlias(ctx context.Context, actor Actor, projectID, placementID, key string) (Alias, error) {
	var result Alias
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, "", placementID, true)
		if err != nil {
			return err
		}
		if !keyPattern.MatchString(key) {
			return &ValidationError{Result: oneIssue("invalid_placement_alias", "use_stable_placement_key")}
		}
		for _, alias := range tx.Aliases(placementID) {
			if alias.Key == key {
				return ErrConflict
			}
		}
		now := s.now()
		result = Alias{ID: tx.NextID("placement_alias"), ProjectID: projectID, PlacementID: placementID, Key: key, Status: "active", CreatedByActorID: actor.ID, CreatedAt: now}
		tx.SaveAlias(result)
		s.audit(tx, actor, scope, "placement.alias_created", "placement_alias", result.ID, map[string]string{"key": key})
		return nil
	})
	return result, err
}
func (s *Service) Aliases(ctx context.Context, actor Actor, projectID, placementID string) ([]Alias, error) {
	result := []Alias{}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, "", placementID, false); err != nil {
			return err
		}
		result = reader.Aliases(placementID)
		return nil
	})
	return result, err
}
func (s *Service) Usage(ctx context.Context, actor Actor, projectID, placementID string) (Usage, error) {
	var result Usage
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, "", placementID, false); err != nil {
			return err
		}
		result = reader.Usage(placementID)
		return nil
	})
	return result, err
}
func (s *Service) ArchivePlacement(ctx context.Context, actor Actor, projectID, placementID string) error {
	return s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, "", placementID, true)
		if err != nil {
			return err
		}
		usage := tx.Usage(placementID)
		if usage.RuleSetCount > 0 {
			return ErrConflict
		}
		now := s.now()
		tx.ArchivePlacement(placementID, actor.ID, now)
		s.audit(tx, actor, scope, "placement.archived", "placement", placementID, map[string]string{})
		return nil
	})
}

func (s *Service) ArchiveRuleSet(ctx context.Context, actor Actor, projectID, environmentID, placementID, ruleSetID string) error {
	return s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		tx.Lock("ruleset:" + ruleSetID)
		ruleSet, ok := tx.RuleSet(ruleSetID)
		if !ok || ruleSet.ProjectID != projectID || ruleSet.EnvironmentID != environmentID || ruleSet.PlacementID != placementID {
			return ErrNotFound
		}
		if ruleSet.Status != "active" {
			return ErrArchived
		}
		now := s.now()
		if !tx.ArchiveRuleSet(ruleSetID, actor.ID, now) {
			return ErrConflict
		}
		s.audit(tx, actor, scope, "placement_rule_set.archived", "placement_rule_set", ruleSetID, map[string]string{})
		return nil
	})
}

func (s *Service) CreateOverride(ctx context.Context, actor Actor, projectID, environmentID, placementID, safeLabel, selector string, outcome Outcome, expiresAt time.Time) (QAOverrideCreated, error) {
	ctx, span := s.operation(ctx, "placement_qa_override.create", actor, attribute.String("mosaic.environment.id", environmentID), attribute.String("mosaic.placement.id", placementID))
	defer span.End()
	var result QAOverrideCreated
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		if scope.EnvironmentMode != "development" && scope.EnvironmentMode != "staging" {
			return ErrProductionOverride
		}
		now := s.now()
		if expiresAt.After(now.Add(24*time.Hour)) || !expiresAt.After(now) || strings.TrimSpace(selector) == "" || len(safeLabel) < 1 || len(safeLabel) > 80 {
			return &ValidationError{Result: oneIssue("invalid_qa_override", "use_nonproduction_expiry_within_24_hours")}
		}
		ruleSet, ok := tx.RuleSetForPlacement(environmentID, placementID)
		if !ok || ruleSet.Status != "active" {
			return ErrNotFound
		}
		draft, ok := tx.Draft(ruleSet.CurrentDraftID)
		if !ok || draft.Status != "active" {
			return ErrConflict
		}
		revision, ok := tx.DraftRevision(draft.ID, draft.CurrentRevision)
		if !ok {
			return ErrNotFound
		}
		document, _, _, err := Canonicalize(revision.Document)
		if err != nil {
			return &ValidationError{Result: invalidDocument(err)}
		}
		outcomeValidation := make([]ValidationIssue, 0)
		validateOutcome(outcome, "", "outcome", fallbackMap(document.Fallbacks), catalog{Reader: tx, projectID: projectID, environmentID: environmentID}, func(code, ruleID, path, resourceType, resourceID, action string) {
			outcomeValidation = append(outcomeValidation, ValidationIssue{Severity: "error", Code: code, RuleID: ruleID, ConditionPath: path, ResourceType: resourceType, ResourceID: resourceID, RecoveryAction: action})
		})
		if len(outcomeValidation) != 0 {
			return &ValidationError{Result: ValidationResult{Valid: false, Issues: outcomeValidation}}
		}
		tokenBytes := make([]byte, 32)
		if err := s.random(tokenBytes); err != nil {
			return err
		}
		token := base64.RawURLEncoding.EncodeToString(tokenBytes)
		selectorHash, tokenHash := sha256.Sum256([]byte(selector)), sha256.Sum256([]byte(token))
		override := QAOverride{ID: tx.NextID("qa_override"), ProjectID: projectID, EnvironmentID: environmentID, PlacementID: placementID, SafeLabel: safeLabel, Outcome: outcome, Status: "active", CreatedByActorID: actor.ID, CreatedAt: now, ExpiresAt: expiresAt.UTC()}
		tx.SaveOverride(override, selectorHash[:], tokenHash[:])
		s.audit(tx, actor, scope, "placement_qa_override.created", "placement_qa_override", override.ID, map[string]string{"expiresAt": override.ExpiresAt.Format(time.RFC3339), "outcome": outcome.Type})
		result = QAOverrideCreated{Override: override, Token: token}
		return nil
	})
	return result, err
}
func (s *Service) RevokeOverride(ctx context.Context, actor Actor, projectID, environmentID, placementID, overrideID string) error {
	return s.repository.Transact(ctx, func(tx Transaction) error {
		scope, err := requireScope(tx, actor, projectID, environmentID, placementID, true)
		if err != nil {
			return err
		}
		if _, ok := tx.OverrideScoped(overrideID, projectID, environmentID, placementID); !ok {
			return ErrNotFound
		}
		if !tx.RevokeOverride(overrideID, projectID, environmentID, placementID, actor.ID, s.now()) {
			return ErrNotFound
		}
		s.audit(tx, actor, scope, "placement_qa_override.revoked", "placement_qa_override", overrideID, map[string]string{})
		return nil
	})
}
func (s *Service) Overrides(ctx context.Context, actor Actor, projectID, environmentID, placementID string) ([]QAOverride, error) {
	result := []QAOverride{}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := requireScope(reader, actor, projectID, environmentID, placementID, false); err != nil {
			return err
		}
		result = reader.Overrides(environmentID, placementID, s.now())
		return nil
	})
	return result, err
}

func tokenMatches(raw string, digestValue []byte) bool {
	sum := sha256.Sum256([]byte(raw))
	return subtle.ConstantTimeCompare(sum[:], digestValue) == 1
}
