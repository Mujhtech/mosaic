import Foundation

// Authoritative Entitlement Contract v1 — the Mosaic-derived answer to "what
// access does this Billing Customer have, and why".
//
// Everything in this file is *authoritative*: it is what Mosaic's server-side
// projection says, not what the on-device store provider observed. The
// provider-observed surface (`MosaicEntitlement`, `activeEntitlements()`,
// entitlement targeting) is unchanged and keeps its own vocabulary.
//
// The one rule that governs every type here: a rejection yields `unknown`,
// never `inactive`. `inactive` is a claim about a person and may only ever come
// from a snapshot Mosaic issued and this SDK fully accepted.

/// Authoritative Entitlement `2` — the one version of this contract (ADR-0028).
public let mosaicAuthoritativeEntitlementContractVersion = "2"

// MARK: - Closed contract vocabularies

public enum MosaicCustomerUncertaintyReason: String, Sendable, Equatable, CaseIterable, Codable {
  case none
  case providerUnavailable = "provider_unavailable"
  case missingFact = "missing_fact"
  case identityUnresolved = "identity_unresolved"
  case productUnresolved = "product_unresolved"
  case conflictingFacts = "conflicting_facts"
  case projectionFailed = "projection_failed"
  case staleValidation = "stale_validation"
  case unsupportedProviderState = "unsupported_provider_state"
}

public enum MosaicCustomerExpectedResolution: String, Sendable, Equatable, CaseIterable, Codable {
  case automaticRetry = "automatic_retry"
  case nextProviderNotification = "next_provider_notification"
  case nextProjectionRun = "next_projection_run"
  case operatorAction = "operator_action"
  case customerAction = "customer_action"
  case noneExpected = "none_expected"
}

/// Why a state is not definitive. `reason == .none` means the state is
/// definitive and carries no `since`.
public struct MosaicCustomerUncertainty: Sendable, Equatable, Codable {
  public let reason: MosaicCustomerUncertaintyReason
  public let since: Date?
  public let expectedResolution: MosaicCustomerExpectedResolution?
  public let diagnosticCode: String?

  public init(
    reason: MosaicCustomerUncertaintyReason,
    since: Date? = nil,
    expectedResolution: MosaicCustomerExpectedResolution? = nil,
    diagnosticCode: String? = nil
  ) {
    self.reason = reason
    self.since = since
    self.expectedResolution = expectedResolution
    self.diagnosticCode = diagnosticCode
  }

  public static let definite = MosaicCustomerUncertainty(reason: .none)
}

public enum MosaicCustomerExplanationCode: String, Sendable, Equatable, CaseIterable, Codable {
  case activeSubscriptionPeriod = "active_subscription_period"
  case activeTrialPeriod = "active_trial_period"
  case activeGracePeriod = "active_grace_period"
  case activeBillingRetryAllowance = "active_billing_retry_allowance"
  case permanentOneTimePurchase = "permanent_one_time_purchase"
  case familySharedSource = "family_shared_source"
  case scheduledPauseNotYetEffective = "scheduled_pause_not_yet_effective"
  case subscriptionCancelledAccessUntilPeriodEnd =
    "subscription_cancelled_access_until_period_end"
  case subscriptionExpired = "subscription_expired"
  case subscriptionPaused = "subscription_paused"
  case subscriptionRevoked = "subscription_revoked"
  case subscriptionRefunded = "subscription_refunded"
  case subscriptionSuperseded = "subscription_superseded"
  case grantVersionEnded = "grant_version_ended"
  case noQualifyingSource = "no_qualifying_source"
  case identityUnresolved = "identity_unresolved"
  case productUnresolved = "product_unresolved"
  case conflictingFacts = "conflicting_facts"
  case projectionFailed = "projection_failed"
  case providerEvidenceStale = "provider_evidence_stale"
  case providerUnavailable = "provider_unavailable"
  case billingDisabled = "billing_disabled"
  case unsupportedProviderState = "unsupported_provider_state"
}

