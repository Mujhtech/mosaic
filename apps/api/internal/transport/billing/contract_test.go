package billinghttp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/rs/zerolog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billing"
)

// The Billing Ingestion Contract v1 is frozen and platform-neutral: four SDKs
// decode one shape. These tests read the contract's own schema and fixtures off
// disk rather than restating them, so a contract change that Mosaic has not
// followed fails here instead of at an SDK decode site in the field.

const contractRoot = "../../../../../protocol"

func fixturePath(parts ...string) string {
	return filepath.Join(append([]string{contractRoot, "fixtures", "billing-ingestion", "v1"}, parts...)...)
}

func loadJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	// A missing fixture is a failure, not a skip. Skipping meant a renamed or
	// deleted fixture turned every contract assertion into a silent no-op —
	// the suite would stay green while the server drifted away from the
	// document four SDKs are written against.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("contract fixture %s could not be read: %v", path, err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("fixture %s is not valid JSON: %v", path, err)
	}
	return decoded
}

func encode(t *testing.T, result billing.SubmissionResult) map[string]any {
	t.Helper()
	raw, err := json.Marshal(result.Envelope())
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func keysOf(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// Every response Mosaic emits must carry the contract record envelope and the
// exact field set of the corresponding fixture. The submission-response schema
// declares additionalProperties:false at both levels, so an extra Mosaic-
// internal field (a request id, a raw input id) would be a hard decode failure
// in a strict reader rather than a tolerated addition.
func TestSubmissionResponsesMatchContractFixtureShape(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 400_000_000, time.UTC)
	received := billing.ContractTimestamp(now)

	cases := []struct {
		fixture string
		result  billing.SubmissionResult
	}{
		{
			fixture: "accepted-for-validation.json",
			result: billing.SubmissionResult{
				SubmissionID: "fixture-submission-apple-0001", ReceivedAt: received,
				Status: billing.SubmissionAccepted, EstimatedValidationDelaySeconds: 30,
			},
		},
		{
			fixture: "duplicate-observation.json",
			result: billing.SubmissionResult{
				SubmissionID: "fixture-submission-apple-0001", ReceivedAt: received,
				Status: billing.SubmissionDuplicate,
			},
		},
		{
			fixture: "permanent-rejection.json",
			result:  billing.Reject("fixture-submission-malformed-0001", now, billing.CodeProviderReferenceMalformed),
		},
		{
			fixture: "retryable-failure.json",
			result:  billing.RateLimited("fixture-submission-google-0001", now, 30*time.Second),
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.fixture, func(t *testing.T) {
			fixture := loadJSON(t, fixturePath("responses", testCase.fixture))
			produced := encode(t, testCase.result)

			if !reflect.DeepEqual(keysOf(fixture), keysOf(produced)) {
				t.Fatalf("envelope keys %v, want %v", keysOf(produced), keysOf(fixture))
			}
			for _, key := range []string{"billingIngestionContractVersion", "recordType"} {
				if produced[key] != fixture[key] {
					t.Fatalf("%s = %v, want %v", key, produced[key], fixture[key])
				}
			}

			fixturePayload := fixture["payload"].(map[string]any)
			producedPayload := produced["payload"].(map[string]any)

			// `diagnostics` is an optional member Mosaic does not populate;
			// everything else must match the fixture field-for-field.
			expected := make([]string, 0, len(fixturePayload))
			for _, key := range keysOf(fixturePayload) {
				if key == "diagnostics" {
					continue
				}
				expected = append(expected, key)
			}
			if !reflect.DeepEqual(expected, keysOf(producedPayload)) {
				t.Fatalf("payload keys %v, want %v", keysOf(producedPayload), expected)
			}
			for _, key := range expected {
				if key == "receivedAt" {
					continue
				}
				if producedPayload[key] != fixturePayload[key] {
					t.Fatalf("payload.%s = %v, want %v", key, producedPayload[key], fixturePayload[key])
				}
			}
		})
	}
}

// receivedAt must match the contract's UTC timestamp pattern. A Go time
// rendered with the default RFC 3339 layout carries an offset like +00:00 and
// nanosecond precision, both of which the pattern rejects, so this is a real
// and easy regression.
func TestContractTimestampMatchesSchemaPattern(t *testing.T) {
	schema := loadJSON(t, filepath.Join(contractRoot, "schema", "billing-ingestion", "v1", "observation.schema.json"))
	defs := schema["$defs"].(map[string]any)
	pattern := defs["utcTimestamp"].(map[string]any)["pattern"].(string)

	expression := regexpMustCompile(t, pattern)
	for _, instant := range []time.Time{
		time.Date(2026, 7, 27, 12, 0, 0, 400_000_000, time.UTC),
		time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		// A non-UTC input must still render as UTC with a literal Z.
		time.Date(2026, 7, 27, 12, 0, 0, 0, time.FixedZone("test", 5*3600)),
	} {
		rendered := billing.ContractTimestamp(instant)
		if !expression.MatchString(rendered) {
			t.Fatalf("ContractTimestamp(%s) = %q, which the contract pattern rejects", instant, rendered)
		}
	}
}

// The status and code vocabularies are frozen. A Mosaic constant outside them
// would be rejected by any SDK validating against the schema, and the failure
// would surface as an undecodable response rather than a clear error.
func TestSubmissionStatusesAndCodesAreInTheContractVocabulary(t *testing.T) {
	schema := loadJSON(t, filepath.Join(contractRoot, "schema", "billing-ingestion", "v1", "submission-response.schema.json"))
	defs := schema["$defs"].(map[string]any)

	permanent := enumOf(t, defs, "permanentCode")
	retryable := enumOf(t, defs, "retryableCode")

	for _, code := range []string{
		billing.CodeObservationSchemaInvalid, billing.CodeUnknownField, billing.CodeInvalidIdentifier,
		billing.CodeInvalidTimestamp, billing.CodeObservationTooLarge, billing.CodeProviderReferenceMalformed,
		billing.CodeReferenceKindUnsupported, billing.CodeSensitiveValueRejected, billing.CodeAuthorityNotAllowed,
		billing.CodeBillingNotEnabled, billing.CodeObservationIDConflict,
	} {
		if !permanent[code] {
			t.Fatalf("permanent code %q is not in the contract vocabulary", code)
		}
	}
	for _, code := range []string{
		billing.CodeRateLimited, billing.CodeStorageUnavailable, billing.CodeServiceUnavailable,
		billing.CodeIngestionTimeout, billing.CodeValidationBacklogFull,
	} {
		if !retryable[code] {
			t.Fatalf("retryable code %q is not in the contract vocabulary", code)
		}
	}

	// The whole point of the status set: nothing in it may imply the
	// transaction was proven real.
	statuses := map[string]bool{}
	for _, variant := range defs["observationSubmissionResult"].(map[string]any)["oneOf"].([]any) {
		properties := variant.(map[string]any)["properties"].(map[string]any)
		statuses[properties["status"].(map[string]any)["const"].(string)] = true
	}
	for _, status := range []string{
		billing.SubmissionAccepted, billing.SubmissionDuplicate,
		billing.SubmissionPermanentlyRejected, billing.SubmissionRetryableFailure,
	} {
		if !statuses[status] {
			t.Fatalf("status %q is not in the contract status set", status)
		}
	}
	for forbidden := range statuses {
		switch forbidden {
		case "validated", "verified", "confirmed", "entitled":
			t.Fatalf("the contract status set contains %q, which claims proof", forbidden)
		}
	}
}

func enumOf(t *testing.T, defs map[string]any, name string) map[string]bool {
	t.Helper()
	values := defs[name].(map[string]any)["enum"].([]any)
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value.(string)] = true
	}
	return set
}

