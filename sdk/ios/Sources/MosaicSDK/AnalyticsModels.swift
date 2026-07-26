import CoreFoundation
import Foundation

public let mosaicAnalyticsEventContractVersion = "1"
public let mosaicAnalyticsEventSchemaVersion = "1"

public struct MosaicAnalyticsCapabilityReport: Sendable, Equatable {
  public let analyticsEventContractVersions: [String]
  public let eventSchemaVersions: [String]
  public let eventNames: [MosaicAnalyticsEventName]
  public let maximumEventsPerBatch: Int
  public let maximumEventBytes: Int
  public let maximumRequestBytes: Int
  public let publicSDKAuthority: MosaicAnalyticsAuthority

  public static let current = MosaicAnalyticsCapabilityReport(
    analyticsEventContractVersions: ["1"], eventSchemaVersions: ["1"],
    eventNames: MosaicAnalyticsEventName.allCases, maximumEventsPerBatch: 50,
    maximumEventBytes: 32 * 1_024, maximumRequestBytes: 512 * 1_024,
    publicSDKAuthority: .clientObserved)
}

public enum MosaicAnalyticsEventName: String, Codable, Sendable, CaseIterable {
  case placementRequested = "placement_requested"
  case placementPaywallSelected = "placement_paywall_selected"
  case placementNoPaywall = "placement_no_paywall"
  case placementFallbackUsed = "placement_fallback_used"
  case placementUnavailable = "placement_unavailable"
  case placementEvaluationFailed = "placement_evaluation_failed"
  case paywallPresented = "paywall_presented"
  case paywallDismissed = "paywall_dismissed"
  case paywallActionSelected = "paywall_action_selected"
  case paywallRenderFailed = "paywall_render_failed"
  case productLoadStarted = "product_load_started"
  case productLoadCompleted = "product_load_completed"
  case productLoadFailed = "product_load_failed"
  case productUnavailable = "product_unavailable"
  case productSelected = "product_selected"
  case purchaseStarted = "purchase_started"
  case purchaseCompletedClient = "purchase_completed_client"
  case purchaseCompletedProvider = "purchase_completed_provider"
  case purchasePending = "purchase_pending"
  case purchaseDeferred = "purchase_deferred"
  case purchaseCancelled = "purchase_cancelled"
  case purchaseFailed = "purchase_failed"
  case restoreStarted = "restore_started"
  case restoreCompleted = "restore_completed"
  case restoreNothingFound = "restore_nothing_found"
  case restoreCancelled = "restore_cancelled"
  case restoreFailed = "restore_failed"
}

public enum MosaicAnalyticsAuthority: String, Codable, Sendable {
  case clientObserved = "client_observed"
  case trustedServer = "trusted_server"
  case providerConfirmed = "provider_confirmed"
}

public struct MosaicAnalyticsIdentity: Codable, Sendable, Equatable {
  public let installationId: String
  public let applicationUserId: String?
  public let generation: UInt64

  public init(installationId: String, applicationUserId: String? = nil, generation: UInt64) {
    self.installationId = installationId
    self.applicationUserId = applicationUserId
    self.generation = generation
  }
}

public struct MosaicAnalyticsContext: Codable, Sendable, Equatable {
  public let platform: String
  public let sdkFamily: String
  public let sdkVersion: String
  public let operatingSystemVersion: String?
  public let applicationVersion: String?
  public let locale: String?
  public let configurationDeliveryVersion: String?
  public let commerceProviderContractVersion: String?

  public init(
    platform: String = "ios", sdkFamily: String = "ios", sdkVersion: String,
    operatingSystemVersion: String? = nil, applicationVersion: String? = nil,
    locale: String? = nil, configurationDeliveryVersion: String? = nil,
    commerceProviderContractVersion: String? = nil
  ) {
    self.platform = platform
    self.sdkFamily = sdkFamily
    self.sdkVersion = sdkVersion
    self.operatingSystemVersion = operatingSystemVersion
    self.applicationVersion = applicationVersion
    self.locale = locale
    self.configurationDeliveryVersion = configurationDeliveryVersion
    self.commerceProviderContractVersion = commerceProviderContractVersion
  }
}

public struct MosaicAnalyticsCorrelation: Codable, Sendable, Equatable {
  public var placementRequestId: String?
  public var paywallPresentationId: String?
  public var productLoadAttemptId: String?
  public var purchaseAttemptId: String?
  public var restoreAttemptId: String?
  public var providerOperationId: String?
  public var providerUpdateId: String?

  public init(
    placementRequestId: String? = nil, paywallPresentationId: String? = nil,
    productLoadAttemptId: String? = nil, purchaseAttemptId: String? = nil,
    restoreAttemptId: String? = nil, providerOperationId: String? = nil,
    providerUpdateId: String? = nil
  ) {
    self.placementRequestId = placementRequestId
    self.paywallPresentationId = paywallPresentationId
    self.productLoadAttemptId = productLoadAttemptId
    self.purchaseAttemptId = purchaseAttemptId
    self.restoreAttemptId = restoreAttemptId
    self.providerOperationId = providerOperationId
    self.providerUpdateId = providerUpdateId
  }
}

