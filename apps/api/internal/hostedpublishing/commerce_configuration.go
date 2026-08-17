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

// CommerceConfigurationVersion is the only Commerce Configuration contract
// version (ADR-0028: one version per contract until GA). v2 absorbed every
// shape v1 carried, so every snapshot Mosaic builds claims it.
const CommerceConfigurationVersion = "2"

const (
	commerceProviderSchemaID      = "urn:mosaic:protocol:schema:commerce-provider:v2:contract"
	commerceConfigurationSchemaID = "urn:mosaic:protocol:schema:commerce-configuration:v2:configuration"
)

type CommerceConfigurationValidator struct {
	schemas map[string]*jsonschema.Schema
}

// CompileCommerceConfigurationValidator compiles the canonical Commerce
// Provider v2 and Commerce Configuration v2 schemas — the only versions
// (ADR-0028). A snapshot claiming any other version is refused before the
// schema is consulted.
func CompileCommerceConfigurationValidator(providerSchema, configurationSchema io.Reader) (*CommerceConfigurationValidator, error) {
	decode := func(name string, reader io.Reader) (any, error) {
		var document any
		decoder := json.NewDecoder(reader)
		if err := decoder.Decode(&document); err != nil {
			return nil, fmt.Errorf("decode canonical %s schema: %w", name, err)
		}
		return document, nil
	}
	providerDocument, err := decode("Commerce Provider v2", providerSchema)
	if err != nil {
		return nil, err
	}
	configurationDocument, err := decode("Commerce Configuration v2", configurationSchema)
	if err != nil {
		return nil, err
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseRegexpEngine(compileECMARegexp)
	compiler.AssertFormat()
	if err := compiler.AddResource(commerceProviderSchemaID, providerDocument); err != nil {
		return nil, fmt.Errorf("register canonical Commerce Provider v2 schema: %w", err)
	}
	if err := compiler.AddResource(commerceConfigurationSchemaID, configurationDocument); err != nil {
		return nil, fmt.Errorf("register canonical Commerce Configuration v2 schema: %w", err)
	}
	schema, err := compiler.Compile(commerceConfigurationSchemaID)
	if err != nil {
		return nil, fmt.Errorf("compile canonical Commerce Configuration v2 schema: %w", err)
	}
	return &CommerceConfigurationValidator{schemas: map[string]*jsonschema.Schema{CommerceConfigurationVersion: schema}}, nil
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

// commercePublishMaterial memoizes the application-invariant inputs of a
// publish's per-application commerce builds: product rows, entitlement-key
// sets, grant counts, and the release digest — which requires scanning the
// full release payload. Without it a publish with A applications repeats each
// of those reads A times inside the transaction holding the publish lock.
type commercePublishMaterial struct {
	products        map[string]Product
	entitlementKeys map[string][]string
	grantCounts     map[string]int

	digest       string
	digestErr    error
	digestSolved bool
}

// newCommercePublishMaterial seeds the memo with the products the publish
// already validated and fetched.
func newCommercePublishMaterial(products map[string]Product) *commercePublishMaterial {
	seeded := make(map[string]Product, len(products))
	for id, product := range products {
		seeded[id] = product
	}
	return &commercePublishMaterial{
		products:        seeded,
		entitlementKeys: make(map[string][]string),
		grantCounts:     make(map[string]int),
	}
}

func (m *commercePublishMaterial) releaseDigest(release Release) (string, error) {
	if !m.digestSolved {
		m.digest, m.digestErr = configurationReleaseDigest(release.Payload)
		m.digestSolved = true
	}
	return m.digest, m.digestErr
}

func (m *commercePublishMaterial) product(reader Reader, productID string) (Product, bool) {
	if product, ok := m.products[productID]; ok {
		return product, true
	}
	product, ok := reader.Product(productID)
	if ok {
		m.products[productID] = product
	}
	return product, ok
}

func (m *commercePublishMaterial) productEntitlementKeys(reader Reader, productID string) []string {
	if keys, ok := m.entitlementKeys[productID]; ok {
		return keys
	}
	keys := reader.ProductEntitlementKeys(productID)
	m.entitlementKeys[productID] = keys
	return keys
}

func (m *commercePublishMaterial) productGrantCount(reader Reader, productID string) int {
	if count, ok := m.grantCounts[productID]; ok {
		return count
	}
	count := reader.ProductGrantCount(productID)
	m.grantCounts[productID] = count
	return count
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

func (s *Service) buildCommerceConfiguration(tx Transaction, release Release, environment Environment, application Application, productIDs []string, now time.Time, material *commercePublishMaterial) (CommerceConfigurationSnapshot, error) {
	assignment, ok := tx.ProviderAssignment(environment.ID, application.ID)
	if !ok {
		return CommerceConfigurationSnapshot{}, ErrProviderReadiness
	}
	if assignment.ActivationKind == "native_store" {
		return s.buildNativeCommerceConfiguration(tx, release, environment, application, productIDs, now, assignment, material)
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
		// The adapter kind is derived from the connection's provider, never from
		// the mere presence of offering and package identifiers. Commerce
		// Configuration v2 rejects a revenueCatPackage mapping unless the active
		// provider identity is revenuecat
		// (protocol/tools/commerce-configuration-validation-v2.mjs:393-396), and
		// offering/package columns are no longer RevenueCat's alone: an App
		// Store Connect import stores an Apple subscription group there as
		// provenance. Selecting the kind by shape would let such a provider
		// silently emit a schema-invalid mapping.
		adapter := commerceAdapterMapping{Kind: "directProduct"}
		if mapping.ProviderPackageIdentifier != "" || mapping.ProviderOfferingIdentifier != "" {
			if connection.Provider != "revenuecat" ||
				mapping.ProviderPackageIdentifier == "" || mapping.ProviderOfferingIdentifier == "" {
				return CommerceConfigurationSnapshot{}, ErrProviderReadiness
			}
			adapter = commerceAdapterMapping{
				Kind: "revenueCatPackage", OfferingIdentifier: mapping.ProviderOfferingIdentifier,
				PackageIdentifier: mapping.ProviderPackageIdentifier,
			}
		}
		product, ok := material.product(tx, mapping.ProductID)
		if !ok || product.ProjectID != environment.ProjectID {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		keys := material.productEntitlementKeys(tx, mapping.ProductID)
		if len(keys) == 0 {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		productMappings = append(productMappings, commerceProductMapping{
			MosaicProductID: mapping.ProductID, MappingID: mapping.ID, ProductType: product.Type,
			EntitlementKeys: keys, ProviderProductReference: mapping.ExpectedStoreProductID,
			AdapterMapping: adapter,
		})
		observedAt = minTime(observedAt, snapshot.ObservedAt)
		synchronizedAt = minTime(synchronizedAt, snapshot.SyncedAt)
		staleAt = minTime(staleAt, snapshot.StaleAt)
		expiresAt = minTimePointer(expiresAt, snapshot.ExpiresAt)
	}
	for _, productID := range expectedProducts {
		grantCount := material.productGrantCount(tx, productID)
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
	releaseDigest, err := material.releaseDigest(release)
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
			Identity:   identity,
			Activation: commerceProviderActivation{Source: "providerConnection", ProviderConnectionID: connection.ID},
			// Recovery for a server-connected provider is the provider's own
			// behaviour, not a Mosaic-defined store recovery flow.
			Capabilities: capabilities, RecoveryMode: "providerDefined",
		},
		ProductMappings: productMappings, EntitlementMappings: entitlementMappings,
		Freshness: freshness, Diagnostics: []map[string]any{},
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(encoded, &canonicalMaterial); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	digest := sha256.Sum256(canonicalBytes)
	document.ContentDigest = fmt.Sprintf("sha256:%x", digest)
	payload, err := json.Marshal(commerceConfigurationEnvelope{Version: CommerceConfigurationVersion, Configuration: document})
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

// importedNativeProvider is the server-connected provider whose imported
// mappings also describe a native store catalog. App Store Connect reads
// Apple's catalog; purchases still run through the native App Store
// activation, so its mappings feed the native delivery path.
const importedNativeProvider = "app_store_connect"

// nativeCommerceMappings reduces the mapping rows that can back one native
// store activation to exactly one row per Product, in the shape the native
// builder emits.
//
// Two provenances can describe the same iOS Product. A native app_store
// mapping carries the StoreKit identifier an operator typed. An
// app_store_connect mapping was imported from Apple, records Apple's opaque
// resource ID in provider_product_identifier and the purchasable App Store
// product ID in expected_store_product_id, and is refreshed by the
// synchronization worker.
//
// Precedence: the imported mapping wins. It is provider-verified and kept
// fresh, while the hand-created mapping is an unverified transcription that
// nothing re-checks against Apple. Ties inside one provenance are broken by
// the caller's ordering (product_id, id), so the winner is deterministic.
//
// Offering and package identifiers on an imported mapping are subscription
// group provenance, not purchase selectors, and are dropped here. Together
// with the explicit provider check in the server-connected branch this makes
// it impossible to derive a revenueCatPackage adapter from App Store Connect
// data, which Commerce Configuration v2 would reject
// (protocol/tools/commerce-configuration-validation-v2.mjs:393-396).
func nativeCommerceMappings(provider string, mappings []CommerceProductMapping) []CommerceProductMapping {
	result := make([]CommerceProductMapping, 0, len(mappings))
	positions := make(map[string]int, len(mappings))
	for _, mapping := range mappings {
		imported := provider == "app_store" && mapping.Provider == importedNativeProvider
		if imported {
			if mapping.ExpectedStoreProductID == "" {
				// StoreKit buys the App Store product ID. An import that never
				// recorded one cannot serve a purchase, so it must not displace
				// a native mapping that can.
				continue
			}
			mapping.ProviderProductIdentifier = mapping.ExpectedStoreProductID
			mapping.ProviderPackageIdentifier, mapping.ProviderOfferingIdentifier = "", ""
			mapping.ProviderBasePlanIdentifier, mapping.ProviderOfferIdentifier = "", ""
		} else if mapping.Provider == importedNativeProvider {
			continue
		}
		position, seen := positions[mapping.ProductID]
		if !seen {
			positions[mapping.ProductID] = len(result)
			result = append(result, mapping)
			continue
		}
		if imported && result[position].Provider != importedNativeProvider {
			result[position] = mapping
		}
	}
	return result
}

func (s *Service) buildNativeCommerceConfiguration(tx Transaction, release Release, environment Environment, application Application, productIDs []string, now time.Time, assignment ProviderAssignment, material *commercePublishMaterial) (CommerceConfigurationSnapshot, error) {
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
	mappings := nativeCommerceMappings(assignment.Provider, tx.ProviderMappingsForNativeCommerce(
		assignment.Provider, environment.ID, application.ID, application.Platform, expectedProducts,
	))
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
		product, ok := material.product(tx, mapping.ProductID)
		if !ok || product.ProjectID != environment.ProjectID {
			return CommerceConfigurationSnapshot{}, ErrProviderReadiness
		}
		keys := material.productEntitlementKeys(tx, mapping.ProductID)
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
	releaseDigest, err := material.releaseDigest(release)
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
	encoded, err := json.Marshal(document)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	var canonicalMaterial map[string]any
	if err := json.Unmarshal(encoded, &canonicalMaterial); err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	delete(canonicalMaterial, "contentDigest")
	canonicalBytes, err := canonicalJSON(canonicalMaterial)
	if err != nil {
		return CommerceConfigurationSnapshot{}, err
	}
	digest := sha256.Sum256(canonicalBytes)
	document.ContentDigest = fmt.Sprintf("sha256:%x", digest)
	payload, err := json.Marshal(commerceConfigurationEnvelope{Version: CommerceConfigurationVersion, Configuration: document})
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
	if err := json.Unmarshal(target.Payload, &envelope); err != nil || envelope.Version != CommerceConfigurationVersion {
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
	if envelope.Configuration.Freshness.StaleAt != "" {
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
