import Foundation
import XCTest

@testable import MosaicSDK

/// A transport whose response is scripted per call, so the queue's terminal
/// status handling can be driven without a server.
private actor ObservationTestTransport: MosaicTransactionObservationTransport {
  private var responses: [MosaicTransactionObservationHTTPResponse]
  private(set) var bodies: [Data] = []
  private(set) var customerTokens: [MosaicCustomerAccessToken?] = []

  init(_ responses: [MosaicTransactionObservationHTTPResponse]) {
    self.responses = responses
  }

  func send(data: Data, customerToken: MosaicCustomerAccessToken?) async throws
    -> MosaicTransactionObservationHTTPResponse
  {
    bodies.append(data)
    customerTokens.append(customerToken)
    guard !responses.isEmpty else { throw URLError(.notConnectedToInternet) }
    return responses.removeFirst()
  }

  func recordedBodies() -> [Data] { bodies }
  func recordedCustomerTokens() -> [MosaicCustomerAccessToken?] { customerTokens }
}

/// A token source under direct test control, so "a token arrived between
/// enqueue and flush" is expressible without driving a real provider.
/// A clock the test can move forward, so retry eligibility is reachable without
/// sleeping.
private final class MutableClock: @unchecked Sendable {
  private let lock = NSLock()
  private var current: Date

  init(start: Date) { current = start }

  func now() -> Date {
    lock.lock()
    defer { lock.unlock() }
    return current
  }

  func advance(_ seconds: TimeInterval) {
    lock.lock()
    current = current.addingTimeInterval(seconds)
    lock.unlock()
  }
}

private actor StubCustomerTokenSource: MosaicCustomerTokenSource {
  private var token: MosaicCustomerAccessToken?

  init(token: MosaicCustomerAccessToken? = nil) { self.token = token }

  func set(_ token: MosaicCustomerAccessToken?) { self.token = token }
  func heldCustomerToken() -> MosaicCustomerAccessToken? { token }
}

extension MosaicTransactionObservationHTTPResponse {
  /// One Billing Ingestion Contract 1 `observationSubmissionResult` record.
  fileprivate static func result(
    _ status: String, submissionID: String, code: String? = nil,
    contractVersion: String = "1", recordType: String = "observationSubmissionResult",
    statusCode: Int = 202
  ) -> MosaicTransactionObservationHTTPResponse {
    var payload: [String: Any] = [
      "submissionId": submissionID, "receivedAt": "2026-07-27T12:00:00.400Z", "status": status,
    ]
    if let code { payload["code"] = code }
    let record: [String: Any] = [
      "billingIngestionContractVersion": contractVersion,
      "recordType": recordType,
      "payload": payload,
    ]
    return .init(
      statusCode: statusCode,
      data: (try? JSONSerialization.data(withJSONObject: record)) ?? Data(),
      retryAfterSeconds: nil)
  }
}

final class TransactionObservationTests: XCTestCase {
  private let observedAt = Date(timeIntervalSince1970: 1_785_500_000)

  private func observation(
    submissionID: String = "storekit_transaction_2000000900000001",
    reference: String = "2000000900000001"
  ) throws -> MosaicTransactionObservation {
    try XCTUnwrap(
      MosaicTransactionObservation(
        submissionID: submissionID, referenceKind: .appStoreTransactionID,
        reference: reference, observedAt: observedAt))
  }

  // MARK: Customer binding

  // Risk: without the customer token an identified user's purchase anchors
  // anonymously and has to be associated to their Billing Customer later by
  // other evidence — which is exactly the association gap Phase 9B exists to
  // close.
  func testSubmissionCarriesTheCustomerTokenWhenOneIsHeld() async throws {
    let transport = ObservationTestTransport([
      .result("accepted_for_validation", submissionID: "s1")
    ])
    let runtime = runtime(
      persistence: MosaicMemoryTransactionObservationPersistence(), transport: transport)
    await runtime.attachCustomerTokenSource(
      StubCustomerTokenSource(token: MosaicCustomerAccessToken("mcat_bound")))

    await runtime.enqueue(try observation(submissionID: "s1"))

    let tokens = await transport.recordedCustomerTokens()
    XCTAssertEqual(tokens, [MosaicCustomerAccessToken("mcat_bound")])
  }

