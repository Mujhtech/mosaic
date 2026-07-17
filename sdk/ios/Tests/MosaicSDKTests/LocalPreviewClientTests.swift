import Foundation
import XCTest

@testable import MosaicSDK

@MainActor
final class LocalPreviewClientTests: XCTestCase {
  func testWorkingVerticalSliceAppliesCommerceRendersAndAcknowledgesOnlyWhenLive() async throws {
    let socket = PreviewTestSocket()
    let connector = PreviewTestConnector(socket: socket)
    let client = try makeClient(connector: connector)
    client.connect()

    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)
    let requestedProtocols = await connector.protocolSnapshot()
    XCTAssertEqual(requestedProtocols, [[mosaicLocalPreviewWebSocketProtocol]])
    let handshakeTypes = await socket.sentTypes()
    XCTAssertEqual(
      handshakeTypes.prefix(2),
      ["previewClientConnected", "capabilityReport"]
    )

    await socket.enqueue(.text(try localPreviewMessageSource(at: 2)))
    await socket.enqueue(.text(try localPreviewMessageSource(at: 3)))
    let didReceiveDraft = await waitUntil { client.pendingDraft?.revision.sequence == 2 }
    XCTAssertTrue(didReceiveDraft)
    XCTAssertEqual(client.connectionStatus, .connected)
    XCTAssertNil(client.liveDraft)
    let typesBeforeRender = await socket.sentTypes()
    XCTAssertFalse(typesBeforeRender.contains("draftAccepted"))
    XCTAssertEqual(client.mockCommerceState?.purchaseOutcome, .purchased)

    let pendingRevision = try XCTUnwrap(client.pendingDraft?.revision)
    await client.markRevisionLive(pendingRevision)
    XCTAssertEqual(client.liveDraft?.revision, pendingRevision)
    XCTAssertNil(client.pendingDraft)
    let didAcknowledge = await waitUntil { await socket.sentTypes().contains("draftAccepted") }
    XCTAssertTrue(didAcknowledge)

