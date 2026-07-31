import CryptoKit
import Foundation

public let mosaicExperimentAssignmentVersion = "1"
public let mosaicSupportedExperimentAssignmentVersions = [mosaicExperimentAssignmentVersion]
public let mosaicExperimentAssignmentAlgorithm = "experiment_sha256_length_prefixed_v1"
public let mosaicExperimentGroupAlgorithm = "experiment_group_sha256_length_prefixed_v1"
public let mosaicExperimentSchedulePolicy = "trusted_server_time_v1"

public let mosaicSupportedExperimentFeatures = [
  "allocation.ranges",
  "assignment.identified_user",
  "assignment.identified_user_or_installation",
  "assignment.installation",
  "fallback.normal_placement",
  "group.mutual_exclusion",
  "override.qa",
  "schedule.trusted_server_time",
]

public struct MosaicExperimentCapabilityReport: Sendable, Equatable {
  public let assignmentContractVersions: [String]
  public let features: [String]
  public let bucketingAlgorithms: [String]
  public let schedulePolicies: [String]

  public static let current = MosaicExperimentCapabilityReport(
    assignmentContractVersions: mosaicSupportedExperimentAssignmentVersions,
    features: mosaicSupportedExperimentFeatures,
    bucketingAlgorithms: [mosaicExperimentAssignmentAlgorithm, mosaicExperimentGroupAlgorithm],
    schedulePolicies: [mosaicExperimentSchedulePolicy])
}

public enum MosaicExperimentAssignmentKeyPolicy: String, Codable, Sendable, Equatable {
  case installation
  case identifiedUser = "identified_user"
  case identifiedUserOrInstallation = "identified_user_or_installation"
}

public enum MosaicExperimentAssignmentKeyType: String, Codable, Sendable, Equatable {
  case installation
  case identifiedUser = "identified_user"
}

public enum MosaicExperimentLifecycle: String, Codable, Sendable, Equatable {
  case scheduled, running, paused, stopped, completed
}

public enum MosaicExperimentVariantRole: String, Codable, Sendable, Equatable {
  case control, treatment
}

public enum MosaicExperimentProviderCapability: String, Codable, Sendable, Equatable, CaseIterable {
  case productLoad = "product_load"
  case purchase
  case restore
  case entitlementLookup = "entitlement_lookup"
  case nativeRecovery = "native_recovery"
}

public struct MosaicExperimentVariantCompatibility: Codable, Sendable, Equatable {
  public let requiredProductIds: [String]
  public let requiredProviderCapabilities: [MosaicExperimentProviderCapability]
}

public struct MosaicExperimentVariant: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let role: MosaicExperimentVariantRole
  public let paywallId: String
  public let paywallVersionId: String
  public let rangeStart: Int
  public let rangeEnd: Int
  public let compatibility: MosaicExperimentVariantCompatibility
}

public struct MosaicExperimentSchedule: Codable, Sendable, Equatable {
  public let startsAt: String
  public let endsAt: String?
  public let timePolicy: String
  public let unreliableTimeBehavior: String
}

public struct MosaicExperimentGroupMember: Codable, Sendable, Equatable {
  public let experimentId: String
  public let rangeStart: Int
  public let rangeEnd: Int
}

public struct MosaicExperimentBucketRange: Codable, Sendable, Equatable {
  public let rangeStart: Int
  public let rangeEnd: Int
}

public struct MosaicExperimentMutualExclusionGroup: Codable, Sendable, Equatable {
  public let id: String
  public let versionId: String
  public let members: [MosaicExperimentGroupMember]
  public let normalPlacementRange: MosaicExperimentBucketRange?
  public let bucketingAlgorithm: String
}

public struct MosaicExperimentQAOverride: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let variantId: String
  public let assignmentKeyType: MosaicExperimentAssignmentKeyType
  public let selectorDigest: String
  public let safeLabel: String
  public let startsAt: String
  public let expiresAt: String
  public let visibility: String
}

public struct MosaicExperimentCompatibility: Codable, Sendable, Equatable {
  public let requiredFeatures: [String]
  public let bucketingAlgorithms: [String]
  public let schedulePolicies: [String]
}

