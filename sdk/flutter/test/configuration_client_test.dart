import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
import 'package:mosaic_sdk/src/sha256.dart';

import 'support/configuration_delivery_fixture.dart';

void main() {
  test('accepts 200 atomically and 304 preserves the accepted cache', () async {
    final transport = _Transport(<MosaicConfigurationResponse>[
      MosaicConfigurationUpdatedResponse(
        source: deliveryFixtureSource(),
        etag: '"release-1"',
      ),
      const MosaicConfigurationNotModifiedResponse(),
    ]);
    final cache = _Cache();
    final mosaic = _mosaic(transport: transport, cache: cache);

    final initial = await mosaic.loadConfiguration();
    expect(initial, isA<MosaicConfigurationReady>());
    expect(mosaic.acceptedConfiguration!.source,
        MosaicConfigurationSource.bundledFallback);

    final updated = await mosaic.refreshConfiguration();
    expect(updated, isA<MosaicConfigurationUpdated>());
    expect(cache.writes, 1);
    expect(
        mosaic.acceptedConfiguration!.source, MosaicConfigurationSource.remote);

    final notModified = await mosaic.refreshConfiguration();
    expect(notModified, isA<MosaicConfigurationNotModified>());
    expect(cache.writes, 1);
    expect(transport.requests.last.etag, '"release-1"');
  });

  test('malformed, unsupported, and failed refresh preserve last known valid',
      () async {
    final cache = _Cache(
      entry: MosaicConfigurationCacheEntry(
        etag: '"cached"',
        releaseSource: deliveryFixtureSource(),
      ),
    );
    final transport = _Transport(<MosaicConfigurationResponse>[
      MosaicConfigurationUpdatedResponse(
        source: deliveryFixtureSource('invalid/malformed-release.json'),
        etag: '"malformed"',
      ),
      MosaicConfigurationUpdatedResponse(
        source: deliveryFixtureSource(
          'invalid/unsupported-contract-version.json',
        ),
        etag: '"unsupported"',
      ),
      const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.networkFailed',
      ),
    ]);
    final mosaic = _mosaic(transport: transport, cache: cache);
    await mosaic.loadConfiguration();
    final original = mosaic.acceptedConfiguration;

    for (var index = 0; index < 3; index += 1) {
      expect(await mosaic.refreshConfiguration(),
          isA<MosaicConfigurationRetained>());
      expect(mosaic.acceptedConfiguration, same(original));
    }
    expect(cache.writes, 0);
  });

  test('cache survives reconstruction and presentation never fetches',
      () async {
    final cache = _Cache();
    final firstTransport = _Transport(<MosaicConfigurationResponse>[
      MosaicConfigurationUpdatedResponse(
        source: deliveryFixtureSource(),
        etag: '"release-1"',
      ),
    ]);
    final first = _mosaic(transport: firstTransport, cache: cache);
    await first.refreshConfiguration();

    final secondTransport = _Transport(const <MosaicConfigurationResponse>[]);
    final second = _mosaic(transport: secondTransport, cache: cache);
    final loaded = await second.loadConfiguration();
    expect(loaded, isA<MosaicConfigurationReady>());
    expect(
        second.acceptedConfiguration!.source, MosaicConfigurationSource.cache);
    expect(
      second.resolvePlacement('onboarding_complete'),
      isA<MosaicPlacementResolved>(),
    );
    expect(secondTransport.fetches, 0);
  });

  test('concurrent manual refreshes coalesce', () async {
    final response = Completer<MosaicConfigurationResponse>();
    final transport = _DelayedTransport(response.future);
    final mosaic = _mosaic(transport: transport, cache: _Cache());

    final first = mosaic.refreshConfiguration();
    final second = mosaic.refreshConfiguration();
    for (var attempt = 0;
        attempt < 50 && transport.fetches == 0;
        attempt += 1) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(transport.fetches, 1);
    response.complete(
      MosaicConfigurationUpdatedResponse(
        source: deliveryFixtureSource(),
        etag: '"release-1"',
      ),
    );
    expect(await first, isA<MosaicConfigurationUpdated>());
    expect(await second, isA<MosaicConfigurationUpdated>());
    expect(transport.fetches, 1);
  });

  test('remote Environment may replace a synthetic bundled Environment',
      () async {
    final transport = _Transport(<MosaicConfigurationResponse>[
      MosaicConfigurationUpdatedResponse(
        source: deliveryFixtureSource(),
        etag: '"release-1"',
      ),
    ]);
    final mosaic = _mosaic(
      transport: transport,
      cache: _Cache(),
      bundledFallbackSource: _releaseWithEnvironment('environment_bundle'),
    );

    await mosaic.loadConfiguration();
    expect(
      mosaic.acceptedConfiguration!.envelope.release.environment.id,
      'environment_bundle',
    );
    expect(
        await mosaic.refreshConfiguration(), isA<MosaicConfigurationUpdated>());
    expect(
      mosaic.acceptedConfiguration!.envelope.release.environment.id,
      'environment_staging',
    );
  });

  test('remote Environment cannot replace an accepted hosted Environment',
      () async {
    final originalSource = deliveryFixtureSource();
    final cache = _Cache(
      entry: MosaicConfigurationCacheEntry(
        etag: '"release-1"',
        releaseSource: originalSource,
      ),
    );
    final transport = _Transport(<MosaicConfigurationResponse>[
      MosaicConfigurationUpdatedResponse(
        source: _releaseWithEnvironment('environment_production'),
        etag: '"release-2"',
      ),
    ]);
    final mosaic = _mosaic(transport: transport, cache: cache);

    await mosaic.loadConfiguration();
    expect(await mosaic.refreshConfiguration(),
        isA<MosaicConfigurationRetained>());
    expect(cache.writes, 0);
    expect(
      mosaic.acceptedConfiguration!.envelope.release.environment.id,
      'environment_staging',
    );
  });

  test('invalid remote sidecar retains the atomically cached release pair',
      () async {
    final releaseSource = deliveryFixtureSource('product-reference.json');
    final validSidecar = _commerceForRelease(releaseSource);
    final invalidSidecar =
        validSidecar.replaceFirst('application_ios', 'application_other');
    final cache = _Cache(
      entry: MosaicConfigurationCacheEntry(
        etag: '"release-product"',
        releaseSource: releaseSource,
        commerceConfigurationSource: validSidecar,
      ),
    );
    final mosaic = _mosaic(
      transport: _Transport(<MosaicConfigurationResponse>[
        MosaicConfigurationUpdatedResponse(
          source: releaseSource,
          etag: '"release-product-2"',
        ),
      ]),
      cache: cache,
      applicationId: 'application_ios',
      storePlatform: MosaicStorePlatform.ios,
      commerceConfigurationLoader: (_) async => invalidSidecar,
    );

    expect(await mosaic.loadConfiguration(), isA<MosaicConfigurationReady>());
    final accepted = mosaic.acceptedConfiguration;
    expect(accepted!.commerceEnvelope, isNotNull);

    expect(
      await mosaic.refreshConfiguration(),
      isA<MosaicConfigurationRetained>(),
    );
    expect(mosaic.acceptedConfiguration, same(accepted));
    expect(cache.writes, 0);
    expect(
      cache.entry!.commerceConfigurationSource,
      validSidecar,
    );
  });

  test('commerce 304 reuses only the validated cached release pair', () async {
    final releaseSource = deliveryFixtureSource('product-reference.json');
    final sidecar = _commerceForRelease(releaseSource);
    final sidecarDigest =
        ((jsonDecode(sidecar) as Map<String, Object?>)['configuration']!
            as Map<String, Object?>)['contentDigest']! as String;
    final sidecarEtag = '"$sidecarDigest"';
    final cache = _Cache(
      entry: MosaicConfigurationCacheEntry(
        etag: '"release-product"',
        releaseSource: releaseSource,
        commerceConfigurationSource: sidecar,
        commerceConfigurationEtag: sidecarEtag,
      ),
    );
    final commerceTransport = _CommerceTransport(
      const MosaicCommerceConfigurationNotModifiedResponse(),
    );
    final mosaic = _mosaic(
      transport: _Transport(<MosaicConfigurationResponse>[
        MosaicConfigurationUpdatedResponse(
          source: releaseSource,
          etag: '"release-product-2"',
        ),
      ]),
      cache: cache,
      applicationId: 'application_ios',
      storePlatform: MosaicStorePlatform.ios,
      commerceConfigurationTransport: commerceTransport,
    );

    expect(await mosaic.loadConfiguration(), isA<MosaicConfigurationReady>());
    expect(
      await mosaic.refreshConfiguration(),
      isA<MosaicConfigurationUpdated>(),
    );
    expect(commerceTransport.requests.single.retained!.etag, sidecarEtag);
    expect(cache.entry!.commerceConfigurationSource, sidecar);
    expect(cache.entry!.commerceConfigurationEtag, sidecarEtag);
    expect(cache.entry!.etag, '"release-product-2"');
  });
}

