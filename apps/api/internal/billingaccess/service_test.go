package billingaccess

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// These tests cover the properties whose failure is a security or correctness
// incident rather than a bug report: a token that reaches another tenant, a
// credential that outlives its revocation, a cached snapshot confirmed without
// proof it is still current, and billing being disabled reported as loss of
// access.

type fakeRepository struct {
	enabled   map[string]bool
	tokens    map[string]Token
	digests   map[string]string
	customers map[string]CustomerView
	snapshots map[string]SnapshotView
	touched   int
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		enabled:   map[string]bool{"proj_1": true, "proj_2": true},
		tokens:    map[string]Token{},
		digests:   map[string]string{},
		customers: map[string]CustomerView{"bcu_1": {ID: "bcu_1", ProjectID: "proj_1"}},
		snapshots: map[string]SnapshotView{},
	}
}

func (f *fakeRepository) BillingEnabled(_ context.Context, projectID string) (bool, error) {
	return f.enabled[projectID], nil
}

func (f *fakeRepository) CreateToken(_ context.Context, token Token, digest []byte, _ string) (Token, error) {
	f.tokens[token.ID] = token
	f.digests[string(digest)] = token.ID
	return token, nil
}

func (f *fakeRepository) TokenByDigest(_ context.Context, digest []byte) (Token, error) {
	id, ok := f.digests[string(digest)]
	if !ok {
		return Token{}, ErrUnauthenticated
	}
	return f.tokens[id], nil
}

func (f *fakeRepository) TouchToken(_ context.Context, _ string, _ time.Time) error {
	f.touched++
	return nil
}

func (f *fakeRepository) RevokeToken(_ context.Context, scope KeyScope, tokenID, reason, _ string, at time.Time) (Token, error) {
	token, ok := f.tokens[tokenID]
	if !ok || token.ProjectID != scope.ProjectID || token.EnvironmentID != scope.EnvironmentID {
		return Token{}, ErrNotFound
	}
	revoked := at
	token.RevokedAt, token.RevocationReason = &revoked, reason
	f.tokens[tokenID] = token
	return token, nil
}

func (f *fakeRepository) ListTokens(_ context.Context, _ KeyScope, _ string, _ int) ([]Token, error) {
	return nil, nil
}

func (f *fakeRepository) CurrentSnapshot(_ context.Context, _, environmentID, customerID string) (SnapshotView, error) {
	view, ok := f.snapshots[environmentID+"/"+customerID]
	if !ok {
		return SnapshotView{}, ErrNotFound
	}
	return view, nil
}

func (f *fakeRepository) ProjectionStatusFor(_ context.Context, _, _, _ string) (ProjectionStatus, error) {
	return ProjectionStatus{State: ProjectionCurrent, LastProjectedAt: instant("2026-07-28T11:59:58Z")}, nil
}

func (f *fakeRepository) Customer(_ context.Context, projectID, customerID string) (CustomerView, error) {
	view, ok := f.customers[customerID]
	if !ok || view.ProjectID != projectID {
		return CustomerView{}, ErrNotFound
	}
	return view, nil
}

func (f *fakeRepository) Subscriptions(context.Context, string, string, string, int, string) ([]SubscriptionView, string, error) {
	return nil, "", nil
}

func (f *fakeRepository) Subscription(context.Context, string, string) (SubscriptionView, error) {
	return SubscriptionView{}, ErrNotFound
}

func (f *fakeRepository) Timeline(context.Context, string, string, int, string) ([]TimelineEntry, string, error) {
	return nil, "", nil
}

func (f *fakeRepository) RecordAudit(context.Context, string, string, string, string, string, string, map[string]string, time.Time) error {
	return nil
}

type fakeKeys struct {
	server map[string]KeyScope
	sdk    map[string]KeyScope
}

func (f fakeKeys) AuthenticateServerKey(_ context.Context, raw string) (KeyScope, error) {
	scope, ok := f.server[raw]
	if !ok {
		return KeyScope{}, ErrUnauthenticated
	}
	return scope, nil
}

func (f fakeKeys) AuthenticateSDKKey(_ context.Context, raw string) (KeyScope, error) {
	scope, ok := f.sdk[raw]
	if !ok {
		return KeyScope{}, ErrUnauthenticated
	}
	return scope, nil
}

// countingReader produces deterministic bytes so a test can assert on token
// shape without asserting on a specific secret.
type countingReader struct{ n byte }

func (c *countingReader) Read(buffer []byte) (int, error) {
	for index := range buffer {
		c.n++
		buffer[index] = c.n
	}
	return len(buffer), nil
}

