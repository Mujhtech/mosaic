package placementdecision

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestValidationWarningsDoNotBlockEquivalentRuleSet(t *testing.T) {
	leaf := Condition{Type: "condition", Source: Source{Kind: "device.platform"}, Operator: "equals", Value: &TypedValue{Type: "string", Value: "ios"}}
	document := validTestDocument()
	document.Rules = []Rule{
		{ID: "rule_1", Priority: 10, Enabled: true, Condition: Condition{Type: "all", Children: []Condition{leaf, leaf}}, Outcome: Outcome{Type: "no_paywall"}},
		{ID: "rule_2", Priority: 20, Enabled: true, Condition: Condition{Type: "all", Children: []Condition{leaf, leaf}}, Outcome: Outcome{Type: "no_paywall"}},
	}

	result := Validate(document, nil)
	if !result.Valid {
		t.Fatalf("warnings made an otherwise valid Rule Set invalid: %#v", result.Issues)
	}
	codes := map[string]bool{}
	for _, issue := range result.Issues {
		if issue.Severity != "warning" {
			t.Fatalf("unexpected blocking issue: %#v", issue)
		}
		codes[issue.Code] = true
	}
	if !codes["duplicate_leaf_condition"] || !codes["rule_shadowed_by_earlier_equivalent"] {
		t.Fatalf("expected duplicate and shadow warnings, got %#v", result.Issues)
	}
}

