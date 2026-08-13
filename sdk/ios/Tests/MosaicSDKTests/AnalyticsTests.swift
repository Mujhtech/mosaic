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
  /// Every canonical Analytics Event fixture decodes, and every canonical invalid
  /// one is rejected.
  ///
  /// The corpus is read from the directory rather than from a list copied here,
  /// so a fixture added or renamed upstream is exercised without an edit and an
  /// emptied corpus fails instead of silently passing.
  func testCanonicalFixturesDecodeWithClosedEventAndResponseCodecs() throws {
    let events = try analyticsFixtureNames(in: ".")
    XCTAssertGreaterThanOrEqual(events.count, 6)
    for fixture in events {
      XCTAssertNoThrow(try MosaicAnalyticsCodec.decodeEvent(analyticsFixtureData(fixture)), fixture)
    }

    let journey = try MosaicAnalyticsCodec.decodeBatch(
      analyticsFixtureData("batches/experiment-journey.json"))
    XCTAssertEqual(journey.events.count, 5)
    XCTAssertEqual(journey.events.first?.identity?.installationId, "installation_001")

    let responses = try analyticsFixtureNames(in: "responses")
    XCTAssertFalse(responses.isEmpty)
    for fixture in responses {
      XCTAssertNoThrow(
        try MosaicAnalyticsCodec.decodeResponse(analyticsFixtureData("responses/\(fixture)")),
        fixture)
    }

    let invalid = try analyticsFixtureNames(in: "invalid")
      .filter { $0 != "rejection-layers.json" }
    XCTAssertFalse(invalid.isEmpty)
    for fixture in invalid {
      XCTAssertThrowsError(
        try MosaicAnalyticsCodec.decodeEvent(analyticsFixtureData("invalid/\(fixture)")), fixture)
    }
  }

  func testCodecRejectsUnsafeBoundedFieldsAndIncompleteRuleSetIdentity() throws {
    let fixture = try analyticsFixtureData("batches/experiment-journey.json")
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
    // A closed payload vocabulary: an unsafe value in a bounded enumeration slot
    // is rejected rather than carried through to the collector.
    XCTAssertThrowsError(
      try MosaicAnalyticsCodec.decodeEvent(
        encodedEvent(4) { event in
          var payload = event["payload"] as! [String: Any]
          payload["outcome"] = "Rendering Failure"
          event["payload"] = payload
        }))
    // Rule-set identity is all-or-nothing: an id without its version names a
    // rule set that cannot be pinned to what actually evaluated.
    XCTAssertThrowsError(
      try MosaicAnalyticsCodec.decodeEvent(
        encodedEvent(0) { event in
          var attribution = event["attribution"] as! [String: Any]
          attribution["placementRuleSetId"] = "rule_set_experiment"
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
    // Collection is enabled by default, so a disabled Environment is seeded
    // explicitly here rather than relied on as the starting state.
    await runtime.setCollection(environmentEnabled: false, hostEnabled: true)
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

  /// The core Experiment analytics invariant: a conversion event carries the
  /// Experiment tuple **if and only if** an `experiment_exposed` row exists for
  /// that presentation.
  ///
  /// Conversion attribution joins a conversion to an exposure by equality on
  /// the Experiment columns of the conversion event itself. Both a fallback
  /// presentation and a QA-override presentation emit no exposure, so a
  /// tuple-carrying `product_selected` from either would displace the Variant's
  /// legitimate denominator row in `product_selection_purchase_start`.
  ///
  /// `experiment_fallback_presented` still carries the tuple; it is a
  /// diagnostic event, not a conversion.
  @MainActor
  func testConversionTupleExistsExactlyWhenExposureIsRecorded() async throws {
    let assignment = try qaOverrideAssignment()
    let variant = try XCTUnwrap(assignment.variants.first)
    func selection(source: MosaicExperimentAssignmentSource) -> MosaicExperimentSelection {
      MosaicExperimentSelection(
        assignment: assignment, variant: variant, keyType: .identifiedUser, bucket: 1_118,
        groupBucket: nil, source: source,
        subjectDigest: "sha256:" + String(repeating: "a", count: 64)
      )
    }
    let exposed = selection(source: .deterministic)
    let qaOverride = selection(source: .qaOverride)
    XCTAssertFalse(exposed.excludedFromResults)
    XCTAssertTrue(qaOverride.excludedFromResults, "A QA override is excluded from results.")

    let experiment = MosaicAnalyticsAttribution(
      configurationReleaseId: "release_experiment", placementId: "placement_experiment",
      experimentId: assignment.experimentId,
      experimentVersionId: assignment.experimentVersionId,
      experimentVariantId: variant.id,
      experimentAllocationVersion: assignment.allocationVersion)

    // The tuple predicate must agree with the exposure predicate in every case.
    let cases:
      [(name: String, selection: MosaicExperimentSelection?, fallback: String?, exposes: Bool)] = [
        ("exposed original variant", exposed, nil, true),
        ("fallback: products unavailable", exposed, "products_unavailable", false),
        ("fallback: provider capability", exposed, "provider_capability", false),
        ("qa override", qaOverride, nil, false),
        ("qa override with fallback", qaOverride, "products_unavailable", false),
        ("no assignment", nil, nil, false),
      ]
    for value in cases {
      let exposes = MosaicPlacementPaywall.recordsStatisticalExposure(
        selection: value.selection, experiment: experiment, fallbackReason: value.fallback)
      XCTAssertEqual(exposes, value.exposes, value.name)
      let tuple = MosaicPlacementPaywall.conversionExperimentAttribution(
        experiment: experiment, selection: value.selection, fallbackReason: value.fallback)
      // tuple <-> exposure
      XCTAssertEqual(tuple != nil, exposes, value.name)
      XCTAssertEqual(tuple, value.exposes ? experiment : nil, value.name)
    }

    // End to end: a QA-override presentation emits tuple-free conversions.
    let queued = try await conversionEvents(
      experiment: MosaicPlacementPaywall.conversionExperimentAttribution(
        experiment: experiment, selection: qaOverride, fallbackReason: nil))
    for name in [
      MosaicAnalyticsEventName.productSelected, .purchaseStarted, .purchaseCompletedClient,
    ] {
      let event = try XCTUnwrap(queued.first { $0.eventName == name }, name.rawValue)
      XCTAssertNil(event.attribution.experimentId, name.rawValue)
      XCTAssertNil(event.attribution.experimentVersionId, name.rawValue)
      XCTAssertNil(event.attribution.experimentVariantId, name.rawValue)
      XCTAssertNil(event.attribution.experimentAllocationVersion, name.rawValue)
      // Tuple removal is the rule; the schema version is unaffected.
      XCTAssertEqual(event.eventSchemaVersion, "2", name.rawValue)
      // The product attribution a conversion does need is still present.
      XCTAssertEqual(event.attribution.mosaicProductId, "yearly-plan", name.rawValue)
    }

    // And a fallback presentation does the same.
    let fallbackQueued = try await conversionEvents(
      experiment: MosaicPlacementPaywall.conversionExperimentAttribution(
        experiment: experiment, selection: exposed, fallbackReason: "products_unavailable"))
    for name in [
      MosaicAnalyticsEventName.productSelected, .purchaseStarted, .purchaseCompletedClient,
    ] {
      let event = try XCTUnwrap(fallbackQueued.first { $0.eventName == name }, name.rawValue)
      XCTAssertNil(event.attribution.experimentId, name.rawValue)
      XCTAssertNil(event.attribution.experimentAllocationVersion, name.rawValue)
      XCTAssertEqual(event.attribution.mosaicProductId, "yearly-plan", name.rawValue)
    }
  }

  /// Drives one real paywall purchase and returns the queued events.
  @MainActor
  private func conversionEvents(
    experiment: MosaicAnalyticsAttribution?
  ) async throws -> [MosaicAnalyticsEvent] {
    let persistence = MosaicMemoryAnalyticsPersistence()
    let runtime = MosaicAnalyticsRuntime(
      persistence: persistence, transport: AnalyticsTestTransport(.fail),
      identityStore: MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence()),
      context: .init(sdkVersion: mosaicSDKVersion), jitter: { _ in 0 })
    await runtime.setCollection(environmentEnabled: true, hostEnabled: true)
    let analytics = MosaicAnalyticsPresentationInstrumentation(
      runtime: runtime, placementRequestID: "placement_request_experiment",
      presentationID: "presentation_experiment",
      attribution: .init(
        configurationReleaseId: "release_experiment", placementId: "placement_experiment",
        paywallId: "paywall_control", paywallVersionId: "paywall_version_control"),
      experimentAttribution: experiment,
      providerID: "mock")
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

  private func qaOverrideAssignment() throws -> MosaicExperimentAssignment {
    try MosaicExperimentAssignmentDecoder.decode(
      phase5FixtureData("experiment-assignment/v1/staging-qa.json"), environmentMode: .staging)
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

  /// Analytics collection is opt-out. A host that never touches the flag gets a
  /// live analytics runtime that queues events, and opts out explicitly through
  /// the host gate alone. Ingestion stays gated by the Environment setting
  /// server-side; this only pins the client default.
  func testAnalyticsCollectionIsEnabledByDefaultAndHostsOptOutExplicitly() async throws {
    // Port 1 is reserved, so nothing leaves the process during this test.
    let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:1"))
    let mosaic = try await Mosaic.configureHosted(
      publicSDKKey: "public_analytics_default_key",
      baseURL: baseURL,
      applicationVersion: nil,
      requestTimeout: 1,
      bundledFallback: .packaged,
      purchaseProvider: MockMosaicPurchaseProvider(),
      persistenceRoot: .unavailable
    )

    let defaultDiagnostics = await mosaic.analyticsDiagnostics()
    XCTAssertTrue(defaultDiagnostics.collectionEnabled)
    // Through the public handle, so the device-derived context the registry
    // builds has to be acceptable to the codec for the default to mean anything.
    let recorded = await mosaic.recordAnalytics(
      .paywallActionSelected,
      correlation: .init(paywallPresentationId: "presentation_default"),
      payload: .init(action: "close"))
    guard case .queued = recorded else {
      return XCTFail("The enabled default must queue without any host opt-in: \(recorded)")
    }
    let queued = await mosaic.analyticsDiagnostics()
    XCTAssertEqual(queued.queuedEventCount, 1)

    // Opting out is a single host call that needs no knowledge of the
    // Environment setting. It clears unsent events and stops recording.
    await mosaic.setAnalyticsCollection(hostEnabled: false)
    let optedOut = await mosaic.analyticsDiagnostics()
    XCTAssertFalse(optedOut.collectionEnabled)
    XCTAssertEqual(optedOut.queuedEventCount, 0)
    let afterOptOut = await mosaic.recordAnalytics(
      .paywallActionSelected,
      correlation: .init(paywallPresentationId: "presentation_opted_out"),
      payload: .init(action: "close"))
    XCTAssertEqual(afterOptOut, .collectionDisabled)
  }

  /// The two collection gates are independent, and naming one must not write a
  /// value for the other. With both parameters defaulted to `true`, the host
  /// opt-out call `setAnalyticsCollection(hostEnabled:)` also wrote
  /// `environmentEnabled: true`, so a host toggling its own gate back on would
  /// silently re-enable a disabled Environment — the exact thing the API
  /// documents it cannot do.
  func testSettingOneCollectionGateLeavesTheOtherAtItsStoredValue() async throws {
    // Port 1 is reserved, so nothing leaves the process during this test.
    let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:1"))
    let mosaic = try await Mosaic.configureHosted(
      publicSDKKey: "public_analytics_gate_key",
      baseURL: baseURL,
      applicationVersion: nil,
      requestTimeout: 1,
      bundledFallback: .packaged,
      purchaseProvider: MockMosaicPurchaseProvider(),
      persistenceRoot: .unavailable
    )

    await mosaic.setAnalyticsCollection(environmentEnabled: false)
    let disabled = await mosaic.analyticsDiagnostics()
    XCTAssertFalse(disabled.collectionEnabled)

    // A host toggling only its own gate cannot revive the Environment gate.
    await mosaic.setAnalyticsCollection(hostEnabled: true)
    let stillDisabled = await mosaic.analyticsDiagnostics()
    XCTAssertFalse(stillDisabled.collectionEnabled)

    // And the host gate is likewise preserved across an Environment update.
    await mosaic.setAnalyticsCollection(hostEnabled: false)
    await mosaic.setAnalyticsCollection(environmentEnabled: true)
    let hostStillOptedOut = await mosaic.analyticsDiagnostics()
    XCTAssertFalse(hostStillOptedOut.collectionEnabled)
  }

  /// `Locale.current.identifier` is an ICU identifier: a region override or a
  /// non-Gregorian calendar appends `@`-keywords that the closed event codec
  /// rejects, which silently dropped every event on those devices. The
  /// normalized tag must be accepted by the codec, not merely well formed.
  func testDeviceLocaleNormalizationKeepsEventsAcceptableToTheClosedCodec() async throws {
    XCTAssertEqual(MosaicDeviceLocale.contextTag("en_US@rg=gbzzzz"), "en-US")
    XCTAssertEqual(MosaicDeviceLocale.contextTag("zh_Hans_CN@calendar=chinese"), "zh-Hans-CN")
    // The iOS 16+ tag form of the same region override collapses identically,
    // so the two deployment paths cannot disagree.
    XCTAssertEqual(MosaicDeviceLocale.contextTag("en-US-u-rg-gbzzzz"), "en-US")
    XCTAssertEqual(MosaicDeviceLocale.contextTag("en_US.UTF-8"), "en-US")
    XCTAssertEqual(MosaicDeviceLocale.contextTag("en_US_#u-rg-gbzzzz"), "en-US")
    XCTAssertEqual(MosaicDeviceLocale.contextTag("en_US_POSIX"), "en-US-posix")
    // Nothing usable survives. The field is omitted rather than carrying a
    // language the device never reported; the codec accepts an absent locale.
    XCTAssertNil(MosaicDeviceLocale.contextTag("@calendar=chinese"))
    XCTAssertNil(MosaicDeviceLocale.contextTag(""))
    // The device's own locale must satisfy the contract on whatever host runs
    // the suite, which is how the original defect reached CI unnoticed.
    let deviceTag = try XCTUnwrap(MosaicDeviceLocale.currentContextTag)
    XCTAssertEqual(MosaicDeviceLocale.contextTag(deviceTag), deviceTag)

    for identifier in ["en_US@rg=gbzzzz", "zh_Hans_CN@calendar=chinese", deviceTag] {
      let runtime = MosaicAnalyticsRuntime(
        persistence: MosaicMemoryAnalyticsPersistence(),
        transport: AnalyticsTestTransport(.fail),
        identityStore: MosaicIdentityStore(persistence: MosaicMemoryIdentityPersistence()),
        context: .init(
          sdkVersion: mosaicSDKVersion, locale: MosaicDeviceLocale.contextTag(identifier)
        ),
        jitter: { _ in 0 })
      let recorded = await runtime.record(
        name: .paywallActionSelected,
        correlation: .init(paywallPresentationId: "presentation_locale"),
        attribution: .init(), payload: .init(action: "close"))
      guard case .queued = recorded else {
        return XCTFail("\(identifier) produced a context the codec rejects: \(recorded)")
      }
    }
  }
}
