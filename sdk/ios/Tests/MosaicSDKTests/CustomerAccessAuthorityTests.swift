import Foundation
import XCTest

@testable import MosaicSDK

private actor AuthoritySyncTransport: MosaicEntitlementSyncTransport {
  private var responses: [MosaicEntitlementSyncHTTPResponse]
  private(set) var requests: [MosaicEntitlementSyncHTTPRequest] = []

  init(_ data: [Data]) {
    responses = data.map { .init(statusCode: 200, data: $0) }
  }

  func fetch(_ request: MosaicEntitlementSyncHTTPRequest) async throws
    -> MosaicEntitlementSyncHTTPResponse
  {
    requests.append(request)
    guard !responses.isEmpty else { throw URLError(.badServerResponse) }
    return responses.count > 1 ? responses.removeFirst() : responses[0]
  }
}

private actor AuthorityTokenProvider: MosaicCustomerTokenProvider {
  private(set) var calls: [Bool] = []

  func customerAccessToken(forceRefresh: Bool) async -> MosaicCustomerTokenResult {
    calls.append(forceRefresh)
    return .token(MosaicCustomerAccessToken("mcat_authority_test"))
  }
}

private enum AuthorityCacheFailure: Error { case writeFailed }

private actor BlockingAuthorityCache: MosaicCustomerEntitlementCacheStore {
  private var record: MosaicCustomerEntitlementCacheRecord?
  private var blockNextSave = false
  private var failNextSave = false
  private var failSavesRemaining = 0
  private var saveStarted = false
  private var releaseContinuation: CheckedContinuation<Void, Never>?

  func load() -> MosaicCustomerEntitlementCacheRecord? { record }

  func save(_ candidate: MosaicCustomerEntitlementCacheRecord) async throws {
    if failSavesRemaining > 0 {
      failSavesRemaining -= 1
      throw AuthorityCacheFailure.writeFailed
    }
    if blockNextSave {
      saveStarted = true
      await withCheckedContinuation { releaseContinuation = $0 }
      blockNextSave = false
      if failNextSave {
        failNextSave = false
        throw AuthorityCacheFailure.writeFailed
      }
    }
    record = candidate
  }

  func clear() { record = nil }

  func prepareBlockingFailure() {
    prepareBlockingSave(fails: true)
  }

  func prepareBlockingSave(fails: Bool) {
    blockNextSave = true
    failNextSave = fails
    saveStarted = false
  }

  func failNextSaves(_ count: Int) { failSavesRemaining = count }

  func waitUntilSaveStarts() async {
    while !saveStarted { await Task.yield() }
  }

  func releaseSave() {
    releaseContinuation?.resume()
    releaseContinuation = nil
  }
}

final class CustomerAccessAuthorityTests: XCTestCase {
  private let application = MosaicEntitlementApplicationMetadata(
    applicationID: "fixture-application-ios",
    appVersion: "4.2.0",
    sdkVersion: "2.0.0")

  private func client(
    transport: any MosaicEntitlementSyncTransport,
    cache: any MosaicCustomerEntitlementCacheStore = MosaicCustomerEntitlementMemoryCacheStore(),
    tokenProvider: any MosaicCustomerTokenProvider = AuthorityTokenProvider(),
    broadcaster: MosaicCustomerAccessAuthorityBroadcaster = .init()
  ) -> MosaicCustomerEntitlementClient {
    MosaicCustomerEntitlementClient(
      publicSDKKey: "pk_authority_test",
      baseURL: URL(string: "https://api.example.test")!,
      requestTimeout: 5,
      transport: transport,
      tokenStore: MosaicCustomerTokenStore(provider: tokenProvider),
      authorityBroadcaster: broadcaster,
      bindingDigest: "authority-test-customer",
      cacheStoreFactory: { _ in cache },
      applicationMetadata: application,
      authorityAware: true,
      clock: { Date(timeIntervalSince1970: 1_785_245_400) })
  }

  private func unchangedResponse(
    for fullSnapshot: Data,
    authorityDigestOverride: String? = nil,
    mutation: ((inout [String: Any]) -> Void)? = nil
  ) throws -> Data {
    guard
      let fullRoot = try JSONSerialization.jsonObject(with: fullSnapshot) as? [String: Any],
      let fullPayload = fullRoot["payload"] as? [String: Any],
      let authority = fullPayload["authority"] as? [String: Any],
      let authorityDigest = fullPayload["snapshotAuthorityDigest"] as? String,
      let minimumSupport = fullPayload["minimumSupport"] as? [String: Any]
    else { throw CanonicalFixtureLookupError.invalidShape }
    // The canonical unchanged record nests its confirmation under
    // `payload.unchanged`, beside the authority material this helper replaces.
    var confirmation = try authoritativeEntitlementRecordBody(
      "snapshot-unchanged.json", key: "unchanged")
    mutation?(&confirmation)
    return try MosaicCustomerCanonicalJSON.data([
      "authoritativeEntitlementContractVersion": "2",
      "recordType": "snapshotUnchanged",
      "payload": [
        "authority": authority,
        "unchanged": confirmation,
        "snapshotAuthorityDigest": authorityDigestOverride ?? authorityDigest,
        "minimumSupport": minimumSupport,
      ],
    ])
  }

