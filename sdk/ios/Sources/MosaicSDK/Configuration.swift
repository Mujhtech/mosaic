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

  private init(
    configuration: MosaicConfiguration,
    purchaseProvider: any MosaicPurchaseProvider,
    configurationClient: MosaicConfigurationClient? = nil
  ) {
    self.configuration = configuration
    self.purchaseProvider = purchaseProvider
    self.configurationClient = configurationClient
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
      configurationClient: client
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
