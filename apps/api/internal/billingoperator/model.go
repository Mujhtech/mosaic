// Package billingoperator owns the Phase 9B operator (dashboard) surface over
// Mosaic's billing identity, subscription, and entitlement state.
//
// It exists because every other 9B surface authenticates a machine. The
// trusted-server APIs in billingcustomer, billingaccess, and billingrestore
// take their tenant from a secret server key, which is exactly right for an
// application backend and structurally unreachable from a browser session. An
// operator looking at the Customers page holds a session cookie and an
// organization role, so the same state needs a second door with a different
// lock — plan §15: "every operator surface permission-checked server-side".
//
// The package derives nothing. It authorizes, then reads through the ports
// below, which are satisfied by the services and repositories that already own
// the state. The one write it can trigger — identity conflict resolution —
// is delegated wholesale to billingcustomer, so the unfreeze, the audit, and
// the reprojection of both candidates happen in the code that already gets
// them right, not in a second copy that could drift.
package billingoperator

import "time"

// Identifier types the read-only customer lookup accepts. The set is closed and
// small on purpose: it is the three identifiers an operator can plausibly be
// handed by a support ticket, and nothing here can be extended into a general
// query language over customer state.
const (
	IdentifierBillingCustomerID = "billing_customer_id"
	IdentifierApplicationUserID = "application_user_id"
	IdentifierInstallationID    = "installation_id"
)

// ValidIdentifierType reports whether the lookup accepts a type.
func ValidIdentifierType(value string) bool {
	switch value {
	case IdentifierBillingCustomerID, IdentifierApplicationUserID, IdentifierInstallationID:
		return true
	default:
		return false
	}
}

