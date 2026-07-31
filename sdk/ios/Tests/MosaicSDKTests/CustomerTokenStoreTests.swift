import Foundation
import XCTest

@testable import MosaicSDK

/// Counts calls so single-flight and retry-budget behaviour is observable.
private actor RecordingTokenProvider: MosaicCustomerTokenProvider {
  private var results: [MosaicCustomerTokenResult]
  private(set) var calls: [Bool] = []
  private let delay: Duration?

  init(results: [MosaicCustomerTokenResult], delay: Duration? = nil) {
    self.results = results
    self.delay = delay
  }

  var callCount: Int { calls.count }
  var forcedCallCount: Int { calls.filter { $0 }.count }

  func customerAccessToken(forceRefresh: Bool) async -> MosaicCustomerTokenResult {
    calls.append(forceRefresh)
    if let delay { try? await Task.sleep(for: delay) }
    return results.count > 1 ? results.removeFirst() : (results.first ?? .unavailable)
  }
}

final class CustomerTokenStoreTests: XCTestCase {

  private func token(_ value: String) -> MosaicCustomerTokenResult {
    .token(MosaicCustomerAccessToken(value))
  }

  // Risk: a token in a log, a crash report, or a telemetry payload is a leaked
  // credential for someone's billing state. The type is the only thing standing
  // between an ordinary string interpolation and that outcome.
  func testTokenNeverPrintsItsValue() {
    let token = MosaicCustomerAccessToken("mcat_thisisasecretvalue")
    XCTAssertFalse("\(token)".contains("thisisasecret"))
    XCTAssertFalse(String(reflecting: token).contains("thisisasecret"))
    XCTAssertFalse(String(describing: token).contains("thisisasecret"))
  }

  // Risk: ten screens asking for entitlements at launch must produce one call
  // into the host's backend, not ten. A token endpoint is authenticated and
  // rate-limited; a thundering herd from every app launch is a real outage mode.
  func testConcurrentRequestsMakeOneProviderCall() async {
    let provider = RecordingTokenProvider(results: [token("a")], delay: .milliseconds(40))
    let store = MosaicCustomerTokenStore(provider: provider)

    async let first = store.token()
    async let second = store.token()
    async let third = store.token()
    let outcomes = await [first, second, third]

    for outcome in outcomes {
      guard case .lease(let lease) = outcome else { return XCTFail("expected a lease") }
      XCTAssertEqual(lease.generation, 0)
    }
    let calls = await provider.callCount
    XCTAssertEqual(calls, 1)
  }

  // Risk: retrying a refused token forever turns a Mosaic outage into a request
  // storm. Exactly one forced refresh per generation is the contract obligation.
  func testExactlyOneForcedRefreshPerGeneration() async {
    let provider = RecordingTokenProvider(results: [token("a"), token("b"), token("c")])
    let store = MosaicCustomerTokenStore(provider: provider)

    guard case .lease(let first) = await store.token() else { return XCTFail("expected a lease") }

    // First 401: the token is refreshed and a new lease issued.
    guard case .lease(let refreshed) = await store.recoverFromUnauthorized(first) else {
      return XCTFail("expected a refreshed lease")
    }
    XCTAssertGreaterThan(refreshed.generation, first.generation)
    let forcedAfterFirst = await provider.forcedCallCount
    XCTAssertEqual(forcedAfterFirst, 1)

    // Second 401, now on a freshly minted token: a real failure, not a retry.
    let secondRefusal = await store.recoverFromUnauthorized(refreshed)
    XCTAssertEqual(secondRefusal, .unavailable(.notAuthorized))
    let forcedAfterSecond = await provider.forcedCallCount
    XCTAssertEqual(forcedAfterSecond, 1)
  }

  // Risk: a 401 that raced an identity change must not consume the new
  // identity's single retry, or one unlucky interleaving locks a signed-in user
  // out of their own entitlements.
  func testStaleUnauthorizedDoesNotConsumeTheNewGenerationsRetry() async {
    let provider = RecordingTokenProvider(results: [token("a"), token("b"), token("c")])
    let store = MosaicCustomerTokenStore(provider: provider)
    guard case .lease(let stale) = await store.token() else { return XCTFail("expected a lease") }

    await store.invalidate()

    // The refusal belongs to the previous identity.
    guard case .lease(let current) = await store.recoverFromUnauthorized(stale) else {
      return XCTFail("expected the current lease")
    }
    let forced = await provider.forcedCallCount
    XCTAssertEqual(forced, 0, "a stale refusal must not force a refresh")

    // The new generation still has its own retry available.
    guard case .lease = await store.recoverFromUnauthorized(current) else {
      return XCTFail("the current generation must still have its retry")
    }
  }

