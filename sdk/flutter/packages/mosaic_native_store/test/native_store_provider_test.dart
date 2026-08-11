import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_native_store/mosaic_native_store.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  test('one provider-neutral API installs exact mappings and decodes products',
      () async {
    final channel = _FakeChannel();
    final provider = MosaicGooglePlayProviderFactory(
      acceptUpdate: _accept,
      channel: channel,
    ).create(
      commerceConfiguration: _configuration(),
      configurationRelease: _release(),
    );

    final result = await provider.loadProducts(<String>['product_pro_monthly']);

    expect(result, isA<MosaicProductsLoaded>());
    final product = (result as MosaicProductsLoaded).products.single;
    expect(product.id, 'product_pro_monthly');
    expect(product.localizedPrice, r'$4.99');
    expect(product.entitlementKeys, <String>{'pro'});
    final activation =
        channel.calls.firstWhere((call) => call.$1 == 'activate');
    expect(activation.$1, 'activate');
    final mapping = (activation.$2['mappings']! as List<Object?>).single as Map;
    expect(mapping['providerProductReference'], 'pro_subscription');
    expect(mapping['adapterMapping'], <String, Object?>{
      'kind': 'googlePlayProduct',
      'basePlanId': 'monthly',
      'offerId': 'intro',
    });
  });

  test('accepts matching updates idempotently and rejects stale revisions',
      () async {
    final channel = _FakeChannel();
    final provider = MosaicGooglePlayProviderFactory(
      acceptUpdate: _accept,
      channel: channel,
    ).create(
      commerceConfiguration: _configuration(),
      configurationRelease: _release(),
    ) as MosaicNativeStorePurchaseProvider;
    final updates = <MosaicCommerceUpdate>[];
    final subscription = provider.commerceUpdates.listen(updates.add);
    addTearDown(subscription.cancel);

    final update = _update(_configurationDigest);
    expect(await channel.deliver(update), 'accepted');
    expect(await channel.deliver(update), 'accepted');
    expect(
      await channel.deliver(_update(_staleDigest)),
      'rejectedStaleConfiguration',
    );
    await Future<void>.delayed(Duration.zero);
    expect(updates, hasLength(1));
  });

  test('an unrecognised billing term is omitted rather than guessed', () async {
    // A guessed unit or payment mode misstates what the customer pays. The
    // previous defaults turned any unknown unit into "year" and any unknown
    // payment mode into pay-up-front, which is a wrong price on a paywall.
    final channel = _FakeChannel(
      productMetadata: <String, Object?>{
        'localizedDisplayName': 'Pro monthly',
        'localizedPrice': r'$4.99',
        'billingPeriod': <String, Object?>{'unit': 'fortnight', 'value': 1},
        'introductoryOffer': <String, Object?>{
          'localizedPrice': r'$0.99',
          'period': <String, Object?>{'unit': 'month', 'value': 1},
          'cycles': 1,
          'paymentMode': 'payUpFrontLater',
        },
      },
    );
    final provider = MosaicGooglePlayProviderFactory(
      acceptUpdate: _accept,
      channel: channel,
    ).create(
      commerceConfiguration: _configuration(),
      configurationRelease: _release(),
    ) as MosaicNativeStorePurchaseProvider;

    final result = await provider.loadProducts(<String>['product_pro_monthly']);

    final product = (result as MosaicProductsLoaded).products.single;
    expect(product.billingPeriod, isNull);
    expect(product.introductoryOffer, isNull);
    expect(
      provider.diagnostics.map((item) => item.code),
      contains('commerce.product.unknownTerm'),
    );
  });

  test('an omitted entitlement list stays unknown, not local-config truth',
      () async {
    // `activeEntitlementKeys` is optional in the commerce-provider contract and
    // `entitlementLookupFailure: neverInferInactive` also forbids inferring
    // active. Filling the gap from the local commerce configuration would grant
    // access the store never confirmed.
    final channel = _FakeChannel(
      purchasePayload: <String, Object?>{
        'outcome': 'purchased',
        'transactionReference': 'safe_digest',
      },
    );
    final provider = MosaicGooglePlayProviderFactory(
      acceptUpdate: _accept,
      channel: channel,
    ).create(
      commerceConfiguration: _configuration(),
      configurationRelease: _release(),
    ) as MosaicNativeStorePurchaseProvider;

    final result = await provider.purchase('product_pro_monthly');

    expect(result, isA<MosaicPurchased>());
    expect((result as MosaicPurchased).activeEntitlements, isEmpty);
    expect(
      provider.diagnostics.map((item) => item.code),
      contains('commerce.entitlements.unreported'),
    );
  });

  test('missing plugin becomes a stable provider-unavailable outcome',
      () async {
    final provider = MosaicStoreKitProviderFactory(
      acceptUpdate: _accept,
      channel: _MissingChannel(),
    ).create(
      commerceConfiguration: _configuration(
        providerId: 'app_store',
        platform: MosaicStorePlatform.ios,
      ),
      configurationRelease: _release(),
    );

    expect(
      await provider.purchase('product_pro_monthly'),
      isA<MosaicPurchaseProviderUnavailable>(),
    );
  });
}

