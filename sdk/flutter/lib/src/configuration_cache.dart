import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'commerce_configuration.dart';
import 'configuration_delivery.dart';
import 'sha256.dart';

final class MosaicConfigurationCacheEntry {
  const MosaicConfigurationCacheEntry({
    required this.etag,
    required this.releaseSource,
    this.commerceConfigurationSource,
    this.commerceConfigurationEtag,
  });

  final String etag;
  final String releaseSource;

  /// Accepted sidecar bytes stored in the same crash-safe cache record.
  final String? commerceConfigurationSource;

  /// Exact strong ETag validated against the sidecar content digest.
  final String? commerceConfigurationEtag;
}

abstract interface class MosaicConfigurationCache {
  Future<MosaicConfigurationCacheEntry?> read(String namespace);

  Future<void> write(String namespace, MosaicConfigurationCacheEntry entry);
}

typedef MosaicConfigurationCacheDirectoryProvider = Future<Directory>
    Function();

Future<Directory> _applicationSupportDirectory() =>
    getApplicationSupportDirectory();

/// Application-private file cache using same-directory write/flush/rename.
final class MosaicFileConfigurationCache implements MosaicConfigurationCache {
  const MosaicFileConfigurationCache({
    MosaicConfigurationCacheDirectoryProvider directoryProvider =
        _applicationSupportDirectory,
  }) : _directoryProvider = directoryProvider;

  final MosaicConfigurationCacheDirectoryProvider _directoryProvider;

  @override
  Future<MosaicConfigurationCacheEntry?> read(String namespace) async {
    final file = await _file(namespace);
    if (!await file.exists()) return null;
    final stat = await file.stat();
    if (stat.size >
        mosaicMaximumConfigurationBytes +
            mosaicMaximumCommerceConfigurationBytes +
            8192) {
      throw const FormatException('Mosaic cache record exceeds its limit.');
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(await file.readAsString());
    } on Object {
      throw const FormatException('Mosaic cache record is invalid.');
    }
    if (decoded is! Map) {
      throw const FormatException('Mosaic cache record is invalid.');
    }
    final object = decoded.cast<String, Object?>();
    final version = object['cacheFormatVersion'];
    final keys = object.keys.toSet();
    final expectedKeys = switch (version) {
      1 => _cacheVersionOneKeys,
      2 => _cacheVersionTwoRequiredKeys,
      _ => _cacheVersionThreeRequiredKeys,
    };
    final allowedKeys =
        version == 3 ? _cacheVersionThreeKeys : _cacheVersionTwoKeys;
    if (version != 1 && version != 2 && version != 3 ||
        keys.difference(allowedKeys).isNotEmpty ||
        !keys.containsAll(expectedKeys) ||
        version == 1 && keys.length != _cacheVersionOneKeys.length ||
        object['etag'] is! String ||
        object['release'] is! String ||
        object.containsKey('commerceConfiguration') &&
            object['commerceConfiguration'] is! String ||
        object.containsKey('commerceConfigurationEtag') &&
            object['commerceConfigurationEtag'] is! String ||
        object.containsKey('commerceConfigurationEtag') &&
            !object.containsKey('commerceConfiguration') ||
        object['commerceConfigurationEtag'] is String &&
            !_isCommerceEtag(object['commerceConfigurationEtag']! as String) ||
        !_isStrongEtag(object['etag']! as String)) {
      throw const FormatException('Mosaic cache record is invalid.');
    }
    final commerceSource = object['commerceConfiguration'] as String?;
    if (commerceSource != null &&
        utf8.encode(commerceSource).length >
            mosaicMaximumCommerceConfigurationBytes) {
      throw const FormatException('Mosaic cache record is invalid.');
    }
    return MosaicConfigurationCacheEntry(
      etag: object['etag']! as String,
      releaseSource: object['release']! as String,
      commerceConfigurationSource: commerceSource,
      commerceConfigurationEtag: object['commerceConfigurationEtag'] as String?,
    );
  }

  @override
  Future<void> write(
    String namespace,
    MosaicConfigurationCacheEntry entry,
  ) async {
    if (!_isStrongEtag(entry.etag)) {
      throw const FormatException('Mosaic cache ETag must be strong.');
    }
    if (entry.commerceConfigurationEtag != null &&
        (entry.commerceConfigurationSource == null ||
            !_isCommerceEtag(entry.commerceConfigurationEtag!))) {
      throw const FormatException(
        'Mosaic Commerce Configuration ETag must be exact and strong.',
      );
    }
    final target = await _file(namespace);
    await target.parent.create(recursive: true);
    final temporary = File(
      '${target.path}.tmp-${DateTime.now().microsecondsSinceEpoch}',
    );
    try {
      await temporary.writeAsString(
        jsonEncode(<String, Object?>{
          'cacheFormatVersion': 3,
          'etag': entry.etag,
          'release': entry.releaseSource,
          if (entry.commerceConfigurationSource != null)
            'commerceConfiguration': entry.commerceConfigurationSource,
          if (entry.commerceConfigurationEtag != null)
            'commerceConfigurationEtag': entry.commerceConfigurationEtag,
        }),
        flush: true,
      );
      await temporary.rename(target.path);
    } on Object {
      if (await temporary.exists()) {
        await temporary.delete();
      }
      rethrow;
    }
  }

  Future<File> _file(String namespace) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(namespace)) {
      throw ArgumentError.value(namespace, 'namespace', 'Invalid cache key.');
    }
    final root = await _directoryProvider();
    return File('${root.path}/mosaic/configuration-$namespace.json');
  }
}

String mosaicConfigurationCacheNamespace(Uri baseUrl, String publicSdkKey) =>
    mosaicSha256String('${_normalizedBaseUrl(baseUrl)}\n$publicSdkKey');

String _normalizedBaseUrl(Uri value) {
  final path = value.path.endsWith('/')
      ? value.path.substring(0, value.path.length - 1)
      : value.path;
  return value.replace(path: path, query: null, fragment: null).toString();
}

bool mosaicIsStrongEtag(String value) => _isStrongEtag(value);

bool _isStrongEtag(String value) =>
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"') &&
    !value.startsWith('W/') &&
    !value.contains('\r') &&
    !value.contains('\n');

const Set<String> _cacheVersionOneKeys = <String>{
  'cacheFormatVersion',
  'etag',
  'release',
};

const Set<String> _cacheVersionTwoRequiredKeys = <String>{
  'cacheFormatVersion',
  'etag',
  'release',
};

const Set<String> _cacheVersionTwoKeys = <String>{
  ..._cacheVersionTwoRequiredKeys,
  'commerceConfiguration',
};

const Set<String> _cacheVersionThreeRequiredKeys = _cacheVersionTwoRequiredKeys;

const Set<String> _cacheVersionThreeKeys = <String>{
  ..._cacheVersionTwoKeys,
  'commerceConfigurationEtag',
};

bool _isCommerceEtag(String value) =>
    RegExp(r'^"sha256:[a-f0-9]{64}"$').hasMatch(value);
