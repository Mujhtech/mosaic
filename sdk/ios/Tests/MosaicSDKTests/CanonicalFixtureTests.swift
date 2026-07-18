import Foundation
import XCTest

@testable import MosaicSDK

final class CanonicalFixtureTests: XCTestCase {
  func testDecodesTheSoleRepositoryCanonicalFixtureDirectly() throws {
    let document = try canonicalDocument()
    let nodes = flattenedNodes(document.layout.content)

    XCTAssertEqual(document.schemaVersion, "0.1")
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(document.revision, 1)
    XCTAssertEqual(document.layout.type, .scrollContainer)
    XCTAssertEqual(document.layout.axis, .vertical)
    XCTAssertEqual(document.layout.safeArea, .respect)
    XCTAssertTrue(document.layout.showsIndicators)
    XCTAssertEqual(document.layout.content.spacing, 20)
    XCTAssertEqual(document.layout.content.padding.start, 24)
    XCTAssertEqual(document.layout.content.horizontalAlignment, .stretch)
    XCTAssertEqual(nodes.filter { $0.kind == .verticalStack }.count, 2)
    XCTAssertEqual(
      Set(nodes.map(\.kind)),
      Set([
        .verticalStack, .text, .image, .featureList, .productSelector,
        .purchaseButton, .restoreButton, .closeButton, .legalText,
      ])
    )
    XCTAssertEqual(document.assets.single?.source.key, "mosaic.paywall.hero")
    XCTAssertEqual(document.products.map(\.id), ["monthly-plan", "yearly-plan"])
    XCTAssertEqual(
      document.products.map(\.productId),
      ["mosaic_pro_monthly", "mosaic_pro_yearly"]
    )
    XCTAssertEqual(document.localization.locales["de"]?.direction, .leftToRight)
    XCTAssertEqual(document.localization.locales["ar"]?.direction, .rightToLeft)
    XCTAssertEqual(
      Set(document.compatibility.requiredCapabilities.map(\.name)),
      Set(MosaicCapabilityCatalog.v01)
    )
    XCTAssertEqual(MosaicSDKCapabilityReport.current.supportedSchemaVersions, ["0.1", "0.2"])
    XCTAssertEqual(
      Set(
        MosaicSDKCapabilityReport.current.capabilities
          .filter { $0.version == "0.1" }
          .map(\.name)
      ),
      Set(MosaicCapabilityCatalog.v01)
    )
  }

  func testPackagedResourceIsAByteIdenticalCopyOfCurrentV02Source() throws {
    let canonical = try v02FixtureURL().standardizedFileURL.resolvingSymlinksInPath()
    let packageResource =
      canonical
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("sdk/ios/Sources/MosaicSDK/Resources/v0.2/complete-paywall.json")

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
    try mutateFirstNode(type: "text", in: &unsupportedComponent) { node in
      node["type"] = "webView"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unsupportedComponent)))

    var unknownProperty = try canonicalFixtureObject()
    try mutateFirstNode(type: "purchaseButton", in: &unknownProperty) { node in
      node["platformCallback"] = "buy"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(unknownProperty)))
  }

  func testRejectsSemanticCapabilityIDActionAndLocalizationViolations() throws {
    var missingCapability = try canonicalFixtureObject()
    var compatibility = try XCTUnwrap(missingCapability["compatibility"] as? [String: Any])
    var capabilities = try XCTUnwrap(
      compatibility["requiredCapabilities"] as? [[String: Any]]
    )
    capabilities.removeAll { $0["name"] as? String == "component.legalText" }
    compatibility["requiredCapabilities"] = capabilities
    missingCapability["compatibility"] = compatibility
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(missingCapability)))

    var duplicateID = try canonicalFixtureObject()
    try mutateFirstNode(type: "legalText", in: &duplicateID) { node in
      node["id"] = "headline"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(duplicateID)))

    var invalidAction = try canonicalFixtureObject()
    try mutateFirstNode(type: "purchaseButton", in: &invalidAction) { node in
      node["action"] = ["type": "purchase", "productSelectorId": "missing-selector"]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(invalidAction)))

    var catalogMismatch = try canonicalFixtureObject()
    var localization = try XCTUnwrap(catalogMismatch["localization"] as? [String: Any])
    var locales = try XCTUnwrap(localization["locales"] as? [String: Any])
    var english = try XCTUnwrap(locales["en"] as? [String: Any])
    var strings = try XCTUnwrap(english["strings"] as? [String: Any])
    strings["paywall.headline"] = "Different default"
    english["strings"] = strings
    locales["en"] = english
    localization["locales"] = locales
    catalogMismatch["localization"] = localization
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(catalogMismatch)))
  }

  func testRejectsInvalidProductImageAndAccessibilityRelationships() throws {
    var invalidProduct = try canonicalFixtureObject()
    try mutateFirstNode(type: "productSelector", in: &invalidProduct) { node in
      node["initiallySelectedProductReferenceId"] = "missing-plan"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(invalidProduct)))

    var invalidImage = try canonicalFixtureObject()
    try mutateFirstNode(type: "image", in: &invalidImage) { node in
      node["assetId"] = "missing-image"
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(invalidImage)))

    var invalidAccessibility = try canonicalFixtureObject()
    try mutateFirstNode(type: "image", in: &invalidAccessibility) { node in
      node["accessibility"] = [
        "hidden": true,
        "label": ["default": "Hidden", "localizationKey": "paywall.hero.alt"],
      ]
    }
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(invalidAccessibility)))
  }

  func testAcceptsMathematicalIntegerSpellingsAndRejectsNumericBounds() throws {
    let integral = try canonicalFixtureReplacing(
      #""revision": 1"#,
      with: #""revision": 1.0"#
    )
    XCTAssertEqual(try MosaicProtocolDecoder.decode(integral).revision, 1)

    let maximum = try canonicalFixtureReplacing(
      #""revision": 1"#,
      with: #""revision": 2147483647"#
    )
    XCTAssertEqual(try MosaicProtocolDecoder.decode(maximum).revision, 2_147_483_647)

    let tooLarge = try canonicalFixtureReplacing(
      #""revision": 1"#,
      with: #""revision": 2147483648"#
    )
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(tooLarge))

    let nonFinite = try canonicalFixtureReplacing(
      #""spacing": 20"#,
      with: #""spacing": 1e400"#
    )
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(nonFinite))
  }
}

extension Collection {
  fileprivate var single: Element? { count == 1 ? first : nil }
}
