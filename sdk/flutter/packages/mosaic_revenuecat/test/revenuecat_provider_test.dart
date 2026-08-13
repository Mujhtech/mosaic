import 'dart:collection';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_revenuecat/mosaic_revenuecat.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as revenuecat;

void main() {
  test('selects exact direct Product and Offering Package handles', () async {
    final setup = _setup();
    final client = _FakeRevenueCatClient(
      products: <revenuecat.StoreProduct>[setup.monthly],
      offerings: setup.offerings,
      purchases: <Object>[
        _purchaseResult(setup.monthly, activeEntitlement: 'pro'),
        _purchaseResult(setup.yearly, activeEntitlement: 'pro'),
      ],
    );
    final provider = setup.provider(client);
    expect(provider.identity.id, 'revenuecat');
    expect(provider.identity.adapterVersion, '1.0.0');
    expect(
      provider.capabilities
          .firstWhere(
            (capability) =>
                capability.name == MosaicProviderCapabilityName.trials,
          )
          .support,
      MosaicProviderCapabilitySupport.conditional,
    );

    final loaded = await provider.loadProducts(
      const <String>['mosaic_pro_monthly', 'mosaic_pro_yearly'],
    );
    expect(loaded, isA<MosaicProductsLoaded>());
    expect(
      (loaded as MosaicProductsLoaded).products.map((product) => product.id),
      <String>['mosaic_pro_monthly', 'mosaic_pro_yearly'],
    );
    expect(loaded.products.first.localizedPrice, r'$9.99');
    expect(loaded.products.first.billingPeriod?.unit,
        MosaicBillingPeriodUnit.month);

    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchased>(),
    );
    expect(client.purchaseParameters.first.product, same(setup.monthly));
    expect(client.purchaseParameters.first.package, isNull);

    final yearly = await provider.purchase('mosaic_pro_yearly');
    expect(yearly, isA<MosaicPurchased>());
    expect(client.purchaseParameters.last.package, same(setup.yearlyPackage));
    expect(
      (yearly as MosaicPurchased)
          .activeEntitlements
          .map((entitlement) => entitlement.id),
      <String>['pro'],
    );
  });

  test('normalizes cancellation, pending, unavailability, and entitlement',
      () async {
    final setup = _setup();
    final client = _FakeRevenueCatClient(
      products: <revenuecat.StoreProduct>[setup.monthly],
      offerings: setup.offerings,
      purchases: <Object>[
        _error(revenuecat.PurchasesErrorCode.purchaseCancelledError),
        _error(revenuecat.PurchasesErrorCode.paymentPendingError),
        _error(
          revenuecat.PurchasesErrorCode.productNotAvailableForPurchaseError,
        ),
        _error(revenuecat.PurchasesErrorCode.productAlreadyPurchasedError),
        _error(revenuecat.PurchasesErrorCode.networkError),
      ],
    );
    final provider = setup.provider(client);
    await provider.loadProducts(const <String>['mosaic_pro_monthly']);

    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchaseCancelled>(),
    );
    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchasePending>(),
    );
    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchaseProductUnavailable>(),
    );
    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicAlreadyEntitled>(),
    );
    final unavailable = await provider.purchase('mosaic_pro_monthly')
        as MosaicPurchaseProviderUnavailable;
    expect(unavailable.diagnostic?.retryable, isTrue);
    expect(unavailable.diagnostic?.safeMessage, isNotEmpty);
    expect(unavailable.diagnostic?.correlationId,
        startsWith('flutter_revenuecat_'));
    expect(provider.diagnostics.last.providerCode, 'networkError');
    expect(provider.diagnostics.last.safeMessage, isNot(contains('secret')));
  });

  test('a failed load removes stale handles and a later retry recovers',
      () async {
    final setup = _setup();
    final client = _FakeRevenueCatClient(
      products: <revenuecat.StoreProduct>[setup.monthly],
      offerings: setup.offerings,
      productFailures: <PlatformException>[
        _error(revenuecat.PurchasesErrorCode.networkError),
      ],
      purchases: <Object>[
        _purchaseResult(setup.monthly, activeEntitlement: 'pro'),
      ],
    );
    final provider = setup.provider(client);

    expect(
      await provider.loadProducts(const <String>['mosaic_pro_monthly']),
      isA<MosaicProductsUnavailable>(),
    );
    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchaseProductUnavailable>(),
    );

    expect(
      await provider.loadProducts(const <String>['mosaic_pro_monthly']),
      isA<MosaicProductsLoaded>(),
    );
    expect(
      await provider.purchase('mosaic_pro_monthly'),
      isA<MosaicPurchased>(),
    );
  });

  test('restore and entitlement failures never become empty success', () async {
    final setup = _setup();
    final client = _FakeRevenueCatClient(
      products: <revenuecat.StoreProduct>[setup.monthly],
      offerings: setup.offerings,
      restoreFailure: _error(revenuecat.PurchasesErrorCode.networkError),
      entitlementFailure: _error(revenuecat.PurchasesErrorCode.networkError),
    );
    final provider = setup.provider(client);

    expect(await provider.restore(), isA<MosaicRestoreProviderUnavailable>());
    expect(
      await provider.activeEntitlements(),
      isA<MosaicEntitlementsProviderUnavailable>(),
    );
  });

  test('restore already-entitled provider state normalizes to restored',
      () async {
    final setup = _setup();
    final client = _FakeRevenueCatClient(
      products: <revenuecat.StoreProduct>[setup.monthly],
      offerings: setup.offerings,
      restoreFailure: _error(
        revenuecat.PurchasesErrorCode.productAlreadyPurchasedError,
      ),
      customerActiveEntitlement: 'pro',
    );
    final result = await setup.provider(client).restore();

    expect(result, isA<MosaicRestored>());
    expect(
      (result as MosaicRestored)
          .entitlements
          .map((entitlement) => entitlement.id),
      <String>['pro'],
    );
  });

  test('restore already-entitled with no active access is nothing to restore',
      () async {
    final setup = _setup();
    final client = _FakeRevenueCatClient(
      products: <revenuecat.StoreProduct>[setup.monthly],
      offerings: setup.offerings,
      restoreFailure: _error(
        revenuecat.PurchasesErrorCode.productAlreadyPurchasedError,
      ),
    );

    expect(
      await setup.provider(client).restore(),
      isA<MosaicNothingToRestore>(),
    );
  });

  test('router rejects a mismatched installed adapter identity', () {
    final setup = _setup();
    final router = MosaicCommerceProviderRouter(
      factories: <MosaicCommerceProviderFactory>[
        _MismatchedRevenueCatFactory(setup.configuration),
      ],
    );

    expect(
      router.activate(
        commerceConfiguration: setup.configuration,
        configurationRelease: setup.release,
      ),
      isFalse,
    );
    expect(router.activeProvider, isNull);
  });
}

