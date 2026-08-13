package billingaccess

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// This file is the only place in Mosaic that produces Authoritative Entitlement
// Contract records. Two decisions make it the only place:
//
//  1. Records are built as map[string]any rather than as tagged structs. The
//     contract's canonical serialization must omit absent members and must
//     never emit null, and a tagged struct with pointer fields makes "absent"
//     and "null" one keystroke apart. A map cannot carry a member it was not
//     given.
//  2. The response body IS the canonical serialization. An SDK recomputes
//     contentDigest over what it received; if the body and the digested bytes
//     were produced by two different code paths, a digest mismatch would be a
//     serialization bug reported to users as cache corruption.

// ContractTimestamp renders an instant in the contract's fixed form: RFC 3339
// UTC with exactly three fractional digits and a literal Z. The precision is
// fixed rather than optional because the same instant at a different precision
// digests differently.
func ContractTimestamp(at time.Time) string {
	return at.UTC().Format("2006-01-02T15:04:05.000Z")
}

// CanonicalJSON renders the contract's canonical serialization: minified, keys
// ascending at every depth, array order preserved, absent members omitted.
//
// Go's encoder already sorts map keys and preserves slice order; HTML escaping
// is disabled because the contract requires minimal escaping and an escaped
// `&` would change the digest for a value no other implementation escapes.
func CanonicalJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("serialize contract record: %w", err)
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// contentDigest is SHA-256 over the canonical serialization of a payload with
// the excluded member removed. It is corruption and binding detection, not
// authentication: it covers the customer, Project, Environment, and snapshot
// version, so a snapshot cannot be accepted into another customer's cache.
func contentDigest(payload map[string]any, excludedMember string) (string, error) {
	reduced := make(map[string]any, len(payload))
	for key, value := range payload {
		if key == excludedMember {
			continue
		}
		reduced[key] = value
	}
	encoded, err := CanonicalJSON(reduced)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// Envelope wraps a payload in the contract's house envelope.
func Envelope(recordType string, payload map[string]any) map[string]any {
	return map[string]any{
		"authoritativeEntitlementContractVersion": ContractVersion,
		"recordType": recordType,
		"payload":    payload,
	}
}

// ---------------------------------------------------------------------------
// Vocabulary translation
// ---------------------------------------------------------------------------
//
// Phase 9B's storage vocabulary and the frozen contract vocabulary are not
// identical: the schema landed before the contracts froze, and the contract's
// enumerations are closed and over-provisioned in ways storage is not. The
// translation lives here, in one direction only (storage to wire), with an
// explicit default for every table. Anything not named falls back to the
// honest answer rather than to a guess.

// wireSourceType maps a stored entitlement-source type onto the contract's
// closed sourceType vocabulary.
func wireSourceType(stored string) string {
	switch stored {
	case "verified_grace_period":
		return "grace_period"
	case "accepted_billing_retry":
		return "billing_retry"
	case "active_subscription", "trial", "one_time_non_consumable", "family_shared":
		return stored
	default:
		// An unknown stored type is still a subscription source; reporting it
		// as a one-time purchase would tell a reader it never expires.
		return "active_subscription"
	}
}

// storedExplanations maps the projection engine's explanation codes onto the
// contract's closed explanationCode vocabulary.
var storedExplanations = map[string]string{
	"trial_active":               "active_trial_period",
	"verified_grace_period":      "active_grace_period",
	"billing_retry":              "active_billing_retry_allowance",
	"subscription_active":        "active_subscription_period",
	"subscription_trialing":      "active_trial_period",
	"subscription_grace_period":  "active_grace_period",
	"subscription_billing_retry": "active_billing_retry_allowance",
	"subscription_paused":        "subscription_paused",
	"subscription_expired":       "subscription_expired",
	"subscription_revoked":       "subscription_revoked",
	"subscription_refunded":      "subscription_refunded",
	"subscription_superseded":    "subscription_superseded",
	"subscription_unknown":       "no_qualifying_source",
	"one_time_purchase_owned":    "permanent_one_time_purchase",
	"one_time_purchase_refunded": "subscription_refunded",
	"one_time_purchase_revoked":  "subscription_revoked",
	"one_time_purchase_unknown":  "no_qualifying_source",
	"permanent_source_active":    "permanent_one_time_purchase",
	"no_active_source":           "no_qualifying_source",
	"unresolved_evidence":        "identity_unresolved",
	"family_shared":              "family_shared_source",
	"scheduled_pause_pending":    "scheduled_pause_not_yet_effective",
	"cancelled_access_until_end": "subscription_cancelled_access_until_period_end",
	"grant_version_ended":        "grant_version_ended",
	"product_unresolved":         "product_unresolved",
	"conflicting_facts":          "conflicting_facts",
	"projection_failed":          "projection_failed",
	"provider_evidence_stale":    "provider_evidence_stale",
	"unsupported_provider_state": "unsupported_provider_state",
}

// wireExplanation maps a stored explanation code onto the contract's closed
// vocabulary. An unmapped code becomes `no_qualifying_source`: a reader may
// render its own copy for a code it knows, but a producer must never invent
// one, and inventing one is exactly what passing an unmapped value through
// would do.
func wireExplanation(stored string, state string) string {
	if mapped, ok := storedExplanations[stored]; ok {
		return mapped
	}
	if state == "unknown" {
		return "identity_unresolved"
	}
	return "no_qualifying_source"
}

// wireUncertaintyForState refines a stored uncertainty reason so an
// uncertain state is always explainable. The contract requires that a
// non-definitive state carries a reason other than `none`; storage permits the
// combination, so it is repaired here rather than served.
func wireUncertaintyForState(state, reason string) string {
	if state == "active" || state == "inactive" {
		return reason
	}
	if reason == "" || reason == "none" {
		return "missing_fact"
	}
	return reason
}

// wireChangeReason maps the projection's stored change reason onto the
// contract's closed changeReason vocabulary.
func wireChangeReason(stored string, previousVersion int64) string {
	switch stored {
	case "initial_projection", "subscription_state_changed", "subscription_period_changed",
		"renewal_intent_changed", "source_added", "source_ended", "refund_applied",
		"revocation_applied", "grant_version_changed", "identity_changed",
		"identity_conflict_opened", "identity_conflict_resolved", "projection_replayed",
		"projection_rule_upgraded", "projection_recovered", "projection_failed",
		"manual_reprojection":
		return stored
	}
	if previousVersion == 0 {
		return "initial_projection"
	}
	return "subscription_state_changed"
}

// wireStorePlatform maps Mosaic's provider identifier onto the contract's
// storePlatform vocabulary. The second result is false when the provider is not
// one the contract can name.
//
// The vocabulary is a closed two-value enum, and the previous mapping reported
// everything that was not Apple — including an empty or unrecognised provider —
// as `google_play`. That is a statement about where a customer bought
// something, made on no evidence: a support agent, a refund tool, or an SDK
// branching on storePlatform would have been told a purchase came from a store
// Mosaic never saw. There is no third enum member to widen into, so an
// unmappable provider is reported as unmappable and each call site decides
// whether the field can be omitted (it is optional on a source summary) or the
// payload cannot be built at all (it is required on a subscription snapshot).
func wireStorePlatform(provider string) (string, bool) {
	switch provider {
	case "app_store", "apple_app_store":
		return "apple_app_store", true
	case "google_play", "play_store":
		return "google_play", true
	default:
		return "", false
	}
}

// SourceIdentity is the contract's stable source id, derived from (purchase
// lineage, Mosaic Product, grant version) and never from a fact identifier or a
// per-generation row id.
//
// It must be stable across snapshots: a reader resolves an entry's sourceIds
// against the sources array of the same snapshot, but an operator comparing two
// snapshots reads the same source under the same identity. The per-generation
// row id would change on every projection and make that comparison impossible.
func SourceIdentity(lineageID, productID, grantVersionID string) string {
	sum := sha256.Sum256([]byte("mosaic-entitlement-source-v1\x00" +
		lineageID + "\x00" + productID + "\x00" + grantVersionID))
	return "esrc." + hex.EncodeToString(sum[:16])
}

// EntityTag builds the opaque HTTP validator. It carries no ordering: a reader
// compares it for equality only, and snapshot monotonicity is decided by
// snapshotVersion alone.
func EntityTag(view SnapshotView) string {
	sum := sha256.Sum256([]byte(view.CustomerID + "\x00" + view.EnvironmentID + "\x00" +
		fmt.Sprint(view.SnapshotVersion) + "\x00" + hex.EncodeToString(view.Checksum)))
	return "ces." + hex.EncodeToString(sum[:12])
}

// ---------------------------------------------------------------------------
// Record builders
// ---------------------------------------------------------------------------

// projectionStatusRecord renders the projection health block. A degraded or
// failed projection does not make a snapshot unreadable; it makes the entries
// it could not determine unknown.
func projectionStatusRecord(status ProjectionStatus) map[string]any {
	record := map[string]any{
		"state":           status.State,
		"lastProjectedAt": ContractTimestamp(status.LastProjectedAt),
	}
	if status.State == ProjectionPending {
		record["pendingFactCount"] = status.PendingFactCount
	}
	if status.State == ProjectionDegraded || status.State == ProjectionFailed {
		code := status.DiagnosticCode
		if code == "" {
			code = "entitlement.projection.degraded"
		}
		record["diagnosticCode"] = code
	}
	return record
}

// uncertaintyRecord renders the uncertainty object. A definitive state carries
// no `since` instant; a non-definitive one always does.
func uncertaintyRecord(reason string, since time.Time, resolution string) map[string]any {
	if reason == "" {
		reason = "none"
	}
	record := map[string]any{"reason": reason}
	if reason == "none" {
		return record
	}
	record["since"] = ContractTimestamp(since)
	if resolution != "" {
		record["expectedResolution"] = resolution
	}
	return record
}

// expectedResolutionFor is guidance for a reader deciding whether to retry, not
// a promise.
func expectedResolutionFor(reason string) string {
	switch reason {
	case "provider_unavailable", "stale_validation":
		return "automatic_retry"
	case "missing_fact":
		return "next_provider_notification"
	case "projection_failed":
		return "next_projection_run"
	case "identity_unresolved", "conflicting_facts", "product_unresolved":
		return "operator_action"
	case "unsupported_provider_state":
		return "operator_action"
	default:
		return ""
	}
}

// sourceRecord renders one source summary. Mosaic Product and Subscription
// Instance identity live here and nowhere else, so two places cannot disagree
// when several sources grant one Entitlement.
func sourceRecord(source SnapshotSource, asOf time.Time) map[string]any {
	sourceType := wireSourceType(source.SourceType)
	record := map[string]any{
		"sourceId":        SourceIdentity(source.PurchaseLineageID, source.ProductID, source.GrantVersionID),
		"sourceType":      sourceType,
		"mosaicProductId": source.ProductID,
		"grantVersionId":  source.GrantVersionID,
		"sourceState":     wireSourceState(source.SourceState),
		"explanationCode": wireExplanation(source.ExplanationCode, source.SourceState),
		"isTestSource":    source.IsTestSource,
	}
	// sourceSnapshotId names the projected state generation this source cites.
	// A subscription source cites its Subscription Snapshot; a one-time source
	// has no snapshot row of its own, so it cites the per-generation source row
	// that recorded it, which is the same thing at a different granularity.
	if source.SourceSnapshotID != "" {
		record["sourceSnapshotId"] = source.SourceSnapshotID
	} else {
		record["sourceSnapshotId"] = source.RowID
	}
	if sourceType == "one_time_non_consumable" {
		record["oneTimePurchaseInstanceId"] = source.OneTimePurchaseInstanceID
	} else {
		record["subscriptionInstanceId"] = source.SubscriptionInstanceID
	}
	// storePlatform is optional on a source summary, so an unmappable provider
	// — including the empty string a lineage-less source carries — omits the
	// member. "Mosaic is not saying" is representable here; "google_play" would
	// have been a claim.
	if platform, ok := wireStorePlatform(source.StorePlatform); ok {
		record["storePlatform"] = platform
	}
	if source.SourceStart != nil {
		record["start"] = ContractTimestamp(*source.SourceStart)
	} else {
		record["start"] = ContractTimestamp(asOf)
	}
	// An absent end means this source has no finite end Mosaic can state. For a
	// permanent source that is a fact; for an uncertain source the uncertainty
	// explains why.
	if source.EndKnown && source.SourceEnd != nil {
		record["end"] = ContractTimestamp(*source.SourceEnd)
	}
	reason := source.UncertaintyReason
	if record["sourceState"] == "unknown" {
		reason = wireUncertaintyForState("unknown", reason)
	}
	record["uncertainty"] = uncertaintyRecord(reason, asOf, expectedResolutionFor(reason))
	return record
}

func wireSourceState(stored string) string {
	switch stored {
	case "active":
		return "granting"
	case "unknown":
		return "unknown"
	default:
		return "not_granting"
	}
}

// entryRecord renders one Entitlement entry. Product and Subscription Instance
// identity are deliberately absent: they live on the contributing sources.
func entryRecord(entry SnapshotEntry, sourceIDs []string, asOf time.Time) map[string]any {
	state := entry.State
	record := map[string]any{
		"entitlementId":  entry.EntitlementID,
		"entitlementKey": entry.EntitlementKey,
		"state":          state,
		"endKnown":       entry.EndKnown,
		"sourceIds":      sourceIDs,
		// sourceCount is the count of the sources actually named. Storing a
		// count that can disagree with the list is the defect the contract's
		// entry-source-count-disagrees fixture exists to catch.
		"sourceCount": len(sourceIDs),
		"primaryExplanation": map[string]any{
			"code": wireExplanation(entry.ExplanationCode, state),
		},
	}
	if entry.EffectiveStart != nil {
		record["effectiveStart"] = ContractTimestamp(*entry.EffectiveStart)
	} else if state == "active" {
		// An active entry must state when it started; falling back to the
		// evaluation instant keeps the record valid rather than unserializable.
		record["effectiveStart"] = ContractTimestamp(asOf)
	}
	if entry.EndKnown && entry.EffectiveEnd != nil {
		record["effectiveEnd"] = ContractTimestamp(*entry.EffectiveEnd)
	}
	if state == "unknown" {
		reason := wireUncertaintyForState(state, entry.UncertaintyReason)
		record["uncertainty"] = uncertaintyRecord(reason, asOf, expectedResolutionFor(reason))
	} else if entry.UncertaintyReason != "" && entry.UncertaintyReason != "none" {
		record["uncertainty"] = uncertaintyRecord(entry.UncertaintyReason, asOf,
			expectedResolutionFor(entry.UncertaintyReason))
	}
	return record
}

// SnapshotRecord builds the customerEntitlementSnapshot payload.
//
// requestedKeys, when non-empty, narrows the entries to those keys. Sources are
// narrowed with them so a reader never sees a source no entry references — the
// contract's orphan-source fixture is exactly that defect.
func SnapshotRecord(view SnapshotView, issuedAt time.Time, freshness Freshness, correlationID string, requestedKeys []string) (map[string]any, error) {
	freshness = freshness.Bounded()
	issuedAt = issuedAt.UTC()

	keyFilter := map[string]bool{}
	for _, key := range requestedKeys {
		keyFilter[key] = true
	}

	sourcesByRow := map[string]SnapshotSource{}
	for _, source := range view.Sources {
		sourcesByRow[source.RowID] = source
	}

	entries := make([]map[string]any, 0, len(view.Entries))
	usedSources := map[string]bool{}
	sortedEntries := append([]SnapshotEntry(nil), view.Entries...)
	sort.Slice(sortedEntries, func(i, j int) bool {
		return sortedEntries[i].EntitlementKey < sortedEntries[j].EntitlementKey
	})
	for _, entry := range sortedEntries {
		if len(keyFilter) > 0 && !keyFilter[entry.EntitlementKey] {
			continue
		}
		identities := make([]string, 0, len(entry.SourceIDs))
		for _, rowID := range entry.SourceIDs {
			source, ok := sourcesByRow[rowID]
			if !ok {
				continue
			}
			identity := SourceIdentity(source.PurchaseLineageID, source.ProductID, source.GrantVersionID)
			identities = append(identities, identity)
			usedSources[rowID] = true
		}
		sort.Strings(identities)
		identities = dedupe(identities)
		entries = append(entries, entryRecord(entry, identities, view.AsOf))
	}

	sources := make([]map[string]any, 0, len(view.Sources))
	sortedSources := append([]SnapshotSource(nil), view.Sources...)
	sort.Slice(sortedSources, func(i, j int) bool {
		left := SourceIdentity(sortedSources[i].PurchaseLineageID, sortedSources[i].ProductID, sortedSources[i].GrantVersionID)
		right := SourceIdentity(sortedSources[j].PurchaseLineageID, sortedSources[j].ProductID, sortedSources[j].GrantVersionID)
		return left < right
	})
	seenSource := map[string]bool{}
	for _, source := range sortedSources {
		if len(keyFilter) > 0 && !usedSources[source.RowID] {
			continue
		}
		identity := SourceIdentity(source.PurchaseLineageID, source.ProductID, source.GrantVersionID)
		if seenSource[identity] {
			continue
		}
		seenSource[identity] = true
		sources = append(sources, sourceRecord(source, view.AsOf))
	}

	payload := map[string]any{
		"snapshotId":            view.SnapshotID,
		"billingCustomerId":     view.CustomerID,
		"projectId":             view.ProjectID,
		"environmentId":         view.EnvironmentID,
		"snapshotVersion":       view.SnapshotVersion,
		"projectionRuleVersion": view.RuleVersion,
		"issuedAt":              ContractTimestamp(issuedAt),
		"asOf":                  ContractTimestamp(view.AsOf),
		"refreshAfter":          ContractTimestamp(issuedAt.Add(freshness.RefreshAfter)),
		"validUntil":            ContractTimestamp(issuedAt.Add(freshness.ValidFor)),
		"staleGraceSeconds":     int(freshness.StaleGrace / time.Second),
		"entityTag":             EntityTag(view),
		"entries":               entries,
		"sources":               sources,
		"projectionStatus":      projectionStatusRecord(view.Projection),
		"changeReason":          wireChangeReason(view.ChangeReason, view.PreviousSnapshotVersion),
		"correlationId":         safeCorrelation(correlationID),
	}
	if view.PreviousSnapshotVersion > 0 {
		payload["previousSnapshotVersion"] = view.PreviousSnapshotVersion
	}
	digest, err := contentDigest(payload, "contentDigest")
	if err != nil {
		return nil, err
	}
	payload["contentDigest"] = digest
	return payload, nil
}

// UnchangedRecord builds the snapshotUnchanged payload. It carries no entries:
// it confirms the cached snapshot and slides its freshness window, so a
// confirmed-current snapshot never expires merely because it was confirmed
// instead of resent.
func UnchangedRecord(view SnapshotView, issuedAt time.Time, freshness Freshness, correlationID string) map[string]any {
	freshness = freshness.Bounded()
	issuedAt = issuedAt.UTC()
	return map[string]any{
		"billingCustomerId": view.CustomerID,
		"projectId":         view.ProjectID,
		"environmentId":     view.EnvironmentID,
		"snapshotVersion":   view.SnapshotVersion,
		"entityTag":         EntityTag(view),
		"issuedAt":          ContractTimestamp(issuedAt),
		"asOf":              ContractTimestamp(view.AsOf),
		"refreshAfter":      ContractTimestamp(issuedAt.Add(freshness.RefreshAfter)),
		"validUntil":        ContractTimestamp(issuedAt.Add(freshness.ValidFor)),
		"staleGraceSeconds": int(freshness.StaleGrace / time.Second),
		"projectionStatus":  projectionStatusRecord(view.Projection),
		"correlationId":     safeCorrelation(correlationID),
	}
}

// CheckResultRecord builds the entitlementCheckResult payload. The answer is
// never a bare boolean: every key carries a state, an explanation, and the
// snapshot version and as-of instant it was derived from.
//
// A nil view means no snapshot could be read at all, in which case every result
// is `unavailable` — which says Mosaic could not answer, not that the customer
// lacks access.
func CheckResultRecord(customerID, projectID, environmentID string, view *SnapshotView, keys []string,
	issuedAt time.Time, correlationID string, unavailableReason, unavailableExplanation string) map[string]any {

	issuedAt = issuedAt.UTC()
	requested := append([]string(nil), keys...)
	sort.Strings(requested)
	requested = dedupe(requested)

	results := make([]map[string]any, 0, len(requested))
	if view == nil {
		since := issuedAt
		for _, key := range requested {
			results = append(results, map[string]any{
				"entitlementKey": key,
				"state":          "unavailable",
				"sourceCount":    0,
				"endKnown":       false,
				"primaryExplanation": map[string]any{
					"code": unavailableExplanation,
				},
				"uncertainty": uncertaintyRecord(unavailableReason, since,
					expectedResolutionFor(unavailableReason)),
			})
		}
		return map[string]any{
			"billingCustomerId": customerID,
			"projectId":         projectID,
			"environmentId":     environmentID,
			"issuedAt":          ContractTimestamp(issuedAt),
			"results":           results,
			"correlationId":     safeCorrelation(correlationID),
		}
	}

	byKey := map[string]SnapshotEntry{}
	for _, entry := range view.Entries {
		byKey[entry.EntitlementKey] = entry
	}
	sourcesByRow := map[string]SnapshotSource{}
	for _, source := range view.Sources {
		sourcesByRow[source.RowID] = source
	}

	for _, key := range requested {
		entry, found := byKey[key]
		if !found {
			// A key the Project defines but no source contributes to is
			// inactive, not unknown: the absence is definite.
			results = append(results, map[string]any{
				"entitlementKey": key,
				"state":          "inactive",
				"sourceCount":    0,
				"endKnown":       true,
				"primaryExplanation": map[string]any{
					"code": "no_qualifying_source",
				},
			})
			continue
		}
		identities := make([]string, 0, len(entry.SourceIDs))
		testSource := false
		for _, rowID := range entry.SourceIDs {
			source, ok := sourcesByRow[rowID]
			if !ok {
				continue
			}
			identities = append(identities, SourceIdentity(source.PurchaseLineageID, source.ProductID, source.GrantVersionID))
			if source.IsTestSource {
				testSource = true
			}
		}
		sort.Strings(identities)
		identities = dedupe(identities)

		result := map[string]any{
			"entitlementKey": key,
			"state":          entry.State,
			"sourceCount":    len(identities),
			"endKnown":       entry.EndKnown,
			"primaryExplanation": map[string]any{
				"code": wireExplanation(entry.ExplanationCode, entry.State),
			},
		}
		if len(identities) > 0 {
			result["sourceIds"] = identities
		}
		if entry.EffectiveStart != nil {
			result["effectiveStart"] = ContractTimestamp(*entry.EffectiveStart)
		}
		if entry.EndKnown && entry.EffectiveEnd != nil {
			result["effectiveEnd"] = ContractTimestamp(*entry.EffectiveEnd)
		}
		if testSource {
			result["isTestSource"] = true
		}
		if entry.State == "unknown" {
			reason := wireUncertaintyForState(entry.State, entry.UncertaintyReason)
			result["uncertainty"] = uncertaintyRecord(reason, view.AsOf, expectedResolutionFor(reason))
		}
		results = append(results, result)
	}

	return map[string]any{
		"billingCustomerId":     customerID,
		"projectId":             projectID,
		"environmentId":         environmentID,
		"snapshotVersion":       view.SnapshotVersion,
		"projectionRuleVersion": view.RuleVersion,
		"issuedAt":              ContractTimestamp(issuedAt),
		"asOf":                  ContractTimestamp(view.AsOf),
		"results":               results,
		"projectionStatus":      projectionStatusRecord(view.Projection),
		"correlationId":         safeCorrelation(correlationID),
	}
}

// SubscriptionRecord builds the subscriptionSnapshot payload.
func SubscriptionRecord(view SubscriptionView, correlationID string) (map[string]any, error) {
	// storePlatform is required on a subscription snapshot and its vocabulary is
	// closed, so there is no honest payload for a provider Mosaic cannot name.
	// Refusing to build one is the fail-closed answer: the caller reports the
	// snapshot as unavailable instead of publishing a fabricated store.
	storePlatform, mappable := wireStorePlatform(view.StorePlatform)
	if !mappable {
		return nil, fmt.Errorf("%w: subscription snapshot %q names store platform %q, which the contract cannot express",
			ErrUnrepresentable, view.SnapshotID, view.StorePlatform)
	}
	payload := map[string]any{
		"subscriptionSnapshotId": view.SnapshotID,
		"subscriptionInstanceId": view.SubscriptionInstanceID,
		"billingCustomerId":      view.CustomerID,
		"projectId":              view.ProjectID,
		"environmentId":          view.EnvironmentID,
		"projectionVersion":      view.ProjectionVersion,
		"projectionRuleVersion":  view.RuleVersion,
		"computedAt":             ContractTimestamp(view.ComputedAt),
		"asOf":                   ContractTimestamp(view.AsOf),
		"storePlatform":          storePlatform,
		"mosaicProductId":        view.ProductID,
		"accessState":            view.AccessState,
		"lifecycleState":         view.LifecycleState,
		"renewalIntent":          view.RenewalIntent,
		"billingState":           view.BillingState,
		"isTestSource":           view.IsTestSource,
		"changeReason":           wireChangeReason(view.ChangeReason, view.ProjectionVersion-1),
		"correlationId":          safeCorrelation(correlationID),
	}
	reason := wireUncertaintyForState(view.AccessState, view.UncertaintyReason)
	payload["uncertainty"] = uncertaintyRecord(reason, view.AsOf, expectedResolutionFor(reason))

	if view.PurchaseLineageID != "" {
		payload["purchaseLineageId"] = view.PurchaseLineageID
	}
	if view.PriorProductID != "" {
		payload["priorMosaicProductId"] = view.PriorProductID
	}
	if view.SupersededByInstanceID != "" {
		payload["supersededBySubscriptionInstanceId"] = view.SupersededByInstanceID
	}
	if view.ExplanationCode != "" {
		payload["explanationCode"] = wireExplanation(view.ExplanationCode, view.AccessState)
	}
	if view.SourceFactCount > 0 {
		payload["sourceFactCount"] = view.SourceFactCount
	}
	for member, instant := range map[string]*time.Time{
		"periodStart":             view.PeriodStart,
		"periodEnd":               view.PeriodEnd,
		"gracePeriodEnd":          view.GracePeriodEnd,
		"billingRetryStart":       view.BillingRetryStart,
		"pauseEffectiveAt":        view.PauseEffectiveAt,
		"pauseResumeAt":           view.PauseResumeAt,
		"cancellationEffectiveAt": view.CancellationEffectiveAt,
		"expirationEffectiveAt":   view.ExpirationEffectiveAt,
		"revocationEffectiveAt":   view.RevocationEffectiveAt,
		"refundEffectiveAt":       view.RefundEffectiveAt,
	} {
		if instant != nil {
			payload[member] = ContractTimestamp(*instant)
		}
	}
	checksum, err := contentDigest(payload, "checksum")
	if err != nil {
		return nil, err
	}
	payload["checksum"] = checksum
	return payload, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func dedupe(values []string) []string {
	if len(values) < 2 {
		return values
	}
	result := values[:1]
	for _, value := range values[1:] {
		if value != result[len(result)-1] {
			result = append(result, value)
		}
	}
	return result
}

// safeCorrelation bounds a caller-supplied correlation id to the contract's
// identifier shape. A caller cannot inject control characters, a newline, or an
// unbounded string into a record Mosaic signs its own name to.
func safeCorrelation(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "mosaic"
	}
	if len(value) > 128 {
		value = value[:128]
	}
	cleaned := make([]rune, 0, len(value))
	for index, char := range value {
		switch {
		case char >= 'A' && char <= 'Z', char >= 'a' && char <= 'z', char >= '0' && char <= '9':
			cleaned = append(cleaned, char)
		case index > 0 && (char == '.' || char == '_' || char == ':' || char == '-'):
			cleaned = append(cleaned, char)
		}
	}
	if len(cleaned) == 0 {
		return "mosaic"
	}
	return string(cleaned)
}
