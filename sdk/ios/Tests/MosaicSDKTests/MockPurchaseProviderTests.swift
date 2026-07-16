import XCTest

@testable import MosaicSDK

final class MockPurchaseProviderTests: XCTestCase {
  func testMockProviderReturnsExplicitCommerceResults() async {
    let provider = MockMosaicPurchaseProvider(
      products: [
        MosaicProduct(
          id: "mosaic_pro_yearly",
          title: "Mosaic Pro Yearly",
          localizedPrice: "$49.99"
        )
      ]
    )

    let load = await provider.loadProducts(identifiers: ["mosaic_pro_yearly"])
    guard case .loaded(let products) = load else {
      return XCTFail("Expected an explicit loaded result.")
    }
    XCTAssertEqual(products.map(\.id), ["mosaic_pro_yearly"])

    let purchase = await provider.purchase(productID: "mosaic_pro_yearly")
    guard case .purchased = purchase else {
      return XCTFail("Expected an explicit purchased result.")
    }

    let repeated = await provider.purchase(productID: "mosaic_pro_yearly")
    guard case .alreadyEntitled = repeated else {
      return XCTFail("Expected an explicit alreadyEntitled result.")
    }

    let restore = await provider.restore()
    guard case .restored = restore else {
      return XCTFail("Expected an explicit restored result.")
    }

    let active = await provider.activeEntitlements()
    guard case .active = active else {
      return XCTFail("Expected explicit active entitlements.")
    }
  }

  func testMockProviderReportsUnavailableAndEmptyStates() async {
    let provider = MockMosaicPurchaseProvider()

    let load = await provider.loadProducts(identifiers: ["missing"])
    guard case .unavailable = load else {
      return XCTFail("Expected unavailable products.")
    }

    let purchase = await provider.purchase(productID: "missing")
    guard case .productUnavailable = purchase else {
      return XCTFail("Expected productUnavailable.")
    }

    let restore = await provider.restore()
    XCTAssertEqual(restore, .nothingToRestore)
  }
}
