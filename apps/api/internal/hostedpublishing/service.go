package hostedpublishing

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type Service struct {
	repository        Repository
	now               func() time.Time
	tracer            trace.Tracer
	validator         *ProtocolValidator
	objects           ObjectStore
	assetBase         string
	assetLimit        int64
	commerceValidator *CommerceConfigurationValidator
}

type ServiceOption func(*Service)

func WithProtocolValidator(validator *ProtocolValidator) ServiceOption {
	return func(service *Service) { service.validator = validator }
}

func WithCommerceConfigurationValidator(validator *CommerceConfigurationValidator) ServiceOption {
	return func(service *Service) { service.commerceValidator = validator }
}

func WithObjectStore(store ObjectStore, publicBaseURL string, uploadLimit int64) ServiceOption {
	return func(service *Service) {
		service.objects = store
		service.assetBase = strings.TrimRight(publicBaseURL, "/")
		service.assetLimit = uploadLimit
	}
}

func NewService(repository Repository, options ...ServiceOption) *Service {
	service := &Service{
		repository: repository,
		// PostgreSQL timestamps retain microsecond precision. Normalize timestamps
		// before returning or persisting them so an idempotent replay can reproduce
		// the exact metadata returned by the original mutation.
		now:        func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/hostedpublishing"),
		validator:  NewProtocolValidator(nil),
		assetLimit: 10 << 20,
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) operation(ctx context.Context, name string, actor Actor, attributes ...attribute.KeyValue) (context.Context, trace.Span) {
	attributes = append(attributes, attribute.String("mosaic.actor.id", actor.ID))
	return s.tracer.Start(ctx, name, trace.WithAttributes(attributes...))
}

func projectAccess(reader Reader, actor Actor, projectID string, write bool) (Project, error) {
	if strings.TrimSpace(actor.ID) == "" {
		return Project{}, ErrUnauthenticated
	}
	project, ok := reader.Project(projectID)
	if !ok {
		return Project{}, ErrNotFound
	}
	role, ok := reader.Role(project.OrganizationID, actor.ID)
	if !ok {
		return Project{}, ErrForbidden
	}
	if write && role != "owner" && role != "admin" {
		return Project{}, ErrForbidden
	}
	if write && project.Status == "archived" {
		return Project{}, ErrArchived
	}
	return project, nil
}

func environmentAccess(reader Reader, actor Actor, projectID, environmentID string, write bool) (Project, Environment, error) {
	project, err := projectAccess(reader, actor, projectID, write)
	if err != nil {
		return Project{}, Environment{}, err
	}
	environment, ok := reader.Environment(environmentID)
	if !ok || environment.ProjectID != project.ID {
		return Project{}, Environment{}, ErrNotFound
	}
	return project, environment, nil
}

func (s *Service) audit(tx Transaction, actor Actor, project Project, environmentID, action, resourceType, resourceID string, metadata map[string]string) {
	tx.SaveAuditEvent(AuditEvent{
		ID: tx.NextID("audit"), ActorID: actor.ID, OrganizationID: project.OrganizationID,
		ProjectID: project.ID, EnvironmentID: environmentID, Action: action,
		ResourceType: resourceType, ResourceID: resourceID, Metadata: metadata, CreatedAt: s.now(),
	})
}

func (s *Service) CreatePaywall(ctx context.Context, actor Actor, projectID, key, name string) (Paywall, error) {
	ctx, span := s.operation(ctx, "paywall.create", actor, attribute.String("mosaic.project.id", projectID))
	defer span.End()
	var result Paywall
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		for _, existing := range tx.Paywalls(projectID) {
			if existing.Key == key {
				return ErrConflict
			}
		}
		now := s.now()
		result = Paywall{ID: tx.NextID("paywall"), ProjectID: projectID, Key: key, Name: name, Status: "active", CreatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
		tx.SavePaywall(result)
		s.audit(tx, actor, project, "", "paywall.created", "paywall", result.ID, map[string]string{"key": key})
		return nil
	})
	if err == nil {
		zerolog.Ctx(ctx).Info().Str("project_id", projectID).Str("paywall_id", result.ID).Msg("paywall created")
	}
	return result, err
}

