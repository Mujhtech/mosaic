import CryptoKit
import Foundation

struct MosaicConfigurationCacheRecord: Codable, Sendable, Equatable {
  let formatVersion: Int
  let etag: String
  let releaseData: Data
  let storedAt: Date
  let refreshAfter: Date
  let serverTime: Date?
  let localReceiptTime: Date?
  let systemUptime: TimeInterval?

  init(
    etag: String,
    releaseData: Data,
    storedAt: Date,
    refreshAfter: Date,
    serverTime: Date? = nil,
    localReceiptTime: Date? = nil,
    systemUptime: TimeInterval? = nil
  ) {
    formatVersion = 2
    self.etag = etag
    self.releaseData = releaseData
    self.storedAt = storedAt
    self.refreshAfter = refreshAfter
    self.serverTime = serverTime
    self.localReceiptTime = localReceiptTime
    self.systemUptime = systemUptime
  }
}

protocol MosaicConfigurationCacheStore: Sendable {
  func load() async throws -> MosaicConfigurationCacheRecord?
  func save(_ record: MosaicConfigurationCacheRecord) async throws
}

actor MosaicConfigurationFileStore: MosaicConfigurationCacheStore {
  private let directory: URL
  private let fileURL: URL
  private let fileManager: FileManager

  init(
    baseURL: URL,
    publicSDKKey: String,
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
      .appendingPathComponent("configuration-v1", isDirectory: true)
    fileURL = directory.appendingPathComponent(
      Self.namespace(baseURL: baseURL, publicSDKKey: publicSDKKey) + ".json",
      isDirectory: false
    )
    self.fileManager = fileManager
  }

  func load() throws -> MosaicConfigurationCacheRecord? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    let data = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
    let record = try JSONDecoder().decode(MosaicConfigurationCacheRecord.self, from: data)
    guard record.formatVersion == 1 || record.formatVersion == 2 else {
      throw CocoaError(.fileReadCorruptFile)
    }
    return record
  }

  func save(_ record: MosaicConfigurationCacheRecord) throws {
    try fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: nil
    )
    let data = try JSONEncoder().encode(record)
    try data.write(to: fileURL, options: .atomic)
  }

  private static func namespace(baseURL: URL, publicSDKKey: String) -> String {
    let normalizedBaseURL = baseURL.absoluteString.trimmingCharacters(
      in: CharacterSet(charactersIn: "/"))
    let material = Data("\(normalizedBaseURL)\n\(publicSDKKey)".utf8)
    let hash = SHA256.hash(data: material)
    return hash.map { String(format: "%02x", $0) }.joined()
  }
}
