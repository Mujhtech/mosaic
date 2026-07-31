import CryptoKit
import Foundation

public let mosaicPlacementDecisionVersion = "1"
public let mosaicSupportedPlacementDecisionVersions = [mosaicPlacementDecisionVersion]
public let mosaicSupportedBucketingAlgorithms = ["sha256_length_prefixed_v1"]

public enum MosaicThreeState: String, Sendable, Equatable, Codable {
  case `true`
  case `false`
  case unknown
}

public enum MosaicTypedValue: Sendable, Equatable, Codable {
  case string(String)
  case boolean(Bool)
  case number(Double)
  case timestamp(String)
  case semanticVersion(String)
  case stringList([String])

  private enum CodingKeys: String, CodingKey { case type, value }
  private enum Kind: String, Codable {
    case string
    case boolean
    case number
    case timestamp
    case semanticVersion = "semantic_version"
    case stringList = "string_list"
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .string: self = .string(try container.decode(String.self, forKey: .value))
    case .boolean: self = .boolean(try container.decode(Bool.self, forKey: .value))
    case .number: self = .number(try container.decode(Double.self, forKey: .value))
    case .timestamp: self = .timestamp(try container.decode(String.self, forKey: .value))
    case .semanticVersion:
      self = .semanticVersion(try container.decode(String.self, forKey: .value))
    case .stringList: self = .stringList(try container.decode([String].self, forKey: .value))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .string(let value):
      try container.encode(Kind.string, forKey: .type)
      try container.encode(value, forKey: .value)
    case .boolean(let value):
      try container.encode(Kind.boolean, forKey: .type)
      try container.encode(value, forKey: .value)
    case .number(let value):
      try container.encode(Kind.number, forKey: .type)
      try container.encode(value == 0 ? 0 : value, forKey: .value)
    case .timestamp(let value):
      try container.encode(Kind.timestamp, forKey: .type)
      try container.encode(value, forKey: .value)
    case .semanticVersion(let value):
      try container.encode(Kind.semanticVersion, forKey: .type)
      try container.encode(value, forKey: .value)
    case .stringList(let value):
      try container.encode(Kind.stringList, forKey: .type)
      try container.encode(value, forKey: .value)
    }
  }
}

public enum MosaicAssignmentPolicy: String, Sendable, Equatable, Codable {
  case installation
  case identifiedUser = "identified_user"
  case identifiedUserOrInstallation = "identified_user_or_installation"
}

public enum MosaicDecisionSource: Sendable, Equatable, Codable {
  case devicePlatform
  case deviceOSVersion
  case applicationVersion
  case applicationLocale
  case country
  case environmentID
  case environmentKey
  case userPresent
  case userAttribute(String)
  case entitlementState(String)
  case productAvailability(String)
  case productReadiness(String)
  case providerCapability(String)

