import Foundation

public let mosaicLocalPreviewProtocolVersion = "0.2"
public let mosaicLocalPreviewWebSocketProtocol = "mosaic.local-preview.v0.2"
public let mosaicLatestLocalPreviewProtocolVersion = mosaicLocalPreviewProtocolVersion
public let mosaicSupportedLocalPreviewProtocolVersions = [mosaicLocalPreviewProtocolVersion]
public let mosaicLocalPreviewMaximumFrameBytes = 2 * 1_024 * 1_024
public let mosaicIOSPreviewMaximumDocumentBytes = 1_024 * 1_024

public enum MosaicPreviewCapabilityName: String, CaseIterable, Sendable {
  case liveUpdate = "preview.liveUpdate"
  case mockCommerce = "preview.mockCommerce"
  case localeOverride = "preview.localeOverride"
  case textScale = "preview.textScale"
  case diagnostics = "preview.diagnostics"
}

public struct MosaicPreviewSoftwareIdentity: Sendable, Equatable {
  public let id: String
  public let version: String

  public init(id: String, version: String) {
    self.id = id
    self.version = version
  }
}

public struct MosaicPreviewApplicationIdentity: Sendable, Equatable {
  public let id: String
  public let displayName: String
  public let version: String

  public init(id: String, displayName: String, version: String) {
    self.id = id
    self.displayName = displayName
    self.version = version
  }
}

public struct MosaicPreviewDeviceIdentity: Sendable, Equatable {
  public let displayName: String
  public let systemName: String
  public let systemVersion: String

  public init(displayName: String, systemName: String, systemVersion: String) {
    self.displayName = displayName
    self.systemName = systemName
    self.systemVersion = systemVersion
  }
}

public struct MosaicPreviewClientIdentity: Sendable, Equatable {
  public let clientId: String
  public let displayName: String
  public let renderer: MosaicPreviewSoftwareIdentity
  public let application: MosaicPreviewApplicationIdentity
  public let device: MosaicPreviewDeviceIdentity

  public init(
    clientId: String,
    displayName: String,
    renderer: MosaicPreviewSoftwareIdentity,
    application: MosaicPreviewApplicationIdentity,
    device: MosaicPreviewDeviceIdentity
  ) {
    self.clientId = clientId
    self.displayName = displayName
    self.renderer = renderer
    self.application = application
    self.device = device
  }
}

public struct MosaicLocalRevision: Sendable, Equatable, Hashable {
  public let revisionId: String
  public let sequence: Int

  public init(revisionId: String, sequence: Int) {
    self.revisionId = revisionId
    self.sequence = sequence
  }
}

public struct MosaicPreviewContext: Sendable, Equatable {
  public let locale: String
  public let textScale: Double

  public init(locale: String, textScale: Double) {
    self.locale = locale
    self.textScale = textScale
  }
}

public struct MosaicPreviewSupportedCapability: Sendable, Equatable, Hashable {
  public let name: String
  public let version: String

  public init(name: String, version: String) {
    self.name = name
    self.version = version
  }
}

public struct MosaicPreviewCapability: Sendable, Equatable, Hashable {
  public let name: MosaicPreviewCapabilityName
  public let version: String

  public init(
    name: MosaicPreviewCapabilityName, version: String = mosaicLocalPreviewProtocolVersion
  ) {
    self.name = name
    self.version = version
  }
}

public struct MosaicPreviewCapabilityReport: Sendable, Equatable {
  public let clientId: String
  public let supportedSchemaVersions: [String]
  public let supportedCapabilities: [MosaicPreviewSupportedCapability]
  public let previewCapabilities: [MosaicPreviewCapability]
  public let maxDocumentBytes: Int

