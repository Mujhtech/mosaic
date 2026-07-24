package cloudworkspace

import (
	"context"
	"encoding/hex"
	"slices"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/Mujhtech/mosaic/apps/api/internal/nativecommerce"
	"github.com/Mujhtech/mosaic/apps/api/internal/providercredential"
	"github.com/Mujhtech/mosaic/apps/api/internal/providerreadiness"
)

const providerCredentialClass = "serverSecret"

type CreateProviderConnectionInput struct {
	Name              string
	Provider          ProviderKind
	IntegrationMode   ProviderIntegrationMode
	Mode              ProviderConnectionMode
	ExternalProjectID string
	EnvironmentIDs    []string
	ApplicationIDs    []string
	Credential        string
}

type ReplaceProviderConnectionScopesInput struct {
	EnvironmentIDs []string
	ApplicationIDs []string
}

type CreateProviderMappingDraftInput struct {
	ConnectionID               string
	Provider                   ProviderKind
	EnvironmentID              string
	ApplicationID              string
	ProviderProductIdentifier  string
	ProviderPackageIdentifier  string
	ProviderOfferingIdentifier string
	ExpectedStoreProductID     string
	ProviderBasePlanIdentifier string
	ProviderOfferIdentifier    string
}

type SetActiveProviderAssignmentInput struct {
	Provider                 ProviderKind
	ActivationKind           ProviderActivationKind
	ConnectionID             string
	AcknowledgeProductionUse bool
}

type CreateProviderMappingObservationInput struct {
	AdapterVersion string
	StoreContext   ProviderObservationContext
	Result         ProviderObservationResult
	DiagnosticCode string
	CorrelationID  string
	Metadata       ProviderMappingObservationMetadata
	ObservedAt     time.Time
	ExpiresAt      *time.Time
}

func validProviderObservationMetadata(metadata ProviderMappingObservationMetadata) bool {
	safeVersion := func(value string) bool {
		if len(value) > 64 {
			return false
		}
		for _, character := range value {
			if character < 0x20 || character > 0x7e {
				return false
			}
		}
		lower := strings.ToLower(value)
		for _, forbidden := range []string{
			"receipt", "token", "credential", "customer", "account",
			"authorization", "secret", "password", "bearer",
		} {
			if strings.Contains(lower, forbidden) {
				return false
			}
		}
		return true
	}
	if metadata.ClientPlatform != "" &&
		metadata.ClientPlatform != ProviderObservationClientIOS &&
		metadata.ClientPlatform != ProviderObservationClientAndroid &&
		metadata.ClientPlatform != ProviderObservationClientFlutter {
		return false
	}
	if !safeVersion(metadata.ClientVersion) ||
		!safeVersion(metadata.ApplicationVersion) ||
		!safeVersion(metadata.OSVersion) {
		return false
	}
	if metadata.ConfigurationSource != "" &&
		metadata.ConfigurationSource != ProviderObservationConfigurationBundled &&
		metadata.ConfigurationSource != ProviderObservationConfigurationRemote &&
		metadata.ConfigurationSource != ProviderObservationConfigurationLocal &&
		metadata.ConfigurationSource != ProviderObservationConfigurationUnknown {
		return false
	}
	if metadata.StorefrontCountryCode != "" &&
		(len(metadata.StorefrontCountryCode) != 2 ||
			metadata.StorefrontCountryCode[0] < 'A' || metadata.StorefrontCountryCode[0] > 'Z' ||
			metadata.StorefrontCountryCode[1] < 'A' || metadata.StorefrontCountryCode[1] > 'Z') {
		return false
	}
	return metadata.TestScenario == "" ||
		metadata.TestScenario == ProviderObservationScenarioProductLoad ||
		metadata.TestScenario == ProviderObservationScenarioConfigurationAcceptance ||
		metadata.TestScenario == ProviderObservationScenarioPurchasePresentation ||
		metadata.TestScenario == ProviderObservationScenarioRestore
}

func supportedProviderIntegration(provider ProviderKind, mode ProviderIntegrationMode) bool {
	return provider == ProviderRevenueCat && mode == ProviderServerConnected ||
		provider == ProviderCustom && mode == ProviderSDKOnly
}

func validProviderMappingTarget(provider ProviderKind, input CreateProviderMappingDraftInput) bool {
	validIdentifier := func(value string, required bool) bool {
		if value == "" {
			return !required
		}
		return len(value) <= 255 && strings.TrimSpace(value) != ""
	}
	if !validIdentifier(input.ProviderProductIdentifier, true) ||
		!validIdentifier(input.ProviderPackageIdentifier, false) ||
		!validIdentifier(input.ProviderOfferingIdentifier, false) ||
		!validIdentifier(input.ExpectedStoreProductID, false) {
		return false
	}
	hasPackage := input.ProviderPackageIdentifier != ""
	hasOffering := input.ProviderOfferingIdentifier != ""
	if hasPackage != hasOffering {
		return false
	}
	if provider == ProviderRevenueCat {
		return true
	}
	if hasPackage || input.ExpectedStoreProductID != "" {
		return false
	}
	if provider == ProviderAppStore {
		return input.ProviderBasePlanIdentifier == "" && input.ProviderOfferIdentifier == ""
	}
	if provider == ProviderGooglePlay {
		return input.ProviderOfferIdentifier == "" || input.ProviderBasePlanIdentifier != ""
	}
	return provider == ProviderCustom
}

func uniqueStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	slices.Sort(result)
	return result
}

