import 'dart:convert';

import 'commerce_configuration_v2.dart';
import 'configuration_delivery.dart';
import 'sha256.dart';

const String mosaicCommerceConfigurationVersion = '1';
const List<String> mosaicSupportedCommerceConfigurationVersions = <String>[
  '2',
  '1',
];
const List<String> mosaicSupportedCommerceProviderContractVersions = <String>[
  '2',
  '1',
];
const int mosaicMaximumCommerceConfigurationBytes = 1024 * 1024;

final class MosaicCommerceConfigurationException implements Exception {
  const MosaicCommerceConfigurationException(this.message);

  final String message;

  @override
  String toString() => 'MosaicCommerceConfigurationException: $message';
}

enum MosaicStorePlatform {
  ios('ios'),
  android('android');

  const MosaicStorePlatform(this.wireValue);

  final String wireValue;
}

enum MosaicCommerceProductType {
  subscription('subscription'),
  oneTimeNonConsumable('one_time_non_consumable');

  const MosaicCommerceProductType(this.wireValue);

  final String wireValue;
}

enum MosaicProviderCapabilityName {
  productLoading('productLoading'),
  subscriptions('subscriptions'),
  oneTimeNonConsumables('oneTimeNonConsumables'),
  trials('trials'),
  introductoryOffers('introductoryOffers'),
  promotionalOffers('promotionalOffers'),
  restore('restore'),
  activeEntitlementLookup('activeEntitlementLookup'),
  pendingPurchases('pendingPurchases'),
  deferredPurchases('deferredPurchases'),
  serverConfirmedTransactions('serverConfirmedTransactions'),
  productSynchronization('productSynchronization'),
  providerDiagnostics('providerDiagnostics'),
  basePlans('basePlans'),
  explicitOffers('explicitOffers'),
  storeSynchronization('storeSynchronization'),
  activePurchaseRecovery('activePurchaseRecovery'),
  asynchronousCommerceUpdates('asynchronousCommerceUpdates'),
  localDeliveryAcceptance('localDeliveryAcceptance');

  const MosaicProviderCapabilityName(this.wireValue);

  final String wireValue;
}

enum MosaicProviderCapabilitySupport {
  supported,
  unsupported,
  conditional,
}

final class MosaicProviderIdentity {
  const MosaicProviderIdentity({
    required this.id,
    required this.displayName,
    required this.adapterVersion,
  });

  final String id;
  final String displayName;
  final String adapterVersion;
}

final class MosaicProviderCapability {
  const MosaicProviderCapability({
    required this.name,
    required this.support,
    this.reasonCode,
  });

  final MosaicProviderCapabilityName name;
  final MosaicProviderCapabilitySupport support;
  final String? reasonCode;
}

enum MosaicCommerceDiagnosticSeverity { info, warning, error }

enum MosaicCommerceRecoveryAction {
  retry,
  reconnectProvider,
  fixProductMapping,
  updateProviderConfiguration,
  contactProvider,
  none,
}

final class MosaicCommerceDiagnostic {
  const MosaicCommerceDiagnostic({
    required this.code,
    required this.safeMessage,
    required this.severity,
    required this.retryable,
    required this.correlationId,
    this.retryAfterSeconds,
    this.providerCode,
    this.mosaicProductId,
    this.recoveryAction,
  });

  final String code;
  final String safeMessage;
  final MosaicCommerceDiagnosticSeverity severity;
  final bool retryable;
  final String correlationId;
  final int? retryAfterSeconds;
  final String? providerCode;
  final String? mosaicProductId;
  final MosaicCommerceRecoveryAction? recoveryAction;
}

sealed class MosaicProviderActivation {
  const MosaicProviderActivation();

  String get source;
}

final class MosaicProviderConnectionActivation
    extends MosaicProviderActivation {
  const MosaicProviderConnectionActivation({
    required this.providerConnectionId,
  });

  final String providerConnectionId;

  @override
  String get source => 'providerConnection';
}

final class MosaicSdkLocalProviderActivation extends MosaicProviderActivation {
  const MosaicSdkLocalProviderActivation({required this.localSnapshotId});

  final String localSnapshotId;

  @override
  String get source => 'sdkLocal';
}

final class MosaicNativeStoreProviderActivation
    extends MosaicProviderActivation {
  const MosaicNativeStoreProviderActivation();

  @override
  String get source => 'nativeStore';
}

