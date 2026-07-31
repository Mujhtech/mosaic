import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'customer_entitlements.dart';
import 'sha256.dart';

/// Safe diagnostic code reported when entitlement persistence is unavailable
/// and the SDK degrades to an in-memory cache for the session.
const String mosaicCustomerEntitlementCacheUnavailableCode =
    'entitlements.cache_unavailable';

const int _cacheFormatVersion = 2;

/// One accepted snapshot, with everything needed to decide freshness and
/// monotonicity without re-reading the document.
final class MosaicCustomerEntitlementCacheRecord {
  MosaicCustomerEntitlementCacheRecord({
    required this.source,
    required this.binding,
    required this.authority,
    required this.snapshotAuthorityDigest,
    required this.snapshotVersion,
    required DateTime asOf,
    required this.entityTag,
    required DateTime issuedAt,
    required DateTime refreshAfter,
    required DateTime validUntil,
    this.staleGraceSeconds = 0,
    DateTime? trustedServerTime,
    DateTime? localReceiptTime,
    this.isInvalidationTombstone = false,
  })  : asOf = asOf.toUtc(),
        issuedAt = issuedAt.toUtc(),
        refreshAfter = refreshAfter.toUtc(),
        validUntil = validUntil.toUtc(),
        trustedServerTime = trustedServerTime?.toUtc(),
        localReceiptTime = localReceiptTime?.toUtc();

  /// The exact accepted document. Keeping the bytes rather than the decoded
  /// model means a cache round trip cannot quietly re-shape a snapshot, and
  /// the digest still verifies after a restart.
  final String source;
  final MosaicCustomerBinding binding;
  final MosaicCustomerAuthority authority;
  final String snapshotAuthorityDigest;
  final int snapshotVersion;
  final DateTime asOf;
  final String entityTag;
  final DateTime issuedAt;

  /// Freshness bounds. A `snapshotUnchanged` response slides these without
  /// touching the snapshot itself.
  final DateTime refreshAfter;
  final DateTime validUntil;
  final int staleGraceSeconds;

  /// Server `Date` at receipt, paired with the device clock at the same
  /// instant. Together they let the runtime notice a device clock that moved
  /// after the snapshot was stored.
  final DateTime? trustedServerTime;
  final DateTime? localReceiptTime;

  /// Durable fail-closed marker. It contains no replayable snapshot and is
  /// atomically replaced by a later accepted full snapshot.
  final bool isInvalidationTombstone;

  factory MosaicCustomerEntitlementCacheRecord.invalidationTombstone() =>
      MosaicCustomerEntitlementCacheRecord(
        source: '',
        binding: const MosaicCustomerBinding(
          billingCustomerId: 'invalidated',
          projectId: 'invalidated',
          environmentId: 'invalidated',
        ),
        authority: const MosaicCustomerAuthority(
          epoch: 0,
          kind: MosaicCustomerAuthorityKind.source,
          scope: MosaicCustomerAuthorityScope(
            projectId: 'invalidated',
            environmentId: 'invalidated',
            applicationId: 'invalidated',
            platform: MosaicCustomerAuthorityPlatform.ios,
          ),
          transitionState: MosaicCustomerAuthorityTransitionState.stable,
        ),
        snapshotAuthorityDigest:
            'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        snapshotVersion: 0,
        asOf: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        entityTag: 'invalidated',
        issuedAt: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        refreshAfter: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        validUntil: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        isInvalidationTombstone: true,
      );

  MosaicCustomerEntitlementCacheRecord slideFreshness({
    required DateTime refreshAfter,
    required DateTime validUntil,
    required int staleGraceSeconds,
    DateTime? trustedServerTime,
    DateTime? localReceiptTime,
  }) =>
      MosaicCustomerEntitlementCacheRecord(
        source: source,
        binding: binding,
        authority: authority,
        snapshotAuthorityDigest: snapshotAuthorityDigest,
        snapshotVersion: snapshotVersion,
        asOf: asOf,
        entityTag: entityTag,
        issuedAt: issuedAt,
        refreshAfter: refreshAfter,
        validUntil: validUntil,
        staleGraceSeconds: staleGraceSeconds,
        trustedServerTime: trustedServerTime ?? this.trustedServerTime,
        localReceiptTime: localReceiptTime ?? this.localReceiptTime,
        isInvalidationTombstone: isInvalidationTombstone,
      );

  MosaicCustomerCachedSnapshotSummary get summary =>
      MosaicCustomerCachedSnapshotSummary(
        binding: binding,
        snapshotVersion: snapshotVersion,
        asOf: asOf,
      );
}

