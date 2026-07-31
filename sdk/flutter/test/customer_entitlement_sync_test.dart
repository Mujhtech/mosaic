import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';
import 'support/customer_authority_fixture.dart';

/// Records what the runtime asked for and replays scripted answers.
final class _RecordingTransport implements MosaicCustomerEntitlementTransport {
  _RecordingTransport(this.responses);

  final List<MosaicCustomerEntitlementSyncResponse> responses;
  final List<MosaicCustomerEntitlementSyncRequest> requests =
      <MosaicCustomerEntitlementSyncRequest>[];
  Completer<void>? gate;
  var _index = 0;

  @override
  Future<MosaicCustomerEntitlementSyncResponse> sync(
    MosaicCustomerEntitlementSyncRequest request,
  ) async {
    requests.add(request);
    if (gate case final pending?) await pending.future;
    final response = responses[_index.clamp(0, responses.length - 1)];
    _index += 1;
    return response;
  }
}

final class _ControlledCache implements MosaicCustomerEntitlementCache {
  MosaicCustomerEntitlementCacheRecord? record;
  late Completer<void> writeStarted;
  late Completer<void> writeGate;
  var failWrite = false;

  void controlNextWrite({required bool fail}) {
    writeStarted = Completer<void>();
    writeGate = Completer<void>();
    failWrite = fail;
  }

  @override
  Future<MosaicCustomerEntitlementCacheRecord?> read(String namespace) async =>
      record;

  @override
  Future<void> write(
    String namespace,
    MosaicCustomerEntitlementCacheRecord candidate,
  ) async {
    writeStarted.complete();
    await writeGate.future;
    if (failWrite) throw StateError('scripted cache failure');
    record = candidate;
  }

  @override
  Future<void> clear(String namespace) async => record = null;

  @override
  Future<void> removeOtherRecords(String namespace) async {}
}

final class _PolicyInvalidationCache implements MosaicCustomerEntitlementCache {
  MosaicCustomerEntitlementCacheRecord? record;
  bool failTombstoneWrites = false;
  bool failClear = true;
  int tombstoneWriteAttempts = 0;
  int clearAttempts = 0;
  Completer<void>? tombstoneWriteGate;

  @override
  Future<MosaicCustomerEntitlementCacheRecord?> read(String namespace) async =>
      record;

  @override
  Future<void> write(
    String namespace,
    MosaicCustomerEntitlementCacheRecord candidate,
  ) async {
    if (candidate.isInvalidationTombstone) {
      tombstoneWriteAttempts += 1;
      if (tombstoneWriteGate case final gate?) await gate.future;
      if (failTombstoneWrites) {
        throw StateError('scripted tombstone persistence failure');
      }
    }
    record = candidate;
  }

  @override
  Future<void> clear(String namespace) async {
    clearAttempts += 1;
    if (failClear) throw StateError('delete unavailable');
    record = null;
  }

  @override
  Future<void> removeOtherRecords(String namespace) async {}
}