    await client.disconnect()
  }

  func testStaleConflictAndIdempotentRevisionsNeverReplaceTheLiveDraft() async throws {
    let socket = PreviewTestSocket()
    let client = try makeClient(connector: PreviewTestConnector(socket: socket))
    client.connect()
    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)

    await socket.enqueue(.text(try localPreviewMessageSource(at: 3)))
    let didReceiveDraft = await waitUntil { client.pendingDraft?.revision.sequence == 2 }
    XCTAssertTrue(didReceiveDraft)
    await client.markRevisionLive(try XCTUnwrap(client.pendingDraft?.revision))
    let acceptedBeforeDuplicate = await socket.count(type: "draftAccepted")

    var duplicate = try localPreviewFlowObjects()[3]
    duplicate["messageId"] = "msg_duplicate_000004"
    await socket.enqueue(.text(try source(duplicate)))
    let didReacknowledge = await waitUntil {
      await socket.count(type: "draftAccepted") > acceptedBeforeDuplicate
    }
    XCTAssertTrue(didReacknowledge)
    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)

    await socket.enqueue(.text(try localPreviewMessageSource(at: 6)))
    let didRejectStale = await waitUntil {
      await socket.containsRejection(reason: "staleRevision")
    }
    XCTAssertTrue(didRejectStale)
    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)

    var conflict = try localPreviewFlowObjects()[3]
    conflict["messageId"] = "msg_conflict_000004"
    var payload = try XCTUnwrap(conflict["payload"] as? [String: Any])
    var revision = try XCTUnwrap(payload["revision"] as? [String: Any])
    revision["revisionId"] = "revision_conflict_000002"
    payload["revision"] = revision
    conflict["payload"] = payload
    await socket.enqueue(.text(try source(conflict)))
    let didRejectConflict = await waitUntil {
      await socket.containsRejection(reason: "revisionConflict")
    }
    XCTAssertTrue(didRejectConflict)
    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)

    await client.disconnect()
  }

  func testInvalidAndUnsupportedDraftsKeepLastAcceptedFallbackAndSurfaceRecovery() async throws {
    let socket = PreviewTestSocket()
    let client = try makeClient(connector: PreviewTestConnector(socket: socket))
    client.connect()
    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)

    await socket.enqueue(.text(try localPreviewMessageSource(at: 3)))
    let didReceiveDraft = await waitUntil { client.pendingDraft != nil }
    XCTAssertTrue(didReceiveDraft)
    await client.markRevisionLive(try XCTUnwrap(client.pendingDraft?.revision))

    await socket.enqueue(.text(try localPreviewMessageSource(at: 8)))
    let didReportInvalidDocument = await waitUntil {
      client.draftIssue?.kind == .invalidDocument
    }
    XCTAssertTrue(didReportInvalidDocument)
    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)
    XCTAssertNil(client.pendingDraft)
    let invalidTypes = await socket.sentTypes()
    XCTAssertTrue(invalidTypes.contains("validationError"))
    let didRejectValidation = await socket.containsRejection(reason: "validationFailed")
    XCTAssertTrue(didRejectValidation)

    var unsupported = try localPreviewFlowObjects()[3]
    unsupported["messageId"] = "msg_unsupported_000005"
    var payload = try XCTUnwrap(unsupported["payload"] as? [String: Any])
    payload["revision"] = ["revisionId": "revision_unsupported_000005", "sequence": 5]
    var document = try XCTUnwrap(payload["document"] as? [String: Any])
    var layout = try XCTUnwrap(document["layout"] as? [String: Any])
    var content = try XCTUnwrap(layout["content"] as? [String: Any])
    var children = try XCTUnwrap(content["children"] as? [[String: Any]])
    children[1]["type"] = "video"
    content["children"] = children
    layout["content"] = content
    document["layout"] = layout
    payload["document"] = document
    unsupported["payload"] = payload
    await socket.enqueue(.text(try source(unsupported)))

    let didReportUnsupportedComponent = await waitUntil {
      client.draftIssue?.kind == .unsupportedComponent
    }
    XCTAssertTrue(didReportUnsupportedComponent)
    XCTAssertEqual(client.draftIssue?.location.componentId, "hero")
    XCTAssertEqual(client.draftIssue?.recovery.action, .removeComponent)
    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)
    let didRejectUnsupported = await socket.containsRejection(reason: "unsupportedCapability")
    XCTAssertTrue(didRejectUnsupported)
    let unsupportedTypes = await socket.sentTypes()
    XCTAssertTrue(unsupportedTypes.contains("renderWarning"))

    await client.disconnect()
  }

  func testCommerceOrderingIsIndependentAndOtherClientDisconnectIsIgnored() async throws {
    let socket = PreviewTestSocket()
    let client = try makeClient(connector: PreviewTestConnector(socket: socket))
    client.connect()
    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)

    var commerceTwo = try localPreviewFlowObjects()[2]
    commerceTwo["messageId"] = "msg_commerce_000002"
    var payload = try XCTUnwrap(commerceTwo["payload"] as? [String: Any])
    payload["stateRevision"] = ["revisionId": "revision_commerce_000002", "sequence": 2]
    commerceTwo["payload"] = payload
    await socket.enqueue(.text(try source(commerceTwo)))
    await socket.enqueue(.text(try localPreviewMessageSource(at: 3)))
    let didApplyCommerce = await waitUntil { client.mockCommerceRevision?.sequence == 2 }
    XCTAssertTrue(didApplyCommerce)

    var staleCommerce = try localPreviewFlowObjects()[2]
    staleCommerce["messageId"] = "msg_commerce_stale_000001"
    await socket.enqueue(.text(try source(staleCommerce)))
    let didReportStaleCommerce = await waitUntil {
      client.diagnostics.contains { $0.code == "preview.commerce.stale" }
    }
    XCTAssertTrue(didReportStaleCommerce)
    XCTAssertEqual(client.mockCommerceRevision?.sequence, 2)

    await socket.enqueue(.text(try localPreviewMessageSource(at: 16)))
    try? await Task<Never, Never>.sleep(nanoseconds: 30_000_000)
    XCTAssertEqual(client.connectionStatus, .connected)

    await client.disconnect()
  }

  func testLateUnavailableCommerceActivatesFallbackAndReportsRenderWarning() async throws {
    let socket = PreviewTestSocket()
    let client = try makeClient(connector: PreviewTestConnector(socket: socket))
    client.connect()
    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)

    await socket.enqueue(.text(try localPreviewMessageSource(at: 3)))
    let didReceiveDraft = await waitUntil { client.pendingDraft != nil }
    XCTAssertTrue(didReceiveDraft)
    await client.markRevisionLive(try XCTUnwrap(client.pendingDraft?.revision))
    let acceptedCount = await socket.count(type: "draftAccepted")

    var unavailableCommerce = try localPreviewFlowObjects()[2]
    unavailableCommerce["messageId"] = "msg_commerce_unavailable_000002"
    var payload = try XCTUnwrap(unavailableCommerce["payload"] as? [String: Any])
    payload["stateRevision"] = [
      "revisionId": "revision_commerce_unavailable_000002",
      "sequence": 2,
    ]
    var state = try XCTUnwrap(payload["state"] as? [String: Any])
    var products = try XCTUnwrap(state["products"] as? [[String: Any]])
    products[1] = [
      "productReferenceId": "yearly-plan",
      "availability": "unavailable",
      "reason": "temporarilyUnavailable",
    ]
    state["products"] = products
    payload["state"] = state
    unavailableCommerce["payload"] = payload
    await socket.enqueue(.text(try source(unavailableCommerce)))

    let didWarn = await waitUntil {
      await socket.count(type: "renderWarning") > 0
        && client.mockCommerceRevision?.sequence == 2
    }
    XCTAssertTrue(didWarn)
    let acceptedAfterCommerce = await socket.count(type: "draftAccepted")
    XCTAssertEqual(acceptedAfterCommerce, acceptedCount)

    let productResult = await client.purchaseProvider.loadProducts(
      identifiers: ["mosaic_pro_monthly", "mosaic_pro_yearly"]
    )
    guard case .loaded(let products) = productResult else {
      return XCTFail("Expected selector fallback to retain the available monthly product")
    }
    XCTAssertEqual(products.map(\.id), ["mosaic_pro_monthly"])
    XCTAssertTrue(client.diagnostics.contains { $0.code == "preview.product.unavailable" })

    await client.disconnect()
  }

  func testRenderFailureKeepsLastAcceptedDraftAndReportsBothOutcomes() async throws {
    let socket = PreviewTestSocket()
    let client = try makeClient(connector: PreviewTestConnector(socket: socket))
    client.connect()
    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)

    await socket.enqueue(.text(try localPreviewMessageSource(at: 3)))
    let didReceiveFirstDraft = await waitUntil { client.pendingDraft?.revision.sequence == 2 }
    XCTAssertTrue(didReceiveFirstDraft)
    await client.markRevisionLive(try XCTUnwrap(client.pendingDraft?.revision))

    await socket.enqueue(.text(try localPreviewMessageSource(at: 11)))
    let didReceiveNewDraft = await waitUntil { client.pendingDraft?.revision.sequence == 4 }
    XCTAssertTrue(didReceiveNewDraft)
    await client.reportRenderFailure(
      MosaicPreviewRenderDiagnostic(
        code: "preview.render.failed",
        message: "The native preview could not render this revision.",
        location: MosaicPreviewDiagnosticLocation(
          documentPath: "/layout/content",
          componentId: "content"
        ),
        recovery: MosaicPreviewRecovery(
          action: .retry,
          message: "Fix the affected block and send a new revision."
        )
      )
    )

    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)
    XCTAssertNil(client.pendingDraft)
    XCTAssertEqual(client.draftIssue?.kind, .renderFailure)
    let sentTypes = await socket.sentTypes()
    XCTAssertTrue(sentTypes.contains("renderFailure"))
    let didReject = await socket.containsRejection(reason: "renderFailed")
    XCTAssertTrue(didReject)

    await client.disconnect()
  }

  func testTransportDropReconnectsWithTheSameProcessIdentity() async throws {
    let firstSocket = PreviewTestSocket()
    let secondSocket = PreviewTestSocket()
    let connector = PreviewSequenceConnector(sockets: [firstSocket, secondSocket])
    let client = try makeClient(
      connector: connector,
      delay: { _ in await Task.yield() }
    )
    client.connect()

    let didConnectFirst = await waitUntil { await firstSocket.sentCount >= 2 }
    XCTAssertTrue(didConnectFirst)
    await firstSocket.close()
    let didReconnect = await waitUntil { await secondSocket.sentCount >= 2 }
    XCTAssertTrue(didReconnect)
    XCTAssertEqual(client.connectionStatus, .connected)

    let firstClientIds = await firstSocket.connectedClientIds()
    let secondClientIds = await secondSocket.connectedClientIds()
    XCTAssertEqual(firstClientIds, [previewTestIdentity().clientId])
    XCTAssertEqual(secondClientIds, firstClientIds)
    let connectionCount = await connector.connectionCountSnapshot()
    XCTAssertEqual(connectionCount, 2)

    await client.disconnect()
  }

  func testReconnectPolicyStartsAt250MillisecondsAndCapsAtFiveSeconds() {
    let policy = MosaicPreviewReconnectPolicy(maximumAttempts: 8)
    XCTAssertEqual(policy.delay(forAttempt: 1), .milliseconds(250))
    XCTAssertEqual(policy.delay(forAttempt: 2), .milliseconds(500))
    XCTAssertEqual(policy.delay(forAttempt: 5), .seconds(4))
    XCTAssertEqual(policy.delay(forAttempt: 6), .seconds(5))
    XCTAssertEqual(policy.delay(forAttempt: 8), .seconds(5))
  }

  func testConfigurationRejectsPublicAndIPv6LookingDNSHosts() throws {
    let publicEndpoint = try XCTUnwrap(URL(string: "wss://preview.example.com/preview"))
    XCTAssertThrowsError(
      try MosaicPreviewClientConfiguration(
        endpoint: publicEndpoint,
        identity: previewTestIdentity()
      )
    ) { error in
      XCTAssertEqual(error as? MosaicPreviewConfigurationError, .nonLocalEndpoint)
    }

    let prefixEndpoint = try XCTUnwrap(URL(string: "wss://fdexample.com/preview"))
    XCTAssertThrowsError(
      try MosaicPreviewClientConfiguration(
        endpoint: prefixEndpoint,
        identity: previewTestIdentity()
      )
    ) { error in
      XCTAssertEqual(error as? MosaicPreviewConfigurationError, .nonLocalEndpoint)
    }

    let localIPv6Endpoint = try XCTUnwrap(URL(string: "ws://[fd00::1]:4317/preview"))
    XCTAssertNoThrow(
      try MosaicPreviewClientConfiguration(
        endpoint: localIPv6Endpoint,
        identity: previewTestIdentity()
      )
    )

    let linkLocalEndpoint = try XCTUnwrap(URL(string: "ws://169.254.10.20:4317/preview"))
    XCTAssertNoThrow(
      try MosaicPreviewClientConfiguration(
        endpoint: linkLocalEndpoint,
        identity: previewTestIdentity()
      )
    )

    let localhostSubdomain = try XCTUnwrap(URL(string: "ws://studio.localhost:4317/preview"))
    XCTAssertNoThrow(
      try MosaicPreviewClientConfiguration(
        endpoint: localhostSubdomain,
        identity: previewTestIdentity()
      )
    )

    let roleQuery = try XCTUnwrap(
      URL(string: "ws://127.0.0.1:4317/preview?role=studio")
    )
    XCTAssertThrowsError(
      try MosaicPreviewClientConfiguration(
        endpoint: roleQuery,
        identity: previewTestIdentity()
      )
    ) { error in
      XCTAssertEqual(error as? MosaicPreviewConfigurationError, .invalidEndpoint)
    }
  }

  func testHeartbeatPingGetsMatchingPong() async throws {
    let socket = PreviewTestSocket()
    let client = try makeClient(connector: PreviewTestConnector(socket: socket))
    client.connect()
    let didSendHandshake = await waitUntil { await socket.sentCount >= 2 }
    XCTAssertTrue(didSendHandshake)

    var ping = try localPreviewFlowObjects()[14]
    var payload = try XCTUnwrap(ping["payload"] as? [String: Any])
    payload["clientId"] = "client_ios_tests"
    ping["payload"] = payload
    await socket.enqueue(.text(try source(ping)))

    let didSendPong = await waitUntil {
      await socket.containsHeartbeat(kind: "pong", sequence: 1)
    }
    XCTAssertTrue(didSendPong)
    await client.disconnect()
  }

  func testOptInRealRelayVerticalSlice() async throws {
    guard ProcessInfo.processInfo.environment["MOSAIC_PREVIEW_RELAY_TEST"] == "1" else {
      throw XCTSkip("Set MOSAIC_PREVIEW_RELAY_TEST=1 while the local relay is running.")
    }

    // Isolate this transport smoke test from an interactive Studio. A Studio
    // in the default session may immediately send its current cached revision
    // to a new client, which is correct relay behaviour but not this fixture.
    let sessionId = "session_ios_relay_test"
    let studioEndpoint = try XCTUnwrap(
      URL(
        string:
          "\(MosaicPreviewDefaults.endpoint.absoluteString)?role=studio&sessionId=\(sessionId)"
      )
    )
    let studio = try await MosaicURLSessionPreviewSocketConnector().connect(
      endpoint: studioEndpoint,
      protocols: [mosaicLocalPreviewWebSocketProtocol]
    )
    let configuration = try MosaicPreviewClientConfiguration(
      endpoint: MosaicPreviewDefaults.endpoint,
      sessionId: sessionId,
      identity: previewTestIdentity()
    )
    let client = MosaicLocalPreviewClient(configuration: configuration)
    client.connect()

    var handshakeTypes: [String] = []
    while handshakeTypes.count < 2 {
      guard case .text(let source) = try await studio.receive() else {
        XCTFail("The relay returned a binary handshake frame.")
        continue
      }
      let object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: Data(source.utf8)) as? [String: Any]
      )
      handshakeTypes.append(try XCTUnwrap(object["type"] as? String))
    }
    XCTAssertEqual(handshakeTypes, ["previewClientConnected", "capabilityReport"])

    var commerce = try localPreviewFlowObjects()[2]
    commerce["messageId"] = "msg_ios_relay_commerce"
    commerce["sessionId"] = sessionId
    try await studio.send(text: try source(commerce))

    var draft = try localPreviewFlowObjects()[3]
    draft["messageId"] = "msg_ios_relay_draft"
    draft["sessionId"] = sessionId
    try await studio.send(text: try source(draft))

    let received = await waitUntil(timeout: 5) { client.pendingDraft?.revision.sequence == 2 }
    XCTAssertTrue(received)
    XCTAssertEqual(client.mockCommerceState?.purchaseOutcome, .purchased)
    let revision = try XCTUnwrap(client.pendingDraft?.revision)
    await client.markRevisionLive(revision)

    var acknowledged = false
    while !acknowledged {
      guard case .text(let responseSource) = try await studio.receive() else {
        XCTFail("The relay returned a binary acknowledgement frame.")
        continue
      }
      let response = try XCTUnwrap(
        JSONSerialization.jsonObject(with: Data(responseSource.utf8)) as? [String: Any]
      )
      acknowledged = response["type"] as? String == "draftAccepted"
    }
    XCTAssertEqual(client.liveDraft?.revision.sequence, 2)

    await client.disconnect()
    await studio.close()
  }

  private func makeClient(
    connector: any MosaicPreviewSocketConnector,
    delay: @escaping MosaicPreviewDelay = mosaicPreviewTaskDelay
  ) throws
    -> MosaicLocalPreviewClient
  {
    let configuration = try MosaicPreviewClientConfiguration(
      endpoint: MosaicPreviewDefaults.endpoint,
      sessionId: "session_phase2_demo",
      identity: previewTestIdentity(),
      heartbeatInterval: .seconds(5),
      peerTimeout: .seconds(15)
    )
    return MosaicLocalPreviewClient(
      configuration: configuration,
      connector: connector,
      delay: delay
    )
  }

  private func source(_ object: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return try XCTUnwrap(String(data: data, encoding: .utf8))
  }

  private func waitUntil(
    timeout: TimeInterval = 2,
    condition: @escaping @MainActor () async -> Bool
  ) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if await condition() { return true }
      try? await Task<Never, Never>.sleep(nanoseconds: 10_000_000)
    }
    return await condition()
  }
}

