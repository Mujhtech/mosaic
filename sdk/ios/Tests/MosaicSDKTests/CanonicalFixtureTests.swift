import Foundation
import XCTest

@testable import MosaicSDK

final class CanonicalFixtureTests: XCTestCase {
  func testDecodesTheSoleRepositoryCanonicalFixtureDirectly() throws {
    let document = try canonicalDocument()

    XCTAssertEqual(document.schemaVersion, "0.3")
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(document.initialScreenId, "offer")
    XCTAssertEqual(document.screens.map(\.id), ["offer", "details"])
    XCTAssertEqual(document.screens.map { $0.presentation?.type }, [.screen, .sheet])
    // The SDK reads both contracts, and reports each one's capabilities against
    // the version they belong to: `style.productCardStates` exists in `0.3` and
    // not in `0.4`, so a merged set could not describe either.
    XCTAssertEqual(MosaicSDKCapabilityReport.current.supportedSchemaVersions, ["0.3", "0.4"])
    XCTAssertEqual(
      Set(
        MosaicSDKCapabilityReport.current.capabilities
          .filter { $0.version == "0.3" }
          .map(\.name)
      ),
      Set(MosaicCapabilityCatalog.v03)
    )
  }

  func testPackagedResourceIsAByteIdenticalCopyOfCurrentV03Source() throws {
    let canonical = try v03FixtureURL().standardizedFileURL.resolvingSymlinksInPath()
    let packageResource =
      canonical
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("sdk/ios/Sources/MosaicSDK/Resources/v0.3/complete-paywall.json")

    let values = try packageResource.resourceValues(forKeys: [
      .isRegularFileKey, .isSymbolicLinkKey,
    ])
    XCTAssertEqual(values.isRegularFile, true)
    XCTAssertEqual(values.isSymbolicLink, false)
    XCTAssertEqual(try Data(contentsOf: packageResource), try Data(contentsOf: canonical))
  }

  func testRejectsUnknownSchemaComponentAndPropertyAtomically() throws {
    var unsupportedVersion = try canonicalFixtureObject()
    unsupportedVersion["schemaVersion"] = "9.9"
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unsupportedVersion))) { error in
      XCTAssertEqual(error as? MosaicProtocolError, .unsupportedSchemaVersion("9.9"))
    }

    var unsupportedComponent = try canonicalFixtureObject()
    try mutateFirstV03Node(type: "text", in: &unsupportedComponent) { node in
      node["type"] = "webView"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unsupportedComponent)))

    var unknownProperty = try canonicalFixtureObject()
    try mutateFirstV03Node(type: "button", in: &unknownProperty) { node in
      node["swiftUIView"] = "Text"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unknownProperty)))
  }
}
