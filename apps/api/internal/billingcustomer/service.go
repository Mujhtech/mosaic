package billingcustomer

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// Service is the billing-identity application service. Handlers are thin
// wrappers over it; it owns every authorization decision, every transaction
// boundary, and the lazy-creation rules.
type Service struct {
	repository  Repository
	keys        ServerKeyAuthenticator
	reprojector Reprojector
	now         func() time.Time
	random      io.Reader
	tracer      trace.Tracer
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	return func(s *Service) {
		if now != nil {
			s.now = now
		}
	}
}

func WithRandom(random io.Reader) Option {
	return func(s *Service) {
		if random != nil {
			s.random = random
		}
	}
}

// NewService builds the identity service.
//
// The key authenticator and the reprojector are constructor arguments rather
// than options because neither is optional in a running system: without the
// first there is no trusted surface, and without the second an identity change
// leaves a stale grant in place, which is precisely review finding I-10.
func NewService(repository Repository, keys ServerKeyAuthenticator, reprojector Reprojector, options ...Option) *Service {
	service := &Service{
		repository:  repository,
		keys:        keys,
		reprojector: reprojector,
		now:         func() time.Time { return time.Now().UTC() },
		random:      rand.Reader,
		tracer:      otel.Tracer("github.com/Mujhtech/mosaic/apps/api/billingcustomer"),
	}
	for _, option := range options {
		option(service)
	}
	return service
}

// CreateOrGetForApplicationUser is the trusted identify path: an application
// backend says "this is my user", and Mosaic returns the customer that user
// already has or creates one.
//
// This is one of exactly two ways a Billing Customer comes into existence
// (plan §5a). The other is a validated fact that needs somewhere to attach.
// SDK initialization and installation registration create nothing, which is
// what keeps Mosaic clear of the duplicate-customer trap that client-anchored
// systems fall into.
//
// The caller must already have been authenticated as a trusted server
// principal; a public SDK key can never reach this method, because an
// unverified user id accepted as authorization is an
// impersonate-anyone vulnerability.
// It reports whether the customer was created by this call, which is the only
// thing the caller cannot infer for itself and is what distinguishes a 201 from
// a 200 on the trusted surface.
func (s *Service) CreateOrGetForApplicationUser(ctx context.Context, projectID, applicationUserID string) (Customer, bool, error) {
	ctx, span := s.tracer.Start(ctx, "billing.customer.identify")
	defer span.End()

	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Customer{}, false, err
	}
	value := strings.TrimSpace(applicationUserID)
	if value == "" || len(value) > 512 {
		return Customer{}, false, ErrInvalidAlias
	}

	digest := AliasDigest(AliasApplicationUser, value)
	existing, err := s.repository.CustomerForAlias(ctx, projectID, AliasApplicationUser, digest)
	switch {
	case err == nil:
		span.SetAttributes(attribute.Bool("mosaic.billing.customer.created", false))
		return existing, false, nil
	case !errors.Is(err, ErrNotFound):
		return Customer{}, false, ErrUnavailable
	}

	now := s.now()
	id, err := s.newID("bcu")
	if err != nil {
		return Customer{}, false, ErrUnavailable
	}
	customer, err := s.repository.CreateCustomer(ctx, Customer{
		ID: id, ProjectID: projectID, Status: StatusActive,
		DiagnosticsStatus: "none", CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		return Customer{}, false, ErrUnavailable
	}

	aliasID, err := s.newID("bca")
	if err != nil {
		return Customer{}, false, ErrUnavailable
	}
	alias := Alias{
		ID: aliasID, ProjectID: projectID, BillingCustomerID: customer.ID,
		AliasType: AliasApplicationUser, SourceAuthority: AuthorityTrustedServer,
		VerificationStatus: "verified", EffectiveStart: now, CreatedAt: now,
	}.WithDigest(digest)
	if _, err := s.repository.AttachAlias(ctx, alias); err != nil {
		if errors.Is(err, ErrConflict) {
			// Another request created the same identity concurrently. The
			// partial unique index is the arbiter; re-read rather than
			// creating a second customer for the same person.
			if resolved, readErr := s.repository.CustomerForAlias(ctx, projectID, AliasApplicationUser, digest); readErr == nil {
				return resolved, false, nil
			}
		}
		return Customer{}, false, ErrUnavailable
	}
	_ = s.repository.RecordAudit(ctx, Actor{}, projectID, "billing.customer.created",
		"billing_customer", customer.ID, map[string]string{"aliasType": AliasApplicationUser}, now)
	logSafely(ctx, "billing customer created", map[string]string{
		"project_id": projectID, "billing_customer_id": customer.ID, "creation_path": "trusted_identify",
	})
	span.SetAttributes(attribute.Bool("mosaic.billing.customer.created", true))
	return customer, true, nil
}

