import Foundation

public struct MosaicConfiguration: Sendable, Equatable {
  public let apiKey: String

  /// Optional override for local development or self-hosting.
  ///
  /// Phase 0 deliberately does not select a hosted production URL.
  public let endpoint: URL?
  public let applicationVersion: String?
  public let requestTimeout: TimeInterval

  public init(
    apiKey: String,
    endpoint: URL? = nil,
    applicationVersion: String? = nil,
    requestTimeout: TimeInterval = 5
  ) throws {
    let normalizedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedKey.isEmpty else {
      throw MosaicConfigurationError.emptyAPIKey
    }
    if let endpoint {
      guard
        let scheme = endpoint.scheme?.lowercased(),
        scheme == "http" || scheme == "https",
        endpoint.host?.isEmpty == false,
        endpoint.user == nil,
        endpoint.password == nil,
        endpoint.query == nil,
        endpoint.fragment == nil
      else {
        throw MosaicConfigurationError.invalidEndpoint
      }
    }
    let normalizedApplicationVersion = applicationVersion?.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    if let normalizedApplicationVersion {
      guard
        !normalizedApplicationVersion.isEmpty,
        normalizedApplicationVersion.count <= 64,
        normalizedApplicationVersion.unicodeScalars.allSatisfy({ scalar in
          scalar.value >= 0x20 && scalar.value != 0x7F
        })
      else { throw MosaicConfigurationError.invalidApplicationVersion }
    }
    guard requestTimeout.isFinite, (1...30).contains(requestTimeout) else {
      throw MosaicConfigurationError.invalidRequestTimeout
    }
    self.apiKey = normalizedKey
    self.endpoint = endpoint
    self.applicationVersion = normalizedApplicationVersion
    self.requestTimeout = requestTimeout
  }
}

/// Where the SDK keeps its cached configuration, identity, assignment replay,
/// and analytics queue.
enum MosaicPersistenceRoot: Sendable, Equatable {
  case applicationSupport
  case directory(URL)
  /// Simulates an unreachable Application Support directory.
  case unavailable

  func resolve(_ fileManager: FileManager = .default) -> URL? {
    switch self {
    case .applicationSupport:
      fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    case .directory(let url):
      url
    case .unavailable:
      nil
    }
  }
}

public enum MosaicConfigurationError: Error, Sendable, Equatable {
  case emptyAPIKey
  case invalidEndpoint
  case invalidApplicationVersion
  case invalidRequestTimeout
}

/// An isolated configured SDK handle; Phase 0 installs no global singleton.
public struct Mosaic: Sendable {
  public let configuration: MosaicConfiguration
  public let purchaseProvider: any MosaicPurchaseProvider
  private let configurationClient: MosaicConfigurationClient?
  private let identityStore: MosaicIdentityStore
  private let analyticsRuntime: MosaicAnalyticsRuntime?
  private let transactionObservationRuntime: MosaicTransactionObservationRuntime?

  private init(
    configuration: MosaicConfiguration,
    purchaseProvider: any MosaicPurchaseProvider,
    configurationClient: MosaicConfigurationClient? = nil,
    identityStore: MosaicIdentityStore = MosaicIdentityStore(
      persistence: MosaicMemoryIdentityPersistence()),
    analyticsRuntime: MosaicAnalyticsRuntime? = nil,
    transactionObservationRuntime: MosaicTransactionObservationRuntime? = nil
  ) {
    self.configuration = configuration
    self.purchaseProvider = purchaseProvider
    self.configurationClient = configurationClient
    self.identityStore = identityStore
    self.analyticsRuntime = analyticsRuntime
    self.transactionObservationRuntime = transactionObservationRuntime
  }

  public static func configure(
    apiKey: String,
    endpoint: URL? = nil,
    purchaseProvider: any MosaicPurchaseProvider
  ) throws -> Mosaic {
    Mosaic(
      configuration: try MosaicConfiguration(apiKey: apiKey, endpoint: endpoint),
      purchaseProvider: purchaseProvider
    )
  }

