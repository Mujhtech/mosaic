package billingmigrationrepair

import (
	"context"
	"errors"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingprojection"
)

func TestProductionProviderAdapterDispatchesKnownReferenceIdempotently(t *testing.T) {
	store := newRepairStoreFake()
	provider := &providerImporterFake{result: billingmigration.ProviderEvidenceResult{Validated: 1, EvidenceDigest: digestOf(9)}}
	production := &Production{Store: store, Provider: provider}

	result, err := production.RevalidateProviderReference(context.Background(), RepairCommand{ProgramID: "program", References: []string{"source-record"}})
	if err != nil {
		t.Fatalf("provider repair: %v", err)
	}
	replay, err := production.RevalidateProviderReference(context.Background(), RepairCommand{ProgramID: "program", References: []string{"source-record"}})
	if err != nil {
		t.Fatalf("provider repair replay: %v", err)
	}
	if provider.calls != 2 || provider.refs[0].Reference != "provider-reference" {
		t.Fatalf("provider importer calls=%d refs=%#v", provider.calls, provider.refs)
	}
	if string(result.AfterDigest) != string(digestOf(9)) || string(replay.AfterDigest) != string(result.AfterDigest) {
		t.Fatalf("provider result=%#v replay=%#v", result, replay)
	}
}

func TestProductionProviderAdapterFailsClosedWhenValidationIsPending(t *testing.T) {
	store := newRepairStoreFake()
	provider := &providerImporterFake{result: billingmigration.ProviderEvidenceResult{Accepted: 1, EvidenceDigest: digestOf(8)}, err: billingmigration.ErrValidationPending}
	production := &Production{Store: store, Provider: provider}

	result, err := production.RevalidateProviderReference(context.Background(), RepairCommand{ProgramID: "program", References: []string{"source-record"}})
	if !errors.Is(err, billingmigration.ErrValidationPending) {
		t.Fatalf("pending error = %v", err)
	}
	if result.ErrorCode != "provider_validation_pending" || string(result.BeforeDigest) != string(result.AfterDigest) {
		t.Fatalf("pending result = %#v", result)
	}
}

func TestProductionFactReplayDispatchesProjectionWithStableReplayDigest(t *testing.T) {
	store := newRepairStoreFake()
	projection := &projectionFake{results: []billingprojection.ReplayResult{{
		ScopeKey: "customer:bcu_one", Comparison: billingprojection.ComparisonChanged, Materialized: true,
	}}}
	production := &Production{Store: store, Projection: projection, ReplayKeys: replayKeysFake{}}

	result, err := production.ReplayImmutableFactRange(context.Background(), RepairCommand{ProgramID: "program", References: []string{"customer:bcu_one"}})
	if err != nil {
		t.Fatalf("fact replay: %v", err)
	}
	projection.results = []billingprojection.ReplayResult{{ScopeKey: "customer:bcu_one", Comparison: billingprojection.ComparisonUnchanged}}
	replay, err := production.ReplayImmutableFactRange(context.Background(), RepairCommand{ProgramID: "program", References: []string{"customer:bcu_one"}})
	if err != nil {
		t.Fatalf("fact replay retry: %v", err)
	}
	if projection.calls != 2 || projection.scope.CustomerID != "bcu_one" || projection.scope.ProjectID != "project" {
		t.Fatalf("projection calls=%d scope=%#v", projection.calls, projection.scope)
	}
	if string(result.AfterDigest) != string(replay.AfterDigest) || string(result.BeforeDigest) == string(result.AfterDigest) {
		t.Fatalf("fact replay result=%#v replay=%#v", result, replay)
	}
}

func TestProductionFactReplayFailsClosedForUnsupportedScope(t *testing.T) {
	production := &Production{Store: newRepairStoreFake(), Projection: &projectionFake{}, ReplayKeys: replayKeysFake{}}

	result, err := production.ReplayImmutableFactRange(context.Background(), RepairCommand{ProgramID: "program", References: []string{"fact-id-only"}})
	if !errors.Is(err, billingmigration.ErrUnavailable) {
		t.Fatalf("fact replay error = %v, want unavailable", err)
	}
	if result.ErrorCode != "unsupported_fact_replay_scope" {
		t.Fatalf("unsupported fact result = %#v", result)
	}
}

func TestProductionAliasAdapterAttachesWithStableExecutionIDReceipt(t *testing.T) {
	store := newRepairStoreFake()
	production := &Production{Store: store}
	command := RepairCommand{ExecutionID: "mre_stable", ProgramID: "program", References: []string{"entry"}}

	result, err := production.AttachProvenAlias(context.Background(), command)
	if err != nil {
		t.Fatalf("alias repair: %v", err)
	}
	replay, err := production.AttachProvenAlias(context.Background(), command)
	if err != nil {
		t.Fatalf("alias repair replay: %v", err)
	}
	if store.aliasAttachAttempts != 2 || store.aliasInsertions != 1 {
		t.Fatalf("alias attempts=%d insertions=%d", store.aliasAttachAttempts, store.aliasInsertions)
	}
	if string(result.AfterDigest) != string(replay.AfterDigest) || string(result.BeforeDigest) == string(result.AfterDigest) {
		t.Fatalf("alias result=%#v replay=%#v", result, replay)
	}
}