func testService(t *testing.T, repository *fakeRepository, now time.Time) *Service {
	t.Helper()
	keys := fakeKeys{
		server: map[string]KeyScope{
			"sk.one": {APIKeyID: "key_1", ProjectID: "proj_1", EnvironmentID: "env_1"},
			"sk.two": {APIKeyID: "key_2", ProjectID: "proj_2", EnvironmentID: "env_2"},
		},
		sdk: map[string]KeyScope{
			"pk.one": {APIKeyID: "key_3", ProjectID: "proj_1", EnvironmentID: "env_1", ApplicationID: "app_1"},
			"pk.two": {APIKeyID: "key_4", ProjectID: "proj_1", EnvironmentID: "env_2", ApplicationID: "app_2"},
		},
	}
	return NewService(repository, keys,
		WithClock(func() time.Time { return now }),
		WithRandom(&countingReader{}))
}

func issue(t *testing.T, service *Service, ttlSeconds int) IssuedToken {
	t.Helper()
	issued, err := service.IssueToken(context.Background(), "sk.one", IssuanceRequest{
		CustomerID: "bcu_1", Audience: AudienceSDKSync,
		Scopes: []string{ScopeEntitlementsRead}, RequestedTTLSecond: ttlSeconds,
		CorrelationID: "corr-1",
	})
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return issued
}

// The token is opaque and bounded: prefixed, fixed length, and stored only as a
// digest. A token Mosaic could reproduce would be a token a database compromise
// hands to an attacker.
func TestIssuedTokenIsOpaqueAndStoredOnlyAsADigest(t *testing.T) {
	repository := newFakeRepository()
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)

	if !strings.HasPrefix(issued.Value, TokenPrefix) || len(issued.Value) != len(TokenPrefix)+43 {
		t.Fatalf("token value %q does not match the contract shape", issued.Value)
	}
	sum := sha256.Sum256([]byte(issued.Value))
	if _, ok := repository.digests[string(sum[:])]; !ok {
		t.Fatal("the token digest was not stored")
	}
	for _, stored := range repository.tokens {
		encoded, _ := json.Marshal(stored)
		if bytes.Contains(encoded, []byte(issued.Value)) {
			t.Fatal("the token value was persisted alongside its digest")
		}
	}
	if !issued.Metadata.ExpiresAt.After(issued.Metadata.IssuedAt) {
		t.Fatal("the issued token does not expire")
	}
}

// A caller may shorten a token's life and can never lengthen it past the
// contract maximum.
func TestTokenLifetimeIsClamped(t *testing.T) {
	repository := newFakeRepository()
	now := instant("2026-07-28T12:00:00Z")
	service := testService(t, repository, now)

	if got := issue(t, service, 0).Metadata.ExpiresAt.Sub(now); got != DefaultTokenTTL {
		t.Fatalf("default lifetime %v, want %v", got, DefaultTokenTTL)
	}
	if got := issue(t, service, 300).Metadata.ExpiresAt.Sub(now); got != 5*time.Minute {
		t.Fatalf("shortened lifetime %v, want 5m", got)
	}
	if got := issue(t, service, 999999).Metadata.ExpiresAt.Sub(now); got != MaxTokenTTL {
		t.Fatalf("lifetime %v exceeds the contract maximum %v", got, MaxTokenTTL)
	}
}

// A token minted for one Environment must be refused when presented alongside
// another Environment's SDK key. Without this check the token, not the key,
// would be the only thing standing between a sandbox client and production
// entitlement state.
func TestTokenCannotCrossEnvironment(t *testing.T) {
	repository := newFakeRepository()
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)

	if _, err := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one"); err != nil {
		t.Fatalf("a matching key pair was refused: %v", err)
	}
	if _, err := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.two"); err != ErrForbidden {
		t.Fatalf("a token presented with another Environment's key returned %v, want forbidden", err)
	}
	if _, err := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.unknown"); err != ErrUnauthenticated {
		t.Fatalf("an unknown SDK key returned %v, want unauthenticated", err)
	}
}

