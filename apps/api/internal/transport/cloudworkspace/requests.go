package cloudworkspacehttp

import (
	"errors"
	"regexp"
	"strconv"
	"time"

	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

var keyPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,62}$`)
var nonWhitespacePattern = regexp.MustCompile(`\S`)

// revenueCatSecretPattern and jsonDocumentPattern are the transport-level
// shapes of the two server-connected credentials. Neither proves the credential
// works; both keep an obviously wrong paste out of the encryption path.
var (
	revenueCatSecretPattern = regexp.MustCompile(`^sk_[^\s]+$`)
	jsonDocumentPattern     = regexp.MustCompile(`(?s)^\s*\{.*\}\s*$`)
	// providerCredentialShapePattern accepts either form, because the request
	// that rotates a credential does not name its provider.
	providerCredentialShapePattern = regexp.MustCompile(`(?s)^(sk_[^\s]+|\s*\{.*\}\s*)$`)
)

type organizationRequest struct {
	Name string `json:"name"`
}

func (request *organizationRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Name, validation.Required, validation.Length(1, 120)))
}

type memberRequest struct {
	ActorID string              `json:"actorId"`
	Role    cloudworkspace.Role `json:"role"`
}

func (request *memberRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.ActorID, validation.Required, validation.Length(1, 200)), validation.Field(&request.Role, validation.Required, validation.In(cloudworkspace.RoleOwner, cloudworkspace.RoleAdmin, cloudworkspace.RoleMember)))
}

type memberRoleRequest struct {
	Role cloudworkspace.Role `json:"role"`
}

func (request *memberRoleRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Role, validation.Required, validation.In(cloudworkspace.RoleOwner, cloudworkspace.RoleAdmin, cloudworkspace.RoleMember)))
}

type projectRequest struct {
	OrganizationID string `json:"organizationId"`
	Key            string `json:"key"`
	Name           string `json:"name"`
}

func (request *projectRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.OrganizationID, validation.Required), validation.Field(&request.Key, validation.Required, validation.Match(keyPattern)), validation.Field(&request.Name, validation.Required, validation.Length(1, 120)))
}

type applicationRequest struct {
	Name       string                  `json:"name"`
	Platform   cloudworkspace.Platform `json:"platform"`
	Identifier string                  `json:"identifier"`
}

func (request *applicationRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Name, validation.Required, validation.Length(1, 120)), validation.Field(&request.Platform, validation.Required, validation.In(cloudworkspace.PlatformIOS, cloudworkspace.PlatformAndroid)), validation.Field(&request.Identifier, validation.Required, validation.Length(3, 255)))
}

type apiKeyRequest struct {
	Kind          cloudworkspace.APIKeyKind `json:"kind"`
	ApplicationID string                    `json:"applicationId"`
}

type environmentModeRequest struct {
	Mode cloudworkspace.EnvironmentMode `json:"mode"`
}

func (request *environmentModeRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Mode, validation.Required, validation.In(
			cloudworkspace.EnvironmentDevelopment,
			cloudworkspace.EnvironmentStaging,
			cloudworkspace.EnvironmentProduction,
		)),
	)
}

func (request *apiKeyRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Kind, validation.Required, validation.In(cloudworkspace.APIKeyPublicSDK, cloudworkspace.APIKeySecretServer)),
		validation.Field(&request.ApplicationID,
			validation.When(request.Kind == cloudworkspace.APIKeyPublicSDK, validation.Required),
			validation.When(request.Kind == cloudworkspace.APIKeySecretServer, validation.Empty)),
	)
}

type catalogResourceRequest struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (request *catalogResourceRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Key, validation.Required, validation.Match(keyPattern)), validation.Field(&request.Name, validation.Required, validation.Length(1, 120)), validation.Field(&request.Description, validation.Length(0, 1000)))
}

type productRequest struct {
	Key          string                     `json:"key"`
	InternalName string                     `json:"internalName"`
	Description  string                     `json:"description"`
	Type         cloudworkspace.ProductType `json:"type"`
}

func (request *productRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.Key, validation.Required, validation.Match(keyPattern)), validation.Field(&request.InternalName, validation.Required, validation.Length(1, 120)), validation.Field(&request.Description, validation.Length(0, 1000)), validation.Field(&request.Type, validation.Required, validation.In(cloudworkspace.ProductSubscription, cloudworkspace.ProductOneTimeNonConsumable)))
}

type productReferenceRequest struct {
	ProductID string `json:"productId"`
}

func (request *productReferenceRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.ProductID, validation.Required))
}

type entitlementReferenceRequest struct {
	EntitlementID string `json:"entitlementId"`
}

func (request *entitlementReferenceRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.EntitlementID, validation.Required))
}

type providerMappingRequest struct {
	ApplicationID             string                      `json:"applicationId"`
	Provider                  cloudworkspace.ProviderKind `json:"provider"`
	ProviderProductIdentifier string                      `json:"providerProductIdentifier"`
}

func (request *providerMappingRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.ApplicationID, validation.Required), validation.Field(&request.Provider, validation.Required, validation.In(cloudworkspace.ProviderRevenueCat, cloudworkspace.ProviderAppStore, cloudworkspace.ProviderGooglePlay, cloudworkspace.ProviderCustom)), validation.Field(&request.ProviderProductIdentifier, validation.Required, validation.Length(1, 255)))
}

type providerConnectionRequest struct {
	Name              string                                 `json:"name"`
	Provider          cloudworkspace.ProviderKind            `json:"provider"`
	IntegrationMode   cloudworkspace.ProviderIntegrationMode `json:"integrationMode"`
	Mode              cloudworkspace.ProviderConnectionMode  `json:"mode"`
	ExternalProjectID string                                 `json:"externalProjectId"`
	EnvironmentIDs    []string                               `json:"environmentIds"`
	ApplicationIDs    []string                               `json:"applicationIds"`
	Credential        string                                 `json:"credential"`
}

func (request *providerConnectionRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Name, validation.Required, validation.Length(1, 120)),
		validation.Field(&request.Provider, validation.Required, validation.In(cloudworkspace.ProviderRevenueCat, cloudworkspace.ProviderAppStoreConnect, cloudworkspace.ProviderCustom)),
		validation.Field(&request.IntegrationMode, validation.Required, validation.In(cloudworkspace.ProviderServerConnected, cloudworkspace.ProviderSDKOnly)),
		validation.Field(&request.Mode, validation.Required, validation.In(cloudworkspace.ProviderSandbox, cloudworkspace.ProviderProduction)),
		validation.Field(&request.ExternalProjectID, validation.Length(0, 255),
			validation.When(request.Provider == cloudworkspace.ProviderRevenueCat,
				validation.Required, validation.Match(nonWhitespacePattern)),
			// An App Store Connect API key is team-scoped and names no second
			// project resource, so a value here is always a mistake.
			validation.When(request.Provider == cloudworkspace.ProviderAppStoreConnect, validation.Empty)),
		validation.Field(&request.EnvironmentIDs, validation.Required, validation.Length(1, 100), validation.Each(validation.Required)),
		validation.Field(&request.ApplicationIDs, validation.Required, validation.Length(1, 100), validation.Each(validation.Required)),
		validation.Field(&request.Credential, validation.Length(0, 4096),
			validation.When(request.Provider == cloudworkspace.ProviderRevenueCat,
				validation.Required, validation.Match(revenueCatSecretPattern)),
			// The App Store Connect credential is a JSON document whose real
			// shape — a parsable P-256 .p8, a ten-character key ID, an issuer
			// UUID — is checked by the application service. Transport only
			// asserts that something was sent and that it looks like JSON.
			validation.When(request.Provider == cloudworkspace.ProviderAppStoreConnect,
				validation.Required, validation.Match(jsonDocumentPattern)),
			validation.When(request.Provider == cloudworkspace.ProviderCustom, validation.Empty)),
	)
}

// providerCredentialRequest carries a replacement credential for an existing
// connection. The connection determines the provider, so the payload cannot be
// validated against one provider's shape here; the service applies the rules
// for the connection's actual provider.
type providerCredentialRequest struct {
	Credential string `json:"credential"`
}

func (request *providerCredentialRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Credential, validation.Required, validation.Length(6, 4096),
			validation.Match(providerCredentialShapePattern)),
	)
}

type providerConnectionScopesRequest struct {
	EnvironmentIDs []string `json:"environmentIds"`
	ApplicationIDs []string `json:"applicationIds"`
}

func (request *providerConnectionScopesRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.EnvironmentIDs, validation.Required, validation.Length(1, 100), validation.Each(validation.Required)),
		validation.Field(&request.ApplicationIDs, validation.Required, validation.Length(1, 100), validation.Each(validation.Required)),
	)
}

type providerAssignmentRequest struct {
	Provider                           cloudworkspace.ProviderKind           `json:"provider"`
	ActivationKind                     cloudworkspace.ProviderActivationKind `json:"activationKind"`
	ConnectionID                       string                                `json:"connectionId"`
	AcknowledgeProductionConnectionUse bool                                  `json:"acknowledgeProductionConnectionUse"`
}

func (request *providerAssignmentRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Provider, validation.When(request.ActivationKind == cloudworkspace.ProviderActivationNativeStore, validation.Required)),
		validation.Field(&request.ActivationKind, validation.In("", cloudworkspace.ProviderActivationConnection, cloudworkspace.ProviderActivationNativeStore)),
		validation.Field(&request.ConnectionID,
			validation.When(request.ActivationKind != cloudworkspace.ProviderActivationNativeStore, validation.Required),
			validation.When(request.ActivationKind == cloudworkspace.ProviderActivationNativeStore, validation.Empty)),
	)
}

type providerMappingDraftRequest struct {
	ConnectionID               string                      `json:"connectionId"`
	Provider                   cloudworkspace.ProviderKind `json:"provider"`
	EnvironmentID              string                      `json:"environmentId"`
	ApplicationID              string                      `json:"applicationId"`
	ProviderProductIdentifier  string                      `json:"providerProductIdentifier"`
	ProviderPackageIdentifier  string                      `json:"providerPackageIdentifier"`
	ProviderOfferingIdentifier string                      `json:"providerOfferingIdentifier"`
	ExpectedStoreProductID     string                      `json:"expectedStoreProductId"`
	ProviderBasePlanIdentifier string                      `json:"providerBasePlanIdentifier"`
	ProviderOfferIdentifier    string                      `json:"providerOfferIdentifier"`
}

func (request *providerMappingDraftRequest) Validate() error {
	if err := validation.ValidateStruct(request,
		validation.Field(&request.Provider, validation.When(request.ConnectionID == "", validation.Required,
			validation.In(cloudworkspace.ProviderAppStore, cloudworkspace.ProviderGooglePlay))),
		validation.Field(&request.EnvironmentID, validation.Required),
		validation.Field(&request.ApplicationID, validation.Required),
		validation.Field(&request.ProviderProductIdentifier, validation.Required, validation.Length(1, 255), validation.Match(nonWhitespacePattern)),
		validation.Field(&request.ProviderPackageIdentifier, validation.Length(0, 255), validation.When(request.ProviderPackageIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderOfferingIdentifier, validation.Length(0, 255), validation.When(request.ProviderOfferingIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ExpectedStoreProductID, validation.Length(0, 255), validation.When(request.ExpectedStoreProductID != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderBasePlanIdentifier, validation.Length(0, 255), validation.When(request.ProviderBasePlanIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderOfferIdentifier, validation.Length(0, 255), validation.When(request.ProviderOfferIdentifier != "", validation.Match(nonWhitespacePattern))),
	); err != nil {
		return err
	}
	if (request.ProviderPackageIdentifier == "") != (request.ProviderOfferingIdentifier == "") {
		return validation.Errors{
			"providerPackageIdentifier":  errors.New("package and offering identifiers must be supplied together"),
			"providerOfferingIdentifier": errors.New("package and offering identifiers must be supplied together"),
		}
	}
	return nil
}

type providerMappingReplacementRequest struct {
	ProviderProductIdentifier  string `json:"providerProductIdentifier"`
	ProviderPackageIdentifier  string `json:"providerPackageIdentifier"`
	ProviderOfferingIdentifier string `json:"providerOfferingIdentifier"`
	ProviderBasePlanIdentifier string `json:"providerBasePlanIdentifier"`
	ProviderOfferIdentifier    string `json:"providerOfferIdentifier"`
}

func (request *providerMappingReplacementRequest) Validate() error {
	if err := validation.ValidateStruct(request,
		validation.Field(&request.ProviderProductIdentifier, validation.Required, validation.Length(1, 255), validation.Match(nonWhitespacePattern)),
		validation.Field(&request.ProviderPackageIdentifier, validation.Length(0, 255), validation.When(request.ProviderPackageIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderOfferingIdentifier, validation.Length(0, 255), validation.When(request.ProviderOfferingIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderBasePlanIdentifier, validation.Length(0, 255), validation.When(request.ProviderBasePlanIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderOfferIdentifier, validation.Length(0, 255), validation.When(request.ProviderOfferIdentifier != "", validation.Match(nonWhitespacePattern))),
	); err != nil {
		return err
	}
	if (request.ProviderPackageIdentifier == "") != (request.ProviderOfferingIdentifier == "") {
		return validation.Errors{
			"providerPackageIdentifier":  errors.New("package and offering identifiers must be supplied together"),
			"providerOfferingIdentifier": errors.New("package and offering identifiers must be supplied together"),
		}
	}
	return nil
}

type providerMappingObservationRequest struct {
	AdapterVersion string                                    `json:"adapterVersion"`
	StoreContext   cloudworkspace.ProviderObservationContext `json:"storeContext"`
	Result         cloudworkspace.ProviderObservationResult  `json:"result"`
	DiagnosticCode string                                    `json:"diagnosticCode"`
	CorrelationID  string                                    `json:"correlationId"`
	Metadata       providerMappingObservationMetadataRequest `json:"metadata"`
	ObservedAt     time.Time                                 `json:"observedAt"`
	ExpiresAt      *time.Time                                `json:"expiresAt"`
}

type providerMappingObservationMetadataRequest struct {
	ClientPlatform        cloudworkspace.ProviderObservationClientPlatform      `json:"clientPlatform"`
	ClientVersion         string                                                `json:"clientVersion"`
	ApplicationVersion    string                                                `json:"applicationVersion"`
	OSVersion             string                                                `json:"osVersion"`
	ConfigurationSource   cloudworkspace.ProviderObservationConfigurationSource `json:"configurationSource"`
	StorefrontCountryCode string                                                `json:"storefrontCountryCode"`
	TestScenario          cloudworkspace.ProviderObservationTestScenario        `json:"testScenario"`
}

func (request providerMappingObservationMetadataRequest) domain() cloudworkspace.ProviderMappingObservationMetadata {
	return cloudworkspace.ProviderMappingObservationMetadata{
		ClientPlatform: request.ClientPlatform, ClientVersion: request.ClientVersion,
		ApplicationVersion: request.ApplicationVersion, OSVersion: request.OSVersion,
		ConfigurationSource:   request.ConfigurationSource,
		StorefrontCountryCode: request.StorefrontCountryCode, TestScenario: request.TestScenario,
	}
}

func (request *providerMappingObservationRequest) Validate() error {
	if err := validation.ValidateStruct(request,
		validation.Field(&request.AdapterVersion, validation.Required, validation.Length(1, 64)),
		validation.Field(&request.StoreContext, validation.Required, validation.In(
			cloudworkspace.ProviderObservationStoreKitConfiguration,
			cloudworkspace.ProviderObservationAppleSandbox,
			cloudworkspace.ProviderObservationGooglePlayTest,
			cloudworkspace.ProviderObservationProduction,
			cloudworkspace.ProviderObservationUnknown,
		)),
		validation.Field(&request.Result, validation.Required, validation.In(
			cloudworkspace.ProviderObservationAvailable,
			cloudworkspace.ProviderObservationUnavailable,
			cloudworkspace.ProviderObservationFailed,
		)),
		validation.Field(&request.DiagnosticCode, validation.Length(0, 128)),
		validation.Field(&request.CorrelationID, validation.Required, validation.Length(1, 128)),
		validation.Field(&request.ObservedAt, validation.Required),
	); err != nil {
		return err
	}
	return validation.ValidateStruct(&request.Metadata,
		validation.Field(&request.Metadata.ClientPlatform, validation.In(
			cloudworkspace.ProviderObservationClientIOS,
			cloudworkspace.ProviderObservationClientAndroid,
			cloudworkspace.ProviderObservationClientFlutter,
			"",
		)),
		validation.Field(&request.Metadata.ClientVersion, validation.Length(0, 64)),
		validation.Field(&request.Metadata.ApplicationVersion, validation.Length(0, 64)),
		validation.Field(&request.Metadata.OSVersion, validation.Length(0, 64)),
		validation.Field(&request.Metadata.ConfigurationSource, validation.In(
			cloudworkspace.ProviderObservationConfigurationBundled,
			cloudworkspace.ProviderObservationConfigurationRemote,
			cloudworkspace.ProviderObservationConfigurationLocal,
			cloudworkspace.ProviderObservationConfigurationUnknown,
			"",
		)),
		validation.Field(&request.Metadata.StorefrontCountryCode,
			validation.Match(regexp.MustCompile(`^$|^[A-Z]{2}$`))),
		validation.Field(&request.Metadata.TestScenario, validation.In(
			cloudworkspace.ProviderObservationScenarioProductLoad,
			cloudworkspace.ProviderObservationScenarioConfigurationAcceptance,
			cloudworkspace.ProviderObservationScenarioPurchasePresentation,
			cloudworkspace.ProviderObservationScenarioRestore,
			"",
		)),
	)
}

type providerEntitlementImportRequest struct {
	ProviderIdentifier    string `json:"providerIdentifier"`
	ExistingEntitlementID string `json:"existingEntitlementId"`
	Key                   string `json:"key"`
	Name                  string `json:"name"`
}

type providerProductImportItemRequest struct {
	ProviderProductIdentifier  string                             `json:"providerProductIdentifier"`
	ProviderPackageIdentifier  string                             `json:"providerPackageIdentifier"`
	ProviderOfferingIdentifier string                             `json:"providerOfferingIdentifier"`
	ExistingProductID          string                             `json:"existingProductId"`
	Key                        string                             `json:"key"`
	InternalName               string                             `json:"internalName"`
	EnvironmentID              string                             `json:"environmentId"`
	ApplicationID              string                             `json:"applicationId"`
	Entitlements               []providerEntitlementImportRequest `json:"entitlements"`
}

type providerImportRequest struct {
	ConnectionID string                             `json:"connectionId"`
	Items        []providerProductImportItemRequest `json:"items"`
}

func (request *providerImportRequest) Validate() error {
	if err := validation.ValidateStruct(request,
		validation.Field(&request.ConnectionID, validation.Required),
		validation.Field(&request.Items, validation.Required, validation.Length(1, 100)),
	); err != nil {
		return err
	}
	fields := validation.Errors{}
	for index, item := range request.Items {
		prefix := "items[" + strconv.Itoa(index) + "]."
		if item.ProviderProductIdentifier == "" || len(item.ProviderProductIdentifier) > 255 {
			fields[prefix+"providerProductIdentifier"] = errors.New("provider Product identifier is required")
		}
		if item.EnvironmentID == "" {
			fields[prefix+"environmentId"] = errors.New("Environment ID is required")
		}
		if item.ApplicationID == "" {
			fields[prefix+"applicationId"] = errors.New("Application ID is required")
		}
		if (item.ProviderPackageIdentifier == "") != (item.ProviderOfferingIdentifier == "") {
			fields[prefix+"providerPackageIdentifier"] = errors.New("package and offering identifiers must be supplied together")
		}
		if item.ExistingProductID == "" && (!keyPattern.MatchString(item.Key) || item.InternalName == "") {
			fields[prefix+"key"] = errors.New("key and internal name are required for a new Product")
		}
		for entitlementIndex, entitlement := range item.Entitlements {
			entitlementPrefix := prefix + "entitlements[" + strconv.Itoa(entitlementIndex) + "]."
			if entitlement.ProviderIdentifier == "" {
				fields[entitlementPrefix+"providerIdentifier"] = errors.New("provider Entitlement identifier is required")
			}
			if entitlement.ExistingEntitlementID == "" && (!keyPattern.MatchString(entitlement.Key) || entitlement.Name == "") {
				fields[entitlementPrefix+"key"] = errors.New("key and name are required for a new Entitlement")
			}
		}
	}
	if len(fields) != 0 {
		return fields
	}
	return nil
}