// The canonical fixtures are decoded through the real strict decoder, so the
// Go request types are proven to accept exactly what the SDKs are told to send.
// Restating the shape in the test instead would let the two drift silently.
func TestCanonicalObservationFixturesDecode(t *testing.T) {
	for _, fixture := range []string{"apple-client-observation.json", "google-client-observation.json"} {
		t.Run(fixture, func(t *testing.T) {
			body := readFixture(t, fixturePath(fixture))
			envelope, code := decodeEnvelope[clientObservationPayload](body, recordTypeClientObservation)
			if code != "" {
				t.Fatalf("canonical client fixture was rejected with %q", code)
			}
			if code := envelope.Payload.validate(); code != "" {
				t.Fatalf("canonical client fixture failed validation with %q", code)
			}
			observation := envelope.Payload.toObservation()
			if observation.SubmissionID == "" || observation.Reference == "" {
				t.Fatal("the decoded observation lost its submission id or reference")
			}
			// A client observation is never allowed to arrive classified.
			if observation.StoreEnvironment != "unclassified" {
				t.Fatalf("client observation classified as %q", observation.StoreEnvironment)
			}
		})
	}

	t.Run("trusted-server-observation.json", func(t *testing.T) {
		body := readFixture(t, fixturePath("trusted-server-observation.json"))
		envelope, code := decodeEnvelope[serverObservationPayload](body, recordTypeServerObservation)
		if code != "" {
			t.Fatalf("canonical trusted-server fixture was rejected with %q", code)
		}
		if code := envelope.Payload.validate(); code != "" {
			t.Fatalf("canonical trusted-server fixture failed validation with %q", code)
		}
		// The trusted fixture asserts production, and a trusted server is
		// permitted to classify.
		if got := envelope.Payload.toObservation().StoreEnvironment; got != "production" {
			t.Fatalf("trusted classification decoded as %q, want production", got)
		}
	})
}

