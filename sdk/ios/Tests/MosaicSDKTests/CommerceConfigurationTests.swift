import Foundation
import XCTest

@testable import MosaicSDK

final class CommerceConfigurationTests: XCTestCase {
  func testCanonicalStoreKitV2DecodesExactMappingGrantsAndNativeActivation() throws {
    let association = MosaicCommerceConfigurationAssociation(
      environmentID: "environment_production",
      applicationID: "application_ios",
      storePlatform: .ios,
      configurationReleaseID: "configuration_release_42",
      configurationReleaseDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      mosaicProductIDs: ["mosaic_pro_monthly", "mosaic_pro_yearly", "mosaic_pro_lifetime"],
      mosaicProductTypes: [
        "mosaic_pro_monthly": .subscription,
        "mosaic_pro_yearly": .subscription,
        "mosaic_pro_lifetime": .oneTimeNonConsumable,
      ]
    )
    let configuration = try MosaicCommerceConfigurationDecoder.decode(
      commerceConfigurationV2FixtureData(),
      association: association
    )

    XCTAssertEqual(configuration.version, "2")
    XCTAssertEqual(configuration.activeProvider.identity.id, "app_store")
    XCTAssertEqual(configuration.activeProvider.activation, .nativeStore)
    XCTAssertEqual(configuration.activeProvider.recoveryMode, .storeSynchronization)
    XCTAssertEqual(configuration.productMappings.count, 3)
    let monthly = try XCTUnwrap(
      configuration.productMappings.first { $0.mosaicProductID == "mosaic_pro_monthly" }
    )
    XCTAssertEqual(monthly.adapterMapping, .storeKitProduct)
    XCTAssertEqual(monthly.productType, .subscription)
    XCTAssertEqual(monthly.entitlementKeys, ["pro"])
    XCTAssertEqual(configuration.freshness.source, .nativeStoreConfiguration)
    XCTAssertEqual(configuration.freshness.status, .configured)

    let provider = RecordingCommerceProvider(
      identity: .init(
        id: "app_store",
        displayName: "StoreKit",
        adapterVersion: "1.0.0"
      ),
      capabilities: configuration.activeProvider.capabilities
    )
    XCTAssertNoThrow(
      try MosaicConfiguredPurchaseProvider(
        configuration: configuration,
        provider: provider
      )
    )
  }

  func testV2RouterRejectsDuplicateAndStaleAsynchronousUpdates() async throws {
    let association = storeKitAssociation()
    let configuration = try MosaicCommerceConfigurationDecoder.decode(
      commerceConfigurationV2FixtureData(),
      association: association
    )
    let provider = AsyncRecordingCommerceProvider(
      capabilities: configuration.activeProvider.capabilities
    )
    let router = MosaicCommerceProviderRouter()
    try await router.install(configuration: configuration, provider: provider)
    let stream = await router.commerceUpdates
    var iterator = stream.makeAsyncIterator()
    let reference = MosaicCommerceConfigurationReference(
      configurationID: configuration.id,
      configurationRevision: configuration.contentDigest
    )
    let first = commerceUpdate(id: "update_storekit_1", configuration: reference)
    await provider.emit(first)
    let routedFirst = await iterator.next()
    XCTAssertEqual(routedFirst, first)

    await provider.emit(first)
    await provider.emit(
      commerceUpdate(
        id: "update_storekit_stale",
        configuration: .init(
          configurationID: configuration.id,
          configurationRevision: "stale_revision"
        )
      )
    )
    let second = commerceUpdate(id: "update_storekit_2", configuration: reference)
    await provider.emit(second)
    let routedSecond = await iterator.next()
    XCTAssertEqual(routedSecond, second)
  }

