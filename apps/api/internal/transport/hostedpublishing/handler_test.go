package hostedpublishinghttp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Mujhtech/mosaic/apps/api/internal/hostedpublishing"
)

func TestCompressedConfigurationUsesRepresentationSpecificStrongETag(t *testing.T) {
	payload := bytes.Repeat([]byte(`{"release":"stable"}`), 100)
	compressed, err := gzipRepresentation(payload)
	if err != nil {
		t.Fatal(err)
	}
	if representationETag(payload) == representationETag(compressed) {
		t.Fatal("identity and gzip representations shared a strong ETag")
	}
	second, err := gzipRepresentation(payload)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(compressed, second) {
		t.Fatal("gzip representation is not deterministic for conditional requests")
	}
}

type rejectingLimiter struct{}

func (rejectingLimiter) Allow(string) (bool, time.Duration) { return false, 1500 * time.Millisecond }

func TestDeliveryRateLimitUsesStableRetryableError(t *testing.T) {
	handler := &Handler{limiter: rejectingLimiter{}}
	request := httptest.NewRequest(http.MethodGet, "/v1/sdk/configuration", nil)
	recorder := httptest.NewRecorder()
	if handler.allowDelivery(recorder, request, "ip:127.0.0.1") {
		t.Fatal("rejected delivery was allowed")
	}
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "2" {
		t.Fatalf("status=%d retry=%q, want 429 and two seconds", recorder.Code, recorder.Header().Get("Retry-After"))
	}
	if !strings.Contains(recorder.Body.String(), `"code":"rate_limited"`) {
		t.Fatalf("response omitted stable rate_limited code: %s", recorder.Body.String())
	}
}

type deliveryTestRepository struct{ transaction *deliveryTestTransaction }

func (repository deliveryTestRepository) View(_ context.Context, fn func(hostedpublishing.Reader) error) error {
	return fn(repository.transaction)
}

func (repository deliveryTestRepository) Transact(_ context.Context, fn func(hostedpublishing.Transaction) error) error {
	return fn(repository.transaction)
}

type deliveryTestTransaction struct {
	hostedpublishing.Transaction
	key             hostedpublishing.APIKeyRecord
	environment     hostedpublishing.Environment
	state           hostedpublishing.ReleaseState
	release         hostedpublishing.Release
	representations map[string]hostedpublishing.ReleaseRepresentation
	application     hostedpublishing.Application
	commerce        hostedpublishing.CommerceConfigurationSnapshot
	asset           hostedpublishing.Asset
}

func (transaction *deliveryTestTransaction) APIKeyByPrefix(prefix string) (hostedpublishing.APIKeyRecord, bool) {
	return transaction.key, prefix == transaction.key.Prefix
}

func (transaction *deliveryTestTransaction) Environment(id string) (hostedpublishing.Environment, bool) {
	return transaction.environment, id == transaction.environment.ID
}

func (transaction *deliveryTestTransaction) ReleaseState(id string) (hostedpublishing.ReleaseState, bool) {
	return transaction.state, id == transaction.state.EnvironmentID
}

func (transaction *deliveryTestTransaction) Release(id string) (hostedpublishing.Release, bool) {
	return transaction.release, id == transaction.release.ID
}

func (transaction *deliveryTestTransaction) ReleaseRepresentation(releaseID, version string) (hostedpublishing.ReleaseRepresentation, bool) {
	representation, ok := transaction.representations[version]
	return representation, ok && releaseID == transaction.release.ID
}

func (transaction *deliveryTestTransaction) Applications(projectID string) []hostedpublishing.Application {
	if transaction.application.ProjectID != projectID {
		return nil
	}
	return []hostedpublishing.Application{transaction.application}
}

func (transaction *deliveryTestTransaction) CommerceConfiguration(releaseID, applicationID string) (hostedpublishing.CommerceConfigurationSnapshot, bool) {
	return transaction.commerce,
		releaseID == transaction.commerce.ConfigurationReleaseID &&
			applicationID == transaction.commerce.ApplicationID
}

func (*deliveryTestTransaction) TouchAPIKey(string) {}

func (transaction *deliveryTestTransaction) Asset(id string) (hostedpublishing.Asset, bool) {
	return transaction.asset, id == transaction.asset.ID
}