private enum PreviewTestSocketError: Error {
  case closed
}

private actor PreviewTestSocket: MosaicPreviewSocket {
  private var frames: [MosaicPreviewSocketFrame] = []
  private var waiters: [CheckedContinuation<MosaicPreviewSocketFrame, Error>] = []
  private var sent: [String] = []
  private var closed = false

  var sentCount: Int { sent.count }

  func send(text: String) async throws {
    guard !closed else { throw PreviewTestSocketError.closed }
    sent.append(text)
  }

  func receive() async throws -> MosaicPreviewSocketFrame {
    if !frames.isEmpty { return frames.removeFirst() }
    guard !closed else { throw PreviewTestSocketError.closed }
    return try await withCheckedThrowingContinuation { continuation in
      waiters.append(continuation)
    }
  }

  func close() async {
    guard !closed else { return }
    closed = true
    let currentWaiters = waiters
    waiters.removeAll()
    for waiter in currentWaiters {
      waiter.resume(throwing: PreviewTestSocketError.closed)
    }
  }

  func enqueue(_ frame: MosaicPreviewSocketFrame) {
    if !waiters.isEmpty {
      waiters.removeFirst().resume(returning: frame)
    } else {
      frames.append(frame)
    }
  }

  func sentTypes() -> [String] {
    sent.compactMap { source in
      guard
        let data = source.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        return nil
      }
      return object["type"] as? String
    }
  }

  func count(type: String) -> Int {
    sentTypes().filter { $0 == type }.count
  }

  func containsRejection(reason: String) -> Bool {
    sent.contains { source in
      guard
        let data = source.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        object["type"] as? String == "draftRejected",
        let payload = object["payload"] as? [String: Any]
      else {
        return false
      }
      return payload["reason"] as? String == reason
    }
  }

  func containsHeartbeat(kind: String, sequence: Int) -> Bool {
    sent.contains { source in
      guard
        let data = source.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        object["type"] as? String == "previewHeartbeat",
        let payload = object["payload"] as? [String: Any]
      else {
        return false
      }
      return payload["kind"] as? String == kind
        && (payload["sequence"] as? NSNumber)?.intValue == sequence
    }
  }

  func connectedClientIds() -> [String] {
    sent.compactMap { source in
      guard
        let data = source.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        object["type"] as? String == "previewClientConnected",
        let payload = object["payload"] as? [String: Any],
        let client = payload["client"] as? [String: Any]
      else {
        return nil
      }
      return client["clientId"] as? String
    }
  }
}

private actor PreviewTestConnector: MosaicPreviewSocketConnector {
  private let socket: PreviewTestSocket
  private(set) var requestedProtocols: [[String]] = []

  init(socket: PreviewTestSocket) {
    self.socket = socket
  }

  func connect(endpoint: URL, protocols: [String]) async throws -> any MosaicPreviewSocket {
    requestedProtocols.append(protocols)
    return socket
  }

  func protocolSnapshot() -> [[String]] {
    requestedProtocols
  }
}

private actor PreviewSequenceConnector: MosaicPreviewSocketConnector {
  private var sockets: [PreviewTestSocket]
  private var connectionCount = 0

  init(sockets: [PreviewTestSocket]) {
    self.sockets = sockets
  }

  func connect(endpoint: URL, protocols: [String]) async throws -> any MosaicPreviewSocket {
    guard !sockets.isEmpty else { throw URLError(.cannotConnectToHost) }
    connectionCount += 1
    return sockets.removeFirst()
  }

  func connectionCountSnapshot() -> Int {
    connectionCount
  }
}
