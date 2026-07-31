package billingaccess

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingmigration"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const maximumSemanticVersion = "99999999999999999999999999999999999999.0.0"

type AuthoritySyncRequest struct {
	KnownAuthorityEpoch          *int64
	KnownSnapshotVersion         *int64
	KnownSnapshotAuthorityDigest string
	ApplicationID                string
	Platform                     string
	AppVersion                   string
	SDKVersion                   string
	SupportedContractVersions    []string
	Capabilities                 []string
}

func authorityScopeRecord(scope AuthorityScope) map[string]any {
	return map[string]any{
		"projectId": scope.ProjectID, "environmentId": scope.EnvironmentID,
		"applicationId": scope.ApplicationID, "platform": scope.Platform,
	}
}

func minimumSupportRecord(support MinimumSupport) map[string]any {
	window := map[string]any{"minimumInclusive": support.MinimumAppVersion}
	if support.MaximumAppVersion != "" {
		window["maximumInclusive"] = support.MaximumAppVersion
	}
	return map[string]any{
		"minimumContractVersion":    AuthorityContractVersion,
		"minimumSdkVersion":         support.MinimumSDKVersion,
		"supportedAppVersionWindow": window,
		"requiredCapabilities":      append([]string(nil), support.RequiredCapabilities...),
	}
}

func authorityRecord(selection AuthoritySelection) map[string]any {
	record := map[string]any{
		"authorityEpoch":  selection.AuthorityEpoch,
		"authorityKind":   selection.AuthorityKind,
		"scope":           authorityScopeRecord(selection.Scope),
		"transitionState": selection.TransitionState,
	}
	if selection.CutoverAt != nil {
		record["cutoverAt"] = ContractTimestamp(*selection.CutoverAt)
	}
	return record
}

func authorityEnvelope(recordType string, payload map[string]any) map[string]any {
	return map[string]any{
		"authoritativeEntitlementContractVersion": AuthorityContractVersion,
		"recordType": recordType,
		"payload":    payload,
	}
}

