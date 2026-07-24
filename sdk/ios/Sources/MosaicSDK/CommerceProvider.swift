import Foundation

public let mosaicCommerceProviderContractVersion = "1"
public let mosaicCommerceConfigurationVersion = "1"
public let mosaicSupportedCommerceProviderContractVersions = ["2", "1"]
public let mosaicSupportedCommerceConfigurationVersions = ["2", "1"]

public enum MosaicCommercePeriodUnit: String, Sendable, Equatable, CaseIterable {
  case day
  case week
  case month
  case year
}

public struct MosaicCommercePeriod: Sendable, Equatable {
  public let unit: MosaicCommercePeriodUnit
  public let value: Int

  public init(unit: MosaicCommercePeriodUnit, value: Int) {
    self.unit = unit
    self.value = value
  }
}

public enum MosaicCommerceOfferEligibility: String, Sendable, Equatable {
  case eligible
  case ineligible
  case unknown
}

public struct MosaicCommerceTrial: Sendable, Equatable {
  public let period: MosaicCommercePeriod
  public let eligibility: MosaicCommerceOfferEligibility?

  public init(
    period: MosaicCommercePeriod,
    eligibility: MosaicCommerceOfferEligibility? = nil
  ) {
    self.period = period
    self.eligibility = eligibility
  }
}

public enum MosaicCommerceIntroductoryPaymentMode: String, Sendable, Equatable {
  case payAsYouGo
  case payUpFront
}

public struct MosaicCommerceIntroductoryOffer: Sendable, Equatable {
  public let localizedPrice: String
  public let period: MosaicCommercePeriod
  public let cycles: Int
  public let paymentMode: MosaicCommerceIntroductoryPaymentMode
  public let eligibility: MosaicCommerceOfferEligibility?

  public init(
    localizedPrice: String,
    period: MosaicCommercePeriod,
    cycles: Int,
    paymentMode: MosaicCommerceIntroductoryPaymentMode,
    eligibility: MosaicCommerceOfferEligibility? = nil
  ) {
    self.localizedPrice = localizedPrice
    self.period = period
    self.cycles = cycles
    self.paymentMode = paymentMode
    self.eligibility = eligibility
  }
}

public struct MosaicCommerceProviderIdentity: Sendable, Equatable {
  public let id: String
  public let displayName: String
  public let adapterVersion: String

  public init(id: String, displayName: String, adapterVersion: String) {
    self.id = id
    self.displayName = displayName
    self.adapterVersion = adapterVersion
  }
}

public enum MosaicCommerceCapabilityName: String, Sendable, Equatable, CaseIterable {
  case productLoading
  case subscriptions
  case oneTimeNonConsumables
  case trials
  case introductoryOffers
  case promotionalOffers
  case restore
  case activeEntitlementLookup
  case pendingPurchases
  case deferredPurchases
  case serverConfirmedTransactions
  case productSynchronization
  case providerDiagnostics
  case basePlans
  case explicitOffers
  case storeSynchronization
  case activePurchaseRecovery
  case asynchronousCommerceUpdates
  case localDeliveryAcceptance
}

public enum MosaicCommerceCapabilitySupport: String, Sendable, Equatable {
  case supported
  case unsupported
  case conditional
}

public struct MosaicCommerceCapability: Sendable, Equatable {
  public let name: MosaicCommerceCapabilityName
  public let support: MosaicCommerceCapabilitySupport
  public let reasonCode: String?

  public init(
    name: MosaicCommerceCapabilityName,
    support: MosaicCommerceCapabilitySupport,
    reasonCode: String? = nil
  ) {
    self.name = name
    self.support = support
    self.reasonCode = reasonCode
  }
}

public enum MosaicCommerceDiagnosticSeverity: String, Sendable, Equatable {
  case info
  case warning
  case error
}

public enum MosaicCommerceRecoveryAction: String, Sendable, Equatable {
  case retry
  case reconnectProvider
  case fixProductMapping
  case updateProviderConfiguration
  case contactProvider
  case none
}

