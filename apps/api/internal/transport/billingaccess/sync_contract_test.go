package billingaccesshttp_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	billingaccesshttp "github.com/Mujhtech/mosaic/apps/api/internal/transport/billingaccess"
)

// The negotiated (POST) sync must never answer a bare 304.
//
// The risk is a cross-platform one rather than an HTTP one. A 304 carries no
// body, so the only place freshness could travel is the `Mosaic-…` response
// headers — and no frozen schema defines those names. Three SDKs each reading
// freshness out of undocumented headers is freshness the Authoritative
// Entitlement Contract cannot guarantee; the first platform to mistype one
// silently expires a paying customer's cache while the device is demonstrably
// in contact with the server.
//
// The canonical `snapshotUnchanged` record carries refreshAfter, validUntil,
// and staleGraceSeconds inside the schema every SDK already validates, so the
// negotiated form always answers 200 with it. The GET form is not conditional
// at all (defect D-5): it has no way to state a snapshot version, so it always
// answers 200 with the full snapshot.

const (
	testCustomerID = "bcu_sync_test"
	testProjectID  = "proj_sync_test"
	testEnvID      = "env_sync_test"
	testToken      = "mcat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	testSDKKey     = "pk_sync.test"
	testVersion    = int64(7)
)

// stubRepository serves one committed snapshot. Only the methods the sync path
// reaches do anything; the rest satisfy the port.
type stubRepository struct{}

func (stubRepository) BillingEnabled(context.Context, string) (bool, error) { return true, nil }

func (stubRepository) CurrentSnapshot(_ context.Context, projectID, environmentID, customerID string) (billingaccess.SnapshotView, error) {
	at := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	return billingaccess.SnapshotView{
		SnapshotID: "ces_sync_test", ProjectID: projectID, EnvironmentID: environmentID,
		CustomerID: customerID, SnapshotVersion: testVersion, RuleVersion: 1,
		ComputedAt: at, AsOf: at, ChangeReason: "projection",
		Projection: billingaccess.ProjectionStatus{
			State: billingaccess.ProjectionCurrent, LastProjectedAt: at,
		},
	}, nil
}

func (stubRepository) ProjectionStatusFor(context.Context, string, string, string) (billingaccess.ProjectionStatus, error) {
	return billingaccess.ProjectionStatus{
		State:           billingaccess.ProjectionCurrent,
		LastProjectedAt: time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC),
	}, nil
}

func (stubRepository) TokenByDigest(context.Context, []byte) (billingaccess.Token, error) {
	issued := time.Now().UTC().Add(-time.Minute)
	return billingaccess.Token{
		ID: "cat_sync_test", ProjectID: testProjectID, EnvironmentID: testEnvID,
		CustomerID: testCustomerID, Audience: billingaccess.AudienceSDKSync,
		Scopes:    []string{billingaccess.ScopeEntitlementsRead, billingaccess.ScopeEntitlementsSync},
		IssuedAt:  issued,
		ExpiresAt: issued.Add(time.Hour),
	}, nil
}

func (stubRepository) TouchToken(context.Context, string, time.Time) error { return nil }

func (stubRepository) CreateToken(_ context.Context, token billingaccess.Token, _ []byte, _ string) (billingaccess.Token, error) {
	return token, nil
}

func (stubRepository) RevokeToken(context.Context, billingaccess.KeyScope, string, string, string, time.Time) (billingaccess.Token, error) {
	return billingaccess.Token{}, nil
}
func (stubRepository) ListTokens(context.Context, billingaccess.KeyScope, string, int) ([]billingaccess.Token, error) {
	return nil, nil
}
func (stubRepository) Customer(context.Context, string, string) (billingaccess.CustomerView, error) {
	return billingaccess.CustomerView{}, nil
}
func (stubRepository) Subscriptions(context.Context, string, string, string, int, string) ([]billingaccess.SubscriptionView, string, error) {
	return nil, "", nil
}
func (stubRepository) Subscription(context.Context, string, string) (billingaccess.SubscriptionView, error) {
	return billingaccess.SubscriptionView{}, nil
}
func (stubRepository) Timeline(context.Context, string, string, int, string) ([]billingaccess.TimelineEntry, string, error) {
	return nil, "", nil
}
func (stubRepository) RecordAudit(context.Context, string, string, string, string, string, string, map[string]string, time.Time) error {
	return nil
}

type stubKeys struct{}

func (stubKeys) AuthenticateServerKey(context.Context, string) (billingaccess.KeyScope, error) {
	return billingaccess.KeyScope{}, billingaccess.ErrUnauthenticated
}

func (stubKeys) AuthenticateSDKKey(_ context.Context, raw string) (billingaccess.KeyScope, error) {
	if strings.TrimSpace(raw) != testSDKKey {
		return billingaccess.KeyScope{}, billingaccess.ErrUnauthenticated
	}
	return billingaccess.KeyScope{ProjectID: testProjectID, EnvironmentID: testEnvID}, nil
}

func syncRouter() http.Handler {
	service := billingaccess.NewService(stubRepository{}, stubKeys{})
	router := chi.NewRouter()
	billingaccesshttp.RegisterSDKRoutes(router, service)
	return router
}