  public init(
    clientId: String,
    supportedSchemaVersions: [String] = [mosaicProtocolVersion],
    supportedCapabilities: [MosaicPreviewSupportedCapability] =
      MosaicCapabilityName.allCases.map {
        MosaicPreviewSupportedCapability(name: $0.rawValue, version: mosaicProtocolVersion)
      },
    previewCapabilities: [MosaicPreviewCapability] =
      MosaicPreviewCapabilityName.allCases.map { MosaicPreviewCapability(name: $0) },
    maxDocumentBytes: Int = mosaicIOSPreviewMaximumDocumentBytes
  ) {
    self.clientId = clientId
    self.supportedSchemaVersions = supportedSchemaVersions
    self.supportedCapabilities = supportedCapabilities
    self.previewCapabilities = previewCapabilities
    self.maxDocumentBytes = maxDocumentBytes
  }

  public static func v02(
    clientId: String,
    maxDocumentBytes: Int = mosaicIOSPreviewMaximumDocumentBytes
  ) -> MosaicPreviewCapabilityReport {
    MosaicPreviewCapabilityReport(
      clientId: clientId,
      supportedSchemaVersions: mosaicSupportedProtocolVersions,
      supportedCapabilities: MosaicCapabilityCatalog.v02.map {
        MosaicPreviewSupportedCapability(name: $0.rawValue, version: mosaicProtocolVersion)
      },
      previewCapabilities: MosaicPreviewCapabilityName.allCases.map {
        MosaicPreviewCapability(name: $0, version: mosaicLocalPreviewProtocolVersion)
      },
      maxDocumentBytes: maxDocumentBytes
    )
  }
}

public enum MosaicPreviewPeriodUnit: String, Sendable, CaseIterable {
  case day
  case week
  case month
  case year
}

public struct MosaicPreviewPeriod: Sendable, Equatable {
  public let unit: MosaicPreviewPeriodUnit
  public let value: Int

  public init(unit: MosaicPreviewPeriodUnit, value: Int) {
    self.unit = unit
    self.value = value
  }

  public var displayValue: String {
    value == 1 ? unit.rawValue : "\(unit.rawValue)s"
  }
}

public struct MosaicPreviewIntroductoryOffer: Sendable, Equatable {
  public let localizedPrice: String
  public let period: MosaicPreviewPeriod
  public let cycles: Int

  public init(localizedPrice: String, period: MosaicPreviewPeriod, cycles: Int) {
    self.localizedPrice = localizedPrice
    self.period = period
    self.cycles = cycles
  }
}

public enum MosaicPreviewUnavailableReason: String, Sendable, CaseIterable {
  case notConfigured
  case temporarilyUnavailable
  case unsupported
}

public enum MosaicPreviewMockProduct: Sendable, Equatable {
  case subscription(
    productReferenceId: String,
    localizedPrice: String,
    currencyCode: String,
    billingPeriod: MosaicPreviewPeriod,
    trialPeriod: MosaicPreviewPeriod?,
    introductoryOffer: MosaicPreviewIntroductoryOffer?
  )
  case nonConsumable(
    productReferenceId: String,
    localizedPrice: String,
    currencyCode: String
  )
  case unavailable(productReferenceId: String, reason: MosaicPreviewUnavailableReason)

  public var productReferenceId: String {
    switch self {
    case .subscription(let id, _, _, _, _, _), .nonConsumable(let id, _, _),
      .unavailable(let id, _):
      id
    }
  }

  public var isAvailable: Bool {
    switch self {
    case .subscription, .nonConsumable: true
    case .unavailable: false
    }
  }

  public var localizedPrice: String? {
    switch self {
    case .subscription(_, let price, _, _, _, _), .nonConsumable(_, let price, _): price
    case .unavailable: nil
    }
  }
}

public enum MosaicPreviewPurchaseOutcome: String, Sendable, CaseIterable {
  case purchased
  case alreadyEntitled
  case cancelled
  case purchaseFailed
}

public enum MosaicPreviewRestoreOutcome: String, Sendable, CaseIterable {
  case restored
  case alreadyEntitled
  case restoreNoPurchases
  case restoreFailed
}

public enum MosaicPreviewMockEntitlement: Sendable, Equatable {
  case none
  case active(productReferenceId: String)

  public var productReferenceId: String? {
    if case .active(let productReferenceId) = self { return productReferenceId }
    return nil
  }
}

