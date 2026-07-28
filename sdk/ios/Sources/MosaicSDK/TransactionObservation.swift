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

/// Which store a reference belongs to. A record's store platform must match
/// its reference kind, so it is derived rather than supplied.
public enum MosaicTransactionObservationStorePlatform: String, Sendable, Equatable, Codable {
  case appleAppStore = "apple_app_store"
}

/// Correlation to Analytics Event 1/2 through the existing opaque handles
/// only. No new cross-contract identifier is introduced.
public struct MosaicTransactionObservationCorrelation: Sendable, Equatable {
  public let purchaseAttemptID: String?
  public let providerOperationID: String?
  public let providerUpdateID: String?

  /// Returns `nil` when no handle is present or any handle is not a contract
  /// identifier, because the contract requires at least one valid member.
  public init?(
    purchaseAttemptID: String? = nil,
    providerOperationID: String? = nil,
    providerUpdateID: String? = nil
  ) {
    let handles = [purchaseAttemptID, providerOperationID, providerUpdateID].compactMap { $0 }
    guard !handles.isEmpty,
      handles.allSatisfy(MosaicTransactionObservation.isIdentifier)
    else { return nil }
    self.purchaseAttemptID = purchaseAttemptID
    self.providerOperationID = providerOperationID
    self.providerUpdateID = providerUpdateID
  }

  var wireValue: [String: String] {
    var value: [String: String] = [:]
    if let purchaseAttemptID { value["purchaseAttemptId"] = purchaseAttemptID }
    if let providerOperationID { value["providerOperationId"] = providerOperationID }
    if let providerUpdateID { value["providerUpdateId"] = providerUpdateID }
    return value
  }
}

extension MosaicTransactionObservationCorrelation: Codable {
  enum CodingKeys: String, CodingKey {
    case purchaseAttemptID = "purchaseAttemptId"
    case providerOperationID = "providerOperationId"
    case providerUpdateID = "providerUpdateId"
  }
}

/// One untrusted client report that a provider transaction may exist.
///
/// The value type carries no receipt, no signed payload, no device
/// verification material, no account token, no tenant identity, and no Store
/// Environment. Tenant scope is derived server-side from the authenticated
/// public SDK key, and Store Environment is classified server-side during
/// validation: a client never asserts one.
public struct MosaicTransactionObservation: Sendable, Equatable, Codable {
  /// Identity of this observation record. It is derived from the submission
  /// identifier so a replay after relaunch reproduces the identical record
  /// instead of colliding with itself.
  public let observationID: String
  /// Deterministic idempotency key. It is never derived from a timestamp,
  /// price, Product, or subject, so a retry after relaunch deduplicates.
  public let submissionID: String
  /// The Mosaic commerce provider identity, matching the installed adapter.
  public let providerID: String
  public let referenceKind: MosaicTransactionObservationReferenceKind
  /// The raw provider reference, carried verbatim as a string. It is never
  /// parsed into an integer or a floating-point number: App Store transaction
  /// identifiers exceed both IEEE-754 double precision and `Int64`.
  public let reference: String
  public let observedAt: Date
  public let correlation: MosaicTransactionObservationCorrelation?

  /// Derived from the reference kind, never supplied, so a record can never
  /// claim a platform its reference does not belong to.
  public var storePlatform: MosaicTransactionObservationStorePlatform {
    switch referenceKind {
    case .appStoreTransactionID: .appleAppStore
    }
  }