func TestSDKConfigurationHTTPConditionalGzipAndExactCapabilities(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/configuration-delivery/v1/valid-release.json"))
	if err != nil {
		t.Fatal(err)
	}
	const rawKey = "sdk_test.secret"
	digest := sha256.Sum256([]byte(rawKey))
	transaction := &deliveryTestTransaction{
		key:         hostedpublishing.APIKeyRecord{ID: "key_1", EnvironmentID: "environment_staging", Kind: "public_sdk", Prefix: "sdk_test", SecretDigest: digest[:]},
		environment: hostedpublishing.Environment{ID: "environment_staging", ProjectID: "project_1", Key: "staging"},
		state:       hostedpublishing.ReleaseState{EnvironmentID: "environment_staging", ProjectID: "project_1", CurrentReleaseID: "configuration-release-9"},
		release:     hostedpublishing.Release{ID: "configuration-release-9", EnvironmentID: "environment_staging", Payload: payload},
	}
	handler := &Handler{service: hostedpublishing.NewService(deliveryTestRepository{transaction: transaction})}
	capabilities := releaseCapabilities(t, payload)

	request := sdkRequest(rawKey, capabilities)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()
	handler.sdkConfiguration(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Encoding") != "gzip" || recorder.Header().Get("ETag") == "" {
		t.Fatalf("gzip delivery status=%d encoding=%q etag=%q body=%s", recorder.Code, recorder.Header().Get("Content-Encoding"), recorder.Header().Get("ETag"), recorder.Body.String())
	}

	notModified := sdkRequest(rawKey, capabilities)
	notModified.Header.Set("Accept-Encoding", "gzip")
	notModified.Header.Set("If-None-Match", recorder.Header().Get("ETag"))
	notModifiedRecorder := httptest.NewRecorder()
	handler.sdkConfiguration(notModifiedRecorder, notModified)
	if notModifiedRecorder.Code != http.StatusNotModified || notModifiedRecorder.Body.Len() != 0 {
		t.Fatalf("conditional delivery status=%d body=%q", notModifiedRecorder.Code, notModifiedRecorder.Body.String())
	}

	unsupported := sdkRequest(rawKey, capabilities[1:])
	unsupportedRecorder := httptest.NewRecorder()
	handler.sdkConfiguration(unsupportedRecorder, unsupported)
	if unsupportedRecorder.Code != http.StatusNotAcceptable || !strings.Contains(unsupportedRecorder.Body.String(), `"code":"unsupported_capability"`) {
		t.Fatalf("unsupported capability status=%d body=%s", unsupportedRecorder.Code, unsupportedRecorder.Body.String())
	}
}

