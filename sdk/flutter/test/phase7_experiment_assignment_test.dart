import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
import 'package:mosaic_sdk/src/sha256.dart';

void main() {
  final root = Directory.current.path.endsWith('/sdk/flutter') ? '../..' : '.';

  test('canonical Assignment v1 decodes and matches shared hash vectors', () {
    final assignmentSource = jsonDecode(File(
      '$root/protocol/fixtures/experiment-assignment/v1/running-ab.json',
    ).readAsStringSync());
    final assignment = const MosaicExperimentAssignmentDecoder().decode(
      assignmentSource,
      production: true,
    );
    final vectors = jsonDecode(File(
      '$root/protocol/fixtures/experiment-assignment/v1/assignment-vectors.json',
    ).readAsStringSync()) as Map<String, Object?>;
    final engine = const MosaicExperimentAssignmentEngine();
    for (final raw in vectors['assignmentVectors'] as List) {
      final vector = (raw as Map).cast<String, Object?>();
      final values = (vector['values'] as List).cast<String>();
      final keyType = values[4];
      final bucket = engine.bucket(assignment, keyType, values[5]);
      expect(bucket, vector['bucket']);
      expect(
        assignment.variants
            .singleWhere((variant) =>
                bucket >= variant.rangeStart && bucket < variant.rangeEnd)
            .id,
        vector['variantId'],
      );
    }
  });

  test('schedule and missing identity conservatively use normal Placement', () {
    final wrapper = jsonDecode(File(
      '$root/protocol/fixtures/experiment-assignment/v1/running-ab.json',
    ).readAsStringSync());
    final assignment = const MosaicExperimentAssignmentDecoder().decode(
      wrapper,
      production: true,
    );
    final engine = const MosaicExperimentAssignmentEngine();
    expect(
      (engine.evaluate(
        assignment: assignment,
        identity: MosaicIdentityState(
            installationId: 'installation_001', generation: 1),
        trustedNow: null,
      ) as MosaicExperimentNormalPlacement)
          .reason,
      'time_unreliable',
    );
  });

  test('assignment store persists only a digest and remains bounded', () async {
    final source = jsonDecode(File(
      '$root/protocol/fixtures/experiment-assignment/v1/running-ab.json',
    ).readAsStringSync());
    final assignment = const MosaicExperimentAssignmentDecoder()
        .decode(source, production: true);
    final result = const MosaicExperimentAssignmentEngine().evaluate(
      assignment: assignment,
      identity: MosaicIdentityState(
          installationId: 'installation_001', generation: 1),
      trustedNow: DateTime.parse('2026-07-26T12:30:00.000Z'),
    ) as MosaicExperimentAssigned;
    final storage = MosaicMemoryExperimentAssignmentStorage();
    final store = MosaicExperimentAssignmentStore(
      storage: storage,
      namespace: 'a' * 64,
    );
    await store.record(result, 'installation_001');
    expect(storage.source, isNot(contains('installation_001')));
    expect((await store.read()).single['variantId'], result.variant.id);
    final reconstructed = MosaicExperimentAssignmentStore(
      storage: storage,
      namespace: 'a' * 64,
    );
    expect((await reconstructed.read()).single['bucket'], result.bucket);
    await reconstructed.markExposed(result, 'installation_001');
    expect((await reconstructed.read()).single['exposed'], isTrue);
  });

  test('hosted Mosaic activates the default assignment-store boundary', () {
    final mosaic = Mosaic.configure(
      publicSdkKey: 'mos_public_sdk_test.secret',
      baseUrl: Uri.parse('https://mosaic.example'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      experimentAssignmentStorage: MosaicMemoryExperimentAssignmentStorage(),
    );
    expect(mosaic.experimentAssignmentStore, isNotNull);
  });

  test('canonical Delivery v3 decodes atomically', () {
    final source = File(
      '$root/protocol/fixtures/configuration-delivery/v3/experiment-release.json',
    ).readAsStringSync();
    final envelope = const MosaicConfigurationDeliveryDecoder().decode(source);
    expect(envelope.version, mosaicConfigurationDeliveryVersionV3);
    expect(envelope.release.experimentAssignments, hasLength(1));
  });

  test('same-Placement group candidates are ordered and admit later member',
      () async {
    final source = _deliveryV3((release) {
      final original = (release['experimentAssignments'] as List).single
          as Map<String, Object?>;
      Map<String, Object?> candidate(String id) =>
          (jsonDecode(jsonEncode(original)) as Map).cast<String, Object?>()
            ..['experimentId'] = 'experiment_$id'
            ..['experimentVersionId'] = 'experiment_version_$id'
            ..['allocationVersion'] = 'allocation_$id';
      final first = candidate('a');
      final second = candidate('b');
      for (final assignment in <Map<String, Object?>>[first, second]) {
        final group = assignment['mutualExclusionGroup']!
            as Map<String, Object?>;
        group['members'] = <Object?>[
          <String, Object?>{
            'experimentId': 'experiment_a',
            'rangeStart': 0,
            'rangeEnd': 5000,
          },
          <String, Object?>{
            'experimentId': 'experiment_b',
            'rangeStart': 5000,
            'rangeEnd': 10000,
          },
        ];
      }
      // Delivery order is intentionally reversed; the SDK retains canonical
      // stable-Experiment ordering.
      release['experimentAssignments'] = <Object?>[second, first];
    });
    final envelope = const MosaicConfigurationDeliveryDecoder().decode(source);
    final candidates = envelope.release
        .experimentsForPlacement('placement_export_pdf');
    expect(candidates.map((value) => value.experimentId),
        <String>['experiment_a', 'experiment_b']);

    var index = 0;
    String installationId;
    do {
      installationId = 'installation_group_${index++}';
    } while (const MosaicExperimentAssignmentEngine().groupBucketFor(
          candidates.first,
          candidates.first.group!,
          'installation',
          installationId,
        ) <
        5000);
    final identityStorage = MosaicMemoryIdentityStorage()
      ..source = jsonEncode(<String, Object?>{
        'version': 1,
        'installationId': installationId,
        'userId': null,
        'generation': 1,
        'attributes': <String, Object?>{},
      });
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_phase7_group',
      baseUrl: Uri.parse('https://mosaic.example'),
      applicationVersion: '2.4.0',
      purchaseProvider: MockMosaicPurchaseProvider(products: const [
        MosaicProduct(
          id: 'product_export_pro',
          title: 'Export Pro',
          localizedPrice: r'$9.99',
        ),
      ]),
      transport: _TestTransport(const []),
      cache: _TestCache(),
      identityStorage: identityStorage,
      bundledFallbackLoader: () async => source,
    );
    await mosaic.loadConfiguration();
    final decision = await mosaic.decidePlacement(
      'export_pdf',
      inputs: MosaicPlacementDecisionInputs(
        platform: 'ios',
        applicationLocale: 'zz-OR',
        now: DateTime.utc(2026, 7, 26, 12, 30),
      ),
    ) as MosaicPlacementDecisionPaywall;
    expect(decision.experiment?.assignment.experimentId, 'experiment_b');
    mosaic.dispose();
  });

  test('Delivery v3 rejects invalid Control and exact Product references', () {
    final invalidControl = _deliveryV3((release) {
      final decisions = release['placementDecisions'] as List;
      final ruleSet = (decisions.single as Map)['ruleSet'] as Map;
      for (final rule in ruleSet['rules'] as List) {
        final outcome = (rule as Map)['outcome'] as Map;
        if (outcome['paywallVersionId'] == 'paywall_version_ios') {
          outcome['paywallVersionId'] = 'paywall_version_student';
        }
      }
    });
    final invalidProducts = _deliveryV3((release) {
      final assignment = (release['experimentAssignments'] as List).single
          as Map<String, Object?>;
      final variant = (assignment['variants'] as List).last as Map;
      final compatibility = variant['compatibility'] as Map;
      compatibility['requiredProductIds'] = <String>['product_export_pro'];
    });
    const decoder = MosaicConfigurationDeliveryDecoder();
    expect(() => decoder.decode(invalidControl),
        throwsA(isA<MosaicConfigurationDeliveryException>()));
    expect(() => decoder.decode(invalidProducts),
        throwsA(isA<MosaicConfigurationDeliveryException>()));
  });

  test('stopped lifecycle replaces running LKG; invalid v3 retains stopped',
      () async {
    final running = _deliveryV3((_) {});
    final stopped = _deliveryV3((release) {
      release['id'] = 'release_phase7_stopped';
      release['number'] = 13;
      final assignment = (release['experimentAssignments'] as List).single
          as Map<String, Object?>;
      assignment['lifecycle'] = 'stopped';
    });
    final invalid = _deliveryV3((release) {
      release['id'] = 'release_phase7_invalid';
      release['number'] = 14;
      final assignment = (release['experimentAssignments'] as List).single
          as Map<String, Object?>;
      final variant = (assignment['variants'] as List).last as Map;
      (variant['compatibility'] as Map)['requiredProductIds'] =
          <String>['product_export_pro'];
    });
    final cache = _TestCache(
      MosaicConfigurationCacheEntry(
        etag: '"running"',
        releaseSource: running,
      ),
    );
    final mosaic = Mosaic.configure(
      publicSdkKey: 'public_phase7_lifecycle',
      baseUrl: Uri.parse('https://mosaic.example'),
      purchaseProvider: MockMosaicPurchaseProvider(),
      transport: _TestTransport(<MosaicConfigurationResponse>[
        MosaicConfigurationUpdatedResponse(
          source: stopped,
          etag: '"stopped"',
        ),
        MosaicConfigurationUpdatedResponse(
          source: invalid,
          etag: '"invalid"',
        ),
      ]),
      cache: cache,
    );
    await mosaic.loadConfiguration();
    expect(mosaic.acceptedConfiguration!.envelope.release
        .experimentAssignments.single.lifecycle,
        MosaicExperimentLifecycle.running);
    expect(
      await mosaic.refreshConfiguration(),
      isA<MosaicConfigurationUpdated>(),
    );
    final stoppedConfiguration = mosaic.acceptedConfiguration;
    expect(stoppedConfiguration!.envelope.release.experimentAssignments.single
        .lifecycle, MosaicExperimentLifecycle.stopped);
    expect(
      await mosaic.refreshConfiguration(),
      isA<MosaicConfigurationRetained>(),
    );
    expect(mosaic.acceptedConfiguration, same(stoppedConfiguration));
    mosaic.dispose();
  });

  test('v2 exposure event keeps the immutable attribution tuple', () {
    final source = jsonDecode(File(
      '$root/protocol/fixtures/experiment-assignment/v1/running-ab.json',
    ).readAsStringSync());
    final assignment = const MosaicExperimentAssignmentDecoder()
        .decode(source, production: true);
    final result = MosaicExperimentAssigned(
      assignment: assignment,
      variant: assignment.variants.first,
      assignmentKeyType: 'identified_user',
      bucket: 1118,
      groupBucket: null,
      qaOverride: false,
    );
    final event = mosaicExperimentAnalyticsEvent(
      name: MosaicExperimentAnalyticsEventName.exposed,
      assigned: result,
      placementRequestId: 'placement_request_1',
      paywallPresentationId: 'presentation_1',
      payload: const {
        'assignmentKeyType': 'identified_user',
        'bucketingAlgorithm': mosaicExperimentBucketingAlgorithm,
        'productReadiness': 'ready',
        'providerCapability': 'accepted',
      },
    );
    expect(event['eventSchemaVersion'], '2');
    expect(
      (event['attribution'] as Map)['experimentAllocationVersion'],
      assignment.allocationVersion,
    );
  });
}

