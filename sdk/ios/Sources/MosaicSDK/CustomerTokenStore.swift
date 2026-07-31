import Foundation

/// A token plus the generation it belongs to.
///
/// The generation is what makes "exactly one retry per 401" enforceable: a 401
/// carries back the lease it was issued under, so a response that raced an
/// identity change cannot consume the new identity's single retry.
struct MosaicCustomerTokenLease: Sendable, Equatable {
  let token: MosaicCustomerAccessToken
  let generation: UInt64
}

/// Reads whatever Customer Access Token is currently held, without causing one
/// to be fetched.
///
/// Deliberately narrow. A caller on a delivery path must be able to attach a
/// token when one happens to exist without ever making the absence of one into a
/// network call, a suspension, or a failure.
protocol MosaicCustomerTokenSource: Sendable {
  func heldCustomerToken() async -> MosaicCustomerAccessToken?
}

enum MosaicCustomerTokenOutcome: Sendable, Equatable {
  case lease(MosaicCustomerTokenLease)
  case signedOut
  case unavailable(MosaicCustomerUnavailableReason)
}

/// Holds the Customer Access Token **in memory only**.
///
/// Nothing here writes to disk, the keychain, or user defaults, and the token is
/// never logged. A token is short-lived by contract and the host backend can
/// always mint another, so persisting one would add a durable secret to the
/// device in exchange for nothing.
actor MosaicCustomerTokenStore: MosaicCustomerTokenSource {
  private let provider: (any MosaicCustomerTokenProvider)?
  private let clock: @Sendable () -> Date
  /// A provider that just failed is not asked again immediately: a backend
  /// outage must not become a request storm from every device at once.
  private let failureCooldown: TimeInterval

  private var cached: MosaicCustomerAccessToken?
  private var generation: UInt64 = 0
  /// The generation that was minted *by* a forced refresh. A 401 on a freshly
  /// minted token is a real failure, not something to retry.
  private var forcedRefreshGeneration: UInt64?
  private var cooldownUntil: Date?
  private var signedOut = false
  private var inFlight: (id: UInt64, task: Task<MosaicCustomerTokenOutcome, Never>)?
  private var fetchSequence: UInt64 = 0

  init(
    provider: (any MosaicCustomerTokenProvider)?,
    failureCooldown: TimeInterval = 30,
    clock: @escaping @Sendable () -> Date = Date.init
  ) {
    self.provider = provider
    self.failureCooldown = failureCooldown
    self.clock = clock
  }

  var isConfigured: Bool { provider != nil }
  var hasToken: Bool { cached != nil }

  /// The token already held, or `nil`. Never fetches and never refreshes: a
  /// caller using this must treat absence as "carry on without it".
  func heldCustomerToken() -> MosaicCustomerAccessToken? {
    signedOut ? nil : cached
  }
  var currentGeneration: UInt64 { generation }

  /// The token to attach to a sync request, fetching one if none is held.
  func token() async -> MosaicCustomerTokenOutcome {
    guard provider != nil else { return .unavailable(.notConfigured) }
    if signedOut { return .signedOut }
    if let cached { return .lease(.init(token: cached, generation: generation)) }
    if let cooldownUntil, clock() < cooldownUntil {
      return .unavailable(.tokenProviderFailed)
    }
    return await fetch(forceRefresh: false)
  }

  /// Handles a refusal from Mosaic for the token issued under `lease`.
  ///
  /// Exactly one forced refresh per generation. A second 401 on a freshly minted
  /// token means the token is not the problem, and retrying forever turns an
  /// outage into a request storm.
  func recoverFromUnauthorized(_ lease: MosaicCustomerTokenLease) async
    -> MosaicCustomerTokenOutcome
  {
    guard provider != nil else { return .unavailable(.notConfigured) }
    if signedOut { return .signedOut }
    // The refusal belongs to an identity the SDK has already moved past. It
    // says nothing about the token now held.
    guard lease.generation == generation else { return await token() }
    guard forcedRefreshGeneration != lease.generation else {
      return .unavailable(.notAuthorized)
    }
    // A forced refresh mints a new generation, so anything still holding the
    // refused lease is recognisably stale and cannot spend this generation's
    // retry a second time.
    cached = nil
    generation &+= 1
    inFlight?.task.cancel()
    inFlight = nil
    let outcome = await fetch(forceRefresh: true)
    if case .lease(let refreshed) = outcome {
      forcedRefreshGeneration = refreshed.generation
    }
    return outcome
  }

  /// Discards the token and moves to a new generation, cancelling any in-flight
  /// fetch. Callers use this on identity change and on host-requested clears.
  func invalidate() {
    cached = nil
    cooldownUntil = nil
    signedOut = false
    forcedRefreshGeneration = nil
    generation &+= 1
    inFlight?.task.cancel()
    inFlight = nil
  }

  /// Logout semantics: the token is discarded and every later read reports
  /// signed out until the host identifies someone.
  func signOut() {
    invalidate()
    signedOut = true
  }

  private func fetch(forceRefresh: Bool) async -> MosaicCustomerTokenOutcome {
    // One in-flight fetch at a time. Ten screens asking at once must produce one
    // call into the host's backend, not ten.
    if let inFlight { return await inFlight.task.value }
    guard let provider else { return .unavailable(.notConfigured) }
    fetchSequence &+= 1
    let id = fetchSequence
    let requestedGeneration = generation
    let task = Task { [provider] in
      await provider.customerAccessToken(forceRefresh: forceRefresh)
    }
    let holder = Task<MosaicCustomerTokenOutcome, Never> { [weak self] in
      let result = await task.value
      guard let self else { return .unavailable(.tokenProviderFailed) }
      return await self.apply(result, requestedGeneration: requestedGeneration)
    }
    inFlight = (id, holder)
    let outcome = await holder.value
    if inFlight?.id == id { inFlight = nil }
    return outcome
  }

  private func apply(
    _ result: MosaicCustomerTokenResult, requestedGeneration: UInt64
  ) -> MosaicCustomerTokenOutcome {
    // An answer for an identity the SDK has moved past is discarded rather than
    // stored: caching it would attach the previous user's token to the new one.
    guard requestedGeneration == generation, !signedOut else {
      if signedOut { return .signedOut }
      return .unavailable(.tokenProviderFailed)
    }
    switch result {
    case .token(let token):
      cached = token
      cooldownUntil = nil
      return .lease(.init(token: token, generation: generation))
    case .signedOut:
      cached = nil
      signedOut = true
      return .signedOut
    case .unavailable:
      cached = nil
      cooldownUntil = clock().addingTimeInterval(failureCooldown)
      return .unavailable(.tokenProviderFailed)
    }
  }
}