Mosaic _mosaic({
  required MosaicConfigurationTransport transport,
  required MosaicConfigurationCache cache,
  String? bundledFallbackSource,
  String? applicationId,
  MosaicStorePlatform? storePlatform,
  MosaicCommerceConfigurationLoader? commerceConfigurationLoader,
  MosaicCommerceConfigurationTransport? commerceConfigurationTransport,
}) =>
    Mosaic.configure(
      publicSdkKey: 'mos_public_sdk_test.secret',
      baseUrl: Uri.parse('https://mosaic.example'),
      applicationVersion: '1.0.0',
      applicationId: applicationId,
      storePlatform: storePlatform,
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: transport,
      cache: cache,
      bundledFallbackLoader: () async =>
          bundledFallbackSource ?? deliveryFixtureSource(),
      commerceConfigurationLoader: commerceConfigurationLoader,
      commerceConfigurationTransport: commerceConfigurationTransport,
    );

String _releaseWithEnvironment(String environmentId) {
  final envelope = jsonDecode(deliveryFixtureSource()) as Map<String, Object?>;
  final release = envelope['release']! as Map<String, Object?>;
  final environment = release['environment']! as Map<String, Object?>;
  environment['id'] = environmentId;
  release.remove('contentDigest');
  release['contentDigest'] =
      'sha256:${mosaicSha256String(jsonEncode(_canonicalize(release)))}';
  return jsonEncode(envelope);
}

