package billingdiagnostics

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Stable domain errors, mapped onto HTTP in exactly one place by the handler.
var (
	ErrUnauthenticated = errors.New("an authenticated actor is required")
	ErrForbidden       = errors.New("the actor may not read this Project's projection health")
	ErrNotFound        = errors.New("the Environment was not found")
	ErrUnavailable     = errors.New("projection health could not be read")
)

// Actor is the authenticated operator. Authorization is decided server-side by
// the repository against organization membership, never by the handler.
type Actor struct{ ID string }

// Repository is the persistence port.
type Repository interface {
	BillingEnabled(ctx context.Context, projectID string) (bool, error)
	ProjectionHealth(ctx context.Context, actor Actor, projectID, environmentID string) (ProjectionHealth, error)
}

// Service is the diagnostics application service. It is thin by nature — the
// surface is a read — but it owns the enablement decision and the tracing, so
// the handler stays a transport adapter.
type Service struct {
	repository Repository
	tracer     trace.Tracer
}

func NewService(repository Repository) *Service {
	return &Service{
		repository: repository,
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingdiagnostics"),
	}
}

// ProjectionHealth reports the Environment's projection health.
//
// A Project with billing disabled still gets an answer rather than an error:
// the surface exists to tell an operator what state Mosaic is in, and "billing
// is off" is one of those states. Every count is zero in that case, which is
// true — a disabled Project holds no billing state.
func (s *Service) ProjectionHealth(ctx context.Context, actor Actor, projectID, environmentID string) (ProjectionHealth, error) {
	ctx, span := s.tracer.Start(ctx, "billing.projection.health")
	defer span.End()
	span.SetAttributes(attribute.String("mosaic.environment.id", environmentID))

	health, err := s.repository.ProjectionHealth(ctx, actor, projectID, environmentID)
	if err != nil {
		if errors.Is(err, ErrUnauthenticated) || errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return ProjectionHealth{}, err
		}
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("environment_id", environmentID).
			Str("diagnostics_error_kind", fmt.Sprintf("%T", err)).
			Msg("projection health could not be read")
		return ProjectionHealth{}, ErrUnavailable
	}
	span.SetAttributes(
		attribute.Int64("mosaic.billing.projection.queue_depth", health.ProjectionQueueDepth),
		attribute.Int64("mosaic.billing.projection.stale_customers", health.StaleCustomers),
		attribute.Int64("mosaic.billing.identity.open_conflicts", health.OpenIdentityConflicts))
	return health, nil
}
