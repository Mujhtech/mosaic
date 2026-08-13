package hostedpublishing

import (
	"encoding/json"
	"regexp"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
)

const MaxSDKCapabilityCount = 128

var semanticVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$`)

var supportedExperimentFeatures = map[string]struct{}{
	"allocation.ranges": {}, "assignment.installation": {}, "assignment.identified_user": {},
	"assignment.identified_user_or_installation": {}, "fallback.normal_placement": {},
	"group.mutual_exclusion": {}, "override.qa": {}, "schedule.trusted_server_time": {},
}

var supportedExperimentBucketingAlgorithms = map[string]struct{}{
	"experiment_sha256_length_prefixed_v1": {}, "experiment_group_sha256_length_prefixed_v1": {},
}

var supportedExperimentSchedulePolicies = map[string]struct{}{"trusted_server_time_v1": {}}

type SDKCapability struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type SDKPaywallProtocolSupport struct {
	Version      string          `json:"version"`
	Capabilities []SDKCapability `json:"capabilities"`
}

type SDKCapabilityRequest struct {
	Platform                               string                      `json:"platform"`
	SDKVersion                             string                      `json:"sdkVersion"`
	SupportedConfigurationDeliveryVersions []string                    `json:"supportedConfigurationDeliveryVersions"`
	SupportedPaywallProtocols              []SDKPaywallProtocolSupport `json:"supportedPaywallProtocols"`
	ApplicationVersion                     string                      `json:"applicationVersion,omitempty"`
	SupportedPlacementDecisionContracts    []string                    `json:"supportedPlacementDecisionContracts"`
	SupportedDecisionFeatures              []string                    `json:"supportedDecisionFeatures"`
	SupportedBucketingAlgorithms           []string                    `json:"supportedBucketingAlgorithms"`
	SupportedExperimentAssignmentContracts []string                    `json:"supportedExperimentAssignmentContracts,omitempty"`
	SupportedExperimentFeatures            []string                    `json:"supportedExperimentFeatures,omitempty"`
	SupportedExperimentBucketingAlgorithms []string                    `json:"supportedExperimentBucketingAlgorithms,omitempty"`
	SupportedExperimentSchedulePolicies    []string                    `json:"supportedExperimentSchedulePolicies,omitempty"`
}

func PreferredDeliveryVersion(values []string) string {
	for _, value := range values {
		if value == "3" {
			return "3"
		}
	}
	for _, value := range values {
		if value == "2" {
			return "2"
		}
	}
	for _, value := range values {
		if value == "1" {
			return "1"
		}
	}
	return ""
}

func ValidateSDKCapabilityPayload(request SDKCapabilityRequest, payload json.RawMessage, version string) error {
	if version == "1" {
		release := Release{DeliveryContractVersion: "1", Payload: payload}
		return ValidateSDKCapabilityRequest(request, release)
	}
	if version == "3" {
		return validateDeliveryV3(request, payload)
	}
	return validateDeliveryV2(request, payload, version)
}

func validateDeliveryV3(request SDKCapabilityRequest, payload json.RawMessage) error {
	if err := requireExactUnique("configurationDeliveryVersion", request.SupportedConfigurationDeliveryVersions, "3", 8); err != nil {
		return err
	}
	if err := requireExactUnique("experimentAssignmentContractVersion", request.SupportedExperimentAssignmentContracts, "1", 8); err != nil {
		return err
	}
	if err := requireKnownUnique("experimentFeature", request.SupportedExperimentFeatures, supportedExperimentFeatures, MaxSDKCapabilityCount); err != nil {
		return err
	}
	if err := requireKnownUnique("experimentBucketingAlgorithm", request.SupportedExperimentBucketingAlgorithms, supportedExperimentBucketingAlgorithms, 8); err != nil {
		return err
	}
	if err := requireKnownUnique("experimentSchedulePolicy", request.SupportedExperimentSchedulePolicies, supportedExperimentSchedulePolicies, 8); err != nil {
		return err
	}
	var envelope struct {
		ConfigurationDeliveryVersion string `json:"configurationDeliveryVersion"`
		Release                      struct {
			Compatibility struct {
				PaywallProtocols []deliveryProtocolCompatibility `json:"paywallProtocols"`
				Experiment       []struct {
					Version             string   `json:"version"`
					RequiredFeatures    []string `json:"requiredFeatures"`
					BucketingAlgorithms []string `json:"bucketingAlgorithms"`
					SchedulePolicies    []string `json:"schedulePolicies"`
				} `json:"experimentAssignmentContracts"`
			} `json:"compatibility"`
			ExperimentAssignments []json.RawMessage `json:"experimentAssignments"`
		} `json:"release"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.ConfigurationDeliveryVersion != "3" {
		return unsupportedCapability("configurationDeliveryVersion", "", "3", CapabilityUnavailable)
	}
	features := stringSet(request.SupportedExperimentFeatures)
	algorithms := stringSet(request.SupportedExperimentBucketingAlgorithms)
	policies := stringSet(request.SupportedExperimentSchedulePolicies)
	for _, contract := range envelope.Release.Compatibility.Experiment {
		if contract.Version != "1" {
			return unsupportedCapability("experimentAssignmentContractVersion", "", contract.Version, CapabilityUnsupported)
		}
		for _, feature := range contract.RequiredFeatures {
			if _, ok := features[feature]; !ok {
				return unsupportedCapability("experimentFeature", feature, "", CapabilityMissing)
			}
		}
		for _, algorithm := range contract.BucketingAlgorithms {
			if _, ok := algorithms[algorithm]; !ok {
				return unsupportedCapability("experimentBucketingAlgorithm", algorithm, "", CapabilityMissing)
			}
		}
		for _, policy := range contract.SchedulePolicies {
			if _, ok := policies[policy]; !ok {
				return unsupportedCapability("experimentSchedulePolicy", policy, "", CapabilityMissing)
			}
		}
	}
	return validateEmbeddedV1(request, envelope.Release.Compatibility.PaywallProtocols)
}

