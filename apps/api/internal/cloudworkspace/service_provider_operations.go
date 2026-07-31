package cloudworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/Mujhtech/mosaic/apps/api/internal/providercatalog"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
)

var revenueCatCapabilities = []ProviderCapability{
	{Name: "productLoading", Support: "supported"},
	{Name: "subscriptions", Support: "supported"},
	{Name: "oneTimeNonConsumables", Support: "supported"},
	{Name: "trials", Support: "conditional", ReasonCode: "provider.platformCapabilityVaries"},
	{Name: "introductoryOffers", Support: "conditional", ReasonCode: "provider.platformCapabilityVaries"},
	{Name: "promotionalOffers", Support: "conditional", ReasonCode: "provider.runtimeEligibilityRequired"},
	{Name: "restore", Support: "supported"},
	{Name: "activeEntitlementLookup", Support: "supported"},
	{Name: "pendingPurchases", Support: "supported"},
	{Name: "deferredPurchases", Support: "unsupported", ReasonCode: "provider.outcomeNotDistinct"},
	{Name: "serverConfirmedTransactions", Support: "conditional", ReasonCode: "provider.runtimeConfirmation"},
	{Name: "productSynchronization", Support: "supported"},
	{Name: "providerDiagnostics", Support: "supported"},
}

var revenueCatReadPermissions = []string{
	"project_configuration:apps:read",
	"project_configuration:products:read",
	"project_configuration:offerings:read",
	"project_configuration:packages:read",
	"project_configuration:entitlements:read",
}

const providerImportInProgressTTL = 15 * time.Minute

func providerCapabilities(provider ProviderKind) []ProviderCapability {
	if provider != ProviderRevenueCat {
		return []ProviderCapability{
			{Name: "productLoading", Support: "conditional", ReasonCode: "host.implementationRequired"},
		}
	}
	return append([]ProviderCapability(nil), revenueCatCapabilities...)
}

func (s *Service) requireProviderOperations() error {
	if s.credentialCipher == nil || s.providerCatalog == nil {
		return ErrProviderFeatureDisabled
	}
	return nil
}

func providerErrorCode(err error) (ProviderErrorCode, bool, *int) {
	var catalogError *providercatalog.Error
	if !errors.As(err, &catalogError) {
		return ProviderErrorProviderUnavailable, true, nil
	}
	code := ProviderErrorProviderUnavailable
	switch catalogError.Code {
	case providercatalog.ErrorCredentialInvalid:
		code = ProviderErrorCredentialInvalid
	case providercatalog.ErrorPermissionDenied:
		code = ProviderErrorPermissionDenied
	case providercatalog.ErrorRateLimited:
		code = ProviderErrorRateLimited
	case providercatalog.ErrorTimeout:
		code = ProviderErrorTimeout
	case providercatalog.ErrorInvalidResponse:
		code = ProviderErrorInvalidResponse
	}
	var retryAfterSeconds *int
	if catalogError.RetryAfter > 0 {
		seconds := int(catalogError.RetryAfter.Round(time.Second) / time.Second)
		if seconds < 1 {
			seconds = 1
		}
		retryAfterSeconds = &seconds
	}
	return code, catalogError.Retryable, retryAfterSeconds
}

// providerOperationError converts a failed provider operation into the error the
// caller should see.
//
// Only a real provider-adapter failure becomes a provider error code. An
// authorization or lookup refusal must survive unchanged: routing it through
// publicProviderError reported a cross-tenant `POST /provider-connections/{id}/test`
// as "the provider is temporarily unavailable" instead of 403, so an
// unauthorized attempt looked like an outage and a legitimate operator missing a
// permission had no way to tell.
func providerOperationError(err error) error {
	var catalogError *providercatalog.Error
	if !errors.As(err, &catalogError) {
		return err
	}
	code, _, _ := providerErrorCode(err)
	return publicProviderError(code)
}

func publicProviderError(code ProviderErrorCode) error {
	switch code {
	case ProviderErrorCredentialInvalid:
		return ErrProviderCredentialInvalid
	case ProviderErrorPermissionDenied:
		return ErrProviderPermissionDenied
	case ProviderErrorRateLimited:
		return ErrProviderRateLimited
	case ProviderErrorInvalidResponse:
		return ErrProviderInvalidResponse
	default:
		return ErrProviderUnavailable
	}
}

func (s *Service) credentialForConnection(ctx context.Context, actor Actor, connectionID string, write bool) (ProviderConnection, Project, []byte, error) {
	if err := s.requireProviderOperations(); err != nil {
		return ProviderConnection{}, Project{}, nil, err
	}
	var connection ProviderConnection
	var project Project
	var record ProviderCredentialRecord
	err := s.repository.View(ctx, func(reader Reader) error {
		var ok bool
		connection, ok = reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		var scopeErr error
		project, _, scopeErr = projectScope(reader, actor, connection.ProjectID, write)
		if scopeErr != nil {
			return scopeErr
		}
		if connection.Provider != ProviderRevenueCat || connection.IntegrationMode != ProviderServerConnected {
			return ErrProviderUnsupported
		}
		if connection.Status == ProviderConnectionRevoked {
			return ErrConnectionRevoked
		}
		record, ok = reader.ProviderCredential(connection.ID)
		if !ok || record.RevokedAt != nil {
			return ErrProviderCredentialInvalid
		}
		return nil
	})
	if err != nil {
		return ProviderConnection{}, Project{}, nil, err
	}
	plaintext, err := s.credentialCipher.Decrypt(providercredential.Envelope{
		Version: record.Version, Algorithm: record.Algorithm, KeyID: record.KeyID,
		Nonce: record.Nonce, Ciphertext: record.Ciphertext,
		CredentialClass: record.Class, Fingerprint: record.Fingerprint,
	}, providercredential.Scope{
		OrganizationID: project.OrganizationID, ProjectID: project.ID,
		ConnectionID: connection.ID, CredentialClass: record.Class,
	})
	if err != nil {
		return ProviderConnection{}, Project{}, nil, ErrProviderCredentialInvalid
	}
	return connection, project, plaintext, nil
}

