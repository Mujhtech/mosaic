package billingprojection

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/jobtelemetry"
)

// projectionLease bounds how long one worker may hold a projection job. It is
// deliberately short: the transaction makes no external calls, so a job that
// has been held for minutes is a stuck worker, not slow work.
const projectionLease = 60 * time.Second

// Service is the projection application service. It owns the transaction
// boundary, the lock, the compare-and-swap, and the job loop. The engines it
// calls stay pure.
type Service struct {
	repository Repository
	now        func() time.Time
	tracer     trace.Tracer

	projections    metric.Int64Counter
	projectionCost metric.Float64Histogram
}

type Option func(*Service)

func NewService(repository Repository, options ...Option) *Service {
	meter := otel.Meter("mosaic/billingprojection")
	service := &Service{
		repository: repository,
		now:        func() time.Time { return time.Now().UTC() },
		tracer:     otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingprojection"),
	}
	service.projections, _ = meter.Int64Counter("mosaic.billing.projection.outcomes")
	service.projectionCost, _ = meter.Float64Histogram("mosaic.billing.projection.latency",
		metric.WithUnit("ms"))
	for _, option := range options {
		option(service)
	}
	return service
}

// Enqueue coalesces a projection trigger. Every trigger in plan §12 routes
// through here, and the scope-key partial unique index absorbs duplicates, so
// a burst of facts for one customer produces one projection rather than a job
// storm.
func (s *Service) Enqueue(ctx context.Context, scope Scope, kind string) error {
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return err
	}
	return s.repository.Enqueue(ctx, scope, kind, s.now())
}

// ProcessNextProjection leases and runs one projection job. It matches the
// (processed, error) contract every other Mosaic job family uses.
func (s *Service) ProcessNextProjection(ctx context.Context, workerID string) (bool, error) {
	now := s.now()
	job, leased, err := s.repository.LeaseJob(ctx, workerID, now, now.Add(projectionLease))
	if err != nil {
		return false, fmt.Errorf("lease projection job: %w", err)
	}
	if !leased {
		return false, nil
	}
	jobtelemetry.Annotate(ctx, jobtelemetry.Identity{
		JobID: job.ID, JobKind: "billing_projection",
		ProjectID: job.ProjectID, EnvironmentID: job.EnvironmentID, ResourceID: job.ScopeKey,
	})

	// A Project that turned billing off projects nothing. The job is parked
	// rather than failed: disabling is reversible, and failing would need an
	// operator action to recover work that only ever needed to wait.
	if err := s.requireEnabled(ctx, job.ProjectID); err != nil {
		return true, s.repository.CompleteJob(ctx, job, "queued", "billing_disabled",
			s.now().Add(5*time.Minute), s.now())
	}

	output, runErr := s.Project(ctx, job.Scope(), job.ID)
	completed := s.now()
	switch {
	case runErr != nil && errors.Is(runErr, ErrVersionConflict):
		// Another worker committed newer state for this scope. Requeue
		// promptly: the work is still wanted, just against fresher input.
		return true, s.repository.CompleteJob(ctx, job, "queued", "version_conflict", completed, completed)
	case runErr != nil:
		status := "queued"
		if job.AttemptCount >= job.MaxAttempts {
			status = "failed"
		}
		return true, s.repository.CompleteJob(ctx, job, status, "projection_failed",
			completed.Add(backoff(job.AttemptCount)), completed)
	default:
		s.projections.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", output.Outcome)))
		return true, s.repository.CompleteJob(ctx, job, "completed", "", completed, completed)
	}
}

// Project runs one projection command end to end.
//
// The sequence is the accepted one (WP11): acquire the scope's advisory lock,
// re-read the current version inside the transaction, load the facts, project
// with the pure engines, and commit everything atomically under a
// compare-and-swap. No external call happens inside the transaction, and the
// lock is never held across network I/O.
//
// A no-change projection is a first-class outcome, not a degenerate one: no
// snapshot is written, no webhook event is created, the checkpoint still
// advances, and the attempt is recorded. Without that, every reprojection
// would churn every SDK cache in the Project.
func (s *Service) Project(ctx context.Context, scope Scope, jobID string) (Output, error) {
	return s.ProjectUnder(ctx, scope, jobID, ActiveRuleVersion)
}

