import 'dart:convert';

import 'sha256.dart';

/// The exact Authoritative Entitlement Contract version this SDK reads.
///
/// Reading is exact-match. A `"2"` document is as unreadable to a `"1"` reader
/// as a `"9.9"` document; numeric ordering never implies support.
const String mosaicAuthoritativeEntitlementContractVersion = '1';

/// Cross-platform clock-skew tolerance, applied in the direction that favours
/// the user. Identical on Flutter, iOS, and Android.
const int mosaicCustomerEntitlementClockSkewToleranceSeconds = 60;

/// `staleGraceSeconds` absent means zero, so a producer that intends bounded
/// grace states it. This constant records the shipped server-side default and
/// is never substituted for an absent member.
const int mosaicCustomerEntitlementDefaultStaleGraceSeconds = 86400;

/// `(validUntil - issuedAt) + staleGraceSeconds` may never exceed 30 days.
const int mosaicCustomerEntitlementMaximumCacheHorizonSeconds = 2592000;

/// Contract record-size bound, enforced by the transport and the cache.
const int mosaicCustomerEntitlementMaximumRecordBytes = 65536;

/// Cross-platform restore poll bound before reporting `validationPending`.
const int mosaicCustomerRestorePollAttempts = 3;
const Duration mosaicCustomerRestorePollBudget = Duration(seconds: 6);

/// Whether access is granted under accepted policy.
///
/// `unavailable` says the authoritative service could not answer. It is never
/// customer state, and a reader must never turn "I could not find out" into
/// [inactive].
enum MosaicCustomerAccessState {
  active('active'),
  inactive('inactive'),
  unknown('unknown'),
  unavailable('unavailable');

  const MosaicCustomerAccessState(this.wireValue);

  final String wireValue;
}

/// Entitlement state admissible inside an immutable snapshot. `unavailable` is
/// deliberately absent: it describes Mosaic's ability to answer.
enum MosaicCustomerEntitlementState {
  active('active'),
  inactive('inactive'),
  unknown('unknown');