func snapshotAuthorityDigest(authority, snapshot map[string]any) (string, error) {
	encoded, err := CanonicalJSON(map[string]any{"authority": authority, "snapshot": snapshot})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func observationDigest(snapshotDigest, customerID string) []byte {
	sum := sha256.Sum256([]byte("mosaic-authority-sync-observation-v1\x00" + snapshotDigest + "\x00" + customerID))
	return sum[:]
}

func containsAll(offered, required []string) bool {
	held := make(map[string]struct{}, len(offered))
	for _, value := range offered {
		held[value] = struct{}{}
	}
	for _, value := range required {
		if _, ok := held[value]; !ok {
			return false
		}
	}
	return true
}

func supportedVersion(value, minimum, maximum string) bool {
	if maximum == "" {
		maximum = maximumSemanticVersion
	}
	ok, err := billingmigration.SemanticVersionInRange(value, minimum, maximum)
	return err == nil && ok
}

func (s *Service) authorityUnavailable(scope AuthorityScope, support MinimumSupport, reason string) (SyncResult, error) {
	payload, err := CanonicalJSON(authorityEnvelope("authorityUnavailable", map[string]any{
		"scope": authorityScopeRecord(scope), "result": "unavailable", "reason": reason,
		"minimumSupport": minimumSupportRecord(support),
	}))
	return SyncResult{Payload: payload}, err
}

func (s *Service) policyUnavailable(scope AuthorityScope) (SyncResult, error) {
	payload, err := CanonicalJSON(authorityEnvelope("authorityUnavailable", map[string]any{
		"scope": authorityScopeRecord(scope), "result": "unavailable", "reason": "policy_unavailable",
	}))
	return SyncResult{Payload: payload}, err
}

// SyncAuthorityV2 serves only the exact authenticated Application/platform
// scope and CAT-bound customer. It never consults a provider or the legacy
// global pointer.
func (s *Service) SyncAuthorityV2(ctx context.Context, authenticated AuthenticatedToken, request AuthoritySyncRequest) (SyncResult, error) {
	ctx, span := s.tracer.Start(ctx, "billing.entitlement.sync.v2")
	defer span.End()
	started := s.now()
	defer func() { s.syncLatency.Record(ctx, float64(s.now().Sub(started).Milliseconds())) }()

	token, sdk := authenticated.Token, authenticated.SDKKey
	scope := AuthorityScope{ProjectID: token.ProjectID, EnvironmentID: token.EnvironmentID,
		ApplicationID: sdk.ApplicationID, Platform: sdk.Platform}
	if !token.HasScope(ScopeEntitlementsRead) && !token.HasScope(ScopeEntitlementsSync) {
		return SyncResult{}, ErrForbidden
	}
	if err := s.requireEnabled(ctx, token.ProjectID); err != nil {
		return SyncResult{}, err
	}

	// Request copies are verification only. The authenticated values remain the
	// selector even when these copies disagree.
	if request.ApplicationID != scope.ApplicationID || request.Platform != scope.Platform {
		support, err := s.repository.MinimumSupport(ctx, scope)
		if errors.Is(err, ErrNotFound) {
			return s.policyUnavailable(scope)
		}
		if err != nil {
			return SyncResult{}, err
		}
		return s.authorityUnavailable(scope, support, "scope_mismatch")
	}

	selection, err := s.repository.AuthoritySelection(ctx, scope, token.CustomerID, s.now())
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			return SyncResult{}, err
		}
		support, supportErr := s.repository.MinimumSupport(ctx, scope)
		if errors.Is(supportErr, ErrNotFound) {
			result, encodeErr := s.policyUnavailable(scope)
			s.appendAuthorityObservation(ctx, token.CustomerID, request, AuthoritySelection{Scope: scope}, "unknown_authority", "")
			return result, encodeErr
		}
		if supportErr != nil {
			return SyncResult{}, supportErr
		}
		result, encodeErr := s.authorityUnavailable(scope, support, "authority_unknown")
		s.appendAuthorityObservation(ctx, token.CustomerID, request, AuthoritySelection{Scope: scope, ProgramID: support.ProgramID, MinimumSupport: support}, "unknown_authority", "")
		return result, encodeErr
	}

	if !containsAll(request.SupportedContractVersions, []string{AuthorityContractVersion}) ||
		!containsAll(request.Capabilities, selection.MinimumSupport.RequiredCapabilities) ||
		!supportedVersion(request.SDKVersion, selection.MinimumSupport.MinimumSDKVersion, "") {
		result, encodeErr := s.authorityUnavailable(scope, selection.MinimumSupport, "unsupported_contract")
		s.appendAuthorityObservation(ctx, token.CustomerID, request, selection, "rejected", "")
		return result, encodeErr
	}
	if !supportedVersion(request.AppVersion, selection.MinimumSupport.MinimumAppVersion, selection.MinimumSupport.MaximumAppVersion) {
		result, encodeErr := s.authorityUnavailable(scope, selection.MinimumSupport, "unsupported_app_version")
		s.appendAuthorityObservation(ctx, token.CustomerID, request, selection, "rejected", "")
		return result, encodeErr
	}

	if status, statusErr := s.repository.ProjectionStatusFor(ctx, token.ProjectID, token.EnvironmentID, token.CustomerID); statusErr == nil {
		selection.Snapshot.Projection = status
	}
	issuedAt := s.now()
	authority := authorityRecord(selection)
	fullSnapshot, err := SnapshotRecord(selection.Snapshot, issuedAt, s.freshness, "", nil)
	if err != nil {
		return SyncResult{}, err
	}
	digest, err := snapshotAuthorityDigest(authority, fullSnapshot)
	if err != nil {
		return SyncResult{}, err
	}

	unchanged := request.KnownAuthorityEpoch != nil && *request.KnownAuthorityEpoch == selection.AuthorityEpoch &&
		request.KnownSnapshotVersion != nil && *request.KnownSnapshotVersion == selection.Snapshot.SnapshotVersion &&
		request.KnownSnapshotAuthorityDigest != ""
	if unchanged {
		decoded, decodeErr := hex.DecodeString(strings.TrimPrefix(request.KnownSnapshotAuthorityDigest, "sha256:"))
		if decodeErr != nil || len(decoded) != sha256.Size {
			unchanged = false
		} else {
			unchanged, err = s.repository.ObservedSnapshotDigest(ctx, selection,
				observationDigest(request.KnownSnapshotAuthorityDigest, token.CustomerID))
			if err != nil {
				return SyncResult{}, err
			}
		}
	}

	bounded := s.freshness.Bounded()
	result := SyncResult{EntityTag: EntityTag(selection.Snapshot), RefreshAfter: issuedAt.Add(bounded.RefreshAfter),
		ValidUntil: issuedAt.Add(bounded.ValidFor), StaleGrace: bounded.StaleGrace}
	if unchanged {
		payload := map[string]any{
			"authority":               authority,
			"unchanged":               UnchangedRecord(selection.Snapshot, issuedAt, s.freshness, ""),
			"snapshotAuthorityDigest": request.KnownSnapshotAuthorityDigest,
			"minimumSupport":          minimumSupportRecord(selection.MinimumSupport),
		}
		result.Payload, err = CanonicalJSON(authorityEnvelope("snapshotUnchanged", payload))
		result.Unchanged = true
		digest = request.KnownSnapshotAuthorityDigest
	} else {
		payload := map[string]any{"authority": authority, "snapshot": fullSnapshot,
			"snapshotAuthorityDigest": digest, "minimumSupport": minimumSupportRecord(selection.MinimumSupport)}
		result.Payload, err = CanonicalJSON(authorityEnvelope("customerEntitlementSnapshot", payload))
	}
	if err != nil {
		return SyncResult{}, err
	}
	s.appendAuthorityObservation(ctx, token.CustomerID, request, selection, "accepted", digest)
	s.syncResults.Add(ctx, 1, metric.WithAttributes(attribute.String("result", map[bool]string{true: "v2_unchanged", false: "v2_snapshot"}[unchanged])))
	span.SetAttributes(attribute.Int64("mosaic.billing.authority.epoch", selection.AuthorityEpoch))
	return result, nil
}