/// The one reason a reader should show first. `safeSummary` is operator-facing
/// convenience text; it is never parsed.
public struct MosaicCustomerExplanation: Sendable, Equatable, Codable {
  public let code: MosaicCustomerExplanationCode
  public let sourceID: String?
  public let safeSummary: String?

  public init(
    code: MosaicCustomerExplanationCode, sourceID: String? = nil, safeSummary: String? = nil
  ) {
    self.code = code
    self.sourceID = sourceID
    self.safeSummary = safeSummary
  }
}

/// Entitlement state admissible inside an immutable snapshot. `unavailable` is
/// deliberately absent: it describes Mosaic's ability to answer, never the
/// customer's access, so it can never be persisted as projected state.
public enum MosaicCustomerPersistedEntitlementState: String, Sendable, Equatable, Codable {
  case active
  case inactive
  case unknown
}

public enum MosaicCustomerStorePlatform: String, Sendable, Equatable, Codable {
  case appleAppStore = "apple_app_store"
  case googlePlay = "google_play"
}

public enum MosaicCustomerSourceType: String, Sendable, Equatable, CaseIterable, Codable {
  case activeSubscription = "active_subscription"
  case trial
  case gracePeriod = "grace_period"
  case billingRetry = "billing_retry"
  case oneTimeNonConsumable = "one_time_non_consumable"
  case familyShared = "family_shared"
}

public enum MosaicCustomerSourceState: String, Sendable, Equatable, Codable {
  case granting
  case notGranting = "not_granting"
  case unknown
}

/// One reason a Billing Customer holds, or may hold, access. Mosaic Product and
/// Subscription Instance identity live here and nowhere else.
public struct MosaicCustomerEntitlementSource: Sendable, Equatable, Codable {
  public let sourceID: String
  public let sourceType: MosaicCustomerSourceType
  public let subscriptionInstanceID: String?
  public let oneTimePurchaseInstanceID: String?
  public let mosaicProductID: String
  public let grantVersionID: String
  public let sourceSnapshotID: String
  public let storePlatform: MosaicCustomerStorePlatform?
  public let start: Date
  /// Absent means this source has no finite end Mosaic can state.
  public let end: Date?
  public let sourceState: MosaicCustomerSourceState
  public let uncertainty: MosaicCustomerUncertainty
  public let explanationCode: MosaicCustomerExplanationCode
  /// True when this source derives from a provider test transaction. On Google
  /// this flag is the only thing separating a license-tester grant from a paid
  /// one, so every surface that reports access reports it.
  public let isTestSource: Bool
}

/// The authoritative state of one Entitlement for one Billing Customer.
public struct MosaicCustomerEntitlementEntry: Sendable, Equatable, Codable {
  public let entitlementID: String
  public let entitlementKey: String
  public let state: MosaicCustomerPersistedEntitlementState
  public let effectiveStart: Date?
  /// Present only when `endKnown` is true. `endKnown == true` with this absent
  /// means the Entitlement is permanent.
  public let effectiveEnd: Date?
  public let endKnown: Bool
  public let refreshRecommendedAt: Date?
  public let sourceIDs: [String]
  public let sourceCount: Int
  public let primaryExplanation: MosaicCustomerExplanation
  public let uncertainty: MosaicCustomerUncertainty?
}

public enum MosaicCustomerProjectionState: String, Sendable, Equatable, Codable {
  case current
  case pending
  case stale
  case degraded
  case failed
}

public struct MosaicCustomerProjectionStatus: Sendable, Equatable, Codable {
  public let state: MosaicCustomerProjectionState
  public let lastProjectedAt: Date
  public let pendingFactCount: Int?
  public let diagnosticCode: String?
}