public struct MosaicExperimentAssignment: Codable, Sendable, Equatable, Identifiable {
  public var id: String { experimentVersionId }
  public let projectId: String
  public let environmentId: String
  public let experimentId: String
  public let experimentVersionId: String
  public let placementId: String
  public let controlPaywallVersionId: String
  public let allocationVersion: String
  public let variants: [MosaicExperimentVariant]
  public let assignmentKeyPolicy: MosaicExperimentAssignmentKeyPolicy
  public let bucketingAlgorithm: String
  public let lifecycle: MosaicExperimentLifecycle
  public let schedule: MosaicExperimentSchedule
  public let mutualExclusionGroup: MosaicExperimentMutualExclusionGroup?
  public let qaOverrides: [MosaicExperimentQAOverride]
  public let fallback: String
  public let compatibility: MosaicExperimentCompatibility
}

public enum MosaicExperimentAssignmentError: Error, Sendable, Equatable {
  case invalidShape(path: String)
  case invalidSemantics(code: String)
  case unsupported(String)

  public var diagnosticCode: String {
    switch self {
    case .invalidShape: "experiment.invalid_shape"
    case .invalidSemantics(let code): code
    case .unsupported: "experiment.unsupported_contract"
    }
  }
}

public enum MosaicExperimentAssignmentDecoder {
  public static func decode(_ data: Data, environmentMode: MosaicEnvironmentMode? = nil) throws
    -> MosaicExperimentAssignment
  {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw MosaicExperimentAssignmentError.invalidShape(path: "$")
    }
    try exact(root, ["experimentAssignmentVersion", "assignment"], "$")
    guard root["experimentAssignmentVersion"] as? String == "1",
      let raw = root["assignment"] as? [String: Any]
    else { throw MosaicExperimentAssignmentError.unsupported("contract") }
    return try decodeAssignment(raw, environmentMode: environmentMode)
  }

  static func decodeAssignment(
    _ raw: [String: Any], environmentMode: MosaicEnvironmentMode?
  ) throws -> MosaicExperimentAssignment {
    try exact(
      raw,
      [
        "projectId", "environmentId", "experimentId", "experimentVersionId", "placementId",
        "controlPaywallVersionId", "allocationVersion", "variants", "assignmentKeyPolicy",
        "bucketingAlgorithm", "lifecycle", "schedule", "mutualExclusionGroup", "qaOverrides",
        "fallback", "compatibility",
      ], "$.assignment", optional: ["mutualExclusionGroup"])
    try validateNestedShape(raw)
    let data = try DeliveryCanonicalJSON.data(raw)
    let assignment = try JSONDecoder().decode(MosaicExperimentAssignment.self, from: data)
    try validate(assignment, environmentMode: environmentMode)
    return assignment
  }

  static func validate(
    _ value: MosaicExperimentAssignment, environmentMode: MosaicEnvironmentMode?
  ) throws {
    let identifiers = [
      value.projectId, value.environmentId, value.experimentId, value.experimentVersionId,
      value.placementId, value.controlPaywallVersionId, value.allocationVersion,
    ]
    guard identifiers.allSatisfy(validIdentifier),
      value.bucketingAlgorithm == mosaicExperimentAssignmentAlgorithm,
      value.fallback == "normal_placement", (2...4).contains(value.variants.count)
    else { throw semantic("experiment.invalid_assignment") }
    guard value.variants.filter({ $0.role == .control }).count == 1,
      value.variants.filter({ $0.role == .treatment }).count == value.variants.count - 1,
      Set(value.variants.map(\.id)).count == value.variants.count,
      value.variants.first(where: { $0.role == .control })?.paywallVersionId
        == value.controlPaywallVersionId
    else { throw semantic("experiment.invalid_variants") }
    try validateRanges(value.variants.map { ($0.rangeStart, $0.rangeEnd) })
    for variant in value.variants {
      guard validIdentifier(variant.id), validIdentifier(variant.paywallId),
        validIdentifier(variant.paywallVersionId), (1...160).contains(variant.name.utf8.count),
        Set(variant.compatibility.requiredProductIds).count
          == variant.compatibility.requiredProductIds.count,
        variant.compatibility.requiredProductIds.allSatisfy(validIdentifier),
        Set(variant.compatibility.requiredProviderCapabilities).count
          == variant.compatibility.requiredProviderCapabilities.count
      else { throw semantic("experiment.invalid_variant") }
    }
    guard let start = timestamp(value.schedule.startsAt),
      value.schedule.timePolicy == mosaicExperimentSchedulePolicy,
      value.schedule.unreliableTimeBehavior == "normal_placement",
      value.schedule.endsAt.flatMap(timestamp).map({ $0 > start })
        ?? (value.schedule.endsAt == nil)
    else { throw semantic("experiment.invalid_schedule") }
    if let group = value.mutualExclusionGroup {
      guard validIdentifier(group.id), validIdentifier(group.versionId),
        group.bucketingAlgorithm == mosaicExperimentGroupAlgorithm,
        group.members.contains(where: { $0.experimentId == value.experimentId }),
        Set(group.members.map(\.experimentId)).count == group.members.count
      else { throw semantic("experiment.invalid_group") }
      var ranges = group.members.map { ($0.rangeStart, $0.rangeEnd) }
      if let holdout = group.normalPlacementRange {
        ranges.append((holdout.rangeStart, holdout.rangeEnd))
      }
      try validateRanges(ranges)
    }
    for override in value.qaOverrides {
      guard environmentMode != .production, validIdentifier(override.id),
        value.variants.contains(where: { $0.id == override.variantId }),
        override.selectorDigest.range(of: "^sha256:[a-f0-9]{64}$", options: .regularExpression)
          != nil,
        override.visibility == "diagnostic", let startsAt = timestamp(override.startsAt),
        let expiresAt = timestamp(override.expiresAt), expiresAt > startsAt,
        expiresAt.timeIntervalSince(startsAt) <= 24 * 60 * 60
      else { throw semantic("experiment.invalid_qa_override") }
    }
    let expectedFeatures = Set(
      [
        "allocation.ranges", "assignment.\(value.assignmentKeyPolicy.rawValue)",
        "fallback.normal_placement", "schedule.trusted_server_time",
      ] + (value.mutualExclusionGroup == nil ? [] : ["group.mutual_exclusion"])
        + (value.qaOverrides.isEmpty ? [] : ["override.qa"]))
    let expectedAlgorithms = Set(
      [mosaicExperimentAssignmentAlgorithm]
        + (value.mutualExclusionGroup == nil ? [] : [mosaicExperimentGroupAlgorithm]))
    guard Set(value.compatibility.requiredFeatures) == expectedFeatures,
      Set(value.compatibility.bucketingAlgorithms) == expectedAlgorithms,
      value.compatibility.schedulePolicies == [mosaicExperimentSchedulePolicy]
    else { throw semantic("experiment.compatibility_mismatch") }
  }

  private static func validateNestedShape(_ raw: [String: Any]) throws {
    guard let variants = raw["variants"] as? [[String: Any]],
      let schedule = raw["schedule"] as? [String: Any],
      let overrides = raw["qaOverrides"] as? [[String: Any]],
      let compatibility = raw["compatibility"] as? [String: Any]
    else { throw MosaicExperimentAssignmentError.invalidShape(path: "$.assignment") }
    for (index, variant) in variants.enumerated() {
      try exact(
        variant,
        [
          "id", "name", "role", "paywallId", "paywallVersionId", "rangeStart", "rangeEnd",
          "compatibility",
        ],
        "$.assignment.variants[\(index)]")
      guard let nested = variant["compatibility"] as? [String: Any] else {
        throw MosaicExperimentAssignmentError.invalidShape(
          path: "$.assignment.variants[\(index)].compatibility")
      }
      try exact(
        nested, ["requiredProductIds", "requiredProviderCapabilities"], "variant.compatibility")
    }
    try exact(
      schedule, ["startsAt", "endsAt", "timePolicy", "unreliableTimeBehavior"], "schedule",
      optional: ["endsAt"])
    for item in overrides {
      try exact(
        item,
        [
          "id", "variantId", "assignmentKeyType", "selectorDigest", "safeLabel", "startsAt",
          "expiresAt", "visibility",
        ], "qaOverride")
    }
    try exact(
      compatibility, ["requiredFeatures", "bucketingAlgorithms", "schedulePolicies"],
      "compatibility")
    if let group = raw["mutualExclusionGroup"] as? [String: Any] {
      try exact(
        group, ["id", "versionId", "members", "normalPlacementRange", "bucketingAlgorithm"],
        "group", optional: ["normalPlacementRange"])
      guard let members = group["members"] as? [[String: Any]] else {
        throw MosaicExperimentAssignmentError.invalidShape(path: "group.members")
      }
      for member in members {
        try exact(member, ["experimentId", "rangeStart", "rangeEnd"], "group.member")
      }
      if let holdout = group["normalPlacementRange"] as? [String: Any] {
        try exact(holdout, ["rangeStart", "rangeEnd"], "group.normalPlacementRange")
      }
    }
  }

  private static func exact(
    _ raw: [String: Any], _ keys: Set<String>, _ path: String, optional: Set<String> = []
  ) throws {
    guard Set(raw.keys) == keys.subtracting(optional).union(Set(raw.keys).intersection(optional))
    else { throw MosaicExperimentAssignmentError.invalidShape(path: path) }
  }

  private static func validateRanges(_ ranges: [(Int, Int)]) throws {
    let sorted = ranges.sorted { $0.0 < $1.0 }
    guard sorted.first?.0 == 0, sorted.last?.1 == 10_000 else {
      throw semantic("experiment.invalid_allocation")
    }
    for (index, range) in sorted.enumerated() {
      guard range.0 >= 0, range.0 < range.1, range.1 <= 10_000,
        index == 0 || sorted[index - 1].1 == range.0
      else { throw semantic("experiment.invalid_allocation") }
    }
  }

  static func timestamp(_ value: String) -> Date? {
    guard
      value.range(
        of:
          "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
        options: .regularExpression) != nil
    else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
  }

  private static func validIdentifier(_ value: String) -> Bool {
    (1...128).contains(value.utf8.count)
      && value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", options: .regularExpression) != nil
  }

  private static func semantic(_ code: String) -> MosaicExperimentAssignmentError {
    .invalidSemantics(code: code)
  }
}

