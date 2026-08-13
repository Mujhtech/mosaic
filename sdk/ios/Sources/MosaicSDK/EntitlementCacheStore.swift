import CryptoKit
import Foundation

enum MosaicCustomerEntitlementCacheInvalidationReason: String, Codable, Sendable, Equatable {
  case policyUnavailable
}

struct MosaicCustomerEntitlementCacheInvalidation: Codable, Sendable, Equatable {
  let reason: MosaicCustomerEntitlementCacheInvalidationReason
  let scope: MosaicCustomerAccessAuthorityScope
  let invalidatedAt: Date
}

/// One accepted snapshot or durable access-invalidation marker at rest.
///
/// Snapshot bytes are kept alongside binding members and re-decoded verbatim.
/// A policy tombstone uses the same atomic record replacement so a restart can
/// never replay the active snapshot that preceded the invalidation.
struct MosaicCustomerEntitlementCacheRecord: Codable, Sendable, Equatable {
  var formatVersion = 1
  var recordData: Data
  var billingCustomerID: String
  var projectID: String
  var environmentID: String
  var snapshotVersion: Int64
  var issuedAt: Date
  var asOf: Date
  var refreshAfter: Date
  var validUntil: Date
  var staleGraceSeconds: Int
  var entityTag: String
  var storedAt: Date
  var serverTime: Date?
  var localReceiptTime: Date?
  var systemUptime: TimeInterval?
  var applicationID: String? = nil
  var platform: MosaicCustomerAccessPlatform? = nil
  var authority: MosaicCustomerAccessAuthority? = nil
  var snapshotAuthorityDigest: String? = nil
  var minimumSupport: MosaicCustomerMinimumAccessSupport? = nil
  var invalidation: MosaicCustomerEntitlementCacheInvalidation? = nil
  /// Corruption detection, **not** authentication. It catches a truncated
  /// write, a half-flushed page, or a file edited on a jailbroken device; it
  /// proves nothing about origin, because anyone can recompute it. The
  /// snapshot's own `contentDigest` is what binds the document to a customer.
  var checksum: String

  static func checksum(
    recordData: Data, billingCustomerID: String, projectID: String, environmentID: String,
    snapshotVersion: Int64,
    applicationID: String? = nil,
    platform: MosaicCustomerAccessPlatform? = nil,
    authority: MosaicCustomerAccessAuthority? = nil,
    snapshotAuthorityDigest: String? = nil,
    invalidation: MosaicCustomerEntitlementCacheInvalidation? = nil
  ) -> String {
    var material = Data()
    material.append(recordData)
    material.append(
      Data(
        "\n\(billingCustomerID)\n\(projectID)\n\(environmentID)\n\(snapshotVersion)".utf8))
    if let applicationID, let platform, let authority, let snapshotAuthorityDigest {
      material.append(
        Data(
          "\n\(applicationID)\n\(platform.rawValue)\n\(authority.epoch)\n\(authority.kind.rawValue)\n\(authority.transitionState.rawValue)\n\(snapshotAuthorityDigest)"
            .utf8))
    }
    if let invalidation {
      material.append(
        Data(
          "\ninvalidated\n\(invalidation.reason.rawValue)\n\(invalidation.scope.projectID)\n\(invalidation.scope.environmentID)\n\(invalidation.scope.applicationID)\n\(invalidation.scope.platform.rawValue)\n\(invalidation.invalidatedAt.timeIntervalSinceReferenceDate)"
            .utf8))
    }
    return SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
  }

  var isIntact: Bool {
    checksum
      == Self.checksum(
        recordData: recordData, billingCustomerID: billingCustomerID, projectID: projectID,
        environmentID: environmentID, snapshotVersion: snapshotVersion,
        applicationID: applicationID, platform: platform, authority: authority,
        snapshotAuthorityDigest: snapshotAuthorityDigest, invalidation: invalidation)
  }

  var isPolicyUnavailableTombstone: Bool {
    formatVersion == 3 && invalidation?.reason == .policyUnavailable
  }

  var binding: MosaicCustomerSnapshotBinding {
    MosaicCustomerSnapshotBinding(
      // One contract version, whether or not the record carried authority
      // material (ADR-0028).
      contractVersion: mosaicAuthoritativeEntitlementContractVersion,
      billingCustomerID: billingCustomerID, projectID: projectID, environmentID: environmentID,
      snapshotVersion: snapshotVersion, asOf: asOf, contentDigestValid: true)
  }
}

protocol MosaicCustomerEntitlementCacheStore: Sendable {
  func load() async throws -> MosaicCustomerEntitlementCacheRecord?
  func save(_ record: MosaicCustomerEntitlementCacheRecord) async throws
  func clear() async throws
}

/// Degraded persistence, and the store the tests use. The SDK stays correct for
/// the process lifetime; nothing survives relaunch.
actor MosaicCustomerEntitlementMemoryCacheStore: MosaicCustomerEntitlementCacheStore {
  private var record: MosaicCustomerEntitlementCacheRecord?
  private(set) var saveCount = 0
  private(set) var clearCount = 0

  init(record: MosaicCustomerEntitlementCacheRecord? = nil) { self.record = record }

  func load() -> MosaicCustomerEntitlementCacheRecord? { record }

  func save(_ record: MosaicCustomerEntitlementCacheRecord) {
    self.record = record
    saveCount += 1
  }

  func clear() {
    record = nil
    clearCount += 1
  }
}

