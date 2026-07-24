import 'dart:async';

import 'package:flutter/services.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

const int mosaicNativeStoreChannelCodecVersion = 1;
const String mosaicNativeStoreChannelName =
    'dev.mosaic/native_store/commerce_v1';

abstract interface class MosaicNativeStoreChannel {
  Future<Object?> invoke(String method, [Map<String, Object?>? arguments]);

  void setHandler(Future<Object?> Function(String, Object?)? handler);
}

final class MethodChannelMosaicNativeStoreChannel
    implements MosaicNativeStoreChannel {
  MethodChannelMosaicNativeStoreChannel({
    MethodChannel channel = const MethodChannel(mosaicNativeStoreChannelName),
  }) : _channel = channel;

  final MethodChannel _channel;

  @override
  Future<Object?> invoke(
    String method, [
    Map<String, Object?>? arguments,
  ]) =>
      _channel.invokeMethod<Object?>(method, arguments);

  @override
  void setHandler(Future<Object?> Function(String, Object?)? handler) {
    _channel.setMethodCallHandler(
      handler == null ? null : (call) => handler(call.method, call.arguments),
    );
  }
}

final class MosaicStoreKitProviderFactory
    extends _MosaicNativeStoreProviderFactory {
  MosaicStoreKitProviderFactory({
    MosaicNativeStoreChannel? channel,
  }) : super(
          providerId: 'app_store',
          expectedPlatform: MosaicStorePlatform.ios,
          channel: channel,
        );
}

final class MosaicGooglePlayProviderFactory
    extends _MosaicNativeStoreProviderFactory {
  MosaicGooglePlayProviderFactory({
    MosaicNativeStoreChannel? channel,
  }) : super(
          providerId: 'google_play',
          expectedPlatform: MosaicStorePlatform.android,
          channel: channel,
        );
}

abstract base class _MosaicNativeStoreProviderFactory
    implements MosaicCommerceProviderFactory {
  _MosaicNativeStoreProviderFactory({
    required this.providerId,
    required this.expectedPlatform,
    MosaicNativeStoreChannel? channel,
  }) : channel = channel ?? MethodChannelMosaicNativeStoreChannel();

  @override
  final String providerId;
  final MosaicStorePlatform expectedPlatform;
  final MosaicNativeStoreChannel channel;

  @override
  MosaicCommerceProvider create({
    required MosaicCommerceConfiguration commerceConfiguration,
    required MosaicConfigurationRelease configurationRelease,
  }) {
    if (commerceConfiguration.version != '2' ||
        commerceConfiguration.storePlatform != expectedPlatform ||
        commerceConfiguration.activeProvider.identity.id != providerId ||
        commerceConfiguration.activeProvider.activation
            is! MosaicNativeStoreProviderActivation) {
      throw ArgumentError(
        'The native-store factory does not match the accepted configuration.',
      );
    }
    return MosaicNativeStorePurchaseProvider(
      commerceConfiguration: commerceConfiguration,
      configurationRelease: configurationRelease,
      channel: channel,
    );
  }
}