public enum MosaicExperimentAssignmentSource: String, Codable, Sendable, Equatable {
  case deterministic
  case qaOverride = "qa_override"
}

public struct MosaicExperimentSelection: Sendable, Equatable {
  public let assignment: MosaicExperimentAssignment
  public let variant: MosaicExperimentVariant
  public let keyType: MosaicExperimentAssignmentKeyType
  public let bucket: Int
  public let groupBucket: Int?
  public let source: MosaicExperimentAssignmentSource
  public let subjectDigest: String
  public var excludedFromResults: Bool { source == .qaOverride }
}

public enum MosaicExperimentEligibilityReason: String, Sendable, Equatable {
  case missingIdentity = "missing_identity"
  case inactive
  case beforeStart = "before_start"
  case expired
  case timeUnreliable = "time_unreliable"
  case groupExcluded = "group_excluded"
  case qaSelectorMissing = "qa_selector_missing"
}

public enum MosaicExperimentEvaluationResult: Sendable, Equatable {
  case selected(MosaicExperimentSelection)
  case normalPlacement(MosaicExperimentEligibilityReason)
}

public struct MosaicExperimentDiagnostics: Sendable, Equatable {
  public let acceptedReleaseID: String?
  public let activeAssignmentCount: Int
  public let trustedTimeReliable: Bool
  public let persistedAssignmentCount: Int
  public let exposedAssignmentCount: Int
  public let lastSafeCode: String?

