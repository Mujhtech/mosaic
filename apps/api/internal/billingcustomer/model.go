// Package billingcustomer owns Mosaic's billing identity: the Project-scoped
// Billing Customer, its typed aliases, the evidence that links validated
// provider facts to it, and the Environment-scoped purchase lineages those
// facts belong to.
//
// The package exists to make one failure structurally impossible: silently
// creating or selecting the wrong customer. Customers are created lazily,
// aliases are digest-only, an installation identifier can never select a
// customer, and a lineage claimed by two customers freezes rather than
// resolving to a guess.
package billingcustomer

import "time"

// ResolverVersion is stamped on every piece of association evidence, so a
// later change to the resolution rules is a version bump with a replay rather
// than an unexplained change of history.
const ResolverVersion = 1

// Customer statuses.
const (
	StatusActive     = "active"
	StatusFrozen     = "frozen"
	StatusAnonymized = "anonymized"
)

// Alias types. Every one is stored as a digest; no raw value is persisted.
const (
	AliasApplicationUser        = "application_user_id"
	AliasInstallation           = "installation_id"
	AliasAppleAppAccountToken   = "apple_app_account_token"
	AliasGoogleObfuscatedAcount = "google_obfuscated_account_id"
)

// Alias source authorities. The authority records who asserted the link, which
// is what makes "a public SDK key can never claim an application user" an
// auditable property rather than a routing convention.
const (
	AuthorityTrustedServer   = "trusted_server"
	AuthoritySDKInstallation = "sdk_installation"
	AuthorityProviderPayload = "provider_payload"
	AuthorityOperator        = "operator"
	AuthorityRestore         = "restore"
)

// Evidence types (OD-2(b)). `installation_observation` is deliberately
// included and deliberately never resolving: it is recorded for attribution
// and diagnostics only.
const (
	EvidenceAppAccountToken   = "app_account_token"
	EvidenceObfuscatedAccount = "obfuscated_external_account_id"
	EvidenceTrustedServer     = "trusted_server_observation"
	EvidencePriorLineage      = "prior_lineage_association"
	EvidenceRestoreLink       = "restore_link"
	EvidenceOperatorRepair    = "operator_repair"
	EvidenceInstallation      = "installation_observation"
)

// Association outcomes.
const (
	OutcomeResolved    = "resolved"
	OutcomeUnresolved  = "unresolved"
	OutcomeConflicting = "conflicting"
	OutcomeUnsupported = "unsupported"
)

// Lineage types.
const (
	LineageSubscription = "subscription"
	LineageOneTime      = "one_time"
)

// Customer is the Project-scoped authoritative subject.
type Customer struct {
	ID                       string     `json:"id"`
	ProjectID                string     `json:"projectId"`
	Status                   string     `json:"status"`
	CurrentProjectionVersion int64      `json:"currentProjectionVersion"`
	LastProjectedAt          *time.Time `json:"lastProjectedAt,omitempty"`
	DiagnosticsStatus        string     `json:"diagnosticsStatus"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
}

// Alias is one accepted external identity bound to a customer. The digest is
// never rendered on any operator surface: an alias digest is still a stable
// per-person identifier, and exposing it would let one tenant's export be
// joined against another's.
type Alias struct {
	ID                 string     `json:"id"`
	ProjectID          string     `json:"projectId"`
	BillingCustomerID  string     `json:"billingCustomerId"`
	AliasType          string     `json:"aliasType"`
	digest             []byte     `json:"-"`
	SourceAuthority    string     `json:"sourceAuthority"`
	VerificationStatus string     `json:"verificationStatus"`
	EffectiveStart     time.Time  `json:"effectiveStart"`
	EffectiveEnd       *time.Time `json:"effectiveEnd,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
}

// Digest exposes the stored digest to the persistence layer inside the
// application, without putting it on the JSON surface.
func (a Alias) Digest() []byte { return a.digest }

// WithDigest returns a copy carrying the digest, used by repositories when
// hydrating rows.
func (a Alias) WithDigest(digest []byte) Alias {
	a.digest = digest
	return a
}

// Evidence is one append-only association observation.
type Evidence struct {
	ID                         string
	ProjectID                  string
	EnvironmentID              string
	PurchaseLineageID          string
	EvidenceType               string
	EvidenceDigest             []byte
	RawInputID                 string
	TransactionReferenceDigest []byte
	BillingCustomerID          string
	ResolverVersion            int
	Outcome                    string
	DiagnosticCode             string
	ObservedAt                 time.Time
	CreatedAt                  time.Time
}

// Lineage is one provider purchase chain.
type Lineage struct {
	ID                    string    `json:"id"`
	ProjectID             string    `json:"projectId"`
	EnvironmentID         string    `json:"environmentId"`
	EnvironmentMode       string    `json:"-"`
	ApplicationID         string    `json:"applicationId"`
	Provider              string    `json:"provider"`
	StoreEnvironment      string    `json:"storeEnvironment"`
	LineageKeyDigest      []byte    `json:"-"`
	LineageType           string    `json:"lineageType"`
	BillingCustomerID     string    `json:"billingCustomerId,omitempty"`
	SupersededByLineageID string    `json:"supersededByLineageId,omitempty"`
	ProjectionFrozen      bool      `json:"projectionFrozen"`
	DiagnosticStatus      string    `json:"diagnosticStatus"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

// Conflict is one disputed lineage held open for operator resolution.
type Conflict struct {
	ID                string     `json:"id"`
	ProjectID         string     `json:"projectId"`
	PurchaseLineageID string     `json:"purchaseLineageId"`
	Status            string     `json:"status"`
	FirstCustomerID   string     `json:"firstCustomerId"`
	SecondCustomerID  string     `json:"secondCustomerId"`
	OpenedAt          time.Time  `json:"openedAt"`
	ResolvedAt        *time.Time `json:"resolvedAt,omitempty"`
	ResolutionAction  string     `json:"resolutionAction,omitempty"`
}

// Actor is the authenticated operator principal.
type Actor struct{ ID string }