Future<MosaicNativeStoreUpdateAcceptanceDisposition> _accept(
  MosaicCommerceUpdate _,
) async =>
    MosaicNativeStoreUpdateAcceptanceDisposition.accepted;

MosaicCommerceConfiguration _configuration({
  String providerId = 'google_play',
  MosaicStorePlatform platform = MosaicStorePlatform.android,
}) {
  final mapping = MosaicCommerceProductMapping(
    mosaicProductId: 'product_pro_monthly',
    mappingId: 'mapping_monthly',
    providerProductReference:
        providerId == 'app_store' ? 'com.example.monthly' : 'pro_subscription',
    adapterMapping: providerId == 'app_store'
        ? const MosaicStoreKitProductMapping()
        : const MosaicGooglePlayProductMapping(
            basePlanId: 'monthly',
            offerId: 'intro',
          ),
    productType: MosaicCommerceProductType.subscription,
    entitlementKeys: const <String>['pro'],
  );
  return MosaicCommerceConfiguration(
    version: '2',
    id: 'commerce_configuration',
    environmentId: 'environment',
    applicationId: 'application',
    storePlatform: platform,
    configurationReleaseId: 'release',
    configurationReleaseDigest: _releaseDigest,
    contentDigest: _configurationDigest,
    activeProvider: MosaicActiveProvider(
      identity: MosaicProviderIdentity(
        id: providerId,
        displayName:
            providerId == 'app_store' ? 'StoreKit' : 'Google Play Billing',
        adapterVersion: '1.0.0',
      ),
      activation: const MosaicNativeStoreProviderActivation(),
      capabilities: const <MosaicProviderCapability>[
        MosaicProviderCapability(
          name: MosaicProviderCapabilityName.productLoading,
          support: MosaicProviderCapabilitySupport.supported,
        ),
      ],
      recoveryMode: providerId == 'app_store'
          ? MosaicCommerceRecoveryMode.storeSynchronization
          : MosaicCommerceRecoveryMode.activePurchaseRecovery,
    ),
    productMappings: <MosaicCommerceProductMapping>[mapping],
    entitlementMappings: const <MosaicCommerceEntitlementMapping>[],
    freshness: MosaicCommerceFreshness(
      source: MosaicCommerceFreshnessSource.nativeStoreConfiguration,
      status: MosaicCommerceFreshnessStatus.configured,
      providerObservedAt: DateTime.utc(2026),
      synchronizedAt: DateTime.utc(2026),
      staleAt: DateTime.utc(2026),
      configuredAt: DateTime.utc(2026),
    ),
    diagnostics: const <MosaicCommerceDiagnostic>[],
  );
}