final class _MismatchedRevenueCatFactory
    implements MosaicCommerceProviderFactory {
  const _MismatchedRevenueCatFactory(this.configuration);

  final MosaicCommerceConfiguration configuration;

  @override
  String get providerId => 'revenuecat';

  @override
  MosaicCommerceProvider create({
    required MosaicCommerceConfiguration commerceConfiguration,
    required MosaicConfigurationRelease configurationRelease,
  }) =>
      _MismatchedRevenueCatProvider(configuration);
}

final class _MismatchedRevenueCatProvider implements MosaicCommerceProvider {
  const _MismatchedRevenueCatProvider(this.configuration);

  final MosaicCommerceConfiguration configuration;

  @override
  MosaicProviderIdentity get identity => const MosaicProviderIdentity(
        id: 'revenuecat',
        displayName: 'RevenueCat',
        adapterVersion: '9.9.9',
      );

  @override
  List<MosaicProviderCapability> get capabilities =>
      configuration.activeProvider.capabilities;

  @override
  List<MosaicCommerceDiagnostic> get diagnostics =>
      const <MosaicCommerceDiagnostic>[];

  @override
  Future<MosaicActiveEntitlementsResult> activeEntitlements() async =>
      const MosaicEntitlementsUnknown();

  @override
  Future<MosaicProductLoadResult> loadProducts(
    Iterable<String> productIds,
  ) async =>
      MosaicProductsUnavailable(productIds);

