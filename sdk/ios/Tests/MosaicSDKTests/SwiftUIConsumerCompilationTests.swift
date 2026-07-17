import SwiftUI
import XCTest

@testable import MosaicSDK

@MainActor
final class SwiftUIConsumerCompilationTests: XCTestCase {
  func testCanonicalDocumentBuildsPublicSwiftUIViewAPI() throws {
    let document = try canonicalDocument()
    let view = MosaicPaywall(
      document: document,
      requestedLocale: "en",
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts
      ),
      imageResolver: .missing,
      onInteraction: { _ in },
      onResult: { _ in }
    )

    XCTAssertNotNil(view.body)
  }

  func testConfiguredClientRemainsUsableAlongsideRenderer() throws {
    let mosaic = try Mosaic.configure(
      apiKey: "public_test_key",
      purchaseProvider: MockMosaicPurchaseProvider()
    )

    XCTAssertEqual(mosaic.configuration.apiKey, "public_test_key")
    XCTAssertTrue(mosaic.purchaseProvider is MockMosaicPurchaseProvider)
  }
}