// AttachApplicationUserAlias links an application user to an existing
// customer. Login attaches; it never merges (plan §5a rule 3). When the alias
// already resolves to a different customer with real purchases, the result is
// a conflict for an operator, not an automatic reassignment.
func (s *Service) AttachApplicationUserAlias(ctx context.Context, actor Actor, projectID, customerID, applicationUserID string) (Alias, error) {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Alias{}, err
	}
	value := strings.TrimSpace(applicationUserID)
	if value == "" || len(value) > 512 {
		return Alias{}, ErrInvalidAlias
	}
	customer, err := s.repository.Customer(ctx, actor, projectID, customerID)
	if err != nil {
		return Alias{}, err
	}
	if customer.Status == StatusFrozen {
		return Alias{}, ErrFrozen
	}

	now := s.now()
	aliasID, err := s.newID("bca")
	if err != nil {
		return Alias{}, ErrUnavailable
	}
	digest := AliasDigest(AliasApplicationUser, value)
	alias, err := s.repository.AttachAlias(ctx, Alias{
		ID: aliasID, ProjectID: projectID, BillingCustomerID: customerID,
		AliasType: AliasApplicationUser, SourceAuthority: AuthorityTrustedServer,
		VerificationStatus: "verified", EffectiveStart: now, CreatedAt: now,
	}.WithDigest(digest))
	if err != nil {
		// Corrects review finding I-10. A digest that already has a live
		// resolution elsewhere used to surface as a bare ErrConflict, which
		// reads like a lost race and invites the caller to retry. It is not a
		// race: one application user is claiming two customers, which is
		// exactly the quarantine case of plan §5a rule 4. Open the conflict,
		// freeze, audit, and tell the caller an operator now owns it.
		if errors.Is(err, ErrConflict) {
			return Alias{}, s.openAliasConflict(ctx, actor, projectID, customerID, digest, now)
		}
		return Alias{}, err
	}
	_ = s.repository.RecordAudit(ctx, actor, projectID, "billing.customer.alias_attached",
		"billing_customer", customerID, map[string]string{"aliasType": AliasApplicationUser}, now)
	return alias, nil
}

// RecordInstallationEvidence records an installation identifier as association
// evidence and nothing else (plan §5a rule 2a, OD-4(a)).
//
// It deliberately returns no customer. The installation id is client-generated
// and guessable, so letting it select a customer would mean anyone who can
// forge one reads someone else's entitlements. It exists here to give
// purchase→install attribution at zero proliferation cost.
func (s *Service) RecordInstallationEvidence(ctx context.Context, projectID, environmentID, customerID, installationID string) error {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return err
	}
	value := strings.TrimSpace(installationID)
	if value == "" || len(value) > 512 {
		return ErrInvalidAlias
	}
	id, err := s.newID("bae")
	if err != nil {
		return ErrUnavailable
	}
	now := s.now()
	return s.repository.RecordEvidence(ctx, Evidence{
		ID: id, ProjectID: projectID, EnvironmentID: environmentID,
		EvidenceType: EvidenceInstallation, EvidenceDigest: AliasDigest(AliasInstallation, value),
		BillingCustomerID: customerID, ResolverVersion: ResolverVersion,
		// Always unsupported as a resolution input, by design.
		Outcome: OutcomeUnsupported, DiagnosticCode: "installation_is_evidence_only",
		ObservedAt: now, CreatedAt: now,
	})
}