  func testCanonicalRevenueCatSidecarDecodesOnlyForExactReleaseAssociation() throws {
    let data = try commerceConfigurationFixtureData()
    let association = revenueCatAssociation()
    let configuration = try MosaicCommerceConfigurationDecoder.decode(
      data,
      association: association
    )

    XCTAssertEqual(configuration.activeProvider.identity.id, "revenuecat")
    XCTAssertEqual(
      configuration.contentDigest,
      "sha256:4449f3af7e8490aa7141070b427d0cf7d2ca86209d7e344ec85d51fe9f896176"
    )
    XCTAssertEqual(
      configuration.productMappings.map(\.mosaicProductID),
      association.mosaicProductIDs
    )
    XCTAssertEqual(
      configuration.productMappings.map(\.adapterMapping),
      [
        .directProduct,
        .revenueCatPackage(
          offeringIdentifier: "default",
          packageIdentifier: "$rc_annual"
        ),
      ]
    )

    let wrongAssociation = MosaicCommerceConfigurationAssociation(
      environmentID: association.environmentID,
      applicationID: association.applicationID,
      storePlatform: association.storePlatform,
      configurationReleaseID: "configuration_release_43",
      configurationReleaseDigest: association.configurationReleaseDigest,
      mosaicProductIDs: association.mosaicProductIDs
    )
    XCTAssertThrowsError(
      try MosaicCommerceConfigurationDecoder.decode(data, association: wrongAssociation)
    ) { error in
      XCTAssertEqual(
        error as? MosaicCommerceConfigurationError,
        .invalidConfiguration(code: "commerce_configuration_association_mismatch")
      )
    }
  }

  func testInvalidCandidatePreservesExactCacheAndReleaseChangeFailsClosed() async throws {
    let store = CommerceMemoryStore()
    let manager = MosaicCommerceConfigurationManager(store: store)
    let data = try commerceConfigurationFixtureData()
    let association = revenueCatAssociation()
    _ = await manager.bootstrap(association: association)
    _ = await manager.accept(data, source: .remote, association: association)

    let rejected = await manager.accept(
      Data("{\"commerceConfigurationVersion\":\"1\"}".utf8),
      source: .remote,
      association: association
    )
    guard case .preserved(let configuration, .remote, let diagnostic) = rejected else {
      return XCTFail("Expected the last exact accepted sidecar to be preserved.")
    }
    XCTAssertEqual(configuration.id, "commerce_configuration_release_42_ios")
    XCTAssertEqual(diagnostic.code, "commerce_configuration_invalid_shape")

    let nextAssociation = MosaicCommerceConfigurationAssociation(
      environmentID: association.environmentID,
      applicationID: association.applicationID,
      storePlatform: association.storePlatform,
      configurationReleaseID: "configuration_release_43",
      configurationReleaseDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      mosaicProductIDs: association.mosaicProductIDs
    )
    let changedRelease = await manager.accept(
      data,
      source: .remote,
      association: nextAssociation
    )
    guard case .unavailable(let diagnostics) = changedRelease else {
      return XCTFail("A sidecar from an older release must never survive release transition.")
    }
    XCTAssertEqual(diagnostics.last?.code, "commerce_configuration_association_mismatch")
  }