abstract interface class MosaicCustomerEntitlementCache {
  Future<MosaicCustomerEntitlementCacheRecord?> read(String namespace);

  Future<void> write(
    String namespace,
    MosaicCustomerEntitlementCacheRecord record,
  );

  Future<void> clear(String namespace);

  /// Deletes every stored record that is not [namespace].
  ///
  /// Called on every identity change, so the previous customer's snapshot does
  /// not sit on disk waiting for a sign-in that happens to reuse its key.
  Future<void> removeOtherRecords(String namespace);
}

/// In-memory cache. It is the test double and the degraded mode a device falls
/// back to when no application cache directory is available.
final class MosaicMemoryCustomerEntitlementCache
    implements MosaicCustomerEntitlementCache {
  final Map<String, MosaicCustomerEntitlementCacheRecord> _records =
      <String, MosaicCustomerEntitlementCacheRecord>{};

  @override
  Future<MosaicCustomerEntitlementCacheRecord?> read(String namespace) async =>
      _records[namespace];

  @override
  Future<void> write(
    String namespace,
    MosaicCustomerEntitlementCacheRecord record,
  ) async {
    _records[namespace] = record;
  }

  @override
  Future<void> clear(String namespace) async => _records.remove(namespace);

  @override
  Future<void> removeOtherRecords(String namespace) async =>
      _records.removeWhere((key, _) => key != namespace);
}

typedef MosaicCustomerEntitlementCacheDirectoryProvider = Future<Directory>
    Function();

Future<Directory> _applicationCacheDirectory() =>
    getApplicationCacheDirectory();

/// Application-private file cache under the platform cache directory.
///
/// The cache directory, never the support directory: an entitlement snapshot
/// is derived state that must not travel in a device backup to another device
/// or another user, and on both platforms the cache directory is the location
/// with that property. When it is unavailable the store degrades to memory for
/// the session and reports [mosaicCustomerEntitlementCacheUnavailableCode]; it
/// never silently falls back to a backed-up location.
final class MosaicFileCustomerEntitlementCache
    implements MosaicCustomerEntitlementCache {
  MosaicFileCustomerEntitlementCache({
    MosaicCustomerEntitlementCacheDirectoryProvider directoryProvider =
        _applicationCacheDirectory,
    void Function(String diagnosticCode)? onDiagnostic,
  })  : _directoryProvider = directoryProvider,
        _onDiagnostic = onDiagnostic;

  final MosaicCustomerEntitlementCacheDirectoryProvider _directoryProvider;
  final void Function(String diagnosticCode)? _onDiagnostic;
  MosaicMemoryCustomerEntitlementCache? _degraded;

  bool get isDegraded => _degraded != null;

  @override
  Future<MosaicCustomerEntitlementCacheRecord?> read(String namespace) async {
    final degraded = _degraded;
    if (degraded != null) return degraded.read(namespace);
    final File file;
    try {
      file = await _file(namespace);
    } on ArgumentError {
      rethrow;
    } on Object {
      return _degrade().read(namespace);
    }
    if (!await file.exists()) return null;
    if ((await file.stat()).size >
        mosaicCustomerEntitlementMaximumRecordBytes + 8192) {
      throw const MosaicCustomerEntitlementFormatException(
        'cache_record_too_large',
      );
    }
    return decodeCustomerEntitlementCacheRecord(await file.readAsString());
  }

  @override
  Future<void> write(
    String namespace,
    MosaicCustomerEntitlementCacheRecord record,
  ) async {
    final degraded = _degraded;
    if (degraded != null) return degraded.write(namespace, record);
    final File target;
    try {
      target = await _file(namespace);
    } on ArgumentError {
      rethrow;
    } on Object {
      return _degrade().write(namespace, record);
    }
    await target.parent.create(recursive: true);
    // Write, flush, rename in the same directory: a crash between the two
    // steps leaves either the previous record or the new one, never a
    // half-written document that would read as corruption on next launch.
    final temporary = File(
      '${target.path}.tmp-${DateTime.now().microsecondsSinceEpoch}',
    );
    try {
      await temporary.writeAsString(
        encodeCustomerEntitlementCacheRecord(record),
        flush: true,
      );
      await temporary.rename(target.path);
    } on Object {
      if (await temporary.exists()) await temporary.delete();
      rethrow;
    }
  }

  @override
  Future<void> clear(String namespace) async {
    final degraded = _degraded;
    if (degraded != null) return degraded.clear(namespace);
    try {
      final file = await _file(namespace);
      if (await file.exists()) await file.delete();
    } on ArgumentError {
      rethrow;
    } on Object {
      // A cache that cannot be deleted must not crash a sign-out. The record
      // is unreadable to the next identity anyway: its namespace differs.
      _degrade();
    }
  }

  @override
  Future<void> removeOtherRecords(String namespace) async {
    final degraded = _degraded;
    if (degraded != null) return degraded.removeOtherRecords(namespace);
    try {
      final keep = await _file(namespace);
      final directory = keep.parent;
      if (!await directory.exists()) return;
      await for (final entity in directory.list()) {
        final name = entity.uri.pathSegments.last;
        if (entity is File &&
            name.startsWith('entitlements-') &&
            entity.path != keep.path) {
          await entity.delete();
        }
      }
    } on ArgumentError {
      rethrow;
    } on Object {
      _degrade();
    }
  }

  MosaicMemoryCustomerEntitlementCache _degrade() {
    final degraded = _degraded ??= MosaicMemoryCustomerEntitlementCache();
    _onDiagnostic?.call(mosaicCustomerEntitlementCacheUnavailableCode);
    return degraded;
  }

  Future<File> _file(String namespace) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(namespace)) {
      throw ArgumentError.value(namespace, 'namespace', 'Invalid cache key.');
    }
    final root = await _directoryProvider();
    return File('${root.path}/mosaic/entitlements-$namespace.json');
  }
}