public enum MosaicCustomerChangeReason: String, Sendable, Equatable, CaseIterable, Codable {
  case initialProjection = "initial_projection"
  case subscriptionStateChanged = "subscription_state_changed"
  case subscriptionPeriodChanged = "subscription_period_changed"
  case renewalIntentChanged = "renewal_intent_changed"
  case sourceAdded = "source_added"
  case sourceEnded = "source_ended"
  case refundApplied = "refund_applied"
  case revocationApplied = "revocation_applied"
  case grantVersionChanged = "grant_version_changed"
  case identityChanged = "identity_changed"
  case identityConflictOpened = "identity_conflict_opened"
  case identityConflictResolved = "identity_conflict_resolved"
  case projectionReplayed = "projection_replayed"
  case projectionRuleUpgraded = "projection_rule_upgraded"
  case projectionRecovered = "projection_recovered"
  case projectionFailed = "projection_failed"
  case manualReprojection = "manual_reprojection"
}

/// A safe diagnostic carried by a contract record. Distinct from
/// ``MosaicDiagnostic``, which is the SDK's own local diagnostic shape.
public struct MosaicCustomerRecordDiagnostic: Sendable, Equatable, Codable {
  public let code: String
  public let safeMessage: String
  public let severity: String
  public let retryable: Bool
  public let retryAfterSeconds: Int?
  public let correlationID: String
  public let recoveryAction: String?
}

/// Immutable authoritative state for one Billing Customer in one Environment at
/// one snapshot version.
///
/// It is a read model, never a bearer credential: possessing it authorizes
/// nothing, and an application backend must never accept one presented by a
/// client as proof of access.
public struct MosaicCustomerEntitlementSnapshot: Sendable, Equatable, Codable {
  public let snapshotID: String
  public let billingCustomerID: String
  public let projectID: String
  public let environmentID: String
  public let snapshotVersion: Int64
  public let previousSnapshotVersion: Int64?
  public let projectionRuleVersion: Int
  public let issuedAt: Date
  public let asOf: Date
  public let refreshAfter: Date
  public let validUntil: Date
  /// Absent on the wire means zero. Zero is the strict policy expressed through
  /// the same fields rather than as a separate mode.
  public let staleGraceSeconds: Int
  public let entityTag: String
  public let contentDigest: String
  public let entries: [MosaicCustomerEntitlementEntry]
  public let sources: [MosaicCustomerEntitlementSource]
  public let projectionStatus: MosaicCustomerProjectionStatus
  public let changeReason: MosaicCustomerChangeReason
  public let correlationID: String
  public let diagnostics: [MosaicCustomerRecordDiagnostic]

  public func entry(forKey key: String) -> MosaicCustomerEntitlementEntry? {
    entries.first { $0.entitlementKey == key }
  }

  public func source(id: String) -> MosaicCustomerEntitlementSource? {
    sources.first { $0.sourceID == id }
  }
}

/// The answer to a conditional sync whose cached snapshot is still current. It
/// carries no entries: it confirms the cached snapshot and slides its freshness
/// window.
public struct MosaicCustomerSnapshotConfirmation: Sendable, Equatable, Codable {
  public let billingCustomerID: String
  public let projectID: String
  public let environmentID: String
  public let snapshotVersion: Int64
  public let entityTag: String
  public let issuedAt: Date
  public let asOf: Date
  public let refreshAfter: Date
  public let validUntil: Date
  public let staleGraceSeconds: Int
  public let projectionStatus: MosaicCustomerProjectionStatus
  public let correlationID: String
  public let diagnostics: [MosaicCustomerRecordDiagnostic]
}

// MARK: - SDK-facing state

/// Why Mosaic could not answer. This is never customer state: it says the
/// authoritative service could not answer, so it is reported instead of
/// `inactive`, never as `inactive`.
public enum MosaicCustomerUnavailableReason: String, Sendable, Equatable, CaseIterable {
  /// The host never supplied a customer token provider.
  case notConfigured
  /// The host's token provider reported a signed-out user.
  case signedOut
  /// The host's token provider failed or is in its failure cooldown.
  case tokenProviderFailed
  /// Mosaic refused the token twice in one generation, or the token is expired
  /// or revoked.
  case notAuthorized
  /// The sync surface could not be reached and no usable cache exists.
  case serviceUnavailable
  /// Billing is disabled for this Environment.
  case billingDisabled
  /// The cached snapshot is past its bounded-grace window, so the cache's age
  /// can no longer support an answer.
  case cacheExpired
  /// No snapshot has ever been accepted for this customer.
  case noSnapshot
  /// The SDK cannot establish the server-directed access-authority epoch.
  case authorityUnknown
  /// The host app is outside the server-directed supported version window.
  case unsupportedAppVersion
  /// The authority response did not match this app/customer scope.
  case scopeMismatch
}