/// The on-disk entitlement cache.
///
/// Three properties matter and each is deliberate:
///
/// - The **customer binding digest is part of the file name**, so two customers
///   on one device can never share a file and a stale read cannot return the
///   previous person's grants.
/// - The directory and the file are **excluded from backup**. An entitlement
///   cache restored onto a second device from an iCloud backup would carry one
///   person's access into another device's session, and it is derived state
///   that Mosaic can always reissue.
/// - The file is protected `completeUntilFirstUserAuthentication`, which is the
///   strongest class compatible with a launch-time read on a locked device.
actor MosaicCustomerEntitlementFileCacheStore: MosaicCustomerEntitlementCacheStore {
  /// Two customers' files are kept: the current one and the previous one, so
  /// the common "switch back to my other account" flow does not re-sync from
  /// nothing. Anything older is a device that has hosted several people and has
  /// no business holding their billing state.
  static let retainedCustomerFiles = 2

  private let directory: URL
  private let fileURL: URL
  private let fileManager: FileManager

  init(
    baseURL: URL,
    publicSDKKey: String,
    customerBindingDigest: String,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) throws {
    guard
      let root = rootDirectory
        ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    else { throw CocoaError(.fileNoSuchFile) }
    directory =
      root
      .appendingPathComponent("MosaicSDK", isDirectory: true)
      .appendingPathComponent("entitlements-v1", isDirectory: true)
    let normalizedURL = baseURL.absoluteString.trimmingCharacters(
      in: CharacterSet(charactersIn: "/"))
    let material = Data("\(normalizedURL)\n\(publicSDKKey)\n\(customerBindingDigest)".utf8)
    let name = SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
    fileURL = directory.appendingPathComponent(name + ".json", isDirectory: false)
    self.fileManager = fileManager
  }

  /// Digests the host's identity for a customer into a cache namespace. The raw
  /// user identifier never reaches the file system.
  static func bindingDigest(userID: String?) -> String {
    let material = Data("mosaic.entitlements.v1\n\(userID ?? "")".utf8)
    return SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
  }

  func load() throws -> MosaicCustomerEntitlementCacheRecord? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    let record = try JSONDecoder().decode(
      MosaicCustomerEntitlementCacheRecord.self,
      from: Data(contentsOf: fileURL, options: .mappedIfSafe))
    guard (1...3).contains(record.formatVersion) else {
      throw CocoaError(.fileReadCorruptFile)
    }
    if record.formatVersion < 3, record.invalidation != nil {
      throw CocoaError(.fileReadCorruptFile)
    }
    if record.formatVersion == 2 {
      guard record.applicationID != nil, record.platform != nil, record.authority != nil,
        record.snapshotAuthorityDigest != nil, record.minimumSupport != nil
      else { throw CocoaError(.fileReadCorruptFile) }
    }
    if record.formatVersion == 3 {
      guard let invalidation = record.invalidation,
        invalidation.reason == .policyUnavailable,
        record.applicationID == invalidation.scope.applicationID,
        record.platform == invalidation.scope.platform,
        record.projectID == invalidation.scope.projectID,
        record.environmentID == invalidation.scope.environmentID,
        record.authority == nil,
        record.snapshotAuthorityDigest == nil,
        record.minimumSupport == nil
      else { throw CocoaError(.fileReadCorruptFile) }
    }
    // A corrupt cache is not a customer state. It is discarded and reported as
    // `invalid`, which resolves to `unknown`, never `inactive`.
    guard record.isIntact else { throw CocoaError(.fileReadCorruptFile) }
    return record
  }

  func save(_ record: MosaicCustomerEntitlementCacheRecord) throws {
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    var resource = URLResourceValues()
    resource.isExcludedFromBackup = true
    var mutableDirectory = directory
    try? mutableDirectory.setResourceValues(resource)
    // `.atomic` writes to a temporary file and renames, so an interrupted write
    // leaves the previous accepted snapshot intact rather than a half-file.
    try JSONEncoder().encode(record).write(to: fileURL, options: .atomic)
    var mutableFile = fileURL
    try? mutableFile.setResourceValues(resource)
    #if os(iOS) || os(tvOS) || os(watchOS) || os(visionOS)
      try? fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: fileURL.path)
    #endif
    pruneOtherCustomers()
  }

  func clear() throws {
    guard fileManager.fileExists(atPath: fileURL.path) else { return }
    try fileManager.removeItem(at: fileURL)
  }

  /// Keeps the most recently written customer files and removes the rest, so a
  /// shared or resold device does not accumulate every person who ever signed
  /// in to the app.
  private func pruneOtherCustomers() {
    guard
      let names = try? fileManager.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
    else { return }
    let files = names.filter { $0.pathExtension == "json" }
    guard files.count > Self.retainedCustomerFiles else { return }
    let dated = files.map { url -> (URL, Date) in
      let modified =
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
        .contentModificationDate ?? .distantPast
      return (url, modified)
    }
    .sorted { $0.1 > $1.1 }
    for (url, _) in dated.dropFirst(Self.retainedCustomerFiles) {
      try? fileManager.removeItem(at: url)
    }
  }
}