func providerScopes(reader Reader, connection ProviderConnection) ProviderConnection {
	connection.EnvironmentIDs = reader.ProviderConnectionEnvironmentIDs(connection.ID)
	connection.ApplicationIDs = reader.ProviderConnectionApplicationIDs(connection.ID)
	if credential, ok := reader.ProviderCredential(connection.ID); ok {
		connection.Credential = publicProviderCredential(credential)
	}
	return connection
}

func publicProviderCredential(record ProviderCredentialRecord) *ProviderCredential {
	return &ProviderCredential{
		Class: record.Class, Fingerprint: "hmac-sha256:" + hex.EncodeToString(record.Fingerprint),
		KeyID: record.KeyID, EnvelopeVersion: record.Version, CreatedAt: record.CreatedAt,
		RotatedAt: record.RotatedAt, RevokedAt: record.RevokedAt,
	}
}

func validRevenueCatCredential(value string) bool {
	return strings.HasPrefix(value, "sk_") && len(value) >= 6 && len(value) <= 4096 &&
		strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\r\n\t ")
}

func (s *Service) encryptProviderCredential(project Project, connectionID string, plaintext string) (ProviderCredentialRecord, error) {
	if s.credentialCipher == nil || !validRevenueCatCredential(plaintext) {
		return ProviderCredentialRecord{}, ErrProviderCredentialInvalid
	}
	envelope, err := s.credentialCipher.Encrypt([]byte(plaintext), providercredential.Scope{
		OrganizationID: project.OrganizationID, ProjectID: project.ID,
		ConnectionID: connectionID, CredentialClass: providerCredentialClass,
	})
	if err != nil {
		return ProviderCredentialRecord{}, ErrProviderCredentialInvalid
	}
	now := s.now()
	return ProviderCredentialRecord{
		ConnectionID: connectionID, ProjectID: project.ID, OrganizationID: project.OrganizationID,
		Class: envelope.CredentialClass, Version: envelope.Version, Algorithm: envelope.Algorithm,
		KeyID: envelope.KeyID, Nonce: envelope.Nonce, Ciphertext: envelope.Ciphertext,
		Fingerprint: envelope.Fingerprint, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func validateProviderScopes(reader Reader, projectID string, mode ProviderConnectionMode, environmentIDs, applicationIDs []string) error {
	if len(environmentIDs) == 0 || len(applicationIDs) == 0 {
		return ErrScopeMismatch
	}
	for _, environmentID := range environmentIDs {
		environment, ok := reader.Environment(environmentID)
		if !ok || environment.ProjectID != projectID {
			return ErrScopeMismatch
		}
		if mode == ProviderProduction && environment.Mode != EnvironmentProduction ||
			mode == ProviderSandbox && environment.Mode == EnvironmentProduction {
			return ErrModeMismatch
		}
	}
	for _, applicationID := range applicationIDs {
		application, ok := reader.Application(applicationID)
		if !ok || application.ProjectID != projectID {
			return ErrScopeMismatch
		}
	}
	return nil
}

func (s *Service) CreateProviderConnection(ctx context.Context, actor Actor, projectID string, input CreateProviderConnectionInput) (ProviderConnection, error) {
	ctx, span := s.operation(ctx, "provider_connection.create", actor,
		attribute.String("mosaic.project.id", projectID),
		attribute.String("mosaic.provider.kind", string(input.Provider)),
	)
	defer span.End()
	var result ProviderConnection
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, err := catalogProject(tx, actor, projectID, true)
		if err != nil {
			return err
		}
		if !supportedProviderIntegration(input.Provider, input.IntegrationMode) {
			return ErrProviderUnsupported
		}
		if input.Provider == ProviderRevenueCat &&
			(strings.TrimSpace(input.ExternalProjectID) == "" ||
				strings.TrimSpace(input.ExternalProjectID) != input.ExternalProjectID ||
				len(input.ExternalProjectID) > 255) {
			return ErrProviderProjectInvalid
		}
		if input.Provider == ProviderRevenueCat && s.providerCatalog != nil {
			if input.Credential == "" {
				return ErrProviderCredentialInvalid
			}
		} else if input.Credential != "" {
			return ErrProviderUnsupported
		}
		environmentIDs := uniqueStrings(input.EnvironmentIDs)
		applicationIDs := uniqueStrings(input.ApplicationIDs)
		if err := validateProviderScopes(tx, projectID, input.Mode, environmentIDs, applicationIDs); err != nil {
			return err
		}
		for _, connection := range tx.ProviderConnections(projectID) {
			if connection.Name == input.Name {
				return &ConflictError{Resource: "provider_connection", Field: "name"}
			}
		}
		now := s.now()
		result = ProviderConnection{
			ID:                tx.NextID("provider_connection"),
			ProjectID:         projectID,
			Name:              input.Name,
			Provider:          input.Provider,
			IntegrationMode:   input.IntegrationMode,
			Mode:              input.Mode,
			Status:            ProviderConnectionPending,
			HealthStatus:      ProviderHealthUntested,
			ExternalProjectID: input.ExternalProjectID,
			EnvironmentIDs:    environmentIDs,
			ApplicationIDs:    applicationIDs,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		tx.SaveProviderConnection(result)
		tx.ReplaceProviderConnectionScopes(result.ID, projectID, environmentIDs, applicationIDs, now)
		if input.Provider == ProviderRevenueCat && s.providerCatalog != nil {
			credential, err := s.encryptProviderCredential(project, result.ID, input.Credential)
			if err != nil {
				return err
			}
			tx.SaveProviderCredential(credential)
			result.Credential = publicProviderCredential(credential)
		}
		s.audit(tx, actor, project.OrganizationID, projectID, "", "provider_connection.created", "provider_connection", result.ID, map[string]string{
			"provider":        string(result.Provider),
			"integrationMode": string(result.IntegrationMode),
			"mode":            string(result.Mode),
		})
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_connection.created", actor, "", projectID, result.ID)
	}
	return result, err
}

func (s *Service) GetProviderConnection(ctx context.Context, actor Actor, connectionID string) (ProviderConnection, error) {
	var result ProviderConnection
	err := s.repository.View(ctx, func(reader Reader) error {
		connection, ok := reader.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		if _, _, err := projectScope(reader, actor, connection.ProjectID, false); err != nil {
			return err
		}
		result = providerScopes(reader, connection)
		return nil
	})
	return result, err
}

func (s *Service) ListProviderConnections(ctx context.Context, actor Actor, projectID string, options ListOptions) (List[ProviderConnection], error) {
	values := make([]ProviderConnection, 0)
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := projectScope(reader, actor, projectID, false); err != nil {
			return err
		}
		for _, connection := range reader.ProviderConnections(projectID) {
			values = append(values, providerScopes(reader, connection))
		}
		return nil
	})
	return paginated(values, options, func(value ProviderConnection) string { return value.ID }, err)
}

