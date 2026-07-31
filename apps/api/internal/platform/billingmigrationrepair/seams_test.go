package billingmigrationrepair

import (
	"context"
	"errors"
	"testing"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
)

type providerStub struct {
	calls   int
	command RepairCommand
	result  billingmigration.RepairResult
	err     error
}

func (s *providerStub) RevalidateProviderReference(_ context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	s.calls++
	s.command = command
	if s.result.BeforeDigest != nil || s.result.AfterDigest != nil || s.err != nil {
		return s.result, s.err
	}
	return successfulResult(), nil
}

type factStub struct {
	calls   int
	command RepairCommand
}

func (s *factStub) ReplayImmutableFactRange(_ context.Context, command RepairCommand) (billingmigration.RepairResult, error) {
	s.calls++
	s.command = command
	return successfulResult(), nil
}

type previewStub struct {
	calls  int
	impact billingmigration.RepairImpact
}

func (s *previewStub) PreviewRepair(_ context.Context, _ billingmigration.RepairRequest) (billingmigration.RepairImpact, error) {
	s.calls++
	if s.impact.BeforeDigest != nil || s.impact.AfterDigest != nil {
		return s.impact, nil
	}
	return billingmigration.RepairImpact{AffectedCount: 1, BeforeDigest: digestOf(0), AfterDigest: digestOf(1)}, nil
}

func TestExecutorExposesOnlyAllowlistedTypedSeams(t *testing.T) {
	provider := &providerStub{}
	executor := Executor{Provider: provider}

	_, err := executor.Execute(context.Background(), repairRequest(billingmigration.RepairRevalidateProviderReference, "reference"))
	if err != nil {
		t.Fatalf("execute allowlisted repair: %v", err)
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.calls)
	}
	if provider.command.ExecutionID != "mre_stable" || provider.command.ProgramID != "program" || provider.command.CaseID != "case" {
		t.Fatalf("provider command = %#v", provider.command)
	}
	if got := provider.command.References; len(got) != 1 || got[0] != "reference" {
		t.Fatalf("provider references = %#v", got)
	}

	_, err = executor.Execute(context.Background(), repairRequest("arbitrary_sql", "UPDATE facts"))
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("arbitrary repair error = %v, want invalid", err)
	}
}

func TestExecutorRejectsUnboundedSingleReferenceRepairs(t *testing.T) {
	executor := Executor{Provider: &providerStub{}}

	_, err := executor.Execute(context.Background(), repairRequest(billingmigration.RepairRevalidateProviderReference, "one", "two"))
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("multi-reference provider repair error = %v, want invalid", err)
	}
}

func TestExecutorRequiresImmutableCaseContext(t *testing.T) {
	provider := &providerStub{}
	request := repairRequest(billingmigration.RepairRevalidateProviderReference, "reference")
	request.CaseID = ""

	_, err := (Executor{Provider: provider}).Execute(context.Background(), request)
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("missing case context error = %v, want invalid", err)
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls = %d, want 0", provider.calls)
	}
}

func TestExecutorRejectsAmbiguousRepairScopeReferences(t *testing.T) {
	executor := Executor{Facts: &factStub{}}
	for name, refs := range map[string][]string{
		"empty":     {""},
		"control":   {"fact\n1"},
		"duplicate": {"fact-1", "fact-1"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := executor.Execute(context.Background(), repairRequest(billingmigration.RepairReplayFactRange, refs...))
			if !errors.Is(err, billingmigration.ErrInvalid) {
				t.Fatalf("scope error = %v, want invalid", err)
			}
		})
	}
}

func TestExecutorAllowsBoundedFactRangeReplay(t *testing.T) {
	facts := &factStub{}
	executor := Executor{Facts: facts}

	_, err := executor.Execute(context.Background(), repairRequest(billingmigration.RepairReplayFactRange, "fact-1", "fact-2"))
	if err != nil {
		t.Fatalf("fact replay: %v", err)
	}
	if facts.calls != 1 {
		t.Fatalf("fact calls = %d, want 1", facts.calls)
	}
	if got := facts.command.References; len(got) != 2 || got[0] != "fact-1" || got[1] != "fact-2" {
		t.Fatalf("fact references = %#v", got)
	}
}

func TestExecutorRejectsOversizedFactRangeReplay(t *testing.T) {
	refs := make([]string, maxRepairScopeReferences+1)
	for i := range refs {
		refs[i] = "fact-" + string(rune('a'+i%26)) + string(rune('A'+i/26))
	}

	_, err := (Executor{Facts: &factStub{}}).Execute(context.Background(), repairRequest(billingmigration.RepairReplayFactRange, refs...))
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("oversized fact range error = %v, want invalid", err)
	}
}

func TestExecutorRejectsInvalidSuccessfulResultDigests(t *testing.T) {
	provider := &providerStub{result: billingmigration.RepairResult{BeforeDigest: digestOf(0), AfterDigest: []byte("short")}}

	_, err := (Executor{Provider: provider}).Execute(context.Background(), repairRequest(billingmigration.RepairRevalidateProviderReference, "reference"))
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("invalid result digest error = %v, want invalid", err)
	}
}

func TestExecutorRejectsInvalidSuccessfulResultInvalidations(t *testing.T) {
	provider := &providerStub{result: billingmigration.RepairResult{
		BeforeDigest: digestOf(0),
		AfterDigest:  digestOf(1),
		Invalidations: []billingmigration.RepairInvalidation{{
			Kind:        "mapping_set",
			ReferenceID: "mapping",
			Digest:      []byte("short"),
		}},
	}}

	_, err := (Executor{Provider: provider}).Execute(context.Background(), repairRequest(billingmigration.RepairRevalidateProviderReference, "reference"))
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("invalid invalidation digest error = %v, want invalid", err)
	}
}

func TestExecutorValidatesPreviewBeforePreviewer(t *testing.T) {
	previewer := &previewStub{}
	request := repairRequest(billingmigration.RepairRevalidateProviderReference, "reference")
	request.ProgramID = ""

	_, err := (Executor{Previewer: previewer}).Preview(context.Background(), request)
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("invalid preview request error = %v, want invalid", err)
	}
	if previewer.calls != 0 {
		t.Fatalf("preview calls = %d, want 0", previewer.calls)
	}
}

func TestExecutorRejectsInvalidPreviewDigest(t *testing.T) {
	previewer := &previewStub{impact: billingmigration.RepairImpact{AffectedCount: 1, BeforeDigest: digestOf(0), AfterDigest: []byte("short")}}

	_, err := (Executor{Previewer: previewer}).Preview(context.Background(), repairRequest(billingmigration.RepairRevalidateProviderReference, "reference"))
	if !errors.Is(err, billingmigration.ErrInvalid) {
		t.Fatalf("invalid preview digest error = %v, want invalid", err)
	}
}

func repairRequest(kind string, references ...string) billingmigration.RepairRequest {
	return billingmigration.RepairRequest{
		Kind:            kind,
		ProgramID:       "program",
		CaseID:          "case",
		ExecutionID:     "mre_stable",
		ScopeReferences: references,
	}
}

func successfulResult() billingmigration.RepairResult {
	return billingmigration.RepairResult{BeforeDigest: digestOf(0), AfterDigest: digestOf(1)}
}

func digestOf(v byte) []byte {
	b := make([]byte, sha256DigestBytes)
	for i := range b {
		b[i] = v
	}
	return b
}
