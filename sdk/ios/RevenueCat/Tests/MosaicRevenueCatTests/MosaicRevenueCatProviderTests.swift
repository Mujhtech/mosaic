import MosaicSDK
import RevenueCat
import XCTest

@testable import MosaicRevenueCat

final class MosaicRevenueCatProviderTests: XCTestCase {
  func testLoadsExactDirectAndOfferingPackageMappingsAndPurchasesNativeHandle() async {
    let client = RevenueCatClientStub(
      products: [
        snapshot(providerID: "com.example.pro.monthly", handle: "direct")
      ],
      packages: [
        RevenueCatPackageTarget(
          offeringIdentifier: "default",
          packageIdentifier: "$rc_annual"
        ): snapshot(providerID: "com.example.pro.yearly", handle: "package")
      ]
    )
    let provider = MosaicRevenueCatProvider(client: client)
    XCTAssertEqual(provider.identity.id, "revenuecat")
    XCTAssertEqual(provider.identity.adapterVersion, "1.0.0")
    XCTAssertEqual(provider.capabilities.count, 13)
    XCTAssertEqual(
      provider.capabilities.first(where: { $0.name == .deferredPurchases }),
      MosaicCommerceCapability(
        name: .deferredPurchases,
        support: .unsupported,
        reasonCode: "provider.outcomeNotDistinct"
      )
    )

    let products = await provider.loadProducts(mappings: mappings())
    XCTAssertEqual(products.map(\.availability.status), [.available, .available])
    XCTAssertEqual(products.compactMap(\.product).map(\.id), ["monthly", "yearly"])
    XCTAssertEqual(products.compactMap(\.product).map(\.localizedPrice), ["$9.99", "$79.99"])

    let result = await provider.purchase(mosaicProductID: "yearly")
    XCTAssertEqual(result, .purchased(productID: "yearly", transactionID: nil))
    let purchasedHandle = await client.purchasedHandle()
    XCTAssertEqual(purchasedHandle, "package")
  }

  func testMapsRevenueCatTypedPurchaseFailuresWithoutRawErrors() async {
    let client = RevenueCatClientStub(
      products: [snapshot(providerID: "com.example.pro.monthly", handle: "direct")]
    )
    let provider = MosaicRevenueCatProvider(client: client)
    _ = await provider.loadProducts(mappings: [mappings()[0]])

    await client.setPurchaseError(.paymentPendingError)
    let pending = await provider.purchase(mosaicProductID: "monthly")
    XCTAssertEqual(
      pending,
      .pending(productID: "monthly", transactionID: nil)
    )

    await client.setPurchaseError(.productAlreadyPurchasedError)
    let alreadyEntitled = await provider.purchase(mosaicProductID: "monthly")
    XCTAssertEqual(
      alreadyEntitled,
      .alreadyEntitled(productID: "monthly")
    )

    await client.setPurchaseError(.networkError)
    let unavailable = await provider.purchase(mosaicProductID: "monthly")
    guard
      case .providerUnavailable(let productID, let diagnosticCode, let diagnostic) =
        unavailable
    else {
      return XCTFail("Expected a complete RevenueCat provider diagnostic.")
    }
    XCTAssertEqual(productID, "monthly")
    XCTAssertEqual(diagnosticCode, diagnostic.code)
    XCTAssertEqual(diagnostic.code, "commerce.providerUnavailable")
    XCTAssertEqual(
      diagnostic.safeMessage,
      "RevenueCat is temporarily unavailable for purchase."
    )
    XCTAssertEqual(diagnostic.severity, .error)
    XCTAssertTrue(diagnostic.retryable)
    XCTAssertEqual(diagnostic.providerCode, "network_error")
    XCTAssertEqual(diagnostic.mosaicProductID, "monthly")
    XCTAssertEqual(diagnostic.recoveryAction, .retry)
    XCTAssertTrue(diagnostic.correlationID.hasPrefix("ios_revenuecat_provider_"))
    let diagnostics = await provider.providerDiagnostics()
    XCTAssertEqual(diagnostics.health, .degraded)
    XCTAssertEqual(diagnostics.diagnostics.last, diagnostic)
  }