public struct MosaicAnalyticsAttribution: Codable, Sendable, Equatable {
  public var configurationReleaseId: String?
  public var placementId: String?
  public var placementRuleSetId: String?
  public var placementRuleSetVersion: UInt64?
  public var winningRuleId: String?
  public var paywallId: String?
  public var paywallVersionId: String?
  public var mosaicProductId: String?
  public var planId: String?
  public var providerId: String?
  public var providerProductMappingId: String?

  public init(
    configurationReleaseId: String? = nil, placementId: String? = nil,
    placementRuleSetId: String? = nil, placementRuleSetVersion: UInt64? = nil,
    winningRuleId: String? = nil, paywallId: String? = nil,
    paywallVersionId: String? = nil, mosaicProductId: String? = nil,
    planId: String? = nil, providerId: String? = nil,
    providerProductMappingId: String? = nil
  ) {
    self.configurationReleaseId = configurationReleaseId
    self.placementId = placementId
    self.placementRuleSetId = placementRuleSetId
    self.placementRuleSetVersion = placementRuleSetVersion
    self.winningRuleId = winningRuleId
    self.paywallId = paywallId
    self.paywallVersionId = paywallVersionId
    self.mosaicProductId = mosaicProductId
    self.planId = planId
    self.providerId = providerId
    self.providerProductMappingId = providerProductMappingId
  }
}

public struct MosaicAnalyticsPayload: Codable, Sendable, Equatable {
  public var decisionContractVersion: String?
  public var finalOutcome: String?
  public var assignmentKeyType: String?
  public var bucketingAlgorithm: String?
  public var rolloutBucket: Int?
  public var trigger: String?
  public var fallbackKey: String?
  public var diagnosticCode: String?
  public var retryable: Bool?
  public var reason: String?
  public var action: String?
  public var componentId: String?
  public var requestedProductCount: Int?
  public var availableProductCount: Int?
  public var unavailableProductCount: Int?
  public var durationMs: Int?
  public var source: String?
  public var outcome: String?
  public var observedEntitlementKeys: [String]?
  public var providerResultCode: String?
  public var confirmationSource: String?
  public var activeEntitlementKeys: [String]?
  public var linkedClientEventId: String?
  public var providerId: String?
  public var restoredProductIds: [String]?

  public init(
    decisionContractVersion: String? = nil, finalOutcome: String? = nil,
    assignmentKeyType: String? = nil, bucketingAlgorithm: String? = nil,
    rolloutBucket: Int? = nil, trigger: String? = nil, fallbackKey: String? = nil,
    diagnosticCode: String? = nil, retryable: Bool? = nil, reason: String? = nil,
    action: String? = nil, componentId: String? = nil, requestedProductCount: Int? = nil,
    availableProductCount: Int? = nil, unavailableProductCount: Int? = nil,
    durationMs: Int? = nil, source: String? = nil, outcome: String? = nil,
    observedEntitlementKeys: [String]? = nil, providerResultCode: String? = nil,
    confirmationSource: String? = nil, activeEntitlementKeys: [String]? = nil,
    linkedClientEventId: String? = nil, providerId: String? = nil,
    restoredProductIds: [String]? = nil
  ) {
    self.decisionContractVersion = decisionContractVersion
    self.finalOutcome = finalOutcome
    self.assignmentKeyType = assignmentKeyType
    self.bucketingAlgorithm = bucketingAlgorithm
    self.rolloutBucket = rolloutBucket
    self.trigger = trigger
    self.fallbackKey = fallbackKey
    self.diagnosticCode = diagnosticCode
    self.retryable = retryable
    self.reason = reason
    self.action = action
    self.componentId = componentId
    self.requestedProductCount = requestedProductCount
    self.availableProductCount = availableProductCount
    self.unavailableProductCount = unavailableProductCount
    self.durationMs = durationMs
    self.source = source
    self.outcome = outcome
    self.observedEntitlementKeys = observedEntitlementKeys
    self.providerResultCode = providerResultCode
    self.confirmationSource = confirmationSource
    self.activeEntitlementKeys = activeEntitlementKeys
    self.linkedClientEventId = linkedClientEventId
    self.providerId = providerId
    self.restoredProductIds = restoredProductIds
  }
}

public struct MosaicAnalyticsEvent: Codable, Sendable, Equatable {
  public let eventId: String
  public let eventSchemaVersion: String
  public let eventName: MosaicAnalyticsEventName
  public let occurredAt: String
  public let queuedAt: String
  public let authority: MosaicAnalyticsAuthority
  public let identity: MosaicAnalyticsIdentity?
  public let sessionId: String?
  public let context: MosaicAnalyticsContext?
  public let correlation: MosaicAnalyticsCorrelation
  public let attribution: MosaicAnalyticsAttribution
  public let payload: MosaicAnalyticsPayload

