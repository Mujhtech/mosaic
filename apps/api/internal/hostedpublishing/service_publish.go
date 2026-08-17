package hostedpublishing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/attribute"

	"github.com/Mujhtech/mosaic/apps/api/internal/placementdecision"
	"github.com/Mujhtech/mosaic/apps/api/internal/providerreadiness"
)

type PublishCommand struct {
	ProjectID               string `json:"projectId"`
	EnvironmentID           string `json:"environmentId"`
	DraftID                 string `json:"draftId"`
	ExpectedRevision        int64  `json:"expectedRevision"`
	AcknowledgeMockProducts bool   `json:"acknowledgeMockProducts"`
	IdempotencyKey          string `json:"-"`
}

// deliveryEnvelope is the Configuration Delivery v3 wire envelope — the one
// Delivery contract (ADR-0028). Its release member carries Placement Decision
// v1 Rule Sets, Paywall Protocol 0.4 documents, exact Product and Entitlement
// references, and Experiment Assignment v1 definitions.
type deliveryEnvelope struct {
	ConfigurationDeliveryVersion string          `json:"configurationDeliveryVersion"`
	Release                      deliveryRelease `json:"release"`
}

type deliveryRelease struct {
	ID                    string                 `json:"id"`
	Number                int64                  `json:"number"`
	ProjectID             string                 `json:"projectId"`
	Environment           deliveryEnvironment    `json:"environment"`
	PublishedAt           string                 `json:"publishedAt"`
	ContentDigest         string                 `json:"contentDigest"`
	Compatibility         deliveryCompatibility  `json:"compatibility"`
	PlacementDecisions    []json.RawMessage      `json:"placementDecisions"`
	PaywallVersions       []deliveryVersion      `json:"paywallVersions"`
	ProductReferences     []deliveryProduct      `json:"productReferences"`
	EntitlementReferences []EntitlementReference `json:"entitlementReferences"`
	AssetReferences       []deliveryAsset        `json:"assetReferences"`
	ExperimentAssignments []json.RawMessage      `json:"experimentAssignments"`
}

type deliveryEnvironment struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Mode string `json:"mode"`
}

type deliveryCompatibility struct {
	PlacementDecisionContracts    []deliveryDecisionCompatibility   `json:"placementDecisionContracts"`
	PaywallProtocols              []deliveryProtocolCompatibility   `json:"paywallProtocols"`
	Acceptance                    string                            `json:"acceptance"`
	ExperimentAssignmentContracts []deliveryExperimentCompatibility `json:"experimentAssignmentContracts"`
}

type deliveryDecisionCompatibility struct {
	Version             string   `json:"version"`
	RequiredFeatures    []string `json:"requiredFeatures"`
	BucketingAlgorithms []string `json:"bucketingAlgorithms"`
}

// deliveryExperimentCompatibility declares the exact union of Experiment
// Assignment requirements a Release carries. A Release published without
// Experiments still declares the contract entry (the schema pins exactly one)
// with empty unions.
type deliveryExperimentCompatibility struct {
	Version             string   `json:"version"`
	RequiredFeatures    []string `json:"requiredFeatures"`
	BucketingAlgorithms []string `json:"bucketingAlgorithms"`
	SchedulePolicies    []string `json:"schedulePolicies"`
}

type deliveryProtocolCompatibility struct {
	Version              string                       `json:"version"`
	RequiredCapabilities []deliveryRequiredCapability `json:"requiredCapabilities"`
}