// ResolveLineageCustomer runs the association resolver for one lineage and
// applies its verdict.
//
// A resolved lineage is attached and projection may proceed. An unresolved one
// keeps its facts and projects nothing to any customer. A conflicting one
// opens a conflict and freezes the lineage, so neither candidate is granted
// anything automatically (OD-10(a)).
func (s *Service) ResolveLineageCustomer(ctx context.Context, projectID, lineageID string, observations []Observation) (Resolution, error) {
	ctx, span := s.tracer.Start(ctx, "billing.customer.resolve_association")
	defer span.End()

	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Resolution{}, err
	}
	lineage, err := s.repository.Lineage(ctx, projectID, lineageID)
	if err != nil {
		return Resolution{}, err
	}

	digests := make([][]byte, 0, len(observations))
	for _, observation := range observations {
		if len(observation.Digest) > 0 {
			digests = append(digests, observation.Digest)
		}
	}
	active, err := s.repository.ActiveAliasResolutions(ctx, projectID, digests)
	if err != nil {
		return Resolution{}, ErrUnavailable
	}
	if lineage.BillingCustomerID != "" {
		// An association already accepted for this lineage is itself the
		// highest-authority non-operator evidence: it is why a renewal on an
		// established subscription does not have to re-prove identity.
		observations = append(observations, Observation{
			EvidenceType: EvidencePriorLineage, CustomerID: lineage.BillingCustomerID,
		})
	}

	resolution := Resolve(observations, active)

	// Corrects review finding I-10.
	//
	// A lineage that is already attached and whose evidence now names someone
	// else is a reassignment, and reassignment away from a customer that
	// already holds the purchase is never automatic. Higher-authority evidence
	// used to win here and move the pointer silently, which left two wrongs
	// behind at once: no record an operator could act on, and a previously
	// granted customer whose committed snapshot still granted the purchase it
	// no longer owned. The move is downgraded to a conflict *before* evidence
	// is written, so the persisted evidence records `conflicting` rather than a
	// resolution that never happened.
	reassignedFrom := ""
	if resolution.Outcome == OutcomeResolved && lineage.BillingCustomerID != "" &&
		lineage.BillingCustomerID != resolution.CustomerID {
		reassignedFrom = lineage.BillingCustomerID
		resolution.Outcome = OutcomeConflicting
		// The incumbent is named first; the challenger the evidence proposed is
		// second. An operator resolving with `assigned_second` is the explicit
		// reassignment this path refuses to perform on its own.
		resolution.ConflictWith = resolution.CustomerID
		resolution.CustomerID = lineage.BillingCustomerID
		resolution.DiagnosticCode = DiagnosticReassignmentBlocked
	}

	now := s.now()
	for _, observation := range resolution.Considered {
		id, idErr := s.newID("bae")
		if idErr != nil {
			return Resolution{}, ErrUnavailable
		}
		outcome := resolution.Outcome
		if authorityRank(observation.EvidenceType) == 0 {
			outcome = OutcomeUnsupported
		}
		if err := s.repository.RecordEvidence(ctx, Evidence{
			ID: id, ProjectID: projectID, EnvironmentID: lineage.EnvironmentID,
			PurchaseLineageID: lineageID, EvidenceType: observation.EvidenceType,
			EvidenceDigest: observation.Digest, RawInputID: observation.RawInputID,
			BillingCustomerID: resolution.CustomerID, ResolverVersion: ResolverVersion,
			Outcome: outcome, DiagnosticCode: resolution.DiagnosticCode,
			ObservedAt: now, CreatedAt: now,
		}); err != nil {
			return Resolution{}, ErrUnavailable
		}
	}

	switch resolution.Outcome {
	case OutcomeResolved:
		if lineage.BillingCustomerID == resolution.CustomerID {
			return resolution, nil
		}
		if err := s.repository.AttachLineageCustomer(ctx, projectID, lineageID, resolution.CustomerID, now); err != nil {
			return Resolution{}, ErrUnavailable
		}
		_ = s.repository.RecordAudit(ctx, Actor{}, projectID, "billing.lineage.customer_attached",
			"purchase_lineage", lineageID, map[string]string{"billingCustomerId": resolution.CustomerID}, now)

	case OutcomeConflicting:
		conflictID, idErr := s.newID("bic")
		if idErr != nil {
			return Resolution{}, ErrUnavailable
		}
		if _, err := s.repository.OpenConflict(ctx, Conflict{
			ID: conflictID, ProjectID: projectID, Scope: ConflictScopeLineage,
			PurchaseLineageID: lineageID,
			Status:            "open", FirstCustomerID: resolution.CustomerID,
			SecondCustomerID: resolution.ConflictWith, DiagnosticCode: resolution.DiagnosticCode,
			OpenedAt: now,
		}); err != nil {
			return Resolution{}, ErrUnavailable
		}
		if err := s.repository.SetLineageFrozen(ctx, projectID, lineageID, true, "identity_conflict", now); err != nil {
			return Resolution{}, ErrUnavailable
		}
		_ = s.repository.RecordAudit(ctx, Actor{}, projectID, "billing.lineage.identity_conflict_opened",
			"purchase_lineage", lineageID, map[string]string{
				"conflictScope": ConflictScopeLineage, "diagnosticCode": resolution.DiagnosticCode,
			}, now)
		logSafely(ctx, "billing lineage frozen by identity conflict", map[string]string{
			"project_id": projectID, "purchase_lineage_id": lineageID,
			"diagnostic_code": resolution.DiagnosticCode,
		})

		// Corrects review finding I-10. Freezing the lineage only stops the
		// *next* projection from using it; the customer that was already
		// granted this purchase still has a committed snapshot saying so. The
		// error is returned rather than swallowed: the freeze and the conflict
		// are idempotent, so the caller's retry re-reaches this point, whereas
		// dropping the trigger would leave the stale grant standing until some
		// unrelated event happened to enqueue a projection.
		if reassignedFrom != "" {
			if err := s.scheduleReprojection(ctx, projectID, lineage.EnvironmentID, reassignedFrom); err != nil {
				return Resolution{}, err
			}
		}
	}
	span.SetAttributes(attribute.String("mosaic.billing.association.outcome", resolution.Outcome))
	return resolution, nil
}

