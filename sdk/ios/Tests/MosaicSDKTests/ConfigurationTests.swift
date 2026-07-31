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

  /// Unreachable local persistence must not fail the host application's
  /// launch. The SDK degrades to process-lifetime storage, still resolves the
  /// bundled fallback, and reports one safe diagnostic.
  func testUnreachablePersistenceDegradesInsteadOfFailingConfigure() async throws {
    // Port 1 is reserved, so remote delivery fails without a live server.
    let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:1"))
    let mosaic = try await Mosaic.configureHosted(
      publicSDKKey: "public_degraded_key",
      baseURL: baseURL,
      applicationVersion: nil,
      requestTimeout: 1,
      bundledFallback: .packaged,
      purchaseProvider: MockMosaicPurchaseProvider(),
      persistenceRoot: .unavailable
    )

    guard case .available(_, let source, let diagnostics) = await mosaic.configurationStatus()
    else {
      return XCTFail("Bundled fallback must remain reachable without local persistence.")
    }
    XCTAssertEqual(source, .bundled)
    XCTAssertTrue(
      diagnostics.contains(
        MosaicDiagnostic(code: "delivery_persistence_unavailable", stage: .cache)))

    // The packaged fallback must yield a renderable Paywall, not just accepted
    // metadata. It is synthesized at runtime, so a shape or digest regression
    // is otherwise invisible until a host loses connectivity.
    guard
      case .resolved(_, _, _, let resolvedSource) = await mosaic.resolve(
        placement: "onboarding_complete")
    else {
      return XCTFail("The packaged fallback must resolve its declared Placement.")
    }
    XCTAssertEqual(resolvedSource, .bundled)
  }
}