func zero(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

func (s *Service) fetchProviderCatalog(ctx context.Context, actor Actor, connectionID string, write bool) (ProviderConnection, Project, providercatalog.Catalog, error) {
	connection, project, credential, err := s.credentialForConnection(ctx, actor, connectionID, write)
	if err != nil {
		return ProviderConnection{}, Project{}, providercatalog.Catalog{}, err
	}
	defer zero(credential)
	catalog, err := s.providerCatalog.FetchCatalog(ctx, providercatalog.Credential{
		Secret: credential, ExternalProjectID: connection.ExternalProjectID,
	})
	return connection, project, catalog, err
}

func (s *Service) saveProviderFailure(ctx context.Context, actor Actor, connectionID, operation string, providerErr error) {
	code, retryable, retryAfter := providerErrorCode(providerErr)
	_ = s.repository.Transact(ctx, func(tx Transaction) error {
		connection, ok := tx.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		project, _, err := projectScope(tx, actor, connection.ProjectID, true)
		if err != nil {
			return err
		}
		now := s.now()
		connection.HealthStatus = ProviderHealthUnavailable
		if retryable {
			connection.HealthStatus = ProviderHealthDegraded
		}
		connection.LastErrorCode, connection.UpdatedAt = code, now
		tx.SaveProviderConnection(connection)
		diagnosticID := tx.NextID("provider_diagnostic")
		tx.SaveProviderDiagnostic(ProviderDiagnostic{
			ID: diagnosticID, ProjectID: project.ID, ConnectionID: connection.ID,
			Operation: operation, Code: code, Retryable: retryable,
			RetryAfterSeconds: retryAfter, CorrelationID: diagnosticID, OccurredAt: now,
		})
		return nil
	})
}

func (s *Service) TestProviderConnection(ctx context.Context, actor Actor, connectionID string) (ProviderConnectionHealth, error) {
	ctx, span := s.operation(ctx, "provider_connection.test", actor, attribute.String("mosaic.provider_connection.id", connectionID))
	defer span.End()
	connection, project, _, err := s.fetchProviderCatalog(ctx, actor, connectionID, true)
	if err != nil {
		s.saveProviderFailure(ctx, actor, connectionID, "test", err)
		return ProviderConnectionHealth{}, providerOperationError(err)
	}
	var result ProviderConnectionHealth
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		current, ok := tx.ProviderConnection(connection.ID)
		if !ok || current.ProjectID != project.ID {
			return ErrNotFound
		}
		now := s.now()
		current.Status, current.HealthStatus = ProviderConnectionActive, ProviderHealthHealthy
		current.LastSuccessfulTestAt, current.LastErrorCode, current.UpdatedAt = &now, "", now
		tx.SaveProviderConnection(current)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "provider_connection.tested", "provider_connection", current.ID, map[string]string{
			"outcome": "healthy",
		})
		result = ProviderConnectionHealth{
			ConnectionID: current.ID, Status: current.HealthStatus,
			LastSuccessfulAt:    current.LastSuccessfulTestAt,
			Capabilities:        providerCapabilities(current.Provider),
			RequiredPermissions: append([]string(nil), revenueCatReadPermissions...),
		}
		return nil
	})
	return result, err
}

func (s *Service) ProviderConnectionHealth(ctx context.Context, actor Actor, connectionID string) (ProviderConnectionHealth, error) {
	var result ProviderConnectionHealth
	err := s.repository.View(ctx, func(reader Reader) error {
		connection, ok := reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		if _, _, err := projectScope(reader, actor, connection.ProjectID, false); err != nil {
			return err
		}
		result = ProviderConnectionHealth{
			ConnectionID: connection.ID, Status: connection.HealthStatus,
			LastSuccessfulAt: connection.LastSuccessfulTestAt, LastErrorCode: connection.LastErrorCode,
			Capabilities: providerCapabilities(connection.Provider),
		}
		if connection.Provider == ProviderRevenueCat {
			result.RequiredPermissions = append([]string(nil), revenueCatReadPermissions...)
		}
		return nil
	})
	return result, err
}

func (s *Service) ProviderConnectionDiagnostics(ctx context.Context, actor Actor, connectionID string) ([]ProviderDiagnostic, error) {
	result := []ProviderDiagnostic{}
	err := s.repository.View(ctx, func(reader Reader) error {
		connection, ok := reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		if _, _, err := projectScope(reader, actor, connection.ProjectID, false); err != nil {
			return err
		}
		result = reader.ProviderDiagnostics(connection.ID)
		return nil
	})
	return result, err
}

func catalogPreview(connectionID string, catalog providercatalog.Catalog) ProviderCatalogPreview {
	result := ProviderCatalogPreview{
		ConnectionID: connectionID, ObservedAt: catalog.ObservedAt,
		Applications: make([]ProviderCatalogApplication, 0, len(catalog.Apps)),
		Products:     make([]ProviderCatalogProduct, 0, len(catalog.Products)),
		Entitlements: make([]ProviderCatalogEntitlement, 0, len(catalog.Entitlements)),
		Offerings:    make([]ProviderCatalogOffering, 0, len(catalog.Offerings)),
	}
	for _, app := range catalog.Apps {
		result.Applications = append(result.Applications, ProviderCatalogApplication{
			ID: app.ID, Name: app.Name, Platform: app.Platform, Identifier: app.Identifier,
		})
	}
	for _, product := range catalog.Products {
		result.Products = append(result.Products, ProviderCatalogProduct{
			ID: product.ID, ApplicationID: product.AppID, StoreIdentifier: product.StoreIdentifier,
			DisplayName: product.DisplayName, Type: product.Type, State: product.State,
			Importable: product.State == "active" &&
				(product.Type == providercatalog.ProductTypeSubscription ||
					product.Type == providercatalog.ProductTypeOneTimeNonConsumable),
		})
	}
	for _, entitlement := range catalog.Entitlements {
		result.Entitlements = append(result.Entitlements, ProviderCatalogEntitlement{
			ID: entitlement.ID, LookupKey: entitlement.LookupKey,
			DisplayName: entitlement.DisplayName, State: entitlement.State,
		})
	}
	for _, offering := range catalog.Offerings {
		value := ProviderCatalogOffering{
			ID: offering.ID, LookupKey: offering.LookupKey, DisplayName: offering.DisplayName,
			State: offering.State, IsCurrent: offering.IsCurrent,
			Packages: make([]ProviderCatalogPackage, 0, len(offering.Packages)),
		}
		for _, providerPackage := range offering.Packages {
			value.Packages = append(value.Packages, ProviderCatalogPackage{
				ID: providerPackage.ID, LookupKey: providerPackage.LookupKey,
				DisplayName: providerPackage.DisplayName,
				ProductIDs:  append([]string(nil), providerPackage.ProductIDs...),
			})
		}
		result.Offerings = append(result.Offerings, value)
	}
	return result
}

