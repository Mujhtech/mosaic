package hostedpublishing

import (
	"bytes"
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/attribute"
)

type PublishCommand struct {
	ProjectID               string `json:"projectId"`
	EnvironmentID           string `json:"environmentId"`
	DraftID                 string `json:"draftId"`
	ExpectedRevision        int64  `json:"expectedRevision"`
	AcknowledgeMockProducts bool   `json:"acknowledgeMockProducts"`
	IdempotencyKey          string `json:"-"`
}

type deliveryEnvelope struct {
	ConfigurationDeliveryVersion string          `json:"configurationDeliveryVersion"`
	Release                      deliveryRelease `json:"release"`
}

type deliveryRelease struct {
	ID                string                `json:"id"`
	Number            int64                 `json:"number"`
	Environment       deliveryEnvironment   `json:"environment"`
	PublishedAt       string                `json:"publishedAt"`
	ContentDigest     string                `json:"contentDigest"`
	Compatibility     deliveryCompatibility `json:"compatibility"`
	Placements        []deliveryPlacement   `json:"placements"`
	PaywallVersions   []deliveryVersion     `json:"paywallVersions"`
	ProductReferences []deliveryProduct     `json:"productReferences"`
	AssetReferences   []deliveryAsset       `json:"assetReferences"`
}

type deliveryEnvironment struct {
	ID  string `json:"id"`
	Key string `json:"key"`
}

type deliveryCompatibility struct {
	PaywallProtocols []deliveryProtocolCompatibility `json:"paywallProtocols"`
	Acceptance       string                          `json:"acceptance"`
}

type deliveryProtocolCompatibility struct {
	Version              string                       `json:"version"`
	RequiredCapabilities []deliveryRequiredCapability `json:"requiredCapabilities"`
}

type deliveryRequiredCapability struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type deliveryPlacement struct {
	Key              string `json:"key"`
	PaywallVersionID string `json:"paywallVersionId"`
}

type deliveryVersion struct {
	ID                  string                 `json:"id"`
	PaywallID           string                 `json:"paywallId"`
	ProtocolVersion     string                 `json:"protocolVersion"`
	DocumentDigest      string                 `json:"documentDigest"`
	Document            json.RawMessage        `json:"document"`
	ProductReferenceIDs []string               `json:"productReferenceIds"`
	AssetBindings       []deliveryAssetBinding `json:"assetBindings"`
}

type deliveryAssetBinding struct {
	DocumentAssetID  string `json:"documentAssetId"`
	AssetReferenceID string `json:"assetReferenceId"`
}

type deliveryProduct struct {
	ID                  string `json:"id"`
	Type                string `json:"type"`
	FallbackDisplayName string `json:"fallbackDisplayName"`
}

type deliveryAsset struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	MediaType     string `json:"mediaType"`
	ByteLength    int64  `json:"byteLength"`
	ContentDigest string `json:"contentDigest"`
	URL           string `json:"url"`
}

