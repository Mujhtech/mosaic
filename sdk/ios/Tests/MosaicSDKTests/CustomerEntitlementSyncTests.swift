import Foundation
import XCTest

@testable import MosaicSDK

/// Serves queued responses and records the headers each request carried.
private actor StubSyncTransport: MosaicEntitlementSyncTransport {
  private var responses: [MosaicEntitlementSyncHTTPResponse]
  private(set) var requests: [MosaicEntitlementSyncHTTPRequest] = []
  private let delay: Duration?

  init(_ responses: [MosaicEntitlementSyncHTTPResponse], delay: Duration? = nil) {
    self.responses = responses
    self.delay = delay
  }

  var requestCount: Int { requests.count }

  func fetch(_ request: MosaicEntitlementSyncHTTPRequest) async throws
    -> MosaicEntitlementSyncHTTPResponse
  {
    requests.append(request)
    if let delay { try? await Task.sleep(for: delay) }
    guard !responses.isEmpty else { throw URLError(.badServerResponse) }
    return responses.count > 1 ? responses.removeFirst() : responses[0]
  }
}

private actor FailingSyncTransport: MosaicEntitlementSyncTransport {
  private(set) var requestCount = 0
  func fetch(_: MosaicEntitlementSyncHTTPRequest) async throws
    -> MosaicEntitlementSyncHTTPResponse
  {
    requestCount += 1
    throw URLError(.notConnectedToInternet)
  }
}

final class CustomerEntitlementSyncTests: XCTestCase {
  private let baseURL = URL(string: "https://api.example.com")!
  private let issuedAt = try! contractTimestamp("2026-07-28T12:00:00.000Z")

  private func snapshotData(_ name: String) throws -> Data {
    try entitlementSnapshotData(name)
  }

  private func invalidData(_ name: String) throws -> Data {
    try authoritativeEntitlementFixtureData("invalid/\(name)")
  }

  private func mutatedSnapshotPayload(
    _ name: String, _ mutation: (inout [String: Any]) -> Void
  ) throws -> Data {
    try mutatedEntitlementRecord(name, mutation)
  }

  private func ok(_ data: Data, etag: String? = nil, serverDate: Date? = nil)
    -> MosaicEntitlementSyncHTTPResponse
  {
    .init(statusCode: 200, data: data, etag: etag, serverDate: serverDate)
  }

  private func makeClient(
    transport: any MosaicEntitlementSyncTransport,
    tokenProvider: any MosaicCustomerTokenProvider = MosaicStaticCustomerTokenProvider(
      token: MosaicCustomerAccessToken("mcat_test")),
    cache: MosaicCustomerEntitlementMemoryCacheStore = .init(),
    broadcaster: MosaicCustomerEntitlementBroadcaster = .init(),
    now: Date? = nil
  ) -> (MosaicCustomerEntitlementClient, MosaicCustomerEntitlementMemoryCacheStore) {
    let instant = now ?? issuedAt.addingTimeInterval(60)
    let client = MosaicCustomerEntitlementClient(
      publicSDKKey: "pk_test",
      baseURL: baseURL,
      requestTimeout: 5,
      transport: transport,
      tokenStore: MosaicCustomerTokenStore(provider: tokenProvider, clock: { instant }),
      broadcaster: broadcaster,
      bindingDigest: "digest-a",
      cacheStoreFactory: { _ in cache },
      clock: { instant })
    return (client, cache)
  }

  // MARK: Wire form

  // Risk: the public SDK key identifies the application and the customer token
  // selects the customer; neither substitutes for the other. A request missing
  // either header is refused, and a token in a query string ends up in access
  // logs, proxy logs, and browser history.
  func testRequestCarriesBothPinnedHeadersAndNoTokenInTheURL() async throws {
    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, _) = makeClient(transport: transport)

    _ = await client.refresh()

