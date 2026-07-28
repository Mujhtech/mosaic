package billingprojection

import (
	"crypto/sha256"
	"sort"
	"strconv"
	"time"
)

// Checksums are what make "no change" a fact rather than an assumption. A
// replay that produces a checksum equal to the committed one writes no
// snapshot, emits no webhook, and advances the checkpoint — so a projection
// storm cannot manufacture customer-visible churn.
//
// They deliberately exclude `as_of` and computed-at: those advance on every
// run by construction, and including them would make every replay a change.
// They also exclude source fact ids, so re-recording the same meaning under a
// new validator version is not, by itself, an access change.

func digest(domain string, fields ...string) []byte {
	hasher := sha256.New()
	hasher.Write([]byte(domain))
	for _, field := range fields {
		hasher.Write([]byte{0})
		hasher.Write([]byte(field))
	}
	return hasher.Sum(nil)
}

func stamp(value *time.Time) string {
	if value == nil || value.IsZero() {
		return ""
	}
	return strconv.FormatInt(value.UTC().UnixMilli(), 10)
}

func subscriptionChecksum(snapshot SubscriptionSnapshot) []byte {
	return digest("mosaic-subscription-snapshot-v1",
		strconv.Itoa(RuleVersion),
		snapshot.AccessState,
		snapshot.LifecycleState,
		snapshot.RenewalIntent,
		snapshot.BillingState,
		snapshot.UncertaintyReason,
		stamp(snapshot.PeriodStartAt),
		stamp(snapshot.PeriodEndAt),
		stamp(snapshot.GracePeriodEndAt),
		stamp(snapshot.BillingRetryStartAt),
		stamp(snapshot.PauseStartAt),
		stamp(snapshot.PauseResumeAt),
		stamp(snapshot.CancellationEffectiveAt),
		stamp(snapshot.ExpirationEffectiveAt),
		stamp(snapshot.RevocationEffectiveAt),
		stamp(snapshot.RefundEffectiveAt),
		snapshot.CurrentProductID,
		snapshot.PriorProductID,
		snapshot.ScheduledProductIdentifier,
		strconv.FormatBool(snapshot.IsTestSource),
		strconv.FormatBool(snapshot.Terminal),
	)
}

func oneTimeChecksum(snapshot OneTimeSnapshot) []byte {
	return digest("mosaic-one-time-snapshot-v1",
		strconv.Itoa(RuleVersion),
		snapshot.ValidityState,
		stamp(&snapshot.AcquiredAt),
		stamp(snapshot.RefundEffectiveAt),
		stamp(snapshot.RevocationEffectiveAt),
		snapshot.MosaicProductID,
		snapshot.UncertaintyReason,
		strconv.FormatBool(snapshot.IsTestSource),
	)
}

// customerChecksum covers the entitlement entries and the sources that justify
// them. Sources participate because "pro is active" for two different reasons
// than yesterday is a real change an operator must be able to see, even though
// the entry alone looks identical.
func customerChecksum(entries []EntitlementEntry, sources []EntitlementSource) []byte {
	fields := make([]string, 0, len(entries)*8+len(sources)*6+1)
	fields = append(fields, strconv.Itoa(RuleVersion))

	sortedEntries := append([]EntitlementEntry(nil), entries...)
	sort.Slice(sortedEntries, func(i, j int) bool { return sortedEntries[i].EntitlementID < sortedEntries[j].EntitlementID })
	for _, entry := range sortedEntries {
		fields = append(fields,
			entry.EntitlementID, entry.EntitlementKey, entry.State,
			stamp(entry.EffectiveStart), stamp(entry.EffectiveEnd),
			strconv.FormatBool(entry.EndKnown),
			entry.UncertaintyReason,
			strconv.FormatBool(entry.IsTestSource))
	}

	sortedSources := append([]EntitlementSource(nil), sources...)
	sort.Slice(sortedSources, func(i, j int) bool { return sortedSources[i].sortKey() < sortedSources[j].sortKey() })
	for _, source := range sortedSources {
		fields = append(fields,
			source.PurchaseLineageID, source.EntitlementID, source.GrantVersionID,
			source.SourceType, source.SourceState, stamp(source.SourceEnd))
	}
	return digest("mosaic-customer-entitlement-snapshot-v1", fields...)
}