func scopeContains(values []string, candidate string) bool {
	return slices.Contains(values, candidate)
}

func (s *Service) ReplaceProviderConnectionScopes(ctx context.Context, actor Actor, connectionID string, input ReplaceProviderConnectionScopesInput) (ProviderConnection, error) {
	ctx, span := s.operation(ctx, "provider_connection.scopes.replace", actor, attribute.String("mosaic.provider_connection.id", connectionID))
	defer span.End()
	var result ProviderConnection
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		connection, ok := tx.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		project, err := catalogProject(tx, actor, connection.ProjectID, true)
		if err != nil {
			return err
		}
		if connection.Status == ProviderConnectionRevoked {
			return ErrConnectionRevoked
		}
		environmentIDs := uniqueStrings(input.EnvironmentIDs)
		applicationIDs := uniqueStrings(input.ApplicationIDs)
		if err := validateProviderScopes(tx, project.ID, connection.Mode, environmentIDs, applicationIDs); err != nil {
			return err
		}
		for _, assignment := range tx.ProviderAssignments(connection.ID) {
			if !scopeContains(environmentIDs, assignment.EnvironmentID) || !scopeContains(applicationIDs, assignment.ApplicationID) {
				return ErrScopeMismatch
			}
		}
		for _, product := range tx.Products(project.ID) {
			for _, mapping := range tx.ProviderMappings(product.ID) {
				if mapping.ConnectionID == connection.ID && mapping.Status != ProviderMappingArchived &&
					(!scopeContains(environmentIDs, mapping.EnvironmentID) || !scopeContains(applicationIDs, mapping.ApplicationID)) {
					return ErrScopeMismatch
				}
			}
		}
		for _, currentEnvironmentID := range tx.ProviderConnectionEnvironmentIDs(connection.ID) {
			for _, currentApplicationID := range tx.ProviderConnectionApplicationIDs(connection.ID) {
				for _, mapping := range tx.ProviderEntitlementMappings(
					connection.ID, currentEnvironmentID, currentApplicationID,
				) {
					if mapping.Status == ProviderMappingActive &&
						(!scopeContains(environmentIDs, mapping.EnvironmentID) ||
							!scopeContains(applicationIDs, mapping.ApplicationID)) {
						return ErrScopeMismatch
					}
				}
			}
		}
		now := s.now()
		tx.ReplaceProviderConnectionScopes(connection.ID, project.ID, environmentIDs, applicationIDs, now)
		connection.EnvironmentIDs, connection.ApplicationIDs, connection.UpdatedAt = environmentIDs, applicationIDs, now
		tx.SaveProviderConnection(connection)
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "provider_connection.scopes_replaced", "provider_connection", connection.ID, map[string]string{})
		result, organizationID = connection, project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_connection.scopes_replaced", actor, organizationID, result.ProjectID, result.ID)
	}
	return result, err
}

func (s *Service) RevokeProviderConnection(ctx context.Context, actor Actor, connectionID string) (ProviderConnection, error) {
	ctx, span := s.operation(ctx, "provider_connection.revoke", actor, attribute.String("mosaic.provider_connection.id", connectionID))
	defer span.End()
	var result ProviderConnection
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		connection, ok := tx.ProviderConnection(connectionID)
		if !ok {
			return ErrNotFound
		}
		project, err := catalogProject(tx, actor, connection.ProjectID, true)
		if err != nil {
			return err
		}
		if connection.Status == ProviderConnectionRevoked {
			result, organizationID = providerScopes(tx, connection), project.OrganizationID
			return nil
		}
		now := s.now()
		connection.Status, connection.HealthStatus, connection.LastErrorCode = ProviderConnectionRevoked, ProviderHealthRevoked, ProviderErrorConnectionRevoked
		connection.RevokedAt, connection.UpdatedAt = &now, now
		tx.SaveProviderConnection(connection)
		if credential, ok := tx.ProviderCredential(connection.ID); ok {
			credential.RevokedAt, credential.UpdatedAt = &now, now
			tx.SaveProviderCredential(credential)
		}
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "provider_connection.revoked", "provider_connection", connection.ID, map[string]string{})
		result, organizationID = providerScopes(tx, connection), project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_connection.revoked", actor, organizationID, result.ProjectID, result.ID)
	}
	return result, err
}

