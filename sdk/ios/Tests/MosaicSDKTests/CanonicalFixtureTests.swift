import Foundation
import XCTest

@testable import MosaicSDK

final class CanonicalFixtureTests: XCTestCase {
  func testDecodesRepositoryCanonicalProtocolFixture() throws {
    let data = try Data(contentsOf: canonicalFixtureURL())
    let document = try MosaicProtocolDecoder.decode(data)

    XCTAssertEqual(document.schemaVersion, "0.1")
    XCTAssertEqual(document.id, "minimal-paywall")
    XCTAssertEqual(document.revision, 1)
    XCTAssertEqual(document.layout.type, .vertical)
    XCTAssertEqual(document.layout.id, "root-layout")
    XCTAssertEqual(document.layout.gap, 16)
    XCTAssertEqual(document.layout.padding, 24)
    XCTAssertEqual(
      Set(document.compatibility.requiredCapabilities.map(\.name)),
      Set(MosaicCapabilityName.allCases)
    )
    XCTAssertEqual(
      document.layout.children.map(\.kind),
      [
        .closeButton,
        .text,
        .featureList,
        .productSelector,
        .purchaseButton,
        .restoreButton,
        .legalText,
      ]
    )

    guard case .closeButton(let close) = document.layout.children[0] else {
      return XCTFail("Expected closeButton at canonical fixture index 0.")
    }
    XCTAssertEqual(close.label.defaultValue, "Close")

    guard case .text(let text) = document.layout.children[1] else {
      return XCTFail("Expected text at canonical fixture index 1.")
    }
    XCTAssertEqual(text.value.localizationKey, "paywall.headline")

    guard case .featureList(let features) = document.layout.children[2] else {
      return XCTFail("Expected featureList at canonical fixture index 2.")
    }
    XCTAssertEqual(
      features.items.map(\.id),
      ["unlimited-projects", "priority-support"]
    )

    guard case .productSelector(let selector) = document.layout.children[3] else {
      return XCTFail("Expected productSelector at canonical fixture index 3.")
    }
    XCTAssertEqual(selector.initiallySelectedProductId, "mosaic_pro_yearly")
    XCTAssertEqual(
      selector.products.map(\.productId),
      ["mosaic_pro_monthly", "mosaic_pro_yearly"]
    )
  }

  func testRejectsFieldsOutsideFrozenProtocolSchema() throws {
    var object = try canonicalFixtureObject()
    object["platform"] = "swiftui"
    let mutated = try JSONSerialization.data(withJSONObject: object)

    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(mutated)) { error in
      XCTAssertTrue(error is MosaicProtocolError)
    }
  }

  func testRejectsCapabilitiesThatDoNotMatchDocumentContent() throws {
    var object = try canonicalFixtureObject()
    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    var capabilities = try XCTUnwrap(
      compatibility["requiredCapabilities"] as? [[String: Any]]
    )
    capabilities.removeAll { capability in
      capability["name"] as? String == "component.legalText"
    }
    compatibility["requiredCapabilities"] = capabilities
    object["compatibility"] = compatibility

    let mutated = try JSONSerialization.data(withJSONObject: object)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(mutated))
  }

  func testRejectsInvalidProductSelectorRelationships() throws {
    var missingSelection = try canonicalFixtureObject()
    try mutateProductSelector(in: &missingSelection) { selector in
      selector["initiallySelectedProductId"] = "not_declared"
    }
    let missingSelectionData = try JSONSerialization.data(withJSONObject: missingSelection)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(missingSelectionData))

    var duplicateProduct = try canonicalFixtureObject()
    try mutateProductSelector(in: &duplicateProduct) { selector in
      var products = selector["products"] as? [[String: Any]] ?? []
      if let first = products.first {
        products.append(first)
      }
      selector["products"] = products
    }
    let duplicateProductData = try JSONSerialization.data(withJSONObject: duplicateProduct)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(duplicateProductData))
  }

  func testRejectsSchemaScalarConstraintViolations() throws {
    var object = try canonicalFixtureObject()
    object["revision"] = 0

    let mutated = try JSONSerialization.data(withJSONObject: object)
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(mutated))
  }

  func testAcceptsIntegralRevisionSpellingsWithinThe32BitRange() throws {
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
  }

  func testRejectsRevisionsAboveThe32BitRange() throws {
    let source = try canonicalFixtureReplacing(
      #""revision": 1"#,
      with: #""revision": 2147483648"#
    )

    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(source))
  }

  func testRejectsNonFiniteLayoutNumbers() throws {
    let source = try canonicalFixtureReplacing(
      #""gap": 16"#,
      with: #""gap": 1e400"#
    )

    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(source))
  }
}

private func canonicalFixtureObject() throws -> [String: Any] {
  let data = try Data(contentsOf: canonicalFixtureURL())
  guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return object
}

private func canonicalFixtureReplacing(
  _ original: String,
  with replacement: String
) throws -> String {
  let source = try String(contentsOf: canonicalFixtureURL(), encoding: .utf8)
  guard source.contains(original) else {
    throw CanonicalFixtureLookupError.invalidShape
  }
  return source.replacingOccurrences(of: original, with: replacement)
}

private func mutateProductSelector(
  in object: inout [String: Any],
  mutation: (inout [String: Any]) -> Void
) throws {
  guard
    var layout = object["layout"] as? [String: Any],
    var children = layout["children"] as? [[String: Any]],
    let selectorIndex = children.firstIndex(where: { $0["type"] as? String == "productSelector" })
  else {
    throw CanonicalFixtureLookupError.invalidShape
  }

  mutation(&children[selectorIndex])
  layout["children"] = children
  object["layout"] = layout
}

private func canonicalFixtureURL(filePath: StaticString = #filePath) throws -> URL {
  let fileManager = FileManager.default
  var directory = URL(fileURLWithPath: "\(filePath)").deletingLastPathComponent()

  while directory.path != "/" {
    let candidate =
      directory
      .appendingPathComponent("protocol")
      .appendingPathComponent("fixtures")
      .appendingPathComponent("v0.1")
      .appendingPathComponent("minimal-paywall.json")
    if fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }
    directory.deleteLastPathComponent()
  }

  throw CanonicalFixtureLookupError.notFound
}

private enum CanonicalFixtureLookupError: Error {
  case invalidShape
  case notFound
}
