import SwiftUI
import XCTest

@testable import MosaicSDK

@available(macOS 10.15, *)
final class SwiftUIConsumerCompilationTests: XCTestCase {
  func testConfiguredClientCanBeOwnedBySwiftUIView() throws {
    let mosaic = try Mosaic.configure(
      apiKey: "public_test_key",
      purchaseProvider: MockMosaicPurchaseProvider()
    )

    let view = SwiftUIConsumerView(mosaic: mosaic)
    XCTAssertEqual(view.mosaic.configuration.apiKey, "public_test_key")
  }
}

@available(macOS 10.15, *)
private struct SwiftUIConsumerView: View {
  let mosaic: Mosaic

  var body: some View {
    Text("Configured \(mosaic.configuration.apiKey)")
  }
}
