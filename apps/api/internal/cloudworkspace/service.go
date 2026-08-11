package cloudworkspace

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"io"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

const defaultPageLimit = 25

type Service struct {
	repository          Repository
	now                 func() time.Time
	random              io.Reader
	tracer              trace.Tracer
	credentialCipher    providercredential.CredentialCipher
	providerCatalogs    ProviderCatalogClients
	providerSnapshotTTL time.Duration
}

// ProviderCatalogClients resolves the catalog adapter for one server-connected
// provider kind. A provider with no registered adapter is unsupported rather
// than silently served by another provider's client.
type ProviderCatalogClients map[ProviderKind]providercatalog.Client

// catalogClient returns the adapter for provider, or ErrProviderUnsupported.
func (s *Service) catalogClient(provider ProviderKind) (providercatalog.Client, error) {
	client, ok := s.providerCatalogs[provider]
	if !ok || client == nil {
		return nil, ErrProviderUnsupported
	}
	return client, nil
}

// hasCatalogClient reports whether a server-connected adapter is registered.
func (s *Service) hasCatalogClient(provider ProviderKind) bool {
	client, ok := s.providerCatalogs[provider]
	return ok && client != nil
}

type ServiceOption func(*Service)

func WithClock(now func() time.Time) ServiceOption {
	return func(service *Service) { service.now = now }
}

func WithRandom(random io.Reader) ServiceOption {
	return func(service *Service) { service.random = random }
}

// WithProviderOperations enables server-connected provider operations with one
// catalog adapter per supported provider kind.
func WithProviderOperations(cipher providercredential.CredentialCipher, catalogs ProviderCatalogClients, snapshotTTL time.Duration) ServiceOption {
	return func(service *Service) {
		service.credentialCipher = cipher
		service.providerCatalogs = catalogs
		service.providerSnapshotTTL = snapshotTTL
	}
}

func NewService(repository Repository, options ...ServiceOption) *Service {
	service := &Service{
		repository:          repository,
		now:                 func() time.Time { return time.Now().UTC() },
		random:              rand.Reader,
		tracer:              otel.Tracer("github.com/Mujhtech/mosaic/apps/api/cloudworkspace"),
		providerSnapshotTTL: 24 * time.Hour,
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func requireActor(actor Actor) error {
	if strings.TrimSpace(actor.ID) == "" {
		return ErrUnauthenticated
	}
	return nil
}

func roleFor(reader Reader, actor Actor, organizationID string) (Role, error) {
	if err := requireActor(actor); err != nil {
		return "", err
	}
	membership, ok := reader.Membership(organizationID, actor.ID)
	if !ok {
		return "", ErrForbidden
	}
	return membership.Role, nil
}

func requireWriter(reader Reader, actor Actor, organizationID string) (Role, error) {
	role, err := roleFor(reader, actor, organizationID)
	if err != nil {
		return "", err
	}
	if role != RoleOwner && role != RoleAdmin {
		return "", ErrForbidden
	}
	return role, nil
}

func projectScope(reader Reader, actor Actor, projectID string, write bool) (Project, Role, error) {
	project, ok := reader.Project(projectID)
	if !ok {
		return Project{}, "", ErrNotFound
	}
	var role Role
	var err error
	if write {
		role, err = requireWriter(reader, actor, project.OrganizationID)
	} else {
		role, err = roleFor(reader, actor, project.OrganizationID)
	}
	return project, role, err
}

func environmentScope(reader Reader, actor Actor, environmentID string, write bool) (Environment, Project, error) {
	environment, ok := reader.Environment(environmentID)
	if !ok {
		return Environment{}, Project{}, ErrNotFound
	}
	project, _, err := projectScope(reader, actor, environment.ProjectID, write)
	return environment, project, err
}

func (s *Service) operation(ctx context.Context, name string, actor Actor, attributes ...attribute.KeyValue) (context.Context, trace.Span) {
	attributes = append(attributes, attribute.String("mosaic.actor.id", actor.ID))
	return s.tracer.Start(ctx, name, trace.WithAttributes(attributes...))
}

func (s *Service) audit(tx Transaction, actor Actor, organizationID, projectID, environmentID, action, resourceType, resourceID string, metadata map[string]string) {
	tx.SaveAuditEvent(AuditEvent{
		ID:             tx.NextID("audit"),
		ActorID:        actor.ID,
		OrganizationID: organizationID,
		ProjectID:      projectID,
		EnvironmentID:  environmentID,
		Action:         action,
		ResourceType:   resourceType,
		ResourceID:     resourceID,
		Metadata:       metadata,
		CreatedAt:      s.now(),
	})
}

func logMutation(ctx context.Context, action string, actor Actor, organizationID, projectID, resourceID string) {
	zerolog.Ctx(ctx).Info().
		Str("actor_id", actor.ID).
		Str("organization_id", organizationID).
		Str("project_id", projectID).
		Str("resource_id", resourceID).
		Str("action", action).
		Msg("cloud workspace mutation completed")
}

func pageOptions(options ListOptions) ListOptions {
	if options.Limit <= 0 {
		options.Limit = defaultPageLimit
	}
	if options.Limit > 100 {
		options.Limit = 100
	}
	return options
}

func paginate[T any](values []T, options ListOptions, id func(T) string) (List[T], error) {
	options = pageOptions(options)
	start := 0
	if options.Cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(options.Cursor)
		if err != nil || len(decoded) == 0 {
			return List[T]{}, ErrInvalidCursor
		}
		found := false
		for index, value := range values {
			if id(value) == string(decoded) {
				start = index + 1
				found = true
				break
			}
		}
		if !found {
			return List[T]{}, ErrInvalidCursor
		}
	}
	end := start + options.Limit
	if end > len(values) {
		end = len(values)
	}
	items := make([]T, end-start)
	copy(items, values[start:end])
	page := Page{}
	if end < len(values) && len(items) > 0 {
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(id(items[len(items)-1])))
	}
	return List[T]{Items: items, Page: page}, nil
}

