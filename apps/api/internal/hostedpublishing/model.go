package hostedpublishing

import (
	"encoding/json"
	"io"
	"time"
)

const (
	ProtocolVersion = "0.2"
	DeliveryVersion = "1"
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
}

type Product struct {
	ID             string
	ProjectID      string
	Type           string
	Status         string
	MetadataSource string
	InternalName   string
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
	Release     Release
	Environment Environment
	APIKeyID    string
}

func DraftETag(id string, revision int64) string {
	return `"draft-` + id + `-r` + formatInt(revision) + `"`
}