  const MosaicCustomerEntitlementState(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerUncertaintyReason {
  none('none'),
  providerUnavailable('provider_unavailable'),
  missingFact('missing_fact'),
  identityUnresolved('identity_unresolved'),
  productUnresolved('product_unresolved'),
  conflictingFacts('conflicting_facts'),
  projectionFailed('projection_failed'),
  staleValidation('stale_validation'),
  unsupportedProviderState('unsupported_provider_state');

  const MosaicCustomerUncertaintyReason(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerExpectedResolution {
  automaticRetry('automatic_retry'),
  nextProviderNotification('next_provider_notification'),
  nextProjectionRun('next_projection_run'),
  operatorAction('operator_action'),
  customerAction('customer_action'),
  noneExpected('none_expected');

  const MosaicCustomerExpectedResolution(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerExplanationCode {
  activeSubscriptionPeriod('active_subscription_period'),
  activeTrialPeriod('active_trial_period'),
  activeGracePeriod('active_grace_period'),
  activeBillingRetryAllowance('active_billing_retry_allowance'),
  permanentOneTimePurchase('permanent_one_time_purchase'),
  familySharedSource('family_shared_source'),
  scheduledPauseNotYetEffective('scheduled_pause_not_yet_effective'),
  subscriptionCancelledAccessUntilPeriodEnd(
      'subscription_cancelled_access_until_period_end'),
  subscriptionExpired('subscription_expired'),
  subscriptionPaused('subscription_paused'),
  subscriptionRevoked('subscription_revoked'),
  subscriptionRefunded('subscription_refunded'),
  subscriptionSuperseded('subscription_superseded'),
  grantVersionEnded('grant_version_ended'),
  noQualifyingSource('no_qualifying_source'),
  identityUnresolved('identity_unresolved'),
  productUnresolved('product_unresolved'),
  conflictingFacts('conflicting_facts'),
  projectionFailed('projection_failed'),
  providerEvidenceStale('provider_evidence_stale'),
  providerUnavailable('provider_unavailable'),
  billingDisabled('billing_disabled'),
  unsupportedProviderState('unsupported_provider_state');

  const MosaicCustomerExplanationCode(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerSourceType {
  activeSubscription('active_subscription'),
  trial('trial'),
  gracePeriod('grace_period'),
  billingRetry('billing_retry'),
  oneTimeNonConsumable('one_time_non_consumable'),
  familyShared('family_shared');

  const MosaicCustomerSourceType(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerSourceState {
  granting('granting'),
  notGranting('not_granting'),
  unknown('unknown');

  const MosaicCustomerSourceState(this.wireValue);

  final String wireValue;
}

/// Store platform vocabulary of the Authoritative Entitlement Contract. It is
/// deliberately separate from `MosaicStorePlatform`, whose wire values belong
/// to Commerce Configuration.
enum MosaicCustomerStorePlatform {
  appleAppStore('apple_app_store'),
  googlePlay('google_play');

  const MosaicCustomerStorePlatform(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerProjectionState {
  current('current'),
  pending('pending'),
  stale('stale'),
  degraded('degraded'),
  failed('failed');

  const MosaicCustomerProjectionState(this.wireValue);

  final String wireValue;
}

enum MosaicCustomerChangeReason {
  initialProjection('initial_projection'),
  subscriptionStateChanged('subscription_state_changed'),
  subscriptionPeriodChanged('subscription_period_changed'),
  renewalIntentChanged('renewal_intent_changed'),
  sourceAdded('source_added'),
  sourceEnded('source_ended'),
  refundApplied('refund_applied'),
  revocationApplied('revocation_applied'),
  grantVersionChanged('grant_version_changed'),
  identityChanged('identity_changed'),
  identityConflictOpened('identity_conflict_opened'),
  identityConflictResolved('identity_conflict_resolved'),
  projectionReplayed('projection_replayed'),
  projectionRuleUpgraded('projection_rule_upgraded'),
  projectionRecovered('projection_recovered'),
  projectionFailed('projection_failed'),
  manualReprojection('manual_reprojection');

  const MosaicCustomerChangeReason(this.wireValue);

  final String wireValue;
}

/// The freshness and acceptance state of the locally cached snapshot.
///
/// Clock unreliability is deliberately not a member: it forces
/// expired-equivalent behaviour rather than becoming an extra state.
enum MosaicEntitlementCacheState {
  fresh,
  refreshRecommended,
  staleWithinGrace,
  expired,
  missing,
  invalid,
  differentCustomer,
}

final class MosaicCustomerUncertainty {
  const MosaicCustomerUncertainty({
    required this.reason,
    this.since,
    this.expectedResolution,
    this.diagnosticCode,
  });

  static const MosaicCustomerUncertainty definite = MosaicCustomerUncertainty(
    reason: MosaicCustomerUncertaintyReason.none,
  );

  final MosaicCustomerUncertaintyReason reason;
  final DateTime? since;
  final MosaicCustomerExpectedResolution? expectedResolution;
  final String? diagnosticCode;

  bool get isDefinite => reason == MosaicCustomerUncertaintyReason.none;
}

final class MosaicCustomerExplanation {
  const MosaicCustomerExplanation({
    required this.code,
    this.sourceId,
    this.safeSummary,
  });

  final MosaicCustomerExplanationCode code;
  final String? sourceId;

  /// Operator-facing convenience. It is never parsed and never carries a
  /// provider identifier, token, or raw provider error text.
  final String? safeSummary;
}

final class MosaicCustomerDiagnostic {
  const MosaicCustomerDiagnostic({
    required this.code,
    required this.safeMessage,
    required this.severity,
    required this.retryable,
    required this.correlationId,
    this.retryAfterSeconds,
    this.recoveryAction,
  });

  final String code;
  final String safeMessage;
  final String severity;
  final bool retryable;
  final String correlationId;
  final int? retryAfterSeconds;
  final String? recoveryAction;
}

final class MosaicCustomerProjectionStatus {
  const MosaicCustomerProjectionStatus({
    required this.state,
    required this.lastProjectedAt,
    this.pendingFactCount,
    this.diagnosticCode,
  });

  final MosaicCustomerProjectionState state;
  final DateTime lastProjectedAt;
  final int? pendingFactCount;
  final String? diagnosticCode;
}

/// One reason a Billing Customer holds, or may hold, access.
///
/// Mosaic Product and Subscription Instance identity live here and nowhere
/// else: duplicating them onto the entry would create two places that can
/// disagree when several sources grant one Entitlement.
final class MosaicCustomerEntitlementSource {
  const MosaicCustomerEntitlementSource({
    required this.sourceId,
    required this.sourceType,
    required this.mosaicProductId,
    required this.grantVersionId,
    required this.sourceSnapshotId,
    required this.start,
    required this.sourceState,
    required this.uncertainty,
    required this.explanationCode,
    required this.isTestSource,
    this.subscriptionInstanceId,
    this.oneTimePurchaseInstanceId,
    this.storePlatform,
    this.end,
  });

  final String sourceId;
  final MosaicCustomerSourceType sourceType;
  final String mosaicProductId;
  final String grantVersionId;
  final String sourceSnapshotId;
  final DateTime start;
  final MosaicCustomerSourceState sourceState;
  final MosaicCustomerUncertainty uncertainty;
  final MosaicCustomerExplanationCode explanationCode;

  /// True when this source derives from a provider test transaction. On Google
  /// Play it is the only thing separating a licence-tester grant from a paid
  /// one, so every surface that reports access reports it.
  final bool isTestSource;
  final String? subscriptionInstanceId;
  final String? oneTimePurchaseInstanceId;
  final MosaicCustomerStorePlatform? storePlatform;

  /// Absent means this source has no finite end Mosaic can state. For a
  /// permanent source that is a fact; for an uncertain source [uncertainty]
  /// explains why.
  final DateTime? end;
}

/// The authoritative state of one Entitlement for one Billing Customer.
final class MosaicCustomerEntitlementEntry {
  const MosaicCustomerEntitlementEntry({
    required this.entitlementId,
    required this.entitlementKey,
    required this.state,
    required this.endKnown,
    required this.sourceIds,
    required this.sourceCount,
    required this.primaryExplanation,
    this.effectiveStart,
    this.effectiveEnd,
    this.refreshRecommendedAt,
    this.uncertainty,
  });

  final String entitlementId;
  final String entitlementKey;
  final MosaicCustomerEntitlementState state;

  /// Whether Mosaic can state the effective end at all. False means an active
  /// source has an uncertain end and a reader must not display or enforce any
  /// expiry.
  final bool endKnown;
  final List<String> sourceIds;
  final int sourceCount;
  final MosaicCustomerExplanation primaryExplanation;
  final DateTime? effectiveStart;

  /// Present only when [endKnown] is true. `endKnown == true` with this member
  /// absent means the Entitlement is permanent.
  final DateTime? effectiveEnd;
  final DateTime? refreshRecommendedAt;
  final MosaicCustomerUncertainty? uncertainty;

  bool get isPermanent => endKnown && effectiveEnd == null;
}

/// Immutable authoritative state for one Billing Customer in one Environment
/// at one snapshot version.
///
/// It is a read model, never a bearer credential: possessing it authorizes
/// nothing, and an application backend must never accept one presented by a
/// client as proof of access.
final class MosaicCustomerEntitlementSnapshot {
  MosaicCustomerEntitlementSnapshot({
    required this.snapshotId,
    required this.billingCustomerId,
    required this.projectId,
    required this.environmentId,
    required this.snapshotVersion,
    required this.projectionRuleVersion,
    required this.issuedAt,
    required this.asOf,
    required this.refreshAfter,
    required this.validUntil,
    required this.entityTag,
    required this.contentDigest,
    required this.changeReason,
    required this.correlationId,
    required this.projectionStatus,
    required Iterable<MosaicCustomerEntitlementEntry> entries,
    required Iterable<MosaicCustomerEntitlementSource> sources,
    this.previousSnapshotVersion,
    this.staleGraceSeconds = 0,
    Iterable<MosaicCustomerDiagnostic> diagnostics =
        const <MosaicCustomerDiagnostic>[],
  })  : entries = List.unmodifiable(entries),
        sources = List.unmodifiable(sources),
        diagnostics = List.unmodifiable(diagnostics);

  final String snapshotId;
  final String billingCustomerId;
  final String projectId;
  final String environmentId;
  final int snapshotVersion;
  final int? previousSnapshotVersion;
  final int projectionRuleVersion;
  final DateTime issuedAt;
  final DateTime asOf;
  final DateTime refreshAfter;
  final DateTime validUntil;

  /// Absent on the wire means zero, which is the strict policy expressed
  /// through the same fields rather than as a separate mode.
  final int staleGraceSeconds;
  final String entityTag;
  final String contentDigest;
  final List<MosaicCustomerEntitlementEntry> entries;
  final List<MosaicCustomerEntitlementSource> sources;
  final MosaicCustomerProjectionStatus projectionStatus;
  final MosaicCustomerChangeReason changeReason;
  final String correlationId;
  final List<MosaicCustomerDiagnostic> diagnostics;

  MosaicCustomerEntitlementEntry? entryFor(String entitlementKey) {
    for (final entry in entries) {
      if (entry.entitlementKey == entitlementKey) return entry;
    }
    return null;
  }

  MosaicCustomerEntitlementSource? sourceFor(String sourceId) {
    for (final source in sources) {
      if (source.sourceId == sourceId) return source;
    }
    return null;
  }
}

/// The conditional-request answer confirming a cached snapshot is current. It
/// carries no entries but does slide the freshness window, so a snapshot
/// confirmed instead of resent never expires for having been confirmed.
final class MosaicCustomerSnapshotUnchanged {
  const MosaicCustomerSnapshotUnchanged({
    required this.billingCustomerId,
    required this.projectId,
    required this.environmentId,
    required this.snapshotVersion,
    required this.entityTag,
    required this.issuedAt,
    required this.asOf,
    required this.refreshAfter,
    required this.validUntil,
    required this.projectionStatus,
    required this.correlationId,
    this.staleGraceSeconds = 0,
  });

  final String billingCustomerId;
  final String projectId;
  final String environmentId;
  final int snapshotVersion;
  final String entityTag;
  final DateTime issuedAt;
  final DateTime asOf;
  final DateTime refreshAfter;
  final DateTime validUntil;
  final int staleGraceSeconds;
  final MosaicCustomerProjectionStatus projectionStatus;
  final String correlationId;
}

/// The customer, Project, and Environment a cached snapshot is bound to.
final class MosaicCustomerBinding {
  const MosaicCustomerBinding({
    required this.billingCustomerId,
    required this.projectId,
    required this.environmentId,
  });

  final String billingCustomerId;
  final String projectId;
  final String environmentId;

  @override
  bool operator ==(Object other) =>
      other is MosaicCustomerBinding &&
      other.billingCustomerId == billingCustomerId &&
      other.projectId == projectId &&
      other.environmentId == environmentId;

  @override
  int get hashCode => Object.hash(billingCustomerId, projectId, environmentId);
}

/// What a reader does with the previously accepted cache after evaluating an
/// incoming snapshot.
enum MosaicCustomerCacheAction { replace, preserve, clear }

/// The outcome of the normative cache-acceptance order.
final class MosaicCustomerCacheDecision {
  const MosaicCustomerCacheDecision({
    required this.accepted,
    required this.reasonCode,
    required this.cacheAction,
  });

  final bool accepted;

  /// Wire vocabulary shared with the cross-implementation reference vectors.
  final String reasonCode;
  final MosaicCustomerCacheAction cacheAction;
}

/// The identity and version of a cached snapshot, without its entries. This is
/// the whole input the acceptance order needs.
final class MosaicCustomerCachedSnapshotSummary {
  const MosaicCustomerCachedSnapshotSummary({
    required this.binding,
    required this.snapshotVersion,
    required this.asOf,
  });

  final MosaicCustomerBinding binding;
  final int snapshotVersion;
  final DateTime asOf;
}

/// Applies the normative cache-acceptance order.
///
/// The order matters. Binding is checked before version because snapshot
/// versions are monotonic *per Environment*, so a staging snapshot legitimately
/// starts at 1; diagnosing that as a version regression would preserve a
/// production cache under a staging identity.
///
/// [contractVersion] and [contentDigestValid] are supplied by the caller
/// because they are decided while decoding, not from the decoded model.
MosaicCustomerCacheDecision mosaicEvaluateCustomerCacheDecision({
  required String contractVersion,
  required MosaicCustomerBinding incomingBinding,
  required int incomingSnapshotVersion,
  required DateTime incomingAsOf,
  required bool contentDigestValid,
  required MosaicCustomerCachedSnapshotSummary? cached,
}) {
  if (contractVersion != mosaicAuthoritativeEntitlementContractVersion) {
    return const MosaicCustomerCacheDecision(
      accepted: false,
      reasonCode: 'unsupported_contract_version',
      cacheAction: MosaicCustomerCacheAction.preserve,
    );
  }
  if (cached != null) {
    final binding = cached.binding;
    // Each binding member is reported separately: an operator reading a
    // diagnostic needs to know whether the app changed customer, Project, or
    // Environment, and all three clear the cache.
    if (binding.billingCustomerId != incomingBinding.billingCustomerId) {
      return const MosaicCustomerCacheDecision(
        accepted: false,
        reasonCode: 'customer_mismatch',
        cacheAction: MosaicCustomerCacheAction.clear,
      );
    }
    if (binding.projectId != incomingBinding.projectId) {
      return const MosaicCustomerCacheDecision(
        accepted: false,
        reasonCode: 'project_mismatch',
        cacheAction: MosaicCustomerCacheAction.clear,
      );
    }
    if (binding.environmentId != incomingBinding.environmentId) {
      return const MosaicCustomerCacheDecision(
        accepted: false,
        reasonCode: 'environment_mismatch',
        cacheAction: MosaicCustomerCacheAction.clear,
      );
    }
  }
  if (!contentDigestValid) {
    return const MosaicCustomerCacheDecision(
      accepted: false,
      reasonCode: 'content_digest_mismatch',
      cacheAction: MosaicCustomerCacheAction.preserve,
    );
  }
  if (cached == null) {
    return const MosaicCustomerCacheDecision(
      accepted: true,
      reasonCode: 'no_cached_snapshot',
      cacheAction: MosaicCustomerCacheAction.replace,
    );
  }
  // Equal is not newer. Confirming a current snapshot is what the unchanged
  // response is for, so "accepted" always means the state advanced.
  if (incomingSnapshotVersion <= cached.snapshotVersion) {
    return const MosaicCustomerCacheDecision(
      accepted: false,
      reasonCode: 'snapshot_version_not_newer',
      cacheAction: MosaicCustomerCacheAction.preserve,
    );
  }
  if (incomingAsOf.isBefore(cached.asOf)) {
    return const MosaicCustomerCacheDecision(
      accepted: false,
      reasonCode: 'as_of_regression',
      cacheAction: MosaicCustomerCacheAction.preserve,
    );
  }
  return const MosaicCustomerCacheDecision(
    accepted: true,
    reasonCode: 'newer_snapshot_version',
    cacheAction: MosaicCustomerCacheAction.replace,
  );
}

/// Derives the bounded-grace freshness band of a snapshot against the device
/// clock.
///
/// A device clock earlier than `issuedAt` by more than the tolerance is
/// unreliable, and an unreliable clock forces expired-equivalent behaviour: a
/// naive implementation computes a negative cache age, concludes "fresh", and
/// hands unlimited offline access to anyone willing to move their clock back.
MosaicEntitlementCacheState mosaicEvaluateCustomerFreshness({
  required DateTime issuedAt,
  required DateTime refreshAfter,
  required DateTime validUntil,
  required int staleGraceSeconds,
  required DateTime deviceNow,
  int clockSkewToleranceSeconds =
      mosaicCustomerEntitlementClockSkewToleranceSeconds,
}) {
  final tolerance = Duration(seconds: clockSkewToleranceSeconds);
  final now = deviceNow.toUtc();
  if (now.isBefore(issuedAt.toUtc().subtract(tolerance))) {
    return MosaicEntitlementCacheState.expired;
  }
  if (!now.isAfter(refreshAfter.toUtc().add(tolerance))) {
    return MosaicEntitlementCacheState.fresh;
  }
  final graceEnd =
      validUntil.toUtc().add(Duration(seconds: staleGraceSeconds)).add(
            tolerance,
          );
  if (now.isAfter(graceEnd)) {
    return MosaicEntitlementCacheState.expired;
  }
  if (now.isAfter(validUntil.toUtc().add(tolerance))) {
    return MosaicEntitlementCacheState.staleWithinGrace;
  }
  return MosaicEntitlementCacheState.refreshRecommended;
}

/// The answer to a synchronous access question. There is no boolean anywhere:
/// a caller that cannot see the difference between `inactive` and `unknown`
/// will eventually revoke a paying customer during an outage.
final class MosaicCustomerEntitlementCheck {
  const MosaicCustomerEntitlementCheck({
    required this.entitlementKey,
    required this.state,
    required this.cacheState,
    required this.sourceCount,
    required this.endKnown,
    required this.isStale,
    required this.isTestSource,
    this.reasonCode,
    this.primaryExplanation,
    this.uncertainty,
    this.effectiveStart,
    this.effectiveEnd,
    this.snapshotVersion,
    this.asOf,
  }) : assert(
          state == MosaicCustomerAccessState.active || reasonCode != null,
          'Every non-active answer states why.',
        );

  final String entitlementKey;
  final MosaicCustomerAccessState state;
  final MosaicEntitlementCacheState cacheState;
  final int sourceCount;
  final bool endKnown;

  /// True while access is served from the bounded-grace band. A host must
  /// surface it: the contract requires stale access to be visibly stale.
  final bool isStale;
  final bool isTestSource;

  /// Present whenever [state] is not [MosaicCustomerAccessState.active].
  final String? reasonCode;
  final MosaicCustomerExplanation? primaryExplanation;
  final MosaicCustomerUncertainty? uncertainty;
  final DateTime? effectiveStart;
  final DateTime? effectiveEnd;
  final int? snapshotVersion;
  final DateTime? asOf;

  bool get isPermanent => endKnown && effectiveEnd == null;
}

/// Observable transitions of the authoritative entitlement state.
///
/// `Cleared` exists so an identity transition is observable without ever
/// emitting the previous customer's grants.
sealed class MosaicCustomerEntitlementUpdate {
  const MosaicCustomerEntitlementUpdate();
}

final class MosaicCustomerEntitlementSnapshotAccepted
    extends MosaicCustomerEntitlementUpdate {
  const MosaicCustomerEntitlementSnapshotAccepted(this.snapshot);

  final MosaicCustomerEntitlementSnapshot snapshot;
}

final class MosaicCustomerEntitlementCleared
    extends MosaicCustomerEntitlementUpdate {
  const MosaicCustomerEntitlementCleared({required this.reasonCode});

  final String reasonCode;
}

/// The outcome of one authoritative refresh.
sealed class MosaicCustomerEntitlementRefreshResult {
  const MosaicCustomerEntitlementRefreshResult();
}

final class MosaicCustomerEntitlementUpdated
    extends MosaicCustomerEntitlementRefreshResult {
  const MosaicCustomerEntitlementUpdated(this.snapshot);

  final MosaicCustomerEntitlementSnapshot snapshot;
}

/// The server confirmed the cached snapshot. The cache is preserved and its
/// freshness window slides.
final class MosaicCustomerEntitlementUnchanged
    extends MosaicCustomerEntitlementRefreshResult {
  const MosaicCustomerEntitlementUnchanged({required this.snapshotVersion});

  final int snapshotVersion;
}

/// The response was read but not accepted. The cache is preserved unless
/// [cacheAction] says otherwise, and access reads report `unknown`.
final class MosaicCustomerEntitlementRejected
    extends MosaicCustomerEntitlementRefreshResult {
  const MosaicCustomerEntitlementRejected({
    required this.reasonCode,
    required this.cacheAction,
  });

  final String reasonCode;
  final MosaicCustomerCacheAction cacheAction;
}

/// Mosaic could not answer. This is never a claim about the customer.
final class MosaicCustomerEntitlementUnavailable
    extends MosaicCustomerEntitlementRefreshResult {
  const MosaicCustomerEntitlementUnavailable({required this.reasonCode});

  final String reasonCode;
}

/// A record the reader rejected, carrying the safe reason code a diagnostic
/// reports. Rejection always yields `unknown` and never `inactive`.
final class MosaicCustomerEntitlementFormatException implements Exception {
  const MosaicCustomerEntitlementFormatException(this.reasonCode);

  final String reasonCode;

  @override
  String toString() => 'MosaicCustomerEntitlementFormatException: $reasonCode';
}

/// Canonical serialization of a decoded JSON tree.
///
/// Five implementations must produce byte-identical input, so the rules are
/// mechanical: minified, object members ascending by UTF-16 code unit at every
/// depth, array order preserved exactly, absent members omitted, `null` never
/// emitted, integers in shortest decimal form.
String mosaicCustomerCanonicalJson(Object? value) {
  final buffer = StringBuffer();
  _writeCanonical(value, buffer);
  return buffer.toString();
}

void _writeCanonical(Object? value, StringBuffer buffer) {
  if (value == null) {
    // Absent and null are different bytes and therefore different digests, and
    // null is invalid everywhere in this contract.
    throw const MosaicCustomerEntitlementFormatException('null_member');
  }
  if (value is Map) {
    final keys = value.keys.whereType<String>().toList()..sort();
    if (keys.length != value.length) {
      throw const MosaicCustomerEntitlementFormatException('malformed_record');
    }
    buffer.write('{');
    for (var index = 0; index < keys.length; index += 1) {
      if (index > 0) buffer.write(',');
      buffer
        ..write(jsonEncode(keys[index]))
        ..write(':');
      _writeCanonical(value[keys[index]], buffer);
    }
    buffer.write('}');
    return;
  }
  if (value is List) {
    // Array order is normative. A serializer that sorted an array would
    // silently repair a document the semantic rules exist to reject.
    buffer.write('[');
    for (var index = 0; index < value.length; index += 1) {
      if (index > 0) buffer.write(',');
      _writeCanonical(value[index], buffer);
    }
    buffer.write(']');
    return;
  }
  if (value is double && value == value.roundToDouble() && value.isFinite) {
    buffer.write(value.toInt().toString());
    return;
  }
  buffer.write(jsonEncode(value));
}

/// SHA-256 over the canonical serialization of [payload] with [excludedMember]
/// removed.
///
/// This is corruption and binding detection, not authentication. It covers the
/// customer, Project, Environment, and version, so a snapshot cannot be
/// accepted into another customer's cache — but anyone can compute it.
String mosaicCustomerContentDigest(
  Map<String, Object?> payload, {
  String excludedMember = 'contentDigest',
}) {
  final copy = Map<String, Object?>.of(payload)..remove(excludedMember);
  return 'sha256:'
      '${mosaicSha256Hex(utf8.encode(mosaicCustomerCanonicalJson(copy)))}';
}

// ---------------------------------------------------------------------------
// Strict closed reading
// ---------------------------------------------------------------------------

/// A record read from the SDK entitlement sync surface.
///
/// The surface carries exactly two record types. A Subscription Snapshot, a
/// check result, or a restore result arriving here is a different contract
/// surface and is rejected rather than partially understood.
sealed class MosaicCustomerSyncRecord {
  const MosaicCustomerSyncRecord();
}

final class MosaicCustomerSnapshotRecord extends MosaicCustomerSyncRecord {
  const MosaicCustomerSnapshotRecord({
    required this.snapshot,
    required this.contentDigestValid,
  });

  final MosaicCustomerEntitlementSnapshot snapshot;

  /// Reported rather than thrown, because a digest mismatch is a distinct
  /// cache decision (reject, preserve) in the normative acceptance order.
  final bool contentDigestValid;
}

final class MosaicCustomerUnchangedRecord extends MosaicCustomerSyncRecord {
  const MosaicCustomerUnchangedRecord(this.unchanged);

  final MosaicCustomerSnapshotUnchanged unchanged;
}

/// Reads Authoritative Entitlement Contract v1 records from the SDK sync
/// surface.
///
/// Reading is closed and whole-document: any unknown version, record type,
/// field, or enumeration member rejects the entire record. The single
/// exception is an unrecognized `entitlementKey`, which is Project data and is
/// carried, because making *defining a new Entitlement* a breaking change for
/// every shipped SDK is the opposite of what fail-closed reading is for.
final class MosaicCustomerEntitlementDecoder {
  const MosaicCustomerEntitlementDecoder();

  MosaicCustomerSyncRecord decode(String source) {
    if (utf8.encode(source).length >
        mosaicCustomerEntitlementMaximumRecordBytes) {
      throw const MosaicCustomerEntitlementFormatException('record_too_large');
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException {
      throw const MosaicCustomerEntitlementFormatException('malformed_record');
    }
    if (decoded is! Map) {
      throw const MosaicCustomerEntitlementFormatException('malformed_record');
    }
    return decodeObject(decoded.cast<String, Object?>());
  }

  MosaicCustomerSyncRecord decodeObject(Map<String, Object?> envelope) {
    final fields = _Fields(envelope, const <String>{
      'authoritativeEntitlementContractVersion',
      'recordType',
      'payload',
    });
    if (fields.raw['authoritativeEntitlementContractVersion'] !=
        mosaicAuthoritativeEntitlementContractVersion) {
      throw const MosaicCustomerEntitlementFormatException(
        'unsupported_contract_version',
      );
    }
    final payload = fields.object('payload');
    return switch (fields.raw['recordType']) {
      'customerEntitlementSnapshot' => _snapshotRecord(payload),
      'snapshotUnchanged' => MosaicCustomerUnchangedRecord(_unchanged(payload)),
      // Every other member of the closed record-type set belongs to a surface
      // this reader does not serve; anything else is not a record type at all.
      'entitlementSyncRequest' ||
      'entitlementCheckRequest' ||
      'entitlementCheckResult' ||
      'subscriptionSnapshot' ||
      'restoreResult' =>
        throw const MosaicCustomerEntitlementFormatException(
          'unsupported_record_type',
        ),
      _ => throw const MosaicCustomerEntitlementFormatException(
          'unknown_record_type',
        ),
    };
  }

  MosaicCustomerSnapshotRecord _snapshotRecord(Map<String, Object?> payload) {
    final fields = _Fields(payload, const <String>{
      'snapshotId',
      'billingCustomerId',
      'projectId',
      'environmentId',
      'snapshotVersion',
      'previousSnapshotVersion',
      'projectionRuleVersion',
      'issuedAt',
      'asOf',
      'refreshAfter',
      'validUntil',
      'staleGraceSeconds',
      'entityTag',
      'contentDigest',
      'entries',
      'sources',
      'projectionStatus',
      'changeReason',
      'correlationId',
      'diagnostics',
    });
    final snapshotVersion = fields.integer('snapshotVersion', minimum: 0);
    final previousSnapshotVersion =
        fields.optionalInteger('previousSnapshotVersion', minimum: 0);
    if (previousSnapshotVersion != null &&
        snapshotVersion <= previousSnapshotVersion) {
      // A version that regresses against its own stated predecessor is
      // self-inconsistent, independent of anything the reader has cached.
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }
    final issuedAt = fields.timestamp('issuedAt');
    final refreshAfter = fields.timestamp('refreshAfter');
    final validUntil = fields.timestamp('validUntil');
    final staleGraceSeconds = fields.optionalInteger(
          'staleGraceSeconds',
          minimum: 0,
          maximum: mosaicCustomerEntitlementMaximumCacheHorizonSeconds,
        ) ??
        0;
    _validateHorizon(
      issuedAt: issuedAt,
      refreshAfter: refreshAfter,
      validUntil: validUntil,
      staleGraceSeconds: staleGraceSeconds,
    );

    final entries = fields
        .list('entries', maximum: 200)
        .map(_entry)
        .toList(growable: false);
    final sources = fields
        .list('sources', maximum: 200)
        .map(_source)
        .toList(growable: false);
    _validateGraph(entries, sources);

    final projectionStatus =
        _projectionStatus(fields.object('projectionStatus'));
    final changeReason = fields.enumeration(
      'changeReason',
      MosaicCustomerChangeReason.values,
      (value) => value.wireValue,
    );
    if (snapshotVersion == 0 &&
        (previousSnapshotVersion != null ||
            entries.isNotEmpty ||
            sources.isNotEmpty ||
            projectionStatus.state != MosaicCustomerProjectionState.pending ||
            changeReason != MosaicCustomerChangeReason.initialProjection)) {
      // Zero is the never-projected placeholder, not a snapshot of empty or
      // projected state. Its strict content rules keep it fail-closed while
      // allowing the ordinary monotonic gate to replace it with version 1.
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }

    final snapshot = MosaicCustomerEntitlementSnapshot(
      snapshotId: fields.identifier('snapshotId'),
      billingCustomerId: fields.identifier('billingCustomerId'),
      projectId: fields.identifier('projectId'),
      environmentId: fields.identifier('environmentId'),
      snapshotVersion: snapshotVersion,
      previousSnapshotVersion: previousSnapshotVersion,
      projectionRuleVersion:
          fields.integer('projectionRuleVersion', minimum: 1),
      issuedAt: issuedAt,
      asOf: fields.timestamp('asOf'),
      refreshAfter: refreshAfter,
      validUntil: validUntil,
      staleGraceSeconds: staleGraceSeconds,
      entityTag: fields.entityTag('entityTag'),
      contentDigest: fields.digest('contentDigest'),
      entries: entries,
      sources: sources,
      projectionStatus: projectionStatus,
      changeReason: changeReason,
      correlationId: fields.identifier('correlationId'),
      diagnostics: fields
          .optionalList('diagnostics', maximum: 10)
          .map(_diagnostic)
          .toList(growable: false),
    );
    return MosaicCustomerSnapshotRecord(
      snapshot: snapshot,
      contentDigestValid:
          mosaicCustomerContentDigest(payload) == snapshot.contentDigest,
    );
  }

  MosaicCustomerSnapshotUnchanged _unchanged(Map<String, Object?> payload) {
    final fields = _Fields(payload, const <String>{
      'billingCustomerId',
      'projectId',
      'environmentId',
      'snapshotVersion',
      'entityTag',
      'issuedAt',
      'asOf',
      'refreshAfter',
      'validUntil',
      'staleGraceSeconds',
      'projectionStatus',
      'correlationId',
      'diagnostics',
    });
    final issuedAt = fields.timestamp('issuedAt');
    final refreshAfter = fields.timestamp('refreshAfter');
    final validUntil = fields.timestamp('validUntil');
    final staleGraceSeconds = fields.optionalInteger(
          'staleGraceSeconds',
          minimum: 0,
          maximum: mosaicCustomerEntitlementMaximumCacheHorizonSeconds,
        ) ??
        0;
    // The horizon bound is enforced here too. Otherwise it could be evaded by
    // confirming a snapshot rather than reissuing one.
    _validateHorizon(
      issuedAt: issuedAt,
      refreshAfter: refreshAfter,
      validUntil: validUntil,
      staleGraceSeconds: staleGraceSeconds,
    );
    fields.optionalList('diagnostics', maximum: 10).forEach(_diagnostic);
    return MosaicCustomerSnapshotUnchanged(
      billingCustomerId: fields.identifier('billingCustomerId'),
      projectId: fields.identifier('projectId'),
      environmentId: fields.identifier('environmentId'),
      snapshotVersion: fields.integer('snapshotVersion', minimum: 1),
      entityTag: fields.entityTag('entityTag'),
      issuedAt: issuedAt,
      asOf: fields.timestamp('asOf'),
      refreshAfter: refreshAfter,
      validUntil: validUntil,
      staleGraceSeconds: staleGraceSeconds,
      projectionStatus: _projectionStatus(fields.object('projectionStatus')),
      correlationId: fields.identifier('correlationId'),
    );
  }

  void _validateHorizon({
    required DateTime issuedAt,
    required DateTime refreshAfter,
    required DateTime validUntil,
    required int staleGraceSeconds,
  }) {
    if (refreshAfter.isAfter(validUntil)) {
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }
    final horizon =
        validUntil.difference(issuedAt).inSeconds + staleGraceSeconds;
    if (horizon > mosaicCustomerEntitlementMaximumCacheHorizonSeconds) {
      // Bounding each field alone would let a 30-day validity and a 30-day
      // grace window compose into 60 days of unconfirmed offline access.
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }
  }

  MosaicCustomerEntitlementEntry _entry(Map<String, Object?> value) {
    final fields = _Fields(value, const <String>{
      'entitlementId',
      'entitlementKey',
      'state',
      'effectiveStart',
      'effectiveEnd',
      'endKnown',
      'refreshRecommendedAt',
      'sourceIds',
      'sourceCount',
      'primaryExplanation',
      'uncertainty',
    });
    final state = fields.enumeration(
      'state',
      MosaicCustomerEntitlementState.values,
      (item) => item.wireValue,
    );
    final endKnown = fields.boolean('endKnown');
    final effectiveStart = fields.optionalTimestamp('effectiveStart');
    final effectiveEnd = fields.optionalTimestamp('effectiveEnd');
    final uncertainty = fields.raw.containsKey('uncertainty')
        ? _uncertainty(fields.object('uncertainty'))
        : null;
    if (!endKnown && effectiveEnd != null) {
      // endKnown false means the end is genuinely uncertain, so a reader must
      // display no expiry at all rather than an unreliable one.
      throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );
    }
    if (state == MosaicCustomerEntitlementState.active &&
            effectiveStart == null ||
        state == MosaicCustomerEntitlementState.unknown &&
            (uncertainty == null || uncertainty.isDefinite)) {
      throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );
    }
    final sourceIds = fields.identifierList('sourceIds', maximum: 64);
    final sourceCount = fields.integer('sourceCount', minimum: 0, maximum: 64);
    if (sourceCount != sourceIds.length) {
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }
    return MosaicCustomerEntitlementEntry(
      entitlementId: fields.identifier('entitlementId'),
      // Project data: an unrecognized key is carried, never rejected.
      entitlementKey: fields.entitlementKey('entitlementKey'),
      state: state,
      endKnown: endKnown,
      sourceIds: sourceIds,
      sourceCount: sourceCount,
      primaryExplanation: _explanation(fields.object('primaryExplanation')),
      effectiveStart: effectiveStart,
      effectiveEnd: effectiveEnd,
      refreshRecommendedAt: fields.optionalTimestamp('refreshRecommendedAt'),
      uncertainty: uncertainty,
    );
  }

  MosaicCustomerEntitlementSource _source(Map<String, Object?> value) {
    final fields = _Fields(value, const <String>{
      'sourceId',
      'sourceType',
      'subscriptionInstanceId',
      'oneTimePurchaseInstanceId',
      'mosaicProductId',
      'grantVersionId',
      'sourceSnapshotId',
      'storePlatform',
      'start',
      'end',
      'sourceState',
      'uncertainty',
      'explanationCode',
      'isTestSource',
    });
    final sourceType = fields.enumeration(
      'sourceType',
      MosaicCustomerSourceType.values,
      (item) => item.wireValue,
    );
    final subscriptionInstanceId =
        fields.optionalIdentifier('subscriptionInstanceId');
    final oneTimePurchaseInstanceId =
        fields.optionalIdentifier('oneTimePurchaseInstanceId');
    final expectsOneTime =
        sourceType == MosaicCustomerSourceType.oneTimeNonConsumable;
    if (expectsOneTime &&
            (oneTimePurchaseInstanceId == null ||
                subscriptionInstanceId != null) ||
        !expectsOneTime &&
            (subscriptionInstanceId == null ||
                oneTimePurchaseInstanceId != null)) {
      throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );
    }
    final sourceState = fields.enumeration(
      'sourceState',
      MosaicCustomerSourceState.values,
      (item) => item.wireValue,
    );
    final uncertainty = _uncertainty(fields.object('uncertainty'));
    if (sourceState == MosaicCustomerSourceState.unknown &&
        uncertainty.isDefinite) {
      throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );
    }
    return MosaicCustomerEntitlementSource(
      sourceId: fields.identifier('sourceId'),
      sourceType: sourceType,
      mosaicProductId: fields.identifier('mosaicProductId'),
      grantVersionId: fields.identifier('grantVersionId'),
      sourceSnapshotId: fields.identifier('sourceSnapshotId'),
      start: fields.timestamp('start'),
      sourceState: sourceState,
      uncertainty: uncertainty,
      explanationCode: fields.enumeration(
        'explanationCode',
        MosaicCustomerExplanationCode.values,
        (item) => item.wireValue,
      ),
      isTestSource: fields.boolean('isTestSource'),
      subscriptionInstanceId: subscriptionInstanceId,
      oneTimePurchaseInstanceId: oneTimePurchaseInstanceId,
      storePlatform: fields.raw.containsKey('storePlatform')
          ? fields.enumeration<MosaicCustomerStorePlatform>(
              'storePlatform',
              MosaicCustomerStorePlatform.values,
              (item) => item.wireValue,
            )
          : null,
      end: fields.optionalTimestamp('end'),
    );
  }

  MosaicCustomerUncertainty _uncertainty(Map<String, Object?> value) {
    final fields = _Fields(value, const <String>{
      'reason',
      'since',
      'expectedResolution',
      'diagnosticCode',
    });
    final reason = fields.enumeration(
      'reason',
      MosaicCustomerUncertaintyReason.values,
      (item) => item.wireValue,
    );
    final since = fields.optionalTimestamp('since');
    // A definite state carries no since instant; a non-definite one must.
    if (reason == MosaicCustomerUncertaintyReason.none && since != null ||
        reason != MosaicCustomerUncertaintyReason.none && since == null) {
      throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );
    }
    return MosaicCustomerUncertainty(
      reason: reason,
      since: since,
      expectedResolution: fields.raw.containsKey('expectedResolution')
          ? fields.enumeration<MosaicCustomerExpectedResolution>(
              'expectedResolution',
              MosaicCustomerExpectedResolution.values,
              (item) => item.wireValue,
            )
          : null,
      diagnosticCode: fields.optionalDiagnosticCode('diagnosticCode'),
    );
  }

  MosaicCustomerExplanation _explanation(Map<String, Object?> value) {
    final fields = _Fields(value, const <String>{
      'code',
      'sourceId',
      'safeSummary',
    });
    return MosaicCustomerExplanation(
      code: fields.enumeration(
        'code',
        MosaicCustomerExplanationCode.values,
        (item) => item.wireValue,
      ),
      sourceId: fields.optionalIdentifier('sourceId'),
      safeSummary: fields.optionalSafeText('safeSummary'),
    );
  }

  MosaicCustomerProjectionStatus _projectionStatus(
    Map<String, Object?> value,
  ) {
    final fields = _Fields(value, const <String>{
      'state',
      'lastProjectedAt',
      'pendingFactCount',
      'diagnosticCode',
    });
    final state = fields.enumeration(
      'state',
      MosaicCustomerProjectionState.values,
      (item) => item.wireValue,
    );
    final pendingFactCount = fields.optionalInteger(
      'pendingFactCount',
      minimum: 0,
      maximum: 1000000,
    );
    final diagnosticCode = fields.optionalDiagnosticCode('diagnosticCode');
    if (state == MosaicCustomerProjectionState.pending &&
            pendingFactCount == null ||
        (state == MosaicCustomerProjectionState.degraded ||
                state == MosaicCustomerProjectionState.failed) &&
            diagnosticCode == null) {
      throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );
    }
    return MosaicCustomerProjectionStatus(
      state: state,
      lastProjectedAt: fields.timestamp('lastProjectedAt'),
      pendingFactCount: pendingFactCount,
      diagnosticCode: diagnosticCode,
    );
  }

  MosaicCustomerDiagnostic _diagnostic(Map<String, Object?> value) {
    final fields = _Fields(value, const <String>{
      'code',
      'safeMessage',
      'severity',
      'retryable',
      'retryAfterSeconds',
      'correlationId',
      'recoveryAction',
    });
    final severity = fields.string('severity');
    if (!const <String>{'info', 'warning', 'error'}.contains(severity)) {
      throw const MosaicCustomerEntitlementFormatException(
        'unknown_enum_member',
      );
    }
    final recoveryAction = fields.raw.containsKey('recoveryAction')
        ? fields.string('recoveryAction')
        : null;
    if (recoveryAction != null &&
        !const <String>{
          'retry',
          'refreshCustomerAccessToken',
          'requestAuthoritativeSync',
          'resolveIdentityConflict',
          'fixProductMapping',
          'contactProvider',
          'none',
        }.contains(recoveryAction)) {
      throw const MosaicCustomerEntitlementFormatException(
        'unknown_enum_member',
      );
    }
    return MosaicCustomerDiagnostic(
      code: fields.diagnosticCode('code'),
      safeMessage: fields.safeText('safeMessage'),
      severity: severity,
      retryable: fields.boolean('retryable'),
      correlationId: fields.identifier('correlationId'),
      retryAfterSeconds: fields.optionalInteger(
        'retryAfterSeconds',
        minimum: 1,
        maximum: 86400,
      ),
      recoveryAction: recoveryAction,
    );
  }

  /// Semantic rules the schema cannot express. All of them protect the same
  /// property: an entry a reader trusts always resolves to the reasons behind
  /// it, and unresolved evidence never reads as `inactive`.
  void _validateGraph(
    List<MosaicCustomerEntitlementEntry> entries,
    List<MosaicCustomerEntitlementSource> sources,
  ) {
    if (!_ascendingUnique(entries.map((entry) => entry.entitlementKey)) ||
        !_ascendingUnique(sources.map((source) => source.sourceId))) {
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }
    final byId = <String, MosaicCustomerEntitlementSource>{
      for (final source in sources) source.sourceId: source,
    };
    final referenced = <String>{};
    for (final entry in entries) {
      var granting = false;
      var indeterminate = false;
      for (final sourceId in entry.sourceIds) {
        final source = byId[sourceId];
        if (source == null) {
          throw const MosaicCustomerEntitlementFormatException(
            'semantic_invariant_violated',
          );
        }
        referenced.add(sourceId);
        granting |= source.sourceState == MosaicCustomerSourceState.granting;
        indeterminate |=
            source.sourceState == MosaicCustomerSourceState.unknown;
      }
      // An active Entitlement always has a reason, and an inactive one has no
      // reason that might still turn out to grant.
      if (entry.state == MosaicCustomerEntitlementState.active && !granting ||
          entry.state == MosaicCustomerEntitlementState.inactive &&
              (granting || indeterminate)) {
        throw const MosaicCustomerEntitlementFormatException(
          'semantic_invariant_violated',
        );
      }
    }
    if (referenced.length != byId.length) {
      // An orphan source is a projection defect: the snapshot claims a reason
      // no entry accounts for.
      throw const MosaicCustomerEntitlementFormatException(
        'semantic_invariant_violated',
      );
    }
  }

  static bool _ascendingUnique(Iterable<String> values) {
    String? previous;
    for (final value in values) {
      if (previous != null && value.compareTo(previous) <= 0) return false;
      previous = value;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Closed-key field reading
// ---------------------------------------------------------------------------

final RegExp _identifierPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _entitlementKeyPattern = RegExp(r'^[a-z][a-z0-9_.-]*$');
final RegExp _timestampPattern = RegExp(
  r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$',
);
final RegExp _digestPattern = RegExp(r'^sha256:[a-f0-9]{64}$');
final RegExp _entityTagPattern = RegExp(r'^[A-Za-z0-9._-]+$');
final RegExp _diagnosticCodePattern = RegExp(
  r'^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$',
);

/// Reads one closed JSON object. Construction alone rejects an unknown member,
/// which is what makes reading whole-document rather than best-effort.
final class _Fields {
  _Fields(this.raw, Set<String> allowed) {
    for (final key in raw.keys) {
      if (!allowed.contains(key)) {
        throw const MosaicCustomerEntitlementFormatException('unknown_field');
      }
    }
  }

  final Map<String, Object?> raw;

  Never _missing() => throw const MosaicCustomerEntitlementFormatException(
        'missing_required_field',
      );

  Never _invalid() => throw const MosaicCustomerEntitlementFormatException(
        'invalid_field_value',
      );

  Map<String, Object?> object(String key) {
    final value = raw[key];
    if (value == null) _missing();
    if (value is! Map) _invalid();
    return value.cast<String, Object?>();
  }

  List<Map<String, Object?>> list(String key, {required int maximum}) {
    final value = raw[key];
    if (value == null) _missing();
    return _objects(value, maximum);
  }

  List<Map<String, Object?>> optionalList(String key, {required int maximum}) {
    final value = raw[key];
    if (value == null) return const <Map<String, Object?>>[];
    return _objects(value, maximum);
  }

  List<Map<String, Object?>> _objects(Object? value, int maximum) {
    if (value is! List || value.length > maximum) _invalid();
    return value.map((item) {
      if (item is! Map) _invalid();
      return item.cast<String, Object?>();
    }).toList(growable: false);
  }

  List<String> identifierList(String key, {required int maximum}) {
    final value = raw[key];
    if (value == null) _missing();
    if (value is! List || value.length > maximum) _invalid();
    final result = value.map((item) {
      if (item is! String || !_isIdentifier(item)) _invalid();
      return item;
    }).toList(growable: false);
    if (result.toSet().length != result.length) _invalid();
    return result;
  }

  String string(String key) {
    final value = raw[key];
    if (value == null) _missing();
    if (value is! String) _invalid();
    return value;
  }

  bool boolean(String key) {
    final value = raw[key];
    if (value == null) _missing();
    if (value is! bool) _invalid();
    return value;
  }

  int integer(String key, {required int minimum, int? maximum}) {
    final value = optionalInteger(key, minimum: minimum, maximum: maximum);
    if (value == null) _missing();
    return value;
  }

  int? optionalInteger(String key, {required int minimum, int? maximum}) {
    final value = raw[key];
    if (value == null) return null;
    if (value is! int ||
        value < minimum ||
        maximum != null && value > maximum) {
      _invalid();
    }
    return value;
  }

  DateTime timestamp(String key) {
    final value = optionalTimestamp(key);
    if (value == null) _missing();
    return value;
  }

  DateTime? optionalTimestamp(String key) {
    final value = raw[key];
    if (value == null) return null;
    // Millisecond precision is fixed by the schema because the same instant
    // written at another precision digests differently.
    if (value is! String || !_timestampPattern.hasMatch(value)) _invalid();
    return DateTime.parse(value).toUtc();
  }

  String identifier(String key) {
    final value = optionalIdentifier(key);
    if (value == null) _missing();
    return value;
  }

  String? optionalIdentifier(String key) {
    final value = raw[key];
    if (value == null) return null;
    if (value is! String || !_isIdentifier(value)) _invalid();
    return value;
  }

  // A signed-payload-shaped identifier — three dot-separated base64url
  // segments — is a producer defect the semantic validator rejects, not a
  // reader obligation. Rejecting it here would diverge from iOS and Android
  // and would make the reader guess at intent from a value's shape.
  static bool _isIdentifier(String value) =>
      value.isNotEmpty &&
      value.length <= 128 &&
      _identifierPattern.hasMatch(value);

  String entitlementKey(String key) {
    final value = string(key);
    if (value.isEmpty ||
        value.length > 64 ||
        !_entitlementKeyPattern.hasMatch(value)) {
      _invalid();
    }
    return value;
  }

  String digest(String key) {
    final value = string(key);
    if (!_digestPattern.hasMatch(value)) _invalid();
    return value;
  }

  String entityTag(String key) {
    final value = string(key);
    if (value.length < 8 ||
        value.length > 128 ||
        !_entityTagPattern.hasMatch(value)) {
      _invalid();
    }
    return value;
  }

  String diagnosticCode(String key) {
    final value = optionalDiagnosticCode(key);
    if (value == null) _missing();
    return value;
  }

  String? optionalDiagnosticCode(String key) {
    final value = raw[key];
    if (value == null) return null;
    if (value is! String ||
        value.length < 3 ||
        value.length > 96 ||
        !_diagnosticCodePattern.hasMatch(value)) {
      _invalid();
    }
    return value;
  }

  String safeText(String key) {
    final value = optionalSafeText(key);
    if (value == null) _missing();
    return value;
  }

  String? optionalSafeText(String key) {
    final value = raw[key];
    if (value == null) return null;
    if (value is! String ||
        value.isEmpty ||
        value.length > 240 ||
        value.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
      _invalid();
    }
    return value;
  }

  T enumeration<T>(
    String key,
    List<T> values,
    String Function(T value) wire,
  ) {
    final value = string(key);
    for (final candidate in values) {
      if (wire(candidate) == value) return candidate;
    }
    // Every vocabulary in this contract is closed and over-provisioned, so an
    // unrecognized member means the document is from a version this reader
    // cannot claim to understand.
    throw const MosaicCustomerEntitlementFormatException(
      'unknown_enum_member',
    );
  }
}
