import CryptoKit
import Foundation

/// Errors from reading an Authoritative Entitlement v1 record.
///
/// These are internal on purpose. They never reach the host as an error type:
/// every one of them resolves to `unknown` plus a stable diagnostic code, so a
/// decoding detail can never become unstable public API.
enum MosaicCustomerEntitlementDecodingError: Error, Sendable, Equatable {
  case invalidJSON
  case recordTooLarge
  case unsupportedContractVersion
  case unsupportedRecordType
  case invalidShape(path: String, reason: String)
  case invalidSemantics(code: String)

  var diagnosticCode: String {
    switch self {
    case .invalidJSON: "entitlement_invalid_json"
    case .recordTooLarge: "entitlement_record_too_large"
    case .unsupportedContractVersion: "entitlement_unsupported_contract_version"
    case .unsupportedRecordType: "entitlement_unsupported_record_type"
    case .invalidShape: "entitlement_invalid_shape"
    case .invalidSemantics(let code): "entitlement_\(code)"
    }
  }
}

enum MosaicCustomerEntitlementRecord: Sendable, Equatable {
  case snapshot(MosaicCustomerEntitlementSnapshot)
  case unchanged(MosaicCustomerSnapshotConfirmation)
}

/// A record that decoded cleanly, plus the two things the acceptance gate needs
/// without re-reading the bytes.
///
/// The digest result is reported rather than thrown because digest verification
/// is step three of a normative order: a binding mismatch must be diagnosed
/// first, since it clears the cache and a digest failure does not.
struct MosaicCustomerDecodedRecord: Sendable, Equatable {
  let record: MosaicCustomerEntitlementRecord
  let binding: MosaicCustomerSnapshotBinding
  let contentDigestValid: Bool
}

// MARK: - Canonical serialization

/// The canonical form `contentDigest` is computed over.
///
/// Foundation's `JSONSerialization.sortedKeys` is deliberately **not** used: it
/// sorts with locale- and case-insensitive options, which disagrees with the
/// contract's UTF-16 code-unit ordering on any object mixing cases. Five
/// implementations must produce byte-identical input, so the ordering, escaping,
/// and number form are all spelled out here.
enum MosaicCustomerCanonicalJSON {
  static func digest(_ value: Any) throws -> String {
    let hash = SHA256.hash(data: try data(value))
    return "sha256:" + hash.map { String(format: "%02x", $0) }.joined()
  }

  static func data(_ value: Any) throws -> Data {
    var output = Data()
    try append(value, to: &output)
    return output
  }

  private static func append(_ value: Any, to output: inout Data) throws {
    switch value {
    case let object as [String: Any]:
      output.append(UInt8(ascii: "{"))
      // Ascending by UTF-16 code unit, at every depth.
      let keys = object.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
      for (index, key) in keys.enumerated() {
        if index > 0 { output.append(UInt8(ascii: ",")) }
        appendString(key, to: &output)
        output.append(UInt8(ascii: ":"))
        // An absent optional and a null optional are different bytes and
        // therefore different digests, and null is invalid everywhere in this
        // contract, so it is refused rather than normalized away.
        guard let member = object[key], !(member is NSNull) else {
          throw MosaicCustomerEntitlementDecodingError.invalidShape(
            path: key, reason: "null_forbidden")
        }
        try append(member, to: &output)
      }
      output.append(UInt8(ascii: "}"))
    case let array as [Any]:
      // Array order is normative: a serializer that sorted one would silently
      // repair a document the semantic validator exists to reject.
      output.append(UInt8(ascii: "["))
      for (index, element) in array.enumerated() {
        if index > 0 { output.append(UInt8(ascii: ",")) }
        guard !(element is NSNull) else {
          throw MosaicCustomerEntitlementDecodingError.invalidShape(
            path: "[]", reason: "null_forbidden")
        }
        try append(element, to: &output)
      }
      output.append(UInt8(ascii: "]"))
    case let string as String:
      appendString(string, to: &output)
    case let number as NSNumber:
      if isBoolean(number) {
        output.append(contentsOf: Array((number.boolValue ? "true" : "false").utf8))
      } else {
        // Shortest decimal, no exponent, no decimal point. This contract
        // contains no non-integer numbers.
        let integer = number.int64Value
        guard Double(integer) == number.doubleValue else {
          throw MosaicCustomerEntitlementDecodingError.invalidShape(
            path: "number", reason: "non_integer_number")
        }
        output.append(contentsOf: Array(String(integer).utf8))
      }
    default:
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "value", reason: "unsupported_json_value")
    }
  }

  /// Minimal JSON escaping. Non-ASCII is never escaped into `\u` sequences: it
  /// is emitted as UTF-8, which is what the digest is computed over.
  private static func appendString(_ value: String, to output: inout Data) {
    output.append(UInt8(ascii: "\""))
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": output.append(contentsOf: Array("\\\"".utf8))
      case "\\": output.append(contentsOf: Array("\\\\".utf8))
      case "\u{08}": output.append(contentsOf: Array("\\b".utf8))
      case "\u{0C}": output.append(contentsOf: Array("\\f".utf8))
      case "\n": output.append(contentsOf: Array("\\n".utf8))
      case "\r": output.append(contentsOf: Array("\\r".utf8))
      case "\t": output.append(contentsOf: Array("\\t".utf8))
      default:
        if scalar.value < 0x20 {
          output.append(contentsOf: Array(String(format: "\\u%04x", scalar.value).utf8))
        } else {
          output.append(contentsOf: Array(String(scalar).utf8))
        }
      }
    }
    output.append(UInt8(ascii: "\""))
  }

  private static func isBoolean(_ number: NSNumber) -> Bool {
    CFGetTypeID(number) == CFBooleanGetTypeID()
  }
}

