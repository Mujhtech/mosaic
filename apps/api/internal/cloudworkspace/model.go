package cloudworkspace

import (
	"encoding/json"
	"time"

	"github.com/Mujhtech/mosaic/apps/api/internal/providerreadiness"
)

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
	ID        string          `json:"id"`
	ProjectID string          `json:"projectId"`
	Key       string          `json:"key"`
	Name      string          `json:"name"`
	Mode      EnvironmentMode `json:"mode"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type EnvironmentMode string

const (
	EnvironmentDevelopment EnvironmentMode = "development"
	EnvironmentStaging     EnvironmentMode = "staging"
	EnvironmentProduction  EnvironmentMode = "production"
)

type APIKeyKind string

const (
	APIKeyPublicSDK    APIKeyKind = "public_sdk"
	APIKeySecretServer APIKeyKind = "secret_server"
)

type APIKey struct {
	ID                   string     `json:"id"`
	EnvironmentID        string     `json:"environmentId"`
	ApplicationID        string     `json:"applicationId,omitempty"`
	ApplicationProjectID string     `json:"-"`
	Kind                 APIKeyKind `json:"kind"`
	Prefix               string     `json:"prefix"`
	CreatedByActorID     string     `json:"createdByActorId"`
	CreatedAt            time.Time  `json:"createdAt"`
	RotatedAt            *time.Time `json:"rotatedAt,omitempty"`
	RevokedAt            *time.Time `json:"revokedAt,omitempty"`
	LastUsedAt           *time.Time `json:"lastUsedAt,omitempty"`
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

type ProviderIntegrationMode string

const (
	ProviderServerConnected ProviderIntegrationMode = "server_connected"
	ProviderSDKOnly         ProviderIntegrationMode = "sdk_only"
)

type ProviderConnectionMode string

const (
	ProviderSandbox    ProviderConnectionMode = "sandbox"
	ProviderProduction ProviderConnectionMode = "production"
)

type ProviderConnectionStatus string

const (
	ProviderConnectionPending ProviderConnectionStatus = "pending"
	ProviderConnectionActive  ProviderConnectionStatus = "active"
	ProviderConnectionRevoked ProviderConnectionStatus = "revoked"
)

type ProviderHealthStatus string

const (
	ProviderHealthUntested    ProviderHealthStatus = "untested"
	ProviderHealthHealthy     ProviderHealthStatus = "healthy"
	ProviderHealthDegraded    ProviderHealthStatus = "degraded"
	ProviderHealthUnavailable ProviderHealthStatus = "unavailable"
	ProviderHealthRevoked     ProviderHealthStatus = "revoked"
)

type ProviderConnection struct {
	ID                   string                   `json:"id"`
	ProjectID            string                   `json:"projectId"`
	Name                 string                   `json:"name"`
	Provider             ProviderKind             `json:"provider"`
	IntegrationMode      ProviderIntegrationMode  `json:"integrationMode"`
	Mode                 ProviderConnectionMode   `json:"mode"`
	Status               ProviderConnectionStatus `json:"status"`
	HealthStatus         ProviderHealthStatus     `json:"healthStatus"`
	ExternalProjectID    string                   `json:"externalProjectId,omitempty"`
	EnvironmentIDs       []string                 `json:"environmentIds"`
	ApplicationIDs       []string                 `json:"applicationIds"`
	LastSuccessfulTestAt *time.Time               `json:"lastSuccessfulTestAt,omitempty"`
	LastSuccessfulSyncAt *time.Time               `json:"lastSuccessfulSyncAt,omitempty"`
	LastErrorCode        ProviderErrorCode        `json:"lastErrorCode,omitempty"`
	Credential           *ProviderCredential      `json:"credential,omitempty"`
	RevokedAt            *time.Time               `json:"revokedAt,omitempty"`
	CreatedAt            time.Time                `json:"createdAt"`
	UpdatedAt            time.Time                `json:"updatedAt"`
}

type ProviderCredential struct {
	Class           string     `json:"class"`
	Fingerprint     string     `json:"fingerprint"`
	KeyID           string     `json:"keyId"`
	EnvelopeVersion int        `json:"envelopeVersion"`
	CreatedAt       time.Time  `json:"createdAt"`
	RotatedAt       *time.Time `json:"rotatedAt,omitempty"`
	RevokedAt       *time.Time `json:"revokedAt,omitempty"`
}

// ProviderCredentialRecord is persistence-only. Ciphertext, nonce, and the
// complete fingerprint are never serialized into public API responses.
type ProviderCredentialRecord struct {
	ConnectionID   string
	ProjectID      string
	OrganizationID string
	Class          string
	Version        int
	Algorithm      string
	KeyID          string
	Nonce          []byte
	Ciphertext     []byte
	Fingerprint    []byte
	CreatedAt      time.Time
	RotatedAt      *time.Time
	RevokedAt      *time.Time
	UpdatedAt      time.Time
}

type ProviderCapability struct {
	Name       string `json:"name"`
	Support    string `json:"support"`
	ReasonCode string `json:"reasonCode,omitempty"`
}

type ProviderConnectionHealth struct {
	ConnectionID        string               `json:"connectionId"`
	Status              ProviderHealthStatus `json:"status"`
	LastSuccessfulAt    *time.Time           `json:"lastSuccessfulAt,omitempty"`
	LastErrorCode       ProviderErrorCode    `json:"lastErrorCode,omitempty"`
	Capabilities        []ProviderCapability `json:"capabilities"`
	RequiredPermissions []string             `json:"requiredPermissions"`
}

type ProviderDiagnostic struct {
	ID                string            `json:"id"`
	ProjectID         string            `json:"projectId"`
	ConnectionID      string            `json:"connectionId"`
	Operation         string            `json:"operation"`
	Code              ProviderErrorCode `json:"code"`
	Retryable         bool              `json:"retryable"`
	RetryAfterSeconds *int              `json:"retryAfterSeconds,omitempty"`
	CorrelationID     string            `json:"correlationId"`
	OccurredAt        time.Time         `json:"occurredAt"`
}

type ActiveProviderAssignment struct {
	ProjectID                           string                 `json:"projectId"`
	EnvironmentID                       string                 `json:"environmentId"`
	ApplicationID                       string                 `json:"applicationId"`
	Platform                            Platform               `json:"platform"`
	Provider                            ProviderKind           `json:"provider"`
	ActivationKind                      ProviderActivationKind `json:"activationKind"`
	ConnectionID                        string                 `json:"connectionId,omitempty"`
	ProductionConnectionUseAcknowledged bool                   `json:"productionConnectionUseAcknowledged"`
	CreatedByActorID                    string                 `json:"createdByActorId"`
	CreatedAt                           time.Time              `json:"createdAt"`
	UpdatedAt                           time.Time              `json:"updatedAt"`
}

type ProviderActivationKind string

const (
	ProviderActivationConnection  ProviderActivationKind = "provider_connection"
	ProviderActivationNativeStore ProviderActivationKind = "native_store"
)

type ProviderMappingStatus string

const (
	ProviderMappingPlaceholder       ProviderMappingStatus = "placeholder"
	ProviderMappingDraft             ProviderMappingStatus = "draft"
	ProviderMappingActive            ProviderMappingStatus = "active"
	ProviderMappingAttentionRequired ProviderMappingStatus = "attention_required"
	ProviderMappingArchived          ProviderMappingStatus = "archived"
)

type ProviderAvailability string

const (
	ProviderAvailabilityUnknown     ProviderAvailability = "unknown"
	ProviderAvailabilityAvailable   ProviderAvailability = "available"
	ProviderAvailabilityUnavailable ProviderAvailability = "unavailable"
)

type ProviderSyncState string

const (
	ProviderSyncNeverSynced ProviderSyncState = "never_synced"
	ProviderSyncCurrent     ProviderSyncState = "current"
	ProviderSyncStale       ProviderSyncState = "stale"
	ProviderSyncFailed      ProviderSyncState = "failed"
)

type ProviderProductMapping struct {
	ID                         string                `json:"id"`
	ProjectID                  string                `json:"projectId"`
	ProductID                  string                `json:"productId"`
	ConnectionID               string                `json:"connectionId,omitempty"`
	EnvironmentID              string                `json:"environmentId,omitempty"`
	ApplicationID              string                `json:"applicationId"`
	Platform                   Platform              `json:"platform,omitempty"`
	Provider                   ProviderKind          `json:"provider"`
	ProviderProductIdentifier  string                `json:"providerProductIdentifier"`
	ProviderPackageIdentifier  string                `json:"providerPackageIdentifier,omitempty"`
	ProviderOfferingIdentifier string                `json:"providerOfferingIdentifier,omitempty"`
	ExpectedStoreProductID     string                `json:"expectedStoreProductId,omitempty"`
	ProviderBasePlanIdentifier string                `json:"providerBasePlanIdentifier,omitempty"`
	ProviderOfferIdentifier    string                `json:"providerOfferIdentifier,omitempty"`
	ReplacesMappingID          string                `json:"replacesMappingId,omitempty"`
	Status                     ProviderMappingStatus `json:"status"`
	Availability               ProviderAvailability  `json:"availability"`
	SyncState                  ProviderSyncState     `json:"syncState"`
	CurrentSnapshotID          string                `json:"currentSnapshotId,omitempty"`
	LastErrorCode              ProviderErrorCode     `json:"lastErrorCode,omitempty"`
	ArchivedAt                 *time.Time            `json:"archivedAt,omitempty"`
	CreatedAt                  time.Time             `json:"createdAt"`
	UpdatedAt                  time.Time             `json:"updatedAt"`
}

type ProviderObservationContext string

const (
	ProviderObservationStoreKitConfiguration ProviderObservationContext = "storekitConfiguration"
	ProviderObservationAppleSandbox          ProviderObservationContext = "appleSandbox"
	ProviderObservationGooglePlayTest        ProviderObservationContext = "googlePlayTest"
	ProviderObservationProduction            ProviderObservationContext = "production"
	ProviderObservationUnknown               ProviderObservationContext = "unknown"
)

type ProviderObservationResult string

const (
	ProviderObservationAvailable   ProviderObservationResult = "available"
	ProviderObservationUnavailable ProviderObservationResult = "unavailable"
	ProviderObservationFailed      ProviderObservationResult = "failed"
)

type ProviderObservationConfigurationSource string

const (
	ProviderObservationConfigurationBundled ProviderObservationConfigurationSource = "bundled"
	ProviderObservationConfigurationRemote  ProviderObservationConfigurationSource = "remote"
	ProviderObservationConfigurationLocal   ProviderObservationConfigurationSource = "local"
	ProviderObservationConfigurationUnknown ProviderObservationConfigurationSource = "unknown"
)

type ProviderObservationClientPlatform string

const (
	ProviderObservationClientIOS     ProviderObservationClientPlatform = "ios"
	ProviderObservationClientAndroid ProviderObservationClientPlatform = "android"
	ProviderObservationClientFlutter ProviderObservationClientPlatform = "flutter"
)

type ProviderObservationTestScenario string

const (
	ProviderObservationScenarioProductLoad             ProviderObservationTestScenario = "productLoad"
	ProviderObservationScenarioConfigurationAcceptance ProviderObservationTestScenario = "configurationAcceptance"
	ProviderObservationScenarioPurchasePresentation    ProviderObservationTestScenario = "purchasePresentation"
	ProviderObservationScenarioRestore                 ProviderObservationTestScenario = "restore"
)

// ProviderMappingObservationMetadata is intentionally closed and operational.
// It excludes free-form messages, device identity, provider payloads, and
// customer or payment material.
type ProviderMappingObservationMetadata struct {
	ClientPlatform        ProviderObservationClientPlatform      `json:"clientPlatform,omitempty"`
	ClientVersion         string                                 `json:"clientVersion,omitempty"`
	ApplicationVersion    string                                 `json:"applicationVersion,omitempty"`
	OSVersion             string                                 `json:"osVersion,omitempty"`
	ConfigurationSource   ProviderObservationConfigurationSource `json:"configurationSource,omitempty"`
	StorefrontCountryCode string                                 `json:"storefrontCountryCode,omitempty"`
	TestScenario          ProviderObservationTestScenario        `json:"testScenario,omitempty"`
}

// ProviderMappingObservation is immutable, bounded developer-supplied evidence.
// It never contains transactions, receipts, purchase tokens, or customer data.
type ProviderMappingObservation struct {
	ID               string                             `json:"id"`
	ProjectID        string                             `json:"projectId"`
	MappingID        string                             `json:"mappingId"`
	EnvironmentID    string                             `json:"environmentId"`
	ApplicationID    string                             `json:"applicationId"`
	Platform         Platform                           `json:"platform"`
	Provider         ProviderKind                       `json:"provider"`
	AdapterVersion   string                             `json:"adapterVersion"`
	StoreContext     ProviderObservationContext         `json:"storeContext"`
	Result           ProviderObservationResult          `json:"result"`
	DiagnosticCode   string                             `json:"diagnosticCode,omitempty"`
	CorrelationID    string                             `json:"correlationId"`
	Metadata         ProviderMappingObservationMetadata `json:"metadata"`
	ObservedAt       time.Time                          `json:"observedAt"`
	ExpiresAt        *time.Time                         `json:"expiresAt,omitempty"`
	ReceivedAt       time.Time                          `json:"receivedAt"`
	CreatedByActorID string                             `json:"createdByActorId"`
}

type ProviderMetadataSource string

const (
	ProviderMetadataProvider    ProviderMetadataSource = "provider"
	ProviderMetadataSDKSnapshot ProviderMetadataSource = "sdk_snapshot"
	ProviderMetadataManual      ProviderMetadataSource = "manual"
)

// ProviderProductMetadataSnapshot is immutable provider-observation history.
// It intentionally excludes raw provider responses and credentials.
type ProviderProductMetadataSnapshot struct {
	ID            string                 `json:"id"`
	ProjectID     string                 `json:"projectId"`
	MappingID     string                 `json:"mappingId"`
	Source        ProviderMetadataSource `json:"source"`
	Digest        string                 `json:"digest"`
	Availability  ProviderAvailability   `json:"availability"`
	ObservedAt    time.Time              `json:"observedAt"`
	SyncedAt      time.Time              `json:"syncedAt"`
	StaleAt       time.Time              `json:"staleAt"`
	ExpiresAt     *time.Time             `json:"expiresAt,omitempty"`
	LastErrorCode ProviderErrorCode      `json:"lastErrorCode,omitempty"`
	Metadata      json.RawMessage        `json:"metadata"`
	CreatedAt     time.Time              `json:"createdAt"`
}

type ProviderCatalogPreview struct {
	ConnectionID string                       `json:"connectionId"`
	ObservedAt   time.Time                    `json:"observedAt"`
	Applications []ProviderCatalogApplication `json:"applications"`
	Products     []ProviderCatalogProduct     `json:"products"`
	Entitlements []ProviderCatalogEntitlement `json:"entitlements"`
	Offerings    []ProviderCatalogOffering    `json:"offerings"`
}

type ProviderCatalogApplication struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Platform   string `json:"platform"`
	Identifier string `json:"identifier,omitempty"`
}

type ProviderCatalogProduct struct {
	ID              string `json:"id"`
	ApplicationID   string `json:"applicationId"`
	StoreIdentifier string `json:"storeIdentifier"`
	DisplayName     string `json:"displayName,omitempty"`
	Type            string `json:"type"`
	State           string `json:"state"`
	Importable      bool   `json:"importable"`
}

type ProviderCatalogEntitlement struct {
	ID          string `json:"id"`
	LookupKey   string `json:"lookupKey"`
	DisplayName string `json:"displayName"`
	State       string `json:"state"`
}

type ProviderCatalogPackage struct {
	ID          string   `json:"id"`
	LookupKey   string   `json:"lookupKey"`
	DisplayName string   `json:"displayName"`
	ProductIDs  []string `json:"productIds"`
}

type ProviderCatalogOffering struct {
	ID          string                   `json:"id"`
	LookupKey   string                   `json:"lookupKey"`
	DisplayName string                   `json:"displayName"`
	State       string                   `json:"state"`
	IsCurrent   bool                     `json:"isCurrent"`
	Packages    []ProviderCatalogPackage `json:"packages"`
}

type ProviderEntitlementMapping struct {
	ID                            string                `json:"id"`
	ProjectID                     string                `json:"projectId"`
	EntitlementID                 string                `json:"entitlementId"`
	ConnectionID                  string                `json:"connectionId"`
	EnvironmentID                 string                `json:"environmentId"`
	ApplicationID                 string                `json:"applicationId"`
	ProviderEntitlementIdentifier string                `json:"providerEntitlementIdentifier"`
	Status                        ProviderMappingStatus `json:"status"`
	ArchivedAt                    *time.Time            `json:"archivedAt,omitempty"`
	CreatedAt                     time.Time             `json:"createdAt"`
	UpdatedAt                     time.Time             `json:"updatedAt"`
}

type ProviderImportStatus string

const (
	ProviderImportInProgress ProviderImportStatus = "in_progress"
	ProviderImportCompleted  ProviderImportStatus = "completed"
	ProviderImportPartial    ProviderImportStatus = "partial"
)

type ProviderImportRequest struct {
	ID                 string               `json:"id"`
	ProjectID          string               `json:"projectId"`
	ConnectionID       string               `json:"connectionId"`
	IdempotencyKeyHash [32]byte             `json:"-"`
	RequestHash        [32]byte             `json:"-"`
	Status             ProviderImportStatus `json:"status"`
	CreatedByActorID   string               `json:"createdByActorId"`
	CreatedAt          time.Time            `json:"createdAt"`
	CompletedAt        *time.Time           `json:"completedAt,omitempty"`
}

type ProviderImportItem struct {
	ImportID                  string            `json:"importId"`
	ProjectID                 string            `json:"projectId"`
	ProviderProductIdentifier string            `json:"providerProductIdentifier"`
	MosaicProductID           string            `json:"mosaicProductId,omitempty"`
	MappingID                 string            `json:"mappingId,omitempty"`
	Status                    string            `json:"status"`
	ErrorCode                 ProviderErrorCode `json:"errorCode,omitempty"`
	CreatedAt                 time.Time         `json:"createdAt"`
}

type ProviderImportResult struct {
	Import ProviderImportRequest `json:"import"`
	Items  []ProviderImportItem  `json:"items"`
}

type ProviderSyncJobStatus string

const (
	ProviderSyncJobQueued    ProviderSyncJobStatus = "queued"
	ProviderSyncJobLeased    ProviderSyncJobStatus = "leased"
	ProviderSyncJobCompleted ProviderSyncJobStatus = "completed"
	ProviderSyncJobFailed    ProviderSyncJobStatus = "failed"
)

type ProviderSyncJob struct {
	ID                 string                `json:"id"`
	ProjectID          string                `json:"projectId"`
	ConnectionID       string                `json:"connectionId"`
	Status             ProviderSyncJobStatus `json:"status"`
	AttemptCount       int                   `json:"attemptCount"`
	MaxAttempts        int                   `json:"maxAttempts"`
	AvailableAt        time.Time             `json:"availableAt"`
	LeaseOwner         string                `json:"-"`
	LeaseExpiresAt     *time.Time            `json:"-"`
	RequestedByActorID string                `json:"requestedByActorId"`
	CreatedAt          time.Time             `json:"createdAt"`
	UpdatedAt          time.Time             `json:"updatedAt"`
}

type ProviderSyncRun struct {
	ID           string     `json:"id"`
	ProjectID    string     `json:"projectId"`
	ConnectionID string     `json:"connectionId"`
	JobID        string     `json:"jobId"`
	Status       string     `json:"status"`
	ItemCount    int        `json:"itemCount"`
	SuccessCount int        `json:"successCount"`
	FailureCount int        `json:"failureCount"`
	StartedAt    time.Time  `json:"startedAt"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type ProviderSyncRunItem struct {
	RunID       string            `json:"runId"`
	ProjectID   string            `json:"projectId"`
	MappingID   string            `json:"mappingId"`
	Status      string            `json:"status"`
	SnapshotID  string            `json:"snapshotId,omitempty"`
	ErrorCode   ProviderErrorCode `json:"errorCode,omitempty"`
	CompletedAt time.Time         `json:"completedAt"`
}