func (s *Service) Publish(ctx context.Context, actor Actor, command PublishCommand) (PublishResult, error) {
	ctx, span := s.operation(ctx, "paywall.publish", actor,
		attribute.String("mosaic.project.id", command.ProjectID),
		attribute.String("mosaic.environment.id", command.EnvironmentID),
		attribute.String("mosaic.draft.id", command.DraftID))
	defer span.End()
	if command.IdempotencyKey == "" {
		return PublishResult{}, ErrPreconditionRequired
	}
	keyHash := digestString(command.IdempotencyKey)
	requestHash := requestDigest(struct {
		DraftID          string
		ExpectedRevision int64
		AcknowledgeMock  bool
	}{command.DraftID, command.ExpectedRevision, command.AcknowledgeMockProducts})
	var result PublishResult
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, environment, err := environmentAccess(tx, actor, command.ProjectID, command.EnvironmentID, true)
		if err != nil {
			return err
		}
		tx.LockScope("release:" + environment.ID)
		if replay, ok := tx.PublicationRequest(environment.ID, "publish", keyHash); ok {
			if replay.RequestHash != requestHash {
				return ErrIdempotencyConflict
			}
			release, ok := tx.Release(replay.ResultReleaseID)
			if !ok {
				return ErrNotFound
			}
			result = PublishResult{Release: release, Warnings: []string{}}
			return nil
		}
		draft, ok := tx.Draft(command.DraftID)
		if !ok || draft.ProjectID != project.ID || draft.EnvironmentID != environment.ID {
			return ErrNotFound
		}
		if draft.Status != "active" {
			return ErrArchived
		}
		if draft.CurrentRevision != command.ExpectedRevision {
			return &ConflictError{Revision: draft.CurrentRevision, ETag: DraftETag(draft.ID, draft.CurrentRevision), UpdatedAt: draft.UpdatedAt, ActorID: draft.UpdatedByActorID}
		}
		revision, ok := tx.DraftRevision(draft.ID, command.ExpectedRevision)
		if !ok {
			return ErrNotFound
		}
		analysis := s.analyzeDocument(revision.Document)
		if err := validationError(analysis.Summary); err != nil {
			return err
		}
		if analysis.DocumentID != draft.PaywallID {
			return &ValidationError{Errors: []string{"document_paywall_id_mismatch"}}
		}
		versionAssets, assets, err := s.resolveDocumentAssets(tx, project.ID, analysis.RemoteAssets)
		if err != nil {
			return err
		}
		warnings := make([]string, 0)
		products := make(map[string]Product, len(analysis.ProductIDs))
		for _, productID := range analysis.ProductIDs {
			product, ok := tx.Product(productID)
			if !ok || product.ProjectID != project.ID || product.Status == "archived" {
				return ErrProductInvalid
			}
			products[product.ID] = product
		}
		tx.LockScope("paywall-version:" + draft.PaywallID + ":" + environment.ID)
		versionNumber := int64(1)
		if latest, ok := tx.LatestPaywallVersion(draft.PaywallID, environment.ID); ok {
			versionNumber = latest.VersionNumber + 1
		}
		now := s.now()
		version := PaywallVersion{
			ID: tx.NextID("version"), ProjectID: project.ID, PaywallID: draft.PaywallID,
			EnvironmentID: environment.ID, VersionNumber: versionNumber, SourceDraftID: draft.ID,
			SourceRevision: revision.Revision, ProtocolVersion: analysis.ProtocolVersion,
			Document: analysis.Canonical, DocumentHash: analysis.Hash, ValidationMetadata: analysis.Summary,
			CreatedByActorID: actor.ID, CreatedAt: now, ProductIDs: analysis.ProductIDs,
			Assets: versionAssets,
		}
		tx.SavePaywallVersion(version)
		for _, productID := range version.ProductIDs {
			tx.SaveVersionProduct(version.ID, project.ID, productID)
		}
		for index := range version.Assets {
			version.Assets[index].VersionID = version.ID
			tx.SaveVersionAsset(version.Assets[index])
		}
		bindings := tx.PlacementBindings(environment.ID)
		if len(bindings) == 0 {
			return ErrPlacementUnpublished
		}
		resolved := make([]ReleasePlacement, 0, len(bindings))
		versions := make(map[string]PaywallVersion)
		publishedDraft := false
		for _, binding := range bindings {
			placement, ok := tx.Placement(binding.PlacementID)
			if !ok || placement.ProjectID != project.ID || placement.Status == "archived" {
				return ErrPlacementUnpublished
			}
			paywall, ok := tx.Paywall(binding.PaywallID)
			if !ok || paywall.ProjectID != project.ID || paywall.Status == "archived" {
				return ErrPlacementUnpublished
			}
			selected := version
			if binding.PaywallID != version.PaywallID {
				var found bool
				selected, found = tx.LatestPaywallVersion(binding.PaywallID, environment.ID)
				if !found {
					return ErrPlacementUnpublished
				}
			} else {
				publishedDraft = true
			}
			selected.ProductIDs = tx.VersionProducts(selected.ID)
			selected.Assets = tx.VersionAssets(selected.ID)
			versions[selected.ID] = selected
			resolved = append(resolved, ReleasePlacement{ProjectID: project.ID, EnvironmentID: environment.ID, PlacementID: placement.ID, PlacementKey: placement.Key, PaywallVersionID: selected.ID})
			for _, productID := range selected.ProductIDs {
				if _, exists := products[productID]; !exists {
					product, ok := tx.Product(productID)
					if !ok || product.ProjectID != project.ID || product.Status == "archived" {
						return ErrProductInvalid
					}
					products[product.ID] = product
				}
			}
			for _, binding := range selected.Assets {
				asset, ok := tx.Asset(binding.AssetID)
				if !ok || asset.ProjectID != project.ID || asset.Status != "ready" {
					return ErrAssetNotReady
				}
				assets[asset.ID] = asset
			}
		}
		if !publishedDraft {
			return ErrPlacementUnpublished
		}
		for _, product := range products {
			if product.MetadataSource != "mock" {
				continue
			}
			if !command.AcknowledgeMockProducts {
				return &ValidationError{Errors: []string{"mock_product_acknowledgement_required"}}
			}
			warnings = append(warnings, "product_mock_metadata:"+product.ID)
		}
		providerIssues := providerPublicationIssues(tx, environment, products, s.now())
		if environment.Mode == "production" && len(providerIssues) != 0 {
			return &ProviderReadinessError{Blockers: providerIssues}
		}
		for _, issue := range providerIssues {
			warnings = append(warnings, providerPublicationWarning(issue))
		}
		state, ok := tx.ReleaseState(environment.ID)
		if !ok || state.ProjectID != project.ID {
			return ErrNotFound
		}
		releaseID := tx.NextID("release")
		releaseNumber := state.LastReleaseNumber + 1
		sortPlacements(resolved)
		payload, contentHash, err := buildDeliveryPayload(releaseID, releaseNumber, environment, now, resolved, versions, products, assets)
		if err != nil {
			return err
		}
		release := Release{
			ID: releaseID, ProjectID: project.ID, EnvironmentID: environment.ID, ReleaseNumber: releaseNumber,
			DeliveryContractVersion: DeliveryVersion, Payload: payload, ContentHash: contentHash,
			SourceReleaseID: state.CurrentReleaseID, PublishedByActorID: actor.ID, PublishedAt: now,
		}
		tx.SaveRelease(release)
		for index := range resolved {
			resolved[index].ReleaseID = release.ID
			tx.SaveReleasePlacement(resolved[index])
		}
		productIDs := make([]string, 0, len(products))
		for productID := range products {
			productIDs = append(productIDs, productID)
		}
		sort.Strings(productIDs)
		for _, productID := range productIDs {
			tx.SaveReleaseProduct(release.ID, environment.ID, project.ID, productID)
		}
		assetIDs := make([]string, 0, len(assets))
		for assetID := range assets {
			assetIDs = append(assetIDs, assetID)
		}
		sort.Strings(assetIDs)
		for _, assetID := range assetIDs {
			tx.SaveReleaseAsset(release.ID, environment.ID, project.ID, assetID)
		}
		if shouldBuildCommerceConfigurations(productIDs, providerIssues) {
			for _, application := range tx.Applications(project.ID) {
				commerceConfiguration, err := s.buildCommerceConfiguration(
					tx, release, environment, application, productIDs, now,
				)
				if err != nil {
					return err
				}
				tx.SaveCommerceConfiguration(commerceConfiguration)
			}
		}
		state.CurrentReleaseID, state.LastReleaseNumber, state.UpdatedAt = release.ID, releaseNumber, now
		tx.SaveReleaseState(state)
		draft.Status, draft.UpdatedByActorID, draft.UpdatedAt = "published", actor.ID, now
		tx.SaveDraft(draft)
		tx.SavePublicationRequest(PublicationRequest{EnvironmentID: environment.ID, Operation: "publish", IdempotencyKeyHash: keyHash, RequestHash: requestHash, ResultReleaseID: release.ID, CreatedAt: now})
		s.audit(tx, actor, project, environment.ID, "configuration.published", "configuration_release", release.ID, map[string]string{"releaseNumber": formatInt(releaseNumber), "paywallVersionId": version.ID})
		result = PublishResult{Release: release, Warnings: uniqueStrings(warnings)}
		return nil
	})
	if err != nil {
		span.RecordError(err)
		zerolog.Ctx(ctx).Warn().Err(err).Str("environment_id", command.EnvironmentID).Msg("configuration publication failed")
	} else {
		zerolog.Ctx(ctx).Info().Str("environment_id", command.EnvironmentID).Str("release_id", result.Release.ID).Int64("release_number", result.Release.ReleaseNumber).Msg("configuration published")
	}
	return result, err
}

