package billingoperator

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// Service is the operator application service. It owns the authorization
// decision on every surface in this package and nothing else: the state it
// returns is read through ports onto the modules that own it.
type Service struct {
	repository   Repository
	entitlements Entitlements
	identity     Identity
	tracer       trace.Tracer

	lookups metric.Int64Counter
}

func NewService(repository Repository, entitlements Entitlements, identity Identity) *Service {
	service := &Service{
		repository:   repository,
		entitlements: entitlements,
		identity:     identity,
		tracer:       otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingoperator"),
	}
	// Lookup volume by outcome is the signal that distinguishes support use from
	// enumeration: a rise in misses without a matching rise in hits is somebody
	// guessing identifiers, and it is exactly what the rate limit in front of
	// this surface exists to bound.
	service.lookups, _ = otel.Meter("mosaic/billingoperator").Int64Counter(
		"mosaic.billing.operator.customer_lookups")
	return service
}

// ---------------------------------------------------------------------------
// Customer lookup and list
// ---------------------------------------------------------------------------

// LookupResult is the answer to a typed-identifier lookup. A miss is a
// first-class result rather than a 404, because "no customer holds this
// identifier" is a true and useful answer to a support question — and because
// answering it as an error would make an enumeration attempt indistinguishable
// from a mistyped route.
type LookupResult struct {
	Found    bool             `json:"found"`
	Customer *CustomerSummary `json:"customer,omitempty"`
}

// LookupCustomer resolves one typed identifier to at most one customer.
//
// The submitted value is digested here and never stored, never logged, and
// never echoed. For an application user id the digest is matched against the
// active alias resolutions; for an installation id it is matched against
// association evidence, because an installation identifier is evidence and can
// never be an anchor (plan §5a rule 2a) — there is no alias resolution to read.
//
// Nothing on this path can create. The repository port exposes no writer, so a
// lookup that misses leaves the database exactly as it found it. That is the
// distinction from the trusted identify surface, which is create-or-get and
// would mint a customer for every mistyped support query if it were reused here.
func (s *Service) LookupCustomer(ctx context.Context, actor Actor, projectID, environmentID,
	identifierType, value string) (LookupResult, error) {

	ctx, span := s.tracer.Start(ctx, "billing.operator.customer_lookup")
	defer span.End()
	span.SetAttributes(attribute.String("mosaic.billing.lookup.identifier_type", identifierType))

	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return LookupResult{}, err
	}
	if !ValidIdentifierType(identifierType) {
		return LookupResult{}, ErrInvalid
	}
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 512 {
		return LookupResult{}, ErrInvalid
	}

	customerID := ""
	var err error
	switch identifierType {
	case IdentifierBillingCustomerID:
		customerID = value
	case IdentifierApplicationUserID:
		customerID, err = s.repository.CustomerIDForAliasDigest(ctx, projectID,
			billingcustomer.AliasApplicationUser, billingcustomer.AliasDigest(billingcustomer.AliasApplicationUser, value))
	case IdentifierInstallationID:
		customerID, err = s.repository.CustomerIDForInstallationDigest(ctx, projectID,
			billingcustomer.AliasDigest(billingcustomer.AliasInstallation, value))
	}
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return s.lookupMiss(ctx, identifierType), nil
		}
		return LookupResult{}, s.unavailable(ctx, projectID, "customer lookup failed", err)
	}

	summary, err := s.repository.CustomerSummary(ctx, projectID, environmentID, customerID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return s.lookupMiss(ctx, identifierType), nil
		}
		return LookupResult{}, s.unavailable(ctx, projectID, "customer lookup failed", err)
	}
	s.lookups.Add(ctx, 1, metric.WithAttributes(
		attribute.String("identifier_type", identifierType), attribute.String("outcome", "match")))
	span.SetAttributes(attribute.Bool("mosaic.billing.lookup.match", true))
	return LookupResult{Found: true, Customer: &summary}, nil
}

func (s *Service) lookupMiss(ctx context.Context, identifierType string) LookupResult {
	s.lookups.Add(ctx, 1, metric.WithAttributes(
		attribute.String("identifier_type", identifierType), attribute.String("outcome", "miss")))
	return LookupResult{Found: false}
}

