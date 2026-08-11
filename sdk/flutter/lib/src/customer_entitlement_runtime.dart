import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';

import 'customer_authentication.dart';
import 'customer_entitlement_cache.dart';
import 'customer_entitlement_transport.dart';
import 'customer_entitlements.dart';
import 'placement_identity.dart';
import 'protocol.dart';

/// Host-facing settings for the authoritative entitlement subsystem.
final class MosaicCustomerEntitlementSettings {
  const MosaicCustomerEntitlementSettings({
    this.refreshOnResume = true,
    this.requestedEntitlementKeys = const <String>[],
  });

  /// Refresh when the application returns to the foreground. A device that was
  /// offline for a week is most likely to be online again at this moment.
  final bool refreshOnResume;

  /// Narrows the response to these keys. Unrecognized keys are Project data
  /// and are accepted; a key the Project does not define contributes no entry.
  final List<String> requestedEntitlementKeys;
}

/// Everything a host may safely display about authoritative entitlement state.
final class MosaicCustomerEntitlementDiagnostics {
  const MosaicCustomerEntitlementDiagnostics({
    required this.enabled,
    required this.cacheState,
    required this.identityGeneration,
    required this.staleGraceSeconds,
    required this.token,
    this.snapshotVersion,
    this.issuedAt,
    this.asOf,
    this.refreshAfter,
    this.validUntil,
    this.lastReasonCode,
    this.billingCustomerId,
    this.projectionState,
    this.authority,
    this.minimumSupport,
  });

  final bool enabled;
  final MosaicEntitlementCacheState cacheState;
  final int identityGeneration;
  final int staleGraceSeconds;

  /// Token handle and expiry only. The token value is structurally absent.
  final MosaicCustomerTokenDiagnostics token;
  final int? snapshotVersion;
  final DateTime? issuedAt;
  final DateTime? asOf;
  final DateTime? refreshAfter;
  final DateTime? validUntil;
  final String? lastReasonCode;
  final String? billingCustomerId;
  final MosaicCustomerProjectionState? projectionState;
  final MosaicCustomerAuthority? authority;
  final MosaicCustomerMinimumSupport? minimumSupport;
}

typedef MosaicCustomerEntitlementClock = DateTime Function();

DateTime _systemClock() => DateTime.now().toUtc();