/// A bounded, application-safe diagnostic. Raw provider errors, payloads,
/// credentials, customer identifiers, and receipt data are never represented.
public struct MosaicCommerceDiagnostic: Sendable, Equatable {
  public let code: String
  public let safeMessage: String
  public let severity: MosaicCommerceDiagnosticSeverity
  public let retryable: Bool
  public let retryAfterSeconds: Int?
  public let correlationID: String
  public let providerCode: String?
  public let mosaicProductID: String?
  public let recoveryAction: MosaicCommerceRecoveryAction?

  public init(
    code: String,
    safeMessage: String,
    severity: MosaicCommerceDiagnosticSeverity,
    retryable: Bool,
    retryAfterSeconds: Int? = nil,
    correlationID: String,
    providerCode: String? = nil,
    mosaicProductID: String? = nil,
    recoveryAction: MosaicCommerceRecoveryAction? = nil
  ) {
    self.code = code
    self.safeMessage = safeMessage
    self.severity = severity
    self.retryable = retryable
    self.retryAfterSeconds = retryAfterSeconds
    self.correlationID = correlationID
    self.providerCode = providerCode
    self.mosaicProductID = mosaicProductID
    self.recoveryAction = recoveryAction
  }
}

public enum MosaicCommerceProductAvailabilityStatus: String, Sendable, Equatable {
  case available
  case unavailable
  case unknown
}

public enum MosaicCommerceProductAvailabilityReason: String, Sendable, Equatable {
  case mappingMissing
  case mappingInvalid
  case productNotFound
  case temporarilyUnavailable
  case providerUnavailable
  case unsupportedProductType
  case metadataUnavailable
}

public struct MosaicCommerceProductAvailability: Sendable, Equatable {
  public let status: MosaicCommerceProductAvailabilityStatus
  public let reason: MosaicCommerceProductAvailabilityReason?

  public init(
    status: MosaicCommerceProductAvailabilityStatus,
    reason: MosaicCommerceProductAvailabilityReason? = nil
  ) {
    self.status = status
    self.reason = reason
  }
}

public struct MosaicCommerceResolvedProduct: Sendable, Equatable {
  public let mosaicProductID: String
  public let product: MosaicProduct?
  public let availability: MosaicCommerceProductAvailability
  public let diagnostics: [MosaicCommerceDiagnostic]

  public init(
    mosaicProductID: String,
    product: MosaicProduct?,
    availability: MosaicCommerceProductAvailability,
    diagnostics: [MosaicCommerceDiagnostic] = []
  ) {
    self.mosaicProductID = mosaicProductID
    self.product = product
    self.availability = availability
    self.diagnostics = diagnostics
  }
}

public enum MosaicCommerceProviderHealth: String, Sendable, Equatable {
  case healthy
  case degraded
  case unavailable
  case unknown
}

public struct MosaicCommerceProviderDiagnostics: Sendable, Equatable {
  public let providerID: String
  public let health: MosaicCommerceProviderHealth
  public let diagnostics: [MosaicCommerceDiagnostic]

  public init(
    providerID: String,
    health: MosaicCommerceProviderHealth,
    diagnostics: [MosaicCommerceDiagnostic]
  ) {
    self.providerID = providerID
    self.health = health
    self.diagnostics = diagnostics
  }
}

public enum MosaicCommerceRecoveryOutcome: String, Sendable, Equatable {
  case restored
  case nothingToRestore
  case cancelled
  case providerUnavailable
  case failed
}

public struct MosaicCommerceRecoveryResult: Sendable, Equatable {
  public let operationID: String
  public let providerID: String
  public let outcome: MosaicCommerceRecoveryOutcome
  public let recoveryMode: MosaicCommerceRecoveryMode
  public let activeEntitlements: Set<MosaicEntitlement>
  public let completedAt: Date
  public let diagnostics: [MosaicCommerceDiagnostic]

