import Foundation
import XCTest

@testable import MosaicSDK

/// A transport whose response is scripted per call, so the queue's terminal
/// status handling can be driven without a server.
private actor ObservationTestTransport: MosaicTransactionObservationTransport {
  private var responses: [MosaicTransactionObservationHTTPResponse]
  private(set) var bodies: [Data] = []

  init(_ responses: [MosaicTransactionObservationHTTPResponse]) {
    self.responses = responses
  }

  func send(data: Data) async throws -> MosaicTransactionObservationHTTPResponse {
    bodies.append(data)
    guard !responses.isEmpty else { throw URLError(.notConnectedToInternet) }
    return responses.removeFirst()
  }

  func recordedBodies() -> [Data] { bodies }
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

  /// The submitted record must be the canonical client observation envelope
  /// and must carry exactly the agreed keys, nothing more.
  ///
  /// A key allowlist checked against the canonical fixture is the only
  /// assertion that fails by default when a future change adds a field, which
  /// is what would smuggle a JWS representation, device-verification material,
  /// or an account token onto the wire.
  func testSubmittedRecordMatchesTheCanonicalObservationEnvelope() throws {
    let correlated = try XCTUnwrap(
      MosaicTransactionObservation(
        submissionID: "storekit_transaction_2000000900000001",
        reference: "2000000900000001", observedAt: observedAt,
        correlation: MosaicTransactionObservationCorrelation(
          providerOperationID: "storekit_purchase_0001")))
    let encoded = try MosaicTransactionObservationCodec.encode(correlated, context: context)
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

    let fixture = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: try phase5FixtureData("billing-ingestion/v1/apple-client-observation.json"))
        as? [String: Any])
    let fixturePayload = try XCTUnwrap(fixture["payload"] as? [String: Any])

    // Envelope.
    XCTAssertEqual(Set(root.keys), Set(fixture.keys))
    XCTAssertEqual(Set(root.keys), MosaicTransactionObservationCodec.envelopeKeys)
    XCTAssertEqual(root["billingIngestionContractVersion"] as? String, "1")
    XCTAssertEqual(root["recordType"] as? String, "clientTransactionObservation")

    // Payload: exactly the canonical fixture's keys, and within the allowlist.
    let body = try XCTUnwrap(root["payload"] as? [String: Any])
    XCTAssertEqual(Set(body.keys), Set(fixturePayload.keys))
    XCTAssertTrue(Set(body.keys).isSubset(of: MosaicTransactionObservationCodec.wireKeys))
    XCTAssertEqual(
      body["observationId"] as? String, "observation_storekit_transaction_2000000900000001")
    XCTAssertEqual(body["submissionId"] as? String, "storekit_transaction_2000000900000001")
    XCTAssertEqual(body["providerId"] as? String, "app_store")
    XCTAssertEqual(body["storePlatform"] as? String, "apple_app_store")
    XCTAssertEqual(body["sourceAuthority"] as? String, "client_observation")
    XCTAssertEqual(body["observedAt"] as? String, "2026-07-31T12:13:20.000Z")

    let reference = try XCTUnwrap(body["transactionReference"] as? [String: Any])
    let fixtureReference = try XCTUnwrap(fixturePayload["transactionReference"] as? [String: Any])
    XCTAssertEqual(Set(reference.keys), Set(fixtureReference.keys))
    XCTAssertEqual(reference["referenceKind"] as? String, "app_store_transaction_id")
    XCTAssertEqual(reference["value"] as? String, "2000000900000001")

    let sdkContext = try XCTUnwrap(body["context"] as? [String: Any])
    let fixtureContext = try XCTUnwrap(fixturePayload["context"] as? [String: Any])
    XCTAssertTrue(Set(sdkContext.keys).isSubset(of: Set(fixtureContext.keys)))
    XCTAssertEqual(sdkContext["platform"] as? String, "ios")
    XCTAssertEqual(sdkContext["sdkFamily"] as? String, "ios")
    XCTAssertEqual(sdkContext["sdkVersion"] as? String, mosaicSDKVersion)
    XCTAssertEqual(sdkContext["applicationVersion"] as? String, "1.4.2")

    let correlation = try XCTUnwrap(body["correlation"] as? [String: Any])
    XCTAssertTrue(
      Set(correlation.keys).isSubset(
        of: ["purchaseAttemptId", "providerOperationId", "providerUpdateId"]))
    XCTAssertFalse(correlation.isEmpty)

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