// Revocation takes effect on the next presentation, and expiry is evaluated on
// every request rather than trusted from issuance.
func TestRevokedAndExpiredTokensAreRefused(t *testing.T) {
	repository := newFakeRepository()
	now := instant("2026-07-28T12:00:00Z")
	service := testService(t, repository, now)
	issued := issue(t, service, 0)

	if _, err := service.RevokeToken(context.Background(), "sk.one", issued.Metadata.ID, RevokedCustomerSignedOut); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one"); err != ErrUnauthenticated {
		t.Fatalf("a revoked token returned %v, want unauthenticated", err)
	}

	fresh := newFakeRepository()
	freshService := testService(t, fresh, now)
	freshToken := issue(t, freshService, 0)
	later := NewService(fresh, fakeKeys{
		server: map[string]KeyScope{"sk.one": {ProjectID: "proj_1", EnvironmentID: "env_1"}},
		sdk:    map[string]KeyScope{"pk.one": {ProjectID: "proj_1", EnvironmentID: "env_1", ApplicationID: "app_1"}},
	}, WithClock(func() time.Time { return now.Add(2 * time.Hour) }))
	if _, err := later.AuthenticateCustomerToken(context.Background(), freshToken.Value, "pk.one"); err != ErrUnauthenticated {
		t.Fatalf("an expired token returned %v, want unauthenticated", err)
	}

	// A token from another Project cannot be revoked through this key.
	other := issue(t, service, 0)
	if _, err := service.RevokeToken(context.Background(), "sk.two", other.Metadata.ID, RevokedOperator); err != ErrNotFound {
		t.Fatalf("cross-tenant revocation returned %v, want not found", err)
	}
}

func seedSnapshot(repository *fakeRepository) {
	view := sampleView()
	repository.snapshots["env_1/bcu_1"] = view
}

