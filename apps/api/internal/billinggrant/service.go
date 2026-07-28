package billinggrant

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Service is the grant-version application service.
//
// It owns three decisions and no persistence: whether Billing is on for the
// Project, whether the actor may do what they asked, and whether the proposed
// version is a permitted change. The handler makes none of them.
type Service struct {
	repository Repository
	now        func() time.Time
	tracer     trace.Tracer
}

type Option func(*Service)

// WithClock makes publish timestamps deterministic for tests.
func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func NewService(repository Repository, options ...Option) *Service {
	service := &Service{
		repository: repository,
		now:        func() time.Time { return time.Now().UTC() },
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billinggrant"),
	}
	for _, option := range options {
		option(service)
	}
	return service
}

// ListVersions reports a pair's grant history.
//
// Reading is permitted to any member of the owning organization. The history is
// the answer to "why is this customer entitled?", and an operator who can see
// the customer's entitlements but not the rule that produced them has been given
// a fact with no explanation.
func (s *Service) ListVersions(ctx context.Context, actor Actor, projectID string, filter ListFilter) ([]Version, error) {
	ctx, span := s.tracer.Start(ctx, "billing.grant.versions.list")
	defer span.End()

	if _, err := s.authorize(ctx, actor, projectID, false); err != nil {
		return nil, err
	}
	if strings.TrimSpace(filter.ProductID) == "" {
		return nil, fmt.Errorf("%w: a history read names one Product", ErrInvalid)
	}
	versions, err := s.repository.ListVersions(ctx, projectID, filter.Bounded())
	if err != nil {
		return nil, s.unavailable(ctx, projectID, "grant versions could not be listed", err)
	}
	span.SetAttributes(attribute.Int("mosaic.billing.grant.versions", len(versions)))
	return versions, nil
}

// PreviewImpact reports what a change would touch, and changes nothing.
//
// It is a POST because it carries a proposal in the body, not because it has an
// effect. Nothing here writes, including the audit trail: an operator comparing
// three candidate policies before choosing one has not made three changes.
func (s *Service) PreviewImpact(ctx context.Context, actor Actor, projectID string, input PublishInput) (Impact, error) {
	ctx, span := s.tracer.Start(ctx, "billing.grant.impact.preview")
	defer span.End()

	// A preview is gated on the *write* permission even though it writes
	// nothing. It is a step in a change workflow, and the counts it reports
	// describe how much damage the change could do; an actor who may not make
	// the change has no reason to be shown the blast radius.
	if _, err := s.authorize(ctx, actor, projectID, true); err != nil {
		return Impact{}, err
	}
	input = Normalize(input)
	if err := ValidateShape(input); err != nil {
		return Impact{}, err
	}

	impact, err := s.repository.Impact(ctx, projectID, input.ProductID, input.EntitlementID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return Impact{}, err
		}
		return Impact{}, s.unavailable(ctx, projectID, "grant impact could not be computed", err)
	}
	impact.Retroactive = input.Retroactive
	impact.ObservedAt = s.now()

	current, found, err := s.repository.CurrentVersion(ctx, projectID, input.ProductID, input.EntitlementID)
	if err != nil {
		return Impact{}, s.unavailable(ctx, projectID, "the current grant version could not be read", err)
	}
	if found {
		impact.CurrentVersion = &current
		impact.AdditiveSuperset = true
		if code, ok := CheckAdditiveSuperset(current, input); !ok {
			impact.AdditiveSuperset, impact.NarrowingCode = false, code
		}
	} else {
		// With nothing in force, every proposal is trivially a superset: there
		// is no access to take away.
		impact.AdditiveSuperset = true
	}

	span.SetAttributes(
		attribute.Int("mosaic.billing.grant.impact.customers", impact.ImpactedCustomers),
		attribute.Int("mosaic.billing.grant.impact.active_sources", impact.ImpactedActiveSources),
		attribute.Bool("mosaic.billing.grant.impact.retroactive", impact.Retroactive))
	return impact, nil
}