String _deliveryV3(void Function(Map<String, Object?> release) mutate) {
  final root = Directory.current.path.endsWith('/sdk/flutter') ? '../..' : '.';
  final envelope = (jsonDecode(File(
    '$root/protocol/fixtures/configuration-delivery/v3/experiment-release.json',
  ).readAsStringSync()) as Map).cast<String, Object?>();
  final release = (envelope['release'] as Map).cast<String, Object?>();
  mutate(release);
  release.remove('contentDigest');
  release['contentDigest'] =
      'sha256:${mosaicSha256String(jsonEncode(_canonicalize(release)))}';
  return jsonEncode(envelope);
}

Object? _canonicalize(Object? value) {
  if (value is List) return value.map(_canonicalize).toList(growable: false);
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return <String, Object?>{
      for (final key in keys) key: _canonicalize(value[key]),
    };
  }
  return value;
}

final class _TestCache implements MosaicConfigurationCache {
  _TestCache([this.entry]);
  MosaicConfigurationCacheEntry? entry;

  @override
  Future<MosaicConfigurationCacheEntry?> read(String namespace) async => entry;

  @override
  Future<void> write(
    String namespace,
    MosaicConfigurationCacheEntry entry,
  ) async {
    this.entry = entry;
  }
}

final class _TestTransport implements MosaicConfigurationTransport {
  _TestTransport(List<MosaicConfigurationResponse> responses)
      : _responses = List.of(responses);
  final List<MosaicConfigurationResponse> _responses;

  @override
  Future<MosaicConfigurationResponse> fetch(
    MosaicConfigurationRequest request,
  ) async =>
      _responses.isEmpty
          ? const MosaicConfigurationFailedResponse(diagnosticCode: 'unused')
          : _responses.removeAt(0);
}
