import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';
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
    // Enumerated from disk rather than listed here, so a fixture the protocol
    // agent adds is swept the day it lands instead of sitting unexercised
    // behind a test whose name already claimed to cover it.
    final invalid = canonicalFixtureFiles(
      repositoryDirectory(
        'protocol/fixtures/configuration-delivery/v3/invalid',
      ),
    );
    final rejected = <String>{};
    for (final file in invalid) {
      final name = file.uri.pathSegments.last;
      expect(
        () => decoder.decode(file.readAsStringSync()),
        throwsA(isA<MosaicConfigurationDeliveryException>()),
        reason: name,
      );
      rejected.add(name);
    }
    // Named rather than counted, for the same reason the sweep is
    // directory-driven: a fixture that stops being swept — renamed, moved, or
    // newly excluded — would otherwise reduce coverage silently.
    expect(
      rejected,
      containsAll(<String>{
        'unsupported-contract-version.json',
        'unsupported-paywall-protocol.json',
        'unsupported-experiment-contract.json',
        'malformed-release.json',
        'malformed-allocation.json',
        'incomplete-release.json',
        'paywall-material-digest.json',
      }),
    );
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