  private enum CodingKeys: String, CodingKey { case kind, key, productId, capability }
  private enum Kind: String, Codable {
    case devicePlatform = "device.platform"
    case deviceOSVersion = "device.os_version"
    case applicationVersion = "application.version"
    case applicationLocale = "application.locale"
    case country = "context.country"
    case environmentID = "environment.id"
    case environmentKey = "environment.key"
    case userPresent = "identity.user_present"
    case userAttribute = "user_attribute"
    case entitlementState = "entitlement_state"
    case productAvailability = "product_availability"
    case productReadiness = "product_readiness"
    case providerCapability = "provider_capability"
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .devicePlatform: self = .devicePlatform
    case .deviceOSVersion: self = .deviceOSVersion
    case .applicationVersion: self = .applicationVersion
    case .applicationLocale: self = .applicationLocale
    case .country: self = .country
    case .environmentID: self = .environmentID
    case .environmentKey: self = .environmentKey
    case .userPresent: self = .userPresent
    case .userAttribute: self = .userAttribute(try container.decode(String.self, forKey: .key))
    case .entitlementState:
      self = .entitlementState(try container.decode(String.self, forKey: .key))
    case .productAvailability:
      self = .productAvailability(try container.decode(String.self, forKey: .productId))
    case .productReadiness:
      self = .productReadiness(try container.decode(String.self, forKey: .productId))
    case .providerCapability:
      self = .providerCapability(try container.decode(String.self, forKey: .capability))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .devicePlatform: try container.encode(Kind.devicePlatform, forKey: .kind)
    case .deviceOSVersion: try container.encode(Kind.deviceOSVersion, forKey: .kind)
    case .applicationVersion: try container.encode(Kind.applicationVersion, forKey: .kind)
    case .applicationLocale: try container.encode(Kind.applicationLocale, forKey: .kind)
    case .country: try container.encode(Kind.country, forKey: .kind)
    case .environmentID: try container.encode(Kind.environmentID, forKey: .kind)
    case .environmentKey: try container.encode(Kind.environmentKey, forKey: .kind)
    case .userPresent: try container.encode(Kind.userPresent, forKey: .kind)
    case .userAttribute(let key):
      try container.encode(Kind.userAttribute, forKey: .kind)
      try container.encode(key, forKey: .key)
    case .entitlementState(let key):
      try container.encode(Kind.entitlementState, forKey: .kind)
      try container.encode(key, forKey: .key)
    case .productAvailability(let id):
      try container.encode(Kind.productAvailability, forKey: .kind)
      try container.encode(id, forKey: .productId)
    case .productReadiness(let id):
      try container.encode(Kind.productReadiness, forKey: .kind)
      try container.encode(id, forKey: .productId)
    case .providerCapability(let value):
      try container.encode(Kind.providerCapability, forKey: .kind)
      try container.encode(value, forKey: .capability)
    }
  }
}

public enum MosaicDecisionOperator: String, Sendable, Equatable, Codable {
  case equals
  case notEquals = "not_equals"
  case `in`
  case notIn = "not_in"
  case greaterThan = "greater_than"
  case greaterThanOrEqual = "greater_than_or_equal"
  case lessThan = "less_than"
  case lessThanOrEqual = "less_than_or_equal"
  case exists
  case doesNotExist = "does_not_exist"
  case containsAny = "contains_any"
  case containsAll = "contains_all"
  case localeMatches = "locale_matches"
}

public indirect enum MosaicConditionNode: Sendable, Equatable, Codable {
  case condition(
    source: MosaicDecisionSource, operator: MosaicDecisionOperator, operand: MosaicTypedValue?)
  case all([MosaicConditionNode])
  case any([MosaicConditionNode])
  case not(MosaicConditionNode)

  private enum CodingKeys: String, CodingKey {
    case type, source, `operator`, operand, children, child
  }
  private enum Kind: String, Codable { case condition, all, any, not }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .type) {
    case .condition:
      self = .condition(
        source: try c.decode(MosaicDecisionSource.self, forKey: .source),
        operator: try c.decode(MosaicDecisionOperator.self, forKey: .operator),
        operand: try c.decodeIfPresent(MosaicTypedValue.self, forKey: .operand))
    case .all: self = .all(try c.decode([MosaicConditionNode].self, forKey: .children))
    case .any: self = .any(try c.decode([MosaicConditionNode].self, forKey: .children))
    case .not: self = .not(try c.decode(MosaicConditionNode.self, forKey: .child))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .condition(let source, let op, let operand):
      try c.encode(Kind.condition, forKey: .type)
      try c.encode(source, forKey: .source)
      try c.encode(op, forKey: .operator)
      try c.encodeIfPresent(operand, forKey: .operand)
    case .all(let children):
      try c.encode(Kind.all, forKey: .type)
      try c.encode(children, forKey: .children)
    case .any(let children):
      try c.encode(Kind.any, forKey: .type)
      try c.encode(children, forKey: .children)
    case .not(let child):
      try c.encode(Kind.not, forKey: .type)
      try c.encode(child, forKey: .child)
    }
  }
}

