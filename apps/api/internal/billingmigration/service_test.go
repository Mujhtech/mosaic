package billingmigration

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/dlclark/regexp2"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

type testRepository struct {
	command        CreateProgramCommand
	detail         ProgramDetail
	hasIdempotency bool
}

func (repository *testRepository) Authorize(context.Context, Actor, string, string) (Authorization, error) {
	return Authorization{OrganizationID: "org_one", Role: "owner"}, nil
}
func (repository *testRepository) AllowedCapabilities(context.Context, Actor, string) ([]string, error) {
	return []string{CapabilityView, CapabilityManageSource}, nil
}
func (repository *testRepository) Idempotency(context.Context, string, string) (StoredIdempotency, error) {
	if !repository.hasIdempotency {
		return StoredIdempotency{}, ErrNotFound
	}
	return StoredIdempotency{ProgramID: repository.detail.Program.ProgramID, RequestDigest: repository.command.RequestDigest}, nil
}
func (repository *testRepository) CreateProgram(_ context.Context, command CreateProgramCommand) (ProgramDetail, error) {
	repository.command = command
	repository.detail = ProgramDetail{Program: command.Program, SourceCapabilityAssessment: &command.Assessment}
	repository.hasIdempotency = true
	return repository.detail, nil
}
func (repository *testRepository) ListPrograms(context.Context, string, int) ([]ProgramDetail, error) {
	return nil, nil
}
func (repository *testRepository) Program(context.Context, string, string) (ProgramDetail, error) {
	return repository.detail, nil
}

type testCipher struct {
	scope providercredential.SubjectScope
	calls int
}

func (cipher *testCipher) EncryptSubject(_ []byte, scope providercredential.SubjectScope) (providercredential.Envelope, error) {
	cipher.calls++
	cipher.scope = scope
	return providercredential.Envelope{Version: 1, Algorithm: "AES-256-GCM", KeyID: "key_one",
		Nonce: make([]byte, 12), Ciphertext: make([]byte, 16), Fingerprint: make([]byte, 32),
		CredentialClass: scope.CredentialClass}, nil
}
func (*testCipher) DecryptSubject(providercredential.Envelope, providercredential.SubjectScope) ([]byte, error) {
	return nil, errors.New("unused")
}
func (*testCipher) ActiveKeyID() string { return "key_one" }

type testAssessor struct{ calls int }

func (assessor *testAssessor) AssessMigration(_ context.Context, projectID string, credential []byte) (CapabilityResult, error) {
	assessor.calls++
	if projectID != "rc_project" || string(credential) != "secret-value" {
		return CapabilityResult{}, ErrInvalid
	}
	return CapabilityResult{ProviderAPIVersion: "v2", Capabilities: []string{"read_customers"},
		AssessedAt: time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)}, nil
}

func TestCreateProgramSealsSeparateCredentialAndReplaysIdempotently(t *testing.T) {
	repository := &testRepository{}
	cipher := &testCipher{}
	assessor := &testAssessor{}
	service := NewService(repository, cipher, assessor,
		WithRandom(zeroReader{}), WithClock(func() time.Time { return time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC) }))
	input := CreateProgramInput{
		ProjectID: "project_one", EnvironmentID: "environment_one", ExternalProjectID: "rc_project",
		Credential: []byte("secret-value"), IdempotencyKey: "create-1",
		Applications: []ScopeItem{{ApplicationID: "app_b", Platform: "android"}, {ApplicationID: "app_a", Platform: "ios"}},
	}
	created, replayed, err := service.CreateProgram(context.Background(), Actor{ID: "actor_one"}, input)
	if err != nil {
		t.Fatal(err)
	}
	if replayed {
		t.Fatal("first command was reported as an idempotent replay")
	}
	if cipher.scope.SubjectKind != providercredential.SubjectBillingMigrationCredential {
		t.Fatalf("credential subject kind = %q", cipher.scope.SubjectKind)
	}
	if cipher.scope.SubjectID != created.Program.Source.CredentialReference {
		t.Fatal("credential envelope was not bound to the returned credential reference")
	}
	if got := created.Program.Scope.Applications[0].ApplicationID; got != "app_a" {
		t.Fatalf("scope was not canonicalized: first application = %q", got)
	}
	encoded, _ := json.Marshal(created)
	if string(encoded) == "" || contains(string(encoded), "secret-value") {
		t.Fatal("public program representation exposed the migration credential")
	}

	replayedProgram, replayed, err := service.CreateProgram(context.Background(), Actor{ID: "actor_one"}, input)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed || replayedProgram.Program.ProgramID != created.Program.ProgramID {
		t.Fatal("same idempotency key and request did not return the original program")
	}
	if assessor.calls != 1 || cipher.calls != 1 {
		t.Fatalf("idempotent replay repeated side effects: assessments=%d seals=%d", assessor.calls, cipher.calls)
	}
}

