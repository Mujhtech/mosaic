import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('mosaic-entitlement-cache');
  });

  tearDown(() async {
    if (root.existsSync()) await root.delete(recursive: true);
  });

  MosaicFileCustomerEntitlementCache cacheIn(
    Directory directory, {
    void Function(String code)? onDiagnostic,
  }) =>
      MosaicFileCustomerEntitlementCache(
        directoryProvider: () async => directory,
        onDiagnostic: onDiagnostic,
      );

  MosaicCustomerEntitlementCacheRecord record({
    String customerId = 'customer-a',
    int version = 4,
  }) =>
      MosaicCustomerEntitlementCacheRecord(
        source: '{"recordType":"customerEntitlementSnapshot"}',
        binding: MosaicCustomerBinding(
          billingCustomerId: customerId,
          projectId: 'project-mosaic',
          environmentId: 'environment-production',
        ),
        authority: MosaicCustomerAuthority(
          epoch: 5,
          kind: MosaicCustomerAuthorityKind.mosaic,
          scope: const MosaicCustomerAuthorityScope(
            projectId: 'project-mosaic',
            environmentId: 'environment-production',
            applicationId: 'application-ios',
            platform: MosaicCustomerAuthorityPlatform.ios,
          ),
          transitionState: MosaicCustomerAuthorityTransitionState.stabilizing,
          cutoverAt: DateTime.utc(2026, 7, 28, 12, 30),
        ),
        snapshotAuthorityDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        snapshotVersion: version,
        asOf: DateTime.utc(2026, 7, 28, 11, 59, 58),
        entityTag: 'cs-0001-v$version',
        issuedAt: DateTime.utc(2026, 7, 28, 12),
        refreshAfter: DateTime.utc(2026, 7, 28, 13),
        validUntil: DateTime.utc(2026, 8, 4, 12),
        staleGraceSeconds: 86400,
        trustedServerTime: DateTime.utc(2026, 7, 28, 12),
        localReceiptTime: DateTime.utc(2026, 7, 28, 11, 59, 30),
      );

  final namespaceA = mosaicCustomerEntitlementCacheNamespace(
    Uri.parse('https://api.mosaic.test'),
    'public_key',
    'user-a',
  );
  final namespaceB = mosaicCustomerEntitlementCacheNamespace(
    Uri.parse('https://api.mosaic.test'),
    'public_key',
    'user-b',
  );

  test('a namespace is per customer, not per environment alone', () {
    // Two signed-in users on one install must never resolve to one file. If
    // they did, the wrong-customer case would be a filtering bug rather than a
    // missing file, and filtering bugs leak.
    expect(namespaceA, isNot(namespaceB));
    expect(
      mosaicCustomerEntitlementCacheNamespace(
        Uri.parse('https://api.mosaic.test/'),
        'public_key',
        'user-a',
      ),
      namespaceA,
      reason: 'A trailing slash is not a different Environment.',
    );
  });

  test('a written record round-trips through its checksum', () async {
    final cache = cacheIn(root);
    await cache.write(namespaceA, record());
    final read = await cache.read(namespaceA);

    expect(read, isNotNull);
    expect(read!.binding.billingCustomerId, 'customer-a');
    expect(read.snapshotVersion, 4);
    expect(
      read.snapshotAuthorityDigest,
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(read.staleGraceSeconds, 86400);
    expect(read.trustedServerTime, DateTime.utc(2026, 7, 28, 12));
    expect(read.localReceiptTime, DateTime.utc(2026, 7, 28, 11, 59, 30));
  });

  test('an invalidation tombstone round-trips without replayable snapshot',
      () async {
    final cache = cacheIn(root);

    await cache.write(
      namespaceA,
      MosaicCustomerEntitlementCacheRecord.invalidationTombstone(),
    );
    final read = await cache.read(namespaceA);

    expect(read, isNotNull);
    expect(read!.isInvalidationTombstone, isTrue);
    final source = File('${root.path}/mosaic/entitlements-$namespaceA.json')
        .readAsStringSync();
    expect(source, contains('"invalidated":true'));
    expect(source, isNot(contains('customer-a')));
    expect(source, isNot(contains('customerEntitlementSnapshot')));
  });

  test('a tampered record is rejected rather than half-trusted', () async {
    final cache = cacheIn(root);
    await cache.write(namespaceA, record());
    final file = File('${root.path}/mosaic/entitlements-$namespaceA.json');
    // Flip the version without recomputing the digest. Accepting this would
    // let anything that can touch the file grant a newer snapshot's authority
    // to older content.
    await file.writeAsString(
      file.readAsStringSync().replaceFirst(
            '"snapshotVersion":4',
            '"snapshotVersion":9',
          ),
    );

    await expectLater(
      cache.read(namespaceA),
      throwsA(
        isA<MosaicCustomerEntitlementFormatException>().having(
          (error) => error.reasonCode,
          'reasonCode',
          'cache_corrupt',
        ),
      ),
    );
  });

  test('an unknown member is rejected, not ignored', () async {
    final cache = cacheIn(root);
    await cache.write(namespaceA, record());
    final file = File('${root.path}/mosaic/entitlements-$namespaceA.json');
    await file.writeAsString(
      file.readAsStringSync().replaceFirst('{', '{"grantOverride":true,'),
    );

    await expectLater(
      cache.read(namespaceA),
      throwsA(isA<MosaicCustomerEntitlementFormatException>()),
    );
  });

  test('a write leaves no temporary file behind', () async {
    final cache = cacheIn(root);
    await cache.write(namespaceA, record());
    final remaining = Directory('${root.path}/mosaic')
        .listSync()
        .map((entity) => entity.uri.pathSegments.last)
        .where((name) => name.contains('.tmp-'));

    expect(remaining, isEmpty);
  });

  test('an identity change deletes the previous customer record', () async {
    final cache = cacheIn(root);
    await cache.write(namespaceA, record());
    await cache.write(namespaceB, record(customerId: 'customer-b'));

    await cache.removeOtherRecords(namespaceB);

    // The leak this prevents: user A signs out, user B signs in, and A's
    // snapshot is still sitting on disk under a key a later sign-in reuses.
    expect(await cache.read(namespaceA), isNull);
    expect((await cache.read(namespaceB))!.binding.billingCustomerId,
        'customer-b');
  });

  test('an unavailable cache directory degrades to memory, never to backup',
      () async {
    final codes = <String>[];
    final cache = MosaicFileCustomerEntitlementCache(
      directoryProvider: () async =>
          throw const FileSystemException('no cache directory'),
      onDiagnostic: codes.add,
    );

    await cache.write(namespaceA, record());
    final read = await cache.read(namespaceA);

    expect(read, isNotNull);
    expect(cache.isDegraded, isTrue);
    expect(codes, contains(mosaicCustomerEntitlementCacheUnavailableCode));
    // Nothing reached any on-disk location. The support directory is a backed
    // up location on both platforms and is never used as a fallback.
    expect(root.listSync(), isEmpty);
  });

  test('clearing removes the record for this customer only', () async {
    final cache = cacheIn(root);
    await cache.write(namespaceA, record());
    await cache.write(namespaceB, record(customerId: 'customer-b'));

    await cache.clear(namespaceA);

    expect(await cache.read(namespaceA), isNull);
    expect(await cache.read(namespaceB), isNotNull);
  });

  test('sliding freshness keeps the accepted snapshot untouched', () {
    final slid = record().slideFreshness(
      refreshAfter: DateTime.utc(2026, 7, 29, 13),
      validUntil: DateTime.utc(2026, 8, 5, 12),
      staleGraceSeconds: 86400,
    );

    // A 304 confirms a snapshot; it never re-accepts one, so the version, the
    // bytes, and the as-of instant must all be identical.
    expect(slid.snapshotVersion, 4);
    expect(slid.source, record().source);
    expect(slid.asOf, record().asOf);
    expect(slid.validUntil, DateTime.utc(2026, 8, 5, 12));
  });
}