func providerPublicationWarning(issue ProviderPublicationIssue) string {
	return "provider_readiness:" + issue.Code + ":" + issue.ProductID + ":" + issue.ApplicationID
}

func publicationIssue(code string, product Product, application Application, resourceType, resourceID, recoveryAction string) ProviderPublicationIssue {
	return ProviderPublicationIssue{
		Code: code, ProductID: product.ID, ApplicationID: application.ID,
		ResourceType: resourceType, ResourceID: resourceID, RecoveryAction: recoveryAction,
	}
}

func providerEntitlementCoverageIssue(reader Reader, connectionID, environmentID, applicationID, productID string, grantCount int) string {
	mappings := reader.ProviderEntitlementMappingsForCommerce(
		connectionID, environmentID, applicationID, []string{productID},
	)
	entitlements := make(map[string]struct{}, len(mappings))
	providerIdentifiers := make(map[string]string, len(mappings))
	for _, mapping := range mappings {
		if _, duplicate := entitlements[mapping.EntitlementID]; duplicate {
			return "mappingAmbiguous"
		}
		entitlements[mapping.EntitlementID] = struct{}{}
		if existing, duplicate := providerIdentifiers[mapping.ProviderEntitlementIdentifier]; duplicate &&
			existing != mapping.EntitlementID {
			return "mappingAmbiguous"
		}
		providerIdentifiers[mapping.ProviderEntitlementIdentifier] = mapping.EntitlementID
	}
	if len(entitlements) != grantCount {
		return "mappingMissing"
	}
	return ""
}

