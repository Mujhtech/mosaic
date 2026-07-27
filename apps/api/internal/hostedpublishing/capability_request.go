package hostedpublishing

import (
	"encoding/json"
	"regexp"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
)

const MaxSDKCapabilityCount = 128

var semanticVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?$`)

var supportedProtocolCapabilities = map[string]struct{}{
	"layout.scrollContainer": {}, "layout.stack": {}, "layout.sizing": {}, "layout.heightSizing": {}, "layout.outerInsets": {},
	"navigation.screens": {}, "navigation.sheets": {},
	"component.text": {}, "component.image": {}, "component.icon": {}, "component.featureList": {}, "component.productSelector": {},
	"component.productCard": {}, "component.productBadge": {}, "component.button": {}, "component.carousel": {}, "component.switch": {}, "component.countdown": {},
	"localization.catalogs": {}, "localization.rtl": {}, "localization.productTemplate": {}, "product.references": {},
	"asset.bundledImage": {}, "asset.remoteImage": {}, "asset.bundledVideo": {}, "asset.remoteVideo": {},
	"action.purchase": {}, "action.restore": {}, "action.close": {}, "action.navigateTo": {}, "action.navigateBack": {}, "action.openExternalUrl": {},
	"accessibility.metadata": {}, "fallback.asset": {}, "fallback.product": {}, "outcome.normalized": {},
	"style.colors": {}, "style.designTokens": {}, "style.gradientBackground": {}, "style.mediaBackground": {}, "style.shadow": {},
	"style.box": {}, "style.clipping": {}, "style.typography": {}, "style.productCardStates": {},
	"visibility.static": {}, "condition.switchVisibility": {},
}

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
		if !containsExactUnique(request.SupportedConfigurationDeliveryVersions, "3", 8) ||
			!containsExactUnique(request.SupportedExperimentAssignmentContracts, "1", 8) ||
			!containsKnownUnique(request.SupportedExperimentFeatures, supportedExperimentFeatures, MaxSDKCapabilityCount) ||
			!containsKnownUnique(request.SupportedExperimentBucketingAlgorithms, supportedExperimentBucketingAlgorithms, 8) ||
			!containsKnownUnique(request.SupportedExperimentSchedulePolicies, supportedExperimentSchedulePolicies, 8) {
			return ErrUnsupportedCapability
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
			return ErrUnsupportedCapability
		}
		features := stringSet(request.SupportedExperimentFeatures)
		algorithms := stringSet(request.SupportedExperimentBucketingAlgorithms)
		policies := stringSet(request.SupportedExperimentSchedulePolicies)
		for _, contract := range envelope.Release.Compatibility.Experiment {
			if contract.Version != "1" {
				return ErrUnsupportedCapability
			}
			for _, v := range contract.RequiredFeatures {
				if _, ok := features[v]; !ok {
					return ErrUnsupportedCapability
				}
			}
			for _, v := range contract.BucketingAlgorithms {
				if _, ok := algorithms[v]; !ok {
					return ErrUnsupportedCapability
				}
			}
			for _, v := range contract.SchedulePolicies {
				if _, ok := policies[v]; !ok {
					return ErrUnsupportedCapability
				}
			}
		}
		clone := request
		clone.SupportedConfigurationDeliveryVersions = []string{"1"}
		v1 := deliveryEnvelope{ConfigurationDeliveryVersion: "1", Release: deliveryRelease{Compatibility: deliveryCompatibility{PaywallProtocols: envelope.Release.Compatibility.PaywallProtocols, Acceptance: "atomic"}}}
		v1Payload, _ := json.Marshal(v1)
		return ValidateSDKCapabilityRequest(clone, Release{DeliveryContractVersion: "1", Payload: v1Payload})
	}
	if version != "2" || !containsExactUnique(request.SupportedConfigurationDeliveryVersions, "2", 8) || !containsExactUnique(request.SupportedPlacementDecisionContracts, "1", 8) {
		return ErrUnsupportedCapability
	}
	var envelope deliveryV2Envelope
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.ConfigurationDeliveryVersion != "2" {
		return ErrUnsupportedCapability
	}
	features := map[string]struct{}{}
	for _, feature := range request.SupportedDecisionFeatures {
		if _, duplicate := features[feature]; duplicate {
			return ErrUnsupportedCapability
		}
		features[feature] = struct{}{}
	}
	algorithms := map[string]struct{}{}
	for _, algorithm := range request.SupportedBucketingAlgorithms {
		if algorithm != placementdecision.BucketingAlgorithm {
			return ErrUnsupportedCapability
		}
		if _, duplicate := algorithms[algorithm]; duplicate {
			return ErrUnsupportedCapability
		}
		algorithms[algorithm] = struct{}{}
	}
	for _, contract := range envelope.Release.Compatibility.PlacementDecisionContracts {
		if contract.Version != "1" {
			return ErrUnsupportedCapability
		}
		for _, feature := range contract.RequiredFeatures {
			if _, ok := features[feature]; !ok {
				return ErrUnsupportedCapability
			}
		}
		for _, algorithm := range contract.BucketingAlgorithms {
			if _, ok := algorithms[algorithm]; !ok {
				return ErrUnsupportedCapability
			}
		}
	}
	clone := request
	clone.SupportedConfigurationDeliveryVersions = []string{"1"}
	v1 := deliveryEnvelope{ConfigurationDeliveryVersion: "1", Release: deliveryRelease{Compatibility: deliveryCompatibility{PaywallProtocols: envelope.Release.Compatibility.PaywallProtocols, Acceptance: "atomic"}}}
	v1Payload, _ := json.Marshal(v1)
	return ValidateSDKCapabilityRequest(clone, Release{DeliveryContractVersion: "1", Payload: v1Payload})
}

func containsKnownUnique(values []string, supported map[string]struct{}, limit int) bool {
	if len(values) == 0 || len(values) > limit {
		return false
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if _, ok := supported[value]; !ok {
			return false
		}
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
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
		return ErrUnsupportedCapability
	}
	if len(request.SDKVersion) > 64 || !semanticVersionPattern.MatchString(request.SDKVersion) {
		return ErrUnsupportedCapability
	}
	if request.ApplicationVersion != "" && (len(request.ApplicationVersion) > 64 || !safeApplicationVersion(request.ApplicationVersion)) {
		return ErrUnsupportedCapability
	}
	if !containsExactUnique(request.SupportedConfigurationDeliveryVersions, DeliveryVersion, 8) {
		return ErrUnsupportedCapability
	}
	if len(request.SupportedPaywallProtocols) == 0 || len(request.SupportedPaywallProtocols) > 8 {
		return ErrUnsupportedCapability
	}
	protocols := make(map[string]map[string]struct{}, len(request.SupportedPaywallProtocols))
	for _, protocol := range request.SupportedPaywallProtocols {
		if protocol.Version != ProtocolVersion || len(protocol.Capabilities) == 0 || len(protocol.Capabilities) > MaxSDKCapabilityCount {
			return ErrUnsupportedCapability
		}
		if _, duplicate := protocols[protocol.Version]; duplicate {
			return ErrUnsupportedCapability
		}
		capabilities := make(map[string]struct{}, len(protocol.Capabilities))
		for _, capability := range protocol.Capabilities {
			if capability.Version != protocol.Version {
				return ErrUnsupportedCapability
			}
			if _, known := supportedProtocolCapabilities[capability.Name]; !known {
				return ErrUnsupportedCapability
			}
			key := capability.Name + "@" + capability.Version
			if _, duplicate := capabilities[key]; duplicate {
				return ErrUnsupportedCapability
			}
			capabilities[key] = struct{}{}
		}
		protocols[protocol.Version] = capabilities
	}
	reported, ok := protocols[ProtocolVersion]
	if !ok {
		return ErrUnsupportedCapability
	}
	var envelope deliveryEnvelope
	if err := json.Unmarshal(release.Payload, &envelope); err != nil || envelope.ConfigurationDeliveryVersion != DeliveryVersion {
		return ErrUnsupportedCapability
	}
	if len(envelope.Release.Compatibility.PaywallProtocols) == 0 {
		return ErrUnsupportedCapability
	}
	for _, protocol := range envelope.Release.Compatibility.PaywallProtocols {
		if protocol.Version != ProtocolVersion {
			return ErrUnsupportedCapability
		}
		for _, required := range protocol.RequiredCapabilities {
			if _, ok := reported[required.Name+"@"+required.Version]; !ok {
				return ErrUnsupportedCapability
			}
		}
	}
	return nil
}

// ValidateSDKCommerceCapabilityRequest validates the versions an SDK can decode.
// The published snapshot is checked separately so a v2 document is never sent
// to a client that declared only v1 support.
func ValidateSDKCommerceCapabilityRequest(platform, sdkVersion string, configurationVersions, providerContractVersions []string) error {
	if platform != "flutter" && platform != "ios" && platform != "android" {
		return ErrUnsupportedCapability
	}
	if len(sdkVersion) > 64 || !semanticVersionPattern.MatchString(sdkVersion) {
		return ErrUnsupportedCapability
	}
	if !containsSupportedUnique(configurationVersions, 8) ||
		!containsSupportedUnique(providerContractVersions, 8) {
		return ErrUnsupportedCapability
	}
	return nil
}

func ValidateSDKCommerceSnapshotCapability(version string, configurationVersions, providerContractVersions []string) error {
	if version != "1" && version != "2" {
		return ErrUnsupportedCapability
	}
	if !containsExactUnique(configurationVersions, version, 8) ||
		!containsExactUnique(providerContractVersions, version, 8) {
		return ErrUnsupportedCapability
	}
	return nil
}

func safeApplicationVersion(value string) bool {
	for _, character := range value {
		if character <= 0x1f || character == 0x7f {
			return false
		}
	}
	return true
}

func containsExactUnique(values []string, expected string, limit int) bool {
	if len(values) == 0 || len(values) > limit {
		return false
	}
	seen := make(map[string]struct{}, len(values))
	found := false
	for _, value := range values {
		if value == "" {
			return false
		}
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
		if value == expected {
			found = true
		}
	}
	return found
}

func containsSupportedUnique(values []string, limit int) bool {
	if len(values) == 0 || len(values) > limit {
		return false
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "1" && value != "2" {
			return false
		}
		if _, duplicate := seen[value]; duplicate {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}