  public init(
    eventId: String, eventSchemaVersion: String = mosaicAnalyticsEventSchemaVersion,
    eventName: MosaicAnalyticsEventName, occurredAt: String, queuedAt: String,
    authority: MosaicAnalyticsAuthority, identity: MosaicAnalyticsIdentity? = nil,
    sessionId: String? = nil, context: MosaicAnalyticsContext? = nil,
    correlation: MosaicAnalyticsCorrelation, attribution: MosaicAnalyticsAttribution,
    payload: MosaicAnalyticsPayload
  ) {
    self.eventId = eventId
    self.eventSchemaVersion = eventSchemaVersion
    self.eventName = eventName
    self.occurredAt = occurredAt
    self.queuedAt = queuedAt
    self.authority = authority
    self.identity = identity
    self.sessionId = sessionId
    self.context = context
    self.correlation = correlation
    self.attribution = attribution
    self.payload = payload
  }
}

public struct MosaicAnalyticsBatch: Codable, Sendable, Equatable {
  public let analyticsEventContractVersion: String
  public let batchId: String
  public let sentAt: String
  public let events: [MosaicAnalyticsEvent]

  public init(batchId: String, sentAt: String, events: [MosaicAnalyticsEvent]) {
    analyticsEventContractVersion = mosaicAnalyticsEventContractVersion
    self.batchId = batchId
    self.sentAt = sentAt
    self.events = events
  }
}

public enum MosaicAnalyticsResultStatus: String, Codable, Sendable {
  case accepted
  case duplicate
  case permanentlyRejected = "permanently_rejected"
  case retryable
}

public struct MosaicAnalyticsEventResult: Codable, Sendable, Equatable {
  public let eventId: String
  public let status: MosaicAnalyticsResultStatus
  public let code: String?
  public let retryAfterSeconds: Int?
}

public struct MosaicAnalyticsIngestionResponse: Codable, Sendable, Equatable {
  public let analyticsEventContractVersion: String
  public let batchId: String
  public let receivedAt: String
  public let results: [MosaicAnalyticsEventResult]
}

public enum MosaicAnalyticsCodecError: Error, Sendable, Equatable {
  case malformedJSON
  case unknownField(String)
  case unsupportedVersion
  case invalidEvent
  case payloadMismatch
}

public enum MosaicAnalyticsCodec {
  private static let eventKeys: Set<String> = [
    "eventId", "eventSchemaVersion", "eventName", "occurredAt", "queuedAt", "authority",
    "identity", "sessionId", "context", "correlation", "attribution", "payload",
  ]
  private static let nestedKeys: [String: Set<String>] = [
    "identity": ["installationId", "applicationUserId", "generation"],
    "context": [
      "platform", "sdkFamily", "sdkVersion", "operatingSystemVersion", "applicationVersion",
      "locale", "configurationDeliveryVersion", "commerceProviderContractVersion",
    ],
    "correlation": [
      "placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId",
      "restoreAttemptId", "providerOperationId", "providerUpdateId",
    ],
    "attribution": [
      "configurationReleaseId", "placementId", "placementRuleSetId", "placementRuleSetVersion",
      "winningRuleId", "paywallId", "paywallVersionId", "mosaicProductId", "planId", "providerId",
      "providerProductMappingId",
    ],
  ]

