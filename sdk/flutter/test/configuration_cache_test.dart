import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/configuration_delivery_fixture.dart';

void main() {
  test('file cache reconstructs and invalid replacement preserves prior bytes',
      () async {
    final directory = await Directory.systemTemp.createTemp('mosaic-cache-');
    addTearDown(() => directory.delete(recursive: true));
    final cache = MosaicFileConfigurationCache(
      directoryProvider: () async => directory,
    );
    final namespace = mosaicConfigurationCacheNamespace(
      Uri.parse('https://mosaic.example'),
      'mos_public_sdk_test.secret',
    );
    final original = MosaicConfigurationCacheEntry(
      etag: '"release-1"',
      releaseSource: deliveryFixtureSource(),
    );
    await cache.write(namespace, original);

    final reconstructed = await cache.read(namespace);
    expect(reconstructed!.etag, original.etag);
    expect(reconstructed.releaseSource, original.releaseSource);

    await expectLater(
      cache.write(
        namespace,
        MosaicConfigurationCacheEntry(
          etag: 'W/"weak"',
          releaseSource: 'invalid',
        ),
      ),
      throwsA(isA<FormatException>()),
    );
    final preserved = await cache.read(namespace);
    expect(preserved!.etag, original.etag);
    expect(preserved.releaseSource, original.releaseSource);
  });
}