enum MosaicCommerceRecoveryMode {
  providerDefined,
  storeSynchronization,
  activePurchaseRecovery,
}

final class MosaicActiveProvider {
  MosaicActiveProvider({
    required this.identity,
    required this.activation,
    required Iterable<MosaicProviderCapability> capabilities,
    this.recoveryMode = MosaicCommerceRecoveryMode.providerDefined,
  }) : capabilities = List.unmodifiable(capabilities);

  final MosaicProviderIdentity identity;
  final MosaicProviderActivation activation;
  final List<MosaicProviderCapability> capabilities;
  final MosaicCommerceRecoveryMode recoveryMode;

  MosaicProviderCapability? capability(MosaicProviderCapabilityName name) {
    for (final capability in capabilities) {
      if (capability.name == name) return capability;
    }
    return null;
  }
}

sealed class MosaicAdapterMapping {
  const MosaicAdapterMapping();

  String get kind;
}

final class MosaicDirectProductMapping extends MosaicAdapterMapping {
  const MosaicDirectProductMapping();

  @override
  String get kind => 'directProduct';
}

final class MosaicRevenueCatPackageMapping extends MosaicAdapterMapping {
  const MosaicRevenueCatPackageMapping({
    required this.offeringIdentifier,
    required this.packageIdentifier,
  });

  final String offeringIdentifier;
  final String packageIdentifier;

  @override
  String get kind => 'revenueCatPackage';
}

final class MosaicStoreKitProductMapping extends MosaicAdapterMapping {
  const MosaicStoreKitProductMapping();

  @override
  String get kind => 'storeKitProduct';
}

final class MosaicGooglePlayProductMapping extends MosaicAdapterMapping {
  const MosaicGooglePlayProductMapping({
    this.basePlanId,
    this.offerId,
  });

  final String? basePlanId;
  final String? offerId;

  @override
  String get kind => 'googlePlayProduct';
}

final class MosaicCommerceProductMapping {
  const MosaicCommerceProductMapping({
    required this.mosaicProductId,
    required this.mappingId,
    required this.providerProductReference,
    required this.adapterMapping,
    this.productType,
    this.entitlementKeys = const <String>[],
  });

  final String mosaicProductId;
  final String mappingId;
  final String providerProductReference;
  final MosaicAdapterMapping adapterMapping;
  final MosaicCommerceProductType? productType;
  final List<String> entitlementKeys;
}

final class MosaicCommerceEntitlementMapping {
  const MosaicCommerceEntitlementMapping({
    required this.mosaicEntitlementKey,
    required this.providerEntitlementIdentifier,
  });

  final String mosaicEntitlementKey;
  final String providerEntitlementIdentifier;
}

enum MosaicCommerceFreshnessSource {
  providerSynchronization,
  sdkLocalSnapshot,
  nativeStoreConfiguration,
}

enum MosaicCommerceFreshnessStatus { configured, fresh, stale }

final class MosaicCommerceFreshness {
  const MosaicCommerceFreshness({
    required this.source,
    required this.status,
    required this.providerObservedAt,
    required this.synchronizedAt,
    required this.staleAt,
    this.expiresAt,
    this.configuredAt,
    this.observationEnvironment,
  });

  final MosaicCommerceFreshnessSource source;
  final MosaicCommerceFreshnessStatus status;
  final DateTime providerObservedAt;
  final DateTime synchronizedAt;
  final DateTime staleAt;
  final DateTime? expiresAt;
  final DateTime? configuredAt;
  final String? observationEnvironment;
}

final class MosaicCommerceConfiguration {
  MosaicCommerceConfiguration({
    this.version = mosaicCommerceConfigurationVersion,
    required this.id,
    required this.environmentId,
    required this.applicationId,
    required this.storePlatform,
    required this.configurationReleaseId,
    required this.configurationReleaseDigest,
    required this.contentDigest,
    required this.activeProvider,
    required Iterable<MosaicCommerceProductMapping> productMappings,
    required Iterable<MosaicCommerceEntitlementMapping> entitlementMappings,
    required this.freshness,
    required Iterable<MosaicCommerceDiagnostic> diagnostics,
  })  : productMappings = List.unmodifiable(productMappings),
        entitlementMappings = List.unmodifiable(entitlementMappings),
        diagnostics = List.unmodifiable(diagnostics),
        _productMappingsById =
            Map.unmodifiable(<String, MosaicCommerceProductMapping>{
          for (final mapping in productMappings)
            mapping.mosaicProductId: mapping,
        }),
        _mosaicEntitlementByProviderId = Map.unmodifiable(<String, String>{
          for (final mapping in entitlementMappings)
            mapping.providerEntitlementIdentifier: mapping.mosaicEntitlementKey,
        });