func TestPublishRecomputesCompatibilityAfterServerMutationAndRevalidates(t *testing.T) {
	repository := newRiskRepository("staging")
	document := validTestDocument()
	document.Compatibility = Compatibility{RequiredFeatures: []string{"outcome.paywall"}, RequiredBucketingAlgorithms: []string{BucketingAlgorithm}}
	repository.revision.Document = MarshalDocument(document)
	repository.overrides = []QAOverride{{ID: "override_1", SafeLabel: "QA", CreatedAt: repository.now, ExpiresAt: repository.now.Add(time.Hour), Outcome: Outcome{Type: "no_paywall"}, SelectorDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
	service := NewService(repository)
	service.now = func() time.Time { return repository.now }

	version, err := service.Publish(context.Background(), Actor{ID: "actor_1"}, "project_1", "environment_1", "placement_1", "ruleset_1", 1)
	if err != nil {
		t.Fatal(err)
	}
	final, _, _, err := Canonicalize(version.Document)
	if err != nil {
		t.Fatal(err)
	}
	want := DeriveCompatibility(final)
	if !equalStrings(final.Compatibility.RequiredFeatures, want.RequiredFeatures) || !equalStrings(final.Compatibility.RequiredBucketingAlgorithms, want.RequiredBucketingAlgorithms) {
		t.Fatalf("stored compatibility was not derived from final bytes: got %#v want %#v", final.Compatibility, want)
	}
	if !contains(final.Compatibility.RequiredFeatures, "override.qa") || contains(final.Compatibility.RequiredFeatures, "outcome.paywall") {
		t.Fatalf("server mutation not reflected exactly in compatibility: %#v", final.Compatibility)
	}

	repository = newRiskRepository("staging")
	repository.revision.Document = MarshalDocument(validTestDocument())
	repository.overrides = []QAOverride{{ID: "override_bad", SafeLabel: "QA", CreatedAt: repository.now, ExpiresAt: repository.now.Add(time.Hour), Outcome: Outcome{Type: "paywall", PaywallVersionID: "missing"}, SelectorDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}
	service = NewService(repository)
	service.now = func() time.Time { return repository.now }
	if _, err := service.Publish(context.Background(), Actor{ID: "actor_1"}, "project_1", "environment_1", "placement_1", "ruleset_1", 1); !errors.Is(err, ErrValidation) {
		t.Fatalf("final server-mutated bytes were saved without revalidation: %v", err)
	}
	if repository.savedVersion.ID != "" {
		t.Fatal("invalid final bytes reached immutable version persistence")
	}
}

func TestOverrideAndRuleSetArchiveLifecycleGuards(t *testing.T) {
	repository := newRiskRepository("staging")
	repository.revision.Document = MarshalDocument(validTestDocument())
	service := NewService(repository)
	service.now = func() time.Time { return repository.now }
	_, err := service.CreateOverride(context.Background(), Actor{ID: "actor_1"}, "project_1", "environment_1", "placement_1", "QA", "selector-value-long", Outcome{Type: "paywall", PaywallVersionID: "missing"}, repository.now.Add(time.Hour))
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("override accepted an invalid outcome reference: %v", err)
	}
	productionRepository := newRiskRepository("production")
	productionRepository.revision.Document = MarshalDocument(validTestDocument())
	productionService := NewService(productionRepository)
	productionService.now = func() time.Time { return productionRepository.now }
	if _, err := productionService.CreateOverride(context.Background(), Actor{ID: "actor_1"}, "project_1", "environment_1", "placement_1", "QA", "selector-value-long", Outcome{Type: "no_paywall"}, productionRepository.now.Add(time.Hour)); !errors.Is(err, ErrProductionOverride) {
		t.Fatalf("production Environment accepted a QA override: %v", err)
	}

	if err := service.ArchiveRuleSet(context.Background(), Actor{ID: "actor_1"}, "project_1", "environment_1", "placement_1", "ruleset_1"); err != nil {
		t.Fatal(err)
	}
	if repository.ruleSet.Status != "archived" || repository.draft.Status != "superseded" || repository.ruleSet.CurrentDraftID != "" {
		t.Fatalf("archive did not close mutable lifecycle: ruleSet=%#v draft=%#v", repository.ruleSet, repository.draft)
	}
	if _, err := service.Publish(context.Background(), Actor{ID: "actor_1"}, "project_1", "environment_1", "placement_1", "ruleset_1", 1); !errors.Is(err, ErrArchived) {
		t.Fatalf("archived Rule Set remained publishable: %v", err)
	}
}

func validTestDocument() Document {
	return Document{RuleSetID: "ruleset_1", Version: 1, ProjectID: "project_1", EnvironmentID: "environment_1", EnvironmentKey: "staging", PlacementID: "placement_1", PlacementKey: "upgrade", Enabled: true, AssignmentPolicy: "installation", AttributeDefinitions: []ContractAttributeDefinition{}, DefaultOutcome: Outcome{Type: "no_paywall"}, Fallbacks: []Fallback{}, Rules: []Rule{}, QAOverrides: []PublishedOverride{}, Compatibility: Compatibility{RequiredFeatures: []string{"outcome.no_paywall"}, RequiredBucketingAlgorithms: []string{}}}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

type riskRepository struct {
	now          time.Time
	scope        Scope
	ruleSet      RuleSet
	draft        Draft
	revision     DraftRevision
	overrides    []QAOverride
	versions     []Version
	savedVersion Version
	sequence     int
}

func newRiskRepository(mode string) *riskRepository {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	return &riskRepository{now: now, scope: Scope{ProjectID: "project_1", OrganizationID: "organization_1", ProjectStatus: "active", Role: "owner", EnvironmentID: "environment_1", EnvironmentKey: "staging", EnvironmentMode: mode, PlacementID: "placement_1", PlacementKey: "upgrade", PlacementStatus: "active"}, ruleSet: RuleSet{ID: "ruleset_1", ProjectID: "project_1", EnvironmentID: "environment_1", PlacementID: "placement_1", ContractVersion: "1", Status: "active", CurrentDraftID: "draft_1", CreatedByActorID: "actor_1", CreatedAt: now, UpdatedAt: now}, draft: Draft{ID: "draft_1", RuleSetID: "ruleset_1", ProjectID: "project_1", EnvironmentID: "environment_1", Status: "active", CurrentRevision: 1, CreatedByActorID: "actor_1", UpdatedByActorID: "actor_1", CreatedAt: now, UpdatedAt: now}, revision: DraftRevision{DraftID: "draft_1", RuleSetID: "ruleset_1", ProjectID: "project_1", EnvironmentID: "environment_1", Revision: 1}}
}

func (r *riskRepository) View(_ context.Context, fn func(Reader) error) error          { return fn(r) }
func (r *riskRepository) Transact(_ context.Context, fn func(Transaction) error) error { return fn(r) }
func (r *riskRepository) Scope(_, _, _, _ string) (Scope, bool)                        { return r.scope, true }
func (r *riskRepository) RuleSet(id string) (RuleSet, bool)                            { return r.ruleSet, id == r.ruleSet.ID }
func (r *riskRepository) RuleSetForPlacement(_, _ string) (RuleSet, bool)              { return r.ruleSet, true }
func (r *riskRepository) Draft(id string) (Draft, bool)                                { return r.draft, id == r.draft.ID }
func (r *riskRepository) DraftRevision(id string, revision int64) (DraftRevision, bool) {
	return r.revision, id == r.draft.ID && revision == 1
}
func (r *riskRepository) DraftRevisionByMutation(string, string) (DraftRevision, bool) {
	return DraftRevision{}, false
}
func (r *riskRepository) Version(id string) (Version, bool) {
	for _, value := range r.versions {
		if value.ID == id {
			return value, true
		}
	}
	return Version{}, false
}
func (r *riskRepository) Versions(string) []Version { return append([]Version(nil), r.versions...) }
func (r *riskRepository) AttributeScoped(string, string) (AttributeDefinition, bool) {
	return AttributeDefinition{}, false
}
func (r *riskRepository) Attributes(string) []AttributeDefinition          { return nil }
func (r *riskRepository) PaywallVersionScoped(string, string, string) bool { return false }
func (r *riskRepository) ProductScoped(string, string) bool                { return false }
func (r *riskRepository) EntitlementScoped(string, string) bool            { return false }
func (r *riskRepository) Aliases(string) []Alias                           { return nil }
func (r *riskRepository) Usage(string) Usage {
	if r.ruleSet.Status == "active" {
		return Usage{RuleSetCount: 1}
	}
	return Usage{}
}
func (r *riskRepository) Overrides(string, string, time.Time) []QAOverride {
	return append([]QAOverride(nil), r.overrides...)
}
func (r *riskRepository) OverrideScoped(id, projectID, environmentID, placementID string) (QAOverride, bool) {
	for _, override := range r.overrides {
		if override.ID == id && override.ProjectID == projectID && override.EnvironmentID == environmentID && override.PlacementID == placementID && override.Status == "active" {
			return override, true
		}
	}
	return QAOverride{}, false
}
func (r *riskRepository) Lock(string)                     {}
func (r *riskRepository) NextID(prefix string) string     { r.sequence++; return prefix + "_test" }
func (r *riskRepository) SaveRuleSet(value RuleSet)       { r.ruleSet = value }
func (r *riskRepository) SaveDraft(value Draft)           { r.draft = value }
func (r *riskRepository) SaveDraftRevision(DraftRevision) {}
func (r *riskRepository) SaveVersion(value Version, _ []Rule) {
	r.savedVersion = value
	r.versions = append(r.versions, value)
}
func (r *riskRepository) SaveAttribute(AttributeDefinition)                       {}
func (r *riskRepository) ArchiveAttribute(string, string, string, time.Time) bool { return false }
func (r *riskRepository) SaveAlias(Alias)                                         {}
func (r *riskRepository) ArchiveRuleSet(id, _ string, at time.Time) bool {
	if id != r.ruleSet.ID || r.ruleSet.Status != "active" {
		return false
	}
	r.draft.Status = "superseded"
	r.ruleSet.Status, r.ruleSet.CurrentDraftID, r.ruleSet.ArchivedAt, r.ruleSet.UpdatedAt = "archived", "", &at, at
	return true
}
func (r *riskRepository) ArchivePlacement(string, string, time.Time) {}
func (r *riskRepository) SaveOverride(QAOverride, []byte, []byte)    {}
func (r *riskRepository) RevokeOverride(string, string, string, string, string, time.Time) bool {
	return false
}
func (r *riskRepository) SaveAudit(AuditEvent) {}

var _ Repository = (*riskRepository)(nil)
var _ Transaction = (*riskRepository)(nil)
