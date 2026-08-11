package billingoperator

import (
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/billingaccess"
	"github.com/Mujhtech/mosaic/apps/api/internal/billingcustomer"
)

// This file is the single mapping layer between the modules that own billing
// state and the operator's view of it.
//
// It exists so no database row and no other module's read model is ever the
// public response. That is the rule the backend conventions state and it is
// load-bearing here: billingcustomer.Alias and billingcustomer.Conflict both
// carry an alias digest in unexported fields, and a mapper that names every
// field it copies cannot accidentally start copying one.

func aliasView(alias billingcustomer.Alias) AliasView {
	return AliasView{
		AliasID:            alias.ID,
		AliasType:          alias.AliasType,
		SourceAuthority:    alias.SourceAuthority,
		VerificationStatus: alias.VerificationStatus,
		Active:             alias.EffectiveEnd == nil,
		EffectiveStart:     alias.EffectiveStart.UTC(),
		EffectiveEnd:       utcOrNil(alias.EffectiveEnd),
	}
}

func lineageView(lineage billingcustomer.Lineage) LineageView {
	return LineageView{
		PurchaseLineageID:     lineage.ID,
		EnvironmentID:         lineage.EnvironmentID,
		Provider:              lineage.Provider,
		StoreEnvironment:      lineage.StoreEnvironment,
		LineageType:           lineage.LineageType,
		ProjectionFrozen:      lineage.ProjectionFrozen,
		DiagnosticStatus:      lineage.DiagnosticStatus,
		SupersededByLineageID: lineage.SupersededByLineageID,
		CreatedAt:             lineage.CreatedAt.UTC(),
		UpdatedAt:             lineage.UpdatedAt.UTC(),
	}
}

func conflictView(conflict billingcustomer.Conflict) ConflictView {
	return ConflictView{
		ConflictID:        conflict.ID,
		ProjectID:         conflict.ProjectID,
		Scope:             conflict.Scope,
		Status:            conflict.Status,
		PurchaseLineageID: conflict.PurchaseLineageID,
		AliasType:         conflict.AliasType,
		FirstCustomerID:   conflict.FirstCustomerID,
		SecondCustomerID:  conflict.SecondCustomerID,
		DiagnosticCode:    conflict.DiagnosticCode,
		OpenedAt:          conflict.OpenedAt.UTC(),
		ResolvedAt:        utcOrNil(conflict.ResolvedAt),
		ResolutionAction:  OperatorAction(conflict.ResolutionAction),
		ResolutionReason:  conflict.ResolutionReason,
	}
}

func snapshotView(view billingaccess.SnapshotView) SnapshotView {
	result := SnapshotView{
		SnapshotID:              view.SnapshotID,
		SnapshotVersion:         view.SnapshotVersion,
		PreviousSnapshotVersion: view.PreviousSnapshotVersion,
		ProjectionRuleVersion:   view.RuleVersion,
		ComputedAt:              view.ComputedAt.UTC(),
		AsOf:                    view.AsOf.UTC(),
		ChangeReason:            view.ChangeReason,
		Entries:                 make([]EntitlementEntryView, 0, len(view.Entries)),
		Sources:                 make([]EntitlementSourceView, 0, len(view.Sources)),
	}
	// The snapshot checksum is deliberately not carried onto the operator
	// surface. It is a determinism control the replay surface compares; an
	// operator reading it can only mistake it for a state.
	for _, entry := range view.Entries {
		result.Entries = append(result.Entries, EntitlementEntryView{
			EntitlementID:     entry.EntitlementID,
			EntitlementKey:    entry.EntitlementKey,
			State:             entry.State,
			EffectiveStart:    utcOrNil(entry.EffectiveStart),
			EffectiveEnd:      utcOrNil(entry.EffectiveEnd),
			EndKnown:          entry.EndKnown,
			SourceCount:       entry.SourceCount,
			UncertaintyReason: entry.UncertaintyReason,
			IsTestSource:      entry.IsTestSource,
			ExplanationCode:   entry.ExplanationCode,
			SourceIDs:         append([]string(nil), entry.SourceIDs...),
		})
	}
	for _, source := range view.Sources {
		result.Sources = append(result.Sources, EntitlementSourceView{
			SourceID:                  source.RowID,
			EntitlementID:             source.EntitlementID,
			PurchaseLineageID:         source.PurchaseLineageID,
			MosaicProductID:           source.ProductID,
			GrantVersionID:            source.GrantVersionID,
			SubscriptionInstanceID:    source.SubscriptionInstanceID,
			OneTimePurchaseInstanceID: source.OneTimePurchaseInstanceID,
			StorePlatform:             source.StorePlatform,
			SourceType:                source.SourceType,
			SourceState:               source.SourceState,
			SourceStart:               utcOrNil(source.SourceStart),
			SourceEnd:                 utcOrNil(source.SourceEnd),
			EndKnown:                  source.EndKnown,
			UncertaintyReason:         source.UncertaintyReason,
			IsTestSource:              source.IsTestSource,
			ExplanationCode:           source.ExplanationCode,
		})
	}
	return result
}