func providerPublicationIssues(reader Reader, environment Environment, products map[string]Product, now time.Time) []ProviderPublicationIssue {
	applications := reader.Applications(environment.ProjectID)
	if len(applications) == 0 {
		issues := make([]ProviderPublicationIssue, 0, len(products))
		for _, product := range products {
			issues = append(issues, publicationIssue(
				"scopeMismatch", product, Application{}, "project", environment.ProjectID, "createApplication",
			))
		}
		return issues
	}
	productIDs := make([]string, 0, len(products))
	for productID := range products {
		productIDs = append(productIDs, productID)
	}
	sort.Strings(productIDs)
	issues := make([]ProviderPublicationIssue, 0)
	for _, productID := range productIDs {
		product := products[productID]
		for _, application := range applications {
			if product.Status != "connected" {
				issues = append(issues, publicationIssue("productUnavailable", product, application, "product", product.ID, "connectProduct"))
			}
			if product.MetadataSource != "provider" {
				issues = append(issues, publicationIssue("metadataStale", product, application, "product", product.ID, "syncProviderMetadata"))
			}
			grantCount := reader.ProductGrantCount(product.ID)
			if grantCount == 0 {
				issues = append(issues, publicationIssue("productUnavailable", product, application, "product", product.ID, "grantEntitlement"))
			}
			assignment, ok := reader.ProviderAssignment(environment.ID, application.ID)
			if !ok {
				issues = append(issues, publicationIssue("providerUnavailable", product, application, "provider_assignment", environment.ID+":"+application.ID, "assignProviderConnection"))
				continue
			}
			connection, ok := reader.ProviderConnection(assignment.ConnectionID)
			if !ok || connection.ProjectID != environment.ProjectID {
				issues = append(issues, publicationIssue("scopeMismatch", product, application, "provider_connection", assignment.ConnectionID, "assignProviderConnection"))
				continue
			}
			if connection.Status == "revoked" {
				issues = append(issues, publicationIssue("connectionRevoked", product, application, "provider_connection", connection.ID, "reconnectProvider"))
				continue
			}
			if connection.Status != "active" || connection.HealthStatus != "healthy" {
				issues = append(issues, publicationIssue("providerUnavailable", product, application, "provider_connection", connection.ID, "testOrReconnectProvider"))
			}
			if !reader.ProviderConnectionEnvironmentScoped(connection.ID, environment.ID) ||
				!reader.ProviderConnectionApplicationScoped(connection.ID, application.ID) {
				issues = append(issues, publicationIssue("scopeMismatch", product, application, "provider_connection", connection.ID, "updateConnectionScopes"))
			}
			if environment.Mode == "production" && connection.Mode != "production" {
				issues = append(issues, publicationIssue("modeMismatch", product, application, "provider_connection", connection.ID, "assignProductionConnection"))
			}
			if grantCount > 0 {
				if code := providerEntitlementCoverageIssue(
					reader, connection.ID, environment.ID, application.ID, product.ID, grantCount,
				); code != "" {
					recoveryAction := "importProviderEntitlementMapping"
					if code == "mappingAmbiguous" {
						recoveryAction = "replaceProviderEntitlementMapping"
					}
					issues = append(issues, publicationIssue(
						code, product, application, "product", product.ID, recoveryAction,
					))
				}
			}
			mappings := reader.ProviderMappingsForReadiness(product.ID, connection.ID, environment.ID, application.ID, application.Platform)
			switch len(mappings) {
			case 0:
				issues = append(issues, publicationIssue("mappingMissing", product, application, "product", product.ID, "createOrSyncProviderMapping"))
			case 1:
				mapping := mappings[0]
				if mapping.Availability != "available" {
					issues = append(issues, publicationIssue("productUnavailable", product, application, "provider_mapping", mapping.ID, "reviewProviderProduct"))
				}
				if mapping.SyncState != "current" || mapping.CurrentSnapshotID == "" {
					issues = append(issues, publicationIssue("metadataStale", product, application, "provider_mapping", mapping.ID, "syncProviderMetadata"))
					continue
				}
				snapshot, ok := reader.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
				if !ok {
					issues = append(issues, publicationIssue("metadataStale", product, application, "provider_mapping", mapping.ID, "syncProviderMetadata"))
				} else if snapshot.ExpiresAt != nil && !snapshot.ExpiresAt.After(now) {
					issues = append(issues, publicationIssue("productUnavailable", product, application, "provider_mapping", mapping.ID, "syncProviderMetadata"))
				} else if snapshot.StaleAt.IsZero() || !snapshot.StaleAt.After(now) {
					issues = append(issues, publicationIssue("metadataStale", product, application, "provider_mapping", mapping.ID, "syncProviderMetadata"))
				}
			default:
				issues = append(issues, publicationIssue("mappingAmbiguous", product, application, "product", product.ID, "archiveDuplicateMappings"))
			}
		}
	}
	return issues
}