func (s *Service) PreviewProviderCatalog(ctx context.Context, actor Actor, connectionID string) (ProviderCatalogPreview, error) {
	ctx, span := s.operation(ctx, "provider_catalog.preview", actor, attribute.String("mosaic.provider_connection.id", connectionID))
	defer span.End()
	_, _, catalog, err := s.fetchProviderCatalog(ctx, actor, connectionID, false)
	if err != nil {
		s.saveProviderFailure(ctx, actor, connectionID, "preview", err)
		return ProviderCatalogPreview{}, providerOperationError(err)
	}
	return catalogPreview(connectionID, catalog), nil
}

type ReplaceProviderCredentialInput struct {
	Credential string
}

func (s *Service) replaceProviderCredential(ctx context.Context, actor Actor, connectionID, plaintext, action string, allowRevoked bool) (ProviderConnection, error) {
	if err := s.requireProviderOperations(); err != nil {
		return ProviderConnection{}, err
	}
	if !validRevenueCatCredential(plaintext) {
		return ProviderConnection{}, ErrProviderCredentialInvalid
	}
	var connection ProviderConnection
	var project Project
	err := s.repository.View(ctx, func(reader Reader) error {
		var ok bool
		connection, ok = reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		var scopeErr error
		project, _, scopeErr = projectScope(reader, actor, connection.ProjectID, true)
		if scopeErr != nil {
			return scopeErr
		}
		if connection.Provider != ProviderRevenueCat || connection.IntegrationMode != ProviderServerConnected {
			return ErrProviderUnsupported
		}
		if connection.Status == ProviderConnectionRevoked && !allowRevoked {
			return ErrConnectionRevoked
		}
		return nil
	})
	if err != nil {
		return ProviderConnection{}, err
	}
	secret := []byte(plaintext)
	_, providerErr := s.providerCatalog.FetchCatalog(ctx, providercatalog.Credential{
		Secret: secret, ExternalProjectID: connection.ExternalProjectID,
	})
	zero(secret)
	if providerErr != nil {
		code, _, _ := providerErrorCode(providerErr)
		return ProviderConnection{}, publicProviderError(code)
	}
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		current, ok := tx.ProviderConnection(connection.ID)
		if !ok || current.ProjectID != project.ID {
			return ErrNotFound
		}
		credential, err := s.encryptProviderCredential(project, current.ID, plaintext)
		if err != nil {
			return err
		}
		now := s.now()
		if previous, ok := tx.ProviderCredential(current.ID); ok {
			credential.CreatedAt = previous.CreatedAt
		}
		credential.RotatedAt, credential.UpdatedAt = &now, now
		tx.SaveProviderCredential(credential)
		current.Status, current.HealthStatus, current.RevokedAt = ProviderConnectionActive, ProviderHealthHealthy, nil
		current.LastSuccessfulTestAt, current.LastErrorCode, current.UpdatedAt = &now, "", now
		tx.SaveProviderConnection(current)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", action, "provider_connection", current.ID, map[string]string{})
		connection = providerScopes(tx, current)
		return nil
	})
	return connection, err
}

func (s *Service) RotateProviderCredential(ctx context.Context, actor Actor, connectionID, credential string) (ProviderConnection, error) {
	return s.replaceProviderCredential(ctx, actor, connectionID, credential, "provider_connection.credential_rotated", false)
}

func (s *Service) ReconnectProviderConnection(ctx context.Context, actor Actor, connectionID, credential string) (ProviderConnection, error) {
	return s.replaceProviderCredential(ctx, actor, connectionID, credential, "provider_connection.reconnected", true)
}

type ProviderEntitlementImportInput struct {
	ProviderIdentifier    string
	ExistingEntitlementID string
	Key                   string
	Name                  string
}

type ProviderProductImportInput struct {
	ProviderProductIdentifier  string
	ProviderPackageIdentifier  string
	ProviderOfferingIdentifier string
	ExistingProductID          string
	Key                        string
	InternalName               string
	EnvironmentID              string
	ApplicationID              string
	Entitlements               []ProviderEntitlementImportInput
}

type ImportProviderProductsInput struct {
	IdempotencyKey string
	Items          []ProviderProductImportInput
}