// Each invalid fixture encodes a rule the contract exists to enforce. Decoding
// them through the same path proves Mosaic refuses what the contract refuses,
// rather than being more permissive than the document four SDKs were written
// against.
func TestInvalidObservationFixturesAreRejected(t *testing.T) {
	cases := []struct {
		fixture string
		reason  string
	}{
		{"client-observation-asserts-store-environment.json",
			"a client may not classify the Store Environment"},
		{"client-observation-foreign-authority.json",
			"a public SDK key proves only client authority"},
		{"client-observation-platform-reference-mismatch.json",
			"an Android digest must not be validated against Apple's API"},
		{"client-observation-tenant-field.json",
			"tenant scope comes from the authenticated key, never the body"},
		{"client-observation-credential-shaped-reference.json",
			"a reference must not be able to carry credential-shaped material"},
		{"malformed-token-digest-reference.json",
			"a malformed token digest cannot address a Google purchase"},
		{"client-observation-carries-purchase-token.json",
			"a public SDK may never carry a full purchase token"},
		{"unknown-contract-version.json",
			"a reader of another contract version must be told so precisely"},
		{"unknown-record-type.json",
			"an unknown record type must not be interpreted as a known one"},
	}
	for _, testCase := range cases {
		t.Run(testCase.fixture, func(t *testing.T) {
			body := readFixture(t, fixturePath("invalid", testCase.fixture))
			envelope, code := decodeEnvelope[clientObservationPayload](body, recordTypeClientObservation)
			if code == "" {
				code = envelope.Payload.validate()
			}
			if code == "" {
				t.Fatalf("invalid fixture was accepted; %s", testCase.reason)
			}
			t.Logf("rejected with %q (%s)", code, testCase.reason)
		})
	}
}

// A trusted server may not claim an authority its key does not prove. A secret
// server key proves a trusted app backend sent the document; it proves nothing
// about a provider having signed anything, so provider_notification and the
// other Mosaic-internal authorities must be refused on this surface.
func TestTrustedEndpointRejectsAuthorityItsKeyDoesNotProve(t *testing.T) {
	body := readFixture(t, fixturePath("invalid", "server-observation-unsigned-provider-notification.json"))
	envelope, code := decodeEnvelope[serverObservationPayload](body, recordTypeServerObservation)
	if code == "" {
		code = envelope.Payload.validate()
	}
	if code != billing.CodeAuthorityNotAllowed {
		t.Fatalf("rejected with %q, want %q", code, billing.CodeAuthorityNotAllowed)
	}
}

// Posting a record to the wrong endpoint is a record-type error: the document
// does not belong on that surface at all. Without this a trusted-shaped
// document could be submitted with only a public SDK key.
func TestRecordTypeIsBoundToTheEndpoint(t *testing.T) {
	trusted := readFixture(t, fixturePath("trusted-server-observation.json"))
	if _, code := decodeEnvelope[clientObservationPayload](trusted, recordTypeClientObservation); code != "unsupported_record_type" {
		t.Fatalf("a server record posted to the public endpoint was rejected with %q, want unsupported_record_type", code)
	}
	client := readFixture(t, fixturePath("apple-client-observation.json"))
	if _, code := decodeEnvelope[serverObservationPayload](client, recordTypeServerObservation); code != "unsupported_record_type" {
		t.Fatalf("a client record posted to the trusted endpoint was rejected with %q, want unsupported_record_type", code)
	}
}