func validateDeliveryV2(request SDKCapabilityRequest, payload json.RawMessage, version string) error {
	if version != "2" {
		return unsupportedCapability("configurationDeliveryVersion", "", version, CapabilityUnsupported)
	}
	if err := requireExactUnique("configurationDeliveryVersion", request.SupportedConfigurationDeliveryVersions, "2", 8); err != nil {
		return err
	}
	if err := requireExactUnique("placementDecisionContractVersion", request.SupportedPlacementDecisionContracts, "1", 8); err != nil {
		return err
	}
	var envelope deliveryV2Envelope
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.ConfigurationDeliveryVersion != "2" {
		return unsupportedCapability("configurationDeliveryVersion", "", "2", CapabilityUnavailable)
	}
	features := map[string]struct{}{}
	for _, feature := range request.SupportedDecisionFeatures {
		if _, duplicate := features[feature]; duplicate {
			return unsupportedCapability("decisionFeature", feature, "", CapabilityDuplicate)
		}
		features[feature] = struct{}{}
	}
	algorithms := map[string]struct{}{}
	for _, algorithm := range request.SupportedBucketingAlgorithms {
		if algorithm != placementdecision.BucketingAlgorithm {
			return unsupportedCapability("bucketingAlgorithm", algorithm, "", CapabilityUnknown)
		}
		if _, duplicate := algorithms[algorithm]; duplicate {
			return unsupportedCapability("bucketingAlgorithm", algorithm, "", CapabilityDuplicate)
		}
		algorithms[algorithm] = struct{}{}
	}
	for _, contract := range envelope.Release.Compatibility.PlacementDecisionContracts {
		if contract.Version != "1" {
			return unsupportedCapability("placementDecisionContractVersion", "", contract.Version, CapabilityUnsupported)
		}
		for _, feature := range contract.RequiredFeatures {
			if _, ok := features[feature]; !ok {
				return unsupportedCapability("decisionFeature", feature, "", CapabilityMissing)
			}
		}
		for _, algorithm := range contract.BucketingAlgorithms {
			if _, ok := algorithms[algorithm]; !ok {
				return unsupportedCapability("bucketingAlgorithm", algorithm, "", CapabilityMissing)
			}
		}
	}
	return validateEmbeddedV1(request, envelope.Release.Compatibility.PaywallProtocols)
}

