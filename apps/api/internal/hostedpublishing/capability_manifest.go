package hostedpublishing

import (
	"encoding/json"
	"fmt"

	"github.com/Mujhtech/mosaic/apps/api/internal/platform/protocolschema"
)

// capabilityFallbackRenderWithoutMotion is the one fallback tier that does not
// reject: a reader missing a motion.* capability renders the document
// statically and completely, which the terminal-state rule of Protocol 0.4
// guarantees is the full authored design. The value is named for motion
// specifically so it cannot spread by imitation; every other capability keeps
// rejectDocument. See docs/protocol/v0.4.md, "The enhancement tier".
const capabilityFallbackRenderWithoutMotion = "renderWithoutMotion"

// capabilityFallbackRejectDocument is the tier every other capability carries,
// and the answer for any name the manifests do not define: reject is the only
// safe default for a capability whose degradation is unknown.
const capabilityFallbackRejectDocument = "rejectDocument"

// protocolCapabilityFallbacks maps each Paywall Protocol version — there is
// exactly one (ADR-0028) — to its capability vocabulary and each capability's
// fallback tier.
//
// Sourced from the embedded copy of protocol/compatibility/v0.4.json rather
// than a list maintained here, so the vocabulary the runtime accepts and the
// vocabulary Mosaic publishes cannot disagree. The hand-maintained list this
// replaced omitted several published capabilities, so a conformant SDK
// advertising any of them was refused every Release as advertising a
// capability Mosaic does not define. The copy is refreshed by the
// protocolschema go:generate sync and drift-tested against the canonical file.
var protocolCapabilityFallbacks = mustLoadProtocolCapabilityFallbacks()

// mustLoadProtocolCapabilityFallbacks parses the embedded manifest at package
// initialization. The bytes are compiled into the binary and drift-tested, so a
// failure here is a build defect, and panicking at import time is the loudest
// available equivalent of failing startup when a required contract is missing.
func mustLoadProtocolCapabilityFallbacks() map[string]map[string]string {
	document, err := protocolschema.Bytes(protocolschema.PaywallV04Compatibility)
	if err != nil {
		panic(fmt.Sprintf("load embedded Protocol %s compatibility manifest: %v", ProtocolVersion, err))
	}
	var manifest struct {
		SchemaVersion string `json:"schemaVersion"`
		Capabilities  []struct {
			Name     string `json:"name"`
			Fallback string `json:"fallback"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(document, &manifest); err != nil {
		panic(fmt.Sprintf("decode embedded Protocol %s compatibility manifest: %v", ProtocolVersion, err))
	}
	if manifest.SchemaVersion != ProtocolVersion || len(manifest.Capabilities) == 0 {
		panic(fmt.Sprintf("embedded Protocol %s compatibility manifest does not describe Protocol %s", ProtocolVersion, ProtocolVersion))
	}
	fallbacks := make(map[string]string, len(manifest.Capabilities))
	for _, capability := range manifest.Capabilities {
		if capability.Name == "" || capability.Fallback == "" {
			panic(fmt.Sprintf("Protocol %s compatibility manifest carries a capability without a name or fallback", ProtocolVersion))
		}
		fallbacks[capability.Name] = capability.Fallback
	}
	return map[string]map[string]string{ProtocolVersion: fallbacks}
}

func knownPaywallProtocolVersion(version string) bool {
	_, known := protocolCapabilityFallbacks[version]
	return known
}

func knownPaywallCapability(version, name string) bool {
	_, known := protocolCapabilityFallbacks[version][name]
	return known
}

// paywallCapabilityFallback is the manifest fallback tier for a required
// capability, defaulting to rejectDocument for any name the manifest for that
// version does not carry.
func paywallCapabilityFallback(version, name string) string {
	if fallback, known := protocolCapabilityFallbacks[version][name]; known {
		return fallback
	}
	return capabilityFallbackRejectDocument
}