  /// Configures hosted delivery.
  ///
  /// This only throws for an invalid configuration argument. When local
  /// persistence is unreachable the SDK degrades to process-lifetime storage
  /// and the bundled fallback rather than failing the host's launch; the
  /// degradation is reported through `configurationStatus()` diagnostics.
  public static func configure(
    publicSDKKey: String,
    baseURL: URL,
    applicationVersion: String? = nil,
    requestTimeout: TimeInterval = 5,
    bundledFallback: MosaicConfigurationBundledFallback = .packaged,
    transactionObservations: MosaicTransactionObservationMode = .disabled,
    purchaseProvider: any MosaicPurchaseProvider
  ) async throws -> Mosaic {
    try await configureHosted(
      publicSDKKey: publicSDKKey,
      baseURL: baseURL,
      applicationVersion: applicationVersion,
      requestTimeout: requestTimeout,
      bundledFallback: bundledFallback,
      transactionObservations: transactionObservations,
      purchaseProvider: purchaseProvider,
      persistenceRoot: .applicationSupport
    )
  }

  static func configureHosted(
    publicSDKKey: String,
    baseURL: URL,
    applicationVersion: String?,
    requestTimeout: TimeInterval,
    bundledFallback: MosaicConfigurationBundledFallback,
    transactionObservations: MosaicTransactionObservationMode = .disabled,
    purchaseProvider: any MosaicPurchaseProvider,
    persistenceRoot: MosaicPersistenceRoot
  ) async throws -> Mosaic {
    let configuration = try MosaicConfiguration(
      apiKey: publicSDKKey,
      endpoint: baseURL,
      applicationVersion: applicationVersion,
      requestTimeout: requestTimeout
    )
    let key = configuration.apiKey
    let root = persistenceRoot.resolve()
    var degraded = root == nil

    let store: any MosaicConfigurationCacheStore
    if let root,
      let fileStore = try? MosaicConfigurationFileStore(
        baseURL: baseURL, publicSDKKey: key, rootDirectory: root)
    {
      store = fileStore
    } else {
      store = MosaicConfigurationMemoryStore()
      degraded = true
    }

    let experimentRegistry = MosaicExperimentAssignmentStoreRegistry.shared
    var experimentStore: MosaicExperimentAssignmentStore?
    if let root {
      experimentStore = try? await experimentRegistry.store(
        baseURL: baseURL, publicSDKKey: key, rootDirectory: root)
    }
    if experimentStore == nil {
      experimentStore = await experimentRegistry.memoryStore(baseURL: baseURL, publicSDKKey: key)
      degraded = true
    }

    let identityPersistence: any MosaicIdentityPersistence
    if let root,
      let filePersistence = try? MosaicIdentityFilePersistence(
        baseURL: baseURL, publicSDKKey: key, rootDirectory: root)
    {
      identityPersistence = filePersistence
    } else {
      identityPersistence = MosaicMemoryIdentityPersistence()
      degraded = true
    }
    let identityStore = MosaicIdentityStore(persistence: identityPersistence)

    let analytics = await MosaicAnalyticsRuntimeRegistry.shared.runtime(
      baseURL: baseURL, apiKey: key, timeout: requestTimeout,
      identityStore: identityStore, applicationVersion: applicationVersion,
      rootDirectory: root)
    let analyticsRuntime = analytics.runtime
    if analytics.degraded { degraded = true }

    // Opt-in. When observations are disabled no runtime exists, so nothing is
    // built, queued, persisted, or sent.
    var observationRuntime: MosaicTransactionObservationRuntime?
    if transactionObservations == .enabled {
      let observations = await MosaicTransactionObservationRuntimeRegistry.shared.runtime(
        baseURL: baseURL, apiKey: key, timeout: requestTimeout,
        applicationVersion: configuration.applicationVersion, rootDirectory: root)
      observationRuntime = observations.runtime
      if observations.degraded { degraded = true }
    }

    let client = MosaicConfigurationClient(
      publicSDKKey: key,
      baseURL: baseURL,
      applicationVersion: configuration.applicationVersion,
      requestTimeout: configuration.requestTimeout,
      bundledFallback: bundledFallback,
      transport: MosaicURLSessionConfigurationTransport(requestTimeout: requestTimeout),
      store: store,
      // `experimentStore` is always assigned above.
      experimentStore: experimentStore
        ?? MosaicExperimentAssignmentStore(
          persistence: MosaicExperimentMemoryPersistence()),
      initialDiagnostics: degraded
        ? [MosaicDiagnostic(code: "delivery_persistence_unavailable", stage: .cache)]
        : []
    )
    await client.bootstrap()
    _ = await client.refresh()
    let namespace = baseURL.absoluteString + "\n" + key
    await MosaicAnalyticsLifecycleRegistry.install(
      runtime: analyticsRuntime,
      namespace: namespace)
    if let observationRuntime {
      await MosaicTransactionObservationLifecycleRegistry.install(
        runtime: observationRuntime, namespace: namespace)
      // Delivery of anything left over from a previous launch must never
      // delay the host's configure call.
      Task.detached(priority: .utility) { _ = await observationRuntime.flush() }
    }
    return Mosaic(
      configuration: configuration,
      purchaseProvider: purchaseProvider,
      configurationClient: client,
      identityStore: identityStore,
      analyticsRuntime: analyticsRuntime,
      transactionObservationRuntime: observationRuntime
    )
  }