/// The state of one Entitlement as far as the SDK can honestly report it.
public enum MosaicCustomerEntitlementState: Sendable, Equatable {
  case active
  case inactive
  case unknown(reason: MosaicCustomerUncertainty)
  case unavailable(reason: MosaicCustomerUnavailableReason)

  public var isActive: Bool { self == .active }
}

/// The freshness of the locally held snapshot.
///
/// Clock unreliability is deliberately not a member: a cache whose age cannot
/// be measured cannot be trusted to be young, so it takes the `expired` path.
public enum MosaicCustomerEntitlementCacheState: Sendable, Equatable {
  /// Before `refreshAfter`. Serve; do not refresh.
  case fresh
  /// At or after `refreshAfter`, before `validUntil`. Fully valid.
  case refreshRecommended
  /// Past `validUntil` and inside the bounded-grace window. Previously active
  /// Entitlements stay active and **must be surfaced as stale**.
  case staleWithinGrace(until: Date)
  /// Past the grace window. Report `unknown`, never `inactive`.
  case expired
  case missing
  /// The cached bytes could not be read or no longer satisfy the contract.
  case invalid
  /// The cache belongs to another Billing Customer, Project, or Environment.
  case differentCustomer
  /// A legacy v1 cache has no authority epoch and therefore cannot grant access
  /// to an authority-aware client.
  case authorityUnknown

  public var servesAccess: Bool {
    switch self {
    case .fresh, .refreshRecommended, .staleWithinGrace: true
    case .expired, .missing, .invalid, .differentCustomer, .authorityUnknown: false
    }
  }

  public var isStale: Bool {
    if case .staleWithinGrace = self { return true }
    return false
  }
}

/// The answer to one focused access question. Never a bare boolean.
public struct MosaicCustomerEntitlementCheck: Sendable, Equatable {
  public let entitlementKey: String
  public let state: MosaicCustomerEntitlementState
  public let explanation: MosaicCustomerExplanation?
  public let sourceCount: Int
  public let endKnown: Bool
  public let effectiveStart: Date?
  public let effectiveEnd: Date?
  /// True when every contributing source is a provider test transaction.
  public let isTestSource: Bool
  public let snapshotVersion: Int64?
  public let asOf: Date?
  public let cacheState: MosaicCustomerEntitlementCacheState

  public var isStale: Bool { cacheState.isStale }

  init(
    entitlementKey: String,
    state: MosaicCustomerEntitlementState,
    explanation: MosaicCustomerExplanation? = nil,
    sourceCount: Int = 0,
    endKnown: Bool = false,
    effectiveStart: Date? = nil,
    effectiveEnd: Date? = nil,
    isTestSource: Bool = false,
    snapshotVersion: Int64? = nil,
    asOf: Date? = nil,
    cacheState: MosaicCustomerEntitlementCacheState
  ) {
    self.entitlementKey = entitlementKey
    self.state = state
    self.explanation = explanation
    self.sourceCount = sourceCount
    self.endKnown = endKnown
    self.effectiveStart = effectiveStart
    self.effectiveEnd = effectiveEnd
    self.isTestSource = isTestSource
    self.snapshotVersion = snapshotVersion
    self.asOf = asOf
    self.cacheState = cacheState
  }
}

/// The snapshot plus how fresh it is, as handed to observers.
public struct MosaicCustomerEntitlementSnapshotUpdate: Sendable, Equatable {
  public let snapshot: MosaicCustomerEntitlementSnapshot
  public let cacheState: MosaicCustomerEntitlementCacheState
  public let authority: MosaicCustomerAccessAuthority?