func (s *Service) ListPaywalls(ctx context.Context, actor Actor, projectID string) (List[Paywall], error) {
	result := List[Paywall]{Items: []Paywall{}}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		result.Items = reader.Paywalls(projectID)
		return nil
	})
	return result, err
}

func (s *Service) GetPaywall(ctx context.Context, actor Actor, projectID, paywallID string) (Paywall, error) {
	var result Paywall
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		paywall, ok := reader.Paywall(paywallID)
		if !ok || paywall.ProjectID != projectID {
			return ErrNotFound
		}
		result = paywall
		return nil
	})
	return result, err
}

func (s *Service) UpdatePaywall(ctx context.Context, actor Actor, projectID, paywallID, name string) (Paywall, error) {
	var result Paywall
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		paywall, ok := tx.Paywall(paywallID)
		if !ok || paywall.ProjectID != projectID {
			return ErrNotFound
		}
		if paywall.Status == "archived" {
			return ErrArchived
		}
		paywall.Name, paywall.UpdatedAt = name, s.now()
		tx.SavePaywall(paywall)
		s.audit(tx, actor, project, "", "paywall.updated", "paywall", paywall.ID, map[string]string{})
		result = paywall
		return nil
	})
	return result, err
}

func (s *Service) CreateDraft(ctx context.Context, actor Actor, projectID, paywallID, environmentID string, document json.RawMessage, sourceVersionID, mutationKey string) (DraftResource, error) {
	ctx, span := s.operation(ctx, "draft.create", actor, attribute.String("mosaic.paywall.id", paywallID), attribute.String("mosaic.environment.id", environmentID))
	defer span.End()
	analysis := s.analyzeDocument(document)
	if analysis.Canonical == nil {
		return DraftResource{}, validationError(analysis.Summary)
	}
	if mutationKey == "" {
		mutationKey = "create:" + digestString(string(analysis.Canonical))
	}
	var result DraftResource
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, _, err := environmentAccess(tx, actor, projectID, environmentID, true)
		if err != nil {
			return err
		}
		paywall, ok := tx.Paywall(paywallID)
		if !ok || paywall.ProjectID != projectID {
			return ErrNotFound
		}
		if paywall.Status == "archived" {
			return ErrArchived
		}
		if analysis.DocumentID != paywall.ID {
			return &ValidationError{Errors: []string{"document_paywall_id_mismatch"}}
		}
		if _, exists := tx.ActiveDraft(paywallID, environmentID); exists {
			return ErrConflict
		}
		if sourceVersionID != "" {
			version, ok := tx.PaywallVersion(sourceVersionID)
			if !ok || version.PaywallID != paywallID || version.EnvironmentID != environmentID {
				return ErrNotFound
			}
		}
		now := s.now()
		draft := Draft{
			ID: tx.NextID("draft"), ProjectID: projectID, PaywallID: paywallID, EnvironmentID: environmentID,
			Status: "active", CurrentRevision: 1, SourceVersionID: sourceVersionID,
			CurrentProtocolVersion: analysis.ProtocolVersion, ValidationStatus: validationStatus(analysis.Summary), ValidationSummary: analysis.Summary,
			CreatedByActorID: actor.ID, UpdatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now,
		}
		revision := DraftRevision{
			DraftID: draft.ID, Revision: 1, ProjectID: projectID, ProtocolVersion: analysis.ProtocolVersion,
			Document: analysis.Canonical, DocumentHash: analysis.Hash, ValidationStatus: draft.ValidationStatus,
			ValidationSummary: analysis.Summary, MutationKeyHash: digestString(mutationKey), RequestHash: digestString(string(analysis.Canonical)),
			ActorID: actor.ID, CreatedAt: now,
		}
		tx.SaveDraft(draft)
		tx.SaveDraftRevision(revision)
		s.audit(tx, actor, project, environmentID, "draft.created", "paywall_draft", draft.ID, map[string]string{"revision": "1"})
		result = DraftResource{Draft: draft, Document: analysis.Canonical, ETag: DraftETag(draft.ID, 1)}
		return nil
	})
	return result, err
}