func TestSDKConfigurationParsesExperimentCapabilitiesAndVariesRepresentation(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/configuration-delivery/v3/experiment-release.json"))
	if err != nil {
		t.Fatal(err)
	}
	const rawKey = "sdk_experiment.secret"
	digest := sha256.Sum256([]byte(rawKey))
	transaction := &deliveryTestTransaction{
		key:         hostedpublishing.APIKeyRecord{ID: "key_experiment", EnvironmentID: "environment_staging", Kind: "public_sdk", Prefix: "sdk_experiment", SecretDigest: digest[:]},
		environment: hostedpublishing.Environment{ID: "environment_staging", ProjectID: "project_1", Key: "staging"},
		state:       hostedpublishing.ReleaseState{EnvironmentID: "environment_staging", ProjectID: "project_1", CurrentReleaseID: "configuration-release-experiment"},
		release:     hostedpublishing.Release{ID: "configuration-release-experiment", EnvironmentID: "environment_staging", DeliveryContractVersion: "3", Payload: payload},
		representations: map[string]hostedpublishing.ReleaseRepresentation{
			"3": {ReleaseID: "configuration-release-experiment", EnvironmentID: "environment_staging", DeliveryContractVersion: "3", Payload: payload},
		},
	}
	handler := &Handler{service: hostedpublishing.NewService(deliveryTestRepository{transaction: transaction})}
	request := sdkRequest(rawKey, releaseCapabilities(t, payload))
	request.Header.Set("Mosaic-Configuration-Versions", "3")
	request.Header.Set(experimentAssignmentVersionsHeader, "1")
	request.Header.Set(experimentFeaturesHeader, "allocation.ranges,assignment.installation,assignment.identified_user,assignment.identified_user_or_installation,fallback.normal_placement,group.mutual_exclusion,override.qa,schedule.trusted_server_time")
	request.Header.Set(experimentBucketingAlgorithmsHeader, "experiment_sha256_length_prefixed_v1,experiment_group_sha256_length_prefixed_v1")
	request.Header.Set(experimentSchedulePoliciesHeader, "trusted_server_time_v1")
	recorder := httptest.NewRecorder()
	handler.sdkConfiguration(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("Experiment-capable delivery status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	for _, name := range []string{experimentAssignmentVersionsHeader, experimentFeaturesHeader, experimentBucketingAlgorithmsHeader, experimentSchedulePoliciesHeader} {
		if !headerContains(recorder.Header().Get("Vary"), name) {
			t.Errorf("Vary omits %s: %s", name, recorder.Header().Get("Vary"))
		}
	}

	missingPolicy := request.Clone(request.Context())
	missingPolicy.Header = request.Header.Clone()
	missingPolicy.Header.Del(experimentSchedulePoliciesHeader)
	unsupportedRecorder := httptest.NewRecorder()
	handler.sdkConfiguration(unsupportedRecorder, missingPolicy)
	if unsupportedRecorder.Code != http.StatusNotAcceptable || !strings.Contains(unsupportedRecorder.Body.String(), `"code":"unsupported_capability"`) {
		t.Fatalf("missing Experiment schedule policy status=%d body=%s", unsupportedRecorder.Code, unsupportedRecorder.Body.String())
	}
}

func TestSDKConfigurationFallsBackToCurrentV2ForV3CapableSDK(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/configuration-delivery/v2/advanced-release.json"))
	if err != nil {
		t.Fatal(err)
	}
	const rawKey = "sdk_v3_v2_fallback.secret"
	digest := sha256.Sum256([]byte(rawKey))
	transaction := &deliveryTestTransaction{
		key:         hostedpublishing.APIKeyRecord{ID: "key_v2", EnvironmentID: "environment_staging", Kind: "public_sdk", Prefix: "sdk_v3_v2_fallback", SecretDigest: digest[:]},
		environment: hostedpublishing.Environment{ID: "environment_staging", ProjectID: "project_1", Key: "staging"},
		state:       hostedpublishing.ReleaseState{EnvironmentID: "environment_staging", ProjectID: "project_1", CurrentReleaseID: "configuration-release-v2"},
		release:     hostedpublishing.Release{ID: "configuration-release-v2", EnvironmentID: "environment_staging", DeliveryContractVersion: "2", Payload: payload},
	}
	handler := &Handler{service: hostedpublishing.NewService(deliveryTestRepository{transaction: transaction})}
	request := sdkRequest(rawKey, releaseCapabilities(t, payload))
	request.Header.Set("Mosaic-Configuration-Versions", "3,2,1")
	features, algorithms := decisionCapabilities(t, payload)
	request.Header.Set("Mosaic-Placement-Decision-Versions", "1")
	request.Header.Set("Mosaic-Decision-Features", strings.Join(features, ","))
	request.Header.Set("Mosaic-Bucketing-Algorithms", strings.Join(algorithms, ","))
	recorder := httptest.NewRecorder()

	handler.sdkConfiguration(recorder, request)

	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "application/vnd.mosaic.configuration+json;version=2" || !bytes.Equal(recorder.Body.Bytes(), payload) {
		t.Fatalf("v3-capable fallback status=%d content-type=%q body=%s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.String())
	}
}

func TestSDKCommerceConfigurationAssociationConditionalAndPlatformIsolation(t *testing.T) {
	payload, err := os.ReadFile(filepath.Join("../../../../../protocol/fixtures/commerce-configuration/v1/revenuecat-configuration.json"))
	if err != nil {
		t.Fatal(err)
	}
	const rawKey = "sdk_commerce.secret"
	digest := sha256.Sum256([]byte(rawKey))
	transaction := &deliveryTestTransaction{
		key: hostedpublishing.APIKeyRecord{
			ID: "key_1", EnvironmentID: "environment_staging", Kind: "public_sdk",
			Prefix: "sdk_commerce", SecretDigest: digest[:],
		},
		environment: hostedpublishing.Environment{ID: "environment_staging", ProjectID: "project_1", Key: "staging"},
		state: hostedpublishing.ReleaseState{
			EnvironmentID: "environment_staging", ProjectID: "project_1",
			CurrentReleaseID: "configuration-release-9",
		},
		application: hostedpublishing.Application{ID: "application_ios", ProjectID: "project_1", Platform: "ios"},
		commerce: hostedpublishing.CommerceConfigurationSnapshot{
			ID: "commerce_1", ProjectID: "project_1", EnvironmentID: "environment_staging",
			ApplicationID: "application_ios", StorePlatform: "ios",
			ConfigurationReleaseID: "configuration-release-9",
			ContentDigest:          "sha256:" + strings.Repeat("a", 64), Payload: payload,
		},
	}
	handler := &Handler{service: hostedpublishing.NewService(deliveryTestRepository{transaction: transaction})}
	request := commerceSDKRequest(rawKey, "ios")
	recorder := httptest.NewRecorder()
	handler.sdkCommerceConfiguration(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), payload) ||
		recorder.Header().Get("Content-Type") != commerceContentType ||
		recorder.Header().Get("ETag") != `"`+transaction.commerce.ContentDigest+`"` ||
		recorder.Header().Get("Mosaic-Configuration-Release-Id") != transaction.commerce.ConfigurationReleaseID {
		t.Fatalf("commerce delivery status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
	}

	notModified := commerceSDKRequest(rawKey, "ios")
	notModified.Header.Set("If-None-Match", recorder.Header().Get("ETag"))
	notModifiedRecorder := httptest.NewRecorder()
	handler.sdkCommerceConfiguration(notModifiedRecorder, notModified)
	if notModifiedRecorder.Code != http.StatusNotModified || notModifiedRecorder.Body.Len() != 0 ||
		notModifiedRecorder.Header().Get("ETag") != recorder.Header().Get("ETag") ||
		notModifiedRecorder.Header().Get("Mosaic-Configuration-Release-Id") != transaction.commerce.ConfigurationReleaseID ||
		notModifiedRecorder.Header().Get("Cache-Control") == "" ||
		notModifiedRecorder.Header().Get("Vary") == "" {
		t.Fatalf("conditional commerce delivery status=%d headers=%v body=%q", notModifiedRecorder.Code, notModifiedRecorder.Header(), notModifiedRecorder.Body.String())
	}

	mismatched := commerceSDKRequest(rawKey, "android")
	mismatchedRecorder := httptest.NewRecorder()
	handler.sdkCommerceConfiguration(mismatchedRecorder, mismatched)
	if mismatchedRecorder.Code != http.StatusNotAcceptable ||
		!strings.Contains(mismatchedRecorder.Body.String(), `"code":"unsupported_capability"`) {
		t.Fatalf("platform mismatch status=%d body=%s", mismatchedRecorder.Code, mismatchedRecorder.Body.String())
	}

	transaction.commerce.Payload = []byte(`{"commerceConfigurationVersion":"2"}`)
	v1OnlyRecorder := httptest.NewRecorder()
	handler.sdkCommerceConfiguration(v1OnlyRecorder, commerceSDKRequest(rawKey, "ios"))
	if v1OnlyRecorder.Code != http.StatusNotAcceptable ||
		!strings.Contains(v1OnlyRecorder.Body.String(), `"code":"unsupported_capability"`) {
		t.Fatalf("v1-only client received v2 configuration status=%d body=%s", v1OnlyRecorder.Code, v1OnlyRecorder.Body.String())
	}

	v2Request := commerceSDKRequest(rawKey, "ios")
	v2Request.Header.Set("Mosaic-Commerce-Configuration-Versions", "1, 2")
	v2Request.Header.Set("Mosaic-Commerce-Provider-Contract-Versions", "1, 2")
	v2Recorder := httptest.NewRecorder()
	handler.sdkCommerceConfiguration(v2Recorder, v2Request)
	if v2Recorder.Code != http.StatusOK ||
		v2Recorder.Header().Get("Content-Type") != "application/vnd.mosaic.commerce-configuration+json;version=2" {
		t.Fatalf("v2-capable client status=%d headers=%v body=%s", v2Recorder.Code, v2Recorder.Header(), v2Recorder.Body.String())
	}
}

func commerceSDKRequest(rawKey, platform string) *http.Request {
	request := httptest.NewRequest(
		http.MethodGet,
		"/v1/sdk/commerce-configuration?applicationId=application_ios",
		nil,
	)
	request.Header.Set("Authorization", "Bearer "+rawKey)
	request.Header.Set("Accept", commerceContentType)
	request.Header.Set("Mosaic-SDK-Platform", platform)
	request.Header.Set("Mosaic-SDK-Version", "1.0.0")
	request.Header.Set("Mosaic-Commerce-Configuration-Versions", "1")
	request.Header.Set("Mosaic-Commerce-Provider-Contract-Versions", "1")
	return request
}

func sdkRequest(rawKey string, capabilities []string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, "/v1/sdk/configuration", nil)
	request.Header.Set("Authorization", "Bearer "+rawKey)
	request.Header.Set("Mosaic-SDK-Platform", "flutter")
	request.Header.Set("Mosaic-SDK-Version", "0.2.0-dev.5")
	request.Header.Set("Mosaic-Configuration-Versions", "1")
	request.Header.Set("Mosaic-Paywall-Protocol-Versions", "0.2")
	request.Header.Set(capabilitiesHeader, strings.Join(capabilities, ","))
	return request
}

func releaseCapabilities(t *testing.T, payload []byte) []string {
	t.Helper()
	var envelope struct {
		Release struct {
			Compatibility struct {
				PaywallProtocols []struct {
					RequiredCapabilities []struct {
						Name    string `json:"name"`
						Version string `json:"version"`
					} `json:"requiredCapabilities"`
				} `json:"paywallProtocols"`
			} `json:"compatibility"`
		} `json:"release"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	values := make([]string, 0)
	for _, protocol := range envelope.Release.Compatibility.PaywallProtocols {
		for _, capability := range protocol.RequiredCapabilities {
			values = append(values, capability.Name+"@"+capability.Version)
		}
	}
	return values
}

func decisionCapabilities(t *testing.T, payload []byte) ([]string, []string) {
	t.Helper()
	var envelope struct {
		Release struct {
			Compatibility struct {
				Contracts []struct {
					RequiredFeatures    []string `json:"requiredFeatures"`
					BucketingAlgorithms []string `json:"bucketingAlgorithms"`
				} `json:"placementDecisionContracts"`
			} `json:"compatibility"`
		} `json:"release"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Release.Compatibility.Contracts) != 1 {
		t.Fatalf("fixture placement compatibility = %#v", envelope.Release.Compatibility.Contracts)
	}
	return envelope.Release.Compatibility.Contracts[0].RequiredFeatures, envelope.Release.Compatibility.Contracts[0].BucketingAlgorithms
}

var _ hostedpublishing.Repository = deliveryTestRepository{}

type deliveryObjectStore struct{ content []byte }

func (deliveryObjectStore) Check(context.Context) error                                 { return nil }
func (deliveryObjectStore) Put(context.Context, string, io.Reader, int64, string) error { return nil }
func (store deliveryObjectStore) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(store.content)), nil
}
func (deliveryObjectStore) Delete(context.Context, string) error { return nil }