  init(
    snapshot: MosaicCustomerEntitlementSnapshot,
    cacheState: MosaicCustomerEntitlementCacheState,
    authority: MosaicCustomerAccessAuthority? = nil
  ) {
    self.snapshot = snapshot
    self.cacheState = cacheState
    self.authority = authority
  }
}

public enum MosaicCustomerEntitlementClearReason: String, Sendable, Equatable {
  case identityChanged
  case differentCustomer
  case hostRequested
}

/// What an observer of ``Mosaic/customerEntitlementUpdates()`` sees.
///
/// Identity transitions are observable as their own members so a consumer never
/// has to infer "the previous user's grants no longer apply" from the absence
/// of an emission.
public enum MosaicCustomerEntitlementUpdate: Sendable, Equatable {
  case loading
  case signedOut
  case cleared(MosaicCustomerEntitlementClearReason)
  case snapshot(MosaicCustomerEntitlementSnapshotUpdate)
  case unavailable(MosaicCustomerUnavailableReason)
}

public struct MosaicCustomerEntitlementDiagnostics: Sendable, Equatable {
  public let isConfigured: Bool
  public let hasCustomerToken: Bool
  public let tokenGeneration: UInt64
  public let cacheState: MosaicCustomerEntitlementCacheState
  public let snapshotVersion: Int64?
  public let billingCustomerID: String?
  public let projectionState: MosaicCustomerProjectionState?
  public let entryCount: Int
  public let acceptedSnapshotCount: UInt64
  public let rejectedSnapshotCount: UInt64
  public let lastRejectionReason: String?
  public let lastSafeCode: String?
  public let isRefreshInFlight: Bool
  public let authority: MosaicCustomerAccessAuthority?
  public let minimumSupport: MosaicCustomerMinimumAccessSupport?
  public let snapshotAuthorityDigest: String?
  public let applicationID: String?
  public let appVersion: String?
  public let supportedCapabilities: [MosaicCustomerAccessCapability]
  public let urgentAuthorityRefreshPending: Bool

  static let notConfigured = MosaicCustomerEntitlementDiagnostics(
    isConfigured: false, hasCustomerToken: false, tokenGeneration: 0, cacheState: .missing,
    snapshotVersion: nil, billingCustomerID: nil, projectionState: nil, entryCount: 0,
    acceptedSnapshotCount: 0, rejectedSnapshotCount: 0, lastRejectionReason: nil,
    lastSafeCode: "entitlement_not_configured", isRefreshInFlight: false,
    authority: nil, minimumSupport: nil, snapshotAuthorityDigest: nil,
    applicationID: nil, appVersion: nil, supportedCapabilities: [],
    urgentAuthorityRefreshPending: false)
}

// MARK: - Cross-platform policy constants

/// The constants five implementations must agree on. They are pinned in
/// `protocol/compatibility/authoritative-entitlement/v2.json` and asserted
/// against the shared reference vectors.
public enum MosaicCustomerEntitlementPolicy: Sendable {
  public static let clockSkewToleranceSeconds: TimeInterval = 60
  public static let defaultStaleGraceSeconds = 86_400
  public static let maxValidUntilSeconds = 2_592_000
  public static let maxStaleGraceSeconds = 2_592_000
  /// `(validUntil - issuedAt) + staleGraceSeconds` may never exceed this.
  /// Bounding each field alone would let a 30-day validity and a 30-day grace
  /// window compose into 60 days of unconfirmed offline access.
  public static let maxCacheHorizonSeconds = 2_592_000
  public static let restorePollAttempts = 3
  public static let restorePollBudgetSeconds: TimeInterval = 6
  public static let maxRecordBytes = 65_536
}

// MARK: - Freshness

