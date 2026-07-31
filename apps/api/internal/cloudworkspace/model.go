package cloudworkspace

import "time"

type Actor struct {
	ID string
}

type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

type Organization struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Membership struct {
	OrganizationID string    `json:"organizationId"`
	ActorID        string    `json:"actorId"`
	Role           Role      `json:"role"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type ProjectStatus string

const (
	ProjectActive   ProjectStatus = "active"
	ProjectArchived ProjectStatus = "archived"
)

type Project struct {
	ID             string        `json:"id"`
	OrganizationID string        `json:"organizationId"`
	Key            string        `json:"key"`
	Name           string        `json:"name"`
	Status         ProjectStatus `json:"status"`
	ArchivedAt     *time.Time    `json:"archivedAt,omitempty"`
	CreatedAt      time.Time     `json:"createdAt"`
	UpdatedAt      time.Time     `json:"updatedAt"`
}

type Platform string

const (
	PlatformIOS     Platform = "ios"
	PlatformAndroid Platform = "android"
)

type Application struct {
	ID         string    `json:"id"`
	ProjectID  string    `json:"projectId"`
	Name       string    `json:"name"`
	Platform   Platform  `json:"platform"`
	Identifier string    `json:"identifier"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Environment struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	Key       string    `json:"key"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type APIKeyKind string

const (
	APIKeyPublicSDK    APIKeyKind = "public_sdk"
	APIKeySecretServer APIKeyKind = "secret_server"
)

type APIKey struct {
	ID               string     `json:"id"`
	EnvironmentID    string     `json:"environmentId"`
	Kind             APIKeyKind `json:"kind"`
	Prefix           string     `json:"prefix"`
	CreatedByActorID string     `json:"createdByActorId"`
	CreatedAt        time.Time  `json:"createdAt"`
	RotatedAt        *time.Time `json:"rotatedAt,omitempty"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
	LastUsedAt       *time.Time `json:"lastUsedAt,omitempty"`
}

type APIKeyRecord struct {
	APIKey
	SecretDigest [32]byte `json:"-"`
}

type APIKeySecretResult struct {
	APIKey APIKey `json:"apiKey"`
	Secret string `json:"secret"`
}

type Plan struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type ProductType string

const (
	ProductSubscription         ProductType = "subscription"
	ProductOneTimeNonConsumable ProductType = "one_time_non_consumable"
)

type ProductStatus string

const (
	ProductDraft             ProductStatus = "draft"
	ProductConnected         ProductStatus = "connected"
	ProductAttentionRequired ProductStatus = "attention_required"
	ProductArchived          ProductStatus = "archived"
)

type MetadataSource string

const (
	MetadataMock     MetadataSource = "mock"
	MetadataProvider MetadataSource = "provider"
)

type ProductReadiness struct {
	Ready          bool           `json:"ready"`
	Reasons        []string       `json:"reasons"`
	MetadataSource MetadataSource `json:"metadataSource"`
}

type Product struct {
	ID                   string           `json:"id"`
	ProjectID            string           `json:"projectId"`
	Key                  string           `json:"key"`
	InternalName         string           `json:"internalName"`
	Description          string           `json:"description,omitempty"`
	Type                 ProductType      `json:"type"`
	Status               ProductStatus    `json:"status"`
	MetadataSource       MetadataSource   `json:"metadataSource"`
	Readiness            ProductReadiness `json:"readiness"`
	ReplacementProductID string           `json:"replacementProductId,omitempty"`
	ArchivedAt           *time.Time       `json:"archivedAt,omitempty"`
	CreatedAt            time.Time        `json:"createdAt"`
	UpdatedAt            time.Time        `json:"updatedAt"`
}

type Entitlement struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type PlanProduct struct {
	PlanID    string    `json:"planId"`
	ProductID string    `json:"productId"`
	CreatedAt time.Time `json:"createdAt"`
}

type ProductEntitlementGrant struct {
	ProductID     string    `json:"productId"`
	EntitlementID string    `json:"entitlementId"`
	CreatedAt     time.Time `json:"createdAt"`
}

type ProductReplacementHistory struct {
	ProjectID            string    `json:"projectId"`
	ProductID            string    `json:"productId"`
	ReplacementProductID string    `json:"replacementProductId"`
	ChangedAt            time.Time `json:"changedAt"`
}

type ProviderKind string

const (
	ProviderRevenueCat ProviderKind = "revenuecat"
	ProviderAppStore   ProviderKind = "app_store"
	ProviderGooglePlay ProviderKind = "google_play"
	ProviderCustom     ProviderKind = "custom"
)

type ProviderProductMapping struct {
	ID                        string       `json:"id"`
	ProductID                 string       `json:"productId"`
	ApplicationID             string       `json:"applicationId"`
	Provider                  ProviderKind `json:"provider"`
	ProviderProductIdentifier string       `json:"providerProductIdentifier"`
	Status                    string       `json:"status"`
	CreatedAt                 time.Time    `json:"createdAt"`
	UpdatedAt                 time.Time    `json:"updatedAt"`
}

type ProductUsage struct {
	ProductID            string                   `json:"productId"`
	Plans                []Plan                   `json:"plans"`
	Entitlements         []Entitlement            `json:"entitlements"`
	ProviderMappings     []ProviderProductMapping `json:"providerMappings"`
	HistoricalReferences []string                 `json:"historicalReferences"`
}

type AuditEvent struct {
	ID             string            `json:"id"`
	ActorID        string            `json:"actorId"`
	OrganizationID string            `json:"organizationId"`
	ProjectID      string            `json:"projectId,omitempty"`
	EnvironmentID  string            `json:"environmentId,omitempty"`
	Action         string            `json:"action"`
	ResourceType   string            `json:"resourceType"`
	ResourceID     string            `json:"resourceId"`
	Metadata       map[string]string `json:"metadata"`
	CreatedAt      time.Time         `json:"createdAt"`
}

type Page struct {
	NextCursor string `json:"nextCursor,omitempty"`
}

type List[T any] struct {
	Items []T  `json:"items"`
	Page  Page `json:"page"`
}

type ListOptions struct {
	Cursor string
	Limit  int
}

type ProductFilters struct {
	ListOptions
	Status ProductStatus
	Type   ProductType
	Search string
}

type AuditFilters struct {
	ListOptions
	ProjectID string
	Action    string
}