// ProjectUnder runs one projection command under a selected rule version. Every
// live trigger uses the active version through Project; a replay is the only
// caller that selects (plan §12, review finding I-12).
//
// A rule version this build does not derive under is refused before any work
// begins, rather than silently recomputed under the active semantics.
func (s *Service) ProjectUnder(ctx context.Context, scope Scope, jobID string, ruleVersion int) (Output, error) {
	ctx, span := s.tracer.Start(ctx, "billing.projection.commit")
	defer span.End()
	span.SetAttributes(
		attribute.String("mosaic.billing.projection.scope", scope.Key()),
		attribute.Int("mosaic.billing.projection.rule_version", ResolveRuleVersion(ruleVersion)))

	started := s.now()
	if !RuleVersionImplemented(ruleVersion) {
		return Output{}, ErrUnsupportedRuleVersion
	}
	if err := s.requireEnabled(ctx, scope.ProjectID); err != nil {
		return Output{}, err
	}

	input, err := s.repository.LoadInput(ctx, scope)
	if err != nil {
		return Output{}, err
	}
	input.RuleVersion = ruleVersion

	output := Compute(input, s.now())
	commitErr := s.repository.Commit(ctx, input, output, s.now())
	completed := s.now()
	s.projectionCost.Record(ctx, float64(completed.Sub(started).Milliseconds()))

	errorCode := ""
	if commitErr != nil {
		output.Outcome = OutcomeFailed
		errorCode = "commit_failed"
		if errors.Is(commitErr, ErrVersionConflict) {
			errorCode = "version_conflict"
		}
	}
	// The attempt is recorded outside the projection transaction, so a
	// rolled-back projection still leaves an observable trace of having run.
	if err := s.repository.RecordAttempt(ctx, scope, jobID, output, errorCode, started, completed); err != nil {
		zerolog.Ctx(ctx).Error().
			Str("projection_scope", scope.Key()).
			Str("attempt_error_kind", fmt.Sprintf("%T", err)).
			Msg("projection attempt could not be recorded")
	}
	if commitErr != nil {
		return output, commitErr
	}
	// A lineage-scoped command never mints a customer snapshot (defect D-4). If
	// the lineage has acquired a customer, the aggregate that *can* mint one is
	// enqueued instead of being derived here from a single lineage. The failure
	// is returned rather than logged: the projection itself is idempotent, so a
	// retry costs a no-change pass, whereas a dropped escalation leaves the
	// customer's committed snapshot missing a purchase they hold.
	if scope.CustomerID == "" && input.EscalateToCustomerID != "" {
		escalated := Scope{
			ProjectID: scope.ProjectID, EnvironmentID: scope.EnvironmentID,
			CustomerID: input.EscalateToCustomerID,
		}
		if err := s.repository.Enqueue(ctx, escalated, KindAssociationEstablished, s.now()); err != nil {
			return output, fmt.Errorf("escalate lineage projection to customer scope: %w", err)
		}
	}
	span.SetAttributes(
		attribute.String("mosaic.billing.projection.outcome", output.Outcome),
		attribute.Bool("mosaic.billing.projection.changed", output.CustomerSnapshot != nil))
	return output, nil
}