func validCatalogKey(value string) bool {
	if len(value) < 2 || len(value) > 63 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for _, char := range value[1:] {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func validateProviderImportInput(input ImportProviderProductsInput) error {
	if strings.TrimSpace(input.IdempotencyKey) == "" || len(input.Items) == 0 || len(input.Items) > 100 {
		return ErrIdempotencyConflict
	}
	products := make(map[string]struct{}, len(input.Items))
	for _, item := range input.Items {
		if item.ProviderProductIdentifier == "" || len(item.ProviderProductIdentifier) > 255 ||
			item.EnvironmentID == "" || item.ApplicationID == "" ||
			(item.ProviderPackageIdentifier == "") != (item.ProviderOfferingIdentifier == "") {
			return ErrMappingTargetInvalid
		}
		if _, duplicate := products[item.ProviderProductIdentifier]; duplicate {
			return ErrMappingAmbiguous
		}
		products[item.ProviderProductIdentifier] = struct{}{}
		if item.ExistingProductID == "" &&
			(!validCatalogKey(item.Key) || strings.TrimSpace(item.InternalName) == "" || len(item.InternalName) > 120) {
			return ErrMappingTargetInvalid
		}
		entitlements := make(map[string]struct{}, len(item.Entitlements))
		for _, entitlement := range item.Entitlements {
			if strings.TrimSpace(entitlement.ProviderIdentifier) == "" || len(entitlement.ProviderIdentifier) > 255 {
				return ErrMappingTargetInvalid
			}
			if _, duplicate := entitlements[entitlement.ProviderIdentifier]; duplicate {
				return ErrMappingAmbiguous
			}
			entitlements[entitlement.ProviderIdentifier] = struct{}{}
			if entitlement.ExistingEntitlementID == "" &&
				(!validCatalogKey(entitlement.Key) || strings.TrimSpace(entitlement.Name) == "" || len(entitlement.Name) > 120) {
				return ErrMappingTargetInvalid
			}
		}
	}
	return nil
}

func importRequestHash(connectionID string, input ImportProviderProductsInput) [32]byte {
	items := append([]ProviderProductImportInput(nil), input.Items...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].ProviderProductIdentifier < items[j].ProviderProductIdentifier
	})
	material, _ := json.Marshal(struct {
		ConnectionID string
		Items        []ProviderProductImportInput
	}{ConnectionID: connectionID, Items: items})
	return sha256.Sum256(material)
}

func providerProductType(value string) (ProductType, bool) {
	switch value {
	case providercatalog.ProductTypeSubscription:
		return ProductSubscription, true
	case providercatalog.ProductTypeOneTimeNonConsumable:
		return ProductOneTimeNonConsumable, true
	default:
		return "", false
	}
}

func catalogProduct(catalog providercatalog.Catalog, id string) (providercatalog.Product, bool) {
	for _, product := range catalog.Products {
		if product.ID == id {
			return product, true
		}
	}
	return providercatalog.Product{}, false
}

func catalogPackageLookupKeys(catalog providercatalog.Catalog, offeringID, packageID, productID string) (string, string, bool) {
	if offeringID == "" && packageID == "" {
		return "", "", true
	}
	for _, offering := range catalog.Offerings {
		if offering.ID != offeringID && offering.LookupKey != offeringID {
			continue
		}
		for _, providerPackage := range offering.Packages {
			if providerPackage.ID != packageID && providerPackage.LookupKey != packageID {
				continue
			}
			for _, candidate := range providerPackage.ProductIDs {
				if candidate == productID {
					if offering.LookupKey == "" || providerPackage.LookupKey == "" {
						return "", "", false
					}
					return offering.LookupKey, providerPackage.LookupKey, true
				}
			}
		}
	}
	return "", "", false
}

func catalogEntitlementLookupKey(catalog providercatalog.Catalog, identifier string) (string, bool) {
	for _, entitlement := range catalog.Entitlements {
		if entitlement.ID != identifier && entitlement.LookupKey != identifier {
			continue
		}
		if entitlement.State != "active" || entitlement.LookupKey == "" {
			return "", false
		}
		return entitlement.LookupKey, true
	}
	return "", false
}

func normalizedProductMetadata(product providercatalog.Product) (json.RawMessage, string) {
	material, _ := json.Marshal(struct {
		ProviderProductID string `json:"providerProductId"`
		StoreIdentifier   string `json:"storeIdentifier"`
		DisplayName       string `json:"displayName,omitempty"`
		Type              string `json:"type"`
		State             string `json:"state"`
	}{
		ProviderProductID: product.ID, StoreIdentifier: product.StoreIdentifier,
		DisplayName: product.DisplayName, Type: product.Type, State: product.State,
	})
	digest := sha256.Sum256(material)
	return material, fmt.Sprintf("%x", digest)
}

