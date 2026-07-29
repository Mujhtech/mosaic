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
  private struct AcceptedSnapshot: Sendable {
    var snapshot: MosaicCustomerEntitlementSnapshot
    var recordData: Data
    var entityTag: String
    var issuedAt: Date
    var refreshAfter: Date
    var validUntil: Date
    var staleGraceSeconds: Int
    var trustedTime: MosaicTrustedTimeAnchor?
  }

  private let publicSDKKey: String
  private let endpointURL: URL
  private let requestTimeout: TimeInterval
  private let transport: any MosaicEntitlementSyncTransport
  private let tokenStore: MosaicCustomerTokenStore
  private let broadcaster: MosaicCustomerEntitlementBroadcaster
  private let cacheStoreFactory: @Sendable (String) -> any MosaicCustomerEntitlementCacheStore
  private let clock: @Sendable () -> Date

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

  init(
    publicSDKKey: String,
    baseURL: URL,
    requestTimeout: TimeInterval,
    transport: any MosaicEntitlementSyncTransport,
    tokenStore: MosaicCustomerTokenStore,
    broadcaster: MosaicCustomerEntitlementBroadcaster = MosaicCustomerEntitlementBroadcaster(),
    bindingDigest: String,
    cacheStoreFactory: @escaping @Sendable (String) -> any MosaicCustomerEntitlementCacheStore,
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
    self.bindingDigest = bindingDigest
    self.cacheStoreFactory = cacheStoreFactory
    cacheStore = cacheStoreFactory(bindingDigest)
    self.clock = clock
  }

  // MARK: Observation

  func updates() async -> AsyncStream<MosaicCustomerEntitlementUpdate> {
    await broadcaster.updates()
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
    return .init(snapshot: accepted.snapshot, cacheState: currentCacheState())
  }

  func check(key: String) async -> MosaicCustomerEntitlementCheck {
    let state = currentCacheState()
    guard let accepted else {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: key,
        state: .unavailable(reason: await unavailableReasonWithoutSnapshot()),
        cacheState: state)
    }
    return accepted.snapshot.check(key: key, cacheState: state)
  }

  private func unavailableReasonWithoutSnapshot() async -> MosaicCustomerUnavailableReason {
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
      isRefreshInFlight: inFlight != nil)
  }

  // MARK: Lifecycle

  /// Loads any cached snapshot without touching the network, so a launch has an
  /// answer before the first request completes.
  func bootstrap() async {
    do {
      guard let record = try await cacheStore.load() else { return }
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
          systemUptime: record.systemUptime, now: clock()))
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
  }

  /// Host-requested clear: discards the token and deletes this customer's cache.
  func clearCustomerState() async {
    generation &+= 1
    inFlight?.task.cancel()
    inFlight = nil
    accepted = nil
    cacheStateOverride = nil
    try? await cacheStore.clear()
    await tokenStore.invalidate()
    await broadcaster.emit(.cleared(.hostRequested))
  }

  // MARK: Refresh

  func refreshIfNeeded() async -> MosaicCustomerEntitlementRefreshResult {
    if let accepted, case .fresh = currentCacheState() {
      return .skippedFresh(snapshotVersion: accepted.snapshot.snapshotVersion)
    }
    return await refresh()
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
    return result
  }

  private func performRefresh() async -> MosaicCustomerEntitlementRefreshResult {
    let startGeneration = generation
    switch await tokenStore.token() {
    case .signedOut:
      await broadcaster.emit(.signedOut)
      return .signedOut
    case .unavailable(let reason):
      return await unavailable(reason, code: "entitlement_token_unavailable", stage: .entitlementAuthentication)
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
    if let entityTag = accepted?.entityTag {
      headers[MosaicEntitlementSyncHeader.ifNoneMatch] = "\"\(entityTag)\""
    }

    let body: Data
    do {
      body = try MosaicEntitlementSyncRequestBody.encode(
        knownSnapshotVersion: accepted?.snapshot.snapshotVersion,
        entityTag: accepted?.entityTag,
        correlationID: MosaicEntitlementSyncRequestBody.correlationID())
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
      return await accept(response)
    case 304:
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
      trustedTime: trustedTime ?? accepted?.trustedTime)

    // Acceptance is atomic: the cache is replaced whole, never merged. A reader
    // never keeps the entries it understood from a document it rejected.
    accepted = next
    cacheStateOverride = nil
    acceptedCount &+= 1
    await persist(next)
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

    accepted = current
    cacheStateOverride = nil
    await persist(current)
    await emitCurrent()
    return .unchanged(snapshotVersion: snapshotVersion)
  }

  // MARK: Persistence and emission

  private func persist(_ value: AcceptedSnapshot) async {
    let record = MosaicCustomerEntitlementCacheRecord(
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
      checksum: MosaicCustomerEntitlementCacheRecord.checksum(
        recordData: value.recordData,
        billingCustomerID: value.snapshot.billingCustomerID,
        projectID: value.snapshot.projectID,
        environmentID: value.snapshot.environmentID,
        snapshotVersion: value.snapshot.snapshotVersion))
    do {
      try await cacheStore.save(record)
    } catch {
      // A cache that cannot be written costs offline continuity, not
      // correctness: the accepted snapshot still stands for this process.
      self.record(code: "entitlement_cache_write_failed", stage: .entitlementCache)
    }
  }

  private func emitCurrent() async {
    guard let accepted else { return }
    await broadcaster.emit(
      .snapshot(.init(snapshot: accepted.snapshot, cacheState: currentCacheState())))
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
