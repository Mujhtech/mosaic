import 'dart:convert';

import 'commerce_configuration.dart';
import 'configuration_delivery.dart';
import 'sha256.dart';

/// Strict reader for the frozen Commerce Configuration v2 contract.
///
/// This stays separate from the v1 reader so v1 remains closed and unchanged.
final class MosaicCommerceConfigurationV2Decoder {
  const MosaicCommerceConfigurationV2Decoder._();

  static MosaicCommerceConfigurationEnvelope decode(
    String source, {
    required MosaicConfigurationRelease expectedRelease,
    required String expectedApplicationId,
    required MosaicStorePlatform expectedStorePlatform,
  }) {
    final root = _object(jsonDecode(source), r'$');
    _keys(
      root,
      const <String>{'commerceConfigurationVersion', 'configuration'},
      r'$',
    );
    if (_string(root['commerceConfigurationVersion'], r'$.version') != '2') {
      throw const MosaicCommerceConfigurationException(
        'The Commerce Configuration version is unsupported.',
      );
    }
    final raw = _object(root['configuration'], r'$.configuration');
    const path = r'$.configuration';
    _keys(
      raw,
      const <String>{
        'id',
        'environmentId',
        'applicationId',
        'storePlatform',
        'configurationRelease',
        'contentDigest',
        'activeProvider',
        'productMappings',
        'entitlementMappings',
        'freshness',
        'diagnostics',
      },
      path,
    );
    final release =
        _object(raw['configurationRelease'], '$path.configurationRelease');
    _keys(
      release,
      const <String>{'id', 'contentDigest'},
      '$path.configurationRelease',
    );
    final platform = _wireEnum(
      raw['storePlatform'],
      '$path.storePlatform',
      MosaicStorePlatform.values,
      (value) => value.wireValue,
    );
    final provider = _activeProvider(
      raw['activeProvider'],
      '$path.activeProvider',
      platform,
    );
    final products = _productMappings(
      raw['productMappings'],
      '$path.productMappings',
      provider.identity.id,
    );
    final configuration = MosaicCommerceConfiguration(
      version: '2',
      id: _identifier(raw['id'], '$path.id'),
      environmentId: _identifier(raw['environmentId'], '$path.environmentId'),
      applicationId: _identifier(raw['applicationId'], '$path.applicationId'),
      storePlatform: platform,
      configurationReleaseId:
          _identifier(release['id'], '$path.configurationRelease.id'),
      configurationReleaseDigest: _digest(
          release['contentDigest'], '$path.configurationRelease.digest'),
      contentDigest: _digest(raw['contentDigest'], '$path.contentDigest'),
      activeProvider: provider,
      productMappings: products,
      entitlementMappings: _entitlementMappings(
        raw['entitlementMappings'],
        '$path.entitlementMappings',
      ),
      freshness: _freshness(
        raw['freshness'],
        '$path.freshness',
        provider.activation.source,
      ),
      diagnostics: _diagnostics(raw['diagnostics'], '$path.diagnostics'),
    );
    final material = Map<String, Object?>.of(raw)..remove('contentDigest');
    final digest =
        'sha256:${mosaicSha256String(jsonEncode(_canonicalize(material)))}';
    if (digest != configuration.contentDigest) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration content digest does not match.',
      );
    }
    if (configuration.environmentId != expectedRelease.environment.id ||
        configuration.applicationId != expectedApplicationId ||
        configuration.storePlatform != expectedStorePlatform ||
        configuration.configurationReleaseId != expectedRelease.id ||
        configuration.configurationReleaseDigest !=
            expectedRelease.contentDigest ||
        products.map((item) => item.mosaicProductId).toSet().length !=
            expectedRelease.productReferences.length ||
        !products
            .map((item) => item.mosaicProductId)
            .toSet()
            .containsAll(expectedRelease.productReferences.keys)) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration does not match the accepted release scope.',
      );
    }
    for (final mapping in products) {
      final expected =
          expectedRelease.productReferences[mapping.mosaicProductId];
      final expectedType = switch (expected?.type) {
        MosaicDeliveredProductType.subscription =>
          MosaicCommerceProductType.subscription,
        MosaicDeliveredProductType.oneTimeNonConsumable =>
          MosaicCommerceProductType.oneTimeNonConsumable,
        null => null,
      };
      if (expected == null || mapping.productType != expectedType) {
        throw const MosaicCommerceConfigurationException(
          'The commerce Product mappings do not match the accepted release.',
        );
      }
    }
    return MosaicCommerceConfigurationEnvelope(
      version: '2',
      configuration: configuration,
      source: source,
    );
  }

  static MosaicActiveProvider _activeProvider(
    Object? value,
    String path,
    MosaicStorePlatform platform,
  ) {
    final object = _object(value, path);
    _keys(
      object,
      const <String>{
        'identity',
        'activation',
        'capabilities',
        'recoveryMode',
      },
      path,
    );
    final identity = _object(object['identity'], '$path.identity');
    _keys(
      identity,
      const <String>{'id', 'displayName', 'adapterVersion'},
      '$path.identity',
    );
    final providerId = _identifier(identity['id'], '$path.identity.id');
    final activationObject = _object(object['activation'], '$path.activation');
    final activationSource =
        _string(activationObject['source'], '$path.activation.source');
    final MosaicProviderActivation activation;
    switch (activationSource) {
      case 'providerConnection':
        _keys(
          activationObject,
          const <String>{'source', 'providerConnectionId'},
          '$path.activation',
        );
        activation = MosaicProviderConnectionActivation(
          providerConnectionId: _identifier(
            activationObject['providerConnectionId'],
            '$path.activation.providerConnectionId',
          ),
        );
        break;
      case 'sdkLocal':
        _keys(
          activationObject,
          const <String>{'source', 'localSnapshotId'},
          '$path.activation',
        );
        activation = MosaicSdkLocalProviderActivation(
          localSnapshotId: _identifier(
            activationObject['localSnapshotId'],
            '$path.activation.localSnapshotId',
          ),
        );
        break;
      case 'nativeStore':
        _keys(
          activationObject,
          const <String>{'source'},
          '$path.activation',
        );
        if (platform == MosaicStorePlatform.ios && providerId != 'app_store' ||
            platform == MosaicStorePlatform.android &&
                providerId != 'google_play') {
          throw const MosaicCommerceConfigurationException(
            'The native Provider does not match the store platform.',
          );
        }
        activation = const MosaicNativeStoreProviderActivation();
        break;
      default:
        throw const MosaicCommerceConfigurationException(
          'The Provider activation source is unsupported.',
        );
    }
    final capabilities = <MosaicProviderCapability>[];
    final seen = <MosaicProviderCapabilityName>{};
    final values = _list(object['capabilities'], '$path.capabilities', 1, 19);
    for (var index = 0; index < values.length; index += 1) {
      final itemPath = '$path.capabilities[$index]';
      final item = _object(values[index], itemPath);
      _keys(
        item,
        const <String>{'name', 'support'},
        itemPath,
        optional: const <String>{'reasonCode'},
      );
      final name = _wireEnum(
        item['name'],
        '$itemPath.name',
        MosaicProviderCapabilityName.values,
        (value) => value.wireValue,
      );
      final support = _wireEnum(
        item['support'],
        '$itemPath.support',
        MosaicProviderCapabilitySupport.values,
        (value) => value.name,
      );
      final reason = item.containsKey('reasonCode')
          ? _pattern(
              item['reasonCode'],
              '$itemPath.reasonCode',
              _reasonPattern,
              96,
            )
          : null;
      if (!seen.add(name) ||
          (support == MosaicProviderCapabilitySupport.supported
              ? reason != null
              : reason == null)) {
        throw const MosaicCommerceConfigurationException(
          'A Provider capability is invalid or duplicated.',
        );
      }
      capabilities.add(
        MosaicProviderCapability(
          name: name,
          support: support,
          reasonCode: reason,
        ),
      );
    }
    return MosaicActiveProvider(
      identity: MosaicProviderIdentity(
        id: providerId,
        displayName:
            _safe(identity['displayName'], '$path.identity.displayName'),
        adapterVersion: _pattern(
          identity['adapterVersion'],
          '$path.identity.adapterVersion',
          _adapterVersionPattern,
          64,
        ),
      ),
      activation: activation,
      capabilities: capabilities,
      recoveryMode: _wireEnum(
        object['recoveryMode'],
        '$path.recoveryMode',
        MosaicCommerceRecoveryMode.values,
        (value) => value.name,
      ),
    );
  }

  static List<MosaicCommerceProductMapping> _productMappings(
    Object? value,
    String path,
    String providerId,
  ) {
    final values = _list(value, path, 1, 256);
    final productIds = <String>{};
    final mappingIds = <String>{};
    final targets = <String>{};
    return <MosaicCommerceProductMapping>[
      for (var index = 0; index < values.length; index += 1)
        _productMapping(
          values[index],
          '$path[$index]',
          providerId,
          productIds,
          mappingIds,
          targets,
        ),
    ];
  }

  static MosaicCommerceProductMapping _productMapping(
    Object? value,
    String path,
    String providerId,
    Set<String> productIds,
    Set<String> mappingIds,
    Set<String> targets,
  ) {
    final object = _object(value, path);
    _keys(
      object,
      const <String>{
        'mosaicProductId',
        'mappingId',
        'productType',
        'entitlementKeys',
        'providerProductReference',
        'adapterMapping',
      },
      path,
    );
    final productId = _identifier(object['mosaicProductId'], '$path.product');
    final mappingId = _identifier(object['mappingId'], '$path.mapping');
    final type = _wireEnum(
      object['productType'],
      '$path.productType',
      MosaicCommerceProductType.values,
      (value) => value.wireValue,
    );
    final reference =
        _opaque(object['providerProductReference'], '$path.providerReference');
    final adapter = _object(object['adapterMapping'], '$path.adapterMapping');
    final kind = _string(adapter['kind'], '$path.adapterMapping.kind');
    final MosaicAdapterMapping decodedAdapter;
    switch (kind) {
      case 'directProduct':
        _keys(adapter, const <String>{'kind'}, '$path.adapterMapping');
        decodedAdapter = const MosaicDirectProductMapping();
        break;
      case 'revenueCatPackage':
        _keys(
          adapter,
          const <String>{
            'kind',
            'offeringIdentifier',
            'packageIdentifier',
          },
          '$path.adapterMapping',
        );
        if (providerId != 'revenuecat') {
          throw const MosaicCommerceConfigurationException(
            'A RevenueCat Package mapping requires the RevenueCat Provider.',
          );
        }
        decodedAdapter = MosaicRevenueCatPackageMapping(
          offeringIdentifier: _opaque(
            adapter['offeringIdentifier'],
            '$path.adapterMapping.offeringIdentifier',
          ),
          packageIdentifier: _opaque(
            adapter['packageIdentifier'],
            '$path.adapterMapping.packageIdentifier',
          ),
        );
        break;
      case 'storeKitProduct':
        _keys(adapter, const <String>{'kind'}, '$path.adapterMapping');
        if (providerId != 'app_store') {
          throw const MosaicCommerceConfigurationException(
            'A StoreKit mapping requires the App Store Provider.',
          );
        }
        decodedAdapter = const MosaicStoreKitProductMapping();
        break;
      case 'googlePlayProduct':
        _keys(
          adapter,
          const <String>{'kind'},
          '$path.adapterMapping',
          optional: const <String>{'basePlanId', 'offerId'},
        );
        if (providerId != 'google_play') {
          throw const MosaicCommerceConfigurationException(
            'A Google Play mapping requires the Google Play Provider.',
          );
        }
        final basePlan = adapter.containsKey('basePlanId')
            ? _opaque(adapter['basePlanId'], '$path.adapterMapping.basePlanId')
            : null;
        final offer = adapter.containsKey('offerId')
            ? _opaque(adapter['offerId'], '$path.adapterMapping.offerId')
            : null;
        if (type == MosaicCommerceProductType.subscription
            ? basePlan == null
            : basePlan != null || offer != null) {
          throw const MosaicCommerceConfigurationException(
            'The Google Play mapping does not match its Product type.',
          );
        }
        decodedAdapter = MosaicGooglePlayProductMapping(
          basePlanId: basePlan,
          offerId: offer,
        );
        break;
      default:
        throw const MosaicCommerceConfigurationException(
          'The native commerce adapter mapping is unsupported.',
        );
    }
    final grants = _list(object['entitlementKeys'], '$path.entitlements', 0, 32)
        .map((item) => _entitlement(item, '$path.entitlements'))
        .toList(growable: false);
    final target = '$reference:${jsonEncode(_canonicalize(adapter))}';
    if (!productIds.add(productId) ||
        !mappingIds.add(mappingId) ||
        !targets.add(target) ||
        grants.toSet().length != grants.length) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration contains ambiguous Product mappings.',
      );
    }
    return MosaicCommerceProductMapping(
      mosaicProductId: productId,
      mappingId: mappingId,
      providerProductReference: reference,
      adapterMapping: decodedAdapter,
      productType: type,
      entitlementKeys: List.unmodifiable(grants),
    );
  }

  static List<MosaicCommerceEntitlementMapping> _entitlementMappings(
    Object? value,
    String path,
  ) {
    final values = _list(value, path, 0, 128);
    final keys = <String>{};
    final providerIds = <String>{};
    return <MosaicCommerceEntitlementMapping>[
      for (var index = 0; index < values.length; index += 1)
        (() {
          final itemPath = '$path[$index]';
          final item = _object(values[index], itemPath);
          _keys(
            item,
            const <String>{
              'mosaicEntitlementKey',
              'providerEntitlementIdentifier',
            },
            itemPath,
          );
          final key =
              _entitlement(item['mosaicEntitlementKey'], '$itemPath.key');
          final provider = _opaque(
            item['providerEntitlementIdentifier'],
            '$itemPath.provider',
          );
          if (!keys.add(key) || !providerIds.add(provider)) {
            throw const MosaicCommerceConfigurationException(
              'The commerce configuration contains ambiguous Entitlement mappings.',
            );
          }
          return MosaicCommerceEntitlementMapping(
            mosaicEntitlementKey: key,
            providerEntitlementIdentifier: provider,
          );
        })(),
    ];
  }

  static MosaicCommerceFreshness _freshness(
    Object? value,
    String path,
    String activationSource,
  ) {
    final object = _object(value, path);
    final source = _string(object['source'], '$path.source');
    if (source != 'nativeStoreConfiguration') {
      _keys(
        object,
        const <String>{
          'source',
          'status',
          'providerObservedAt',
          'synchronizedAt',
          'staleAt',
        },
        path,
        optional: const <String>{'expiresAt'},
      );
      final decodedSource = _wireEnum(
        source,
        '$path.source',
        const <MosaicCommerceFreshnessSource>[
          MosaicCommerceFreshnessSource.providerSynchronization,
          MosaicCommerceFreshnessSource.sdkLocalSnapshot,
        ],
        (value) => value.name,
      );
      final expected = activationSource == 'providerConnection'
          ? MosaicCommerceFreshnessSource.providerSynchronization
          : MosaicCommerceFreshnessSource.sdkLocalSnapshot;
      if (decodedSource != expected) {
        throw const MosaicCommerceConfigurationException(
          'Commerce freshness does not match Provider activation.',
        );
      }
      final observed =
          _timestamp(object['providerObservedAt'], '$path.providerObservedAt');
      final synchronized =
          _timestamp(object['synchronizedAt'], '$path.synchronizedAt');
      final staleAt = _timestamp(object['staleAt'], '$path.staleAt');
      final expires = object.containsKey('expiresAt')
          ? _timestamp(object['expiresAt'], '$path.expiresAt')
          : null;
      if (synchronized.isBefore(observed) ||
          staleAt.isBefore(synchronized) ||
          expires != null && expires.isBefore(staleAt)) {
        throw const MosaicCommerceConfigurationException(
          'Commerce freshness timestamps are inconsistent.',
        );
      }
      return MosaicCommerceFreshness(
        source: decodedSource,
        status: _wireEnum(
          object['status'],
          '$path.status',
          const <MosaicCommerceFreshnessStatus>[
            MosaicCommerceFreshnessStatus.fresh,
            MosaicCommerceFreshnessStatus.stale,
          ],
          (value) => value.name,
        ),
        providerObservedAt: observed,
        synchronizedAt: synchronized,
        staleAt: staleAt,
        expiresAt: expires,
      );
    }
    _keys(
      object,
      const <String>{'source', 'status', 'configuredAt'},
      path,
      optional: const <String>{'observation'},
    );
    if (activationSource != 'nativeStore') {
      throw const MosaicCommerceConfigurationException(
        'Native commerce freshness is invalid.',
      );
    }
    final configured = _timestamp(object['configuredAt'], '$path.configuredAt');
    DateTime? observed;
    DateTime? expires;
    String? environment;
    if (object['observation'] case final Object observationValue) {
      final observation = _object(observationValue, '$path.observation');
      _keys(
        observation,
        const <String>{'environment', 'observedAt'},
        '$path.observation',
        optional: const <String>{'expiresAt'},
      );
      environment = _enumString(
        observation['environment'],
        '$path.observation.environment',
        const <String>{'test', 'production', 'unknown'},
      );
      observed =
          _timestamp(observation['observedAt'], '$path.observation.observedAt');
      expires = observation.containsKey('expiresAt')
          ? _timestamp(
              observation['expiresAt'],
              '$path.observation.expiresAt',
            )
          : null;
      if (expires != null && expires.isBefore(observed)) {
        throw const MosaicCommerceConfigurationException(
          'Native commerce freshness timestamps are inconsistent.',
        );
      }
    }
    return MosaicCommerceFreshness(
      source: MosaicCommerceFreshnessSource.nativeStoreConfiguration,
      status: _wireEnum(
        object['status'],
        '$path.status',
        MosaicCommerceFreshnessStatus.values,
        (value) => value.name,
      ),
      providerObservedAt: observed ?? configured,
      synchronizedAt: configured,
      staleAt: expires ?? observed ?? configured,
      expiresAt: expires,
      configuredAt: configured,
      observationEnvironment: environment,
    );
  }

  static List<MosaicCommerceDiagnostic> _diagnostics(
    Object? value,
    String path,
  ) {
    final values = _list(value, path, 0, 32);
    return <MosaicCommerceDiagnostic>[
      for (var index = 0; index < values.length; index += 1)
        _diagnostic(values[index], '$path[$index]'),
    ];
  }

  static MosaicCommerceDiagnostic _diagnostic(Object? value, String path) {
    final object = _object(value, path);
    _keys(
      object,
      const <String>{
        'code',
        'safeMessage',
        'severity',
        'retryable',
        'correlationId',
      },
      path,
      optional: const <String>{
        'retryAfterSeconds',
        'providerCode',
        'mosaicProductId',
        'recoveryAction',
      },
    );
    final retryable = object['retryable'];
    if (retryable is! bool) {
      throw MosaicCommerceConfigurationException('$path.retryable is invalid.');
    }
    final retryAfter = object['retryAfterSeconds'];
    if (retryAfter != null &&
        (retryAfter is! int ||
            retryAfter < 1 ||
            retryAfter > 86400 ||
            !retryable)) {
      throw MosaicCommerceConfigurationException(
        '$path.retryAfterSeconds is invalid.',
      );
    }
    return MosaicCommerceDiagnostic(
      code: _pattern(object['code'], '$path.code', _reasonPattern, 96),
      safeMessage: _safe(object['safeMessage'], '$path.safeMessage'),
      severity: _wireEnum(
        object['severity'],
        '$path.severity',
        MosaicCommerceDiagnosticSeverity.values,
        (value) => value.name,
      ),
      retryable: retryable,
      correlationId: _identifier(object['correlationId'], '$path.correlation'),
      retryAfterSeconds: retryAfter as int?,
      providerCode: object.containsKey('providerCode')
          ? _pattern(
              object['providerCode'],
              '$path.providerCode',
              _safePattern,
              128,
            )
          : null,
      mosaicProductId: object.containsKey('mosaicProductId')
          ? _identifier(object['mosaicProductId'], '$path.product')
          : null,
      recoveryAction: object.containsKey('recoveryAction')
          ? _wireEnum<MosaicCommerceRecoveryAction>(
              object['recoveryAction'],
              '$path.recoveryAction',
              MosaicCommerceRecoveryAction.values,
              (value) => value.name,
            )
          : null,
    );
  }
}

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map) {
    throw MosaicCommerceConfigurationException('$path must be an object.');
  }
  try {
    return value.cast<String, Object?>();
  } on Object {
    throw MosaicCommerceConfigurationException('$path has invalid keys.');
  }
}