MosaicConfigurationRelease _release() => MosaicConfigurationRelease(
      id: 'release',
      number: 1,
      environment: const MosaicDeliveredEnvironment(
        id: 'environment',
        key: 'production',
      ),
      publishedAt: '2026-07-24T00:00:00Z',
      contentDigest: _releaseDigest,
      requiredCapabilities: const <MosaicRequiredCapability>[],
      placements: const <String, String>{},
      paywallVersions: const <String, MosaicDeliveredPaywallVersion>{},
      productReferences: const <String, MosaicDeliveredProductReference>{
        'product_pro_monthly': MosaicDeliveredProductReference(
          id: 'product_pro_monthly',
          type: MosaicDeliveredProductType.subscription,
          fallbackDisplayName: 'Pro monthly',
        ),
      },
      assetReferences: const <String, MosaicDeliveredAssetReference>{},
    );

Map<String, Object?> _update(String revision) => <String, Object?>{
      'updateId': 'update_1',
      'providerId': 'google_play',
      'mosaicProductId': 'product_pro_monthly',
      'configuration': <String, Object?>{
        'configurationId': 'commerce_configuration',
        'configurationRevision': revision,
      },
      'outcome': 'purchased',
      'transactionReference': 'safe_digest',
      'activeEntitlementKeys': <String>['pro'],
      'occurredAt': '2026-07-24T12:00:00Z',
      'diagnostics': <Object?>[],
    };

final class _FakeChannel implements MosaicNativeStoreChannel {
  _FakeChannel({this.productMetadata, this.purchasePayload});

  /// Replaces the product metadata the native side reports, so a test can send
  /// a term this Dart bridge does not recognise.
  final Map<String, Object?>? productMetadata;

  /// Replaces the purchase payload, so a test can omit optional contract
  /// fields such as `activeEntitlementKeys`.
  final Map<String, Object?>? purchasePayload;

  final List<(String, Map<String, Object?>)> calls =
      <(String, Map<String, Object?>)>[];
  Future<Object?> Function(String, Object?)? handler;

  @override
  Future<Object?> invoke(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    calls.add((method, arguments ?? <String, Object?>{}));
    return switch (method) {
      'profile' => <String, Object?>{
          'provider': <String, Object?>{
            'id': 'google_play',
            'displayName': 'Google Play Billing',
            'adapterVersion': '1.0.0',
          },
          'capabilities': <Object?>[
            <String, Object?>{
              'name': 'productLoading',
              'support': 'supported',
            },
          ],
          'recoveryMode': 'activePurchaseRecovery',
        },
      'activate' => <String, Object?>{'status': 'ready'},
      'loadProducts' => <String, Object?>{
          'products': <Object?>[
            <String, Object?>{
              'mosaicProductId': 'product_pro_monthly',
              'productType': 'subscription',
              'entitlementKeys': <String>['pro'],
              'availability': 'available',
              'metadata': productMetadata ??
                  <String, Object?>{
                    'localizedDisplayName': 'Pro monthly',
                    'localizedPrice': r'$4.99',
                    'currencyCode': 'USD',
                    'billingPeriod': <String, Object?>{
                      'unit': 'month',
                      'value': 1,
                    },
                  },
            },
          ],
        },
      'purchase' => purchasePayload ?? <String, Object?>{'outcome': 'failed'},
      _ => <String, Object?>{'outcome': 'failed'},
    };
  }

  @override
  void setHandler(Future<Object?> Function(String, Object?)? value) {
    handler = value;
  }

  Future<Object?> deliver(Map<String, Object?> update) =>
      handler!('commerceUpdate', update);
}

final class _MissingChannel implements MosaicNativeStoreChannel {
  @override
  Future<Object?> invoke(
    String method, [
    Map<String, Object?>? arguments,
  ]) =>
      Future<Object?>.error(MissingPluginException());

  @override
  void setHandler(Future<Object?> Function(String, Object?)? handler) {}
}

const String _releaseDigest =
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const String _configurationDigest =
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const String _staleDigest =
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
