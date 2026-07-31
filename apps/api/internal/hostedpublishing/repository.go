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
	Product(string) (Product, bool)
	ProviderMappingCount(string) int
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
	SaveReleasePlacement(ReleasePlacement)
	SaveReleaseProduct(string, string, string, string)
	SaveReleaseAsset(string, string, string, string)
	SaveReleaseState(ReleaseState)
	SavePublicationRequest(PublicationRequest)
	SaveAuditEvent(AuditEvent)
	TouchAPIKey(string)
}