List<Object?> _list(Object? value, String path, int minimum, int maximum) {
  if (value is! List || value.length < minimum || value.length > maximum) {
    throw MosaicCommerceConfigurationException('$path has an invalid size.');
  }
  return value.cast<Object?>();
}

void _keys(
  Map<String, Object?> value,
  Set<String> required,
  String path, {
  Set<String> optional = const <String>{},
}) {
  final actual = value.keys.toSet();
  if (!actual.containsAll(required) ||
      actual.difference(required.union(optional)).isNotEmpty) {
    throw MosaicCommerceConfigurationException(
      '$path contains missing or unsupported properties.',
    );
  }
}

String _string(Object? value, String path) {
  if (value is! String) {
    throw MosaicCommerceConfigurationException('$path must be a string.');
  }
  return value;
}

String _pattern(Object? value, String path, RegExp pattern, int maximum) {
  final text = _string(value, path);
  if (text.isEmpty || text.length > maximum || !pattern.hasMatch(text)) {
    throw MosaicCommerceConfigurationException('$path is invalid.');
  }
  return text;
}

String _identifier(Object? value, String path) =>
    _pattern(value, path, _identifierPattern, 128);
String _entitlement(Object? value, String path) =>
    _pattern(value, path, _entitlementPattern, 64);