  // Risk: iOS accepting a different wrapper shape or authority vocabulary from
  // Android/Flutter would make cutover behavior platform-dependent.
  func testCanonicalFixturesDecodeAndInvalidAuthorityIsRejected() throws {
    let source = try MosaicCustomerAuthorityCodec.decode(
      authoritativeEntitlementFixtureData("source-snapshot.json"))
    guard case .snapshot(let snapshot, let authority, _, let support, _) = source else {
      return XCTFail("expected authority snapshot")
    }
    XCTAssertEqual(snapshot.snapshotVersion, 0)
    XCTAssertEqual(authority.epoch, 4)
    XCTAssertEqual(authority.kind, .source)
    XCTAssertTrue(support.requiredCapabilities.contains(.authorityEpoch))

    guard
      case .unchanged(_, let confirmation, _, _, _) = try MosaicCustomerAuthorityCodec.decode(
        authoritativeEntitlementFixtureData("snapshot-unchanged.json"))
    else { return XCTFail("expected authority confirmation") }
    XCTAssertEqual(confirmation.snapshotVersion, 4)
    XCTAssertEqual(
      confirmation.refreshAfter,
      try contractTimestamp("2026-07-28T13:45:00.000Z"))

    guard
      case .unavailable(_, let reason, _) = try MosaicCustomerAuthorityCodec.decode(
        authoritativeEntitlementFixtureData("authority-unavailable.json"))
    else { return XCTFail("expected unavailable") }
    XCTAssertEqual(reason, .authorityUnknown)

    guard
      case .unavailable(_, let policyReason, let minimumSupport) =
        try MosaicCustomerAuthorityCodec.decode(
          authoritativeEntitlementFixtureData("authority-policy-unavailable.json"))
    else { return XCTFail("expected unavailable policy") }
    XCTAssertEqual(policyReason, .policyUnavailable)
    XCTAssertNil(minimumSupport)

    XCTAssertThrowsError(
      try MosaicCustomerAuthorityCodec.decode(
        authoritativeEntitlementFixtureData(
          "invalid/policy-unavailable-with-minimum-support.json")))

    var missingSupport = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: authoritativeEntitlementFixtureData("authority-unavailable.json"))
        as? [String: Any])
    var missingSupportPayload = try XCTUnwrap(missingSupport["payload"] as? [String: Any])
    missingSupportPayload.removeValue(forKey: "minimumSupport")
    missingSupport["payload"] = missingSupportPayload
    XCTAssertThrowsError(
      try MosaicCustomerAuthorityCodec.decode(
        JSONSerialization.data(withJSONObject: missingSupport)))

    XCTAssertThrowsError(
      try MosaicCustomerAuthorityCodec.decode(
        authoritativeEntitlementFixtureData("invalid/source-with-cutover-time.json")))
  }

  // Risk: readiness enforcement depends on exact app/SDK/capability metadata;
  // CAT binding remains server-side and must never be guessed into this body.
  func testSyncRequestMatchesCanonicalFixtureAndCarriesNoCustomerBinding() throws {
    let encoded = try MosaicEntitlementSyncRequestBody.encodeAuthorityAware(
      knownAuthorityEpoch: 5,
      knownSnapshotVersion: 4,
      knownSnapshotAuthorityDigest:
        "sha256:b659fc1560544193b6599e1e4a82861a55cae857fcad73fa340b611abe877c34",
      application: application)
    let expected = try authoritativeEntitlementFixtureData("sync-request.json")
    XCTAssertEqual(
      try JSONSerialization.jsonObject(with: encoded) as? NSDictionary,
      try JSONSerialization.jsonObject(with: expected) as? NSDictionary)
    let text = try XCTUnwrap(String(data: encoded, encoding: .utf8))
    XCTAssertFalse(text.contains("billingCustomerId"))
    XCTAssertFalse(text.contains("projectId"))
    XCTAssertFalse(text.contains("environmentId"))
  }

  // Risk: the digest is a verification hint for one retained customer/scope/
  // epoch snapshot. Sending it on the first request, or without both known
  // versions, could let a server treat unrelated state as unchanged.
  func testSyncRequestOmitsVerificationTupleUntilExactSnapshotIsRetained() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let fullRoot = try XCTUnwrap(
      JSONSerialization.jsonObject(with: full) as? [String: Any])
    let fullPayload = try XCTUnwrap(fullRoot["payload"] as? [String: Any])
    let retainedDigest = try XCTUnwrap(fullPayload["snapshotAuthorityDigest"] as? String)
    let transport = AuthoritySyncTransport([full])
    let client = client(transport: transport)

    _ = await client.refresh()
    _ = await client.refresh()

    let requests = await transport.requests
    XCTAssertEqual(requests.count, 2)
    let first = try XCTUnwrap(
      JSONSerialization.jsonObject(with: requests[0].body) as? [String: Any])
    let firstPayload = try XCTUnwrap(first["payload"] as? [String: Any])
    XCTAssertNil(firstPayload["knownAuthorityEpoch"])
    XCTAssertNil(firstPayload["knownSnapshotVersion"])
    XCTAssertNil(firstPayload["knownSnapshotAuthorityDigest"])

    let second = try XCTUnwrap(
      JSONSerialization.jsonObject(with: requests[1].body) as? [String: Any])
    let secondPayload = try XCTUnwrap(second["payload"] as? [String: Any])
    XCTAssertEqual(secondPayload["knownAuthorityEpoch"] as? Int, 5)
    XCTAssertEqual(secondPayload["knownSnapshotVersion"] as? Int, 4)
    XCTAssertEqual(
      secondPayload["knownSnapshotAuthorityDigest"] as? String,
      retainedDigest)
  }

  // Risk: a digest restored beside stale Application scope or beside a
  // different authority digest is not verification of the current retained
  // snapshot. Bootstrap must discard that tuple, and the next sync must ask
  // for a full snapshot without leaking any of its conditional members.
  func testStaleCachedScopeOrDigestIsNeverSentAsKnownVerification() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let primedCache = MosaicCustomerEntitlementMemoryCacheStore()
    let primed = client(
      transport: AuthoritySyncTransport([full]), cache: primedCache)
    _ = await primed.refresh()
    let loadedRecord = await primedCache.load()
    let acceptedRecord = try XCTUnwrap(loadedRecord)

    let mutations: [(String, (inout MosaicCustomerEntitlementCacheRecord) -> Void)] = [
      ("scope", { $0.applicationID = "other.application" }),
      (
        "digest",
        {
          $0.snapshotAuthorityDigest = "sha256:" + String(repeating: "0", count: 64)
        }
      ),
    ]

    for (name, mutation) in mutations {
      var stale = acceptedRecord
      mutation(&stale)
      stale.checksum = MosaicCustomerEntitlementCacheRecord.checksum(
        recordData: stale.recordData,
        billingCustomerID: stale.billingCustomerID,
        projectID: stale.projectID,
        environmentID: stale.environmentID,
        snapshotVersion: stale.snapshotVersion,
        applicationID: stale.applicationID,
        platform: stale.platform,
        authority: stale.authority,
        snapshotAuthorityDigest: stale.snapshotAuthorityDigest)
      let staleCache = MosaicCustomerEntitlementMemoryCacheStore(record: stale)
      let transport = AuthoritySyncTransport([full])
      let reconstructed = client(transport: transport, cache: staleCache)

      await reconstructed.bootstrap()
      _ = await reconstructed.refresh()

      let requests = await transport.requests
      let request = try XCTUnwrap(requests.first, name)
      let root = try XCTUnwrap(
        JSONSerialization.jsonObject(with: request.body) as? [String: Any], name)
      let payload = try XCTUnwrap(root["payload"] as? [String: Any], name)
      XCTAssertNil(payload["knownAuthorityEpoch"], name)
      XCTAssertNil(payload["knownSnapshotVersion"], name)
      XCTAssertNil(payload["knownSnapshotAuthorityDigest"], name)
    }
  }

  // Risk: an unavailable frozen policy must clear any retained grants and stay
  // unavailable. Treating omitted support metadata as a generic decode failure
  // could preserve an old active Mosaic snapshot through a policy outage.
  func testPolicyUnavailableClearsRetainedSnapshotAndNeverBecomesInactive() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let policyUnavailable = try authoritativeEntitlementFixtureData(
      "authority-policy-unavailable.json")
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let client = client(
      transport: AuthoritySyncTransport([full, policyUnavailable]), cache: cache)

    _ = await client.refresh()
    let result = await client.refresh()

    guard case .unavailable(let reason, _) = result else {
      return XCTFail("policy unavailable must fail closed")
    }
    XCTAssertEqual(reason, .authorityUnknown)
    let snapshot = await client.snapshot()
    XCTAssertNil(snapshot)
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .unavailable(reason: .authorityUnknown))
    XCTAssertNotEqual(check.state, .inactive)
    let cached = await cache.load()
    XCTAssertTrue(cached?.isPolicyUnavailableTombstone == true)
  }

  // Risk: deleting an active cache after publishing unavailable leaves a crash
  // window where restart can replay the old file. The tombstone must survive
  // reconstruction and suppress the prior grant without network access.
  func testPolicyUnavailableTombstoneSurvivesRestart() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let policyUnavailable = try authoritativeEntitlementFixtureData(
      "authority-policy-unavailable.json")
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let current = client(
      transport: AuthoritySyncTransport([full, policyUnavailable]), cache: cache)
    _ = await current.refresh()
    _ = await current.refresh()

    let reconstructed = client(
      transport: AuthoritySyncTransport([]), cache: cache)
    await reconstructed.bootstrap()

    let reconstructedSnapshot = await reconstructed.snapshot()
    XCTAssertNil(reconstructedSnapshot)
    let check = await reconstructed.check(key: "pro")
    XCTAssertEqual(check.state, .unavailable(reason: .authorityUnknown))
    guard case .unavailable(let reason, let support) = await reconstructed.authorityState() else {
      return XCTFail("expected tombstone authority state")
    }
    XCTAssertEqual(reason, .policyUnavailable)
    XCTAssertNil(support)
  }

  // Risk: publishing unavailable before the atomic marker write completes can
  // leave memory and durable state disagreeing. While the write is suspended,
  // the previously durable authority remains the only published state.
  func testPolicyInvalidationPersistsBeforePublishingUnavailable() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let policyUnavailable = try authoritativeEntitlementFixtureData(
      "authority-policy-unavailable.json")
    let cache = BlockingAuthorityCache()
    let candidate = client(
      transport: AuthoritySyncTransport([full, policyUnavailable]), cache: cache)
    _ = await candidate.refresh()
    await cache.prepareBlockingSave(fails: false)

    let invalidation = Task { await candidate.refresh() }
    await cache.waitUntilSaveStarts()

    let blockedSnapshot = await candidate.snapshot()
    XCTAssertEqual(blockedSnapshot?.snapshot.snapshotVersion, 4)
    guard case .authority(let authority, _) = await candidate.authorityState() else {
      return XCTFail("expected retained authority while tombstone save is blocked")
    }
    XCTAssertEqual(authority.epoch, 5)
    let blockedCache = await cache.load()
    XCTAssertFalse(blockedCache?.isPolicyUnavailableTombstone == true)

    await cache.releaseSave()
    guard case .unavailable(let reason, _) = await invalidation.value else {
      return XCTFail("expected unavailable after durable tombstone")
    }
    XCTAssertEqual(reason, .authorityUnknown)
    let invalidatedSnapshot = await candidate.snapshot()
    let invalidatedCache = await cache.load()
    XCTAssertNil(invalidatedSnapshot)
    XCTAssertTrue(invalidatedCache?.isPolicyUnavailableTombstone == true)
  }

  // Risk: a failed tombstone write must clear process-local access but must not
  // contact the server again while the old active file can still replay. Each
  // refresh retries the marker first; only a successful retry opens sync.
  func testFailedPolicyInvalidationBlocksSyncUntilTombstoneRetryAndRecovery() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let recovered = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 5)
    let policyUnavailable = try authoritativeEntitlementFixtureData(
      "authority-policy-unavailable.json")
    let transport = AuthoritySyncTransport([full, policyUnavailable, recovered])
    let cache = BlockingAuthorityCache()
    let candidate = client(transport: transport, cache: cache)
    _ = await candidate.refresh()
    await cache.failNextSaves(2)

    guard case .unavailable(_, let failureDiagnostics) = await candidate.refresh() else {
      return XCTFail("failed marker write must still clear in-memory access")
    }
    XCTAssertTrue(
      failureDiagnostics.contains { $0.code == "entitlement_policy_invalidation_write_failed" })
    let failedSnapshot = await candidate.snapshot()
    let oldCache = await cache.load()
    XCTAssertNil(failedSnapshot)
    XCTAssertNil(oldCache)

    let restarted = client(transport: AuthoritySyncTransport([]), cache: cache)
    await restarted.bootstrap()
    let restartedSnapshot = await restarted.snapshot()
    let restartedCheck = await restarted.check(key: "pro")
    XCTAssertNil(restartedSnapshot)
    XCTAssertEqual(restartedCheck.state, .unavailable(reason: .noSnapshot))

    guard case .unavailable = await candidate.refresh() else {
      return XCTFail("failed retry must remain unavailable")
    }
    let blockedRequests = await transport.requests
    XCTAssertEqual(blockedRequests.count, 2, "retry failure must block network sync")

    let recovery = await candidate.refresh()
    let recoveredRequests = await transport.requests
    let recoveredSnapshot = await candidate.snapshot()
    let recoveredCache = await cache.load()
    XCTAssertEqual(recovery, .updated(snapshotVersion: 5))
    XCTAssertEqual(recoveredRequests.count, 3)
    XCTAssertEqual(recoveredSnapshot?.snapshot.snapshotVersion, 5)
    XCTAssertEqual(recoveredCache?.formatVersion, 2)
  }

  // Risk: the canonical invalid fixture differs from the fail-closed record by
  // exactly one forbidden property. Treating it like arbitrary malformed JSON
  // would preserve active access despite an unmistakable policy outage.
  func testExactMalformedPolicyUnavailableFixturePersistsTombstone() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let malformed = try authoritativeEntitlementFixtureData(
      "invalid/policy-unavailable-with-minimum-support.json")
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let candidate = client(
      transport: AuthoritySyncTransport([full, malformed]), cache: cache)
    _ = await candidate.refresh()

    guard case .unavailable(let reason, _) = await candidate.refresh() else {
      return XCTFail("exact malformed policy response must fail closed")
    }
    XCTAssertEqual(reason, .authorityUnknown)
    let invalidatedSnapshot = await candidate.snapshot()
    let tombstone = await cache.load()
    XCTAssertNil(invalidatedSnapshot)
    XCTAssertTrue(tombstone?.isPolicyUnavailableTombstone == true)
  }

  // Risk: a durable tombstone must not become a permanent denial. A later
  // valid full snapshot atomically replaces it through the ordinary cache path.
  func testValidFullSnapshotRecoversFromRestartedPolicyTombstone() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let recovered = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 5)
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let current = client(
      transport: AuthoritySyncTransport([
        full,
        try authoritativeEntitlementFixtureData("authority-policy-unavailable.json"),
      ]), cache: cache)
    _ = await current.refresh()
    _ = await current.refresh()

    let reconstructed = client(
      transport: AuthoritySyncTransport([recovered]), cache: cache)
    await reconstructed.bootstrap()
    let tombstonedSnapshot = await reconstructed.snapshot()
    XCTAssertNil(tombstonedSnapshot)

    let recovery = await reconstructed.refresh()
    let recoveredSnapshot = await reconstructed.snapshot()
    let recoveredCache = await cache.load()
    XCTAssertEqual(recovery, .updated(snapshotVersion: 5))
    XCTAssertEqual(recoveredSnapshot?.snapshot.snapshotVersion, 5)
    XCTAssertEqual(recoveredCache?.formatVersion, 2)
  }

  // Risk: snapshot version alone would preserve epoch 4/version 14 over epoch
  // 5/version 1, or accept a late epoch 4/version 99 after cutover. Both return
  // access from the wrong authority.
  func testAuthorityEpochPrecedesSnapshotVersionAndTriggersOneUrgentTokenGeneration() async throws {
    let epoch4 = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 4, authorityKind: .source, transitionState: .cutoverPending,
      snapshotVersion: 14)
    let epoch5 = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 1)
    let lateEpoch4 = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 4, authorityKind: .source, transitionState: .stable,
      snapshotVersion: 99)
    let transport = AuthoritySyncTransport([epoch4, epoch5, lateEpoch4])
    let tokenProvider = AuthorityTokenProvider()
    let client = client(transport: transport, tokenProvider: tokenProvider)

    let initial = await client.refresh()
    XCTAssertEqual(initial, .updated(snapshotVersion: 14))

    // The epoch transition schedules its replacement-token sync off the caller's
    // path. Wait only for that bounded local state transition, never for time.
    for _ in 0..<50 {
      if await client.snapshot()?.authority?.epoch == 5 { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    let cutover = await client.snapshot()
    XCTAssertEqual(cutover?.authority?.epoch, 5)
    XCTAssertEqual(cutover?.snapshot.snapshotVersion, 1)
    let isMosaic = await client.isMosaicAuthoritative()
    XCTAssertTrue(isMosaic)

    _ = await client.refresh()
    let afterLateResponse = await client.snapshot()
    XCTAssertEqual(afterLateResponse?.authority?.epoch, 5)
    XCTAssertEqual(afterLateResponse?.snapshot.snapshotVersion, 1)
    let tokenCalls = await tokenProvider.calls.count
    XCTAssertGreaterThanOrEqual(tokenCalls, 2)
  }

  // Risk: a pre-9C cache has no authority epoch. Serving its active entries
  // would silently retain the old provider authority after cutover.
  func testAuthorityAwareBootstrapRejectsLegacyV1CacheAsUnavailable() async throws {
    let data = try entitlementSnapshotData("active-subscription.json")
    let decoded = try MosaicCustomerEntitlementCodec.decode(data)
    guard case .snapshot(let snapshot) = decoded.record else {
      return XCTFail("expected v1 snapshot")
    }
    let record = MosaicCustomerEntitlementCacheRecord(
      formatVersion: 1,
      recordData: data,
      billingCustomerID: snapshot.billingCustomerID,
      projectID: snapshot.projectID,
      environmentID: snapshot.environmentID,
      snapshotVersion: snapshot.snapshotVersion,
      issuedAt: snapshot.issuedAt,
      asOf: snapshot.asOf,
      refreshAfter: snapshot.refreshAfter,
      validUntil: snapshot.validUntil,
      staleGraceSeconds: snapshot.staleGraceSeconds,
      entityTag: snapshot.entityTag,
      storedAt: snapshot.issuedAt,
      serverTime: nil,
      localReceiptTime: nil,
      systemUptime: nil,
      checksum: MosaicCustomerEntitlementCacheRecord.checksum(
        recordData: data,
        billingCustomerID: snapshot.billingCustomerID,
        projectID: snapshot.projectID,
        environmentID: snapshot.environmentID,
        snapshotVersion: snapshot.snapshotVersion))
    let cache = MosaicCustomerEntitlementMemoryCacheStore(record: record)
    let client = client(transport: AuthoritySyncTransport([]), cache: cache)

    await client.bootstrap()

    let cacheState = await client.cacheState()
    let currentSnapshot = await client.snapshot()
    let check = await client.check(key: "pro")
    let clearCount = await cache.clearCount
    XCTAssertEqual(cacheState, .authorityUnknown)
    XCTAssertNil(currentSnapshot)
    XCTAssertEqual(check.state, .unavailable(reason: .authorityUnknown))
    XCTAssertEqual(clearCount, 1)
  }

  // Risk: late subscribers must immediately know whether Mosaic or the source
  // is authoritative; waiting for the next transition can leave a screen using
  // stale provider access indefinitely.
  func testAuthorityStreamReplaysCurrentAcceptedState() async throws {
    let data = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 4)
    let broadcaster = MosaicCustomerAccessAuthorityBroadcaster()
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let client = client(
      transport: AuthoritySyncTransport([data]), cache: cache, broadcaster: broadcaster)
    _ = await client.refresh()

    let stream = await client.authorityUpdates()
    var iterator = stream.makeAsyncIterator()
    guard case .authority(let authority, _) = await iterator.next() else {
      return XCTFail("expected replayed authority")
    }
    XCTAssertEqual(authority.epoch, 5)
    XCTAssertEqual(authority.kind, .mosaic)
    let cached = await cache.load()
    XCTAssertEqual(cached?.formatVersion, 2)
    XCTAssertEqual(cached?.authority, authority)
    XCTAssertEqual(cached?.applicationID, "fixture-application-ios")
    XCTAssertTrue(cached?.isIntact == true)
  }

  // Risk: v2 unchanged retains the v1 freshness body. Ignoring it expires a
  // confirmed paying customer; treating a bare 304 as equivalent invents an
  // unbounded freshness channel outside the contract.
  func testAuthorityUnchangedSlidesFreshnessAndKeepsCacheBootstrapable() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 4)
    let unchanged = try unchangedResponse(for: full)
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let currentClient = client(
      transport: AuthoritySyncTransport([full, unchanged]), cache: cache)

    _ = await currentClient.refresh()
    for _ in 0..<50 {
      if await currentClient.cacheState() == .fresh { break }
      try await Task.sleep(for: .milliseconds(10))
    }

    let refreshedState = await currentClient.cacheState()
    XCTAssertEqual(refreshedState, .fresh)
    let stored = await cache.load()
    XCTAssertEqual(stored?.refreshAfter, try contractTimestamp("2026-07-28T13:45:00.000Z"))

    let reconstructed = client(
      transport: AuthoritySyncTransport([]), cache: cache)
    await reconstructed.bootstrap()
    let reconstructedEpoch = await reconstructed.snapshot()?.authority?.epoch
    XCTAssertEqual(reconstructedEpoch, 5)
  }

  // Risk: unioning provider-observed access with Mosaic access after cutover
  // would let the old provider keep granting an Entitlement Mosaic revoked.
  // Commerce remains installed and usable, but targeting reads Mosaic only.
  func testMosaicAuthorityTargetingNeverUnionsProviderEntitlements() async throws {
    let data = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 4)
    let entitlementClient = client(transport: AuthoritySyncTransport([data]))
    _ = await entitlementClient.refresh()
    let provider = MockMosaicPurchaseProvider(
      activeEntitlements: [MosaicEntitlement(id: "provider_only")])
    let mosaic = Mosaic(
      configuration: try MosaicConfiguration(
        apiKey: "pk_test",
        applicationID: "fixture-application-ios",
        applicationVersion: "4.2.0"),
      purchaseProvider: provider,
      entitlementClient: entitlementClient)

    let states = await mosaic.entitlementDecisionStates(for: ["pro", "provider_only"])

    XCTAssertEqual(states["pro"], .active)
    XCTAssertEqual(states["provider_only"], .unknown)
    let providerAccess = await provider.activeEntitlements()
    XCTAssertEqual(providerAccess, .available([MosaicEntitlement(id: "provider_only")]))
  }

  // Risk: treating "authority not established" as implicit provider authority
  // leaks provider-observed access during startup or an authority outage.
  func testTargetingUsesProviderOnlyAfterAcceptedSourceAuthority() async throws {
    let cases: [(MosaicCustomerAccessAuthorityKind, MosaicCustomerAccessTransitionState)] = [
      (.source, .stable),
      (.sourceRollback, .rolledBack),
    ]

    for (authorityKind, transitionState) in cases {
      let source = try authoritativeEntitlementAuthoritySnapshotVariant(
        authorityEpoch: 4, authorityKind: authorityKind,
        transitionState: transitionState, snapshotVersion: 4)
      let entitlementClient = client(transport: AuthoritySyncTransport([source]))
      let provider = MockMosaicPurchaseProvider(
        activeEntitlements: [MosaicEntitlement(id: "provider_only")])
      let mosaic = Mosaic(
        configuration: try MosaicConfiguration(
          apiKey: "pk_test",
          applicationID: "fixture-application-ios",
          applicationVersion: "4.2.0"),
        purchaseProvider: provider,
        entitlementClient: entitlementClient)

      let unknown = await mosaic.entitlementDecisionStates(for: ["provider_only"])
      XCTAssertEqual(unknown["provider_only"], .unknown, authorityKind.rawValue)

      _ = await entitlementClient.refresh()
      let sourceAuthorized = await mosaic.entitlementDecisionStates(
        for: ["provider_only", "pro"])
      XCTAssertEqual(sourceAuthorized["provider_only"], .active, authorityKind.rawValue)
      XCTAssertEqual(sourceAuthorized["pro"], .inactive, authorityKind.rawValue)
    }
  }

  // Risk: a direct host check that reads a retained source-authoritative
  // snapshot can grant access even though Mosaic is not the current authority.
  func testDirectCheckDoesNotAnswerFromSourceAuthoritySnapshot() async throws {
    try await assertDirectCheckUnavailable(
      authorityKind: .source, transitionState: .stable)
  }

  // Risk: rollback explicitly returns authority to the source. Treating the
  // retained Mosaic projection as current would defeat that rollback.
  func testDirectCheckDoesNotAnswerFromSourceRollbackAuthoritySnapshot() async throws {
    try await assertDirectCheckUnavailable(
      authorityKind: .sourceRollback, transitionState: .rolledBack)
  }

  // Risk: an unchanged response is allowed to slide freshness only. Accepting
  // any identity, evaluation, projection, digest, or regressing-window change
  // would mutate the retained snapshot without a new snapshot version.
  func testAuthorityUnchangedRejectsEveryRetainedBindingAndFreshnessMismatch() async throws {
    let full = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let mutations: [(String, (inout [String: Any]) -> Void)] = [
      ("customer", { $0["billingCustomerId"] = "fixture-customer-other" }),
      ("version", { $0["snapshotVersion"] = 5 }),
      ("entity tag", { $0["entityTag"] = "cs-0001-other" }),
      ("as-of", { $0["asOf"] = "2026-07-28T12:00:00.000Z" }),
      (
        "projection state",
        { value in
          guard var status = value["projectionStatus"] as? [String: Any] else { return }
          status["state"] = "stale"
          value["projectionStatus"] = status
        }
      ),
      (
        "last projected",
        { value in
          guard var status = value["projectionStatus"] as? [String: Any] else { return }
          status["lastProjectedAt"] = "2026-07-28T12:00:00.000Z"
          value["projectionStatus"] = status
        }
      ),
      ("issued-at regression", { $0["issuedAt"] = "2026-07-28T11:59:59.000Z" }),
      ("refresh-after regression", { $0["refreshAfter"] = "2026-07-28T12:59:59.000Z" }),
      ("valid-until regression", { $0["validUntil"] = "2026-08-04T11:59:59.000Z" }),
      ("v1 horizon", { $0["validUntil"] = "2026-09-30T12:45:00.000Z" }),
    ]

    for (name, mutation) in mutations {
      let invalid = try unchangedResponse(for: full, mutation: mutation)
      let cache = MosaicCustomerEntitlementMemoryCacheStore()
      let candidate = client(
        transport: AuthoritySyncTransport([full, invalid]), cache: cache)
      _ = await candidate.refresh()
      let result = await candidate.refresh()
      let retained = await candidate.snapshot()
      let stored = await cache.load()

      guard case .preserved(let version, _) = result else {
        return XCTFail("expected \(name) mismatch to preserve")
      }
      XCTAssertEqual(version, 4, name)
      XCTAssertEqual(retained?.snapshot.snapshotVersion, 4, name)
      XCTAssertEqual(stored?.refreshAfter, try contractTimestamp("2026-07-28T13:00:00.000Z"), name)
    }

    let digestMismatch = try unchangedResponse(
      for: full,
      authorityDigestOverride: "sha256:" + String(repeating: "0", count: 64))
    let digestClient = client(
      transport: AuthoritySyncTransport([full, digestMismatch]))
    _ = await digestClient.refresh()
    guard case .preserved = await digestClient.refresh() else {
      return XCTFail("expected authority digest mismatch to preserve")
    }

    let scopeClient = client(
      transport: AuthoritySyncTransport([
        full,
        try authoritativeEntitlementFixtureData("invalid/unchanged-scope-mismatch.json"),
      ]))
    _ = await scopeClient.refresh()
    guard case .preserved = await scopeClient.refresh() else {
      return XCTFail("expected retained authority scope mismatch to preserve")
    }
  }

  // Risk: publishing in memory before an atomic cache save lets readers and
  // listeners observe an authority epoch that cannot survive restart. A blocked
  // or failed write must leave the prior durable epoch as the only publication.
  func testFailedBlockedPersistenceNeverPublishesCandidateAuthority() async throws {
    let initial = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stable,
      snapshotVersion: 4)
    let candidate = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 6, authorityKind: .sourceRollback, transitionState: .rolledBack,
      snapshotVersion: 1)
    let cache = BlockingAuthorityCache()
    let client = client(
      transport: AuthoritySyncTransport([initial, candidate]), cache: cache)
    _ = await client.refresh()
    await cache.prepareBlockingFailure()

    let refresh = Task { await client.refresh() }
    await cache.waitUntilSaveStarts()

    let whileBlocked = await client.snapshot()
    guard case .authority(let blockedAuthority, _) = await client.authorityState() else {
      return XCTFail("expected retained authority while cache save is blocked")
    }
    XCTAssertEqual(whileBlocked?.snapshot.snapshotVersion, 4)
    XCTAssertEqual(blockedAuthority.epoch, 5)

    await cache.releaseSave()
    guard case .preserved(let version, let diagnostic) = await refresh.value else {
      return XCTFail("expected failed publication to preserve")
    }
    XCTAssertEqual(version, 4)
    XCTAssertEqual(diagnostic.code, "entitlement_cache_write_failed")
    let finalSnapshot = await client.snapshot()
    XCTAssertEqual(finalSnapshot?.snapshot.snapshotVersion, 4)
    guard case .authority(let finalAuthority, _) = await client.authorityState() else {
      return XCTFail("expected retained final authority")
    }
    XCTAssertEqual(finalAuthority.epoch, 5)
    let finalCache = await cache.load()
    XCTAssertEqual(finalCache?.snapshotVersion, 4)
  }

  // Risk: replaying a valid snapshot into another Application is a cross-app
  // access leak. Scope mismatch is the authority rejection that clears rather
  // than preserving the mismatched cache.
  func testAuthorityScopeMismatchClearsCacheAndReportsUnavailable() async throws {
    let accepted = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 4)
    let wrongApplication = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 6, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 5,
      applicationID: "other.application")
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let client = client(
      transport: AuthoritySyncTransport([accepted, wrongApplication]), cache: cache)

    _ = await client.refresh()
    for _ in 0..<50 {
      if await client.cacheState() == .differentCustomer { break }
      try await Task.sleep(for: .milliseconds(10))
    }

    let state = await client.cacheState()
    let check = await client.check(key: "pro")
    let clearCount = await cache.clearCount
    XCTAssertEqual(state, .differentCustomer)
    XCTAssertEqual(check.state, .unavailable(reason: .scopeMismatch))
    XCTAssertGreaterThanOrEqual(clearCount, 1)
  }

  // Risk: accepting a snapshot outside the server-declared readiness window
  // can run cutover behavior on an app version that lacks its required safety
  // semantics. It must be unavailable, never inactive or provider-derived.
  func testMinimumAppSupportFailsClosed() async throws {
    let unsupported = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 5, authorityKind: .mosaic, transitionState: .stabilizing,
      snapshotVersion: 4,
      minimumAppVersion: "5.0.0")
    let client = client(transport: AuthoritySyncTransport([unsupported]))

    let result = await client.refresh()
    let check = await client.check(key: "pro")
    let snapshot = await client.snapshot()

    guard case .unavailable(let reason, _) = result else {
      return XCTFail("expected unsupported app version")
    }
    XCTAssertEqual(reason, .unsupportedAppVersion)
    XCTAssertNil(snapshot)
    XCTAssertEqual(check.state, .unavailable(reason: .unsupportedAppVersion))
  }

  private func assertDirectCheckUnavailable(
    authorityKind: MosaicCustomerAccessAuthorityKind,
    transitionState: MosaicCustomerAccessTransitionState
  ) async throws {
    let data = try authoritativeEntitlementAuthoritySnapshotVariant(
      authorityEpoch: 4, authorityKind: authorityKind,
      transitionState: transitionState, snapshotVersion: 4)
    let entitlementClient = client(transport: AuthoritySyncTransport([data]))

    _ = await entitlementClient.refresh()
    let check = await entitlementClient.check(key: "pro")

    XCTAssertEqual(check.state, .unavailable(reason: .authorityUnknown))
    XCTAssertEqual(check.snapshotVersion, 4)
    XCTAssertTrue(check.cacheState.servesAccess)
  }
}