  public func configurationStatus() async -> MosaicConfigurationStatus {
    guard let configurationClient else {
      return .unavailable(
        diagnostics: [
          MosaicDiagnostic(code: "delivery_not_configured", stage: .deliveryValidation)
        ])
    }
    return await configurationClient.status()
  }

  public func refresh() async -> MosaicConfigurationRefreshResult {
    guard let configurationClient else {
      return .unavailable(
        diagnostics: [
          MosaicDiagnostic(code: "delivery_not_configured", stage: .deliveryValidation)
        ])
    }
    return await configurationClient.refresh()
  }

  public func refreshIfNeeded() async -> MosaicConfigurationRefreshResult {
    guard let configurationClient else {
      return .unavailable(
        diagnostics: [
          MosaicDiagnostic(code: "delivery_not_configured", stage: .deliveryValidation)
        ])
    }
    return await configurationClient.refreshIfNeeded()
  }

  public func resolve(placement: String) async -> MosaicPlacementResolution {
    guard let configurationClient else {
      return .unavailable(
        diagnostics: [
          MosaicDiagnostic(code: "delivery_not_configured", stage: .placement)
        ])
    }
    return await configurationClient.resolve(placement: placement)
  }

  /// Evaluates an accepted Placement locally. This never refreshes configuration.
  public func decision(
    placement: String,
    context suppliedContext: MosaicDecisionContext? = nil
  ) async -> MosaicPlacementDecisionResult {
    await decisionForPresentation(placement: placement, context: suppliedContext).result
  }