/// Cache key for one customer's authoritative snapshot.
///
/// [customerBinding] is the host's own user identity, which is what the SDK
/// knows before any snapshot exists. Putting it in the path — rather than
/// inside one shared document — is what makes a wrong-customer read a missing
/// file instead of a filtering mistake.
String mosaicCustomerEntitlementCacheNamespace(
        Uri baseUrl, String publicSdkKey, String customerBinding,
        [String? applicationId, String? platform]) =>
    mosaicSha256String(
      '${_normalizedBaseUrl(baseUrl)}\n$publicSdkKey\n$customerBinding\n'
      '${applicationId ?? 'authority-unknown'}\n'
      '${platform ?? 'authority-unknown'}\nentitlements-v2',
    );

/// Namespace used by Phase 9B. It is read only for removal; its records do not
/// carry authority and can never be relabelled as a v2 cache entry.
String mosaicLegacyCustomerEntitlementCacheNamespace(
  Uri baseUrl,
  String publicSdkKey,
  String customerBinding,
) =>
    mosaicSha256String(
      '${_normalizedBaseUrl(baseUrl)}\n$publicSdkKey\n$customerBinding\n'
      'entitlements-v1',
    );

String _normalizedBaseUrl(Uri value) {
  final path = value.path.endsWith('/')
      ? value.path.substring(0, value.path.length - 1)
      : value.path;
  return value.replace(path: path, query: null, fragment: null).toString();
}

String encodeCustomerEntitlementCacheRecord(
  MosaicCustomerEntitlementCacheRecord record,
) {
  if (record.isInvalidationTombstone) {
    final body = <String, Object?>{
      'cacheFormatVersion': _cacheFormatVersion,
      'invalidated': true,
    };
    return jsonEncode(<String, Object?>{
      ...body,
      'checksum': _checksum(body),
    });
  }
  final body = <String, Object?>{
    'cacheFormatVersion': _cacheFormatVersion,
    'snapshot': record.source,
    'billingCustomerId': record.binding.billingCustomerId,
    'projectId': record.binding.projectId,
    'environmentId': record.binding.environmentId,
    'applicationId': record.authority.scope.applicationId,
    'platform': record.authority.scope.platform.wireValue,
    'authorityEpoch': record.authority.epoch,
    'authorityKind': record.authority.kind.wireValue,
    'transitionState': record.authority.transitionState.wireValue,
    if (record.authority.cutoverAt != null)
      'cutoverAt': record.authority.cutoverAt!.toIso8601String(),
    'snapshotAuthorityDigest': record.snapshotAuthorityDigest,
    'snapshotVersion': record.snapshotVersion,
    'asOf': record.asOf.toIso8601String(),
    'entityTag': record.entityTag,
    'issuedAt': record.issuedAt.toIso8601String(),
    'refreshAfter': record.refreshAfter.toIso8601String(),
    'validUntil': record.validUntil.toIso8601String(),
    'staleGraceSeconds': record.staleGraceSeconds,
    if (record.trustedServerTime != null)
      'trustedServerTime': record.trustedServerTime!.toIso8601String(),
    if (record.localReceiptTime != null)
      'localReceiptTime': record.localReceiptTime!.toIso8601String(),
  };
  return jsonEncode(<String, Object?>{
    ...body,
    // Integrity, documented as corruption detection rather than security: a
    // process that can write this file can also recompute this digest.
    'checksum': _checksum(body),
  });
}