func (s *Service) resolveDocumentAssets(reader Reader, projectID string, references []documentAssetReference) ([]VersionAsset, map[string]Asset, error) {
	bindings := make([]VersionAsset, 0, len(references))
	assets := make(map[string]Asset, len(references))
	if len(references) == 0 {
		return bindings, assets, nil
	}
	if s.objects == nil || s.assetBase == "" {
		return nil, nil, ErrAssetStorageUnavailable
	}
	prefix := s.assetBase + "/"
	for _, reference := range references {
		if !strings.HasPrefix(reference.URL, prefix) {
			return nil, nil, &ValidationError{Errors: []string{"remote_asset_must_use_hosted_asset"}}
		}
		parts := strings.SplitN(strings.TrimPrefix(reference.URL, prefix), "/", 2)
		if len(parts) != 2 || !strings.HasPrefix(parts[1], "sha256:") {
			return nil, nil, &ValidationError{Errors: []string{"hosted_asset_url_invalid"}}
		}
		asset, ok := reader.Asset(parts[0])
		if !ok || asset.ProjectID != projectID || asset.Status != "ready" || asset.Kind != reference.Kind || asset.ContentDigest != parts[1] || asset.URL != reference.URL {
			return nil, nil, ErrAssetNotReady
		}
		bindings = append(bindings, VersionAsset{ProjectID: projectID, AssetID: asset.ID, DocumentAssetID: reference.DocumentAssetID})
		assets[asset.ID] = asset
	}
	sort.Slice(bindings, func(i, j int) bool { return bindings[i].DocumentAssetID < bindings[j].DocumentAssetID })
	return bindings, assets, nil
}