// MARK: - Decoder

/// The closed, pessimistic reader for Authoritative Entitlement v1.
///
/// Every unknown version, record type, field, or enumeration member rejects the
/// whole record. The single exception is `entitlementKey`: keys are Project
/// data, so rejecting an unrecognized one would make *defining a new
/// Entitlement* a breaking change for every already-shipped SDK.
enum MosaicCustomerEntitlementCodec {
  static func decode(_ data: Data) throws -> MosaicCustomerDecodedRecord {
    guard data.count <= MosaicCustomerEntitlementPolicy.maxRecordBytes else {
      throw MosaicCustomerEntitlementDecodingError.recordTooLarge
    }
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw MosaicCustomerEntitlementDecodingError.invalidJSON
    }
    try Value.exactKeys(
      root,
      expected: ["authoritativeEntitlementContractVersion", "recordType", "payload"],
      path: "$")
    // Exact-match reading. A "2" document is as unreadable to a "1" reader as a
    // "9.9" document; numeric ordering never implies support.
    guard root["authoritativeEntitlementContractVersion"] as? String
        == mosaicAuthoritativeEntitlementContractVersion
    else { throw MosaicCustomerEntitlementDecodingError.unsupportedContractVersion }

    switch root["recordType"] as? String {
    case "customerEntitlementSnapshot":
      return try decodeSnapshot(Value.object(root["payload"], path: "payload"))
    case "snapshotUnchanged":
      return try decodeUnchanged(Value.object(root["payload"], path: "payload"))
    default:
      throw MosaicCustomerEntitlementDecodingError.unsupportedRecordType
    }
  }

  // MARK: Snapshot

  private static func decodeSnapshot(_ payload: [String: Any]) throws -> MosaicCustomerDecodedRecord
  {
    try Value.keys(
      payload,
      required: [
        "snapshotId", "billingCustomerId", "projectId", "environmentId", "snapshotVersion",
        "projectionRuleVersion", "issuedAt", "asOf", "refreshAfter", "validUntil", "entityTag",
        "contentDigest", "entries", "sources", "projectionStatus", "changeReason", "correlationId",
      ],
      optional: ["previousSnapshotVersion", "staleGraceSeconds", "diagnostics"],
      path: "payload")

    let issuedAt = try Value.timestamp(payload["issuedAt"], path: "payload.issuedAt")
    let asOf = try Value.timestamp(payload["asOf"], path: "payload.asOf")
    let refreshAfter = try Value.timestamp(payload["refreshAfter"], path: "payload.refreshAfter")
    let validUntil = try Value.timestamp(payload["validUntil"], path: "payload.validUntil")
    let staleGraceSeconds = try Value.optionalInt(
      payload["staleGraceSeconds"], range: 0...MosaicCustomerEntitlementPolicy.maxStaleGraceSeconds,
      path: "payload.staleGraceSeconds") ?? 0

    guard refreshAfter <= validUntil else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "refresh_after_later_than_valid_until")
    }
    // The 30-day maximum is on the *combined* horizon. Bounding each field
    // alone would let a 30-day validity and a 30-day grace window compose into
    // 60 days during which a device serves access Mosaic never confirmed.
    let horizon = validUntil.timeIntervalSince(issuedAt) + TimeInterval(staleGraceSeconds)
    guard horizon <= TimeInterval(MosaicCustomerEntitlementPolicy.maxCacheHorizonSeconds) else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "cache_horizon_exceeds_maximum")
    }

    let entries = try Value.array(payload["entries"], count: 0...200, path: "payload.entries")
      .enumerated().map { try decodeEntry(Value.object($1, path: "payload.entries[\($0)]")) }
    let sources = try Value.array(payload["sources"], count: 0...200, path: "payload.sources")
      .enumerated().map { try decodeSource(Value.object($1, path: "payload.sources[\($0)]")) }

    try validateGraph(entries: entries, sources: sources)

    let snapshot = MosaicCustomerEntitlementSnapshot(
      snapshotID: try Value.identifier(payload["snapshotId"], path: "payload.snapshotId"),
      billingCustomerID: try Value.identifier(
        payload["billingCustomerId"], path: "payload.billingCustomerId"),
      projectID: try Value.identifier(payload["projectId"], path: "payload.projectId"),
      environmentID: try Value.identifier(payload["environmentId"], path: "payload.environmentId"),
      snapshotVersion: try Value.snapshotVersion(
        payload["snapshotVersion"], path: "payload.snapshotVersion"),
      previousSnapshotVersion: try Value.optionalInt64(
        payload["previousSnapshotVersion"], range: 0...999_999_999_999,
        path: "payload.previousSnapshotVersion"),
      projectionRuleVersion: try Value.int(
        payload["projectionRuleVersion"], range: 1...1_000_000,
        path: "payload.projectionRuleVersion"),
      issuedAt: issuedAt,
      asOf: asOf,
      refreshAfter: refreshAfter,
      validUntil: validUntil,
      staleGraceSeconds: staleGraceSeconds,
      entityTag: try Value.entityTag(payload["entityTag"], path: "payload.entityTag"),
      contentDigest: try Value.digest(payload["contentDigest"], path: "payload.contentDigest"),
      entries: entries,
      sources: sources,
      projectionStatus: try decodeProjectionStatus(
        Value.object(payload["projectionStatus"], path: "payload.projectionStatus")),
      changeReason: try Value.member(
        MosaicCustomerChangeReason.self, payload["changeReason"], path: "payload.changeReason"),
      correlationID: try Value.identifier(
        payload["correlationId"], path: "payload.correlationId"),
      diagnostics: try decodeDiagnostics(payload["diagnostics"]))

    var digestInput = payload
    digestInput.removeValue(forKey: "contentDigest")
    let computed = try MosaicCustomerCanonicalJSON.digest(digestInput)

    return MosaicCustomerDecodedRecord(
      record: .snapshot(snapshot),
      binding: MosaicCustomerSnapshotBinding(
        contractVersion: mosaicAuthoritativeEntitlementContractVersion,
        billingCustomerID: snapshot.billingCustomerID,
        projectID: snapshot.projectID,
        environmentID: snapshot.environmentID,
        snapshotVersion: snapshot.snapshotVersion,
        asOf: snapshot.asOf,
        contentDigestValid: computed == snapshot.contentDigest),
      contentDigestValid: computed == snapshot.contentDigest)
  }

  private static func decodeEntry(_ value: [String: Any]) throws
    -> MosaicCustomerEntitlementEntry
  {
    try Value.keys(
      value,
      required: [
        "entitlementId", "entitlementKey", "state", "endKnown", "sourceIds", "sourceCount",
        "primaryExplanation",
      ],
      optional: ["effectiveStart", "effectiveEnd", "refreshRecommendedAt", "uncertainty"],
      path: "entry")

    let state = try Value.member(
      MosaicCustomerPersistedEntitlementState.self, value["state"], path: "entry.state")
    let endKnown = try Value.bool(value["endKnown"], path: "entry.endKnown")
    let effectiveEnd = try Value.optionalTimestamp(
      value["effectiveEnd"], path: "entry.effectiveEnd")
    // `endKnown: false` means the end is genuinely uncertain, so a reader must
    // not display or enforce any expiry. Carrying one anyway is a defect.
    guard endKnown || effectiveEnd == nil else {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "entry.effectiveEnd", reason: "end_known_false_with_effective_end")
    }
    let uncertainty = try decodeOptionalUncertainty(value["uncertainty"], path: "entry.uncertainty")
    if state == .unknown {
      guard let uncertainty, uncertainty.reason != .none else {
        throw MosaicCustomerEntitlementDecodingError.invalidShape(
          path: "entry.uncertainty", reason: "unknown_without_uncertainty")
      }
    }
    let effectiveStart = try Value.optionalTimestamp(
      value["effectiveStart"], path: "entry.effectiveStart")
    if state == .active, effectiveStart == nil {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "entry.effectiveStart", reason: "active_without_effective_start")
    }

    let sourceIDs = try Value.array(value["sourceIds"], count: 0...64, path: "entry.sourceIds")
      .enumerated().map { try Value.identifier($1, path: "entry.sourceIds[\($0)]") }
    guard Set(sourceIDs).count == sourceIDs.count else {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "entry.sourceIds", reason: "duplicate_source_id")
    }
    let sourceCount = try Value.int(value["sourceCount"], range: 0...64, path: "entry.sourceCount")
    guard sourceCount == sourceIDs.count else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "entry_source_count_disagrees")
    }

    return MosaicCustomerEntitlementEntry(
      entitlementID: try Value.identifier(value["entitlementId"], path: "entry.entitlementId"),
      // Project data, not contract vocabulary: an unrecognized key is accepted.
      entitlementKey: try Value.patternString(
        value["entitlementKey"], length: 1...64, pattern: "^[a-z][a-z0-9_.-]*$",
        path: "entry.entitlementKey"),
      state: state,
      effectiveStart: effectiveStart,
      effectiveEnd: effectiveEnd,
      endKnown: endKnown,
      refreshRecommendedAt: try Value.optionalTimestamp(
        value["refreshRecommendedAt"], path: "entry.refreshRecommendedAt"),
      sourceIDs: sourceIDs,
      sourceCount: sourceCount,
      primaryExplanation: try decodeExplanation(
        Value.object(value["primaryExplanation"], path: "entry.primaryExplanation")),
      uncertainty: uncertainty)
  }

  private static func decodeSource(_ value: [String: Any]) throws
    -> MosaicCustomerEntitlementSource
  {
    try Value.keys(
      value,
      required: [
        "sourceId", "sourceType", "mosaicProductId", "grantVersionId", "sourceSnapshotId", "start",
        "sourceState", "uncertainty", "explanationCode", "isTestSource",
      ],
      optional: ["subscriptionInstanceId", "oneTimePurchaseInstanceId", "storePlatform", "end"],
      path: "source")

    let sourceType = try Value.member(
      MosaicCustomerSourceType.self, value["sourceType"], path: "source.sourceType")
    let subscriptionInstanceID = try Value.optionalIdentifier(
      value["subscriptionInstanceId"], path: "source.subscriptionInstanceId")
    let oneTimeInstanceID = try Value.optionalIdentifier(
      value["oneTimePurchaseInstanceId"], path: "source.oneTimePurchaseInstanceId")
    // Exactly one instance reference, chosen by source type. A source naming
    // both, or neither, cannot be reconciled with a purchase lineage.
    if sourceType == .oneTimeNonConsumable {
      guard oneTimeInstanceID != nil, subscriptionInstanceID == nil else {
        throw MosaicCustomerEntitlementDecodingError.invalidShape(
          path: "source", reason: "instance_reference_mismatch")
      }
    } else {
      guard subscriptionInstanceID != nil, oneTimeInstanceID == nil else {
        throw MosaicCustomerEntitlementDecodingError.invalidShape(
          path: "source", reason: "instance_reference_mismatch")
      }
    }

    let sourceState = try Value.member(
      MosaicCustomerSourceState.self, value["sourceState"], path: "source.sourceState")
    let uncertainty = try decodeUncertainty(
      Value.object(value["uncertainty"], path: "source.uncertainty"))
    if sourceState == .unknown, uncertainty.reason == .none {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "source.uncertainty", reason: "unknown_without_uncertainty")
    }

    return MosaicCustomerEntitlementSource(
      sourceID: try Value.identifier(value["sourceId"], path: "source.sourceId"),
      sourceType: sourceType,
      subscriptionInstanceID: subscriptionInstanceID,
      oneTimePurchaseInstanceID: oneTimeInstanceID,
      mosaicProductID: try Value.identifier(
        value["mosaicProductId"], path: "source.mosaicProductId"),
      grantVersionID: try Value.identifier(
        value["grantVersionId"], path: "source.grantVersionId"),
      sourceSnapshotID: try Value.identifier(
        value["sourceSnapshotId"], path: "source.sourceSnapshotId"),
      storePlatform: try Value.optionalMember(
        MosaicCustomerStorePlatform.self, value["storePlatform"], path: "source.storePlatform"),
      start: try Value.timestamp(value["start"], path: "source.start"),
      end: try Value.optionalTimestamp(value["end"], path: "source.end"),
      sourceState: sourceState,
      uncertainty: uncertainty,
      explanationCode: try Value.member(
        MosaicCustomerExplanationCode.self, value["explanationCode"],
        path: "source.explanationCode"),
      isTestSource: try Value.bool(value["isTestSource"], path: "source.isTestSource"))
  }

  /// The entry-to-source graph rules the schema cannot express.
  private static func validateGraph(
    entries: [MosaicCustomerEntitlementEntry], sources: [MosaicCustomerEntitlementSource]
  ) throws {
    let keys = entries.map(\.entitlementKey)
    guard Set(keys).count == keys.count, keys == keys.sorted() else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "entries_not_in_canonical_order")
    }
    let sourceIDs = sources.map(\.sourceID)
    guard Set(sourceIDs).count == sourceIDs.count, sourceIDs == sourceIDs.sorted() else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "sources_not_in_canonical_order")
    }
    let byID = Dictionary(uniqueKeysWithValues: sources.map { ($0.sourceID, $0) })
    var referenced = Set<String>()
    for entry in entries {
      let contributing = try entry.sourceIDs.map { id -> MosaicCustomerEntitlementSource in
        guard let source = byID[id] else {
          throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
            code: "entry_references_absent_source")
        }
        referenced.insert(id)
        return source
      }
      switch entry.state {
      case .active:
        // An active Entitlement always has a reason.
        guard contributing.contains(where: { $0.sourceState == .granting }) else {
          throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
            code: "entry_active_without_granting_source")
        }
      case .inactive:
        // Unresolved evidence yields unknown, never inactive — the top rule,
        // applied inside the projection rather than only at the reader.
        guard !contributing.contains(where: { $0.sourceState != .notGranting }) else {
          throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
            code: "entry_inactive_with_unresolved_source")
        }
      case .unknown:
        break
      }
    }
    guard referenced.count == sources.count else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "snapshot_carries_orphan_source")
    }
  }

  // MARK: Unchanged

  private static func decodeUnchanged(_ payload: [String: Any]) throws
    -> MosaicCustomerDecodedRecord
  {
    try Value.keys(
      payload,
      required: [
        "billingCustomerId", "projectId", "environmentId", "snapshotVersion", "entityTag",
        "issuedAt", "asOf", "refreshAfter", "validUntil", "projectionStatus", "correlationId",
      ],
      optional: ["staleGraceSeconds", "diagnostics"],
      path: "payload")

    let issuedAt = try Value.timestamp(payload["issuedAt"], path: "payload.issuedAt")
    let validUntil = try Value.timestamp(payload["validUntil"], path: "payload.validUntil")
    let refreshAfter = try Value.timestamp(payload["refreshAfter"], path: "payload.refreshAfter")
    let staleGraceSeconds = try Value.optionalInt(
      payload["staleGraceSeconds"], range: 0...MosaicCustomerEntitlementPolicy.maxStaleGraceSeconds,
      path: "payload.staleGraceSeconds") ?? 0
    guard refreshAfter <= validUntil else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "refresh_after_later_than_valid_until")
    }
    // Enforced on the unchanged response too: otherwise the combined-horizon
    // bound could be evaded by confirming a snapshot rather than reissuing it.
    let horizon = validUntil.timeIntervalSince(issuedAt) + TimeInterval(staleGraceSeconds)
    guard horizon <= TimeInterval(MosaicCustomerEntitlementPolicy.maxCacheHorizonSeconds) else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "cache_horizon_exceeds_maximum")
    }

    let confirmation = MosaicCustomerSnapshotConfirmation(
      billingCustomerID: try Value.identifier(
        payload["billingCustomerId"], path: "payload.billingCustomerId"),
      projectID: try Value.identifier(payload["projectId"], path: "payload.projectId"),
      environmentID: try Value.identifier(payload["environmentId"], path: "payload.environmentId"),
      snapshotVersion: try Value.snapshotVersion(
        payload["snapshotVersion"], path: "payload.snapshotVersion"),
      entityTag: try Value.entityTag(payload["entityTag"], path: "payload.entityTag"),
      issuedAt: issuedAt,
      asOf: try Value.timestamp(payload["asOf"], path: "payload.asOf"),
      refreshAfter: refreshAfter,
      validUntil: validUntil,
      staleGraceSeconds: staleGraceSeconds,
      projectionStatus: try decodeProjectionStatus(
        Value.object(payload["projectionStatus"], path: "payload.projectionStatus")),
      correlationID: try Value.identifier(payload["correlationId"], path: "payload.correlationId"),
      diagnostics: try decodeDiagnostics(payload["diagnostics"]))

    return MosaicCustomerDecodedRecord(
      record: .unchanged(confirmation),
      binding: MosaicCustomerSnapshotBinding(
        contractVersion: mosaicAuthoritativeEntitlementContractVersion,
        billingCustomerID: confirmation.billingCustomerID,
        projectID: confirmation.projectID,
        environmentID: confirmation.environmentID,
        snapshotVersion: confirmation.snapshotVersion,
        asOf: confirmation.asOf,
        // An unchanged response carries no entries and therefore no digest;
        // it is a confirmation of bytes already verified when they were
        // accepted.
        contentDigestValid: true),
      contentDigestValid: true)
  }

  // MARK: Shared members

  private static func decodeProjectionStatus(_ value: [String: Any]) throws
    -> MosaicCustomerProjectionStatus
  {
    try Value.keys(
      value, required: ["state", "lastProjectedAt"],
      optional: ["pendingFactCount", "diagnosticCode"], path: "projectionStatus")
    let state = try Value.member(
      MosaicCustomerProjectionState.self, value["state"], path: "projectionStatus.state")
    let pendingFactCount = try Value.optionalInt(
      value["pendingFactCount"], range: 0...1_000_000, path: "projectionStatus.pendingFactCount")
    let diagnosticCode = try Value.optionalDiagnosticCode(
      value["diagnosticCode"], path: "projectionStatus.diagnosticCode")
    if state == .pending, pendingFactCount == nil {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "projectionStatus.pendingFactCount", reason: "required_for_pending")
    }
    if state == .degraded || state == .failed, diagnosticCode == nil {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "projectionStatus.diagnosticCode", reason: "required_for_degraded_or_failed")
    }
    return MosaicCustomerProjectionStatus(
      state: state,
      lastProjectedAt: try Value.timestamp(
        value["lastProjectedAt"], path: "projectionStatus.lastProjectedAt"),
      pendingFactCount: pendingFactCount,
      diagnosticCode: diagnosticCode)
  }

  private static func decodeExplanation(_ value: [String: Any]) throws
    -> MosaicCustomerExplanation
  {
    try Value.keys(
      value, required: ["code"], optional: ["sourceId", "safeSummary"], path: "primaryExplanation")
    return MosaicCustomerExplanation(
      code: try Value.member(
        MosaicCustomerExplanationCode.self, value["code"], path: "primaryExplanation.code"),
      sourceID: try Value.optionalIdentifier(
        value["sourceId"], path: "primaryExplanation.sourceId"),
      safeSummary: try Value.optionalSafeString(
        value["safeSummary"], length: 1...240, path: "primaryExplanation.safeSummary"))
  }

  private static func decodeOptionalUncertainty(_ value: Any?, path: String) throws
    -> MosaicCustomerUncertainty?
  {
    guard let value else { return nil }
    return try decodeUncertainty(Value.object(value, path: path))
  }

  private static func decodeUncertainty(_ value: [String: Any]) throws
    -> MosaicCustomerUncertainty
  {
    try Value.keys(
      value, required: ["reason"], optional: ["since", "expectedResolution", "diagnosticCode"],
      path: "uncertainty")
    let reason = try Value.member(
      MosaicCustomerUncertaintyReason.self, value["reason"], path: "uncertainty.reason")
    let since = try Value.optionalTimestamp(value["since"], path: "uncertainty.since")
    // A definite state carries no `since`; a non-definite state requires one.
    guard (reason == .none) == (since == nil) else {
      throw MosaicCustomerEntitlementDecodingError.invalidShape(
        path: "uncertainty.since", reason: "since_pairing")
    }
    return MosaicCustomerUncertainty(
      reason: reason,
      since: since,
      expectedResolution: try Value.optionalMember(
        MosaicCustomerExpectedResolution.self, value["expectedResolution"],
        path: "uncertainty.expectedResolution"),
      diagnosticCode: try Value.optionalDiagnosticCode(
        value["diagnosticCode"], path: "uncertainty.diagnosticCode"))
  }

  private static func decodeDiagnostics(_ value: Any?) throws -> [MosaicCustomerRecordDiagnostic] {
    guard let value else { return [] }
    return try Value.array(value, count: 0...10, path: "diagnostics").enumerated().map { index, raw in
      let object = try Value.object(raw, path: "diagnostics[\(index)]")
      try Value.keys(
        object, required: ["code", "safeMessage", "severity", "retryable", "correlationId"],
        optional: ["retryAfterSeconds", "recoveryAction"], path: "diagnostics")
      let severity = try Value.string(object["severity"], path: "diagnostics.severity")
      guard ["info", "warning", "error"].contains(severity) else {
        throw MosaicCustomerEntitlementDecodingError.invalidShape(
          path: "diagnostics.severity", reason: "unknown_member")
      }
      var recoveryAction: String?
      if let raw = object["recoveryAction"] {
        let value = try Value.string(raw, path: "diagnostics.recoveryAction")
        guard
          [
            "retry", "refreshCustomerAccessToken", "requestAuthoritativeSync",
            "resolveIdentityConflict", "fixProductMapping", "contactProvider", "none",
          ].contains(value)
        else {
          throw MosaicCustomerEntitlementDecodingError.invalidShape(
            path: "diagnostics.recoveryAction", reason: "unknown_member")
        }
        recoveryAction = value
      }
      return MosaicCustomerRecordDiagnostic(
        code: try Value.diagnosticCode(object["code"], path: "diagnostics.code"),
        safeMessage: try Value.safeString(
          object["safeMessage"], length: 1...240, path: "diagnostics.safeMessage"),
        severity: severity,
        retryable: try Value.bool(object["retryable"], path: "diagnostics.retryable"),
        retryAfterSeconds: try Value.optionalInt(
          object["retryAfterSeconds"], range: 1...86_400, path: "diagnostics.retryAfterSeconds"),
        correlationID: try Value.identifier(
          object["correlationId"], path: "diagnostics.correlationId"),
        recoveryAction: recoveryAction)
    }
  }
}