func (s *Service) ImportProviderProducts(ctx context.Context, actor Actor, projectID, connectionID string, input ImportProviderProductsInput) (ProviderImportResult, error) {
	if err := validateProviderImportInput(input); err != nil {
		return ProviderImportResult{}, err
	}
	keyHash := sha256.Sum256([]byte(input.IdempotencyKey))
	requestHash := importRequestHash(connectionID, input)
	var replay ProviderImportResult
	expiredInProgress := false
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := projectScope(reader, actor, projectID, true); err != nil {
			return err
		}
		existing, ok := reader.ProviderImportByKeyHash(projectID, keyHash)
		if !ok {
			return nil
		}
		if existing.RequestHash != requestHash {
			return ErrIdempotencyConflict
		}
		if existing.Status == ProviderImportInProgress {
			if existing.CreatedAt.Add(providerImportInProgressTTL).After(s.now()) {
				return ErrProviderImportInProgress
			}
			expiredInProgress = true
			return nil
		}
		replay = ProviderImportResult{Import: existing, Items: reader.ProviderImportItems(existing.ID)}
		return nil
	})
	if err != nil || replay.Import.ID != "" {
		return replay, err
	}
	if expiredInProgress {
		err = s.repository.Transact(ctx, func(tx Transaction) error {
			tx.LockScope("provider-import:" + projectID + ":" + fmt.Sprintf("%x", keyHash))
			project, _, err := projectScope(tx, actor, projectID, true)
			if err != nil {
				return err
			}
			existing, ok := tx.ProviderImportByKeyHash(projectID, keyHash)
			if !ok {
				return ErrNotFound
			}
			if existing.RequestHash != requestHash {
				return ErrIdempotencyConflict
			}
			if existing.Status != ProviderImportInProgress {
				replay = ProviderImportResult{Import: existing, Items: tx.ProviderImportItems(existing.ID)}
				return nil
			}
			now := s.now()
			if existing.CreatedAt.Add(providerImportInProgressTTL).After(now) {
				return ErrProviderImportInProgress
			}
			existing.Status, existing.CompletedAt = ProviderImportPartial, &now
			tx.SaveProviderImport(existing)
			s.audit(tx, actor, project.OrganizationID, projectID, "", "provider_import.expired", "provider_import", existing.ID, map[string]string{
				"status": string(existing.Status),
			})
			replay = ProviderImportResult{Import: existing, Items: tx.ProviderImportItems(existing.ID)}
			return nil
		})
		return replay, err
	}
	connection, project, catalog, err := s.fetchProviderCatalog(ctx, actor, connectionID, true)
	if err != nil {
		s.saveProviderFailure(ctx, actor, connectionID, "import", err)
		return ProviderImportResult{}, providerOperationError(err)
	}
	if connection.ProjectID != projectID || project.ID != projectID {
		return ProviderImportResult{}, ErrScopeMismatch
	}
	var importRequest ProviderImportRequest
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		tx.LockScope("provider-import:" + projectID + ":" + fmt.Sprintf("%x", keyHash))
		if existing, ok := tx.ProviderImportByKeyHash(projectID, keyHash); ok {
			if existing.RequestHash != requestHash {
				return ErrIdempotencyConflict
			}
			if existing.Status == ProviderImportInProgress {
				return ErrProviderImportInProgress
			}
			replay = ProviderImportResult{Import: existing, Items: tx.ProviderImportItems(existing.ID)}
			return nil
		}
		now := s.now()
		importRequest = ProviderImportRequest{
			ID: tx.NextID("provider_import"), ProjectID: projectID, ConnectionID: connectionID,
			IdempotencyKeyHash: keyHash, RequestHash: requestHash, Status: ProviderImportInProgress,
			CreatedByActorID: actor.ID, CreatedAt: now,
		}
		tx.SaveProviderImport(importRequest)
		return nil
	})
	if err != nil {
		return ProviderImportResult{}, err
	}
	if replay.Import.ID != "" {
		return replay, nil
	}
	for _, item := range input.Items {
		item := item
		itemResult := ProviderImportItem{
			ImportID: importRequest.ID, ProjectID: projectID,
			ProviderProductIdentifier: item.ProviderProductIdentifier,
			Status:                    "failed", ErrorCode: ProviderErrorProductNotFound, CreatedAt: s.now(),
		}
		itemErr := s.repository.Transact(ctx, func(tx Transaction) error {
			providerProduct, ok := catalogProduct(catalog, item.ProviderProductIdentifier)
			if !ok || providerProduct.State != "active" {
				tx.SaveProviderImportItem(itemResult)
				return nil
			}
			productType, ok := providerProductType(providerProduct.Type)
			if !ok {
				itemResult.ErrorCode = ProviderErrorProductUnavailable
				tx.SaveProviderImportItem(itemResult)
				return nil
			}
			environment, environmentOK := tx.Environment(item.EnvironmentID)
			application, applicationOK := tx.Application(item.ApplicationID)
			if !environmentOK || !applicationOK || environment.ProjectID != projectID ||
				application.ProjectID != projectID ||
				!scopeContains(tx.ProviderConnectionEnvironmentIDs(connectionID), environment.ID) ||
				!scopeContains(tx.ProviderConnectionApplicationIDs(connectionID), application.ID) {
				itemResult.ErrorCode = ProviderErrorScopeMismatch
				tx.SaveProviderImportItem(itemResult)
				return nil
			}
			providerAppMatch := false
			for _, app := range catalog.Apps {
				if app.ID == providerProduct.AppID && app.Identifier == application.Identifier &&
					(application.Platform == PlatformIOS && app.Platform == "app_store" ||
						application.Platform == PlatformAndroid && app.Platform == "play_store") {
					providerAppMatch = true
				}
			}
			offeringLookupKey, packageLookupKey, packageOK := catalogPackageLookupKeys(
				catalog, item.ProviderOfferingIdentifier, item.ProviderPackageIdentifier, providerProduct.ID,
			)
			if !providerAppMatch || !packageOK {
				itemResult.ErrorCode = ProviderErrorScopeMismatch
				tx.SaveProviderImportItem(itemResult)
				return nil
			}
			item.ProviderOfferingIdentifier = offeringLookupKey
			item.ProviderPackageIdentifier = packageLookupKey
			for index := range item.Entitlements {
				lookupKey, entitlementOK := catalogEntitlementLookupKey(
					catalog, item.Entitlements[index].ProviderIdentifier,
				)
				if !entitlementOK {
					itemResult.ErrorCode = ProviderErrorProductUnavailable
					tx.SaveProviderImportItem(itemResult)
					return nil
				}
				item.Entitlements[index].ProviderIdentifier = lookupKey
			}
			var product Product
			productNeedsCreate := false
			if item.ExistingProductID != "" {
				product, ok = tx.Product(item.ExistingProductID)
				if !ok || product.ProjectID != projectID || product.Status == ProductArchived ||
					product.Type != productType {
					itemResult.ErrorCode = ProviderErrorScopeMismatch
					tx.SaveProviderImportItem(itemResult)
					return nil
				}
			} else {
				for _, existing := range tx.Products(projectID) {
					if existing.Key == item.Key {
						product = existing
						break
					}
				}
				if product.ID != "" && (product.Status == ProductArchived || product.Type != productType) {
					itemResult.ErrorCode = ProviderErrorScopeMismatch
					tx.SaveProviderImportItem(itemResult)
					return nil
				}
				if product.ID == "" {
					now := s.now()
					product = Product{
						ID: tx.NextID("product"), ProjectID: projectID, Key: item.Key,
						InternalName: item.InternalName, Type: productType,
						Status: ProductConnected, MetadataSource: MetadataProvider,
						Readiness: ProductReadiness{Reasons: []string{}, MetadataSource: MetadataProvider},
						CreatedAt: now, UpdatedAt: now,
					}
					productNeedsCreate = true
				}
			}
			for _, existing := range tx.ProviderMappings(product.ID) {
				if existing.EnvironmentID == environment.ID && existing.ApplicationID == application.ID &&
					existing.Status != ProviderMappingArchived {
					itemResult.ErrorCode = ProviderErrorMappingAmbiguous
					tx.SaveProviderImportItem(itemResult)
					return nil
				}
			}
			type resolvedEntitlement struct {
				value              Entitlement
				providerIdentifier string
				needsCreate        bool
				grantExists        bool
				mappingExists      bool
			}
			resolvedEntitlements := make([]resolvedEntitlement, 0, len(item.Entitlements))
			seenEntitlements := make(map[string]struct{}, len(item.Entitlements))
			existingGrants := tx.ProductGrants(product.ID)
			existingMappings := tx.ProviderEntitlementMappings(connectionID, environment.ID, application.ID)
			for _, entitlementInput := range item.Entitlements {
				var entitlement Entitlement
				entitlementNeedsCreate := false
				if entitlementInput.ExistingEntitlementID != "" {
					entitlement, ok = tx.Entitlement(entitlementInput.ExistingEntitlementID)
				} else {
					for _, existing := range tx.Entitlements(projectID) {
						if existing.Key == entitlementInput.Key {
							entitlement = existing
							ok = true
							break
						}
					}
					if entitlement.ID == "" {
						entitlement = Entitlement{
							ID: tx.NextID("entitlement"), ProjectID: projectID,
							Key: entitlementInput.Key, Name: entitlementInput.Name,
						}
						entitlementNeedsCreate, ok = true, true
					}
				}
				if !ok || entitlement.ProjectID != projectID {
					itemResult.ErrorCode = ProviderErrorScopeMismatch
					tx.SaveProviderImportItem(itemResult)
					return nil
				}
				if _, duplicate := seenEntitlements[entitlement.ID]; duplicate {
					itemResult.ErrorCode = ProviderErrorMappingAmbiguous
					tx.SaveProviderImportItem(itemResult)
					return nil
				}
				seenEntitlements[entitlement.ID] = struct{}{}
				resolved := resolvedEntitlement{
					value: entitlement, providerIdentifier: entitlementInput.ProviderIdentifier,
					needsCreate: entitlementNeedsCreate,
				}
				for _, grant := range existingGrants {
					if grant.EntitlementID == entitlement.ID {
						resolved.grantExists = true
						break
					}
				}
				for _, entitlementMapping := range existingMappings {
					if entitlementMapping.Status == ProviderMappingArchived {
						continue
					}
					if entitlementMapping.EntitlementID == entitlement.ID {
						if entitlementMapping.ProviderEntitlementIdentifier != entitlementInput.ProviderIdentifier {
							itemResult.ErrorCode = ProviderErrorMappingAmbiguous
							tx.SaveProviderImportItem(itemResult)
							return nil
						}
						resolved.mappingExists = true
					} else if entitlementMapping.ProviderEntitlementIdentifier == entitlementInput.ProviderIdentifier {
						itemResult.ErrorCode = ProviderErrorMappingAmbiguous
						tx.SaveProviderImportItem(itemResult)
						return nil
					}
				}
				resolvedEntitlements = append(resolvedEntitlements, resolved)
			}
			now := s.now()
			metadata, digest := normalizedProductMetadata(providerProduct)
			staleAt, expiresAt := now.Add(s.providerSnapshotTTL), now.Add(7*s.providerSnapshotTTL)
			mapping := ProviderProductMapping{
				ID: tx.NextID("mapping"), ProjectID: projectID, ProductID: product.ID,
				ConnectionID: connectionID, EnvironmentID: environment.ID,
				ApplicationID: application.ID, Platform: application.Platform,
				Provider: ProviderRevenueCat, ProviderProductIdentifier: providerProduct.ID,
				ProviderPackageIdentifier:  item.ProviderPackageIdentifier,
				ProviderOfferingIdentifier: item.ProviderOfferingIdentifier,
				ExpectedStoreProductID:     providerProduct.StoreIdentifier,
				Status:                     ProviderMappingActive, Availability: ProviderAvailabilityAvailable,
				SyncState: ProviderSyncCurrent, CreatedAt: now, UpdatedAt: now,
			}
			snapshot := ProviderProductMetadataSnapshot{
				ID: tx.NextID("provider_snapshot"), ProjectID: projectID, MappingID: mapping.ID,
				Source: ProviderMetadataProvider, Digest: digest,
				Availability: ProviderAvailabilityAvailable, ObservedAt: catalog.ObservedAt,
				SyncedAt: now, StaleAt: staleAt, ExpiresAt: &expiresAt,
				Metadata: metadata, CreatedAt: now,
			}
			mapping.CurrentSnapshotID = snapshot.ID
			if productNeedsCreate {
				tx.SaveProduct(product)
			}
			mapping.CurrentSnapshotID = ""
			tx.SaveProviderMapping(mapping)
			tx.SaveProviderMetadataSnapshot(snapshot)
			mapping.CurrentSnapshotID = snapshot.ID
			tx.SaveProviderMapping(mapping)
			for _, entitlement := range resolvedEntitlements {
				if entitlement.needsCreate {
					entitlement.value.CreatedAt, entitlement.value.UpdatedAt = now, now
					tx.SaveEntitlement(entitlement.value)
				}
				if !entitlement.grantExists {
					tx.SaveProductGrant(ProductEntitlementGrant{
						ProductID: product.ID, EntitlementID: entitlement.value.ID, CreatedAt: now,
					})
				}
				if !entitlement.mappingExists {
					tx.SaveProviderEntitlementMapping(ProviderEntitlementMapping{
						ID: tx.NextID("entitlement_mapping"), ProjectID: projectID,
						EntitlementID: entitlement.value.ID, ConnectionID: connectionID,
						EnvironmentID: environment.ID, ApplicationID: application.ID,
						ProviderEntitlementIdentifier: entitlement.providerIdentifier,
						Status:                        ProviderMappingActive, CreatedAt: now, UpdatedAt: now,
					})
				}
			}
			product.Status, product.MetadataSource, product.UpdatedAt = ProductConnected, MetadataProvider, now
			product.Readiness = ProductReadiness{
				Ready: len(tx.ProductGrants(product.ID)) > 0, Reasons: []string{},
				MetadataSource: MetadataProvider,
			}
			tx.SaveProduct(product)
			itemResult.MosaicProductID, itemResult.MappingID = product.ID, mapping.ID
			itemResult.Status, itemResult.ErrorCode = "imported", ""
			tx.SaveProviderImportItem(itemResult)
			return nil
		})
		if itemErr != nil {
			finalizeErr := s.repository.Transact(ctx, func(tx Transaction) error {
				current, ok := tx.ProviderImportByKeyHash(projectID, keyHash)
				if !ok {
					return ErrNotFound
				}
				now := s.now()
				current.Status, current.CompletedAt = ProviderImportPartial, &now
				tx.SaveProviderImport(current)
				return nil
			})
			return ProviderImportResult{}, errors.Join(itemErr, finalizeErr)
		}
	}
	result := ProviderImportResult{}
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		current, ok := tx.ProviderImportByKeyHash(projectID, keyHash)
		if !ok {
			return ErrNotFound
		}
		items := tx.ProviderImportItems(current.ID)
		now := s.now()
		current.Status, current.CompletedAt = ProviderImportCompleted, &now
		for _, item := range items {
			if item.Status == "failed" {
				current.Status = ProviderImportPartial
				break
			}
		}
		tx.SaveProviderImport(current)
		s.audit(tx, actor, project.OrganizationID, projectID, "", "provider_import.completed", "provider_import", current.ID, map[string]string{
			"status": string(current.Status),
		})
		result = ProviderImportResult{Import: current, Items: items}
		return nil
	})
	return result, err
}

