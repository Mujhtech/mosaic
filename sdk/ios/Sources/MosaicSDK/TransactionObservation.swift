import Foundation

/// Whether the SDK hands observed provider transactions to Mosaic for
/// server-side validation.
///
/// A Transaction Observation is a trigger, never proof. Enabling this never
/// changes a local purchase result, never grants access, and never re-labels a
/// StoreKit-verified purchase as server-validated.
public enum MosaicTransactionObservationMode: Sendable, Equatable {
  /// The default. No observation is built, queued, persisted, or sent.
  case disabled
  case enabled
}

/// How a submitted `reference` must be read by the server.
///
/// iOS submits only the raw decimal App Store transaction identifier. The
/// remaining Billing Ingestion Contract 1 reference kinds belong to other
/// store platforms and are deliberately absent here.
public enum MosaicTransactionObservationReferenceKind: String, Sendable, Equatable, Codable {
  case appStoreTransactionID = "app_store_transaction_id"
}

/// Store Environment, which is always distinct from the Mosaic Environment.
///
/// StoreKit Testing in Xcode has no App Store record at all, so it is
/// deliberately absent: those transactions are never observed.
public enum MosaicTransactionObservationStoreEnvironment: String, Sendable, Equatable, Codable {
  case sandbox
  case production
}

/// One untrusted client report that a provider transaction may exist.
///
/// The value type carries no receipt, no signed payload, no device
/// verification material, no account token, and no tenant identity. Tenant
/// scope is derived server-side from the authenticated public SDK key.
public struct MosaicTransactionObservation: Sendable, Equatable, Codable {
  /// Deterministic idempotency key. It is never derived from a timestamp,
  /// price, Product, or subject, so a retry after relaunch deduplicates.
  public let submissionID: String
  public let referenceKind: MosaicTransactionObservationReferenceKind
  /// The raw provider reference, carried verbatim as a string. It is never
  /// parsed into an integer or a floating-point number: App Store transaction
  /// identifiers exceed both IEEE-754 double precision and `Int64`.
  public let reference: String
  /// Absent when the platform cannot report it (below iOS 16).
  public let storeEnvironment: MosaicTransactionObservationStoreEnvironment?
  public let observedAt: Date

  /// Returns `nil` when the reference or submission identifier would violate
  /// the Billing Ingestion Contract 1 bounds, so a malformed value is dropped
  /// on the device rather than rejected at ingest.
  public init?(
    submissionID: String,
    referenceKind: MosaicTransactionObservationReferenceKind = .appStoreTransactionID,
    reference: String,
    storeEnvironment: MosaicTransactionObservationStoreEnvironment? = nil,
    observedAt: Date = Date()
  ) {
    guard Self.isIdentifier(submissionID), Self.isValidReference(reference, kind: referenceKind)
    else { return nil }
    self.submissionID = submissionID
    self.referenceKind = referenceKind
    self.reference = reference
    self.storeEnvironment = storeEnvironment
    // Normalizing through the wire representation keeps a persisted record
    // equal to the record it was restored from.
    self.observedAt =
      MosaicAnalyticsRuntime.parseTimestamp(MosaicAnalyticsRuntime.timestamp(observedAt))
      ?? observedAt
  }

  enum CodingKeys: String, CodingKey {
    case submissionID = "submissionId"
    case referenceKind
    case reference
    case storeEnvironment
    case observedAt
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(submissionID, forKey: .submissionID)
    try container.encode(referenceKind, forKey: .referenceKind)
    try container.encode(reference, forKey: .reference)
    try container.encodeIfPresent(storeEnvironment, forKey: .storeEnvironment)
    try container.encode(MosaicAnalyticsRuntime.timestamp(observedAt), forKey: .observedAt)
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let submissionID = try container.decode(String.self, forKey: .submissionID)
    let referenceKind = try container.decode(
      MosaicTransactionObservationReferenceKind.self, forKey: .referenceKind)
    let reference = try container.decode(String.self, forKey: .reference)
    let storeEnvironment = try container.decodeIfPresent(
      MosaicTransactionObservationStoreEnvironment.self, forKey: .storeEnvironment)
    let observedAt = try container.decode(String.self, forKey: .observedAt)
    guard let date = MosaicAnalyticsRuntime.parseTimestamp(observedAt),
      let value = MosaicTransactionObservation(
        submissionID: submissionID, referenceKind: referenceKind, reference: reference,
        storeEnvironment: storeEnvironment, observedAt: date)
    else {
      throw DecodingError.dataCorruptedError(
        forKey: .observedAt, in: container,
        debugDescription: "The stored observation is not contract valid.")
    }
    self = value
  }

