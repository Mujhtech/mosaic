package billingdiagnostics

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
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
	// AuthorizeReplay is separate from the health authorization because a
	// replay is a write. It is the only permission check in this package that
	// guards state change rather than a read.
	AuthorizeReplay(ctx context.Context, actor Actor, projectID, environmentID string) error
	RecordReplayAudit(ctx context.Context, actor Actor, projectID, environmentID string,
		ruleVersion, scopes, changed int, now time.Time) error
}

// Service is the diagnostics application service. It is thin by nature — the
// surface is a read — but it owns the enablement decision and the tracing, so
// the handler stays a transport adapter.
type Service struct {
	repository Repository
	tracer     trace.Tracer

	replayer     Replayer
	replayScopes billingprojection.ReplayScopeKeys
}

type Option func(*Service)

// WithReplay enables the bounded projection-replay operation.
//
// Both halves are required together. A replay needs the projection command and
// the scope enumeration; having one without the other is not a degraded replay,
// it is no replay, so the option refuses a partial configuration rather than
// leaving an endpoint that fails at the first request.
func WithReplay(replayer Replayer, scopes billingprojection.ReplayScopeKeys) Option {
	return func(s *Service) {
		if replayer != nil && scopes != nil {
			s.replayer, s.replayScopes = replayer, scopes
		}
	}
}

func NewService(repository Repository, options ...Option) *Service {
	service := &Service{
		repository: repository,
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingdiagnostics"),
	}
	for _, option := range options {
		option(service)
	}
	return service
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