func buildDeliveryPayload(releaseID string, releaseNumber int64, environment Environment, publishedAt time.Time, placements []ReleasePlacement, versions map[string]PaywallVersion, products map[string]Product, assets map[string]Asset) (json.RawMessage, string, error) {
	deliveryPlacements := make([]deliveryPlacement, 0, len(placements))
	for _, placement := range placements {
		deliveryPlacements = append(deliveryPlacements, deliveryPlacement{Key: placement.PlacementKey, PaywallVersionID: placement.PaywallVersionID})
	}
	versionValues := make([]PaywallVersion, 0, len(versions))
	for _, version := range versions {
		versionValues = append(versionValues, version)
	}
	sort.Slice(versionValues, func(i, j int) bool { return versionValues[i].ID < versionValues[j].ID })
	deliveryVersions := make([]deliveryVersion, 0, len(versionValues))
	requiredCapabilities := make(map[string]deliveryRequiredCapability)
	for _, version := range versionValues {
		capabilities, err := documentRequiredCapabilities(version.Document)
		if err != nil {
			return nil, "", err
		}
		for _, capability := range capabilities {
			requiredCapabilities[capability.Name+"@"+capability.Version] = capability
		}
		assetBindings := make([]deliveryAssetBinding, 0, len(version.Assets))
		for _, binding := range version.Assets {
			assetBindings = append(assetBindings, deliveryAssetBinding{DocumentAssetID: binding.DocumentAssetID, AssetReferenceID: binding.AssetID})
		}
		sort.Slice(assetBindings, func(i, j int) bool { return assetBindings[i].DocumentAssetID < assetBindings[j].DocumentAssetID })
		deliveryVersions = append(deliveryVersions, deliveryVersion{
			ID: version.ID, PaywallID: version.PaywallID, ProtocolVersion: version.ProtocolVersion,
			DocumentDigest: canonicalRawDigest(version.Document), Document: version.Document,
			ProductReferenceIDs: uniqueStrings(version.ProductIDs), AssetBindings: assetBindings,
		})
	}
	capabilityValues := make([]deliveryRequiredCapability, 0, len(requiredCapabilities))
	for _, capability := range requiredCapabilities {
		capabilityValues = append(capabilityValues, capability)
	}
	sort.Slice(capabilityValues, func(i, j int) bool {
		if capabilityValues[i].Name == capabilityValues[j].Name {
			return capabilityValues[i].Version < capabilityValues[j].Version
		}
		return capabilityValues[i].Name < capabilityValues[j].Name
	})
	productValues := make([]Product, 0, len(products))
	for _, product := range products {
		productValues = append(productValues, product)
	}
	sort.Slice(productValues, func(i, j int) bool { return productValues[i].ID < productValues[j].ID })
	deliveryProducts := make([]deliveryProduct, 0, len(productValues))
	for _, product := range productValues {
		deliveryProducts = append(deliveryProducts, deliveryProduct{ID: product.ID, Type: product.Type, FallbackDisplayName: product.InternalName})
	}
	assetValues := make([]Asset, 0, len(assets))
	for _, asset := range assets {
		assetValues = append(assetValues, asset)
	}
	sort.Slice(assetValues, func(i, j int) bool { return assetValues[i].ID < assetValues[j].ID })
	deliveryAssets := make([]deliveryAsset, 0, len(assetValues))
	for _, asset := range assetValues {
		deliveryAssets = append(deliveryAssets, deliveryAsset{ID: asset.ID, Kind: asset.Kind, MediaType: asset.MediaType, ByteLength: asset.ByteLength, ContentDigest: asset.ContentDigest, URL: asset.URL})
	}
	envelope := deliveryEnvelope{ConfigurationDeliveryVersion: DeliveryVersion, Release: deliveryRelease{
		ID: releaseID, Number: releaseNumber, Environment: deliveryEnvironment{ID: environment.ID, Key: environment.Key},
		PublishedAt: publishedAt.UTC().Format(time.RFC3339Nano), Compatibility: deliveryCompatibility{
			PaywallProtocols: []deliveryProtocolCompatibility{{Version: ProtocolVersion, RequiredCapabilities: capabilityValues}},
			Acceptance:       "atomic",
		},
		Placements: deliveryPlacements, PaywallVersions: deliveryVersions, ProductReferences: deliveryProducts, AssetReferences: deliveryAssets,
	}}
	material, err := json.Marshal(envelope.Release)
	if err != nil {
		return nil, "", err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(material, &canonicalMaterial); err != nil {
		return nil, "", err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return nil, "", err
	}
	envelope.Release.ContentDigest = "sha256:" + digestString(string(canonicalBytes))
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, "", err
	}
	return payload, digestString(string(payload)), nil
}

