import XCTest

@testable import MosaicSDK

final class MockPurchaseProviderTests: XCTestCase {
  func testAutomaticMockProviderReturnsExplicitCommerceResults() async {
    let provider = MockMosaicPurchaseProvider(products: [.phase1Yearly])

    let load = await provider.loadProducts(identifiers: ["mosaic_pro_yearly"])
    guard case .loaded(let products) = load else {
      return XCTFail("Expected an explicit loaded result.")
    }
    XCTAssertEqual(products.map(\.id), ["mosaic_pro_yearly"])

    guard case .purchased = await provider.purchase(productID: "mosaic_pro_yearly") else {
      return XCTFail("Expected an explicit purchased result.")
    }
    guard case .alreadyEntitled = await provider.purchase(productID: "mosaic_pro_yearly") else {
      return XCTFail("Expected an explicit alreadyEntitled result.")
    }
    guard case .restored = await provider.restore() else {
      return XCTFail("Expected an explicit restored result.")
    }
    guard case .available = await provider.activeEntitlements() else {
      return XCTFail("Expected explicit available entitlements.")
    }
  }

  func testMockProviderReturnsAvailableSubsetAndAllFailureScenarios() async {
    let provider = MockMosaicPurchaseProvider(
      products: [.phase1Monthly],
      purchaseBehavior: .failure(diagnosticCode: "mock_purchase_failed"),
      restoreBehavior: .failure(diagnosticCode: "mock_restore_failed")
    )

    let load = await provider.loadProducts(
      identifiers: ["mosaic_pro_monthly", "mosaic_pro_yearly"]
    )
    guard case .loaded(let products) = load else {
      return XCTFail("Expected the available subset.")
    }
    XCTAssertEqual(products.map(\.id), ["mosaic_pro_monthly"])

    let failedPurchase = await provider.purchase(productID: "mosaic_pro_monthly")
    guard case .failed(let productID, let diagnosticCode, let diagnostic) = failedPurchase else {
      return XCTFail("Expected a complete mock purchase failure.")
    }
    XCTAssertEqual(productID, "mosaic_pro_monthly")
    XCTAssertEqual(diagnosticCode, diagnostic.code)
    XCTAssertEqual(diagnostic.code, "mock_purchase_failed")
    XCTAssertEqual(diagnostic.safeMessage, "The mock purchase failed.")
    XCTAssertEqual(diagnostic.providerCode, "mock_configured_failure")
    XCTAssertEqual(diagnostic.mosaicProductID, "mosaic_pro_monthly")
    XCTAssertEqual(diagnostic.recoveryAction, .none)
    XCTAssertTrue(diagnostic.correlationID.hasPrefix("ios_mock_purchase_"))
    let unavailablePurchase = await provider.purchase(productID: "missing")
    XCTAssertEqual(
      unavailablePurchase,
      .productUnavailable(productID: "missing")
    )
    let failedRestore = await provider.restore()
    guard case .failed(let diagnosticCode, let diagnostic) = failedRestore else {
      return XCTFail("Expected a complete mock restore failure.")
    }
    XCTAssertEqual(diagnosticCode, diagnostic.code)
    XCTAssertEqual(diagnostic.code, "mock_restore_failed")
    XCTAssertEqual(diagnostic.safeMessage, "The mock restore failed.")
    XCTAssertEqual(diagnostic.providerCode, "mock_configured_failure")
    XCTAssertNil(diagnostic.mosaicProductID)
    XCTAssertEqual(diagnostic.recoveryAction, .none)
    XCTAssertTrue(diagnostic.correlationID.hasPrefix("ios_mock_restore_"))
  }

  func testMockProviderSupportsCancellationAlreadyEntitledAndRestoreVariants() async {
    let cancellation = MockMosaicPurchaseProvider(
      products: [.phase1Yearly],
      purchaseBehavior: .cancellation
    )
    let cancelledPurchase = await cancellation.purchase(productID: "mosaic_pro_yearly")
    XCTAssertEqual(
      cancelledPurchase,
      .cancelled(productID: "mosaic_pro_yearly")
    )

    let already = MockMosaicPurchaseProvider(
      products: [.phase1Yearly],
      purchaseBehavior: .alreadyEntitled,
      restoreBehavior: .alreadyEntitled([MosaicEntitlement(id: "pro")])
    )
    let entitledPurchase = await already.purchase(productID: "mosaic_pro_yearly")
    XCTAssertEqual(
      entitledPurchase,
      .alreadyEntitled(productID: "mosaic_pro_yearly")
    )
    guard case .restored = await already.restore() else {
      return XCTFail("Expected legacy already-entitled input to normalize to restored.")
    }

    let empty = MockMosaicPurchaseProvider(restoreBehavior: .noPurchases)
    let emptyRestore = await empty.restore()
    XCTAssertEqual(emptyRestore, .nothingToRestore)
  }
}