func projectionStatusView(status billingaccess.ProjectionStatus) ProjectionStatusView {
	return ProjectionStatusView{
		State:            status.State,
		LastProjectedAt:  status.LastProjectedAt.UTC(),
		PendingFactCount: status.PendingFactCount,
		DiagnosticCode:   status.DiagnosticCode,
	}
}

func subscriptionView(view billingaccess.SubscriptionView) SubscriptionView {
	return SubscriptionView{
		SubscriptionInstanceID:  view.SubscriptionInstanceID,
		PurchaseLineageID:       view.PurchaseLineageID,
		BillingCustomerID:       view.CustomerID,
		EnvironmentID:           view.EnvironmentID,
		StorePlatform:           view.StorePlatform,
		MosaicProductID:         view.ProductID,
		PriorMosaicProductID:    view.PriorProductID,
		AccessState:             view.AccessState,
		LifecycleState:          view.LifecycleState,
		RenewalIntent:           view.RenewalIntent,
		BillingState:            view.BillingState,
		UncertaintyReason:       view.UncertaintyReason,
		ProjectionVersion:       view.ProjectionVersion,
		ProjectionRuleVersion:   view.RuleVersion,
		ComputedAt:              view.ComputedAt.UTC(),
		AsOf:                    view.AsOf.UTC(),
		PeriodStart:             utcOrNil(view.PeriodStart),
		PeriodEnd:               utcOrNil(view.PeriodEnd),
		GracePeriodEnd:          utcOrNil(view.GracePeriodEnd),
		BillingRetryStart:       utcOrNil(view.BillingRetryStart),
		PauseEffectiveAt:        utcOrNil(view.PauseEffectiveAt),
		PauseResumeAt:           utcOrNil(view.PauseResumeAt),
		CancellationEffectiveAt: utcOrNil(view.CancellationEffectiveAt),
		ExpirationEffectiveAt:   utcOrNil(view.ExpirationEffectiveAt),
		RevocationEffectiveAt:   utcOrNil(view.RevocationEffectiveAt),
		RefundEffectiveAt:       utcOrNil(view.RefundEffectiveAt),
		SupersededByInstanceID:  view.SupersededByInstanceID,
		IsTestSource:            view.IsTestSource,
		SourceFactCount:         view.SourceFactCount,
		ChangeReason:            view.ChangeReason,
		ExplanationCode:         view.ExplanationCode,
	}
}

func timelineEntryView(entry billingaccess.TimelineEntry) TimelineEntryView {
	// Detail is produced by the ledger guard function, which is what keeps a
	// provider token or a raw payload fragment out of an explanation. It is
	// copied rather than referenced so a later mutation of the read model
	// cannot reach a response already built.
	detail := make(map[string]string, len(entry.Detail))
	for key, value := range entry.Detail {
		detail[key] = value
	}
	return TimelineEntryView{
		TimelineEntryID:        entry.ID,
		EntryType:              entry.EntryType,
		EffectiveAt:            entry.EffectiveAt.UTC(),
		ObservedAt:             entry.ObservedAt.UTC(),
		SubscriptionInstanceID: entry.SubscriptionInstanceID,
		MosaicProductID:        entry.ProductID,
		PriorMosaicProductID:   entry.PriorProductID,
		ExplanationCode:        entry.ExplanationCode,
		Detail:                 detail,
	}
}

func utcOrNil(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}

// lastProjectedFrom is the best instant available for a projection status that
// could not be read: the snapshot's own computed-at, or the zero instant when
// there is no snapshot either. It is deliberately not "now" — the last
// projection did not happen at read time, and stating that it did is the same
// class of fabrication as reporting the status as current.
func lastProjectedFrom(snapshot *SnapshotView) time.Time {
	if snapshot == nil {
		return time.Time{}
	}
	return snapshot.ComputedAt
}