type ProviderErrorCode string

const (
	ProviderErrorCredentialInvalid   ProviderErrorCode = "credentialInvalid"
	ProviderErrorCredentialExpired   ProviderErrorCode = "credentialExpired"
	ProviderErrorPermissionDenied    ProviderErrorCode = "permissionDenied"
	ProviderErrorConnectionRevoked   ProviderErrorCode = "connectionRevoked"
	ProviderErrorScopeMismatch       ProviderErrorCode = "scopeMismatch"
	ProviderErrorModeMismatch        ProviderErrorCode = "modeMismatch"
	ProviderErrorRateLimited         ProviderErrorCode = "rateLimited"
	ProviderErrorTimeout             ProviderErrorCode = "timeout"
	ProviderErrorProviderUnavailable ProviderErrorCode = "providerUnavailable"
	ProviderErrorInvalidResponse     ProviderErrorCode = "invalidResponse"
	ProviderErrorProductNotFound     ProviderErrorCode = "productNotFound"
	ProviderErrorProductUnavailable  ProviderErrorCode = "productUnavailable"
	ProviderErrorMappingMissing      ProviderErrorCode = "mappingMissing"
	ProviderErrorMappingAmbiguous    ProviderErrorCode = "mappingAmbiguous"
	ProviderErrorSyncInProgress      ProviderErrorCode = "syncInProgress"
	ProviderErrorSyncPartial         ProviderErrorCode = "syncPartial"
	ProviderErrorSyncFailed          ProviderErrorCode = "syncFailed"
	ProviderErrorMetadataStale       ProviderErrorCode = "metadataStale"
	ProviderErrorIdempotencyConflict ProviderErrorCode = "idempotencyConflict"
)