// entityTag reads the validator off a full snapshot response, so the
// conditional cases present a tag the server actually issued rather than a
// guess.
func entityTag(t *testing.T, handler http.Handler) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/sdk/billing/entitlements", nil)
	request.Header.Set("Authorization", "Bearer "+testToken)
	request.Header.Set(billingaccesshttp.SDKKeyHeader, testSDKKey)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("priming read: status %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	return strings.Trim(recorder.Header().Get("ETag"), `"`)
}

func syncBody(version int64, tag string) string {
	payload := map[string]any{
		"authoritativeEntitlementContractVersion": billingaccess.ContractVersion,
		"recordType": "entitlementSyncRequest",
		"payload": map[string]any{
			"knownSnapshotVersion": version,
			"entityTag":            tag,
			"supportedAuthoritativeEntitlementContracts": []string{billingaccess.ContractVersion},
			"correlationId": "corr_sync_test",
		},
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func TestNegotiatedSyncAnswersUnchangedRecordRatherThanBare304(t *testing.T) {
	handler := syncRouter()
	tag := entityTag(t, handler)

	// The hostile case: a matching version *and* an If-None-Match header, which
	// is exactly what made the old handler take the 304 branch on POST.
	request := httptest.NewRequest(http.MethodPost, "/sdk/billing/entitlements",
		strings.NewReader(syncBody(testVersion, tag)))
	request.Header.Set("Authorization", "Bearer "+testToken)
	request.Header.Set(billingaccesshttp.SDKKeyHeader, testSDKKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("If-None-Match", `"`+tag+`"`)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("negotiated sync with a matching version: status %d, want 200 (never a bare 304)", recorder.Code)
	}

	var envelope struct {
		ContractVersion string `json:"authoritativeEntitlementContractVersion"`
		RecordType      string `json:"recordType"`
		Payload         struct {
			SnapshotVersion   int64  `json:"snapshotVersion"`
			RefreshAfter      string `json:"refreshAfter"`
			ValidUntil        string `json:"validUntil"`
			StaleGraceSeconds *int   `json:"staleGraceSeconds"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode unchanged record: %v (%s)", err, recorder.Body.String())
	}
	if envelope.RecordType != "snapshotUnchanged" {
		t.Fatalf("recordType %q, want snapshotUnchanged", envelope.RecordType)
	}
	if envelope.ContractVersion != billingaccess.ContractVersion {
		t.Fatalf("contract version %q, want %q", envelope.ContractVersion, billingaccess.ContractVersion)
	}
	if envelope.Payload.SnapshotVersion != testVersion {
		t.Fatalf("snapshotVersion %d, want %d", envelope.Payload.SnapshotVersion, testVersion)
	}

	// The whole reason the negotiated form does not use 304: the freshness
	// window has to be in the body, under the frozen schema, not only in
	// headers no contract defines.
	if envelope.Payload.RefreshAfter == "" || envelope.Payload.ValidUntil == "" ||
		envelope.Payload.StaleGraceSeconds == nil {
		t.Fatalf("unchanged record must carry refreshed freshness windows: %s", recorder.Body.String())
	}
	refreshAfter, err := time.Parse(time.RFC3339, envelope.Payload.RefreshAfter)
	if err != nil {
		t.Fatalf("parse refreshAfter: %v", err)
	}
	validUntil, err := time.Parse(time.RFC3339, envelope.Payload.ValidUntil)
	if err != nil {
		t.Fatalf("parse validUntil: %v", err)
	}
	// Refreshed, not echoed back from whatever the caller last held: both
	// windows are ahead of now, which is what makes a device that keeps
	// confirming the same version stay valid.
	now := time.Now().UTC()
	if !refreshAfter.After(now) || !validUntil.After(refreshAfter) {
		t.Fatalf("freshness not refreshed: refreshAfter=%s validUntil=%s now=%s",
			refreshAfter, validUntil, now)
	}
}

// The GET form is a plain full-snapshot read (defect D-5, ratified).
//
// There is one conditional mechanism on this surface and it is the POST body's
// `knownSnapshotVersion`. The GET form has no way to state a version, and
// version equality is a precondition of `unchanged` because a matching entity
// tag alone would confirm a cache without proving monotonicity — so the
// handler's old 304 branch was unreachable on every request that could ever
// have taken it. The branch is gone; this test pins what replaced it: a 200
// with the full snapshot and the freshness headers, whatever the caller sends
// in If-None-Match.
//
// The If-None-Match header is still sent here deliberately. It is the header an
// ordinary HTTP client sends without being asked, and the risk this test
// protects against is a future edit reintroducing a bodyless answer to it on
// the highest-QPS authenticated surface Mosaic serves.
func TestConditionalGetAnswersFullSnapshotWithFreshnessHeaders(t *testing.T) {
	handler := syncRouter()
	tag := entityTag(t, handler)

	request := httptest.NewRequest(http.MethodGet, "/sdk/billing/entitlements", nil)
	request.Header.Set("Authorization", "Bearer "+testToken)
	request.Header.Set(billingaccesshttp.SDKKeyHeader, testSDKKey)
	request.Header.Set("If-None-Match", `"`+tag+`"`)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("GET with If-None-Match: status %d, want 200 (%s)", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		RecordType string `json:"recordType"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if envelope.RecordType != "customerEntitlementSnapshot" {
		t.Fatalf("recordType %q, want customerEntitlementSnapshot", envelope.RecordType)
	}
	for _, header := range []string{"ETag", "Mosaic-Refresh-After", "Mosaic-Valid-Until", "Mosaic-Stale-Grace-Seconds"} {
		if recorder.Header().Get(header) == "" {
			t.Fatalf("GET is missing %s; the freshness window must be visible without parsing the body", header)
		}
	}
}