  public static func decodeEvent(_ data: Data) throws -> MosaicAnalyticsEvent {
    guard data.count <= 32 * 1_024 else { throw MosaicAnalyticsCodecError.invalidEvent }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw MosaicAnalyticsCodecError.malformedJSON
    }
    try validateEventObject(object)
    do { return try JSONDecoder().decode(MosaicAnalyticsEvent.self, from: data) } catch {
      throw MosaicAnalyticsCodecError.invalidEvent
    }
  }

  public static func decodeBatch(_ data: Data) throws -> MosaicAnalyticsBatch {
    guard data.count <= 512 * 1_024 else { throw MosaicAnalyticsCodecError.invalidEvent }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(object.keys).isSubset(of: [
        "analyticsEventContractVersion", "batchId", "sentAt", "events",
      ]),
      object["analyticsEventContractVersion"] as? String == "1",
      let batchID = object["batchId"] as? String, validIdentifier(batchID),
      let sentAt = object["sentAt"] as? String, validTimestamp(sentAt),
      let events = object["events"] as? [[String: Any]], (1...100).contains(events.count)
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    guard Set(events.compactMap { $0["eventId"] as? String }).count == events.count else {
      throw MosaicAnalyticsCodecError.invalidEvent
    }
    for event in events {
      guard let encoded = try? JSONSerialization.data(withJSONObject: event),
        encoded.count <= 32 * 1_024
      else { throw MosaicAnalyticsCodecError.invalidEvent }
      try validateEventObject(event)
    }
    do { return try JSONDecoder().decode(MosaicAnalyticsBatch.self, from: data) } catch {
      throw MosaicAnalyticsCodecError.invalidEvent
    }
  }

  public static func decodeResponse(_ data: Data) throws -> MosaicAnalyticsIngestionResponse {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(object.keys).isSubset(of: [
        "analyticsEventContractVersion", "batchId", "receivedAt", "results",
      ]),
      object["analyticsEventContractVersion"] as? String == "1",
      let batchID = object["batchId"] as? String, validIdentifier(batchID),
      let receivedAt = object["receivedAt"] as? String, validTimestamp(receivedAt),
      let results = object["results"] as? [[String: Any]], (1...100).contains(results.count)
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    let statusKeys: [String: Set<String>] = [
      "accepted": ["eventId", "status"], "duplicate": ["eventId", "status"],
      "permanently_rejected": ["eventId", "status", "code"],
      "retryable": ["eventId", "status", "code", "retryAfterSeconds"],
    ]
    for result in results {
      guard let status = result["status"] as? String, let allowed = statusKeys[status],
        Set(result.keys).isSubset(of: allowed),
        let eventID = result["eventId"] as? String, validIdentifier(eventID)
      else { throw MosaicAnalyticsCodecError.invalidEvent }
      if status == "permanently_rejected" || status == "retryable" {
        let codes = status == "permanently_rejected" ? permanentResultCodes : retryableResultCodes
        guard let code = result["code"] as? String, codes.contains(code) else {
          throw MosaicAnalyticsCodecError.invalidEvent
        }
      }
      if let retryAfter = result["retryAfterSeconds"] {
        guard status == "retryable", let number = retryAfter as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue == Double(number.intValue), (1...300).contains(number.intValue)
        else { throw MosaicAnalyticsCodecError.invalidEvent }
      }
    }
    guard Set(results.compactMap { $0["eventId"] as? String }).count == results.count else {
      throw MosaicAnalyticsCodecError.invalidEvent
    }
    do { return try JSONDecoder().decode(MosaicAnalyticsIngestionResponse.self, from: data) } catch
    { throw MosaicAnalyticsCodecError.invalidEvent }
  }

  public static func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
  }

  private static func validateEventObject(_ object: [String: Any]) throws {
    guard Set(object.keys).isSubset(of: eventKeys) else {
      throw MosaicAnalyticsCodecError.unknownField("event")
    }
    guard object["eventSchemaVersion"] as? String == "1",
      let nameValue = object["eventName"] as? String,
      let name = MosaicAnalyticsEventName(rawValue: nameValue),
      let eventID = object["eventId"] as? String, validIdentifier(eventID),
      let occurredAt = object["occurredAt"] as? String, validTimestamp(occurredAt),
      let queuedAt = object["queuedAt"] as? String, validTimestamp(queuedAt),
      let authority = object["authority"] as? String,
      ["client_observed", "trusted_server", "provider_confirmed"].contains(authority),
      let correlation = object["correlation"] as? [String: Any],
      let attribution = object["attribution"] as? [String: Any],
      let payload = object["payload"] as? [String: Any]
    else { throw MosaicAnalyticsCodecError.unsupportedVersion }
    for (key, allowed) in nestedKeys where object[key] != nil {
      guard let nested = object[key] as? [String: Any], Set(nested.keys).isSubset(of: allowed)
      else {
        throw MosaicAnalyticsCodecError.unknownField(key)
      }
    }
    guard Set(payload.keys).isSubset(of: payloadKeys[name] ?? []) else {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    guard requiredPayloadKeys[name, default: []].isSubset(of: Set(payload.keys)) else {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    guard requiredCorrelationKeys[name, default: []].isSubset(of: Set(correlation.keys)),
      requiredAttributionKeys[name, default: []].isSubset(of: Set(attribution.keys))
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    guard Set(correlation.keys).isSubset(of: correlationKeys[name, default: []]),
      Set(attribution.keys).isSubset(of: attributionKeys[name, default: []])
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    for value in correlation.values {
      guard let identifier = value as? String, validIdentifier(identifier) else {
        throw MosaicAnalyticsCodecError.invalidEvent
      }
    }
    for (key, value) in attribution {
      if key == "placementRuleSetVersion" {
        guard let number = value as? NSNumber, number.doubleValue == Double(number.uint64Value),
          (1...9_007_199_254_740_991).contains(number.uint64Value),
          CFGetTypeID(number) != CFBooleanGetTypeID()
        else { throw MosaicAnalyticsCodecError.invalidEvent }
      } else {
        guard let identifier = value as? String, validIdentifier(identifier) else {
          throw MosaicAnalyticsCodecError.invalidEvent
        }
      }
    }
    let ruleSetIDPresent = attribution["placementRuleSetId"] != nil
    let ruleSetVersionPresent = attribution["placementRuleSetVersion"] != nil
    guard ruleSetIDPresent == ruleSetVersionPresent,
      attribution["winningRuleId"] == nil || ruleSetIDPresent
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    try validatePayload(payload, name: name)
    if name == .purchaseCompletedProvider {
      guard let authority = object["authority"] as? String,
        authority == "trusted_server" || authority == "provider_confirmed",
        correlation["purchaseAttemptId"] != nil || correlation["providerOperationId"] != nil
          || correlation["providerUpdateId"] != nil
      else { throw MosaicAnalyticsCodecError.invalidEvent }
    } else {
      guard object["authority"] as? String == "client_observed", object["identity"] != nil,
        let sessionID = object["sessionId"] as? String, validIdentifier(sessionID),
        object["identity"] is [String: Any], object["context"] is [String: Any]
      else { throw MosaicAnalyticsCodecError.invalidEvent }
    }
    if let identity = object["identity"] as? [String: Any] { try validateIdentity(identity) }
    if let sessionID = object["sessionId"] as? String {
      guard validIdentifier(sessionID) else { throw MosaicAnalyticsCodecError.invalidEvent }
    } else if object["sessionId"] != nil {
      throw MosaicAnalyticsCodecError.invalidEvent
    }
    if let context = object["context"] as? [String: Any] { try validateContext(context) }
  }

  private static func validateIdentity(_ identity: [String: Any]) throws {
    guard let installationID = identity["installationId"] as? String,
      validIdentifier(installationID), let generation = identity["generation"] as? NSNumber,
      CFGetTypeID(generation) != CFBooleanGetTypeID(),
      generation.doubleValue == Double(generation.uint64Value),
      generation.uint64Value <= 9_007_199_254_740_991
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    if let userID = identity["applicationUserId"] {
      guard let value = userID as? String, (1...256).contains(value.utf8.count),
        value.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7F })
      else { throw MosaicAnalyticsCodecError.invalidEvent }
    }
  }

  private static func validateContext(_ context: [String: Any]) throws {
    guard let platform = context["platform"] as? String, ["ios", "android"].contains(platform),
      let family = context["sdkFamily"] as? String,
      ["flutter", "ios", "android"].contains(family),
      let sdkVersion = context["sdkVersion"] as? String,
      validBoundedString(sdkVersion, bytes: 1...64, pattern: "^[A-Za-z0-9][A-Za-z0-9.+_-]*$")
    else { throw MosaicAnalyticsCodecError.invalidEvent }
    if let value = context["operatingSystemVersion"] {
      guard let string = value as? String,
        validBoundedString(string, bytes: 1...64, pattern: "^[A-Za-z0-9][A-Za-z0-9.+_ -]*$")
      else { throw MosaicAnalyticsCodecError.invalidEvent }
    }
    if let value = context["applicationVersion"] {
      guard let string = value as? String,
        validBoundedString(string, bytes: 1...64, pattern: "^[A-Za-z0-9][A-Za-z0-9.+_-]*$")
      else { throw MosaicAnalyticsCodecError.invalidEvent }
    }
    if let value = context["locale"] {
      guard let string = value as? String,
        validBoundedString(
          string, bytes: 2...35, pattern: "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")
      else { throw MosaicAnalyticsCodecError.invalidEvent }
    }
    for key in ["configurationDeliveryVersion", "commerceProviderContractVersion"]
    where context[key] != nil {
      guard let version = context[key] as? String, ["1", "2"].contains(version) else {
        throw MosaicAnalyticsCodecError.invalidEvent
      }
    }
  }

  private static func validatePayload(
    _ payload: [String: Any], name: MosaicAnalyticsEventName
  ) throws {
    func int(_ key: String, _ range: ClosedRange<Int>) -> Bool {
      guard let number = payload[key] as? NSNumber else { return payload[key] == nil }
      let value = number.intValue
      return CFGetTypeID(number) != CFBooleanGetTypeID()
        && number.doubleValue == Double(value) && range.contains(value)
    }
    guard int("durationMs", 0...86_400_000), int("rolloutBucket", 0...9_999),
      int("requestedProductCount", 1...64), int("availableProductCount", 0...64),
      int("unavailableProductCount", 0...64)
    else { throw MosaicAnalyticsCodecError.payloadMismatch }
    if name == .productLoadCompleted,
      let available = (payload["availableProductCount"] as? NSNumber)?.intValue,
      let unavailable = (payload["unavailableProductCount"] as? NSNumber)?.intValue,
      available + unavailable > 64
    {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    for key in ["observedEntitlementKeys", "activeEntitlementKeys", "restoredProductIds"] {
      if let values = payload[key] as? [String] {
        guard values.count <= 64, Set(values).count == values.count,
          values.allSatisfy(validIdentifier)
        else { throw MosaicAnalyticsCodecError.payloadMismatch }
      } else if payload[key] != nil {
        throw MosaicAnalyticsCodecError.payloadMismatch
      }
    }
    let enumValues: [String: Set<String>] = [
      "finalOutcome": name == .placementFallbackUsed
        ? ["paywall", "no_paywall", "unavailable"] : ["paywall", "no_paywall"],
      "assignmentKeyType": ["installation", "identified_user"],
      "source": ["default", "user"],
      "outcome": ["purchased", "already_entitled"],
      "reason": name == .paywallDismissed
        ? ["user", "system", "purchase_completed", "host_application", "unknown"]
        : name == .productUnavailable
          ? [
            "mapping_missing", "mapping_invalid", "product_not_found", "temporarily_unavailable",
            "provider_unavailable", "unsupported_product_type", "metadata_unavailable",
          ]
          : [
            "no_safe_decision", "configuration_incompatible", "content_unavailable",
            "commerce_unavailable",
          ],
      "action": [
        "purchase", "restore", "close", "navigate_to", "navigate_back", "open_external_url",
      ],
      "trigger": [
        "configuration_incompatible", "content_unavailable", "commerce_unavailable",
        "product_unavailable", "product_unknown", "provider_unavailable", "entitlement_unknown",
        "unsafe_rendering",
      ],
      "confirmationSource": [
        "trusted_provider_integration", "trusted_server_endpoint", "accepted_adapter_source",
      ],
    ]
    for (key, allowed) in enumValues where payload[key] != nil {
      guard let value = payload[key] as? String, allowed.contains(value) else {
        throw MosaicAnalyticsCodecError.payloadMismatch
      }
    }
    for key in ["diagnosticCode", "providerResultCode"] where payload[key] != nil {
      guard let value = payload[key] as? String, validSafeCode(value) else {
        throw MosaicAnalyticsCodecError.payloadMismatch
      }
    }
    if let fallbackKey = payload["fallbackKey"] {
      guard let value = fallbackKey as? String,
        validBoundedString(value, bytes: 1...64, pattern: "^[a-z][a-z0-9_]*$")
      else { throw MosaicAnalyticsCodecError.payloadMismatch }
    }
    for key in ["componentId", "linkedClientEventId", "providerId"] where payload[key] != nil {
      guard let value = payload[key] as? String, validIdentifier(value) else {
        throw MosaicAnalyticsCodecError.payloadMismatch
      }
    }
    if let version = payload["decisionContractVersion"] as? String, version != "1" {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    if let algorithm = payload["bucketingAlgorithm"] as? String,
      algorithm != "sha256_length_prefixed_v1"
    {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    if name == .placementPaywallSelected, payload["finalOutcome"] as? String != "paywall" {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    if name == .placementNoPaywall, payload["finalOutcome"] as? String != "no_paywall" {
      throw MosaicAnalyticsCodecError.payloadMismatch
    }
    if name == .placementPaywallSelected || name == .placementNoPaywall {
      let rolloutKeys = ["assignmentKeyType", "bucketingAlgorithm", "rolloutBucket"]
      let presentCount = rolloutKeys.count { payload[$0] != nil }
      guard presentCount == 0 || presentCount == rolloutKeys.count else {
        throw MosaicAnalyticsCodecError.payloadMismatch
      }
    }
  }

  private static func validIdentifier(_ value: String) -> Bool {
    (1...128).contains(value.utf8.count)
      && value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", options: .regularExpression) != nil
  }

  private static func validSafeCode(_ value: String) -> Bool {
    validBoundedString(
      value, bytes: 3...96, pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$")
  }

  private static func validBoundedString(
    _ value: String, bytes: ClosedRange<Int>, pattern: String
  ) -> Bool {
    bytes.contains(value.utf8.count)
      && value.range(of: pattern, options: .regularExpression) != nil
  }

  private static func validTimestamp(_ value: String) -> Bool {
    value.range(
      of:
        "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
      options: .regularExpression) != nil
  }

  private static let payloadKeys: [MosaicAnalyticsEventName: Set<String>] = [
    .placementRequested: ["decisionContractVersion"],
    .placementPaywallSelected: [
      "finalOutcome", "decisionContractVersion", "assignmentKeyType", "bucketingAlgorithm",
      "rolloutBucket",
    ],
    .placementNoPaywall: [
      "finalOutcome", "decisionContractVersion", "assignmentKeyType", "bucketingAlgorithm",
      "rolloutBucket",
    ],
    .placementFallbackUsed: ["trigger", "fallbackKey", "finalOutcome", "diagnosticCode"],
    .placementUnavailable: ["reason", "diagnosticCode"],
    .placementEvaluationFailed: ["diagnosticCode", "retryable"],
    .paywallPresented: [], .paywallDismissed: ["reason"],
    .paywallActionSelected: ["action", "componentId"],
    .paywallRenderFailed: ["diagnosticCode", "retryable"],
    .productLoadStarted: ["requestedProductCount"],
    .productLoadCompleted: ["availableProductCount", "unavailableProductCount", "durationMs"],
    .productLoadFailed: ["requestedProductCount", "durationMs", "diagnosticCode", "retryable"],
    .productUnavailable: ["reason", "diagnosticCode"], .productSelected: ["source"],
    .purchaseStarted: [],
    .purchaseCompletedClient: [
      "outcome", "durationMs", "observedEntitlementKeys", "providerResultCode",
    ],
    .purchaseCompletedProvider: [
      "confirmationSource", "activeEntitlementKeys", "linkedClientEventId",
    ],
    .purchasePending: ["durationMs", "providerResultCode"],
    .purchaseDeferred: ["durationMs", "providerResultCode"],
    .purchaseCancelled: ["durationMs", "providerResultCode"],
    .purchaseFailed: ["durationMs", "diagnosticCode", "retryable"],
    .restoreStarted: ["providerId"],
    .restoreCompleted: [
      "providerId", "durationMs", "restoredProductIds", "observedEntitlementKeys",
    ],
    .restoreNothingFound: ["providerId", "durationMs", "providerResultCode"],
    .restoreCancelled: ["providerId", "durationMs", "providerResultCode"],
    .restoreFailed: ["providerId", "durationMs", "diagnosticCode", "retryable"],
  ]

  private static let requiredPayloadKeys: [MosaicAnalyticsEventName: Set<String>] = [
    .placementRequested: ["decisionContractVersion"],
    .placementPaywallSelected: ["finalOutcome", "decisionContractVersion"],
    .placementNoPaywall: ["finalOutcome", "decisionContractVersion"],
    .placementFallbackUsed: ["trigger", "fallbackKey", "finalOutcome"],
    .placementUnavailable: ["reason"],
    .placementEvaluationFailed: ["diagnosticCode", "retryable"],
    .paywallDismissed: ["reason"], .paywallActionSelected: ["action"],
    .paywallRenderFailed: ["diagnosticCode", "retryable"],
    .productLoadStarted: ["requestedProductCount"],
    .productLoadCompleted: ["availableProductCount", "unavailableProductCount", "durationMs"],
    .productLoadFailed: ["requestedProductCount", "durationMs", "diagnosticCode", "retryable"],
    .productUnavailable: ["reason"], .productSelected: ["source"],
    .purchaseCompletedClient: ["outcome", "durationMs", "observedEntitlementKeys"],
    .purchaseCompletedProvider: ["confirmationSource", "activeEntitlementKeys"],
    .purchasePending: ["durationMs"], .purchaseDeferred: ["durationMs"],
    .purchaseCancelled: ["durationMs"],
    .purchaseFailed: ["durationMs", "diagnosticCode", "retryable"],
    .restoreStarted: ["providerId"],
    .restoreCompleted: [
      "providerId", "durationMs", "restoredProductIds", "observedEntitlementKeys",
    ],
    .restoreNothingFound: ["providerId", "durationMs"],
    .restoreCancelled: ["providerId", "durationMs"],
    .restoreFailed: ["providerId", "durationMs", "diagnosticCode", "retryable"],
  ]

  private static let requiredCorrelationKeys: [MosaicAnalyticsEventName: Set<String>] = [
    .placementRequested: ["placementRequestId"],
    .placementPaywallSelected: ["placementRequestId"],
    .placementNoPaywall: ["placementRequestId"],
    .placementFallbackUsed: ["placementRequestId"],
    .placementUnavailable: ["placementRequestId"],
    .placementEvaluationFailed: ["placementRequestId"],
    .paywallPresented: ["paywallPresentationId"],
    .paywallDismissed: ["paywallPresentationId"],
    .paywallActionSelected: ["paywallPresentationId"],
    .productLoadStarted: ["productLoadAttemptId", "paywallPresentationId"],
    .productLoadCompleted: ["productLoadAttemptId"],
    .productLoadFailed: ["productLoadAttemptId"],
    .productUnavailable: ["productLoadAttemptId"],
    .productSelected: ["paywallPresentationId"],
    .purchaseStarted: ["purchaseAttemptId"],
    .purchaseCompletedClient: ["purchaseAttemptId"],
    .purchasePending: ["purchaseAttemptId"], .purchaseDeferred: ["purchaseAttemptId"],
    .purchaseCancelled: ["purchaseAttemptId"], .purchaseFailed: ["purchaseAttemptId"],
    .restoreStarted: ["restoreAttemptId"], .restoreCompleted: ["restoreAttemptId"],
    .restoreNothingFound: ["restoreAttemptId"], .restoreCancelled: ["restoreAttemptId"],
    .restoreFailed: ["restoreAttemptId"],
  ]

  private static let requiredAttributionKeys: [MosaicAnalyticsEventName: Set<String>] = [
    .placementRequested: ["placementId"],
    .placementPaywallSelected: ["placementId", "paywallId", "paywallVersionId"],
    .placementNoPaywall: ["placementId"], .placementFallbackUsed: ["placementId"],
    .placementUnavailable: ["placementId"], .placementEvaluationFailed: ["placementId"],
    .paywallPresented: ["paywallId", "paywallVersionId"],
    .productUnavailable: ["mosaicProductId"],
    .productSelected: ["paywallId", "paywallVersionId", "mosaicProductId"],
    .purchaseStarted: ["mosaicProductId", "providerId"],
    .purchaseCompletedClient: ["mosaicProductId", "providerId"],
    .purchaseCompletedProvider: ["mosaicProductId", "providerId"],
    .purchasePending: ["mosaicProductId", "providerId"],
    .purchaseDeferred: ["mosaicProductId", "providerId"],
    .purchaseCancelled: ["mosaicProductId", "providerId"],
    .purchaseFailed: ["mosaicProductId", "providerId"],
  ]

  private static let placementCorrelation: Set<String> = ["placementRequestId"]
  private static let paywallCorrelation: Set<String> = [
    "placementRequestId", "paywallPresentationId",
  ]
  private static let productCorrelation: Set<String> = [
    "placementRequestId", "paywallPresentationId", "productLoadAttemptId",
  ]
  private static let purchaseCorrelation: Set<String> = [
    "placementRequestId", "paywallPresentationId", "productLoadAttemptId", "purchaseAttemptId",
    "providerOperationId",
  ]
  private static let restoreCorrelation: Set<String> = ["restoreAttemptId", "providerOperationId"]

  private static let correlationKeys: [MosaicAnalyticsEventName: Set<String>] = [
    .placementRequested: placementCorrelation, .placementPaywallSelected: placementCorrelation,
    .placementNoPaywall: placementCorrelation, .placementFallbackUsed: placementCorrelation,
    .placementUnavailable: placementCorrelation, .placementEvaluationFailed: placementCorrelation,
    .paywallPresented: paywallCorrelation, .paywallDismissed: paywallCorrelation,
    .paywallActionSelected: paywallCorrelation, .paywallRenderFailed: paywallCorrelation,
    .productLoadStarted: productCorrelation, .productLoadCompleted: productCorrelation,
    .productLoadFailed: productCorrelation, .productUnavailable: productCorrelation,
    .productSelected: productCorrelation, .purchaseStarted: purchaseCorrelation,
    .purchaseCompletedClient: purchaseCorrelation,
    .purchaseCompletedProvider: ["purchaseAttemptId", "providerOperationId", "providerUpdateId"],
    .purchasePending: purchaseCorrelation, .purchaseDeferred: purchaseCorrelation,
    .purchaseCancelled: purchaseCorrelation, .purchaseFailed: purchaseCorrelation,
    .restoreStarted: restoreCorrelation, .restoreCompleted: restoreCorrelation,
    .restoreNothingFound: restoreCorrelation, .restoreCancelled: restoreCorrelation,
    .restoreFailed: restoreCorrelation,
  ]

  private static let placementAttribution: Set<String> = [
    "configurationReleaseId", "placementId", "placementRuleSetId", "placementRuleSetVersion",
    "winningRuleId",
  ]
  private static let paywallAttribution = placementAttribution.union([
    "paywallId", "paywallVersionId",
  ])
  private static let productAttribution = paywallAttribution.union([
    "mosaicProductId", "planId", "providerId", "providerProductMappingId",
  ])

  private static let attributionKeys: [MosaicAnalyticsEventName: Set<String>] = [
    .placementRequested: placementAttribution.subtracting(["winningRuleId"]),
    .placementPaywallSelected: paywallAttribution, .placementNoPaywall: placementAttribution,
    .placementFallbackUsed: paywallAttribution, .placementUnavailable: placementAttribution,
    .placementEvaluationFailed: placementAttribution.subtracting(["winningRuleId"]),
    .paywallPresented: paywallAttribution, .paywallDismissed: paywallAttribution,
    .paywallActionSelected: paywallAttribution, .paywallRenderFailed: paywallAttribution,
    .productLoadStarted: paywallAttribution, .productLoadCompleted: paywallAttribution,
    .productLoadFailed: paywallAttribution, .productUnavailable: productAttribution,
    .productSelected: productAttribution, .purchaseStarted: productAttribution,
    .purchaseCompletedClient: productAttribution, .purchaseCompletedProvider: productAttribution,
    .purchasePending: productAttribution, .purchaseDeferred: productAttribution,
    .purchaseCancelled: productAttribution, .purchaseFailed: productAttribution,
    .restoreStarted: ["configurationReleaseId"], .restoreCompleted: ["configurationReleaseId"],
    .restoreNothingFound: ["configurationReleaseId"],
    .restoreCancelled: ["configurationReleaseId"], .restoreFailed: ["configurationReleaseId"],
  ]

  private static let permanentResultCodes: Set<String> = [
    "event_schema_invalid", "unsupported_event_schema", "unsupported_event_name", "unknown_field",
    "invalid_identifier", "invalid_timestamp", "occurred_at_too_far_future", "event_expired",
    "event_too_large", "batch_event_limit_exceeded", "duplicate_event_id_in_batch",
    "authority_not_allowed", "tenant_field_forbidden", "attribution_not_found",
    "attribution_scope_mismatch", "event_id_conflict", "sensitive_value_rejected",
  ]
  private static let retryableResultCodes: Set<String> = [
    "rate_limited", "storage_temporarily_unavailable", "service_temporarily_unavailable",
    "ingestion_timeout",
  ]
}
