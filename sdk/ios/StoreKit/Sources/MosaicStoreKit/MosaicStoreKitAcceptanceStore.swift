import CryptoKit
import Foundation

public protocol MosaicStoreKitAcceptanceStore: Sendable {
  func contains(_ updateID: String) async throws -> Bool
  func insert(_ updateID: String) async throws
}

public actor MosaicStoreKitFileAcceptanceStore: MosaicStoreKitAcceptanceStore {
  private let fileURL: URL
  private var accepted: Set<String>

  public init(fileURL: URL) throws {
    self.fileURL = fileURL
    if FileManager.default.fileExists(atPath: fileURL.path) {
      let data = try Data(contentsOf: fileURL)
      accepted = try JSONDecoder().decode(Set<String>.self, from: data)
    } else {
      accepted = []
    }
  }

  public static func defaultStore(
    identifier: String = Bundle.main.bundleIdentifier ?? "mosaic-host"
  ) throws -> MosaicStoreKitFileAcceptanceStore {
    let root = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first ?? FileManager.default.temporaryDirectory
    let digest = SHA256.hash(data: Data(identifier.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
    return try MosaicStoreKitFileAcceptanceStore(
      fileURL:
        root
        .appendingPathComponent("MosaicSDK", isDirectory: true)
        .appendingPathComponent("StoreKit", isDirectory: true)
        .appendingPathComponent("\(digest).json", isDirectory: false)
    )
  }

  public func contains(_ updateID: String) -> Bool {
    accepted.contains(updateID)
  }

  public func insert(_ updateID: String) throws {
    guard accepted.insert(updateID).inserted else { return }
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try JSONEncoder().encode(accepted).write(to: fileURL, options: .atomic)
  }
}
