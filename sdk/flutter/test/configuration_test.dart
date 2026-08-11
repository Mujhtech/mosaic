import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';
import 'support/customer_authority_fixture.dart';

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

  group('analytics collection default', () {
    // Analytics is opt-out. A host that configures nothing beyond a base URL
    // must get a wired, collecting runtime; a silent regression here would
    // lose every product event without any signal.
    test('a default-configured client wires a collecting analytics runtime',
        () async {
      final diagnostics = <MosaicDiagnostic>[];
      final mosaic = Mosaic.configure(
        publicSdkKey: 'public_analytics_default',
        baseUrl: Uri.parse('https://api.mosaic.test'),
        purchaseProvider: MockMosaicPurchaseProvider(),
        identityStorage: MosaicMemoryIdentityStorage(),
        analyticsStorage: MosaicMemoryAnalyticsStorage(),
        onDiagnostic: diagnostics.add,
      );

      expect(mosaic.analytics, isNotNull);
      expect((await mosaic.analyticsDiagnostics()).collectionEnabled, isTrue);
      // The auto-wiring diagnostic must stay reserved for genuine
      // unavailability, not fire on every default configure.
      expect(
        diagnostics.map((diagnostic) => diagnostic.code),
        isNot(contains('analytics.subsystem.disabled')),
      );
      mosaic.dispose();
    });

    test('no transport still reports the analytics subsystem as disabled', () {
      final diagnostics = <MosaicDiagnostic>[];
      final mosaic = Mosaic.configure(
        publicSdkKey: 'public_analytics_untransported',
        purchaseProvider: MockMosaicPurchaseProvider(),
        identityStorage: MosaicMemoryIdentityStorage(),
        onDiagnostic: diagnostics.add,
      );

      expect(mosaic.analytics, isNull);
      expect(
        diagnostics.map((diagnostic) => diagnostic.code),
        contains('analytics.subsystem.disabled'),
      );
      mosaic.dispose();
    });

    // `context.platform` names only ios and android, so a Flutter host on any
    // other target has its events filed under android. With collection on by
    // default that substitution is now continuous, so it must be reported —
    // otherwise desktop traffic is indistinguishable from Android traffic.
    Mosaic configureOn(TargetPlatform platform, List<MosaicDiagnostic> sink) {
      debugDefaultTargetPlatformOverride = platform;
      try {
        return Mosaic.configure(
          publicSdkKey: 'public_analytics_platform',
          baseUrl: Uri.parse('https://api.mosaic.test'),
          purchaseProvider: MockMosaicPurchaseProvider(),
          identityStorage: MosaicMemoryIdentityStorage(),
          analyticsStorage: MosaicMemoryAnalyticsStorage(),
          onDiagnostic: sink.add,
        );
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    }

    test('an unnameable target reports the substituted analytics platform', () {
      final diagnostics = <MosaicDiagnostic>[];
      configureOn(TargetPlatform.macOS, diagnostics).dispose();
      expect(
        diagnostics.map((diagnostic) => diagnostic.code),
        contains(mosaicAnalyticsPlatformSubstitutedCode),
      );
    });

    test('a nameable target reports no platform substitution', () {
      final diagnostics = <MosaicDiagnostic>[];
      configureOn(TargetPlatform.android, diagnostics).dispose();
      expect(
        diagnostics.map((diagnostic) => diagnostic.code),
        isNot(contains(mosaicAnalyticsPlatformSubstitutedCode)),
      );
    });
  });

  group('authoritative entitlements through the client', () {
    final snapshot = wrapCustomerSnapshotV2(repositoryFile(
      'protocol/fixtures/authoritative-entitlement/v1/snapshots/'
      'active-subscription.json',
    ).readAsStringSync());

    setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.iOS);
    tearDown(() => debugDefaultTargetPlatformOverride = null);

    Mosaic configure({
      required MosaicCustomerEntitlementCache cache,
      required MosaicCustomerEntitlementTransport transport,
      MosaicCustomerTokenProvider? tokenProvider,
    }) =>
        Mosaic.configure(
          publicSdkKey: 'public_test_key',
          baseUrl: Uri.parse('https://api.mosaic.test'),
          applicationId: fixtureAuthorityApplicationId,
          applicationVersion: '4.2.0',
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
