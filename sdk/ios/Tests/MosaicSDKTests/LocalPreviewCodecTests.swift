import Foundation
import XCTest

@testable import MosaicSDK

final class LocalPreviewCodecTests: XCTestCase {
  private let codec = MosaicPreviewMessageCodec()

  func testDecodesEveryCanonicalLocalPreviewFlowMessage() throws {
    let values = try localPreviewFlowObjects()
    XCTAssertEqual(values.count, 17)

    var draftCount = 0
    var commerceCount = 0
    var heartbeatCount = 0
    for value in values {
      let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
      let decoded = try codec.decode(data, expectedSessionId: "session_phase2_demo")
      XCTAssertEqual(decoded.sessionId, "session_phase2_demo")
      switch decoded.message {
      case .draftUpdated:
        draftCount += 1
      case .mockCommerceStateChanged:
        commerceCount += 1
      case .heartbeat:
        heartbeatCount += 1
      case .previewClientDisconnected, .validatedOther:
        break
      }
    }

    XCTAssertEqual(draftCount, 4)
    XCTAssertEqual(commerceCount, 1)
    XCTAssertEqual(heartbeatCount, 2)
  }

  func testCanonicalDraftCarriesTheUnchangedPaywallAndPreviewContext() throws {
    let decoded = try codec.decode(
      localPreviewMessageSource(at: 3),
      expectedSessionId: "session_phase2_demo"
    )
    guard case .draftUpdated(let update) = decoded.message else {
      return XCTFail("Expected canonical draftUpdated message")
    }

    let document = try MosaicProtocolDecoder.decode(update.documentData)
    XCTAssertEqual(update.editableDocumentId, "document_phase2_demo")
    XCTAssertEqual(update.revision, MosaicLocalRevision(revisionId: "revision_000002", sequence: 2))
    XCTAssertEqual(update.preview, MosaicPreviewContext(locale: "en", textScale: 1))
    XCTAssertEqual(document.id, "phase1-complete-paywall")
    XCTAssertEqual(document.schemaVersion, mosaicProtocolVersion)
  }

  func testCanonicalCommerceDecodesTrialsOffersAndEntitlement() throws {
    let decoded = try codec.decode(
      localPreviewMessageSource(at: 2),
      expectedSessionId: "session_phase2_demo"
    )
    guard case .mockCommerceStateChanged(let update) = decoded.message else {
      return XCTFail("Expected canonical mock commerce message")
    }

    XCTAssertEqual(update.stateRevision.sequence, 1)
    XCTAssertEqual(update.state.products.count, 2)
    XCTAssertEqual(update.state.purchaseOutcome, .purchased)
    XCTAssertEqual(update.state.restoreOutcome, .restored)
    XCTAssertEqual(update.state.entitlement, .none)
    guard case .subscription(_, _, _, _, let trial, _) = update.state.products[0] else {
      return XCTFail("Expected subscription")
    }
    XCTAssertEqual(trial, MosaicPreviewPeriod(unit: .day, value: 7))
    guard case .subscription(_, _, _, _, _, let offer) = update.state.products[1] else {
      return XCTFail("Expected subscription")
    }
    XCTAssertEqual(offer?.localizedPrice, "$39.99")
  }

