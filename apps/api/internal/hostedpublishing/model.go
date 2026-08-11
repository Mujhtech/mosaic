package hostedpublishing

import (
	"encoding/json"
	"io"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providerreadiness"
)

const (
	// ProtocolVersion is the baseline Paywall Protocol version this backend
	// reads and serves. 0.3 replaced 0.2 outright: there is no migration, so a
	// 0.2 document is an unknown version.
	ProtocolVersion = "0.3"
	// ProtocolVersion04 is Paywall Protocol 0.4 "Motion". Unlike the 0.2 to 0.3
	// replacement, 0.4 is served alongside 0.3: versions are exact identifiers,
	// a document validates against exactly the version it declares, and a
	// Release advertises one compatibility entry per protocol version it
	// carries. See docs/protocol/v0.4.md.
	ProtocolVersion04 = "0.4"
	DeliveryVersion   = "1"
)

type Actor struct{ ID string }

type Project struct {
	ID             string
	OrganizationID string
	Status         string
}

type Environment struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Key       string `json:"key"`
	Mode      string `json:"mode"`
}

type Application struct {
	ID        string
	ProjectID string
	Platform  string
}

type Product struct {
	ID             string
	ProjectID      string
	Type           string
	Status         string
	MetadataSource string
	InternalName   string
	ReadinessReady bool
}

type PublishedDecisionVersion struct {
	ID          string
	PlacementID string
	Document    json.RawMessage
}
type EntitlementReference struct {
	ID  string `json:"id"`
	Key string `json:"key"`
}
type ReleaseRepresentation struct {
	ReleaseID               string
	EnvironmentID           string
	DeliveryContractVersion string
	Payload                 json.RawMessage
	ContentHash             string
	CreatedAt               time.Time
}

type ProviderAssignment struct {
	Provider       string
	ActivationKind string
	ConnectionID   string
}

type ProviderConnection struct {
	ID           string
	ProjectID    string
	Provider     string
	Mode         string
	Status       string
	HealthStatus string
}

type ProviderMappingReadiness struct {
	ID                         string
	ProductID                  string
	ProviderProductIdentifier  string
	ProviderBasePlanIdentifier string
	ProviderOfferIdentifier    string
	Availability               string
	SyncState                  string
	CurrentSnapshotID          string
}

type ProviderMetadataSnapshot struct {
	ID         string
	ObservedAt time.Time
	SyncedAt   time.Time
	StaleAt    time.Time
	ExpiresAt  *time.Time
}

type CommerceProductMapping struct {
	ID        string
	ProductID string
	// Provider is the mapping's provenance, not the active provider identity.
	// A native App Store activation is served by app_store mappings the
	// operator typed and by app_store_connect mappings imported from Apple.
	Provider                   string
	ProviderProductIdentifier  string
	ProviderPackageIdentifier  string
	ProviderOfferingIdentifier string
	ExpectedStoreProductID     string
	ProviderBasePlanIdentifier string
	ProviderOfferIdentifier    string
	CurrentSnapshotID          string
}

type ProviderMappingObservation struct {
	ID           string
	Result       string
	StoreContext string
	ObservedAt   time.Time
	ExpiresAt    *time.Time
}

type CommerceEntitlementMapping struct {
	EntitlementID                 string
	EntitlementKey                string
	ProviderEntitlementIdentifier string
}

type CommerceConfigurationSnapshot struct {
	ID                         string
	ProjectID                  string
	EnvironmentID              string
	ApplicationID              string
	StorePlatform              string
	ConfigurationReleaseID     string
	ConfigurationReleaseDigest string
	ContentDigest              string
	Payload                    json.RawMessage
	CreatedAt                  time.Time
}

type ProviderPublicationIssue struct {
	Code           string                   `json:"code"`
	ProductID      string                   `json:"productId"`
	ApplicationID  string                   `json:"applicationId"`
	ResourceType   string                   `json:"resourceType"`
	ResourceID     string                   `json:"resourceId"`
	RecoveryAction providerreadiness.Action `json:"recoveryAction"`
}