Object? _canonicalize(Object? value) {
  if (value is List<Object?>) {
    return <Object?>[for (final item in value) _canonicalize(item)];
  }
  if (value is Map<String, Object?>) {
    final keys = value.keys.toList()..sort();
    return <String, Object?>{
      for (final key in keys) key: _canonicalize(value[key]),
    };
  }
  return value;
}

String _commerceForRelease(String releaseSource) {
  final delivery = jsonDecode(releaseSource) as Map<String, Object?>;
  final release = delivery['release']! as Map<String, Object?>;
  final environment = release['environment']! as Map<String, Object?>;
  final products = release['productReferences']! as List<Object?>;
  final configuration = <String, Object?>{
    'id': 'commerce_configuration_test',
    'environmentId': environment['id'],
    'applicationId': 'application_ios',
    'storePlatform': 'ios',
    'configurationRelease': <String, Object?>{
      'id': release['id'],
      'contentDigest': release['contentDigest'],
    },
    'activeProvider': <String, Object?>{
      'identity': <String, Object?>{
        'id': 'custom.example',
        'displayName': 'Custom Example',
        'adapterVersion': '1.0.0',
      },
      'activation': <String, Object?>{
        'source': 'sdkLocal',
        'localSnapshotId': 'snapshot_1',
      },
      'capabilities': <Object?>[
        <String, Object?>{
          'name': 'productLoading',
          'support': 'supported',
        },
      ],
    },
    'productMappings': <Object?>[
      for (final raw in products) _commerceProductMapping(raw),
    ],
    'entitlementMappings': <Object?>[
      <String, Object?>{
        'mosaicEntitlementKey': 'pro',
        'providerEntitlementIdentifier': 'provider_pro',
      },
    ],
    'freshness': <String, Object?>{
      'source': 'sdkLocalSnapshot',
      'status': 'fresh',
      'providerObservedAt': '2026-07-23T12:00:00Z',
      'synchronizedAt': '2026-07-23T12:00:00Z',
      'staleAt': '2026-07-24T12:00:00Z',
    },
    'diagnostics': <Object?>[],
  };
  configuration['contentDigest'] =
      'sha256:${mosaicSha256String(jsonEncode(_canonicalize(configuration)))}';
  return jsonEncode(<String, Object?>{
    'commerceConfigurationVersion': '1',
    'configuration': configuration,
  });
}

Map<String, Object?> _commerceProductMapping(Object? raw) {
  final product = raw! as Map<String, Object?>;
  final id = product['id']! as String;
  return <String, Object?>{
    'mosaicProductId': id,
    'mappingId': 'mapping_$id',
    'providerProductReference': 'provider.$id',
    'adapterMapping': <String, Object?>{'kind': 'directProduct'},
  };
}

final class _Cache implements MosaicConfigurationCache {
  _Cache({this.entry});

  MosaicConfigurationCacheEntry? entry;
  var writes = 0;

  @override
  Future<MosaicConfigurationCacheEntry?> read(String namespace) async => entry;

  @override
  Future<void> write(
    String namespace,
    MosaicConfigurationCacheEntry value,
  ) async {
    writes += 1;
    entry = value;
  }
}

final class _Transport implements MosaicConfigurationTransport {
  _Transport(List<MosaicConfigurationResponse> responses)
      : _responses = List<MosaicConfigurationResponse>.of(responses);

  final List<MosaicConfigurationResponse> _responses;
  final List<MosaicConfigurationRequest> requests =
      <MosaicConfigurationRequest>[];
  int get fetches => requests.length;

  @override
  Future<MosaicConfigurationResponse> fetch(
    MosaicConfigurationRequest request,
  ) async {
    requests.add(request);
    return _responses.removeAt(0);
  }
}

final class _CommerceTransport implements MosaicCommerceConfigurationTransport {
  _CommerceTransport(this.response);

  final MosaicCommerceConfigurationResponse response;
  final List<MosaicCommerceConfigurationRequest> requests =
      <MosaicCommerceConfigurationRequest>[];

  @override
  Future<MosaicCommerceConfigurationResponse> fetch(
    MosaicCommerceConfigurationRequest request,
  ) async {
    requests.add(request);
    return response;
  }
}

final class _DelayedTransport implements MosaicConfigurationTransport {
  _DelayedTransport(this.response);

  final Future<MosaicConfigurationResponse> response;
  var fetches = 0;

  @override
  Future<MosaicConfigurationResponse> fetch(
    MosaicConfigurationRequest request,
  ) {
    fetches += 1;
    return response;
  }
}