// LocateLineage finds or creates the lineage for a validated provider chain.
// It never merges two lineages because they share a Product or a customer.
func (s *Service) LocateLineage(ctx context.Context, lineage Lineage) (Lineage, error) {
	if err := s.requireEnabled(ctx, lineage.ProjectID); err != nil {
		return Lineage{}, err
	}
	if lineage.ID == "" {
		id, err := s.newID("bpl")
		if err != nil {
			return Lineage{}, ErrUnavailable
		}
		lineage.ID = id
	}
	now := s.now()
	lineage.CreatedAt, lineage.UpdatedAt = now, now
	if lineage.DiagnosticStatus == "" {
		lineage.DiagnosticStatus = "none"
	}
	located, created, err := s.repository.LocateLineage(ctx, lineage)
	if err != nil {
		return Lineage{}, ErrUnavailable
	}
	if created {
		_ = s.repository.RecordAudit(ctx, Actor{}, lineage.ProjectID, "billing.lineage.created",
			"purchase_lineage", located.ID, map[string]string{"provider": located.Provider}, now)
	}
	return located, nil
}

// RecordSupersession records that one lineage was replaced by another. Nothing
// is deleted: the superseded lineage stops granting access and stays fully
// visible in history.
func (s *Service) RecordSupersession(ctx context.Context, projectID, supersededID, successorID string) error {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return err
	}
	if supersededID == successorID {
		return ErrConflict
	}
	now := s.now()
	if err := s.repository.SetLineageSupersededBy(ctx, projectID, supersededID, successorID, now); err != nil {
		return ErrUnavailable
	}
	return s.repository.RecordAudit(ctx, Actor{}, projectID, "billing.lineage.superseded",
		"purchase_lineage", supersededID, map[string]string{"supersededByLineageId": successorID}, now)
}