  // Risk: attaching a token for a signed-out session would bind a purchase to
  // whoever was signed in last. Anonymous submission stays valid, so absence is
  // not an error and must not suppress delivery.
  func testSubmissionOmitsTheTokenWhenSignedOutAndStillDelivers() async throws {
    let transport = ObservationTestTransport([
      .result("accepted_for_validation", submissionID: "s1")
    ])
    let runtime = runtime(
      persistence: MosaicMemoryTransactionObservationPersistence(), transport: transport)
    await runtime.attachCustomerTokenSource(StubCustomerTokenSource(token: nil))

    await runtime.enqueue(try observation(submissionID: "s1"))

    let tokens = await transport.recordedCustomerTokens()
    XCTAssertEqual(tokens, [nil])
    let diagnostics = await runtime.diagnostics()
    XCTAssertEqual(
      diagnostics.acceptedForValidationCount, 1,
      "an anonymous submission is still a valid submission")
  }

  // Risk: a queued observation can outlive many token generations. Binding at
  // enqueue time would either persist a credential or attach a stale one; the
  // token must be read at send time.
  func testTokenArrivingBetweenEnqueueAndFlushIsUsed() async throws {
    let transport = ObservationTestTransport([
      // The first attempt fails, so the observation stays queued.
      .init(statusCode: 503, data: Data(), retryAfterSeconds: nil),
      .result("accepted", submissionID: "s1"),
    ])
    let source = StubCustomerTokenSource(token: nil)
    // The clock has to advance past the retry backoff, so this runtime is built
    // directly rather than with the fixed-clock helper.
    let start = Date(timeIntervalSince1970: 1_785_500_010)
    let elapsed = MutableClock(start: start)
    let runtime = MosaicTransactionObservationRuntime(
      persistence: MosaicMemoryTransactionObservationPersistence(), transport: transport,
      context: MosaicTransactionObservationContext(applicationVersion: "1.4.2"),
      clock: { elapsed.now() }, jitter: { $0.upperBound })
    await runtime.attachCustomerTokenSource(source)

    await runtime.enqueue(try observation(submissionID: "s1"))

    // The user signs in after the purchase was already queued, and enough time
    // passes for the retry to become eligible.
    await source.set(MosaicCustomerAccessToken("mcat_signed_in_later"))
    elapsed.advance(60)
    _ = await runtime.flush()

    let tokens = await transport.recordedCustomerTokens()
    XCTAssertEqual(tokens, [nil, MosaicCustomerAccessToken("mcat_signed_in_later")])
  }

  // Risk: a credential written into the observation queue would sit on disk far
  // longer than the token's own lifetime, in a file that survives relaunch. It
  // must appear in neither the persisted queue nor the diagnostics a host might
  // log.
  func testTokenIsNeverPersistedWithTheQueueOrSurfacedInDiagnostics() async throws {
    let persistence = MosaicMemoryTransactionObservationPersistence()
    // No response, so the observation fails and stays queued to be persisted.
    let transport = ObservationTestTransport([])
    let runtime = runtime(persistence: persistence, transport: transport)
    await runtime.attachCustomerTokenSource(
      StubCustomerTokenSource(token: MosaicCustomerAccessToken("mcat_secret_value")))

    await runtime.enqueue(try observation(submissionID: "s1"))

    let loaded = await persistence.load()
    let stored = try XCTUnwrap(loaded)
    XCTAssertEqual(stored.queue.count, 1, "the observation is retained for retry")
    let encoded = try JSONEncoder().encode(stored)
    let text = try XCTUnwrap(String(data: encoded, encoding: .utf8))
    XCTAssertFalse(text.contains("mcat_secret_value"))
    XCTAssertFalse(text.contains("Mosaic-Customer-Token"))

    let diagnostics = await runtime.diagnostics()
    XCTAssertFalse(String(describing: diagnostics).contains("mcat_secret_value"))
  }