  static func isIdentifier(_ value: String) -> Bool {
    value.count <= 128
      && value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", options: .regularExpression) != nil
  }

  static func isValidReference(
    _ value: String, kind: MosaicTransactionObservationReferenceKind
  ) -> Bool {
    switch kind {
    case .appStoreTransactionID:
      value.range(of: "^[0-9]{1,24}$", options: .regularExpression) != nil
    }
  }
}

/// The synchronous answer to submitting one observation.
///
/// There is deliberately no member meaning validated, verified, confirmed, or
/// entitled. Acceptance means the observation is well formed and queued and
/// asserts nothing about the transaction being real.
public enum MosaicTransactionObservationOutcome: Sendable, Equatable {
  case acceptedForValidation
  case duplicate
  case permanentlyRejected(code: String)
  case retryableFailure(code: String)
}

public struct MosaicTransactionObservationDiagnostics: Sendable, Equatable {
  public let mode: MosaicTransactionObservationMode
  public let queuedCount: Int
  public let acceptedForValidationCount: UInt64
  public let duplicateCount: UInt64
  public let permanentlyRejectedCount: UInt64
  public let retryCount: UInt64
  public let droppedCount: UInt64
  public let lastSafeCode: String?
  public let isFlushInFlight: Bool

  static let disabled = MosaicTransactionObservationDiagnostics(
    mode: .disabled, queuedCount: 0, acceptedForValidationCount: 0, duplicateCount: 0,
    permanentlyRejectedCount: 0, retryCount: 0, droppedCount: 0,
    lastSafeCode: nil, isFlushInFlight: false)
}

public enum MosaicTransactionObservationFlushResult: Sendable, Equatable {
  case delivered(removed: Int, retained: Int)
  case empty
  case deferred
  case disabled
}

/// Receives observations from a commerce provider.
///
/// `enqueue` is synchronous on purpose. A purchase must never suspend on
/// observation handoff, and a `nonisolated func … async` requirement would
/// still allow a provider actor to suspend on a file write.
public protocol MosaicTransactionObservationSink: Sendable {
  func enqueue(_ observation: MosaicTransactionObservation)
}

/// Decodes the observation submission response.
///
/// The decoder is deliberately closed and pessimistic: any status it does not
/// recognize, and any response it cannot read, becomes a retryable failure.
/// There is no input that can produce a validated state.
enum MosaicTransactionObservationCodec {
  /// The complete set of keys an SDK submission may carry. Adding a key here
  /// is a contract change, not an implementation detail.
  static let wireKeys: Set<String> = [
    "submissionId", "referenceKind", "reference", "storeEnvironment", "observedAt",
  ]

  static func encode(_ observation: MosaicTransactionObservation) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(observation)
  }

  static func decodeOutcome(
    _ data: Data, submissionID: String
  ) -> MosaicTransactionObservationOutcome {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let payload = root["data"] as? [String: Any],
      let status = payload["outcome"] as? String
    else { return .retryableFailure(code: "unreadable_submission_result") }
    if let echoed = payload["submissionId"] as? String, echoed != submissionID {
      return .retryableFailure(code: "submission_id_mismatch")
    }
    let code = payload["code"] as? String
    switch status {
    case "accepted_for_validation": return .acceptedForValidation
    case "duplicate": return .duplicate
    case "permanently_rejected":
      return .permanentlyRejected(code: safeCode(code) ?? "permanently_rejected")
    case "retryable_failure":
      return .retryableFailure(code: safeCode(code) ?? "retryable_failure")
    default:
      return .retryableFailure(code: "unrecognized_submission_outcome")
    }
  }

  /// Server codes are echoed into diagnostics, so they are bounded and
  /// stripped of control characters before they are stored.
  private static func safeCode(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    let sanitized = value.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F }
    guard !sanitized.isEmpty else { return nil }
    return String(String.UnicodeScalarView(sanitized.prefix(96)))
  }
}