func TestAssetContentRetainsArchivedImmutableBytes(t *testing.T) {
	content := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	transaction := &deliveryTestTransaction{asset: hostedpublishing.Asset{
		ID: "asset_1", ProjectID: "project_1", MediaType: "image/png", ByteLength: int64(len(content)),
		ContentDigest: "sha256:" + strings.Repeat("a", 64), StorageKey: "private/key", Status: "archived",
	}}
	service := hostedpublishing.NewService(deliveryTestRepository{transaction: transaction}, hostedpublishing.WithObjectStore(deliveryObjectStore{content: content}, "https://assets.example/v1/sdk/assets", 1024))
	handler := &Handler{service: service}
	request := httptest.NewRequest(http.MethodGet, "/v1/sdk/assets/asset_1/"+transaction.asset.ContentDigest, nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("assetId", transaction.asset.ID)
	routeContext.URLParams.Add("contentDigest", transaction.asset.ContentDigest)
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
	recorder := httptest.NewRecorder()

	handler.assetContent(recorder, request)

	if recorder.Code != http.StatusOK || !bytes.Equal(recorder.Body.Bytes(), content) || recorder.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset response status=%d cache=%q body=%x", recorder.Code, recorder.Header().Get("Cache-Control"), recorder.Body.Bytes())
	}
}

var _ hostedpublishing.ObjectStore = deliveryObjectStore{}