  func testConfiguredCustomProviderReceivesVerifiedMappingsAndKeepsExplicitResult() async throws {
    let configuration = try MosaicCommerceConfigurationDecoder.decode(
      try commerceConfigurationFixtureData(named: "sdk-local-configuration.json"),
      association: sdkLocalAssociation()
    )
    let provider = RecordingCommerceProvider()
    let configured = try MosaicConfiguredPurchaseProvider(
      configuration: configuration,
      provider: provider
    )

    let load = await configured.loadProducts(identifiers: ["product_pro_monthly"])
    XCTAssertEqual(
      load,
      .loaded([
        MosaicProduct(
          id: "product_pro_monthly",
          title: "Pro monthly",
          localizedPrice: "$9.99"
        )
      ])
    )
    let loadedMappingIDs = await provider.loadedMappingIDs()
    XCTAssertEqual(loadedMappingIDs, ["mapping_acme_pro_monthly_android"])
    let purchase = await configured.purchase(productID: "product_pro_monthly")
    XCTAssertEqual(
      purchase,
      .pending(productID: "product_pro_monthly", transactionID: nil)
    )

    await provider.setPurchaseFailure(
      MosaicCommerceDiagnostic(
        code: "Raw provider detail!",
        safeMessage: "unsafe\nmessage",
        severity: .error,
        retryable: true,
        retryAfterSeconds: 90_000,
        correlationID: "invalid correlation",
        mosaicProductID: "wrong_product"
      )
    )
    let failed = await configured.purchase(productID: "product_pro_monthly")
    guard case .failed(let productID, let diagnosticCode, let diagnostic) = failed else {
      return XCTFail("Expected the custom Provider failure to remain explicit.")
    }
    XCTAssertEqual(productID, "product_pro_monthly")
    XCTAssertEqual(diagnosticCode, diagnostic.code)
    XCTAssertEqual(diagnostic.code, "commerce.purchaseFailed")
    XCTAssertEqual(
      diagnostic.safeMessage,
      "The commerce provider could not complete the purchase."
    )
    XCTAssertTrue(diagnostic.retryable)
    XCTAssertNil(diagnostic.retryAfterSeconds)
    XCTAssertEqual(diagnostic.providerCode, "provider_failure")
    XCTAssertEqual(diagnostic.mosaicProductID, "product_pro_monthly")
    XCTAssertEqual(diagnostic.recoveryAction, .retry)
    XCTAssertEqual(diagnostic.correlationID, "ios_provider_purchase_1")
  }

  func testConfigurationReplacementBlocksPurchaseUntilExactMappingsReload() async throws {
    let configuration = try MosaicCommerceConfigurationDecoder.decode(
      try commerceConfigurationFixtureData(named: "sdk-local-configuration.json"),
      association: sdkLocalAssociation()
    )
    let provider = RecordingCommerceProvider()
    let router = MosaicCommerceProviderRouter()

    try await router.install(configuration: configuration, provider: provider)
    _ = await router.loadProducts(identifiers: ["product_pro_monthly"])
    let initialPurchase = await router.purchase(productID: "product_pro_monthly")
    XCTAssertEqual(
      initialPurchase,
      .pending(productID: "product_pro_monthly", transactionID: nil)
    )

    await provider.deferNextInvalidation()
    let replacement = Task {
      try await router.install(configuration: configuration, provider: provider)
    }
    await provider.waitForDeferredInvalidation()

    let purchaseDuringReplacement = await router.purchase(productID: "product_pro_monthly")
    guard
      case .providerUnavailable(
        let productID,
        let diagnosticCode,
        let diagnostic
      ) = purchaseDuringReplacement
    else {
      return XCTFail("Replacement must expose a correlated unavailable diagnostic.")
    }
    XCTAssertEqual(productID, "product_pro_monthly")
    XCTAssertEqual(diagnosticCode, diagnostic.code)
    XCTAssertEqual(diagnostic.code, "commerce.configurationUnavailable")
    XCTAssertEqual(diagnostic.safeMessage, "Commerce configuration is unavailable.")
    XCTAssertTrue(diagnostic.retryable)
    XCTAssertEqual(diagnostic.providerCode, "provider_not_installed")
    XCTAssertEqual(diagnostic.mosaicProductID, "product_pro_monthly")
    XCTAssertEqual(diagnostic.recoveryAction, .updateProviderConfiguration)
    XCTAssertTrue(diagnostic.correlationID.hasPrefix("ios_router_purchase_"))

    await provider.completeDeferredInvalidation()
    try await replacement.value
    let purchaseBeforeReload = await router.purchase(productID: "product_pro_monthly")
    XCTAssertEqual(
      purchaseBeforeReload,
      .productUnavailable(productID: "product_pro_monthly")
    )

    _ = await router.loadProducts(identifiers: ["product_pro_monthly"])
    let purchaseAfterReload = await router.purchase(productID: "product_pro_monthly")
    XCTAssertEqual(
      purchaseAfterReload,
      .pending(productID: "product_pro_monthly", transactionID: nil)
    )
    let invalidationCount = await provider.invalidationCount()
    XCTAssertEqual(invalidationCount, 3)
  }

