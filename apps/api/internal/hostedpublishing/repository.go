package hostedpublishing

import "context"

type Repository interface {
	View(context.Context, func(Reader) error) error
	Transact(context.Context, func(Transaction) error) error
}

type Reader interface {
	Project(string) (Project, bool)
	Role(string, string) (string, bool)
	Environment(string) (Environment, bool)
	Applications(string) []Application
	Product(string) (Product, bool)
	ProviderMappingCount(string) int
	ProductGrantCount(string) int
	ProviderAssignment(string, string) (ProviderAssignment, bool)
	ProviderConnection(string) (ProviderConnection, bool)
	ProviderConnectionEnvironmentScoped(string, string) bool
	ProviderConnectionApplicationScoped(string, string) bool
	ProviderMappingsForReadiness(string, string, string, string, string) []ProviderMappingReadiness
	ProviderMappingsForCommerce(string, string, string, string, []string) []CommerceProductMapping
	ProviderMappingsForNativeCommerce(string, string, string, string, []string) []CommerceProductMapping
	ProductEntitlementKeys(string) []string
	LatestProviderMappingObservation(string) (ProviderMappingObservation, bool)
	ProviderEntitlementMappingsForCommerce(string, string, string, []string) []CommerceEntitlementMapping
	ProviderMetadataSnapshot(string) (ProviderMetadataSnapshot, bool)
	Asset(string) (Asset, bool)
	Assets(string) []Asset
	AssetUsage(string) AssetUsage
	Paywall(string) (Paywall, bool)
	Paywalls(string) []Paywall
	ActiveDraft(string, string) (Draft, bool)
	Draft(string) (Draft, bool)
	DraftRevision(string, int64) (DraftRevision, bool)
	DraftRevisionByMutation(string, string) (DraftRevision, bool)
	PaywallVersion(string) (PaywallVersion, bool)
	PaywallVersions(string) []PaywallVersion
	LatestPaywallVersion(string, string) (PaywallVersion, bool)
	VersionProducts(string) []string
	VersionAssets(string) []VersionAsset
	Placement(string) (Placement, bool)
	Placements(string) []Placement
	PlacementBinding(string, string) (PlacementBinding, bool)
	PlacementBindings(string) []PlacementBinding
	Release(string) (Release, bool)
	Releases(string) []Release
	ReleasePlacements(string) []ReleasePlacement
	ReleaseProducts(string) []string
	ReleaseAssets(string) []string
	ReleaseState(string) (ReleaseState, bool)
	PublicationRequest(string, string, string) (PublicationRequest, bool)
	APIKeyByPrefix(string) (APIKeyRecord, bool)
	CommerceConfiguration(string, string) (CommerceConfigurationSnapshot, bool)
	PublishedDecisionVersions(string) []PublishedDecisionVersion
	ReleaseDecisionVersions(string) []PublishedDecisionVersion
	EntitlementByKey(string, string) (EntitlementReference, bool)
}

type Transaction interface {
	Reader
	LockScope(string)
	NextID(string) string
	SavePaywall(Paywall)
	SaveAsset(Asset)
	SaveDraft(Draft)
	SaveDraftRevision(DraftRevision)
	SavePaywallVersion(PaywallVersion)
	SaveVersionProduct(string, string, string)
	SaveVersionAsset(VersionAsset)
	SavePlacement(Placement)
	SavePlacementBinding(PlacementBinding)
	SaveRelease(Release)
	SaveReleaseRuleSetVersion(string, string, string, string, string)
	SaveReleasePlacement(ReleasePlacement)
	SaveReleaseProduct(string, string, string, string)
	SaveReleaseAsset(string, string, string, string)
	SaveCommerceConfiguration(CommerceConfigurationSnapshot)
	SaveReleaseState(ReleaseState)
	SavePublicationRequest(PublicationRequest)
	SaveAuditEvent(AuditEvent)
	TouchAPIKey(string)
}