  func testMapsOnlyConfiguredRevenueCatEntitlementsAndPreservesLookupFailure() async {
    let client = RevenueCatClientStub(
      activeEntitlements: ["pro", "provider_internal"]
    )
    let provider = MosaicRevenueCatProvider(client: client)
    let mappings = [
      MosaicCommerceEntitlementMapping(
        mosaicEntitlementKey: "premium",
        providerEntitlementIdentifier: "pro"
      )
    ]

    let active = await provider.activeEntitlements(entitlementMappings: mappings)
    XCTAssertEqual(
      active,
      .available([MosaicEntitlement(id: "premium")])
    )
    let restored = await provider.restore(entitlementMappings: mappings)
    XCTAssertEqual(
      restored,
      .restored([MosaicEntitlement(id: "premium")])
    )

    await client.setEntitlementError(.offlineConnectionError)
    let unavailable = await provider.activeEntitlements(entitlementMappings: mappings)
    guard case .providerUnavailable(let diagnosticCode, let lookupDiagnostic) = unavailable else {
      return XCTFail("Expected a complete Entitlement lookup diagnostic.")
    }
    XCTAssertEqual(diagnosticCode, lookupDiagnostic.code)
    XCTAssertEqual(lookupDiagnostic.code, "commerce.providerUnavailable")
    XCTAssertEqual(
      lookupDiagnostic.safeMessage,
      "RevenueCat is temporarily unavailable for entitlement lookup."
    )
    XCTAssertTrue(lookupDiagnostic.retryable)
    XCTAssertEqual(lookupDiagnostic.providerCode, "offline_connection_error")
    XCTAssertNil(lookupDiagnostic.mosaicProductID)
    XCTAssertEqual(lookupDiagnostic.recoveryAction, .retry)

    let restoreUnavailable = await provider.restore(entitlementMappings: mappings)
    guard
      case .providerUnavailable(let restoreCode, let restoreDiagnostic) =
        restoreUnavailable
    else {
      return XCTFail("Expected a complete restore diagnostic.")
    }
    XCTAssertEqual(restoreCode, restoreDiagnostic.code)
    XCTAssertEqual(restoreDiagnostic.code, "commerce.providerUnavailable")
    XCTAssertEqual(
      restoreDiagnostic.safeMessage,
      "RevenueCat is temporarily unavailable for restore."
    )
    XCTAssertTrue(restoreDiagnostic.retryable)
    XCTAssertEqual(restoreDiagnostic.providerCode, "offline_connection_error")
    XCTAssertEqual(restoreDiagnostic.recoveryAction, .retry)
    XCTAssertNotEqual(restoreDiagnostic.correlationID, lookupDiagnostic.correlationID)

    await client.setEntitlementError(.unknownError)
    let failed = await provider.activeEntitlements(entitlementMappings: mappings)
    guard case .failed(let failedCode, let failedDiagnostic) = failed else {
      return XCTFail("Expected a complete failed Entitlement diagnostic.")
    }
    XCTAssertEqual(failedCode, failedDiagnostic.code)
    XCTAssertEqual(failedDiagnostic.code, "commerce.entitlementLookupFailed")
    XCTAssertEqual(failedDiagnostic.safeMessage, "RevenueCat could not read active access.")
    XCTAssertFalse(failedDiagnostic.retryable)
    XCTAssertEqual(failedDiagnostic.providerCode, "unknown_error")
    XCTAssertEqual(failedDiagnostic.recoveryAction, .contactProvider)
  }

  func testInvalidationDiscardsInFlightLoadAndOnlyPurchasesReloadedHandle() async {
    let client = LoadRaceRevenueCatClient()
    let provider = MosaicRevenueCatProvider(client: client)
    let mapping = mappings()[0]
    let staleLoad = Task {
      await provider.loadProducts(mappings: [mapping])
    }
    await client.waitForProductRequest()

    await provider.invalidateLoadedProducts()
    await client.completeProductRequest(
      with: [snapshot(providerID: "com.example.pro.monthly", handle: "stale")]
    )

    let staleProducts = await staleLoad.value
    XCTAssertEqual(staleProducts.map(\.availability.status), [.unknown])
    let purchaseBeforeReload = await provider.purchase(mosaicProductID: "monthly")
    XCTAssertEqual(
      purchaseBeforeReload,
      .productUnavailable(productID: "monthly")
    )

    await client.useImmediateProducts([
      snapshot(providerID: "com.example.pro.monthly", handle: "current")
    ])
    let currentProducts = await provider.loadProducts(mappings: [mapping])
    XCTAssertEqual(currentProducts.map(\.availability.status), [.available])
    let purchaseAfterReload = await provider.purchase(mosaicProductID: "monthly")
    XCTAssertEqual(
      purchaseAfterReload,
      .purchased(productID: "monthly", transactionID: nil)
    )
    let purchasedHandle = await client.purchasedHandle()
    XCTAssertEqual(purchasedHandle, "current")
  }

