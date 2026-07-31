import 'dart:collection';
import 'dart:convert';

import 'protocol.dart';
import 'sha256.dart';

const String mosaicConfigurationDeliveryVersion = '1';
const int mosaicMaximumConfigurationBytes = 8 * 1024 * 1024;

final class MosaicConfigurationDeliveryException implements Exception {
  const MosaicConfigurationDeliveryException(this.message);

  final String message;

  @override
  String toString() => 'MosaicConfigurationDeliveryException: $message';
}

final class MosaicConfigurationDeliveryEnvelope {
  const MosaicConfigurationDeliveryEnvelope({
    required this.version,
    required this.release,
    required this.source,
  });

  final String version;
  final MosaicConfigurationRelease release;
  final String source;
}

final class MosaicConfigurationRelease {
  MosaicConfigurationRelease({
    required this.id,
    required this.number,
    required this.environment,
    required this.publishedAt,
    required this.contentDigest,
    required Iterable<MosaicRequiredCapability> requiredCapabilities,
    required Map<String, String> placements,
    required Map<String, MosaicDeliveredPaywallVersion> paywallVersions,
    required Map<String, MosaicDeliveredProductReference> productReferences,
    required Map<String, MosaicDeliveredAssetReference> assetReferences,
  })  : requiredCapabilities = List.unmodifiable(requiredCapabilities),
        placements = Map.unmodifiable(placements),
        paywallVersions = Map.unmodifiable(paywallVersions),
        productReferences = Map.unmodifiable(productReferences),
        assetReferences = Map.unmodifiable(assetReferences);

  final String id;
  final int number;
  final MosaicDeliveredEnvironment environment;
  final String publishedAt;
  final String contentDigest;
  final List<MosaicRequiredCapability> requiredCapabilities;
  final Map<String, String> placements;
  final Map<String, MosaicDeliveredPaywallVersion> paywallVersions;
  final Map<String, MosaicDeliveredProductReference> productReferences;
  final Map<String, MosaicDeliveredAssetReference> assetReferences;

  MosaicDeliveredPaywallVersion? paywallForPlacement(String key) {
    final versionId = placements[key];
    return versionId == null ? null : paywallVersions[versionId];
  }
}

final class MosaicDeliveredEnvironment {
  const MosaicDeliveredEnvironment({required this.id, required this.key});

  final String id;
  final String key;
}

final class MosaicDeliveredPaywallVersion {
  MosaicDeliveredPaywallVersion({
    required this.id,
    required this.paywallId,
    required this.protocolVersion,
    required this.documentDigest,
    required this.document,
    required Iterable<String> productReferenceIds,
    required Map<String, String> assetBindings,
  })  : productReferenceIds = Set.unmodifiable(productReferenceIds),
        assetBindings = Map.unmodifiable(assetBindings);

  final String id;
  final String paywallId;
  final String protocolVersion;
  final String documentDigest;
  final MosaicPaywallDocument document;
  final Set<String> productReferenceIds;
  final Map<String, String> assetBindings;
}

enum MosaicDeliveredProductType { subscription, oneTimeNonConsumable }

final class MosaicDeliveredProductReference {
  const MosaicDeliveredProductReference({
    required this.id,
    required this.type,
    required this.fallbackDisplayName,
  });

  final String id;
  final MosaicDeliveredProductType type;
  final String fallbackDisplayName;
}

enum MosaicDeliveredAssetKind { image, video }

final class MosaicDeliveredAssetReference {
  const MosaicDeliveredAssetReference({
    required this.id,
    required this.kind,
    required this.mediaType,
    required this.byteLength,
    required this.contentDigest,
    required this.url,
  });

  final String id;
  final MosaicDeliveredAssetKind kind;
  final String mediaType;
  final int byteLength;
  final String contentDigest;
  final Uri url;
}

/// Strict, atomic reader for Configuration Delivery Contract v1.
///
/// Every included Protocol 0.2 document and every cross-release reference is
/// validated before an envelope is returned.
final class MosaicConfigurationDeliveryDecoder {
  const MosaicConfigurationDeliveryDecoder({
    this.protocolDecoder = const MosaicProtocolDecoder(),
  });