  // Risk: a host backend that cannot mint a token has not revoked anyone's
  // subscription. Reporting `inactive` here would cancel every paying customer
  // whenever the host's auth service hiccups.
  func testProviderFailureReportsUnavailableAndBacksOff() async {
    let provider = RecordingTokenProvider(results: [.unavailable])
    let store = MosaicCustomerTokenStore(provider: provider, failureCooldown: 60)

    let first = await store.token()
    let second = await store.token()
    XCTAssertEqual(first, .unavailable(.tokenProviderFailed))
    XCTAssertEqual(second, .unavailable(.tokenProviderFailed))
    let calls = await provider.callCount
    XCTAssertEqual(calls, 1, "the cooldown must suppress the second call")
  }

  func testSignedOutIsDistinctFromUnavailable() async {
    let provider = RecordingTokenProvider(results: [.signedOut])
    let store = MosaicCustomerTokenStore(provider: provider)

    let first = await store.token()
    // Still signed out without asking again.
    let second = await store.token()
    XCTAssertEqual(first, .signedOut)
    XCTAssertEqual(second, .signedOut)
    let calls = await provider.callCount
    XCTAssertEqual(calls, 1)
  }

  // Risk: a token that outlives a logout is the previous user's credential in
  // the next user's session.
  func testSignOutDiscardsTheTokenAndBumpsTheGeneration() async {
    let provider = RecordingTokenProvider(results: [token("a")])
    let store = MosaicCustomerTokenStore(provider: provider)
    _ = await store.token()

    let before = await store.currentGeneration
    await store.signOut()

    let held = await store.hasToken
    XCTAssertFalse(held)
    let after = await store.currentGeneration
    XCTAssertGreaterThan(after, before)
    let afterSignOut = await store.token()
    XCTAssertEqual(afterSignOut, .signedOut)
  }

  // Risk: an in-flight token fetch that resolves after an identity change would
  // otherwise cache the previous user's token under the new identity.
  func testInFlightFetchResolvingAfterInvalidationIsDiscarded() async {
    let provider = RecordingTokenProvider(results: [token("a")], delay: .milliseconds(60))
    let store = MosaicCustomerTokenStore(provider: provider)

    let pending = Task { await store.token() }
    try? await Task.sleep(for: .milliseconds(10))
    await store.invalidate()
    _ = await pending.value

    let held = await store.hasToken
    XCTAssertFalse(held, "a token fetched for a discarded identity must not be retained")
  }

  func testNoProviderReportsNotConfigured() async {
    let store = MosaicCustomerTokenStore(provider: nil)
    let outcome = await store.token()
    XCTAssertEqual(outcome, .unavailable(.notConfigured))
  }

  // Risk: carrying a token generation across an authority cutover lets a token
  // minted for the old epoch race the urgent post-cutover sync. The token stays
  // opaque; only the local generation is rebound.
  func testAuthorityEpochChangeRebindsOpaqueTokenGenerationOnce() async {
    let provider = RecordingTokenProvider(results: [token("a"), token("b")])
    let store = MosaicCustomerTokenStore(provider: provider)
    guard case .lease(let initial) = await store.token() else {
      return XCTFail("expected initial lease")
    }
    XCTAssertNil(initial.authorityEpoch)

    await store.bind(toAuthorityEpoch: 7)
    guard case .lease(let rebound) = await store.token() else {
      return XCTFail("expected rebound lease")
    }
    XCTAssertEqual(rebound.authorityEpoch, 7)
    XCTAssertGreaterThan(rebound.generation, initial.generation)

    let generation = rebound.generation
    await store.bind(toAuthorityEpoch: 7)
    guard case .lease(let sameEpoch) = await store.token() else {
      return XCTFail("expected retained lease")
    }
    XCTAssertEqual(sameEpoch.generation, generation)
    let calls = await provider.callCount
    XCTAssertEqual(calls, 2)
  }
}
