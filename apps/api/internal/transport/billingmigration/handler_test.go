package billingmigrationhttp

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/Mujhtech/mosaic/apps/api/internal/platform/authn"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

type handlerRepository struct {
	detail billingmigration.ProgramDetail
}

func (*handlerRepository) Authorize(context.Context, billingmigration.Actor, string, string) (billingmigration.Authorization, error) {
	return billingmigration.Authorization{OrganizationID: "org_one", Role: "owner"}, nil
}
func (*handlerRepository) AllowedCapabilities(context.Context, billingmigration.Actor, string) ([]string, error) {
	return []string{billingmigration.CapabilityView, billingmigration.CapabilityManageSource}, nil
}
func (*handlerRepository) Idempotency(context.Context, string, string) (billingmigration.StoredIdempotency, error) {
	return billingmigration.StoredIdempotency{}, billingmigration.ErrNotFound
}
func (repository *handlerRepository) CreateProgram(_ context.Context, command billingmigration.CreateProgramCommand) (billingmigration.ProgramDetail, error) {
	repository.detail = billingmigration.ProgramDetail{Program: command.Program, SourceCapabilityAssessment: &command.Assessment}
	return repository.detail, nil
}
func (*handlerRepository) ListPrograms(context.Context, string, int) ([]billingmigration.ProgramDetail, error) {
	return nil, nil
}
func (repository *handlerRepository) Program(context.Context, string, string) (billingmigration.ProgramDetail, error) {
	return repository.detail, nil
}

type handlerCipher struct{}

func (handlerCipher) EncryptSubject(_ []byte, scope providercredential.SubjectScope) (providercredential.Envelope, error) {
	return providercredential.Envelope{Version: 1, Algorithm: "AES-256-GCM", KeyID: "key",
		Nonce: make([]byte, 12), Ciphertext: make([]byte, 16), Fingerprint: make([]byte, 32),
		CredentialClass: scope.CredentialClass}, nil
}
func (handlerCipher) DecryptSubject(providercredential.Envelope, providercredential.SubjectScope) ([]byte, error) {
	return nil, errors.New("unused")
}
func (handlerCipher) ActiveKeyID() string { return "key" }

type handlerAssessor struct{}

func (handlerAssessor) AssessMigration(context.Context, string, []byte) (billingmigration.CapabilityResult, error) {
	return billingmigration.CapabilityResult{ProviderAPIVersion: "v2", Capabilities: []string{"read_customers"}, AssessedAt: time.Now().UTC()}, nil
}