  // Risk: the 9A observation record is a frozen contract. Customer binding is a
  // transport concern and must not have leaked into the submitted document.
  func testSubmittedRecordIsUnchangedByCustomerBinding() async throws {
    let transport = ObservationTestTransport([
      .result("accepted_for_validation", submissionID: "s1")
    ])
    let runtime = runtime(
      persistence: MosaicMemoryTransactionObservationPersistence(), transport: transport)
    await runtime.attachCustomerTokenSource(
      StubCustomerTokenSource(token: MosaicCustomerAccessToken("mcat_secret_value")))

    await runtime.enqueue(try observation(submissionID: "s1"))

    let bodies = await transport.recordedBodies()
    let body = try XCTUnwrap(bodies.first)
    XCTAssertEqual(
      body, try MosaicTransactionObservationCodec.encode(
        try observation(submissionID: "s1"), context: context))
    XCTAssertFalse(
      try XCTUnwrap(String(data: body, encoding: .utf8)).contains("mcat_secret_value"))
  }

  /// A runtime with a fixed clock and a deterministic worst-case backoff, so
  /// retry scheduling is reproducible.
  private func runtime(
    persistence: any MosaicTransactionObservationPersistence,
    transport: any MosaicTransactionObservationTransport,
    secondsAfterObservation: TimeInterval = 10
  ) -> MosaicTransactionObservationRuntime {
    let now = Date(timeIntervalSince1970: 1_785_500_000 + secondsAfterObservation)
    return MosaicTransactionObservationRuntime(
      persistence: persistence, transport: transport,
      context: MosaicTransactionObservationContext(applicationVersion: "1.4.2"),
      clock: { now }, jitter: { $0.upperBound })
  }

  private var context: MosaicTransactionObservationContext {
    MosaicTransactionObservationContext(applicationVersion: "1.4.2")
  }

  /// The payload of the submitted record.
  private func payload(_ observation: MosaicTransactionObservation) throws -> [String: Any] {
    let encoded = try MosaicTransactionObservationCodec.encode(observation, context: context)
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    return try XCTUnwrap(root["payload"] as? [String: Any])
  }

