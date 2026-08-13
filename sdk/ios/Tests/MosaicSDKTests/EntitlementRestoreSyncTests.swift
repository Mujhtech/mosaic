import Foundation
import XCTest

@testable import MosaicSDK

private actor ScriptedSyncTransport: MosaicEntitlementSyncTransport {
  private var responses: [MosaicEntitlementSyncHTTPResponse]
  private(set) var requestCount = 0

  init(_ responses: [MosaicEntitlementSyncHTTPResponse]) { self.responses = responses }

  func fetch(_: MosaicEntitlementSyncHTTPRequest) async throws
    -> MosaicEntitlementSyncHTTPResponse
  {
    requestCount += 1
    guard !responses.isEmpty else { throw URLError(.badServerResponse) }
    return responses.count > 1 ? responses.removeFirst() : responses[0]
  }
}

final class EntitlementRestoreSyncTests: XCTestCase {
  private let baseURL = URL(string: "https://api.example.com")!

  private func snapshotData(_ name: String) throws -> Data {
    try entitlementSnapshotData(name)
  }

  private func ok(_ data: Data) -> MosaicEntitlementSyncHTTPResponse {
    .init(statusCode: 200, data: data)
  }

  private func makeClient(
    transport: any MosaicEntitlementSyncTransport, now: Date
  ) -> MosaicCustomerEntitlementClient {
    MosaicCustomerEntitlementClient(
      publicSDKKey: "pk_test",
      baseURL: baseURL,
      requestTimeout: 5,
      transport: transport,
      tokenStore: MosaicCustomerTokenStore(
        provider: MosaicStaticCustomerTokenProvider(
          token: MosaicCustomerAccessToken("mcat_test")),
        clock: { now }),
      bindingDigest: "digest-a",
      cacheStoreFactory: { _ in MosaicCustomerEntitlementMemoryCacheStore() },
      clock: { now })
  }

  private func coordinator(_ client: MosaicCustomerEntitlementClient)
    -> MosaicCustomerRestoreCoordinator
  {
    // No real sleeping: the poll budget is a product decision, not something a
    // test should spend six seconds proving.
    MosaicCustomerRestoreCoordinator(client: client, sleep: { _ in })
  }

  private static let proEntitlement: Set<MosaicEntitlement> = [MosaicEntitlement(id: "pro")]
  private var proEntitlement: Set<MosaicEntitlement> { Self.proEntitlement }

  // Risk: the central rule of the restore contract. A successful native restore
  // whose facts Mosaic has not validated yet is not restored access, and
  // reporting it as restored is how a restore flow starts lying: the customer is
  // told they have access, the next snapshot says otherwise, and it looks like
  // Mosaic took it away.
  func testRestoredRequiresAnAcceptedSnapshotThatReflectsTheRestore() async throws {
    // Mosaic keeps answering with the same pre-restore snapshot version.
    let transport = ScriptedSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let now = try contractTimestamp("2026-07-28T12:30:00.000Z")
    let client = makeClient(transport: transport, now: now)
    _ = await client.refresh()

    let result = await coordinator(client).run { .restored(Self.proEntitlement) }

    XCTAssertEqual(result.outcome, .validationPending(attempts: 3))
    XCTAssertFalse(
      result.authoritativeEntitlementsUpdated,
      "no accepted snapshot reflects the restore, so nothing was authoritatively updated")
    // The provider's own answer is carried verbatim, never merged into the
    // authoritative outcome.
    XCTAssertEqual(result.providerResult, .restored(proEntitlement))
  }

  // Risk: the poll must be bounded. An unbounded wait blocks the restore button
  // forever when validation is slow or Mosaic is down.
  func testValidationPollIsBoundedByTheCrossPlatformBudget() async throws {
    let transport = ScriptedSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let now = try contractTimestamp("2026-07-28T12:30:00.000Z")
    let client = makeClient(transport: transport, now: now)
    _ = await client.refresh()

    let result = await coordinator(client).run { .restored(Self.proEntitlement) }

    XCTAssertEqual(result.outcome, .validationPending(attempts: 3))
    let requests = await transport.requestCount
    // One priming refresh plus exactly the budgeted attempts.
    XCTAssertEqual(requests, 1 + MosaicCustomerEntitlementPolicy.restorePollAttempts)
  }

