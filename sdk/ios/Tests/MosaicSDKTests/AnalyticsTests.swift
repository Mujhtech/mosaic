import Foundation
import XCTest

@testable import MosaicSDK

private actor AnalyticsTestTransport: MosaicAnalyticsTransport {
  enum Behavior: Sendable { case fail, accept, partial }
  var behavior: Behavior
  private(set) var batches: [MosaicAnalyticsBatch] = []

  init(_ behavior: Behavior) { self.behavior = behavior }

  func send(data: Data) async throws -> MosaicAnalyticsHTTPResponse {
    let batch = try MosaicAnalyticsCodec.decodeBatch(data)
    batches.append(batch)
    switch behavior {
    case .fail: throw URLError(.notConnectedToInternet)
    case .accept:
      return response(batch: batch, statuses: batch.events.map { ($0.eventId, "accepted", nil) })
    case .partial:
      let names = ["accepted", "duplicate", "permanently_rejected", "retryable"]
      let statuses = batch.events.enumerated().map { index, event in
        (
          event.eventId, names[index % names.count],
          index % names.count == 2
            ? "authority_not_allowed"
            : index % names.count == 3 ? "storage_temporarily_unavailable" : nil
        )
      }
      return response(batch: batch, statuses: statuses)
    }
  }

  func setBehavior(_ value: Behavior) { behavior = value }

  private func response(
    batch: MosaicAnalyticsBatch, statuses: [(String, String, String?)]
  ) -> MosaicAnalyticsHTTPResponse {
    let results = statuses.map { eventID, status, code -> [String: Any] in
      var value: [String: Any] = ["eventId": eventID, "status": status]
      if let code { value["code"] = code }
      if status == "retryable" { value["retryAfterSeconds"] = 10 }
      return value
    }
    let object: [String: Any] = [
      "analyticsEventContractVersion": "1", "batchId": batch.batchId,
      "receivedAt": "2026-07-26T12:05:00.000Z", "results": results,
    ]
    return .init(
      statusCode: 200,
      data: try! JSONSerialization.data(withJSONObject: object), retryAfterSeconds: nil)
  }
}

final class AnalyticsTests: XCTestCase {
  func testCanonicalFixturesDecodeWithClosedEventAndResponseCodecs() throws {
    let events = [
      "placement-request.json", "paywall-presentation.json", "product-selection.json",
      "purchase-started.json", "purchase-completed-client.json",
      "purchase-completed-provider.json", "purchase-cancelled.json", "purchase-failed.json",
      "restore-completed.json",
    ]
    for fixture in events {
      XCTAssertNoThrow(try MosaicAnalyticsCodec.decodeEvent(analyticsFixtureData(fixture)), fixture)
    }
    XCTAssertEqual(
      try MosaicAnalyticsCodec.decodeBatch(
        analyticsFixtureData("batches/monetization-journey.json")
      )
      .events.count,
      6)
    let edgeCases = try MosaicAnalyticsCodec.decodeBatch(
      analyticsFixtureData("batches/edge-case-conformance.json"))
    XCTAssertEqual(edgeCases.events.count, 7)
    XCTAssertEqual(edgeCases.events.first?.identity?.applicationUserId, "tenant opaque/user 42")
    for fixture in [
      "accepted-event.json", "duplicate-event.json", "permanent-rejection.json",
      "retryable-event.json", "mixed-result-batch.json",
    ] {
      XCTAssertNoThrow(
        try MosaicAnalyticsCodec.decodeResponse(analyticsFixtureData("responses/\(fixture)")),
        fixture)
    }
    for fixture in [
      "public-sdk-provider-authority.json", "incomplete-rollout-attribution.json",
      "placement-request-unrelated-attribution.json",
      "placement-request-unrelated-correlation.json",
    ] {
      XCTAssertThrowsError(
        try MosaicAnalyticsCodec.decodeEvent(analyticsFixtureData("invalid/\(fixture)")), fixture)
    }
  }