// Publish records a new immutable grant version.
//
// Publishing is the explicit, separate act. Nothing else on this surface
// changes what a Product grants: the preview reports and the history reads, and
// only this call, carrying an actor and a reason, writes. The audit event and
// the reprojection it enqueues are part of the same transaction as the version
// itself.
func (s *Service) Publish(ctx context.Context, actor Actor, projectID string, input PublishInput) (Version, error) {
	ctx, span := s.tracer.Start(ctx, "billing.grant.version.publish")
	defer span.End()

	role, err := s.authorize(ctx, actor, projectID, true)
	if err != nil {
		return Version{}, err
	}
	input = Normalize(input)
	if err := ValidateShape(input); err != nil {
		return Version{}, err
	}
	if strings.TrimSpace(input.Reason) == "" {
		// The reason is what an investigation reads months later, when the
		// operator who published is gone and the only remaining question is why
		// access changed. It costs one sentence now and is unrecoverable later.
		return Version{}, fmt.Errorf("%w: a published grant version must state why", ErrInvalid)
	}
	// Granting access during billing retry contradicts both providers'
	// documentation (plan §7), so it is closed by default and enabling it is an
	// owner decision rather than an ordinary catalog edit.
	if input.Policy.GrantsInBillingRetry && role != RoleOwner {
		return Version{}, fmt.Errorf(
			"%w: granting access during billing retry contradicts provider documentation and requires an organization owner",
			ErrForbidden)
	}

	now := s.now()
	published, err := s.repository.Publish(ctx, actor, projectID, input,
		func(existing []Version, at time.Time) (Plan, error) {
			return PlanPublish(existing, input, at)
		}, now)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalid), errors.Is(err, ErrOverlap),
			errors.Is(err, ErrNotAdditiveSuperset), errors.Is(err, ErrNotFound),
			errors.Is(err, ErrConflict), errors.Is(err, ErrImmutable):
			return Version{}, err
		}
		return Version{}, s.unavailable(ctx, projectID, "the grant version could not be published", err)
	}

	span.SetAttributes(
		attribute.String("mosaic.billing.grant.version.id", published.ID),
		attribute.Int("mosaic.billing.grant.version.number", published.Version),
		attribute.Bool("mosaic.billing.grant.version.retroactive", published.Retroactive))
	// The reason is operator-authored free text and is deliberately not logged:
	// it is recorded in the audit event, which is access-controlled, while
	// operator logs are not.
	zerolog.Ctx(ctx).Info().
		Str("project_id", projectID).
		Str("actor_id", actor.ID).
		Str("product_id", published.ProductID).
		Str("entitlement_id", published.EntitlementID).
		Str("grant_version_id", published.ID).
		Int("grant_version", published.Version).
		Bool("retroactive", published.Retroactive).
		Msg("product-to-entitlement grant version published")
	return published, nil
}

// Version reads one recorded version.
func (s *Service) Version(ctx context.Context, actor Actor, projectID, versionID string) (Version, error) {
	if _, err := s.authorize(ctx, actor, projectID, false); err != nil {
		return Version{}, err
	}
	versions, err := s.repository.ListVersions(ctx, projectID, ListFilter{Limit: 1, VersionID: versionID})
	if err != nil {
		return Version{}, s.unavailable(ctx, projectID, "the grant version could not be read", err)
	}
	if len(versions) == 0 {
		return Version{}, ErrNotFound
	}
	return versions[0], nil
}

// authorize resolves the actor's role and applies the read/write split.
func (s *Service) authorize(ctx context.Context, actor Actor, projectID string, write bool) (string, error) {
	if strings.TrimSpace(actor.ID) == "" {
		return "", ErrUnauthenticated
	}
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		// Fails closed, matching the ingestion, projection, and access paths: an
		// unreadable setting must not quietly re-enable a Project that asked
		// Mosaic to hold no billing state.
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("grant_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; treating the Project as disabled")
		return "", ErrBillingDisabled
	}
	if !enabled {
		return "", ErrBillingDisabled
	}
	role, err := s.repository.Role(ctx, actor, projectID)
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) || errors.Is(err, ErrUnauthenticated) {
			return "", err
		}
		return "", s.unavailable(ctx, projectID, "the actor's role could not be resolved", err)
	}
	if !write {
		return role, nil
	}
	switch role {
	case RoleOwner, RoleAdmin:
		return role, nil
	default:
		return "", ErrForbidden
	}
}

// unavailable logs the shape of a storage failure and returns the stable domain
// error. The cause never reaches the response: on this surface it can quote SQL
// and identifiers from other tenants' rows.
func (s *Service) unavailable(ctx context.Context, projectID, message string, err error) error {
	zerolog.Ctx(ctx).Error().
		Str("project_id", projectID).
		Str("grant_error_kind", fmt.Sprintf("%T", err)).
		Msg(message)
	return ErrUnavailable
}
