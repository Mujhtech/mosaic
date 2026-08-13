import Foundation
import SwiftUI
import XCTest

@testable import MosaicSDK

/// Motion decoding, validation, and capability reporting.
///
/// The rest of the contract is covered by `ProtocolConformanceTests` and
/// `ProtocolPresentationTests`; this suite covers the motion vocabulary, the
/// capability handshake, and the version gate at the reader's entry point.
final class ProtocolMotionTests: XCTestCase {

  /// Every published `0.4` document decodes, and the canonical one carries the
  /// motion it was built to carry.
  ///
  /// Protects the contract's central compatibility claim — "0.4 is 0.3 plus
  /// motion minus one capability" — end to end through this reader.
  func testCanonicalV04FixtureDecodesWithItsAuthoredMotion() throws {
    let document = try v04Document()
    XCTAssertEqual(document.schemaVersion, "0.4")

    let motions = try XCTUnwrap(document.designSystem?.motions)
    XCTAssertEqual(motions.map(\.id), [
      "motion-entrance", "motion-entrance-alias", "motion-selection", "motion-pulse",
    ])
    // A token may reference another token, and the reference resolves through
    // the chain to one inline value.
    XCTAssertEqual(
      document.resolvedMotionCurve(.token("motion-entrance-alias")),
      MosaicResolvedMotionCurve(durationMilliseconds: 240, easing: .decelerate)
    )

    let byID = Dictionary(
      uniqueKeysWithValues: document.allNodes.map { ($0.id, $0) })
    guard case .fadeRise = try XCTUnwrap(byID["headline"]?.motion?.appear?.effect) else {
      return XCTFail("Expected the headline to rise.")
    }
    XCTAssertEqual(byID["headline"]?.motion?.appear?.riseLogicalSize, 12)
    // Stagger is authored as a delay on each sibling; there is no stagger sugar.
    XCTAssertEqual(byID["subtitle"]?.motion?.appear?.delayMilliseconds, 80)
    XCTAssertNotNil(byID["plans"]?.motion?.selection)
    XCTAssertNotNil(byID["billing-tabs"]?.motion?.selection)

    let loop = try XCTUnwrap(byID["purchase"]?.motion?.loop)
    XCTAssertEqual(loop.effect, .pulse)
    XCTAssertEqual(loop.scaleAmplitude, 0.04)
    XCTAssertEqual(loop.repeatCount, 3)
  }

  func testEveryPublishedV04DocumentFixtureDecodes() throws {
    // The corpora that travel beside the documents are not documents: they carry
    // frames, announcements, and locale vectors rather than a `schemaVersion`.
    let corpora: Set<String> = [
      "motion-frames.json", "accessibility-announcement.json",
      "rating-announcement.json", "locale-resolution.json",
    ]
    let names = try v04FixtureNames(in: ".").filter { !corpora.contains($0) }
    XCTAssertEqual(names.count, 6)
    for name in names {
      XCTAssertNoThrow(try v04Document(named: name), name)
    }
  }

  /// Every invalid fixture is rejected, at the layer the protocol says rejects
  /// it.
  ///
  /// Protects more than "bad documents throw": `rejection-layers.json` records
  /// whether the schema alone or a semantic rule catches each case, so this also
  /// proves the shape gate and the semantic gate are drawn in the same places
  /// here as in the reference implementation. A rule quietly migrating between
  /// the two layers is exactly how three renderers drift apart.
  func testEveryInvalidV04FixtureIsRejectedAtItsRecordedLayer() throws {
    guard
      let layers = try JSONSerialization.jsonObject(
        with: v04FixtureData(named: "invalid/rejection-layers.json")) as? [String: Any],
      let expected = layers["layers"] as? [String: String]
    else { throw CanonicalFixtureLookupError.invalidShape }
    XCTAssertEqual(expected.count, 20)

    for (name, layer) in expected {
      let data = try v04FixtureData(named: "invalid/\(name)")
      XCTAssertThrowsError(try MosaicProtocolDecoder.decode(data), name) { error in
        guard let error = error as? MosaicProtocolError else {
          return XCTFail("\(name) threw \(error)")
        }
        switch (layer, error) {
        case ("schema", .invalidShape), ("semantic", .semanticViolation),
          ("semantic", .unsupportedCapability), ("semantic", .duplicateCapability):
          break
        default:
          XCTFail("\(name) is recorded as \(layer) but was rejected by \(error)")
        }
      }
    }
  }