void main() {
  final root = repositoryDirectory(
    'protocol/fixtures/authoritative-entitlement/v1',
  );
  final authorityRoot = repositoryDirectory(
    'protocol/fixtures/authoritative-entitlement/v2',
  );
  String fixture(String path) => File('${root.path}/$path').readAsStringSync();

  late DateTime now;
  DateTime clock() => now;

  setUp(() => now = DateTime.utc(2026, 7, 28, 12, 30));

  MosaicCustomerToken token([String id = 'token-a']) => MosaicCustomerToken(
        value: 'mcat_$id',
        tokenId: id,
        expiresAt: now.add(const Duration(hours: 1)),
      );

  MosaicCustomerEntitlementSyncReceived received(String path) =>
      MosaicCustomerEntitlementSyncReceived(
        source: path.endsWith('snapshot-unchanged.json')
            ? wrapCustomerUnchangedV2(
                fixture(path),
                fixture('snapshots/active-subscription.json'),
              )
            : wrapCustomerSnapshotV2(fixture(path)),
      );

  String firstProjectedSnapshot(int version) {
    final envelope = jsonDecode(
      fixture('snapshots/never-projected-placeholder.json'),
    ) as Map<String, Object?>;
    final payload = (envelope['payload']! as Map).cast<String, Object?>();
    final projected = (jsonDecode(
      fixture('snapshots/active-subscription.json'),
    ) as Map<String, Object?>)['payload']! as Map<String, Object?>;
    payload['snapshotVersion'] = version;
    payload['entityTag'] = 'cs-0001-v$version';
    payload.remove('previousSnapshotVersion');
    payload['issuedAt'] = '2026-07-29T10:00:00.000Z';
    payload['asOf'] = '2026-07-29T09:59:58.000Z';
    payload['refreshAfter'] = '2026-07-29T11:00:00.000Z';
    payload['validUntil'] = '2026-08-05T10:00:00.000Z';
    payload['entries'] = projected['entries'];
    payload['sources'] = projected['sources'];
    payload['projectionStatus'] = <String, Object?>{
      'state': 'current',
      'lastProjectedAt': '2026-07-29T09:59:58.000Z',
    };
    payload['contentDigest'] = mosaicCustomerContentDigest(payload);
    return jsonEncode(envelope);
  }

  MosaicCustomerEntitlementRuntime runtimeWith(
    _RecordingTransport transport, {
    MosaicCustomerEntitlementCache? cache,
    MosaicCustomerTokenProvider? tokenProvider,
    void Function(String code, {required bool severe})? onDiagnostic,
  }) =>
      MosaicCustomerEntitlementRuntime(
        baseUrl: Uri.parse('https://api.mosaic.test'),
        publicSdkKey: 'public_key',
        transport: transport,
        cache: cache ?? MosaicMemoryCustomerEntitlementCache(),
        tokenProvider: tokenProvider ?? (_) async => token(),
        applicationId: fixtureAuthorityApplicationId,
        platform: MosaicCustomerAuthorityPlatform.ios,
        applicationVersion: '4.2.0',
        settings: const MosaicCustomerEntitlementSettings(
          refreshOnResume: false,
        ),
        clock: clock,
        onDiagnostic: onDiagnostic,
      );

  MosaicCustomerEntitlementCacheRecord replaceCachedBinding(
    MosaicCustomerEntitlementCacheRecord record, {
    MosaicCustomerBinding? binding,
    MosaicCustomerAuthority? authority,
    String? snapshotAuthorityDigest,
  }) =>
      MosaicCustomerEntitlementCacheRecord(
        source: record.source,
        binding: binding ?? record.binding,
        authority: authority ?? record.authority,
        snapshotAuthorityDigest:
            snapshotAuthorityDigest ?? record.snapshotAuthorityDigest,
        snapshotVersion: record.snapshotVersion,
        asOf: record.asOf,
        entityTag: record.entityTag,
        issuedAt: record.issuedAt,
        refreshAfter: record.refreshAfter,
        validUntil: record.validUntil,
        staleGraceSeconds: record.staleGraceSeconds,
        trustedServerTime: record.trustedServerTime,
        localReceiptTime: record.localReceiptTime,
      );

  test('the sync request matches the canonical conditional fixture shape', () {
    final canonicalRoot = repositoryDirectory(
      'protocol/fixtures/authoritative-entitlement/v2',
    );
    final canonical = jsonDecode(
      File('${canonicalRoot.path}/sync-request.json').readAsStringSync(),
    ) as Map<String, Object?>;
    final encoded = mosaicEncodeEntitlementSyncRequest(
      MosaicCustomerEntitlementSyncRequest(
        baseUrl: Uri.parse('https://api.mosaic.test'),
        publicSdkKey: 'public_key',
        customerToken: 'mcat_secret',
        timeout: const Duration(seconds: 5),
        correlationId: 'fixture-correlation-0001',
        applicationId: fixtureAuthorityApplicationId,
        platform: 'ios',
        applicationVersion: '4.2.0',
        knownAuthorityEpoch: 5,
        knownSnapshotVersion: 4,
        knownSnapshotAuthorityDigest:
            'sha256:b659fc1560544193b6599e1e4a82861a55cae857fcad73fa340b611abe877c34',
        entityTag: 'cs-0001-v4',
      ),
    );

    expect(
      encoded['authoritativeEntitlementContractVersion'],
      canonical['authoritativeEntitlementContractVersion'],
    );
    expect(encoded['recordType'], canonical['recordType']);
    final payload = encoded['payload']! as Map<String, Object?>;
    // Contract negotiation lives in the body, which is why this read is sent
    // with one: a bodyless request cannot state which versions it can read,
    // and the server answers snapshotUnchanged only when told which version
    // the caller holds.
    final request = payload['request']! as Map<String, Object?>;
    expect(request['supportedContractVersions'], <String>['1', '2']);
    expect(payload['knownAuthorityEpoch'], 5);
    expect(payload['knownSnapshotVersion'], 4);
    expect(
      payload['knownSnapshotAuthorityDigest'],
      (canonical['payload']!
          as Map<String, Object?>)['knownSnapshotAuthorityDigest'],
    );
    expect(request.containsKey('projectId'), isFalse);
    expect(request.containsKey('environmentId'), isFalse);
    expect(request.containsKey('customerId'), isFalse);
    // No credential ever appears in the record.
    expect(jsonEncode(encoded), isNot(contains('mcat_')));
  });

  test('a request without a retained digest remains a full-sync request', () {
    final encoded = mosaicEncodeEntitlementSyncRequest(
      MosaicCustomerEntitlementSyncRequest(
        baseUrl: Uri.parse('https://api.mosaic.test'),
        publicSdkKey: 'public_key',
        customerToken: 'mcat_secret',
        timeout: const Duration(seconds: 5),
        correlationId: 'fixture-correlation-0001',
        applicationId: fixtureAuthorityApplicationId,
        platform: 'ios',
        applicationVersion: '4.2.0',
        knownAuthorityEpoch: 4,
        knownSnapshotVersion: 41,
      ),
    );
    final canonical = jsonDecode(
      File('${authorityRoot.path}/sync-request-without-known-digest.json')
          .readAsStringSync(),
    ) as Map<String, Object?>;
    final payload = encoded['payload']! as Map<String, Object?>;
    final canonicalPayload = canonical['payload']! as Map<String, Object?>;

    expect(payload.containsKey('knownSnapshotAuthorityDigest'), isFalse);
    expect(
      payload.keys,
      unorderedEquals(canonicalPayload.keys),
    );
  });

  test('a newer snapshot is accepted and emitted once', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(transport);
    final updates = <MosaicCustomerEntitlementUpdate>[];
    runtime.updates.listen(updates.add);

    final result = await runtime.refresh();

    expect(result, isA<MosaicCustomerEntitlementUpdated>());
    expect(runtime.snapshot?.snapshotVersion, 4);
    final check = runtime.checkCustomerEntitlement('pro');
    expect(check.state, MosaicCustomerAccessState.active);
    expect(check.reasonCode, isNull);
    expect(check.sourceCount, 1);
    await pumpEventQueue();
    expect(updates.whereType<MosaicCustomerAuthorityChanged>(), hasLength(1));
    expect(
      updates.whereType<MosaicCustomerEntitlementSnapshotAccepted>(),
      hasLength(1),
    );
    runtime.dispose();
  });

  test('persistence commits before state and a failed replacement is invisible',
      () async {
    final active = fixture('snapshots/active-subscription.json');
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(active, epoch: 5),
      ),
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(active, epoch: 6),
      ),
    ]);
    final cache = _ControlledCache()..controlNextWrite(fail: false);
    final runtime = runtimeWith(transport, cache: cache);
    final updates = <MosaicCustomerEntitlementUpdate>[];
    runtime.updates.listen(updates.add);
    var listenerCalls = 0;
    runtime.addListener(() => listenerCalls += 1);

    final first = runtime.refresh();
    await cache.writeStarted.future;

    expect(runtime.snapshot, isNull);
    expect(runtime.authority, isNull);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unavailable,
    );
    expect(updates, isEmpty);
    expect(listenerCalls, 0);

    cache.writeGate.complete();
    expect(await first, isA<MosaicCustomerEntitlementUpdated>());
    await pumpEventQueue();
    final acceptedSnapshot = runtime.snapshot;
    final acceptedUpdateCount = updates.length;
    final acceptedListenerCalls = listenerCalls;
    expect(acceptedSnapshot, isNotNull);
    expect(runtime.authority?.epoch, 5);

    cache.controlNextWrite(fail: true);
    final replacement = runtime.refresh();
    await cache.writeStarted.future;

    expect(runtime.snapshot, same(acceptedSnapshot));
    expect(runtime.authority?.epoch, 5);
    expect(updates, hasLength(acceptedUpdateCount));
    expect(listenerCalls, acceptedListenerCalls);

    cache.writeGate.complete();
    expect(
      await replacement,
      isA<MosaicCustomerEntitlementUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        mosaicCustomerEntitlementCacheUnavailableCode,
      ),
    );
    await pumpEventQueue();
    expect(runtime.snapshot, same(acceptedSnapshot));
    expect(runtime.authority?.epoch, 5);
    expect(updates, hasLength(acceptedUpdateCount));
    expect(listenerCalls, acceptedListenerCalls);
    runtime.dispose();
  });

  test('the never-projected placeholder is cached and replaced by version 1',
      () async {
    now = DateTime.utc(2026, 7, 29, 8, 30);
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(
          fixture('snapshots/never-projected-placeholder.json'),
        ),
      ),
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(firstProjectedSnapshot(1)),
      ),
    ]);
    final runtime = runtimeWith(transport);

    final placeholder = await runtime.refresh();

    expect(placeholder, isA<MosaicCustomerEntitlementUpdated>());
    expect(runtime.snapshot?.snapshotVersion, 0);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unknown,
    );

    now = DateTime.utc(2026, 7, 29, 10, 30);
    final projected = await runtime.refresh();

    expect(transport.requests.last.knownSnapshotVersion, 0);
    final requestPayload = mosaicEncodeEntitlementSyncRequest(
      transport.requests.last,
    )['payload']! as Map<String, Object?>;
    expect(requestPayload['knownSnapshotVersion'], 0);
    expect(projected, isA<MosaicCustomerEntitlementUpdated>());
    expect(runtime.snapshot?.snapshotVersion, 1);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    runtime.dispose();
  });

  test('version zero cannot carry projected entitlement content', () {
    expect(
      () => const MosaicCustomerEntitlementDecoder().decode(
        firstProjectedSnapshot(0),
      ),
      throwsA(
        isA<MosaicCustomerEntitlementFormatException>().having(
          (error) => error.reasonCode,
          'reasonCode',
          'semantic_invariant_violated',
        ),
      ),
    );
  });

  test('an older snapshot never rolls accepted state backwards', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/newer-snapshot.json'),
      received('snapshots/active-subscription.json'),
    ]);
    // The newer fixture is issued at 14:00, so the device clock is set after
    // it: a clock earlier than issuance is the unreliable-clock path, not the
    // case under test here.
    now = DateTime.utc(2026, 7, 28, 14, 30);
    final runtime = runtimeWith(transport);

    await runtime.refresh();
    final accepted = runtime.snapshot!.snapshotVersion;
    final second = await runtime.refresh();

    expect(
      second,
      isA<MosaicCustomerEntitlementRejected>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'snapshot_version_not_newer',
      ),
    );
    expect(runtime.snapshot!.snapshotVersion, accepted);
    // The cache is preserved, so access continues from the newer state rather
    // than dropping to unknown because a late response arrived.
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    runtime.dispose();
  });

  test('a higher authority epoch replaces state without version inference',
      () async {
    final active = fixture('snapshots/active-subscription.json');
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(active, epoch: 5),
      ),
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(active, epoch: 6),
      ),
    ]);
    final runtime = runtimeWith(transport);
    final authorities = <MosaicCustomerAuthority>[];
    runtime.authorityUpdates.listen(authorities.add);

    await runtime.refresh();
    final result = await runtime.refresh();

    expect(result, isA<MosaicCustomerEntitlementUpdated>());
    expect(runtime.authority?.epoch, 6);
    expect(runtime.snapshot?.snapshotVersion, 4);
    await pumpEventQueue();
    expect(authorities.map((item) => item.epoch), <int>[5, 6]);
    runtime.dispose();
  });

  test('the canonical unchanged record is what slides the window', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      received('snapshots/snapshot-unchanged.json'),
    ]);
    final runtime = runtimeWith(transport);

    await runtime.refresh();
    // Past the accepted snapshot's own validUntil. The unchanged record's
    // refreshed window is the only contract-pinned carrier, so a device that
    // is demonstrably in contact with the server does not expire.
    now = DateTime.utc(2026, 8, 4, 12, 20);
    final unchanged = await runtime.refresh();

    expect(unchanged, isA<MosaicCustomerEntitlementUnchanged>());
    expect(runtime.snapshot!.snapshotVersion, 4);
    expect(runtime.cacheState, MosaicEntitlementCacheState.refreshRecommended);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    // The conditional request carried both the version and the validator.
    expect(transport.requests.last.knownSnapshotVersion, 4);
    expect(transport.requests.last.knownAuthorityEpoch, 5);
    final accepted = const MosaicCustomerAuthorityDecoder().decode(
      wrapCustomerSnapshotV2(fixture('snapshots/active-subscription.json')),
    ) as MosaicCustomerAuthoritySnapshotRecord;
    expect(
      transport.requests.last.knownSnapshotAuthorityDigest,
      accepted.snapshotAuthorityDigest,
    );
    expect(transport.requests.last.entityTag, isNull);
    runtime.dispose();
  });

  test('policy unavailable clears stale authority and later full sync recovers',
      () async {
    final cache = MosaicMemoryCustomerEntitlementCache();
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(
        source: File(
          '${authorityRoot.path}/authority-policy-unavailable.json',
        ).readAsStringSync(),
      ),
    ]);
    final runtime = runtimeWith(transport, cache: cache);
    await runtime.refresh();

    final result = await runtime.refresh();

    expect(
      result,
      isA<MosaicCustomerEntitlementUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.authority.policy_unavailable',
      ),
    );
    expect(runtime.snapshot, isNull);
    expect(runtime.authority, isNull);
    expect(runtime.diagnostics.minimumSupport, isNull);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unavailable,
    );
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      isNot(MosaicCustomerAccessState.inactive),
    );
    final namespace = mosaicCustomerEntitlementCacheNamespace(
      Uri.parse('https://api.mosaic.test'),
      'public_key',
      '',
      fixtureAuthorityApplicationId,
      'ios',
    );
    expect((await cache.read(namespace))!.isInvalidationTombstone, isTrue);
    runtime.dispose();

    final restored = runtimeWith(
      _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
      ]),
      cache: cache,
    );
    await restored.load();
    expect(restored.snapshot, isNull);
    expect(
      restored.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unavailable,
    );

    final recovered = await restored.refresh();

    expect(recovered, isA<MosaicCustomerEntitlementUpdated>());
    expect(restored.snapshot?.snapshotVersion, 4);
    expect(restored.checkCustomerEntitlement('pro').state,
        MosaicCustomerAccessState.active);
    expect(
      restored.checkCustomerEntitlement('pro').state,
      isNot(MosaicCustomerAccessState.inactive),
    );
    expect((await cache.read(namespace))!.isInvalidationTombstone, isFalse);
    restored.dispose();
  });

  test('policy unavailable for another scope preserves accepted cache',
      () async {
    final cache = MosaicMemoryCustomerEntitlementCache();
    final wrongScope = jsonDecode(File(
      '${authorityRoot.path}/authority-policy-unavailable.json',
    ).readAsStringSync()) as Map<String, Object?>;
    final payload = wrongScope['payload']! as Map<String, Object?>;
    final scope = payload['scope']! as Map<String, Object?>;
    scope['environmentId'] = 'fixture-environment-staging';
    final runtime = runtimeWith(
      _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
        MosaicCustomerEntitlementSyncReceived(source: jsonEncode(wrongScope)),
      ]),
      cache: cache,
    );
    await runtime.refresh();

    final result = await runtime.refresh();

    expect(
      result,
      isA<MosaicCustomerEntitlementRejected>()
          .having((value) => value.reasonCode, 'reasonCode', 'scope_mismatch')
          .having(
            (value) => value.cacheAction,
            'cacheAction',
            MosaicCustomerCacheAction.preserve,
          ),
    );
    expect(runtime.snapshot?.snapshotVersion, 4);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    final namespace = mosaicCustomerEntitlementCacheNamespace(
      Uri.parse('https://api.mosaic.test'),
      'public_key',
      '',
      fixtureAuthorityApplicationId,
      'ios',
    );
    expect((await cache.read(namespace))!.isInvalidationTombstone, isFalse);
    runtime.dispose();
  });

  test('policy tombstone does not depend on best-effort cache deletion',
      () async {
    final cache = _PolicyInvalidationCache();
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(
        source: File(
          '${authorityRoot.path}/authority-policy-unavailable.json',
        ).readAsStringSync(),
      ),
    ]);
    final runtime = runtimeWith(transport, cache: cache);
    await runtime.refresh();
    cache.tombstoneWriteGate = Completer<void>();

    final pending = runtime.refresh();
    await pumpEventQueue();

    expect(cache.tombstoneWriteAttempts, 1);
    expect(runtime.snapshot?.snapshotVersion, 4);
    expect(runtime.checkCustomerEntitlement('pro').state,
        MosaicCustomerAccessState.active);

    cache.tombstoneWriteGate!.complete();
    final result = await pending;

    expect(result, isA<MosaicCustomerEntitlementUnavailable>());
    expect(cache.record!.isInvalidationTombstone, isTrue);
    expect(cache.tombstoneWriteAttempts, 1);
    expect(cache.clearAttempts, 0);
    runtime.dispose();
  });

  test('failed tombstone persistence blocks bootstrap until retry succeeds',
      () async {
    final cache = _PolicyInvalidationCache();
    final severeCodes = <String>[];
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(
        source: File(
          '${authorityRoot.path}/authority-policy-unavailable.json',
        ).readAsStringSync(),
      ),
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(
      transport,
      cache: cache,
      onDiagnostic: (code, {required bool severe}) {
        if (severe) severeCodes.add(code);
      },
    );
    await runtime.refresh();
    cache.failTombstoneWrites = true;

    final failed = await runtime.refresh();

    expect(
      failed,
      isA<MosaicCustomerEntitlementUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.authority.policy_invalidation_persistence_failed',
      ),
    );
    expect(runtime.snapshot, isNull);
    expect(cache.record!.isInvalidationTombstone, isFalse);
    expect(
      severeCodes,
      contains(
        'entitlements.authority.policy_invalidation_persistence_failed',
      ),
    );

    final blocked = await runtime.refresh();

    expect(blocked, isA<MosaicCustomerEntitlementUnavailable>());
    expect(transport.requests, hasLength(2));
    expect(cache.tombstoneWriteAttempts, 2);

    cache.failTombstoneWrites = false;
    final recovered = await runtime.refresh();

    expect(recovered, isA<MosaicCustomerEntitlementUpdated>());
    expect(cache.tombstoneWriteAttempts, 3);
    expect(cache.record!.isInvalidationTombstone, isFalse);
    expect(runtime.checkCustomerEntitlement('pro').state,
        MosaicCustomerAccessState.active);
    runtime.dispose();
  });

  test('failed tombstone write clears durable cache before cold restart',
      () async {
    final cache = _PolicyInvalidationCache()
      ..failTombstoneWrites = true
      ..failClear = false;
    final runtime = runtimeWith(
      _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
        MosaicCustomerEntitlementSyncReceived(
          source: File(
            '${authorityRoot.path}/authority-policy-unavailable.json',
          ).readAsStringSync(),
        ),
      ]),
      cache: cache,
    );
    await runtime.refresh();

    final failed = await runtime.refresh();

    expect(failed, isA<MosaicCustomerEntitlementUnavailable>());
    expect(cache.record, isNull);
    expect(cache.clearAttempts, 1);
    runtime.dispose();

    final restarted = runtimeWith(
      _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
      ]),
      cache: cache,
    );
    await restarted.load();
    expect(restarted.snapshot, isNull);
    expect(
      restarted.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unavailable,
    );
    restarted.dispose();
  });

  test('malformed policy-unavailable fixture tombstones instead of preserving',
      () async {
    final cache = MosaicMemoryCustomerEntitlementCache();
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(
        source: File(
          '${authorityRoot.path}/invalid/policy-unavailable-with-minimum-support.json',
        ).readAsStringSync(),
      ),
    ]);
    final runtime = runtimeWith(transport, cache: cache);
    await runtime.refresh();

    final result = await runtime.refresh();

    expect(
      result,
      isA<MosaicCustomerEntitlementUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.authority.policy_unavailable',
      ),
    );
    expect(runtime.snapshot, isNull);
    final namespace = mosaicCustomerEntitlementCacheNamespace(
      Uri.parse('https://api.mosaic.test'),
      'public_key',
      '',
      fixtureAuthorityApplicationId,
      'ios',
    );
    expect((await cache.read(namespace))!.isInvalidationTombstone, isTrue);
    runtime.dispose();
  });

  test('unrelated malformed policy-like response preserves accepted cache',
      () async {
    final cache = MosaicMemoryCustomerEntitlementCache();
    final malformed = jsonDecode(File(
      '${authorityRoot.path}/invalid/policy-unavailable-with-minimum-support.json',
    ).readAsStringSync()) as Map<String, Object?>;
    malformed['unexpected'] = true;
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(source: jsonEncode(malformed)),
    ]);
    final runtime = runtimeWith(transport, cache: cache);
    await runtime.refresh();

    final rejected = await runtime.refresh();

    expect(rejected, isA<MosaicCustomerEntitlementRejected>());
    expect(runtime.snapshot?.snapshotVersion, 4);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    final namespace = mosaicCustomerEntitlementCacheNamespace(
      Uri.parse('https://api.mosaic.test'),
      'public_key',
      '',
      fixtureAuthorityApplicationId,
      'ios',
    );
    expect((await cache.read(namespace))!.isInvalidationTombstone, isFalse);
    runtime.dispose();
  });

  for (final staleBinding in <String>['digest', 'epoch', 'scope', 'customer']) {
    test('a stale $staleBinding cache binding never contributes a digest',
        () async {
      final cache = MosaicMemoryCustomerEntitlementCache();
      final seedRuntime = runtimeWith(
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
          received('snapshots/active-subscription.json'),
        ]),
        cache: cache,
      );
      await seedRuntime.refresh();
      seedRuntime.dispose();
      final namespace = mosaicCustomerEntitlementCacheNamespace(
        Uri.parse('https://api.mosaic.test'),
        'public_key',
        '',
        fixtureAuthorityApplicationId,
        'ios',
      );
      final accepted = (await cache.read(namespace))!;
      final stale = switch (staleBinding) {
        'digest' => replaceCachedBinding(
            accepted,
            snapshotAuthorityDigest:
                'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          ),
        'epoch' => replaceCachedBinding(
            accepted,
            authority: MosaicCustomerAuthority(
              epoch: accepted.authority.epoch + 1,
              kind: accepted.authority.kind,
              scope: accepted.authority.scope,
              transitionState: accepted.authority.transitionState,
              cutoverAt: accepted.authority.cutoverAt,
            ),
          ),
        'scope' => replaceCachedBinding(
            accepted,
            authority: MosaicCustomerAuthority(
              epoch: accepted.authority.epoch,
              kind: accepted.authority.kind,
              scope: MosaicCustomerAuthorityScope(
                projectId: accepted.authority.scope.projectId,
                environmentId: accepted.authority.scope.environmentId,
                applicationId: 'another-application',
                platform: accepted.authority.scope.platform,
              ),
              transitionState: accepted.authority.transitionState,
              cutoverAt: accepted.authority.cutoverAt,
            ),
          ),
        'customer' => replaceCachedBinding(
            accepted,
            binding: MosaicCustomerBinding(
              billingCustomerId: 'another-customer',
              projectId: accepted.binding.projectId,
              environmentId: accepted.binding.environmentId,
            ),
          ),
        _ => throw StateError('unknown test case'),
      };
      await cache.write(namespace, stale);
      final transport =
          _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
        received('snapshots/active-subscription.json'),
      ]);
      final runtime = runtimeWith(transport, cache: cache);

      await runtime.refresh();

      expect(transport.requests, hasLength(1));
      expect(transport.requests.single.knownAuthorityEpoch, isNull);
      expect(transport.requests.single.knownSnapshotVersion, isNull);
      expect(
        transport.requests.single.knownSnapshotAuthorityDigest,
        isNull,
      );
      runtime.dispose();
    });
  }

  test('a bodyless 304 preserves the cache without sliding it', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      const MosaicCustomerEntitlementSyncNotModified(),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();

    now = DateTime.utc(2026, 8, 4, 12, 20);
    final unchanged = await runtime.refresh();

    expect(unchanged, isA<MosaicCustomerEntitlementUnchanged>());
    // Nothing in a bodyless response is a contract-pinned carrier of refreshed
    // windows. Inferring one from an unpinned header would let anything on the
    // network path extend offline access, so the window does not move.
    expect(runtime.cacheState, MosaicEntitlementCacheState.expired);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unknown,
    );
    runtime.dispose();
  });

  test('an unchanged record for another customer confirms nothing', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerUnchangedV2(
          fixture('snapshots/snapshot-unchanged.json').replaceFirst(
            'fixture-customer-0001',
            'fixture-customer-0002',
          ),
          fixture('snapshots/active-subscription.json'),
        ),
      ),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();

    final result = await runtime.refresh();

    expect(
      result,
      isA<MosaicCustomerEntitlementRejected>().having(
        (value) => value.cacheAction,
        'cacheAction',
        MosaicCustomerCacheAction.clear,
      ),
    );
    expect(runtime.snapshot, isNull);
    runtime.dispose();
  });

  test('the sync body never carries a customer identifier', () {
    // The Customer Access Token is the sole customer selector. A hint could
    // only narrow the answer or fail the request, so it is not sent at all.
    final encoded = mosaicEncodeEntitlementSyncRequest(
      MosaicCustomerEntitlementSyncRequest(
        baseUrl: Uri.parse('https://api.mosaic.test'),
        publicSdkKey: 'public_key',
        customerToken: 'mcat_secret',
        timeout: const Duration(seconds: 5),
        correlationId: 'fixture-correlation-0001',
        applicationId: fixtureAuthorityApplicationId,
        platform: 'ios',
        applicationVersion: '4.2.0',
      ),
    );
    final payload = encoded['payload']! as Map<String, Object?>;
    expect(payload.containsKey('billingCustomerId'), isFalse);
    final request = payload['request']! as Map<String, Object?>;
    expect(request.containsKey('billingCustomerId'), isFalse);
    expect(request.containsKey('customerId'), isFalse);
  });

  test('an absent entitlement key reads unknown, never inactive', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();

    final check = runtime.checkCustomerEntitlement('enterprise');

    // Absence is not a statement. Mosaic never said this key is inactive, and
    // most often the response was simply narrowed to other keys.
    expect(check.state, MosaicCustomerAccessState.unknown);
    expect(check.reasonCode, 'entitlements.entry.absent');
    expect(check.sourceCount, 0);
    // Cross-platform spelling of the cache-state vocabulary.
    expect(
      MosaicEntitlementCacheState.values.map((value) => value.name),
      containsAll(<String>[
        'fresh',
        'refreshRecommended',
        'staleWithinGrace',
        'expired',
        'missing',
        'invalid',
        'differentCustomer',
      ]),
    );
    runtime.dispose();
  });

  test('concurrent refreshes coalesce onto one request', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ])
          ..gate = Completer<void>();
    final runtime = runtimeWith(transport);

    final first = runtime.refresh();
    final second = runtime.refresh();
    transport.gate!.complete();
    await Future.wait(<Future<Object?>>[first, second]);

    expect(transport.requests, hasLength(1));
    runtime.dispose();
  });

  test('an expired cache reports unknown, never inactive', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();

    // Past validUntil plus the default grace window in the fixture (absent,
    // therefore zero: the strict policy expressed through the same fields).
    now = DateTime.utc(2026, 8, 6, 12);
    final check = runtime.checkCustomerEntitlement('pro');

    expect(runtime.cacheState, MosaicEntitlementCacheState.expired);
    expect(check.state, MosaicCustomerAccessState.unknown);
    expect(check.state, isNot(MosaicCustomerAccessState.inactive));
    expect(check.reasonCode, isNotNull);
    runtime.dispose();
  });

  test('a backwards device clock expires the cache instead of freezing it',
      () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();
    expect(runtime.cacheState, MosaicEntitlementCacheState.fresh);

    // Moving the clock back is the cheapest attack on an offline cache. The
    // age becomes unmeasurable, so the cache is treated as expired.
    now = DateTime.utc(2026, 7, 27, 12);
    expect(runtime.cacheState, MosaicEntitlementCacheState.expired);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unknown,
    );
    runtime.dispose();
  });

  test('a 401 forces exactly one token refresh and one retry', () async {
    var mints = 0;
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      const MosaicCustomerEntitlementSyncUnauthorized(),
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(
      transport,
      tokenProvider: (_) async {
        mints += 1;
        return token('token-$mints');
      },
    );

    final result = await runtime.refresh();

    expect(result, isA<MosaicCustomerEntitlementUpdated>());
    expect(mints, 2);
    expect(transport.requests, hasLength(2));
    runtime.dispose();
  });

  test('a signed-out customer is unavailable with no cache', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[]);
    final runtime = runtimeWith(transport, tokenProvider: (_) async => null);

    final result = await runtime.refresh();

    expect(result, isA<MosaicCustomerEntitlementUnavailable>());
    expect(transport.requests, isEmpty);
    final check = runtime.checkCustomerEntitlement('pro');
    expect(check.state, MosaicCustomerAccessState.unavailable);
    runtime.dispose();
  });

  test('a network failure preserves the cache and never claims inactive',
      () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      const MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: 'entitlements.sync.networkFailed',
      ),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();

    final result = await runtime.refresh();

    expect(result, isA<MosaicCustomerEntitlementUnavailable>());
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    runtime.dispose();
  });

  test('an identity change clears state before any read can observe it',
      () async {
    final cache = MosaicMemoryCustomerEntitlementCache();
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(transport, cache: cache);
    await runtime.bindIdentity(
      MosaicIdentityState(
        installationId: 'installation_a',
        generation: 1,
        userId: 'user-a',
      ),
    );
    await runtime.refresh();
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.active,
    );
    final updates = <MosaicCustomerEntitlementUpdate>[];
    runtime.updates.listen(updates.add);

    await runtime.bindIdentity(
      MosaicIdentityState(
        installationId: 'installation_a',
        generation: 2,
        userId: 'user-b',
      ),
    );

    // The leak this prevents: the second user reading the first user's
    // entitlements because a cached snapshot outlived the sign-in.
    expect(runtime.snapshot, isNull);
    final check = runtime.checkCustomerEntitlement('pro');
    expect(check.state, isNot(MosaicCustomerAccessState.active));
    expect(check.state, isNot(MosaicCustomerAccessState.inactive));
    await pumpEventQueue();
    expect(updates.whereType<MosaicCustomerEntitlementCleared>(), isNotEmpty);
    runtime.dispose();
  });

  test('signing out discards the token and the cached snapshot', () async {
    final cache = MosaicMemoryCustomerEntitlementCache();
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
    ]);
    final runtime = runtimeWith(transport, cache: cache);
    await runtime.bindIdentity(
      MosaicIdentityState(
        installationId: 'installation_a',
        generation: 1,
        userId: 'user-a',
      ),
    );
    await runtime.refresh();

    await runtime.clearCustomer();

    expect(runtime.snapshot, isNull);
    expect(runtime.diagnostics.token.hasToken, isFalse);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unavailable,
    );
    runtime.dispose();
  });

  test('a snapshot bound to another customer clears the cache loudly',
      () async {
    final severeCodes = <String>[];
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      received('snapshots/test-source-sandbox-grant.json'),
    ]);
    final runtime = runtimeWith(
      transport,
      onDiagnostic: (code, {required bool severe}) {
        if (severe) severeCodes.add(code);
      },
    );
    await runtime.refresh();
    final updates = <MosaicCustomerEntitlementUpdate>[];
    runtime.updates.listen(updates.add);

    final rejected = await runtime.refresh();

    expect(
      rejected,
      isA<MosaicCustomerEntitlementRejected>()
          .having(
              (value) => value.reasonCode, 'reasonCode', 'customer_mismatch')
          .having(
            (value) => value.cacheAction,
            'cacheAction',
            MosaicCustomerCacheAction.clear,
          ),
    );
    // The one rejection that clears. Preserving here would keep serving the
    // previous customer's access under a new identity.
    expect(runtime.snapshot, isNull);
    expect(
      runtime.checkCustomerEntitlement('pro').state,
      MosaicCustomerAccessState.unavailable,
    );
    await pumpEventQueue();
    expect(updates.whereType<MosaicCustomerEntitlementCleared>(), isNotEmpty);
    expect(severeCodes, isNotEmpty);
    runtime.dispose();
  });

  test('a rejected document leaves the accepted snapshot in place', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncReceived(
        source: wrapCustomerSnapshotV2(
          fixture('invalid/snapshot-entry-unknown-field.json'),
        ),
      ),
    ]);
    final runtime = runtimeWith(transport);
    await runtime.refresh();

    final rejected = await runtime.refresh();

    expect(
      rejected,
      isA<MosaicCustomerEntitlementRejected>().having(
        (value) => value.cacheAction,
        'cacheAction',
        MosaicCustomerCacheAction.preserve,
      ),
    );
    expect(runtime.snapshot!.snapshotVersion, 4);
    runtime.dispose();
  });
}
