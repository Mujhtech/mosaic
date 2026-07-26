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

  private init(
    configuration: MosaicConfiguration,
    purchaseProvider: any MosaicPurchaseProvider,
    configurationClient: MosaicConfigurationClient? = nil,
    identityStore: MosaicIdentityStore = MosaicIdentityStore(
      persistence: MosaicMemoryIdentityPersistence())
  ) {
    self.configuration = configuration
    self.purchaseProvider = purchaseProvider
    self.configurationClient = configurationClient
    self.identityStore = identityStore
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

  public static func configure(
    publicSDKKey: String,
    baseURL: URL,
    applicationVersion: String? = nil,
    requestTimeout: TimeInterval = 5,
    bundledFallback: MosaicConfigurationBundledFallback = .packaged,
    purchaseProvider: any MosaicPurchaseProvider
  ) async throws -> Mosaic {
    let configuration = try MosaicConfiguration(
      apiKey: publicSDKKey,
      endpoint: baseURL,
      applicationVersion: applicationVersion,
      requestTimeout: requestTimeout
    )
    let store = try MosaicConfigurationFileStore(
      baseURL: baseURL,
      publicSDKKey: configuration.apiKey
    )
    let client = MosaicConfigurationClient(
      publicSDKKey: configuration.apiKey,
      baseURL: baseURL,
      applicationVersion: configuration.applicationVersion,
      requestTimeout: configuration.requestTimeout,
      bundledFallback: bundledFallback,
      transport: MosaicURLSessionConfigurationTransport(requestTimeout: requestTimeout),
      store: store
    )
    await client.bootstrap()
    _ = await client.refresh()
    return Mosaic(
      configuration: configuration,
      purchaseProvider: purchaseProvider,
      configurationClient: client,
      identityStore: MosaicIdentityStore(
        persistence: try MosaicIdentityFilePersistence(
          baseURL: baseURL,
          publicSDKKey: configuration.apiKey
        )
      )
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
    guard let configurationClient else {
      return .configurationUnavailable(diagnostics: [
        MosaicDiagnostic(code: "delivery_not_configured", stage: .placement)
      ])
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
    return await configurationClient.decide(
      placement: placement, context: context, identity: identity)
  }

  public func identity() async -> MosaicIdentitySnapshot { await identityStore.snapshot() }

  public func identify(userID: String) async throws { try await identityStore.identify(userID) }

  public func setUserAttributes(_ attributes: [String: MosaicTypedValue]) async throws {
    let definitions = await configurationClient?.attributeDefinitions()
    try await identityStore.replaceAttributes(attributes, definitions: definitions)
  }

  /// Clears user identity, attributes and user-bound decision material while retaining the installation ID.
  public func resetIdentity() async throws { try await identityStore.resetUser() }

  /// Creates a new app-install identity and also clears user-bound state.
  public func resetInstallationIdentity() async throws {
    try await identityStore.resetInstallation()
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
