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

  // Risk: migration readiness cannot exclude an incompatible app if iOS omits
  // its application/version identity. Bundle defaults keep reporting automatic;
  // explicit overrides keep tests, extensions, and self-hosted apps deterministic.
  func testApplicationAndVersionReportingUseSafeDefaultsAndValidatedOverrides() throws {
    let automatic = try MosaicConfiguration(apiKey: "pk_test")
    XCTAssertFalse(automatic.applicationID.isEmpty)
    XCTAssertFalse(automatic.applicationVersion?.isEmpty ?? true)

    let overridden = try MosaicConfiguration(
      apiKey: "pk_test",
      applicationID: "com.example.mosaic",
      applicationVersion: "4.2.0")
    XCTAssertEqual(overridden.applicationID, "com.example.mosaic")
    XCTAssertEqual(overridden.applicationVersion, "4.2.0")

    XCTAssertThrowsError(
      try MosaicConfiguration(apiKey: "pk_test", applicationID: "*"))
    XCTAssertThrowsError(
      try MosaicConfiguration(apiKey: "pk_test", applicationVersion: "bad version"))
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
      case .paywallSelected(_, _, _, _, _, let resolvedSource, let trace) = await mosaic.decision(
        placement: "onboarding_complete")
    else {
      return XCTFail("The packaged fallback must resolve its declared Placement.")
    }
    XCTAssertEqual(resolvedSource, .bundled)
    // The fallback carries no decision rule set, so it is selected as the
    // fallback rather than by a rule.
    XCTAssertEqual(trace.steps.map(\.code), ["bundled_fallback_selected"])
  }

  /// The decision context used to hardcode every provider capability as
  /// available, so a Placement rule gated on a capability the adapter does not
  /// implement matched anyway. The adapter is now asked.
  func testProviderCapabilitiesComeFromTheAdapterInsteadOfBeingAssumed() {
    XCTAssertEqual(
      Mosaic.decisionCapabilities([.productLoad, .purchase, .restore, .entitlementLookup]),
      [
        "product_loading": .available, "purchase": .available, "restore": .available,
        "entitlement_lookup": .available,
      ])

    XCTAssertEqual(
      Mosaic.decisionCapabilities([.productLoad, .purchase]),
      [
        "product_loading": .available, "purchase": .available, "restore": .unavailable,
        "entitlement_lookup": .unavailable,
      ])
  }
}
