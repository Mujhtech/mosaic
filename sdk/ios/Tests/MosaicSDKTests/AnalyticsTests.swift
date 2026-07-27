import Foundation
import XCTest

@testable import MosaicSDK

private actor AnalyticsTestTransport: MosaicAnalyticsTransport {
  enum Behavior: Sendable {
    case fail, accept, partial
    /// A 200 acknowledgement that echoes the wrong contract version.
    case contractVersionMismatch
  }
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
    case .contractVersionMismatch:
      return response(
        batch: batch, statuses: batch.events.map { ($0.eventId, "accepted", nil) },
        contractVersion: batch.analyticsEventContractVersion == "2" ? "1" : "2")
    }
  }

  func setBehavior(_ value: Behavior) { behavior = value }

  private func response(
    batch: MosaicAnalyticsBatch, statuses: [(String, String, String?)],
    contractVersion: String? = nil
  ) -> MosaicAnalyticsHTTPResponse {
    let results = statuses.map { eventID, status, code -> [String: Any] in
      var value: [String: Any] = ["eventId": eventID, "status": status]
      if let code { value["code"] = code }
      if status == "retryable" { value["retryAfterSeconds"] = 10 }
      return value
    }
    // The ingestion API echoes the contract version of the submitted batch.
    let object: [String: Any] = [
      "analyticsEventContractVersion": contractVersion ?? batch.analyticsEventContractVersion,
      "batchId": batch.batchId,
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

  /// A 200 acknowledgement that echoes a different contract version than the
  /// submitted batch must not be applied. It would apply one contract's result
  /// semantics to another's batch. The events stay queued for retry instead of
  /// being removed, and a matching acknowledgement then delivers them.
  func testAcknowledgementContractVersionMustMatchTheSubmittedBatch() async {
    let now = Date(timeIntervalSince1970: 1_790_510_400)
    let persistence = MosaicMemoryAnalyticsPersistence()
    let identity = MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence())
    let transport = AnalyticsTestTransport(.contractVersionMismatch)
    let runtime = MosaicAnalyticsRuntime(
      persistence: persistence, transport: transport, identityStore: identity,
      context: .init(sdkVersion: mosaicSDKVersion), clock: { now }, jitter: { _ in 0 })
    await runtime.setCollection(environmentEnabled: true, hostEnabled: true)
    let recordResult = await runtime.record(
      name: .experimentExposed,
      correlation: .init(
        placementRequestId: "placement_request_mismatch",
        paywallPresentationId: "presentation_mismatch"),
      attribution: .init(
        configurationReleaseId: "release_mismatch", placementId: "placement_mismatch",
        paywallId: "paywall_mismatch", paywallVersionId: "paywall_version_mismatch",
        experimentId: "experiment_mismatch",
        experimentVersionId: "experiment_version_mismatch",
        experimentVariantId: "variant_mismatch",
        experimentAllocationVersion: "allocation_mismatch_1"),
      payload: .init(
        assignmentKeyType: "identified_user",
        bucketingAlgorithm: mosaicExperimentAssignmentAlgorithm,
        productReadiness: "ready", providerCapability: "accepted", qaOverride: false),
      occurredAt: now)
    guard case .queued = recordResult else {
      return XCTFail("The canonical experiment exposure shape must queue.")
    }

    let mismatchResult = await runtime.flush()
    XCTAssertEqual(mismatchResult, .deferred)
    let deferredDiagnostics = await runtime.diagnostics()
    XCTAssertEqual(deferredDiagnostics.queuedEventCount, 1)

    // The submitted batch was well formed; only the echo was wrong.
    let submitted = await transport.batches
    XCTAssertEqual(submitted.count, 1)
    XCTAssertEqual(submitted.first?.analyticsEventContractVersion, "2")

    await transport.setBehavior(.accept)
    let matchedResult = await runtime.flush()
    XCTAssertEqual(matchedResult, .delivered(removed: 1, retained: 0))
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

  /// Conversion attribution joins solely on the event-carried Experiment tuple,
  /// and the tuple is accepted only on Event Schema v2. If a monetization event
  /// were emitted on v1, or without the complete tuple, an active Experiment
  /// would silently report zero conversions.
  @MainActor
  func testActiveExperimentAttributesMonetizationEventsOnSchemaV2() async throws {
    func events(withExperiment: Bool) async throws -> [MosaicAnalyticsEvent] {
      let persistence = MosaicMemoryAnalyticsPersistence()
      let runtime = MosaicAnalyticsRuntime(
        persistence: persistence, transport: AnalyticsTestTransport(.fail),
        identityStore: MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence()),
        context: .init(sdkVersion: mosaicSDKVersion), jitter: { _ in 0 })
      await runtime.setCollection(environmentEnabled: true, hostEnabled: true)
      let base = MosaicAnalyticsAttribution(
        configurationReleaseId: "release_experiment", placementId: "placement_experiment",
        paywallId: "paywall_experiment", paywallVersionId: "paywall_version_experiment")
      var experiment: MosaicAnalyticsAttribution?
      if withExperiment {
        experiment = MosaicAnalyticsAttribution(
          experimentId: "experiment_checkout",
          experimentVersionId: "experiment_version_checkout_1",
          experimentVariantId: "variant_treatment_a",
          experimentAllocationVersion: "allocation_checkout_1")
      }
      let analytics = MosaicAnalyticsPresentationInstrumentation(
        runtime: runtime, placementRequestID: "placement_request_experiment",
        presentationID: "presentation_experiment", attribution: base,
        experimentAttribution: experiment, providerID: "mock")
      let document = try canonicalDocument()
      let model = MosaicPaywallModel(
        document: document,
        purchaseProvider: MockMosaicPurchaseProvider(
          products: MosaicProduct.phase1MockProducts, purchaseBehavior: .success),
        analytics: analytics,
        onResult: { _ in })
      await model.prepare()
      await model.purchase(using: try purchaseButton(in: document))

      var queued: [MosaicAnalyticsEvent] = []
      for _ in 0..<1_000 {
        queued = await persistence.load()?.queue.map(\.event) ?? []
        let names = Set(queued.map(\.eventName))
        if names.contains(.purchaseStarted) && names.contains(.purchaseCompletedClient) { break }
        await Task.yield()
      }
      return queued
    }

    let attributed = try await events(withExperiment: true)
    let conversionNames: [MosaicAnalyticsEventName] = [
      .productSelected, .purchaseStarted, .purchaseCompletedClient,
    ]
    for name in conversionNames {
      let event = try XCTUnwrap(attributed.first { $0.eventName == name }, name.rawValue)
      // v1 cannot carry the tuple at all.
      XCTAssertEqual(event.eventSchemaVersion, "2", name.rawValue)
      XCTAssertEqual(event.attribution.experimentId, "experiment_checkout", name.rawValue)
      XCTAssertEqual(
        event.attribution.experimentVersionId, "experiment_version_checkout_1", name.rawValue)
      XCTAssertEqual(
        event.attribution.experimentVariantId, "variant_treatment_a", name.rawValue)
      XCTAssertEqual(
        event.attribution.experimentAllocationVersion, "allocation_checkout_1", name.rawValue)
      // All-or-none: the encoded event must survive the closed codec.
      XCTAssertNoThrow(
        try MosaicAnalyticsCodec.decodeEvent(MosaicAnalyticsCodec.encode(event)), name.rawValue)
    }

    // Without an assignment the same events carry no partial tuple.
    let unattributed = try await events(withExperiment: false)
    for name in conversionNames {
      let event = try XCTUnwrap(unattributed.first { $0.eventName == name }, name.rawValue)
      XCTAssertEqual(event.eventSchemaVersion, "2", name.rawValue)
      XCTAssertNil(event.attribution.experimentId, name.rawValue)
      XCTAssertNil(event.attribution.experimentVersionId, name.rawValue)
      XCTAssertNil(event.attribution.experimentVariantId, name.rawValue)
      XCTAssertNil(event.attribution.experimentAllocationVersion, name.rawValue)
      XCTAssertNoThrow(
        try MosaicAnalyticsCodec.decodeEvent(MosaicAnalyticsCodec.encode(event)), name.rawValue)
    }
  }
}