// ListCustomers pages the Environment's Billing Customers.
//
// The list is Environment-filtered even though customer identity is
// Project-scoped (OD-3(b)): everything an operator looks at on a customer —
// lineages, subscriptions, snapshots — is Environment-scoped, so a list that
// mixed Environments would put a production customer next to a sandbox one with
// no way to tell. A customer that holds no state in any Environment yet is the
// one exception and appears everywhere, because it genuinely belongs nowhere.
func (s *Service) ListCustomers(ctx context.Context, actor Actor, projectID, environmentID string,
	filter CustomerFilter, limit int, cursor string) ([]CustomerSummary, string, error) {

	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return nil, "", err
	}
	if filter.Status != "" {
		switch filter.Status {
		case billingcustomer.StatusActive, billingcustomer.StatusFrozen,
			billingcustomer.StatusAnonymized, billingcustomer.StatusAbsorbed:
		default:
			return nil, "", ErrInvalid
		}
	}
	customers, next, err := s.repository.ListCustomers(ctx, projectID, environmentID, filter, boundedLimit(limit), cursor)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return nil, "", ErrInvalid
		}
		return nil, "", s.unavailable(ctx, projectID, "customer list failed", err)
	}
	return customers, next, nil
}

// Customer assembles the customer detail page.
func (s *Service) Customer(ctx context.Context, actor Actor, projectID, environmentID, customerID string) (CustomerDetail, error) {
	ctx, span := s.tracer.Start(ctx, "billing.operator.customer_detail")
	defer span.End()

	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return CustomerDetail{}, err
	}
	customerID = strings.TrimSpace(customerID)
	summary, err := s.repository.CustomerSummary(ctx, projectID, environmentID, customerID)
	if err != nil {
		return CustomerDetail{}, s.classify(ctx, projectID, "customer detail failed", err)
	}
	detail := CustomerDetail{
		Customer:      summary,
		Aliases:       []AliasView{},
		Lineages:      []LineageView{},
		Subscriptions: []SubscriptionView{},
		OneTime:       []OneTimePurchaseView{},
		Conflicts:     []ConflictView{},
	}

	aliases, err := s.identity.ListAliases(ctx, billingcustomer.Actor(actor), projectID, customerID)
	if err != nil {
		return CustomerDetail{}, s.classifyIdentity(err)
	}
	for _, alias := range aliases {
		detail.Aliases = append(detail.Aliases, aliasView(alias))
	}

	if detail.Lineages, err = s.repository.Lineages(ctx, projectID, environmentID, customerID); err != nil {
		return CustomerDetail{}, s.classify(ctx, projectID, "customer lineages failed", err)
	}
	if detail.OneTime, err = s.repository.OneTimePurchases(ctx, projectID, environmentID, customerID); err != nil {
		return CustomerDetail{}, s.classify(ctx, projectID, "customer one-time purchases failed", err)
	}
	if detail.Conflicts, err = s.repository.CustomerConflicts(ctx, projectID, customerID); err != nil {
		return CustomerDetail{}, s.classify(ctx, projectID, "customer conflicts failed", err)
	}

	subscriptions, _, err := s.entitlements.Subscriptions(ctx, projectID, environmentID, customerID, maxDetailSubscriptions, "")
	if err != nil {
		return CustomerDetail{}, s.classify(ctx, projectID, "customer subscriptions failed", err)
	}
	for _, subscription := range subscriptions {
		detail.Subscriptions = append(detail.Subscriptions, subscriptionView(subscription))
	}

	// A customer that has never been projected in this Environment is not an
	// error and is not empty: `currentSnapshot` is simply absent, and the
	// projection status says why.
	snapshot, err := s.entitlements.CurrentSnapshot(ctx, projectID, environmentID, customerID)
	switch {
	case err == nil:
		view := snapshotView(snapshot)
		detail.Snapshot = &view
	case errors.Is(err, billingaccess.ErrNotFound):
	default:
		return CustomerDetail{}, s.classify(ctx, projectID, "customer snapshot failed", err)
	}
	// A failed health read is reported as degraded, never omitted and never
	// current. Leaving detail.Projection nil rendered the operator surface as if
	// the projection were fine; `err == nil` alone is how "Mosaic could not ask"
	// became "everything is up to date".
	status, statusErr := s.entitlements.ProjectionStatusFor(ctx, projectID, environmentID, customerID)
	if statusErr != nil {
		status = billingaccess.ProjectionStatusUnavailable(lastProjectedFrom(detail.Snapshot))
	}
	projection := projectionStatusView(status)
	detail.Projection = &projection

	span.SetAttributes(
		attribute.String("mosaic.billing.customer.id", customerID),
		attribute.Int("mosaic.billing.customer.subscriptions", len(detail.Subscriptions)))
	return detail, nil
}