func (s *Service) SetActiveProviderAssignment(ctx context.Context, actor Actor, environmentID, applicationID string, input SetActiveProviderAssignmentInput) (ActiveProviderAssignment, error) {
	ctx, span := s.operation(ctx, "provider_assignment.set", actor,
		attribute.String("mosaic.environment.id", environmentID),
		attribute.String("mosaic.application.id", applicationID),
		attribute.String("mosaic.provider", string(input.Provider)),
		attribute.String("mosaic.provider_activation.kind", string(input.ActivationKind)),
	)
	defer span.End()
	var result ActiveProviderAssignment
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		environment, project, err := environmentScope(tx, actor, environmentID, true)
		if err != nil {
			return err
		}
		if project.Status == ProjectArchived {
			return ErrResourceArchived
		}
		application, ok := tx.Application(applicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		productionUseOutsideProduction := false
		provider := input.Provider
		activationKind := input.ActivationKind
		if activationKind == "" && input.ConnectionID != "" {
			activationKind = ProviderActivationConnection
		}
		switch activationKind {
		case ProviderActivationConnection:
			connection, ok := tx.ProviderConnection(input.ConnectionID)
			if !ok || connection.ProjectID != project.ID ||
				(provider != "" && connection.Provider != provider) {
				return ErrScopeMismatch
			}
			provider = connection.Provider
			if connection.Status == ProviderConnectionRevoked {
				return ErrConnectionRevoked
			}
			if !scopeContains(tx.ProviderConnectionEnvironmentIDs(connection.ID), environment.ID) ||
				!scopeContains(tx.ProviderConnectionApplicationIDs(connection.ID), application.ID) {
				return ErrScopeMismatch
			}
			if environment.Mode == EnvironmentProduction && connection.Mode == ProviderSandbox {
				return ErrModeMismatch
			}
			productionUseOutsideProduction = environment.Mode != EnvironmentProduction && connection.Mode == ProviderProduction
			if productionUseOutsideProduction && !input.AcknowledgeProductionUse {
				return ErrProductionConnectionAcknowledgementRequired
			}
		case ProviderActivationNativeStore:
			if input.ConnectionID != "" ||
				(provider == ProviderAppStore && application.Platform != PlatformIOS) ||
				(provider == ProviderGooglePlay && application.Platform != PlatformAndroid) ||
				(provider != ProviderAppStore && provider != ProviderGooglePlay) {
				return ErrProviderUnsupported
			}
		default:
			return ErrProviderUnsupported
		}
		now := s.now()
		result = ActiveProviderAssignment{
			ProjectID:                           project.ID,
			EnvironmentID:                       environment.ID,
			ApplicationID:                       application.ID,
			Platform:                            application.Platform,
			Provider:                            provider,
			ActivationKind:                      activationKind,
			ConnectionID:                        input.ConnectionID,
			ProductionConnectionUseAcknowledged: productionUseOutsideProduction && input.AcknowledgeProductionUse,
			CreatedByActorID:                    actor.ID,
			CreatedAt:                           now,
			UpdatedAt:                           now,
		}
		if previous, ok := tx.ActiveProviderAssignment(environment.ID, application.ID); ok {
			result.CreatedAt = previous.CreatedAt
		}
		tx.SaveActiveProviderAssignment(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "provider_assignment.set", "provider_assignment", environment.ID+":"+application.ID, map[string]string{
			"applicationId":  application.ID,
			"connectionId":   input.ConnectionID,
			"provider":       string(provider),
			"activationKind": string(activationKind),
			"platform":       string(application.Platform),
		})
		organizationID = project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_assignment.set", actor, organizationID, result.ProjectID, environmentID+":"+applicationID)
	}
	return result, err
}

func (s *Service) GetActiveProviderAssignment(ctx context.Context, actor Actor, environmentID, applicationID string) (ActiveProviderAssignment, error) {
	var result ActiveProviderAssignment
	err := s.repository.View(ctx, func(reader Reader) error {
		environment, project, err := environmentScope(reader, actor, environmentID, false)
		if err != nil {
			return err
		}
		application, ok := reader.Application(applicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrNotFound
		}
		result, ok = reader.ActiveProviderAssignment(environment.ID, application.ID)
		if !ok {
			return ErrNotFound
		}
		return nil
	})
	return result, err
}

func (s *Service) ClearActiveProviderAssignment(ctx context.Context, actor Actor, environmentID, applicationID string) error {
	ctx, span := s.operation(ctx, "provider_assignment.clear", actor,
		attribute.String("mosaic.environment.id", environmentID),
		attribute.String("mosaic.application.id", applicationID),
	)
	defer span.End()
	var organizationID, projectID, connectionID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		environment, project, err := environmentScope(tx, actor, environmentID, true)
		if err != nil {
			return err
		}
		application, ok := tx.Application(applicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrNotFound
		}
		assignment, ok := tx.ActiveProviderAssignment(environment.ID, application.ID)
		if !ok {
			return ErrNotFound
		}
		tx.DeleteActiveProviderAssignment(environment.ID, application.ID)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "provider_assignment.cleared", "provider_assignment", environment.ID+":"+application.ID, map[string]string{
			"applicationId": application.ID,
			"connectionId":  assignment.ConnectionID,
		})
		organizationID, projectID, connectionID = project.OrganizationID, project.ID, assignment.ConnectionID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_assignment.cleared", actor, organizationID, projectID, connectionID)
	}
	return err
}