  final String id;
  final String version;
  final String environmentId;
  final String applicationId;
  final MosaicStorePlatform storePlatform;
  final String configurationReleaseId;
  final String configurationReleaseDigest;
  final String contentDigest;
  final MosaicActiveProvider activeProvider;
  final List<MosaicCommerceProductMapping> productMappings;
  final List<MosaicCommerceEntitlementMapping> entitlementMappings;
  final MosaicCommerceFreshness freshness;
  final List<MosaicCommerceDiagnostic> diagnostics;
  final Map<String, MosaicCommerceProductMapping> _productMappingsById;
  final Map<String, String> _mosaicEntitlementByProviderId;

  MosaicCommerceProductMapping? mappingForProduct(String mosaicProductId) =>
      _productMappingsById[mosaicProductId];

  Set<String> mosaicEntitlementsForProviderIds(
    Iterable<String> providerIdentifiers,
  ) =>
      Set.unmodifiable(
        providerIdentifiers
            .map((identifier) => _mosaicEntitlementByProviderId[identifier])
            .whereType<String>(),
      );
}

final class MosaicCommerceConfigurationEnvelope {
  const MosaicCommerceConfigurationEnvelope({
    required this.version,
    required this.configuration,
    required this.source,
  });

  final String version;
  final MosaicCommerceConfiguration configuration;
  final String source;
}

/// Strict Commerce Configuration v1 reader.
///
/// The complete sidecar is validated before use. Its canonical digest and
/// Environment, Application, platform, Release ID, Release digest, and Product
/// set must all bind to the already accepted Configuration Delivery release.
final class MosaicCommerceConfigurationDecoder {
  const MosaicCommerceConfigurationDecoder();

