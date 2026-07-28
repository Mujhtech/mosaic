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
  fileprivate static func result(
    _ outcome: String, submissionID: String, code: String? = nil, status: Int = 202
  ) -> MosaicTransactionObservationHTTPResponse {
    var payload: [String: Any] = ["submissionId": submissionID, "outcome": outcome]
    if let code { payload["code"] = code }
    return .init(
      statusCode: status,
      data: (try? JSONSerialization.data(withJSONObject: ["data": payload])) ?? Data(),
      retryAfterSeconds: nil)
  }
}

final class TransactionObservationTests: XCTestCase {
  private let observedAt = Date(timeIntervalSince1970: 1_785_500_000)

  private func observation(
    submissionID: String = "storekit_transaction_2000000900000001",
    reference: String = "2000000900000001",
    environment: MosaicTransactionObservationStoreEnvironment? = .production
  ) throws -> MosaicTransactionObservation {
    try XCTUnwrap(
      MosaicTransactionObservation(
        submissionID: submissionID, referenceKind: .appStoreTransactionID,
        reference: reference, storeEnvironment: environment, observedAt: observedAt))
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
      clock: { now }, jitter: { $0.upperBound })
  }

  /// The submission body must carry exactly the agreed keys and nothing else.
  ///
  /// A key allowlist is the only assertion that fails by default when a future
  /// change adds a field, which is what would smuggle a JWS representation,
  /// device-verification material, or an account token onto the wire.
  func testSubmissionBodyCarriesExactlyTheAllowlistedKeys() throws {
    let encoded = try MosaicTransactionObservationCodec.encode(observation())
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: encoded) as? [String: Any])

    XCTAssertEqual(
      Set(object.keys),
      ["submissionId", "referenceKind", "reference", "storeEnvironment", "observedAt"])
    XCTAssertEqual(Set(object.keys), MosaicTransactionObservationCodec.wireKeys)
    XCTAssertEqual(object["referenceKind"] as? String, "app_store_transaction_id")
    XCTAssertEqual(object["reference"] as? String, "2000000900000001")
    XCTAssertEqual(object["storeEnvironment"] as? String, "production")
    XCTAssertEqual(object["observedAt"] as? String, "2026-07-31T12:13:20.000Z")

    // The environment is omitted rather than guessed where StoreKit cannot
    // report it, and a client never asserts a Store Environment it invented.
    let withoutEnvironment = try MosaicTransactionObservationCodec.encode(
      observation(environment: nil))
    let reduced = try XCTUnwrap(
      JSONSerialization.jsonObject(with: withoutEnvironment) as? [String: Any])
    XCTAssertEqual(
      Set(reduced.keys), ["submissionId", "referenceKind", "reference", "observedAt"])

    let body = try XCTUnwrap(String(data: encoded, encoding: .utf8))
    for forbidden in [
      "jws", "signedTransaction", "deviceVerification", "appAccountToken", "appTransactionID",
      "originalID", "purchaseToken", "receipt",
    ] {
      XCTAssertFalse(body.localizedCaseInsensitiveContains(forbidden), forbidden)
    }
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
      let object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: MosaicTransactionObservationCodec.encode(candidate))
          as? [String: Any])
      XCTAssertEqual(object["reference"] as? String, value)
      XCTAssertLessThanOrEqual(
        try XCTUnwrap(object["submissionId"] as? String).count, 128)
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
      return try XCTUnwrap(object["reference"] as? String)
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
      .init(statusCode: 500, data: Data(), retryAfterSeconds: nil),
      .init(statusCode: 202, data: Data("{}".utf8), retryAfterSeconds: nil),
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
