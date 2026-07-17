import Foundation
import XCTest

@testable import MosaicSDK

@MainActor
final class ProtocolV02Tests: XCTestCase {
  func testCanonicalV02DecodesEveryNewNativeComponentAndStyleState() throws {
    let document = try v02Document()

    XCTAssertEqual(document.schemaVersion, "0.2")
    XCTAssertEqual(document.layout.content.type, .stack)
    XCTAssertEqual(document.layout.content.direction, .vertical)
    XCTAssertFalse(document.switches.isEmpty)
    XCTAssertEqual(document.carousels.single?.pages.count, 2)

    let kinds = Set(document.allNodes.map(\.kind))
    XCTAssertTrue(kinds.isSuperset(of: [.stack, .carousel, .switchControl, .countdown]))

    let selector = try XCTUnwrap(document.productSelectors.single)
    let resolved = selector.cardStyles.selected.resolving(selector.cardStyles.defaultStyle)
    XCTAssertEqual(resolved.cornerRadius, selector.cardStyles.defaultStyle.cornerRadius)
    XCTAssertEqual(resolved.padding.top, selector.cardStyles.defaultStyle.padding.top)
    XCTAssertEqual(resolved.padding.start, 18)
    XCTAssertEqual(resolved.border.width, 2)
    XCTAssertEqual(resolved.productLabelColor.rawValue, "action.primary")
    XCTAssertEqual(resolved.badge.background.rawValue, "action.primary")
    XCTAssertEqual(resolved.badge.cornerRadius, 999)

    XCTAssertEqual(
      MosaicSDKCapabilityReport.current.supportedSchemaVersions,
      ["0.1", "0.2"]
    )
    XCTAssertEqual(
      Set(
        MosaicSDKCapabilityReport.current.capabilities
          .filter { $0.version == "0.2" }
          .map(\.name)
      ),
      Set(MosaicCapabilityCatalog.v02)
    )
  }

  func testV02EdgeAndExpiredFixturesDecodeWhileNoncanonicalColorFailsClosed() throws {
    XCTAssertNoThrow(try v02Document(named: "edge-cases.json"))
    XCTAssertNoThrow(try v02Document(named: "expired-countdown.json"))
    XCTAssertThrowsError(
      try MosaicProtocolDecoder.decode(v02FixtureData(named: "invalid/noncanonical-color.json"))
    ) { error in
      XCTAssertEqual(
        error as? MosaicProtocolError,
        .semanticViolation(code: "protocol_invalid_color")
      )
    }
  }

  func testSwitchVisibilityCarouselStateAndControlledCountdownResetPerModel() throws {
    let document = try v02Document()
    let first = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(products: MosaicProduct.phase1MockProducts),
      clock: { Date(timeIntervalSince1970: 1_893_455_998) },
      onResult: { _ in }
    )
    let offerSwitch = try XCTUnwrap(document.switches.first { $0.id == "show-offer-details" })
    let carousel = try XCTUnwrap(document.carousels.single)

    XCTAssertTrue(first.switchValue(for: offerSwitch.id))
    XCTAssertEqual(first.carouselPageIndex(for: carousel.id), 1)
    XCTAssertTrue(first.isNodeVisible("offer-highlights"))
    XCTAssertFalse(first.isNodeVisible("offer-countdown"))

    first.setSwitchValue(false, for: offerSwitch.id)
    first.setCarouselPageIndex(0, for: carousel.id)
    XCTAssertFalse(first.isNodeVisible("offer-highlights"))
    XCTAssertTrue(first.isNodeVisible("offer-countdown"))