  /// `style.productCardStates` is gone, and one marker union serves both
  /// components.
  func testRemovedProductCardStatesIsRejectedAndTheMarkerVocabularyIsConsolidated() throws {
    let document = try v04Document()
    // A document that declares the removed capability is rejected as an unknown
    // capability rather than tolerated.
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any])
    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    var capabilities = try XCTUnwrap(
      compatibility["requiredCapabilities"] as? [[String: Any]])
    capabilities.append(["name": "style.productCardStates", "version": "0.4"])
    compatibility["requiredCapabilities"] = capabilities
    object["compatibility"] = compatibility
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(JSONSerialization.data(withJSONObject: object))
    ) { error in
      XCTAssertEqual(
        (error as? MosaicProtocolError)?.diagnosticCode, "protocol_unsupported_capability")
    }

    // One marker union, used by both components, with a per-item override.
    guard case .featureList(let features) = document.allNodes.first(where: { $0.id == "features" })
    else { return XCTFail("Expected the canonical feature list.") }
    XCTAssertEqual(features.marker, .icon(name: .checkmark))
    XCTAssertEqual(features.items.map(\.marker), [nil, .ordinal, .icon(name: .close)])
    // An absent item marker carries the list's marker. It is never a request for
    // no glyph.
    XCTAssertEqual(features.marker(for: features.items[0]), .icon(name: .checkmark))
    XCTAssertEqual(features.marker(for: features.items[2]), .icon(name: .close))
  }

  /// The renderer draws the marker each item resolves to, not a constant.
  ///
  /// The test above proves the model decodes the union; this one proves the view
  /// reads it. They are separate risks and the second is the one that shipped
  /// broken: the Feature List decoded all three markers correctly and then drew a
  /// hardcoded checkmark for every row, so the fixture's ordinal came out as a
  /// tick and its "not included" row, authored as `icon: close`, came out
  /// claiming the opposite of what it said.
  ///
  /// Asserted on the resolution `body` reads rather than on pixels, because the
  /// failure is a wrong glyph rather than a wrong layout, and because the golden
  /// that would have caught it can only run on a Simulator.
  @MainActor
  func testFeatureListRendersTheMarkerEachItemResolvesTo() throws {
    let document = try v04Document()
    guard case .featureList(let component) = document.allNodes.first(where: { $0.id == "features" })
    else { return XCTFail("Expected the canonical feature list.") }
    let view = MosaicFeatureListView(
      component: component,
      localization: MosaicLocalizationResolver(
        localization: document.localization, requestedLocale: "en")
    )
    XCTAssertEqual(
      (0..<component.items.count).map(view.marker(at:)),
      [.icon(name: .checkmark), .ordinal, .icon(name: .close)]
    )

    // Every glyph is drawn at the component's size, never per item: an item
    // overrides which glyph it draws, not how large.
    XCTAssertEqual(component.markerSize, 18)
    XCTAssertEqual(component.markerExtent, 18)
    // Absent, it falls back to the list's own typography rather than to a
    // renderer constant — the fallback that let Flutter draw 20 while Compose
    // drew the font size.
    XCTAssertEqual(component.typography.fontSize, 16)
    XCTAssertEqual(try featureListWithoutMarkerSize().markerExtent, 16)
  }

  /// The canonical feature list with its authored `markerSize` removed, so the
  /// optional field's default branch is exercised rather than described.
  private func featureListWithoutMarkerSize() throws -> MosaicFeatureListComponent {
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any])
    try mutateNode(id: "features", in: &object) { node in
      node.removeValue(forKey: "markerSize")
    }
    let document = try MosaicProtocolDecoder.decode(
      JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
    guard case .featureList(let component) = document.allNodes.first(where: { $0.id == "features" })
    else { throw CanonicalFixtureLookupError.invalidShape }
    return component
  }

  /// Versions are exact identifiers, in both directions.
  ///
  /// Version identifiers are exact, and every version but `0.4` is refused.
  ///
  /// Protects the single-version rule (ADR-0028) at the one place it is
  /// enforced. The retired predecessor is named explicitly because a reader that
  /// silently accepted it — by numeric ordering, or by tolerating a document
  /// whose body happens to still parse — is the exact failure the exact-identifier
  /// rule exists to prevent.
  func testOnlyTheCurrentContractVersionIsRead() throws {
    for version in ["0.3", "0.5", "1.0", ""] {
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any])
      object["schemaVersion"] = version
      XCTAssertThrowsError(
        try MosaicProtocolDecoder.decode(JSONSerialization.data(withJSONObject: object)),
        version
      ) { error in
        XCTAssertEqual(
          error as? MosaicProtocolError, .unsupportedSchemaVersion(version), version)
      }
    }

    XCTAssertEqual(try v04Document().schemaVersion, mosaicProtocolVersion)
  }

  /// Capability reporting covers the one contract, motion included.
  ///
  /// Protects the compatibility handshake: a reader that renders motion but does
  /// not say so is indistinguishable from one that cannot, and the enhancement
  /// tier's whole point is that the difference is visible.
  func testCapabilityReportCoversTheContractIncludingMotion() {
    let report = MosaicSDKCapabilityReport.current
    XCTAssertEqual(report.supportedSchemaVersions, [mosaicProtocolVersion])

    XCTAssertTrue(report.capabilities.allSatisfy { $0.version == mosaicProtocolVersion })
    let names = Set(report.capabilities.map(\.name))
    XCTAssertEqual(names, Set(MosaicCapabilityCatalog.current))
    XCTAssertTrue(names.isSuperset(of: MosaicCapabilityCatalog.motion))
  }

  /// Declared capabilities are derived from what the document actually authors,
  /// in both directions.
  ///
  /// Protects the enhancement tier from the failure the contract calls out: a
  /// document claiming motion it does not author would tell a reader to fall
  /// back for nothing.
  func testMotionCapabilitiesAreDerivedFromAuthoredMotion() throws {
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: v04FixtureData()) as? [String: Any])
    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    let capabilities = try XCTUnwrap(compatibility["requiredCapabilities"] as? [[String: Any]])
    compatibility["requiredCapabilities"] = capabilities.filter {
      $0["name"] as? String != "motion.loop"
    }
    object["compatibility"] = compatibility

    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(JSONSerialization.data(withJSONObject: object))
    ) { error in
      XCTAssertEqual(
        (error as? MosaicProtocolError)?.diagnosticCode,
        "protocol_missing_capability_motion.loop"
      )
    }
  }
}