func readFixture(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("contract fixture %s could not be read: %v", path, err)
	}
	return raw
}

func regexpMustCompile(t *testing.T, pattern string) *regexp.Regexp {
	t.Helper()
	expression, err := regexp.Compile(pattern)
	if err != nil {
		t.Fatalf("contract pattern %q is not a Go-compatible regular expression: %v", pattern, err)
	}
	return expression
}

// BL-1 — the trusted server endpoint carries the full Google purchase token.
//
// Without it a Google observation carries only a digest, a digest cannot be
// reversed, and the observation can never validate: an operator wiring an app
// backend to the trusted endpoint would receive accepted_for_validation for
// every submission and watch every one land in quarantine.
func TestTrustedServerObservationAcceptsPurchaseToken(t *testing.T) {
	body := readFixture(t, fixturePath("trusted-server-observation.json"))
	envelope, code := decodeEnvelope[serverObservationPayload](body, recordTypeServerObservation)
	if code != "" {
		t.Fatalf("the canonical trusted-server fixture was rejected with %q", code)
	}
	if code := envelope.Payload.validate(); code != "" {
		t.Fatalf("the canonical trusted-server fixture failed validation with %q", code)
	}
	if envelope.Payload.PurchaseToken == "" {
		t.Skip("the canonical fixture carries no purchase token; the synthetic cases below still apply")
	}
	if got := envelope.Payload.toObservation().PurchaseToken; got != envelope.Payload.PurchaseToken {
		t.Fatal("the decoded purchase token did not reach the observation")
	}
}

// The token is bound to the record's own reference. Without the binding a
// caller could file a real purchase token under a *different* transaction's
// reference; Mosaic would validate the token against Google, get a genuine
// answer, and record it as a fact about the transaction the reference named.
func TestPurchaseTokenMustDigestToItsOwnReference(t *testing.T) {
	token := "fixture-google-purchase-token-0001"
	matching := hexOf(billing.TokenDigest(token))

	base := func() serverObservationPayload {
		return serverObservationPayload{
			ObservationID: "fixture-observation-google-0001",
			SubmissionID:  "fixture-submission-google-0001",
			ProviderID:    "fixture-provider-google",
			StorePlatform: storePlatformGoogle,
			TransactionReference: transactionReference{
				ReferenceKind: billing.ReferenceGooglePlayTokenDigest, Value: matching,
			},
			SourceAuthority: authorityTrustedServer,
			TrustBasis:      "provider_server_api",
			ReceivedAt:      "2026-07-27T12:05:00.000Z",
			PurchaseToken:   token,
		}
	}

	if code := base().validate(); code != "" {
		t.Fatalf("a token matching its own reference was rejected with %q", code)
	}

	mismatched := base()
	mismatched.TransactionReference.Value = hexOf(billing.TokenDigest("fixture-a-different-purchase"))
	if code := mismatched.validate(); code != billing.CodeProviderReferenceMalformed {
		t.Fatalf("a token filed under another transaction's reference was accepted (code=%q)", code)
	}

	// Gated to Google: an Apple record may never carry one.
	apple := base()
	apple.StorePlatform = storePlatformApple
	apple.TransactionReference = transactionReference{
		ReferenceKind: billing.ReferenceAppStoreTransactionID, Value: "2000000900000001",
	}
	if code := apple.validate(); code != billing.CodeReferenceKindUnsupported {
		t.Fatalf("an Apple record carried a purchase token (code=%q)", code)
	}

	// Gated to trusted-server authority.
	foreign := base()
	foreign.SourceAuthority = "provider_notification"
	if code := foreign.validate(); code != billing.CodeAuthorityNotAllowed {
		t.Fatalf("a non-trusted authority carried a purchase token (code=%q)", code)
	}

	// Bounds: control characters and over-length values are refused before the
	// digest comparison, so a hostile value cannot reach storage.
	oversize := base()
	oversize.PurchaseToken = strings.Repeat("t", maxPurchaseTokenLength+1)
	if code := oversize.validate(); code != billing.CodeSensitiveValueRejected {
		t.Fatalf("an over-length token was accepted (code=%q)", code)
	}
	control := base()
	control.PurchaseToken = "fixture\ntoken"
	if code := control.validate(); code != billing.CodeSensitiveValueRejected {
		t.Fatalf("a token with a control character was accepted (code=%q)", code)
	}
}