  final MosaicProtocolDecoder protocolDecoder;

  MosaicConfigurationDeliveryEnvelope decode(String source) {
    if (utf8.encode(source).length > mosaicMaximumConfigurationBytes) {
      throw const MosaicConfigurationDeliveryException(
        'The configuration release exceeds the SDK byte limit.',
      );
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException {
      throw const MosaicConfigurationDeliveryException(
        'The configuration release is not valid JSON.',
      );
    }
    final envelope = _object(decoded, r'$');
    _expectKeys(
      envelope,
      const <String>{'configurationDeliveryVersion', 'release'},
      r'$',
    );
    final version = _string(
      envelope['configurationDeliveryVersion'],
      r'$.configurationDeliveryVersion',
    );
    if (version != mosaicConfigurationDeliveryVersion) {
      throw const MosaicConfigurationDeliveryException(
        'The Configuration Delivery version is unsupported.',
      );
    }
    final releaseObject = _object(envelope['release'], r'$.release');
    final release = _release(releaseObject);
    _validateReleaseDigest(envelope, release.contentDigest);
    return MosaicConfigurationDeliveryEnvelope(
      version: version,
      release: release,
      source: source,
    );
  }

  MosaicConfigurationRelease _release(Map<String, Object?> object) {
    const path = r'$.release';
    _expectKeys(
      object,
      const <String>{
        'id',
        'number',
        'environment',
        'publishedAt',
        'contentDigest',
        'compatibility',
        'placements',
        'paywallVersions',
        'productReferences',
        'assetReferences',
      },
      path,
    );
    final requiredCapabilities = _compatibility(object['compatibility']);
    final assetReferences = _assetReferences(object['assetReferences']);
    final paywallVersions = _paywallVersions(
      object['paywallVersions'],
      assetReferences,
    );
    final placements = _placements(object['placements'], paywallVersions);
    final productReferences = _productReferences(object['productReferences']);
    _validateCompleteReferences(
      requiredCapabilities: requiredCapabilities,
      placements: placements,
      paywallVersions: paywallVersions,
      productReferences: productReferences,
      assetReferences: assetReferences,
    );
    final environment = _object(object['environment'], '$path.environment');
    _expectKeys(
      environment,
      const <String>{'id', 'key'},
      '$path.environment',
    );
    return MosaicConfigurationRelease(
      id: _identifier(object['id'], '$path.id'),
      number:
          _integer(object['number'], '$path.number', maximum: 9007199254740991),
      environment: MosaicDeliveredEnvironment(
        id: _identifier(environment['id'], '$path.environment.id'),
        key: _patternString(
          environment['key'],
          '$path.environment.key',
          _environmentKeyPattern,
          maximumLength: 64,
        ),
      ),
      publishedAt: _timestamp(object['publishedAt'], '$path.publishedAt'),
      contentDigest: _digest(object['contentDigest'], '$path.contentDigest'),
      requiredCapabilities: requiredCapabilities,
      placements: placements,
      paywallVersions: paywallVersions,
      productReferences: productReferences,
      assetReferences: assetReferences,
    );
  }

  List<MosaicRequiredCapability> _compatibility(Object? value) {
    const path = r'$.release.compatibility';
    final object = _object(value, path);
    _expectKeys(object, const <String>{'paywallProtocols', 'acceptance'}, path);
    if (_string(object['acceptance'], '$path.acceptance') != 'atomic') {
      throw const MosaicConfigurationDeliveryException(
        'Configuration releases must use atomic acceptance.',
      );
    }
    final protocols = _list(
      object['paywallProtocols'],
      '$path.paywallProtocols',
      minimum: 1,
      maximum: 1,
    );
    final protocol = _object(protocols.single, '$path.paywallProtocols[0]');
    _expectKeys(
      protocol,
      const <String>{'version', 'requiredCapabilities'},
      '$path.paywallProtocols[0]',
    );
    if (_string(protocol['version'], '$path.paywallProtocols[0].version') !=
        mosaicProtocolVersion) {
      throw const MosaicConfigurationDeliveryException(
        'The release requires an unsupported Paywall Protocol.',
      );
    }
    final entries = _list(
      protocol['requiredCapabilities'],
      '$path.paywallProtocols[0].requiredCapabilities',
      minimum: 1,
      maximum: 128,
    );
    final seen = <String>{};
    return <MosaicRequiredCapability>[
      for (var index = 0; index < entries.length; index += 1)
        _requiredCapability(
          entries[index],
          '$path.paywallProtocols[0].requiredCapabilities[$index]',
          seen,
        ),
    ];
  }

  MosaicRequiredCapability _requiredCapability(
    Object? value,
    String path,
    Set<String> seen,
  ) {
    final object = _object(value, path);
    _expectKeys(object, const <String>{'name', 'version'}, path);
    final name = _string(object['name'], '$path.name');
    final version = _string(object['version'], '$path.version');
    if (!mosaicProtocolV02Capabilities.contains(name) ||
        version != mosaicProtocolVersion) {
      throw const MosaicConfigurationDeliveryException(
        'The release requires an unsupported Paywall capability.',
      );
    }
    if (!seen.add(name)) {
      throw const MosaicConfigurationDeliveryException(
        'The release contains a duplicate Paywall capability.',
      );
    }
    return MosaicRequiredCapability(name: name, version: version);
  }

  Map<String, MosaicDeliveredPaywallVersion> _paywallVersions(
    Object? value,
    Map<String, MosaicDeliveredAssetReference> assetReferences,
  ) {
    const path = r'$.release.paywallVersions';
    final entries = _list(value, path, minimum: 1, maximum: 256);
    final result = <String, MosaicDeliveredPaywallVersion>{};
    final paywallIds = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{
          'id',
          'paywallId',
          'protocolVersion',
          'documentDigest',
          'document',
          'productReferenceIds',
          'assetBindings',
        },
        entryPath,
      );
      final id = _identifier(object['id'], '$entryPath.id');
      final paywallId =
          _identifier(object['paywallId'], '$entryPath.paywallId');
      if (result.containsKey(id) || !paywallIds.add(paywallId)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains duplicate Paywall Versions.',
        );
      }
      final protocolVersion =
          _string(object['protocolVersion'], '$entryPath.protocolVersion');
      if (protocolVersion != mosaicProtocolVersion) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version uses an unsupported protocol.',
        );
      }
      final documentObject = _object(object['document'], '$entryPath.document');
      final documentSource = jsonEncode(documentObject);
      final MosaicPaywallDocument document;
      try {
        document = protocolDecoder.decode(documentSource);
      } on MosaicProtocolException {
        throw const MosaicConfigurationDeliveryException(
          'An included Paywall document is invalid or unsupported.',
        );
      }
      if (document.schemaVersion != protocolVersion ||
          document.id != paywallId) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version does not match its document identity.',
        );
      }
      final documentDigest =
          _digest(object['documentDigest'], '$entryPath.documentDigest');
      if (documentDigest != _digestValue(documentObject)) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version document digest does not match.',
        );
      }
      final productIds = _uniqueIdentifiers(
        object['productReferenceIds'],
        '$entryPath.productReferenceIds',
        maximum: 64,
      );
      if (!_sameSet(
          productIds, document.products.map((item) => item.productId))) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version Product reference set is inconsistent.',
        );
      }
      final bindings = _assetBindings(
        object['assetBindings'],
        entryPath,
        document,
        assetReferences,
      );
      result[id] = MosaicDeliveredPaywallVersion(
        id: id,
        paywallId: paywallId,
        protocolVersion: protocolVersion,
        documentDigest: documentDigest,
        document: document,
        productReferenceIds: productIds,
        assetBindings: bindings,
      );
    }
    return result;
  }

  Map<String, String> _assetBindings(
    Object? value,
    String versionPath,
    MosaicPaywallDocument document,
    Map<String, MosaicDeliveredAssetReference> assetReferences,
  ) {
    final path = '$versionPath.assetBindings';
    final entries = _list(value, path, maximum: 128);
    final result = <String, String>{};
    final referencedIds = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{'documentAssetId', 'assetReferenceId'},
        entryPath,
      );
      final documentId =
          _identifier(object['documentAssetId'], '$entryPath.documentAssetId');
      final referenceId = _identifier(
          object['assetReferenceId'], '$entryPath.assetReferenceId');
      if (result.containsKey(documentId) || !referencedIds.add(referenceId)) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version contains duplicate Asset bindings.',
        );
      }
      result[documentId] = referenceId;
    }
    final remoteAssets = <String, MosaicAsset>{
      for (final asset in document.assets)
        if (asset.source is MosaicRemoteAssetSource) asset.id: asset,
    };
    if (!_sameSet(result.keys, remoteAssets.keys)) {
      throw const MosaicConfigurationDeliveryException(
        'A Paywall Version remote Asset binding set is inconsistent.',
      );
    }
    for (final binding in result.entries) {
      final documentAsset = remoteAssets[binding.key]!;
      final releaseAsset = assetReferences[binding.value];
      if (releaseAsset == null) {
        throw const MosaicConfigurationDeliveryException(
          'A Paywall Version references an unknown release Asset.',
        );
      }
      final documentKind = documentAsset is MosaicImageAsset
          ? MosaicDeliveredAssetKind.image
          : MosaicDeliveredAssetKind.video;
      final documentUrl = (documentAsset.source as MosaicRemoteAssetSource).url;
      if (releaseAsset.kind != documentKind ||
          releaseAsset.url != documentUrl) {
        throw const MosaicConfigurationDeliveryException(
          'A release Asset does not match its Paywall document Asset.',
        );
      }
    }
    return result;
  }

  Map<String, String> _placements(
    Object? value,
    Map<String, MosaicDeliveredPaywallVersion> paywallVersions,
  ) {
    const path = r'$.release.placements';
    final entries = _list(value, path, minimum: 1, maximum: 256);
    final result = <String, String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{'key', 'paywallVersionId'},
        entryPath,
      );
      final key = _patternString(
        object['key'],
        '$entryPath.key',
        _placementKeyPattern,
        maximumLength: 64,
      );
      final versionId = _identifier(
          object['paywallVersionId'], '$entryPath.paywallVersionId');
      if (result.containsKey(key)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains a duplicate Placement key.',
        );
      }
      if (!paywallVersions.containsKey(versionId)) {
        throw const MosaicConfigurationDeliveryException(
          'A Placement references an unknown Paywall Version.',
        );
      }
      result[key] = versionId;
    }
    if (!_sameSet(result.values, paywallVersions.keys)) {
      throw const MosaicConfigurationDeliveryException(
        'Every Paywall Version must be referenced by a Placement.',
      );
    }
    return result;
  }

  Map<String, MosaicDeliveredProductReference> _productReferences(
      Object? value) {
    const path = r'$.release.productReferences';
    final entries = _list(value, path, maximum: 1024);
    final result = <String, MosaicDeliveredProductReference>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{'id', 'type', 'fallbackDisplayName'},
        entryPath,
      );
      final id = _identifier(object['id'], '$entryPath.id');
      if (result.containsKey(id)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains a duplicate Product reference.',
        );
      }
      final type = _string(object['type'], '$entryPath.type');
      final displayName = _boundedSafeString(
        object['fallbackDisplayName'],
        '$entryPath.fallbackDisplayName',
        maximumLength: 160,
      );
      result[id] = MosaicDeliveredProductReference(
        id: id,
        type: switch (type) {
          'subscription' => MosaicDeliveredProductType.subscription,
          'one_time_non_consumable' =>
            MosaicDeliveredProductType.oneTimeNonConsumable,
          _ => throw const MosaicConfigurationDeliveryException(
              'A Product reference uses an unsupported type.',
            ),
        },
        fallbackDisplayName: displayName,
      );
    }
    return result;
  }

  Map<String, MosaicDeliveredAssetReference> _assetReferences(Object? value) {
    const path = r'$.release.assetReferences';
    final entries = _list(value, path, maximum: 1024);
    final result = <String, MosaicDeliveredAssetReference>{};
    for (var index = 0; index < entries.length; index += 1) {
      final entryPath = '$path[$index]';
      final object = _object(entries[index], entryPath);
      _expectKeys(
        object,
        const <String>{
          'id',
          'kind',
          'mediaType',
          'byteLength',
          'contentDigest',
          'url',
        },
        entryPath,
      );
      final id = _identifier(object['id'], '$entryPath.id');
      if (result.containsKey(id)) {
        throw const MosaicConfigurationDeliveryException(
          'The release contains a duplicate Asset reference.',
        );
      }
      final kindValue = _string(object['kind'], '$entryPath.kind');
      final kind = switch (kindValue) {
        'image' => MosaicDeliveredAssetKind.image,
        'video' => MosaicDeliveredAssetKind.video,
        _ => throw const MosaicConfigurationDeliveryException(
            'A release Asset uses an unsupported kind.',
          ),
      };
      final mediaType = _patternString(
        object['mediaType'],
        '$entryPath.mediaType',
        _mediaTypePattern,
        maximumLength: 96,
      );
      if (!mediaType.startsWith('$kindValue/')) {
        throw const MosaicConfigurationDeliveryException(
          'A release Asset media type does not match its kind.',
        );
      }
      result[id] = MosaicDeliveredAssetReference(
        id: id,
        kind: kind,
        mediaType: mediaType,
        byteLength: _integer(
          object['byteLength'],
          '$entryPath.byteLength',
          maximum: 52428800,
        ),
        contentDigest:
            _digest(object['contentDigest'], '$entryPath.contentDigest'),
        url: _immutableHttpsUrl(object['url'], '$entryPath.url'),
      );
    }
    return result;
  }

  void _validateCompleteReferences({
    required List<MosaicRequiredCapability> requiredCapabilities,
    required Map<String, String> placements,
    required Map<String, MosaicDeliveredPaywallVersion> paywallVersions,
    required Map<String, MosaicDeliveredProductReference> productReferences,
    required Map<String, MosaicDeliveredAssetReference> assetReferences,
  }) {
    final expectedProducts = <String>{};
    final expectedAssets = <String>{};
    final expectedCapabilities = <String>{};
    for (final version in paywallVersions.values) {
      expectedProducts.addAll(version.productReferenceIds);
      expectedAssets.addAll(version.assetBindings.values);
      expectedCapabilities.addAll(
        version.document.compatibility.requiredCapabilities.map(
          (capability) => '${capability.name}@${capability.version}',
        ),
      );
    }
    if (!_sameSet(expectedProducts, productReferences.keys) ||
        !_sameSet(expectedAssets, assetReferences.keys) ||
        !_sameSet(
          expectedCapabilities,
          requiredCapabilities.map(
            (capability) => '${capability.name}@${capability.version}',
          ),
        )) {
      throw const MosaicConfigurationDeliveryException(
        'The release contains an inconsistent complete reference set.',
      );
    }
    if (placements.isEmpty) {
      throw const MosaicConfigurationDeliveryException(
        'The release must contain at least one Placement.',
      );
    }
  }

  void _validateReleaseDigest(
    Map<String, Object?> envelope,
    String expected,
  ) {
    final release = Map<String, Object?>.from(
      _object(envelope['release'], r'$.release'),
    )..remove('contentDigest');
    if (_digestValue(release) != expected) {
      throw const MosaicConfigurationDeliveryException(
        'The release content digest does not match.',
      );
    }
  }
}