  // Risk: when Mosaic *does* project the restore, the SDK must say so, and the
  // evidence is the advanced snapshot version.
  func testAcceptedNewerSnapshotReportsRestoredWithItsVersion() async throws {
    let transport = ScriptedSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(try snapshotData("newer-snapshot.json")),
    ])
    let now = try contractTimestamp("2026-07-28T14:30:00.000Z")
    let client = makeClient(transport: transport, now: now)
    _ = await client.refresh()

    let result = await coordinator(client).run { .restored(Self.proEntitlement) }

    XCTAssertEqual(result.outcome, .restored(snapshotVersion: 14))
    XCTAssertTrue(result.authoritativeEntitlementsUpdated)
    XCTAssertEqual(result.snapshotVersion, 14)
    XCTAssertTrue(
      result.stages.contains(.authoritativeSnapshotAccepted(snapshotVersion: 14)),
      "the accepted snapshot must appear as an observable stage")
  }

  // Risk: a cancelled or failed native restore must not trigger a validation
  // wait, and must never be reported as restored.
  func testProviderCancellationShortCircuitsWithoutSyncing() async throws {
    let transport = ScriptedSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let now = try contractTimestamp("2026-07-28T12:30:00.000Z")
    let client = makeClient(transport: transport, now: now)

    let result = await coordinator(client).run { .cancelled }

    XCTAssertEqual(result.outcome, .cancelled)
    XCTAssertFalse(result.authoritativeEntitlementsUpdated)
    XCTAssertEqual(result.providerResult, .cancelled)
    let requests = await transport.requestCount
    XCTAssertEqual(requests, 0, "a cancelled restore must not wait on validation")
    XCTAssertFalse(result.stages.contains(.authoritativeSyncStarted))
  }

  func testProviderFailureIsCarriedVerbatimAndNeverBecomesRestored() async throws {
    let transport = ScriptedSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let now = try contractTimestamp("2026-07-28T12:30:00.000Z")
    let client = makeClient(transport: transport, now: now)
    let diagnostic = MosaicCommerceDiagnostic(
      code: "commerce.restoreFailed", safeMessage: "StoreKit could not synchronize purchases.",
      severity: .error, retryable: true, correlationID: "ios_storekit_1",
      providerCode: "storekit_error", recoveryAction: .retry)

    let result = await coordinator(client).run {
      .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic)
    }

    XCTAssertEqual(result.outcome, .failed)
    XCTAssertEqual(
      result.providerResult, .failed(diagnosticCode: diagnostic.code, diagnostic: diagnostic))
    XCTAssertFalse(result.authoritativeEntitlementsUpdated)
  }

  // Risk: "nothing to restore" is a real, common answer — a customer who never
  // purchased. It must be distinguishable from a failure and from a pending
  // validation, or the UI shows an error to someone who simply has no purchases.
  func testNothingToRestoreIsItsOwnOutcome() async throws {
    let transport = ScriptedSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let now = try contractTimestamp("2026-07-28T12:30:00.000Z")
    let client = makeClient(transport: transport, now: now)
    _ = await client.refresh()

    let result = await coordinator(client).run { .nothingToRestore }

    XCTAssertEqual(result.outcome, .noAdditionalPurchases)
    XCTAssertFalse(result.authoritativeEntitlementsUpdated)
  }

  // Risk: with no customer there is no authoritative answer possible, and
  // pretending otherwise would report someone else's access or a false failure.
  func testSignedOutDuringRestoreReportsIdentityUnresolved() async throws {
    let transport = ScriptedSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let now = try contractTimestamp("2026-07-28T12:30:00.000Z")
    let client = MosaicCustomerEntitlementClient(
      publicSDKKey: "pk_test",
      baseURL: baseURL,
      requestTimeout: 5,
      transport: transport,
      tokenStore: MosaicCustomerTokenStore(
        provider: MosaicStaticCustomerTokenProvider(result: .signedOut), clock: { now }),
      bindingDigest: "digest-a",
      cacheStoreFactory: { _ in MosaicCustomerEntitlementMemoryCacheStore() },
      clock: { now })

    let result = await coordinator(client).run { .restored(Self.proEntitlement) }

    XCTAssertEqual(result.outcome, .identityUnresolved)
    XCTAssertFalse(result.authoritativeEntitlementsUpdated)
  }

  // Risk: the stage list is what a host renders as restore progress. It must
  // record both axes in order, so a customer sees "the store said yes, Mosaic is
  // still confirming" rather than an unexplained wait.
  func testStagesRecordBothAxesInOrder() async throws {
    let transport = ScriptedSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(try snapshotData("newer-snapshot.json")),
    ])
    let now = try contractTimestamp("2026-07-28T14:30:00.000Z")
    let client = makeClient(transport: transport, now: now)
    _ = await client.refresh()

    let result = await coordinator(client).run { .restored(Self.proEntitlement) }

    XCTAssertEqual(
      result.stages,
      [
        .providerRestoreStarted,
        .providerRestoreFinished(.restored(proEntitlement)),
        .authoritativeSyncStarted,
        .authoritativeSnapshotAccepted(snapshotVersion: 14),
      ])
  }
}
