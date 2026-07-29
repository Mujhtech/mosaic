import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
import 'package:mosaic_sdk/src/customer_authentication.dart';
import 'package:mosaic_sdk/src/customer_entitlement_runtime.dart';

import 'support/canonical_fixture.dart';

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

void main() {
  final root = repositoryDirectory(
    'protocol/fixtures/authoritative-entitlement/v1',
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
        source: fixture(path),
        freshness: const MosaicCustomerEntitlementFreshnessHeaders(),
      );

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
        settings: const MosaicCustomerEntitlementSettings(
          refreshOnResume: false,
        ),
        clock: clock,
        onDiagnostic: onDiagnostic,
      );

  test('the sync request matches the canonical conditional fixture shape', () {
    final canonical = jsonDecode(fixture('sync/sync-request-conditional.json'))
        as Map<String, Object?>;
    final encoded = mosaicEncodeEntitlementSyncRequest(
      MosaicCustomerEntitlementSyncRequest(
        baseUrl: Uri.parse('https://api.mosaic.test'),
        publicSdkKey: 'public_key',
        customerToken: 'mcat_secret',
        timeout: const Duration(seconds: 5),
        correlationId: 'fixture-correlation-0001',
        knownSnapshotVersion: 4,
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
    expect(
        payload['supportedAuthoritativeEntitlementContracts'], <String>['1']);
    expect(payload['knownSnapshotVersion'], 4);
    expect(payload['entityTag'], 'cs-0001-v4');
    // No credential ever appears in the record.
    expect(jsonEncode(encoded), isNot(contains('mcat_')));
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
    expect(updates, hasLength(1));
    runtime.dispose();
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

  test('a 304 slides freshness without re-accepting anything', () async {
    final transport =
        _RecordingTransport(<MosaicCustomerEntitlementSyncResponse>[
      received('snapshots/active-subscription.json'),
      MosaicCustomerEntitlementSyncNotModified(
        freshness: MosaicCustomerEntitlementFreshnessHeaders(
          refreshAfter: DateTime.utc(2026, 8, 3, 12),
          validUntil: DateTime.utc(2026, 8, 10, 12),
          staleGraceSeconds: 86400,
        ),
      ),
    ]);
    final runtime = runtimeWith(transport);

    await runtime.refresh();
    // Past the snapshot's own validUntil: without the slide, a device that is
    // demonstrably in contact with the server would expire.
    now = DateTime.utc(2026, 8, 5, 12);
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
    expect(transport.requests.last.entityTag, 'cs-0001-v4');
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
      MosaicCustomerAccessState.unknown,
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
        source: fixture('invalid/snapshot-entry-unknown-field.json'),
        freshness: const MosaicCustomerEntitlementFreshnessHeaders(),
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