func (s *Service) CloneVersionDraft(ctx context.Context, actor Actor, projectID, paywallID, versionID, mutationKey string) (DraftResource, error) {
	var version PaywallVersion
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		value, ok := reader.PaywallVersion(versionID)
		if !ok || value.ProjectID != projectID || value.PaywallID != paywallID {
			return ErrNotFound
		}
		version = value
		return nil
	})
	if err != nil {
		return DraftResource{}, err
	}
	return s.CreateDraft(ctx, actor, projectID, paywallID, version.EnvironmentID, version.Document, version.ID, mutationKey)
}

func (s *Service) GetDraft(ctx context.Context, actor Actor, projectID, paywallID, draftID string) (DraftResource, error) {
	var result DraftResource
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		draft, ok := reader.Draft(draftID)
		if !ok || draft.ProjectID != projectID || draft.PaywallID != paywallID {
			return ErrNotFound
		}
		revision, ok := reader.DraftRevision(draft.ID, draft.CurrentRevision)
		if !ok {
			return ErrNotFound
		}
		result = DraftResource{Draft: draft, Document: revision.Document, ETag: DraftETag(draft.ID, draft.CurrentRevision)}
		return nil
	})
	return result, err
}

func (s *Service) GetActiveDraft(ctx context.Context, actor Actor, projectID, paywallID, environmentID string) (DraftResource, error) {
	var result DraftResource
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := environmentAccess(reader, actor, projectID, environmentID, false); err != nil {
			return err
		}
		paywall, ok := reader.Paywall(paywallID)
		if !ok || paywall.ProjectID != projectID {
			return ErrNotFound
		}
		draft, ok := reader.ActiveDraft(paywallID, environmentID)
		if !ok || draft.ProjectID != projectID {
			return ErrNotFound
		}
		revision, ok := reader.DraftRevision(draft.ID, draft.CurrentRevision)
		if !ok {
			return ErrNotFound
		}
		result = DraftResource{Draft: draft, Document: revision.Document, ETag: DraftETag(draft.ID, draft.CurrentRevision)}
		return nil
	})
	return result, err
}