    let acceptedRevisionModel = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(),
      onResult: { _ in }
    )
    XCTAssertTrue(acceptedRevisionModel.switchValue(for: offerSwitch.id))
    XCTAssertEqual(acceptedRevisionModel.carouselPageIndex(for: carousel.id), 1)
  }

  func testCountdownUsesAbsoluteUTCClockAndCompletedLocalizedText() throws {
    let document = try v02Document()
    let countdown = try XCTUnwrap(document.allNodes.compactMap { node -> MosaicCountdownComponent? in
      guard case .countdown(let value) = node else { return nil }
      return value
    }.single)

    let before = try XCTUnwrap(ISO8601DateFormatter().date(from: countdown.endsAt))
      .addingTimeInterval(-90_061)
    XCTAssertEqual(
      MosaicCountdownText.resolve(component: countdown, now: before, completedText: "Ended"),
      "1d 1h 1m 1s"
    )
    XCTAssertEqual(
      MosaicCountdownText.resolve(
        component: countdown,
        now: try XCTUnwrap(ISO8601DateFormatter().date(from: countdown.endsAt))
          .addingTimeInterval(1),
        completedText: "Ended"
      ),
      "Ended"
    )
  }

  func testV02RejectsUnknownPropertiesAndMissingUsedCapabilities() throws {
    var object = try v02FixtureObject()
    var layout = try XCTUnwrap(object["layout"] as? [String: Any])
    var content = try XCTUnwrap(layout["content"] as? [String: Any])
    content["prototypeOnly"] = true
    layout["content"] = content
    object["layout"] = layout
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object)))

    object = try v02FixtureObject()
    var compatibility = try XCTUnwrap(object["compatibility"] as? [String: Any])
    var capabilities = try XCTUnwrap(compatibility["requiredCapabilities"] as? [[String: Any]])
    capabilities.removeAll { $0["name"] as? String == "component.carousel" }
    compatibility["requiredCapabilities"] = capabilities
    object["compatibility"] = compatibility
    XCTAssertThrowsError(try MosaicProtocolDecoder.decode(encoded(object)))
  }

  func testLocalPreviewV02CodecIsExactAndCarriesTheV02DraftUnchanged() throws {
    let codec = MosaicPreviewMessageCodec(protocolVersion: mosaicLocalPreviewProtocolVersionV02)
    let messages = try localPreviewV02Objects()
    var decodedDraft: MosaicPreviewDraftUpdate?
    for message in messages {
      let data = try JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
      let decoded = try codec.decode(data, expectedSessionId: "session_phase2_demo")
      if case .draftUpdated(let draft) = decoded.message { decodedDraft = draft }
    }

    let draft = try XCTUnwrap(decodedDraft)
    XCTAssertEqual(try MosaicProtocolDecoder.decode(draft.documentData).schemaVersion, "0.2")
    XCTAssertThrowsError(
      try MosaicPreviewMessageCodec().decode(
        try JSONSerialization.data(withJSONObject: messages[0], options: [.sortedKeys])
      )
    ) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .unsupportedVersion)
    }
  }

  func testLocalPreviewV02CapabilityReportAdvertisesExactImplementedCoverage() throws {
    let codec = MosaicPreviewMessageCodec(protocolVersion: mosaicLocalPreviewProtocolVersionV02)
    let report = MosaicPreviewCapabilityReport.v02(clientId: "client_ios_tests")
    let source = try codec.encode(
      .capabilityReport(report),
      messageId: "msg_ios_v02_report",
      sessionId: "session_phase2_demo",
      sentAt: Date(timeIntervalSince1970: 1_768_665_600)
    )
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(source.utf8)) as? [String: Any]
    )
    XCTAssertEqual(object["previewProtocolVersion"] as? String, "0.2")
    let payload = try XCTUnwrap(object["payload"] as? [String: Any])
    XCTAssertEqual(payload["supportedSchemaVersions"] as? [String], ["0.1", "0.2"])
    let capabilities = try XCTUnwrap(payload["supportedCapabilities"] as? [[String: Any]])
    XCTAssertEqual(
      Set(capabilities.compactMap { $0["name"] as? String }),
      Set(MosaicCapabilityCatalog.v02.map(\.rawValue))
    )
    let preview = try XCTUnwrap(payload["previewCapabilities"] as? [[String: Any]])
    XCTAssertTrue(preview.allSatisfy { $0["version"] as? String == "0.2" })
  }
}

private func v02FixtureURL(named name: String = "complete-paywall.json") throws -> URL {
  let manager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory
      .appendingPathComponent("protocol/fixtures/v0.2")
      .appendingPathComponent(name)
    if manager.fileExists(atPath: candidate.path) { return candidate }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

private func v02FixtureData(named name: String = "complete-paywall.json") throws -> Data {
  try Data(contentsOf: v02FixtureURL(named: name))
}

private func v02Document(named name: String = "complete-paywall.json") throws
  -> MosaicPaywallDocument
{
  try MosaicProtocolDecoder.decode(v02FixtureData(named: name))
}

private func v02FixtureObject() throws -> [String: Any] {
  guard let object = try JSONSerialization.jsonObject(with: v02FixtureData()) as? [String: Any]
  else { throw CanonicalFixtureLookupError.invalidShape }
  return object
}

private func localPreviewV02Objects() throws -> [[String: Any]] {
  let manager = FileManager.default
  var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  while directory.path != "/" {
    let candidate = directory.appendingPathComponent(
      "protocol/fixtures/local-preview/v0.2/session-flow.messages.json"
    )
    if manager.fileExists(atPath: candidate.path) {
      guard let values = try JSONSerialization.jsonObject(
        with: Data(contentsOf: candidate)
      ) as? [[String: Any]] else { throw CanonicalFixtureLookupError.invalidShape }
      return values
    }
    directory.deleteLastPathComponent()
  }
  throw CanonicalFixtureLookupError.notFound
}

extension Collection {
  fileprivate var single: Element? { count == 1 ? first : nil }
}
