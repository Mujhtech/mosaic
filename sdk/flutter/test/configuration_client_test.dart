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
}

Mosaic _mosaic({
  required MosaicConfigurationTransport transport,
  required MosaicConfigurationCache cache,
  String? bundledFallbackSource,
}) =>
    Mosaic.configure(
      publicSdkKey: 'mos_public_sdk_test.secret',
      baseUrl: Uri.parse('https://mosaic.example'),
      applicationVersion: '1.0.0',
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: transport,
      cache: cache,
      bundledFallbackLoader: () async =>
          bundledFallbackSource ?? deliveryFixtureSource(),
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