MosaicCustomerEntitlementCacheRecord decodeCustomerEntitlementCacheRecord(
  String source,
) {
  final Object? decoded;
  try {
    decoded = jsonDecode(source);
  } on FormatException {
    throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
  }
  if (decoded is! Map) {
    throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
  }
  final object = decoded.cast<String, Object?>();
  if (object['cacheFormatVersion'] != _cacheFormatVersion) {
    throw const MosaicCustomerEntitlementFormatException(
      'cache_format_unsupported',
    );
  }
  if (object['invalidated'] == true) {
    if (object.keys.toSet().difference(_tombstoneKeys).isNotEmpty ||
        !_tombstoneKeys.every(object.containsKey)) {
      throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
    }
    final body = Map<String, Object?>.of(object)..remove('checksum');
    if (object['checksum'] != _checksum(body)) {
      throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
    }
    return MosaicCustomerEntitlementCacheRecord.invalidationTombstone();
  }
  final keys = object.keys.toSet();
  if (!keys.containsAll(_requiredKeys) ||
      keys.difference(_allowedKeys).isNotEmpty) {
    // Strict closed-key reading, exactly as on the wire. A record with a
    // member this version does not define was written by something else.
    throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
  }
  final body = Map<String, Object?>.of(object)..remove('checksum');
  if (object['checksum'] != _checksum(body)) {
    throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
  }
  try {
    return MosaicCustomerEntitlementCacheRecord(
      source: object['snapshot']! as String,
      binding: MosaicCustomerBinding(
        billingCustomerId: object['billingCustomerId']! as String,
        projectId: object['projectId']! as String,
        environmentId: object['environmentId']! as String,
      ),
      authority: MosaicCustomerAuthority(
        epoch: object['authorityEpoch']! as int,
        kind: MosaicCustomerAuthorityKind.values.firstWhere(
          (item) => item.wireValue == object['authorityKind'],
        ),
        scope: MosaicCustomerAuthorityScope(
          projectId: object['projectId']! as String,
          environmentId: object['environmentId']! as String,
          applicationId: object['applicationId']! as String,
          platform: MosaicCustomerAuthorityPlatform.values.firstWhere(
            (item) => item.wireValue == object['platform'],
          ),
        ),
        transitionState:
            MosaicCustomerAuthorityTransitionState.values.firstWhere(
          (item) => item.wireValue == object['transitionState'],
        ),
        cutoverAt: object['cutoverAt'] == null
            ? null
            : DateTime.parse(object['cutoverAt']! as String),
      ),
      snapshotAuthorityDigest: object['snapshotAuthorityDigest']! as String,
      snapshotVersion: object['snapshotVersion']! as int,
      asOf: DateTime.parse(object['asOf']! as String),
      entityTag: object['entityTag']! as String,
      issuedAt: DateTime.parse(object['issuedAt']! as String),
      refreshAfter: DateTime.parse(object['refreshAfter']! as String),
      validUntil: DateTime.parse(object['validUntil']! as String),
      staleGraceSeconds: object['staleGraceSeconds']! as int,
      trustedServerTime: object['trustedServerTime'] == null
          ? null
          : DateTime.parse(object['trustedServerTime']! as String),
      localReceiptTime: object['localReceiptTime'] == null
          ? null
          : DateTime.parse(object['localReceiptTime']! as String),
    );
  } on Object {
    throw const MosaicCustomerEntitlementFormatException('cache_corrupt');
  }
}

String _checksum(Map<String, Object?> body) => 'sha256:'
    '${mosaicSha256Hex(utf8.encode(mosaicCustomerCanonicalJson(body)))}';

const Set<String> _requiredKeys = <String>{
  'cacheFormatVersion',
  'snapshot',
  'billingCustomerId',
  'projectId',
  'environmentId',
  'applicationId',
  'platform',
  'authorityEpoch',
  'authorityKind',
  'transitionState',
  'snapshotAuthorityDigest',
  'snapshotVersion',
  'asOf',
  'entityTag',
  'issuedAt',
  'refreshAfter',
  'validUntil',
  'staleGraceSeconds',
  'checksum',
};

const Set<String> _allowedKeys = <String>{
  ..._requiredKeys,
  'trustedServerTime',
  'localReceiptTime',
  'cutoverAt',
};

const Set<String> _tombstoneKeys = <String>{
  'cacheFormatVersion',
  'invalidated',
  'checksum',
};