  /// The submitted record must reproduce the canonical client observation
  /// fixture exactly.
  ///
  /// Every value the SDK does not author itself is taken *from* the fixture and
  /// the whole encoded document is compared to it, so drift in either direction
  /// — a field the SDK stops emitting, a value the fixture changes — fails
  /// here. Comparing key sets against inline literals would not.
  func testSubmittedRecordReproducesTheCanonicalObservationFixture() throws {
    let fixture = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: try phase5FixtureData("billing-ingestion/v1/apple-client-observation.json"))
        as? [String: Any])
    let fixturePayload = try XCTUnwrap(fixture["payload"] as? [String: Any])
    let fixtureReference = try XCTUnwrap(fixturePayload["transactionReference"] as? [String: Any])
    let fixtureContext = try XCTUnwrap(fixturePayload["context"] as? [String: Any])
    let fixtureCorrelation = try XCTUnwrap(fixturePayload["correlation"] as? [String: Any])

    let fixtureRecord = try XCTUnwrap(
      MosaicTransactionObservation(
        submissionID: try XCTUnwrap(fixturePayload["submissionId"] as? String),
        referenceKind: try XCTUnwrap(
          MosaicTransactionObservationReferenceKind(
            rawValue: try XCTUnwrap(fixtureReference["referenceKind"] as? String))),
        reference: try XCTUnwrap(fixtureReference["value"] as? String),
        providerID: try XCTUnwrap(fixturePayload["providerId"] as? String),
        observationID: try XCTUnwrap(fixturePayload["observationId"] as? String),
        observedAt: try XCTUnwrap(
          MosaicAnalyticsRuntime.parseTimestamp(
            try XCTUnwrap(fixturePayload["observedAt"] as? String))),
        correlation: MosaicTransactionObservationCorrelation(
          purchaseAttemptID: try XCTUnwrap(fixtureCorrelation["purchaseAttemptId"] as? String))))
    let fixtureSDKContext = MosaicTransactionObservationContext(
      sdkVersion: try XCTUnwrap(fixtureContext["sdkVersion"] as? String),
      operatingSystemVersion: try XCTUnwrap(fixtureContext["operatingSystemVersion"] as? String),
      applicationVersion: try XCTUnwrap(fixtureContext["applicationVersion"] as? String))

    let encoded = try MosaicTransactionObservationCodec.encode(
      fixtureRecord, context: fixtureSDKContext)
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

    // Full-document equality. `storePlatform`, `sourceAuthority`, the contract
    // version, the record type, and the reference envelope are all authored by
    // the codec, so this pins them to the canonical values rather than to a
    // literal repeated in this file.
    XCTAssertEqual(NSDictionary(dictionary: root), NSDictionary(dictionary: fixture))
    XCTAssertEqual(Set(root.keys), MosaicTransactionObservationCodec.envelopeKeys)
    XCTAssertTrue(
      Set(fixturePayload.keys).isSubset(of: MosaicTransactionObservationCodec.wireKeys))

    // The identifiers the SDK authors itself cannot come from the fixture, so
    // they are checked against the contract's identifier rule and, for the
    // derived one, against its derivation.
    let authored = try XCTUnwrap(
      MosaicTransactionObservation(
        submissionID: "storekit_transaction_2000000900000001", reference: "2000000900000001"))
    XCTAssertEqual(
      authored.observationID, "observation_storekit_transaction_2000000900000001")
    for identifier in [authored.observationID, authored.submissionID, authored.providerID] {
      XCTAssertTrue(
        MosaicTransactionObservation.isIdentifier(identifier), identifier)
      XCTAssertLessThanOrEqual(identifier.count, 128, identifier)
    }
    let live = MosaicTransactionObservationContext(applicationVersion: "1.4.2")
    XCTAssertEqual(live.platform, fixtureContext["platform"] as? String)
    XCTAssertEqual(live.sdkFamily, fixtureContext["sdkFamily"] as? String)
    XCTAssertEqual(live.sdkVersion, mosaicSDKVersion)
    XCTAssertNotNil(
      live.sdkVersion.range(
        of: "^[A-Za-z0-9][A-Za-z0-9.+_-]*$", options: .regularExpression))
    XCTAssertLessThanOrEqual(live.sdkVersion.count, 64)

    // Correlation is the only optional member, and it is absent when there is
    // no handle to carry.
    let plain = try payload(observation())
    XCTAssertEqual(Set(plain.keys), Set(fixturePayload.keys).subtracting(["correlation"]))

    let serialized = try XCTUnwrap(String(data: encoded, encoding: .utf8))
    for forbidden in [
      "jws", "signedTransaction", "deviceVerification", "appAccountToken", "appTransactionID",
      "originalID", "purchaseToken", "receipt",
      // A client observation never asserts a Store Environment, a tenant, a
      // price, or an entitlement.
      "storeEnvironment", "sandbox", "production", "organizationId", "projectId",
      "environmentId", "monetaryAmount", "entitlement",
    ] {
      XCTAssertFalse(serialized.localizedCaseInsensitiveContains(forbidden), forbidden)
    }
  }

  /// The four canonical response fixtures must decode to the four contract
  /// outcomes.
  ///
  /// Asserting against the shared fixtures rather than hand-built JSON is what
  /// binds the Swift decoder to the frozen record shape; a change to the
  /// envelope, the status vocabulary, or the retry hint fails here.
  func testCanonicalSubmissionResultFixturesDecodeToTheContractOutcomes() throws {
    func decode(_ fixture: String, submissionID: String)
      throws -> MosaicTransactionObservationSubmissionResult
    {
      MosaicTransactionObservationCodec.decodeResult(
        try phase5FixtureData("billing-ingestion/v1/responses/\(fixture)"),
        submissionID: submissionID)
    }

    XCTAssertEqual(
      try decode("accepted-for-validation.json", submissionID: "fixture-submission-apple-0001"),
      .init(outcome: .acceptedForValidation, retryAfterSeconds: nil))
    XCTAssertEqual(
      try decode("duplicate-observation.json", submissionID: "fixture-submission-apple-0001"),
      .init(outcome: .duplicate, retryAfterSeconds: nil))
    XCTAssertEqual(
      try decode("permanent-rejection.json", submissionID: "fixture-submission-malformed-0001"),
      .init(
        outcome: .permanentlyRejected(code: "provider_reference_malformed"),
        retryAfterSeconds: nil))
    XCTAssertEqual(
      try decode("retryable-failure.json", submissionID: "fixture-submission-google-0001"),
      .init(outcome: .retryableFailure(code: "rate_limited"), retryAfterSeconds: 30))

    // A result addressed to a different submission is never applied to this
    // record.
    XCTAssertEqual(
      try decode("accepted-for-validation.json", submissionID: "storekit_transaction_1"),
      .init(outcome: .retryableFailure(code: "submission_id_mismatch"), retryAfterSeconds: nil))
  }

  /// The App Store reference is a decimal string end to end.
  ///
  /// The shared vectors include 2^53+1 and UInt64.max precisely because an
  /// implementation that parses the identifier into a double or a signed 64-bit
  /// integer agrees on every ordinary value and corrupts these two.
  func testAppStoreReferenceVectorsSurviveAsStringsWithinContractBounds() throws {
    let root = try billingReferenceVectors()
    let section = try XCTUnwrap(root["appStoreTransactionId"] as? [String: Any])
    XCTAssertEqual(section["referenceKind"] as? String, "app_store_transaction_id")
    let vectors = try XCTUnwrap(section["vectors"] as? [[String: Any]])
    XCTAssertFalse(vectors.isEmpty)
    var identifiers = Set<String>()

    for vector in vectors {
      let value = try XCTUnwrap(vector["value"] as? String)
      identifiers.insert(try XCTUnwrap(vector["id"] as? String))
      let candidate = try observation(
        submissionID: "storekit_transaction_\(value)", reference: value)
      XCTAssertEqual(candidate.reference, value)
      XCTAssertLessThanOrEqual(value.count, 24)
      XCTAssertTrue(value.allSatisfy(\.isNumber))

      // Round-tripping through JSON proves the value is carried as a string
      // rather than as a JSON number.
      let body = try payload(candidate)
      let reference = try XCTUnwrap(body["transactionReference"] as? [String: Any])
      XCTAssertEqual(reference["value"] as? String, value)
      XCTAssertLessThanOrEqual(try XCTUnwrap(body["submissionId"] as? String).count, 128)
      XCTAssertLessThanOrEqual(try XCTUnwrap(body["observationId"] as? String).count, 128)
    }

    XCTAssertTrue(identifiers.contains("uint64-max"))
    XCTAssertTrue(identifiers.contains("beyond-double-precision"))
    // The device-side derivation is String(Transaction.id); the shared vector
    // pins the exact digits an iOS client can produce at the upper bound.
    let maximum = try XCTUnwrap(
      vectors.first(where: { $0["id"] as? String == "uint64-max" })?["value"] as? String)
    XCTAssertEqual(String(UInt64.max), maximum)
    XCTAssertEqual(maximum.count, 20)

    // A value outside the contract bounds is dropped on the device instead of
    // being sent for guaranteed rejection.
    XCTAssertNil(
      MosaicTransactionObservation(
        submissionID: "storekit_transaction_1", reference: String(repeating: "9", count: 25)))
    XCTAssertNil(
      MosaicTransactionObservation(submissionID: "storekit_transaction_1", reference: "storekit_1"))
  }

  /// The queue must survive relaunch and must never submit one transaction
  /// twice, because Mosaic finishes transactions as soon as local delivery is
  /// durable and cannot rely on StoreKit to replay them.
  func testQueueSurvivesRestartAndIsDuplicateSafe() async throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("mosaic-observations-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let baseURL = try XCTUnwrap(URL(string: "https://example.test"))
    // Two persistence instances over the same file are the restart: the record
    // has to survive as bytes, not as process memory.
    func store() throws -> MosaicTransactionObservationFilePersistence {
      try MosaicTransactionObservationFilePersistence(
        baseURL: baseURL, publicSDKKey: "public_observation_key", rootDirectory: root)
    }
    let persistence = try store()
    let offline = ObservationTestTransport([])
    let first = runtime(persistence: persistence, transport: offline)

    await first.enqueue(try observation())
    // The same transaction observed again (relaunch replay of
    // Transaction.unfinished) must not add a second record.
    await first.enqueue(try observation())
    await first.enqueue(
      try observation(
        submissionID: "storekit_transaction_2000000900000002", reference: "2000000900000002"))

    let queued = await first.diagnostics()
    XCTAssertEqual(queued.queuedCount, 2)
    XCTAssertEqual(queued.acceptedForValidationCount, 0)
    XCTAssertEqual(queued.lastSafeCode, "service_temporarily_unavailable")

    // A fresh runtime over the same persistence is the restart.
    let transport = ObservationTestTransport([
      .result("accepted_for_validation", submissionID: "storekit_transaction_2000000900000001"),
      .result("duplicate", submissionID: "storekit_transaction_2000000900000002"),
    ])
    // An hour later, past any scheduled backoff.
    let restarted = runtime(
      persistence: try store(), transport: transport, secondsAfterObservation: 3_600)
    let restored = await restarted.diagnostics()
    XCTAssertEqual(restored.queuedCount, 2)

    let result: MosaicTransactionObservationFlushResult = await restarted.flush()
    XCTAssertEqual(result, .delivered(removed: 2, retained: 0))
    let diagnostics = await restarted.diagnostics()
    XCTAssertEqual(diagnostics.acceptedForValidationCount, 1)
    // A duplicate is idempotent, not an error: it clears the record and never
    // escalates into a rejection.
    XCTAssertEqual(diagnostics.duplicateCount, 1)
    XCTAssertEqual(diagnostics.permanentlyRejectedCount, 0)
    XCTAssertEqual(diagnostics.queuedCount, 0)

    let submitted = await transport.recordedBodies()
    XCTAssertEqual(submitted.count, 2)
    let references = try submitted.map { body -> String in
      let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
      let payload = try XCTUnwrap(object["payload"] as? [String: Any])
      let reference = try XCTUnwrap(payload["transactionReference"] as? [String: Any])
      return try XCTUnwrap(reference["value"] as? String)
    }
    XCTAssertEqual(Set(references), ["2000000900000001", "2000000900000002"])
  }

  /// No response can move a record into a success state the contract does not
  /// contain. An unknown, absent, or invented status is retryable, so a server
  /// or contract change can never silently upgrade a local purchase into a
  /// server-validated one.
  func testUnknownSubmissionStatusIsRetryableAndNeverValidated() async throws {
    let submissionID = "storekit_transaction_2000000900000001"
    let responses: [MosaicTransactionObservationHTTPResponse] = [
      .result("validated", submissionID: submissionID),
      .result("confirmed", submissionID: submissionID),
      .result("", submissionID: submissionID),
      .result("accepted_for_validation", submissionID: "storekit_transaction_9"),
      // A future contract version carries different semantics and is never
      // reinterpreted under this one's rules, even when it says accepted.
      .result("accepted_for_validation", submissionID: submissionID, contractVersion: "2"),
      .result(
        "accepted_for_validation", submissionID: submissionID, recordType: "validationResult"),
      .init(statusCode: 500, data: Data(), retryAfterSeconds: nil),
      .init(statusCode: 202, data: Data("{}".utf8), retryAfterSeconds: nil),
      // The superseded flat envelope must not be honoured either.
      .init(
        statusCode: 202,
        data: Data(#"{"data":{"submissionId":"x","outcome":"accepted_for_validation"}}"#.utf8),
        retryAfterSeconds: nil),
    ]
    for response in responses {
      let persistence = MosaicMemoryTransactionObservationPersistence()
      let transport = ObservationTestTransport([response])
      let queue = runtime(persistence: persistence, transport: transport)
      await queue.enqueue(try observation())

      let diagnostics = await queue.diagnostics()
      XCTAssertEqual(diagnostics.acceptedForValidationCount, 0)
      XCTAssertEqual(diagnostics.duplicateCount, 0)
      XCTAssertEqual(diagnostics.permanentlyRejectedCount, 0)
      XCTAssertEqual(diagnostics.retryCount, 1)
      // The record is retained for a later attempt rather than discarded.
      XCTAssertEqual(diagnostics.queuedCount, 1)
    }

    // A permanent rejection is the only response that removes a record without
    // counting as acceptance.
    let persistence = MosaicMemoryTransactionObservationPersistence()
    let transport = ObservationTestTransport([
      .result("permanently_rejected", submissionID: submissionID, code: "unknown_provider")
    ])
    let queue = runtime(persistence: persistence, transport: transport)
    await queue.enqueue(try observation())
    let diagnostics = await queue.diagnostics()
    XCTAssertEqual(diagnostics.permanentlyRejectedCount, 1)
    XCTAssertEqual(diagnostics.acceptedForValidationCount, 0)
    XCTAssertEqual(diagnostics.lastSafeCode, "unknown_provider")
    XCTAssertEqual(diagnostics.queuedCount, 0)
  }

  /// Transaction observations are opt-in. An integrator who does not ask for
  /// them gets no sink, no queue, no persistence, and no egress.
  func testTransactionObservationsAreDisabledByDefault() async throws {
    // Port 1 is reserved, so remote delivery fails without a live server.
    let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:1"))
    let mosaic = try await Mosaic.configureHosted(
      publicSDKKey: "public_observation_default_key",
      baseURL: baseURL,
      applicationVersion: nil,
      requestTimeout: 1,
      bundledFallback: .packaged,
      purchaseProvider: MockMosaicPurchaseProvider(),
      persistenceRoot: .unavailable
    )

    XCTAssertNil(mosaic.transactionObservationSink())
    let flushed: MosaicTransactionObservationFlushResult =
      await mosaic.flushTransactionObservations()
    XCTAssertEqual(flushed, .disabled)
    let diagnostics = await mosaic.transactionObservationDiagnostics()
    XCTAssertEqual(diagnostics.mode, .disabled)
    XCTAssertEqual(diagnostics.queuedCount, 0)

    let enabled = try await Mosaic.configureHosted(
      publicSDKKey: "public_observation_enabled_key",
      baseURL: baseURL,
      applicationVersion: nil,
      requestTimeout: 1,
      bundledFallback: .packaged,
      transactionObservations: .enabled,
      purchaseProvider: MockMosaicPurchaseProvider(),
      persistenceRoot: .unavailable
    )
    XCTAssertNotNil(enabled.transactionObservationSink())
    let enabledDiagnostics = await enabled.transactionObservationDiagnostics()
    XCTAssertEqual(enabledDiagnostics.mode, .enabled)
  }
}
