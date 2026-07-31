import Foundation

/// Authoritative Entitlement v2. The v1 snapshot remains embedded unchanged.
public let mosaicAuthoritativeEntitlementAuthorityContractVersion = "2"

public enum MosaicCustomerAccessAuthorityKind: String, Sendable, Equatable, Codable {
  case source
  case mosaic
  case sourceRollback = "source_rollback"
}

public enum MosaicCustomerAccessTransitionState: String, Sendable, Equatable, Codable {
  case stable
  case cutoverPending = "cutover_pending"
  case stabilizing
  case rolledBack = "rolled_back"
}

public enum MosaicCustomerAccessPlatform: String, Sendable, Equatable, Codable {
  case ios
  case android
}

public struct MosaicCustomerAccessAuthorityScope: Sendable, Equatable, Codable {
  public let projectID: String
  public let environmentID: String
  public let applicationID: String
  public let platform: MosaicCustomerAccessPlatform

  public init(
    projectID: String,
    environmentID: String,
    applicationID: String,
    platform: MosaicCustomerAccessPlatform
  ) {
    self.projectID = projectID
    self.environmentID = environmentID
    self.applicationID = applicationID
    self.platform = platform
  }
}

public struct MosaicCustomerAccessAuthority: Sendable, Equatable, Codable {
  public let epoch: Int64
  public let kind: MosaicCustomerAccessAuthorityKind
  public let scope: MosaicCustomerAccessAuthorityScope
  public let transitionState: MosaicCustomerAccessTransitionState
  public let cutoverAt: Date?

  public init(
    epoch: Int64,
    kind: MosaicCustomerAccessAuthorityKind,
    scope: MosaicCustomerAccessAuthorityScope,
    transitionState: MosaicCustomerAccessTransitionState,
    cutoverAt: Date? = nil
  ) {
    self.epoch = epoch
    self.kind = kind
    self.scope = scope
    self.transitionState = transitionState
    self.cutoverAt = cutoverAt
  }

  public var isMosaicAuthoritative: Bool { kind == .mosaic }
}

public enum MosaicCustomerAccessCapability: String, Sendable, Equatable, Codable, CaseIterable {
  case authorityEpoch = "authority_epoch"
  case authorityScope = "authority_scope"
  case urgentAuthoritySync = "urgent_authority_sync"
  case mosaicAuthoritativeTargeting = "mosaic_authoritative_targeting"
}

public struct MosaicCustomerSupportedAppVersionWindow: Sendable, Equatable, Codable {
  public let minimumInclusive: String
  public let maximumInclusive: String?

  public init(minimumInclusive: String, maximumInclusive: String? = nil) {
    self.minimumInclusive = minimumInclusive
    self.maximumInclusive = maximumInclusive
  }
}

public struct MosaicCustomerMinimumAccessSupport: Sendable, Equatable, Codable {
  public let minimumContractVersion: String
  public let minimumSDKVersion: String
  public let supportedAppVersionWindow: MosaicCustomerSupportedAppVersionWindow
  public let requiredCapabilities: [MosaicCustomerAccessCapability]

  public init(
    minimumContractVersion: String,
    minimumSDKVersion: String,
    supportedAppVersionWindow: MosaicCustomerSupportedAppVersionWindow,
    requiredCapabilities: [MosaicCustomerAccessCapability]
  ) {
    self.minimumContractVersion = minimumContractVersion
    self.minimumSDKVersion = minimumSDKVersion
    self.supportedAppVersionWindow = supportedAppVersionWindow
    self.requiredCapabilities = requiredCapabilities
  }
}

public enum MosaicCustomerAuthorityUnavailableReason: String, Sendable, Equatable, Codable {
  case authorityUnknown = "authority_unknown"
  case unsupportedContract = "unsupported_contract"
  case unsupportedAppVersion = "unsupported_app_version"
  case scopeMismatch = "scope_mismatch"
  case policyUnavailable = "policy_unavailable"
}

/// Replaying state stream for authority changes. This is metadata for the stable
/// access API, not a second access gate.
public enum MosaicCustomerAccessAuthorityUpdate: Sendable, Equatable {
  case authority(
    MosaicCustomerAccessAuthority,
    minimumSupport: MosaicCustomerMinimumAccessSupport
  )
  case unavailable(
    reason: MosaicCustomerAuthorityUnavailableReason,
    minimumSupport: MosaicCustomerMinimumAccessSupport?
  )
  case signedOut
  case cleared(MosaicCustomerEntitlementClearReason)
}