func (s *Service) UpdateDraft(ctx context.Context, actor Actor, projectID, paywallID, draftID, ifMatch, mutationKey string, document json.RawMessage) (DraftResource, error) {
	ctx, span := s.operation(ctx, "draft.update", actor, attribute.String("mosaic.draft.id", draftID))
	defer span.End()
	if strings.TrimSpace(ifMatch) == "" {
		return DraftResource{}, ErrPreconditionRequired
	}
	if strings.TrimSpace(mutationKey) == "" {
		return DraftResource{}, ErrPreconditionRequired
	}
	analysis := s.analyzeDocument(document)
	if analysis.Canonical == nil {
		return DraftResource{}, validationError(analysis.Summary)
	}
	mutationHash := digestString(mutationKey)
	requestHash := requestDigest(struct {
		BaseETag string
		Document json.RawMessage
	}{strings.TrimSpace(ifMatch), analysis.Canonical})
	var result DraftResource
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		tx.LockScope("draft:" + draftID)
		draft, ok := tx.Draft(draftID)
		if !ok || draft.ProjectID != projectID || draft.PaywallID != paywallID {
			return ErrNotFound
		}
		if replay, ok := tx.DraftRevisionByMutation(draftID, mutationHash); ok {
			if replay.RequestHash != requestHash {
				return ErrIdempotencyConflict
			}
			snapshot := draft
			snapshot.Status = "active"
			snapshot.CurrentRevision = replay.Revision
			snapshot.CurrentProtocolVersion = replay.ProtocolVersion
			snapshot.ValidationStatus = replay.ValidationStatus
			snapshot.ValidationSummary = replay.ValidationSummary
			snapshot.UpdatedByActorID = replay.ActorID
			snapshot.UpdatedAt = replay.CreatedAt
			result = DraftResource{Draft: snapshot, Document: replay.Document, ETag: DraftETag(draft.ID, replay.Revision)}
			return nil
		}
		if draft.Status != "active" {
			return ErrArchived
		}
		if analysis.DocumentID != draft.PaywallID {
			return &ValidationError{Errors: []string{"document_paywall_id_mismatch"}}
		}
		if !draftETagMatches(ifMatch, draft) {
			return &ConflictError{Revision: draft.CurrentRevision, ETag: DraftETag(draft.ID, draft.CurrentRevision), UpdatedAt: draft.UpdatedAt, ActorID: draft.UpdatedByActorID}
		}
		now := s.now()
		revisionNumber := draft.CurrentRevision + 1
		revision := DraftRevision{
			DraftID: draft.ID, Revision: revisionNumber, ProjectID: projectID, ProtocolVersion: analysis.ProtocolVersion,
			Document: analysis.Canonical, DocumentHash: analysis.Hash, ValidationStatus: validationStatus(analysis.Summary),
			ValidationSummary: analysis.Summary, MutationKeyHash: mutationHash, RequestHash: requestHash, ActorID: actor.ID, CreatedAt: now,
		}
		draft.CurrentRevision, draft.CurrentProtocolVersion = revisionNumber, analysis.ProtocolVersion
		draft.ValidationStatus, draft.ValidationSummary = revision.ValidationStatus, analysis.Summary
		draft.UpdatedByActorID, draft.UpdatedAt = actor.ID, now
		tx.SaveDraftRevision(revision)
		tx.SaveDraft(draft)
		s.audit(tx, actor, project, draft.EnvironmentID, "draft.updated", "paywall_draft", draft.ID, map[string]string{"revision": formatInt(revisionNumber)})
		result = DraftResource{Draft: draft, Document: analysis.Canonical, ETag: DraftETag(draft.ID, revisionNumber)}
		return nil
	})
	if errors.Is(err, ErrDraftRevisionConflict) {
		span.RecordError(err)
		zerolog.Ctx(ctx).Warn().Str("draft_id", draftID).Msg("draft revision conflict")
	}
	return result, err
}

func (s *Service) ValidateDraft(ctx context.Context, actor Actor, projectID, paywallID, draftID string) (ValidationSummary, error) {
	ctx, span := s.operation(ctx, "draft.validate", actor, attribute.String("mosaic.draft.id", draftID))
	defer span.End()
	resource, err := s.GetDraft(ctx, actor, projectID, paywallID, draftID)
	if err != nil {
		return ValidationSummary{}, err
	}
	return s.analyzeDocument(resource.Document).Summary, nil
}

func (s *Service) ListVersions(ctx context.Context, actor Actor, projectID, paywallID string) (List[PaywallVersion], error) {
	result := List[PaywallVersion]{Items: []PaywallVersion{}}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		paywall, ok := reader.Paywall(paywallID)
		if !ok || paywall.ProjectID != projectID {
			return ErrNotFound
		}
		result.Items = reader.PaywallVersions(paywallID)
		for index := range result.Items {
			result.Items[index].ProductIDs = reader.VersionProducts(result.Items[index].ID)
		}
		return nil
	})
	return result, err
}

func (s *Service) GetVersion(ctx context.Context, actor Actor, projectID, paywallID, versionID string) (PaywallVersion, error) {
	var result PaywallVersion
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		version, ok := reader.PaywallVersion(versionID)
		if !ok || version.ProjectID != projectID || version.PaywallID != paywallID {
			return ErrNotFound
		}
		version.ProductIDs = reader.VersionProducts(version.ID)
		result = version
		return nil
	})
	return result, err
}