  public init(
    acceptedReleaseID: String? = nil, activeAssignmentCount: Int = 0,
    trustedTimeReliable: Bool = false, persistedAssignmentCount: Int,
    exposedAssignmentCount: Int, lastSafeCode: String? = nil
  ) {
    self.acceptedReleaseID = acceptedReleaseID
    self.activeAssignmentCount = activeAssignmentCount
    self.trustedTimeReliable = trustedTimeReliable
    self.persistedAssignmentCount = persistedAssignmentCount
    self.exposedAssignmentCount = exposedAssignmentCount
    self.lastSafeCode = lastSafeCode
  }
}

public enum MosaicExperimentAssignmentEngine {
  public static func evaluate(
    _ assignment: MosaicExperimentAssignment,
    identity: MosaicIdentitySnapshot,
    trustedTime: Date?,
    qaSelectorDigests: Set<String> = []
  ) -> MosaicExperimentEvaluationResult {
    guard let key = assignmentKey(assignment.assignmentKeyPolicy, identity: identity) else {
      return .normalPlacement(.missingIdentity)
    }
    let subjectDigest = digest("\(key.type.rawValue)\n\(key.value)")
    let assignmentBucket = bucket(
      domain: "mosaic-experiment-assignment",
      values: [
        assignment.projectId, assignment.environmentId, assignment.experimentId,
        assignment.experimentVersionId, key.type.rawValue, key.value,
      ])
    if let now = trustedTime,
      let override = assignment.qaOverrides.first(where: {
        $0.assignmentKeyType == key.type && qaSelectorDigests.contains($0.selectorDigest)
          && MosaicExperimentAssignmentDecoder.timestamp($0.startsAt).map { now >= $0 } == true
          && MosaicExperimentAssignmentDecoder.timestamp($0.expiresAt).map { now < $0 } == true
      }), let variant = assignment.variants.first(where: { $0.id == override.variantId })
    {
      return .selected(
        .init(
          assignment: assignment, variant: variant, keyType: key.type, bucket: assignmentBucket,
          groupBucket: nil, source: .qaOverride, subjectDigest: subjectDigest))
    }
    guard let now = trustedTime else { return .normalPlacement(.timeUnreliable) }
    guard assignment.lifecycle == .running || assignment.lifecycle == .scheduled else {
      return .normalPlacement(.inactive)
    }
    guard let startsAt = MosaicExperimentAssignmentDecoder.timestamp(assignment.schedule.startsAt),
      now >= startsAt
    else { return .normalPlacement(.beforeStart) }
    if let end = assignment.schedule.endsAt.flatMap(MosaicExperimentAssignmentDecoder.timestamp),
      now >= end
    {
      return .normalPlacement(.expired)
    }
    var groupBucket: Int?
    if let group = assignment.mutualExclusionGroup {
      let bucket = bucket(
        domain: "mosaic-experiment-group",
        values: [
          assignment.projectId, assignment.environmentId, group.id, group.versionId,
          key.type.rawValue, key.value,
        ])
      groupBucket = bucket
      guard
        group.members.first(where: { $0.rangeStart <= bucket && bucket < $0.rangeEnd })?
          .experimentId == assignment.experimentId
      else {
        return .normalPlacement(.groupExcluded)
      }
    }
    guard
      let variant = assignment.variants.first(where: {
        $0.rangeStart <= assignmentBucket && assignmentBucket < $0.rangeEnd
      })
    else {
      return .normalPlacement(.inactive)
    }
    return .selected(
      .init(
        assignment: assignment, variant: variant, keyType: key.type, bucket: assignmentBucket,
        groupBucket: groupBucket, source: .deterministic, subjectDigest: subjectDigest))
  }

