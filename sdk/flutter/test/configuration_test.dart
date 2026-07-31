import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

/// Answers every sync with one scripted snapshot.
final class _FixtureEntitlementTransport
    implements MosaicCustomerEntitlementTransport {
  _FixtureEntitlementTransport(this.source);

  final String source;
  var calls = 0;

  @override
  Future<MosaicCustomerEntitlementSyncResponse> sync(
    MosaicCustomerEntitlementSyncRequest request,
  ) async {
    calls += 1;
    return MosaicCustomerEntitlementSyncReceived(
      source: source,
    );
  }
}

void main() {
  test('configures an isolated Mosaic client', () {
    final provider = MockMosaicPurchaseProvider();
    final mosaic = Mosaic.configure(
      apiKey: ' public_test_key ',
      endpoint: Uri.parse('http://localhost:8080'),
      purchaseProvider: provider,
    );

    expect(mosaic.configuration.apiKey, 'public_test_key');
    expect(mosaic.configuration.endpoint, Uri.parse('http://localhost:8080'));
    expect(mosaic.purchaseProvider, same(provider));
  });

  test('rejects an empty key and relative endpoint', () {
    expect(
      () => MosaicConfiguration(apiKey: '  '),
      throwsA(isA<MosaicConfigurationException>()),
    );
    expect(
      () => MosaicConfiguration(
        apiKey: 'public_test_key',
        endpoint: Uri.parse('/local'),
      ),
      throwsA(isA<MosaicConfigurationException>()),
    );
  });

  group('authoritative entitlements through the client', () {
    final snapshot = repositoryFile(
      'protocol/fixtures/authoritative-entitlement/v1/snapshots/'
      'active-subscription.json',
    ).readAsStringSync();

    Mosaic configure({
      required MosaicCustomerEntitlementCache cache,
      required MosaicCustomerEntitlementTransport transport,
      MosaicCustomerTokenProvider? tokenProvider,
    }) =>
        Mosaic.configure(
          publicSdkKey: 'public_test_key',
          baseUrl: Uri.parse('https://api.mosaic.test'),
          purchaseProvider: MockMosaicPurchaseProvider(),
          identityStorage: MosaicMemoryIdentityStorage(),
          customerEntitlementCache: cache,
          customerEntitlementTransport: transport,
          customerTokenProvider: tokenProvider ??
              (_) async => MosaicCustomerToken(
                    value: 'mcat_secret',
                    tokenId: 'token-a',
                    expiresAt: DateTime.utc(2026, 7, 28, 12)
                        .add(const Duration(hours: 1)),
                  ),
          customerEntitlementSettings: const MosaicCustomerEntitlementSettings(
            refreshOnResume: false,
          ),
          clock: () => DateTime.utc(2026, 7, 28, 12, 30),
        );

    test('identifying a second user cannot read the first user\'s access',
        () async {
      final cache = MosaicMemoryCustomerEntitlementCache();
      final transport = _FixtureEntitlementTransport(snapshot);
      final mosaic = configure(cache: cache, transport: transport);

      await mosaic.identify('user-a');
      await mosaic.refreshCustomerEntitlements();
      expect(
        mosaic.checkCustomerEntitlement('pro').state,
        MosaicCustomerAccessState.active,
      );

      await mosaic.identify('user-b');

      // The leak this guards: user B seeing user A's Pro access because a
      // cached snapshot outlived the sign-in. It must be gone before any read,
      // and the answer must not be inactive either — Mosaic has said nothing
      // about user B yet.
      final check = mosaic.checkCustomerEntitlement('pro');
      expect(check.state, isNot(MosaicCustomerAccessState.active));
      expect(check.state, isNot(MosaicCustomerAccessState.inactive));
      expect(mosaic.customerEntitlements?.snapshot, isNull);
      mosaic.dispose();
    });

    test('resetting user identity signs the customer out of billing too',
        () async {
      final cache = MosaicMemoryCustomerEntitlementCache();
      final mosaic = configure(
        cache: cache,
        transport: _FixtureEntitlementTransport(snapshot),
      );
      await mosaic.identify('user-a');
      await mosaic.refreshCustomerEntitlements();

      await mosaic.resetUserIdentity();

      expect(mosaic.customerEntitlementDiagnostics.token.hasToken, isFalse);
      expect(
        mosaic.checkCustomerEntitlement('pro').state,
        MosaicCustomerAccessState.unavailable,
      );
      mosaic.dispose();
    });

    test('a client without a token provider reports unavailable, not inactive',
        () {
      final mosaic = Mosaic.configure(
        publicSdkKey: 'public_test_key',
        baseUrl: Uri.parse('https://api.mosaic.test'),
        purchaseProvider: MockMosaicPurchaseProvider(),
        identityStorage: MosaicMemoryIdentityStorage(),
      );

      final check = mosaic.checkCustomerEntitlement('pro');
      expect(check.state, MosaicCustomerAccessState.unavailable);
      expect(check.reasonCode, 'entitlements.disabled');
      expect(mosaic.customerEntitlements, isNull);
      mosaic.dispose();
    });
  });
}