// Customer reads one customer for an authorized operator.
func (s *Service) Customer(ctx context.Context, actor Actor, projectID, customerID string) (Customer, error) {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Customer{}, err
	}
	return s.repository.Customer(ctx, actor, projectID, customerID)
}

// ListCustomers pages a Project's customers for an authorized operator.
func (s *Service) ListCustomers(ctx context.Context, actor Actor, projectID string, limit int, cursor string) ([]Customer, string, error) {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return nil, "", err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repository.ListCustomers(ctx, actor, projectID, limit, cursor)
}

// ListAliases returns a customer's alias history. Digest values are not part
// of the response shape: an alias digest is still a stable per-person
// identifier and nothing on an operator surface needs it.
func (s *Service) ListAliases(ctx context.Context, actor Actor, projectID, customerID string) ([]Alias, error) {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return nil, err
	}
	return s.repository.ListAliases(ctx, actor, projectID, customerID)
}

// ListConflicts returns open identity conflicts for operator resolution.
func (s *Service) ListConflicts(ctx context.Context, actor Actor, projectID, status string) ([]Conflict, error) {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return nil, err
	}
	if status == "" {
		status = "open"
	}
	return s.repository.ListConflicts(ctx, actor, projectID, status)
}

// ResolveConflict applies an operator's decision and unfreezes the lineage.
// There is deliberately no automatic-merge path: automatic merge stays an ADR
// checkpoint, not something a heuristic reaches on its own.
func (s *Service) ResolveConflict(ctx context.Context, actor Actor, projectID, conflictID, action, assignedCustomerID string) (Conflict, error) {
	if err := s.requireEnabled(ctx, projectID); err != nil {
		return Conflict{}, err
	}
	switch action {
	case "assigned_first", "assigned_second", "detached_both":
	default:
		return Conflict{}, ErrConflict
	}
	now := s.now()
	conflict, err := s.repository.ResolveConflict(ctx, actor, projectID, conflictID, action, assignedCustomerID, now)
	if err != nil {
		return Conflict{}, err
	}

	environmentID := ""
	switch conflict.Scope {
	case ConflictScopeAlias:
		// An alias conflict froze the customer the caller tried to extend,
		// because there was no lineage to freeze. Release it.
		if err := s.repository.SetCustomerStatus(ctx, projectID, conflict.FirstCustomerID, StatusActive, now); err != nil {
			return Conflict{}, ErrUnavailable
		}
	default:
		lineage, lineageErr := s.repository.Lineage(ctx, projectID, conflict.PurchaseLineageID)
		if lineageErr != nil {
			return Conflict{}, ErrUnavailable
		}
		environmentID = lineage.EnvironmentID
		if err := s.repository.SetLineageFrozen(ctx, projectID, conflict.PurchaseLineageID, false, "none", now); err != nil {
			return Conflict{}, ErrUnavailable
		}
	}

	_ = s.repository.RecordAudit(ctx, actor, projectID, "billing.identity_conflict.resolved",
		"billing_identity_conflict", conflictID, map[string]string{
			"action": action, "conflictScope": conflict.Scope,
		}, now)

	// Corrects review finding I-10. Both candidates are reprojected, not only
	// the assigned one: whichever customer loses the lineage is the one holding
	// a committed snapshot that still grants it, and that is the stale grant
	// the finding is about. Reprojection is idempotent and a no-change
	// projection is a first-class outcome, so reprojecting the winner too costs
	// nothing and removes a whole class of "which side needed it" reasoning.
	if environmentID != "" {
		for _, customerID := range dedupe(conflict.FirstCustomerID, conflict.SecondCustomerID, assignedCustomerID) {
			if err := s.scheduleReprojection(ctx, projectID, environmentID, customerID); err != nil {
				return Conflict{}, err
			}
		}
	}
	return conflict, nil
}