Object? _canonicalize(Object? value) {
  if (value is List<Object?>) {
    return <Object?>[for (final item in value) _canonicalize(item)];
  }
  if (value is Map) {
    final sorted = SplayTreeMap<String, Object?>();
    for (final entry in value.entries) {
      sorted[entry.key as String] = _canonicalize(entry.value);
    }
    return sorted;
  }
  return value;
}

String _digestValue(Object? value) =>
    'sha256:${mosaicSha256String(jsonEncode(_canonicalize(value)))}';

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map) {
    throw MosaicConfigurationDeliveryException('Expected an object at $path.');
  }
  try {
    return value.cast<String, Object?>();
  } on Object {
    throw MosaicConfigurationDeliveryException('Expected an object at $path.');
  }
}

List<Object?> _list(
  Object? value,
  String path, {
  int minimum = 0,
  required int maximum,
}) {
  if (value is! List<Object?> ||
      value.length < minimum ||
      value.length > maximum) {
    throw MosaicConfigurationDeliveryException('Invalid list at $path.');
  }
  return value;
}

void _expectKeys(
  Map<String, Object?> object,
  Set<String> expected,
  String path,
) {
  if (object.keys.toSet().difference(expected).isNotEmpty ||
      expected.difference(object.keys.toSet()).isNotEmpty) {
    throw MosaicConfigurationDeliveryException('Unexpected fields at $path.');
  }
}

