import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/customer_authority_fixture.dart';

void main() {
  test('Delivery v2 canonical snapshots decode atomically', () {
    const decoder = MosaicConfigurationDeliveryDecoder();
    final advanced = decoder
        .decode(_fixture('configuration-delivery/v2/advanced-release.json'));
    expect(advanced.version, mosaicConfigurationDeliveryVersionV2);
    expect(advanced.release.decisionForPlacement('export_pdf'), isNotNull);
    expect(advanced.release.projectId, 'project_alpha');
    expect(advanced.release.paywallVersions, hasLength(3));
    expect(advanced.release.environment.mode,
        MosaicDeliveredEnvironmentMode.production);

    final noPaywall = decoder
        .decode(_fixture('configuration-delivery/v2/no-paywall-release.json'));
    expect(noPaywall.release.paywallVersions, isEmpty);

    final staging = decoder.decode(
        _fixture('configuration-delivery/v2/staging-qa-override-release.json'));
    expect(staging.release.environment.mode,
        MosaicDeliveredEnvironmentMode.staging);
    expect(
      staging.release
          .decisionForPlacement('onboarding_complete')!
          .requiredFeatures,
      <String>{'outcome.no_paywall', 'override.qa'},
    );

    for (final path in _invalidDeliveryV2Fixtures) {
      expect(
        () => decoder.decode(_fixture(path)),
        throwsA(isA<MosaicConfigurationDeliveryException>()),
        reason: path,
      );
    }

    for (final path in _invalidDecisionV1Fixtures) {
      expect(
        () => const MosaicPlacementDecisionDecoder()
            .decode(jsonDecode(_fixture(path))),
        throwsA(isA<MosaicPlacementDecisionException>()),
        reason: path,
      );
    }
  });

  test('invalid Delivery v2 refreshes retain the atomic last-known-valid',
      () async {
    final cache = _MemoryCache();
    final transport = _QueuedTransport(<MosaicConfigurationResponse>[
      for (final path in _invalidDeliveryV2Fixtures)
        MosaicConfigurationUpdatedResponse(
          source: _fixture(path),
          etag: '"${path.split('/').last}"',
        ),
    ]);
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_test',
      baseUrl: Uri.parse('https://mosaic.example'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: transport,
      cache: cache,
      identityStorage: MosaicMemoryIdentityStorage(),
      bundledFallbackLoader: () async =>
          _fixture('configuration-delivery/v2/advanced-release.json'),
    );
    expect(await mosaic.loadConfiguration(), isA<MosaicConfigurationReady>());
    final accepted = mosaic.acceptedConfiguration;
    expect(accepted!.envelope.version, mosaicConfigurationDeliveryVersionV2);

    for (var index = 0; index < _invalidDeliveryV2Fixtures.length; index += 1) {
      expect(await mosaic.refreshConfiguration(),
          isA<MosaicConfigurationRetained>());
      expect(mosaic.acceptedConfiguration, same(accepted));
    }
    expect(cache.writes, 0);
  });

  test('Paywall-unavailable fallback edges are traversed for cycles', () {
    final fixture = jsonDecode(
      _fixture('placement-decision/v1/evaluator-conformance.json'),
    )! as Map<String, Object?>;
    final decision = (fixture['decision']! as Map).cast<String, Object?>();
    final ruleSet = (decision['ruleSet']! as Map).cast<String, Object?>();
    final fallbacks = ruleSet['fallbacks']! as List<Object?>;
    final fallback = (fallbacks.single! as Map).cast<String, Object?>();
    final outcome = (fallback['outcome']! as Map).cast<String, Object?>();
    outcome['unavailableFallbackKey'] = fallback['key'];

    expect(
      () => const MosaicPlacementDecisionDecoder().decode(decision),
      throwsA(isA<MosaicPlacementDecisionException>()),
    );
  });

  test('offline bundled decision returns explicit no-paywall without fetching',
      () async {
    final transport = _QueuedTransport(<MosaicConfigurationResponse>[]);
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_test',
      baseUrl: Uri.parse('https://mosaic.example'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: transport,
      cache: _MemoryCache(),
      identityStorage: MosaicMemoryIdentityStorage(),
      bundledFallbackLoader: () async =>
          _fixture('configuration-delivery/v2/no-paywall-release.json'),
    );
    await mosaic.loadConfiguration();
    final resolution = await mosaic.decidePlacement('onboarding_complete');
    expect(resolution, isA<MosaicPlacementNoPaywall>());
    expect(transport.fetches, 0);
  });

  test('Mosaic authority never unions provider-observed access', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      final v1 = (jsonDecode(_fixture(
        'authoritative-entitlement/v1/snapshots/'
        'inactive-expired-subscription.json',
      )) as Map)
          .cast<String, Object?>();
      final payload = (v1['payload']! as Map).cast<String, Object?>()
        ..['projectId'] = 'project_alpha'
        ..['environmentId'] = 'environment_production';
      payload['contentDigest'] = mosaicCustomerContentDigest(payload);
      final provider = MockMosaicPurchaseProvider(
        products: const <MosaicProduct>[
          MosaicProduct(
            id: 'product_export_pro',
            title: 'Export Pro',
            localizedPrice: r'$9.99',
          ),
        ],
        activeEntitlements: const <MosaicEntitlement>[
          MosaicEntitlement(id: 'pro'),
        ],
      );
      final mosaic = Mosaic.configure(
        publicSdkKey: 'public_test',
        baseUrl: Uri.parse('https://mosaic.example'),
        applicationId: fixtureAuthorityApplicationId,
        applicationVersion: '4.2.0',
        purchaseProvider: provider,
        transport: _QueuedTransport(<MosaicConfigurationResponse>[]),
        cache: _MemoryCache(),
        identityStorage: MosaicMemoryIdentityStorage(),
        bundledFallbackLoader: () async =>
            _fixture('configuration-delivery/v2/advanced-release.json'),
        customerEntitlementCache: MosaicMemoryCustomerEntitlementCache(),
        customerEntitlementTransport:
            _EntitlementTransport(wrapCustomerSnapshotV2(jsonEncode(v1))),
        customerTokenProvider: (_) async => MosaicCustomerToken(
          value: 'mcat_secret',
          tokenId: 'token-a',
          expiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
        ),
        customerEntitlementSettings: const MosaicCustomerEntitlementSettings(
          refreshOnResume: false,
        ),
      );

      await mosaic.loadConfiguration();
      final unknownAuthority = await mosaic.decidePlacement('export_pdf');
      expect(mosaic.customerAuthority, isNull);
      expect(
        (unknownAuthority as MosaicPlacementNoPaywall).decision.matchedRuleId,
        isNot('rule_pro'),
        reason: 'Unknown authority must not fall back to provider access.',
      );

      await mosaic.refreshCustomerEntitlements();
      final result = await mosaic.decidePlacement('export_pdf');

      expect(mosaic.customerAuthority?.isMosaic, isTrue);
      expect(result, isA<MosaicPlacementNoPaywall>());
      expect(
        (result as MosaicPlacementNoPaywall).decision.matchedRuleId,
        isNot('rule_pro'),
      );
      mosaic.dispose();
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  test('rollout implementation matches every cross-platform vector', () {
    final fixture = jsonDecode(
      _fixture('placement-decision/v1/rollout-vectors.json'),
    )! as Map<String, Object?>;
    for (final raw in fixture['vectors']! as List<Object?>) {
      final vector = (raw! as Map).cast<String, Object?>();
      expect(
        mosaicRolloutBucket(
          projectId: vector['projectId']! as String,
          environmentId: vector['environmentId']! as String,
          placementId: vector['placementId']! as String,
          ruleId: vector['ruleId']! as String,
          assignmentKeyType: vector['assignmentKeyType']! as String,
          assignmentKeyValue: vector['assignmentKeyValue']! as String,
        ),
        vector['bucket'],
      );
    }
  });

  test(
      'pure evaluator matches the canonical priority, fallback, and unknown cases',
      () {
    final fixture = jsonDecode(
      _fixture('placement-decision/v1/evaluator-conformance.json'),
    )! as Map<String, Object?>;
    final ruleSet =
        const MosaicPlacementDecisionDecoder().decode(fixture['decision']);
    for (final raw in fixture['cases']! as List<Object?>) {
      final testCase = (raw! as Map).cast<String, Object?>();
      final context = (testCase['context']! as Map).cast<String, Object?>();
      final assignment =
          (testCase['assignment']! as Map).cast<String, Object?>();
      final expected = (testCase['expected']! as Map).cast<String, Object?>();
      final result = const MosaicPlacementDecisionEvaluator().evaluate(
        ruleSet: ruleSet,
        context: MosaicDecisionContext(
          platform: context['platform'] as String?,
          applicationLocale: context['applicationLocale'] as String?,
          applicationVersion: context['applicationVersion'] as String?,
          country: context['country'] as String?,
          attributes: _attributes(context['attributes']),
          entitlements: _entitlements(context['entitlements']),
          products: _products(context['products']),
        ),
        assignment: MosaicAssignmentKey(
          type: assignment['type']! as String,
          value: assignment['value']! as String,
        ),
      );
      expect(result.matchedRuleId, expected['matchedRuleId'],
          reason: testCase['name']! as String);
      final expectedOutcome =
          (expected['outcome']! as Map).cast<String, Object?>();
      switch (expectedOutcome['type']) {
        case 'no_paywall':
          expect(result, isA<MosaicNoPaywallSelected>());
        case 'paywall':
          expect(result, isA<MosaicPaywallSelected>());
          expect(
            (result as MosaicPaywallSelected).paywallVersionId,
            expectedOutcome['paywallVersionId'],
          );
      }
      expect(result.fallbackPath, expected['fallbackPath'] ?? <Object?>[]);
      if (expected.containsKey('rolloutBucket')) {
        expect(result.rolloutBucket, expected['rolloutBucket']);
      }
    }
  });

  test(
      'identity persists, user reset retains install, and install reset rotates',
      () async {
    final storage = MosaicMemoryIdentityStorage();
    final first =
        MosaicIdentityController(storage: storage, namespace: 'a' * 64);
    final anonymous = await first.load();
    await first.identify('user_123');
    await first.setAttributes(
      const <String, MosaicAttributeValue>{
        'student': MosaicBooleanAttribute(true),
      },
    );

    final reconstructed =
        MosaicIdentityController(storage: storage, namespace: 'a' * 64);
    expect(
        (await reconstructed.load()).installationId, anonymous.installationId);
    expect(reconstructed.current!.userId, 'user_123');
    final reset = await reconstructed.resetUser();
    expect(reset.installationId, anonymous.installationId);
    expect(reset.userId, isNull);
    expect(reset.attributes, isEmpty);
    await reconstructed.identify('user_456');
    await reconstructed.setAttributes(
      const <String, MosaicAttributeValue>{
        'student': MosaicBooleanAttribute(true),
      },
    );
    final rotated = await reconstructed.rotateInstallation();
    expect(rotated.installationId, isNot(anonymous.installationId));
    expect(rotated.userId, isNull);
    expect(rotated.attributes, isEmpty);
  });
}

const List<String> _invalidDeliveryV2Fixtures = <String>[
  'configuration-delivery/v2/invalid/unsupported-operator.json',
  'configuration-delivery/v2/invalid/invalid-condition-type.json',
  'configuration-delivery/v2/invalid/duplicate-priority.json',
  'configuration-delivery/v2/invalid/fallback-cycle.json',
  'configuration-delivery/v2/invalid/incompatible-source-operator.json',
  'configuration-delivery/v2/invalid/missing-unavailable-fallback.json',
  'configuration-delivery/v2/invalid/underdeclared-features.json',
  'configuration-delivery/v2/invalid/overdeclared-features.json',
  'configuration-delivery/v2/invalid/release-underdeclared-compatibility.json',
  'configuration-delivery/v2/invalid/release-overdeclared-compatibility.json',
  'configuration-delivery/v2/invalid/qa-override-over-24h.json',
  'configuration-delivery/v2/invalid/production-qa-override.json',
  'configuration-delivery/v2/invalid/invalid-environment-mode.json',
];

const List<String> _invalidDecisionV1Fixtures = <String>[
  'placement-decision/v1/invalid/unsupported-operator.json',
  'placement-decision/v1/invalid/invalid-condition-type.json',
  'placement-decision/v1/invalid/duplicate-priority.json',
  'placement-decision/v1/invalid/fallback-cycle.json',
  'placement-decision/v1/invalid/incompatible-source-operator.json',
  'placement-decision/v1/invalid/missing-unavailable-fallback.json',
  'placement-decision/v1/invalid/underdeclared-features.json',
  'placement-decision/v1/invalid/overdeclared-features.json',
  'placement-decision/v1/invalid/qa-override-over-24h.json',
];

Map<String, MosaicAttributeValue> _attributes(Object? value) {
  if (value is! Map) return const {};
  return <String, MosaicAttributeValue>{
    for (final entry in value.entries)
      entry.key! as String: switch ((entry.value! as Map)['type']) {
        'boolean' => MosaicBooleanAttribute(
            (entry.value! as Map)['value']! as bool,
          ),
        _ => throw StateError('Unsupported fixture attribute.'),
      },
  };
}

Map<String, MosaicEntitlementDecisionState> _entitlements(Object? value) {
  if (value is! Map) return const {};
  return <String, MosaicEntitlementDecisionState>{
    for (final entry in value.entries)
      entry.key! as String: switch (entry.value) {
        'active' => MosaicEntitlementDecisionState.active,
        'inactive' => MosaicEntitlementDecisionState.inactive,
        'unknown' => MosaicEntitlementDecisionState.unknown,
        _ => throw StateError('Unsupported fixture Entitlement state.'),
      },
  };
}

Map<String, MosaicProductDecisionState> _products(Object? value) {
  if (value is! Map) return const {};
  return <String, MosaicProductDecisionState>{
    for (final entry in value.entries)
      entry.key! as String: switch (entry.value) {
        'available' => MosaicProductDecisionState.available,
        'unavailable' => MosaicProductDecisionState.unavailable,
        'unknown' => MosaicProductDecisionState.unknown,
        _ => throw StateError('Unsupported fixture Product state.'),
      },
  };
}

String _fixture(String relativePath) {
  var directory = Directory.current.absolute;
  while (true) {
    final file = File('${directory.path}/protocol/fixtures/$relativePath');
    if (file.existsSync()) return file.readAsStringSync();
    if (directory.parent.path == directory.path) {
      throw StateError('Cannot locate canonical fixture $relativePath.');
    }
    directory = directory.parent;
  }
}

final class _MemoryCache implements MosaicConfigurationCache {
  var writes = 0;
  MosaicConfigurationCacheEntry? entry;

  @override
  Future<MosaicConfigurationCacheEntry?> read(String namespace) async => entry;

  @override
  Future<void> write(
      String namespace, MosaicConfigurationCacheEntry entry) async {
    writes += 1;
    this.entry = entry;
  }
}

final class _QueuedTransport implements MosaicConfigurationTransport {
  _QueuedTransport(this.responses);
  final List<MosaicConfigurationResponse> responses;
  var fetches = 0;

  @override
  Future<MosaicConfigurationResponse> fetch(
      MosaicConfigurationRequest request) async {
    fetches += 1;
    return responses.removeAt(0);
  }
}

final class _EntitlementTransport
    implements MosaicCustomerEntitlementTransport {
  const _EntitlementTransport(this.source);

  final String source;

  @override
  Future<MosaicCustomerEntitlementSyncResponse> sync(
    MosaicCustomerEntitlementSyncRequest request,
  ) async =>
      MosaicCustomerEntitlementSyncReceived(source: source);
}