String _digest(Object? value, String path) =>
    _pattern(value, path, _digestPattern, 71);
String _safe(Object? value, String path) =>
    _pattern(value, path, _safePattern, 240);
String _opaque(Object? value, String path) =>
    _pattern(value, path, _safePattern, 256);

T _wireEnum<T>(
  Object? value,
  String path,
  Iterable<T> values,
  String Function(T value) encode,
) {
  final text = _string(value, path);
  for (final candidate in values) {
    if (encode(candidate) == text) return candidate;
  }
  throw MosaicCommerceConfigurationException('$path is unsupported.');
}

String _enumString(
  Object? value,
  String path,
  Set<String> supported,
) {
  final text = _string(value, path);
  if (!supported.contains(text)) {
    throw MosaicCommerceConfigurationException('$path is unsupported.');
  }
  return text;
}

DateTime _timestamp(Object? value, String path) {
  final text = _pattern(value, path, _timestampPattern, 32);
  try {
    return DateTime.parse(text);
  } on FormatException {
    throw MosaicCommerceConfigurationException('$path is invalid.');
  }
}

Object? _canonicalize(Object? value) {
  if (value is List) {
    return <Object?>[for (final item in value) _canonicalize(item)];
  }
  if (value is Map) {
    final entries = value.entries.toList()
      ..sort(
        (left, right) => (left.key as String).compareTo(right.key as String),
      );
    return <String, Object?>{
      for (final entry in entries)
        entry.key as String: _canonicalize(entry.value),
    };
  }
  return value;
}

final RegExp _identifierPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _entitlementPattern = RegExp(r'^[a-z][a-z0-9_.-]*$');
final RegExp _digestPattern = RegExp(r'^sha256:[a-f0-9]{64}$');
final RegExp _adapterVersionPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9.+_-]*$');
final RegExp _reasonPattern =
    RegExp(r'^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$');
final RegExp _safePattern = RegExp(r'^[^\r\n\u0000-\u001F\u007F]+$');
final RegExp _timestampPattern = RegExp(
  r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$',
);
