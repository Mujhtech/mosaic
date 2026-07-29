import Foundation
import XCTest

@testable import MosaicSDK

final class CustomerEntitlementCacheStoreTests: XCTestCase {
  private var root: URL!

  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory
      .appendingPathComponent("mosaic-entitlement-cache-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: root)
  }

  private func store(customer: String) throws -> MosaicCustomerEntitlementFileCacheStore {
    try MosaicCustomerEntitlementFileCacheStore(
      baseURL: URL(string: "https://api.example.com")!,
      publicSDKKey: "pk_test",
      customerBindingDigest: MosaicCustomerEntitlementFileCacheStore.bindingDigest(
        userID: customer),
      rootDirectory: root)
  }

  private func record(
    customer: String = "fixture-customer-0001", version: Int64 = 4, data: Data = Data("{}".utf8)
  ) -> MosaicCustomerEntitlementCacheRecord {
    MosaicCustomerEntitlementCacheRecord(
      recordData: data,
      billingCustomerID: customer,
      projectID: "fixture-project-mosaic",
      environmentID: "fixture-environment-production",
      snapshotVersion: version,
      issuedAt: Date(timeIntervalSince1970: 1_000),
      asOf: Date(timeIntervalSince1970: 990),
      refreshAfter: Date(timeIntervalSince1970: 4_600),
      validUntil: Date(timeIntervalSince1970: 605_800),
      staleGraceSeconds: 86_400,
      entityTag: "cs-0001-v4",
      storedAt: Date(timeIntervalSince1970: 1_000),
      serverTime: nil,
      localReceiptTime: nil,
      systemUptime: nil,
      checksum: MosaicCustomerEntitlementCacheRecord.checksum(
        recordData: data, billingCustomerID: customer, projectID: "fixture-project-mosaic",
        environmentID: "fixture-environment-production", snapshotVersion: version))
  }

  func testRoundTrip() async throws {
    let store = try store(customer: "user-a")
    let written = record()
    try await store.save(written)
    let loaded = try await store.load()
    XCTAssertEqual(loaded, written)
  }

  // Risk: an entitlement cache restored onto a second device from an iCloud
  // backup carries one person's access into another device's session. Apple also
  // rejects apps that back up regenerable caches. Both the directory and the
  // file must carry the flag; setting it on only one is the common mistake.
  func testCacheDirectoryAndFileAreExcludedFromBackup() async throws {
    let store = try store(customer: "user-a")
    try await store.save(record())

    let directory = root.appendingPathComponent("MosaicSDK/entitlements-v1", isDirectory: true)
    let files = try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "json" }
    XCTAssertEqual(files.count, 1)

    XCTAssertEqual(
      try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true,
      "the entitlements directory must be excluded from backup")
    XCTAssertEqual(
      try files[0].resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true,
      "the entitlement cache file must be excluded from backup")
  }

  // Risk: two customers sharing a cache file is the entitlement leak the whole
  // binding design exists to prevent.
  func testEachCustomerGetsItsOwnFile() async throws {
    try await store(customer: "user-a").save(record(customer: "customer-a"))
    try await store(customer: "user-b").save(record(customer: "customer-b"))

    let loadedA = try await store(customer: "user-a").load()
    let loadedB = try await store(customer: "user-b").load()
    XCTAssertEqual(loadedA?.billingCustomerID, "customer-a")
    XCTAssertEqual(loadedB?.billingCustomerID, "customer-b")
  }

  // Risk: a device that has hosted several people should not keep every one of
  // their billing states indefinitely.
  func testPruningRetainsOnlyTheTwoMostRecentCustomers() async throws {
    for name in ["user-a", "user-b", "user-c"] {
      try await store(customer: name).save(record(customer: name))
      // Modification-time ordering needs to be observable on a coarse clock.
      try await Task.sleep(for: .milliseconds(1_100))
    }

    let directory = root.appendingPathComponent("MosaicSDK/entitlements-v1", isDirectory: true)
    let files = try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "json" }
    XCTAssertEqual(files.count, MosaicCustomerEntitlementFileCacheStore.retainedCustomerFiles)

    // The oldest customer is gone; the two most recent survive.
    let oldest = try await store(customer: "user-a").load()
    XCTAssertNil(oldest)
    let newest = try await store(customer: "user-c").load()
    XCTAssertEqual(newest?.billingCustomerID, "user-c")
  }

  // Risk: a corrupt cache must never be read as customer state. It is discarded
  // and reported as invalid, which resolves to `unknown` — never `inactive`.
  func testCorruptFileIsRejectedRatherThanPartiallyRead() async throws {
    let store = try store(customer: "user-a")
    try await store.save(record())

    let directory = root.appendingPathComponent("MosaicSDK/entitlements-v1", isDirectory: true)
    let file = try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: nil
    ).first { $0.pathExtension == "json" }!
    try Data("{\"formatVersion\":1,\"recordData\"".utf8).write(to: file)

    do {
      _ = try await store.load()
      XCTFail("a truncated cache file must not decode")
    } catch {}
  }

  // Risk: bit-rot or an edited file on a jailbroken device could otherwise
  // promote a stale snapshot version, defeating the monotonicity gate.
  func testTamperedChecksumIsRejected() async throws {
    let store = try store(customer: "user-a")
    var tampered = record()
    tampered.snapshotVersion = 9_999
    try await store.save(tampered)

    do {
      _ = try await store.load()
      XCTFail("a record whose checksum does not cover its contents must not load")
    } catch {}
  }

  func testClearRemovesTheFile() async throws {
    let store = try store(customer: "user-a")
    try await store.save(record())
    try await store.clear()
    let loaded = try await store.load()
    XCTAssertNil(loaded)
  }
}
