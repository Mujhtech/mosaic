package billingaccess

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dlclark/regexp2"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// These tests cover the properties whose failure is a security or correctness
// incident rather than a bug report: a token that reaches another tenant, a
// credential that outlives its revocation, a cached snapshot confirmed without
// proof it is still current, and billing being disabled reported as loss of
// access.

type fakeRepository struct {
	// projectionStatusErr makes the projection-health read fail, which is the
	// condition the served status must report honestly.
	projectionStatusErr error
	enabled             map[string]bool
	tokens              map[string]Token
	digests             map[string]string
	customers           map[string]CustomerView
	snapshots           map[string]SnapshotView
	touched             int
	authority           *AuthoritySelection
	minimum             MinimumSupport
	observed            map[string]bool
	observations        []SyncObservation
	observationErr      error
	legacyAuthority     string
}

type accessSignal struct {
	projectID, environmentID string
	startedAt, endedAt       time.Time
	failed                   bool
}

type fakeAccessSignalRecorder struct {
	signals        []accessSignal
	err            error
	lastContextErr error
}

func (f *fakeAccessSignalRecorder) RecordAccessAPIResult(ctx context.Context, projectID, environmentID string, startedAt, endedAt time.Time, failed bool) error {
	f.signals = append(f.signals, accessSignal{projectID: projectID, environmentID: environmentID, startedAt: startedAt, endedAt: endedAt, failed: failed})
	f.lastContextErr = ctx.Err()
	return f.err
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		enabled:   map[string]bool{"proj_1": true, "proj_2": true},
		tokens:    map[string]Token{},
		digests:   map[string]string{},
		customers: map[string]CustomerView{"bcu_1": {ID: "bcu_1", ProjectID: "proj_1"}},
		snapshots: map[string]SnapshotView{},
		observed:  map[string]bool{},
	}
}

