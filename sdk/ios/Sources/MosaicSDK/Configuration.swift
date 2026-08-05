import Foundation

public struct MosaicConfiguration: Sendable, Equatable {
  public let apiKey: String

  /// Optional override for local development or self-hosting.
  ///
  /// Phase 0 deliberately does not select a hosted production URL.
  public let endpoint: URL?
  public let applicationID: String
  public let applicationVersion: String?
  public let requestTimeout: TimeInterval

  public init(
    apiKey: String,
    endpoint: URL? = nil,
    applicationID: String? = nil,
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
    let normalizedApplicationID =
      (applicationID ?? Bundle.main.bundleIdentifier ?? "mosaic.ios.application")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard (1...128).contains(normalizedApplicationID.count),
      normalizedApplicationID.range(
        of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$", options: .regularExpression) != nil
    else { throw MosaicConfigurationError.invalidApplicationID }
    let bundledApplicationVersion =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    let normalizedApplicationVersion = (applicationVersion ?? bundledApplicationVersion ?? "0.0.0")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard (1...64).contains(normalizedApplicationVersion.count),
      normalizedApplicationVersion.range(
        of: "^[0-9A-Za-z][0-9A-Za-z.+_-]*$", options: .regularExpression) != nil
    else { throw MosaicConfigurationError.invalidApplicationVersion }
    guard requestTimeout.isFinite, (1...30).contains(requestTimeout) else {
      throw MosaicConfigurationError.invalidRequestTimeout
    }
    self.apiKey = normalizedKey
    self.endpoint = endpoint
    self.applicationID = normalizedApplicationID
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
  case invalidApplicationID
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
  private let entitlementClient: MosaicCustomerEntitlementClient?

  init(
    configuration: MosaicConfiguration,
    purchaseProvider: any MosaicPurchaseProvider,
    configurationClient: MosaicConfigurationClient? = nil,
    identityStore: MosaicIdentityStore = MosaicIdentityStore(
      persistence: MosaicMemoryIdentityPersistence()),
    analyticsRuntime: MosaicAnalyticsRuntime? = nil,
    transactionObservationRuntime: MosaicTransactionObservationRuntime? = nil,
    entitlementClient: MosaicCustomerEntitlementClient? = nil
  ) {
    self.configuration = configuration
    self.purchaseProvider = purchaseProvider
    self.configurationClient = configurationClient
    self.identityStore = identityStore
    self.analyticsRuntime = analyticsRuntime
    self.transactionObservationRuntime = transactionObservationRuntime
    self.entitlementClient = entitlementClient
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
    applicationID: String? = nil,
    applicationVersion: String? = nil,
    requestTimeout: TimeInterval = 5,
    bundledFallback: MosaicConfigurationBundledFallback = .packaged,
    transactionObservations: MosaicTransactionObservationMode = .disabled,
    purchaseProvider: any MosaicPurchaseProvider,
    customerTokenProvider: (any MosaicCustomerTokenProvider)? = nil
  ) async throws -> Mosaic {
    try await configureHosted(
      publicSDKKey: publicSDKKey,
      baseURL: baseURL,
      applicationID: applicationID,
      applicationVersion: applicationVersion,
      requestTimeout: requestTimeout,
      bundledFallback: bundledFallback,
      transactionObservations: transactionObservations,
      purchaseProvider: purchaseProvider,
      customerTokenProvider: customerTokenProvider,
      persistenceRoot: .applicationSupport
    )
  }

  static func configureHosted(
    publicSDKKey: String,
    baseURL: URL,
    applicationID: String? = nil,
    applicationVersion: String?,
    requestTimeout: TimeInterval,
    bundledFallback: MosaicConfigurationBundledFallback,
    transactionObservations: MosaicTransactionObservationMode = .disabled,
    purchaseProvider: any MosaicPurchaseProvider,
    customerTokenProvider: (any MosaicCustomerTokenProvider)? = nil,
    persistenceRoot: MosaicPersistenceRoot
  ) async throws -> Mosaic {
    let configuration = try MosaicConfiguration(
      apiKey: publicSDKKey,
      endpoint: baseURL,
      applicationID: applicationID,
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

    // Built before the observation runtime so an observation submission can
    // carry the customer token that binds a purchase to its Billing Customer.
    // Memory-only, so constructing it costs nothing and persists nothing.
    let customerTokenStore = customerTokenProvider.map {
      MosaicCustomerTokenStore(provider: $0)
    }

    // Opt-in. When observations are disabled no runtime exists, so nothing is
    // built, queued, persisted, or sent.
    var observationRuntime: MosaicTransactionObservationRuntime?
    if transactionObservations == .enabled {
      let observations = await MosaicTransactionObservationRuntimeRegistry.shared.runtime(
        baseURL: baseURL, apiKey: key, timeout: requestTimeout,
        applicationVersion: configuration.applicationVersion, rootDirectory: root)
      observationRuntime = observations.runtime
      if observations.degraded { degraded = true }
      // Without this an identified user's purchase anchors anonymously and has
      // to be associated later by other evidence.
      await observationRuntime?.attachCustomerTokenSource(customerTokenStore)
    }

    // Authoritative entitlements are opt-in: with no customer token provider
    // there is no client at all, so nothing is fetched, cached, or persisted.
    // Mosaic Billing requires an application backend (OD-4).
    var entitlementClient: MosaicCustomerEntitlementClient?
    if let customerTokenStore {
      let identity = await identityStore.snapshot()
      let bindingDigest = MosaicCustomerEntitlementFileCacheStore.bindingDigest(
        userID: identity.userID)
      entitlementClient = MosaicCustomerEntitlementClient(
        publicSDKKey: key,
        baseURL: baseURL,
        requestTimeout: requestTimeout,
        transport: MosaicURLSessionEntitlementSyncTransport(requestTimeout: requestTimeout),
        tokenStore: customerTokenStore,
        bindingDigest: bindingDigest,
        cacheStoreFactory: { digest in
          if let root,
            let store = try? MosaicCustomerEntitlementFileCacheStore(
              baseURL: baseURL, publicSDKKey: key, customerBindingDigest: digest,
              rootDirectory: root)
          {
            return store
          }
          return MosaicCustomerEntitlementMemoryCacheStore()
        },
        applicationMetadata: MosaicEntitlementApplicationMetadata(
          applicationID: configuration.applicationID,
          appVersion: configuration.applicationVersion ?? "0.0.0",
          sdkVersion: mosaicSDKVersion),
        authorityAware: true)
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
    if let entitlementClient {
      // A cached pending/stabilizing authority is access-critical. Reconcile it
      // before accepting a newer Configuration that could target on that state.
      await entitlementClient.bootstrap()
      await entitlementClient.refreshAuthorityBeforeConfigurationIfNeeded()
    }
    await client.bootstrap()
    _ = await client.refresh()
    let namespace = baseURL.absoluteString + "\n" + key
    await MosaicAnalyticsLifecycleRegistry.install(
      runtime: analyticsRuntime,
      namespace: namespace)
    if let entitlementClient {
      // Outside an urgent transition, the network refresh remains detached so
      // ordinary entitlement freshness never delays the host's configure call.
      await MosaicCustomerEntitlementLifecycleRegistry.install(
        client: entitlementClient, namespace: namespace)
      Task.detached(priority: .utility) { _ = await entitlementClient.refresh() }
    }
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
      transactionObservationRuntime: observationRuntime,
      entitlementClient: entitlementClient
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
    // An authority transition is access-critical and precedes ordinary
    // Configuration Delivery refresh by contract.
    await entitlementClient?.refreshAuthorityBeforeConfigurationIfNeeded()
    return await configurationClient.refresh()
  }

  public func refreshIfNeeded() async -> MosaicConfigurationRefreshResult {
    guard let configurationClient else {
      return .unavailable(
        diagnostics: [
          MosaicDiagnostic(code: "delivery_not_configured", stage: .deliveryValidation)
        ])
    }
    await entitlementClient?.refreshAuthorityBeforeConfigurationIfNeeded()
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
        applicationLocale: MosaicDeviceLocale.currentTargetingLocale
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
        context.entitlements = await entitlementDecisionStates(
          for: requirements.entitlementKeys)
      }
      // The adapter is the only thing that knows what it implements. The
      // default protocol extension still reports the full set, so an adapter
      // that does not override this keeps the previous optimistic answer;
      // adapters that do override it can no longer be reported as capable of
      // something they cannot do.
      context.providerCapabilities = Self.decisionCapabilities(
        await purchaseProvider.mosaicExperimentCapabilities)
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

  /// Maps the adapter's declared Experiment capabilities onto the Placement
  /// decision-context keys. A capability the adapter does not declare is
  /// reported `unavailable`, never assumed available.
  static func decisionCapabilities(
    _ capabilities: Set<MosaicExperimentProviderCapability>
  ) -> [String: MosaicProviderCapabilityState] {
    let keys: [(String, MosaicExperimentProviderCapability)] = [
      ("product_loading", .productLoad),
      ("purchase", .purchase),
      ("restore", .restore),
      ("entitlement_lookup", .entitlementLookup),
    ]
    return Dictionary(
      uniqueKeysWithValues: keys.map {
        ($0.0, capabilities.contains($0.1) ? .available : .unavailable)
      })
  }

  /// One authority-aware decision-context seam. Keeping this outside the
  /// evaluator makes "Mosaic only after Mosaic authority" independently
  /// testable and prevents a future merge with provider-observed access.
  func entitlementDecisionStates(for keys: [String]) async
    -> [String: MosaicEntitlementDecisionState]
  {
    if let entitlementClient, await entitlementClient.isAuthorityAwareRuntime() {
      guard let authorityKind = await entitlementClient.targetingAuthorityKind() else {
        return Dictionary(uniqueKeysWithValues: keys.map { ($0, .unknown) })
      }
      if authorityKind == .mosaic {
        var values: [String: MosaicEntitlementDecisionState] = [:]
        for key in keys {
          switch await entitlementClient.check(key: key).state {
          case .active: values[key] = .active
          case .inactive: values[key] = .inactive
          case .unknown, .unavailable: values[key] = .unknown
          }
        }
        return values
      }
      // Accepted source and rollback authority explicitly delegate access
      // observation to the installed provider. Absence of authority above is
      // unknown; it is never permission to infer provider authority.
    }

    switch await purchaseProvider.activeEntitlements() {
    case .available(let active):
      let activeKeys = Set(active.map(\.id))
      return Dictionary(
        uniqueKeysWithValues: keys.map {
          ($0, activeKeys.contains($0) ? .active : .inactive)
        })
    case .unknown:
      return Dictionary(uniqueKeysWithValues: keys.map { ($0, .unknown) })
    case .providerUnavailable:
      return Dictionary(uniqueKeysWithValues: keys.map { ($0, .providerUnavailable) })
    case .failed:
      return Dictionary(uniqueKeysWithValues: keys.map { ($0, .failed) })
    }
  }

  public func identity() async -> MosaicIdentitySnapshot { await identityStore.snapshot() }

  public func identify(userID: String) async throws {
    let before = await identityStore.snapshot()
    try await identityStore.identify(userID)
    let after = await identityStore.snapshot()
    if before.userID != after.userID {
      await configurationClient?.identityChanged(user: true, installation: false)
      await analyticsRuntime?.identityChanged()
      await entitlementClient?.identityChanged(
        bindingDigest: MosaicCustomerEntitlementFileCacheStore.bindingDigest(
          userID: after.userID),
        signedOut: false)
      // The new identity's entitlements are fetched off the caller's path.
      if let entitlementClient {
        Task.detached(priority: .utility) { _ = await entitlementClient.refresh() }
      }
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
      // Logout semantics: the token is discarded and the cache cleared before
      // any read can return the previous person's grants.
      await entitlementClient?.identityChanged(
        bindingDigest: MosaicCustomerEntitlementFileCacheStore.bindingDigest(userID: nil),
        signedOut: true)
    }
  }

  /// Creates a new app-install identity and also clears user-bound state.
  public func resetInstallationIdentity() async throws {
    try await identityStore.resetInstallation()
    await configurationClient?.identityChanged(user: true, installation: true)
    await analyticsRuntime?.identityChanged()
    await entitlementClient?.identityChanged(
      bindingDigest: MosaicCustomerEntitlementFileCacheStore.bindingDigest(userID: nil),
      signedOut: true)
  }

  /// Applies the Environment owner/admin collection setting and a host-app
  /// runtime override. Both must be true. Turning either off cancels delivery
  /// and clears all unsent events; the host cannot override a disabled Environment.
  ///
  /// Collection is enabled by default, so this is the explicit opt-out path:
  /// `setAnalyticsCollection(hostEnabled: false)` declines collection without
  /// the host having to know the Environment setting. The Environment's
  /// server-side collection setting still gates ingestion regardless of what is
  /// set here. The host application remains responsible for obtaining whatever
  /// end-user consent its jurisdiction and app-store policies require before
  /// leaving collection enabled.
  public func setAnalyticsCollection(
    environmentEnabled: Bool = true,
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

  // MARK: - Authoritative entitlements
  //
  // These read Mosaic's server-side projection of what a Billing Customer is
  // entitled to. They are additive and independent of the provider-observed
  // surface (`purchaseProvider.activeEntitlements()`, entitlement targeting),
  // which is unchanged: provider-observed answers what this device's store
  // account shows, authoritative answers what Mosaic has validated for this
  // customer across their devices and platforms.
  //
  // All of it requires a `customerTokenProvider`, because Mosaic Billing
  // requires an application backend: a public SDK key identifies an application
  // and can never select a customer.

  /// Answers one focused access question. Never a bare boolean, and never
  /// `inactive` unless an accepted snapshot says so.
  public func checkCustomerEntitlement(_ key: String) async -> MosaicCustomerEntitlementCheck {
    guard let entitlementClient else {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: key, state: .unavailable(reason: .notConfigured), cacheState: .missing)
    }
    return await entitlementClient.check(key: key)
  }

  /// The full accepted snapshot and how fresh it is, or `nil` when none has been
  /// accepted for this customer.
  public func customerEntitlementSnapshot() async -> MosaicCustomerEntitlementSnapshotUpdate? {
    await entitlementClient?.snapshot()
  }

  /// A stream of accepted changes. Each subscriber gets its own stream and is
  /// replayed the current state on subscription.
  public func customerEntitlementUpdates() async
    -> AsyncStream<MosaicCustomerEntitlementUpdate>
  {
    guard let entitlementClient else {
      return AsyncStream { continuation in
        continuation.yield(.unavailable(.notConfigured))
        continuation.finish()
      }
    }
    return await entitlementClient.updates()
  }

  @discardableResult
  public func refreshCustomerEntitlements() async -> MosaicCustomerEntitlementRefreshResult {
    guard let entitlementClient else {
      return .unavailable(
        reason: .notConfigured,
        diagnostics: [
          MosaicDiagnostic(code: "entitlement_not_configured", stage: .entitlementValidation)
        ])
    }
    return await entitlementClient.refresh()
  }

  public func customerEntitlementDiagnostics() async -> MosaicCustomerEntitlementDiagnostics {
    guard let entitlementClient else { return .notConfigured }
    return await entitlementClient.diagnosticsSnapshot()
  }

  /// The current server-directed access-authority state, if one has been
  /// established. This metadata never substitutes for the stable access API.
  public func customerAccessAuthority() async -> MosaicCustomerAccessAuthorityUpdate? {
    await entitlementClient?.authorityState()
  }

  /// Replaying, bounded authority metadata updates for cutover and rollback UI.
  public func customerAccessAuthorityUpdates() async
    -> AsyncStream<MosaicCustomerAccessAuthorityUpdate>
  {
    guard let entitlementClient else {
      return AsyncStream { continuation in
        continuation.yield(.unavailable(reason: .authorityUnknown, minimumSupport: nil))
        continuation.finish()
      }
    }
    return await entitlementClient.authorityUpdates()
  }

  /// Runs a native restore and then waits, briefly and boundedly, for Mosaic to
  /// project it.
  ///
  /// The result reports both axes separately. `authoritativeEntitlementsUpdated`
  /// is true only when an accepted snapshot reflects the restore, so a host can
  /// tell "the store found your purchase" apart from "Mosaic has confirmed it".
  public func restoreAndSyncCustomerEntitlements() async -> MosaicRestoreAndSyncResult {
    let providerRestore: @Sendable () async -> MosaicRestoreResult = { [purchaseProvider] in
      await purchaseProvider.restore()
    }
    guard let entitlementClient else {
      let result = await providerRestore()
      return MosaicRestoreAndSyncResult(
        outcome: .identityUnresolved,
        stages: [.providerRestoreStarted, .providerRestoreFinished(result)],
        providerResult: result,
        authoritativeEntitlementsUpdated: false,
        snapshotVersion: nil,
        completedAt: Date())
    }
    return await MosaicCustomerRestoreCoordinator(client: entitlementClient)
      .run(restore: providerRestore)
  }

  /// Discards the held customer token and deletes this customer's cached
  /// snapshot. Installation identity is preserved.
  public func clearCustomerState() async {
    await entitlementClient?.clearCustomerState()
  }

  /// Refreshes authoritative entitlements after a purchase completes.
  ///
  /// Fire-and-forget by design: the refresh runs in a detached task so it is
  /// never a suspension point on the purchase path. A purchase must never be
  /// held open waiting for a projection, and a failed refresh must never change
  /// a purchase result.
  public func customerEntitlementsDidChangeAfterPurchase() {
    guard let entitlementClient else { return }
    Task.detached(priority: .utility) { _ = await entitlementClient.refresh() }
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