/// Owns the authoritative entitlement state of one Billing Customer.
///
/// Everything it exposes obeys one rule: a state Mosaic did not confirm is
/// `unknown` or `unavailable`, never `inactive`. A reader that collapsed those
/// into "you do not have it" would turn every outage into a mass revocation
/// experienced by paying customers, at exactly the moment Mosaic is least able
/// to notice.
final class MosaicCustomerEntitlementRuntime extends ChangeNotifier
    with WidgetsBindingObserver {
  MosaicCustomerEntitlementRuntime({
    required this.baseUrl,
    required this.publicSdkKey,
    required this.transport,
    required this.cache,
    required MosaicCustomerTokenProvider? tokenProvider,
    this.applicationId,
    this.platform,
    this.applicationVersion,
    this.settings = const MosaicCustomerEntitlementSettings(),
    this.timeout = const Duration(seconds: 5),
    this.clock = _systemClock,
    this.onDiagnostic = null,
    MosaicCustomerTokenHolder? tokenHolder,
  })  : _tokens = tokenHolder ??
            MosaicCustomerTokenHolder(
              provider: tokenProvider,
              clock: clock,
            ),
        _enabled = tokenProvider != null || tokenHolder != null {
    _observeLifecycleIfAvailable();
  }

  final Uri baseUrl;
  final String publicSdkKey;
  final MosaicCustomerEntitlementTransport transport;
  final MosaicCustomerEntitlementCache cache;
  final MosaicCustomerEntitlementSettings settings;
  final Duration timeout;
  final MosaicCustomerEntitlementClock clock;
  final String? applicationId;
  final MosaicCustomerAuthorityPlatform? platform;
  final String? applicationVersion;
  final void Function(String diagnosticCode, {required bool severe})?
      onDiagnostic;

  final MosaicCustomerTokenHolder _tokens;
  final bool _enabled;
  final StreamController<MosaicCustomerEntitlementUpdate> _updates =
      StreamController<MosaicCustomerEntitlementUpdate>.broadcast();
  final StreamController<MosaicCustomerAuthority> _authorityUpdates =
      StreamController<MosaicCustomerAuthority>.broadcast(sync: true);
  final MosaicCustomerAuthorityDecoder _decoder =
      const MosaicCustomerAuthorityDecoder();

  String _customerBinding = '';
  String? _namespace;
  bool _reportedUnscopedCache = false;
  MosaicCustomerEntitlementCacheRecord? _record;
  MosaicCustomerEntitlementSnapshot? _snapshot;
  MosaicCustomerAuthority? _authority;
  MosaicCustomerMinimumSupport? _minimumSupport;
  Future<MosaicCustomerEntitlementRefreshResult>? _refresh;
  Future<void>? _load;
  int _generation = 0;
  String? _lastReasonCode;
  bool _lastOutcomeUnavailable = true;
  bool _observingLifecycle = false;
  bool _disposed = false;
  bool _authorityUnavailable = true;
  String? _pendingPolicyInvalidationNamespace;

  /// Sealed transitions. `Cleared` exists so an identity change is observable
  /// without ever emitting the previous customer's grants.
  Stream<MosaicCustomerEntitlementUpdate> get updates => _updates.stream;

  /// Replays the current accepted authority to every new listener, then emits
  /// later epochs. The authority object carries no customer grants.
  Stream<MosaicCustomerAuthority> get authorityUpdates => Stream.multi(
        (controller) {
          final subscription = _authorityUpdates.stream.listen(
            controller.addSync,
            onError: controller.addErrorSync,
            onDone: controller.closeSync,
          );
          final current = _authority;
          if (current != null) controller.addSync(current);
          controller.onCancel = subscription.cancel;
        },
        isBroadcast: true,
      );

  MosaicCustomerAuthority? get authority => _authority;

  MosaicCustomerEntitlementSnapshot? get snapshot => _snapshot;

  /// Validates server-owned Project and Environment scope against the accepted
  /// delivery release. A mismatch clears the cache; callers must not retain or
  /// reinterpret it under another release.
  Future<bool> validateAuthorityScope({
    required String? projectId,
    required String environmentId,
  }) async {
    final authority = _authority;
    if (authority == null) return true;
    if (projectId == authority.scope.projectId &&
        environmentId == authority.scope.environmentId) {
      return true;
    }
    final namespace = _namespace;
    if (namespace != null) {
      await _discard(namespace, 'entitlements.authority.scope_mismatch');
    }
    return false;
  }

  /// The current Customer Access Token, for transport-level binding of a
  /// Transaction Observation to this Billing Customer.
  ///
  /// Internal to the SDK's wiring. It returns the held token only while it is
  /// usable and never mints one: observation delivery is fire-and-forget, so a
  /// minting read here would turn a backend outage into a request storm. A
  /// `null` result omits the header, which is a valid anonymous submission.
  String? currentCustomerTokenForSubmission() => _tokens.currentToken?.value;

  MosaicEntitlementCacheState get cacheState => _cacheState();

  MosaicCustomerEntitlementDiagnostics get diagnostics =>
      MosaicCustomerEntitlementDiagnostics(
        enabled: _enabled,
        cacheState: _cacheState(),
        identityGeneration: _generation,
        staleGraceSeconds: _record?.staleGraceSeconds ?? 0,
        token: _tokens.diagnostics,
        snapshotVersion: _snapshot?.snapshotVersion,
        issuedAt: _snapshot?.issuedAt,
        asOf: _snapshot?.asOf,
        refreshAfter: _record?.refreshAfter,
        validUntil: _record?.validUntil,
        lastReasonCode: _lastReasonCode,
        billingCustomerId: _snapshot?.billingCustomerId,
        projectionState: _snapshot?.projectionStatus.state,
        authority: _authority,
        minimumSupport: _minimumSupport,
      );

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /// Binds the runtime to the current Phase 6 identity.
  ///
  /// A change in the host's user identity clears everything bound to the
  /// previous customer before any read can observe it, and deletes the sibling
  /// records on disk. Installation identity is deliberately untouched: it is
  /// Phase 6 state and it is evidence, never an anchor.
  Future<void> bindIdentity(MosaicIdentityState identity) async {
    final binding = identity.userId ?? '';
    _tokens.bindIdentity(
      generation: identity.generation,
      userId: identity.userId,
      installationId: identity.installationId,
    );
    if (binding == _customerBinding && _namespace != null) return;
    final previousNamespace = _namespace;
    _customerBinding = binding;
    _generation += 1;
    // In-flight work belongs to the previous identity. It is disowned here so
    // its result can never be applied to this one.
    _refresh = null;
    _load = null;
    final hadState = _snapshot != null || _record != null;
    _record = null;
    _snapshot = null;
    _authority = null;
    _minimumSupport = null;
    _authorityUnavailable = true;
    _namespace = _cacheNamespaceFor(binding);
    if (hadState) _emitCleared('entitlements.identity.changed');
    await _forgetOtherCustomers(previousNamespace);
    await load();
  }

  /// Signs the customer out: token discarded, cache cleared, state emitted.
  /// Neither half is sufficient alone.
  Future<void> clearCustomer() async {
    _tokens.clearCustomer();
    final previousNamespace = _namespace;
    _customerBinding = '';
    _generation += 1;
    _refresh = null;
    _load = null;
    final hadState = _snapshot != null || _record != null;
    _record = null;
    _snapshot = null;
    _authority = null;
    _minimumSupport = null;
    _authorityUnavailable = true;
    _namespace = _cacheNamespaceFor('');
    _lastReasonCode = 'entitlements.token.signed_out';
    _lastOutcomeUnavailable = true;
    if (hadState) _emitCleared('entitlements.customer.signed_out');
    await _forgetOtherCustomers(previousNamespace);
  }

  /// The cache namespace for one binding, or `null` when the authority scope is
  /// not fully known.
  ///
  /// Application and platform are part of what scopes a snapshot. Folding an
  /// unknown one into the hash as a shared sentinel would give two
  /// differently-scoped installs the same file, so an incomplete scope disables
  /// the cache instead: authoritative reads then degrade to unavailable rather
  /// than risk reading another scope's access.
  String? _cacheNamespaceFor(String binding) {
    final application = applicationId;
    final store = platform?.wireValue;
    if (application == null || store == null) {
      if (!_reportedUnscopedCache) {
        _reportedUnscopedCache = true;
        _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: false);
      }
      return null;
    }
    return mosaicCustomerEntitlementCacheNamespace(
      baseUrl,
      publicSdkKey,
      binding,
      application,
      store,
    );
  }

  Future<void> _forgetOtherCustomers(String? previousNamespace) async {
    final namespace = _namespace;
    if (namespace == null) return;
    try {
      if (previousNamespace != null && previousNamespace != namespace) {
        await cache.clear(previousNamespace);
      }
      await cache.removeOtherRecords(namespace);
      // Phase 9B records have no authority epoch. Remove the current user's
      // legacy namespace instead of ever inferring authority from its bytes.
      await cache.clear(mosaicLegacyCustomerEntitlementCacheNamespace(
        baseUrl,
        publicSdkKey,
        _customerBinding,
      ));
    } on Object {
      _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: true);
    }
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /// Loads the last accepted snapshot from the cache. Never networks.
  Future<void> load() {
    if (_record != null && _snapshot != null) return Future<void>.value();
    return _load ??= _performLoad();
  }

  Future<void> _performLoad() async {
    final generation = _generation;
    final namespace = _namespace ??= _cacheNamespaceFor(_customerBinding);
    if (namespace == null) {
      _load = null;
      return;
    }
    try {
      final pendingInvalidation = _pendingPolicyInvalidationNamespace;
      if (pendingInvalidation != null) {
        if (!await _writePolicyInvalidationTombstone(pendingInvalidation)) {
          return;
        }
        _pendingPolicyInvalidationNamespace = null;
        if (pendingInvalidation == namespace) return;
      }
      final record = await cache.read(namespace);
      if (generation != _generation) return;
      if (record == null) {
        _load = null;
        return;
      }
      if (record.isInvalidationTombstone) {
        _authorityUnavailable = true;
        _lastOutcomeUnavailable = true;
        _lastReasonCode = 'entitlements.authority.policy_unavailable';
        return;
      }
      final decoded = _decoder.decode(record.source);
      if (decoded is! MosaicCustomerAuthoritySnapshotRecord ||
          !decoded.snapshotRecord.contentDigestValid ||
          !decoded.snapshotAuthorityDigestValid ||
          decoded.authority.epoch != record.authority.epoch ||
          decoded.authority.scope != record.authority.scope ||
          decoded.snapshotAuthorityDigest != record.snapshotAuthorityDigest ||
          MosaicCustomerBinding(
                billingCustomerId:
                    decoded.snapshotRecord.snapshot.billingCustomerId,
                projectId: decoded.snapshotRecord.snapshot.projectId,
                environmentId: decoded.snapshotRecord.snapshot.environmentId,
              ) !=
              record.binding ||
          !_supports(decoded.minimumSupport) ||
          !_scopeMatchesConfiguration(decoded.authority.scope) ||
          !_snapshotMatchesAuthority(
            decoded.snapshotRecord.snapshot,
            decoded.authority,
          )) {
        // A record that no longer verifies is discarded rather than served. It
        // is not evidence of anything, in either direction.
        await _discard(namespace, 'entitlements.cache.invalid');
        return;
      }
      _record = record;
      _snapshot = decoded.snapshotRecord.snapshot;
      _authority = decoded.authority;
      _minimumSupport = decoded.minimumSupport;
      _authorityUnavailable = false;
      _lastOutcomeUnavailable = false;
      _tokens.bindAuthorityEpoch(decoded.authority.epoch);
      notifyListeners();
    } on MosaicCustomerEntitlementFormatException catch (error) {
      if (generation == _generation) {
        await _discard(namespace, 'entitlements.cache.${error.reasonCode}');
      }
    } on Object {
      if (generation == _generation) {
        _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: false);
      }
    } finally {
      _load = null;
    }
  }

  Future<void> _discard(String namespace, String reasonCode) async {
    _record = null;
    _snapshot = null;
    _authority = null;
    _minimumSupport = null;
    _authorityUnavailable = true;
    _lastReasonCode = reasonCode;
    try {
      await cache.clear(namespace);
    } on Object {
      // Nothing to recover: the record is already not being served.
    }
    _report(reasonCode, severe: false);
    _emitCleared(reasonCode);
  }

  /// Answers one access question from memory. It performs no I/O, so it is
  /// safe to call while building a widget.
  MosaicCustomerEntitlementCheck checkCustomerEntitlement(
    String entitlementKey,
  ) {
    final state = _cacheState();
    final snapshot = _snapshot;

    final authority = _authority;
    if (_authorityUnavailable || authority == null) {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: entitlementKey,
        state: MosaicCustomerAccessState.unavailable,
        cacheState: state,
        sourceCount: 0,
        endKnown: false,
        isStale: false,
        isTestSource: false,
        reasonCode: _lastReasonCode ?? 'entitlements.authority_unknown',
        snapshotVersion: snapshot?.snapshotVersion,
        asOf: snapshot?.asOf,
      );
    }
    if (!authority.isMosaic) {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: entitlementKey,
        state: MosaicCustomerAccessState.unavailable,
        cacheState: state,
        sourceCount: 0,
        endKnown: false,
        isStale: false,
        isTestSource: false,
        reasonCode: 'entitlements.authority.${authority.kind.wireValue}',
        snapshotVersion: snapshot?.snapshotVersion,
        asOf: snapshot?.asOf,
      );
    }

    if (snapshot == null || state == MosaicEntitlementCacheState.missing) {
      return MosaicCustomerEntitlementCheck(
        entitlementKey: entitlementKey,
        state: _lastOutcomeUnavailable
            ? MosaicCustomerAccessState.unavailable
            : MosaicCustomerAccessState.unknown,
        cacheState: MosaicEntitlementCacheState.missing,
        sourceCount: 0,
        endKnown: false,
        isStale: false,
        isTestSource: false,
        reasonCode: _lastReasonCode ?? 'entitlements.cache.missing',
      );
    }
    if (state == MosaicEntitlementCacheState.expired ||
        state == MosaicEntitlementCacheState.invalid ||
        state == MosaicEntitlementCacheState.differentCustomer) {
      // An expired cache means Mosaic has not been heard from, not that access
      // ended. A host that must not over-grant asks its own server.
      return MosaicCustomerEntitlementCheck(
        entitlementKey: entitlementKey,
        state: MosaicCustomerAccessState.unknown,
        cacheState: state,
        sourceCount: 0,
        endKnown: false,
        isStale: false,
        isTestSource: false,
        reasonCode: 'entitlements.cache.${state.name}',
        snapshotVersion: snapshot.snapshotVersion,
        asOf: snapshot.asOf,
      );
    }

    final entry = snapshot.entryFor(entitlementKey);
    if (entry == null) {
      // Absence is not a statement. Mosaic never said this key is inactive —
      // most often the response was narrowed to other keys.
      return MosaicCustomerEntitlementCheck(
        entitlementKey: entitlementKey,
        state: MosaicCustomerAccessState.unknown,
        cacheState: state,
        sourceCount: 0,
        endKnown: false,
        isStale: state == MosaicEntitlementCacheState.staleWithinGrace,
        isTestSource: false,
        reasonCode: 'entitlements.entry.absent',
        snapshotVersion: snapshot.snapshotVersion,
        asOf: snapshot.asOf,
      );
    }
    final access = switch (entry.state) {
      MosaicCustomerEntitlementState.active => MosaicCustomerAccessState.active,
      MosaicCustomerEntitlementState.inactive =>
        MosaicCustomerAccessState.inactive,
      MosaicCustomerEntitlementState.unknown =>
        MosaicCustomerAccessState.unknown,
    };
    final contributing = entry.sourceIds
        .map(snapshot.sourceFor)
        .whereType<MosaicCustomerEntitlementSource>();
    return MosaicCustomerEntitlementCheck(
      entitlementKey: entitlementKey,
      state: access,
      cacheState: state,
      sourceCount: entry.sourceCount,
      endKnown: entry.endKnown,
      isStale: state == MosaicEntitlementCacheState.staleWithinGrace,
      isTestSource: contributing.any((source) => source.isTestSource),
      reasonCode: access == MosaicCustomerAccessState.active
          ? null
          : entry.primaryExplanation.code.wireValue,
      primaryExplanation: entry.primaryExplanation,
      uncertainty: entry.uncertainty,
      effectiveStart: entry.effectiveStart,
      effectiveEnd: entry.effectiveEnd,
      snapshotVersion: snapshot.snapshotVersion,
      asOf: snapshot.asOf,
    );
  }

  MosaicEntitlementCacheState _cacheState() {
    final record = _record;
    if (record == null || _snapshot == null) {
      return MosaicEntitlementCacheState.missing;
    }
    final now = clock().toUtc();
    final received = record.localReceiptTime;
    if (received != null &&
        now.isBefore(received.subtract(
          const Duration(
            seconds: mosaicCustomerEntitlementClockSkewToleranceSeconds,
          ),
        ))) {
      // The device clock moved backwards since this record was stored. Its age
      // is unmeasurable, so it is treated as expired rather than young.
      return MosaicEntitlementCacheState.expired;
    }
    return mosaicEvaluateCustomerFreshness(
      issuedAt: record.issuedAt,
      refreshAfter: record.refreshAfter,
      validUntil: record.validUntil,
      staleGraceSeconds: record.staleGraceSeconds,
      deviceNow: now,
    );
  }

  // -------------------------------------------------------------------------
  // Refreshing
  // -------------------------------------------------------------------------

  /// Refreshes authoritative state. Concurrent callers coalesce onto one
  /// request: a cold start can want this from a placement read, a lifecycle
  /// resume, and a purchase completion in the same frame.
  Future<MosaicCustomerEntitlementRefreshResult> refresh() =>
      _refresh ??= _performRefresh().whenComplete(() => _refresh = null);

  /// Fire-and-forget refresh. It never blocks or alters a purchase, a restore,
  /// or a presentation result.
  void refreshInBackground() {
    if (!_enabled || _disposed) return;
    unawaited(
        refresh().then<void>((_) {}, onError: (Object _, StackTrace __) {}));
  }

  Future<MosaicCustomerEntitlementRefreshResult> _performRefresh() async {
    if (!_enabled) {
      return _unavailable('entitlements.token.no_provider');
    }
    if (applicationId == null ||
        platform == null ||
        applicationVersion == null) {
      _authorityUnavailable = true;
      return _unavailable('entitlements.authority.requestMetadataMissing');
    }
    final generation = _generation;
    await load();
    if (_pendingPolicyInvalidationNamespace != null) {
      return _unavailable(
        'entitlements.authority.policy_invalidation_persistence_failed',
      );
    }
    final resolution = await _tokens.resolve();
    if (resolution is MosaicCustomerTokenUnavailable) {
      return _unavailable(resolution.reasonCode);
    }
    final resolved = resolution as MosaicCustomerTokenResolved;
    var response = await _send(resolved.token);
    if (response is MosaicCustomerEntitlementSyncUnauthorized) {
      // Exactly one forced refresh and exactly one retry. A second refusal on
      // a freshly minted token is a real failure; retrying forever turns an
      // outage into a request storm.
      final retry = await _tokens.resolve(
        forceRefresh: true,
        observedGeneration: resolved.generation,
      );
      if (retry is MosaicCustomerTokenUnavailable) {
        return _unavailable(retry.reasonCode);
      }
      response = await _send((retry as MosaicCustomerTokenResolved).token);
      if (response is MosaicCustomerEntitlementSyncUnauthorized) {
        return _unavailable('entitlements.sync.unauthorized');
      }
    }
    if (generation != _generation) {
      // Identity changed while the request was in flight. Applying this now
      // would write one customer's snapshot into another's cache.
      return _unavailable('entitlements.identity.changed');
    }
    return switch (response) {
      MosaicCustomerEntitlementSyncFailed(:final diagnosticCode) =>
        _unavailable(diagnosticCode),
      MosaicCustomerEntitlementSyncUnauthorized() =>
        _unavailable('entitlements.sync.unauthorized'),
      MosaicCustomerEntitlementSyncNotModified(:final serverTime) =>
        await _confirmNotModified(serverTime),
      MosaicCustomerEntitlementSyncReceived(:final source, :final serverTime) =>
        await _accept(source, serverTime),
    };
  }

  Future<MosaicCustomerEntitlementSyncResponse> _send(
    MosaicCustomerToken token,
  ) {
    final record = _record;
    return transport.sync(
      MosaicCustomerEntitlementSyncRequest(
        baseUrl: baseUrl,
        publicSdkKey: publicSdkKey,
        customerToken: token.value,
        timeout: timeout,
        correlationId: 'mosaic-flutter-${clock().microsecondsSinceEpoch}',
        applicationId: applicationId,
        platform: platform?.wireValue,
        applicationVersion: applicationVersion,
        knownAuthorityEpoch: record?.authority.epoch,
        knownSnapshotVersion: record?.snapshotVersion,
        knownSnapshotAuthorityDigest: record?.snapshotAuthorityDigest,
      ),
    );
  }

  /// The v2 unchanged record is the only response allowed to slide freshness.
  Future<MosaicCustomerEntitlementRefreshResult> _confirmFromRecord(
    MosaicCustomerAuthorityUnchangedRecord decoded,
    DateTime? serverTime,
  ) async {
    final record = _record;
    final snapshot = _snapshot;
    if (record == null || snapshot == null) {
      return _unavailable('entitlements.sync.unchangedWithoutCache');
    }
    final unchanged = decoded.unchanged;
    final binding = MosaicCustomerBinding(
      billingCustomerId: unchanged.billingCustomerId,
      projectId: unchanged.projectId,
      environmentId: unchanged.environmentId,
    );
    if (!_scopeMatchesConfiguration(decoded.authority.scope) ||
        !_snapshotMatchesAuthority(snapshot, decoded.authority) ||
        binding != record.binding ||
        unchanged.snapshotVersion != record.snapshotVersion ||
        unchanged.entityTag != record.entityTag ||
        unchanged.asOf != record.asOf) {
      // A confirmation for another customer, Environment, or version confirms
      // nothing here. Sliding on it would extend one cache's life using
      // another's evidence.
      return _reject(
        binding != record.binding ||
                !_scopeMatchesConfiguration(decoded.authority.scope)
            ? 'scope_mismatch'
            : 'unchanged_snapshot_mismatch',
        binding != record.binding ||
                !_scopeMatchesConfiguration(decoded.authority.scope)
            ? MosaicCustomerCacheAction.clear
            : MosaicCustomerCacheAction.preserve,
      );
    }
    if (decoded.authority.epoch < record.authority.epoch) {
      return _reject(
          'authority_epoch_regression', MosaicCustomerCacheAction.preserve);
    }
    if (unchanged.issuedAt.isBefore(record.issuedAt) ||
        unchanged.refreshAfter.isBefore(record.refreshAfter) ||
        unchanged.validUntil.isBefore(record.validUntil)) {
      return _reject(
          'freshness_regression', MosaicCustomerCacheAction.preserve);
    }

    final cachedDecoded = _decoder.decode(record.source);
    if (cachedDecoded is! MosaicCustomerAuthoritySnapshotRecord) {
      return _reject(
          'cached_snapshot_invalid', MosaicCustomerCacheAction.clear);
    }
    final expectedDigest = mosaicCustomerSnapshotAuthorityDigest(
      mosaicCustomerAuthorityToJson(decoded.authority),
      cachedDecoded.rawSnapshot,
    );
    if (decoded.snapshotAuthorityDigest != expectedDigest) {
      return _reject('snapshot_authority_digest_mismatch',
          MosaicCustomerCacheAction.preserve);
    }
    final source = jsonEncode(<String, Object?>{
      'authoritativeEntitlementContractVersion':
          mosaicAuthoritativeEntitlementContractVersionV2,
      'recordType': 'customerEntitlementSnapshot',
      'payload': <String, Object?>{
        'authority': mosaicCustomerAuthorityToJson(decoded.authority),
        'snapshot': cachedDecoded.rawSnapshot,
        'snapshotAuthorityDigest': expectedDigest,
        'minimumSupport':
            mosaicCustomerMinimumSupportToJson(decoded.minimumSupport),
      },
    });
    final slid = MosaicCustomerEntitlementCacheRecord(
      source: source,
      binding: record.binding,
      authority: decoded.authority,
      snapshotAuthorityDigest: expectedDigest,
      snapshotVersion: record.snapshotVersion,
      asOf: record.asOf,
      entityTag: record.entityTag,
      issuedAt: unchanged.issuedAt,
      refreshAfter: unchanged.refreshAfter,
      validUntil: unchanged.validUntil,
      staleGraceSeconds: unchanged.staleGraceSeconds,
      trustedServerTime: serverTime,
      localReceiptTime: clock().toUtc(),
    );
    final commitGeneration = _generation;
    if (!await _persist(slid, generation: commitGeneration)) {
      return _persistenceUnavailable(commitGeneration);
    }
    final previousAuthority = _authority;
    _record = slid;
    _authority = decoded.authority;
    _minimumSupport = decoded.minimumSupport;
    _authorityUnavailable = false;
    _lastReasonCode = null;
    _lastOutcomeUnavailable = false;
    _tokens.bindAuthorityEpoch(decoded.authority.epoch);
    _emitAuthorityIfChanged(previousAuthority, decoded.authority);
    notifyListeners();
    return MosaicCustomerEntitlementUnchanged(
      snapshotVersion: slid.snapshotVersion,
    );
  }

  /// A bodyless `304`. The cache is preserved and trusted time is re-anchored,
  /// but the freshness window does not move: nothing in a bodyless response is
  /// a contract-pinned carrier of refreshed windows, and treating an unpinned
  /// header as one would let anything on the path extend offline access.
  Future<MosaicCustomerEntitlementRefreshResult> _confirmNotModified(
    DateTime? serverTime,
  ) async {
    final record = _record;
    if (record == null) {
      return _unavailable('entitlements.sync.unchangedWithoutCache');
    }
    final reanchored = record.slideFreshness(
      refreshAfter: record.refreshAfter,
      validUntil: record.validUntil,
      staleGraceSeconds: record.staleGraceSeconds,
      trustedServerTime: serverTime,
      localReceiptTime: clock().toUtc(),
    );
    final commitGeneration = _generation;
    if (!await _persist(reanchored, generation: commitGeneration)) {
      return _persistenceUnavailable(commitGeneration);
    }
    _record = reanchored;
    _lastReasonCode = null;
    _lastOutcomeUnavailable = false;
    notifyListeners();
    return MosaicCustomerEntitlementUnchanged(
      snapshotVersion: reanchored.snapshotVersion,
    );
  }

  /// The acceptance gate. Every check runs in the normative order, and a
  /// rejected snapshot never emits.
  Future<MosaicCustomerEntitlementRefreshResult> _accept(
    String source,
    DateTime? serverTime,
  ) async {
    final MosaicCustomerAuthoritySyncRecord decoded;
    try {
      decoded = _decoder.decode(source);
    } on MosaicCustomerEntitlementFormatException catch (error) {
      if (_isRecognizablePolicyUnavailable(source)) {
        return _invalidateForPolicyUnavailable();
      }
      return _reject(error.reasonCode, MosaicCustomerCacheAction.preserve);
    }
    final minimumSupport = switch (decoded) {
      MosaicCustomerAuthoritySnapshotRecord(:final minimumSupport) =>
        minimumSupport,
      MosaicCustomerAuthorityUnchangedRecord(:final minimumSupport) =>
        minimumSupport,
      MosaicCustomerAuthorityUnavailableRecord(:final minimumSupport) =>
        minimumSupport,
    };
    if (minimumSupport != null && !_supports(minimumSupport)) {
      _minimumSupport = minimumSupport;
      _authorityUnavailable = true;
      return _unavailable('entitlements.authority.unsupported_client');
    }
    if (decoded is MosaicCustomerAuthorityUnavailableRecord) {
      if (decoded.reason ==
          MosaicCustomerAuthorityUnavailableReason.policyUnavailable) {
        final retainedScope = _authority?.scope ?? _record?.authority.scope;
        if (!_scopeMatchesConfiguration(decoded.scope) ||
            retainedScope != null && decoded.scope != retainedScope) {
          // A policy instruction for another Environment, Application, or
          // platform says nothing about this retained authority. Preserve the
          // accepted cache and diagnose the mismatch rather than invalidating
          // unrelated access.
          return _reject(
            'scope_mismatch',
            MosaicCustomerCacheAction.preserve,
          );
        }
        return _invalidateForPolicyUnavailable();
      }
      _minimumSupport = decoded.minimumSupport;
      _authorityUnavailable = true;
      final scopeMismatch = !_scopeMatchesConfiguration(decoded.scope) ||
          decoded.reason ==
              MosaicCustomerAuthorityUnavailableReason.scopeMismatch;
      if (scopeMismatch) {
        return _reject('scope_mismatch', MosaicCustomerCacheAction.clear);
      }
      return _unavailable('entitlements.authority.${decoded.reason.wireValue}');
    }
    if (decoded is MosaicCustomerAuthorityUnchangedRecord) {
      // The contract-conformant unchanged answer, and the only thing that
      // slides the freshness window.
      return _confirmFromRecord(decoded, serverTime);
    }
    final record = decoded as MosaicCustomerAuthoritySnapshotRecord;
    final snapshot = record.snapshotRecord.snapshot;
    if (!_scopeMatchesConfiguration(record.authority.scope) ||
        !_snapshotMatchesAuthority(snapshot, record.authority)) {
      return _reject('scope_mismatch', MosaicCustomerCacheAction.clear);
    }
    final cached = _record;
    final incomingBinding = MosaicCustomerBinding(
      billingCustomerId: snapshot.billingCustomerId,
      projectId: snapshot.projectId,
      environmentId: snapshot.environmentId,
    );
    if (cached != null && incomingBinding != cached.binding) {
      return _reject('customer_mismatch', MosaicCustomerCacheAction.clear);
    }
    if (cached != null && record.authority.epoch < cached.authority.epoch) {
      return _reject(
          'authority_epoch_regression', MosaicCustomerCacheAction.preserve);
    }
    final decision = mosaicEvaluateCustomerCacheDecision(
      contractVersion: mosaicAuthoritativeEntitlementContractVersion,
      incomingBinding: incomingBinding,
      incomingSnapshotVersion: snapshot.snapshotVersion,
      incomingAsOf: snapshot.asOf,
      contentDigestValid: record.snapshotRecord.contentDigestValid &&
          record.snapshotAuthorityDigestValid,
      cached: cached == null || record.authority.epoch > cached.authority.epoch
          ? null
          : cached.summary,
    );
    if (!decision.accepted) {
      return _reject(decision.reasonCode, decision.cacheAction);
    }

    final now = clock().toUtc();
    final stored = MosaicCustomerEntitlementCacheRecord(
      source: source,
      binding: MosaicCustomerBinding(
        billingCustomerId: snapshot.billingCustomerId,
        projectId: snapshot.projectId,
        environmentId: snapshot.environmentId,
      ),
      authority: record.authority,
      snapshotAuthorityDigest: record.snapshotAuthorityDigest,
      snapshotVersion: snapshot.snapshotVersion,
      asOf: snapshot.asOf,
      entityTag: snapshot.entityTag,
      issuedAt: snapshot.issuedAt,
      refreshAfter: snapshot.refreshAfter,
      validUntil: snapshot.validUntil,
      staleGraceSeconds: snapshot.staleGraceSeconds,
      trustedServerTime: serverTime,
      localReceiptTime: now,
    );
    final commitGeneration = _generation;
    if (!await _persist(stored, generation: commitGeneration)) {
      return _persistenceUnavailable(commitGeneration);
    }
    // Acceptance is atomic. There is no partial merge: a reader never keeps
    // the entries it understood from a document it rejected, and never mixes
    // two versions.
    _record = stored;
    _snapshot = snapshot;
    final previousAuthority = _authority;
    _authority = record.authority;
    _minimumSupport = record.minimumSupport;
    _authorityUnavailable = false;
    _lastReasonCode = null;
    _lastOutcomeUnavailable = false;
    _tokens.bindAuthorityEpoch(record.authority.epoch);
    _emitAuthorityIfChanged(previousAuthority, record.authority);
    _updates.add(MosaicCustomerEntitlementSnapshotAccepted(snapshot));
    notifyListeners();
    return MosaicCustomerEntitlementUpdated(snapshot);
  }

  bool _scopeMatchesConfiguration(MosaicCustomerAuthorityScope scope) =>
      applicationId != null &&
      platform != null &&
      scope.applicationId == applicationId &&
      scope.platform == platform;

  bool _supports(MosaicCustomerMinimumSupport support) {
    final appVersion = applicationVersion;
    if (appVersion == null) return false;
    final sdkComparison =
        _compareVersions(mosaicFlutterSdkVersion, support.minimumSdkVersion);
    final minimumAppComparison = _compareVersions(
      appVersion,
      support.supportedAppVersionWindow.minimumInclusive,
    );
    if (sdkComparison == null ||
        minimumAppComparison == null ||
        sdkComparison < 0 ||
        minimumAppComparison < 0) {
      return false;
    }
    final maximum = support.supportedAppVersionWindow.maximumInclusive;
    if (maximum == null) return true;
    final maximumComparison = _compareVersions(appVersion, maximum);
    return maximumComparison != null && maximumComparison <= 0;
  }

  int? _compareVersions(String left, String right) {
    List<int>? core(String value) {
      final parts = value.split('-').first.split('.');
      if (parts.length != 3) return null;
      final parsed = parts.map(int.tryParse).toList();
      if (parsed.any((item) => item == null)) return null;
      return parsed.cast<int>();
    }

    final leftCore = core(left);
    final rightCore = core(right);
    if (leftCore == null || rightCore == null) return null;
    for (var index = 0; index < 3; index += 1) {
      final comparison = leftCore[index].compareTo(rightCore[index]);
      if (comparison != 0) return comparison;
    }
    return 0;
  }

  bool _snapshotMatchesAuthority(
    MosaicCustomerEntitlementSnapshot snapshot,
    MosaicCustomerAuthority authority,
  ) =>
      snapshot.projectId == authority.scope.projectId &&
      snapshot.environmentId == authority.scope.environmentId;

  void _emitAuthorityIfChanged(
    MosaicCustomerAuthority? previous,
    MosaicCustomerAuthority current,
  ) {
    final changed = previous == null ||
        previous.epoch != current.epoch ||
        previous.kind != current.kind ||
        previous.scope != current.scope ||
        previous.transitionState != current.transitionState ||
        previous.cutoverAt != current.cutoverAt;
    if (!changed) return;
    if (!_authorityUpdates.isClosed) _authorityUpdates.add(current);
    if (!_updates.isClosed) {
      _updates.add(MosaicCustomerAuthorityChanged(
        previous: previous,
        current: current,
      ));
    }
  }

  Future<bool> _persist(
    MosaicCustomerEntitlementCacheRecord record, {
    required int generation,
  }) async {
    final namespace = _namespace;
    if (namespace == null) return false;
    try {
      await cache.write(namespace, record);
    } on Object {
      return false;
    }
    if (generation == _generation) return true;
    // The write completed after an identity change. Remove the superseded
    // namespace again so the late completion cannot resurrect old access.
    try {
      await cache.clear(namespace);
    } on Object {
      _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: true);
    }
    return false;
  }

  Future<MosaicCustomerEntitlementRefreshResult>
      _invalidateForPolicyUnavailable() async {
    final namespace = _namespace;
    if (namespace == null ||
        !await _writePolicyInvalidationTombstone(namespace)) {
      _pendingPolicyInvalidationNamespace = namespace;
      _clearAcceptedAuthority(
        'entitlements.authority.policy_invalidation_persistence_failed',
      );
      return _unavailable(
        'entitlements.authority.policy_invalidation_persistence_failed',
      );
    }
    _pendingPolicyInvalidationNamespace = null;
    _clearAcceptedAuthority('entitlements.authority.policy_unavailable');
    return _unavailable('entitlements.authority.policy_unavailable');
  }

  Future<bool> _writePolicyInvalidationTombstone(String namespace) async {
    try {
      await cache.write(
        namespace,
        MosaicCustomerEntitlementCacheRecord.invalidationTombstone(),
      );
      return true;
    } on Object {
      _report(
        'entitlements.authority.policy_invalidation_persistence_failed',
        severe: true,
      );
      // A failed atomic replace may leave the previously accepted snapshot on
      // disk. Remove it through the same cache abstraction before returning so
      // a cold restart cannot replay access while the tombstone retry gate is
      // active. If storage is wholly unavailable, the clear throws and the
      // severe diagnostic plus gate remain the only safe process-local state.
      try {
        await cache.clear(namespace);
      } on Object {
        _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: true);
      }
      return false;
    }
  }

  void _clearAcceptedAuthority(String reasonCode) {
    final hadState = _snapshot != null || _record != null || _authority != null;
    _record = null;
    _snapshot = null;
    _authority = null;
    _minimumSupport = null;
    _authorityUnavailable = true;
    _lastOutcomeUnavailable = true;
    _lastReasonCode = reasonCode;
    if (hadState) _emitCleared(reasonCode);
    notifyListeners();
  }

  bool _isRecognizablePolicyUnavailable(String source) {
    final recognized =
        _decoder.decodePolicyUnavailableWithForbiddenSupport(source);
    return recognized != null && _scopeMatchesConfiguration(recognized.scope);
  }

  MosaicCustomerEntitlementRefreshResult _persistenceUnavailable(
    int generation,
  ) =>
      _unavailable(
        generation == _generation
            ? mosaicCustomerEntitlementCacheUnavailableCode
            : 'entitlements.identity.changed',
      );

  MosaicCustomerEntitlementRefreshResult _reject(
    String reasonCode,
    MosaicCustomerCacheAction action,
  ) {
    _lastReasonCode = 'entitlements.rejected.$reasonCode';
    if (action == MosaicCustomerCacheAction.clear) {
      // The one rejection that clears rather than preserves. Continuing to
      // serve the previous customer's access after an identity change is
      // precisely the leak this rule exists to prevent.
      _record = null;
      _snapshot = null;
      _authority = null;
      _minimumSupport = null;
      _authorityUnavailable = true;
      _lastOutcomeUnavailable = false;
      final namespace = _namespace;
      if (namespace != null) {
        unawaited(cache.clear(namespace).catchError((Object _) {}));
      }
      _report('entitlements.binding.$reasonCode', severe: true);
      _emitCleared('entitlements.binding.$reasonCode');
      notifyListeners();
    } else {
      _report('entitlements.rejected.$reasonCode', severe: false);
    }
    return MosaicCustomerEntitlementRejected(
      reasonCode: reasonCode,
      cacheAction: action,
    );
  }

  MosaicCustomerEntitlementRefreshResult _unavailable(String reasonCode) {
    _lastReasonCode = reasonCode;
    // A network failure, a signed-out customer, and a backend that will not
    // mint a token are all "Mosaic could not answer". None of them is a claim
    // about the customer, and the previously accepted cache is untouched.
    if (_snapshot == null) _lastOutcomeUnavailable = true;
    _report(reasonCode, severe: false);
    return MosaicCustomerEntitlementUnavailable(reasonCode: reasonCode);
  }

  void _emitCleared(String reasonCode) {
    if (_updates.isClosed) return;
    _updates.add(MosaicCustomerEntitlementCleared(reasonCode: reasonCode));
  }

  void _report(String code, {required bool severe}) {
    try {
      onDiagnostic?.call(code, severe: severe);
    } on Object {
      // A host diagnostic sink that throws must never become a failed sync.
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  void _observeLifecycleIfAvailable() {
    if (_observingLifecycle || !settings.refreshOnResume) return;
    try {
      WidgetsBinding.instance.addObserver(this);
      _observingLifecycle = true;
    } on FlutterError {
      // A pure Dart host may configure before Flutter initializes.
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && settings.refreshOnResume) {
      refreshInBackground();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    if (_observingLifecycle) WidgetsBinding.instance.removeObserver(this);
    unawaited(_updates.close());
    unawaited(_authorityUpdates.close());
    super.dispose();
  }
}