func paginated[T any](values []T, options ListOptions, id func(T) string, readErr error) (List[T], error) {
	if readErr != nil {
		return List[T]{}, readErr
	}
	return paginate(values, options, id)
}

func (s *Service) CreateOrganization(ctx context.Context, actor Actor, name string) (Organization, error) {
	ctx, span := s.operation(ctx, "organization.create", actor)
	defer span.End()
	if err := requireActor(actor); err != nil {
		return Organization{}, err
	}
	var result Organization
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		now := s.now()
		result = Organization{ID: tx.NextID("org"), Name: name, CreatedAt: now, UpdatedAt: now}
		tx.SaveOrganization(result)
		tx.SaveMembership(Membership{OrganizationID: result.ID, ActorID: actor.ID, Role: RoleOwner, CreatedAt: now, UpdatedAt: now})
		s.audit(tx, actor, result.ID, "", "", "organization.created", "organization", result.ID, map[string]string{})
		return nil
	})
	if err == nil {
		logMutation(ctx, "organization.created", actor, result.ID, "", result.ID)
	}
	return result, err
}

func (s *Service) ListOrganizations(ctx context.Context, actor Actor, options ListOptions) (List[Organization], error) {
	if err := requireActor(actor); err != nil {
		return List[Organization]{}, err
	}
	var values []Organization
	err := s.repository.View(ctx, func(reader Reader) error {
		values = reader.OrganizationsForActor(actor.ID)
		return nil
	})
	return paginated(values, options, func(value Organization) string { return value.ID }, err)
}

func (s *Service) GetOrganization(ctx context.Context, actor Actor, id string) (Organization, error) {
	var result Organization
	err := s.repository.View(ctx, func(reader Reader) error {
		value, ok := reader.Organization(id)
		if !ok {
			return ErrNotFound
		}
		if _, err := roleFor(reader, actor, id); err != nil {
			return err
		}
		result = value
		return nil
	})
	return result, err
}

func (s *Service) UpdateOrganization(ctx context.Context, actor Actor, id, name string) (Organization, error) {
	ctx, span := s.operation(ctx, "organization.update", actor, attribute.String("mosaic.organization.id", id))
	defer span.End()
	var result Organization
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		value, ok := tx.Organization(id)
		if !ok {
			return ErrNotFound
		}
		if _, err := requireWriter(tx, actor, id); err != nil {
			return err
		}
		value.Name, value.UpdatedAt = name, s.now()
		tx.SaveOrganization(value)
		s.audit(tx, actor, id, "", "", "organization.updated", "organization", id, map[string]string{})
		result = value
		return nil
	})
	if err == nil {
		logMutation(ctx, "organization.updated", actor, id, "", id)
	}
	return result, err
}

func (s *Service) ListMembers(ctx context.Context, actor Actor, organizationID string, options ListOptions) (List[Membership], error) {
	var values []Membership
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, ok := reader.Organization(organizationID); !ok {
			return ErrNotFound
		}
		if _, err := roleFor(reader, actor, organizationID); err != nil {
			return err
		}
		values = reader.Memberships(organizationID)
		return nil
	})
	return paginated(values, options, func(value Membership) string { return value.ActorID }, err)
}