  public static func bucket(domain: String, values: [String]) -> Int {
    let material = domain + "\n1\n" + values.map { "\($0.utf8.count):\($0)\n" }.joined()
    let hash = SHA256.hash(data: Data(material.utf8))
    var value: UInt64 = 0
    for byte in hash.prefix(8) { value = (value << 8) | UInt64(byte) }
    return Int(value % 10_000)
  }

  private static func assignmentKey(
    _ policy: MosaicExperimentAssignmentKeyPolicy, identity: MosaicIdentitySnapshot
  ) -> (type: MosaicExperimentAssignmentKeyType, value: String)? {
    switch policy {
    case .installation: (.installation, identity.installationID)
    case .identifiedUser: identity.userID.map { (.identifiedUser, $0) }
    case .identifiedUserOrInstallation:
      identity.userID.map { (.identifiedUser, $0) } ?? (.installation, identity.installationID)
    }
  }

  static func digest(_ value: String) -> String {
    "sha256:" + SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

struct MosaicTrustedTimeAnchor: Sendable {
  static let maximumAge: TimeInterval = 7 * 24 * 60 * 60
  static let maximumWallDeviation: TimeInterval = 5 * 60
  let serverTime: Date
  let localReceiptTime: Date
  let systemUptime: TimeInterval
  let continuousReceipt: ContinuousClock.Instant

  static func remote(serverTime: Date, localReceiptTime: Date) -> Self {
    .init(
      serverTime: serverTime, localReceiptTime: localReceiptTime,
      systemUptime: ProcessInfo.processInfo.systemUptime,
      continuousReceipt: ContinuousClock.now)
  }

  static func cached(
    serverTime: Date?, localReceiptTime: Date?, systemUptime: TimeInterval?, now: Date
  ) -> Self? {
    guard let serverTime, let localReceiptTime, let systemUptime,
      now.timeIntervalSince(localReceiptTime) >= 0,
      now.timeIntervalSince(localReceiptTime) <= maximumAge
    else { return nil }
    let currentUptime = ProcessInfo.processInfo.systemUptime
    guard currentUptime >= systemUptime else { return nil }
    let persistedBoot = localReceiptTime.addingTimeInterval(-systemUptime)
    let currentBoot = now.addingTimeInterval(-currentUptime)
    guard abs(currentBoot.timeIntervalSince(persistedBoot)) <= maximumWallDeviation else {
      return nil
    }
    return .init(
      serverTime: serverTime.addingTimeInterval(currentUptime - systemUptime),
      localReceiptTime: now, systemUptime: currentUptime,
      continuousReceipt: ContinuousClock.now)
  }

  func now() -> Date? {
    let elapsed = continuousReceipt.duration(to: ContinuousClock.now)
    let components = elapsed.components
    let seconds = Double(components.seconds) + Double(components.attoseconds) / 1e18
    guard seconds >= 0, seconds <= Self.maximumAge else { return nil }
    return serverTime.addingTimeInterval(seconds)
  }
}