public struct MosaicPreviewMockCommerceState: Sendable, Equatable {
  public let products: [MosaicPreviewMockProduct]
  public let purchaseOutcome: MosaicPreviewPurchaseOutcome
  public let restoreOutcome: MosaicPreviewRestoreOutcome
  public let entitlement: MosaicPreviewMockEntitlement

  public init(
    products: [MosaicPreviewMockProduct],
    purchaseOutcome: MosaicPreviewPurchaseOutcome,
    restoreOutcome: MosaicPreviewRestoreOutcome,
    entitlement: MosaicPreviewMockEntitlement
  ) {
    self.products = products
    self.purchaseOutcome = purchaseOutcome
    self.restoreOutcome = restoreOutcome
    self.entitlement = entitlement
  }
}

public struct MosaicPreviewDiagnosticLocation: Sendable, Equatable {
  public let documentPath: String
  public let componentId: String?
  public let property: String?

  public init(documentPath: String, componentId: String? = nil, property: String? = nil) {
    self.documentPath = documentPath
    self.componentId = componentId
    self.property = property
  }
}

public enum MosaicPreviewRecoveryAction: String, Sendable, CaseIterable {
  case editProperty
  case removeComponent
  case bindProduct
  case selectSupportedTemplate
  case updatePreviewClient
  case restoreLastValidDraft
  case retry
  case reconnect
  case inspectComponent
}

public struct MosaicPreviewRecovery: Sendable, Equatable {
  public let action: MosaicPreviewRecoveryAction
  public let message: String

  public init(action: MosaicPreviewRecoveryAction, message: String) {
    self.action = action
    self.message = message
  }
}

public struct MosaicPreviewValidationDiagnostic: Sendable, Equatable {
  public let code: String
  public let message: String
  public let location: MosaicPreviewDiagnosticLocation
  public let recovery: MosaicPreviewRecovery

  public init(
    code: String,
    message: String,
    location: MosaicPreviewDiagnosticLocation,
    recovery: MosaicPreviewRecovery
  ) {
    self.code = code
    self.message = message
    self.location = location
    self.recovery = recovery
  }
}

public enum MosaicPreviewCompatibilitySeverity: String, Sendable, CaseIterable {
  case warning
  case blocking
}

public enum MosaicPreviewCompatibilityFallback: String, Sendable, CaseIterable {
  case keepLastAcceptedDraft
  case useDeclaredAssetFallback
  case useSelectorFallback
  case nativeApproximation
}

public struct MosaicPreviewCompatibilityWarning: Sendable, Equatable {
  public let code: String
  public let severity: MosaicPreviewCompatibilitySeverity
  public let message: String
  public let location: MosaicPreviewDiagnosticLocation?
  public let capability: MosaicPreviewSupportedCapability?
  public let fallback: MosaicPreviewCompatibilityFallback
  public let recovery: MosaicPreviewRecovery

  public init(
    code: String,
    severity: MosaicPreviewCompatibilitySeverity,
    message: String,
    location: MosaicPreviewDiagnosticLocation? = nil,
    capability: MosaicPreviewSupportedCapability? = nil,
    fallback: MosaicPreviewCompatibilityFallback,
    recovery: MosaicPreviewRecovery
  ) {
    self.code = code
    self.severity = severity
    self.message = message
    self.location = location
    self.capability = capability
    self.fallback = fallback
    self.recovery = recovery
  }
}

public struct MosaicPreviewRenderDiagnostic: Sendable, Equatable {
  public let code: String
  public let message: String
  public let location: MosaicPreviewDiagnosticLocation?
  public let recovery: MosaicPreviewRecovery

  public init(
    code: String,
    message: String,
    location: MosaicPreviewDiagnosticLocation? = nil,
    recovery: MosaicPreviewRecovery
  ) {
    self.code = code
    self.message = message
    self.location = location
    self.recovery = recovery
  }
}

public enum MosaicPreviewDisconnectReason: String, Sendable, CaseIterable {
  case closed
  case timeout
  case transportError
  case replaced
  case sessionEnded
}

