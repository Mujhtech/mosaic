import CryptoKit
import Foundation

public protocol MosaicStoreKitAcceptanceStore: Sendable {
  func contains(_ updateID: String) async throws -> Bool
  func insert(_ updateID: String) async throws
}

public enum MosaicStoreKitAcceptanceStoreError: Error, Equatable {
  /// No directory that survives an OS purge is available for the acceptance
  /// set. The caller decides how to degrade; the store will not silently write
  /// duplicate-suppression state somewhere the system may delete.
  case durableStorageUnavailable
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
    // Deliberately not `temporaryDirectory`. This set is what stops one
    // transaction being delivered to the host twice, and the OS may purge tmp
    // at any time, so a purge would silently re-deliver purchases. Application
    // Support is the only acceptable location; without it the caller is told.
    guard
      let root = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      ).first
    else {
      throw MosaicStoreKitAcceptanceStoreError.durableStorageUnavailable
    }
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
    let directory = fileURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    // Correctness, not housekeeping. This set is what stops one transaction
    // being delivered to the host twice. Restored onto a second device from a
    // backup it would suppress legitimate first-time delivery there, and
    // restored onto a wiped device it would claim transactions the host has
    // never actually seen.
    var resource = URLResourceValues()
    resource.isExcludedFromBackup = true
    var mutableDirectory = directory
    try? mutableDirectory.setResourceValues(resource)
    try JSONEncoder().encode(accepted).write(to: fileURL, options: .atomic)
    var mutableFile = fileURL
    try? mutableFile.setResourceValues(resource)
  }
}
