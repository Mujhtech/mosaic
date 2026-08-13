import 'dart:convert';

import 'configuration_delivery.dart';
import 'sha256.dart';

/// The single Commerce Configuration contract version this SDK reads.
///
/// ADR-0028 collapsed every Mosaic contract to exactly one version, so this is
/// both the version the SDK negotiates and the version every accepted sidecar
/// declares. A document claiming any other version is rejected atomically.
const String mosaicCommerceConfigurationContractVersion = '2';
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

  /// When the Provider last observed this state, or `null` when the source
  /// reported none. Absence means unknown; it is never the configuration time.
  final DateTime? providerObservedAt;
  final DateTime synchronizedAt;

  /// When this state stops being current, or `null` when no source in the
  /// payload can establish it. Absence means unknown freshness.
  final DateTime? staleAt;
  final DateTime? expiresAt;
  final DateTime? configuredAt;
  final String? observationEnvironment;
}

final class MosaicCommerceConfiguration {
  MosaicCommerceConfiguration({
    this.version = mosaicCommerceConfigurationContractVersion,
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

  /// The Commerce Configuration contract this sidecar was read under.
  ///
  /// Exactly one contract version exists, so a decoded configuration always
  /// reports [mosaicCommerceConfigurationContractVersion]. The field is
  /// retained as the widening point for a future parallel version.
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
    this.version = mosaicCommerceConfigurationContractVersion,
    required this.configuration,
    required this.source,
  });

  final String version;
  final MosaicCommerceConfiguration configuration;
  final String source;
}