public enum MosaicPreviewHeartbeatKind: String, Sendable {
  case ping
  case pong
}

public struct MosaicPreviewDraftUpdate: Sendable, Equatable {
  public let editableDocumentId: String
  public let revision: MosaicLocalRevision
  public let documentData: Data
  public let preview: MosaicPreviewContext

  public init(
    editableDocumentId: String,
    revision: MosaicLocalRevision,
    documentData: Data,
    preview: MosaicPreviewContext
  ) {
    self.editableDocumentId = editableDocumentId
    self.revision = revision
    self.documentData = documentData
    self.preview = preview
  }
}

public struct MosaicPreviewCommerceUpdate: Sendable, Equatable {
  public let editableDocumentId: String
  public let stateRevision: MosaicLocalRevision
  public let state: MosaicPreviewMockCommerceState

  public init(
    editableDocumentId: String,
    stateRevision: MosaicLocalRevision,
    state: MosaicPreviewMockCommerceState
  ) {
    self.editableDocumentId = editableDocumentId
    self.stateRevision = stateRevision
    self.state = state
  }
}

public enum MosaicPreviewIncomingMessage: Sendable, Equatable {
  case draftUpdated(MosaicPreviewDraftUpdate)
  case mockCommerceStateChanged(MosaicPreviewCommerceUpdate)
  case heartbeat(clientId: String, kind: MosaicPreviewHeartbeatKind, sequence: Int)
  case previewClientDisconnected(
    clientId: String,
    reason: MosaicPreviewDisconnectReason,
    diagnostic: String?
  )
  case validatedOther(type: String)
}

public struct MosaicPreviewDecodedMessage: Sendable, Equatable {
  public let messageId: String
  public let sessionId: String
  public let sentAt: String
  public let message: MosaicPreviewIncomingMessage

  public init(
    messageId: String,
    sessionId: String,
    sentAt: String,
    message: MosaicPreviewIncomingMessage
  ) {
    self.messageId = messageId
    self.sessionId = sessionId
    self.sentAt = sentAt
    self.message = message
  }
}

public enum MosaicPreviewDraftRejectionReason: String, Sendable {
  case staleRevision
  case revisionConflict
  case validationFailed
  case unsupportedSchemaVersion
  case unsupportedCapability
  case documentTooLarge
  case renderFailed
}

public enum MosaicPreviewOutgoingMessage: Sendable, Equatable {
  case previewClientConnected(MosaicPreviewClientIdentity)
  case previewClientDisconnected(
    clientId: String,
    reason: MosaicPreviewDisconnectReason,
    diagnostic: String?
  )
  case capabilityReport(MosaicPreviewCapabilityReport)
  case draftAccepted(
    clientId: String,
    editableDocumentId: String,
    revision: MosaicLocalRevision
  )
  case draftRejected(
    clientId: String,
    editableDocumentId: String,
    revision: MosaicLocalRevision,
    reason: MosaicPreviewDraftRejectionReason,
    diagnostics: [MosaicPreviewValidationDiagnostic]
  )
  case validationError(
    clientId: String,
    editableDocumentId: String,
    revision: MosaicLocalRevision,
    errors: [MosaicPreviewValidationDiagnostic]
  )
  case renderWarning(
    clientId: String,
    editableDocumentId: String,
    revision: MosaicLocalRevision,
    warnings: [MosaicPreviewCompatibilityWarning]
  )
  case renderFailure(
    clientId: String,
    editableDocumentId: String,
    revision: MosaicLocalRevision,
    failure: MosaicPreviewRenderDiagnostic
  )
  case heartbeat(clientId: String, kind: MosaicPreviewHeartbeatKind, sequence: Int)
}

public enum MosaicPreviewProtocolError: Error, Sendable, Equatable {
  case frameTooLarge
  case invalidJSON
  case invalidEnvelope
  case unsupportedVersion
  case wrongSession
  case unsupportedMessageType
  case invalidPayload
  case unsafeDiagnostic
}