/// One provider-neutral Dart surface backed only by Mosaic's reusable native
/// StoreKit and Google Play modules.
final class MosaicNativeStorePurchaseProvider
    implements MosaicCommerceProvider, MosaicAsynchronousCommerceProvider {
  MosaicNativeStorePurchaseProvider({
    required this.commerceConfiguration,
    required this.configurationRelease,
    required this.channel,
  }) {
    if (commerceConfiguration.version != '2') {
      throw ArgumentError('The native-store bridge requires Commerce v2.');
    }
    channel.setHandler(_handleNativeCall);
    _diagnostics.addAll(commerceConfiguration.diagnostics);
  }

  final MosaicCommerceConfiguration commerceConfiguration;
  final MosaicConfigurationRelease configurationRelease;
  final MosaicNativeStoreChannel channel;
  final StreamController<MosaicCommerceUpdate> _updates =
      StreamController<MosaicCommerceUpdate>.broadcast();
  final List<MosaicCommerceDiagnostic> _diagnostics =
      <MosaicCommerceDiagnostic>[];
  final Set<String> _acceptedUpdateIds = <String>{};
  final List<String> _acceptedUpdateOrder = <String>[];
  Future<void>? _installation;
  var _disposed = false;

  @override
  MosaicProviderIdentity get identity =>
      commerceConfiguration.activeProvider.identity;

  @override
  List<MosaicProviderCapability> get capabilities =>
      commerceConfiguration.activeProvider.capabilities;

  @override
  List<MosaicCommerceDiagnostic> get diagnostics =>
      List.unmodifiable(_diagnostics);

  @override
  Stream<MosaicCommerceUpdate> get commerceUpdates => _updates.stream;

  Future<void> _ensureInstalled() async {
    final existing = _installation;
    if (existing != null) {
      await existing;
      return;
    }
    final installation = _install();
    _installation = installation;
    try {
      await installation;
    } on Object {
      if (identical(_installation, installation)) _installation = null;
      rethrow;
    }
  }

  Future<void> _install() async {
    final profile = _map(await _invoke('profile'), r'$.profile');
    _validateProfile(profile);
    final response = await _invoke(
      'activate',
      <String, Object?>{
        'providerId': identity.id,
        'configuration': _configurationReference(),
        'mappings': [
          for (final mapping in commerceConfiguration.productMappings)
            _encodeMapping(mapping),
        ],
      },
    );
    final result = _map(response, r'$.activate');
    if (result['status'] != 'ready') {
      throw const _NativeStoreUnavailable();
    }
  }

  void _validateProfile(Map<String, Object?> profile) {
    final provider = _map(profile['provider'], r'$.profile.provider');
    if (provider['id'] != identity.id ||
        provider['adapterVersion'] != identity.adapterVersion) {
      throw const _NativeStoreUnavailable();
    }
    final actual = <String, (String, String?)>{};
    for (final raw in _list(profile['capabilities'], r'$.profile.capabilities')) {
      final capability = _map(raw, r'$.profile.capabilities[]');
      actual[_string(capability['name'], r'$.capability.name')] = (
        _string(capability['support'], r'$.capability.support'),
        capability['reasonCode'] as String?,
      );
    }
    for (final expected in capabilities) {
      if (actual[expected.name.wireValue] !=
          (expected.support.name, expected.reasonCode)) {
        throw const _NativeStoreUnavailable();
      }
    }
    if (profile['recoveryMode'] !=
        commerceConfiguration.activeProvider.recoveryMode.name) {
      throw const _NativeStoreUnavailable();
    }
  }

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async {
    final requested = productIds.toList(growable: false);
    if (requested.toSet().length != requested.length) {
      return MosaicProductsUnavailable(
        requested,
        message: 'The Product request contains duplicates.',
      );
    }
    try {
      await _ensureInstalled();
      final response = _map(
        await _invoke('loadProducts', <String, Object?>{
          'productIds': requested,
        }),
        r'$.loadProducts',
      );
      final products = <MosaicProduct>[];
      final unavailable = <String>[];
      for (final item
          in _list(response['products'], r'$.loadProducts.products')) {
        final product = _map(item, r'$.loadProducts.products[]');
        final id = _string(product['mosaicProductId'], r'$.product.id');
        final availability =
            _string(product['availability'], r'$.product.availability');
        if (availability != 'available') {
          unavailable.add(id);
          continue;
        }
        final metadata = _map(product['metadata'], r'$.product.metadata');
        products.add(_decodeProduct(id, metadata, product));
      }
      if (products.isEmpty && unavailable.isNotEmpty) {
        return MosaicProductsUnavailable(
          requested,
          message: 'Native store Products are unavailable.',
        );
      }
      return MosaicProductsLoaded(
        products,
        unavailableProductIds: unavailable,
      );
    } on Object {
      return MosaicProductsUnavailable(
        requested,
        message: 'The native commerce provider is unavailable.',
        diagnostic: _providerUnavailable('load', null),
      );
    }
  }

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async {
    try {
      await _ensureInstalled();
      final payload = _map(
        await _invoke('purchase', <String, Object?>{
          'mosaicProductId': productId,
        }),
        r'$.purchase',
      );
      final outcome = _string(payload['outcome'], r'$.purchase.outcome');
      final decodedEntitlements =
          _entitlements(payload['activeEntitlementKeys']);
      final entitlements = decodedEntitlements.isNotEmpty
          ? decodedEntitlements
          : <MosaicEntitlement>{
              for (final key in commerceConfiguration
                      .mappingForProduct(productId)
                      ?.entitlementKeys ??
                  const <String>[])
                MosaicEntitlement(id: key),
            };
      final transaction = payload['transactionReference'] as String?;
      return switch (outcome) {
        'purchased' => MosaicPurchased(
            productId: productId,
            transactionId: transaction,
            activeEntitlements: entitlements,
          ),
        'alreadyEntitled' => MosaicAlreadyEntitled(
            productId: productId,
            activeEntitlements: entitlements,
          ),
        'pending' => MosaicPurchasePending(productId: productId),
        'deferred' => MosaicPurchaseDeferred(productId: productId),
        'cancelled' => MosaicPurchaseCancelled(productId: productId),
        'productUnavailable' =>
          MosaicPurchaseProductUnavailable(productId: productId),
        'providerUnavailable' => MosaicPurchaseProviderUnavailable(
            productId: productId,
            diagnostic: _providerUnavailable('purchase', productId),
          ),
        _ => MosaicPurchaseFailed(
            productId: productId,
            message: 'The native store could not complete the purchase.',
            diagnostic: _decodeFirstDiagnostic(payload['diagnostics']),
          ),
      };
    } on Object {
      return MosaicPurchaseProviderUnavailable(
        productId: productId,
        diagnostic: _providerUnavailable('purchase', productId),
      );
    }
  }

  @override
  Future<MosaicRestoreResult> restore() async {
    try {
      await _ensureInstalled();
      final payload = _map(await _invoke('restore'), r'$.restore');
      final outcome = _string(payload['outcome'], r'$.restore.outcome');
      return switch (outcome) {
        'restored' => MosaicRestored(
            _entitlements(payload['activeEntitlementKeys']),
          ),
        'nothingToRestore' => const MosaicNothingToRestore(),
        'cancelled' => const MosaicRestoreCancelled(),
        'providerUnavailable' => MosaicRestoreProviderUnavailable(
            diagnostic: _providerUnavailable('restore', null),
          ),
        _ => MosaicRestoreFailed(
            message: 'The native store could not recover purchases.',
            diagnostic: _decodeFirstDiagnostic(payload['diagnostics']),
          ),
      };
    } on Object {
      return MosaicRestoreProviderUnavailable(
        diagnostic: _providerUnavailable('restore', null),
      );
    }
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async {
    try {
      await _ensureInstalled();
      final payload =
          _map(await _invoke('activeEntitlements'), r'$.entitlements');
      final outcome = _string(payload['outcome'], r'$.entitlements.outcome');
      return switch (outcome) {
        'available' => MosaicActiveEntitlements(
            _entitlements(payload['activeEntitlementKeys']),
          ),
        'providerUnavailable' => MosaicEntitlementsProviderUnavailable(
            diagnostic: _providerUnavailable('entitlements', null),
          ),
        'failed' => MosaicEntitlementsFailed(
            message: 'The native store could not read active access.',
            diagnostic: _decodeFirstDiagnostic(payload['diagnostics']),
          ),
        _ => MosaicEntitlementsUnknown(
            diagnostic: _decodeFirstDiagnostic(payload['diagnostics']),
          ),
      };
    } on Object {
      return MosaicEntitlementsProviderUnavailable(
        diagnostic: _providerUnavailable('entitlements', null),
      );
    }
  }

  @override
  Future<void> invalidate() async {
    _installation = null;
    try {
      await _invoke('invalidate');
    } on Object {
      // Invalidation is best effort when an engine or plugin is detaching.
    }
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _updates.close();
  }

  Future<Object?> _handleNativeCall(String method, Object? arguments) async {
    if (method != 'commerceUpdate' && method != 'commerceUpdateReplay') {
      return false;
    }
    try {
      final update = _decodeUpdate(_map(arguments, r'$.commerceUpdate'));
      final current = update.configuration.configurationId ==
              commerceConfiguration.id &&
          update.configuration.configurationRevision ==
              commerceConfiguration.contentDigest &&
          update.providerId == identity.id;
      if (!current) return false;
      if (_acceptedUpdateIds.add(update.updateId)) {
        _acceptedUpdateOrder.add(update.updateId);
        if (_acceptedUpdateOrder.length > 1024) {
          _acceptedUpdateIds.remove(_acceptedUpdateOrder.removeAt(0));
        }
        _updates.add(update);
      }
      return true;
    } on Object {
      return false;
    }
  }

  Future<Object?> _invoke(
    String method, [
    Map<String, Object?>? payload,
  ]) {
    if (_disposed) throw const _NativeStoreUnavailable();
    return channel.invoke(method, <String, Object?>{
      'codecVersion': mosaicNativeStoreChannelCodecVersion,
      if (payload != null) ...payload,
    });
  }

  Map<String, Object?> _configurationReference() => <String, Object?>{
        'configurationId': commerceConfiguration.id,
        // The canonical digest is the immutable revision on both platforms.
        'configurationRevision': commerceConfiguration.contentDigest,
      };

  MosaicCommerceDiagnostic _providerUnavailable(
    String operation,
    String? productId,
  ) {
    final diagnostic = MosaicCommerceDiagnostic(
      code: 'commerce.provider.unavailable',
      safeMessage: 'The native commerce provider is unavailable.',
      severity: MosaicCommerceDiagnosticSeverity.error,
      retryable: true,
      correlationId:
          'flutter_native_${operation}_${DateTime.now().microsecondsSinceEpoch}',
      mosaicProductId: productId,
      recoveryAction: MosaicCommerceRecoveryAction.retry,
    );
    if (_diagnostics.length == 32) _diagnostics.removeAt(0);
    _diagnostics.add(diagnostic);
    return diagnostic;
  }
}

MosaicProduct _decodeProduct(
  String id,
  Map<String, Object?> metadata,
  Map<String, Object?> record,
) {
  _expectKeys(
    record,
    const <String>{
      'mosaicProductId',
      'productType',
      'entitlementKeys',
      'availability',
      'metadata',
    },
    r'$.product',
  );
  _expectKeys(
    metadata,
    const <String>{'localizedDisplayName', 'localizedPrice'},
    r'$.product.metadata',
    optional: const <String>{
      'localizedPeriod',
      'locale',
      'currencyCode',
      'billingPeriod',
      'trial',
      'introductoryOffer',
    },
  );
  final billingPeriod = _decodePeriod(metadata['billingPeriod']);
  final trial = metadata['trial'] == null
      ? null
      : _decodeTrial(_map(metadata['trial'], r'$.metadata.trial'));
  final introductory = metadata['introductoryOffer'] == null
      ? null
      : _decodeIntroductoryOffer(
          _map(metadata['introductoryOffer'], r'$.metadata.introductoryOffer'),
        );
  return MosaicProduct(
    id: id,
    title: _string(metadata['localizedDisplayName'], r'$.metadata.name'),
    localizedPrice: _string(metadata['localizedPrice'], r'$.metadata.price'),
    localizedPeriod: metadata['localizedPeriod'] as String?,
    locale: metadata['locale'] as String?,
    currencyCode: metadata['currencyCode'] as String?,
    billingPeriod: billingPeriod,
    type: _decodeProductType(record['productType']),
    entitlementKeys: _stringSet(record['entitlementKeys']),
    trial: trial,
    introductoryOffer: introductory,
  );
}

MosaicCommerceTrial _decodeTrial(Map<String, Object?> value) =>
    MosaicCommerceTrial(
      period: _decodePeriod(value['period'])!,
      eligibility: _decodeEligibility(value['eligibility']),
    );

MosaicCommerceIntroductoryOffer _decodeIntroductoryOffer(
  Map<String, Object?> value,
) =>
    MosaicCommerceIntroductoryOffer(
      localizedPrice: _string(value['localizedPrice'], r'$.offer.price'),
      period: _decodePeriod(value['period'])!,
      cycles: value['cycles'] as int,
      paymentMode: switch (value['paymentMode']) {
        'payAsYouGo' => MosaicCommerceIntroductoryPaymentMode.payAsYouGo,
        _ => MosaicCommerceIntroductoryPaymentMode.payUpFront,
      },
      eligibility: _decodeEligibility(value['eligibility']),
    );

MosaicBillingPeriod? _decodePeriod(Object? value) {
  if (value == null) return null;
  final period = _map(value, r'$.period');
  return MosaicBillingPeriod(
    unit: switch (_string(period['unit'], r'$.period.unit')) {
      'day' => MosaicBillingPeriodUnit.day,
      'week' => MosaicBillingPeriodUnit.week,
      'month' => MosaicBillingPeriodUnit.month,
      _ => MosaicBillingPeriodUnit.year,
    },
    value: period['value'] as int,
  );
}

MosaicCommerceOfferEligibility _decodeEligibility(Object? value) =>
    switch (value) {
      'eligible' => MosaicCommerceOfferEligibility.eligible,
      'ineligible' => MosaicCommerceOfferEligibility.ineligible,
      _ => MosaicCommerceOfferEligibility.unknown,
    };

MosaicCommerceProductType? _decodeProductType(Object? value) => switch (value) {
      'subscription' => MosaicCommerceProductType.subscription,
      'one_time_non_consumable' =>
        MosaicCommerceProductType.oneTimeNonConsumable,
      _ => null,
    };

Map<String, Object?> _encodeMapping(MosaicCommerceProductMapping mapping) {
  final adapter = switch (mapping.adapterMapping) {
    MosaicStoreKitProductMapping() => <String, Object?>{
        'kind': 'storeKitProduct',
      },
    MosaicGooglePlayProductMapping(:final basePlanId, :final offerId) =>
      <String, Object?>{
        'kind': 'googlePlayProduct',
        if (basePlanId != null) 'basePlanId': basePlanId,
        if (offerId != null) 'offerId': offerId,
      },
    _ => throw ArgumentError('The mapping is not native-store compatible.'),
  };
  return <String, Object?>{
    'mosaicProductId': mapping.mosaicProductId,
    'mappingId': mapping.mappingId,
    'providerProductReference': mapping.providerProductReference,
    'productType': mapping.productType?.wireValue,
    'entitlementKeys': mapping.entitlementKeys,
    'adapterMapping': adapter,
  };
}

MosaicCommerceUpdate _decodeUpdate(Map<String, Object?> value) {
  _expectKeys(
    value,
    const <String>{
      'updateId',
      'providerId',
      'mosaicProductId',
      'configuration',
      'outcome',
      'occurredAt',
      'diagnostics',
    },
    r'$.update',
    optional: const <String>{
      'operationId',
      'transactionReference',
      'activeEntitlementKeys',
    },
  );
  final configuration = _map(value['configuration'], r'$.update.configuration');
  _expectKeys(
    configuration,
    const <String>{'configurationId', 'configurationRevision'},
    r'$.update.configuration',
  );
  return MosaicCommerceUpdate(
    updateId: _string(value['updateId'], r'$.update.id'),
    operationId: value['operationId'] as String?,
    providerId: _string(value['providerId'], r'$.update.provider'),
    mosaicProductId: _string(value['mosaicProductId'], r'$.update.product'),
    configuration: MosaicCommerceConfigurationReference(
      configurationId: _string(
        configuration['configurationId'],
        r'$.update.configuration.id',
      ),
      configurationRevision: _string(
        configuration['configurationRevision'],
        r'$.update.configuration.revision',
      ),
    ),
    outcome: MosaicCommerceUpdateOutcome.values.firstWhere(
      (item) => item.name == value['outcome'],
    ),
    transactionReference: value['transactionReference'] as String?,
    activeEntitlementKeys: _stringSet(value['activeEntitlementKeys']),
    occurredAt: DateTime.parse(
      _string(value['occurredAt'], r'$.update.occurredAt'),
    ),
    diagnostics: _decodeDiagnostics(value['diagnostics']),
  );
}

Set<MosaicEntitlement> _entitlements(Object? value) => <MosaicEntitlement>{
      for (final key in _stringSet(value)) MosaicEntitlement(id: key),
    };

Set<String> _stringSet(Object? value) => value == null
    ? const <String>{}
    : Set.unmodifiable(
        _list(value, r'$.values').map(
          (item) => _string(item, r'$.values[]'),
        ),
      );

MosaicCommerceDiagnostic? _decodeFirstDiagnostic(Object? value) {
  final diagnostics = _decodeDiagnostics(value);
  return diagnostics.isEmpty ? null : diagnostics.first;
}

List<MosaicCommerceDiagnostic> _decodeDiagnostics(Object? value) {
  if (value == null) return const <MosaicCommerceDiagnostic>[];
  return <MosaicCommerceDiagnostic>[
    for (final item in _list(value, r'$.diagnostics'))
      (() {
        final diagnostic = _map(item, r'$.diagnostics[]');
        return MosaicCommerceDiagnostic(
          code: _string(diagnostic['code'], r'$.diagnostic.code'),
          safeMessage:
              _string(diagnostic['safeMessage'], r'$.diagnostic.message'),
          severity: MosaicCommerceDiagnosticSeverity.values.firstWhere(
            (item) => item.name == diagnostic['severity'],
          ),
          retryable: diagnostic['retryable'] as bool,
          correlationId:
              _string(diagnostic['correlationId'], r'$.diagnostic.correlation'),
          retryAfterSeconds: diagnostic['retryAfterSeconds'] as int?,
          providerCode: diagnostic['providerCode'] as String?,
          mosaicProductId: diagnostic['mosaicProductId'] as String?,
          recoveryAction: diagnostic['recoveryAction'] == null
              ? null
              : MosaicCommerceRecoveryAction.values.firstWhere(
                  (item) => item.name == diagnostic['recoveryAction'],
                ),
        );
      })(),
  ];
}

Map<String, Object?> _map(Object? value, String path) {
  if (value is! Map) throw FormatException('$path must be an object.');
  return value.cast<String, Object?>();
}

List<Object?> _list(Object? value, String path) {
  if (value is! List) throw FormatException('$path must be a list.');
  return value.cast<Object?>();
}

String _string(Object? value, String path) {
  if (value is! String || value.isEmpty) {
    throw FormatException('$path must be a non-empty string.');
  }
  return value;
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
    throw FormatException('$path is not a closed channel record.');
  }
}

final class _NativeStoreUnavailable implements Exception {
  const _NativeStoreUnavailable();
}
