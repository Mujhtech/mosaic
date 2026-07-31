import 'dart:collection';

import 'package:flutter/services.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as revenuecat;

import 'revenuecat_client.dart';

typedef MosaicRevenueCatDiagnosticCallback = void Function(
  MosaicCommerceDiagnostic diagnostic,
);

final class MosaicRevenueCatProviderFactory
    implements MosaicCommerceProviderFactory {
  const MosaicRevenueCatProviderFactory({
    this.client = const DefaultMosaicRevenueCatClient(),
    this.onDiagnostic,
  });

  final MosaicRevenueCatClient client;
  final MosaicRevenueCatDiagnosticCallback? onDiagnostic;

  @override
  String get providerId => 'revenuecat';

  @override
  MosaicCommerceProvider create({
    required MosaicCommerceConfiguration commerceConfiguration,
    required MosaicConfigurationRelease configurationRelease,
  }) {
    if (commerceConfiguration.activeProvider.identity.id != providerId) {
      throw ArgumentError(
        'MosaicRevenueCatProviderFactory requires Provider ID revenuecat.',
      );
    }
    return MosaicRevenueCatPurchaseProvider(
      commerceConfiguration: commerceConfiguration,
      configurationRelease: configurationRelease,
      client: client,
      onDiagnostic: onDiagnostic,
    );
  }
}

/// Optional RevenueCat adapter bound to one accepted release/sidecar pair.
///
/// It purchases only private handles returned by an exact mapping load. It
/// never configures RevenueCat, accepts an API key, logs in a customer, or
/// retains an app-user identifier.
final class MosaicRevenueCatPurchaseProvider implements MosaicCommerceProvider {
  MosaicRevenueCatPurchaseProvider({
    required this.commerceConfiguration,
    required this.configurationRelease,
    this.client = const DefaultMosaicRevenueCatClient(),
    this.onDiagnostic,
  }) {
    if (commerceConfiguration.activeProvider.identity.id != 'revenuecat') {
      throw ArgumentError(
        'RevenueCat adapter requires Provider identity revenuecat.',
      );
    }
    if (commerceConfiguration.activeProvider.identity.adapterVersion !=
            '1.0.0' ||
        !_capabilitiesMatch(
          commerceConfiguration.activeProvider.capabilities,
          _revenueCatRuntimeCapabilities,
        )) {
      throw ArgumentError(
        'RevenueCat adapter identity or capabilities are incompatible.',
      );
    }
    final expectedProducts = configurationRelease.productReferences.keys;
    final mappedProducts = commerceConfiguration.productMappings
        .map((mapping) => mapping.mosaicProductId)
        .toSet();
    if (mappedProducts.length != expectedProducts.length ||
        !mappedProducts.containsAll(expectedProducts)) {
      throw ArgumentError(
        'RevenueCat mappings must match the accepted release Products.',
      );
    }
    _diagnostics.addAll(commerceConfiguration.diagnostics);
  }

  final MosaicCommerceConfiguration commerceConfiguration;
  final MosaicConfigurationRelease configurationRelease;
  final MosaicRevenueCatClient client;
  final MosaicRevenueCatDiagnosticCallback? onDiagnostic;
  final Map<String, _RevenueCatHandle> _handles = <String, _RevenueCatHandle>{};
  final List<MosaicCommerceDiagnostic> _diagnostics =
      <MosaicCommerceDiagnostic>[];
  var _operation = 0;

  @override
  MosaicProviderIdentity get identity => const MosaicProviderIdentity(
        id: 'revenuecat',
        displayName: 'RevenueCat',
        adapterVersion: '1.0.0',
      );

  @override
  List<MosaicProviderCapability> get capabilities =>
      _revenueCatRuntimeCapabilities;