func TestProductionAliasAdapterNoChangesWhenAliasAlreadyAttached(t *testing.T) {
	store := newRepairStoreFake()
	store.activeAliasCustomer = "bcu_one"
	production := &Production{Store: store}

	result, err := production.AttachProvenAlias(context.Background(), RepairCommand{ProgramID: "program", References: []string{"entry"}})
	if err != nil {
		t.Fatalf("alias no-change repair: %v", err)
	}
	if store.aliasInsertions != 0 {
		t.Fatalf("alias attachment was attempted for already attached alias")
	}
	if string(result.BeforeDigest) != string(result.AfterDigest) {
		t.Fatalf("already attached alias should be no-change: %#v", result)
	}
}

func TestProductionAliasAdapterFailsClosedWhenAliasResolvesElsewhere(t *testing.T) {
	store := newRepairStoreFake()
	store.activeAliasCustomer = "bcu_other"
	production := &Production{Store: store}

	result, err := production.AttachProvenAlias(context.Background(), RepairCommand{ProgramID: "program", References: []string{"entry"}})
	if !errors.Is(err, billingmigration.ErrRollbackPrerequisite) {
		t.Fatalf("alias conflict error = %v", err)
	}
	if result.ErrorCode != "alias_resolves_elsewhere" || store.aliasInsertions != 0 {
		t.Fatalf("alias conflict result=%#v insertions=%d", result, store.aliasInsertions)
	}
}

func TestProductionMappingAdapterSucceedsOnlyWhenBoundMappingDiffers(t *testing.T) {
	store := newRepairStoreFake()
	production := &Production{Store: store}

	result, err := production.ReplaceMappingSetAndInvalidate(context.Background(), RepairCommand{ProgramID: "program", References: []string{"mapping"}})
	if err != nil {
		t.Fatalf("mapping repair: %v", err)
	}
	if string(result.BeforeDigest) == string(result.AfterDigest) {
		t.Fatalf("mapping replacement should report changed digest: %#v", result)
	}
}

func TestProductionMappingAdapterNoChangeWhenBoundMappingMatches(t *testing.T) {
	store := newRepairStoreFake()
	store.mapping.BeforeDigest = append([]byte(nil), store.mapping.AfterDigest...)
	production := &Production{Store: store}

	result, err := production.ReplaceMappingSetAndInvalidate(context.Background(), RepairCommand{ProgramID: "program", References: []string{"mapping"}})
	if err != nil {
		t.Fatalf("mapping no-change repair: %v", err)
	}
	if string(result.BeforeDigest) != string(result.AfterDigest) {
		t.Fatalf("mapping no-change result = %#v", result)
	}
}

func TestProductionSourceRetryDispatchesOnlyQuarantinedSourceRecord(t *testing.T) {
	store := newRepairStoreFake()
	provider := &providerImporterFake{result: billingmigration.ProviderEvidenceResult{Quarantined: 1, EvidenceDigest: digestOf(6)}}
	production := &Production{Store: store, Provider: provider}

	result, err := production.RetryQuarantinedRecord(context.Background(), RepairCommand{ProgramID: "program", References: []string{"source-record"}})
	if err != nil {
		t.Fatalf("source retry: %v", err)
	}
	if store.quarantineLookups != 1 || provider.calls != 1 {
		t.Fatalf("quarantine lookups=%d provider calls=%d", store.quarantineLookups, provider.calls)
	}
	if string(result.AfterDigest) != string(digestOf(6)) {
		t.Fatalf("source retry result = %#v", result)
	}
}

func TestProductionSourceRetryRejectsUnquarantinedSourceRecord(t *testing.T) {
	store := newRepairStoreFake()
	store.quarantineErr = billingmigration.ErrRollbackPrerequisite
	provider := &providerImporterFake{result: billingmigration.ProviderEvidenceResult{Quarantined: 1, EvidenceDigest: digestOf(6)}}
	production := &Production{Store: store, Provider: provider}

	_, err := production.RetryQuarantinedRecord(context.Background(), RepairCommand{ProgramID: "program", References: []string{"source-record"}})
	if !errors.Is(err, billingmigration.ErrRollbackPrerequisite) {
		t.Fatalf("source retry error = %v", err)
	}
	if store.quarantineLookups != 1 || provider.calls != 0 {
		t.Fatalf("quarantine lookups=%d provider calls=%d", store.quarantineLookups, provider.calls)
	}
}