func (f *fakeRepository) BillingEnabled(_ context.Context, projectID string) (bool, error) {
	return f.enabled[projectID], nil
}
func (f *fakeRepository) LegacyAuthority(context.Context, AuthorityScope) (string, error) {
	if f.legacyAuthority == "" {
		return "source", nil
	}
	return f.legacyAuthority, nil
}
func (f *fakeRepository) MinimumSupport(context.Context, AuthorityScope) (MinimumSupport, error) {
	if f.minimum.MinimumSDKVersion == "" {
		return MinimumSupport{}, ErrNotFound
	}
	return f.minimum, nil
}
func (f *fakeRepository) AuthoritySelection(context.Context, AuthorityScope, string, time.Time) (AuthoritySelection, error) {
	if f.authority == nil {
		return AuthoritySelection{}, ErrNotFound
	}
	return *f.authority, nil
}
func (f *fakeRepository) ObservedSnapshotDigest(_ context.Context, _ AuthoritySelection, digest []byte) (bool, error) {
	return f.observed[string(digest)], nil
}
func (f *fakeRepository) AppendSyncObservation(_ context.Context, observation SyncObservation) error {
	if f.observationErr != nil {
		return f.observationErr
	}
	f.observations = append(f.observations, observation)
	f.observed[string(observation.Digest)] = true
	return nil
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
	if f.projectionStatusErr != nil {
		return ProjectionStatus{}, f.projectionStatusErr
	}
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
			"pk.one": {APIKeyID: "key_3", ProjectID: "proj_1", EnvironmentID: "env_1", ApplicationID: "app_1", Platform: "ios"},
			"pk.two": {APIKeyID: "key_4", ProjectID: "proj_1", EnvironmentID: "env_2", ApplicationID: "app_2", Platform: "android"},
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

// Stabilization evidence must capture both successful and failed authoritative
// checks without carrying customer or entitlement data, and an evidence-store
// outage must never change the access answer.
func TestTrustedAccessCheckRecordsScopedOutcomeWithoutOwningAvailability(t *testing.T) {
	repository := newFakeRepository()
	seedSnapshot(repository)
	now := instant("2026-07-28T12:00:00Z")
	recorder := &fakeAccessSignalRecorder{}
	service := NewService(repository, fakeKeys{server: map[string]KeyScope{
		"sk.one": {APIKeyID: "key_1", ProjectID: "proj_1", EnvironmentID: "env_1"},
	}}, WithClock(func() time.Time { return now }), WithAccessAPISignalRecorder(recorder))

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Check(cancelled, "sk.one", "env_1", CheckRequest{
		CustomerID: "bcu_1", EntitlementKeys: []string{"pro"}, CorrelationID: "corr-1",
	}); err != nil {
		t.Fatal(err)
	}
	if len(recorder.signals) != 1 || recorder.signals[0].failed || recorder.signals[0].projectID != "proj_1" || recorder.signals[0].environmentID != "env_1" || recorder.lastContextErr != nil {
		t.Fatalf("successful access signal=%+v", recorder.signals)
	}

	recorder.err = errors.New("evidence unavailable")
	if _, err := service.Check(context.Background(), "sk.one", "env_other", CheckRequest{
		CustomerID: "bcu_1", EntitlementKeys: []string{"pro"}, CorrelationID: "corr-2",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("access error=%v, want forbidden", err)
	}
	// Cross-environment attempts are refused before a trustworthy scope exists
	// and therefore cannot author stabilization evidence.
	if len(recorder.signals) != 1 {
		t.Fatalf("untrusted scope authored evidence: %+v", recorder.signals)
	}

	if _, err := service.Check(context.Background(), "sk.one", "env_1", CheckRequest{
		CustomerID: "missing", EntitlementKeys: []string{"pro"}, CorrelationID: "corr-3",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("access error=%v, want not found", err)
	}
	if len(recorder.signals) != 2 || !recorder.signals[1].failed {
		t.Fatalf("failed access signal=%+v", recorder.signals)
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
		ComputedAt:   instant("2026-07-28T11:59:59Z"),
		AsOf:         instant("2026-07-28T11:59:59Z"),
		ChangeReason: "initial_projection",
		Projection:   ProjectionStatus{State: ProjectionCurrent, LastProjectedAt: instant("2026-07-28T11:59:59Z")},
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

func seedAuthority(repository *fakeRepository) {
	support := MinimumSupport{MinimumSDKVersion: "2.0.0", MinimumAppVersion: "4.0.0",
		MaximumAppVersion: "5.9.9", RequiredCapabilities: []string{"authority_epoch", "authority_scope"}}
	repository.minimum = support
	cutover := instant("2026-07-28T11:30:00Z")
	repository.authority = &AuthoritySelection{
		Scope:     AuthorityScope{ProjectID: "proj_1", EnvironmentID: "env_1", ApplicationID: "app_1", Platform: "ios"},
		ProgramID: "bmp_1", AuthorityEpoch: 5, AuthorityKind: "mosaic", TransitionState: "stabilizing",
		CutoverAt: &cutover, Snapshot: sampleView(), MinimumSupport: support,
	}
}

func authorityRequest() AuthoritySyncRequest {
	return AuthoritySyncRequest{ApplicationID: "app_1", Platform: "ios", AppVersion: "4.2.0", SDKVersion: "2.1.0",
		SupportedContractVersions: []string{"2"},
		Capabilities:              []string{"authority_epoch", "authority_scope", "urgent_authority_sync"}}
}

func validateAuthorityV2Record(t *testing.T, payload []byte) {
	t.Helper()
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(func(value string) (jsonschema.Regexp, error) {
		compiled, err := regexp2.Compile(value, regexp2.ECMAScript)
		return (*authorityTestRegexp)(compiled), err
	})
	for _, relative := range []string{
		"../../../../protocol/schema/authoritative-entitlement/v2/snapshot.schema.json",
		"../../../../protocol/schema/authoritative-entitlement/v2/check.schema.json",
		"../../../../protocol/schema/authoritative-entitlement/v2/subscription.schema.json",
		"../../../../protocol/schema/authoritative-entitlement/v2/restore.schema.json",
		"../../../../protocol/schema/authoritative-entitlement/v2/contract.schema.json",
	} {
		file, err := os.Open(relative)
		if err != nil {
			t.Fatal(err)
		}
		var document map[string]any
		if err := json.NewDecoder(file).Decode(&document); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
		_ = file.Close()
		id, _ := document["$id"].(string)
		if err := compiler.AddResource(id, document); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := compiler.Compile("urn:mosaic:protocol:schema:authoritative-entitlement:v2:contract")
	if err != nil {
		t.Fatal(err)
	}
	var record any
	if err := json.Unmarshal(payload, &record); err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(record); err != nil {
		t.Fatalf("v2 response violates canonical schema: %v\n%s", err, payload)
	}
}

type authorityTestRegexp regexp2.Regexp

func (expression *authorityTestRegexp) MatchString(value string) bool {
	matched, err := (*regexp2.Regexp)(expression).MatchString(value)
	return err == nil && matched
}
func (expression *authorityTestRegexp) String() string { return (*regexp2.Regexp)(expression).String() }

// V2 conditional sync is keyed by the authority-bound digest, exact epoch and
// exact snapshot version. A stale or merely well-shaped digest must get a full
// snapshot; confirming it would replay access across an authority transition.
func TestAuthorityV2FullThenExactDigestUnchanged(t *testing.T) {
	repository := newFakeRepository()
	seedAuthority(repository)
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")

	full, err := service.SyncAuthorityV2(context.Background(), authenticated, authorityRequest())
	if err != nil {
		t.Fatal(err)
	}
	validateAuthorityV2Record(t, full.Payload)
	var fullRecord struct {
		RecordType string `json:"recordType"`
		Payload    struct {
			Digest    string `json:"snapshotAuthorityDigest"`
			Authority struct {
				Epoch int64 `json:"authorityEpoch"`
			} `json:"authority"`
			Snapshot struct {
				Version int64 `json:"snapshotVersion"`
			} `json:"snapshot"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(full.Payload, &fullRecord); err != nil {
		t.Fatal(err)
	}
	if fullRecord.RecordType != "customerEntitlementSnapshot" || fullRecord.Payload.Digest == "" {
		t.Fatalf("unexpected v2 full record: %s", full.Payload)
	}
	var canonical struct {
		Payload struct {
			Authority map[string]any `json:"authority"`
			Snapshot  map[string]any `json:"snapshot"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(full.Payload, &canonical); err != nil {
		t.Fatal(err)
	}
	wantDigest, err := snapshotAuthorityDigest(canonical.Payload.Authority, canonical.Payload.Snapshot)
	if err != nil || wantDigest != fullRecord.Payload.Digest {
		t.Fatalf("authority digest %q, want %q (%v)", fullRecord.Payload.Digest, wantDigest, err)
	}
	if len(repository.observations) != 1 {
		t.Fatalf("got %d observations after full response", len(repository.observations))
	}
	observationJSON, _ := json.Marshal(repository.observations[0])
	if bytes.Contains(observationJSON, []byte("bcu_1")) || bytes.Contains(observationJSON, []byte(TokenPrefix)) {
		t.Fatalf("observation contains customer or credential material: %s", observationJSON)
	}

	request := authorityRequest()
	request.KnownAuthorityEpoch = &fullRecord.Payload.Authority.Epoch
	request.KnownSnapshotVersion = &fullRecord.Payload.Snapshot.Version
	request.KnownSnapshotAuthorityDigest = fullRecord.Payload.Digest
	unchanged, err := service.SyncAuthorityV2(context.Background(), authenticated, request)
	if err != nil {
		t.Fatal(err)
	}
	if !unchanged.Unchanged || !bytes.Contains(unchanged.Payload, []byte(`"recordType":"snapshotUnchanged"`)) {
		t.Fatalf("exact retained digest was not confirmed: %s", unchanged.Payload)
	}
	validateAuthorityV2Record(t, unchanged.Payload)

	request.KnownSnapshotAuthorityDigest = "sha256:" + strings.Repeat("f", 64)
	stale, err := service.SyncAuthorityV2(context.Background(), authenticated, request)
	if err != nil {
		t.Fatal(err)
	}
	if stale.Unchanged || !bytes.Contains(stale.Payload, []byte(`"recordType":"customerEntitlementSnapshot"`)) {
		t.Fatalf("unknown digest was confirmed instead of receiving full snapshot: %s", stale.Payload)
	}
	validateAuthorityV2Record(t, stale.Payload)
}

// Missing scoped state is authority unavailable, never a read from the legacy
// global pointer and never an inactive snapshot.
func TestAuthorityV2MissingPointerIsUnavailable(t *testing.T) {
	repository := newFakeRepository()
	repository.minimum = MinimumSupport{MinimumSDKVersion: "2.0.0", MinimumAppVersion: "4.0.0",
		MaximumAppVersion: "5.9.9", RequiredCapabilities: []string{"authority_epoch"}}
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")
	result, err := service.SyncAuthorityV2(context.Background(), authenticated, authorityRequest())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(result.Payload, []byte(`"recordType":"authorityUnavailable"`)) || bytes.Contains(result.Payload, []byte(`"state":"inactive"`)) {
		t.Fatalf("missing authority state did not fail closed: %s", result.Payload)
	}
	validateAuthorityV2Record(t, result.Payload)
}

// A missing frozen serving policy has no truthful minimum versions to report.
// The v2 contract therefore requires policy_unavailable and forbids inventing
// a minimumSupport object for this one reason.
func TestAuthorityV2MissingPolicyIsCanonicalUnavailable(t *testing.T) {
	repository := newFakeRepository()
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")
	result, err := service.SyncAuthorityV2(context.Background(), authenticated, authorityRequest())
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		RecordType string         `json:"recordType"`
		Payload    map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(result.Payload, &record); err != nil {
		t.Fatal(err)
	}
	if record.RecordType != "authorityUnavailable" || record.Payload["reason"] != "policy_unavailable" {
		t.Fatalf("unexpected policy response: %s", result.Payload)
	}
	if _, exists := record.Payload["minimumSupport"]; exists {
		t.Fatalf("policy_unavailable invented minimum support: %s", result.Payload)
	}
	validateAuthorityV2Record(t, result.Payload)
}

// Observation evidence is operational only. Its storage failure may reduce
// readiness evidence but cannot change a customer's entitlement response.
func TestAuthorityV2ObservationFailureDoesNotBlockServing(t *testing.T) {
	repository := newFakeRepository()
	seedAuthority(repository)
	repository.observationErr = errors.New("write unavailable")
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")
	result, err := service.SyncAuthorityV2(context.Background(), authenticated, authorityRequest())
	if err != nil {
		t.Fatalf("observation failure changed serving: %v", err)
	}
	if !bytes.Contains(result.Payload, []byte(`"recordType":"customerEntitlementSnapshot"`)) {
		t.Fatalf("unexpected response: %s", result.Payload)
	}
}

func TestLegacySyncFailsClosedAfterAuthorityCutover(t *testing.T) {
	repository := newFakeRepository()
	seedSnapshot(repository)
	repository.legacyAuthority = "mosaic"
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, _ := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")
	if _, err := service.Sync(context.Background(), authenticated, SyncRequest{}); err != ErrAuthorityUpgradeRequired {
		t.Fatalf("v1 sync at Mosaic authority returned %v, want upgrade required", err)
	}
}

// Fallback-audit backend #13 (theme T6). The read model initializes the
// projection status to `current`, and every call site read the real status
// under `if err == nil`. A failed health read therefore served the snapshot as
// though the projection were up to date: the one state that asserts freshness
// was the state published when Mosaic knew nothing about it. An SDK or operator
// acting on `current` has no way to tell that apart from a genuinely current
// projection.
//
// The snapshot is still served — a projection whose health cannot be read is
// not a reason to tell a paying customer they have no access — but it is
// reported degraded, with a diagnostic naming what actually failed.
func TestUnreadableProjectionStatusIsReportedDegradedRatherThanCurrent(t *testing.T) {
	repository := newFakeRepository()
	seedSnapshot(repository)
	repository.projectionStatusErr = ErrUnavailable
	service := testService(t, repository, instant("2026-07-28T12:00:00Z"))
	issued := issue(t, service, 0)
	authenticated, err := service.AuthenticateCustomerToken(context.Background(), issued.Value, "pk.one")
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.Sync(context.Background(), authenticated, SyncRequest{CorrelationID: "corr-1"})
	if err != nil {
		t.Fatalf("an unreadable projection status failed the sync: %v", err)
	}
	var payload struct {
		Payload struct {
			ProjectionStatus struct {
				State          string `json:"state"`
				DiagnosticCode string `json:"diagnosticCode"`
			} `json:"projectionStatus"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(result.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	status := payload.Payload.ProjectionStatus
	if status.State != ProjectionDegraded {
		t.Fatalf("projection state %q with an unreadable status, want %q", status.State, ProjectionDegraded)
	}
	if status.DiagnosticCode != ProjectionStatusUnavailableCode {
		t.Fatalf("diagnostic code %q, want %q", status.DiagnosticCode, ProjectionStatusUnavailableCode)
	}
}