/// Strict reader for the single Commerce Configuration contract.
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
    final root = _root(source);
    const path = r'$.configuration';
    final raw = _object(root['configuration'], path);
    _expectKeys(
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
    _expectKeys(
      release,
      const <String>{'id', 'contentDigest'},
      '$path.configurationRelease',
    );
    final platform = _enumValue(
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
    final diagnostics = _diagnostics(raw['diagnostics'], '$path.diagnostics');
    // Freshness decoding can append a diagnostic, so it must run before the
    // configuration copies the list.
    final freshness = _freshness(
      raw['freshness'],
      '$path.freshness',
      provider.activation.source,
      diagnostics,
    );
    final configuration = MosaicCommerceConfiguration(
      id: _identifier(raw['id'], '$path.id'),
      environmentId: _identifier(raw['environmentId'], '$path.environmentId'),
      applicationId: _identifier(raw['applicationId'], '$path.applicationId'),
      storePlatform: platform,
      configurationReleaseId:
          _identifier(release['id'], '$path.configurationRelease.id'),
      configurationReleaseDigest: _digest(
        release['contentDigest'],
        '$path.configurationRelease.contentDigest',
      ),
      contentDigest: _digest(raw['contentDigest'], '$path.contentDigest'),
      activeProvider: provider,
      productMappings: _productMappings(
        raw['productMappings'],
        '$path.productMappings',
        provider.identity.id,
      ),
      entitlementMappings: _entitlementMappings(
        raw['entitlementMappings'],
        '$path.entitlementMappings',
      ),
      freshness: freshness,
      diagnostics: diagnostics,
    );
    _validateDigest(raw, configuration.contentDigest);
    _validateReleaseScope(
      configuration,
      expectedRelease: expectedRelease,
      expectedApplicationId: expectedApplicationId,
      expectedStorePlatform: expectedStorePlatform,
    );
    return MosaicCommerceConfigurationEnvelope(
      configuration: configuration,
      source: source,
    );
  }

  /// Parses the envelope and rejects anything that is not this contract.
  Map<String, Object?> _root(String source) {
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
      const <String>{'commerceConfigurationVersion', 'configuration'},
      r'$',
    );
    final version = _string(
      root['commerceConfigurationVersion'],
      r'$.commerceConfigurationVersion',
    );
    if (version != mosaicCommerceConfigurationContractVersion) {
      throw const MosaicCommerceConfigurationException(
        'The Commerce Configuration version is unsupported.',
      );
    }
    return root;
  }

  MosaicActiveProvider _activeProvider(
    Object? value,
    String path,
    MosaicStorePlatform platform,
  ) {
    final object = _object(value, path);
    _expectKeys(
      object,
      const <String>{'identity', 'activation', 'capabilities', 'recoveryMode'},
      path,
    );
    final identity = _object(object['identity'], '$path.identity');
    _expectKeys(
      identity,
      const <String>{'id', 'displayName', 'adapterVersion'},
      '$path.identity',
    );
    final providerId = _identifier(identity['id'], '$path.identity.id');
    return MosaicActiveProvider(
      identity: MosaicProviderIdentity(
        id: providerId,
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
      activation: _activation(
        object['activation'],
        '$path.activation',
        platform,
        providerId,
      ),
      capabilities: _capabilities(object['capabilities'], '$path.capabilities'),
      recoveryMode: _enumValue(
        object['recoveryMode'],
        '$path.recoveryMode',
        MosaicCommerceRecoveryMode.values,
        (value) => value.name,
      ),
    );
  }

  MosaicProviderActivation _activation(
    Object? value,
    String path,
    MosaicStorePlatform platform,
    String providerId,
  ) {
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
        _expectKeys(object, const <String>{'source', 'localSnapshotId'}, path);
        return MosaicSdkLocalProviderActivation(
          localSnapshotId: _identifier(
            object['localSnapshotId'],
            '$path.localSnapshotId',
          ),
        );
      case 'nativeStore':
        _expectKeys(object, const <String>{'source'}, path);
        if (platform == MosaicStorePlatform.ios && providerId != 'app_store' ||
            platform == MosaicStorePlatform.android &&
                providerId != 'google_play') {
          throw const MosaicCommerceConfigurationException(
            'The native Provider does not match the store platform.',
          );
        }
        return const MosaicNativeStoreProviderActivation();
      default:
        throw const MosaicCommerceConfigurationException(
          'The Provider activation source is unsupported.',
        );
    }
  }

  List<MosaicProviderCapability> _capabilities(Object? value, String path) {
    final values = _list(value, path, 1, 19);
    final capabilities = <MosaicProviderCapability>[];
    final seen = <MosaicProviderCapabilityName>{};
    for (var index = 0; index < values.length; index += 1) {
      final itemPath = '$path[$index]';
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
        MosaicProviderCapabilityName.values,
        (value) => value.wireValue,
      );
      final support = _enumValue(
        item['support'],
        '$itemPath.support',
        MosaicProviderCapabilitySupport.values,
        (value) => value.name,
      );
      final reasonCode = item.containsKey('reasonCode')
          ? _reasonCode(item['reasonCode'], '$itemPath.reasonCode')
          : null;
      if (!seen.add(name) ||
          (support == MosaicProviderCapabilitySupport.supported
              ? reasonCode != null
              : reasonCode == null)) {
        throw const MosaicCommerceConfigurationException(
          'A Provider capability is invalid or duplicated.',
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
    return capabilities;
  }

  List<MosaicCommerceProductMapping> _productMappings(
    Object? value,
    String path,
    String providerId,
  ) {
    final values = _list(value, path, 1, 256);
    final productIds = <String>{};
    final mappingIds = <String>{};
    final targets = <String>{};
    final result = <MosaicCommerceProductMapping>[];
    for (var index = 0; index < values.length; index += 1) {
      final itemPath = '$path[$index]';
      final object = _object(values[index], itemPath);
      _expectKeys(
        object,
        const <String>{
          'mosaicProductId',
          'mappingId',
          'productType',
          'entitlementKeys',
          'providerProductReference',
          'adapterMapping',
        },
        itemPath,
      );
      final productId =
          _identifier(object['mosaicProductId'], '$itemPath.mosaicProductId');
      final mappingId = _identifier(object['mappingId'], '$itemPath.mappingId');
      final productType = _enumValue(
        object['productType'],
        '$itemPath.productType',
        MosaicCommerceProductType.values,
        (value) => value.wireValue,
      );
      final reference = _opaqueProviderIdentifier(
        object['providerProductReference'],
        '$itemPath.providerProductReference',
      );
      final adapter =
          _object(object['adapterMapping'], '$itemPath.adapterMapping');
      final adapterMapping = _adapterMapping(
        adapter,
        '$itemPath.adapterMapping',
        providerId,
        productType,
      );
      final entitlementKeys =
          _list(object['entitlementKeys'], '$itemPath.entitlementKeys', 0, 32)
              .map((item) => _entitlementKey(item, '$itemPath.entitlementKeys'))
              .toList(growable: false);
      final target = '$reference:${jsonEncode(_canonicalize(adapter))}';
      if (!productIds.add(productId) ||
          !mappingIds.add(mappingId) ||
          !targets.add(target) ||
          entitlementKeys.toSet().length != entitlementKeys.length) {
        throw const MosaicCommerceConfigurationException(
          'The commerce configuration contains ambiguous Product mappings.',
        );
      }
      result.add(
        MosaicCommerceProductMapping(
          mosaicProductId: productId,
          mappingId: mappingId,
          providerProductReference: reference,
          adapterMapping: adapterMapping,
          productType: productType,
          entitlementKeys: List.unmodifiable(entitlementKeys),
        ),
      );
    }
    return result;
  }

  MosaicAdapterMapping _adapterMapping(
    Map<String, Object?> adapter,
    String path,
    String providerId,
    MosaicCommerceProductType productType,
  ) {
    switch (_string(adapter['kind'], '$path.kind')) {
      case 'directProduct':
        _expectKeys(adapter, const <String>{'kind'}, path);
        return const MosaicDirectProductMapping();
      case 'revenueCatPackage':
        _expectKeys(
          adapter,
          const <String>{'kind', 'offeringIdentifier', 'packageIdentifier'},
          path,
        );
        if (providerId != 'revenuecat') {
          throw const MosaicCommerceConfigurationException(
            'A RevenueCat Package mapping requires the RevenueCat Provider.',
          );
        }
        return MosaicRevenueCatPackageMapping(
          offeringIdentifier: _opaqueProviderIdentifier(
            adapter['offeringIdentifier'],
            '$path.offeringIdentifier',
          ),
          packageIdentifier: _opaqueProviderIdentifier(
            adapter['packageIdentifier'],
            '$path.packageIdentifier',
          ),
        );
      case 'storeKitProduct':
        _expectKeys(adapter, const <String>{'kind'}, path);
        if (providerId != 'app_store') {
          throw const MosaicCommerceConfigurationException(
            'A StoreKit mapping requires the App Store Provider.',
          );
        }
        return const MosaicStoreKitProductMapping();
      case 'googlePlayProduct':
        _expectKeys(
          adapter,
          const <String>{'kind'},
          path,
          optional: const <String>{'basePlanId', 'offerId'},
        );
        if (providerId != 'google_play') {
          throw const MosaicCommerceConfigurationException(
            'A Google Play mapping requires the Google Play Provider.',
          );
        }
        final basePlanId = adapter.containsKey('basePlanId')
            ? _opaqueProviderIdentifier(
                adapter['basePlanId'],
                '$path.basePlanId',
              )
            : null;
        final offerId = adapter.containsKey('offerId')
            ? _opaqueProviderIdentifier(adapter['offerId'], '$path.offerId')
            : null;
        if (productType == MosaicCommerceProductType.subscription
            ? basePlanId == null
            : basePlanId != null || offerId != null) {
          throw const MosaicCommerceConfigurationException(
            'The Google Play mapping does not match its Product type.',
          );
        }
        return MosaicGooglePlayProductMapping(
          basePlanId: basePlanId,
          offerId: offerId,
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
    final values = _list(value, path, 0, 128);
    final keys = <String>{};
    final providerIds = <String>{};
    final result = <MosaicCommerceEntitlementMapping>[];
    for (var index = 0; index < values.length; index += 1) {
      final itemPath = '$path[$index]';
      final item = _object(values[index], itemPath);
      _expectKeys(
        item,
        const <String>{'mosaicEntitlementKey', 'providerEntitlementIdentifier'},
        itemPath,
      );
      final key = _entitlementKey(
        item['mosaicEntitlementKey'],
        '$itemPath.mosaicEntitlementKey',
      );
      final providerIdentifier = _opaqueProviderIdentifier(
        item['providerEntitlementIdentifier'],
        '$itemPath.providerEntitlementIdentifier',
      );
      if (!keys.add(key) || !providerIds.add(providerIdentifier)) {
        throw const MosaicCommerceConfigurationException(
          'The commerce configuration contains ambiguous Entitlement mappings.',
        );
      }
      result.add(
        MosaicCommerceEntitlementMapping(
          mosaicEntitlementKey: key,
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
    List<MosaicCommerceDiagnostic> diagnostics,
  ) {
    final object = _object(value, path);
    return _string(object['source'], '$path.source') ==
            'nativeStoreConfiguration'
        ? _nativeStoreFreshness(object, path, activationSource, diagnostics)
        : _synchronizedFreshness(object, path, activationSource);
  }

  MosaicCommerceFreshness _synchronizedFreshness(
    Map<String, Object?> object,
    String path,
    String activationSource,
  ) {
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

  MosaicCommerceFreshness _nativeStoreFreshness(
    Map<String, Object?> object,
    String path,
    String activationSource,
    List<MosaicCommerceDiagnostic> diagnostics,
  ) {
    _expectKeys(
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
    final configuredAt =
        _timestamp(object['configuredAt'], '$path.configuredAt');
    DateTime? observedAt;
    DateTime? expiresAt;
    String? environment;
    if (object['observation'] case final Object observationValue) {
      final observation = _object(observationValue, '$path.observation');
      _expectKeys(
        observation,
        const <String>{'environment', 'observedAt'},
        '$path.observation',
        optional: const <String>{'expiresAt'},
      );
      environment = _observationEnvironment(
        observation['environment'],
        '$path.observation.environment',
      );
      observedAt =
          _timestamp(observation['observedAt'], '$path.observation.observedAt');
      expiresAt = observation.containsKey('expiresAt')
          ? _timestamp(observation['expiresAt'], '$path.observation.expiresAt')
          : null;
      if (expiresAt != null && expiresAt.isBefore(observedAt)) {
        throw const MosaicCommerceConfigurationException(
          'Native commerce freshness timestamps are inconsistent.',
        );
      }
    } else {
      diagnostics.add(
        MosaicCommerceDiagnostic(
          code: 'commerce.freshness.unobserved',
          safeMessage: 'The native store configuration carries no Provider '
              'observation, so its freshness is unknown.',
          severity: MosaicCommerceDiagnosticSeverity.warning,
          retryable: false,
          correlationId: 'commerce_freshness_unobserved',
          recoveryAction: MosaicCommerceRecoveryAction.none,
        ),
      );
    }
    return MosaicCommerceFreshness(
      source: MosaicCommerceFreshnessSource.nativeStoreConfiguration,
      status: _enumValue(
        object['status'],
        '$path.status',
        MosaicCommerceFreshnessStatus.values,
        (value) => value.name,
      ),
      // A native-store configuration without an observation says nothing about
      // when the Provider last looked. Reporting the configuration time as the
      // observation, and as the staleness horizon, would make never-observed
      // state read as freshly observed, so absence is propagated as absence.
      providerObservedAt: observedAt,
      synchronizedAt: configuredAt,
      staleAt: expiresAt ?? observedAt,
      expiresAt: expiresAt,
      configuredAt: configuredAt,
      observationEnvironment: environment,
    );
  }

  List<MosaicCommerceDiagnostic> _diagnostics(Object? value, String path) {
    final values = _list(value, path, 0, 32);
    return <MosaicCommerceDiagnostic>[
      for (var index = 0; index < values.length; index += 1)
        _diagnostic(values[index], '$path[$index]'),
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
    final rawRetryAfter = object['retryAfterSeconds'];
    final retryAfterSeconds = rawRetryAfter == null
        ? null
        : _integer(rawRetryAfter, '$path.retryAfterSeconds', 1, 86400);
    if (retryAfterSeconds != null && !retryable) {
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
      retryAfterSeconds: retryAfterSeconds,
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

  void _validateDigest(Map<String, Object?> rawConfiguration, String expected) {
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

  void _validateReleaseScope(
    MosaicCommerceConfiguration configuration, {
    required MosaicConfigurationRelease expectedRelease,
    required String expectedApplicationId,
    required MosaicStorePlatform expectedStorePlatform,
  }) {
    final mappedProducts = configuration.productMappings
        .map((mapping) => mapping.mosaicProductId)
        .toSet();
    if (configuration.environmentId != expectedRelease.environment.id ||
        configuration.applicationId != expectedApplicationId ||
        configuration.storePlatform != expectedStorePlatform ||
        configuration.configurationReleaseId != expectedRelease.id ||
        configuration.configurationReleaseDigest !=
            expectedRelease.contentDigest ||
        mappedProducts.length != expectedRelease.productReferences.length ||
        !mappedProducts.containsAll(expectedRelease.productReferences.keys)) {
      throw const MosaicCommerceConfigurationException(
        'The commerce configuration does not match the accepted release scope.',
      );
    }
    for (final mapping in configuration.productMappings) {
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

String _entitlementKey(Object? value, String path) =>
    _patternString(value, path, _entitlementPattern, 64);

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

String _observationEnvironment(Object? value, String path) {
  final text = _string(value, path);
  if (!const <String>{'test', 'production', 'unknown'}.contains(text)) {
    throw MosaicCommerceConfigurationException('$path is unsupported.');
  }
  return text;
}

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