// maxDetailSubscriptions bounds the subscriptions embedded in the detail read.
// A customer with more than this many purchase chains is pathological, and the
// paged subscriptions endpoint is where a full list is read.
const maxDetailSubscriptions = 50

// Snapshot reads the customer's current entitlement snapshot on its own, which
// is what the entitlement panel refreshes against without re-reading the whole
// page.
func (s *Service) Snapshot(ctx context.Context, actor Actor, projectID, environmentID, customerID string) (SnapshotView, ProjectionStatusView, error) {
	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return SnapshotView{}, ProjectionStatusView{}, err
	}
	snapshot, err := s.entitlements.CurrentSnapshot(ctx, projectID, environmentID, strings.TrimSpace(customerID))
	if err != nil {
		return SnapshotView{}, ProjectionStatusView{}, s.classify(ctx, projectID, "snapshot read failed", err)
	}
	read, statusErr := s.entitlements.ProjectionStatusFor(ctx, projectID, environmentID, customerID)
	if statusErr != nil {
		// The zero ProjectionStatusView carried an empty state, which the
		// dashboard reads as "nothing to report". Degraded is what Mosaic
		// actually knows.
		read = billingaccess.ProjectionStatusUnavailable(snapshot.ComputedAt)
	}
	return snapshotView(snapshot), projectionStatusView(read), nil
}

// Subscriptions pages one customer's projected subscriptions.
func (s *Service) Subscriptions(ctx context.Context, actor Actor, projectID, environmentID, customerID string,
	limit int, cursor string) ([]SubscriptionView, string, error) {

	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return nil, "", err
	}
	views, next, err := s.entitlements.Subscriptions(ctx, projectID, environmentID,
		strings.TrimSpace(customerID), boundedLimit(limit), cursor)
	if err != nil {
		return nil, "", s.classify(ctx, projectID, "subscription list failed", err)
	}
	result := make([]SubscriptionView, 0, len(views))
	for _, view := range views {
		result = append(result, subscriptionView(view))
	}
	return result, next, nil
}

// Subscription reads one projected Subscription Instance.
//
// The Environment on the route is re-checked against the instance's own
// Environment and a mismatch is reported as absent, not as forbidden: a
// staging URL that happens to name a production instance must not confirm that
// the instance exists.
func (s *Service) Subscription(ctx context.Context, actor Actor, projectID, environmentID, instanceID string) (SubscriptionView, error) {
	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return SubscriptionView{}, err
	}
	view, err := s.entitlements.Subscription(ctx, projectID, strings.TrimSpace(instanceID))
	if err != nil {
		return SubscriptionView{}, s.classify(ctx, projectID, "subscription read failed", err)
	}
	if view.EnvironmentID != environmentID {
		return SubscriptionView{}, ErrNotFound
	}
	return subscriptionView(view), nil
}

// Timeline reads one Subscription Instance's append-only explanation history.
func (s *Service) Timeline(ctx context.Context, actor Actor, projectID, environmentID, instanceID string,
	limit int, cursor string) ([]TimelineEntryView, string, error) {

	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return nil, "", err
	}
	instanceID = strings.TrimSpace(instanceID)
	view, err := s.entitlements.Subscription(ctx, projectID, instanceID)
	if err != nil {
		return nil, "", s.classify(ctx, projectID, "timeline read failed", err)
	}
	if view.EnvironmentID != environmentID {
		return nil, "", ErrNotFound
	}
	entries, next, err := s.entitlements.Timeline(ctx, projectID, instanceID, boundedLimit(limit), cursor)
	if err != nil {
		return nil, "", s.classify(ctx, projectID, "timeline read failed", err)
	}
	result := make([]TimelineEntryView, 0, len(entries))
	for _, entry := range entries {
		result = append(result, timelineEntryView(entry))
	}
	return result, next, nil
}

// ---------------------------------------------------------------------------
// Identity conflicts
// ---------------------------------------------------------------------------