func TestProductionSourceRetryReportsPendingTerminalValidation(t *testing.T) {
	store := newRepairStoreFake()
	provider := &providerImporterFake{result: billingmigration.ProviderEvidenceResult{Accepted: 1, EvidenceDigest: digestOf(6)}, err: billingmigration.ErrValidationPending}
	production := &Production{Store: store, Provider: provider}

	result, err := production.RetryQuarantinedRecord(context.Background(), RepairCommand{ProgramID: "program", References: []string{"source-record"}})
	if !errors.Is(err, billingmigration.ErrValidationPending) {
		t.Fatalf("source retry pending error = %v", err)
	}
	if result.ErrorCode != "source_record_validation_pending" || string(result.BeforeDigest) != string(result.AfterDigest) {
		t.Fatalf("source retry pending result = %#v", result)
	}
}

type repairStoreFake struct {
	provider            ProviderReferenceEvidence
	mapping             MappingReplacementEvidence
	alias               ProvenAliasEvidence
	activeAliasCustomer string
	aliasReceipt        []byte
	aliasAttachAttempts int
	aliasInsertions     int
	quarantineLookups   int
	quarantineErr       error
}

func newRepairStoreFake() *repairStoreFake {
	return &repairStoreFake{
		provider: ProviderReferenceEvidence{
			ProjectID: "project",
			Reference: billingmigration.KnownProviderReference{
				Provider: billing.ProviderAppStore, EnvironmentID: "environment", ApplicationID: "application",
				Reference: "provider-reference", ReferenceKind: billing.ReferenceAppStoreTransactionID,
				SourceProductID: "source-product", TargetProductID: "product",
				ExpectedStoreProductID: "store.product", ExpectedStoreEnvironment: billing.StoreProduction,
			},
			Digest: digestOf(1),
		},
		mapping: MappingReplacementEvidence{
			ProjectID: "project", CurrentMappingID: "mapping", NextMappingID: "mapping",
			BeforeDigest: digestOf(2), AfterDigest: digestOf(3), AffectedCount: 2,
		},
		alias: ProvenAliasEvidence{
			ProjectID: "project", MappingEntryID: "entry", BillingCustomerID: "bcu_one",
			ApplicationUserID: "user-one", Digest: digestOf(4),
		},
	}
}

func (s *repairStoreFake) ProgramProject(context.Context, string) (string, error) {
	return "project", nil
}

func (s *repairStoreFake) ProviderReference(context.Context, string, string) (ProviderReferenceEvidence, error) {
	return s.provider, nil
}

func (s *repairStoreFake) QuarantinedSourceReference(context.Context, string, string) (ProviderReferenceEvidence, error) {
	s.quarantineLookups++
	if s.quarantineErr != nil {
		return ProviderReferenceEvidence{}, s.quarantineErr
	}
	return s.provider, nil
}

func (s *repairStoreFake) MappingReplacement(context.Context, string, string) (MappingReplacementEvidence, error) {
	return s.mapping, nil
}

func (s *repairStoreFake) ProvenAlias(context.Context, string, string) (ProvenAliasEvidence, error) {
	return s.alias, nil
}

func (s *repairStoreFake) ActiveApplicationAliasCustomer(context.Context, string, []byte) (string, error) {
	return s.activeAliasCustomer, nil
}

func (s *repairStoreFake) AttachApplicationAlias(_ context.Context, executionID string, evidence ProvenAliasEvidence, digest []byte) ([]byte, error) {
	s.aliasAttachAttempts++
	if s.activeAliasCustomer != "" {
		return nil, billingmigration.ErrConflict
	}
	receipt := hashStrings("fake-alias-receipt", executionID, evidence.MappingEntryID, string(digest))
	if s.aliasReceipt == nil {
		s.aliasInsertions++
		s.aliasReceipt = receipt
	}
	return append([]byte(nil), s.aliasReceipt...), nil
}

type providerImporterFake struct {
	calls  int
	refs   []billingmigration.KnownProviderReference
	result billingmigration.ProviderEvidenceResult
	err    error
}

func (p *providerImporterFake) RevalidateKnownReferences(_ context.Context, _ string, _ string, refs []billingmigration.KnownProviderReference) (billingmigration.ProviderEvidenceResult, error) {
	p.calls++
	p.refs = append([]billingmigration.KnownProviderReference(nil), refs...)
	return p.result, p.err
}

type projectionFake struct {
	calls   int
	scope   billingprojection.ReplayScope
	results []billingprojection.ReplayResult
	err     error
}

func (p *projectionFake) RunReplay(_ context.Context, _ billingprojection.ReplayScopeKeys, _ billingprojection.Replay, scope billingprojection.ReplayScope, _ int) ([]billingprojection.ReplayResult, error) {
	p.calls++
	p.scope = scope
	return p.results, p.err
}

type replayKeysFake struct{}

func (replayKeysFake) ScopesForReplay(context.Context, billingprojection.ReplayScope, int) ([]billingprojection.Scope, error) {
	return nil, nil
}