func TestCreateProgramReturnsStrictRecordWithoutCredential(t *testing.T) {
	service := billingmigration.NewService(&handlerRepository{}, handlerCipher{}, handlerAssessor{}, billingmigration.WithRandom(zeroReader{}))
	router := chi.NewRouter()
	router.Use(authn.Middleware(authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		return authn.Principal{ActorID: "owner_one", Method: "test"}, nil
	})))
	router.Route("/v1/projects/{projectId}", func(project chi.Router) { RegisterProjectRoutes(project, Services{Program: service}) })
	body := `{"environmentId":"environment_one","applications":[{"applicationId":"app_one","platform":"ios"}],"revenueCatProjectId":"rc_project","revenueCatApiKey":"migration-secret"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/projects/project_one/billing/migration-programs/", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "create-one")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	responseBody := recorder.Body.String()
	if strings.Contains(responseBody, "migration-secret") || strings.Contains(responseBody, "rc_project") {
		t.Fatalf("response exposed migration source secret metadata: %s", responseBody)
	}
	if !strings.Contains(responseBody, `"billingMigrationOperationsContractVersion":"1"`) ||
		!strings.Contains(responseBody, `"recordType":"migrationProgram"`) {
		t.Fatalf("response is not a strict migrationProgram record: %s", responseBody)
	}
	if !strings.Contains(responseBody, `"sourceCapabilityAssessment"`) || !strings.Contains(responseBody, `"read_customers"`) || !strings.Contains(responseBody, `"operatorCapabilities":["view","manage-source"]`) {
		t.Fatalf("response discarded source capability assessment: %s", responseBody)
	}
}

func TestManifestAppendIsNotExposedToUnverifiedOperatorObjects(t *testing.T) {
	service := billingmigration.NewService(&handlerRepository{}, handlerCipher{}, handlerAssessor{})
	router := chi.NewRouter()
	router.Use(authn.Middleware(authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
		return authn.Principal{ActorID: "owner_one", Method: "test"}, nil
	})))
	router.Route("/v1/projects/{projectId}", func(project chi.Router) { RegisterProjectRoutes(project, Services{Program: service}) })
	request := httptest.NewRequest(http.MethodPost,
		"/v1/projects/project_one/billing/migration-programs/program_one/manifests",
		strings.NewReader(`{"objectKey":"foreign-project/object","objectChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("unverified manifest append status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestRunRequestAcceptsOnlyFrozenDigestEncoding(t *testing.T) {
	valid := "sha256:" + strings.Repeat("a", 64)
	if err := (runRequest{ExpectedStateVersion: 1, ManifestDigest: valid, MappingDigest: valid}).Validate(); err != nil {
		t.Fatalf("valid frozen digest rejected: %v", err)
	}
	for _, invalid := range []string{strings.Repeat("a", 64), "sha256:" + strings.Repeat("A", 64)} {
		if err := (runRequest{ExpectedStateVersion: 1, ManifestDigest: invalid, MappingDigest: valid}).Validate(); err == nil {
			t.Fatalf("invalid digest accepted: %q", invalid)
		}
	}
}

func TestMappingRequestLargerThanLegacySixteenKiBIsAccepted(t *testing.T) {
	var body strings.Builder
	body.WriteString(`{"expectedStateVersion":1,"version":1,"entries":[`)
	for index := 0; index < 100; index++ {
		if index > 0 {
			body.WriteByte(',')
		}
		body.WriteString(`{"sourceKind":"customer_id","sourceIdentifier":"`)
		body.WriteString(strings.Repeat("a", 256))
		body.WriteString(`","targetId":"customer_one","matchKind":"exact"}`)
	}
	body.WriteString(`]}`)
	if body.Len() <= 16<<10 {
		t.Fatalf("fixture no longer exercises legacy limit: %d bytes", body.Len())
	}

	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body.String()))
	recorder := httptest.NewRecorder()
	var decoded mappingSetRequest
	if !decode(recorder, request, &decoded) {
		t.Fatalf("bounded mapping request rejected: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if len(decoded.Entries) != 100 {
		t.Fatalf("decoded entries=%d", len(decoded.Entries))
	}
}

