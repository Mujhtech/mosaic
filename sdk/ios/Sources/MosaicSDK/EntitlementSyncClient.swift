import Foundation

public enum MosaicCustomerEntitlementRefreshResult: Sendable, Equatable {
  case updated(snapshotVersion: Int64)
  /// The cached snapshot was confirmed current and its freshness window slid.
  case unchanged(snapshotVersion: Int64)
  case skippedFresh(snapshotVersion: Int64)
  /// The refresh failed and the previously accepted snapshot still stands.
  case preserved(snapshotVersion: Int64, diagnostic: MosaicDiagnostic)
  case unavailable(reason: MosaicCustomerUnavailableReason, diagnostics: [MosaicDiagnostic])
  case signedOut
}

/// Synchronizes and holds the authoritative Entitlement snapshot.
///
/// The invariant this actor exists to keep: **a rejection yields `unknown` and
/// preserves the cache, never `inactive`.** A reader that collapsed "I could not
/// find out" into "you do not have it" would turn every Mosaic outage into a
/// mass revocation experienced by paying customers, and would do it most
/// reliably at exactly the moment Mosaic is least able to notice.
actor MosaicCustomerEntitlementClient {
  private enum PersistenceOutcome {
    case saved
    case failed
    case superseded
  }

  private struct AcceptedSnapshot: Sendable {
    var snapshot: MosaicCustomerEntitlementSnapshot
    var recordData: Data
    var entityTag: String
    var issuedAt: Date
    var refreshAfter: Date
    var validUntil: Date
    var staleGraceSeconds: Int
    var trustedTime: MosaicTrustedTimeAnchor?
    var authority: MosaicCustomerAccessAuthority?
    var snapshotAuthorityDigest: String?
    var minimumSupport: MosaicCustomerMinimumAccessSupport?
  }

  private struct RetainedAuthorityVerification {
    let epoch: Int64
    let snapshotVersion: Int64
    let snapshotAuthorityDigest: String
  }

  private struct PendingPolicyInvalidation {
    let record: MosaicCustomerEntitlementCacheRecord
    let store: any MosaicCustomerEntitlementCacheStore
  }

  private let publicSDKKey: String
  private let endpointURL: URL
  private let requestTimeout: TimeInterval
  private let transport: any MosaicEntitlementSyncTransport
  private let tokenStore: MosaicCustomerTokenStore
  private let broadcaster: MosaicCustomerEntitlementBroadcaster
  private let authorityBroadcaster: MosaicCustomerAccessAuthorityBroadcaster
  private let cacheStoreFactory: @Sendable (String) -> any MosaicCustomerEntitlementCacheStore
  private let clock: @Sendable () -> Date
  private let applicationMetadata: MosaicEntitlementApplicationMetadata?
  private let authorityAware: Bool

  private var cacheStore: any MosaicCustomerEntitlementCacheStore
  private var bindingDigest: String
  private var accepted: AcceptedSnapshot?
  private var cacheStateOverride: MosaicCustomerEntitlementCacheState?
  private var diagnostics: [MosaicDiagnostic] = []
  private var acceptedCount: UInt64 = 0
  private var rejectedCount: UInt64 = 0
  private var lastRejectionReason: String?
  private var inFlight: (id: UInt64, task: Task<MosaicCustomerEntitlementRefreshResult, Never>)?
  private var refreshSequence: UInt64 = 0
  /// Bumped on every identity transition. A response minted for a previous
  /// generation is discarded rather than applied.
  private var generation: UInt64 = 0
  private var urgentAuthorityRefreshPending = false
  private var authorityUnavailableReason: MosaicCustomerUnavailableReason?
  private var pendingPolicyInvalidation: PendingPolicyInvalidation?

  init(
    publicSDKKey: String,
    baseURL: URL,
    requestTimeout: TimeInterval,
    transport: any MosaicEntitlementSyncTransport,
    tokenStore: MosaicCustomerTokenStore,
    broadcaster: MosaicCustomerEntitlementBroadcaster = MosaicCustomerEntitlementBroadcaster(),
    authorityBroadcaster: MosaicCustomerAccessAuthorityBroadcaster =
      MosaicCustomerAccessAuthorityBroadcaster(),
    bindingDigest: String,
    cacheStoreFactory: @escaping @Sendable (String) -> any MosaicCustomerEntitlementCacheStore,
    applicationMetadata: MosaicEntitlementApplicationMetadata? = nil,
    authorityAware: Bool = false,
    clock: @escaping @Sendable () -> Date = Date.init
  ) {
    self.publicSDKKey = publicSDKKey
    endpointURL =
      baseURL
      .appendingPathComponent("v1", isDirectory: true)
      .appendingPathComponent("sdk", isDirectory: true)
      .appendingPathComponent("billing", isDirectory: true)
      .appendingPathComponent("entitlements", isDirectory: false)
    self.requestTimeout = requestTimeout
    self.transport = transport
    self.tokenStore = tokenStore
    self.broadcaster = broadcaster
    self.authorityBroadcaster = authorityBroadcaster
    self.bindingDigest = bindingDigest
    self.cacheStoreFactory = cacheStoreFactory
    cacheStore = cacheStoreFactory(bindingDigest)
    self.applicationMetadata = applicationMetadata
    self.authorityAware = authorityAware
    self.clock = clock
  }

  // MARK: Observation

  func updates() async -> AsyncStream<MosaicCustomerEntitlementUpdate> {
    await broadcaster.updates()
  }

  func authorityUpdates() async -> AsyncStream<MosaicCustomerAccessAuthorityUpdate> {
    await authorityBroadcaster.updates()
  }

  func authorityState() async -> MosaicCustomerAccessAuthorityUpdate? {
    await authorityBroadcaster.currentUpdate
  }

  func isMosaicAuthoritative() -> Bool { accepted?.authority?.isMosaicAuthoritative == true }

  func isAuthorityAwareRuntime() -> Bool { authorityAware }

  func targetingAuthorityKind() -> MosaicCustomerAccessAuthorityKind? {
    accepted?.authority?.kind
  }

  // MARK: Reading

  /// The device instant freshness is judged against.
  ///
  /// A server-anchored monotonic reading is preferred; the device wall clock is
  /// the fallback, and the unreliable-clock rule in the freshness policy is what
  /// keeps that fallback safe.
  private func now() -> Date {
    accepted?.trustedTime?.now() ?? clock()
  }

  private func currentCacheState() -> MosaicCustomerEntitlementCacheState {
    if let cacheStateOverride { return cacheStateOverride }
    guard let accepted else { return .missing }
    return MosaicCustomerEntitlementFreshness.evaluate(
      issuedAt: accepted.issuedAt,
      refreshAfter: accepted.refreshAfter,
      validUntil: accepted.validUntil,
      staleGraceSeconds: accepted.staleGraceSeconds,
      deviceNow: now())
  }

  func cacheState() -> MosaicCustomerEntitlementCacheState { currentCacheState() }

  func snapshot() -> MosaicCustomerEntitlementSnapshotUpdate? {
    guard let accepted else { return nil }
    return .init(
      snapshot: accepted.snapshot, cacheState: currentCacheState(), authority: accepted.authority)
  }

  func check(key: String) async -> MosaicCustomerEntitlementCheck {
    let state = currentCacheState()
    guard let accepted else {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: key,
        state: .unavailable(reason: await unavailableReasonWithoutSnapshot()),
        cacheState: state)
    }
    if authorityAware, accepted.authority?.kind != .mosaic {
      // A source-authoritative snapshot is retained for authority transitions,
      // cache continuity, and diagnostics. It is not Mosaic's access answer.
      // Placement targeting has its own provider-delegation seam; this direct
      // host API must never expose the retained Mosaic projection as current.
      return MosaicCustomerEntitlementCheck(
        entitlementKey: key,
        state: .unavailable(reason: .authorityUnknown),
        snapshotVersion: accepted.snapshot.snapshotVersion,
        asOf: accepted.snapshot.asOf,
        cacheState: state)
    }
    return accepted.snapshot.check(key: key, cacheState: state)
  }

  private func unavailableReasonWithoutSnapshot() async -> MosaicCustomerUnavailableReason {
    if let authorityUnavailableReason { return authorityUnavailableReason }
    guard await tokenStore.isConfigured else { return .notConfigured }
    switch await tokenStore.token() {
    case .signedOut: return .signedOut
    case .unavailable(let reason): return reason
    case .lease: return .noSnapshot
    }
  }

  func diagnosticsSnapshot() async -> MosaicCustomerEntitlementDiagnostics {
    MosaicCustomerEntitlementDiagnostics(
      isConfigured: await tokenStore.isConfigured,
      hasCustomerToken: await tokenStore.hasToken,
      tokenGeneration: await tokenStore.currentGeneration,
      cacheState: currentCacheState(),
      snapshotVersion: accepted?.snapshot.snapshotVersion,
      billingCustomerID: accepted?.snapshot.billingCustomerID,
      projectionState: accepted?.snapshot.projectionStatus.state,
      entryCount: accepted?.snapshot.entries.count ?? 0,
      acceptedSnapshotCount: acceptedCount,
      rejectedSnapshotCount: rejectedCount,
      lastRejectionReason: lastRejectionReason,
      lastSafeCode: diagnostics.last?.code,
      isRefreshInFlight: inFlight != nil,
      authority: accepted?.authority,
      minimumSupport: accepted?.minimumSupport,
      snapshotAuthorityDigest: accepted?.snapshotAuthorityDigest,
      applicationID: applicationMetadata?.applicationID,
      appVersion: applicationMetadata?.appVersion,
      supportedCapabilities: applicationMetadata == nil
        ? [] : MosaicEntitlementApplicationMetadata.capabilities,
      urgentAuthorityRefreshPending: urgentAuthorityRefreshPending)
  }

  // MARK: Lifecycle

  /// Loads any cached snapshot without touching the network, so a launch has an
  /// answer before the first request completes.
  func bootstrap() async {
    guard await retryPendingPolicyInvalidation() else { return }
    do {
      guard let record = try await cacheStore.load() else { return }
      if authorityAware, record.isPolicyUnavailableTombstone {
        accepted = nil
        cacheStateOverride = .authorityUnknown
        authorityUnavailableReason = .authorityUnknown
        self.record(
          code: "entitlement_authority_policy_unavailable", stage: .entitlementValidation)
        await authorityBroadcaster.emit(
          .unavailable(reason: .policyUnavailable, minimumSupport: nil))
        await broadcaster.emit(.unavailable(.authorityUnknown))
        return
      }
      if authorityAware, record.formatVersion == 1 {
        cacheStateOverride = .authorityUnknown
        authorityUnavailableReason = .authorityUnknown
        self.record(code: "entitlement_cache_authority_unknown", stage: .entitlementCache)
        try? await cacheStore.clear()
        await authorityBroadcaster.emit(
          .unavailable(reason: .authorityUnknown, minimumSupport: nil))
        await broadcaster.emit(.unavailable(.authorityUnknown))
        return
      }
      if authorityAware {
        let decoded = try MosaicCustomerAuthorityCodec.decode(record.recordData)
        guard
          case .snapshot(
            let snapshot, let authority, let authorityDigest, let minimumSupport, _) = decoded,
          record.formatVersion == 2,
          record.authority == authority,
          record.snapshotAuthorityDigest == authorityDigest,
          record.minimumSupport == minimumSupport,
          record.applicationID == authority.scope.applicationID,
          record.platform == authority.scope.platform,
          record.billingCustomerID == snapshot.billingCustomerID,
          record.projectID == snapshot.projectID,
          record.environmentID == snapshot.environmentID,
          record.snapshotVersion == snapshot.snapshotVersion
        else {
          throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
            code: "cached_authority_snapshot_rejected")
        }
        guard supportIsCompatible(minimumSupport) else {
          _ = await clearAuthorityUnavailable(
            reason: .unsupportedAppVersion, minimumSupport: minimumSupport,
            code: "entitlement_authority_minimum_support_not_met")
          return
        }
        do {
          try validateExpectedScope(authority.scope, snapshot: snapshot)
        } catch {
          _ = await clearAuthorityUnavailable(
            reason: .scopeMismatch, minimumSupport: minimumSupport,
            code: "entitlement_authority_scope_mismatch")
          return
        }
        accepted = AcceptedSnapshot(
          snapshot: snapshot,
          recordData: record.recordData,
          entityTag: record.entityTag,
          issuedAt: record.issuedAt,
          refreshAfter: record.refreshAfter,
          validUntil: record.validUntil,
          staleGraceSeconds: record.staleGraceSeconds,
          trustedTime: MosaicTrustedTimeAnchor.cached(
            serverTime: record.serverTime, localReceiptTime: record.localReceiptTime,
            systemUptime: record.systemUptime, now: clock()),
          authority: authority,
          snapshotAuthorityDigest: authorityDigest,
          minimumSupport: minimumSupport)
        await tokenStore.bind(toAuthorityEpoch: authority.epoch)
        await emitAuthority(authority, minimumSupport: minimumSupport)
        await emitCurrent()
        return
      }
      let decoded = try MosaicCustomerEntitlementCodec.decode(record.recordData)
      guard case .snapshot(let snapshot) = decoded.record, decoded.contentDigestValid else {
        throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
          code: "cached_snapshot_rejected")
      }
      accepted = AcceptedSnapshot(
        snapshot: snapshot,
        recordData: record.recordData,
        entityTag: record.entityTag,
        issuedAt: record.issuedAt,
        refreshAfter: record.refreshAfter,
        validUntil: record.validUntil,
        staleGraceSeconds: record.staleGraceSeconds,
        trustedTime: MosaicTrustedTimeAnchor.cached(
          serverTime: record.serverTime, localReceiptTime: record.localReceiptTime,
          systemUptime: record.systemUptime, now: clock()),
        authority: nil,
        snapshotAuthorityDigest: nil,
        minimumSupport: nil)
      await emitCurrent()
    } catch {
      // A cache that cannot be read is discarded, never interpreted.
      cacheStateOverride = .invalid
      record(code: "entitlement_cache_unreadable", stage: .entitlementCache)
      try? await cacheStore.clear()
    }
  }

  /// Identity transition. The order is the point: bump the generation so
  /// in-flight work is recognisably stale, cancel it, clear before any read can
  /// return the previous person's grants, then emit an explicit state so an
  /// observer sees the transition rather than inferring it from silence.
  func identityChanged(bindingDigest newDigest: String, signedOut: Bool) async {
    generation &+= 1
    inFlight?.task.cancel()
    inFlight = nil
    accepted = nil
    cacheStateOverride = nil
    authorityUnavailableReason = nil
    if signedOut {
      await tokenStore.signOut()
    } else {
      await tokenStore.invalidate()
    }
    if newDigest != bindingDigest {
      bindingDigest = newDigest
      cacheStore = cacheStoreFactory(newDigest)
    }
    await broadcaster.emit(signedOut ? .signedOut : .cleared(.identityChanged))
    await authorityBroadcaster.emit(signedOut ? .signedOut : .cleared(.identityChanged))
  }

  /// Host-requested clear: discards the token and deletes this customer's cache.
  func clearCustomerState() async {
    generation &+= 1
    inFlight?.task.cancel()
    inFlight = nil
    accepted = nil
    cacheStateOverride = nil
    authorityUnavailableReason = nil
    try? await cacheStore.clear()
    await tokenStore.invalidate()
    await broadcaster.emit(.cleared(.hostRequested))
    await authorityBroadcaster.emit(.cleared(.hostRequested))
  }

  // MARK: Refresh

  func refreshIfNeeded() async -> MosaicCustomerEntitlementRefreshResult {
    if let accepted, case .fresh = currentCacheState() {
      return .skippedFresh(snapshotVersion: accepted.snapshot.snapshotVersion)
    }
    return await refresh()
  }

  func refreshAuthorityBeforeConfigurationIfNeeded() async {
    guard authorityAware else { return }
    let transition = accepted?.authority?.transitionState
    guard
      urgentAuthorityRefreshPending || transition == .cutoverPending || transition == .stabilizing
    else { return }
    _ = await refresh()
  }

  /// Single-flight. Ten call sites asking at once produce one request.
  func refresh() async -> MosaicCustomerEntitlementRefreshResult {
    if let task = inFlight?.task { return await task.value }
    refreshSequence &+= 1
    let id = refreshSequence
    let task = Task { await performRefresh() }
    inFlight = (id, task)
    let result = await task.value
    if inFlight?.id == id { inFlight = nil }
    if urgentAuthorityRefreshPending {
      urgentAuthorityRefreshPending = false
      Task { _ = await self.refresh() }
    }
    return result
  }

  private func performRefresh() async -> MosaicCustomerEntitlementRefreshResult {
    guard await retryPendingPolicyInvalidation() else {
      return .unavailable(reason: .authorityUnknown, diagnostics: diagnostics)
    }
    let startGeneration = generation
    switch await tokenStore.token() {
    case .signedOut:
      await broadcaster.emit(.signedOut)
      return .signedOut
    case .unavailable(let reason):
      return await unavailable(
        reason, code: "entitlement_token_unavailable", stage: .entitlementAuthentication)
    case .lease(let lease):
      // `loading` is emitted only when there is nothing to serve. A background
      // refresh of an already-accepted snapshot must not flick every observer
      // through an indeterminate state, and must not leave the stream parked
      // there if the refresh is then rejected.
      if accepted == nil { await broadcaster.emit(.loading) }
      return await sync(with: lease, startGeneration: startGeneration, allowRetry: true)
    }
  }

  private func sync(
    with lease: MosaicCustomerTokenLease, startGeneration: UInt64, allowRetry: Bool
  ) async -> MosaicCustomerEntitlementRefreshResult {
    var headers = [
      MosaicEntitlementSyncHeader.authorization: "Bearer \(lease.token.value)",
      MosaicEntitlementSyncHeader.sdkKey: publicSDKKey,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Mosaic-SDK-Platform": "ios",
      "Mosaic-SDK-Version": mosaicSDKVersion,
    ]
    if !authorityAware, let entityTag = accepted?.entityTag {
      headers[MosaicEntitlementSyncHeader.ifNoneMatch] = "\"\(entityTag)\""
    }

    let body: Data
    do {
      if authorityAware {
        guard let applicationMetadata else {
          return await preserveOrUnavailable(
            code: "entitlement_application_metadata_unavailable",
            stage: .entitlementValidation, reason: .authorityUnknown)
        }
        let retained = retainedAuthorityVerification()
        body = try MosaicEntitlementSyncRequestBody.encodeAuthorityAware(
          knownAuthorityEpoch: retained?.epoch,
          knownSnapshotVersion: retained?.snapshotVersion,
          knownSnapshotAuthorityDigest: retained?.snapshotAuthorityDigest,
          application: applicationMetadata)
      } else {
        body = try MosaicEntitlementSyncRequestBody.encode(
          knownSnapshotVersion: accepted?.snapshot.snapshotVersion,
          entityTag: accepted?.entityTag,
          correlationID: MosaicEntitlementSyncRequestBody.correlationID())
      }
    } catch {
      return await preserveOrUnavailable(
        code: "entitlement_request_encoding_failed", stage: .entitlementValidation,
        reason: .serviceUnavailable)
    }

    let response: MosaicEntitlementSyncHTTPResponse
    do {
      response = try await transport.fetch(
        MosaicEntitlementSyncHTTPRequest(
          url: endpointURL, headers: headers, body: body, timeout: requestTimeout))
    } catch {
      // A network failure has not revoked anyone's subscription.
      return await preserveOrUnavailable(
        code: "entitlement_network_unavailable", stage: .entitlementTransport,
        reason: .serviceUnavailable)
    }

    // A response for an identity the SDK has already moved past is discarded
    // whole. Applying it would attach the previous customer's access to the new
    // session.
    guard generation == startGeneration else {
      return .unavailable(reason: .signedOut, diagnostics: diagnostics)
    }

    switch response.statusCode {
    case 200:
      return authorityAware ? await acceptAuthority(response) : await accept(response)
    case 304:
      if authorityAware {
        return await preserveOrUnavailable(
          code: "entitlement_unexpected_not_modified", stage: .entitlementTransport,
          reason: .serviceUnavailable)
      }
      return await confirmUnchanged(response)
    case 401, 403:
      guard allowRetry else {
        return await preserveOrUnavailable(
          code: "entitlement_not_authorized", stage: .entitlementAuthentication,
          reason: .notAuthorized)
      }
      switch await tokenStore.recoverFromUnauthorized(lease) {
      case .lease(let refreshed):
        guard generation == startGeneration else {
          return .unavailable(reason: .signedOut, diagnostics: diagnostics)
        }
        return await sync(
          with: refreshed, startGeneration: startGeneration, allowRetry: false)
      case .signedOut:
        await broadcaster.emit(.signedOut)
        return .signedOut
      case .unavailable(let reason):
        return await preserveOrUnavailable(
          code: "entitlement_not_authorized", stage: .entitlementAuthentication, reason: reason)
      }
    case 409:
      // Billing disabled for this Environment maps to unavailable on every
      // entitlement surface, never to inactive.
      return await preserveOrUnavailable(
        code: "entitlement_billing_disabled", stage: .entitlementValidation,
        reason: .billingDisabled)
    default:
      return await preserveOrUnavailable(
        code: "entitlement_http_\(response.statusCode)", stage: .entitlementTransport,
        reason: .serviceUnavailable)
    }
  }

  // MARK: Acceptance gate

  private func acceptAuthority(_ response: MosaicEntitlementSyncHTTPResponse) async
    -> MosaicCustomerEntitlementRefreshResult
  {
    let record: MosaicCustomerAuthorityRecord
    do {
      record = try MosaicCustomerAuthorityCodec.decode(response.data)
    } catch {
      if let scope = MosaicCustomerAuthorityCodec.policyUnavailableInvalidationScope(response.data)
      {
        return await invalidateForUnavailablePolicy(scope: scope)
      }
      let code =
        (error as? MosaicCustomerEntitlementDecodingError)?.diagnosticCode
        ?? "entitlement_authority_record_rejected"
      rejectedCount &+= 1
      lastRejectionReason = code
      return await preserveOrUnavailable(
        code: code, stage: .entitlementValidation, reason: .serviceUnavailable)
    }

    switch record {
    case .unavailable(let scope, let reason, let minimumSupport):
      guard expectedApplicationScopeMatches(scope) else {
        return await clearAuthorityUnavailable(
          reason: .scopeMismatch, minimumSupport: minimumSupport,
          code: "entitlement_authority_scope_mismatch")
      }
      if reason == .policyUnavailable {
        return await invalidateForUnavailablePolicy(scope: scope)
      }
      return await clearAuthorityUnavailable(
        reason: reason, minimumSupport: minimumSupport,
        code: "entitlement_authority_\(reason.rawValue)")

    case .unchanged(
      let authority, let confirmation, let v1Binding, let authorityDigest, let minimumSupport):
      guard supportIsCompatible(minimumSupport) else {
        return await clearAuthorityUnavailable(
          reason: .unsupportedAppVersion, minimumSupport: minimumSupport,
          code: "entitlement_authority_minimum_support_not_met")
      }
      guard expectedApplicationScopeMatches(authority.scope) else {
        return await clearAuthorityUnavailable(
          reason: .scopeMismatch, minimumSupport: minimumSupport,
          code: "entitlement_authority_scope_mismatch")
      }
      guard var current = accepted, let currentAuthority = current.authority else {
        return await preserveOrUnavailable(
          code: "entitlement_unexpected_unchanged_authority",
          stage: .entitlementValidation, reason: .authorityUnknown)
      }
      guard authority.epoch == currentAuthority.epoch,
        authority.scope == currentAuthority.scope,
        authority.kind == currentAuthority.kind,
        authorityDigest == current.snapshotAuthorityDigest,
        confirmation.billingCustomerID == current.snapshot.billingCustomerID,
        confirmation.projectID == current.snapshot.projectID,
        confirmation.environmentID == current.snapshot.environmentID,
        confirmation.snapshotVersion == current.snapshot.snapshotVersion,
        confirmation.entityTag == current.entityTag,
        confirmation.entityTag == current.snapshot.entityTag,
        confirmation.asOf == current.snapshot.asOf,
        confirmation.projectionStatus.state == current.snapshot.projectionStatus.state,
        confirmation.projectionStatus.lastProjectedAt
          == current.snapshot.projectionStatus.lastProjectedAt,
        confirmation.issuedAt >= current.issuedAt,
        confirmation.refreshAfter >= current.refreshAfter,
        confirmation.validUntil >= current.validUntil
      else {
        // A confirmation cannot move authority. A new epoch must carry a full
        // snapshot so epoch-before-version acceptance remains atomic.
        return await preserveOrUnavailable(
          code: authority.epoch < currentAuthority.epoch
            ? "entitlement_authority_epoch_older"
            : "entitlement_authority_unchanged_mismatch",
          stage: .entitlementValidation, reason: .serviceUnavailable)
      }
      do {
        current.recordData = try MosaicCustomerAuthorityCodec.rebindCachedSnapshot(
          cachedSnapshotData: current.recordData,
          unchangedResponseData: response.data)
      } catch {
        return await preserveOrUnavailable(
          code: "entitlement_authority_digest_mismatch", stage: .entitlementValidation,
          reason: .serviceUnavailable)
      }
      current.authority = authority
      current.minimumSupport = minimumSupport
      current.snapshotAuthorityDigest = authorityDigest
      current.entityTag = confirmation.entityTag
      current.issuedAt = confirmation.issuedAt
      current.refreshAfter = confirmation.refreshAfter
      current.validUntil = confirmation.validUntil
      current.staleGraceSeconds = confirmation.staleGraceSeconds
      guard v1Binding.billingCustomerID == current.snapshot.billingCustomerID,
        v1Binding.projectID == current.snapshot.projectID,
        v1Binding.environmentID == current.snapshot.environmentID,
        current.issuedAt <= current.refreshAfter,
        current.refreshAfter <= current.validUntil
      else {
        return await preserveOrUnavailable(
          code: "entitlement_authority_unchanged_mismatch",
          stage: .entitlementValidation, reason: .serviceUnavailable)
      }
      let horizon =
        current.validUntil.timeIntervalSince(current.issuedAt)
        + TimeInterval(current.staleGraceSeconds)
      guard horizon <= TimeInterval(MosaicCustomerEntitlementPolicy.maxCacheHorizonSeconds) else {
        return await preserveOrUnavailable(
          code: "entitlement_cache_horizon_exceeds_maximum", stage: .entitlementValidation,
          reason: .serviceUnavailable)
      }
      if let serverDate = response.serverDate {
        current.trustedTime = MosaicTrustedTimeAnchor.remote(
          serverTime: serverDate, localReceiptTime: clock())
      }
      let publicationGeneration = generation
      switch await persist(current, expectedGeneration: publicationGeneration) {
      case .saved: break
      case .failed: return await persistenceFailureResult()
      case .superseded:
        return .unavailable(reason: .signedOut, diagnostics: diagnostics)
      }
      await emitAuthority(authority, minimumSupport: minimumSupport)
      guard generation == publicationGeneration else {
        return .unavailable(reason: .signedOut, diagnostics: diagnostics)
      }
      accepted = current
      await emitCurrent()
      return .unchanged(snapshotVersion: confirmation.snapshotVersion)

    case .snapshot(
      let snapshot, let authority, let authorityDigest, let minimumSupport, let v1Binding):
      guard supportIsCompatible(minimumSupport) else {
        return await clearAuthorityUnavailable(
          reason: .unsupportedAppVersion, minimumSupport: minimumSupport,
          code: "entitlement_authority_minimum_support_not_met")
      }
      do {
        try validateExpectedScope(authority.scope, snapshot: snapshot)
      } catch {
        return await clearAuthorityUnavailable(
          reason: .scopeMismatch, minimumSupport: minimumSupport,
          code: "entitlement_authority_scope_mismatch")
      }

      if let current = accepted, let currentAuthority = current.authority {
        if currentAuthority.scope != authority.scope {
          return await clearAuthorityUnavailable(
            reason: .scopeMismatch, minimumSupport: minimumSupport,
            code: "entitlement_authority_scope_mismatch")
        }
        if authority.epoch < currentAuthority.epoch {
          rejectedCount &+= 1
          lastRejectionReason = "older_authority_epoch"
          return await preserveOrUnavailable(
            code: "entitlement_authority_epoch_older", stage: .entitlementValidation,
            reason: .serviceUnavailable)
        }
        if authority.epoch == currentAuthority.epoch {
          guard authority.kind == currentAuthority.kind else {
            rejectedCount &+= 1
            lastRejectionReason = "authority_kind_changed_without_epoch"
            return await preserveOrUnavailable(
              code: "entitlement_authority_kind_changed_without_epoch",
              stage: .entitlementValidation, reason: .serviceUnavailable)
          }
          guard v1Binding.snapshotVersion > current.snapshot.snapshotVersion else {
            rejectedCount &+= 1
            lastRejectionReason = "snapshot_version_not_newer"
            return await preserveOrUnavailable(
              code: "entitlement_snapshot_snapshot_version_not_newer",
              stage: .entitlementValidation, reason: .serviceUnavailable)
          }
          guard snapshot.asOf >= current.snapshot.asOf else {
            rejectedCount &+= 1
            lastRejectionReason = "as_of_regression"
            return await preserveOrUnavailable(
              code: "entitlement_snapshot_as_of_regression", stage: .entitlementValidation,
              reason: .serviceUnavailable)
          }
        }
      }

      let previousEpoch = accepted?.authority?.epoch
      let trustedTime = response.serverDate.map {
        MosaicTrustedTimeAnchor.remote(serverTime: $0, localReceiptTime: clock())
      }
      let next = AcceptedSnapshot(
        snapshot: snapshot,
        recordData: response.data,
        entityTag: response.etag.map(Self.unquoted) ?? snapshot.entityTag,
        issuedAt: snapshot.issuedAt,
        refreshAfter: snapshot.refreshAfter,
        validUntil: snapshot.validUntil,
        staleGraceSeconds: snapshot.staleGraceSeconds,
        trustedTime: trustedTime ?? accepted?.trustedTime,
        authority: authority,
        snapshotAuthorityDigest: authorityDigest,
        minimumSupport: minimumSupport)

      let publicationGeneration = generation
      switch await persist(next, expectedGeneration: publicationGeneration) {
      case .saved: break
      case .failed: return await persistenceFailureResult()
      case .superseded:
        return .unavailable(reason: .signedOut, diagnostics: diagnostics)
      }
      if previousEpoch != authority.epoch {
        await tokenStore.bind(toAuthorityEpoch: authority.epoch)
      }
      guard generation == publicationGeneration else {
        return .unavailable(reason: .signedOut, diagnostics: diagnostics)
      }
      await emitAuthority(authority, minimumSupport: minimumSupport)
      guard generation == publicationGeneration else {
        return .unavailable(reason: .signedOut, diagnostics: diagnostics)
      }
      accepted = next
      cacheStateOverride = nil
      authorityUnavailableReason = nil
      acceptedCount &+= 1
      if authority.transitionState == .cutoverPending || authority.transitionState == .stabilizing {
        urgentAuthorityRefreshPending = true
      }
      await emitCurrent()
      return .updated(snapshotVersion: snapshot.snapshotVersion)
    }
  }

  private func validateExpectedScope(
    _ scope: MosaicCustomerAccessAuthorityScope,
    snapshot: MosaicCustomerEntitlementSnapshot
  ) throws {
    guard expectedApplicationScopeMatches(scope),
      scope.projectID == snapshot.projectID,
      scope.environmentID == snapshot.environmentID
    else {
      throw MosaicCustomerEntitlementDecodingError.invalidSemantics(
        code: "authority_scope_mismatch")
    }
  }

  private func expectedApplicationScopeMatches(_ scope: MosaicCustomerAccessAuthorityScope) -> Bool
  {
    guard let applicationMetadata else { return false }
    return scope.applicationID == applicationMetadata.applicationID && scope.platform == .ios
  }

  /// Conditional v2 verification fields describe one exact retained cache
  /// identity. Emitting only part of this tuple, or emitting it after its
  /// customer/scope wrapper has drifted, could incorrectly authorize an
  /// unchanged response. A missing or stale tuple deliberately requests a full
  /// snapshot instead.
  private func retainedAuthorityVerification() -> RetainedAuthorityVerification? {
    guard let accepted,
      let authority = accepted.authority,
      let digest = accepted.snapshotAuthorityDigest,
      accepted.minimumSupport != nil,
      expectedApplicationScopeMatches(authority.scope),
      authority.scope.projectID == accepted.snapshot.projectID,
      authority.scope.environmentID == accepted.snapshot.environmentID,
      digest.range(of: "^sha256:[a-f0-9]{64}$", options: .regularExpression) != nil
    else { return nil }
    return RetainedAuthorityVerification(
      epoch: authority.epoch,
      snapshotVersion: accepted.snapshot.snapshotVersion,
      snapshotAuthorityDigest: digest)
  }

  private func supportIsCompatible(_ support: MosaicCustomerMinimumAccessSupport) -> Bool {
    guard let applicationMetadata else { return false }
    let supported = Set(MosaicEntitlementApplicationMetadata.capabilities)
    guard Set(support.requiredCapabilities).isSubset(of: supported),
      applicationMetadata.sdkVersion.compare(support.minimumSDKVersion, options: .numeric)
        != .orderedAscending,
      applicationMetadata.appVersion.compare(
        support.supportedAppVersionWindow.minimumInclusive, options: .numeric) != .orderedAscending
    else { return false }
    if let maximum = support.supportedAppVersionWindow.maximumInclusive,
      applicationMetadata.appVersion.compare(maximum, options: .numeric) == .orderedDescending
    {
      return false
    }
    return true
  }

  private func clearAuthorityUnavailable(
    reason: MosaicCustomerAuthorityUnavailableReason,
    minimumSupport: MosaicCustomerMinimumAccessSupport?,
    code: String
  ) async -> MosaicCustomerEntitlementRefreshResult {
    accepted = nil
    cacheStateOverride = reason == .scopeMismatch ? .differentCustomer : .authorityUnknown
    try? await cacheStore.clear()
    record(code: code, stage: .entitlementValidation)
    await authorityBroadcaster.emit(.unavailable(reason: reason, minimumSupport: minimumSupport))
    let unavailableReason: MosaicCustomerUnavailableReason =
      switch reason {
      case .authorityUnknown, .unsupportedContract, .policyUnavailable: .authorityUnknown
      case .unsupportedAppVersion: .unsupportedAppVersion
      case .scopeMismatch: .scopeMismatch
      }
    authorityUnavailableReason = unavailableReason
    await broadcaster.emit(.unavailable(unavailableReason))
    return .unavailable(reason: unavailableReason, diagnostics: diagnostics)
  }

  private func invalidateForUnavailablePolicy(
    scope: MosaicCustomerAccessAuthorityScope
  ) async -> MosaicCustomerEntitlementRefreshResult {
    guard expectedApplicationScopeMatches(scope) else {
      return await clearAuthorityUnavailable(
        reason: .scopeMismatch, minimumSupport: nil,
        code: "entitlement_authority_scope_mismatch")
    }
    let invalidatedAt = clock()
    let invalidation = MosaicCustomerEntitlementCacheInvalidation(
      reason: .policyUnavailable, scope: scope, invalidatedAt: invalidatedAt)
    let tombstoneData = Data("mosaic.policy_unavailable.tombstone.v1".utf8)
    var tombstone = MosaicCustomerEntitlementCacheRecord(
      formatVersion: 3,
      recordData: tombstoneData,
      billingCustomerID: accepted?.snapshot.billingCustomerID ?? "",
      projectID: scope.projectID,
      environmentID: scope.environmentID,
      snapshotVersion: accepted?.snapshot.snapshotVersion ?? 0,
      issuedAt: invalidatedAt,
      asOf: invalidatedAt,
      refreshAfter: invalidatedAt,
      validUntil: invalidatedAt,
      staleGraceSeconds: 0,
      entityTag: "",
      storedAt: invalidatedAt,
      serverTime: nil,
      localReceiptTime: nil,
      systemUptime: nil,
      applicationID: scope.applicationID,
      platform: scope.platform,
      authority: nil,
      snapshotAuthorityDigest: nil,
      minimumSupport: nil,
      invalidation: invalidation,
      checksum: "")
    tombstone.checksum = MosaicCustomerEntitlementCacheRecord.checksum(
      recordData: tombstone.recordData,
      billingCustomerID: tombstone.billingCustomerID,
      projectID: tombstone.projectID,
      environmentID: tombstone.environmentID,
      snapshotVersion: tombstone.snapshotVersion,
      applicationID: tombstone.applicationID,
      platform: tombstone.platform,
      authority: nil,
      snapshotAuthorityDigest: nil,
      invalidation: invalidation)

    let store = cacheStore
    do {
      try await store.save(tombstone)
      pendingPolicyInvalidation = nil
      return await publishUnavailablePolicy(
        code: "entitlement_authority_policy_unavailable")
    } catch {
      pendingPolicyInvalidation = PendingPolicyInvalidation(record: tombstone, store: store)
      // The failed atomic replacement may have left the old active snapshot
      // intact. Best-effort removal makes a cold restart fail closed while the
      // in-process gate continues retrying the tombstone before any sync.
      do {
        try await store.clear()
      } catch {
        record(
          code: "entitlement_policy_invalidation_clear_failed", stage: .entitlementCache)
      }
      return await publishUnavailablePolicy(
        code: "entitlement_policy_invalidation_write_failed")
    }
  }

  private func retryPendingPolicyInvalidation() async -> Bool {
    guard let pendingPolicyInvalidation else { return true }
    do {
      try await pendingPolicyInvalidation.store.save(pendingPolicyInvalidation.record)
      self.pendingPolicyInvalidation = nil
      return true
    } catch {
      do {
        try await pendingPolicyInvalidation.store.clear()
      } catch {
        record(
          code: "entitlement_policy_invalidation_clear_failed", stage: .entitlementCache)
      }
      record(
        code: "entitlement_policy_invalidation_write_failed", stage: .entitlementCache)
      return false
    }
  }

  private func publishUnavailablePolicy(
    code: String
  ) async -> MosaicCustomerEntitlementRefreshResult {
    accepted = nil
    cacheStateOverride = .authorityUnknown
    authorityUnavailableReason = .authorityUnknown
    record(code: code, stage: .entitlementCache)
    await authorityBroadcaster.emit(
      .unavailable(reason: .policyUnavailable, minimumSupport: nil))
    await broadcaster.emit(.unavailable(.authorityUnknown))
    return .unavailable(reason: .authorityUnknown, diagnostics: diagnostics)
  }

  private func emitAuthority(
    _ authority: MosaicCustomerAccessAuthority,
    minimumSupport: MosaicCustomerMinimumAccessSupport
  ) async {
    await authorityBroadcaster.emit(.authority(authority, minimumSupport: minimumSupport))
  }

  private func accept(_ response: MosaicEntitlementSyncHTTPResponse) async
    -> MosaicCustomerEntitlementRefreshResult
  {
    let decoded: MosaicCustomerDecodedRecord
    do {
      decoded = try MosaicCustomerEntitlementCodec.decode(response.data)
    } catch {
      let code =
        (error as? MosaicCustomerEntitlementDecodingError)?.diagnosticCode
        ?? "entitlement_record_rejected"
      rejectedCount &+= 1
      lastRejectionReason = code
      return await preserveOrUnavailable(
        code: code, stage: .entitlementValidation, reason: .serviceUnavailable)
    }

    if case .unchanged(let confirmation) = decoded.record {
      return await confirm(
        snapshotVersion: confirmation.snapshotVersion,
        binding: decoded.binding,
        refreshAfter: confirmation.refreshAfter,
        validUntil: confirmation.validUntil,
        issuedAt: confirmation.issuedAt,
        staleGraceSeconds: confirmation.staleGraceSeconds,
        serverDate: response.serverDate)
    }
    guard case .snapshot(let snapshot) = decoded.record else {
      return await preserveOrUnavailable(
        code: "entitlement_unsupported_record_type", stage: .entitlementValidation,
        reason: .serviceUnavailable)
    }

    let decision = MosaicCustomerEntitlementCacheDecision.evaluate(
      cached: accepted.map { cached in
        MosaicCustomerSnapshotBinding(
          contractVersion: mosaicAuthoritativeEntitlementContractVersion,
          billingCustomerID: cached.snapshot.billingCustomerID,
          projectID: cached.snapshot.projectID,
          environmentID: cached.snapshot.environmentID,
          snapshotVersion: cached.snapshot.snapshotVersion,
          asOf: cached.snapshot.asOf,
          contentDigestValid: true)
      },
      incoming: decoded.binding)

    guard case .accepted = decision else {
      guard case .rejected(let reason) = decision else { preconditionFailure("unreachable") }
      rejectedCount &+= 1
      lastRejectionReason = reason.rawValue
      if reason.isBindingMismatch {
        // The one rejection that clears. Continuing to serve the previous
        // customer's access after an identity change is the leak this rule
        // exists to prevent, so it is also the one that earns an error-severity
        // diagnostic rather than a warning.
        accepted = nil
        cacheStateOverride = .differentCustomer
        try? await cacheStore.clear()
        record(code: reason.diagnosticCode, stage: .entitlementValidation)
        await broadcaster.emit(.cleared(.differentCustomer))
        return .unavailable(reason: .noSnapshot, diagnostics: diagnostics)
      }
      return await preserveOrUnavailable(
        code: reason.diagnosticCode, stage: .entitlementValidation, reason: .serviceUnavailable)
    }

    let entityTag = response.etag.map(Self.unquoted) ?? snapshot.entityTag
    let trustedTime = response.serverDate.map {
      MosaicTrustedTimeAnchor.remote(serverTime: $0, localReceiptTime: clock())
    }
    let next = AcceptedSnapshot(
      snapshot: snapshot,
      recordData: response.data,
      entityTag: entityTag,
      issuedAt: snapshot.issuedAt,
      refreshAfter: snapshot.refreshAfter,
      validUntil: snapshot.validUntil,
      staleGraceSeconds: snapshot.staleGraceSeconds,
      trustedTime: trustedTime ?? accepted?.trustedTime,
      authority: nil,
      snapshotAuthorityDigest: nil,
      minimumSupport: nil)

    let publicationGeneration = generation
    switch await persist(next, expectedGeneration: publicationGeneration) {
    case .saved: break
    case .failed: return await persistenceFailureResult()
    case .superseded:
      return .unavailable(reason: .signedOut, diagnostics: diagnostics)
    }
    // Acceptance is atomic: the cache is replaced whole, never merged. A reader
    // never keeps the entries it understood from a document it rejected.
    accepted = next
    cacheStateOverride = nil
    acceptedCount &+= 1
    await emitCurrent()
    return .updated(snapshotVersion: snapshot.snapshotVersion)
  }

  /// A bare `304`.
  ///
  /// The cache is preserved but its freshness window is **not** slid. Sliding
  /// requires server-issued `refreshAfter`/`validUntil`, and the only
  /// contract-pinned carrier for those is a `snapshotUnchanged` record, which a
  /// `304` has no body to hold. Inventing headers to carry them would put the
  /// offline-access horizon on wire names no contract owns.
  private func confirmUnchanged(_ response: MosaicEntitlementSyncHTTPResponse) async
    -> MosaicCustomerEntitlementRefreshResult
  {
    guard var current = accepted else {
      // Nothing to confirm. A 304 against no cache is a server or proxy defect.
      return await preserveOrUnavailable(
        code: "entitlement_unexpected_not_modified", stage: .entitlementTransport,
        reason: .noSnapshot)
    }
    if let serverDate = response.serverDate {
      current.trustedTime = MosaicTrustedTimeAnchor.remote(
        serverTime: serverDate, localReceiptTime: clock())
      accepted = current
    }
    return .unchanged(snapshotVersion: current.snapshot.snapshotVersion)
  }

  /// A confirmed-current snapshot must not expire merely because it was
  /// confirmed instead of resent, so the freshness window slides. Nothing else
  /// changes: the version does not advance and no emission claims it did.
  private func confirm(
    snapshotVersion: Int64,
    binding: MosaicCustomerSnapshotBinding?,
    refreshAfter: Date?,
    validUntil: Date?,
    issuedAt: Date?,
    staleGraceSeconds: Int?,
    serverDate: Date?
  ) async -> MosaicCustomerEntitlementRefreshResult {
    guard var current = accepted else {
      return await preserveOrUnavailable(
        code: "entitlement_unexpected_not_modified", stage: .entitlementTransport,
        reason: .noSnapshot)
    }
    // A confirmation for another customer is a binding failure like any other.
    if let binding {
      if binding.billingCustomerID != current.snapshot.billingCustomerID
        || binding.projectID != current.snapshot.projectID
        || binding.environmentID != current.snapshot.environmentID
      {
        rejectedCount &+= 1
        lastRejectionReason = MosaicCustomerSnapshotRejectionReason.customerMismatch.rawValue
        accepted = nil
        cacheStateOverride = .differentCustomer
        try? await cacheStore.clear()
        record(
          code: MosaicCustomerSnapshotRejectionReason.customerMismatch.diagnosticCode,
          stage: .entitlementValidation)
        await broadcaster.emit(.cleared(.differentCustomer))
        return .unavailable(reason: .noSnapshot, diagnostics: diagnostics)
      }
      guard binding.snapshotVersion == current.snapshot.snapshotVersion else {
        return await preserveOrUnavailable(
          code: "entitlement_unchanged_version_mismatch", stage: .entitlementValidation,
          reason: .serviceUnavailable)
      }
    }

    if let issuedAt { current.issuedAt = issuedAt }
    if let refreshAfter { current.refreshAfter = refreshAfter }
    if let validUntil { current.validUntil = validUntil }
    if let staleGraceSeconds { current.staleGraceSeconds = staleGraceSeconds }
    if let serverDate {
      current.trustedTime = MosaicTrustedTimeAnchor.remote(
        serverTime: serverDate, localReceiptTime: clock())
    }
    // Guard against a slid window that would exceed the combined horizon.
    let horizon =
      current.validUntil.timeIntervalSince(current.issuedAt)
      + TimeInterval(current.staleGraceSeconds)
    guard horizon <= TimeInterval(MosaicCustomerEntitlementPolicy.maxCacheHorizonSeconds) else {
      return await preserveOrUnavailable(
        code: "entitlement_cache_horizon_exceeds_maximum", stage: .entitlementValidation,
        reason: .serviceUnavailable)
    }

    let publicationGeneration = generation
    switch await persist(current, expectedGeneration: publicationGeneration) {
    case .saved: break
    case .failed: return await persistenceFailureResult()
    case .superseded:
      return .unavailable(reason: .signedOut, diagnostics: diagnostics)
    }
    accepted = current
    cacheStateOverride = nil
    await emitCurrent()
    return .unchanged(snapshotVersion: snapshotVersion)
  }

  // MARK: Persistence and emission

  private func persist(
    _ value: AcceptedSnapshot,
    expectedGeneration: UInt64
  ) async -> PersistenceOutcome {
    let store = cacheStore
    let record = MosaicCustomerEntitlementCacheRecord(
      formatVersion: value.authority == nil ? 1 : 2,
      recordData: value.recordData,
      billingCustomerID: value.snapshot.billingCustomerID,
      projectID: value.snapshot.projectID,
      environmentID: value.snapshot.environmentID,
      snapshotVersion: value.snapshot.snapshotVersion,
      issuedAt: value.issuedAt,
      asOf: value.snapshot.asOf,
      refreshAfter: value.refreshAfter,
      validUntil: value.validUntil,
      staleGraceSeconds: value.staleGraceSeconds,
      entityTag: value.entityTag,
      storedAt: clock(),
      serverTime: value.trustedTime?.serverTime,
      localReceiptTime: value.trustedTime?.localReceiptTime,
      systemUptime: value.trustedTime?.systemUptime,
      applicationID: value.authority?.scope.applicationID,
      platform: value.authority?.scope.platform,
      authority: value.authority,
      snapshotAuthorityDigest: value.snapshotAuthorityDigest,
      minimumSupport: value.minimumSupport,
      checksum: MosaicCustomerEntitlementCacheRecord.checksum(
        recordData: value.recordData,
        billingCustomerID: value.snapshot.billingCustomerID,
        projectID: value.snapshot.projectID,
        environmentID: value.snapshot.environmentID,
        snapshotVersion: value.snapshot.snapshotVersion,
        applicationID: value.authority?.scope.applicationID,
        platform: value.authority?.scope.platform,
        authority: value.authority,
        snapshotAuthorityDigest: value.snapshotAuthorityDigest))
    do {
      try await store.save(record)
    } catch {
      guard generation == expectedGeneration else {
        try? await store.clear()
        return .superseded
      }
      self.record(code: "entitlement_cache_write_failed", stage: .entitlementCache)
      return .failed
    }
    guard generation == expectedGeneration else {
      // The write targeted the cache namespace captured before the suspension.
      // If identity changed while it was blocked, erase that stale publication
      // and never expose it through the new in-memory identity.
      try? await store.clear()
      return .superseded
    }
    return .saved
  }

  private func persistenceFailureResult() async -> MosaicCustomerEntitlementRefreshResult {
    let diagnostic = MosaicDiagnostic(
      code: "entitlement_cache_write_failed", stage: .entitlementCache)
    if let accepted, currentCacheState().servesAccess {
      return .preserved(
        snapshotVersion: accepted.snapshot.snapshotVersion, diagnostic: diagnostic)
    }
    await broadcaster.emit(.unavailable(.serviceUnavailable))
    return .unavailable(reason: .serviceUnavailable, diagnostics: diagnostics)
  }

  private func emitCurrent() async {
    guard let accepted else { return }
    await broadcaster.emit(
      .snapshot(
        .init(
          snapshot: accepted.snapshot, cacheState: currentCacheState(),
          authority: accepted.authority)))
  }

  private func preserveOrUnavailable(
    code: String, stage: MosaicDiagnosticStage, reason: MosaicCustomerUnavailableReason
  ) async -> MosaicCustomerEntitlementRefreshResult {
    let diagnostic = MosaicDiagnostic(code: code, stage: stage)
    record(diagnostic)
    // The cache is preserved on every rejection except a binding mismatch,
    // which is handled at its own call site.
    if let accepted, currentCacheState().servesAccess {
      return .preserved(
        snapshotVersion: accepted.snapshot.snapshotVersion, diagnostic: diagnostic)
    }
    let effective: MosaicCustomerUnavailableReason =
      accepted != nil ? .cacheExpired : reason
    await broadcaster.emit(.unavailable(effective))
    return .unavailable(reason: effective, diagnostics: diagnostics)
  }

  private func unavailable(
    _ reason: MosaicCustomerUnavailableReason, code: String, stage: MosaicDiagnosticStage
  ) async -> MosaicCustomerEntitlementRefreshResult {
    record(code: code, stage: stage)
    if let accepted, currentCacheState().servesAccess {
      return .preserved(
        snapshotVersion: accepted.snapshot.snapshotVersion,
        diagnostic: MosaicDiagnostic(code: code, stage: stage))
    }
    await broadcaster.emit(.unavailable(reason))
    return .unavailable(reason: reason, diagnostics: diagnostics)
  }

  private func record(code: String, stage: MosaicDiagnosticStage) {
    record(MosaicDiagnostic(code: code, stage: stage))
  }

  private func record(_ diagnostic: MosaicDiagnostic) {
    diagnostics.append(diagnostic)
    if diagnostics.count > 32 { diagnostics.removeFirst(diagnostics.count - 32) }
  }

  private static func unquoted(_ value: String) -> String {
    guard value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 else { return value }
    return String(value.dropFirst().dropLast())
  }
}
