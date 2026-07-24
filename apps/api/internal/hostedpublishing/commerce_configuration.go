package hostedpublishing

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/Mujhtech/mosaic/apps/api/internal/nativecommerce"
)

const (
	commerceProviderSchemaID        = "urn:mosaic:protocol:schema:commerce-provider:v1:contract"
	commerceConfigurationSchemaID   = "urn:mosaic:protocol:schema:commerce-configuration:v1:configuration"
	commerceProviderV2SchemaID      = "urn:mosaic:protocol:schema:commerce-provider:v2:contract"
	commerceConfigurationV2SchemaID = "urn:mosaic:protocol:schema:commerce-configuration:v2:configuration"
)

type CommerceConfigurationValidator struct {
	schemas map[string]*jsonschema.Schema
}

func CompileCommerceConfigurationValidator(providerSchema, configurationSchema io.Reader, v2Schemas ...io.Reader) (*CommerceConfigurationValidator, error) {
	decode := func(name string, reader io.Reader) (any, error) {
		var document any
		decoder := json.NewDecoder(reader)
		if err := decoder.Decode(&document); err != nil {
			return nil, fmt.Errorf("decode canonical %s schema: %w", name, err)
		}
		return document, nil
	}
	providerDocument, err := decode("Commerce Provider v1", providerSchema)
	if err != nil {
		return nil, err
	}
	configurationDocument, err := decode("Commerce Configuration v1", configurationSchema)
	if err != nil {
		return nil, err
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(compileECMARegexp)
	compiler.AssertFormat()
	if err := compiler.AddResource(commerceProviderSchemaID, providerDocument); err != nil {
		return nil, fmt.Errorf("register canonical Commerce Provider v1 schema: %w", err)
	}
	if err := compiler.AddResource(commerceConfigurationSchemaID, configurationDocument); err != nil {
		return nil, fmt.Errorf("register canonical Commerce Configuration v1 schema: %w", err)
	}
	schema, err := compiler.Compile(commerceConfigurationSchemaID)
	if err != nil {
		return nil, fmt.Errorf("compile canonical Commerce Configuration v1 schema: %w", err)
	}
	schemas := map[string]*jsonschema.Schema{"1": schema}
	if len(v2Schemas) != 0 {
		if len(v2Schemas) != 2 {
			return nil, errors.New("Commerce Configuration v2 requires provider and configuration schemas")
		}
		providerV2Document, err := decode("Commerce Provider v2", v2Schemas[0])
		if err != nil {
			return nil, err
		}
		configurationV2Document, err := decode("Commerce Configuration v2", v2Schemas[1])
		if err != nil {
			return nil, err
		}
		if err := compiler.AddResource(commerceProviderV2SchemaID, providerV2Document); err != nil {
			return nil, fmt.Errorf("register canonical Commerce Provider v2 schema: %w", err)
		}
		if err := compiler.AddResource(commerceConfigurationV2SchemaID, configurationV2Document); err != nil {
			return nil, fmt.Errorf("register canonical Commerce Configuration v2 schema: %w", err)
		}
		v2Schema, err := compiler.Compile(commerceConfigurationV2SchemaID)
		if err != nil {
			return nil, fmt.Errorf("compile canonical Commerce Configuration v2 schema: %w", err)
		}
		schemas["2"] = v2Schema
	}
	return &CommerceConfigurationValidator{schemas: schemas}, nil
}

func (validator *CommerceConfigurationValidator) Validate(payload json.RawMessage) error {
	if validator == nil {
		return errors.New("Commerce Configuration validator unavailable")
	}
	var document any
	if err := json.Unmarshal(payload, &document); err != nil {
		return ErrProviderReadiness
	}
	var envelope struct {
		Version string `json:"commerceConfigurationVersion"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return ErrProviderReadiness
	}
	schema := validator.schemas[envelope.Version]
	if schema == nil {
		return ErrProviderReadiness
	}
	if err := schema.Validate(document); err != nil {
		return ErrProviderReadiness
	}
	return nil
}

type commerceConfigurationEnvelope struct {
	Version       string                        `json:"commerceConfigurationVersion"`
	Configuration commerceConfigurationDocument `json:"configuration"`
}

type commerceConfigurationDocument struct {
	ID                   string                         `json:"id"`
	EnvironmentID        string                         `json:"environmentId"`
	ApplicationID        string                         `json:"applicationId"`
	StorePlatform        string                         `json:"storePlatform"`
	ConfigurationRelease commerceConfigurationRelease   `json:"configurationRelease"`
	ContentDigest        string                         `json:"contentDigest"`
	ActiveProvider       commerceActiveProvider         `json:"activeProvider"`
	ProductMappings      []commerceProductMapping       `json:"productMappings"`
	EntitlementMappings  []commerceEntitlementMapping   `json:"entitlementMappings"`
	Freshness            commerceConfigurationFreshness `json:"freshness"`
	Diagnostics          []map[string]any               `json:"diagnostics"`
}

type commerceConfigurationRelease struct {
	ID            string `json:"id"`
	ContentDigest string `json:"contentDigest"`
}

type commerceProviderIdentity struct {
	ID             string `json:"id"`
	DisplayName    string `json:"displayName"`
	AdapterVersion string `json:"adapterVersion"`
}

type commerceProviderActivation struct {
	Source               string `json:"source"`
	ProviderConnectionID string `json:"providerConnectionId,omitempty"`
}

type commerceProviderCapability struct {
	Name       string `json:"name"`
	Support    string `json:"support"`
	ReasonCode string `json:"reasonCode,omitempty"`
}

type commerceActiveProvider struct {
	Identity     commerceProviderIdentity     `json:"identity"`
	Activation   commerceProviderActivation   `json:"activation"`
	Capabilities []commerceProviderCapability `json:"capabilities"`
	RecoveryMode string                       `json:"recoveryMode,omitempty"`
}

type commerceAdapterMapping struct {
	Kind               string `json:"kind"`
	OfferingIdentifier string `json:"offeringIdentifier,omitempty"`
	PackageIdentifier  string `json:"packageIdentifier,omitempty"`
	BasePlanID         string `json:"basePlanId,omitempty"`
	OfferID            string `json:"offerId,omitempty"`
}

type commerceProductMapping struct {
	MosaicProductID          string                 `json:"mosaicProductId"`
	MappingID                string                 `json:"mappingId"`
	ProductType              string                 `json:"productType,omitempty"`
	EntitlementKeys          []string               `json:"entitlementKeys,omitempty"`
	ProviderProductReference string                 `json:"providerProductReference"`
	AdapterMapping           commerceAdapterMapping `json:"adapterMapping"`
}

type commerceEntitlementMapping struct {
	MosaicEntitlementKey          string `json:"mosaicEntitlementKey"`
	ProviderEntitlementIdentifier string `json:"providerEntitlementIdentifier"`
}

type commerceConfigurationFreshness struct {
	Source             string                     `json:"source"`
	Status             string                     `json:"status"`
	ProviderObservedAt string                     `json:"providerObservedAt,omitempty"`
	SynchronizedAt     string                     `json:"synchronizedAt,omitempty"`
	StaleAt            string                     `json:"staleAt,omitempty"`
	ExpiresAt          string                     `json:"expiresAt,omitempty"`
	ConfiguredAt       string                     `json:"configuredAt,omitempty"`
	Observation        *commerceNativeObservation `json:"observation,omitempty"`
}

type commerceNativeObservation struct {
	Environment string `json:"environment"`
	ObservedAt  string `json:"observedAt"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
}

func configurationReleaseDigest(payload json.RawMessage) (string, error) {
	var envelope struct {
		Release struct {
			ContentDigest string `json:"contentDigest"`
		} `json:"release"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.Release.ContentDigest == "" {
		return "", ErrProviderReadiness
	}
	return envelope.Release.ContentDigest, nil
}

func providerIdentity(provider string) (commerceProviderIdentity, []commerceProviderCapability, error) {
	if provider != "revenuecat" {
		return commerceProviderIdentity{}, nil, ErrProviderReadiness
	}
	capabilities := []commerceProviderCapability{
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
	return commerceProviderIdentity{ID: "revenuecat", DisplayName: "RevenueCat", AdapterVersion: "1.0.0"}, capabilities, nil
}

func nativeProviderIdentity(provider string) (commerceProviderIdentity, []commerceProviderCapability, string, error) {
	profile, ok := nativecommerce.ProfileFor(provider)
	if !ok {
		return commerceProviderIdentity{}, nil, "", ErrProviderReadiness
	}
	capabilities := make([]commerceProviderCapability, 0, len(profile.Capabilities))
	for _, capability := range profile.Capabilities {
		capabilities = append(capabilities, commerceProviderCapability{
			Name: capability.Name, Support: capability.Support, ReasonCode: capability.ReasonCode,
		})
	}
	return commerceProviderIdentity{
		ID: profile.Provider, DisplayName: profile.DisplayName, AdapterVersion: profile.AdapterVersion,
	}, capabilities, profile.RecoveryMode, nil
}

func minTime(current time.Time, candidate time.Time) time.Time {
	if current.IsZero() || candidate.Before(current) {
		return candidate
	}
	return current
}

func minTimePointer(current *time.Time, candidate *time.Time) *time.Time {
	if candidate == nil {
		return current
	}
	if current == nil || candidate.Before(*current) {
		value := *candidate
		return &value
	}
	return current
}

func (s *Service) buildCommerceConfiguration(tx Transaction, release Release, environment Environment, application Application, productIDs []string, now time.Time) (CommerceConfigurationSnapshot, error) {
	assignment, ok := tx.ProviderAssignment(environment.ID, application.ID)
	if !ok {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	if assignment.ActivationKind == "native_store" {
		return s.buildNativeCommerceConfiguration(tx, release, environment, application, productIDs, now, assignment)
	}
	connection, ok := tx.ProviderConnection(assignment.ConnectionID)
	if !ok || connection.ProjectID != environment.ProjectID || connection.Status != "active" || connection.HealthStatus != "healthy" {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	identity, capabilities, err := providerIdentity(connection.Provider)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	expectedProducts := append([]string(nil), productIDs...)
	sort.Strings(expectedProducts)
	mappings := tx.ProviderMappingsForCommerce(
		connection.ID, environment.ID, application.ID, application.Platform, expectedProducts,
	)
	if len(mappings) != len(expectedProducts) {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	productMappings := make([]commerceProductMapping, 0, len(mappings))
	var observedAt, synchronizedAt, staleAt time.Time
	var expiresAt *time.Time
	for index, mapping := range mappings {
		if mapping.ProductID != expectedProducts[index] || mapping.ExpectedStoreProductID == "" || mapping.CurrentSnapshotID == "" {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		snapshot, ok := tx.ProviderMetadataSnapshot(mapping.CurrentSnapshotID)
		if !ok {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		adapter := commerceAdapterMapping{Kind: "directProduct"}
		if mapping.ProviderPackageIdentifier != "" || mapping.ProviderOfferingIdentifier != "" {
			if mapping.ProviderPackageIdentifier == "" || mapping.ProviderOfferingIdentifier == "" {
				return CommerceConfigurationSnapshot{}, ErrProviderReadiness
			}
			adapter = commerceAdapterMapping{
				Kind: "revenueCatPackage", OfferingIdentifier: mapping.ProviderOfferingIdentifier,
				PackageIdentifier: mapping.ProviderPackageIdentifier,
			}
		}
		productMappings = append(productMappings, commerceProductMapping{
			MosaicProductID: mapping.ProductID, MappingID: mapping.ID,
			ProviderProductReference: mapping.ExpectedStoreProductID, AdapterMapping: adapter,
		})
		observedAt = minTime(observedAt, snapshot.ObservedAt)
		synchronizedAt = minTime(synchronizedAt, snapshot.SyncedAt)
		staleAt = minTime(staleAt, snapshot.StaleAt)
		expiresAt = minTimePointer(expiresAt, snapshot.ExpiresAt)
	}
	for _, productID := range expectedProducts {
		grantCount := tx.ProductGrantCount(productID)
		if grantCount == 0 || providerEntitlementCoverageIssue(
			tx, connection.ID, environment.ID, application.ID, productID, grantCount,
		) != "" {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
	}
	entitlementValues := tx.ProviderEntitlementMappingsForCommerce(
		connection.ID, environment.ID, application.ID, expectedProducts,
	)
	if len(entitlementValues) == 0 {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	entitlementMappings := make([]commerceEntitlementMapping, 0, len(entitlementValues))
	for _, mapping := range entitlementValues {
		entitlementMappings = append(entitlementMappings, commerceEntitlementMapping{
			MosaicEntitlementKey:          mapping.EntitlementKey,
			ProviderEntitlementIdentifier: mapping.ProviderEntitlementIdentifier,
		})
	}
	releaseDigest, err := configurationReleaseDigest(release.Payload)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	status := "fresh"
	if !now.Before(staleAt) {
		status = "stale"
	}
	freshness := commerceConfigurationFreshness{
		Source: "providerSynchronization", Status: status,
		ProviderObservedAt: observedAt.UTC().Format(time.RFC3339Nano),
		SynchronizedAt:     synchronizedAt.UTC().Format(time.RFC3339Nano),
		StaleAt:            staleAt.UTC().Format(time.RFC3339Nano),
	}
	if expiresAt != nil {
		freshness.ExpiresAt = expiresAt.UTC().Format(time.RFC3339Nano)
	}
	document := commerceConfigurationDocument{
		ID:            "commerce_" + release.ID + "_" + application.ID,
		EnvironmentID: environment.ID, ApplicationID: application.ID, StorePlatform: application.Platform,
		ConfigurationRelease: commerceConfigurationRelease{ID: release.ID, ContentDigest: releaseDigest},
		ActiveProvider: commerceActiveProvider{
			Identity:     identity,
			Activation:   commerceProviderActivation{Source: "providerConnection", ProviderConnectionID: connection.ID},
			Capabilities: capabilities,
		},
		ProductMappings: productMappings, EntitlementMappings: entitlementMappings,
		Freshness: freshness, Diagnostics: []map[string]any{},
	}
	material, err := json.Marshal(document)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(material, &canonicalMaterial); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	digest := sha256.Sum256(canonicalBytes)
	document.ContentDigest = fmt.Sprintf("sha256:%x", digest)
	payload, err := json.Marshal(commerceConfigurationEnvelope{Version: "1", Configuration: document})
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	if err := s.commerceValidator.Validate(payload); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	return CommerceConfigurationSnapshot{
		ID: document.ID, ProjectID: environment.ProjectID, EnvironmentID: environment.ID,
		ApplicationID: application.ID, StorePlatform: application.Platform,
		ConfigurationReleaseID: release.ID, ConfigurationReleaseDigest: releaseDigest,
		ContentDigest: document.ContentDigest, Payload: payload, CreatedAt: now,
	}, nil
}

func nativeObservationEnvironment(storeContext string) string {
	switch storeContext {
	case "storekitConfiguration", "appleSandbox", "googlePlayTest":
		return "test"
	case "production":
		return "production"
	default:
		return "unknown"
	}
}

func (s *Service) buildNativeCommerceConfiguration(tx Transaction, release Release, environment Environment, application Application, productIDs []string, now time.Time, assignment ProviderAssignment) (CommerceConfigurationSnapshot, error) {
	identity, capabilities, recoveryMode, err := nativeProviderIdentity(assignment.Provider)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	if (assignment.Provider == "app_store" && application.Platform != "ios") ||
		(assignment.Provider == "google_play" && application.Platform != "android") {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	expectedProducts := append([]string(nil), productIDs...)
	sort.Strings(expectedProducts)
	mappings := tx.ProviderMappingsForNativeCommerce(
		assignment.Provider, environment.ID, application.ID, application.Platform, expectedProducts,
	)
	if len(mappings) != len(expectedProducts) {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	productMappings := make([]commerceProductMapping, 0, len(mappings))
	allObserved := true
	anyStale := false
	var observedAt time.Time
	var expiresAt *time.Time
	observationEnvironment := ""
	for index, mapping := range mappings {
		if mapping.ProductID != expectedProducts[index] || mapping.ProviderProductIdentifier == "" {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		product, ok := tx.Product(mapping.ProductID)
		if !ok || product.ProjectID != environment.ProjectID {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		keys := tx.ProductEntitlementKeys(mapping.ProductID)
		if len(keys) == 0 {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		adapter := commerceAdapterMapping{Kind: "storeKitProduct"}
		if assignment.Provider == "google_play" {
			adapter = commerceAdapterMapping{
				Kind: "googlePlayProduct", BasePlanID: mapping.ProviderBasePlanIdentifier,
				OfferID: mapping.ProviderOfferIdentifier,
			}
			if product.Type == "subscription" && adapter.BasePlanID == "" {
				return CommerceConfigurationSnapshot{}, ErrProviderReadiness
			}
			if product.Type == "one_time_non_consumable" && (adapter.BasePlanID != "" || adapter.OfferID != "") {
				return CommerceConfigurationSnapshot{}, ErrProviderReadiness
			}
		}
		productMappings = append(productMappings, commerceProductMapping{
			MosaicProductID: mapping.ProductID, MappingID: mapping.ID, ProductType: product.Type,
			EntitlementKeys: keys, ProviderProductReference: mapping.ProviderProductIdentifier,
			AdapterMapping: adapter,
		})
		observation, ok := tx.LatestProviderMappingObservation(mapping.ID)
		if !ok || observation.Result != "available" {
			allObserved = false
			continue
		}
		if observation.ExpiresAt != nil && !observation.ExpiresAt.After(now) {
			anyStale = true
		}
		observedAt = minTime(observedAt, observation.ObservedAt)
		expiresAt = minTimePointer(expiresAt, observation.ExpiresAt)
		currentEnvironment := nativeObservationEnvironment(observation.StoreContext)
		if observationEnvironment == "" {
			observationEnvironment = currentEnvironment
		} else if observationEnvironment != currentEnvironment {
			observationEnvironment = "unknown"
		}
	}
	releaseDigest, err := configurationReleaseDigest(release.Payload)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	freshness := commerceConfigurationFreshness{
		Source: "nativeStoreConfiguration", Status: "configured",
		ConfiguredAt: now.UTC().Format(time.RFC3339Nano),
	}
	if allObserved && !observedAt.IsZero() {
		freshness.Status = "fresh"
		if anyStale {
			freshness.Status = "stale"
		}
		freshness.Observation = &commerceNativeObservation{
			Environment: observationEnvironment,
			ObservedAt:  observedAt.UTC().Format(time.RFC3339Nano),
		}
		if expiresAt != nil {
			freshness.Observation.ExpiresAt = expiresAt.UTC().Format(time.RFC3339Nano)
		}
	}
	document := commerceConfigurationDocument{
		ID:            "commerce_" + release.ID + "_" + application.ID,
		EnvironmentID: environment.ID, ApplicationID: application.ID, StorePlatform: application.Platform,
		ConfigurationRelease: commerceConfigurationRelease{ID: release.ID, ContentDigest: releaseDigest},
		ActiveProvider: commerceActiveProvider{
			Identity: identity, Activation: commerceProviderActivation{Source: "nativeStore"},
			Capabilities: capabilities, RecoveryMode: recoveryMode,
		},
		ProductMappings: productMappings, EntitlementMappings: []commerceEntitlementMapping{},
		Freshness: freshness, Diagnostics: []map[string]any{},
	}
	material, err := json.Marshal(document)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(material, &canonicalMaterial); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	digest := sha256.Sum256(canonicalBytes)
	document.ContentDigest = fmt.Sprintf("sha256:%x", digest)
	payload, err := json.Marshal(commerceConfigurationEnvelope{Version: "2", Configuration: document})
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	if err := s.commerceValidator.Validate(payload); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	return CommerceConfigurationSnapshot{
		ID: document.ID, ProjectID: environment.ProjectID, EnvironmentID: environment.ID,
		ApplicationID: application.ID, StorePlatform: application.Platform,
		ConfigurationReleaseID: release.ID, ConfigurationReleaseDigest: releaseDigest,
		ContentDigest: document.ContentDigest, Payload: payload, CreatedAt: now,
	}, nil
}

func (s *Service) cloneCommerceConfiguration(target CommerceConfigurationSnapshot, release Release, now time.Time) (CommerceConfigurationSnapshot, error) {
	var envelope commerceConfigurationEnvelope
	if err := json.Unmarshal(target.Payload, &envelope); err != nil || (envelope.Version != "1" && envelope.Version != "2") {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	releaseDigest, err := configurationReleaseDigest(release.Payload)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	envelope.Configuration.ID = "commerce_" + release.ID + "_" + target.ApplicationID
	envelope.Configuration.ConfigurationRelease = commerceConfigurationRelease{
		ID: release.ID, ContentDigest: releaseDigest,
	}
	if envelope.Version == "1" {
		staleAt, err := time.Parse(time.RFC3339Nano, envelope.Configuration.Freshness.StaleAt)
		if err != nil {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		envelope.Configuration.Freshness.Status = "fresh"
		if !now.Before(staleAt) {
			envelope.Configuration.Freshness.Status = "stale"
		}
	} else if observation := envelope.Configuration.Freshness.Observation; observation != nil && observation.ExpiresAt != "" {
		expiresAt, err := time.Parse(time.RFC3339Nano, observation.ExpiresAt)
		if err != nil {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		envelope.Configuration.Freshness.Status = "fresh"
		if !now.Before(expiresAt) {
			envelope.Configuration.Freshness.Status = "stale"
		}
	}
	envelope.Configuration.ContentDigest = ""
	material, err := json.Marshal(envelope.Configuration)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(material, &canonicalMaterial); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	digest := sha256.Sum256(canonicalBytes)
	envelope.Configuration.ContentDigest = fmt.Sprintf("sha256:%x", digest)
	payload, err := json.Marshal(envelope)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	if err := s.commerceValidator.Validate(payload); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	return CommerceConfigurationSnapshot{
		ID: envelope.Configuration.ID, ProjectID: release.ProjectID,
		EnvironmentID: release.EnvironmentID, ApplicationID: target.ApplicationID,
		StorePlatform: target.StorePlatform, ConfigurationReleaseID: release.ID,
		ConfigurationReleaseDigest: releaseDigest, ContentDigest: envelope.Configuration.ContentDigest,
		Payload: payload, CreatedAt: now,
	}, nil
}