  MosaicCommerceConfigurationEnvelope decode(
    String source, {
    required MosaicConfigurationRelease expectedRelease,
    required String expectedApplicationId,
    required MosaicStorePlatform expectedStorePlatform,
  }) {
    if (utf8.encode(source).length > mosaicMaximumCommerceConfigurationBytes) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration exceeds the SDK byte limit.',
      );
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration is not valid JSON.',
      );
    }
    _rejectCredentialMaterial(decoded);
    final root = _object(decoded, r'$');
    _expectKeys(
      root,
      const <String>{
        'commerceConfigurationVersion',
        'configuration',
      },
      r'$',
    );
    final version = _string(
      root['commerceConfigurationVersion'],
      r'$.commerceConfigurationVersion',
    );
    if (version == '2') {
      return MosaicCommerceConfigurationV2Decoder.decode(
        source,
        expectedRelease: expectedRelease,
        expectedApplicationId: expectedApplicationId,
        expectedStorePlatform: expectedStorePlatform,
      );
    }
    if (version != mosaicCommerceConfigurationVersion) {
      throw const MosaicCommerceConfigurationException(
        'The Commerce Configuration version is unsupported.',
      );
    }
    final rawConfiguration = _object(root['configuration'], r'$.configuration');
    final configuration = _configuration(rawConfiguration);
    _validateDigest(rawConfiguration, configuration.contentDigest);
    _validateAssociation(
      configuration,
      expectedRelease: expectedRelease,
      expectedApplicationId: expectedApplicationId,
      expectedStorePlatform: expectedStorePlatform,
    );
    return MosaicCommerceConfigurationEnvelope(
      version: version,
      configuration: configuration,
      source: source,
    );
  }

  MosaicCommerceConfiguration _configuration(Map<String, Object?> value) {
    const path = r'$.configuration';
    _expectKeys(
      value,
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
        _object(value['configurationRelease'], '$path.configurationRelease');
    _expectKeys(
      release,
      const <String>{'id', 'contentDigest'},
      '$path.configurationRelease',
    );
    final activeProvider =
        _activeProvider(value['activeProvider'], '$path.activeProvider');
    final products = _productMappings(
      value['productMappings'],
      '$path.productMappings',
      activeProvider.identity.id,
    );
    final entitlements = _entitlementMappings(
      value['entitlementMappings'],
      '$path.entitlementMappings',
    );
    return MosaicCommerceConfiguration(
      id: _identifier(value['id'], '$path.id'),
      environmentId: _identifier(value['environmentId'], '$path.environmentId'),
      applicationId: _identifier(value['applicationId'], '$path.applicationId'),
      storePlatform: _enumValue(
        value['storePlatform'],
        '$path.storePlatform',
        MosaicStorePlatform.values,
        (item) => item.wireValue,
      ),
      configurationReleaseId:
          _identifier(release['id'], '$path.configurationRelease.id'),
      configurationReleaseDigest: _digest(
        release['contentDigest'],
        '$path.configurationRelease.contentDigest',
      ),
      contentDigest: _digest(value['contentDigest'], '$path.contentDigest'),
      activeProvider: activeProvider,
      productMappings: products,
      entitlementMappings: entitlements,
      freshness: _freshness(
        value['freshness'],
        '$path.freshness',
        activeProvider.activation.source,
      ),
      diagnostics: _diagnostics(value['diagnostics'], '$path.diagnostics'),
    );
  }

  MosaicActiveProvider _activeProvider(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'identity', 'activation', 'capabilities'},
      path,
    );
    final identity = _object(object['identity'], '$path.identity');
    _expectKeys(
      identity,
      const <String>{'id', 'displayName', 'adapterVersion'},
      '$path.identity',
    );
    final activation = _activation(object['activation'], '$path.activation');
    final values = _list(object['capabilities'], '$path.capabilities', 1, 13);
    final capabilities = <MosaicProviderCapability>[];
    final seen = <MosaicProviderCapabilityName>{};
    for (var index = 0; index < values.length; index += 1) {
      final itemPath = '$path.capabilities[$index]';
      final item = _object(values[index], itemPath);
      _expectKeys(
        item,
        const <String>{'name', 'support'},
        itemPath,
        optional: const <String>{'reasonCode'},
      );
      final name = _enumValue(
        item['name'],
        '$itemPath.name',
        _v1CapabilityNames,
        (value) => value.wireValue,
      );
      if (!seen.add(name)) {
        throw const MosaicCommerceConfigurationException(
          'The active Provider contains duplicate capabilities.',
        );
      }
      final support = _enumValue(
        item['support'],
        '$itemPath.support',
        MosaicProviderCapabilitySupport.values,
        (value) => value.name,
      );
      final reasonCode = item.containsKey('reasonCode')
          ? _reasonCode(item['reasonCode'], '$itemPath.reasonCode')
          : null;
      if (support == MosaicProviderCapabilitySupport.supported
          ? reasonCode != null
          : reasonCode == null) {
        throw const MosaicCommerceConfigurationException(
          'A Provider capability has inconsistent support details.',
        );
      }
      capabilities.add(
        MosaicProviderCapability(
          name: name,
          support: support,
          reasonCode: reasonCode,
        ),
      );
    }
    return MosaicActiveProvider(
      identity: MosaicProviderIdentity(
        id: _identifier(identity['id'], '$path.identity.id'),
        displayName: _safeText(
          identity['displayName'],
          '$path.identity.displayName',
        ),
        adapterVersion: _patternString(
          identity['adapterVersion'],
          '$path.identity.adapterVersion',
          _adapterVersionPattern,
          64,
        ),
      ),
      activation: activation,
      capabilities: capabilities,
    );
  }

  MosaicProviderActivation _activation(Object? value, String path) {
    final object = _object(value, path);
    final source = _string(object['source'], '$path.source');
    switch (source) {
      case 'providerConnection':
        _expectKeys(
          object,
          const <String>{'source', 'providerConnectionId'},
          path,
        );
        return MosaicProviderConnectionActivation(
          providerConnectionId: _identifier(
            object['providerConnectionId'],
            '$path.providerConnectionId',
          ),
        );
      case 'sdkLocal':
        _expectKeys(
          object,
          const <String>{'source', 'localSnapshotId'},
          path,
        );
        return MosaicSdkLocalProviderActivation(
          localSnapshotId: _identifier(
            object['localSnapshotId'],
            '$path.localSnapshotId',
          ),
        );
      default:
        throw const MosaicCommerceConfigurationException(
          'The Provider activation source is unsupported.',
        );
    }
  }

  List<MosaicCommerceProductMapping> _productMappings(
    Object? value,
    String path,
    String providerId,
  ) {
    final entries = _list(value, path, 1, 256);
    final result = <MosaicCommerceProductMapping>[];
    final productIds = <String>{};
    final mappingIds = <String>{};
    final targets = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final itemPath = '$path[$index]';
      final object = _object(entries[index], itemPath);
      _expectKeys(
        object,
        const <String>{
          'mosaicProductId',
          'mappingId',
          'providerProductReference',
          'adapterMapping',
        },
        itemPath,
      );
      final productId =
          _identifier(object['mosaicProductId'], '$itemPath.mosaicProductId');
      final mappingId = _identifier(object['mappingId'], '$itemPath.mappingId');
      final reference = _opaqueProviderIdentifier(
        object['providerProductReference'],
        '$itemPath.providerProductReference',
      );
      final adapter =
          _adapterMapping(object['adapterMapping'], '$itemPath.adapterMapping');
      final target =
          '$reference:${jsonEncode(_canonicalize(object['adapterMapping']))}';
      if (!productIds.add(productId) ||
          !mappingIds.add(mappingId) ||
          !targets.add(target)) {
        throw const MosaicCommerceConfigurationException(
          'The commerce configuration contains ambiguous Product mappings.',
        );
      }
      if (adapter is MosaicRevenueCatPackageMapping &&
          providerId != 'revenuecat') {
        throw const MosaicCommerceConfigurationException(
          'A RevenueCat Package mapping requires the RevenueCat Provider.',
        );
      }
      result.add(
        MosaicCommerceProductMapping(
          mosaicProductId: productId,
          mappingId: mappingId,
          providerProductReference: reference,
          adapterMapping: adapter,
        ),
      );
    }
    return result;
  }

  MosaicAdapterMapping _adapterMapping(Object? value, String path) {
    final object = _object(value, path);
    final kind = _string(object['kind'], '$path.kind');
    switch (kind) {
      case 'directProduct':
        _expectKeys(object, const <String>{'kind'}, path);
        return const MosaicDirectProductMapping();
      case 'revenueCatPackage':
        _expectKeys(
          object,
          const <String>{
            'kind',
            'offeringIdentifier',
            'packageIdentifier',
          },
          path,
        );
        return MosaicRevenueCatPackageMapping(
          offeringIdentifier: _opaqueProviderIdentifier(
            object['offeringIdentifier'],
            '$path.offeringIdentifier',
          ),
          packageIdentifier: _opaqueProviderIdentifier(
            object['packageIdentifier'],
            '$path.packageIdentifier',
          ),
        );
      default:
        throw const MosaicCommerceConfigurationException(
          'The commerce adapter mapping is unsupported.',
        );
    }
  }

  List<MosaicCommerceEntitlementMapping> _entitlementMappings(
    Object? value,
    String path,
  ) {
    final entries = _list(value, path, 1, 128);
    final result = <MosaicCommerceEntitlementMapping>[];
    final mosaicIds = <String>{};
    final providerIds = <String>{};
    for (var index = 0; index < entries.length; index += 1) {
      final itemPath = '$path[$index]';
      final object = _object(entries[index], itemPath);
      _expectKeys(
        object,
        const <String>{
          'mosaicEntitlementKey',
          'providerEntitlementIdentifier',
        },
        itemPath,
      );
      final mosaicId = _patternString(
        object['mosaicEntitlementKey'],
        '$itemPath.mosaicEntitlementKey',
        _entitlementPattern,
        64,
      );
      final providerIdentifier = _opaqueProviderIdentifier(
        object['providerEntitlementIdentifier'],
        '$itemPath.providerEntitlementIdentifier',
      );
      if (!mosaicIds.add(mosaicId) || !providerIds.add(providerIdentifier)) {
        throw const MosaicCommerceConfigurationException(
          'The commerce configuration contains ambiguous Entitlement mappings.',
        );
      }
      result.add(
        MosaicCommerceEntitlementMapping(
          mosaicEntitlementKey: mosaicId,
          providerEntitlementIdentifier: providerIdentifier,
        ),
      );
    }
    return result;
  }

  MosaicCommerceFreshness _freshness(
    Object? value,
    String path,
    String activationSource,
  ) {
    final object = _object(value, path);
    _expectKeys(
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
    final source = _enumValue(
      object['source'],
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
    if (source != expected) {
      throw const MosaicCommerceConfigurationException(
        'Commerce freshness does not match the Provider activation.',
      );
    }
    final observed =
        _timestamp(object['providerObservedAt'], '$path.providerObservedAt');
    final synchronized =
        _timestamp(object['synchronizedAt'], '$path.synchronizedAt');
    final staleAt = _timestamp(object['staleAt'], '$path.staleAt');
    final expiresAt = object.containsKey('expiresAt')
        ? _timestamp(object['expiresAt'], '$path.expiresAt')
        : null;
    if (synchronized.isBefore(observed) ||
        staleAt.isBefore(synchronized) ||
        expiresAt != null && expiresAt.isBefore(staleAt)) {
      throw const MosaicCommerceConfigurationException(
        'Commerce freshness timestamps are inconsistent.',
      );
    }
    return MosaicCommerceFreshness(
      source: source,
      status: _enumValue(
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
      expiresAt: expiresAt,
    );
  }

  List<MosaicCommerceDiagnostic> _diagnostics(Object? value, String path) {
    final entries = _list(value, path, 0, 32);
    return <MosaicCommerceDiagnostic>[
      for (var index = 0; index < entries.length; index += 1)
        _diagnostic(entries[index], '$path[$index]'),
    ];
  }

  MosaicCommerceDiagnostic _diagnostic(Object? value, String path) {
    final object = _object(value, path);
    _expectKeys(
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
    final retryable = _boolean(object['retryable'], '$path.retryable');
    final retryAfter = object.containsKey('retryAfterSeconds')
        ? _integer(
            object['retryAfterSeconds'],
            '$path.retryAfterSeconds',
            1,
            86400,
          )
        : null;
    if (!retryable && retryAfter != null) {
      throw const MosaicCommerceConfigurationException(
        'A non-retryable diagnostic cannot include retry-after.',
      );
    }
    return MosaicCommerceDiagnostic(
      code: _reasonCode(object['code'], '$path.code'),
      safeMessage: _safeText(object['safeMessage'], '$path.safeMessage'),
      severity: _enumValue(
        object['severity'],
        '$path.severity',
        MosaicCommerceDiagnosticSeverity.values,
        (value) => value.name,
      ),
      retryable: retryable,
      correlationId:
          _identifier(object['correlationId'], '$path.correlationId'),
      retryAfterSeconds: retryAfter,
      providerCode: object.containsKey('providerCode')
          ? _safeProviderCode(object['providerCode'], '$path.providerCode')
          : null,
      mosaicProductId: object.containsKey('mosaicProductId')
          ? _identifier(object['mosaicProductId'], '$path.mosaicProductId')
          : null,
      recoveryAction: object.containsKey('recoveryAction')
          ? _enumValue<MosaicCommerceRecoveryAction>(
              object['recoveryAction'],
              '$path.recoveryAction',
              MosaicCommerceRecoveryAction.values,
              (value) => value.name,
            )
          : null,
    );
  }

  void _validateDigest(
    Map<String, Object?> rawConfiguration,
    String expected,
  ) {
    final material = Map<String, Object?>.of(rawConfiguration)
      ..remove('contentDigest');
    final actual =
        'sha256:${mosaicSha256String(jsonEncode(_canonicalize(material)))}';
    if (actual != expected) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration content digest does not match.',
      );
    }
  }

  void _validateAssociation(
    MosaicCommerceConfiguration configuration, {
    required MosaicConfigurationRelease expectedRelease,
    required String expectedApplicationId,
    required MosaicStorePlatform expectedStorePlatform,
  }) {
    if (configuration.environmentId != expectedRelease.environment.id ||
        configuration.applicationId != expectedApplicationId ||
        configuration.storePlatform != expectedStorePlatform ||
        configuration.configurationReleaseId != expectedRelease.id ||
        configuration.configurationReleaseDigest !=
            expectedRelease.contentDigest) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration does not match the accepted release scope.',
      );
    }
    final expectedProducts = expectedRelease.productReferences.keys.toSet();
    final mappedProducts = configuration.productMappings
        .map((mapping) => mapping.mosaicProductId)
        .toSet();
    if (expectedProducts.length != mappedProducts.length ||
        !expectedProducts.containsAll(mappedProducts)) {
      throw const MosaicCommerceConfigurationException(
        'The commerce Product mappings do not match the accepted release.',
      );
    }
  }
}

