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
//
// Materialization is changes-only and has no switch. Plan §12 names
// `changes_only` as the *default*; there is no second mode, because the
// projection command mints a customer snapshot only when the recomputed
// checksum differs from the committed one, and a replay reuses that command
// rather than owning a second write path. A `ChangesOnly` field was previously
// declared here and never read (review finding I-12); it has been removed
// rather than left as a parameter that lies about being adjustable. Restoring
// the alternative would mean a "materialize regardless" write path, which is
// churn every SDK cache in the Project for no observable change.
type Replay struct {
	// RuleVersion selects the projection semantics to replay under. Zero means
	// the active version. A version this build does not derive under is refused
	// with ErrUnsupportedRuleVersion rather than approximated by the active
	// engine — see implementedRuleVersions.
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
	ProjectID string
	// WindowStart and WindowEnd bound the replay on *facts*, not on lineage
	// creation: a scope is in scope when it holds at least one fact whose
	// effective or recorded time falls inside the window. Bounding on
	// `purchase_lineages.created_at` (review finding I-12) selected lineages
	// that were first seen in the window and silently skipped every long-lived
	// lineage that received a fact in it — which is exactly the population a
	// "replay last Tuesday" is asked about.
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
	if !RuleVersionImplemented(replay.RuleVersion) {
		// Refused before any scope is enumerated: recomputing under the active
		// engine and labelling the result with the requested version would make
		// a replay's checksum comparison meaningless.
		return nil, ErrUnsupportedRuleVersion
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
		output, err := s.ProjectUnder(ctx, target, "", replay.RuleVersion)
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