func (s *Service) CreateProviderMappingDraft(ctx context.Context, actor Actor, productID string, input CreateProviderMappingDraftInput) (ProviderProductMapping, error) {
	ctx, span := s.operation(ctx, "provider_mapping.create_draft", actor,
		attribute.String("mosaic.product.id", productID),
		attribute.String("mosaic.provider_connection.id", input.ConnectionID),
	)
	defer span.End()
	var result ProviderProductMapping
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		product, project, err := productScope(tx, actor, productID, true)
		if err != nil {
			return err
		}
		if product.Status == ProductArchived {
			return ErrResourceArchived
		}
		environment, ok := tx.Environment(input.EnvironmentID)
		if !ok || environment.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		application, ok := tx.Application(input.ApplicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		provider := input.Provider
		status := ProviderMappingActive
		if input.ConnectionID != "" {
			connection, ok := tx.ProviderConnection(input.ConnectionID)
			if !ok || connection.ProjectID != project.ID {
				return ErrScopeMismatch
			}
			if connection.Status == ProviderConnectionRevoked {
				return ErrConnectionRevoked
			}
			if provider != "" && provider != connection.Provider {
				return ErrScopeMismatch
			}
			provider = connection.Provider
			status = ProviderMappingDraft
			if !scopeContains(tx.ProviderConnectionEnvironmentIDs(connection.ID), environment.ID) ||
				!scopeContains(tx.ProviderConnectionApplicationIDs(connection.ID), application.ID) {
				return ErrScopeMismatch
			}
		} else if (provider == ProviderAppStore && application.Platform != PlatformIOS) ||
			(provider == ProviderGooglePlay && application.Platform != PlatformAndroid) ||
			(provider != ProviderAppStore && provider != ProviderGooglePlay) {
			return ErrProviderUnsupported
		}
		if !validProviderMappingTarget(provider, input) ||
			(provider == ProviderGooglePlay && product.Type == ProductSubscription && input.ProviderBasePlanIdentifier == "") ||
			(product.Type == ProductOneTimeNonConsumable && (input.ProviderBasePlanIdentifier != "" || input.ProviderOfferIdentifier != "")) {
			return ErrMappingTargetInvalid
		}
		if input.ConnectionID == "" {
			if _, exists := tx.NativeProviderMappingByTarget(
				provider, environment.ID, application.ID, application.Platform,
				input.ProviderProductIdentifier,
			); exists {
				return &ConflictError{Resource: "provider_mapping", Field: "providerProductIdentifier"}
			}
		}
		for _, mapping := range tx.ProviderMappings(product.ID) {
			sameActivation := input.ConnectionID != "" && mapping.ConnectionID == input.ConnectionID ||
				input.ConnectionID == "" && mapping.ConnectionID == "" && mapping.Provider == provider
			if sameActivation && mapping.EnvironmentID == environment.ID &&
				mapping.ApplicationID == application.ID && mapping.Platform == application.Platform &&
				mapping.Status != ProviderMappingArchived {
				return &ConflictError{Resource: "provider_mapping", Field: "scope"}
			}
		}
		now := s.now()
		result = ProviderProductMapping{
			ID:                         tx.NextID("mapping"),
			ProjectID:                  project.ID,
			ProductID:                  product.ID,
			ConnectionID:               input.ConnectionID,
			EnvironmentID:              environment.ID,
			ApplicationID:              application.ID,
			Platform:                   application.Platform,
			Provider:                   provider,
			ProviderProductIdentifier:  input.ProviderProductIdentifier,
			ProviderPackageIdentifier:  input.ProviderPackageIdentifier,
			ProviderOfferingIdentifier: input.ProviderOfferingIdentifier,
			ExpectedStoreProductID:     input.ExpectedStoreProductID,
			ProviderBasePlanIdentifier: input.ProviderBasePlanIdentifier,
			ProviderOfferIdentifier:    input.ProviderOfferIdentifier,
			Status:                     status,
			Availability:               ProviderAvailabilityUnknown,
			SyncState:                  ProviderSyncNeverSynced,
			CreatedAt:                  now,
			UpdatedAt:                  now,
		}
		if input.ConnectionID == "" && product.Status != ProductConnected {
			product.Status, product.UpdatedAt = ProductConnected, now
			tx.SaveProduct(product)
		}
		tx.SaveProviderMapping(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "provider_mapping.draft_created", "provider_mapping", result.ID, map[string]string{
			"applicationId": application.ID,
			"connectionId":  input.ConnectionID,
			"provider":      string(provider),
		})
		organizationID = project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_mapping.draft_created", actor, organizationID, result.ProjectID, result.ID)
	}
	return result, err
}

func (s *Service) ArchiveProviderMapping(ctx context.Context, actor Actor, mappingID string) (ProviderProductMapping, error) {
	ctx, span := s.operation(ctx, "provider_mapping.archive", actor, attribute.String("mosaic.provider_mapping.id", mappingID))
	defer span.End()
	var result ProviderProductMapping
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		mapping, ok := tx.ProviderMapping(mappingID)
		if !ok {
			return ErrNotFound
		}
		_, project, err := productScope(tx, actor, mapping.ProductID, true)
		if err != nil {
			return err
		}
		if mapping.Status == ProviderMappingArchived {
			result, organizationID = mapping, project.OrganizationID
			return nil
		}
		now := s.now()
		mapping.Status, mapping.ArchivedAt, mapping.UpdatedAt = ProviderMappingArchived, &now, now
		tx.SaveProviderMapping(mapping)
		s.audit(tx, actor, project.OrganizationID, project.ID, mapping.EnvironmentID, "provider_mapping.archived", "provider_mapping", mapping.ID, map[string]string{})
		result, organizationID = mapping, project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_mapping.archived", actor, organizationID, result.ProjectID, result.ID)
	}
	return result, err
}