// Compute is the pure planning step: given a loaded input and an evaluation
// instant, it decides everything that will be written. It is separated from
// Project so the decision logic is testable without a database and so the
// transaction body contains no branching over provider semantics.
func Compute(input Input, asOf time.Time) Output {
	asOf = asOf.UTC()
	output := Output{Scope: input.Scope, Outcome: OutcomeNoChange}

	if !RuleVersionImplemented(input.RuleVersion) {
		// Review finding I-12: derivation under semantics this build does not
		// implement decides nothing. The command produces an empty plan, so
		// there is no snapshot, no checkpoint, and no event to commit — the
		// caller's refusal is the primary guard and this is the structural one.
		output.Outcome = OutcomeFailed
		return output
	}

	subscriptionSources := make([]SubscriptionSource, 0, len(input.Lineages))
	oneTimeSources := make([]OneTimeSource, 0, len(input.Lineages))
	watermarks := make([]string, 0, len(input.Lineages))
	grantVersionIDs := make([]string, 0, len(input.GrantVersions))

	unresolved, frozen := input.UnresolvedLineages, input.FrozenLineages

	for _, lineage := range input.Lineages {
		if lineage.Frozen || !lineage.CustomerResolved {
			// A frozen lineage keeps its last committed state (OD-10) and an
			// unresolved one has no customer to attach to. Neither is projected
			// and neither advances a checkpoint — projecting either would grant
			// access on a disputed or absent identity.
			//
			// They do, however, still name the Entitlements in question, and
			// those are emitted as `unknown` sources. Skipping them entirely
			// produced a customer snapshot with no entry at all for the
			// Entitlement, and an absent entry reads to every consumer as "this
			// customer never had it" — which is the definite answer the whole
			// uncertainty vocabulary exists to avoid asserting.
			if lineage.Frozen {
				frozen++
			} else {
				unresolved++
			}
			collectUndecided(input, lineage, asOf, &subscriptionSources, &oneTimeSources)
			continue
		}

		ordered := Sort(append([]Fact(nil), lineage.Facts...))
		watermark := HighWatermark(ordered)
		watermarks = append(watermarks, watermark)
		// The checkpoint is invalidated when it no longer describes a prefix of
		// the timeline — a fact arrived that belongs earlier than the watermark.
		invalidated := !PrefixIntact(ordered, lineage.Checkpoint, lineage.CheckpointFacts)

		if lineage.Type == "one_time" {
			result := ProjectOneTimePurchase(ordered, asOf)
			grants := selectGrants(input.GrantVersions, result.Snapshot.MosaicProductID,
				result.Snapshot.AcquiredAt, "non_consumable")
			grantVersionIDs = appendGrantIDs(grantVersionIDs, grants)
			oneTimeSources = append(oneTimeSources, OneTimeSource{
				InstanceID: lineage.InstanceID, PurchaseLineageID: lineage.LineageID,
				Snapshot: result.Snapshot, Grants: grants,
			})
			if !sameChecksum(lineage.CheckpointChecksum, result.Snapshot.Checksum) {
				output.OneTimes = append(output.OneTimes, OneTimeCommit{
					LineageID: lineage.LineageID, InstanceID: lineage.InstanceID,
					Snapshot: result.Snapshot, Timeline: result.Timeline,
				})
			}
			output.Checkpoints = append(output.Checkpoints, CheckpointCommit{
				LineageID: lineage.LineageID, InstanceID: lineage.InstanceID, Type: "one_time",
				HighWatermark: result.HighWatermark, FactsProjected: int64(result.FactsConsumed),
				Checksum: result.Snapshot.Checksum, Invalidated: invalidated,
			})
			continue
		}

		// The lineage is projected once under the default policy to establish
		// its provider lifecycle, period, and effective timestamps — none of
		// which depend on any grant. Access policy is then applied per grant
		// version: re-projecting the whole lineage under grants[0] collapsed
		// every Entitlement onto the first grant's policy, which made the §7
		// per-grant opt-out silently ineffective for every grant but one.
		result := ProjectSubscription(ordered, asOf, DefaultPolicy(), lineage.SupersededByLineage)
		periodTime := asOf
		if result.Snapshot.PeriodStartAt != nil {
			periodTime = *result.Snapshot.PeriodStartAt
		}
		grants := selectGrants(input.GrantVersions, result.Snapshot.CurrentProductID,
			periodTime, "auto_renewable_subscription")
		if len(grants) > 0 {
			// The snapshot's own access column is the union over the grant
			// versions in force. Per-Entitlement access is decided per grant
			// in ProjectEntitlements.
			if granted, dependent := AnyGrantsAccess(result.Snapshot.LifecycleState, grants); dependent {
				if granted {
					result.Snapshot.AccessState = AccessActive
				} else {
					result.Snapshot.AccessState = AccessInactive
				}
				result.Snapshot.Checksum = subscriptionChecksum(result.Snapshot)
			}
		}
		grantVersionIDs = appendGrantIDs(grantVersionIDs, grants)

		subscriptionSources = append(subscriptionSources, SubscriptionSource{
			InstanceID: lineage.InstanceID, SnapshotID: lineage.SnapshotID,
			PurchaseLineageID: lineage.LineageID, Snapshot: result.Snapshot, Grants: grants,
		})
		if !sameChecksum(lineage.CheckpointChecksum, result.Snapshot.Checksum) {
			output.Subscriptions = append(output.Subscriptions, SubscriptionCommit{
				LineageID: lineage.LineageID, InstanceID: lineage.InstanceID,
				Snapshot: result.Snapshot, Timeline: result.Timeline,
			})
		}
		output.Checkpoints = append(output.Checkpoints, CheckpointCommit{
			LineageID: lineage.LineageID, InstanceID: lineage.InstanceID, Type: "subscription",
			HighWatermark: result.HighWatermark, FactsProjected: int64(result.FactsConsumed),
			Checksum: result.Snapshot.Checksum, Invalidated: invalidated,
		})
	}

	output.IdempotencyKey = IdempotencyKey(input.Scope, watermarks, grantVersionIDs)

	if input.Scope.CustomerID == "" {
		// Lineage-scoped projection: subscription state advances, but there is
		// no customer aggregate to recompute yet.
		if len(output.Subscriptions) > 0 || len(output.OneTimes) > 0 {
			output.Outcome = OutcomeProjected
		} else if unresolved > 0 {
			output.Outcome = OutcomeUnresolved
		} else if frozen > 0 {
			output.Outcome = OutcomeFrozen
		}
		return output
	}

	candidate := ProjectEntitlements(CustomerProjection{
		Subscriptions:      subscriptionSources,
		OneTimes:           oneTimeSources,
		UnresolvedLineages: unresolved,
		FrozenLineages:     frozen,
	}, asOf)
	output.Changes = Diff(input.PriorCustomerSnapshot, candidate)

	if output.Changes.NoChange {
		// The customer's authoritative state is unchanged, so no customer
		// snapshot is minted and the snapshot version does not move — even when
		// a subscription snapshot did change underneath it. A renewal that
		// extends a period without changing which Entitlements are held is
		// exactly that case, and advancing the version for it would invalidate
		// every SDK cache in the Project for a change no reader can observe.
		output.Outcome = OutcomeNoChange
		if len(output.Subscriptions) > 0 || len(output.OneTimes) > 0 {
			output.Outcome = OutcomeProjected
		} else if frozen > 0 {
			output.Outcome = OutcomeFrozen
		}
		return output
	}

	output.CustomerSnapshot = &candidate
	output.SnapshotVersion = input.CurrentSnapshotVersion + 1
	output.Event = planEvent(input.PriorCustomerSnapshot, candidate, output.Changes,
		subscriptionSources, asOf)
	output.Outcome = OutcomeProjected
	return output
}

