package cloudworkspace

import (
	"context"
	"slices"
	"strings"

	"go.opentelemetry.io/otel/attribute"
)

type CreateProviderConnectionInput struct {
	Name              string
	Provider          ProviderKind
	IntegrationMode   ProviderIntegrationMode
	Mode              ProviderConnectionMode
	ExternalProjectID string
	EnvironmentIDs    []string
	ApplicationIDs    []string
}

type ReplaceProviderConnectionScopesInput struct {
	EnvironmentIDs []string
	ApplicationIDs []string
}

type CreateProviderMappingDraftInput struct {
	ConnectionID               string
	EnvironmentID              string
	ApplicationID              string
	ProviderProductIdentifier  string
	ProviderPackageIdentifier  string
	ProviderOfferingIdentifier string
	ExpectedStoreProductID     string
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
	return provider == ProviderRevenueCat || !hasPackage
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
	return connection
}

func validateProviderScopes(reader Reader, projectID string, environmentIDs, applicationIDs []string) error {
	if len(environmentIDs) == 0 || len(applicationIDs) == 0 {
		return ErrScopeMismatch
	}
	for _, environmentID := range environmentIDs {
		environment, ok := reader.Environment(environmentID)
		if !ok || environment.ProjectID != projectID {
			return ErrScopeMismatch
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
		environmentIDs := uniqueStrings(input.EnvironmentIDs)
		applicationIDs := uniqueStrings(input.ApplicationIDs)
		if err := validateProviderScopes(tx, projectID, environmentIDs, applicationIDs); err != nil {
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
		if err := validateProviderScopes(tx, project.ID, environmentIDs, applicationIDs); err != nil {
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
		s.audit(tx, actor, project.OrganizationID, project.ID, "", "provider_connection.revoked", "provider_connection", connection.ID, map[string]string{})
		result, organizationID = providerScopes(tx, connection), project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_connection.revoked", actor, organizationID, result.ProjectID, result.ID)
	}
	return result, err
}

func (s *Service) SetActiveProviderAssignment(ctx context.Context, actor Actor, environmentID, applicationID, connectionID string, acknowledgeProductionUse bool) (ActiveProviderAssignment, error) {
	ctx, span := s.operation(ctx, "provider_assignment.set", actor,
		attribute.String("mosaic.environment.id", environmentID),
		attribute.String("mosaic.application.id", applicationID),
		attribute.String("mosaic.provider_connection.id", connectionID),
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
		connection, ok := tx.ProviderConnection(connectionID)
		if !ok || connection.ProjectID != project.ID {
			return ErrScopeMismatch
		}
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
		productionUseOutsideProduction := environment.Mode != EnvironmentProduction && connection.Mode == ProviderProduction
		if productionUseOutsideProduction && !acknowledgeProductionUse {
			return ErrProductionConnectionAcknowledgementRequired
		}
		now := s.now()
		result = ActiveProviderAssignment{
			ProjectID:                           project.ID,
			EnvironmentID:                       environment.ID,
			ApplicationID:                       application.ID,
			Platform:                            application.Platform,
			ConnectionID:                        connection.ID,
			ProductionConnectionUseAcknowledged: productionUseOutsideProduction && acknowledgeProductionUse,
			CreatedByActorID:                    actor.ID,
			CreatedAt:                           now,
			UpdatedAt:                           now,
		}
		if previous, ok := tx.ActiveProviderAssignment(environment.ID, application.ID); ok {
			result.CreatedAt = previous.CreatedAt
		}
		tx.SaveActiveProviderAssignment(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "provider_assignment.set", "provider_assignment", environment.ID+":"+application.ID, map[string]string{
			"applicationId": application.ID,
			"connectionId":  connection.ID,
			"platform":      string(application.Platform),
		})
		organizationID = project.OrganizationID
		return nil
	})
	if err == nil {
		logMutation(ctx, "provider_assignment.set", actor, organizationID, result.ProjectID, result.ConnectionID)
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
		connection, ok := tx.ProviderConnection(input.ConnectionID)
		if !ok || connection.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		if connection.Status == ProviderConnectionRevoked {
			return ErrConnectionRevoked
		}
		if !validProviderMappingTarget(connection.Provider, input) {
			return ErrMappingTargetInvalid
		}
		environment, ok := tx.Environment(input.EnvironmentID)
		if !ok || environment.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		application, ok := tx.Application(input.ApplicationID)
		if !ok || application.ProjectID != project.ID {
			return ErrScopeMismatch
		}
		if !scopeContains(tx.ProviderConnectionEnvironmentIDs(connection.ID), environment.ID) ||
			!scopeContains(tx.ProviderConnectionApplicationIDs(connection.ID), application.ID) {
			return ErrScopeMismatch
		}
		for _, mapping := range tx.ProviderMappings(product.ID) {
			if mapping.ConnectionID == connection.ID && mapping.EnvironmentID == environment.ID &&
				mapping.ApplicationID == application.ID && mapping.Status != ProviderMappingArchived {
				return &ConflictError{Resource: "provider_mapping", Field: "scope"}
			}
		}
		now := s.now()
		result = ProviderProductMapping{
			ID:                         tx.NextID("mapping"),
			ProjectID:                  project.ID,
			ProductID:                  product.ID,
			ConnectionID:               connection.ID,
			EnvironmentID:              environment.ID,
			ApplicationID:              application.ID,
			Platform:                   application.Platform,
			Provider:                   connection.Provider,
			ProviderProductIdentifier:  input.ProviderProductIdentifier,
			ProviderPackageIdentifier:  input.ProviderPackageIdentifier,
			ProviderOfferingIdentifier: input.ProviderOfferingIdentifier,
			ExpectedStoreProductID:     input.ExpectedStoreProductID,
			Status:                     ProviderMappingDraft,
			Availability:               ProviderAvailabilityUnknown,
			SyncState:                  ProviderSyncNeverSynced,
			CreatedAt:                  now,
			UpdatedAt:                  now,
		}
		tx.SaveProviderMapping(result)
		s.audit(tx, actor, project.OrganizationID, project.ID, environment.ID, "provider_mapping.draft_created", "provider_mapping", result.ID, map[string]string{
			"applicationId": application.ID,
			"connectionId":  connection.ID,
			"provider":      string(connection.Provider),
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

func readinessIssue(code ProviderErrorCode, resourceType, resourceID, recoveryAction string) ProviderReadinessIssue {
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
			result.State = ProviderReadinessDraft
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "product", product.ID, "connectProduct"))
		}
		if product.MetadataSource != MetadataProvider {
			if result.State == "" {
				result.State = ProviderReadinessMockOnly
			}
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMetadataStale, "product", product.ID, "syncProviderMetadata"))
		}
		if len(reader.ProductGrants(product.ID)) == 0 {
			if result.State == "" {
				result.State = ProviderReadinessDraft
			}
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorProductUnavailable, "product", product.ID, "grantEntitlement"))
		}
		assignment, ok := reader.ActiveProviderAssignment(environment.ID, application.ID)
		if !ok {
			if result.State == "" {
				result.State = ProviderReadinessMockOnly
			}
			result.Blockers = append(result.Blockers, readinessIssue(ProviderErrorMappingMissing, "provider_assignment", environment.ID+":"+application.ID, "assignProviderConnection"))
			return nil
		}
		result.ConnectionID = assignment.ConnectionID
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
			metadataStale := mapping.SyncState != ProviderSyncCurrent || mapping.CurrentSnapshotID == ""
			if !metadataStale {
				snapshot, ok := reader.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
				metadataStale = !ok || snapshot.ExpiresAt != nil && !snapshot.ExpiresAt.After(result.EvaluatedAt)
			}
			if metadataStale {
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
				result.State = ProviderReadinessConnected
			} else {
				result.State = ProviderReadinessAttentionRequired
			}
		}
		return nil
	})
	return result, err
}