func (s *Service) AddMember(ctx context.Context, actor Actor, organizationID, memberActorID string, role Role) (Membership, error) {
	ctx, span := s.operation(ctx, "member.add", actor, attribute.String("mosaic.organization.id", organizationID))
	defer span.End()
	var result Membership
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		tx.LockScope("organization:" + organizationID)
		if _, ok := tx.Organization(organizationID); !ok {
			return ErrNotFound
		}
		actorRole, err := requireWriter(tx, actor, organizationID)
		if err != nil {
			return err
		}
		if actorRole == RoleAdmin && role == RoleOwner {
			return ErrForbidden
		}
		if _, ok := tx.Membership(organizationID, memberActorID); ok {
			return &ConflictError{Resource: "membership", Field: "actorId"}
		}
		now := s.now()
		result = Membership{OrganizationID: organizationID, ActorID: memberActorID, Role: role, CreatedAt: now, UpdatedAt: now}
		tx.SaveMembership(result)
		s.audit(tx, actor, organizationID, "", "", "member.added", "membership", memberActorID, map[string]string{"role": string(role)})
		return nil
	})
	if err == nil {
		logMutation(ctx, "member.added", actor, organizationID, "", memberActorID)
	}
	return result, err
}

func ownerCount(memberships []Membership) int {
	count := 0
	for _, membership := range memberships {
		if membership.Role == RoleOwner {
			count++
		}
	}
	return count
}

func (s *Service) UpdateMember(ctx context.Context, actor Actor, organizationID, memberActorID string, role Role) (Membership, error) {
	ctx, span := s.operation(ctx, "member.update", actor, attribute.String("mosaic.organization.id", organizationID))
	defer span.End()
	var result Membership
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		tx.LockScope("organization:" + organizationID)
		actorRole, err := requireWriter(tx, actor, organizationID)
		if err != nil {
			return err
		}
		membership, ok := tx.Membership(organizationID, memberActorID)
		if !ok {
			return ErrNotFound
		}
		if actorRole == RoleAdmin && (membership.Role == RoleOwner || role == RoleOwner) {
			return ErrForbidden
		}
		if membership.Role == RoleOwner && role != RoleOwner && ownerCount(tx.Memberships(organizationID)) == 1 {
			return ErrLastOwner
		}
		membership.Role, membership.UpdatedAt = role, s.now()
		tx.SaveMembership(membership)
		s.audit(tx, actor, organizationID, "", "", "member.updated", "membership", memberActorID, map[string]string{"role": string(role)})
		result = membership
		return nil
	})
	if err == nil {
		logMutation(ctx, "member.updated", actor, organizationID, "", memberActorID)
	}
	return result, err
}

func (s *Service) RemoveMember(ctx context.Context, actor Actor, organizationID, memberActorID string) error {
	ctx, span := s.operation(ctx, "member.remove", actor, attribute.String("mosaic.organization.id", organizationID))
	defer span.End()
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		tx.LockScope("organization:" + organizationID)
		actorRole, err := requireWriter(tx, actor, organizationID)
		if err != nil {
			return err
		}
		membership, ok := tx.Membership(organizationID, memberActorID)
		if !ok {
			return ErrNotFound
		}
		if actorRole == RoleAdmin && membership.Role == RoleOwner {
			return ErrForbidden
		}
		if membership.Role == RoleOwner && ownerCount(tx.Memberships(organizationID)) == 1 {
			return ErrLastOwner
		}
		tx.DeleteMembership(organizationID, memberActorID)
		s.audit(tx, actor, organizationID, "", "", "member.removed", "membership", memberActorID, map[string]string{})
		return nil
	})
	if err == nil {
		logMutation(ctx, "member.removed", actor, organizationID, "", memberActorID)
	}
	return err
}

func (s *Service) ListAuditEvents(ctx context.Context, actor Actor, organizationID string, filters AuditFilters) (List[AuditEvent], error) {
	var values []AuditEvent
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, err := roleFor(reader, actor, organizationID); err != nil {
			return err
		}
		for _, event := range reader.AuditEvents(organizationID) {
			if filters.ProjectID != "" && event.ProjectID != filters.ProjectID {
				continue
			}
			if filters.Action != "" && event.Action != filters.Action {
				continue
			}
			values = append(values, event)
		}
		return nil
	})
	return paginated(values, filters.ListOptions, func(value AuditEvent) string { return value.ID }, err)
}