  @override
  Future<MosaicPurchaseResult> purchase(String productId) async =>
      MosaicPurchaseProductUnavailable(productId: productId);

  @override
  Future<MosaicRestoreResult> restore() async => const MosaicNothingToRestore();
}

final class _Setup {
  _Setup({
    required this.configuration,
    required this.release,
    required this.monthly,
    required this.yearly,
    required this.yearlyPackage,
    required this.offerings,
  });

  final MosaicCommerceConfiguration configuration;
  final MosaicConfigurationRelease release;
  final revenuecat.StoreProduct monthly;
  final revenuecat.StoreProduct yearly;
  final revenuecat.Package yearlyPackage;
  final revenuecat.Offerings offerings;

  MosaicRevenueCatPurchaseProvider provider(
    MosaicRevenueCatClient client,
  ) =>
      MosaicRevenueCatPurchaseProvider(
        commerceConfiguration: configuration,
        configurationRelease: release,
        client: client,
      );
}

_Setup _setup() {
  final source = _fixtureSource();
  final release = _releaseFor(source);
  final configuration = const MosaicCommerceConfigurationDecoder()
      .decode(
        source,
        expectedRelease: release,
        expectedApplicationId: 'application_ios',
        expectedStorePlatform: MosaicStorePlatform.ios,
      )
      .configuration;
  const monthly = revenuecat.StoreProduct(
    'com.example.pro.monthly',
    'Monthly access',
    'Pro Monthly',
    9.99,
    r'$9.99',
    'USD',
    productCategory: revenuecat.ProductCategory.subscription,
    subscriptionPeriod: 'P1M',
  );
  const yearly = revenuecat.StoreProduct(
    'com.example.pro.yearly',
    'Yearly access',
    'Pro Yearly',
    79.99,
    r'$79.99',
    'USD',
    productCategory: revenuecat.ProductCategory.subscription,
    subscriptionPeriod: 'P1Y',
  );
  const context = revenuecat.PresentedOfferingContext(
    'default',
    null,
    null,
  );
  const yearlyPackage = revenuecat.Package(
    r'$rc_annual',
    revenuecat.PackageType.annual,
    yearly,
    context,
  );
  const offering = revenuecat.Offering(
    'default',
    'Default',
    <String, Object>{},
    <revenuecat.Package>[yearlyPackage],
    annual: yearlyPackage,
  );
  return _Setup(
    configuration: configuration,
    release: release,
    monthly: monthly,
    yearly: yearly,
    yearlyPackage: yearlyPackage,
    offerings: const revenuecat.Offerings(
      <String, revenuecat.Offering>{'default': offering},
      current: offering,
    ),
  );
}

final class _FakeRevenueCatClient implements MosaicRevenueCatClient {
  _FakeRevenueCatClient({
    required this.products,
    required this.offerings,
    Iterable<Object> purchases = const <Object>[],
    Iterable<PlatformException> productFailures = const <PlatformException>[],
    this.restoreFailure,
    this.entitlementFailure,
    this.customerActiveEntitlement,
  })  : _purchases = Queue<Object>.of(purchases),
        _productFailures = Queue<PlatformException>.of(productFailures);

  final List<revenuecat.StoreProduct> products;
  final revenuecat.Offerings offerings;
  final Queue<Object> _purchases;
  final Queue<PlatformException> _productFailures;
  final PlatformException? restoreFailure;
  final PlatformException? entitlementFailure;
  final String? customerActiveEntitlement;
  final List<revenuecat.PurchaseParams> purchaseParameters =
      <revenuecat.PurchaseParams>[];

  @override
  Future<List<revenuecat.StoreProduct>> getProducts(
    List<String> productIdentifiers, {
    required revenuecat.ProductCategory productCategory,
  }) async {
    if (_productFailures.isNotEmpty) throw _productFailures.removeFirst();
    return products
        .where(
          (product) =>
              productIdentifiers.contains(product.identifier) &&
              product.productCategory == productCategory,
        )
        .toList(growable: false);
  }

  @override
  Future<revenuecat.Offerings> getOfferings() async => offerings;