String _string(Object? value, String path) {
  if (value is! String) {
    throw MosaicConfigurationDeliveryException('Expected a string at $path.');
  }
  return value;
}

String _patternString(
  Object? value,
  String path,
  RegExp pattern, {
  required int maximumLength,
}) {
  final source = _string(value, path);
  if (source.isEmpty ||
      source.length > maximumLength ||
      !pattern.hasMatch(source)) {
    throw MosaicConfigurationDeliveryException('Invalid string at $path.');
  }
  return source;
}

String _boundedSafeString(
  Object? value,
  String path, {
  required int maximumLength,
}) {
  final source = _string(value, path);
  if (source.isEmpty ||
      source.length > maximumLength ||
      source.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
    throw MosaicConfigurationDeliveryException('Invalid string at $path.');
  }
  return source;
}

String _identifier(Object? value, String path) => _patternString(
      value,
      path,
      _identifierPattern,
      maximumLength: 128,
    );

int _integer(Object? value, String path, {required int maximum}) {
  if (value is! num ||
      !value.isFinite ||
      value < 1 ||
      value > maximum ||
      value != value.truncate()) {
    throw MosaicConfigurationDeliveryException('Invalid integer at $path.');
  }
  return value.toInt();
}

String _digest(Object? value, String path) => _patternString(
      value,
      path,
      _digestPattern,
      maximumLength: 71,
    );

