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
    guard case .active = await provider.activeEntitlements() else {
      return XCTFail("Expected explicit active entitlements.")
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
    XCTAssertEqual(
      failedPurchase,
      .failed(productID: "mosaic_pro_monthly", diagnosticCode: "mock_purchase_failed")
    )
    let unavailablePurchase = await provider.purchase(productID: "missing")
    XCTAssertEqual(
      unavailablePurchase,
      .productUnavailable(productID: "missing")
    )
    let failedRestore = await provider.restore()
    XCTAssertEqual(
      failedRestore,
      .failed(diagnosticCode: "mock_restore_failed")
    )
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
    guard case .alreadyEntitled = await already.restore() else {
      return XCTFail("Expected an already-entitled restore.")
    }

    let empty = MockMosaicPurchaseProvider(restoreBehavior: .noPurchases)
    let emptyRestore = await empty.restore()
    XCTAssertEqual(emptyRestore, .nothingToRestore)
  }
}
