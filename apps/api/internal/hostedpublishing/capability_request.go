package hostedpublishing

import (
	"encoding/json"
	"regexp"
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