  func testConfiguredProviderRejectsCapabilityDriftBeforeLoadingMappings() throws {
    let configuration = try MosaicCommerceConfigurationDecoder.decode(
      try commerceConfigurationFixtureData(named: "sdk-local-configuration.json"),
      association: sdkLocalAssociation()
    )
    let provider = RecordingCommerceProvider(
      capabilities: [
        MosaicCommerceCapability(name: .productLoading, support: .supported),
        MosaicCommerceCapability(name: .subscriptions, support: .supported),
        MosaicCommerceCapability(name: .restore, support: .supported),
        MosaicCommerceCapability(name: .activeEntitlementLookup, support: .supported),
      ]
    )

    XCTAssertThrowsError(
      try MosaicConfiguredPurchaseProvider(
        configuration: configuration,
        provider: provider
      )
    ) { error in
      XCTAssertEqual(
        error as? MosaicConfiguredCommerceProviderError,
        .providerCapabilityMismatch(
          name: .restore,
          expected: MosaicCommerceCapability(
            name: .restore,
            support: .conditional,
            reasonCode: "host.sessionRequired"
          ),
          actual: MosaicCommerceCapability(name: .restore, support: .supported)
        )
      )
    }
  }

  func testHostedSidecarRequestAndMetadataUseFrozenWireContract() async throws {
    let data = try commerceConfigurationFixtureData()
    let association = revenueCatAssociation()
    let transport = CommerceTransportStub(
      response: MosaicCommerceConfigurationHTTPResponse(
        statusCode: 200,
        data: data,
        contentType: "application/vnd.mosaic.commerce-configuration+json;version=1",
        etag:
          "\"sha256:4449f3af7e8490aa7141070b427d0cf7d2ca86209d7e344ec85d51fe9f896176\"",
        configurationReleaseID: "configuration_release_42",
        cacheControl: "private, max-age=60"
      )
    )
    let manager = MosaicCommerceConfigurationManager(store: CommerceMemoryStore())
    _ = await manager.bootstrap(association: association)

    let result = await manager.refresh(
      publicSDKKey: "pk_test",
      baseURL: URL(string: "https://api.example.test")!,
      association: association,
      requestTimeout: 5,
      transport: transport
    )
    guard case .accepted(let configuration, .remote) = result else {
      return XCTFail("Expected a valid hosted sidecar response.")
    }
    XCTAssertEqual(configuration.id, "commerce_configuration_release_42_ios")

    let capturedRequest = await transport.request()
    let request = try XCTUnwrap(capturedRequest)
    XCTAssertEqual(
      request.url.absoluteString,
      "https://api.example.test/v1/sdk/commerce-configuration?applicationId=application_ios"
    )
    XCTAssertEqual(request.headers["Authorization"], "Bearer pk_test")
    XCTAssertEqual(request.headers["Mosaic-SDK-Platform"], "ios")
    XCTAssertEqual(request.headers["Mosaic-SDK-Version"], mosaicSDKVersion)
    XCTAssertEqual(request.headers["Mosaic-Commerce-Configuration-Versions"], "2,1")
    XCTAssertEqual(request.headers["Mosaic-Commerce-Provider-Contract-Versions"], "2,1")
    XCTAssertEqual(
      request.headers["Accept"],
      "application/vnd.mosaic.commerce-configuration+json;version=2, "
        + "application/vnd.mosaic.commerce-configuration+json;version=1"
    )
  }

  private func revenueCatAssociation() -> MosaicCommerceConfigurationAssociation {
    MosaicCommerceConfigurationAssociation(
      environmentID: "environment_production",
      applicationID: "application_ios",
      storePlatform: .ios,
      configurationReleaseID: "configuration_release_42",
      configurationReleaseDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      mosaicProductIDs: ["product_pro_monthly", "product_pro_yearly"]
    )
  }