  @override
  List<MosaicCommerceDiagnostic> get diagnostics =>
      UnmodifiableListView(_diagnostics);

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async {
    final requested = productIds.toSet().toList(growable: false);
    for (final productId in requested) {
      _handles.remove(productId);
    }
    final available = <String, MosaicProduct>{};
    final unavailable = <String>{};
    final directSubscriptions = <MosaicCommerceProductMapping>[];
    final directNonSubscriptions = <MosaicCommerceProductMapping>[];
    final packageMappings = <MosaicCommerceProductMapping>[];

    for (final productId in requested) {
      final mapping = commerceConfiguration.mappingForProduct(productId);
      final product = configurationRelease.productReferences[productId];
      if (mapping == null || product == null) {
        unavailable.add(productId);
        _record(
          code: 'commerce.mappingMissing',
          safeMessage: 'The Product has no accepted RevenueCat mapping.',
          providerCode: 'mapping_missing',
          mosaicProductId: productId,
          recoveryAction: MosaicCommerceRecoveryAction.fixProductMapping,
        );
        continue;
      }
      switch (mapping.adapterMapping) {
        case MosaicDirectProductMapping():
          switch (product.type) {
            case MosaicDeliveredProductType.subscription:
              directSubscriptions.add(mapping);
            case MosaicDeliveredProductType.oneTimeNonConsumable:
              directNonSubscriptions.add(mapping);
          }
        case MosaicRevenueCatPackageMapping():
          packageMappings.add(mapping);
      }
    }

    await _loadDirectGroup(
      directSubscriptions,
      revenuecat.ProductCategory.subscription,
      available,
      unavailable,
    );
    await _loadDirectGroup(
      directNonSubscriptions,
      revenuecat.ProductCategory.nonSubscription,
      available,
      unavailable,
    );
    if (packageMappings.isNotEmpty) {
      await _loadPackages(packageMappings, available, unavailable);
    }

    final products = <MosaicProduct>[
      for (final productId in requested)
        if (available[productId] case final product?) product,
    ];
    if (products.isEmpty && unavailable.isNotEmpty) {
      return MosaicProductsUnavailable(
        requested,
        message: 'RevenueCat Products are unavailable.',
        diagnostic: _diagnostics.isEmpty ? null : _diagnostics.last,
      );
    }
    return MosaicProductsLoaded(
      products,
      unavailableProductIds: <String>[
        for (final productId in requested)
          if (unavailable.contains(productId)) productId,
      ],
    );
  }

  Future<void> _loadDirectGroup(
    List<MosaicCommerceProductMapping> mappings,
    revenuecat.ProductCategory category,
    Map<String, MosaicProduct> available,
    Set<String> unavailable,
  ) async {
    if (mappings.isEmpty) return;
    try {
      final result = await client.getProducts(
        mappings
            .map((mapping) => mapping.providerProductReference)
            .toList(growable: false),
        productCategory: category,
      );
      final productsByIdentifier = <String, List<revenuecat.StoreProduct>>{};
      for (final product in result) {
        productsByIdentifier
            .putIfAbsent(product.identifier, () => <revenuecat.StoreProduct>[])
            .add(product);
      }
      for (final mapping in mappings) {
        final matches =
            productsByIdentifier[mapping.providerProductReference] ??
                const <revenuecat.StoreProduct>[];
        if (matches.length != 1) {
          unavailable.add(mapping.mosaicProductId);
          _recordProductUnavailable(mapping.mosaicProductId);
          continue;
        }
        final product = matches.single;
        _handles[mapping.mosaicProductId] =
            _RevenueCatStoreProductHandle(product);
        available[mapping.mosaicProductId] =
            _mosaicProduct(mapping.mosaicProductId, product);
      }
    } on PlatformException catch (error) {
      for (final mapping in mappings) {
        unavailable.add(mapping.mosaicProductId);
      }
      _recordPlatformFailure(error, operation: 'productLoad');
    } on Object {
      for (final mapping in mappings) {
        unavailable.add(mapping.mosaicProductId);
      }
      _recordUnexpectedFailure(operation: 'productLoad');
    }
  }

