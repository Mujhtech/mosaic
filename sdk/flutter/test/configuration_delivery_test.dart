import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/configuration_delivery_fixture.dart';

void main() {
  test('strictly accepts every canonical Delivery release', () {
    const decoder = MosaicConfigurationDeliveryDecoder();
    for (final name in <String>[
      'rich-release.json',
      'advanced-release.json',
      'experiment-release.json',
      'no-paywall-release.json',
    ]) {
      final envelope = decoder.decode(deliveryFixtureSource(name));
      expect(envelope.version, mosaicConfigurationDeliveryVersion,
          reason: name);
      // Every Placement is a decision rule set. The release carries at least
      // one, and each names the paywall it can resolve to.
      expect(envelope.release.placementDecisions, isNotEmpty, reason: name);
      for (final key in envelope.release.placementDecisions.keys) {
        expect(envelope.release.decisionForPlacement(key), isNotNull);
      }
      // The contract carries exactly one paywall protocol, and it is the one
      // this SDK reads.
      for (final version in envelope.release.paywallVersions.values) {
        expect(version.document.schemaVersion, mosaicProtocolVersion);
      }
    }
  });

  test('atomically rejects every canonical invalid Delivery release', () {
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

  test('Flutter capability request advertises one Delivery version', () {
    final actual = const MosaicConfigurationCapabilityRequest(
      applicationVersion: '1.0.0',
    ).toJson();
    expect(actual['sdkVersion'], mosaicFlutterSdkVersion);
    // Exactly one Delivery version is offered, and it is the one carrying
    // Paywall Protocol 0.4.
    expect(actual['supportedConfigurationDeliveryVersions'], <String>['3']);
    expect(actual['supportedPlacementDecisionContracts'], <String>['1']);
    expect(actual['supportedBucketingAlgorithms'],
        <String>['sha256_length_prefixed_v1']);
    expect(actual['supportedExperimentAssignmentContracts'], <String>['1']);
    expect(actual['supportedExperimentSchedulePolicies'],
        <String>['trusted_server_time_v1']);
  });

  test('hosted transport advertises every exact Protocol 0.4 capability', () {
    expect(
      mosaicPaywallCapabilitiesHeaderValue.split(',').toSet(),
      <String>{
        for (final capability in mosaicProtocolCapabilities)
          '$capability@$mosaicProtocolVersion',
      },
    );
  });
}