func (s *Service) GetProviderMappingMetadata(ctx context.Context, actor Actor, mappingID string) (ProviderProductMetadataSnapshot, error) {
	var result ProviderProductMetadataSnapshot
	err := s.repository.View(ctx, func(reader Reader) error {
		mapping, ok := reader.ProviderMapping(mappingID)
		if !ok || mapping.Status == ProviderMappingArchived || mapping.CurrentSnapshotID == "" {
			return ErrNotFound
		}
		if _, _, err := productScope(reader, actor, mapping.ProductID, false); err != nil {
			return err
		}
		snapshot, ok := reader.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
		if !ok || snapshot.MappingID != mapping.ID || snapshot.ProjectID != mapping.ProjectID {
			return ErrNotFound
		}
		result = snapshot
		return nil
	})
	return result, err
}

func validObservationContext(provider ProviderKind, context ProviderObservationContext) bool {
	switch provider {
	case ProviderAppStore:
		return context == ProviderObservationStoreKitConfiguration ||
			context == ProviderObservationAppleSandbox ||
			context == ProviderObservationProduction ||
			context == ProviderObservationUnknown
	case ProviderGooglePlay:
		return context == ProviderObservationGooglePlayTest ||
			context == ProviderObservationProduction ||
			context == ProviderObservationUnknown
	default:
		return false
	}
}

func (s *Service) CreateProviderMappingObservation(ctx context.Context, actor Actor, mappingID string, input CreateProviderMappingObservationInput) (ProviderMappingObservation, error) {
	ctx, span := s.operation(ctx, "provider_mapping.observe", actor, attribute.String("mosaic.provider_mapping.id", mappingID))
	defer span.End()
	var result ProviderMappingObservation
	var organizationID string
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		mapping, ok := tx.ProviderMapping(mappingID)
		if !ok {
			return ErrNotFound
		}
		_, project, err := productScope(tx, actor, mapping.ProductID, true)
		if err != nil {
			return err
		}
		if mapping.Status == ProviderMappingArchived {
			return ErrResourceArchived
		}
		if mapping.ConnectionID != "" || !validObservationContext(mapping.Provider, input.StoreContext) {
			return ErrProviderUnsupported
		}
		now := s.now()
		if input.AdapterVersion == "" || len(input.AdapterVersion) > 64 ||
			input.CorrelationID == "" || len(input.CorrelationID) > 128 ||
			(input.Result != ProviderObservationAvailable &&
				input.Result != ProviderObservationUnavailable &&
				input.Result != ProviderObservationFailed) ||
			input.ObservedAt.IsZero() || input.ObservedAt.After(now.Add(5*time.Minute)) ||
			(input.ExpiresAt != nil && input.ExpiresAt.Before(input.ObservedAt)) ||
			!validProviderObservationMetadata(input.Metadata) ||
			(input.DiagnosticCode != "" && len(input.DiagnosticCode) > 128) {
			return ErrMappingTargetInvalid
		}
		result = ProviderMappingObservation{
			ID: tx.NextID("provider_observation"), ProjectID: project.ID, MappingID: mapping.ID,
			EnvironmentID: mapping.EnvironmentID, ApplicationID: mapping.ApplicationID,
			Platform: mapping.Platform, Provider: mapping.Provider, AdapterVersion: input.AdapterVersion,
			StoreContext: input.StoreContext, Result: input.Result, DiagnosticCode: input.DiagnosticCode,
			CorrelationID: input.CorrelationID, Metadata: input.Metadata, ObservedAt: input.ObservedAt,
			ExpiresAt: input.ExpiresAt, ReceivedAt: now, CreatedByActorID: actor.ID,
		}
		tx.SaveProviderMappingObservation(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, mapping.EnvironmentID,
			"provider_mapping.observation_accepted", "provider_mapping_observation", result.ID,
			map[string]string{
				"mappingId": mapping.ID, "provider": string(mapping.Provider),
				"storeContext": string(input.StoreContext), "result": string(input.Result),
			})
		organizationID = project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_mapping.observation_accepted", actor, organizationID, result.ProjectID, result.ID)
	}
	return result, err
}

func (s *Service) ListProviderMappingObservations(ctx context.Context, actor Actor, mappingID string) ([]ProviderMappingObservation, error) {
	result := []ProviderMappingObservation{}
	err := s.repository.View(ctx, func(reader Reader) error {
		mapping, ok := reader.ProviderMapping(mappingID)
		if !ok {
			return ErrNotFound
		}
		if _, _, err := productScope(reader, actor, mapping.ProductID, false); err != nil {
			return err
		}
		result = reader.ProviderMappingObservations(mapping.ID)
		return nil
	})
	return result, err
}

func (s *Service) ProviderMappingUsage(ctx context.Context, actor Actor, mappingID string) (ProviderMappingUsage, error) {
	var result ProviderMappingUsage
	err := s.repository.View(ctx, func(reader Reader) error {
		mapping, ok := reader.ProviderMapping(mappingID)
		if !ok {
			return ErrNotFound
		}
		product, _, err := productScope(reader, actor, mapping.ProductID, false)
		if err != nil {
			return err
		}
		result = ProviderMappingUsage{Mapping: mapping, Product: product, Usage: productUsage(reader, product)}
		return nil
	})
	return result, err
}

func nativeProviderProfile(provider ProviderKind, platform Platform) (ProviderProfile, bool) {
	profile, ok := nativecommerce.ProfileFor(string(provider))
	if !ok || profile.Platform != string(platform) {
		return ProviderProfile{}, false
	}
	capabilities := make([]ProviderCapability, 0, len(profile.Capabilities))
	for _, capability := range profile.Capabilities {
		capabilities = append(capabilities, ProviderCapability{
			Name: capability.Name, Support: capability.Support, ReasonCode: capability.ReasonCode,
		})
	}
	return ProviderProfile{
		Provider: provider, DisplayName: profile.DisplayName, Platform: platform,
		AdapterVersion: profile.AdapterVersion, Capabilities: capabilities,
	}, true
}