type ReplaceProviderMappingInput struct {
	ProviderProductIdentifier  string
	ProviderPackageIdentifier  string
	ProviderOfferingIdentifier string
	ProviderBasePlanIdentifier string
	ProviderOfferIdentifier    string
}

// ReplaceProviderMapping verifies a new RevenueCat target against the live
// catalog, archives the old mapping, and creates a new immutable metadata
// snapshot in one transaction.
func (s *Service) ReplaceProviderMapping(ctx context.Context, actor Actor, mappingID string, input ReplaceProviderMappingInput) (ProviderProductMapping, error) {
	var original ProviderProductMapping
	err := s.repository.View(ctx, func(reader Reader) error {
		var ok bool
		original, ok = reader.ProviderMapping(mappingID)
		if !ok || original.Status == ProviderMappingArchived {
			return ErrNotFound
		}
		_, _, err := productScope(reader, actor, original.ProductID, true)
		return err
	})
	if err != nil {
		return ProviderProductMapping{}, err
	}
	if original.Provider == ProviderAppStore || original.Provider == ProviderGooglePlay {
		return s.replaceNativeProviderMapping(ctx, actor, original, input)
	}
	if !validProviderMappingTarget(ProviderRevenueCat, CreateProviderMappingDraftInput{
		ProviderProductIdentifier:  input.ProviderProductIdentifier,
		ProviderPackageIdentifier:  input.ProviderPackageIdentifier,
		ProviderOfferingIdentifier: input.ProviderOfferingIdentifier,
	}) {
		return ProviderProductMapping{}, ErrMappingTargetInvalid
	}
	connection, project, catalog, err := s.fetchProviderCatalog(ctx, actor, original.ConnectionID, true)
	if err != nil {
		s.saveProviderFailure(ctx, actor, original.ConnectionID, "mapping_replace", err)
		return ProviderProductMapping{}, providerOperationError(err)
	}
	providerProduct, ok := catalogProduct(catalog, input.ProviderProductIdentifier)
	if !ok || providerProduct.State != "active" {
		return ProviderProductMapping{}, ErrMappingTargetInvalid
	}
	productType, ok := providerProductType(providerProduct.Type)
	if !ok {
		return ProviderProductMapping{}, ErrMappingTargetInvalid
	}
	offeringLookupKey, packageLookupKey, ok := catalogPackageLookupKeys(
		catalog, input.ProviderOfferingIdentifier, input.ProviderPackageIdentifier, providerProduct.ID,
	)
	if !ok {
		return ProviderProductMapping{}, ErrMappingTargetInvalid
	}
	var result ProviderProductMapping
	err = s.repository.Transact(ctx, func(tx Transaction) error {
		current, ok := tx.ProviderMapping(mappingID)
		if !ok || current.Status == ProviderMappingArchived ||
			current.ConnectionID != connection.ID || current.ProjectID != project.ID {
			return ErrNotFound
		}
		product, ok := tx.Product(current.ProductID)
		if !ok || product.ProjectID != project.ID || product.Status == ProductArchived ||
			product.Type != productType {
			return ErrScopeMismatch
		}
		application, ok := tx.Application(current.ApplicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		providerAppMatches := false
		for _, app := range catalog.Apps {
			if app.ID == providerProduct.AppID && app.Identifier == application.Identifier &&
				(application.Platform == PlatformIOS && app.Platform == "app_store" ||
					application.Platform == PlatformAndroid && app.Platform == "play_store") {
				providerAppMatches = true
				break
			}
		}
		if !providerAppMatches {
			return ErrScopeMismatch
		}
		for _, candidate := range tx.ProviderMappings(product.ID) {
			if candidate.ID != current.ID && candidate.ConnectionID == current.ConnectionID &&
				candidate.EnvironmentID == current.EnvironmentID &&
				candidate.ApplicationID == current.ApplicationID &&
				candidate.Status != ProviderMappingArchived {
				return ErrMappingAmbiguous
			}
		}
		now := s.now()
		current.Status, current.ArchivedAt, current.UpdatedAt = ProviderMappingArchived, &now, now
		tx.SaveProviderMapping(current)
		metadata, digest := normalizedProductMetadata(providerProduct)
		staleAt, expiresAt := now.Add(s.providerSnapshotTTL), now.Add(7*s.providerSnapshotTTL)
		result = ProviderProductMapping{
			ID: tx.NextID("mapping"), ProjectID: project.ID, ProductID: product.ID,
			ConnectionID: current.ConnectionID, EnvironmentID: current.EnvironmentID,
			ApplicationID: current.ApplicationID, Platform: current.Platform,
			Provider: ProviderRevenueCat, ProviderProductIdentifier: providerProduct.ID,
			ProviderPackageIdentifier: packageLookupKey, ProviderOfferingIdentifier: offeringLookupKey,
			ExpectedStoreProductID: providerProduct.StoreIdentifier,
			ReplacesMappingID:      current.ID,
			Status:                 ProviderMappingActive, Availability: ProviderAvailabilityAvailable,
			SyncState: ProviderSyncCurrent, CreatedAt: now, UpdatedAt: now,
		}
		snapshot := ProviderProductMetadataSnapshot{
			ID: tx.NextID("provider_snapshot"), ProjectID: project.ID, MappingID: result.ID,
			Source: ProviderMetadataProvider, Digest: digest,
			Availability: ProviderAvailabilityAvailable, ObservedAt: catalog.ObservedAt,
			SyncedAt: now, StaleAt: staleAt, ExpiresAt: &expiresAt,
			Metadata: metadata, CreatedAt: now,
		}
		tx.SaveProviderMapping(result)
		tx.SaveProviderMetadataSnapshot(snapshot)
		result.CurrentSnapshotID = snapshot.ID
		tx.SaveProviderMapping(result)
		product.Status, product.MetadataSource, product.UpdatedAt = ProductConnected, MetadataProvider, now
		product.Readiness.MetadataSource = MetadataProvider
		tx.SaveProduct(product)
		s.audit(tx, actor, project.OrganizationID, project.ID, current.EnvironmentID,
			"provider_mapping.replaced", "provider_mapping", result.ID, map[string]string{
				"replacedMappingId": current.ID,
			})
		return nil
	})
	return result, err
}

func (s *Service) replaceNativeProviderMapping(ctx context.Context, actor Actor, original ProviderProductMapping, input ReplaceProviderMappingInput) (ProviderProductMapping, error) {
	target := CreateProviderMappingDraftInput{
		ProviderProductIdentifier:  input.ProviderProductIdentifier,
		ProviderBasePlanIdentifier: input.ProviderBasePlanIdentifier,
		ProviderOfferIdentifier:    input.ProviderOfferIdentifier,
	}
	if !validProviderMappingTarget(original.Provider, target) {
		return ProviderProductMapping{}, ErrMappingTargetInvalid
	}
	var result ProviderProductMapping
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		current, ok := tx.ProviderMapping(original.ID)
		if !ok || current.Status == ProviderMappingArchived || current.ConnectionID != "" ||
			current.Provider != original.Provider {
			return ErrNotFound
		}
		product, project, err := productScope(tx, actor, current.ProductID, true)
		if err != nil {
			return err
		}
		if product.Status == ProductArchived ||
			(current.Provider == ProviderGooglePlay && product.Type == ProductSubscription && input.ProviderBasePlanIdentifier == "") ||
			(product.Type == ProductOneTimeNonConsumable &&
				(input.ProviderBasePlanIdentifier != "" || input.ProviderOfferIdentifier != "")) {
			return ErrMappingTargetInvalid
		}
		if candidate, exists := tx.NativeProviderMappingByTarget(
			current.Provider, current.EnvironmentID, current.ApplicationID,
			current.Platform, input.ProviderProductIdentifier,
		); exists && candidate.ID != current.ID {
			return &ConflictError{Resource: "provider_mapping", Field: "providerProductIdentifier"}
		}
		for _, candidate := range tx.ProviderMappings(product.ID) {
			if candidate.ID != current.ID && candidate.ConnectionID == "" &&
				candidate.Provider == current.Provider && candidate.EnvironmentID == current.EnvironmentID &&
				candidate.ApplicationID == current.ApplicationID && candidate.Platform == current.Platform &&
				candidate.Status != ProviderMappingArchived {
				return ErrMappingAmbiguous
			}
		}
		now := s.now()
		current.Status, current.ArchivedAt, current.UpdatedAt = ProviderMappingArchived, &now, now
		tx.SaveProviderMapping(current)
		result = ProviderProductMapping{
			ID: tx.NextID("mapping"), ProjectID: project.ID, ProductID: product.ID,
			EnvironmentID: current.EnvironmentID, ApplicationID: current.ApplicationID,
			Platform: current.Platform, Provider: current.Provider,
			ProviderProductIdentifier:  input.ProviderProductIdentifier,
			ProviderBasePlanIdentifier: input.ProviderBasePlanIdentifier,
			ProviderOfferIdentifier:    input.ProviderOfferIdentifier,
			ReplacesMappingID:          current.ID, Status: ProviderMappingActive,
			Availability: ProviderAvailabilityUnknown, SyncState: ProviderSyncNeverSynced,
			CreatedAt: now, UpdatedAt: now,
		}
		tx.SaveProviderMapping(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, current.EnvironmentID,
			"provider_mapping.replaced", "provider_mapping", result.ID,
			map[string]string{"replacedMappingId": current.ID, "provider": string(current.Provider)})
		return nil
	})
	return result, err
}