actor MosaicCustomerAccessAuthorityBroadcaster {
  static let bufferSize = 8

  private var continuations: [UUID: AsyncStream<MosaicCustomerAccessAuthorityUpdate>.Continuation] =
    [:]
  private var current: MosaicCustomerAccessAuthorityUpdate?

  var currentUpdate: MosaicCustomerAccessAuthorityUpdate? { current }
  var subscriberCount: Int { continuations.count }

  func updates() -> AsyncStream<MosaicCustomerAccessAuthorityUpdate> {
    let id = UUID()
    let (stream, continuation) = AsyncStream.makeStream(
      of: MosaicCustomerAccessAuthorityUpdate.self,
      bufferingPolicy: .bufferingNewest(Self.bufferSize))
    continuations[id] = continuation
    if let current { continuation.yield(current) }
    continuation.onTermination = { [weak self] _ in
      Task { await self?.remove(id) }
    }
    return stream
  }

  func emit(_ update: MosaicCustomerAccessAuthorityUpdate) {
    current = update
    for continuation in continuations.values { continuation.yield(update) }
  }

  private func remove(_ id: UUID) { continuations.removeValue(forKey: id) }
}

struct MosaicEntitlementApplicationMetadata: Sendable, Equatable {
  static let capabilities: [MosaicCustomerAccessCapability] = [
    .authorityEpoch,
    .authorityScope,
    .urgentAuthoritySync,
    .mosaicAuthoritativeTargeting,
  ]

  let applicationID: String
  let appVersion: String
  let sdkVersion: String
}

enum MosaicCustomerAuthorityRecord: Sendable, Equatable {
  case snapshot(
    snapshot: MosaicCustomerEntitlementSnapshot,
    authority: MosaicCustomerAccessAuthority,
    snapshotAuthorityDigest: String,
    minimumSupport: MosaicCustomerMinimumAccessSupport,
    v1Binding: MosaicCustomerSnapshotBinding
  )
  case unchanged(
    authority: MosaicCustomerAccessAuthority,
    confirmation: MosaicCustomerSnapshotConfirmation,
    v1Binding: MosaicCustomerSnapshotBinding,
    snapshotAuthorityDigest: String,
    minimumSupport: MosaicCustomerMinimumAccessSupport
  )
  case unavailable(
    scope: MosaicCustomerAccessAuthorityScope,
    reason: MosaicCustomerAuthorityUnavailableReason,
    minimumSupport: MosaicCustomerMinimumAccessSupport?
  )
}

enum MosaicCustomerAuthorityCodec {
  /// Recognizes only the one contract-invalid form that is nevertheless a
  /// server fail-closed instruction: an otherwise exact `policy_unavailable`
  /// payload carrying the specifically forbidden, valid minimum-support
  /// object. Arbitrary malformed responses continue through normal rejection.
  static func policyUnavailableInvalidationScope(_ data: Data)
    -> MosaicCustomerAccessAuthorityScope?
  {
    guard data.count <= MosaicCustomerEntitlementPolicy.maxRecordBytes,
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(root.keys) == [
        "authoritativeEntitlementContractVersion", "recordType", "payload",
      ],
      root["authoritativeEntitlementContractVersion"] as? String
        == mosaicAuthoritativeEntitlementAuthorityContractVersion,
      root["recordType"] as? String == "authorityUnavailable",
      var payload = root["payload"] as? [String: Any],
      Set(payload.keys) == ["scope", "result", "reason", "minimumSupport"],
      payload["result"] as? String == "unavailable",
      payload["reason"] as? String
        == MosaicCustomerAuthorityUnavailableReason.policyUnavailable.rawValue,
      payload["minimumSupport"] is [String: Any]
    else { return nil }

    payload.removeValue(forKey: "minimumSupport")
    guard
      let strictData = try? MosaicCustomerCanonicalJSON.data([
        "authoritativeEntitlementContractVersion":
          mosaicAuthoritativeEntitlementAuthorityContractVersion,
        "recordType": "authorityUnavailable",
        "payload": payload,
      ]),
      case .unavailable(let scope, .policyUnavailable, nil) = try? decode(strictData)
    else { return nil }

    guard var supportProbe = root["payload"] as? [String: Any] else { return nil }
    supportProbe["reason"] = MosaicCustomerAuthorityUnavailableReason.authorityUnknown.rawValue
    guard
      let probeData = try? MosaicCustomerCanonicalJSON.data([
        "authoritativeEntitlementContractVersion":
          mosaicAuthoritativeEntitlementAuthorityContractVersion,
        "recordType": "authorityUnavailable",
        "payload": supportProbe,
      ]),
      case .unavailable(_, .authorityUnknown, .some) = try? decode(probeData)
    else { return nil }
    return scope
  }