public enum MosaicDecisionOutcome: Sendable, Equatable, Codable {
  case paywall(versionID: String, unavailableFallbackKey: String?)
  case noPaywall
  case fallback(key: String)
  case unavailable(reason: String)
  private enum CodingKeys: String, CodingKey {
    case type, paywallVersionId, unavailableFallbackKey, key, reason
  }
  private enum Kind: String, Codable {
    case paywall
    case noPaywall = "no_paywall"
    case fallback
    case unavailable
  }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(Kind.self, forKey: .type) {
    case .paywall:
      self = .paywall(
        versionID: try c.decode(String.self, forKey: .paywallVersionId),
        unavailableFallbackKey: try c.decodeIfPresent(String.self, forKey: .unavailableFallbackKey))
    case .noPaywall: self = .noPaywall
    case .fallback: self = .fallback(key: try c.decode(String.self, forKey: .key))
    case .unavailable: self = .unavailable(reason: try c.decode(String.self, forKey: .reason))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .paywall(let id, let fallback):
      try c.encode(Kind.paywall, forKey: .type)
      try c.encode(id, forKey: .paywallVersionId)
      try c.encodeIfPresent(fallback, forKey: .unavailableFallbackKey)
    case .noPaywall: try c.encode(Kind.noPaywall, forKey: .type)
    case .fallback(let key):
      try c.encode(Kind.fallback, forKey: .type)
      try c.encode(key, forKey: .key)
    case .unavailable(let reason):
      try c.encode(Kind.unavailable, forKey: .type)
      try c.encode(reason, forKey: .reason)
    }
  }
}

public struct MosaicDecisionRollout: Sendable, Equatable, Codable {
  public let algorithm: String
  public let thresholdBasisPoints: Int
}
public struct MosaicDecisionRule: Sendable, Equatable, Codable {
  public let id: String
  public let priority: Int
  public let enabled: Bool
  public let safeLabel: String?
  public let conditions: MosaicConditionNode
  public let rollout: MosaicDecisionRollout?
  public let outcome: MosaicDecisionOutcome
}
public struct MosaicDecisionFallback: Sendable, Equatable, Codable {
  public let key: String
  public let safeLabel: String?
  public let outcome: MosaicDecisionOutcome
}
public enum MosaicAttributeSensitivity: String, Sendable, Equatable, Codable {
  case standard, sensitive
}
public struct MosaicAttributeDefinition: Sendable, Equatable, Codable {
  public let key: String
  public let type: String
  public let sensitivity: MosaicAttributeSensitivity
  public let allowedOperators: [MosaicDecisionOperator]
}
public struct MosaicDecisionCompatibility: Sendable, Equatable, Codable {
  public let requiredFeatures: [String]
  public let bucketingAlgorithms: [String]
}
public struct MosaicQAOverride: Sendable, Equatable, Codable {
  public let id: String
  public let selectorDigest: String
  public let safeLabel: String
  public let startsAt: String
  public let expiresAt: String
  public let outcome: MosaicDecisionOutcome
}
public struct MosaicDecisionRuleSet: Sendable, Equatable, Codable {
  public let id: String
  public let version: Int
  public let projectId: String
  public let environmentId: String
  public let environmentKey: String
  public let placementId: String
  public let placementKey: String
  public let enabled: Bool
  public let assignmentPolicy: MosaicAssignmentPolicy
  public let attributeDefinitions: [MosaicAttributeDefinition]
  public let fallbacks: [MosaicDecisionFallback]
  public let rules: [MosaicDecisionRule]
  public let defaultOutcome: MosaicDecisionOutcome
  public let qaOverrides: [MosaicQAOverride]
  public let compatibility: MosaicDecisionCompatibility
}
public struct MosaicPlacementDecision: Sendable, Equatable, Codable {
  public let placementDecisionVersion: String
  public let ruleSet: MosaicDecisionRuleSet
}

public enum MosaicEntitlementDecisionState: String, Sendable, Equatable, Codable {
  case active, inactive, unknown
  case providerUnavailable = "provider_unavailable"
  case failed
}
public enum MosaicProductDecisionAvailability: String, Sendable, Equatable, Codable {
  case available, unavailable, unknown
  case providerUnavailable = "provider_unavailable"
  case failed
}
public enum MosaicProviderCapabilityState: String, Sendable, Equatable, Codable {
  case available, unavailable, unknown
}