  private func mappings() -> [MosaicCommerceProductMapping] {
    [
      MosaicCommerceProductMapping(
        mosaicProductID: "monthly",
        mappingID: "mapping_monthly",
        providerProductReference: "com.example.pro.monthly",
        adapterMapping: .directProduct
      ),
      MosaicCommerceProductMapping(
        mosaicProductID: "yearly",
        mappingID: "mapping_yearly",
        providerProductReference: "com.example.pro.yearly",
        adapterMapping: .revenueCatPackage(
          offeringIdentifier: "default",
          packageIdentifier: "$rc_annual"
        )
      ),
    ]
  }

  private func snapshot(
    providerID: String,
    handle: String
  ) -> RevenueCatProductSnapshot {
    RevenueCatProductSnapshot(
      providerProductIdentifier: providerID,
      localizedTitle: providerID.hasSuffix("monthly") ? "Pro monthly" : "Pro yearly",
      localizedPrice: providerID.hasSuffix("monthly") ? "$9.99" : "$79.99",
      currencyCode: "USD",
      billingPeriod: MosaicCommercePeriod(
        unit: providerID.hasSuffix("monthly") ? .month : .year,
        value: 1
      ),
      trial: nil,
      introductoryOffer: nil,
      handle: .test(handle)
    )
  }
}

private actor RevenueCatClientStub: RevenueCatClient {
  private let productValues: [RevenueCatProductSnapshot]
  private let packageValues: [RevenueCatPackageTarget: RevenueCatProductSnapshot]
  private let entitlementValues: Set<String>
  private var purchaseFailure: ErrorCode?
  private var entitlementFailure: ErrorCode?
  private var lastPurchasedHandle: String?

  init(
    products: [RevenueCatProductSnapshot] = [],
    packages: [RevenueCatPackageTarget: RevenueCatProductSnapshot] = [:],
    activeEntitlements: Set<String> = []
  ) {
    productValues = products
    packageValues = packages
    entitlementValues = activeEntitlements
  }

  func products(identifiers: [String]) -> [RevenueCatProductSnapshot] {
    productValues.filter { identifiers.contains($0.providerProductIdentifier) }
  }

  func packages(
    targets: [RevenueCatPackageTarget]
  ) throws -> [RevenueCatPackageTarget: RevenueCatProductSnapshot] {
    packageValues.filter { targets.contains($0.key) }
  }

  func purchase(handle: RevenueCatProductHandle) throws -> RevenueCatClientPurchaseResult {
    if let purchaseFailure { throw purchaseFailure }
    if case .test(let value) = handle {
      lastPurchasedHandle = value
    }
    return .purchased(transactionID: nil)
  }

  func restore() throws -> Set<String> {
    if let entitlementFailure { throw entitlementFailure }
    return entitlementValues
  }

  func activeEntitlements() throws -> Set<String> {
    if let entitlementFailure { throw entitlementFailure }
    return entitlementValues
  }

  func setPurchaseError(_ error: ErrorCode?) {
    purchaseFailure = error
  }

  func setEntitlementError(_ error: ErrorCode?) {
    entitlementFailure = error
  }

  func purchasedHandle() -> String? { lastPurchasedHandle }
}

private actor LoadRaceRevenueCatClient: RevenueCatClient {
  private var productContinuation:
    CheckedContinuation<
      [RevenueCatProductSnapshot], Never
    >?
  private var productRequestWaiters: [CheckedContinuation<Void, Never>] = []
  private var immediateProducts: [RevenueCatProductSnapshot]?
  private var lastPurchasedHandle: String?

  func products(identifiers: [String]) async -> [RevenueCatProductSnapshot] {
    if let immediateProducts {
      return immediateProducts.filter {
        identifiers.contains($0.providerProductIdentifier)
      }
    }
    return await withCheckedContinuation { continuation in
      productContinuation = continuation
      for waiter in productRequestWaiters {
        waiter.resume()
      }
      productRequestWaiters = []
    }
  }

  func packages(
    targets: [RevenueCatPackageTarget]
  ) -> [RevenueCatPackageTarget: RevenueCatProductSnapshot] {
    [:]
  }

  func purchase(handle: RevenueCatProductHandle) -> RevenueCatClientPurchaseResult {
    if case .test(let value) = handle {
      lastPurchasedHandle = value
    }
    return .purchased(transactionID: nil)
  }

  func restore() -> Set<String> { [] }

  func activeEntitlements() -> Set<String> { [] }

  func waitForProductRequest() async {
    guard productContinuation == nil else { return }
    await withCheckedContinuation { continuation in
      productRequestWaiters.append(continuation)
    }
  }

  func completeProductRequest(with products: [RevenueCatProductSnapshot]) {
    productContinuation?.resume(returning: products)
    productContinuation = nil
  }

  func useImmediateProducts(_ products: [RevenueCatProductSnapshot]) {
    immediateProducts = products
  }

  func purchasedHandle() -> String? { lastPurchasedHandle }
}
