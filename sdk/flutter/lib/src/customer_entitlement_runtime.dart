import 'dart:async';

import 'package:flutter/widgets.dart';

import 'customer_authentication.dart';
import 'customer_entitlement_cache.dart';
import 'customer_entitlement_transport.dart';
import 'customer_entitlements.dart';
import 'placement_identity.dart';

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
  final void Function(String diagnosticCode, {required bool severe})?
      onDiagnostic;

  final MosaicCustomerTokenHolder _tokens;
  final bool _enabled;
  final StreamController<MosaicCustomerEntitlementUpdate> _updates =
      StreamController<MosaicCustomerEntitlementUpdate>.broadcast();
  final MosaicCustomerEntitlementDecoder _decoder =
      const MosaicCustomerEntitlementDecoder();

  String _customerBinding = '';
  String? _namespace;
  MosaicCustomerEntitlementCacheRecord? _record;
  MosaicCustomerEntitlementSnapshot? _snapshot;
  Future<MosaicCustomerEntitlementRefreshResult>? _refresh;
  Future<void>? _load;
  int _generation = 0;
  String? _lastReasonCode;
  bool _lastOutcomeUnavailable = true;
  bool _observingLifecycle = false;
  bool _disposed = false;

  /// Sealed transitions. `Cleared` exists so an identity change is observable
  /// without ever emitting the previous customer's grants.
  Stream<MosaicCustomerEntitlementUpdate> get updates => _updates.stream;

  MosaicCustomerEntitlementSnapshot? get snapshot => _snapshot;

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
    _namespace = mosaicCustomerEntitlementCacheNamespace(
      baseUrl,
      publicSdkKey,
      binding,
    );
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
    _namespace =
        mosaicCustomerEntitlementCacheNamespace(baseUrl, publicSdkKey, '');
    _lastReasonCode = 'entitlements.token.signed_out';
    _lastOutcomeUnavailable = true;
    if (hadState) _emitCleared('entitlements.customer.signed_out');
    await _forgetOtherCustomers(previousNamespace);
  }

  Future<void> _forgetOtherCustomers(String? previousNamespace) async {
    final namespace = _namespace;
    if (namespace == null) return;
    try {
      if (previousNamespace != null && previousNamespace != namespace) {
        await cache.clear(previousNamespace);
      }
      await cache.removeOtherRecords(namespace);
    } on Object {
      _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: true);
    }
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /// Loads the last accepted snapshot from the cache. Never networks.
  Future<void> load() => _load ??= _performLoad();

  Future<void> _performLoad() async {
    final generation = _generation;
    final namespace = _namespace ??= mosaicCustomerEntitlementCacheNamespace(
      baseUrl,
      publicSdkKey,
      _customerBinding,
    );
    try {
      final record = await cache.read(namespace);
      if (generation != _generation) return;
      if (record == null) {
        _load = null;
        return;
      }
      final decoded = _decoder.decode(record.source);
      if (decoded is! MosaicCustomerSnapshotRecord ||
          !decoded.contentDigestValid) {
        // A record that no longer verifies is discarded rather than served. It
        // is not evidence of anything, in either direction.
        await _discard(namespace, 'entitlements.cache.invalid');
        return;
      }
      _record = record;
      _snapshot = decoded.snapshot;
      _lastOutcomeUnavailable = false;
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
    final generation = _generation;
    await load();
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
        knownSnapshotVersion: record?.snapshotVersion,
        entityTag: record?.entityTag,
        requestedEntitlementKeys: settings.requestedEntitlementKeys,
      ),
    );
  }

  /// A confirmed-current snapshot must not expire merely because it was
  /// confirmed instead of resent. The canonical `snapshotUnchanged` record is
  /// the only carrier of refreshed windows, so it is the only thing that moves
  /// them.
  Future<MosaicCustomerEntitlementRefreshResult> _confirmFromRecord(
    MosaicCustomerSnapshotUnchanged unchanged,
    DateTime? serverTime,
  ) async {
    final record = _record;
    if (record == null) {
      return _unavailable('entitlements.sync.unchangedWithoutCache');
    }
    final binding = MosaicCustomerBinding(
      billingCustomerId: unchanged.billingCustomerId,
      projectId: unchanged.projectId,
      environmentId: unchanged.environmentId,
    );
    if (binding != record.binding ||
        unchanged.snapshotVersion != record.snapshotVersion) {
      // A confirmation for another customer, Environment, or version confirms
      // nothing here. Sliding on it would extend one cache's life using
      // another's evidence.
      return _reject(
        binding != record.binding
            ? 'customer_mismatch'
            : 'snapshot_version_not_newer',
        binding != record.binding
            ? MosaicCustomerCacheAction.clear
            : MosaicCustomerCacheAction.preserve,
      );
    }
    final slid = record.slideFreshness(
      refreshAfter: unchanged.refreshAfter,
      validUntil: unchanged.validUntil,
      staleGraceSeconds: unchanged.staleGraceSeconds,
      trustedServerTime: serverTime,
      localReceiptTime: clock().toUtc(),
    );
    _record = slid;
    _lastReasonCode = null;
    _lastOutcomeUnavailable = false;
    await _persist(slid);
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
    _record = reanchored;
    _lastReasonCode = null;
    _lastOutcomeUnavailable = false;
    await _persist(reanchored);
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
    final MosaicCustomerSyncRecord decoded;
    try {
      decoded = _decoder.decode(source);
    } on MosaicCustomerEntitlementFormatException catch (error) {
      return _reject(error.reasonCode, MosaicCustomerCacheAction.preserve);
    }
    if (decoded is MosaicCustomerUnchangedRecord) {
      // The contract-conformant unchanged answer, and the only thing that
      // slides the freshness window.
      return _confirmFromRecord(decoded.unchanged, serverTime);
    }
    final record = decoded as MosaicCustomerSnapshotRecord;
    final snapshot = record.snapshot;
    final decision = mosaicEvaluateCustomerCacheDecision(
      contractVersion: mosaicAuthoritativeEntitlementContractVersion,
      incomingBinding: MosaicCustomerBinding(
        billingCustomerId: snapshot.billingCustomerId,
        projectId: snapshot.projectId,
        environmentId: snapshot.environmentId,
      ),
      incomingSnapshotVersion: snapshot.snapshotVersion,
      incomingAsOf: snapshot.asOf,
      contentDigestValid: record.contentDigestValid,
      cached: _record?.summary,
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
    // Acceptance is atomic. There is no partial merge: a reader never keeps
    // the entries it understood from a document it rejected, and never mixes
    // two versions.
    _record = stored;
    _snapshot = snapshot;
    _lastReasonCode = null;
    _lastOutcomeUnavailable = false;
    await _persist(stored);
    _updates.add(MosaicCustomerEntitlementSnapshotAccepted(snapshot));
    notifyListeners();
    return MosaicCustomerEntitlementUpdated(snapshot);
  }

  Future<void> _persist(MosaicCustomerEntitlementCacheRecord record) async {
    final namespace = _namespace;
    if (namespace == null) return;
    try {
      await cache.write(namespace, record);
    } on Object {
      // Persistence failure degrades durability, never correctness: the
      // accepted snapshot is already being served from memory.
      _report(mosaicCustomerEntitlementCacheUnavailableCode, severe: false);
    }
  }

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
    super.dispose();
  }
}