func (s *Service) CreatePlacement(ctx context.Context, actor Actor, projectID, key, name, description string) (Placement, error) {
	var result Placement
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		for _, existing := range tx.Placements(projectID) {
			if existing.Key == key {
				return ErrConflict
			}
		}
		now := s.now()
		result = Placement{ID: tx.NextID("placement"), ProjectID: projectID, Key: key, Name: name, Description: description, Status: "active", CreatedByActorID: actor.ID, CreatedAt: now, UpdatedAt: now}
		tx.SavePlacement(result)
		s.audit(tx, actor, project, "", "placement.created", "placement", result.ID, map[string]string{"key": key})
		return nil
	})
	return result, err
}

func (s *Service) ListPlacements(ctx context.Context, actor Actor, projectID string) (List[Placement], error) {
	result := List[Placement]{Items: []Placement{}}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := projectAccess(reader, actor, projectID, false); err != nil {
			return err
		}
		result.Items = reader.Placements(projectID)
		return nil
	})
	return result, err
}

func (s *Service) UpdatePlacement(ctx context.Context, actor Actor, projectID, placementID, name, description string) (Placement, error) {
	var result Placement
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := projectAccess(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		placement, ok := tx.Placement(placementID)
		if !ok || placement.ProjectID != projectID {
			return ErrNotFound
		}
		if placement.Status == "archived" {
			return ErrArchived
		}
		placement.Name, placement.Description, placement.UpdatedAt = name, description, s.now()
		tx.SavePlacement(placement)
		s.audit(tx, actor, project, "", "placement.updated", "placement", placement.ID, map[string]string{})
		result = placement
		return nil
	})
	return result, err
}

func (s *Service) BindPlacement(ctx context.Context, actor Actor, projectID, environmentID, placementID, paywallID string) (PlacementBinding, error) {
	var result PlacementBinding
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, _, err := environmentAccess(tx, actor, projectID, environmentID, true)
		if err != nil {
			return err
		}
		placement, ok := tx.Placement(placementID)
		if !ok || placement.ProjectID != projectID {
			return ErrNotFound
		}
		paywall, ok := tx.Paywall(paywallID)
		if !ok || paywall.ProjectID != projectID {
			return ErrNotFound
		}
		if placement.Status == "archived" || paywall.Status == "archived" {
			return ErrArchived
		}
		result = PlacementBinding{ProjectID: projectID, EnvironmentID: environmentID, PlacementID: placementID, PaywallID: paywallID, UpdatedByActorID: actor.ID, UpdatedAt: s.now()}
		tx.SavePlacementBinding(result)
		s.audit(tx, actor, project, environmentID, "placement.bound", "placement", placementID, map[string]string{"paywallId": paywallID})
		return nil
	})
	return result, err
}

func (s *Service) GetPlacementBinding(ctx context.Context, actor Actor, projectID, environmentID, placementID string) (PlacementBinding, error) {
	var result PlacementBinding
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := environmentAccess(reader, actor, projectID, environmentID, false); err != nil {
			return err
		}
		placement, ok := reader.Placement(placementID)
		if !ok || placement.ProjectID != projectID {
			return ErrNotFound
		}
		binding, ok := reader.PlacementBinding(environmentID, placementID)
		if !ok || binding.ProjectID != projectID {
			return ErrNotFound
		}
		result = binding
		return nil
	})
	return result, err
}

func (s *Service) AuthenticateSDKKey(ctx context.Context, rawKey string) (SDKConfiguration, error) {
	return s.AuthenticateSDKKeyVersion(ctx, rawKey, "1")
}