func (s *Service) appendAuthorityObservation(ctx context.Context, customerID string, request AuthoritySyncRequest,
	selection AuthoritySelection, result, snapshotDigest string) {
	versions := append([]string(nil), request.SupportedContractVersions...)
	sort.Strings(versions)
	capabilities := append([]string(nil), request.Capabilities...)
	sort.Strings(capabilities)
	digest := observationDigest(snapshotDigest, customerID)
	if snapshotDigest == "" {
		encoded, _ := CanonicalJSON(map[string]any{"applicationId": selection.Scope.ApplicationID,
			"platform": selection.Scope.Platform, "appVersion": request.AppVersion, "sdkVersion": request.SDKVersion,
			"contracts": versions, "capabilities": capabilities, "epoch": selection.AuthorityEpoch, "result": result})
		sum := sha256.Sum256(encoded)
		digest = sum[:]
	}
	err := s.repository.AppendSyncObservation(ctx, SyncObservation{ProgramID: selection.ProgramID, Scope: selection.Scope,
		AppVersion: request.AppVersion, SDKVersion: request.SDKVersion, SupportedContractVersions: versions,
		Capabilities: capabilities, AuthorityEpoch: selection.AuthorityEpoch, Result: result,
		Digest: digest, ObservedAt: s.now()})
	if err != nil {
		zerolog.Ctx(ctx).Debug().Str("application_id", selection.Scope.ApplicationID).
			Str("platform", selection.Scope.Platform).Msg("v2 sync observation not recorded")
	}
}