  Future<void> _loadPackages(
    List<MosaicCommerceProductMapping> mappings,
    Map<String, MosaicProduct> available,
    Set<String> unavailable,
  ) async {
    try {
      final offerings = await client.getOfferings();
      for (final mapping in mappings) {
        final adapter = mapping.adapterMapping;
        if (adapter is! MosaicRevenueCatPackageMapping) {
          unavailable.add(mapping.mosaicProductId);
          continue;
        }
        final offering = offerings.getOffering(adapter.offeringIdentifier);
        final package = offering?.getPackage(adapter.packageIdentifier);
        if (package == null ||
            package.storeProduct.identifier !=
                mapping.providerProductReference) {
          unavailable.add(mapping.mosaicProductId);
          _recordProductUnavailable(mapping.mosaicProductId);
          continue;
        }
        _handles[mapping.mosaicProductId] = _RevenueCatPackageHandle(package);
        available[mapping.mosaicProductId] =
            _mosaicProduct(mapping.mosaicProductId, package.storeProduct);
      }
    } on PlatformException catch (error) {
      for (final mapping in mappings) {
        unavailable.add(mapping.mosaicProductId);
      }
      _recordPlatformFailure(error, operation: 'productLoad');
    } on Object {
      for (final mapping in mappings) {
        unavailable.add(mapping.mosaicProductId);
      }
      _recordUnexpectedFailure(operation: 'productLoad');
    }
  }

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async {
    final handle = _handles[productId];
    if (handle == null) {
      return MosaicPurchaseProductUnavailable(productId: productId);
    }
    try {
      final result = await client.purchase(handle.purchaseParameters);
      final activeEntitlements = _activeEntitlements(result.customerInfo);
      final transactionId =
          result.storeTransaction.transactionIdentifier.trim();
      return MosaicPurchased(
        productId: productId,
        transactionId: transactionId.isEmpty ? null : transactionId,
        activeEntitlements: activeEntitlements,
      );
    } on PlatformException catch (error) {
      final code = _errorCode(error);
      switch (code) {
        case revenuecat.PurchasesErrorCode.purchaseCancelledError:
          return MosaicPurchaseCancelled(productId: productId);
        case revenuecat.PurchasesErrorCode.paymentPendingError:
          return MosaicPurchasePending(productId: productId);
        case revenuecat.PurchasesErrorCode.productAlreadyPurchasedError:
          return MosaicAlreadyEntitled(productId: productId);
        case revenuecat.PurchasesErrorCode.productNotAvailableForPurchaseError:
          return MosaicPurchaseProductUnavailable(productId: productId);
        case final code? when _isProviderUnavailable(code):
          final diagnostic = _recordPlatformFailure(
            error,
            operation: 'purchase',
            mosaicProductId: productId,
          );
          return MosaicPurchaseProviderUnavailable(
            productId: productId,
            diagnostic: diagnostic,
          );
        case _:
          final diagnostic = _recordPlatformFailure(
            error,
            operation: 'purchase',
            mosaicProductId: productId,
          );
          return MosaicPurchaseFailed(
            productId: productId,
            message: 'The RevenueCat purchase failed.',
            diagnostic: diagnostic,
          );
      }
    } on Object {
      final diagnostic = _recordUnexpectedFailure(
        operation: 'purchase',
        mosaicProductId: productId,
      );
      return MosaicPurchaseFailed(
        productId: productId,
        message: 'The RevenueCat purchase failed.',
        diagnostic: diagnostic,
      );
    }
  }

  @override
  Future<MosaicRestoreResult> restore() async {
    try {
      final customerInfo = await client.restorePurchases();
      final entitlements = _activeEntitlements(customerInfo);
      return entitlements.isEmpty
          ? const MosaicNothingToRestore()
          : MosaicRestored(entitlements);
    } on PlatformException catch (error) {
      final code = _errorCode(error);
      if (code == revenuecat.PurchasesErrorCode.purchaseCancelledError) {
        return const MosaicRestoreCancelled();
      }
      if (code == revenuecat.PurchasesErrorCode.productAlreadyPurchasedError) {
        try {
          final entitlements =
              _activeEntitlements(await client.getCustomerInfo());
          return entitlements.isEmpty
              ? const MosaicNothingToRestore()
              : MosaicRestored(entitlements);
        } on PlatformException catch (lookupError) {
          final lookupCode = _errorCode(lookupError);
          final diagnostic =
              _recordPlatformFailure(lookupError, operation: 'restore');
          return lookupCode != null && _isProviderUnavailable(lookupCode)
              ? MosaicRestoreProviderUnavailable(diagnostic: diagnostic)
              : MosaicRestoreFailed(
                  message: 'The RevenueCat restore failed.',
                  diagnostic: diagnostic,
                );
        } on Object {
          final diagnostic = _recordUnexpectedFailure(operation: 'restore');
          return MosaicRestoreFailed(
            message: 'The RevenueCat restore failed.',
            diagnostic: diagnostic,
          );
        }
      }
      final diagnostic = _recordPlatformFailure(error, operation: 'restore');
      return code != null && _isProviderUnavailable(code)
          ? MosaicRestoreProviderUnavailable(diagnostic: diagnostic)
          : MosaicRestoreFailed(
              message: 'The RevenueCat restore failed.',
              diagnostic: diagnostic,
            );
    } on Object {
      final diagnostic = _recordUnexpectedFailure(operation: 'restore');
      return MosaicRestoreFailed(
        message: 'The RevenueCat restore failed.',
        diagnostic: diagnostic,
      );
    }
  }

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async {
    try {
      return MosaicActiveEntitlements(
        _activeEntitlements(await client.getCustomerInfo()),
      );
    } on PlatformException catch (error) {
      final code = _errorCode(error);
      final diagnostic =
          _recordPlatformFailure(error, operation: 'entitlementLookup');
      return code != null && _isProviderUnavailable(code)
          ? MosaicEntitlementsProviderUnavailable(diagnostic: diagnostic)
          : MosaicEntitlementsFailed(
              message: 'RevenueCat Entitlements could not be read.',
              diagnostic: diagnostic,
            );
    } on Object {
      final diagnostic =
          _recordUnexpectedFailure(operation: 'entitlementLookup');
      return MosaicEntitlementsFailed(
        message: 'RevenueCat Entitlements could not be read.',
        diagnostic: diagnostic,
      );
    }
  }

