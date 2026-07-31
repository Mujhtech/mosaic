import CryptoKit
import Foundation

public enum MosaicCommerceConfigurationSource: String, Sendable, Equatable {
  case remote
  case sdkLocal
  case cache
  case bundled
}

public enum MosaicCommerceConfigurationStatus: Sendable, Equatable {
  case available(
    configuration: MosaicCommerceConfiguration,
    source: MosaicCommerceConfigurationSource,
    diagnostics: [MosaicDiagnostic]
  )
  case unavailable(diagnostics: [MosaicDiagnostic])
}

public enum MosaicCommerceConfigurationAcceptance: Sendable, Equatable {
  case accepted(
    configuration: MosaicCommerceConfiguration,
    source: MosaicCommerceConfigurationSource
  )
  case preserved(
    configuration: MosaicCommerceConfiguration,
    source: MosaicCommerceConfigurationSource,
    diagnostic: MosaicDiagnostic
  )
  case unavailable(diagnostics: [MosaicDiagnostic])
}

struct MosaicCommerceConfigurationCacheRecord: Codable, Sendable, Equatable {
  let formatVersion: Int
  let association: MosaicCommerceConfigurationAssociation
  let data: Data
  let etag: String?
  let storedAt: Date

  init(
    association: MosaicCommerceConfigurationAssociation,
    data: Data,
    etag: String? = nil,
    storedAt: Date
  ) {
    formatVersion = 1
    self.association = association
    self.data = data
    self.etag = etag
    self.storedAt = storedAt
  }
}

protocol MosaicCommerceConfigurationCacheStore: Sendable {
  func load() async throws -> MosaicCommerceConfigurationCacheRecord?
  func save(_ record: MosaicCommerceConfigurationCacheRecord) async throws
}