String _timestamp(Object? value, String path) => _patternString(
      value,
      path,
      _timestampPattern,
      maximumLength: 40,
    );

Uri _immutableHttpsUrl(Object? value, String path) {
  final source = _string(value, path);
  final uri = Uri.tryParse(source);
  if (source.length < 9 ||
      source.length > 2048 ||
      uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      source.contains('\\') ||
      source.runes.any((rune) => rune <= 0x20 || rune == 0x7f)) {
    throw MosaicConfigurationDeliveryException('Invalid URL at $path.');
  }
  return uri;
}

Set<String> _uniqueIdentifiers(
  Object? value,
  String path, {
  required int maximum,
}) {
  final entries = _list(value, path, maximum: maximum);
  final result = <String>{};
  for (var index = 0; index < entries.length; index += 1) {
    if (!result.add(_identifier(entries[index], '$path[$index]'))) {
      throw MosaicConfigurationDeliveryException(
        'Duplicate identifier at $path.',
      );
    }
  }
  return result;
}

bool _sameSet(Iterable<String> left, Iterable<String> right) {
  final leftSet = left.toSet();
  final rightSet = right.toSet();
  return leftSet.length == rightSet.length && leftSet.containsAll(rightSet);
}

final RegExp _identifierPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _placementKeyPattern = RegExp(r'^[a-z][a-z0-9_]*$');
final RegExp _environmentKeyPattern = RegExp(r'^[a-z][a-z0-9_-]*$');
final RegExp _digestPattern = RegExp(r'^sha256:[a-f0-9]{64}$');
final RegExp _timestampPattern = RegExp(
  r'^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,9})?Z$',
);
final RegExp _mediaTypePattern =
    RegExp(r'^(image|video)/[a-z0-9][a-z0-9.+-]*$');