  private func sdkLocalAssociation() -> MosaicCommerceConfigurationAssociation {
    MosaicCommerceConfigurationAssociation(
      environmentID: "environment_development",
      applicationID: "application_android",
      storePlatform: .android,
      configurationReleaseID: "configuration_release_local_7",
      configurationReleaseDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      mosaicProductIDs: ["product_pro_monthly"]
    )
  }

  private func storeKitAssociation() -> MosaicCommerceConfigurationAssociation {
    MosaicCommerceConfigurationAssociation(
      environmentID: "environment_production",
      applicationID: "application_ios",
      storePlatform: .ios,
      configurationReleaseID: "configuration_release_42",
      configurationReleaseDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      mosaicProductIDs: ["mosaic_pro_monthly", "mosaic_pro_yearly", "mosaic_pro_lifetime"],
      mosaicProductTypes: [
        "mosaic_pro_monthly": .subscription,
        "mosaic_pro_yearly": .subscription,
        "mosaic_pro_lifetime": .oneTimeNonConsumable,
      ]
    )
  }

  private func commerceUpdate(
    id: String,
    configuration: MosaicCommerceConfigurationReference
  ) -> MosaicCommerceUpdate {
    MosaicCommerceUpdate(
      id: id,
      providerID: "app_store",
      mosaicProductID: "mosaic_pro_monthly",
      configuration: configuration,
      outcome: .purchased,
      transactionReference: "storekit_42",
      activeEntitlementKeys: ["pro"],
      occurredAt: Date(timeIntervalSince1970: 1_721_822_700)
    )
  }
}

private actor CommerceMemoryStore: MosaicCommerceConfigurationCacheStore {
  private var record: MosaicCommerceConfigurationCacheRecord?

  func load() -> MosaicCommerceConfigurationCacheRecord? { record }

  func save(_ record: MosaicCommerceConfigurationCacheRecord) {
    self.record = record
  }
}

private actor CommerceTransportStub: MosaicCommerceConfigurationTransport {
  private let response: MosaicCommerceConfigurationHTTPResponse
  private var receivedRequest: MosaicCommerceConfigurationHTTPRequest?

  init(response: MosaicCommerceConfigurationHTTPResponse) {
    self.response = response
  }

  func fetch(
    _ request: MosaicCommerceConfigurationHTTPRequest
  ) -> MosaicCommerceConfigurationHTTPResponse {
    receivedRequest = request
    return response
  }

  func request() -> MosaicCommerceConfigurationHTTPRequest? { receivedRequest }
}