// A conditional sync is answered `unchanged` only when the version matches. The
// entity tag alone is an opaque equality token with no ordering, so confirming
// on it without the version would confirm a cache whose monotonicity nobody
// checked.
func TestConditionalSyncRequiresVersionMatchAndSlidesFreshness(t *testing.T) {
	repository := newFakeRepository()
	seedSnapshot(repository)
	now := instant("2026-07-28T12:00:00Z")
	service := testService(t, repository, now)
	issued := issue(t, service, 0)
	authenticated, err := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")
	if err != nil {
		t.Fatal(err)
	}

	full, err := service.Sync(context.Background(), authenticated, SyncRequest{CorrelationID: "corr-1"})
	if err != nil {
		t.Fatal(err)
	}
	if full.Unchanged {
		t.Fatal("a first sync was answered as unchanged")
	}

	conditional, err := service.Sync(context.Background(), authenticated, SyncRequest{
		KnownSnapshotVersion: 4, EntityTag: full.EntityTag, CorrelationID: "corr-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !conditional.Unchanged {
		t.Fatal("a matching version and tag were not answered as unchanged")
	}
	// The confirmed snapshot's window is refreshed, so a device that keeps
	// confirming the same version never expires while it is in contact.
	if !conditional.ValidUntil.After(now) || !conditional.RefreshAfter.After(now) {
		t.Fatal("a 304 did not slide the freshness window")
	}

	stale, err := service.Sync(context.Background(), authenticated, SyncRequest{
		KnownSnapshotVersion: 3, EntityTag: full.EntityTag, CorrelationID: "corr-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if stale.Unchanged {
		t.Fatal("an older known version was answered as unchanged")
	}
}

// The token decides which customer is read. A body hint naming a different one
// is refused rather than ignored: silently ignoring it would let a client
// believe it had read a customer it had not.
func TestSyncRefusesACustomerHintThatDisagreesWithTheToken(t *testing.T) {
	repository := newFakeRepository()
	seedSnapshot(repository)
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")

	if _, err := service.Sync(context.Background(), authenticated, SyncRequest{
		CustomerIDHint: "bcu_other", CorrelationID: "corr-1",
	}); err != ErrForbidden {
		t.Fatalf("a mismatched customer hint returned %v, want forbidden", err)
	}
}

// Billing being disabled is a statement about Mosaic, not about the customer.
// Every key must come back `unavailable` with a reason, never `inactive`.
func TestBillingDisabledReportsUnavailableNotInactive(t *testing.T) {
	repository := newFakeRepository()
	seedSnapshot(repository)
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	repository.enabled["proj_1"] = false

	payload, err := service.Check(context.Background(), "sk.one", "env_1", CheckRequest{
		CustomerID: "bcu_1", EntitlementKeys: []string{"pro"}, CorrelationID: "corr-1",
	})
	if err != nil {
		t.Fatalf("a disabled Project produced an error instead of a contract answer: %v", err)
	}

	var envelope struct {
		RecordType string `json:"recordType"`
		Payload    struct {
			Results []struct {
				EntitlementKey     string `json:"entitlementKey"`
				State              string `json:"state"`
				PrimaryExplanation struct {
					Code string `json:"code"`
				} `json:"primaryExplanation"`
				Uncertainty struct {
					Reason string `json:"reason"`
					Since  string `json:"since"`
				} `json:"uncertainty"`
			} `json:"results"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.RecordType != "entitlementCheckResult" || len(envelope.Payload.Results) != 1 {
		t.Fatalf("unexpected record: %s", payload)
	}
	result := envelope.Payload.Results[0]
	if result.State != "unavailable" {
		t.Fatalf("billing disabled reported state %q, want unavailable", result.State)
	}
	if result.PrimaryExplanation.Code != "billing_disabled" {
		t.Fatalf("explanation %q, want billing_disabled", result.PrimaryExplanation.Code)
	}
	if result.Uncertainty.Reason == "none" || result.Uncertainty.Since == "" {
		t.Fatal("an unavailable result carried no definite uncertainty")
	}
}

// A customer with no committed projection in an Environment is `unknown`, not
// `inactive`, and the sync surface answers with a readable snapshot rather than
// an error the SDK would have to interpret.
func TestNeverProjectedCustomerSyncsWithoutClaimingLossOfAccess(t *testing.T) {
	repository := newFakeRepository()
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")

	result, err := service.Sync(context.Background(), authenticated, SyncRequest{CorrelationID: "corr-1"})
	if err != nil {
		t.Fatalf("a never-projected customer failed to sync: %v", err)
	}
	var envelope struct {
		RecordType string `json:"recordType"`
		Payload    struct {
			SnapshotID       string `json:"snapshotId"`
			SnapshotVersion  int64  `json:"snapshotVersion"`
			Entries          []any  `json:"entries"`
			ProjectionStatus struct {
				State string `json:"state"`
			} `json:"projectionStatus"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(result.Payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.RecordType != "customerEntitlementSnapshot" {
		t.Fatalf("record type %q", envelope.RecordType)
	}
	if len(envelope.Payload.Entries) != 0 {
		t.Fatal("a never-projected customer was given Entitlement entries")
	}
	if envelope.Payload.ProjectionStatus.State != ProjectionPending {
		t.Fatalf("projection status %q, want pending", envelope.Payload.ProjectionStatus.State)
	}
	// Version 0 is the "nothing has ever been committed" sentinel. Numbering the
	// placeholder 1 would collide with the first genuine projection, which is
	// also 1.
	if envelope.Payload.SnapshotVersion != 0 {
		t.Fatalf("the placeholder snapshot claimed version %d, want 0",
			envelope.Payload.SnapshotVersion)
	}
	if envelope.Payload.SnapshotID != "pending.bcu_1" {
		t.Fatalf("placeholder snapshot id %q", envelope.Payload.SnapshotID)
	}

	// Cross-step: once the customer is projected for the first time, the real
	// snapshot must be strictly newer than the placeholder the device cached.
	// A device comparing versions only advances when this holds.
	repository.snapshots["env_1/bcu_1"] = SnapshotView{
		SnapshotID: "ces_first", ProjectID: "proj_1", EnvironmentID: "env_1", CustomerID: "bcu_1",
		SnapshotVersion: 1, RuleVersion: 1,
		ComputedAt:      instant("2026-07-28T11:59:59Z"),
		AsOf:            instant("2026-07-28T11:59:59Z"),
		ChangeReason:    "initial_projection",
		Projection:      ProjectionStatus{State: ProjectionCurrent, LastProjectedAt: instant("2026-07-28T11:59:59Z")},
	}
	projected, err := service.Sync(context.Background(), authenticated, SyncRequest{
		KnownSnapshotVersion: envelope.Payload.SnapshotVersion,
		EntityTag:            result.EntityTag,
		CorrelationID:        "corr-1",
	})
	if err != nil {
		t.Fatalf("the first real projection failed to sync: %v", err)
	}
	if projected.Unchanged {
		t.Fatal("the first real snapshot was answered as unchanged against the placeholder")
	}
	var after struct {
		Payload struct {
			SnapshotVersion int64 `json:"snapshotVersion"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(projected.Payload, &after); err != nil {
		t.Fatal(err)
	}
	if after.Payload.SnapshotVersion <= envelope.Payload.SnapshotVersion {
		t.Fatalf("the first real snapshot is version %d, not strictly newer than the placeholder's %d",
			after.Payload.SnapshotVersion, envelope.Payload.SnapshotVersion)
	}
}