  /// Returns `nil` when the reference or an identifier would violate the
  /// Billing Ingestion Contract 1 bounds, so a malformed value is dropped on
  /// the device rather than rejected at ingest.
  public init?(
    submissionID: String,
    referenceKind: MosaicTransactionObservationReferenceKind = .appStoreTransactionID,
    reference: String,
    providerID: String = "app_store",
    observationID: String? = nil,
    observedAt: Date = Date(),
    correlation: MosaicTransactionObservationCorrelation? = nil
  ) {
    let identity = observationID ?? "observation_\(submissionID)"
    guard Self.isIdentifier(submissionID), Self.isIdentifier(identity),
      Self.isIdentifier(providerID), Self.isValidReference(reference, kind: referenceKind)
    else { return nil }
    self.observationID = identity
    self.submissionID = submissionID
    self.providerID = providerID
    self.referenceKind = referenceKind
    self.reference = reference
    self.correlation = correlation
    // Normalizing through the wire representation keeps a persisted record
    // equal to the record it was restored from.
    self.observedAt =
      MosaicAnalyticsRuntime.parseTimestamp(MosaicAnalyticsRuntime.timestamp(observedAt))
      ?? observedAt
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

/// SDK context, mirroring the Analytics Event context vocabulary. It carries
/// no Organization, Project, Environment, or Application identity.
struct MosaicTransactionObservationContext: Sendable, Equatable, Codable {
  var platform: String { "ios" }
  var sdkFamily: String { "ios" }
  let sdkVersion: String
  let operatingSystemVersion: String?
  let applicationVersion: String?

  init(sdkVersion: String = mosaicSDKVersion, applicationVersion: String?) {
    self.sdkVersion = Self.bounded(sdkVersion) ?? "0"
    operatingSystemVersion = Self.bounded(
      ProcessInfo.processInfo.operatingSystemVersionString
        .split(separator: " ").first(where: { $0.first?.isNumber == true }).map(String.init))
    self.applicationVersion = Self.bounded(applicationVersion)
  }

  /// The contract bounds these to 64 printable characters with no leading
  /// punctuation. A host-supplied value that does not qualify is omitted
  /// rather than sent and rejected.
  private static func bounded(_ value: String?) -> String? {
    guard let value, value.count <= 64,
      value.range(of: "^[A-Za-z0-9][A-Za-z0-9.+_-]*$", options: .regularExpression) != nil
    else { return nil }
    return value
  }

  var wireValue: [String: String] {
    var value = ["platform": platform, "sdkFamily": sdkFamily, "sdkVersion": sdkVersion]
    if let operatingSystemVersion { value["operatingSystemVersion"] = operatingSystemVersion }
    if let applicationVersion { value["applicationVersion"] = applicationVersion }
    return value
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

/// The decoded observation submission result.
struct MosaicTransactionObservationSubmissionResult: Sendable, Equatable {
  let outcome: MosaicTransactionObservationOutcome
  /// Present only on a retryable failure, per the contract.
  let retryAfterSeconds: Int?
}

/// Encodes a submission and decodes the Billing Ingestion Contract 1
/// `observationSubmissionResult` record.
///
/// The decoder is deliberately closed and pessimistic: any status it does not
/// recognize, any envelope it does not recognize, and any response it cannot
/// read become a retryable failure. There is no input that can produce a
/// validated state.
enum MosaicTransactionObservationCodec {
  static let contractVersion = "1"
  static let observationRecordType = "clientTransactionObservation"
  static let recordType = "observationSubmissionResult"

  /// The complete set of keys a submitted record may carry. Adding a key here
  /// is a contract change, not an implementation detail.
  static let envelopeKeys: Set<String> = [
    "billingIngestionContractVersion", "recordType", "payload",
  ]

  /// A client never asserts a Store Environment, a tenant identity, a price,
  /// or an entitlement: the server classifies and resolves those during
  /// validation. `correlation` is present only when a join handle exists.
  static let wireKeys: Set<String> = [
    "observationId", "submissionId", "providerId", "storePlatform", "transactionReference",
    "observedAt", "sourceAuthority", "context", "correlation",
  ]

  static func encode(
    _ observation: MosaicTransactionObservation,
    context: MosaicTransactionObservationContext
  ) throws -> Data {
    var payload: [String: Any] = [
      "observationId": observation.observationID,
      "submissionId": observation.submissionID,
      "providerId": observation.providerID,
      "storePlatform": observation.storePlatform.rawValue,
      "transactionReference": [
        "referenceKind": observation.referenceKind.rawValue,
        "value": observation.reference,
      ],
      "observedAt": MosaicAnalyticsRuntime.timestamp(observation.observedAt),
      // A client observation can only trigger validation, never author a fact.
      "sourceAuthority": "client_observation",
      "context": context.wireValue,
    ]
    if let correlation = observation.correlation {
      payload["correlation"] = correlation.wireValue
    }
    return try JSONSerialization.data(
      withJSONObject: [
        "billingIngestionContractVersion": contractVersion,
        "recordType": observationRecordType,
        "payload": payload,
      ],
      options: [.sortedKeys])
  }

  static func decodeResult(
    _ data: Data, submissionID: String
  ) -> MosaicTransactionObservationSubmissionResult {
    func retryable(_ code: String) -> MosaicTransactionObservationSubmissionResult {
      .init(outcome: .retryableFailure(code: code), retryAfterSeconds: nil)
    }
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return retryable("unreadable_submission_result") }
    // A record of another contract version or another type carries different
    // semantics and is never reinterpreted under this one's rules.
    guard root["billingIngestionContractVersion"] as? String == contractVersion,
      root["recordType"] as? String == recordType,
      let payload = root["payload"] as? [String: Any],
      let status = payload["status"] as? String
    else { return retryable("unrecognized_submission_result") }
    guard payload["submissionId"] as? String == submissionID else {
      return retryable("submission_id_mismatch")
    }
    let code = safeCode(payload["code"] as? String)
    switch status {
    case "accepted_for_validation":
      return .init(outcome: .acceptedForValidation, retryAfterSeconds: nil)
    case "duplicate":
      return .init(outcome: .duplicate, retryAfterSeconds: nil)
    case "permanently_rejected":
      return .init(
        outcome: .permanentlyRejected(code: code ?? "permanently_rejected"),
        retryAfterSeconds: nil)
    case "retryable_failure":
      let retryAfter = payload["retryAfterSeconds"] as? Int
      return .init(
        outcome: .retryableFailure(code: code ?? "retryable_failure"),
        retryAfterSeconds: retryAfter.map { min(max($0, 1), 86_400) })
    default:
      return retryable("unrecognized_submission_outcome")
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