actor MosaicCommerceConfigurationFileStore: MosaicCommerceConfigurationCacheStore {
  private let directory: URL
  private let fileURL: URL
  private let fileManager: FileManager

  init(
    cacheIdentifier: String,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) throws {
    let root: URL
    if let rootDirectory {
      root = rootDirectory
    } else if let applicationSupport = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first {
      root = applicationSupport
    } else {
      throw CocoaError(.fileNoSuchFile)
    }
    directory =
      root
      .appendingPathComponent("MosaicSDK", isDirectory: true)
      .appendingPathComponent("commerce-configuration-v1", isDirectory: true)
    fileURL = directory.appendingPathComponent(
      Self.namespace(cacheIdentifier) + ".json",
      isDirectory: false
    )
    self.fileManager = fileManager
  }

  func load() throws -> MosaicCommerceConfigurationCacheRecord? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
    let record = try JSONDecoder().decode(MosaicCommerceConfigurationCacheRecord.self, from: data)
    guard record.formatVersion == 1 else { throw CocoaError(.fileReadCorruptFile) }
    return record
  }

  func save(_ record: MosaicCommerceConfigurationCacheRecord) throws {
    try fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: nil
    )
    try JSONEncoder().encode(record).write(to: fileURL, options: .atomic)
  }

  private static func namespace(_ cacheIdentifier: String) -> String {
    SHA256.hash(data: Data(cacheIdentifier.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
  }
}

/// Resolves Commerce Configuration in fail-safe order:
/// accepted candidate, exact-association cache, bundled fallback, unavailable.
///
/// The manager never keeps configuration across a Configuration Release
/// association change. Saving completes atomically before a candidate becomes
/// the current value.
public actor MosaicCommerceConfigurationManager {
  private struct Accepted: Sendable {
    let configuration: MosaicCommerceConfiguration
    let source: MosaicCommerceConfigurationSource
    let etag: String?
  }

  private let store: any MosaicCommerceConfigurationCacheStore
  private let clock: @Sendable () -> Date
  private var association: MosaicCommerceConfigurationAssociation?
  private var accepted: Accepted?
  private var diagnostics: [MosaicDiagnostic] = []

  public init(
    cacheIdentifier: String,
    rootDirectory: URL? = nil
  ) throws {
    let normalized = cacheIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, normalized.count <= 256 else {
      throw MosaicCommerceConfigurationError.invalidShape(
        path: "cacheIdentifier",
        reason: "expected_non_empty_identifier"
      )
    }
    store = try MosaicCommerceConfigurationFileStore(
      cacheIdentifier: normalized,
      rootDirectory: rootDirectory
    )
    clock = { Date() }
  }

  init(
    store: any MosaicCommerceConfigurationCacheStore,
    clock: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.store = store
    self.clock = clock
  }

  @discardableResult
  public func bootstrap(
    association: MosaicCommerceConfigurationAssociation,
    bundledFallbackData: Data? = nil
  ) async -> MosaicCommerceConfigurationStatus {
    self.association = association
    accepted = nil
    diagnostics = []

    do {
      if let cachedRecord = try await store.load(), cachedRecord.association == association {
        do {
          let configuration = try MosaicCommerceConfigurationDecoder.decode(
            cachedRecord.data,
            association: association
          )
          accepted = Accepted(
            configuration: configuration,
            source: .cache,
            etag: cachedRecord.etag
          )
        } catch {
          record(code(error, fallback: "commerce_configuration_cache_rejected"))
        }
      }
    } catch {
      record("commerce_configuration_cache_read_failed")
    }

    if accepted == nil, let bundledFallbackData {
      do {
        let configuration = try MosaicCommerceConfigurationDecoder.decode(
          bundledFallbackData,
          association: association
        )
        accepted = Accepted(configuration: configuration, source: .bundled, etag: nil)
      } catch {
        record(code(error, fallback: "commerce_configuration_bundled_rejected"))
      }
    }
    return status()
  }

  public func accept(
    _ candidateData: Data,
    source: MosaicCommerceConfigurationSource,
    association: MosaicCommerceConfigurationAssociation
  ) async -> MosaicCommerceConfigurationAcceptance {
    guard source == .remote || source == .sdkLocal else {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_invalid_candidate_source",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }

    if self.association != association {
      self.association = association
      accepted = nil
      diagnostics = []
    }

    let configuration: MosaicCommerceConfiguration
    do {
      configuration = try MosaicCommerceConfigurationDecoder.decode(
        candidateData,
        association: association
      )
    } catch {
      let diagnostic = MosaicDiagnostic(
        code: code(error, fallback: "commerce_configuration_candidate_rejected"),
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }

    do {
      try await store.save(
        MosaicCommerceConfigurationCacheRecord(
          association: association,
          data: candidateData,
          storedAt: clock()
        )
      )
    } catch {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_cache_write_failed",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }

    accepted = Accepted(configuration: configuration, source: source, etag: nil)
    return .accepted(configuration: configuration, source: source)
  }

  public func refresh(
    publicSDKKey: String,
    baseURL: URL,
    association: MosaicCommerceConfigurationAssociation,
    requestTimeout: TimeInterval = 5
  ) async -> MosaicCommerceConfigurationAcceptance {
    let normalizedKey = publicSDKKey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedKey.isEmpty,
      requestTimeout.isFinite,
      (1...30).contains(requestTimeout),
      let scheme = baseURL.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      baseURL.host?.isEmpty == false,
      baseURL.user == nil,
      baseURL.password == nil,
      baseURL.query == nil,
      baseURL.fragment == nil
    else {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_invalid_request",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }

    if self.association != association {
      self.association = association
      accepted = nil
      diagnostics = []
    }

    var components = URLComponents(
      url:
        baseURL
        .appendingPathComponent("v1", isDirectory: true)
        .appendingPathComponent("sdk", isDirectory: true)
        .appendingPathComponent("commerce-configuration", isDirectory: false),
      resolvingAgainstBaseURL: false
    )
    components?.queryItems = [
      URLQueryItem(name: "applicationId", value: association.applicationID)
    ]
    guard let url = components?.url else {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_invalid_request",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }

    var headers = [
      "Accept": mosaicCommerceConfigurationAcceptedMediaTypes,
      "Authorization": "Bearer \(normalizedKey)",
      "Mosaic-SDK-Platform": "ios",
      "Mosaic-SDK-Version": mosaicSDKVersion,
      "Mosaic-Commerce-Configuration-Versions":
        mosaicSupportedCommerceConfigurationVersions.joined(separator: ","),
      "Mosaic-Commerce-Provider-Contract-Versions":
        mosaicSupportedCommerceProviderContractVersions.joined(separator: ","),
    ]
    if let etag = accepted?.etag {
      headers["If-None-Match"] = etag
    }

    let response: MosaicCommerceConfigurationHTTPResponse
    do {
      response = try await MosaicURLSessionCommerceConfigurationTransport(
        requestTimeout: requestTimeout
      ).fetch(
        MosaicCommerceConfigurationHTTPRequest(
          url: url,
          headers: headers,
          timeout: requestTimeout
        )
      )
    } catch {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_network_unavailable",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }
    return await acceptHostedResponse(response, association: association)
  }

  func refresh(
    publicSDKKey: String,
    baseURL: URL,
    association: MosaicCommerceConfigurationAssociation,
    requestTimeout: TimeInterval,
    transport: any MosaicCommerceConfigurationTransport
  ) async -> MosaicCommerceConfigurationAcceptance {
    var components = URLComponents(
      url:
        baseURL
        .appendingPathComponent("v1", isDirectory: true)
        .appendingPathComponent("sdk", isDirectory: true)
        .appendingPathComponent("commerce-configuration", isDirectory: false),
      resolvingAgainstBaseURL: false
    )
    components?.queryItems = [
      URLQueryItem(name: "applicationId", value: association.applicationID)
    ]
    guard let url = components?.url else {
      return .unavailable(
        diagnostics: [
          MosaicDiagnostic(code: "commerce_configuration_invalid_request", stage: .commerce)
        ]
      )
    }
    var headers = [
      "Accept": mosaicCommerceConfigurationAcceptedMediaTypes,
      "Authorization": "Bearer \(publicSDKKey)",
      "Mosaic-SDK-Platform": "ios",
      "Mosaic-SDK-Version": mosaicSDKVersion,
      "Mosaic-Commerce-Configuration-Versions":
        mosaicSupportedCommerceConfigurationVersions.joined(separator: ","),
      "Mosaic-Commerce-Provider-Contract-Versions":
        mosaicSupportedCommerceProviderContractVersions.joined(separator: ","),
    ]
    if let etag = accepted?.etag { headers["If-None-Match"] = etag }
    do {
      let response = try await transport.fetch(
        MosaicCommerceConfigurationHTTPRequest(
          url: url,
          headers: headers,
          timeout: requestTimeout
        )
      )
      return await acceptHostedResponse(response, association: association)
    } catch {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_network_unavailable",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }
  }

  private func acceptHostedResponse(
    _ response: MosaicCommerceConfigurationHTTPResponse,
    association: MosaicCommerceConfigurationAssociation
  ) async -> MosaicCommerceConfigurationAcceptance {
    guard response.configurationReleaseID == association.configurationReleaseID else {
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_release_header_mismatch",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }
    switch response.statusCode {
    case 304:
      guard response.data.isEmpty,
        let accepted,
        let etag = accepted.etag,
        response.etag == etag
      else {
        let diagnostic = MosaicDiagnostic(
          code: "commerce_configuration_unexpected_not_modified",
          stage: .commerce
        )
        record(diagnostic)
        return preserveOrUnavailable(diagnostic)
      }
      return .accepted(configuration: accepted.configuration, source: accepted.source)
    case 200:
      guard [mosaicCommerceConfigurationMediaType, mosaicCommerceConfigurationMediaTypeV2]
        .contains(response.contentType),
        let etag = response.etag,
        etag.range(
          of: "^\"sha256:[a-f0-9]{64}\"$",
          options: .regularExpression
        ) != nil
      else {
        let diagnostic = MosaicDiagnostic(
          code: "commerce_configuration_invalid_response_metadata",
          stage: .commerce
        )
        record(diagnostic)
        return preserveOrUnavailable(diagnostic)
      }
      let configuration: MosaicCommerceConfiguration
      do {
        configuration = try MosaicCommerceConfigurationDecoder.decode(
          response.data,
          association: association
        )
      } catch {
        let diagnostic = MosaicDiagnostic(
          code: code(error, fallback: "commerce_configuration_candidate_rejected"),
          stage: .commerce
        )
        record(diagnostic)
        return preserveOrUnavailable(diagnostic)
      }
      guard etag == "\"\(configuration.contentDigest)\"" else {
        let diagnostic = MosaicDiagnostic(
          code: "commerce_configuration_etag_digest_mismatch",
          stage: .commerce
        )
        record(diagnostic)
        return preserveOrUnavailable(diagnostic)
      }
      do {
        try await store.save(
          MosaicCommerceConfigurationCacheRecord(
            association: association,
            data: response.data,
            etag: etag,
            storedAt: clock()
          )
        )
      } catch {
        let diagnostic = MosaicDiagnostic(
          code: "commerce_configuration_cache_write_failed",
          stage: .commerce
        )
        record(diagnostic)
        return preserveOrUnavailable(diagnostic)
      }
      accepted = Accepted(configuration: configuration, source: .remote, etag: etag)
      return .accepted(configuration: configuration, source: .remote)
    default:
      let diagnostic = MosaicDiagnostic(
        code: "commerce_configuration_http_\(response.statusCode)",
        stage: .commerce
      )
      record(diagnostic)
      return preserveOrUnavailable(diagnostic)
    }
  }

  public func status() -> MosaicCommerceConfigurationStatus {
    guard let accepted else {
      return .unavailable(diagnostics: diagnostics)
    }
    return .available(
      configuration: accepted.configuration,
      source: accepted.source,
      diagnostics: diagnostics
    )
  }

  private func preserveOrUnavailable(
    _ diagnostic: MosaicDiagnostic
  ) -> MosaicCommerceConfigurationAcceptance {
    guard let accepted else {
      return .unavailable(diagnostics: diagnostics)
    }
    return .preserved(
      configuration: accepted.configuration,
      source: accepted.source,
      diagnostic: diagnostic
    )
  }

  private func record(_ code: String) {
    record(MosaicDiagnostic(code: code, stage: .commerce))
  }

  private func record(_ diagnostic: MosaicDiagnostic) {
    if !diagnostics.contains(diagnostic) {
      diagnostics.append(diagnostic)
    }
  }

  private func code(_ error: Error, fallback: String) -> String {
    (error as? MosaicCommerceConfigurationError)?.diagnosticCode ?? fallback
  }
}
