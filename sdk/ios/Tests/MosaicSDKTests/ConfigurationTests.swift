import Foundation
import XCTest

@testable import MosaicSDK

final class ConfigurationTests: XCTestCase {
  func testConfiguresIsolatedClient() throws {
    let provider = MockMosaicPurchaseProvider()
    let endpoint = try XCTUnwrap(URL(string: "http://localhost:8080"))
    let mosaic = try Mosaic.configure(
      apiKey: " public_test_key ",
      endpoint: endpoint,
      purchaseProvider: provider
    )

    XCTAssertEqual(mosaic.configuration.apiKey, "public_test_key")
    XCTAssertEqual(mosaic.configuration.endpoint, endpoint)
  }

  func testRejectsEmptyKeyAndRelativeEndpoint() throws {
    XCTAssertThrowsError(try MosaicConfiguration(apiKey: "  "))
    let relativeURL = try XCTUnwrap(URL(string: "/local"))
    XCTAssertThrowsError(
      try MosaicConfiguration(apiKey: "public_test_key", endpoint: relativeURL)
    )
  }
}
