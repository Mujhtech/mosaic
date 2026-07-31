package cloudworkspacehttp

import (
	"errors"
	"regexp"

	validation "github.com/go-ozzo/ozzo-validation/v4"

	"github.com/Mujhtech/mosaic/apps/api/internal/cloudworkspace"
)

var keyPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,62}$`)
var nonWhitespacePattern = regexp.MustCompile(`\S`)

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
	Kind cloudworkspace.APIKeyKind `json:"kind"`
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
	return validation.ValidateStruct(request, validation.Field(&request.Kind, validation.Required, validation.In(cloudworkspace.APIKeyPublicSDK, cloudworkspace.APIKeySecretServer)))
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
}

func (request *providerConnectionRequest) Validate() error {
	return validation.ValidateStruct(request,
		validation.Field(&request.Name, validation.Required, validation.Length(1, 120)),
		validation.Field(&request.Provider, validation.Required, validation.In(cloudworkspace.ProviderRevenueCat, cloudworkspace.ProviderCustom)),
		validation.Field(&request.IntegrationMode, validation.Required, validation.In(cloudworkspace.ProviderServerConnected, cloudworkspace.ProviderSDKOnly)),
		validation.Field(&request.Mode, validation.Required, validation.In(cloudworkspace.ProviderSandbox, cloudworkspace.ProviderProduction)),
		validation.Field(&request.ExternalProjectID, validation.Length(0, 255)),
		validation.Field(&request.EnvironmentIDs, validation.Required, validation.Length(1, 100), validation.Each(validation.Required)),
		validation.Field(&request.ApplicationIDs, validation.Required, validation.Length(1, 100), validation.Each(validation.Required)),
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
	ConnectionID                       string `json:"connectionId"`
	AcknowledgeProductionConnectionUse bool   `json:"acknowledgeProductionConnectionUse"`
}

func (request *providerAssignmentRequest) Validate() error {
	return validation.ValidateStruct(request, validation.Field(&request.ConnectionID, validation.Required))
}

type providerMappingDraftRequest struct {
	ConnectionID               string `json:"connectionId"`
	EnvironmentID              string `json:"environmentId"`
	ApplicationID              string `json:"applicationId"`
	ProviderProductIdentifier  string `json:"providerProductIdentifier"`
	ProviderPackageIdentifier  string `json:"providerPackageIdentifier"`
	ProviderOfferingIdentifier string `json:"providerOfferingIdentifier"`
	ExpectedStoreProductID     string `json:"expectedStoreProductId"`
}

func (request *providerMappingDraftRequest) Validate() error {
	if err := validation.ValidateStruct(request,
		validation.Field(&request.ConnectionID, validation.Required),
		validation.Field(&request.EnvironmentID, validation.Required),
		validation.Field(&request.ApplicationID, validation.Required),
		validation.Field(&request.ProviderProductIdentifier, validation.Required, validation.Length(1, 255), validation.Match(nonWhitespacePattern)),
		validation.Field(&request.ProviderPackageIdentifier, validation.Length(0, 255), validation.When(request.ProviderPackageIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ProviderOfferingIdentifier, validation.Length(0, 255), validation.When(request.ProviderOfferingIdentifier != "", validation.Match(nonWhitespacePattern))),
		validation.Field(&request.ExpectedStoreProductID, validation.Length(0, 255), validation.When(request.ExpectedStoreProductID != "", validation.Match(nonWhitespacePattern))),
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