// openAliasConflict records that one application-user alias claims two
// customers, freezes the customer the caller tried to extend, and refuses the
// attachment. Corrects review finding I-10.
//
// The freeze lands on the customer named in the request rather than on both:
// the other customer's grants come from its own lineages and are not in
// dispute, and freezing a paying customer's identity because someone else's
// backend sent a bad attach would be a self-inflicted outage. Freezing the
// requested customer is what makes the next identical request fail closed
// instead of quietly retrying the same reassignment.
func (s *Service) openAliasConflict(ctx context.Context, actor Actor, projectID, customerID string, digest []byte, now time.Time) error {
	other, err := s.repository.CustomerForAlias(ctx, projectID, AliasApplicationUser, digest)
	if err != nil {
		// The alias could not be read back. Report the original conflict rather
		// than inventing a conflict record against an unknown counterparty.
		return ErrConflict
	}
	if other.ID == customerID {
		// The alias is already attached to this very customer. Attaching twice
		// is not a conflict worth an operator's time.
		return ErrConflict
	}

	conflictID, idErr := s.newID("bic")
	if idErr != nil {
		return ErrUnavailable
	}
	if _, err := s.repository.OpenConflict(ctx, Conflict{
		ID: conflictID, ProjectID: projectID, Scope: ConflictScopeAlias,
		AliasType: AliasApplicationUser, Status: "open",
		FirstCustomerID: customerID, SecondCustomerID: other.ID,
		DiagnosticCode: DiagnosticAliasClaimsTwoCustomers, OpenedAt: now,
	}.WithDigest(digest)); err != nil {
		return ErrUnavailable
	}
	if err := s.repository.SetCustomerStatus(ctx, projectID, customerID, StatusFrozen, now); err != nil {
		return ErrUnavailable
	}
	_ = s.repository.RecordAudit(ctx, actor, projectID, "billing.customer.identity_conflict_opened",
		"billing_customer", customerID, map[string]string{
			"conflictScope": ConflictScopeAlias, "aliasType": AliasApplicationUser,
			"diagnosticCode": DiagnosticAliasClaimsTwoCustomers,
		}, now)
	// Identifiers only. The alias value and its digest never reach a log.
	logSafely(ctx, "billing customer frozen by alias identity conflict", map[string]string{
		"project_id": projectID, "billing_customer_id": customerID,
		"billing_identity_conflict_id": conflictID,
	})
	return ErrIdentityConflict
}

// scheduleReprojection asks the projection module to recompute one customer's
// aggregate. Corrects review finding I-10: an identity change that does not
// reach here leaves the previous owner's committed snapshot granting a purchase
// it no longer holds.
func (s *Service) scheduleReprojection(ctx context.Context, projectID, environmentID, customerID string) error {
	if customerID == "" || environmentID == "" {
		return nil
	}
	if s.reprojector == nil {
		zerolog.Ctx(ctx).Error().
			Str("project_id", projectID).
			Str("billing_customer_id", customerID).
			Msg("no reprojector is wired; a stale entitlement grant cannot be recomputed")
		return ErrUnavailable
	}
	err := s.reprojector.Enqueue(ctx, billingprojection.Scope{
		ProjectID: projectID, EnvironmentID: environmentID, CustomerID: customerID,
	}, billingprojection.KindAssociationEstablished)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, billingprojection.ErrBillingDisabled):
		return ErrBillingDisabled
	default:
		return ErrUnavailable
	}
}

func dedupe(values ...string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

// requireEnabled fails closed. A Project that turned billing off holds no
// billing identity, and a transient read failure must not be able to break
// that promise — so an unreadable setting is treated as disabled and reported,
// exactly as the 9A ingestion path does.
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

func (s *Service) newID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := io.ReadFull(s.random, buffer); err != nil {
		return "", fmt.Errorf("generate billing identity identifier: %w", err)
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

// logSafely writes an operator line with identifiers only. No alias value, no
// digest, and no correlator ever reaches a log.
func logSafely(ctx context.Context, message string, fields map[string]string) {
	event := zerolog.Ctx(ctx).Info()
	for key, value := range fields {
		if value != "" {
			event = event.Str(key, value)
		}
	}
	event.Msg(message)
}