// CustomerSummary is one row of the operator customer list, and the header of
// the detail page.
//
// `Identified` and `PurchaseAnchored` are separate booleans rather than one
// enum because they are independent facts and the interesting customers are the
// ones where they disagree: a purchase-anchored customer who never identified
// is a real revenue record with no person attached, and an identified customer
// with no purchase is a person with no revenue. Collapsing them would hide both
// (plan §5a).
type CustomerSummary struct {
	ID                       string     `json:"billingCustomerId"`
	ProjectID                string     `json:"projectId"`
	EnvironmentID            string     `json:"environmentId"`
	Status                   string     `json:"status"`
	DiagnosticsStatus        string     `json:"diagnosticsStatus"`
	Identified               bool       `json:"identified"`
	PurchaseAnchored         bool       `json:"purchaseAnchored"`
	HasOpenConflict          bool       `json:"hasOpenIdentityConflict"`
	FrozenLineageCount       int        `json:"frozenLineageCount"`
	CurrentProjectionVersion int64      `json:"currentProjectionVersion"`
	LastProjectedAt          *time.Time `json:"lastProjectedAt,omitempty"`
	// SnapshotVersion and SnapshotUpdatedAt describe the Environment's current
	// entitlement pointer. They are absent when the customer has never been
	// projected in this Environment, which is a different answer from "has no
	// entitlements" and is kept different.
	SnapshotVersion   *int64     `json:"snapshotVersion,omitempty"`
	SnapshotUpdatedAt *time.Time `json:"snapshotUpdatedAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// AliasView is one alias as an operator may see it.
//
// There is no value field and no digest field. The alias id is the protected
// representation: it is random, it is stable, it identifies the row for a
// revocation, and it reveals nothing about the person. An alias digest is still
// a stable per-person identifier and would let one tenant's export be joined
// against another's, so it never leaves the persistence layer.
type AliasView struct {
	AliasID            string     `json:"aliasId"`
	AliasType          string     `json:"aliasType"`
	SourceAuthority    string     `json:"sourceAuthority"`
	VerificationStatus string     `json:"verificationStatus"`
	Active             bool       `json:"active"`
	EffectiveStart     time.Time  `json:"effectiveStart"`
	EffectiveEnd       *time.Time `json:"effectiveEnd,omitempty"`
}

// LineageView is one purchase chain attached to the customer.
type LineageView struct {
	PurchaseLineageID     string    `json:"purchaseLineageId"`
	EnvironmentID         string    `json:"environmentId"`
	Provider              string    `json:"provider"`
	StoreEnvironment      string    `json:"storeEnvironment"`
	LineageType           string    `json:"lineageType"`
	ProjectionFrozen      bool      `json:"projectionFrozen"`
	DiagnosticStatus      string    `json:"diagnosticStatus"`
	SupersededByLineageID string    `json:"supersededByLineageId,omitempty"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

// OneTimePurchaseView is validated ownership of a non-consumable.
type OneTimePurchaseView struct {
	InstanceID                string     `json:"oneTimePurchaseInstanceId"`
	PurchaseLineageID         string     `json:"purchaseLineageId"`
	Provider                  string     `json:"provider"`
	MosaicProductID           string     `json:"mosaicProductId,omitempty"`
	ProviderProductIdentifier string     `json:"providerProductIdentifier,omitempty"`
	AcquiredAt                time.Time  `json:"acquiredAt"`
	ValidityState             string     `json:"validityState"`
	RefundEffectiveAt         *time.Time `json:"refundEffectiveAt,omitempty"`
	RevocationEffectiveAt     *time.Time `json:"revocationEffectiveAt,omitempty"`
}

// ConflictView is one identity conflict on the operator surface. It carries the
// disputed alias *family* and never the disputed alias digest.
type ConflictView struct {
	ConflictID        string     `json:"conflictId"`
	ProjectID         string     `json:"projectId"`
	Scope             string     `json:"scope"`
	Status            string     `json:"status"`
	PurchaseLineageID string     `json:"purchaseLineageId,omitempty"`
	AliasType         string     `json:"aliasType,omitempty"`
	FirstCustomerID   string     `json:"firstCustomerId"`
	SecondCustomerID  string     `json:"secondCustomerId"`
	DiagnosticCode    string     `json:"diagnosticCode,omitempty"`
	OpenedAt          time.Time  `json:"openedAt"`
	ResolvedAt        *time.Time `json:"resolvedAt,omitempty"`
	ResolutionAction  string     `json:"resolutionAction,omitempty"`
	ResolutionReason  string     `json:"resolutionReason,omitempty"`
}

// ConflictDetailView adds the disputed lineage, which is what an operator needs
// before choosing between keeping, reassigning, and splitting.
type ConflictDetailView struct {
	Conflict ConflictView `json:"conflict"`
	Lineage  *LineageView `json:"lineage,omitempty"`
}

// ResolutionActions, as OD-10 names them. The stored vocabulary is the schema's
// three actions; these are the operator-facing names the dashboard uses, mapped
// in exactly one place (resolutionAction).
const (
	// ActionKeepExisting awards the disputed subject to the incumbent.
	ActionKeepExisting = "keep_existing"
	// ActionReassign awards it to the candidate the evidence proposed.
	ActionReassign = "reassign_to_candidate"
	// ActionSplit awards it to neither: the operator has decided these are two
	// people and the disputed link is removed rather than moved.
	ActionSplit = "operator_split"
)

// storedAction maps an operator action onto the schema's resolution_action.
func storedAction(action string) (string, bool) {
	switch action {
	case ActionKeepExisting:
		return "assigned_first", true
	case ActionReassign:
		return "assigned_second", true
	case ActionSplit:
		return "detached_both", true
	default:
		return "", false
	}
}

// OperatorAction is the inverse, so a resolved conflict reads back in the same
// vocabulary the operator used.
func OperatorAction(stored string) string {
	switch stored {
	case "assigned_first":
		return ActionKeepExisting
	case "assigned_second":
		return ActionReassign
	case "detached_both":
		return ActionSplit
	default:
		return ""
	}
}

// EntitlementEntryView is one Entitlement's committed state on the customer's
// current snapshot.
type EntitlementEntryView struct {
	EntitlementID     string     `json:"entitlementId"`
	EntitlementKey    string     `json:"entitlementKey"`
	State             string     `json:"state"`
	EffectiveStart    *time.Time `json:"effectiveStart,omitempty"`
	EffectiveEnd      *time.Time `json:"effectiveEnd,omitempty"`
	EndKnown          bool       `json:"endKnown"`
	SourceCount       int        `json:"sourceCount"`
	UncertaintyReason string     `json:"uncertaintyReason,omitempty"`
	IsTestSource      bool       `json:"isTestSource"`
	ExplanationCode   string     `json:"explanationCode,omitempty"`
	SourceIDs         []string   `json:"sourceIds,omitempty"`
}

// EntitlementSourceView is one reason the customer holds, or may hold, an
// Entitlement. Source identity is (lineage, product, grant version) — never a
// fact id — so multi-fact-per-purchase cannot double-grant (plan §3).
type EntitlementSourceView struct {
	SourceID                  string     `json:"sourceId"`
	EntitlementID             string     `json:"entitlementId"`
	PurchaseLineageID         string     `json:"purchaseLineageId,omitempty"`
	MosaicProductID           string     `json:"mosaicProductId,omitempty"`
	GrantVersionID            string     `json:"grantVersionId,omitempty"`
	SubscriptionInstanceID    string     `json:"subscriptionInstanceId,omitempty"`
	OneTimePurchaseInstanceID string     `json:"oneTimePurchaseInstanceId,omitempty"`
	StorePlatform             string     `json:"storePlatform,omitempty"`
	SourceType                string     `json:"sourceType,omitempty"`
	SourceState               string     `json:"sourceState,omitempty"`
	SourceStart               *time.Time `json:"sourceStart,omitempty"`
	SourceEnd                 *time.Time `json:"sourceEnd,omitempty"`
	EndKnown                  bool       `json:"endKnown"`
	UncertaintyReason         string     `json:"uncertaintyReason,omitempty"`
	IsTestSource              bool       `json:"isTestSource"`
	ExplanationCode           string     `json:"explanationCode,omitempty"`
}

// SnapshotView is the customer's current committed entitlement snapshot as the
// operator surface reports it.
type SnapshotView struct {
	SnapshotID              string                  `json:"snapshotId"`
	SnapshotVersion         int64                   `json:"snapshotVersion"`
	PreviousSnapshotVersion int64                   `json:"previousSnapshotVersion,omitempty"`
	ProjectionRuleVersion   int                     `json:"projectionRuleVersion"`
	ComputedAt              time.Time               `json:"computedAt"`
	AsOf                    time.Time               `json:"asOf"`
	ChangeReason            string                  `json:"changeReason,omitempty"`
	Entries                 []EntitlementEntryView  `json:"entries"`
	Sources                 []EntitlementSourceView `json:"sources"`
}

// ProjectionStatusView is the health of the projection behind what is shown.
type ProjectionStatusView struct {
	State            string    `json:"state"`
	LastProjectedAt  time.Time `json:"lastProjectedAt"`
	PendingFactCount int       `json:"pendingFactCount"`
	DiagnosticCode   string    `json:"diagnosticCode,omitempty"`
}

// SubscriptionView is one projected Subscription Instance.
type SubscriptionView struct {
	SubscriptionInstanceID  string     `json:"subscriptionInstanceId"`
	PurchaseLineageID       string     `json:"purchaseLineageId"`
	BillingCustomerID       string     `json:"billingCustomerId,omitempty"`
	EnvironmentID           string     `json:"environmentId"`
	StorePlatform           string     `json:"storePlatform"`
	MosaicProductID         string     `json:"mosaicProductId,omitempty"`
	PriorMosaicProductID    string     `json:"priorMosaicProductId,omitempty"`
	AccessState             string     `json:"accessState"`
	LifecycleState          string     `json:"lifecycleState"`
	RenewalIntent           string     `json:"renewalIntent,omitempty"`
	BillingState            string     `json:"billingState,omitempty"`
	UncertaintyReason       string     `json:"uncertaintyReason,omitempty"`
	ProjectionVersion       int64      `json:"projectionVersion"`
	ProjectionRuleVersion   int        `json:"projectionRuleVersion"`
	ComputedAt              time.Time  `json:"computedAt"`
	AsOf                    time.Time  `json:"asOf"`
	PeriodStart             *time.Time `json:"periodStart,omitempty"`
	PeriodEnd               *time.Time `json:"periodEnd,omitempty"`
	GracePeriodEnd          *time.Time `json:"gracePeriodEnd,omitempty"`
	BillingRetryStart       *time.Time `json:"billingRetryStart,omitempty"`
	PauseEffectiveAt        *time.Time `json:"pauseEffectiveAt,omitempty"`
	PauseResumeAt           *time.Time `json:"pauseResumeAt,omitempty"`
	CancellationEffectiveAt *time.Time `json:"cancellationEffectiveAt,omitempty"`
	ExpirationEffectiveAt   *time.Time `json:"expirationEffectiveAt,omitempty"`
	RevocationEffectiveAt   *time.Time `json:"revocationEffectiveAt,omitempty"`
	RefundEffectiveAt       *time.Time `json:"refundEffectiveAt,omitempty"`
	SupersededByInstanceID  string     `json:"supersededBySubscriptionInstanceId,omitempty"`
	IsTestSource            bool       `json:"isTestSource"`
	SourceFactCount         int        `json:"sourceFactCount"`
	ChangeReason            string     `json:"changeReason,omitempty"`
	ExplanationCode         string     `json:"explanationCode,omitempty"`
}

// TimelineEntryView is one append-only explanation of a transition.
type TimelineEntryView struct {
	TimelineEntryID        string            `json:"timelineEntryId"`
	EntryType              string            `json:"entryType"`
	EffectiveAt            time.Time         `json:"effectiveAt"`
	ObservedAt             time.Time         `json:"observedAt"`
	SubscriptionInstanceID string            `json:"subscriptionInstanceId,omitempty"`
	MosaicProductID        string            `json:"mosaicProductId,omitempty"`
	PriorMosaicProductID   string            `json:"priorMosaicProductId,omitempty"`
	ExplanationCode        string            `json:"explanationCode,omitempty"`
	Detail                 map[string]string `json:"detail,omitempty"`
}

// RestoreJobView is one restore/sync job on the operator surface.
type RestoreJobView struct {
	RestoreID                string     `json:"restoreId"`
	EnvironmentID            string     `json:"environmentId"`
	BillingCustomerID        string     `json:"billingCustomerId,omitempty"`
	StorePlatform            string     `json:"storePlatform"`
	Status                   string     `json:"status"`
	Outcome                  string     `json:"outcome,omitempty"`
	ProviderOutcome          string     `json:"providerOutcome"`
	UncertaintyReason        string     `json:"uncertaintyReason"`
	ObservedTransactionCount int        `json:"observedTransactionCount"`
	PendingValidationCount   int        `json:"pendingValidationCount"`
	BaselineSnapshotVersion  *int64     `json:"baselineSnapshotVersion,omitempty"`
	SnapshotVersion          *int64     `json:"snapshotVersion,omitempty"`
	AttemptCount             int        `json:"attemptCount"`
	MaxAttempts              int        `json:"maxAttempts"`
	RequestedAt              time.Time  `json:"requestedAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
	CompletedAt              *time.Time `json:"completedAt,omitempty"`
}

// CustomerDetail is everything the customer page shows in one read. It is one
// service call rather than eight so the page describes one instant: an operator
// comparing a snapshot version against a projection status assembled from eight
// separate requests would be comparing eight different moments.
type CustomerDetail struct {
	Customer      CustomerSummary       `json:"customer"`
	Aliases       []AliasView           `json:"aliases"`
	Lineages      []LineageView         `json:"purchaseLineages"`
	Subscriptions []SubscriptionView    `json:"subscriptions"`
	OneTime       []OneTimePurchaseView `json:"oneTimePurchases"`
	Conflicts     []ConflictView        `json:"identityConflicts"`
	// Snapshot is absent when the customer has never been projected in this
	// Environment. Absent is not empty: "no answer yet" and "no entitlements"
	// are different states and the surface keeps them different.
	Snapshot   *SnapshotView         `json:"currentSnapshot,omitempty"`
	Projection *ProjectionStatusView `json:"projectionStatus,omitempty"`
}

// Actor is the authenticated operator principal.
type Actor struct{ ID string }

// CustomerFilter narrows the customer list.
type CustomerFilter struct {
	// Status is "" (any), or one of the billing customer statuses.
	Status string
	// Identified restricts to identified or to purchase-anchored-only customers.
	// Nil means both.
	Identified *bool
	// ConflictedOnly restricts to customers with an open identity conflict.
	ConflictedOnly bool
}