  MosaicProduct _mosaicProduct(
    String mosaicProductId,
    revenuecat.StoreProduct product,
  ) {
    final delivered = configurationRelease.productReferences[mosaicProductId]!;
    final period = delivered.type == MosaicDeliveredProductType.subscription
        ? _period(product.subscriptionPeriod)
        : null;
    return MosaicProduct(
      id: mosaicProductId,
      title:
          product.title.isEmpty ? delivered.fallbackDisplayName : product.title,
      localizedPrice: product.priceString,
      localizedPeriod: _periodLabel(period),
      currencyCode: product.currencyCode,
      billingPeriod: period,
      type: delivered.type == MosaicDeliveredProductType.subscription
          ? MosaicCommerceProductType.subscription
          : MosaicCommerceProductType.oneTimeNonConsumable,
    );
  }

  Set<MosaicEntitlement> _activeEntitlements(
    revenuecat.CustomerInfo customerInfo,
  ) {
    final ids = commerceConfiguration.mosaicEntitlementsForProviderIds(
      customerInfo.entitlements.active.keys,
    );
    return Set.unmodifiable(
      ids.map((identifier) => MosaicEntitlement(id: identifier)),
    );
  }

  void _recordProductUnavailable(String productId) {
    _record(
      code: 'commerce.productUnavailable',
      safeMessage: 'The mapped RevenueCat Product is unavailable.',
      providerCode: 'product_unavailable',
      mosaicProductId: productId,
      recoveryAction: MosaicCommerceRecoveryAction.fixProductMapping,
    );
  }

  MosaicCommerceDiagnostic _recordPlatformFailure(
    PlatformException error, {
    required String operation,
    String? mosaicProductId,
  }) {
    final code = _errorCode(error);
    return _record(
      code: _isProviderUnavailable(code)
          ? 'commerce.providerUnavailable'
          : 'commerce.operationFailed',
      safeMessage: _isProviderUnavailable(code)
          ? 'RevenueCat is temporarily unavailable.'
          : 'The RevenueCat operation failed.',
      providerCode: code?.name ?? 'unknown_error',
      mosaicProductId: mosaicProductId,
      retryable: _isProviderUnavailable(code),
      recoveryAction: _isProviderUnavailable(code)
          ? MosaicCommerceRecoveryAction.retry
          : MosaicCommerceRecoveryAction.contactProvider,
    );
  }

  MosaicCommerceDiagnostic _recordUnexpectedFailure({
    required String operation,
    String? mosaicProductId,
  }) {
    return _record(
      code: 'commerce.operationFailed',
      safeMessage: 'The RevenueCat operation failed.',
      providerCode: '${operation}_failed',
      mosaicProductId: mosaicProductId,
      recoveryAction: MosaicCommerceRecoveryAction.contactProvider,
    );
  }

  MosaicCommerceDiagnostic _record({
    required String code,
    required String safeMessage,
    required String providerCode,
    required MosaicCommerceRecoveryAction recoveryAction,
    String? mosaicProductId,
    bool retryable = false,
  }) {
    _operation += 1;
    final diagnostic = MosaicCommerceDiagnostic(
      code: code,
      safeMessage: safeMessage,
      severity: MosaicCommerceDiagnosticSeverity.error,
      retryable: retryable,
      correlationId: 'flutter_revenuecat_$_operation',
      providerCode: providerCode,
      mosaicProductId: mosaicProductId,
      recoveryAction: recoveryAction,
    );
    if (_diagnostics.length == 32) _diagnostics.removeAt(0);
    _diagnostics.add(diagnostic);
    onDiagnostic?.call(diagnostic);
    return diagnostic;
  }
}