// collectUndecided emits `unknown` entitlement sources for a lineage that is
// frozen or has no resolved customer. It projects the lineage only far enough
// to learn which Product it names, then forces the source state to unknown: the
// facts are real, the Entitlement is real, and the only thing Mosaic cannot
// state is whether this customer holds it.
func collectUndecided(input Input, lineage LineageInput, asOf time.Time,
	subscriptions *[]SubscriptionSource, oneTimes *[]OneTimeSource) {

	reason := UncertaintyIdentityUnresolved
	ordered := Sort(append([]Fact(nil), lineage.Facts...))

	if lineage.Type == "one_time" {
		result := ProjectOneTimePurchase(ordered, asOf)
		grants := selectGrants(input.GrantVersions, result.Snapshot.MosaicProductID,
			result.Snapshot.AcquiredAt, "non_consumable")
		if len(grants) == 0 {
			return
		}
		result.Snapshot.ValidityState = OwnershipUnknown
		result.Snapshot.UncertaintyReason = reason
		*oneTimes = append(*oneTimes, OneTimeSource{
			InstanceID: lineage.InstanceID, PurchaseLineageID: lineage.LineageID,
			Snapshot: result.Snapshot, Grants: grants,
		})
		return
	}

	result := ProjectSubscription(ordered, asOf, DefaultPolicy(), lineage.SupersededByLineage)
	periodTime := asOf
	if result.Snapshot.PeriodStartAt != nil {
		periodTime = *result.Snapshot.PeriodStartAt
	}
	grants := selectGrants(input.GrantVersions, result.Snapshot.CurrentProductID,
		periodTime, "auto_renewable_subscription")
	if len(grants) == 0 {
		return
	}
	result.Snapshot.AccessState = AccessUnknown
	result.Snapshot.UncertaintyReason = reason
	*subscriptions = append(*subscriptions, SubscriptionSource{
		InstanceID: lineage.InstanceID, SnapshotID: lineage.SnapshotID,
		PurchaseLineageID: lineage.LineageID, Snapshot: result.Snapshot, Grants: grants,
	})
}

func selectGrants(versions []GrantVersion, productID string, at time.Time, purchaseType string) []GrantVersion {
	if productID == "" {
		return nil
	}
	return SelectGrantVersions(versions, productID, at, purchaseType)
}

func appendGrantIDs(ids []string, grants []GrantVersion) []string {
	for _, grant := range grants {
		ids = append(ids, grant.ID)
	}
	return ids
}

func sameChecksum(left, right []byte) bool {
	return len(left) > 0 && string(left) == string(right)
}

// backoff bounds the retry schedule for a failed projection.
func backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Duration(1<<min(attempt, 6)) * time.Second
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	return delay
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// requireEnabled fails closed, matching the 9A ingestion path: an unreadable
// setting is treated as disabled and reported, so a transient database error
// cannot quietly re-enable a Project that asked Mosaic to hold no billing
// state.
func (s *Service) requireEnabled(ctx context.Context, projectID string) error {
	enabled, err := s.repository.BillingEnabled(ctx, projectID)
	if err != nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("billing_error_kind", fmt.Sprintf("%T", err)).
			Msg("billing enablement could not be read; treating the Project as disabled")
		return ErrBillingDisabled
	}
	if !enabled {
		return ErrBillingDisabled
	}
	return nil
}