type Asset struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	Kind             string     `json:"kind"`
	OriginalFilename string     `json:"originalFilename"`
	MediaType        string     `json:"mediaType"`
	ByteLength       int64      `json:"byteLength"`
	ContentDigest    string     `json:"contentDigest"`
	URL              string     `json:"url"`
	Status           string     `json:"status"`
	StorageKey       string     `json:"-"`
	CreatedByActorID string     `json:"createdByActorId"`
	ArchivedAt       *time.Time `json:"archivedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type AssetUsage struct {
	DraftReferences   int `json:"draftReferences"`
	VersionReferences int `json:"versionReferences"`
	ReleaseReferences int `json:"releaseReferences"`
}

type VersionAsset struct {
	VersionID       string
	ProjectID       string
	AssetID         string
	DocumentAssetID string
}

type AssetObject struct {
	Asset Asset
	Body  io.ReadCloser
}

type Paywall struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	Key              string     `json:"key"`
	Name             string     `json:"name"`
	Status           string     `json:"status"`
	ArchivedAt       *time.Time `json:"archivedAt,omitempty"`
	CreatedByActorID string     `json:"createdByActorId"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type ValidationSummary struct {
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

type Draft struct {
	ID                     string            `json:"id"`
	ProjectID              string            `json:"projectId"`
	PaywallID              string            `json:"paywallId"`
	EnvironmentID          string            `json:"environmentId"`
	Status                 string            `json:"status"`
	CurrentRevision        int64             `json:"revision"`
	SourceVersionID        string            `json:"sourceVersionId,omitempty"`
	CurrentProtocolVersion string            `json:"protocolVersion"`
	ValidationStatus       string            `json:"validationStatus"`
	ValidationSummary      ValidationSummary `json:"validation"`
	CreatedByActorID       string            `json:"createdByActorId"`
	UpdatedByActorID       string            `json:"updatedByActorId"`
	CreatedAt              time.Time         `json:"createdAt"`
	UpdatedAt              time.Time         `json:"updatedAt"`
}

type DraftRevision struct {
	DraftID           string
	Revision          int64
	ProjectID         string
	ProtocolVersion   string
	Document          json.RawMessage
	DocumentHash      string
	ValidationStatus  string
	ValidationSummary ValidationSummary
	MutationKeyHash   string
	RequestHash       string
	ActorID           string
	CreatedAt         time.Time
}

type DraftResource struct {
	Draft    Draft           `json:"draft"`
	Document json.RawMessage `json:"document"`
	ETag     string          `json:"-"`
}

type PaywallVersion struct {
	ID                 string            `json:"id"`
	ProjectID          string            `json:"projectId"`
	PaywallID          string            `json:"paywallId"`
	EnvironmentID      string            `json:"environmentId"`
	VersionNumber      int64             `json:"versionNumber"`
	SourceDraftID      string            `json:"sourceDraftId"`
	SourceRevision     int64             `json:"sourceRevision"`
	ProtocolVersion    string            `json:"protocolVersion"`
	Document           json.RawMessage   `json:"document"`
	DocumentHash       string            `json:"documentHash"`
	ValidationMetadata ValidationSummary `json:"validation"`
	CreatedByActorID   string            `json:"createdByActorId"`
	CreatedAt          time.Time         `json:"createdAt"`
	ProductIDs         []string          `json:"productIds"`
	Assets             []VersionAsset    `json:"-"`
}

type Placement struct {
	ID               string     `json:"id"`
	ProjectID        string     `json:"projectId"`
	Key              string     `json:"key"`
	Name             string     `json:"name"`
	Description      string     `json:"description,omitempty"`
	Status           string     `json:"status"`
	ArchivedAt       *time.Time `json:"archivedAt,omitempty"`
	CreatedByActorID string     `json:"createdByActorId"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type PlacementBinding struct {
	ProjectID        string    `json:"projectId"`
	EnvironmentID    string    `json:"environmentId"`
	PlacementID      string    `json:"placementId"`
	PaywallID        string    `json:"paywallId"`
	UpdatedByActorID string    `json:"updatedByActorId"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Release struct {
	ID                      string          `json:"id"`
	ProjectID               string          `json:"projectId"`
	EnvironmentID           string          `json:"environmentId"`
	ReleaseNumber           int64           `json:"releaseNumber"`
	DeliveryContractVersion string          `json:"deliveryContractVersion"`
	Payload                 json.RawMessage `json:"-"`
	ContentHash             string          `json:"contentHash"`
	SourceReleaseID         string          `json:"sourceReleaseId,omitempty"`
	RollbackSourceReleaseID string          `json:"rollbackSourceReleaseId,omitempty"`
	PublishedByActorID      string          `json:"publishedByActorId"`
	PublishedAt             time.Time       `json:"publishedAt"`
}

type ReleasePlacement struct {
	ReleaseID        string
	ProjectID        string
	EnvironmentID    string
	PlacementID      string
	PlacementKey     string
	PaywallVersionID string
}

type ReleaseState struct {
	EnvironmentID     string
	ProjectID         string
	CurrentReleaseID  string
	LastReleaseNumber int64
	UpdatedAt         time.Time
}

type PublicationRequest struct {
	EnvironmentID      string
	Operation          string
	IdempotencyKeyHash string
	RequestHash        string
	ResultReleaseID    string
	CreatedAt          time.Time
}

type APIKeyRecord struct {
	ID            string
	EnvironmentID string
	Kind          string
	Prefix        string
	SecretDigest  []byte
	RevokedAt     *time.Time
}

type AuditEvent struct {
	ID             string
	ActorID        string
	OrganizationID string
	ProjectID      string
	EnvironmentID  string
	Action         string
	ResourceType   string
	ResourceID     string
	Metadata       map[string]string
	CreatedAt      time.Time
}

type Page struct {
	NextCursor string `json:"nextCursor,omitempty"`
}

type List[T any] struct {
	Items []T  `json:"items"`
	Page  Page `json:"page"`
}

type PublishResult struct {
	Release  Release  `json:"release"`
	Warnings []string `json:"warnings"`
}

type SDKConfiguration struct {
	Release                 Release
	Payload                 json.RawMessage
	ContentHash             string
	DeliveryContractVersion string
	Environment             Environment
	APIKeyID                string
}

type SDKCommerceConfiguration struct {
	Snapshot    CommerceConfigurationSnapshot
	Environment Environment
	APIKeyID    string
}

func DraftETag(id string, revision int64) string {
	return `"draft-` + id + `-r` + formatInt(revision) + `"`
}