public struct MosaicDecisionContext: Sendable, Equatable {
  public var platform: String?
  public var operatingSystemVersion: String?
  public var applicationVersion: String?
  public var applicationLocale: String?
  public var country: String?
  public var attributes: [String: MosaicTypedValue]
  public var entitlements: [String: MosaicEntitlementDecisionState]
  public var products: [String: MosaicProductDecisionAvailability]
  public var providerCapabilities: [String: MosaicProviderCapabilityState]
  public var qaOverrideTokens: [String]
  public init(
    platform: String? = "ios", operatingSystemVersion: String? = nil,
    applicationVersion: String? = nil, applicationLocale: String? = nil, country: String? = nil,
    attributes: [String: MosaicTypedValue] = [:],
    entitlements: [String: MosaicEntitlementDecisionState] = [:],
    products: [String: MosaicProductDecisionAvailability] = [:],
    providerCapabilities: [String: MosaicProviderCapabilityState] = [:],
    qaOverrideTokens: [String] = []
  ) {
    self.platform = platform
    self.operatingSystemVersion = operatingSystemVersion
    self.applicationVersion = applicationVersion
    self.applicationLocale = applicationLocale
    self.country = country
    self.attributes = attributes
    self.entitlements = entitlements
    self.products = products
    self.providerCapabilities = providerCapabilities
    self.qaOverrideTokens = qaOverrideTokens
  }
}

public struct MosaicDecisionTraceStep: Sendable, Equatable {
  public let code: String
  public let ruleID: String?
  public let safeLabel: String?
  public let result: MosaicThreeState?
  public let assignmentType: String?
  public let rolloutBucket: Int?
  public let fallbackKey: String?
}
public struct MosaicDecisionTrace: Sendable, Equatable {
  public let steps: [MosaicDecisionTraceStep]
}

public enum MosaicPlacementDecisionResult: Sendable, Equatable {
  case paywallSelected(
    document: MosaicPaywallDocument, paywallVersionID: String, matchedRuleID: String?,
    fallbackPath: [String], release: MosaicConfigurationReleaseMetadata,
    source: MosaicConfigurationSource, trace: MosaicDecisionTrace)
  case noPaywall(
    matchedRuleID: String?, release: MosaicConfigurationReleaseMetadata,
    source: MosaicConfigurationSource, trace: MosaicDecisionTrace)
  case placementUnavailable(diagnostics: [MosaicDiagnostic])
  case configurationUnavailable(diagnostics: [MosaicDiagnostic])
  case unsupportedDecisionContract(diagnostics: [MosaicDiagnostic])
  case evaluationFailed(diagnostics: [MosaicDiagnostic])
}

public struct MosaicIdentitySnapshot: Sendable, Equatable {
  public let installationID: String
  public let userID: String?
  public let attributes: [String: MosaicTypedValue]
  public let generation: UInt64
}

enum MosaicPlacementEvaluator {
  struct Assignment {
    let type: String
    let value: String
  }
  struct Output {
    let outcome: MosaicDecisionOutcome
    let matchedRuleID: String?
    let fallbackPath: [String]
    let trace: MosaicDecisionTrace
  }