Map<String, Object?> _object(Object? value, String path) {
  if (value is! Map) {
    throw MosaicCommerceConfigurationException('$path must be an object.');
  }
  try {
    return value.cast<String, Object?>();
  } on Object {
    throw MosaicCommerceConfigurationException(
      '$path must use string properties.',
    );
  }
}

List<Object?> _list(
  Object? value,
  String path,
  int minimum,
  int maximum,
) {
  if (value is! List || value.length < minimum || value.length > maximum) {
    throw MosaicCommerceConfigurationException(
      '$path must contain between $minimum and $maximum items.',
    );
  }
  return value.cast<Object?>();
}

void _expectKeys(
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

String _patternString(
  Object? value,
  String path,
  RegExp pattern,
  int maximumLength,
) {
  final text = _string(value, path);
  if (text.isEmpty || text.length > maximumLength || !pattern.hasMatch(text)) {
    throw MosaicCommerceConfigurationException('$path is invalid.');
  }
  return text;
}

String _identifier(Object? value, String path) =>
    _patternString(value, path, _identifierPattern, 128);

String _digest(Object? value, String path) =>
    _patternString(value, path, _digestPattern, 71);

String _reasonCode(Object? value, String path) =>
    _patternString(value, path, _reasonCodePattern, 96);

String _safeText(Object? value, String path) =>
    _patternString(value, path, _safeTextPattern, 240);

String _safeProviderCode(Object? value, String path) =>
    _patternString(value, path, _safeTextPattern, 128);

String _opaqueProviderIdentifier(Object? value, String path) =>
    _patternString(value, path, _safeTextPattern, 256);

bool _boolean(Object? value, String path) {
  if (value is! bool) {
    throw MosaicCommerceConfigurationException('$path must be a boolean.');
  }
  return value;
}

int _integer(Object? value, String path, int minimum, int maximum) {
  if (value is! int || value < minimum || value > maximum) {
    throw MosaicCommerceConfigurationException('$path must be an integer.');
  }
  return value;
}

T _enumValue<T>(
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

DateTime _timestamp(Object? value, String path) {
  final text = _patternString(value, path, _timestampPattern, 32);
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
          (left, right) => (left.key as String).compareTo(right.key as String));
    return <String, Object?>{
      for (final entry in entries)
        entry.key as String: _canonicalize(entry.value),
    };
  }
  return value;
}