  public init(
    operationID: String,
    providerID: String,
    outcome: MosaicCommerceRecoveryOutcome,
    recoveryMode: MosaicCommerceRecoveryMode,
    activeEntitlements: Set<MosaicEntitlement> = [],
    completedAt: Date,
    diagnostics: [MosaicCommerceDiagnostic] = []
  ) {
    self.operationID = operationID
    self.providerID = providerID
    self.outcome = outcome
    self.recoveryMode = recoveryMode
    self.activeEntitlements = activeEntitlements
    self.completedAt = completedAt
    self.diagnostics = diagnostics
  }

  public var restoreResult: MosaicRestoreResult {
    switch outcome {
    case .restored:
      .restored(activeEntitlements)
    case .nothingToRestore:
      .nothingToRestore
    case .cancelled:
      .cancelled
    case .providerUnavailable:
      failureResult(providerUnavailable: true)
    case .failed:
      failureResult(providerUnavailable: false)
    }
  }

  private func failureResult(providerUnavailable: Bool) -> MosaicRestoreResult {
    let diagnostic =
      diagnostics.first(where: { $0.severity == .error })
      ?? MosaicCommerceDiagnostic(
        code: providerUnavailable
          ? "commerce.providerUnavailable" : "commerce.restoreFailed",
        safeMessage: providerUnavailable
          ? "The commerce provider is unavailable for restore."
          : "The commerce provider could not restore purchases.",
        severity: .error,
        retryable: true,
        correlationID: operationID,
        recoveryAction: .retry
      )
    return providerUnavailable
      ? .providerUnavailable(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
      : .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
  }
}

public protocol MosaicCommerceRecoveryProvider: MosaicCommerceProvider {
  func recover(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicCommerceRecoveryResult
}

/// The provider-neutral boundary for RevenueCat and app-owned SDK-local
/// commerce implementations. Providers receive only mappings from an accepted
/// Commerce Configuration and must retain any native purchase handles
/// privately.
public protocol MosaicCommerceProvider: Sendable {
  var identity: MosaicCommerceProviderIdentity { get }
  /// Runtime capabilities this installed adapter actually implements.
  ///
  /// Commerce Configuration capabilities are accepted only when the matching
  /// installed capability has the same support and reason code.
  var capabilities: [MosaicCommerceCapability] { get }

  /// Invalidates every provider-native Product handle retained by this adapter.
  ///
  /// The router calls this before activating a replacement Commerce
  /// Configuration. Implementations must also ensure that an older in-flight
  /// load cannot repopulate handles after invalidation.
  func invalidateLoadedProducts() async

  func loadProducts(
    mappings: [MosaicCommerceProductMapping]
  ) async -> [MosaicCommerceResolvedProduct]

