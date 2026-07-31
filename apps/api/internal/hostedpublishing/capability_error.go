package hostedpublishing

import (
	"errors"
	"strings"
)

// CapabilityError names the exact negotiation term that made a Configuration
// Release undeliverable to the requesting SDK.
//
// A bare 406 that says only "the SDK does not support this Configuration
// Release" is undiagnosable: an integrator has no path from the response to the
// header they must add or the SDK version they must ship. Every negotiation
// refusal therefore carries the requirement it failed, the capability or
// contract name involved, its version where one applies, and why it failed.
//
// Nothing here is tenant data or a secret: these are protocol vocabulary terms
// that already appear in the SDK's own request headers and in the published
// protocol contracts.
type CapabilityError struct {
	// Requirement is the negotiation term, in the vocabulary of the request
	// headers and the protocol contracts (for example
	// "experimentFeature" or "configurationDeliveryVersion").
	Requirement string
	// Name is the capability, feature, algorithm, or policy identifier. It is
	// empty when the requirement is itself version-shaped.
	Name string
	// Version is the contract or capability version, where one applies.
	Version string
	// Reason is why negotiation failed.
	Reason CapabilityFailureReason
}

// CapabilityFailureReason is the closed set of negotiation failure modes.
type CapabilityFailureReason string

const (
	// CapabilityMissing: the Release requires it, the SDK did not advertise it.
	CapabilityMissing CapabilityFailureReason = "missing"
	// CapabilityUnknown: the SDK advertised a term Mosaic does not define.
	CapabilityUnknown CapabilityFailureReason = "unknown"
	// CapabilityUnsupported: the value is defined but not accepted here.
	CapabilityUnsupported CapabilityFailureReason = "unsupported"
	// CapabilityDuplicate: the SDK advertised the same term twice.
	CapabilityDuplicate CapabilityFailureReason = "duplicate"
	// CapabilityMalformed: the advertised value could not be parsed, is empty,
	// or exceeded the allowed count.
	CapabilityMalformed CapabilityFailureReason = "malformed"
	// CapabilityUnavailable: the Release has no representation the SDK can read.
	CapabilityUnavailable CapabilityFailureReason = "unavailable"
)

func (e *CapabilityError) Error() string {
	return "unsupported capability: " + e.Detail()
}

// Unwrap keeps errors.Is(err, ErrUnsupportedCapability) true so every existing
// caller and status mapping continues to work unchanged.
func (e *CapabilityError) Unwrap() error { return ErrUnsupportedCapability }

// Subject renders the failing term as it appears in the protocol vocabulary.
func (e *CapabilityError) Subject() string {
	switch {
	case e.Name != "" && e.Version != "":
		return e.Name + "@" + e.Version
	case e.Name != "":
		return e.Name
	default:
		return e.Version
	}
}

// Detail is the human-readable sentence returned to the caller. It states the
// requirement, the failing value, and the reason.
func (e *CapabilityError) Detail() string {
	subject := e.Subject()
	var builder strings.Builder
	builder.WriteString(e.Requirement)
	if subject != "" {
		builder.WriteString(" ")
		builder.WriteString(subject)
	}
	switch e.Reason {
	case CapabilityMissing:
		builder.WriteString(" is required by this Configuration Release but was not advertised by the SDK")
	case CapabilityUnknown:
		builder.WriteString(" is not a capability Mosaic defines")
	case CapabilityUnsupported:
		builder.WriteString(" is not supported by this Mosaic installation")
	case CapabilityDuplicate:
		builder.WriteString(" was advertised more than once")
	case CapabilityMalformed:
		builder.WriteString(" was missing, empty, malformed, or advertised too many values")
	case CapabilityUnavailable:
		builder.WriteString(" has no representation this Configuration Release can serve")
	default:
		builder.WriteString(" could not be negotiated")
	}
	return builder.String()
}

// NewCapabilityError builds a negotiation refusal. The transport layer uses it
// for the refusals it can only detect while parsing request headers.
func NewCapabilityError(requirement, name, version string, reason CapabilityFailureReason) error {
	return &CapabilityError{Requirement: requirement, Name: name, Version: version, Reason: reason}
}

// unsupportedCapability builds a negotiation refusal.
func unsupportedCapability(requirement, name, version string, reason CapabilityFailureReason) error {
	return NewCapabilityError(requirement, name, version, reason)
}

// CapabilityFailure extracts the negotiation detail from an error, if present.
func CapabilityFailure(err error) (*CapabilityError, bool) {
	var capabilityError *CapabilityError
	if errors.As(err, &capabilityError) {
		return capabilityError, true
	}
	return nil, false
}