/// The bounded-grace freshness evaluation (OD-5).
///
/// Conformance is asserted against
/// `packages/test-fixtures/src/entitlement-freshness-vectors.json`, which every
/// Mosaic implementation shares.
enum MosaicCustomerEntitlementFreshness {
  static func evaluate(
    issuedAt: Date,
    refreshAfter: Date,
    validUntil: Date,
    staleGraceSeconds: Int,
    deviceNow: Date,
    tolerance: TimeInterval = MosaicCustomerEntitlementPolicy.clockSkewToleranceSeconds
  ) -> MosaicCustomerEntitlementCacheState {
    // A device clock earlier than issuance by more than the tolerance makes the
    // cache's age unmeasurable. Computing a negative age and concluding "fresh"
    // would hand unlimited offline access to anyone willing to change their
    // device time.
    if deviceNow < issuedAt.addingTimeInterval(-tolerance) { return .expired }
    // Boundaries are crossed only once `deviceNow` exceeds them by more than the
    // tolerance, so a phone a few seconds fast does not flap between states.
    if deviceNow <= refreshAfter.addingTimeInterval(tolerance) { return .fresh }
    if deviceNow <= validUntil.addingTimeInterval(tolerance) { return .refreshRecommended }
    guard staleGraceSeconds > 0 else { return .expired }
    let graceEnd = validUntil.addingTimeInterval(TimeInterval(staleGraceSeconds))
    if deviceNow <= graceEnd.addingTimeInterval(tolerance) {
      return .staleWithinGrace(until: graceEnd)
    }
    return .expired
  }
}

// MARK: - Cache acceptance

public enum MosaicCustomerCacheAction: String, Sendable, Equatable {
  case replace
  case preserve
  case clear
}

enum MosaicCustomerSnapshotAcceptanceReason: String, Sendable, Equatable {
  case newerSnapshotVersion = "newer_snapshot_version"
  case noCachedSnapshot = "no_cached_snapshot"
}

enum MosaicCustomerSnapshotRejectionReason: String, Sendable, Equatable {
  case unsupportedContractVersion = "unsupported_contract_version"
  case customerMismatch = "customer_mismatch"
  case projectMismatch = "project_mismatch"
  case environmentMismatch = "environment_mismatch"
  case contentDigestMismatch = "content_digest_mismatch"
  case snapshotVersionNotNewer = "snapshot_version_not_newer"
  case asOfRegression = "as_of_regression"

  /// A binding mismatch is the one rejection that clears rather than preserves:
  /// continuing to serve the previous customer's access after an identity
  /// change is precisely the leak the rule exists to prevent.
  var cacheAction: MosaicCustomerCacheAction {
    switch self {
    case .customerMismatch, .projectMismatch, .environmentMismatch: .clear
    default: .preserve
    }
  }

  var isBindingMismatch: Bool { cacheAction == .clear }

  var diagnosticCode: String { "entitlement_snapshot_\(rawValue)" }
}

enum MosaicCustomerSnapshotAcceptance: Sendable, Equatable {
  case accepted(reason: MosaicCustomerSnapshotAcceptanceReason)
  case rejected(reason: MosaicCustomerSnapshotRejectionReason)

  var cacheAction: MosaicCustomerCacheAction {
    switch self {
    case .accepted: .replace
    case .rejected(let reason): reason.cacheAction
    }
  }
}

/// The binding and ordering members the acceptance gate reads. Kept separate
/// from the decoded snapshot so a cached record can be compared without
/// re-decoding it.
struct MosaicCustomerSnapshotBinding: Sendable, Equatable {
  let contractVersion: String
  let billingCustomerID: String
  let projectID: String
  let environmentID: String
  let snapshotVersion: Int64
  let asOf: Date
  let contentDigestValid: Bool
}