void _rejectCredentialMaterial(Object? value) {
  if (value is String && _credentialPattern.hasMatch(value)) {
    throw const MosaicCommerceConfigurationException(
      'Credential material is forbidden in Commerce Configuration.',
    );
  }
  if (value is List) {
    for (final item in value) {
      _rejectCredentialMaterial(item);
    }
  } else if (value is Map) {
    for (final item in value.values) {
      _rejectCredentialMaterial(item);
    }
  }
}

final RegExp _identifierPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _entitlementPattern = RegExp(r'^[a-z][a-z0-9_.-]*$');
final RegExp _digestPattern = RegExp(r'^sha256:[a-f0-9]{64}$');
final RegExp _adapterVersionPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9.+_-]*$');
final RegExp _reasonCodePattern =
    RegExp(r'^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$');
final RegExp _safeTextPattern = RegExp(r'^[^\r\n\u0000-\u001F\u007F]+$');
final RegExp _timestampPattern = RegExp(
  r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$',
);
final RegExp _credentialPattern = RegExp(
  r'(?:^|[^A-Za-z0-9])(?:sk_|appl_|goog_|rcb_)[A-Za-z0-9_-]{8,}|authorization\s*:|bearer\s+',
  caseSensitive: false,
);

const List<MosaicProviderCapabilityName> _v1CapabilityNames =
    <MosaicProviderCapabilityName>[
  MosaicProviderCapabilityName.productLoading,
  MosaicProviderCapabilityName.subscriptions,
  MosaicProviderCapabilityName.oneTimeNonConsumables,
  MosaicProviderCapabilityName.trials,
  MosaicProviderCapabilityName.introductoryOffers,
  MosaicProviderCapabilityName.promotionalOffers,
  MosaicProviderCapabilityName.restore,
  MosaicProviderCapabilityName.activeEntitlementLookup,
  MosaicProviderCapabilityName.pendingPurchases,
  MosaicProviderCapabilityName.deferredPurchases,
  MosaicProviderCapabilityName.serverConfirmedTransactions,
  MosaicProviderCapabilityName.productSynchronization,
  MosaicProviderCapabilityName.providerDiagnostics,
];