// validateEmbeddedV1 re-runs the Paywall-protocol half of negotiation against a
// synthesized v1 envelope, so a v2 or v3 Release is still refused when the SDK
// cannot render one of its Paywall capabilities.
func validateEmbeddedV1(request SDKCapabilityRequest, protocols []deliveryProtocolCompatibility) error {
	clone := request
	clone.SupportedConfigurationDeliveryVersions = []string{"1"}
	v1 := deliveryEnvelope{ConfigurationDeliveryVersion: "1", Release: deliveryRelease{Compatibility: deliveryCompatibility{PaywallProtocols: protocols, Acceptance: "atomic"}}}
	v1Payload, _ := json.Marshal(v1)
	return ValidateSDKCapabilityRequest(clone, Release{DeliveryContractVersion: "1", Payload: v1Payload})
}

// requireKnownUnique accepts a non-empty, bounded, duplicate-free list drawn
// entirely from Mosaic's own vocabulary, naming the first offending value.
func requireKnownUnique(requirement string, values []string, supported map[string]struct{}, limit int) error {
	if len(values) == 0 || len(values) > limit {
		return unsupportedCapability(requirement, "", "", CapabilityMalformed)
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if _, ok := supported[value]; !ok {
			return unsupportedCapability(requirement, value, "", CapabilityUnknown)
		}
		if _, duplicate := seen[value]; duplicate {
			return unsupportedCapability(requirement, value, "", CapabilityDuplicate)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "" {
			result[value] = struct{}{}
		}
	}
	return result
}

// ValidateSDKCapabilityRequest enforces the closed Delivery v1 request contract
// and verifies that the selected immutable Release can be accepted atomically.
func ValidateSDKCapabilityRequest(request SDKCapabilityRequest, release Release) error {
	if request.Platform != "flutter" && request.Platform != "ios" && request.Platform != "android" {
		return unsupportedCapability("sdkPlatform", request.Platform, "", CapabilityUnsupported)
	}
	if len(request.SDKVersion) > 64 || !semanticVersionPattern.MatchString(request.SDKVersion) {
		return unsupportedCapability("sdkVersion", "", request.SDKVersion, CapabilityMalformed)
	}
	if request.ApplicationVersion != "" && (len(request.ApplicationVersion) > 64 || !safeApplicationVersion(request.ApplicationVersion)) {
		return unsupportedCapability("applicationVersion", "", "", CapabilityMalformed)
	}
	if err := requireExactUnique("configurationDeliveryVersion", request.SupportedConfigurationDeliveryVersions, DeliveryVersion, 8); err != nil {
		return err
	}
	if len(request.SupportedPaywallProtocols) == 0 || len(request.SupportedPaywallProtocols) > 8 {
		return unsupportedCapability("paywallProtocolVersion", "", "", CapabilityMalformed)
	}
	protocols := make(map[string]map[string]struct{}, len(request.SupportedPaywallProtocols))
	for _, protocol := range request.SupportedPaywallProtocols {
		if !knownPaywallProtocolVersion(protocol.Version) {
			return unsupportedCapability("paywallProtocolVersion", "", protocol.Version, CapabilityUnsupported)
		}
		if len(protocol.Capabilities) == 0 || len(protocol.Capabilities) > MaxSDKCapabilityCount {
			return unsupportedCapability("paywallCapability", "", protocol.Version, CapabilityMalformed)
		}
		if _, duplicate := protocols[protocol.Version]; duplicate {
			return unsupportedCapability("paywallProtocolVersion", "", protocol.Version, CapabilityDuplicate)
		}
		capabilities := make(map[string]struct{}, len(protocol.Capabilities))
		for _, capability := range protocol.Capabilities {
			if capability.Version != protocol.Version {
				return unsupportedCapability("paywallCapability", capability.Name, capability.Version, CapabilityUnsupported)
			}
			if !knownPaywallCapability(protocol.Version, capability.Name) {
				return unsupportedCapability("paywallCapability", capability.Name, capability.Version, CapabilityUnknown)
			}
			key := capability.Name + "@" + capability.Version
			if _, duplicate := capabilities[key]; duplicate {
				return unsupportedCapability("paywallCapability", capability.Name, capability.Version, CapabilityDuplicate)
			}
			capabilities[key] = struct{}{}
		}
		protocols[protocol.Version] = capabilities
	}
	var envelope deliveryEnvelope
	if err := json.Unmarshal(release.Payload, &envelope); err != nil || envelope.ConfigurationDeliveryVersion != DeliveryVersion {
		return unsupportedCapability("configurationDeliveryVersion", "", DeliveryVersion, CapabilityUnavailable)
	}
	if len(envelope.Release.Compatibility.PaywallProtocols) == 0 {
		return unsupportedCapability("paywallProtocolVersion", "", "", CapabilityUnavailable)
	}
	// Acceptance stays atomic: the SDK must be able to render every protocol
	// version the Release carries, so a Release holding a 0.4 document is
	// refused outright to a 0.3-only reader (the existing rejectDocument flow)
	// rather than partially served. Within a version, a missing capability
	// rejects unless the manifest names renderWithoutMotion as its fallback:
	// those are enhancement capabilities, and a reader without them renders the
	// document statically and completely.
	for _, protocol := range envelope.Release.Compatibility.PaywallProtocols {
		if !knownPaywallProtocolVersion(protocol.Version) {
			return unsupportedCapability("paywallProtocolVersion", "", protocol.Version, CapabilityUnsupported)
		}
		reported, ok := protocols[protocol.Version]
		if !ok {
			return unsupportedCapability("paywallProtocolVersion", "", protocol.Version, CapabilityMissing)
		}
		for _, required := range protocol.RequiredCapabilities {
			if _, ok := reported[required.Name+"@"+required.Version]; ok {
				continue
			}
			if paywallCapabilityFallback(protocol.Version, required.Name) == capabilityFallbackRenderWithoutMotion {
				continue
			}
			return unsupportedCapability("paywallCapability", required.Name, required.Version, CapabilityMissing)
		}
	}
	return nil
}

// ValidateSDKCommerceCapabilityRequest validates the versions an SDK can decode.
// The published snapshot is checked separately so a v2 document is never sent
// to a client that declared only v1 support.
func ValidateSDKCommerceCapabilityRequest(platform, sdkVersion string, configurationVersions, providerContractVersions []string) error {
	if platform != "flutter" && platform != "ios" && platform != "android" {
		return unsupportedCapability("sdkPlatform", platform, "", CapabilityUnsupported)
	}
	if len(sdkVersion) > 64 || !semanticVersionPattern.MatchString(sdkVersion) {
		return unsupportedCapability("sdkVersion", "", sdkVersion, CapabilityMalformed)
	}
	if err := requireSupportedUnique("commerceConfigurationVersion", configurationVersions, 8); err != nil {
		return err
	}
	return requireSupportedUnique("commerceProviderContractVersion", providerContractVersions, 8)
}

func ValidateSDKCommerceSnapshotCapability(version string, configurationVersions, providerContractVersions []string) error {
	if version != "1" && version != "2" {
		return unsupportedCapability("commerceConfigurationVersion", "", version, CapabilityUnsupported)
	}
	if err := requireExactUnique("commerceConfigurationVersion", configurationVersions, version, 8); err != nil {
		return err
	}
	return requireExactUnique("commerceProviderContractVersion", providerContractVersions, version, 8)
}

func safeApplicationVersion(value string) bool {
	for _, character := range value {
		if character <= 0x1f || character == 0x7f {
			return false
		}
	}
	return true
}

// requireExactUnique accepts a bounded, duplicate-free list that contains the
// expected version, naming the version the caller failed to advertise.
func requireExactUnique(requirement string, values []string, expected string, limit int) error {
	if len(values) == 0 || len(values) > limit {
		return unsupportedCapability(requirement, "", expected, CapabilityMalformed)
	}
	seen := make(map[string]struct{}, len(values))
	found := false
	for _, value := range values {
		if value == "" {
			return unsupportedCapability(requirement, "", "", CapabilityMalformed)
		}
		if _, duplicate := seen[value]; duplicate {
			return unsupportedCapability(requirement, "", value, CapabilityDuplicate)
		}
		seen[value] = struct{}{}
		if value == expected {
			found = true
		}
	}
	if !found {
		return unsupportedCapability(requirement, "", expected, CapabilityMissing)
	}
	return nil
}

func requireSupportedUnique(requirement string, values []string, limit int) error {
	if len(values) == 0 || len(values) > limit {
		return unsupportedCapability(requirement, "", "", CapabilityMalformed)
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "1" && value != "2" {
			return unsupportedCapability(requirement, "", value, CapabilityUnsupported)
		}
		if _, duplicate := seen[value]; duplicate {
			return unsupportedCapability(requirement, "", value, CapabilityDuplicate)
		}
		seen[value] = struct{}{}
	}
	return nil
}