// MARK: - Primitive readers

/// Closed readers for the contract's shared primitives. Every one of them
/// throws rather than coercing: a value that does not satisfy the contract
/// rejects the whole record.
private enum Value {
  static func object(_ value: Any?, path: String) throws -> [String: Any] {
    guard let object = value as? [String: Any] else { throw shape(path, "expected_object") }
    return object
  }

  static func array(_ value: Any?, count: ClosedRange<Int>, path: String) throws -> [Any] {
    guard let array = value as? [Any], count.contains(array.count) else {
      throw shape(path, "expected_array")
    }
    return array
  }

  static func exactKeys(_ object: [String: Any], expected: Set<String>, path: String) throws {
    guard Set(object.keys) == expected else { throw shape(path, "unexpected_or_missing_property") }
  }

  static func keys(
    _ object: [String: Any], required: Set<String>, optional: Set<String>, path: String
  ) throws {
    let present = Set(object.keys)
    guard required.isSubset(of: present), present.isSubset(of: required.union(optional)) else {
      throw shape(path, "unexpected_or_missing_property")
    }
  }

  static func string(_ value: Any?, path: String) throws -> String {
    guard let value = value as? String else { throw shape(path, "expected_string") }
    return value
  }

  static func bool(_ value: Any?, path: String) throws -> Bool {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
      throw shape(path, "expected_boolean")
    }
    return number.boolValue
  }

  static func safeString(_ value: Any?, length: ClosedRange<Int>, path: String) throws -> String {
    let value = try string(value, path: path)
    guard length.contains(value.count),
      value.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7F })
    else { throw shape(path, "unsafe_or_out_of_bounds_string") }
    return value
  }

  static func optionalSafeString(_ value: Any?, length: ClosedRange<Int>, path: String) throws
    -> String?
  {
    guard let value else { return nil }
    return try safeString(value, length: length, path: path)
  }

  static func patternString(
    _ value: Any?, length: ClosedRange<Int>, pattern: String, path: String
  ) throws -> String {
    let value = try safeString(value, length: length, path: path)
    guard value.range(of: pattern, options: .regularExpression) != nil else {
      throw shape(path, "pattern_mismatch")
    }
    return value
  }

  static func identifier(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 1...128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", path: path)
  }

  static func optionalIdentifier(_ value: Any?, path: String) throws -> String? {
    guard let value else { return nil }
    return try identifier(value, path: path)
  }

  static func entityTag(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 8...128, pattern: "^[A-Za-z0-9._-]+$", path: path)
  }

  static func digest(_ value: Any?, path: String) throws -> String {
    try patternString(value, length: 71...71, pattern: "^sha256:[a-f0-9]{64}$", path: path)
  }

  static func diagnosticCode(_ value: Any?, path: String) throws -> String {
    try patternString(
      value, length: 3...96, pattern: "^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$", path: path)
  }

  static func optionalDiagnosticCode(_ value: Any?, path: String) throws -> String? {
    guard let value else { return nil }
    return try diagnosticCode(value, path: path)
  }

  /// RFC 3339 UTC with exactly three fractional digits and a literal Z. The
  /// precision is fixed because the same instant written with a different
  /// precision would digest differently.
  static func timestamp(_ value: Any?, path: String) throws -> Date {
    let raw = try string(value, path: path)
    guard
      raw.range(
        of:
          "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
        options: .regularExpression) != nil
    else { throw shape(path, "expected_utc_millisecond_timestamp") }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: raw) else {
      throw shape(path, "expected_utc_millisecond_timestamp")
    }
    return date
  }

  static func optionalTimestamp(_ value: Any?, path: String) throws -> Date? {
    guard let value else { return nil }
    return try timestamp(value, path: path)
  }

  static func integer(_ value: Any?, path: String) throws -> Int64 {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      Double(number.int64Value) == number.doubleValue
    else { throw shape(path, "expected_integer") }
    return number.int64Value
  }

  static func int(_ value: Any?, range: ClosedRange<Int>, path: String) throws -> Int {
    let value = try integer(value, path: path)
    guard let narrowed = Int(exactly: value), range.contains(narrowed) else {
      throw shape(path, "integer_out_of_bounds")
    }
    return narrowed
  }

  static func optionalInt(_ value: Any?, range: ClosedRange<Int>, path: String) throws -> Int? {
    guard let value else { return nil }
    return try int(value, range: range, path: path)
  }

  static func optionalInt64(_ value: Any?, range: ClosedRange<Int64>, path: String) throws
    -> Int64?
  {
    guard let value else { return nil }
    let number = try integer(value, path: path)
    guard range.contains(number) else { throw shape(path, "integer_out_of_bounds") }
    return number
  }

  static func snapshotVersion(_ value: Any?, path: String) throws -> Int64 {
    let number = try integer(value, path: path)
    guard (1...999_999_999_999).contains(number) else { throw shape(path, "integer_out_of_bounds") }
    return number
  }

  static func member<T: RawRepresentable>(_: T.Type, _ value: Any?, path: String) throws -> T
  where T.RawValue == String {
    guard let raw = value as? String, let member = T(rawValue: raw) else {
      throw shape(path, "unknown_member")
    }
    return member
  }

  static func optionalMember<T: RawRepresentable>(_ type: T.Type, _ value: Any?, path: String)
    throws -> T?
  where T.RawValue == String {
    guard let value else { return nil }
    return try member(type, value, path: path)
  }

  private static func shape(_ path: String, _ reason: String)
    -> MosaicCustomerEntitlementDecodingError
  {
    .invalidShape(path: path, reason: reason)
  }
}