  func purchase(mosaicProductID: String) async -> MosaicPurchaseResult
  func restore(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicRestoreResult
  func activeEntitlements(
    entitlementMappings: [MosaicCommerceEntitlementMapping]
  ) async -> MosaicActiveEntitlementsResult
  func providerDiagnostics() async -> MosaicCommerceProviderDiagnostics
}

public enum MosaicConfiguredCommerceProviderError: Error, Sendable, Equatable {
  case providerIdentityMismatch(expected: String, actual: String)
  case providerAdapterVersionMismatch(expected: String, actual: String)
  case providerCapabilitiesInvalid
  case providerCapabilityMismatch(
    name: MosaicCommerceCapabilityName,
    expected: MosaicCommerceCapability,
    actual: MosaicCommerceCapability?
  )
}

/// A stable provider reference that can be passed to `Mosaic.configure` before
/// hosted Configuration Delivery and its associated commerce sidecar finish.
/// Calls fail safely until an exact verified provider is installed.
public actor MosaicCommerceProviderRouter: MosaicPurchaseProvider {
  private var configured: MosaicConfiguredPurchaseProvider?
  private var installedProvider: (any MosaicCommerceProvider)?
  private var installationRevision = 0
  private var diagnosticSequence = 0
  private let updates: AsyncStream<MosaicCommerceUpdate>
  private let updateContinuation: AsyncStream<MosaicCommerceUpdate>.Continuation
  private var updateTask: Task<Void, Never>?
  private var routedUpdateIDs = Set<String>()
  private var routedUpdateOrder: [String] = []

  public init() {
    (updates, updateContinuation) = AsyncStream.makeStream(
      bufferingPolicy: .bufferingNewest(64)
    )
  }

  deinit {
    updateTask?.cancel()
    updateContinuation.finish()
  }

  public var commerceUpdates: AsyncStream<MosaicCommerceUpdate> {
    updates
  }

  public func install(
    configuration: MosaicCommerceConfiguration,
    provider: any MosaicCommerceProvider
  ) async throws {
    let replacement = try MosaicConfiguredPurchaseProvider(
      configuration: configuration,
      provider: provider
    )
    installationRevision += 1
    let revision = installationRevision
    let previousProvider = installedProvider
    configured = nil
    installedProvider = nil
    updateTask?.cancel()
    updateTask = nil
    routedUpdateIDs = []
    routedUpdateOrder = []

    if let previousProvider {
      await previousProvider.invalidateLoadedProducts()
      guard revision == installationRevision else { return }
    }
    await provider.invalidateLoadedProducts()
    guard revision == installationRevision else { return }
    if let asynchronousProvider = provider as? any MosaicAsynchronousCommerceProvider {
      try await asynchronousProvider.install(
        configuration: MosaicCommerceConfigurationReference(
          configurationID: configuration.id,
          configurationRevision: configuration.contentDigest
        ),
        mappings: configuration.productMappings
      )
      guard revision == installationRevision else { return }
      let providerUpdates = await asynchronousProvider.commerceUpdates
      let expectedConfiguration = MosaicCommerceConfigurationReference(
        configurationID: configuration.id,
        configurationRevision: configuration.contentDigest
      )
      updateTask = Task { [weak self] in
        for await update in providerUpdates {
          guard !Task.isCancelled else { return }
          await self?.route(
            update,
            expectedProviderID: provider.identity.id,
            expectedConfiguration: expectedConfiguration,
            installationRevision: revision
          )
        }
      }
    }
    configured = replacement
    installedProvider = provider
  }

  public func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    guard let configured else {
      return .unavailable(
        productIDs: identifiers,
        diagnosticCode: "commerce_configuration_unavailable"
      )
    }
    return await configured.loadProducts(identifiers: identifiers)
  }

  public func purchase(productID: String) async -> MosaicPurchaseResult {
    guard let configured else {
      let diagnostic = configurationUnavailableDiagnostic(
        operation: "purchase",
        mosaicProductID: productID
      )
      return .providerUnavailable(
        productID: productID,
        diagnosticCode: diagnostic.code,
        diagnostic: diagnostic
      )
    }
    return await configured.purchase(productID: productID)
  }

  public func restore() async -> MosaicRestoreResult {
    guard let configured else {
      let diagnostic = configurationUnavailableDiagnostic(operation: "restore")
      return .providerUnavailable(
        diagnosticCode: diagnostic.code,
        diagnostic: diagnostic
      )
    }
    return await configured.restore()
  }

  public func recover() async -> MosaicCommerceRecoveryResult {
    guard let configured else {
      let diagnostic = configurationUnavailableDiagnostic(operation: "recovery")
      return MosaicCommerceRecoveryResult(
        operationID: "ios_recovery_\(UUID().uuidString.lowercased())",
        providerID: "unavailable",
        outcome: .providerUnavailable,
        recoveryMode: .providerDefined,
        completedAt: Date(),
        diagnostics: [diagnostic]
      )
    }
    return await configured.recover()
  }

  public func activeEntitlements() async -> MosaicActiveEntitlementsResult {
    guard let configured else {
      let diagnostic = configurationUnavailableDiagnostic(operation: "entitlements")
      return .unknown(
        diagnosticCode: diagnostic.code,
        diagnostic: diagnostic
      )
    }
    return await configured.activeEntitlements()
  }

  private func configurationUnavailableDiagnostic(
    operation: String,
    mosaicProductID: String? = nil
  ) -> MosaicCommerceDiagnostic {
    diagnosticSequence += 1
    return MosaicCommerceDiagnostic(
      code: "commerce.configurationUnavailable",
      safeMessage: "Commerce configuration is unavailable.",
      severity: .error,
      retryable: true,
      correlationID: "ios_router_\(operation)_\(diagnosticSequence)",
      providerCode: "provider_not_installed",
      mosaicProductID: mosaicProductID,
      recoveryAction: .updateProviderConfiguration
    )
  }