// The client record has no place to put a token at all, so a client that sends
// one is rejected as an unknown field rather than silently ignored.
func TestClientObservationRejectsPurchaseToken(t *testing.T) {
	body := readFixture(t, fixturePath("invalid", "client-observation-carries-purchase-token.json"))
	envelope, code := decodeEnvelope[clientObservationPayload](body, recordTypeClientObservation)
	if code == "" {
		code = envelope.Payload.validate()
	}
	if code != billing.CodeUnknownField {
		t.Fatalf("a client observation carrying a purchase token was rejected with %q, want %q",
			code, billing.CodeUnknownField)
	}
}

// T-5 — the billing error path must never emit request content.
//
// response.Error logs the cause behind every 5xx. On this surface a cause can
// quote a URL containing a purchase token, a decode fragment, or a transport
// error naming internal hosts, so writeError deliberately never populates
// APIError.Cause and logs the error's *type* rather than its message. Nothing
// exercised that until now, and m-3 — errorTypeName returning a message prefix
// and logging colon-less errors verbatim — is exactly the regression this
// catches. Plan §13 names a redaction test explicitly.
func TestBillingErrorPathEmitsNoRequestContent(t *testing.T) {
	const secret = "gtokenAbCdEf0123456789-SECRET-PURCHASE-TOKEN"
	causes := map[string]error{
		"transport error with a token in a URL": errors.New(
			"Get \"https://androidpublisher.googleapis.com/v3/tokens/" + secret + "\": dial tcp 10.1.2.3:443: refused"),
		"error with no colon at all": errors.New("purchase token " + secret + " was rejected"),
		"wrapped safe error": fmt.Errorf("outer context: %w",
			errors.New("signedPayload eyJhbGciOiJFUzI1NiJ9."+secret)),
	}

	for name, cause := range causes {
		t.Run(name, func(t *testing.T) {
			var logged bytes.Buffer
			logger := zerolog.New(&logged)
			request := httptest.NewRequest(http.MethodGet, "/v1/projects/p/billing/store-credentials", nil)
			request = request.WithContext(logger.WithContext(request.Context()))
			recorder := httptest.NewRecorder()

			writeError(recorder, request, cause)

			if recorder.Code != http.StatusInternalServerError {
				t.Fatalf("status %d, want 500 for an unmapped error", recorder.Code)
			}
			// Neither the operator log nor the response body may carry it.
			if strings.Contains(logged.String(), secret) {
				t.Fatalf("the operator log leaked request content: %s", logged.String())
			}
			if strings.Contains(recorder.Body.String(), secret) {
				t.Fatalf("the response body leaked request content: %s", recorder.Body.String())
			}
			// The whole message must be absent, not just the token: a message is
			// where internal topology leaks.
			if strings.Contains(logged.String(), "dial tcp") ||
				strings.Contains(logged.String(), "androidpublisher") {
				t.Fatalf("the operator log leaked the cause message: %s", logged.String())
			}
			// The type is what makes the line useful for triage, so it must be
			// present — otherwise a future refactor could "fix" this test by
			// logging nothing at all.
			if !strings.Contains(logged.String(), "billing_error_kind") {
				t.Fatalf("no billing_error_kind field was logged; triage has nothing to go on: %s", logged.String())
			}
		})
	}

	// A mapped error keeps its stable code and its fixed message, and still
	// carries no cause.
	var logged bytes.Buffer
	logger := zerolog.New(&logged)
	request := httptest.NewRequest(http.MethodGet, "/v1/projects/p/billing/store-credentials", nil)
	request = request.WithContext(logger.WithContext(request.Context()))
	recorder := httptest.NewRecorder()
	writeError(recorder, request, fmt.Errorf("reading credential %s: %w", secret, billing.ErrNotFound))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), secret) || strings.Contains(logged.String(), secret) {
		t.Fatalf("a mapped error leaked its wrapped content: body=%s log=%s", recorder.Body.String(), logged.String())
	}
}