// ListConflicts returns the Project's identity conflicts.
//
// They are Project-scoped, not Environment-scoped, and the route says so: a
// conflict is a dispute about who a person is, and identity in Mosaic belongs
// to the Project (OD-3(b)). Filing this page under an Environment would imply a
// conflict could be resolved differently in staging than in production.
func (s *Service) ListConflicts(ctx context.Context, actor Actor, projectID, status string) ([]ConflictView, error) {
	if err := s.authorizeProject(ctx, actor, projectID); err != nil {
		return nil, err
	}
	switch status {
	case "", "open", "resolved":
	default:
		return nil, ErrInvalid
	}
	conflicts, err := s.identity.ListConflicts(ctx, billingcustomer.Actor(actor), projectID, status)
	if err != nil {
		return nil, s.classifyIdentity(err)
	}
	views := make([]ConflictView, 0, len(conflicts))
	for _, conflict := range conflicts {
		views = append(views, conflictView(conflict))
	}
	return views, nil
}

// Conflict returns one conflict with the lineage it disputes.
func (s *Service) Conflict(ctx context.Context, actor Actor, projectID, conflictID string) (ConflictDetailView, error) {
	if err := s.authorizeProject(ctx, actor, projectID); err != nil {
		return ConflictDetailView{}, err
	}
	detail, err := s.identity.ConflictDetail(ctx, billingcustomer.Actor(actor), projectID, strings.TrimSpace(conflictID))
	if err != nil {
		return ConflictDetailView{}, s.classifyIdentity(err)
	}
	view := ConflictDetailView{Conflict: conflictView(detail.Conflict)}
	if detail.Lineage != nil {
		lineage := lineageView(*detail.Lineage)
		view.Lineage = &lineage
	}
	return view, nil
}

// ResolveConflict applies an operator's decision (OD-10).
//
// It delegates the whole operation. billingcustomer.ResolveConflict applies the
// assignment under a row lock, unfreezes the disputed subject, writes the audit
// event, and enqueues a reprojection for *both* candidates — the loser included,
// because the loser is the one holding a committed snapshot that still grants
// the purchase. This method contributes the operator vocabulary and the reason
// requirement, and nothing else; there is no second write path here that could
// skip one of those steps.
func (s *Service) ResolveConflict(ctx context.Context, actor Actor, projectID, conflictID,
	action, assignedCustomerID, reason string) (ConflictView, error) {

	ctx, span := s.tracer.Start(ctx, "billing.operator.resolve_conflict")
	defer span.End()

	if err := s.authorizeProject(ctx, actor, projectID); err != nil {
		return ConflictView{}, err
	}
	stored, ok := storedAction(action)
	if !ok {
		return ConflictView{}, ErrInvalid
	}
	if strings.TrimSpace(reason) == "" || len(reason) > billingcustomer.MaxResolutionReasonLength {
		return ConflictView{}, ErrInvalid
	}
	resolved, err := s.identity.ResolveConflict(ctx, billingcustomer.Actor(actor), projectID,
		strings.TrimSpace(conflictID), stored, strings.TrimSpace(assignedCustomerID), reason)
	if err != nil {
		return ConflictView{}, s.classifyIdentity(err)
	}
	span.SetAttributes(
		attribute.String("mosaic.billing.conflict.id", resolved.ID),
		attribute.String("mosaic.billing.conflict.action", action))
	return conflictView(resolved), nil
}

// ---------------------------------------------------------------------------
// Restore and sync
// ---------------------------------------------------------------------------

// RequestSync enqueues a manual reprojection of one customer.
//
// This is the operator's "sync now". It is deliberately not a restore: a
// restore needs a device to ask its store for purchases, which no operator can
// do on a customer's behalf, and a control that claimed to would report a
// native outcome nobody produced. What an operator can legitimately ask for is
// a recomputation of committed state from the facts Mosaic already holds.
func (s *Service) RequestSync(ctx context.Context, actor Actor, projectID, environmentID, customerID string) (billingcustomer.SyncRequest, error) {
	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return billingcustomer.SyncRequest{}, err
	}
	request, err := s.identity.RequestSyncForOperator(ctx, billingcustomer.Actor(actor),
		projectID, environmentID, strings.TrimSpace(customerID))
	if err != nil {
		return billingcustomer.SyncRequest{}, s.classifyIdentity(err)
	}
	return request, nil
}

// ListRestoreJobs pages the Environment's restore/sync jobs.
func (s *Service) ListRestoreJobs(ctx context.Context, actor Actor, projectID, environmentID, customerID string,
	limit int, cursor string) ([]RestoreJobView, string, error) {

	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return nil, "", err
	}
	jobs, next, err := s.repository.ListRestoreJobs(ctx, projectID, environmentID,
		strings.TrimSpace(customerID), boundedLimit(limit), cursor)
	if err != nil {
		return nil, "", s.classify(ctx, projectID, "restore job list failed", err)
	}
	return jobs, next, nil
}