private actor RecordingCommerceProvider: MosaicCommerceProvider {
  nonisolated let identity: MosaicCommerceProviderIdentity
  nonisolated let capabilities: [MosaicCommerceCapability]
  private var mappingIDs: [String] = []
  private var invalidations = 0
  private var shouldDeferNextInvalidation = false
  private var invalidationContinuation: CheckedContinuation<Void, Never>?
  private var invalidationWaiters: [CheckedContinuation<Void, Never>] = []
  private var purchaseFailure: MosaicCommerceDiagnostic?

  init(
    identity: MosaicCommerceProviderIdentity = MosaicCommerceProviderIdentity(
      id: "acme-commerce",
      displayName: "Acme Commerce",
      adapterVersion: "2.3.1"
    ),
    capabilities: [MosaicCommerceCapability] = [
      MosaicCommerceCapability(name: .productLoading, support: .supported),
      MosaicCommerceCapability(name: .subscriptions, support: .supported),
      MosaicCommerceCapability(
        name: .restore,
        support: .conditional,
        reasonCode: "host.sessionRequired"
      ),
      MosaicCommerceCapability(name: .activeEntitlementLookup, support: .supported),
    ]
  ) {
    self.identity = identity
    self.capabilities = capabilities
  }

  func invalidateLoadedProducts() async {
    invalidations += 1
    mappingIDs = []
    guard shouldDeferNextInvalidation else { return }
    shouldDeferNextInvalidation = false
    await withCheckedContinuation { continuation in
      invalidationContinuation = continuation
      for waiter in invalidationWaiters {
        waiter.resume()
      }
      invalidationWaiters = []
    }
  }

  func loadProducts(
    mappings: [MosaicCommerceProductMapping]
  ) -> [MosaicCommerceResolvedProduct] {
    mappingIDs = mappings.map(\.mappingID)
    return mappings.map {
      MosaicCommerceResolvedProduct(
        mosaicProductID: $0.mosaicProductID,
        product: MosaicProduct(
          id: $0.mosaicProductID,
          title: "Pro monthly",
          localizedPrice: "$9.99"
        ),
        availability: MosaicCommerceProductAvailability(status: .available)
      )
    }
  }

  func purchase(mosaicProductID: String) -> MosaicPurchaseResult {
    if let purchaseFailure {
      return .failed(
        productID: "untrusted_product",
        diagnosticCode: "Raw provider detail!",
        diagnostic: purchaseFailure
      )
    }
    return .pending(productID: mosaicProductID, transactionID: nil)
  }

  func restore(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) -> MosaicRestoreResult {
    .nothingToRestore
  }

  func activeEntitlements(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) -> MosaicActiveEntitlementsResult {
    .unknown(diagnosticCode: nil)
  }

  func providerDiagnostics() -> MosaicCommerceProviderDiagnostics {
    MosaicCommerceProviderDiagnostics(
      providerID: identity.id,
      health: .healthy,
      diagnostics: []
    )
  }

  func loadedMappingIDs() -> [String] { mappingIDs }

  func invalidationCount() -> Int { invalidations }

  func setPurchaseFailure(_ diagnostic: MosaicCommerceDiagnostic?) {
    purchaseFailure = diagnostic
  }

  func deferNextInvalidation() {
    shouldDeferNextInvalidation = true
  }

  func waitForDeferredInvalidation() async {
    guard invalidationContinuation == nil else { return }
    await withCheckedContinuation { continuation in
      invalidationWaiters.append(continuation)
    }
  }

  func completeDeferredInvalidation() {
    invalidationContinuation?.resume()
    invalidationContinuation = nil
  }
}

private actor AsyncRecordingCommerceProvider: MosaicAsynchronousCommerceProvider {
  nonisolated let identity = MosaicCommerceProviderIdentity(
    id: "app_store",
    displayName: "StoreKit",
    adapterVersion: "1.0.0"
  )
  nonisolated let capabilities: [MosaicCommerceCapability]
  private let updates: AsyncStream<MosaicCommerceUpdate>
  private let continuation: AsyncStream<MosaicCommerceUpdate>.Continuation

  init(capabilities: [MosaicCommerceCapability]) {
    self.capabilities = capabilities
    (updates, continuation) = AsyncStream.makeStream()
  }

  var commerceUpdates: AsyncStream<MosaicCommerceUpdate> {
    get async { updates }
  }

  func install(
    configuration _: MosaicCommerceConfigurationReference,
    mappings _: [MosaicCommerceProductMapping]
  ) {}

  func invalidateLoadedProducts() {}

  func loadProducts(
    mappings _: [MosaicCommerceProductMapping]
  ) -> [MosaicCommerceResolvedProduct] {
    []
  }

  func purchase(mosaicProductID: String) -> MosaicPurchaseResult {
    .productUnavailable(productID: mosaicProductID)
  }

  func restore(
    entitlementMappings _: [MosaicCommerceEntitlementMapping]
  ) -> MosaicRestoreResult {
    .nothingToRestore
  }

  func activeEntitlements(
    entitlementMappings _: [MosaicCommerceEntitlementMapping]
  ) -> MosaicActiveEntitlementsResult {
    .available([])
  }

  func providerDiagnostics() -> MosaicCommerceProviderDiagnostics {
    .init(providerID: identity.id, health: .healthy, diagnostics: [])
  }

  func emit(_ update: MosaicCommerceUpdate) {
    continuation.yield(update)
  }
}