  static func decode(_ data: Data) throws -> MosaicCustomerAuthorityRecord {
    guard data.count <= MosaicCustomerEntitlementPolicy.maxRecordBytes else {
      throw MosaicCustomerEntitlementDecodingError.recordTooLarge
    }
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw MosaicCustomerEntitlementDecodingError.invalidJSON
    }
    try exact(root, ["authoritativeEntitlementContractVersion", "recordType", "payload"], "$")
    guard
      root["authoritativeEntitlementContractVersion"] as? String
        == mosaicAuthoritativeEntitlementAuthorityContractVersion
    else { throw MosaicCustomerEntitlementDecodingError.unsupportedContractVersion }
    let payload = try object(root["payload"], "payload")

    switch root["recordType"] as? String {
    case "customerEntitlementSnapshot":
      try exact(
        payload,
        ["authority", "snapshot", "snapshotAuthorityDigest", "minimumSupport"],
        "payload")
      let rawAuthority = try object(payload["authority"], "payload.authority")
      let rawSnapshot = try object(payload["snapshot"], "payload.snapshot")
      let authority = try decodeAuthority(rawAuthority)
      let digest = try digest(payload["snapshotAuthorityDigest"], "payload.snapshotAuthorityDigest")
      let computed = try MosaicCustomerCanonicalJSON.digest([
        "authority": rawAuthority,
        "snapshot": rawSnapshot,
      ])
      guard computed == digest else {
        throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
          code: "authority_digest_mismatch")
      }
      let v1Data = try MosaicCustomerCanonicalJSON.data([
        "authoritativeEntitlementContractVersion": mosaicAuthoritativeEntitlementContractVersion,
        "recordType": "customerEntitlementSnapshot",
        "payload": rawSnapshot,
      ])
      let decoded = try MosaicCustomerEntitlementCodec.decode(v1Data)
      guard case .snapshot(let snapshot) = decoded.record, decoded.contentDigestValid else {
        throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
          code: "embedded_snapshot_rejected")
      }
      return .snapshot(
        snapshot: snapshot,
        authority: authority,
        snapshotAuthorityDigest: digest,
        minimumSupport: try decodeMinimumSupport(
          object(payload["minimumSupport"], "payload.minimumSupport")),
        v1Binding: decoded.binding)

    case "snapshotUnchanged":
      try exact(
        payload,
        ["authority", "unchanged", "snapshotAuthorityDigest", "minimumSupport"],
        "payload")
      let rawUnchanged = try object(payload["unchanged"], "payload.unchanged")
      let v1Data = try MosaicCustomerCanonicalJSON.data([
        "authoritativeEntitlementContractVersion": mosaicAuthoritativeEntitlementContractVersion,
        "recordType": "snapshotUnchanged",
        "payload": rawUnchanged,
      ])
      let decoded = try MosaicCustomerEntitlementCodec.decode(v1Data)
      guard case .unchanged(let confirmation) = decoded.record else {
        throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
          code: "embedded_confirmation_rejected")
      }
      return .unchanged(
        authority: try decodeAuthority(object(payload["authority"], "payload.authority")),
        confirmation: confirmation,
        v1Binding: decoded.binding,
        snapshotAuthorityDigest: try digest(
          payload["snapshotAuthorityDigest"], "payload.snapshotAuthorityDigest"),
        minimumSupport: try decodeMinimumSupport(
          object(payload["minimumSupport"], "payload.minimumSupport")))

    case "authorityUnavailable":
      guard payload["result"] as? String == "unavailable",
        let reasonRaw = payload["reason"] as? String,
        let reason = MosaicCustomerAuthorityUnavailableReason(rawValue: reasonRaw)
      else { throw shape("payload", "unknown_unavailable_reason") }
      let minimumSupport: MosaicCustomerMinimumAccessSupport?
      if reason == .policyUnavailable {
        try exact(payload, ["scope", "result", "reason"], "payload")
        minimumSupport = nil
      } else {
        try exact(payload, ["scope", "result", "reason", "minimumSupport"], "payload")
        minimumSupport = try decodeMinimumSupport(
          object(payload["minimumSupport"], "payload.minimumSupport"))
      }
      return .unavailable(
        scope: try decodeScope(object(payload["scope"], "payload.scope")),
        reason: reason,
        minimumSupport: minimumSupport)

    default:
      throw MosaicCustomerEntitlementDecodingError.unsupportedRecordType
    }
  }

  /// Rebuilds the cacheable full v2 snapshot after a v2 unchanged response
  /// updates authority metadata and freshness. The embedded v1 snapshot remains
  /// byte-for-byte canonical data; the server-issued authority digest is
  /// rechecked before the new wrapper is persisted.
  static func rebindCachedSnapshot(
    cachedSnapshotData: Data,
    unchangedResponseData: Data
  ) throws -> Data {
    guard
      let cachedRoot = try JSONSerialization.jsonObject(with: cachedSnapshotData)
        as? [String: Any],
      let cachedPayload = cachedRoot["payload"] as? [String: Any],
      let rawSnapshot = cachedPayload["snapshot"] as? [String: Any],
      let unchangedRoot = try JSONSerialization.jsonObject(with: unchangedResponseData)
        as? [String: Any],
      let unchangedPayload = unchangedRoot["payload"] as? [String: Any],
      let rawAuthority = unchangedPayload["authority"] as? [String: Any],
      let rawMinimumSupport = unchangedPayload["minimumSupport"] as? [String: Any],
      let authorityDigest = unchangedPayload["snapshotAuthorityDigest"] as? String
    else { throw shape("payload", "cannot_rebind_cached_snapshot") }
    let computed = try MosaicCustomerCanonicalJSON.digest([
      "authority": rawAuthority,
      "snapshot": rawSnapshot,
    ])
    guard computed == authorityDigest else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "authority_digest_mismatch")
    }
    return try MosaicCustomerCanonicalJSON.data([
      "authoritativeEntitlementContractVersion":
        mosaicAuthoritativeEntitlementAuthorityContractVersion,
      "recordType": "customerEntitlementSnapshot",
      "payload": [
        "authority": rawAuthority,
        "snapshot": rawSnapshot,
        "snapshotAuthorityDigest": authorityDigest,
        "minimumSupport": rawMinimumSupport,
      ],
    ])
  }

  private static func decodeAuthority(_ value: [String: Any]) throws
    -> MosaicCustomerAccessAuthority
  {
    let required: Set<String> = ["authorityEpoch", "authorityKind", "scope", "transitionState"]
    try keys(value, required: required, optional: ["cutoverAt"], "payload.authority")
    guard let kindRaw = value["authorityKind"] as? String,
      let kind = MosaicCustomerAccessAuthorityKind(rawValue: kindRaw),
      let transitionRaw = value["transitionState"] as? String,
      let transition = MosaicCustomerAccessTransitionState(rawValue: transitionRaw)
    else { throw shape("payload.authority", "unknown_member") }
    let cutoverAt = try optionalTimestamp(value["cutoverAt"], "payload.authority.cutoverAt")
    if kind == .source {
      guard cutoverAt == nil, transition == .stable || transition == .cutoverPending else {
        throw shape("payload.authority", "invalid_source_transition")
      }
    } else if cutoverAt == nil {
      throw shape("payload.authority.cutoverAt", "required")
    }
    return MosaicCustomerAccessAuthority(
      epoch: try int64(
        value["authorityEpoch"], 0...999_999_999_999, "payload.authority.authorityEpoch"),
      kind: kind,
      scope: try decodeScope(object(value["scope"], "payload.authority.scope")),
      transitionState: transition,
      cutoverAt: cutoverAt)
  }

  private static func decodeScope(_ value: [String: Any]) throws
    -> MosaicCustomerAccessAuthorityScope
  {
    try exact(value, ["projectId", "environmentId", "applicationId", "platform"], "scope")
    guard let platformRaw = value["platform"] as? String,
      let platform = MosaicCustomerAccessPlatform(rawValue: platformRaw)
    else { throw shape("scope.platform", "unknown_member") }
    return MosaicCustomerAccessAuthorityScope(
      projectID: try identifier(value["projectId"], "scope.projectId"),
      environmentID: try identifier(value["environmentId"], "scope.environmentId"),
      applicationID: try identifier(value["applicationId"], "scope.applicationId"),
      platform: platform)
  }

  private static func decodeMinimumSupport(_ value: [String: Any]) throws
    -> MosaicCustomerMinimumAccessSupport
  {
    try exact(
      value,
      [
        "minimumContractVersion", "minimumSdkVersion", "supportedAppVersionWindow",
        "requiredCapabilities",
      ],
      "minimumSupport")
    guard
      value["minimumContractVersion"] as? String
        == mosaicAuthoritativeEntitlementAuthorityContractVersion
    else { throw shape("minimumSupport.minimumContractVersion", "unsupported") }
    let window = try object(
      value["supportedAppVersionWindow"], "minimumSupport.supportedAppVersionWindow")
    try keys(
      window, required: ["minimumInclusive"], optional: ["maximumInclusive"],
      "supportedAppVersionWindow")
    guard let rawCapabilities = value["requiredCapabilities"] as? [String],
      (1...8).contains(rawCapabilities.count), Set(rawCapabilities).count == rawCapabilities.count
    else { throw shape("minimumSupport.requiredCapabilities", "invalid_array") }
    let capabilities = try rawCapabilities.map { raw -> MosaicCustomerAccessCapability in
      guard let capability = MosaicCustomerAccessCapability(rawValue: raw) else {
        throw shape("minimumSupport.requiredCapabilities", "unknown_member")
      }
      return capability
    }
    guard capabilities.contains(.authorityEpoch) else {
      throw shape("minimumSupport.requiredCapabilities", "authority_epoch_required")
    }
    return MosaicCustomerMinimumAccessSupport(
      minimumContractVersion: mosaicAuthoritativeEntitlementAuthorityContractVersion,
      minimumSDKVersion: try version(
        value["minimumSdkVersion"], "minimumSupport.minimumSdkVersion"),
      supportedAppVersionWindow: .init(
        minimumInclusive: try version(
          window["minimumInclusive"], "supportedAppVersionWindow.minimumInclusive"),
        maximumInclusive: try optionalVersion(
          window["maximumInclusive"], "supportedAppVersionWindow.maximumInclusive")),
      requiredCapabilities: capabilities)
  }

  private static func object(_ value: Any?, _ path: String) throws -> [String: Any] {
    guard let value = value as? [String: Any] else { throw shape(path, "expected_object") }
    return value
  }

  private static func exact(_ value: [String: Any], _ expected: Set<String>, _ path: String) throws
  {
    guard Set(value.keys) == expected else { throw shape(path, "unexpected_or_missing_property") }
  }

  private static func keys(
    _ value: [String: Any], required: Set<String>, optional: Set<String>, _ path: String
  ) throws {
    let present = Set(value.keys)
    guard required.isSubset(of: present), present.isSubset(of: required.union(optional)) else {
      throw shape(path, "unexpected_or_missing_property")
    }
  }

  private static func identifier(_ value: Any?, _ path: String) throws -> String {
    guard let value = value as? String, (1...128).contains(value.count),
      value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", options: .regularExpression) != nil
    else { throw shape(path, "invalid_identifier") }
    return value
  }

  private static func version(_ value: Any?, _ path: String) throws -> String {
    guard let value = value as? String, (1...64).contains(value.count),
      value.range(of: "^[0-9A-Za-z][0-9A-Za-z.+_-]*$", options: .regularExpression) != nil
    else { throw shape(path, "invalid_version") }
    return value
  }

  private static func optionalVersion(_ value: Any?, _ path: String) throws -> String? {
    guard let value else { return nil }
    return try version(value, path)
  }

  private static func digest(_ value: Any?, _ path: String) throws -> String {
    guard let value = value as? String,
      value.range(of: "^sha256:[a-f0-9]{64}$", options: .regularExpression) != nil
    else { throw shape(path, "invalid_digest") }
    return value
  }

  private static func int64(_ value: Any?, _ range: ClosedRange<Int64>, _ path: String) throws
    -> Int64
  {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      Double(number.int64Value) == number.doubleValue, range.contains(number.int64Value)
    else { throw shape(path, "invalid_integer") }
    return number.int64Value
  }

  private static func optionalTimestamp(_ value: Any?, _ path: String) throws -> Date? {
    guard let value else { return nil }
    guard let string = value as? String,
      string.range(
        of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
        options: .regularExpression) != nil
    else { throw shape(path, "invalid_timestamp") }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
    guard let date = formatter.date(from: string) else { throw shape(path, "invalid_timestamp") }
    return date
  }

  private static func shape(_ path: String, _ reason: String)
    -> MosaicCustomerEntitlementDecodingError
  {
    .invalidShape(path: path, reason: reason)
  }
}