  func testRejectsUnknownFieldsVersionSessionAndUnsafeDiagnostics() throws {
    var unknownEnvelope = try localPreviewFlowObjects()[3]
    unknownEnvelope["platform"] = "ios"
    XCTAssertThrowsError(try decode(unknownEnvelope)) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .invalidPayload)
    }

    var unknownPayload = try localPreviewFlowObjects()[3]
    var payload = try XCTUnwrap(unknownPayload["payload"] as? [String: Any])
    payload["swiftUIView"] = "Text"
    unknownPayload["payload"] = payload
    XCTAssertThrowsError(try decode(unknownPayload)) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .invalidPayload)
    }

    var unsupportedVersion = try localPreviewFlowObjects()[3]
    unsupportedVersion["previewProtocolVersion"] = "0.2"
    XCTAssertThrowsError(try decode(unsupportedVersion)) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .unsupportedVersion)
    }

    XCTAssertThrowsError(
      try codec.decode(
        localPreviewMessageSource(at: 3),
        expectedSessionId: "session_another"
      )
    ) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .wrongSession)
    }

    var unsafeDiagnostic = try localPreviewFlowObjects()[10]
    var unsafePayload = try XCTUnwrap(unsafeDiagnostic["payload"] as? [String: Any])
    var diagnostics = try XCTUnwrap(unsafePayload["diagnostics"] as? [[String: Any]])
    diagnostics[0]["message"] = "unsafe\nstack trace"
    unsafePayload["diagnostics"] = diagnostics
    unsafeDiagnostic["payload"] = unsafePayload
    XCTAssertThrowsError(try decode(unsafeDiagnostic)) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .unsafeDiagnostic)
    }
  }

  func testEncodesExactIOSIdentityCapabilityAndAcknowledgementMessages() throws {
    let identity = previewTestIdentity()
    let connected = try codec.encode(
      .previewClientConnected(identity),
      messageId: "msg_ios_test_1",
      sessionId: "session_local_01",
      sentAt: Date(timeIntervalSince1970: 0)
    )
    let capability = try codec.encode(
      .capabilityReport(MosaicPreviewCapabilityReport(clientId: identity.clientId)),
      messageId: "msg_ios_test_2",
      sessionId: "session_local_01",
      sentAt: Date(timeIntervalSince1970: 0)
    )
    let accepted = try codec.encode(
      .draftAccepted(
        clientId: identity.clientId,
        editableDocumentId: "document_local_01",
        revision: MosaicLocalRevision(revisionId: "revision_local_01", sequence: 1)
      ),
      messageId: "msg_ios_test_3",
      sessionId: "session_local_01",
      sentAt: Date(timeIntervalSince1970: 0)
    )

    XCTAssertEqual(try messageType(connected), "previewClientConnected")
    XCTAssertEqual(try messageType(capability), "capabilityReport")
    XCTAssertEqual(try messageType(accepted), "draftAccepted")

    let capabilityObject = try object(capability)
    let capabilityPayload = try XCTUnwrap(capabilityObject["payload"] as? [String: Any])
    let previewCapabilities = try XCTUnwrap(
      capabilityPayload["previewCapabilities"] as? [[String: Any]]
    )
    XCTAssertEqual(
      Set(previewCapabilities.compactMap { $0["name"] as? String }),
      Set(MosaicPreviewCapabilityName.allCases.map(\.rawValue))
    )
    XCTAssertEqual(
      (capabilityPayload["limits"] as? [String: Int])?["maxDocumentBytes"],
      mosaicIOSPreviewMaximumDocumentBytes
    )
  }

  func testHonorsFrameAndContractBounds() throws {
    let oversized = Data(repeating: 0x20, count: mosaicLocalPreviewMaximumFrameBytes + 1)
    XCTAssertThrowsError(try codec.decode(oversized)) { error in
      XCTAssertEqual(error as? MosaicPreviewProtocolError, .frameTooLarge)
    }

    var invalidScale = try localPreviewFlowObjects()[3]
    var payload = try XCTUnwrap(invalidScale["payload"] as? [String: Any])
    var preview = try XCTUnwrap(payload["preview"] as? [String: Any])
    preview["textScale"] = 3.01
    payload["preview"] = preview
    invalidScale["payload"] = payload
    XCTAssertThrowsError(try decode(invalidScale))
  }

  func testTimestampUsesTheNormativeRegexWithoutCalendarInterpretation() throws {
    var regexValid = try localPreviewFlowObjects()[3]
    regexValid["sentAt"] = "2026-02-31T08:00:00Z"

    let decoded = try decode(regexValid)
    XCTAssertEqual(decoded.sentAt, "2026-02-31T08:00:00Z")
  }

  private func decode(_ object: [String: Any]) throws -> MosaicPreviewDecodedMessage {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return try codec.decode(data, expectedSessionId: "session_phase2_demo")
  }

  private func object(_ source: String) throws -> [String: Any] {
    try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(source.utf8)) as? [String: Any]
    )
  }

  private func messageType(_ source: String) throws -> String {
    try XCTUnwrap(object(source)["type"] as? String)
  }
}