  static func evaluate(
    decision: MosaicPlacementDecision, context: MosaicDecisionContext,
    identity: MosaicIdentitySnapshot, productReadiness: [String: MosaicProductReadiness],
    now: Date = Date()
  ) -> Output {
    let set = decision.ruleSet
    var trace: [MosaicDecisionTraceStep] = []
    func append(_ step: MosaicDecisionTraceStep) { if trace.count < 256 { trace.append(step) } }
    if let override = matchingOverride(set.qaOverrides, tokens: context.qaOverrideTokens, now: now)
    {
      append(
        .init(
          code: "qa_override_matched", ruleID: nil, safeLabel: override.safeLabel, result: .true,
          assignmentType: nil, rolloutBucket: nil, fallbackKey: nil))
      let resolved = resolve(override.outcome, fallbacks: set.fallbacks, trace: &trace)
      return Output(
        outcome: resolved.outcome, matchedRuleID: nil, fallbackPath: resolved.path,
        trace: .init(steps: trace))
    }
    guard set.enabled else {
      append(
        .init(
          code: "ruleset_disabled", ruleID: nil, safeLabel: nil, result: nil, assignmentType: nil,
          rolloutBucket: nil, fallbackKey: nil))
      return Output(
        outcome: .unavailable(reason: "no_safe_decision"), matchedRuleID: nil, fallbackPath: [],
        trace: .init(steps: trace))
    }
    let assignment = assignment(policy: set.assignmentPolicy, identity: identity)
    for rule in set.rules.filter(\.enabled).sorted(by: { $0.priority < $1.priority }) {
      let result = evaluate(
        rule.conditions, set: set, context: context, identity: identity,
        productReadiness: productReadiness)
      var bucket: Int?
      var matches = result == .true
      if matches, let rollout = rule.rollout {
        if let assignment {
          bucket = MosaicRolloutBucketer.bucket(
            projectID: set.projectId, environmentID: set.environmentId,
            placementID: set.placementId, ruleID: rule.id, assignmentType: assignment.type,
            assignmentValue: assignment.value)
          matches = bucket! < rollout.thresholdBasisPoints
        } else {
          matches = false
        }
      }
      append(
        .init(
          code: matches ? "rule_matched" : "rule_skipped", ruleID: rule.id,
          safeLabel: rule.safeLabel, result: result,
          assignmentType: rule.rollout == nil ? nil : assignment?.type, rolloutBucket: bucket,
          fallbackKey: nil))
      if matches {
        let resolved = resolve(rule.outcome, fallbacks: set.fallbacks, trace: &trace)
        return Output(
          outcome: resolved.outcome, matchedRuleID: rule.id, fallbackPath: resolved.path,
          trace: .init(steps: trace))
      }
    }
    append(
      .init(
        code: "default_selected", ruleID: nil, safeLabel: nil, result: nil, assignmentType: nil,
        rolloutBucket: nil, fallbackKey: nil))
    let resolved = resolve(set.defaultOutcome, fallbacks: set.fallbacks, trace: &trace)
    return Output(
      outcome: resolved.outcome, matchedRuleID: nil, fallbackPath: resolved.path,
      trace: .init(steps: trace))
  }

  private static func matchingOverride(_ overrides: [MosaicQAOverride], tokens: [String], now: Date)
    -> MosaicQAOverride?
  {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let digests = Set(
      tokens.map {
        "sha256:" + SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined()
      })
    return overrides.first { item in
      guard let start = formatter.date(from: item.startsAt),
        let end = formatter.date(from: item.expiresAt)
      else { return false }
      return start <= now && now < end && digests.contains(item.selectorDigest)
    }
  }

  private static func assignment(policy: MosaicAssignmentPolicy, identity: MosaicIdentitySnapshot)
    -> Assignment?
  {
    switch policy {
    case .installation: return .init(type: "installation", value: identity.installationID)
    case .identifiedUser: return identity.userID.map { .init(type: "identified_user", value: $0) }
    case .identifiedUserOrInstallation:
      return identity.userID.map { .init(type: "identified_user", value: $0) }
        ?? .init(type: "installation", value: identity.installationID)
    }
  }

  private static func resolve(
    _ outcome: MosaicDecisionOutcome, fallbacks: [MosaicDecisionFallback],
    trace: inout [MosaicDecisionTraceStep]
  ) -> (outcome: MosaicDecisionOutcome, path: [String]) {
    var current = outcome
    var path: [String] = []
    for _ in 0..<8 {
      guard case .fallback(let key) = current,
        let fallback = fallbacks.first(where: { $0.key == key })
      else { return (current, path) }
      path.append(key)
      if trace.count < 256 {
        trace.append(
          .init(
            code: "fallback_selected", ruleID: nil, safeLabel: fallback.safeLabel, result: nil,
            assignmentType: nil, rolloutBucket: nil, fallbackKey: key))
      }
      current = fallback.outcome
    }
    return (.unavailable(reason: "no_safe_decision"), path)
  }

  private static func evaluate(
    _ node: MosaicConditionNode, set: MosaicDecisionRuleSet, context: MosaicDecisionContext,
    identity: MosaicIdentitySnapshot, productReadiness: [String: MosaicProductReadiness]
  ) -> MosaicThreeState {
    switch node {
    case .all(let children):
      let values = children.map {
        evaluate(
          $0, set: set, context: context, identity: identity, productReadiness: productReadiness)
      }
      return values.contains(.false) ? .false : (values.contains(.unknown) ? .unknown : .true)
    case .any(let children):
      let values = children.map {
        evaluate(
          $0, set: set, context: context, identity: identity, productReadiness: productReadiness)
      }
      return values.contains(.true) ? .true : (values.contains(.unknown) ? .unknown : .false)
    case .not(let child):
      switch evaluate(
        child, set: set, context: context, identity: identity, productReadiness: productReadiness)
      {
      case .true: return .false
      case .false: return .true
      case .unknown: return .unknown
      }
    case .condition(let source, let op, let operand):
      return compare(
        value(
          for: source, set: set, context: context, identity: identity,
          productReadiness: productReadiness), operator: op, operand: operand)
    }
  }