  func decisionForPresentation(
    placement: String,
    context suppliedContext: MosaicDecisionContext? = nil
  ) async -> MosaicConfigurationClient.AnalyticsDecisionEvaluation {
    guard let configurationClient else {
      return .init(
        .configurationUnavailable(diagnostics: [
          MosaicDiagnostic(code: "delivery_not_configured", stage: .placement)
        ]))
    }
    let identity = await identityStore.snapshot()
    var context =
      suppliedContext
      ?? MosaicDecisionContext(
        platform: "ios",
        operatingSystemVersion: ProcessInfo.processInfo.operatingSystemVersionString
          .split(separator: " ").first(where: { $0.first?.isNumber == true }).map(String.init),
        applicationVersion: configuration.applicationVersion,
        applicationLocale: Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
      )
    if suppliedContext == nil {
      let requirements = await configurationClient.decisionRequirements(placement: placement)
      if !requirements.productIDs.isEmpty {
        switch await purchaseProvider.loadProducts(identifiers: requirements.productIDs) {
        case .loaded(let products):
          let available = Set(products.map(\.id))
          context.products = Dictionary(
            uniqueKeysWithValues: requirements.productIDs.map {
              ($0, available.contains($0) ? .available : .unavailable)
            })
        case .unavailable:
          context.products = Dictionary(
            uniqueKeysWithValues: requirements.productIDs.map { ($0, .providerUnavailable) })
        }
      }
      if !requirements.entitlementKeys.isEmpty {
        switch await purchaseProvider.activeEntitlements() {
        case .available(let active):
          let activeKeys = Set(active.map(\.id))
          context.entitlements = Dictionary(
            uniqueKeysWithValues: requirements.entitlementKeys.map {
              ($0, activeKeys.contains($0) ? .active : .inactive)
            })
        case .unknown:
          context.entitlements = Dictionary(
            uniqueKeysWithValues: requirements.entitlementKeys.map { ($0, .unknown) })
        case .providerUnavailable:
          context.entitlements = Dictionary(
            uniqueKeysWithValues: requirements.entitlementKeys.map { ($0, .providerUnavailable) })
        case .failed:
          context.entitlements = Dictionary(
            uniqueKeysWithValues: requirements.entitlementKeys.map { ($0, .failed) })
        }
      }
      context.providerCapabilities = [
        "product_loading": .available, "purchase": .available, "restore": .available,
        "entitlement_lookup": .available,
      ]
    }
    let evaluation = await configurationClient.decideForPresentation(
      placement: placement, context: context, identity: identity)
    guard let selection = evaluation.experimentSelection else { return evaluation }
    let requiredProducts = selection.variant.compatibility.requiredProductIds
    let productsReady: Bool
    if requiredProducts.isEmpty {
      productsReady = true
    } else {
      switch await purchaseProvider.loadProducts(identifiers: requiredProducts) {
      case .loaded(let products):
        productsReady = Set(products.map(\.id)) == Set(requiredProducts)
      case .unavailable:
        productsReady = false
      }
    }
    return await configurationClient.finalizeExperiment(
      evaluation, productsReady: productsReady,
      providerCapabilities: await purchaseProvider.mosaicExperimentCapabilities)
  }

  public func identity() async -> MosaicIdentitySnapshot { await identityStore.snapshot() }

  public func identify(userID: String) async throws {
    let before = await identityStore.snapshot()
    try await identityStore.identify(userID)
    let after = await identityStore.snapshot()
    if before.userID != after.userID {
      await configurationClient?.identityChanged(user: true, installation: false)
      await analyticsRuntime?.identityChanged()
    }
  }

  public func setUserAttributes(_ attributes: [String: MosaicTypedValue]) async throws {
    let definitions = await configurationClient?.attributeDefinitions()
    try await identityStore.replaceAttributes(attributes, definitions: definitions)
  }

  /// Clears user identity, attributes and user-bound decision material while retaining the installation ID.
  public func resetIdentity() async throws {
    let before = await identityStore.snapshot()
    try await identityStore.resetUser()
    if before.userID != nil || !before.attributes.isEmpty {
      await configurationClient?.identityChanged(user: true, installation: false)
      await analyticsRuntime?.identityChanged()
    }
  }

  /// Creates a new app-install identity and also clears user-bound state.
  public func resetInstallationIdentity() async throws {
    try await identityStore.resetInstallation()
    await configurationClient?.identityChanged(user: true, installation: true)
    await analyticsRuntime?.identityChanged()
  }

  /// Applies the Environment owner/admin collection setting and a host-app
  /// runtime override. Both must be true. Turning either off cancels delivery
  /// and clears all unsent events; the host cannot override a disabled Environment.
  public func setAnalyticsCollection(
    environmentEnabled: Bool,
    hostEnabled: Bool = true
  ) async {
    await analyticsRuntime?.setCollection(
      environmentEnabled: environmentEnabled,
      hostEnabled: hostEnabled)
  }

  /// Records one closed Analytics Event v1/v2 client observation. Provider-confirmed
  /// events cannot be created by this public SDK path.
  @discardableResult
  public func recordAnalytics(
    _ name: MosaicAnalyticsEventName,
    correlation: MosaicAnalyticsCorrelation,
    attribution: MosaicAnalyticsAttribution = .init(),
    payload: MosaicAnalyticsPayload = .init(),
    occurredAt: Date = Date()
  ) async -> MosaicAnalyticsRecordResult {
    guard let analyticsRuntime else { return .collectionDisabled }
    return await analyticsRuntime.record(
      name: name, correlation: correlation, attribution: attribution,
      payload: payload, occurredAt: occurredAt)
  }