type deliveryRequiredCapability struct {
	Name    string `json:"name"`
	Version string `json:"version"`
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
	Readiness           string `json:"readiness"`
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
		decisionVersions := tx.PublishedDecisionVersions(environment.ID)
		entitlements := make(map[string]EntitlementReference)
		for _, decisionVersion := range decisionVersions {
			decision, _, _, err := placementdecision.Canonicalize(decisionVersion.Document)
			if err != nil || decision.ProjectID != project.ID || decision.EnvironmentID != environment.ID || decision.PlacementID != decisionVersion.PlacementID {
				return &ValidationError{Errors: []string{"placement_decision_invalid"}}
			}
			paywallIDs, productIDs, entitlementKeys := decisionReferences(decision)
			for _, paywallVersionID := range paywallIDs {
				if _, exists := versions[paywallVersionID]; exists {
					continue
				}
				selected, ok := tx.PaywallVersion(paywallVersionID)
				if !ok || selected.ProjectID != project.ID || selected.EnvironmentID != environment.ID {
					return &ValidationError{Errors: []string{"placement_decision_paywall_invalid"}}
				}
				selected.ProductIDs, selected.Assets = tx.VersionProducts(selected.ID), tx.VersionAssets(selected.ID)
				versions[selected.ID] = selected
				productIDs = append(productIDs, selected.ProductIDs...)
				for _, binding := range selected.Assets {
					asset, ok := tx.Asset(binding.AssetID)
					if !ok || asset.ProjectID != project.ID || asset.Status != "ready" {
						return ErrAssetNotReady
					}
					assets[asset.ID] = asset
				}
			}
			for _, productID := range uniqueStrings(productIDs) {
				if _, exists := products[productID]; exists {
					continue
				}
				product, ok := tx.Product(productID)
				if !ok || product.ProjectID != project.ID || product.Status == "archived" {
					return ErrProductInvalid
				}
				products[product.ID] = product
			}
			for _, key := range uniqueStrings(entitlementKeys) {
				entitlement, ok := tx.EntitlementByKey(project.ID, key)
				if !ok {
					return &ValidationError{Errors: []string{"placement_decision_entitlement_invalid"}}
				}
				entitlements[key] = entitlement
			}
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
		blockers := make([]ProviderPublicationIssue, 0, len(providerIssues))
		for _, issue := range providerIssues {
			if providerPublicationIssueBlocks(issue) {
				blockers = append(blockers, issue)
			}
		}
		if environment.Mode == "production" && len(blockers) != 0 {
			return &ProviderReadinessError{Blockers: blockers}
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
		payload, contentHash, err := buildDeliveryPayload(releaseID, releaseNumber, project.ID, environment, now, resolved, decisionVersions, versions, products, entitlements, assets)
		if err != nil {
			return err
		}
		release := Release{
			ID: releaseID, ProjectID: project.ID, EnvironmentID: environment.ID, ReleaseNumber: releaseNumber,
			DeliveryContractVersion: DeliveryVersion, Payload: payload, ContentHash: contentHash,
			SourceReleaseID: state.CurrentReleaseID, PublishedByActorID: actor.ID, PublishedAt: now,
		}
		tx.SaveRelease(release)
		for _, decisionVersion := range decisionVersions {
			tx.SaveReleaseRuleSetVersion(release.ID, environment.ID, project.ID, decisionVersion.ID, decisionVersion.PlacementID)
		}
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
			material := newCommercePublishMaterial(products)
			for _, application := range tx.Applications(project.ID) {
				commerceConfiguration, err := s.buildCommerceConfiguration(
					tx, release, environment, application, productIDs, now, material,
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
		var readinessError *ProviderReadinessError
		if errors.As(err, &readinessError) {
			s.auditProviderPublishRejection(ctx, actor, command.ProjectID, command.EnvironmentID, readinessError.Blockers)
		}
	} else {
		zerolog.Ctx(ctx).Info().Str("environment_id", command.EnvironmentID).Str("release_id", result.Release.ID).Int64("release_number", result.Release.ReleaseNumber).Msg("configuration published")
	}
	return result, err
}

func (s *Service) auditProviderPublishRejection(ctx context.Context, actor Actor, projectID, environmentID string, blockers []ProviderPublicationIssue) {
	codes := make([]string, 0, len(blockers))
	for _, blocker := range blockers {
		codes = append(codes, blocker.Code+":"+blocker.ProductID+":"+blocker.ApplicationID)
	}
	sort.Strings(codes)
	if err := s.repository.Transact(ctx, func(tx Transaction) error {
		project, environment, err := environmentAccess(tx, actor, projectID, environmentID, true)
		if err != nil {
			return err
		}
		s.audit(tx, actor, project, environment.ID, "configuration.publish_rejected",
			"environment", environment.ID, map[string]string{"providerBlockers": strings.Join(codes, ",")})
		return nil
	}); err != nil {
		zerolog.Ctx(ctx).Warn().Err(err).Str("environment_id", environmentID).Msg("provider publish rejection audit failed")
	}
}

func providerPublicationIssueBlocks(issue ProviderPublicationIssue) bool {
	return issue.Code != "observationMissing" && issue.Code != "observationStale"
}

func providerPublicationWarning(issue ProviderPublicationIssue) string {
	return "provider_readiness:" + issue.Code + ":" + issue.ProductID + ":" + issue.ApplicationID
}

func publicationIssue(code string, product Product, application Application, resourceType, resourceID string, recoveryAction providerreadiness.Action) ProviderPublicationIssue {
	if !providerreadiness.IsKnown(recoveryAction) {
		panic("unknown provider publication recovery action: " + recoveryAction)
	}
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

// importedNativeMetadataIssue grades the provider-verified metadata behind an
// App Store Connect mapping that is serving a native store activation. It
// mirrors the server-connected grading so the same staleness means the same
// thing whichever activation delivers the Product.
func importedNativeMetadataIssue(reader Reader, mapping CommerceProductMapping, now time.Time) string {
	if mapping.CurrentSnapshotID == "" {
		return "metadataStale"
	}
	snapshot, ok := reader.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
	switch {
	case !ok:
		return "metadataStale"
	case snapshot.ExpiresAt != nil && !snapshot.ExpiresAt.After(now):
		return "productUnavailable"
	case snapshot.StaleAt.IsZero() || !snapshot.StaleAt.After(now):
		return "metadataStale"
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
	// Everything that varies by only one axis of the product × application
	// grid is fetched once per value of that axis. This readiness sweep runs
	// inside the transaction holding the environment's publish lock, where a
	// per-pair fetch pattern turns P products and A applications into P×A
	// sequential round-trips that serialize every publish behind them.
	grantCounts := make(map[string]int, len(productIDs))
	for _, productID := range productIDs {
		grantCounts[productID] = reader.ProductGrantCount(productID)
	}
	type applicationMaterial struct {
		assignment        ProviderAssignment
		hasAssignment     bool
		platformMismatch  bool
		connection        ProviderConnection
		hasConnection     bool
		environmentScoped bool
		applicationScoped bool
		nativeByProduct   map[string][]CommerceProductMapping
	}
	materials := make([]applicationMaterial, len(applications))
	for index, application := range applications {
		material := applicationMaterial{}
		material.assignment, material.hasAssignment = reader.ProviderAssignment(environment.ID, application.ID)
		if material.hasAssignment {
			if material.assignment.ActivationKind == "native_store" {
				material.platformMismatch = (material.assignment.Provider == "app_store" && application.Platform != "ios") ||
					(material.assignment.Provider == "google_play" && application.Platform != "android")
				if !material.platformMismatch {
					// One batched read per application; the query orders by
					// (product_id, id), so grouping by Product preserves the
					// exact order a single-product read would return.
					material.nativeByProduct = make(map[string][]CommerceProductMapping)
					for _, mapping := range reader.ProviderMappingsForNativeCommerce(
						material.assignment.Provider, environment.ID, application.ID, application.Platform, productIDs,
					) {
						material.nativeByProduct[mapping.ProductID] = append(material.nativeByProduct[mapping.ProductID], mapping)
					}
				}
			} else {
				material.connection, material.hasConnection = reader.ProviderConnection(material.assignment.ConnectionID)
				if material.hasConnection && material.connection.ProjectID == environment.ProjectID && material.connection.Status != "revoked" {
					material.environmentScoped = reader.ProviderConnectionEnvironmentScoped(material.connection.ID, environment.ID)
					material.applicationScoped = reader.ProviderConnectionApplicationScoped(material.connection.ID, application.ID)
				}
			}
		}
		materials[index] = material
	}
	issues := make([]ProviderPublicationIssue, 0)
	for _, productID := range productIDs {
		product := products[productID]
		for applicationIndex, application := range applications {
			material := materials[applicationIndex]
			if product.Status != "connected" {
				issues = append(issues, publicationIssue("productUnavailable", product, application, "product", product.ID, "connectProduct"))
			}
			grantCount := grantCounts[product.ID]
			if grantCount == 0 {
				issues = append(issues, publicationIssue("productUnavailable", product, application, "product", product.ID, "grantEntitlement"))
			}
			if !material.hasAssignment {
				issues = append(issues, publicationIssue("providerUnavailable", product, application, "provider_assignment", environment.ID+":"+application.ID, "assignProviderConnection"))
				continue
			}
			assignment := material.assignment
			if assignment.ActivationKind == "native_store" {
				if material.platformMismatch {
					issues = append(issues, publicationIssue("scopeMismatch", product, application, "provider_assignment", environment.ID+":"+application.ID, "selectCompatibleProvider"))
					continue
				}
				mappings := nativeCommerceMappings(assignment.Provider, material.nativeByProduct[product.ID])
				switch len(mappings) {
				case 0:
					issues = append(issues, publicationIssue("mappingMissing", product, application, "product", product.ID, "createNativeProviderMapping"))
				case 1:
					mapping := mappings[0]
					if assignment.Provider == "google_play" && product.Type == "subscription" && mapping.ProviderBasePlanIdentifier == "" {
						issues = append(issues, publicationIssue("basePlanMissing", product, application, "provider_mapping", mapping.ID, "addGoogleBasePlan"))
					}
					if mapping.Provider == importedNativeProvider {
						// An imported mapping cannot carry an SDK observation:
						// observations are refused for connection-backed
						// mappings. Its provider-verified metadata snapshot is
						// the equivalent evidence, so report staleness there
						// instead of demanding a test that cannot be run.
						if code := importedNativeMetadataIssue(reader, mapping, now); code != "" {
							issues = append(issues, publicationIssue(
								code, product, application, "provider_mapping", mapping.ID, "syncProviderMetadata",
							))
						}
						continue
					}
					observation, observed := reader.LatestProviderMappingObservation(mapping.ID)
					if !observed {
						issues = append(issues, publicationIssue("observationMissing", product, application, "provider_mapping", mapping.ID, "runNativeProviderTest"))
					} else if observation.Result != "available" {
						issues = append(issues, publicationIssue("productUnavailable", product, application, "provider_mapping", mapping.ID, "rerunNativeProviderTest"))
					} else if observation.ExpiresAt != nil && !observation.ExpiresAt.After(now) {
						issues = append(issues, publicationIssue("observationStale", product, application, "provider_mapping", mapping.ID, "rerunNativeProviderTest"))
					}
				default:
					issues = append(issues, publicationIssue("mappingAmbiguous", product, application, "product", product.ID, "archiveDuplicateMappings"))
				}
				continue
			}
			if product.MetadataSource != "provider" {
				issues = append(issues, publicationIssue("metadataStale", product, application, "product", product.ID, "syncProviderMetadata"))
			}
			connection := material.connection
			if !material.hasConnection || connection.ProjectID != environment.ProjectID {
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
			if !material.environmentScoped || !material.applicationScoped {
				issues = append(issues, publicationIssue("scopeMismatch", product, application, "provider_connection", connection.ID, "updateConnectionScopes"))
			}
			if environment.Mode == "production" && connection.Mode != "production" {
				issues = append(issues, publicationIssue("modeMismatch", product, application, "provider_connection", connection.ID, "assignProductionConnection"))
			}
			if grantCount > 0 {
				if code := providerEntitlementCoverageIssue(
					reader, connection.ID, environment.ID, application.ID, product.ID, grantCount,
				); code != "" {
					recoveryAction := providerreadiness.ActionImportProviderEntitlementMapping
					if code == "mappingAmbiguous" {
						recoveryAction = providerreadiness.ActionReplaceProviderEntitlementMapping
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

// buildDeliveryPayload renders the Configuration Delivery v3 envelope — the
// Release's single stored representation.
//
// v3 carries Placement material as Placement Decision v1 Rule Sets rather than
// bare Placement-to-Paywall bindings, so a bound Placement without a published
// Rule Set is carried as a synthesized unconditional Rule Set whose default
// outcome is the bound Paywall Version. The synthesis is lossless — a binding
// means "always this Paywall" and that is exactly what the unconditional Rule
// Set evaluates to — and it is the forward direction: a Variant is never
// turned into an unconditional binding.
func buildDeliveryPayload(releaseID string, releaseNumber int64, projectID string, environment Environment, publishedAt time.Time, placements []ReleasePlacement, decisions []PublishedDecisionVersion, versions map[string]PaywallVersion, products map[string]Product, entitlements map[string]EntitlementReference, assets map[string]Asset) (json.RawMessage, string, error) {
	type placementDecision struct {
		placementKey string
		placementID  string
		document     json.RawMessage
	}
	decisionFeatures := map[string]struct{}{}
	decisionAlgorithms := map[string]struct{}{}
	collectCompatibility := func(document placementdecision.Document) {
		compatibility := placementdecision.DeriveCompatibility(document)
		for _, feature := range compatibility.RequiredFeatures {
			decisionFeatures[feature] = struct{}{}
		}
		for _, algorithm := range compatibility.RequiredBucketingAlgorithms {
			decisionAlgorithms[algorithm] = struct{}{}
		}
	}
	decided := map[string]bool{}
	placementDecisions := make([]placementDecision, 0, len(decisions)+len(placements))
	for _, version := range decisions {
		document, canonical, _, err := placementdecision.Canonicalize(version.Document)
		if err != nil {
			return nil, "", err
		}
		decided[document.PlacementID] = true
		placementDecisions = append(placementDecisions, placementDecision{placementKey: document.PlacementKey, placementID: document.PlacementID, document: canonical})
		collectCompatibility(document)
	}
	for _, placement := range placements {
		if decided[placement.PlacementID] {
			continue
		}
		document := placementdecision.Document{
			RuleSetID: "binding:" + placement.PlacementID, Version: 1,
			ProjectID: projectID, EnvironmentID: environment.ID, EnvironmentKey: environment.Key,
			PlacementID: placement.PlacementID, PlacementKey: placement.PlacementKey,
			Enabled: true, AssignmentPolicy: "installation",
			AttributeDefinitions: []placementdecision.ContractAttributeDefinition{},
			DefaultOutcome:       placementdecision.Outcome{Type: "paywall", PaywallVersionID: placement.PaywallVersionID},
			Fallbacks:            []placementdecision.Fallback{},
			Rules:                []placementdecision.Rule{},
			QAOverrides:          []placementdecision.PublishedOverride{},
		}
		document.Compatibility = placementdecision.DeriveCompatibility(document)
		placementDecisions = append(placementDecisions, placementDecision{placementKey: placement.PlacementKey, placementID: placement.PlacementID, document: placementdecision.MarshalDocument(document)})
		collectCompatibility(document)
	}
	sort.Slice(placementDecisions, func(i, j int) bool {
		if placementDecisions[i].placementKey == placementDecisions[j].placementKey {
			return placementDecisions[i].placementID < placementDecisions[j].placementID
		}
		return placementDecisions[i].placementKey < placementDecisions[j].placementKey
	})
	decisionDocuments := make([]json.RawMessage, 0, len(placementDecisions))
	for _, decision := range placementDecisions {
		decisionDocuments = append(decisionDocuments, decision.document)
	}
	versionValues := make([]PaywallVersion, 0, len(versions))
	for _, version := range versions {
		versionValues = append(versionValues, version)
	}
	sort.Slice(versionValues, func(i, j int) bool { return versionValues[i].ID < versionValues[j].ID })
	deliveryVersions := make([]deliveryVersion, 0, len(versionValues))
	requiredCapabilities := map[string]deliveryRequiredCapability{}
	for _, version := range versionValues {
		capabilities, err := documentRequiredCapabilities(version.Document)
		if err != nil {
			return nil, "", err
		}
		for _, capability := range capabilities {
			requiredCapabilities[capability.Name+"@"+capability.Version] = capability
		}
		protocolVersion := version.ProtocolVersion
		if protocolVersion == "" {
			protocolVersion = ProtocolVersion
		}
		assetBindings := make([]deliveryAssetBinding, 0, len(version.Assets))
		for _, binding := range version.Assets {
			assetBindings = append(assetBindings, deliveryAssetBinding{DocumentAssetID: binding.DocumentAssetID, AssetReferenceID: binding.AssetID})
		}
		sort.Slice(assetBindings, func(i, j int) bool { return assetBindings[i].DocumentAssetID < assetBindings[j].DocumentAssetID })
		deliveryVersions = append(deliveryVersions, deliveryVersion{
			ID: version.ID, PaywallID: version.PaywallID, ProtocolVersion: protocolVersion,
			DocumentDigest: canonicalRawDigest(version.Document), Document: version.Document,
			ProductReferenceIDs: uniqueStrings(version.ProductIDs), AssetBindings: assetBindings,
		})
	}
	productValues := make([]Product, 0, len(products))
	for _, product := range products {
		productValues = append(productValues, product)
	}
	sort.Slice(productValues, func(i, j int) bool { return productValues[i].ID < productValues[j].ID })
	deliveryProducts := make([]deliveryProduct, 0, len(productValues))
	for _, product := range productValues {
		readiness := "not_ready"
		if product.ReadinessReady {
			readiness = "ready"
		}
		deliveryProducts = append(deliveryProducts, deliveryProduct{ID: product.ID, Type: product.Type, FallbackDisplayName: product.InternalName, Readiness: readiness})
	}
	entitlementValues := make([]EntitlementReference, 0, len(entitlements))
	for _, value := range entitlements {
		entitlementValues = append(entitlementValues, value)
	}
	sort.Slice(entitlementValues, func(i, j int) bool { return entitlementValues[i].Key < entitlementValues[j].Key })
	assetValues := make([]Asset, 0, len(assets))
	for _, asset := range assets {
		assetValues = append(assetValues, asset)
	}
	sort.Slice(assetValues, func(i, j int) bool { return assetValues[i].ID < assetValues[j].ID })
	deliveryAssets := make([]deliveryAsset, 0, len(assetValues))
	for _, asset := range assetValues {
		deliveryAssets = append(deliveryAssets, deliveryAsset{ID: asset.ID, Kind: asset.Kind, MediaType: asset.MediaType, ByteLength: asset.ByteLength, ContentDigest: asset.ContentDigest, URL: asset.URL})
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
	envelope := deliveryEnvelope{ConfigurationDeliveryVersion: DeliveryVersion, Release: deliveryRelease{
		ID: releaseID, Number: releaseNumber, ProjectID: projectID,
		Environment: deliveryEnvironment{ID: environment.ID, Key: environment.Key, Mode: environment.Mode},
		// The millisecond-precision UTC form every Mosaic contract timestamp
		// uses: exactly three fractional digits and a literal Z. The iOS and
		// Android readers require exactly this shape; RFC3339Nano trims
		// trailing zeros and would emit a variable-width fraction they reject.
		PublishedAt: contractTimestamp(publishedAt), Compatibility: deliveryCompatibility{
			PlacementDecisionContracts: []deliveryDecisionCompatibility{{
				Version:             placementdecision.ContractVersion,
				RequiredFeatures:    sortedSet(decisionFeatures),
				BucketingAlgorithms: sortedSet(decisionAlgorithms),
			}},
			PaywallProtocols: []deliveryProtocolCompatibility{{Version: ProtocolVersion, RequiredCapabilities: capabilityValues}},
			Acceptance:       "atomic",
			// A publish carries no Experiment material; Experiment publication
			// re-emits the Release with its Assignments and their exact unions.
			ExperimentAssignmentContracts: []deliveryExperimentCompatibility{{
				Version: "1", RequiredFeatures: []string{}, BucketingAlgorithms: []string{}, SchedulePolicies: []string{},
			}},
		},
		PlacementDecisions: decisionDocuments, PaywallVersions: deliveryVersions,
		ProductReferences: deliveryProducts, EntitlementReferences: entitlementValues,
		AssetReferences: deliveryAssets, ExperimentAssignments: []json.RawMessage{},
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

// contractTimestamp renders the millisecond-precision UTC form every Mosaic
// contract timestamp uses. The SDK readers pin the shape exactly — three
// fractional digits, literal Z — so a nanosecond-precision or trailing-zero-
// trimmed rendering is a rejection, not a cosmetic difference.
func contractTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}

func sortedSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func decisionReferences(document placementdecision.Document) (paywallVersionIDs, productIDs, entitlementKeys []string) {
	visitOutcome := func(outcome placementdecision.Outcome) {
		if outcome.Type == "paywall" {
			paywallVersionIDs = append(paywallVersionIDs, outcome.PaywallVersionID)
		}
	}
	visitOutcome(document.DefaultOutcome)
	for _, fallback := range document.Fallbacks {
		visitOutcome(fallback.Outcome)
	}
	for _, override := range document.QAOverrides {
		visitOutcome(override.Outcome)
	}
	var visitCondition func(placementdecision.Condition)
	visitCondition = func(condition placementdecision.Condition) {
		if condition.Type == "condition" {
			switch condition.Source.Kind {
			case "product_availability", "product_readiness":
				productIDs = append(productIDs, condition.Source.ProductID)
			case "entitlement_state":
				entitlementKeys = append(entitlementKeys, condition.Source.Key)
			}
			return
		}
		if condition.Child != nil {
			visitCondition(*condition.Child)
		}
		for _, child := range condition.Children {
			visitCondition(child)
		}
	}
	for _, rule := range document.Rules {
		visitOutcome(rule.Outcome)
		visitCondition(rule.Condition)
	}
	return uniqueStrings(paywallVersionIDs), uniqueStrings(productIDs), uniqueStrings(entitlementKeys)
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
		if issue.Code != "metadataStale" && providerPublicationIssueBlocks(issue) {
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
		result = Release{ID: releaseID, ProjectID: project.ID, EnvironmentID: environment.ID, ReleaseNumber: releaseNumber, DeliveryContractVersion: target.DeliveryContractVersion, Payload: payload, ContentHash: contentHash, SourceReleaseID: state.CurrentReleaseID, RollbackSourceReleaseID: target.ID, PublishedByActorID: actor.ID, PublishedAt: now}
		tx.SaveRelease(result)
		for _, decisionVersion := range tx.ReleaseDecisionVersions(target.ID) {
			tx.SaveReleaseRuleSetVersion(result.ID, environment.ID, project.ID, decisionVersion.ID, decisionVersion.PlacementID)
		}
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
	envelope.Release.PublishedAt = contractTimestamp(publishedAt)
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
