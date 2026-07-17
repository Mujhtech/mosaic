import XCTest

@testable import MosaicSDK

final class LocalPreviewCommerceTests: XCTestCase {
  func testCanonicalMockCommerceDrivesProductsPurchaseRestoreAndEntitlements() async throws {
    let document = try canonicalDocument()
    let state = try canonicalCommerceState()
    let provider = MosaicPreviewPurchaseProvider()
    await provider.apply(state: state, document: document)

    let products = await provider.loadProducts(
      identifiers: ["mosaic_pro_monthly", "mosaic_pro_yearly"]
    )
    guard case .loaded(let loaded) = products else {
      return XCTFail("Expected canonical mock products")
    }
    XCTAssertEqual(loaded.map(\.id), ["mosaic_pro_monthly", "mosaic_pro_yearly"])
    XCTAssertEqual(loaded.map(\.localizedPrice), ["$9.99", "$79.99"])
    XCTAssertEqual(loaded.map(\.localizedSubscriptionPeriod), ["per month", "per year"])

    let purchase = await provider.purchase(productID: "mosaic_pro_yearly")
    guard case .purchased(let productID, let transactionID) = purchase else {
      return XCTFail("Expected purchased")
    }
    XCTAssertEqual(productID, "mosaic_pro_yearly")
    XCTAssertEqual(transactionID, "preview-yearly-plan")
    let entitlements = await provider.activeEntitlements()
    XCTAssertEqual(entitlements, .active([MosaicEntitlement(id: "mosaic_pro_yearly")]))

    let restore = await provider.restore()
    XCTAssertEqual(restore, .restored([MosaicEntitlement(id: "mosaic_pro_yearly")]))
  }

  func testMockOutcomesRemainExplicitAndUnavailableProductsFailSafely() async throws {
    let document = try canonicalDocument()
    let provider = MosaicPreviewPurchaseProvider()
    let state = MosaicPreviewMockCommerceState(
      products: [
        .unavailable(productReferenceId: "monthly-plan", reason: .temporarilyUnavailable),
        .subscription(
          productReferenceId: "yearly-plan",
          localizedPrice: "$49.99",
          currencyCode: "USD",
          billingPeriod: MosaicPreviewPeriod(unit: .year, value: 1),
          trialPeriod: nil,
          introductoryOffer: nil
        ),
      ],
      purchaseOutcome: .cancelled,
      restoreOutcome: .restoreFailed,
      entitlement: .none
    )
    await provider.apply(state: state, document: document)

    let unavailablePurchase = await provider.purchase(productID: "mosaic_pro_monthly")
    XCTAssertEqual(
      unavailablePurchase,
      .productUnavailable(productID: "mosaic_pro_monthly")
    )
    let cancelledPurchase = await provider.purchase(productID: "mosaic_pro_yearly")
    XCTAssertEqual(cancelledPurchase, .cancelled(productID: "mosaic_pro_yearly"))
    let restore = await provider.restore()
    XCTAssertEqual(restore, .failed(diagnosticCode: "preview.restore.failed"))
  }

  private func canonicalCommerceState() throws -> MosaicPreviewMockCommerceState {
    let message = try MosaicPreviewMessageCodec().decode(
      localPreviewMessageSource(at: 2),
      expectedSessionId: "session_phase2_demo"
    )
    guard case .mockCommerceStateChanged(let update) = message.message else {
      throw CanonicalFixtureLookupError.invalidShape
    }
    return update.state
  }
}