  public func flushAnalytics() async -> MosaicAnalyticsFlushResult {
    guard let analyticsRuntime else { return .collectionDisabled }
    return await analyticsRuntime.flush()
  }

  public func analyticsDiagnostics() async -> MosaicAnalyticsDiagnostics {
    guard let analyticsRuntime else {
      return .init(
        collectionEnabled: false, queuedEventCount: 0, queuedBytes: 0,
        droppedEventCount: 0, expiredEventCount: 0,
        permanentlyRejectedEventCount: 0, retryCount: 0,
        lastSafeCode: "analytics_not_configured", isFlushInFlight: false)
    }
    return await analyticsRuntime.diagnostics()
  }

  /// The sink a native-store commerce provider hands observed transactions to,
  /// or `nil` when transaction observations are disabled.
  ///
  /// A provider is constructed before `configure`, so the sink is attached to
  /// the provider after configuration rather than passed through it.
  public func transactionObservationSink() -> (any MosaicTransactionObservationSink)? {
    guard let transactionObservationRuntime else { return nil }
    return MosaicTransactionObservationQueueSink(runtime: transactionObservationRuntime)
  }

  /// Attempts delivery of the queued observations now. This never affects a
  /// purchase result and never reports a transaction as validated.
  public func flushTransactionObservations() async -> MosaicTransactionObservationFlushResult {
    guard let transactionObservationRuntime else { return .disabled }
    return await transactionObservationRuntime.flush()
  }

  public func transactionObservationDiagnostics() async
    -> MosaicTransactionObservationDiagnostics
  {
    guard let transactionObservationRuntime else { return .disabled }
    return await transactionObservationRuntime.diagnostics()
  }

  func analyticsPlacementMetadata(_ placement: String) async
    -> MosaicConfigurationClient.AnalyticsPlacementMetadata?
  {
    await configurationClient?.analyticsPlacementMetadata(placement)
  }

  func analyticsPaywallMetadata(versionID: String) async
    -> (paywallID: String, versionID: String)?
  {
    await configurationClient?.analyticsPaywallMetadata(versionID: versionID)
  }

  func analyticsPresentationInstrumentation(
    placementRequestID: String,
    presentationID: String,
    attribution: MosaicAnalyticsAttribution,
    experimentAttribution: MosaicAnalyticsAttribution? = nil
  ) async -> MosaicAnalyticsPresentationInstrumentation? {
    guard let analyticsRuntime else { return nil }
    return MosaicAnalyticsPresentationInstrumentation(
      runtime: analyticsRuntime, placementRequestID: placementRequestID,
      presentationID: presentationID, attribution: attribution,
      experimentAttribution: experimentAttribution,
      providerID: await purchaseProvider.mosaicAnalyticsProviderID)
  }

  func authorizeExperimentPresentation(
    _ selection: MosaicExperimentSelection, releaseID: String
  ) async -> Bool {
    let identity = await identityStore.snapshot()
    return await configurationClient?.authorizePresentation(
      selection, releaseID: releaseID, identity: identity) ?? false
  }

  func markExperimentExposed(_ selection: MosaicExperimentSelection) async {
    await configurationClient?.markExposed(selection)
  }

  public func experimentDiagnostics() async -> MosaicExperimentDiagnostics {
    guard let values = await configurationClient?.experimentDiagnostics() else {
      return .init(persistedAssignmentCount: 0, exposedAssignmentCount: 0)
    }
    return values
  }

  /// Returns the exact accepted Configuration Release association required to
  /// validate a Commerce Configuration sidecar. No sidecar should be decoded
  /// or cached without this binding.
  public func commerceConfigurationAssociation(
    applicationID: String,
    storePlatform: MosaicCommerceStorePlatform = .ios
  ) async -> MosaicCommerceConfigurationAssociation? {
    guard let configurationClient else { return nil }
    return await configurationClient.commerceConfigurationAssociation(
      applicationID: applicationID,
      storePlatform: storePlatform
    )
  }
}