/// The normative cache-acceptance order.
///
/// Conformance is asserted against
/// `packages/test-fixtures/src/entitlement-cache-decision-vectors.json`.
enum MosaicCustomerEntitlementCacheDecision {
  static func evaluate(
    cached: MosaicCustomerSnapshotBinding?,
    incoming: MosaicCustomerSnapshotBinding
  ) -> MosaicCustomerSnapshotAcceptance {
    // 1. A document in an unknown version cannot be trusted to have
    //    interpretable binding fields, so version is checked first.
    guard incoming.contractVersion == mosaicAuthoritativeEntitlementContractVersion else {
      return .rejected(reason: .unsupportedContractVersion)
    }
    // 2. Binding runs before version because snapshot versions are monotonic
    //    per customer PER ENVIRONMENT: a staging snapshot legitimately starts
    //    at 1, and diagnosing that as a version regression would preserve a
    //    production cache under a staging identity.
    if let cached {
      if cached.billingCustomerID != incoming.billingCustomerID {
        return .rejected(reason: .customerMismatch)
      }
      if cached.projectID != incoming.projectID {
        return .rejected(reason: .projectMismatch)
      }
      if cached.environmentID != incoming.environmentID {
        return .rejected(reason: .environmentMismatch)
      }
    }
    // 3. Corruption in transit or at rest. Discarded whole, never partially
    //    applied.
    guard incoming.contentDigestValid else {
      return .rejected(reason: .contentDigestMismatch)
    }
    guard let cached else { return .accepted(reason: .noCachedSnapshot) }
    // 4. Equal is not newer. A 304 is the correct way to confirm a current
    //    snapshot; it slides freshness without re-accepting anything.
    guard incoming.snapshotVersion > cached.snapshotVersion else {
      return .rejected(reason: .snapshotVersionNotNewer)
    }
    // 5. A higher version evaluated at an earlier instant means the server
    //    projected from a stale read.
    guard incoming.asOf >= cached.asOf else {
      return .rejected(reason: .asOfRegression)
    }
    return .accepted(reason: .newerSnapshotVersion)
  }
}

// MARK: - Reading a snapshot

extension MosaicCustomerEntitlementSnapshot {
  /// Answers one key from this snapshot under the supplied cache freshness.
  ///
  /// A cache that no longer serves access yields `unknown` or `unavailable` and
  /// never `inactive`: an unheard-from Mosaic is not a cancelled subscription.
  func check(
    key: String, cacheState: MosaicCustomerEntitlementCacheState
  ) -> MosaicCustomerEntitlementCheck {
    guard cacheState.servesAccess else {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: key,
        state: .unavailable(reason: .cacheExpired),
        snapshotVersion: snapshotVersion,
        asOf: asOf,
        cacheState: cacheState)
    }
    guard let entry = entry(forKey: key) else {
      // Absence is not a statement Mosaic made. A snapshot can omit a key
      // because the Project does not define it, because the projection could
      // not resolve it, or because the request narrowed the response with
      // `requestedEntitlementKeys` — and none of those is Mosaic saying the
      // customer does not have it. `inactive` requires an entry that says so.
      return MosaicCustomerEntitlementCheck(
        entitlementKey: key,
        state: .unknown(reason: MosaicCustomerUncertainty(reason: .missingFact, since: asOf)),
        snapshotVersion: snapshotVersion,
        asOf: asOf,
        cacheState: cacheState)
    }
    let contributing = entry.sourceIDs.compactMap { source(id: $0) }
    let state: MosaicCustomerEntitlementState
    switch entry.state {
    case .active: state = .active
    case .inactive: state = .inactive
    case .unknown:
      state = .unknown(reason: entry.uncertainty ?? MosaicCustomerUncertainty(reason: .missingFact))
    }
    return MosaicCustomerEntitlementCheck(
      entitlementKey: key,
      state: state,
      explanation: entry.primaryExplanation,
      sourceCount: entry.sourceCount,
      endKnown: entry.endKnown,
      effectiveStart: entry.effectiveStart,
      effectiveEnd: entry.effectiveEnd,
      isTestSource: !contributing.isEmpty && contributing.allSatisfy(\.isTestSource),
      snapshotVersion: snapshotVersion,
      asOf: asOf,
      cacheState: cacheState)
  }
}