// RestoreJob reads one restore/sync job's status.
func (s *Service) RestoreJob(ctx context.Context, actor Actor, projectID, environmentID, restoreID string) (RestoreJobView, error) {
	if err := s.authorize(ctx, actor, projectID, environmentID); err != nil {
		return RestoreJobView{}, err
	}
	job, err := s.repository.RestoreJob(ctx, projectID, environmentID, strings.TrimSpace(restoreID))
	if err != nil {
		return RestoreJobView{}, s.classify(ctx, projectID, "restore job read failed", err)
	}
	return job, nil
}

// ---------------------------------------------------------------------------
// Authorization and error classification
// ---------------------------------------------------------------------------

// authorize is the one permission decision every Environment-scoped method
// here makes, and it is made before any state is read. Enablement is checked
// after authorization on purpose: "billing is not enabled for this Project" is
// itself information about a Project, and a caller who may not read the Project
// must not learn it.
func (s *Service) authorize(ctx context.Context, actor Actor, projectID, environmentID string) error {
	if strings.TrimSpace(actor.ID) == "" {
		return ErrUnauthenticated
	}
	if strings.TrimSpace(projectID) == "" || strings.TrimSpace(environmentID) == "" {
		return ErrNotFound
	}
	if err := s.repository.Authorize(ctx, actor, projectID, environmentID); err != nil {
		return classifyAuthorization(err)
	}
	return s.requireEnabled(ctx, projectID)
}

func (s *Service) authorizeProject(ctx context.Context, actor Actor, projectID string) error {
	if strings.TrimSpace(actor.ID) == "" {
		return ErrUnauthenticated
	}
	if strings.TrimSpace(projectID) == "" {
		return ErrNotFound
	}
	if err := s.repository.AuthorizeProject(ctx, actor, projectID); err != nil {
		return classifyAuthorization(err)
	}
	return s.requireEnabled(ctx, projectID)
}

func classifyAuthorization(err error) error {
	switch {
	case errors.Is(err, ErrUnauthenticated), errors.Is(err, ErrForbidden), errors.Is(err, ErrNotFound):
		return err
	default:
		return ErrUnavailable
	}
}

// requireEnabled fails closed, matching every other billing surface: an
// unreadable setting is treated as disabled, so a transient database error
// cannot quietly re-enable a Project that asked Mosaic to hold no billing state.
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

// classify maps a repository or access-module error onto this package's
// vocabulary. The cause is logged with identifiers only and never returned: a
// cause on this surface can quote a query, and a query here carries a digest.
func (s *Service) classify(ctx context.Context, projectID, message string, err error) error {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, billingaccess.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, ErrForbidden), errors.Is(err, billingaccess.ErrForbidden):
		return ErrForbidden
	case errors.Is(err, ErrInvalid), errors.Is(err, billingaccess.ErrInvalid):
		return ErrInvalid
	default:
		return s.unavailable(ctx, projectID, message, err)
	}
}

func (s *Service) classifyIdentity(err error) error {
	switch {
	case errors.Is(err, billingcustomer.ErrUnauthenticated):
		return ErrUnauthenticated
	case errors.Is(err, billingcustomer.ErrForbidden):
		return ErrForbidden
	case errors.Is(err, billingcustomer.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, billingcustomer.ErrInvalidAlias):
		return ErrInvalid
	case errors.Is(err, billingcustomer.ErrIdentityConflict), errors.Is(err, billingcustomer.ErrFrozen),
		errors.Is(err, billingcustomer.ErrConflict):
		return ErrConflict
	case errors.Is(err, billingcustomer.ErrBillingDisabled):
		return ErrBillingDisabled
	default:
		return ErrUnavailable
	}
}

func (s *Service) unavailable(ctx context.Context, projectID, message string, err error) error {
	zerolog.Ctx(ctx).Error().
		Str("project_id", projectID).
		Str("billing_operator_error_kind", fmt.Sprintf("%T", err)).
		Msg(message)
	return ErrUnavailable
}

func boundedLimit(limit int) int {
	if limit <= 0 {
		return 25
	}
	if limit > 100 {
		return 100
	}
	return limit
}