  private static func value(
    for source: MosaicDecisionSource, set: MosaicDecisionRuleSet, context: MosaicDecisionContext,
    identity: MosaicIdentitySnapshot, productReadiness: [String: MosaicProductReadiness]
  ) -> MosaicTypedValue? {
    switch source {
    case .devicePlatform: return context.platform.map(MosaicTypedValue.string)
    case .deviceOSVersion:
      return context.operatingSystemVersion.map(MosaicTypedValue.semanticVersion)
    case .applicationVersion:
      return context.applicationVersion.map(MosaicTypedValue.semanticVersion)
    case .applicationLocale:
      return context.applicationLocale.flatMap(normalizeLocale).map(MosaicTypedValue.string)
    case .country:
      guard let value = context.country?.uppercased(),
        value.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil
      else { return nil }
      return .string(value)
    case .environmentID: return .string(set.environmentId)
    case .environmentKey: return .string(set.environmentKey)
    case .userPresent: return .boolean(identity.userID != nil)
    case .userAttribute(let key): return context.attributes[key] ?? identity.attributes[key]
    case .entitlementState(let key): return context.entitlements[key].map { .string($0.rawValue) }
    case .productAvailability(let id): return context.products[id].map { .string($0.rawValue) }
    case .productReadiness(let id): return productReadiness[id].map { .string($0.rawValue) }
    case .providerCapability(let capability):
      return context.providerCapabilities[capability].map { .string($0.rawValue) }
    }
  }

  private static func compare(
    _ value: MosaicTypedValue?, operator op: MosaicDecisionOperator, operand: MosaicTypedValue?
  ) -> MosaicThreeState {
    if op == .exists { return value == nil ? .false : .true }
    if op == .doesNotExist { return value == nil ? .true : .false }
    guard let value, let operand else { return .unknown }
    if op == .localeMatches, case .string(let lhs) = value, case .string(let rhs) = operand,
      let tag = normalizeLocale(lhs), let range = normalizeLocale(rhs)
    {
      return tag == range || tag.hasPrefix(range + "-") ? .true : .false
    }
    if case .semanticVersion(let lhs) = value {
      guard case .semanticVersion(let rhs) = operand,
        let l = SemanticVersion(lhs), let r = SemanticVersion(rhs)
      else { return .unknown }
      return ordering(l.compare(r), op)
    }
    if case .timestamp(let lhs) = value, case .timestamp(let rhs) = operand {
      return ordering(lhs.compare(rhs), op)
    }
    if case .number(let lhs) = value, case .number(let rhs) = operand {
      return ordering(
        lhs == rhs ? .orderedSame : (lhs < rhs ? .orderedAscending : .orderedDescending), op)
    }
    if case .stringList(let lhs) = value, case .stringList(let rhs) = operand {
      let l = Set(lhs)
      let r = Set(rhs)
      if op == .containsAny { return l.isDisjoint(with: r) ? .false : .true }
      if op == .containsAll { return r.isSubset(of: l) ? .true : .false }
    }
    if case .stringList(let list) = operand {
      let contains: Bool
      switch value {
      case .string(let item): contains = list.contains(item)
      default: return .unknown
      }
      if op == .in { return contains ? .true : .false }
      if op == .notIn { return contains ? .false : .true }
    }
    guard op == .equals || op == .notEquals else { return .unknown }
    let equal = value == operand
    return (op == .equals ? equal : !equal) ? .true : .false
  }

  private static func ordering(_ result: ComparisonResult, _ op: MosaicDecisionOperator)
    -> MosaicThreeState
  {
    let match: Bool
    switch op {
    case .equals: match = result == .orderedSame
    case .notEquals: match = result != .orderedSame
    case .greaterThan: match = result == .orderedDescending
    case .greaterThanOrEqual: match = result != .orderedAscending
    case .lessThan: match = result == .orderedAscending
    case .lessThanOrEqual: match = result != .orderedDescending
    default: return .unknown
    }
    return match ? .true : .false
  }