  @override
  Future<revenuecat.PurchaseResult> purchase(
    revenuecat.PurchaseParams parameters,
  ) async {
    purchaseParameters.add(parameters);
    final result = _purchases.removeFirst();
    if (result is PlatformException) throw result;
    return result as revenuecat.PurchaseResult;
  }

  @override
  Future<revenuecat.CustomerInfo> restorePurchases() async {
    if (restoreFailure case final failure?) throw failure;
    return _customerInfo();
  }

  @override
  Future<revenuecat.CustomerInfo> getCustomerInfo() async {
    if (entitlementFailure case final failure?) throw failure;
    return _customerInfo(activeEntitlement: customerActiveEntitlement);
  }
}

PlatformException _error(revenuecat.PurchasesErrorCode code) =>
    PlatformException(code: code.index.toString(), message: 'secret raw error');

revenuecat.PurchaseResult _purchaseResult(
  revenuecat.StoreProduct product, {
  String? activeEntitlement,
}) =>
    revenuecat.PurchaseResult(
      _customerInfo(activeEntitlement: activeEntitlement),
      revenuecat.StoreTransaction(
        'transaction_1',
        product.identifier,
        '2026-07-23T12:00:00Z',
      ),
    );

revenuecat.CustomerInfo _customerInfo({String? activeEntitlement}) {
  final active = <String, revenuecat.EntitlementInfo>{};
  if (activeEntitlement != null) {
    active[activeEntitlement] = revenuecat.EntitlementInfo(
      activeEntitlement,
      true,
      true,
      '2026-07-23T12:00:00Z',
      '2026-07-23T12:00:00Z',
      'com.example.pro.monthly',
      true,
    );
  }
  return revenuecat.CustomerInfo(
    revenuecat.EntitlementInfos(active, active),
    const <String, String?>{},
    const <String>[],
    const <String>[],
    const <revenuecat.StoreTransaction>[],
    '2026-07-23T12:00:00Z',
    'redacted',
    const <String, String?>{},
    '2026-07-23T12:00:00Z',
  );
}

String _fixtureSource() {
  var directory = Directory.current.absolute;
  while (true) {
    final file = File(
      '${directory.path}/protocol/fixtures/commerce-configuration/v2/'
      'revenuecat-configuration.json',
    );
    if (file.existsSync()) return file.readAsStringSync();
    if (directory.parent.path == directory.path) {
      throw StateError('Cannot locate RevenueCat configuration fixture.');
    }
    directory = directory.parent;
  }
}

MosaicConfigurationRelease _releaseFor(String source) {
  final root = jsonDecode(source) as Map<String, Object?>;
  final configuration = root['configuration']! as Map<String, Object?>;
  final association =
      configuration['configurationRelease']! as Map<String, Object?>;
  return MosaicConfigurationRelease(
    id: association['id']! as String,
    number: 42,
    environment: MosaicDeliveredEnvironment(
      id: configuration['environmentId']! as String,
      key: 'production',
    ),
    publishedAt: '2026-07-23T12:00:00Z',
    contentDigest: association['contentDigest']! as String,
    requiredCapabilities: const <MosaicRequiredCapability>[],
    paywallVersions: const <String, MosaicDeliveredPaywallVersion>{},
    // Derived from the fixture's own mappings rather than restated here: the
    // decoder requires the release's Product set to equal the configuration's
    // exactly, so a hand-written list drifts silently the moment the canonical
    // fixture gains or renames a Product.
    productReferences: <String, MosaicDeliveredProductReference>{
      for (final raw in configuration['productMappings']! as List<Object?>)
        (raw! as Map<String, Object?>)['mosaicProductId']! as String:
            MosaicDeliveredProductReference(
          id: (raw as Map<String, Object?>)['mosaicProductId']! as String,
          type: raw['productType'] == 'subscription'
              ? MosaicDeliveredProductType.subscription
              : MosaicDeliveredProductType.oneTimeNonConsumable,
          fallbackDisplayName: raw['mosaicProductId']! as String,
        ),
    },
    assetReferences: const <String, MosaicDeliveredAssetReference>{},
  );
}