  func testCodecRejectsUnsafeBoundedFieldsAndIncompleteRuleSetIdentity() throws {
    let fixture = try analyticsFixtureData("batches/edge-case-conformance.json")
    let root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: fixture) as? [String: Any])
    let events = try XCTUnwrap(root["events"] as? [[String: Any]])

    func encodedEvent(
      _ index: Int, mutate: (inout [String: Any]) -> Void
    ) throws -> Data {
      var event = events[index]
      mutate(&event)
      return try JSONSerialization.data(withJSONObject: event)
    }

    XCTAssertThrowsError(
      try MosaicAnalyticsCodec.decodeEvent(
        encodedEvent(2) { event in
          var context = event["context"] as! [String: Any]
          context["sdkVersion"] = "invalid/version"
          event["context"] = context
        }))
    XCTAssertThrowsError(
      try MosaicAnalyticsCodec.decodeEvent(
        encodedEvent(0) { event in
          var identity = event["identity"] as! [String: Any]
          identity["applicationUserId"] = String(repeating: "€", count: 86)
          event["identity"] = identity
        }))
    XCTAssertThrowsError(
      try MosaicAnalyticsCodec.decodeEvent(
        encodedEvent(3) { event in
          var payload = event["payload"] as! [String: Any]
          payload["diagnosticCode"] = "Rendering Failure"
          event["payload"] = payload
        }))
    XCTAssertThrowsError(
      try MosaicAnalyticsCodec.decodeEvent(
        encodedEvent(0) { event in
          var attribution = event["attribution"] as! [String: Any]
          attribution.removeValue(forKey: "placementRuleSetVersion")
          event["attribution"] = attribution
        }))
  }

  func testPersistentQueueReconstructionAndExactPartialAcknowledgement() async throws {
    let persistence = MosaicMemoryAnalyticsPersistence()
    let identity = MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence())
    let offline = AnalyticsTestTransport(.fail)
    let now = Date(timeIntervalSince1970: 1_790_510_400)
    let makeRuntime: (any MosaicAnalyticsTransport) -> MosaicAnalyticsRuntime = { transport in
      MosaicAnalyticsRuntime(
        persistence: persistence, transport: transport, identityStore: identity,
        context: .init(sdkVersion: "0.6.0"), clock: { now }, jitter: { _ in 0 })
    }
    let first = makeRuntime(offline)
    await first.setCollection(environmentEnabled: true, hostEnabled: true)
    for index in 0..<4 {
      let result = await first.record(
        name: .paywallActionSelected,
        correlation: .init(paywallPresentationId: "presentation_\(index)"),
        attribution: .init(), payload: .init(action: "close"), occurredAt: now)
      guard case .queued = result else { return XCTFail("event was not queued") }
    }
    _ = await first.flush()
    let offlineDiagnostics = await first.diagnostics()
    XCTAssertEqual(offlineDiagnostics.queuedEventCount, 4)

    let online = AnalyticsTestTransport(.partial)
    let reconstructed = makeRuntime(online)
    let result = await reconstructed.flush()
    XCTAssertEqual(result, .delivered(removed: 3, retained: 1))
    let diagnostics = await reconstructed.diagnostics()
    XCTAssertEqual(diagnostics.queuedEventCount, 1)
    XCTAssertEqual(diagnostics.permanentlyRejectedEventCount, 1)
    XCTAssertEqual(diagnostics.retryCount, 5)
  }

  func testCollectionResetAndEventTimeIdentitySessionsAreNotRewritten() async throws {
    let persistence = MosaicMemoryAnalyticsPersistence()
    let identity = MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence())
    let transport = AnalyticsTestTransport(.accept)
    let now = Date(timeIntervalSince1970: 1_790_510_400)
    let runtime = MosaicAnalyticsRuntime(
      persistence: persistence, transport: transport, identityStore: identity,
      context: .init(sdkVersion: "0.6.0"), clock: { now }, jitter: { _ in 0 })
    let disabledResult = await runtime.record(
      name: .paywallActionSelected,
      correlation: .init(paywallPresentationId: "presentation_disabled"),
      attribution: .init(), payload: .init(action: "close"))
    XCTAssertEqual(disabledResult, .collectionDisabled)
    await runtime.setCollection(environmentEnabled: true, hostEnabled: true)
    _ = await runtime.record(
      name: .paywallActionSelected,
      correlation: .init(paywallPresentationId: "presentation_anonymous"),
      attribution: .init(), payload: .init(action: "close"), occurredAt: now)
    try await identity.identify("customer_42")
    await runtime.identityChanged()
    _ = await runtime.record(
      name: .paywallActionSelected,
      correlation: .init(paywallPresentationId: "presentation_identified"),
      attribution: .init(), payload: .init(action: "close"), occurredAt: now)
    _ = await runtime.flush()
    let batches = await transport.batches
    let batch = try XCTUnwrap(batches.first)
    XCTAssertNil(batch.events[0].identity?.applicationUserId)
    XCTAssertEqual(batch.events[1].identity?.applicationUserId, "customer_42")
    XCTAssertNotEqual(batch.events[0].sessionId, batch.events[1].sessionId)

    _ = await runtime.record(
      name: .paywallActionSelected,
      correlation: .init(paywallPresentationId: "presentation_unsent"),
      attribution: .init(), payload: .init(action: "close"), occurredAt: now)
    await runtime.setCollection(environmentEnabled: true, hostEnabled: false)
    let disabledDiagnostics = await runtime.diagnostics()
    XCTAssertEqual(disabledDiagnostics.queuedEventCount, 0)
  }

  func testPriorityOverflowPreservesPurchaseOutcomeOverLowValueRequest() async {
    let now = Date(timeIntervalSince1970: 1_790_510_400)
    let lowValue = MosaicAnalyticsEvent(
      eventId: "event_low", eventName: .paywallActionSelected,
      occurredAt: MosaicAnalyticsRuntime.timestamp(now),
      queuedAt: MosaicAnalyticsRuntime.timestamp(now), authority: .clientObserved,
      identity: .init(installationId: "installation_test", generation: 0),
      sessionId: "session_test", context: .init(sdkVersion: "0.6.0"),
      correlation: .init(paywallPresentationId: "presentation_low"),
      attribution: .init(), payload: .init(action: "navigate_back"))
    let bytes = (try? MosaicAnalyticsCodec.encode(lowValue).count) ?? 1
    let initial = MosaicAnalyticsPersistentState(
      environmentCollectionEnabled: true,
      queue: Array(
        repeating: .init(event: lowValue, encodedBytes: bytes, attempts: 0, nextAttemptAt: nil),
        count: 1_000))
    let persistence = MosaicMemoryAnalyticsPersistence(state: initial)
    let identity = MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence())
    let transport = AnalyticsTestTransport(.fail)
    let runtime = MosaicAnalyticsRuntime(
      persistence: persistence, transport: transport, identityStore: identity,
      context: .init(sdkVersion: "0.6.0"), clock: { now }, jitter: { _ in 0 })
    _ = await runtime.record(
      name: .purchaseCancelled,
      correlation: .init(purchaseAttemptId: "purchase_attempt_kept"),
      attribution: .init(mosaicProductId: "product_yearly", providerId: "mock"),
      payload: .init(durationMs: 1), occurredAt: now)
    let state = await persistence.load()
    XCTAssertEqual(state?.queue.count, 1_000)
    XCTAssertTrue(state?.queue.contains { $0.event.eventName == .purchaseCancelled } == true)
    XCTAssertEqual(state?.droppedEventCount, 1)
  }

  @MainActor
  func testRendererPreservesCommerceOutcomeAndExactPurchaseCorrelation() async throws {
    let persistence = MosaicMemoryAnalyticsPersistence()
    let identity = MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence())
    let runtime = MosaicAnalyticsRuntime(
      persistence: persistence, transport: AnalyticsTestTransport(.fail),
      identityStore: identity, context: .init(sdkVersion: "0.6.0"), jitter: { _ in 0 })
    await runtime.setCollection(environmentEnabled: true, hostEnabled: true)
    let analytics = MosaicAnalyticsPresentationInstrumentation(
      runtime: runtime, placementRequestID: "placement_request_renderer",
      presentationID: "presentation_renderer",
      attribution: .init(
        configurationReleaseId: "release_renderer", placementId: "placement_renderer",
        paywallId: "paywall_renderer", paywallVersionId: "paywall_version_renderer"),
      providerID: "mock")
    let document = try canonicalDocument()
    var results: [MosaicPresentationResult] = []
    let model = MosaicPaywallModel(
      document: document,
      purchaseProvider: MockMosaicPurchaseProvider(
        products: MosaicProduct.phase1MockProducts, purchaseBehavior: .success),
      analytics: analytics,
      onResult: { results.append($0) })
    await model.prepare()
    await model.purchase(using: try purchaseButton(in: document))
    XCTAssertEqual(results, [.purchased(productReferenceID: "yearly-plan")])

    var state: MosaicAnalyticsPersistentState?
    for _ in 0..<1_000 {
      state = await persistence.load()
      let names = Set(state?.queue.map(\.event.eventName) ?? [])
      if names.contains(.purchaseStarted) && names.contains(.purchaseCompletedClient) {
        break
      }
      await Task.yield()
    }
    let events = try XCTUnwrap(state?.queue.map(\.event))
    let started = try XCTUnwrap(events.first { $0.eventName == .purchaseStarted })
    let completed = try XCTUnwrap(events.first { $0.eventName == .purchaseCompletedClient })
    XCTAssertEqual(started.correlation.purchaseAttemptId, completed.correlation.purchaseAttemptId)
    XCTAssertEqual(completed.correlation.placementRequestId, "placement_request_renderer")
    XCTAssertEqual(completed.correlation.paywallPresentationId, "presentation_renderer")
    XCTAssertEqual(completed.attribution.mosaicProductId, "yearly-plan")
    XCTAssertEqual(completed.attribution.providerId, "mock")
  }
}