func (s *Service) AuthenticateSDKKeyVersion(ctx context.Context, rawKey, deliveryVersion string) (SDKConfiguration, error) {
	parts := strings.SplitN(strings.TrimSpace(rawKey), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return SDKConfiguration{}, ErrUnauthenticated
	}
	presented := digestString(rawKey)
	var result SDKConfiguration
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		key, ok := tx.APIKeyByPrefix(parts[0])
		if !ok || key.Kind != "public_sdk" || key.RevokedAt != nil || subtle.ConstantTimeCompare([]byte(presented), []byte(hexDigest(key.SecretDigest))) != 1 {
			return ErrUnauthenticated
		}
		environment, ok := tx.Environment(key.EnvironmentID)
		if !ok {
			return ErrUnauthenticated
		}
		state, ok := tx.ReleaseState(environment.ID)
		if !ok || state.CurrentReleaseID == "" {
			return ErrNoCurrentRelease
		}
		release, ok := tx.Release(state.CurrentReleaseID)
		if !ok || release.EnvironmentID != environment.ID {
			return ErrNoCurrentRelease
		}
		tx.TouchAPIKey(key.ID)
		representation := ReleaseRepresentation{ReleaseID: release.ID, EnvironmentID: environment.ID, DeliveryContractVersion: "1", Payload: release.Payload, ContentHash: release.ContentHash, CreatedAt: release.PublishedAt}
		if deliveryVersion != "1" || release.DeliveryContractVersion == "2" {
			var ok bool
			representation, ok = tx.ReleaseRepresentation(release.ID, deliveryVersion)
			if !ok {
				return ErrUnsupportedCapability
			}
		}
		result = SDKConfiguration{Release: release, Payload: representation.Payload, ContentHash: representation.ContentHash, DeliveryContractVersion: representation.DeliveryContractVersion, Environment: environment, APIKeyID: key.ID}
		return nil
	})
	return result, err
}

func (s *Service) AuthenticateSDKCommerceKey(ctx context.Context, rawKey, applicationID, sdkPlatform string) (SDKCommerceConfiguration, error) {
	parts := strings.SplitN(strings.TrimSpace(rawKey), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return SDKCommerceConfiguration{}, ErrUnauthenticated
	}
	presented := digestString(rawKey)
	var result SDKCommerceConfiguration
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		key, ok := tx.APIKeyByPrefix(parts[0])
		if !ok || key.Kind != "public_sdk" || key.RevokedAt != nil ||
			subtle.ConstantTimeCompare([]byte(presented), []byte(hexDigest(key.SecretDigest))) != 1 {
			return ErrUnauthenticated
		}
		environment, ok := tx.Environment(key.EnvironmentID)
		if !ok {
			return ErrUnauthenticated
		}
		var application Application
		for _, candidate := range tx.Applications(environment.ProjectID) {
			if candidate.ID == applicationID {
				application = candidate
				break
			}
		}
		if application.ID == "" {
			return ErrNotFound
		}
		if (sdkPlatform == "ios" || sdkPlatform == "android") && sdkPlatform != application.Platform {
			return ErrUnsupportedCapability
		}
		state, ok := tx.ReleaseState(environment.ID)
		if !ok || state.CurrentReleaseID == "" {
			return ErrNoCurrentRelease
		}
		snapshot, ok := tx.CommerceConfiguration(state.CurrentReleaseID, application.ID)
		if !ok || snapshot.ProjectID != environment.ProjectID ||
			snapshot.EnvironmentID != environment.ID ||
			snapshot.ApplicationID != application.ID ||
			snapshot.StorePlatform != application.Platform ||
			snapshot.ConfigurationReleaseID != state.CurrentReleaseID {
			return ErrNotFound
		}
		tx.TouchAPIKey(key.ID)
		result = SDKCommerceConfiguration{
			Snapshot: snapshot, Environment: environment, APIKeyID: key.ID,
		}
		return nil
	})
	return result, err
}

func hexDigest(value []byte) string {
	const digits = "0123456789abcdef"
	result := make([]byte, len(value)*2)
	for i, item := range value {
		result[i*2], result[i*2+1] = digits[item>>4], digits[item&0x0f]
	}
	return string(result)
}

func sortPlacements(values []ReleasePlacement) {
	sort.Slice(values, func(i, j int) bool { return values[i].PlacementKey < values[j].PlacementKey })
}
