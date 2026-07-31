package billingdiagnostics

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// ErrInvalid is a replay request that is not bounded, or that names a rule
// version this build does not derive under.
var ErrInvalid = errors.New("the replay request is not valid")

// Replayer is the narrow port onto the projection service.
//
// It is an interface rather than the concrete service so this package cannot
// reach the projection commit path except through a bounded replay. Diagnostics
// is a read surface with exactly one write it is allowed to trigger, and the
// port is the whole of that permission.
type Replayer interface {
	RunReplay(ctx context.Context, keys billingprojection.ReplayScopeKeys,
		replay billingprojection.Replay, scope billingprojection.ReplayScope, limit int) ([]billingprojection.ReplayResult, error)
}

// ReplayRequest is one bounded replay an operator asked for.
type ReplayRequest struct {
	SubscriptionInstanceID string
	CustomerID             string
	WindowStart            *time.Time
	WindowEnd              *time.Time
	// RuleVersion selects the projection semantics. Zero means the active one.
	RuleVersion int
	Limit       int
}

// bounded reports whether the request names something smaller than "everything".
//
// An unbounded replay is not a replay, it is a migration, and bulk migration
// tooling is explicitly out of Phase 9B (plan §18). A project-window replay
// counts as bounded only when it actually carries a window: without one, "the
// whole Project" is what would run.
func (r ReplayRequest) bounded() bool {
	return r.SubscriptionInstanceID != "" || r.CustomerID != "" ||
		(r.WindowStart != nil && r.WindowEnd != nil)
}

// ReplayOutcome is the result of one replayed scope, plus the rule version it
// was derived under so a caller comparing two runs can tell them apart.
type ReplayOutcome struct {
	ScopeKey     string   `json:"projectionScopeKey"`
	Comparison   string   `json:"comparison"`
	Materialized bool     `json:"materialized"`
	Changed      []string `json:"changedEntitlementIds,omitempty"`
}

// ReplayResponse is the whole run.
type ReplayResponse struct {
	RuleVersion int             `json:"projectionRuleVersion"`
	Scopes      int             `json:"scopesReplayed"`
	Changed     int             `json:"scopesChanged"`
	Outcomes    []ReplayOutcome `json:"outcomes"`
}

// Replay runs a bounded projection replay for an authorized operator.
//
// Replay is the operational expression of principle 2: a projection is derived
// state, so a corrupt checkpoint, a promoted rule version, or a mapping repair
// is answered by recomputing from the immutable facts rather than by patching
// what was derived. It reuses the ordinary projection command, so replayed
// state goes through the same lock, compare-and-swap, and atomic commit as live
// projection — there is no second write path that could diverge — and prior
// snapshots are never deleted.
//
// Provider asymmetry, stated rather than hidden: Apple replay is input-sourced,
// because a stored Apple payload re-validates to the same transaction. Google
// replay is fact-sourced, because Google validation re-queries live provider
// state and a re-query today does not reproduce what the provider said last
// month.
func (s *Service) Replay(ctx context.Context, actor Actor, projectID, environmentID string,
	request ReplayRequest) (ReplayResponse, error) {

	ctx, span := s.tracer.Start(ctx, "billing.projection.replay")
	defer span.End()

	if s.replayer == nil || s.replayScopes == nil {
		return ReplayResponse{}, ErrUnavailable
	}
	if !request.bounded() {
		return ReplayResponse{}, ErrInvalid
	}
	if !billingprojection.RuleVersionImplemented(request.RuleVersion) {
		// Refused rather than approximated. Recomputing under the active engine
		// and labelling the answer with the requested version would make the
		// checksum comparison — the entire point of a replay — meaningless.
		return ReplayResponse{}, ErrInvalid
	}
	if err := s.repository.AuthorizeReplay(ctx, actor, projectID, environmentID); err != nil {
		return ReplayResponse{}, err
	}

	results, err := s.replayer.RunReplay(ctx, s.replayScopes,
		billingprojection.Replay{RuleVersion: request.RuleVersion},
		billingprojection.ReplayScope{
			ProjectID:              projectID,
			CustomerID:             request.CustomerID,
			SubscriptionInstanceID: request.SubscriptionInstanceID,
			WindowStart:            request.WindowStart,
			WindowEnd:              request.WindowEnd,
		}, request.Limit)
	if err != nil {
		switch {
		case errors.Is(err, billingprojection.ErrUnsupportedRuleVersion):
			return ReplayResponse{}, ErrInvalid
		case errors.Is(err, billingprojection.ErrBillingDisabled):
			return ReplayResponse{}, ErrBillingDisabled
		default:
			return ReplayResponse{}, ErrUnavailable
		}
	}

	response := ReplayResponse{
		RuleVersion: billingprojection.ResolveRuleVersion(request.RuleVersion),
		Scopes:      len(results),
		Outcomes:    make([]ReplayOutcome, 0, len(results)),
	}
	for _, result := range results {
		if result.Comparison == billingprojection.ComparisonChanged {
			response.Changed++
		}
		response.Outcomes = append(response.Outcomes, ReplayOutcome{
			ScopeKey: result.ScopeKey, Comparison: result.Comparison,
			Materialized: result.Materialized, Changed: result.Changed,
		})
	}
	span.SetAttributes(
		attribute.Int("mosaic.billing.replay.rule_version", response.RuleVersion),
		attribute.Int("mosaic.billing.replay.scopes", response.Scopes),
		attribute.Int("mosaic.billing.replay.changed", response.Changed))

	// Audited: a replay is a write, and a checksum that moved is exactly the
	// kind of change an investigation needs to be able to attribute.
	if err := s.repository.RecordReplayAudit(ctx, actor, projectID, environmentID,
		response.RuleVersion, response.Scopes, response.Changed, time.Now().UTC()); err != nil {
		return response, nil
	}
	return response, nil
}

// ErrBillingDisabled is a service state, never a statement about a customer.
var ErrBillingDisabled = errors.New("billing is not enabled for this Project")
