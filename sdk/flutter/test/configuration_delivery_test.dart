import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/configuration_delivery_fixture.dart';

void main() {
  test('strictly accepts every canonical Delivery v1 release', () {
    const decoder = MosaicConfigurationDeliveryDecoder();
    for (final name in <String>[
      'valid-release.json',
      'multiple-paywalls.json',
      'placement-binding.json',
      'product-reference.json',
      'asset-reference.json',
    ]) {
      final envelope = decoder.decode(deliveryFixtureSource(name));
      expect(envelope.version, mosaicConfigurationDeliveryVersion);
      expect(envelope.release.placements, isNotEmpty);
      for (final key in envelope.release.placements.keys) {
        expect(envelope.release.paywallForPlacement(key), isNotNull);
      }
    }
  });

  test('atomically rejects every canonical invalid Delivery v1 release', () {
    const decoder = MosaicConfigurationDeliveryDecoder();
    for (final name in <String>[
      'invalid/unsupported-contract-version.json',
      'invalid/unsupported-paywall-protocol.json',
      'invalid/malformed-release.json',
      'invalid/incomplete-release.json',
    ]) {
      expect(
        () => decoder.decode(deliveryFixtureSource(name)),
        throwsA(isA<MosaicConfigurationDeliveryException>()),
        reason: name,
      );
    }
  });

  test('Flutter capability request advertises Delivery v2 decisions', () {
    final actual = const MosaicConfigurationCapabilityRequest(
      applicationVersion: '1.0.0',
    ).toJson();
    expect(actual['sdkVersion'], mosaicFlutterSdkVersion);
    expect(
        actual['supportedConfigurationDeliveryVersions'], <String>['1', '2']);
    expect(actual['supportedPlacementDecisionContracts'], <String>['1']);
    expect(actual['supportedBucketingAlgorithms'],
        <String>['sha256_length_prefixed_v1']);
  });

  test('hosted transport advertises every exact Protocol 0.2 capability', () {
    expect(
      mosaicPaywallCapabilitiesHeaderValue.split(',').toSet(),
      <String>{
        for (final capability in mosaicProtocolV02Capabilities)
          '$capability@$mosaicProtocolVersion',
      },
    );
  });
}