func TestSourcePullRequiresIdempotencyKeyBeforeDispatch(t *testing.T) {
	router := chi.NewRouter()
	router.Route("/v1/projects/{projectId}", func(project chi.Router) {
		RegisterProjectRoutes(project, Services{Program: billingmigration.NewService(&handlerRepository{}, handlerCipher{}, handlerAssessor{})})
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/projects/project_one/billing/migration-programs/program_one/source-pulls", strings.NewReader(`{"intent":"snapshot","expectedStateVersion":1}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled source-pull status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	// Once the runtime seam exists, the transport rejects a missing key before
	// it can enqueue work. A nil repository is safe because dispatch must not occur.
	router = chi.NewRouter()
	router.Route("/v1/projects/{projectId}", func(project chi.Router) {
		RegisterProjectRoutes(project, Services{Program: billingmigration.NewService(&handlerRepository{}, handlerCipher{}, handlerAssessor{}), SourcePull: billingmigration.NewSourcePullService(nil, nil)})
	})
	request = httptest.NewRequest(http.MethodPost, "/v1/projects/project_one/billing/migration-programs/program_one/source-pulls", strings.NewReader(`{"intent":"snapshot","expectedStateVersion":1}`))
	request.Header.Set("Content-Type", "application/json")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "Idempotency-Key") {
		t.Fatalf("missing idempotency status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestRepairExecutionFailsClosedWhenExecutorIsOffline(t *testing.T) {
	handler := &Handler{services: Services{RepairOnline: false}}
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`))
	recorder := httptest.NewRecorder()
	handler.executeRepair(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), "migration_dependency_unavailable") {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

type pendingRepairRepository struct {
	billingmigration.OperationsRepository
	state string
}

func (repository pendingRepairRepository) PrepareRepair(context.Context, billingmigration.RepairExecutionWrite) (billingmigration.PreparedRepair, error) {
	return billingmigration.PreparedRepair{ExecutionID: "mre_pending", RepairKind: billingmigration.RepairRevalidateProviderReference, CaseID: "case_one", AttemptNumber: 1, PreviewBeforeDigest: bytes.Repeat([]byte{1}, 32), State: repository.state}, nil
}

type pendingRepairExecutor struct{}

func (pendingRepairExecutor) Preview(context.Context, billingmigration.RepairRequest) (billingmigration.RepairImpact, error) {
	return billingmigration.RepairImpact{}, errors.New("unused")
}
func (pendingRepairExecutor) Execute(context.Context, billingmigration.RepairRequest) (billingmigration.RepairResult, error) {
	return billingmigration.RepairResult{}, billingmigration.ErrValidationPending
}

func TestRepairExecutionPendingNewAndReplayReturnAccepted(t *testing.T) {
	digest := "sha256:" + strings.Repeat("a", 64)
	for _, state := range []string{billingmigration.RepairPreparationNew, billingmigration.RepairPreparationUnsettled} {
		service := billingmigration.NewOperationsService(&handlerRepository{}, pendingRepairRepository{state: state}, pendingRepairExecutor{})
		router := chi.NewRouter()
		router.Use(authn.Middleware(authn.ResolverFunc(func(*http.Request) (authn.Principal, error) {
			return authn.Principal{ActorID: "owner_one", Method: "test"}, nil
		})))
		router.Route("/v1/projects/{projectId}", func(project chi.Router) {
			RegisterProjectRoutes(project, Services{Operations: service, RepairOnline: true})
		})
		body := `{"previewId":"preview_one","expectedStateVersion":1,"expectedPreviewDigest":"` + digest + `","expectedCaseDigest":"` + digest + `","expectedPolicyDigest":"` + digest + `","expectedScopeDigest":"` + digest + `"}`
		request := httptest.NewRequest(http.MethodPost, "/v1/projects/project_one/billing/migration-programs/program_one/repair-executions", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", "repair-one")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusAccepted || !strings.Contains(recorder.Body.String(), `"executionStatus":"pending"`) || strings.Contains(recorder.Body.String(), `"afterDigest"`) || strings.Contains(recorder.Body.String(), `"resultDigest"`) {
			t.Fatalf("state=%s status=%d body=%s", state, recorder.Code, recorder.Body.String())
		}
	}
}

func TestStabilizationObservationRejectsCallerSuppliedMetrics(t *testing.T) {
	handler := &Handler{services: Services{Stabilization: billingmigration.NewStabilizationService(&handlerRepository{}, nil)}}
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"expectedStateVersion":2,"expectedAuthorityEpoch":3,"expectedPolicyDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","healthy":true}`))
	request.Header.Set("Idempotency-Key", "observe-one")
	recorder := httptest.NewRecorder()
	handler.observeStabilization(recorder, request)
	if recorder.Code != http.StatusUnprocessableEntity || !strings.Contains(recorder.Body.String(), "validation_failed") {
		t.Fatalf("caller-supplied stabilization metric status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestOperationalErrorAndReplayResponseSemantics(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	recorder := httptest.NewRecorder()
	writeError(recorder, request, billingmigration.ErrForbidden)
	if recorder.Code != http.StatusForbidden || !strings.Contains(recorder.Body.String(), "migration_capability_denied") {
		t.Fatalf("forbidden status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	replayResponse(recorder, request, "sourcePullJob", map[string]string{"id": "job"}, true, true)
	if recorder.Code != http.StatusOK {
		t.Fatalf("idempotent replay status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	replayResponse(recorder, request, "sourcePullJob", map[string]string{"id": "job"}, false, true)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("new async command status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

type zeroReader struct{}

func (zeroReader) Read(buffer []byte) (int, error) {
	for index := range buffer {
		buffer[index] = 0
	}
	return len(buffer), nil
}