const _revenueCatRuntimeCapabilities = <MosaicProviderCapability>[
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.productLoading,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.subscriptions,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.oneTimeNonConsumables,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.trials,
    support: MosaicProviderCapabilitySupport.conditional,
    reasonCode: 'provider.platformCapabilityVaries',
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.introductoryOffers,
    support: MosaicProviderCapabilitySupport.conditional,
    reasonCode: 'provider.platformCapabilityVaries',
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.promotionalOffers,
    support: MosaicProviderCapabilitySupport.conditional,
    reasonCode: 'provider.runtimeEligibilityRequired',
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.restore,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.activeEntitlementLookup,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.pendingPurchases,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.deferredPurchases,
    support: MosaicProviderCapabilitySupport.unsupported,
    reasonCode: 'provider.outcomeNotDistinct',
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.serverConfirmedTransactions,
    support: MosaicProviderCapabilitySupport.conditional,
    reasonCode: 'provider.runtimeConfirmation',
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.productSynchronization,
    support: MosaicProviderCapabilitySupport.supported,
  ),
  MosaicProviderCapability(
    name: MosaicProviderCapabilityName.providerDiagnostics,
    support: MosaicProviderCapabilitySupport.supported,
  ),
];

bool _capabilitiesMatch(
  List<MosaicProviderCapability> expected,
  List<MosaicProviderCapability> actual,
) {
  if (expected.length != actual.length) return false;
  final actualByName = <MosaicProviderCapabilityName, MosaicProviderCapability>{
    for (final capability in actual) capability.name: capability,
  };
  if (actualByName.length != actual.length) return false;
  for (final capability in expected) {
    final installed = actualByName[capability.name];
    if (installed == null ||
        installed.support != capability.support ||
        installed.reasonCode != capability.reasonCode) {
      return false;
    }
  }
  return true;
}

sealed class _RevenueCatHandle {
  const _RevenueCatHandle();

  revenuecat.PurchaseParams get purchaseParameters;
}

final class _RevenueCatStoreProductHandle extends _RevenueCatHandle {
  const _RevenueCatStoreProductHandle(this.product);

  final revenuecat.StoreProduct product;

  @override
  revenuecat.PurchaseParams get purchaseParameters =>
      revenuecat.PurchaseParams.storeProduct(product);
}

final class _RevenueCatPackageHandle extends _RevenueCatHandle {
  const _RevenueCatPackageHandle(this.package);

  final revenuecat.Package package;

  @override
  revenuecat.PurchaseParams get purchaseParameters =>
      revenuecat.PurchaseParams.package(package);
}

revenuecat.PurchasesErrorCode? _errorCode(PlatformException error) {
  try {
    return revenuecat.PurchasesErrorHelper.getErrorCode(error);
  } on Object {
    return null;
  }
}

bool _isProviderUnavailable(revenuecat.PurchasesErrorCode? code) =>
    code == revenuecat.PurchasesErrorCode.networkError ||
    code == revenuecat.PurchasesErrorCode.offlineConnectionError ||
    code == revenuecat.PurchasesErrorCode.productRequestTimeout ||
    code == revenuecat.PurchasesErrorCode.apiEndpointBlocked ||
    code == revenuecat.PurchasesErrorCode.unknownBackendError ||
    code == revenuecat.PurchasesErrorCode.unexpectedBackendResponseError;

MosaicBillingPeriod? _period(String? iso8601) {
  if (iso8601 == null) return null;
  final match = RegExp(r'^P([1-9][0-9]*)([DWMY])$').firstMatch(iso8601);
  if (match == null) return null;
  final value = int.parse(match.group(1)!);
  final unit = switch (match.group(2)) {
    'D' => MosaicBillingPeriodUnit.day,
    'W' => MosaicBillingPeriodUnit.week,
    'M' => MosaicBillingPeriodUnit.month,
    'Y' => MosaicBillingPeriodUnit.year,
    _ => null,
  };
  return unit == null ? null : MosaicBillingPeriod(unit: unit, value: value);
}

String? _periodLabel(MosaicBillingPeriod? period) {
  if (period == null) return null;
  final name = period.unit.name;
  return period.value == 1 ? name : '${period.value} ${name}s';
}
