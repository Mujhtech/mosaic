package hostedpublishing

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

var (
	ErrUnauthenticated         = errors.New("unauthenticated")
	ErrForbidden               = errors.New("forbidden")
	ErrNotFound                = errors.New("not found")
	ErrConflict                = errors.New("conflict")
	ErrArchived                = errors.New("resource archived")
	ErrPreconditionRequired    = errors.New("precondition required")
	ErrDraftRevisionConflict   = errors.New("draft revision conflict")
	ErrIdempotencyConflict     = errors.New("idempotency conflict")
	ErrValidationFailed        = errors.New("validation failed")
	ErrProductInvalid          = errors.New("product invalid")
	ErrProviderReadiness       = errors.New("provider readiness unavailable")
	ErrPlacementUnpublished    = errors.New("placement has no published paywall")
	ErrAssetStorageUnavailable = errors.New("hosted asset storage unavailable")
	ErrAssetInvalid            = errors.New("asset is invalid")
	ErrAssetNotReady           = errors.New("asset is not ready")
	ErrAssetReferenced         = errors.New("asset is referenced")
	ErrAssetStorage            = errors.New("asset storage operation failed")
	// ErrAssetObjectMissing means the Asset row exists but its immutable bytes
	// are absent from object storage -- the state a failed or partial restore
	// leaves behind. It is a 404, not a 500: the request named something that
	// is not there, and an SDK must be able to tell that from "Mosaic is
	// broken" so it can fall back to its bundled Asset.
	ErrAssetObjectMissing    = errors.New("asset object is missing from storage")
	ErrNoCurrentRelease      = errors.New("no current release")
	ErrUnsupportedCapability = errors.New("unsupported capability")
	// ErrReleaseProtocolMixed refuses publication of a Configuration Release
	// whose Paywall Versions span more than one Paywall Protocol version. The
	// frozen Configuration Delivery contracts (v1, v2, and v3) pin
	// compatibility.paywallProtocols to exactly one entry and every shipped SDK
	// decoder enforces exactly-one, so a mixed Release would be schema-invalid
	// and hard-fail every SDK decode. Publishing refuses instead; see
	// ReleaseProtocolMixError for the operator-facing detail.
	ErrReleaseProtocolMixed = errors.New("release mixes paywall protocol versions")
	// ErrReleaseProtocolUndeliverable refuses publication of a Configuration
	// Release whose Paywalls declare a Paywall Protocol version no frozen
	// Configuration Delivery contract can express. Delivery v1, v2, and v3 all
	// pin Protocol 0.3 structurally, so a 0.4 Release published today would be
	// an undecodable payload, not a deliverable one; publishing refuses instead
	// until the new Delivery version deferred in docs/protocol/v0.4.md
	// ("Configuration Delivery cannot yet carry 0.4") ships. See
	// ReleaseProtocolUndeliverableError for the operator-facing detail.
	ErrReleaseProtocolUndeliverable = errors.New("release protocol version has no delivery contract")
)

type ConflictError struct {
	Revision  int64
	ETag      string
	UpdatedAt time.Time
	ActorID   string
}

func (e *ConflictError) Error() string { return "draft revision is stale" }
func (e *ConflictError) Unwrap() error { return ErrDraftRevisionConflict }

type ValidationError struct {
	Errors []string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("document validation failed: %v", e.Errors)
}
func (e *ValidationError) Unwrap() error { return ErrValidationFailed }

// ReleaseProtocolMixError names, per protocol version, the Paywalls that would
// have shipped on it, so the operator can see exactly which Paywalls must be
// republished to make the Release version-homogeneous.
type ReleaseProtocolMixError struct {
	// PaywallIDsByProtocolVersion maps each Paywall Protocol version in the
	// refused Release to the sorted Paywall IDs carried on it.
	PaywallIDsByProtocolVersion map[string][]string
}

func (e *ReleaseProtocolMixError) Error() string {
	versions := make([]string, 0, len(e.PaywallIDsByProtocolVersion))
	for version := range e.PaywallIDsByProtocolVersion {
		versions = append(versions, version)
	}
	sort.Strings(versions)
	parts := make([]string, 0, len(versions))
	for _, version := range versions {
		parts = append(parts, fmt.Sprintf("protocol %s: %s", version, strings.Join(e.PaywallIDsByProtocolVersion[version], ", ")))
	}
	return "a configuration release must carry paywalls on a single paywall protocol version (" +
		strings.Join(parts, "; ") + "); republish the outdated paywalls on one version, then publish again"
}
func (e *ReleaseProtocolMixError) Unwrap() error { return ErrReleaseProtocolMixed }

// ReleaseProtocolUndeliverableError names, per undeliverable protocol version,
// the Paywalls that declare it, so the operator can see exactly which Paywalls
// must stay on a deliverable version until a Delivery contract for the new one
// ships.
type ReleaseProtocolUndeliverableError struct {
	// PaywallIDsByProtocolVersion maps each undeliverable Paywall Protocol
	// version in the refused Release to the sorted Paywall IDs declaring it.
	PaywallIDsByProtocolVersion map[string][]string
}

func (e *ReleaseProtocolUndeliverableError) Error() string {
	versions := make([]string, 0, len(e.PaywallIDsByProtocolVersion))
	for version := range e.PaywallIDsByProtocolVersion {
		versions = append(versions, version)
	}
	sort.Strings(versions)
	parts := make([]string, 0, len(versions))
	for _, version := range versions {
		parts = append(parts, fmt.Sprintf("protocol %s: %s", version, strings.Join(e.PaywallIDsByProtocolVersion[version], ", ")))
	}
	return "no configuration delivery contract can carry these paywalls' protocol version yet (" +
		strings.Join(parts, "; ") + "); keep them on protocol " + ProtocolVersion +
		" until the delivery contract extension tracked in docs/protocol/v0.4.md ships"
}
func (e *ReleaseProtocolUndeliverableError) Unwrap() error { return ErrReleaseProtocolUndeliverable }

type ProviderReadinessError struct {
	Blockers []ProviderPublicationIssue
}

func (e *ProviderReadinessError) Error() string {
	return fmt.Sprintf("provider readiness unavailable: %v", e.Blockers)
}
func (e *ProviderReadinessError) Unwrap() error { return ErrProviderReadiness }