type ProviderReadinessState string

const (
	ProviderReadinessConfigured        ProviderReadinessState = "configured"
	ProviderReadinessVerifiedInTest    ProviderReadinessState = "verifiedInTest"
	ProviderReadinessAttentionRequired ProviderReadinessState = "attentionRequired"
	ProviderReadinessUnavailable       ProviderReadinessState = "unavailable"
	ProviderReadinessArchived          ProviderReadinessState = "archived"
)

type ProviderReadinessIssue struct {
	Code           ProviderErrorCode        `json:"code"`
	ResourceType   string                   `json:"resourceType"`
	ResourceID     string                   `json:"resourceId"`
	RecoveryAction providerreadiness.Action `json:"recoveryAction"`
}

type ProviderReadiness struct {
	State         ProviderReadinessState      `json:"state"`
	ProductID     string                      `json:"productId"`
	EnvironmentID string                      `json:"environmentId"`
	ApplicationID string                      `json:"applicationId"`
	Platform      Platform                    `json:"platform"`
	ConnectionID  string                      `json:"connectionId,omitempty"`
	Provider      ProviderKind                `json:"provider,omitempty"`
	MappingID     string                      `json:"mappingId,omitempty"`
	Observation   *ProviderMappingObservation `json:"observation,omitempty"`
	Blockers      []ProviderReadinessIssue    `json:"blockers"`
	Warnings      []ProviderReadinessIssue    `json:"warnings"`
	EvaluatedAt   time.Time                   `json:"evaluatedAt"`
}

type ProductUsage struct {
	ProductID            string                   `json:"productId"`
	Plans                []Plan                   `json:"plans"`
	Entitlements         []Entitlement            `json:"entitlements"`
	ProviderMappings     []ProviderProductMapping `json:"providerMappings"`
	HistoricalReferences []string                 `json:"historicalReferences"`
}

type ProviderMappingUsage struct {
	Mapping ProviderProductMapping `json:"mapping"`
	Product Product                `json:"product"`
	Usage   ProductUsage           `json:"usage"`
}

type ProviderProfile struct {
	Provider       ProviderKind         `json:"provider"`
	DisplayName    string               `json:"displayName"`
	Platform       Platform             `json:"platform"`
	AdapterVersion string               `json:"adapterVersion"`
	Capabilities   []ProviderCapability `json:"capabilities"`
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