func TestAssessReadinessBlocksAnyCurrentAccessOrCriticalGap(t *testing.T) {
	ready, err := AssessReadiness("migration_one", 7, ReadinessInput{
		CurrentAccessMappingPercent: 100, CurrentAccessEvidencePercent: 100,
		FinalDeltaCompleted: true, WatermarksFresh: true, SupportedVersionsAuthorityAware: true,
	})
	if err != nil || !ready.Ready || ready.ReadinessDigest == "" {
		t.Fatalf("ready assessment = %#v err=%v", ready, err)
	}
	blocked, err := AssessReadiness("migration_one", 7, ReadinessInput{
		CurrentAccessMappingPercent: 100, CurrentAccessEvidencePercent: 100,
		Unresolved: Counts{Critical: 1}, FinalDeltaCompleted: true,
		WatermarksFresh: true, SupportedVersionsAuthorityAware: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if blocked.Ready {
		t.Fatal("critical divergence did not block readiness")
	}
	if blocked.ReadinessDigest == ready.ReadinessDigest {
		t.Fatal("readiness digest did not bind blocker state")
	}
}

func TestAuthoritativeReadinessBindsSourceWarningAndApplicationVersionGates(t *testing.T) {
	base, err := AssessReadiness("migration_one", 7, ReadinessInput{
		CurrentAccessMappingPercent:     100,
		CurrentAccessEvidencePercent:    100,
		FinalDeltaCompleted:             true,
		WatermarksFresh:                 true,
		SupportedVersionsAuthorityAware: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	applicationDigest := make([]byte, 32)
	for i := range applicationDigest {
		applicationDigest[i] = 0x71
	}
	blocked, err := AssessAuthoritativeReadiness("migration_one", 7, base, false, 0, FormatDigest(applicationDigest))
	if err != nil || blocked.Assessment.Ready {
		t.Fatalf("missing source capability gate = %#v err=%v", blocked, err)
	}
	ready, err := AssessAuthoritativeReadiness("migration_one", 7, base, true, 0, FormatDigest(applicationDigest))
	if err != nil || !ready.Assessment.Ready {
		t.Fatalf("authoritative readiness = %#v err=%v", ready, err)
	}
	if blocked.Assessment.ReadinessDigest == ready.Assessment.ReadinessDigest {
		t.Fatal("authoritative readiness digest did not bind the source capability gate")
	}
}

func TestCompletionTimingWaitsForRollbackAndUsesExactRetentionDeadline(t *testing.T) {
	completed := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	stabilization := completed.Add(-24 * time.Hour)
	rollback := completed
	deleteAt := completed.Add(30 * 24 * time.Hour)
	if err := ValidateCompletionTiming(completed, stabilization, rollback, rollback, false, &deleteAt); err != nil {
		t.Fatal(err)
	}
	tooEarly := rollback.Add(-time.Second)
	if err := ValidateCompletionTiming(completed, stabilization, rollback, tooEarly, false, &deleteAt); err != ErrInvalid {
		t.Fatalf("early removal error=%v", err)
	}
	if err := ValidateCompletionTiming(completed, completed.Add(time.Second), rollback, rollback, false, &deleteAt); err != ErrInvalid {
		t.Fatalf("completion before stabilization error=%v", err)
	}
	if err := ValidateCompletionTiming(completed, stabilization, completed.Add(time.Second), completed.Add(time.Second), false, &deleteAt); err != ErrInvalid {
		t.Fatalf("completion before rollback end error=%v", err)
	}
	wrongDelete := deleteAt.Add(time.Second)
	if err := ValidateCompletionTiming(completed, stabilization, rollback, rollback, false, &wrongDelete); err != ErrInvalid {
		t.Fatalf("wrong deletion deadline error=%v", err)
	}
}

func TestDigestCompatibilityUsesFrozenSHA256Encoding(t *testing.T) {
	value := FormatDigest(make([]byte, 32))
	if value != "sha256:0000000000000000000000000000000000000000000000000000000000000000" {
		t.Fatalf("digest = %q", value)
	}
	if _, err := ParseDigest(value); err != nil {
		t.Fatalf("parse emitted digest: %v", err)
	}
	for _, invalid := range []string{value[7:], "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "SHA256:" + value[7:]} {
		if _, err := ParseDigest(invalid); err != ErrInvalid {
			t.Fatalf("invalid digest %q error = %v", invalid, err)
		}
	}
}

func TestCreateMappingSetRejectsControlCharactersAndEmitsFrozenDigest(t *testing.T) {
	repository := &evidenceValidationRepository{}
	service := NewService(repository, nil, nil, WithRandom(zeroReader{}))
	input := CreateMappingSetInput{ProjectID: "project_one", ProgramID: "migration_one", ExpectedStateVersion: 1, Version: 1,
		Entries: []MappingEntry{{SourceKind: "customer_id", SourceIdentifier: "bad\nidentifier", TargetID: "customer_one", MatchKind: "exact"}}}
	if _, err := service.CreateMappingSet(context.Background(), Actor{ID: "owner_one"}, input); err != ErrInvalid {
		t.Fatalf("control-character source identifier error = %v", err)
	}
	input.Entries[0].SourceIdentifier = "$RCAnonymousID:opaque"
	mapping, err := service.CreateMappingSet(context.Background(), Actor{ID: "owner_one"}, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseDigest(mapping.MappingDigest); err != nil {
		t.Fatalf("mapping digest is not frozen sha256 form: %q", mapping.MappingDigest)
	}
}

func TestEmittedEvidenceRecordsMatchFrozenContract(t *testing.T) {
	schemaFile, err := os.Open("../../../../protocol/schema/billing-migration-operations/v1/contract.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	defer schemaFile.Close()
	var schemaDocument any
	if err := json.NewDecoder(schemaFile).Decode(&schemaDocument); err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(func(value string) (jsonschema.Regexp, error) {
		compiled, err := regexp2.Compile(value, regexp2.ECMAScript)
		return (*testECMARegexp)(compiled), err
	})
	if err := compiler.AddResource("billing-migration-v1", schemaDocument); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile("billing-migration-v1")
	if err != nil {
		t.Fatal(err)
	}
	records := []any{
		ContractRecord[MappingSet]{BillingMigrationOperationsContractVersion: ContractVersion, RecordType: "mappingSet", Payload: MappingSet{ProgramID: "migration_one", StateVersion: 1, MappingSetID: "mapping_one", Version: 1, Status: "draft", Entries: []MappingEntry{{SourceKind: "customer_id", SourceIdentifier: "$RCAnonymousID:opaque", TargetID: "customer_one", MatchKind: "exact"}}, MappingDigest: FormatDigest(make([]byte, 32))}},
		ContractRecord[ReadinessAssessment]{BillingMigrationOperationsContractVersion: ContractVersion, RecordType: "readinessAssessment", Payload: ReadinessAssessment{ProgramID: "migration_one", StateVersion: 4, Unresolved: Counts{}, ReadinessDigest: FormatDigest(make([]byte, 32))}},
	}
	for _, record := range records {
		encoded, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		var document any
		if err := json.Unmarshal(encoded, &document); err != nil {
			t.Fatal(err)
		}
		if err := schema.Validate(document); err != nil {
			t.Fatalf("record %s rejected by frozen schema: %v", encoded, err)
		}
	}
}

type testECMARegexp regexp2.Regexp

func (expression *testECMARegexp) MatchString(value string) bool {
	matched, err := (*regexp2.Regexp)(expression).MatchString(value)
	return err == nil && matched
}
func (expression *testECMARegexp) String() string { return (*regexp2.Regexp)(expression).String() }

type evidenceValidationRepository struct{ testRepository }

func (*evidenceValidationRepository) AppendManifest(context.Context, int64, ManifestWrite) error {
	return nil
}
func (*evidenceValidationRepository) ListManifests(context.Context, string, string, int) ([]SourceManifest, error) {
	return nil, nil
}
func (*evidenceValidationRepository) CreateMappingSet(context.Context, int64, MappingSetWrite) error {
	return nil
}
func (*evidenceValidationRepository) FreezeMappingSet(context.Context, string, string, string, int64, time.Time) error {
	return nil
}
func (*evidenceValidationRepository) ListMappingSets(context.Context, string, string, int) ([]MappingSet, error) {
	return nil, nil
}
func (*evidenceValidationRepository) CreateImportBatch(context.Context, int64, ImportBatchWrite) (bool, error) {
	return false, nil
}
func (*evidenceValidationRepository) ListImportBatches(context.Context, string, string, int) ([]ImportBatch, error) {
	return nil, nil
}
func (*evidenceValidationRepository) ImportBatch(context.Context, string, string, string) (ImportBatch, error) {
	return ImportBatch{}, nil
}
func (*evidenceValidationRepository) ImportBatchByIdempotency(context.Context, string, string, string) (ImportBatch, error) {
	return ImportBatch{}, nil
}
func (*evidenceValidationRepository) LeaseImportBatch(context.Context, string, time.Time, time.Time) (ImportBatch, bool, error) {
	return ImportBatch{}, false, nil
}
func (*evidenceValidationRepository) CompleteImportBatch(context.Context, string, string, string, string, int64, string, int, int, time.Time) error {
	return nil
}
func (*evidenceValidationRepository) QueueRun(context.Context, int64, RunJobWrite) (bool, error) {
	return false, nil
}
func (*evidenceValidationRepository) RunJob(context.Context, string, string, string) (RunJob, error) {
	return RunJob{}, nil
}
func (*evidenceValidationRepository) RunJobByIdempotency(context.Context, string, string, string) (RunJob, error) {
	return RunJob{}, nil
}
func (*evidenceValidationRepository) RecordRun(context.Context, int64, RunWrite) error { return nil }
func (*evidenceValidationRepository) ListDivergences(context.Context, string, string, int) ([]Divergence, error) {
	return nil, nil
}
func (*evidenceValidationRepository) ReadinessInput(context.Context, string, string) (ReadinessInput, error) {
	return ReadinessInput{}, nil
}
func (*evidenceValidationRepository) RecordReadiness(context.Context, int64, ReadinessWrite) error {
	return nil
}
func (*evidenceValidationRepository) LatestReadiness(context.Context, string, string) (ReadinessAssessment, error) {
	return ReadinessAssessment{}, nil
}

type zeroReader struct{}

func (zeroReader) Read(buffer []byte) (int, error) {
	for index := range buffer {
		buffer[index] = 0
	}
	return len(buffer), nil
}

func contains(value, fragment string) bool {
	for index := 0; index+len(fragment) <= len(value); index++ {
		if value[index:index+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