    let requests = await transport.requests
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.headers["Authorization"], "Bearer mcat_test")
    XCTAssertEqual(request.headers["Mosaic-SDK-Key"], "pk_test")
    XCTAssertEqual(
      request.url.absoluteString, "https://api.example.com/v1/sdk/billing/entitlements")
    XCTAssertFalse(request.url.absoluteString.contains("mcat_"))
  }

  // Risk: contract negotiation lives in the request body, so all three SDKs POST
  // the canonical `entitlementSyncRequest` envelope. A bodyless GET would ship a
  // version-negotiating client that never states which versions it can read.
  func testRequestBodyIsTheCanonicalSyncRequestEnvelope() async throws {
    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, _) = makeClient(transport: transport)

    _ = await client.refresh()

    let requests = await transport.requests
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.headers["Content-Type"], "application/json")
    let envelope = try XCTUnwrap(
      JSONSerialization.jsonObject(with: request.body) as? [String: Any])
    XCTAssertEqual(
      envelope["authoritativeEntitlementContractVersion"] as? String,
      mosaicAuthoritativeEntitlementContractVersion)
    XCTAssertEqual(envelope["recordType"] as? String, "entitlementSyncRequest")
    let payload = try XCTUnwrap(envelope["payload"] as? [String: Any])
    XCTAssertEqual(
      payload["supportedAuthoritativeEntitlementContracts"] as? [String],
      [mosaicAuthoritativeEntitlementContractVersion])
    XCTAssertNotNil(payload["correlationId"] as? String)
    // Nothing already known on a first sync, so neither conditional member is sent.
    XCTAssertNil(payload["knownSnapshotVersion"])
    XCTAssertNil(payload["entityTag"])
    // The customer is selected by the token alone. Asserting an identifier could
    // only narrow or fail the request, so it is never sent.
    XCTAssertNil(payload["billingCustomerId"])
  }

  // Risk: without these the server can never answer `snapshotUnchanged`, and
  // every refresh re-sends a snapshot the device already holds.
  func testConditionalRequestBodyCarriesTheKnownVersionAndEntityTag() async throws {
    let transport = StubSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(try snapshotData("newer-snapshot.json")),
    ])
    let (client, _) = makeClient(transport: transport)
    _ = await client.refresh()
    _ = await client.refresh()

    let requests = await transport.requests
    let envelope = try XCTUnwrap(
      JSONSerialization.jsonObject(with: requests[1].body) as? [String: Any])
    let payload = try XCTUnwrap(envelope["payload"] as? [String: Any])
    XCTAssertEqual(payload["knownSnapshotVersion"] as? Int, 4)
    XCTAssertEqual(payload["entityTag"] as? String, "cs-0001-v4")
  }

  // Risk: a customer whose first projection has not run must still get a
  // validated, cacheable unknown answer. Treating zero as "no cache" omits it
  // from the next request and can strand the client on the placeholder; treating
  // it as invalid prevents the ordinary 1 > 0 monotonic replacement.
  func testNeverProjectedPlaceholderIsCachedSentAndReplacedByVersionOne() async throws {
    let placeholder = try neverProjectedEntitlementPlaceholderData()
    let firstProjection = try authoritativeEntitlementSnapshotVariant { payload in
      payload["snapshotVersion"] = 1
      payload["previousSnapshotVersion"] = 0
      payload["entityTag"] = "cs-0001-v1"
    }
    let transport = StubSyncTransport([ok(placeholder), ok(firstProjection)])
    let (client, cache) = makeClient(transport: transport)

    let placeholderRefresh = await client.refresh()
    let cachedPlaceholder = await client.snapshot()
    let placeholderSaveCount = await cache.saveCount
    XCTAssertEqual(placeholderRefresh, .updated(snapshotVersion: 0))
    XCTAssertEqual(cachedPlaceholder?.snapshot.snapshotVersion, 0)
    XCTAssertEqual(placeholderSaveCount, 1, "the placeholder is an ordinary cached snapshot")
    let placeholderCheck = await client.check(key: "pro")
    XCTAssertNotEqual(placeholderCheck.state, .inactive)

    let firstProjectionRefresh = await client.refresh()
    XCTAssertEqual(firstProjectionRefresh, .updated(snapshotVersion: 1))
    let requests = await transport.requests
    let envelope = try XCTUnwrap(
      JSONSerialization.jsonObject(with: requests[1].body) as? [String: Any])
    let payload = try XCTUnwrap(envelope["payload"] as? [String: Any])
    XCTAssertEqual(payload["knownSnapshotVersion"] as? Int, 0)
    XCTAssertEqual(payload["entityTag"] as? String, "pending-cs-0001-v0")
    let current = await client.snapshot()
    let projectedCheck = await client.check(key: "pro")
    let replacementSaveCount = await cache.saveCount
    XCTAssertEqual(current?.snapshot.snapshotVersion, 1)
    XCTAssertEqual(projectedCheck.state, .active)
    XCTAssertEqual(replacementSaveCount, 2, "version one replaces the placeholder atomically")
  }

  // Risk: the contract-pinned unchanged path. A `snapshotUnchanged` record slides
  // the freshness window so a confirmed-current snapshot does not expire merely
  // because it was confirmed instead of resent.
  func testSnapshotUnchangedRecordSlidesFreshness() async throws {
    let transport = StubSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(try snapshotData("snapshot-unchanged.json")),
    ])
    // Past the original refreshAfter of 13:00Z but inside validity.
    let later = try contractTimestamp("2026-07-28T13:30:00.000Z")
    let (client, _) = makeClient(transport: transport, now: later)

    _ = await client.refresh()
    let before = await client.cacheState()
    XCTAssertEqual(before, .refreshRecommended)

    let result = await client.refresh()
    XCTAssertEqual(result, .unchanged(snapshotVersion: 4))
    // The confirmation carries refreshAfter 13:45Z, which is now in the future.
    let after = await client.cacheState()
    XCTAssertEqual(after, .fresh)
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active)
  }

  // Risk: a bare 304 has no body, so there is no contract-pinned carrier for a
  // refreshed window. It must preserve the cache without silently extending the
  // offline horizon on wire names no contract owns.
  func testBare304PreservesTheCacheWithoutSlidingFreshness() async throws {
    let transport = StubSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      .init(statusCode: 304),
    ])
    let later = try contractTimestamp("2026-07-28T13:30:00.000Z")
    let (client, _) = makeClient(transport: transport, now: later)
    _ = await client.refresh()

    let result = await client.refresh()
    XCTAssertEqual(result, .unchanged(snapshotVersion: 4))
    let state = await client.cacheState()
    XCTAssertEqual(state, .refreshRecommended, "a bare 304 must not extend the window")
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active, "but the cache still stands")
  }

  func testConditionalRequestSendsTheCachedEntityTag() async throws {
    let transport = StubSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(try snapshotData("newer-snapshot.json")),
    ])
    let (client, _) = makeClient(transport: transport)

    _ = await client.refresh()
    _ = await client.refresh()

    let requests = await transport.requests
    XCTAssertNil(requests[0].headers["If-None-Match"])
    XCTAssertEqual(requests[1].headers["If-None-Match"], "\"cs-0001-v4\"")
  }

  // MARK: Acceptance

  func testAcceptedSnapshotIsCachedAndAnswersAChecK() async throws {
    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, cache) = makeClient(transport: transport)

    let result = await client.refresh()
    XCTAssertEqual(result, .updated(snapshotVersion: 4))

    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active)
    XCTAssertEqual(check.snapshotVersion, 4)
    XCTAssertFalse(check.isStale)

    let saves = await cache.saveCount
    XCTAssertEqual(saves, 1)
  }

  // Risk: a late or replayed response must not roll state backwards. This is
  // the monotonicity guarantee the whole cache design rests on.
  func testOlderSnapshotIsRejectedAndTheCacheIsPreserved() async throws {
    let transport = StubSyncTransport([
      ok(try snapshotData("newer-snapshot.json")),
      ok(try invalidData("older-snapshot-version-rejected.json")),
    ])
    // `newer-snapshot` is issued at 14:00Z, so the device clock has to sit
    // inside its validity window for the cache to be servable at all.
    let (client, _) = makeClient(
      transport: transport, now: try contractTimestamp("2026-07-28T14:30:00.000Z"))

    let firstRefresh = await client.refresh()
    XCTAssertEqual(firstRefresh, .updated(snapshotVersion: 14))
    guard case .preserved(let version, let diagnostic) = await client.refresh() else {
      return XCTFail("an older snapshot must preserve the cache")
    }
    XCTAssertEqual(version, 14, "the newer accepted state must still stand")
    XCTAssertEqual(diagnostic.code, "entitlement_snapshot_snapshot_version_not_newer")

    let check = await client.check(key: "pro")
    XCTAssertEqual(check.snapshotVersion, 14)
  }

  // Risk: equal is not newer. Re-accepting would make "accepted" stop meaning
  // "the state advanced", which the restore flow depends on.
  func testEqualVersionIsNotAccepted() async throws {
    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, _) = makeClient(transport: transport)

    let firstRefresh = await client.refresh()
    XCTAssertEqual(firstRefresh, .updated(snapshotVersion: 4))
    guard case .preserved = await client.refresh() else {
      return XCTFail("an identical version must not be re-accepted")
    }
  }

  // Risk: this is the entitlement leak the binding rule exists to prevent.
  // A digest computed over a different billingCustomerId must clear the cache,
  // not preserve it, and must be observable so a host can react.
  func testBindingMismatchClearsTheCacheAndEmitsCleared() async throws {
    let broadcaster = MosaicCustomerEntitlementBroadcaster()
    // The canonical `different-customer-rejected.json` carries a digest computed
    // over another customer, so a reader observes it as a digest mismatch (the
    // codec tests assert exactly that). The binding mismatch this test is about
    // is a payload that *names* another customer, which the acceptance order
    // catches before it ever reaches the digest step.
    let otherCustomer = try mutatedSnapshotPayload("active-subscription.json") { payload in
      payload["billingCustomerId"] = "fixture-customer-0002"
      payload["snapshotVersion"] = 9
    }
    let transport = StubSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(otherCustomer),
    ])
    let (client, cache) = makeClient(transport: transport, broadcaster: broadcaster)

    _ = await client.refresh()
    let stream = await broadcaster.updates()
    var iterator = stream.makeAsyncIterator()
    _ = await iterator.next()  // replayed current snapshot

    _ = await client.refresh()

    let cleared = await cache.clearCount
    XCTAssertGreaterThanOrEqual(cleared, 1, "a binding mismatch must clear the cache")
    let state = await client.cacheState()
    XCTAssertEqual(state, .differentCustomer)

    let check = await client.check(key: "pro")
    if case .unavailable = check.state {
    } else {
      XCTFail("a cleared cache must not keep answering active")
    }
    XCTAssertNotEqual(check.state, .inactive, "never inactive")
  }

  // Risk: a corrupted or tampered payload must be discarded whole. Partial
  // acceptance is forbidden: a reader never keeps the entries it understood
  // from a document it rejected.
  func testDigestMismatchPreservesTheCacheAndNeverEmits() async throws {
    let broadcaster = MosaicCustomerEntitlementBroadcaster()
    let mutated = try mutatedEntitlementRecord("newer-snapshot.json") { snapshot in
      var entries = snapshot["entries"] as! [[String: Any]]
      entries[0]["state"] = "inactive"
      snapshot["entries"] = entries
    }

    let transport = StubSyncTransport([
      ok(try snapshotData("active-subscription.json")),
      ok(mutated),
    ])
    let (client, _) = makeClient(transport: transport, broadcaster: broadcaster)
    _ = await client.refresh()

    let result = await client.refresh()
    if case .preserved = result {
    } else {
      XCTFail("a tampered payload must preserve the previously accepted snapshot")
    }
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active, "the last good snapshot still stands")
    XCTAssertEqual(check.snapshotVersion, 4)
  }

  // MARK: 304

  // MARK: Failure behaviour

  // Risk: the single most important behaviour in the whole contract. A network
  // failure is not a cancelled subscription.
  func testNetworkFailurePreservesAccessAndNeverReportsInactive() async throws {
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let good = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (primed, _) = makeClient(transport: good, cache: cache)
    _ = await primed.refresh()

    let failing = FailingSyncTransport()
    let (client, _) = makeClient(transport: failing, cache: cache)
    await client.bootstrap()

    let result = await client.refresh()
    guard case .preserved = result else {
      return XCTFail("an offline device inside validity keeps its access")
    }
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active)
    XCTAssertNotEqual(check.state, .inactive)
  }

  // Risk: past the bounded-grace window the cache's age can no longer support an
  // answer. It must degrade to unavailable, never to inactive.
  func testExpiredCacheReportsUnavailableNeverInactive() async throws {
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let good = StubSyncTransport([ok(try snapshotData("bounded-offline-cache.json"))])
    let (primed, _) = makeClient(transport: good, cache: cache)
    _ = await primed.refresh()

    // validUntil 2026-08-04T12:00Z plus a 24 h grace window, well past.
    let farFuture = try contractTimestamp("2026-09-01T12:00:00.000Z")
    let (client, _) = makeClient(
      transport: FailingSyncTransport(), cache: cache, now: farFuture)
    await client.bootstrap()

    let state = await client.cacheState()
    XCTAssertEqual(state, .expired)
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .unavailable(reason: .cacheExpired))
    XCTAssertNotEqual(check.state, .inactive)
  }

  // Risk: inside the grace band a previously active Entitlement stays active but
  // must be surfaced as stale, so a host can tell the difference between
  // confirmed and merely remembered access.
  func testStaleWithinGraceKeepsAccessAndMarksItStale() async throws {
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let good = StubSyncTransport([ok(try snapshotData("bounded-offline-cache.json"))])
    let (primed, _) = makeClient(transport: good, cache: cache)
    _ = await primed.refresh()

    let inGrace = try contractTimestamp("2026-08-04T18:00:00.000Z")
    let (client, _) = makeClient(transport: FailingSyncTransport(), cache: cache, now: inGrace)
    await client.bootstrap()

    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active)
    XCTAssertTrue(check.isStale)
  }

  // Risk: billing disabled for an Environment is a service state, not a
  // customer state. Reporting it as inactive would tell every customer of that
  // Environment their subscription ended.
  func testBillingDisabledIsUnavailableNeverInactive() async {
    let transport = StubSyncTransport([.init(statusCode: 409)])
    let (client, _) = makeClient(transport: transport)

    guard case .unavailable(let reason, _) = await client.refresh() else {
      return XCTFail("expected unavailable")
    }
    XCTAssertEqual(reason, .billingDisabled)
    let check = await client.check(key: "pro")
    XCTAssertNotEqual(check.state, .inactive)
  }

  // MARK: Authorization

  // Risk: exactly one forced refresh per generation. The second refusal on a
  // freshly minted token is a real failure; retrying forever turns an outage
  // into a request storm.
  func testOneRetryOnUnauthorizedThenUnavailable() async throws {
    let transport = StubSyncTransport([
      .init(statusCode: 401), .init(statusCode: 401), .init(statusCode: 401),
    ])
    let provider = MosaicClosureCustomerTokenProvider { _ in
      .token(MosaicCustomerAccessToken("mcat_test"))
    }
    let (client, _) = makeClient(transport: transport, tokenProvider: provider)

    let result = await client.refresh()
    guard case .unavailable(let reason, _) = result else {
      return XCTFail("expected unavailable after the retry budget")
    }
    XCTAssertEqual(reason, .notAuthorized)
    let count = await transport.requestCount
    XCTAssertEqual(count, 2, "the original request plus exactly one retry")
  }

  func testUnauthorizedRetrySucceeds() async throws {
    let transport = StubSyncTransport([
      .init(statusCode: 401),
      ok(try snapshotData("active-subscription.json")),
    ])
    let provider = MosaicClosureCustomerTokenProvider { _ in
      .token(MosaicCustomerAccessToken("mcat_test"))
    }
    let (client, _) = makeClient(transport: transport, tokenProvider: provider)

    let result = await client.refresh()
    XCTAssertEqual(result, .updated(snapshotVersion: 4))
  }

  // Risk: a signed-out user must never be served the previous session's grants.
  func testSignedOutProviderYieldsSignedOutNotInactive() async {
    let transport = StubSyncTransport([.init(statusCode: 200)])
    let (client, _) = makeClient(
      transport: transport, tokenProvider: MosaicStaticCustomerTokenProvider(result: .signedOut))

    let result = await client.refresh()
    XCTAssertEqual(result, .signedOut)
    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .unavailable(reason: .signedOut))
  }

  // MARK: Concurrency and identity

  func testConcurrentRefreshesMakeOneRequest() async throws {
    let transport = StubSyncTransport(
      [ok(try snapshotData("active-subscription.json"))], delay: .milliseconds(40))
    let (client, _) = makeClient(transport: transport)

    async let first = client.refresh()
    async let second = client.refresh()
    async let third = client.refresh()
    let results = await [first, second, third]

    XCTAssertEqual(results, Array(repeating: .updated(snapshotVersion: 4), count: 3))
    let count = await transport.requestCount
    XCTAssertEqual(count, 1)
  }

  // Risk: a response that lands after an identity change would attach the
  // previous customer's access to the new session. This is the leak test for the
  // in-flight path specifically.
  func testResponseArrivingAfterIdentityChangeIsDiscarded() async throws {
    let transport = StubSyncTransport(
      [ok(try snapshotData("active-subscription.json"))], delay: .milliseconds(80))
    let (client, _) = makeClient(transport: transport)

    let pending = Task { await client.refresh() }
    try await Task.sleep(for: .milliseconds(10))
    await client.identityChanged(bindingDigest: "digest-b", signedOut: false)
    _ = await pending.value

    let snapshot = await client.snapshot()
    XCTAssertNil(snapshot, "a snapshot for the previous identity must not survive the change")
    let check = await client.check(key: "pro")
    XCTAssertNotEqual(check.state, .active)
  }

  func testIdentityChangeEmitsClearedAndSwapsTheCacheNamespace() async throws {
    let broadcaster = MosaicCustomerEntitlementBroadcaster()
    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, _) = makeClient(transport: transport, broadcaster: broadcaster)
    _ = await client.refresh()

    let stream = await broadcaster.updates()
    var iterator = stream.makeAsyncIterator()
    guard case .snapshot = await iterator.next() else {
      return XCTFail("a new subscriber must be replayed the current snapshot")
    }

    await client.identityChanged(bindingDigest: "digest-b", signedOut: false)
    let next = await iterator.next()
    XCTAssertEqual(next, .cleared(.identityChanged))
  }

  func testClearCustomerStateRemovesTheCache() async throws {
    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, cache) = makeClient(transport: transport)
    _ = await client.refresh()

    await client.clearCustomerState()

    let cleared = await cache.clearCount
    XCTAssertEqual(cleared, 1)
    let snapshot = await client.snapshot()
    XCTAssertNil(snapshot)
  }

  // MARK: Bootstrap

  // Risk: a launch must have an answer before the first network round trip, or
  // every cold start shows a paying customer a paywall.
  func testBootstrapServesTheCachedSnapshotWithoutTheNetwork() async throws {
    let cache = MosaicCustomerEntitlementMemoryCacheStore()
    let good = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (primed, _) = makeClient(transport: good, cache: cache)
    _ = await primed.refresh()

    let offline = FailingSyncTransport()
    let (client, _) = makeClient(transport: offline, cache: cache)
    await client.bootstrap()

    let check = await client.check(key: "pro")
    XCTAssertEqual(check.state, .active)
    let requests = await offline.requestCount
    XCTAssertEqual(requests, 0)
  }

  // MARK: Observation

  // Risk: a rejected snapshot that emitted would tell observers the state
  // advanced when it did not.
  func testRejectedSnapshotsNeverEmit() async throws {
    let broadcaster = MosaicCustomerEntitlementBroadcaster()
    let transport = StubSyncTransport([
      ok(try snapshotData("newer-snapshot.json")),
      ok(try invalidData("older-snapshot-version-rejected.json")),
    ])
    let (client, _) = makeClient(
      transport: transport, broadcaster: broadcaster,
      now: try contractTimestamp("2026-07-28T14:30:00.000Z"))
    _ = await client.refresh()
    _ = await client.refresh()

    let current = await broadcaster.currentUpdate
    guard case .snapshot(let update) = current else {
      return XCTFail("the last emission must be the accepted snapshot")
    }
    XCTAssertEqual(update.snapshot.snapshotVersion, 14)
  }

  func testEveryObserverSeesTheSameChange() async throws {
    let broadcaster = MosaicCustomerEntitlementBroadcaster()
    var firstIterator = await broadcaster.updates().makeAsyncIterator()
    var secondIterator = await broadcaster.updates().makeAsyncIterator()

    let transport = StubSyncTransport([ok(try snapshotData("active-subscription.json"))])
    let (client, _) = makeClient(transport: transport, broadcaster: broadcaster)
    _ = await client.refresh()

    // With nothing cached, both streams see `loading` and then the accepted
    // snapshot — and both see the same sequence, which is the fan-out property
    // a single-consumer AsyncStream cannot provide on its own.
    let firstLoading = await firstIterator.next()
    let secondLoading = await secondIterator.next()
    XCTAssertEqual(firstLoading, .loading)
    XCTAssertEqual(secondLoading, .loading)
    guard case .snapshot = await firstIterator.next(), case .snapshot = await secondIterator.next()
    else { return XCTFail("both observers must receive the accepted snapshot") }
  }
}
