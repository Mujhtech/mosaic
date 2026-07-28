package billingprojection

import (
	"context"
	"time"
)

// Replay recomputes projections from facts, ignoring checkpoints, and reports
// what would change.
//
// Replay exists because projections are rebuildable (principle 2): if a
// checkpoint is corrupt, a rule version is promoted, or a mapping repair
// changes what a historical fact means, the answer is to recompute from the
// immutable facts rather than to patch derived state.
//
// Provider asymmetry, stated rather than hidden: Apple replay is
// input-sourced, because a stored Apple payload re-validates to the same
// transaction. Google replay is fact-sourced, because Google validation
// re-queries live provider state and a re-query today does not reproduce what
// the provider said last month. A Google replay therefore replays the facts
// Mosaic recorded, not the provider's current answer.
type Replay struct {
	// ChangesOnly materializes a new snapshot only where the checksum differs
	// from the committed one. It is the default because a replay that mints a
	// snapshot per customer regardless of outcome would churn every SDK cache
	// in the Project for no reason.
	ChangesOnly bool
	// RuleVersion selects the projection semantics to replay under. Zero means
	// the active version.
	RuleVersion int
}

// ReplayScope bounds one replay. Exactly one of the three is set; a replay
// with no bound is not a replay, it is a migration, and bulk migration tooling
// stays out of this phase.
type ReplayScope struct {
	SubscriptionInstanceID string
	CustomerID             string
	// ProjectWindow replays every scope in a Project whose facts fall inside
	// the window. It is bounded in time deliberately.
	ProjectID   string
	WindowStart *time.Time
	WindowEnd   *time.Time
}

// ReplayResult reports one replayed scope.
type ReplayResult struct {
	ScopeKey string
	// Comparison is `unchanged` when the recomputed checksum equals the
	// committed one, `changed` otherwise. It is the whole point of a replay:
	// proving determinism, or naming exactly what a rule change moved.
	Comparison string
	// Materialized reports whether a new snapshot was actually written.
	Materialized bool
	Changed      []string
}

// Comparison outcomes.
const (
	ComparisonUnchanged = "unchanged"
	ComparisonChanged   = "changed"
)

// ReplayScopeKeys is the port a replay uses to enumerate the scopes it will
// recompute. It is separate from Repository because a replay reads a different
// shape than a projection does and must not be able to reach the commit path
// except through Project.
type ReplayScopeKeys interface {
	ScopesForReplay(ctx context.Context, scope ReplayScope, limit int) ([]Scope, error)
}

// RunReplay recomputes the scopes a replay names and reports the comparison
// for each. It reuses the ordinary projection command, so replayed state goes
// through exactly the same lock, compare-and-swap, and atomic commit as live
// projection — there is no second write path that could diverge.
//
// Prior snapshots are never deleted. A replay that changes state appends a new
// snapshot version; the history that preceded it stays readable.
func (s *Service) RunReplay(ctx context.Context, keys ReplayScopeKeys, replay Replay, scope ReplayScope, limit int) ([]ReplayResult, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil && scope.ProjectID != "" {
		return nil, err
	}
	scopes, err := keys.ScopesForReplay(ctx, scope, limit)
	if err != nil {
		return nil, ErrUnavailable
	}

	results := make([]ReplayResult, 0, len(scopes))
	for _, target := range scopes {
		output, err := s.Project(ctx, target, "")
		if err != nil {
			// One failed scope does not abandon the run: a replay is a
			// diagnostic operation and a partial answer is more useful than
			// none, as long as the failure is visible.
			results = append(results, ReplayResult{ScopeKey: target.Key(), Comparison: ComparisonChanged})
			continue
		}
		result := ReplayResult{
			ScopeKey:     target.Key(),
			Comparison:   ComparisonUnchanged,
			Materialized: output.CustomerSnapshot != nil,
			Changed:      output.Changes.Changed,
		}
		if output.Outcome == OutcomeProjected {
			result.Comparison = ComparisonChanged
		}
		results = append(results, result)
	}
	return results, nil
}