  private static func normalizeLocale(_ value: String) -> String? {
    let normalizedSeparators = value.replacingOccurrences(of: "_", with: "-")
    guard normalizedSeparators.count <= 64,
      normalizedSeparators.range(
        of: "^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$", options: .regularExpression) != nil
    else { return nil }
    return normalizedSeparators.split(separator: "-").enumerated().map { index, part in
      let text = String(part)
      if index == 0 { return text.lowercased() }
      if text.count == 4 { return text.prefix(1).uppercased() + text.dropFirst().lowercased() }
      if text.count == 2 || text.count == 3 { return text.uppercased() }
      return text.lowercased()
    }.joined(separator: "-")
  }
}

public enum MosaicRolloutBucketer {
  public static func bucket(
    projectID: String, environmentID: String, placementID: String, ruleID: String,
    assignmentType: String, assignmentValue: String
  ) -> Int {
    let fields = [projectID, environmentID, placementID, ruleID, assignmentType, assignmentValue]
    let body = fields.map { "\(Data($0.utf8).count):\($0)\n" }.joined()
    let digest = SHA256.hash(data: Data("mosaic-placement-rollout\n1\n\(body)".utf8))
    var remainder: UInt64 = 0
    for byte in digest.prefix(8) {
      remainder = ((remainder % 10_000) * 256 + UInt64(byte)) % 10_000
    }
    return Int(remainder)
  }
}

private struct SemanticVersion {
  let core: [Int]
  let prerelease: [String]
  init?(_ raw: String) {
    let buildParts = raw.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false)
    guard buildParts.count <= 2 else { return nil }
    if buildParts.count == 2 {
      let identifiers = buildParts[1].split(separator: ".", omittingEmptySubsequences: false)
      guard !identifiers.isEmpty,
        identifiers.allSatisfy({
          !$0.isEmpty
            && $0.range(of: "^[0-9A-Za-z-]+$", options: .regularExpression) != nil
        })
      else { return nil }
    }
    let main = buildParts[0]
    let pieces = main.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let components = pieces[0].split(separator: ".", omittingEmptySubsequences: false)
    guard (1...3).contains(components.count) else { return nil }
    var core: [Int] = []
    for component in components {
      let text = String(component)
      guard text.range(of: "^(0|[1-9][0-9]*)$", options: .regularExpression) != nil,
        let value = Int(text)
      else { return nil }
      core.append(value)
    }
    while core.count < 3 { core.append(0) }
    self.core = core
    if pieces.count == 2 {
      let ids = pieces[1].split(separator: ".", omittingEmptySubsequences: false).map(String.init)
      guard !ids.isEmpty,
        ids.allSatisfy({
          !$0.isEmpty && $0.range(of: "^[0-9A-Za-z-]+$", options: .regularExpression) != nil
            && !($0.count > 1 && $0.first == "0" && $0.allSatisfy(\.isNumber))
        })
      else { return nil }
      prerelease = ids
    } else {
      prerelease = []
    }
  }
  func compare(_ other: Self) -> ComparisonResult {
    for (a, b) in zip(core, other.core) where a != b {
      return a < b ? .orderedAscending : .orderedDescending
    }
    if prerelease.isEmpty != other.prerelease.isEmpty {
      return prerelease.isEmpty ? .orderedDescending : .orderedAscending
    }
    for index in 0..<min(prerelease.count, other.prerelease.count) {
      let a = prerelease[index]
      let b = other.prerelease[index]
      if a == b { continue }
      if let ai = Int(a), let bi = Int(b) {
        return ai < bi ? .orderedAscending : .orderedDescending
      }
      if Int(a) != nil { return .orderedAscending }
      if Int(b) != nil { return .orderedDescending }
      return a < b ? .orderedAscending : .orderedDescending
    }
    return prerelease.count == other.prerelease.count
      ? .orderedSame
      : (prerelease.count < other.prerelease.count ? .orderedAscending : .orderedDescending)
  }
}