func documentRequiredCapabilities(document json.RawMessage) ([]deliveryRequiredCapability, error) {
	var value struct {
		Compatibility struct {
			RequiredCapabilities []deliveryRequiredCapability `json:"requiredCapabilities"`
		} `json:"compatibility"`
	}
	if err := json.Unmarshal(document, &value); err != nil {
		return nil, err
	}
	return value.Compatibility.RequiredCapabilities, nil
}

func canonicalRawDigest(value json.RawMessage) string {
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return "sha256:" + digestString(string(value))
	}
	canonical, err := canonicalJSON(decoded)
	if err != nil {
		return "sha256:" + digestString(string(value))
	}
	return "sha256:" + digestString(string(canonical))
}

func canonicalJSON(value any) ([]byte, error) {
	buffer := new(bytes.Buffer)
	encoder := json.NewEncoder(buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

func (s *Service) ListReleases(ctx context.Context, actor Actor, projectID, environmentID string) (List[Release], error) {
	result := List[Release]{Items: []Release{}}
	err := s.repository.View(ctx, func(reader Reader) error {
		if _, _, err := environmentAccess(reader, actor, projectID, environmentID, false); err != nil {
			return err
		}
		result.Items = reader.Releases(environmentID)
		return nil
	})
	return result, err
}

func shouldBuildCommerceConfigurations(productIDs []string, providerIssues []ProviderPublicationIssue) bool {
	if len(productIDs) == 0 {
		return false
	}
	for _, issue := range providerIssues {
		if issue.Code != "metadataStale" {
			return false
		}
	}
	return true
}

func (s *Service) Rollback(ctx context.Context, actor Actor, projectID, environmentID, targetReleaseID, idempotencyKey string) (Release, error) {
	ctx, span := s.operation(ctx, "release.rollback", actor, attribute.String("mosaic.environment.id", environmentID), attribute.String("mosaic.release.id", targetReleaseID))
	defer span.End()
	if idempotencyKey == "" {
		return Release{}, ErrPreconditionRequired
	}
	keyHash := digestString(idempotencyKey)
	requestHash := requestDigest(struct{ Target string }{targetReleaseID})
	var result Release
	err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, environment, err := environmentAccess(tx, actor, projectID, environmentID, true)
		if err != nil {
			return err
		}
		tx.LockScope("release:" + environment.ID)
		if replay, ok := tx.PublicationRequest(environment.ID, "rollback", keyHash); ok {
			if replay.RequestHash != requestHash {
				return ErrIdempotencyConflict
			}
			release, ok := tx.Release(replay.ResultReleaseID)
			if !ok {
				return ErrNotFound
			}
			result = release
			return nil
		}
		target, ok := tx.Release(targetReleaseID)
		if !ok || target.EnvironmentID != environment.ID {
			return ErrNotFound
		}
		state, ok := tx.ReleaseState(environment.ID)
		if !ok || state.CurrentReleaseID == "" {
			return ErrNoCurrentRelease
		}
		placements := tx.ReleasePlacements(target.ID)
		productIDs := tx.ReleaseProducts(target.ID)
		assetIDs := tx.ReleaseAssets(target.ID)
		now := s.now()
		releaseID, releaseNumber := tx.NextID("release"), state.LastReleaseNumber+1
		payload, contentHash, err := cloneDeliveryPayload(target.Payload, releaseID, releaseNumber, now)
		if err != nil {
			return err
		}
		result = Release{ID: releaseID, ProjectID: project.ID, EnvironmentID: environment.ID, ReleaseNumber: releaseNumber, DeliveryContractVersion: DeliveryVersion, Payload: payload, ContentHash: contentHash, SourceReleaseID: state.CurrentReleaseID, RollbackSourceReleaseID: target.ID, PublishedByActorID: actor.ID, PublishedAt: now}
		tx.SaveRelease(result)
		for index := range placements {
			placements[index].ReleaseID = result.ID
			tx.SaveReleasePlacement(placements[index])
		}
		for _, productID := range productIDs {
			tx.SaveReleaseProduct(result.ID, environment.ID, project.ID, productID)
		}
		for _, assetID := range assetIDs {
			tx.SaveReleaseAsset(result.ID, environment.ID, project.ID, assetID)
		}
		for _, application := range tx.Applications(project.ID) {
			targetCommerce, ok := tx.CommerceConfiguration(target.ID, application.ID)
			if !ok {
				continue
			}
			commerceConfiguration, err := s.cloneCommerceConfiguration(targetCommerce, result, now)
			if err != nil {
				return err
			}
			tx.SaveCommerceConfiguration(commerceConfiguration)
		}
		state.CurrentReleaseID, state.LastReleaseNumber, state.UpdatedAt = result.ID, releaseNumber, now
		tx.SaveReleaseState(state)
		tx.SavePublicationRequest(PublicationRequest{EnvironmentID: environment.ID, Operation: "rollback", IdempotencyKeyHash: keyHash, RequestHash: requestHash, ResultReleaseID: result.ID, CreatedAt: now})
		s.audit(tx, actor, project, environment.ID, "configuration.rolled_back", "configuration_release", result.ID, map[string]string{"rollbackSourceReleaseId": target.ID, "releaseNumber": formatInt(releaseNumber)})
		return nil
	})
	if err != nil {
		span.RecordError(err)
	}
	return result, err
}

// cloneDeliveryPayload copies the target Release's immutable content snapshot.
// Only the identity and publication metadata of the newly-created rollback
// Release differ; mutable Product and Asset rows are never consulted.
func cloneDeliveryPayload(target json.RawMessage, releaseID string, releaseNumber int64, publishedAt time.Time) (json.RawMessage, string, error) {
	var envelope deliveryEnvelope
	if err := json.Unmarshal(target, &envelope); err != nil {
		return nil, "", err
	}
	if envelope.ConfigurationDeliveryVersion != DeliveryVersion {
		return nil, "", ErrUnsupportedCapability
	}
	envelope.Release.ID = releaseID
	envelope.Release.Number = releaseNumber
	envelope.Release.PublishedAt = publishedAt.UTC().Format(time.RFC3339Nano)
	envelope.Release.ContentDigest = ""
	material, err := json.Marshal(envelope.Release)
	if err != nil {
		return nil, "", err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(material, &canonicalMaterial); err != nil {
		return nil, "", err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return nil, "", err
	}
	envelope.Release.ContentDigest = "sha256:" + digestString(string(canonicalBytes))
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, "", err
	}
	return payload, digestString(string(payload)), nil
}
