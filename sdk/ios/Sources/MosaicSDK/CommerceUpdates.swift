import Foundation

public struct MosaicCommerceConfigurationReference: Sendable, Equatable, Codable {
  public let configurationID: String
  public let configurationRevision: String

  public init(configurationID: String, configurationRevision: String) {
    self.configurationID = configurationID
    self.configurationRevision = configurationRevision
  }
}

public enum MosaicCommerceUpdateOutcome: String, Sendable, Equatable, Codable {
  case purchased
  case pending
  case cancelled
  case providerUnavailable
  case failed
  case entitlementsChanged
}

public struct MosaicCommerceUpdate: Sendable, Equatable {
  public let id: String
  public let operationID: String?
  public let providerID: String
  public let mosaicProductID: String
  public let configuration: MosaicCommerceConfigurationReference
  public let outcome: MosaicCommerceUpdateOutcome
  public let transactionReference: String?
  public let activeEntitlementKeys: Set<String>
  public let occurredAt: Date
  public let diagnostics: [MosaicCommerceDiagnostic]

  public init(
    id: String,
    operationID: String? = nil,
    providerID: String,
    mosaicProductID: String,
    configuration: MosaicCommerceConfigurationReference,
    outcome: MosaicCommerceUpdateOutcome,
    transactionReference: String? = nil,
    activeEntitlementKeys: Set<String> = [],
    occurredAt: Date,
    diagnostics: [MosaicCommerceDiagnostic] = []
  ) {
    self.id = id
    self.operationID = operationID
    self.providerID = providerID
    self.mosaicProductID = mosaicProductID
    self.configuration = configuration
    self.outcome = outcome
    self.transactionReference = transactionReference
    self.activeEntitlementKeys = activeEntitlementKeys
    self.occurredAt = occurredAt
    self.diagnostics = diagnostics
  }
}

public enum MosaicCommerceUpdateAcceptanceDisposition:
  String, Sendable, Equatable, Codable
{
  case accepted
  case alreadyAccepted
  case rejectedStaleConfiguration
  case deliveryFailed

  public var authorizesFinalization: Bool {
    switch self {
    case .accepted, .alreadyAccepted:
      true
    case .rejectedStaleConfiguration, .deliveryFailed:
      false
    }
  }
}

/// The host-visible, idempotent local-delivery boundary. Only `accepted` and
/// `alreadyAccepted` authorize durable adapter acceptance and native
/// finalization.
public protocol MosaicCommerceUpdateAcceptor: Sendable {
  func accept(
    _ update: MosaicCommerceUpdate
  ) async throws -> MosaicCommerceUpdateAcceptanceDisposition
}

public protocol MosaicAsynchronousCommerceProvider: MosaicCommerceProvider {
  var commerceUpdates: AsyncStream<MosaicCommerceUpdate> { get async }

  func install(
    configuration: MosaicCommerceConfigurationReference,
    mappings: [MosaicCommerceProductMapping]
  ) async throws
}