func (s *Service) NativeProviderProfile(_ context.Context, provider ProviderKind, platform Platform) (ProviderProfile, error) {
	profile, ok := nativeProviderProfile(provider, platform)
	if !ok {
		return ProviderProfile{}, ErrProviderUnsupported
	}
	return profile, nil
}

func readinessIssue(code ProviderErrorCode, resourceType, resourceID string, recoveryAction providerreadiness.Action) ProviderReadinessIssue {
	if !providerreadiness.IsKnown(recoveryAction) {
		panic("unknown provider readiness recovery action: " + recoveryAction)
	}
	return ProviderReadinessIssue{Code: code, ResourceType: resourceType, ResourceID: resourceID, RecoveryAction: recoveryAction}
}

func (s *Service) ProviderReadiness(ctx context.Context, actor Actor, productID, environmentID, applicationID string) (ProviderReadiness, error) {
	ctx, span := s.operation(ctx, "provider_readiness.evaluate", actor,
		attribute.String("mosaic.product.id", productID),
		attribute.String("mosaic.environment.id", environmentID),
		attribute.String("mosaic.application.id", applicationID),
	)
	defer span.End()
	result := ProviderReadiness{
		ProductID: productID, EnvironmentID: environmentID, ApplicationID: applicationID,
		Blockers: []ProviderReadinessIssue{}, Warnings: []ProviderReadinessIssue{}, EvaluatedAt: s.now(),
	}
	err := s.repository.View(ctx, func(reader Reader) error {
		product, project, err := productScope(reader, actor, productID, false)
		if err != nil {
			return err
		}
		environment, ok := reader.Environment(environmentID)
		if !ok || environment.ProjectID != project.ID {
			return ErrNotFound
		}
		application, ok := reader.Application(applicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrNotFound
		}
		result.Platform = application.Platform
		if product.Status == ProductArchived {
			result.State = ProviderReadinessArchived
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "product", product.ID, "restoreOrReplaceProduct"))
			return nil
		}
		if product.Status != ProductConnected {
			result.State = ProviderReadinessAttentionRequired
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "product", product.ID, "connectProduct"))
		}
		productGrants := reader.ProductGrants(product.ID)
		if len(productGrants) == 0 {
			if result.State == "" {
				result.State = ProviderReadinessAttentionRequired
			}
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "product", product.ID, "grantEntitlement"))
		}
		assignment, ok := reader.ActiveProviderAssignment(environment.ID, application.ID)
		if !ok {
			if result.State == "" {
				result.State = ProviderReadinessAttentionRequired
			}
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingMissing, "provider_assignment", environment.ID+":"+application.ID, "assignProvider"))
			return nil
		}
		result.Provider = assignment.Provider
		result.ConnectionID = assignment.ConnectionID
		if assignment.ActivationKind == ProviderActivationNativeStore {
			if (assignment.Provider == ProviderAppStore && application.Platform != PlatformIOS) ||
				(assignment.Provider == ProviderGooglePlay && application.Platform != PlatformAndroid) {
				result.State = ProviderReadinessUnavailable
				result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorScopeMismatch, "provider_assignment", environment.ID+":"+application.ID, "selectCompatibleProvider"))
				return nil
			}
			activeMappings := make([]ProviderProductMapping, 0, 1)
			for _, mapping := range reader.ProviderMappings(product.ID) {
				if mapping.ConnectionID == "" && mapping.Provider == assignment.Provider &&
					mapping.EnvironmentID == environment.ID && mapping.ApplicationID == application.ID &&
					mapping.Platform == application.Platform && mapping.Status == ProviderMappingActive {
					activeMappings = append(activeMappings, mapping)
				}
			}
			switch len(activeMappings) {
			case 0:
				result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingMissing, "product", product.ID, "createNativeProviderMapping"))
			case 1:
				mapping := activeMappings[0]
				result.MappingID = mapping.ID
				if mapping.Provider == ProviderGooglePlay && product.Type == ProductSubscription && mapping.ProviderBasePlanIdentifier == "" {
					result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingMissing, "provider_mapping", mapping.ID, "addGoogleBasePlan"))
				}
				observations := reader.ProviderMappingObservations(mapping.ID)
				if len(observations) != 0 {
					observation := observations[0]
					result.Observation = &observation
					switch observation.Result {
					case ProviderObservationUnavailable, ProviderObservationFailed:
						result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "provider_mapping", mapping.ID, "rerunNativeProviderTest"))
					case ProviderObservationAvailable:
						if observation.ExpiresAt != nil && !observation.ExpiresAt.After(result.EvaluatedAt) {
							result.Warnings = append(result.Warnings, readinessIssue(ProviderErrorMetadataStale, "provider_mapping", mapping.ID, "rerunNativeProviderTest"))
						}
					}
				} else {
					result.Warnings = append(result.Warnings, readinessIssue(ProviderErrorMetadataStale, "provider_mapping", mapping.ID, "runNativeProviderTest"))
				}
			default:
				result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingAmbiguous, "product", product.ID, "archiveDuplicateMappings"))
			}
			if len(result.Blockers) != 0 {
				result.State = ProviderReadinessAttentionRequired
			} else if result.Observation != nil && result.Observation.Result == ProviderObservationAvailable &&
				(result.Observation.StoreContext == ProviderObservationStoreKitConfiguration ||
					result.Observation.StoreContext == ProviderObservationAppleSandbox ||
					result.Observation.StoreContext == ProviderObservationGooglePlayTest) &&
				(result.Observation.ExpiresAt == nil || result.Observation.ExpiresAt.After(result.EvaluatedAt)) {
				result.State = ProviderReadinessVerifiedInTest
			} else {
				result.State = ProviderReadinessConfigured
			}
			return nil
		}
		if product.MetadataSource != MetadataProvider {
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMetadataStale, "product", product.ID, "syncProviderMetadata"))
		}
		connection, ok := reader.ProviderConnection(assignment.ConnectionID)
		if !ok {
			return ErrNotFound
		}
		if connection.Status == ProviderConnectionRevoked {
			result.State = ProviderReadinessUnavailable
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorConnectionRevoked, "provider_connection", connection.ID, "reconnectProvider"))
			return nil
		}
		if !scopeContains(reader.ProviderConnectionEnvironmentIDs(connection.ID), environment.ID) ||
			!scopeContains(reader.ProviderConnectionApplicationIDs(connection.ID), application.ID) {
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorScopeMismatch, "provider_connection", connection.ID, "updateConnectionScopes"))
		}
		if environment.Mode == EnvironmentProduction && connection.Mode == ProviderSandbox {
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorModeMismatch, "provider_connection", connection.ID, "assignProductionConnection"))
		}
		if environment.Mode != EnvironmentProduction && connection.Mode == ProviderProduction {
			result.Warnings = append(result.Warnings, readinessIssue(ProviderErrorModeMismatch, "provider_connection", connection.ID, "reviewProductionConnectionUse"))
		}
		if connection.Status != ProviderConnectionActive || connection.HealthStatus != ProviderHealthHealthy {
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProviderUnavailable, "provider_connection", connection.ID, "testOrReconnectProvider"))
		}
		entitlementMappings := reader.ProviderEntitlementMappings(connection.ID, environment.ID, application.ID)
		mappingsByEntitlement := make(map[string]int, len(entitlementMappings))
		entitlementsByProviderIdentifier := make(map[string]string, len(entitlementMappings))
		for _, mapping := range entitlementMappings {
			if mapping.Status != ProviderMappingActive {
				continue
			}
			mappingsByEntitlement[mapping.EntitlementID]++
			if existing, duplicate := entitlementsByProviderIdentifier[mapping.ProviderEntitlementIdentifier]; duplicate &&
				existing != mapping.EntitlementID {
				result.Blockers = append(result.Blockers, readinessIssue(
					ProviderErrorMappingAmbiguous, "provider_entitlement_mapping", mapping.ID, "replaceProviderEntitlementMapping",
				))
			} else {
				entitlementsByProviderIdentifier[mapping.ProviderEntitlementIdentifier] = mapping.EntitlementID
			}
		}
		for _, grant := range productGrants {
			switch mappingsByEntitlement[grant.EntitlementID] {
			case 0:
				result.Blockers = append(result.Blockers, readinessIssue(
					ProviderErrorMappingMissing, "entitlement", grant.EntitlementID, "importProviderEntitlementMapping",
				))
			case 1:
			default:
				result.Blockers = append(result.Blockers, readinessIssue(
					ProviderErrorMappingAmbiguous, "entitlement", grant.EntitlementID, "replaceProviderEntitlementMapping",
				))
			}
		}
		activeMappings := make([]ProviderProductMapping, 0, 1)
		for _, mapping := range reader.ProviderMappings(product.ID) {
			if mapping.ConnectionID == connection.ID && mapping.EnvironmentID == environment.ID &&
				mapping.ApplicationID == application.ID && mapping.Platform == application.Platform &&
				mapping.Status == ProviderMappingActive {
				activeMappings = append(activeMappings, mapping)
			}
		}
		switch len(activeMappings) {
		case 0:
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingMissing, "product", product.ID, "createOrSyncProviderMapping"))
		case 1:
			mapping := activeMappings[0]
			result.MappingID = mapping.ID
			if mapping.Availability != ProviderAvailabilityAvailable {
				result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "provider_mapping", mapping.ID, "reviewProviderProduct"))
			}
			metadataStale := false
			metadataExpired := false
			if mapping.SyncState != ProviderSyncCurrent || mapping.CurrentSnapshotID == "" {
				metadataStale = true
			} else {
				snapshot, ok := reader.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
				if !ok {
					metadataStale = true
				} else if snapshot.ExpiresAt != nil && !snapshot.ExpiresAt.After(result.EvaluatedAt) {
					metadataExpired = true
				} else if snapshot.StaleAt.IsZero() || !snapshot.StaleAt.After(result.EvaluatedAt) {
					metadataStale = true
				}
			}
			if metadataExpired {
				result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "provider_mapping", mapping.ID, "syncProviderMetadata"))
			} else if metadataStale {
				issue := readinessIssue(ProviderErrorMetadataStale, "provider_mapping", mapping.ID, "syncProviderMetadata")
				if environment.Mode == EnvironmentProduction {
					result.Blockers = append(result.Blockers, issue)
				} else {
					result.Warnings = append(result.Warnings, issue)
				}
			}
		default:
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingAmbiguous, "product", product.ID, "archiveDuplicateMappings"))
		}
		if result.State == "" {
			if len(result.Blockers) == 0 {
				result.State = ProviderReadinessConfigured
			} else {
				result.State = ProviderReadinessAttentionRequired
			}
		}
		return nil
	})
	return result, err
}