func (s *Service) EnqueueProviderSync(ctx context.Context, actor Actor, connectionID string) (ProviderSyncJob, error) {
	var result ProviderSyncJob
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		connection, ok := tx.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		project, _, err := projectScope(tx, actor, connection.ProjectID, true)
		if err != nil {
			return err
		}
		if connection.Status == ProviderConnectionRevoked {
			return ErrConnectionRevoked
		}
		for _, job := range tx.ProviderSyncJobs(connection.ID) {
			if job.Status == ProviderSyncJobQueued || job.Status == ProviderSyncJobLeased {
				return ErrProviderSyncInProgress
			}
		}
		now := s.now()
		result = ProviderSyncJob{
			ID: tx.NextID("provider_sync_job"), ProjectID: project.ID,
			ConnectionID: connection.ID, Status: ProviderSyncJobQueued,
			MaxAttempts: 5, AvailableAt: now, RequestedByActorID: actor.ID,
			CreatedAt: now, UpdatedAt: now,
		}
		tx.SaveProviderSyncJob(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "provider_sync.requested", "provider_sync_job", result.ID, map[string]string{
			"connectionId": connection.ID,
		})
		return nil
	})
	return result, err
}

func (s *Service) ListProviderSyncRuns(ctx context.Context, actor Actor, connectionID string) ([]ProviderSyncRun, error) {
	result := []ProviderSyncRun{}
	err := s.repository.View(ctx, func(reader Reader) error {
		connection, ok := reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		if _, _, err := projectScope(reader, actor, connection.ProjectID, false); err != nil {
			return err
		}
		result = reader.ProviderSyncRuns(connectionID)
		return nil
	})
	return result, err
}
