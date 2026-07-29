package billingcustomer

import (
	"context"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

// These tests protect the two identity outcomes that cannot be undone later: a
// purchase moving to the wrong customer, and a client-generated identifier
// being able to reach someone else's customer at all.

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type recordedProjection struct {
	scope billingprojection.Scope
	kind  string
}

type stubReprojector struct {
	enqueued []recordedProjection
}

func (s *stubReprojector) Enqueue(_ context.Context, scope billingprojection.Scope, kind string) error {
	s.enqueued = append(s.enqueued, recordedProjection{scope: scope, kind: kind})
	return nil
}

// stubRepository records what the service asked persistence to do. It answers
// reads from fields the test sets, and every write is captured rather than
// applied, so an assertion can distinguish "was not attempted" from "was
// attempted and failed".
type stubRepository struct {
	lineage         Lineage
	aliasResolution map[string]string

	createdCustomers    []Customer
	attachedAliases     []Alias
	evidence            []Evidence
	conflicts           []Conflict
	lineageAttachments  []string
	frozenLineages      map[string]bool
	customerStatusCalls map[string]string
}

func newStubRepository() *stubRepository {
	return &stubRepository{
		aliasResolution:     map[string]string{},
		frozenLineages:      map[string]bool{},
		customerStatusCalls: map[string]string{},
	}
}

func (s *stubRepository) BillingEnabled(context.Context, string) (bool, error) { return true, nil }

func (s *stubRepository) CreateCustomer(_ context.Context, customer Customer) (Customer, error) {
	s.createdCustomers = append(s.createdCustomers, customer)
	return customer, nil
}

func (s *stubRepository) Customer(_ context.Context, _ Actor, projectID, customerID string) (Customer, error) {
	return Customer{ID: customerID, ProjectID: projectID, Status: StatusActive}, nil
}

func (s *stubRepository) CustomerForAlias(_ context.Context, projectID, _ string, digest []byte) (Customer, error) {
	if id, ok := s.aliasResolution[string(digest)]; ok {
		return Customer{ID: id, ProjectID: projectID, Status: StatusActive}, nil
	}
	return Customer{}, ErrNotFound
}

func (s *stubRepository) ListCustomers(context.Context, Actor, string, int, string) ([]Customer, string, error) {
	return nil, "", nil
}

func (s *stubRepository) SetCustomerStatus(_ context.Context, _, customerID, status string, _ time.Time) error {
	s.customerStatusCalls[customerID] = status
	return nil
}

func (s *stubRepository) AttachAlias(_ context.Context, alias Alias) (Alias, error) {
	if _, taken := s.aliasResolution[string(alias.Digest())]; taken {
		return Alias{}, ErrConflict
	}
	s.attachedAliases = append(s.attachedAliases, alias)
	s.aliasResolution[string(alias.Digest())] = alias.BillingCustomerID
	return alias, nil
}

func (s *stubRepository) RevokeAlias(context.Context, Actor, string, string, time.Time) error {
	return nil
}

func (s *stubRepository) ListAliases(context.Context, Actor, string, string) ([]Alias, error) {
	return nil, nil
}

func (s *stubRepository) ActiveAliasResolutions(context.Context, string, [][]byte) (map[string]string, error) {
	return s.aliasResolution, nil
}

func (s *stubRepository) RecordEvidence(_ context.Context, evidence Evidence) error {
	s.evidence = append(s.evidence, evidence)
	return nil
}

func (s *stubRepository) EvidenceForReference(context.Context, string, []byte) ([]Evidence, error) {
	return nil, nil
}

func (s *stubRepository) LocateLineage(_ context.Context, lineage Lineage) (Lineage, bool, error) {
	return lineage, false, nil
}

func (s *stubRepository) Lineage(context.Context, string, string) (Lineage, error) {
	return s.lineage, nil
}

func (s *stubRepository) LineageByKey(context.Context, string, string, []byte) (Lineage, error) {
	return s.lineage, nil
}

func (s *stubRepository) AttachLineageCustomer(_ context.Context, _, lineageID, customerID string, _ time.Time) error {
	s.lineageAttachments = append(s.lineageAttachments, lineageID+"->"+customerID)
	return nil
}

func (s *stubRepository) SetLineageSupersededBy(context.Context, string, string, string, time.Time) error {
	return nil
}

func (s *stubRepository) SetLineageFrozen(_ context.Context, _, lineageID string, frozen bool, _ string, _ time.Time) error {
	s.frozenLineages[lineageID] = frozen
	return nil
}

func (s *stubRepository) OpenConflict(_ context.Context, conflict Conflict) (Conflict, error) {
	s.conflicts = append(s.conflicts, conflict)
	return conflict, nil
}

func (s *stubRepository) Conflict(context.Context, Actor, string, string) (Conflict, error) {
	return Conflict{}, ErrNotFound
}

func (s *stubRepository) ListConflicts(context.Context, Actor, string, string) ([]Conflict, error) {
	return nil, nil
}

func (s *stubRepository) ResolveConflict(context.Context, Actor, string, string, string, string, string, time.Time) (Conflict, error) {
	return Conflict{}, ErrNotFound
}

func (s *stubRepository) RecordAudit(context.Context, Actor, string, string, string, string, map[string]string, time.Time) error {
	return nil
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Review finding I-10. Higher-authority evidence naming a different customer
// used to move an already-attached lineage silently. Two things went wrong at
// once: no operator ever saw that a purchase changed hands, and the customer
// that lost the purchase kept a committed entitlement snapshot still granting
// it — a stale grant with no event left to recompute it.
//
// The realistic failure this catches is one backend sending an incorrect
// application user id for an existing subscriber: the subscription silently
// transfers, the original paying customer keeps access they no longer own, and
// nothing in the system records that it happened.
func TestReassignmentOpensConflictAndReprojectsPreviousCustomer(t *testing.T) {
	repository := newStubRepository()
	repository.lineage = Lineage{
		ID: "bpl_1", ProjectID: "prj_1", EnvironmentID: "env_1",
		BillingCustomerID: "bcu_incumbent",
	}
	reprojector := &stubReprojector{}
	service := NewService(repository, nil, reprojector,
		WithClock(func() time.Time { return time.Unix(1700000000, 0).UTC() }))

	resolution, err := service.ResolveLineageCustomer(context.Background(), "prj_1", "bpl_1",
		[]Observation{{EvidenceType: EvidenceTrustedServer, CustomerID: "bcu_challenger"}})
	if err != nil {
		t.Fatalf("resolve returned %v", err)
	}

	if resolution.Outcome != OutcomeConflicting {
		t.Fatalf("outcome %q/%q; a reassignment away from an attached customer must conflict, not resolve",
			resolution.Outcome, resolution.CustomerID)
	}
	if len(repository.lineageAttachments) != 0 {
		t.Fatalf("the lineage was moved to %v; reassignment must never happen automatically",
			repository.lineageAttachments)
	}
	if len(repository.conflicts) != 1 {
		t.Fatalf("opened %d conflicts, want exactly one operator-resolvable record", len(repository.conflicts))
	}
	conflict := repository.conflicts[0]
	if conflict.Scope != ConflictScopeLineage ||
		conflict.FirstCustomerID != "bcu_incumbent" || conflict.SecondCustomerID != "bcu_challenger" {
		t.Fatalf("conflict %+v does not name the incumbent first and the challenger second", conflict)
	}
	if conflict.DiagnosticCode != DiagnosticReassignmentBlocked {
		t.Fatalf("conflict diagnostic %q, want %q", conflict.DiagnosticCode, DiagnosticReassignmentBlocked)
	}
	if !repository.frozenLineages["bpl_1"] {
		t.Fatal("the disputed lineage was not frozen; the next projection would grant one candidate anyway")
	}

	if len(reprojector.enqueued) != 1 {
		t.Fatalf("scheduled %d reprojections, want one for the customer losing the purchase",
			len(reprojector.enqueued))
	}
	scheduled := reprojector.enqueued[0]
	if scheduled.scope.CustomerID != "bcu_incumbent" ||
		scheduled.scope.ProjectID != "prj_1" || scheduled.scope.EnvironmentID != "env_1" {
		t.Fatalf("reprojected %+v; the previously attached customer holds the stale grant", scheduled.scope)
	}

	// Persisted evidence must record the outcome that actually happened. A row
	// stamped `resolved` for a resolution the service refused to apply would
	// make a later replay reconstruct a transfer that never occurred.
	for _, evidence := range repository.evidence {
		if evidence.Outcome == OutcomeResolved {
			t.Fatalf("evidence %q was recorded as resolved for a blocked reassignment", evidence.EvidenceType)
		}
	}
}

// An installation identifier is client-generated and guessable. If it could
// select or create a customer, forging one would read someone else's
// entitlements (OD-4(a), plan §5a rule 2a). resolver_test.go pins the pure
// rule; this pins the service paths that persist, which is where a future
// convenience shortcut would actually be added.
func TestInstallationAliasNeverSelectsOrCreatesCustomer(t *testing.T) {
	repository := newStubRepository()
	repository.lineage = Lineage{ID: "bpl_2", ProjectID: "prj_1", EnvironmentID: "env_1"}
	// A victim customer already owns this installation digest.
	installationDigest := AliasDigest(AliasInstallation, "install-abc")
	repository.aliasResolution[string(installationDigest)] = "bcu_victim"

	service := NewService(repository, nil, &stubReprojector{},
		WithClock(func() time.Time { return time.Unix(1700000000, 0).UTC() }))

	// Recording installation evidence creates nothing.
	if err := service.RecordInstallationEvidence(context.Background(),
		"prj_1", "env_1", "", "install-abc"); err != nil {
		t.Fatalf("record installation evidence: %v", err)
	}
	if len(repository.createdCustomers) != 0 {
		t.Fatalf("installation registration created %d customers; it must create none",
			len(repository.createdCustomers))
	}
	if len(repository.attachedAliases) != 0 {
		t.Fatal("installation registration attached an alias; the installation id is evidence only")
	}

	// And it cannot select one either, even when it already resolves.
	resolution, err := service.ResolveLineageCustomer(context.Background(), "prj_1", "bpl_2",
		[]Observation{{
			EvidenceType: EvidenceInstallation, Digest: installationDigest,
			AliasType: AliasInstallation,
		}})
	if err != nil {
		t.Fatalf("resolve returned %v", err)
	}
	if resolution.Outcome != OutcomeUnresolved || resolution.CustomerID != "" {
		t.Fatalf("installation evidence produced %q/%q; it must never select a customer",
			resolution.Outcome, resolution.CustomerID)
	}
	if len(repository.lineageAttachments) != 0 {
		t.Fatalf("the lineage was attached via installation evidence: %v", repository.lineageAttachments)
	}
	if len(repository.createdCustomers) != 0 {
		t.Fatal("resolution created a customer from installation evidence")
	}
}
