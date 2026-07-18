import Foundation
import XCTest

@testable import MosaicSDK

final class PaywallLoaderTests: XCTestCase {
  func testValidLocalCandidateWinsWithoutFallback() throws {
    let result = MosaicPaywallLoader.load(
      candidateData: try canonicalFixtureData(),
      bundledFallback: .data(Data("invalid".utf8))
    )

    guard case .loaded(let document, let source, let diagnostics) = result else {
      return XCTFail("Expected the valid local candidate.")
    }
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(source, .localCandidate)
    XCTAssertTrue(diagnostics.isEmpty)
  }

  func testRejectedPrimaryLoadsCanonicalBundledFallbackAtomically() throws {
    let result = MosaicPaywallLoader.load(
      candidateData: Data(#"{"schemaVersion":"0.1"}"#.utf8),
      bundledFallback: .data(try canonicalFixtureData())
    )

    guard case .loaded(let document, let source, let diagnostics) = result else {
      return XCTFail("Expected the bundled fallback.")
    }
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(source, .bundledFallback)
    XCTAssertEqual(
      diagnostics,
      [MosaicDiagnostic(code: "primary_document_rejected", stage: .candidateValidation)]
    )
  }

  func testPackagedCanonicalFallbackLoadsWhenCandidateIsAbsent() {
    let result = MosaicPaywallLoader.load(candidateData: nil)

    guard case .loaded(let document, let source, let diagnostics) = result else {
      return XCTFail("Expected the packaged canonical fallback.")
    }
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(document.schemaVersion, "0.2")
    XCTAssertEqual(document.productSelectors.count, 1)
    XCTAssertEqual(document.productSelectors.first?.direction, .horizontal)
    XCTAssertEqual(source, .bundledFallback)
    XCTAssertTrue(diagnostics.isEmpty)
  }

  func testInvalidOrMissingFallbackReturnsConfigurationUnavailable() {
    let invalid = MosaicPaywallLoader.load(
      candidateData: Data("invalid".utf8),
      bundledFallback: .data(Data("also invalid".utf8))
    )
    guard case .unavailable(let result, let diagnostics) = invalid else {
      return XCTFail("Expected configurationUnavailable.")
    }
    XCTAssertEqual(result, .configurationUnavailable)
    XCTAssertEqual(
      diagnostics.map(\.code),
      ["primary_document_rejected", "bundled_fallback_rejected"]
    )

    let missing = MosaicPaywallLoader.load(
      candidateData: nil,
      bundledFallback: .data(nil)
    )
    guard case .unavailable(let missingResult, let missingDiagnostics) = missing else {
      return XCTFail("Expected configurationUnavailable for a missing fallback.")
    }
    XCTAssertEqual(missingResult, .configurationUnavailable)
    XCTAssertEqual(missingDiagnostics.map(\.code), ["bundled_fallback_missing"])
  }
}