  private func route(
    _ update: MosaicCommerceUpdate,
    expectedProviderID: String,
    expectedConfiguration: MosaicCommerceConfigurationReference,
    installationRevision: Int
  ) {
    guard installationRevision == self.installationRevision,
      update.providerID == expectedProviderID,
      update.configuration == expectedConfiguration,
      routedUpdateIDs.insert(update.id).inserted
    else { return }
    routedUpdateOrder.append(update.id)
    if routedUpdateOrder.count > 1_024 {
      routedUpdateIDs.remove(routedUpdateOrder.removeFirst())
    }
    updateContinuation.yield(update)
  }
}

/// Adapts a provider operating on verified mappings to the renderer's stable
/// Mosaic Product-ID interface.
public actor MosaicConfiguredPurchaseProvider: MosaicPurchaseProvider {
  public nonisolated let configuration: MosaicCommerceConfiguration
  private let provider: any MosaicCommerceProvider
  private var loadRevision = 0
  private var loadedProductIDs: Set<String> = []
  private var diagnosticSequence = 0

  public init(
    configuration: MosaicCommerceConfiguration,
    provider: any MosaicCommerceProvider
  ) throws {
    guard configuration.activeProvider.identity.id == provider.identity.id else {
      throw MosaicConfiguredCommerceProviderError.providerIdentityMismatch(
        expected: configuration.activeProvider.identity.id,
        actual: provider.identity.id
      )
    }
    guard configuration.activeProvider.identity.adapterVersion == provider.identity.adapterVersion
    else {
      throw MosaicConfiguredCommerceProviderError.providerAdapterVersionMismatch(
        expected: configuration.activeProvider.identity.adapterVersion,
        actual: provider.identity.adapterVersion
      )
    }
    let actualCapabilities = provider.capabilities
    let capabilitiesByName = Dictionary(
      grouping: actualCapabilities,
      by: \.name
    )
    guard capabilitiesByName.values.allSatisfy({ $0.count == 1 }),
      (
        configuration.version == "2"
          || actualCapabilities.count == configuration.activeProvider.capabilities.count
      ),
      actualCapabilities.allSatisfy(Self.isValidCapability)
    else {
      throw MosaicConfiguredCommerceProviderError.providerCapabilitiesInvalid
    }
    for expected in configuration.activeProvider.capabilities {
      let actual = capabilitiesByName[expected.name]?.first
      guard actual?.support == expected.support,
        actual?.reasonCode == expected.reasonCode
      else {
        throw MosaicConfiguredCommerceProviderError.providerCapabilityMismatch(
          name: expected.name,
          expected: expected,
          actual: actual
        )
      }
    }
    self.configuration = configuration
    self.provider = provider
  }

  public func loadProducts(identifiers: [String]) async -> MosaicProductLoadResult {
    loadRevision += 1
    let revision = loadRevision
    loadedProductIDs = []

    let requested = Set(identifiers)
    let mappings = configuration.productMappings.filter {
      requested.contains($0.mosaicProductID)
    }
    let mapped = Set(mappings.map(\.mosaicProductID))
    let missing = identifiers.filter { !mapped.contains($0) }
    guard missing.isEmpty else {
      return .unavailable(
        productIDs: missing,
        diagnosticCode: "commerce_mapping_missing"
      )
    }

    let resolved = await provider.loadProducts(mappings: mappings)
    guard revision == loadRevision else {
      return .unavailable(
        productIDs: identifiers,
        diagnosticCode: "commerce_product_load_superseded"
      )
    }
    let available = resolved.compactMap { item -> MosaicProduct? in
      guard mapped.contains(item.mosaicProductID),
        item.availability.status == .available,
        item.product?.id == item.mosaicProductID
      else { return nil }
      return item.product
    }
    guard !available.isEmpty || identifiers.isEmpty else {
      let providerUnavailable = resolved.contains {
        $0.availability.reason == .providerUnavailable
      }
      return .unavailable(
        productIDs: identifiers,
        diagnosticCode: providerUnavailable
          ? "commerce_provider_unavailable"
          : "commerce_products_unavailable"
      )
    }
    loadedProductIDs = Set(available.map(\.id))
    return .loaded(available)
  }

  public func purchase(productID: String) async -> MosaicPurchaseResult {
    guard configuration.productMappings.contains(where: { $0.mosaicProductID == productID }),
      loadedProductIDs.contains(productID)
    else {
      return .productUnavailable(productID: productID)
    }
    let result = await provider.purchase(mosaicProductID: productID)
    switch result {
    case .providerUnavailable(_, let diagnosticCode, let diagnostic):
      let normalized = normalizeFailureDiagnostic(
        diagnostic,
        reportedCode: diagnosticCode,
        fallbackCode: "commerce.providerUnavailable",
        fallbackMessage: "The commerce provider is unavailable.",
        operation: "purchase",
        mosaicProductID: productID
      )
      return .providerUnavailable(
        productID: productID,
        diagnosticCode: normalized.code,
        diagnostic: normalized
      )
    case .failed(_, let diagnosticCode, let diagnostic):
      let normalized = normalizeFailureDiagnostic(
        diagnostic,
        reportedCode: diagnosticCode,
        fallbackCode: "commerce.purchaseFailed",
        fallbackMessage: "The commerce provider could not complete the purchase.",
        operation: "purchase",
        mosaicProductID: productID
      )
      return .failed(
        productID: productID,
        diagnosticCode: normalized.code,
        diagnostic: normalized
      )
    default:
      return result
    }
  }

  public func restore() async -> MosaicRestoreResult {
    let result = await provider.restore(
      entitlementMappings: configuration.entitlementMappings
    )
    switch result {
    case .providerUnavailable(let diagnosticCode, let diagnostic):
      let normalized = normalizeFailureDiagnostic(
        diagnostic,
        reportedCode: diagnosticCode,
        fallbackCode: "commerce.providerUnavailable",
        fallbackMessage: "The commerce provider is unavailable for restore.",
        operation: "restore"
      )
      return .providerUnavailable(
        diagnosticCode: normalized.code,
        diagnostic: normalized
      )
    case .failed(let diagnosticCode, let diagnostic):
      let normalized = normalizeFailureDiagnostic(
        diagnostic,
        reportedCode: diagnosticCode,
        fallbackCode: "commerce.restoreFailed",
        fallbackMessage: "The commerce provider could not restore purchases.",
        operation: "restore"
      )
      return .failed(diagnosticCode: normalized.code, diagnostic: normalized)
    default:
      return result
    }
  }

  public func recover() async -> MosaicCommerceRecoveryResult {
    if configuration.version == "2",
      let recoveryProvider = provider as? any MosaicCommerceRecoveryProvider
    {
      return await recoveryProvider.recover(
        entitlementMappings: configuration.entitlementMappings
      )
    }

    let result = await restore()
    let outcome: MosaicCommerceRecoveryOutcome
    let entitlements: Set<MosaicEntitlement>
    let diagnostics: [MosaicCommerceDiagnostic]
    switch result {
    case .restored(let active):
      outcome = .restored
      entitlements = active
      diagnostics = []
    case .nothingToRestore:
      outcome = .nothingToRestore
      entitlements = []
      diagnostics = []
    case .cancelled:
      outcome = .cancelled
      entitlements = []
      diagnostics = []
    case .providerUnavailable(_, let diagnostic):
      outcome = .providerUnavailable
      entitlements = []
      diagnostics = [diagnostic]
    case .failed(_, let diagnostic):
      outcome = .failed
      entitlements = []
      diagnostics = [diagnostic]
    }
    return MosaicCommerceRecoveryResult(
      operationID: "ios_recovery_\(UUID().uuidString.lowercased())",
      providerID: configuration.activeProvider.identity.id,
      outcome: outcome,
      recoveryMode: configuration.activeProvider.recoveryMode,
      activeEntitlements: entitlements,
      completedAt: Date(),
      diagnostics: diagnostics
    )
  }

  public func activeEntitlements() async -> MosaicActiveEntitlementsResult {
    let result = await provider.activeEntitlements(
      entitlementMappings: configuration.entitlementMappings
    )
    switch result {
    case .providerUnavailable(let diagnosticCode, let diagnostic):
      let normalized = normalizeFailureDiagnostic(
        diagnostic,
        reportedCode: diagnosticCode,
        fallbackCode: "commerce.providerUnavailable",
        fallbackMessage: "The commerce provider is unavailable for active access lookup.",
        operation: "entitlements"
      )
      return .providerUnavailable(
        diagnosticCode: normalized.code,
        diagnostic: normalized
      )
    case .failed(let diagnosticCode, let diagnostic):
      let normalized = normalizeFailureDiagnostic(
        diagnostic,
        reportedCode: diagnosticCode,
        fallbackCode: "commerce.entitlementLookupFailed",
        fallbackMessage: "The commerce provider could not read active access.",
        operation: "entitlements"
      )
      return .failed(diagnosticCode: normalized.code, diagnostic: normalized)
    default:
      return result
    }
  }

  public func diagnostics() async -> MosaicCommerceProviderDiagnostics {
    await provider.providerDiagnostics()
  }

  private static func isValidCapability(_ capability: MosaicCommerceCapability) -> Bool {
    switch capability.support {
    case .supported:
      return capability.reasonCode == nil
    case .unsupported, .conditional:
      guard let reasonCode = capability.reasonCode else { return false }
      return reasonCode.count <= 96
        && reasonCode.range(
          of: "^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$",
          options: .regularExpression
        ) != nil
    }
  }

  private func normalizeFailureDiagnostic(
    _ diagnostic: MosaicCommerceDiagnostic,
    reportedCode: String,
    fallbackCode: String,
    fallbackMessage: String,
    operation: String,
    mosaicProductID: String? = nil
  ) -> MosaicCommerceDiagnostic {
    let code =
      Self.safeMachineValue(diagnostic.code, maximumLength: 96)
      ?? Self.safeMachineValue(reportedCode, maximumLength: 96)
      ?? fallbackCode
    let safeMessage =
      Self.safeText(diagnostic.safeMessage, maximumLength: 240)
      ?? fallbackMessage
    let correlationID: String
    if let safeCorrelation = Self.safeIdentifier(diagnostic.correlationID) {
      correlationID = safeCorrelation
    } else {
      diagnosticSequence += 1
      correlationID = "ios_provider_\(operation)_\(diagnosticSequence)"
    }
    return MosaicCommerceDiagnostic(
      code: code,
      safeMessage: safeMessage,
      severity: diagnostic.severity,
      retryable: diagnostic.retryable,
      retryAfterSeconds: diagnostic.retryable
        ? diagnostic.retryAfterSeconds.flatMap { (1...86_400).contains($0) ? $0 : nil }
        : nil,
      correlationID: correlationID,
      providerCode: diagnostic.providerCode.flatMap {
        Self.safeText($0, maximumLength: 128)
      } ?? "provider_failure",
      mosaicProductID: mosaicProductID,
      recoveryAction: diagnostic.recoveryAction
        ?? (diagnostic.retryable ? .retry : .contactProvider)
    )
  }

  private static func safeMachineValue(
    _ value: String,
    maximumLength: Int
  ) -> String? {
    guard value.count <= maximumLength,
      value.range(
        of: "^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$",
        options: .regularExpression
      ) != nil
    else { return nil }
    return value
  }

  private static func safeIdentifier(_ value: String) -> String? {
    guard value.count <= 128,
      value.range(
        of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        options: .regularExpression
      ) != nil
    else { return nil }
    return value
  }

  private static func safeText(
    _ value: String,
    maximumLength: Int
  ) -> String? {
    guard !value.isEmpty, value.count <= maximumLength,
      value.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7F })
    else { return nil }
    return value
  }
}
