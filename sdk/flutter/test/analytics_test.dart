import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

import 'support/canonical_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Analytics Event Contract v1', () {
    test('decodes and exactly re-encodes every canonical event fixture', () {
      final root = repositoryDirectory('protocol/fixtures/analytics-event/v1');
      final fixtures = canonicalFixtureFiles(root);
      expect(fixtures, isNotEmpty);
      for (final fixture in fixtures) {
        final original = jsonDecode(fixture.readAsStringSync());
        final decoded = MosaicAnalyticsEvent.decode(fixture.readAsStringSync());
        expect(decoded.toJson(), original, reason: fixture.path);
      }

      for (final batchFile
          in canonicalFixtureFiles(Directory('${root.path}/batches'))) {
        final batch = MosaicAnalyticsBatch.decode(batchFile.readAsStringSync());
        expect(batch.toJson(), jsonDecode(batchFile.readAsStringSync()),
            reason: batchFile.path);
      }
      for (final file
          in canonicalFixtureFiles(Directory('${root.path}/responses'))) {
        expect(
          MosaicAnalyticsIngestionResponse.decode(file.readAsStringSync())
              .results,
          isNotEmpty,
          reason: file.path,
        );
      }
      for (final file
          in canonicalFixtureFiles(Directory('${root.path}/invalid'))) {
        expect(
          () => MosaicAnalyticsEvent.decode(file.readAsStringSync()),
          throwsFormatException,
          reason: file.path,
        );
      }
      final manifest = jsonDecode(
        repositoryFile('protocol/compatibility/analytics-event/v1.json')
            .readAsStringSync(),
      ) as Map;
      final report = MosaicAnalyticsCapabilityReport();
      expect(report.contractVersion, manifest['analyticsEventContractVersion']);
      expect(report.supportedEventNames, hasLength(27));
      expect(
        report.maximumSendBatchSize,
        (manifest['limits'] as Map)['sdkMaxEventsPerBatch'],
      );
    });

    test('public event construction rejects provider-confirmed authority', () {
      final source = repositoryFile(
        'protocol/fixtures/analytics-event/v1/purchase-completed-provider.json',
      ).readAsStringSync();
      final object = (jsonDecode(source) as Map).cast<String, Object?>()
        ..['authority'] = 'client_observed';
      expect(
        () => MosaicAnalyticsEvent.fromJson(object),
        throwsFormatException,
      );
    });

    test('rejects correlation and attribution from unrelated event stages', () {
      final source = repositoryFile(
        'protocol/fixtures/analytics-event/v1/placement-request.json',
      ).readAsStringSync();
      final unrelatedCorrelation =
          (jsonDecode(source) as Map).cast<String, Object?>();
      (unrelatedCorrelation['correlation'] as Map)['purchaseAttemptId'] =
          'purchase_attempt_unrelated';
      expect(
        () => MosaicAnalyticsEvent.fromJson(unrelatedCorrelation),
        throwsFormatException,
      );

      final unrelatedAttribution =
          (jsonDecode(source) as Map).cast<String, Object?>();
      (unrelatedAttribution['attribution'] as Map)['mosaicProductId'] =
          'product_unrelated';
      expect(
        () => MosaicAnalyticsEvent.fromJson(unrelatedAttribution),
        throwsFormatException,
      );
    });

    test('rejects unknown ingestion codes and noncanonical bucketing', () {
      const response = <String, Object?>{
        'analyticsEventContractVersion': '1',
        'batchId': 'batch_1',
        'receivedAt': '2026-07-26T12:00:00.000Z',
        'results': <Object?>[
          <String, Object?>{
            'eventId': 'event_1',
            'status': 'permanently_rejected',
            'code': 'future_rejection_code',
          },
        ],
      };
      expect(
        () => MosaicAnalyticsIngestionResponse.decode(jsonEncode(response)),
        throwsFormatException,
      );

      final source = repositoryFile(
        'protocol/fixtures/analytics-event/v1/placement-request.json',
      ).readAsStringSync();
      final object = (jsonDecode(source) as Map).cast<String, Object?>()
        ..['eventName'] = 'placement_no_paywall'
        ..['payload'] = <String, Object?>{
          'finalOutcome': 'no_paywall',
          'decisionContractVersion': '1',
          'assignmentKeyType': 'installation',
          'bucketingAlgorithm': 'future_algorithm',
          'rolloutBucket': 1,
        };
      expect(
        () => MosaicAnalyticsEvent.fromJson(object),
        throwsFormatException,
      );
    });

    test('decodes and re-encodes every canonical v2 Experiment fixture', () {
      final root = repositoryDirectory('protocol/fixtures/analytics-event/v2');
      var decoded = 0;
      for (final fixture in canonicalFixtureFiles(root)) {
        final object = jsonDecode(fixture.readAsStringSync());
        expect(
          mosaicDecodeExperimentAnalyticsEvent(object),
          object,
          reason: fixture.path,
        );
        decoded++;
      }
      // Four Experiment events plus the two attributed conversion events.
      expect(decoded, 6, reason: 'every v2 event fixture is covered');

      for (final batchFile
          in canonicalFixtureFiles(Directory('${root.path}/batches'))) {
        final object = (jsonDecode(batchFile.readAsStringSync()) as Map)
            .cast<String, Object?>();
        final batch = MosaicExperimentAnalyticsBatch(
          batchId: object['batchId']! as String,
          sentAt: DateTime.parse(object['sentAt']! as String),
          events: (object['events']! as List)
              .map(mosaicDecodeExperimentAnalyticsEvent),
        );
        expect(batch.toJson(), object, reason: batchFile.path);
      }

      for (final file
          in canonicalFixtureFiles(Directory('${root.path}/responses'))) {
        expect(
          MosaicAnalyticsIngestionResponse.decode(
            file.readAsStringSync(),
            contractVersion: mosaicAnalyticsEventContractVersionV2,
          ).results,
          isNotEmpty,
          reason: file.path,
        );
      }

      for (final file
          in canonicalFixtureFiles(Directory('${root.path}/invalid'))) {
        expect(
          () => mosaicDecodeExperimentAnalyticsEvent(
            jsonDecode(file.readAsStringSync()),
          ),
          throwsFormatException,
          reason: file.path,
        );
      }
    });

    test('a v2 batch is only acknowledged by a v2 ingestion response', () {
      final response = repositoryFile(
        'protocol/fixtures/analytics-event/v2/responses/accepted-exposure.json',
      ).readAsStringSync();
      expect(
        () => MosaicAnalyticsIngestionResponse.decode(response),
        throwsFormatException,
      );
      final v1 = repositoryFile(
        'protocol/fixtures/analytics-event/v1/responses/accepted-event.json',
      ).readAsStringSync();
      expect(
        () => MosaicAnalyticsIngestionResponse.decode(
          v1,
          contractVersion: mosaicAnalyticsEventContractVersionV2,
        ),
        throwsFormatException,
      );
    });
  });

  test('persists event-time identity and session across identity changes',
      () async {
    final storage = MosaicMemoryAnalyticsStorage();
    final identityStorage = MosaicMemoryIdentityStorage();
    final identity = MosaicIdentityController(
        storage: identityStorage, namespace: 'identity');
    final clock = _Clock(DateTime.utc(2026, 7, 26, 12));
    final runtime = _runtime(storage, identity, clock, _AcceptingTransport());
    await runtime.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    await runtime.record(
      name: MosaicAnalyticsEventName.placementRequested,
      correlation:
          const MosaicAnalyticsCorrelation(placementRequestId: 'request_1'),
      attribution: const MosaicAnalyticsAttribution(placementId: 'placement_1'),
      payload: const {'decisionContractVersion': '1'},
    );
    final firstIdentity = await identity.load();
    await identity.identify('customer_2');
    await runtime.identityDidChange(effectiveUserChange: true);
    clock.advance(const Duration(seconds: 1));
    await runtime.record(
      name: MosaicAnalyticsEventName.placementRequested,
      correlation:
          const MosaicAnalyticsCorrelation(placementRequestId: 'request_2'),
      attribution: const MosaicAnalyticsAttribution(placementId: 'placement_1'),
      payload: const {'decisionContractVersion': '1'},
    );
    final saved = (jsonDecode(storage.source!) as Map).cast<String, Object?>();
    final events = saved['events'] as List;
    final first = ((events[0] as Map)['event'] as Map);
    final second = ((events[1] as Map)['event'] as Map);
    expect((first['identity'] as Map)['installationId'],
        firstIdentity.installationId);
    expect(
        (first['identity'] as Map).containsKey('applicationUserId'), isFalse);
    expect((second['identity'] as Map)['applicationUserId'], 'customer_2');
    expect(first['sessionId'], isNot(second['sessionId']));
    clock.advance(const Duration(minutes: 31));
    await runtime.record(
      name: MosaicAnalyticsEventName.placementRequested,
      correlation:
          const MosaicAnalyticsCorrelation(placementRequestId: 'request_3'),
      attribution: const MosaicAnalyticsAttribution(placementId: 'placement_1'),
      payload: const {'decisionContractVersion': '1'},
    );
    final latest = (jsonDecode(storage.source!) as Map)['events'] as List;
    expect(
      ((latest[1] as Map)['event'] as Map)['sessionId'],
      isNot(((latest[2] as Map)['event'] as Map)['sessionId']),
    );
  });

  test('reconstructs offline queue and applies exact partial acknowledgement',
      () async {
    final storage = MosaicMemoryAnalyticsStorage();
    final identityStorage = MosaicMemoryIdentityStorage();
    final clock = _Clock(DateTime.utc(2026, 7, 26, 12));
    final firstTransport = _PartialTransport();
    final first = _runtime(
      storage,
      MosaicIdentityController(storage: identityStorage, namespace: 'identity'),
      clock,
      firstTransport,
    );
    await first.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    for (var index = 0; index < 3; index++) {
      await first.record(
        name: MosaicAnalyticsEventName.placementRequested,
        correlation:
            MosaicAnalyticsCorrelation(placementRequestId: 'request_$index'),
        attribution:
            const MosaicAnalyticsAttribution(placementId: 'placement_1'),
        payload: const {'decisionContractVersion': '1'},
      );
    }
    final flush = await first.flush() as MosaicAnalyticsFlushCompleted;
    expect((flush.sent, flush.removed, flush.retained), (3, 2, 1));

    clock.advance(const Duration(seconds: 10));
    final accepting = _AcceptingTransport();
    final reconstructed = _runtime(
      storage,
      MosaicIdentityController(storage: identityStorage, namespace: 'identity'),
      clock,
      accepting,
    );
    await reconstructed.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    expect((await reconstructed.diagnostics()).queuedEvents, 1);
    final secondFlush =
        await reconstructed.flush() as MosaicAnalyticsFlushCompleted;
    expect(secondFlush.removed, 1);
    expect((await reconstructed.diagnostics()).queuedEvents, 0);
  });

  test('unknown acknowledgement code retains the complete sent batch',
      () async {
    final storage = MosaicMemoryAnalyticsStorage();
    final clock = _Clock(DateTime.utc(2026, 7, 26, 12));
    final runtime = _runtime(
      storage,
      MosaicIdentityController(
        storage: MosaicMemoryIdentityStorage(),
        namespace: 'identity',
      ),
      clock,
      _UnknownCodeTransport(),
    );
    await runtime.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    for (var index = 0; index < 2; index++) {
      await runtime.record(
        name: MosaicAnalyticsEventName.placementRequested,
        correlation:
            MosaicAnalyticsCorrelation(placementRequestId: 'request_$index'),
        attribution:
            const MosaicAnalyticsAttribution(placementId: 'placement_1'),
        payload: const {'decisionContractVersion': '1'},
      );
    }

    final result = await runtime.flush();

    expect(result, isA<MosaicAnalyticsFlushDeferred>());
    expect(
      (result as MosaicAnalyticsFlushDeferred).safeCode,
      'analytics.acknowledgement_malformed',
    );
    final diagnostics = await runtime.diagnostics();
    expect(diagnostics.queuedEvents, 2);
    expect(diagnostics.permanentlyRejectedEvents, 0);
    expect(diagnostics.retryableEvents, 2);
    final persisted = (jsonDecode(storage.source!) as Map)['events'] as List;
    expect(persisted.map((item) => (item as Map)['attempts']), everyElement(1));
  });

  test('host disable atomically clears unsent events', () async {
    final storage = MosaicMemoryAnalyticsStorage();
    final runtime = _runtime(
      storage,
      MosaicIdentityController(
          storage: MosaicMemoryIdentityStorage(), namespace: 'identity'),
      _Clock(DateTime.utc(2026, 7, 26)),
      _AcceptingTransport(),
    );
    await runtime.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    await runtime.record(
      name: MosaicAnalyticsEventName.placementRequested,
      correlation:
          const MosaicAnalyticsCorrelation(placementRequestId: 'request_1'),
      attribution: const MosaicAnalyticsAttribution(placementId: 'placement_1'),
      payload: const {'decisionContractVersion': '1'},
    );
    await runtime.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
      hostEnabled: false,
    );
    expect(storage.source, isNull);
    expect((await runtime.diagnostics()).queuedEvents, 0);
  });

  test('Analytics v2 Experiment queue survives reconstruction and flushes',
      () async {
    final storage = MosaicMemoryAnalyticsStorage();
    final clock = _Clock(DateTime.utc(2026, 7, 26, 12));
    final first = _runtime(
      storage,
      MosaicIdentityController(
          storage: MosaicMemoryIdentityStorage(), namespace: 'identity-v2'),
      clock,
      _AcceptingTransport(),
    );
    await first.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    await first.enqueue(<String, Object?>{
      'eventId': 'event_exposure_1',
      'eventSchemaVersion': '2',
      'eventName': 'experiment_exposed',
      'occurredAt': '2026-07-26T12:00:00.000Z',
      'queuedAt': '2026-07-26T12:00:00.000Z',
      'authority': 'client_observed',
      'correlation': <String, Object?>{
        'placementRequestId': 'request_1',
        'paywallPresentationId': 'presentation_1',
      },
      'attribution': <String, Object?>{
        'experimentId': 'experiment_1',
        'experimentVersionId': 'experiment_version_1',
        'experimentVariantId': 'variant_1',
        'experimentAllocationVersion': 'allocation_1',
        'paywallId': 'paywall_1',
        'paywallVersionId': 'paywall_version_1',
      },
      'payload': <String, Object?>{
        'assignmentKeyType': 'identified_user',
        'bucketingAlgorithm': 'experiment_sha256_length_prefixed_v1',
        'productReadiness': 'ready',
        'providerCapability': 'accepted',
      },
    });
    expect(storage.source, contains('experiment_exposed'));

    final reconstructed = _runtime(
      storage,
      MosaicIdentityController(
          storage: MosaicMemoryIdentityStorage(), namespace: 'identity-v2'),
      clock,
      _AcceptingTransport(),
    );
    await reconstructed.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    expect((await reconstructed.diagnostics()).queuedEvents, 1);
    expect(await reconstructed.flush(), isA<MosaicAnalyticsFlushCompleted>());
    expect((await reconstructed.diagnostics()).queuedEvents, 0);
  });

  test('priority overflow keeps purchase outcomes and never exceeds bounds',
      () async {
    final clock = _Clock(DateTime.utc(2026, 7, 26, 12));
    final storage = MosaicMemoryAnalyticsStorage();
    final identity = MosaicIdentityController(
      storage: MosaicMemoryIdentityStorage(),
      namespace: 'identity',
    );
    final identityState = await identity.load();
    final lowValue = <Map<String, Object?>>[];
    for (var index = 0; index < mosaicAnalyticsMaximumQueueEvents; index++) {
      final event = MosaicAnalyticsEvent(
        eventId: 'event_$index',
        name: MosaicAnalyticsEventName.placementRequested,
        occurredAt: clock.value,
        queuedAt: clock.value,
        identity: MosaicAnalyticsIdentity(
          installationId: identityState.installationId,
          generation: identityState.generation,
        ),
        sessionId: 'session_1',
        context: const MosaicAnalyticsContext(
          platform: 'ios',
          sdkVersion: '0.6.0',
        ),
        correlation:
            MosaicAnalyticsCorrelation(placementRequestId: 'request_$index'),
        attribution:
            const MosaicAnalyticsAttribution(placementId: 'placement_1'),
        payload: const {'decisionContractVersion': '1'},
      );
      lowValue.add(<String, Object?>{
        'event': event.toJson(),
        'attempts': 0,
      });
    }
    storage.source = jsonEncode(<String, Object?>{
      'version': 1,
      'events': lowValue,
      'sessionId': 'session_1',
      'lastActivityAt': mosaicAnalyticsTimestamp(clock.value),
    });
    final runtime = _runtime(storage, identity, clock, _FailingTransport());
    await runtime.setCollection(
      environment: const MosaicAnalyticsEnvironmentSettings(
        collectionEnabled: true,
      ),
    );
    expect(
      await runtime.record(
        name: MosaicAnalyticsEventName.purchaseCompletedClient,
        correlation: const MosaicAnalyticsCorrelation(
          purchaseAttemptId: 'purchase_attempt_1',
        ),
        attribution: const MosaicAnalyticsAttribution(
          mosaicProductId: 'product_1',
          providerId: 'app_store',
        ),
        payload: const <String, Object?>{
          'outcome': 'purchased',
          'durationMs': 10,
          'observedEntitlementKeys': <String>[],
        },
      ),
      isTrue,
    );
    final diagnostics = await runtime.diagnostics();
    expect(diagnostics.queuedEvents, mosaicAnalyticsMaximumQueueEvents);
    expect(diagnostics.droppedEvents, 1);
    final saved = (jsonDecode(storage.source!) as Map)['events'] as List;
    expect(
      saved.where((item) =>
          ((item as Map)['event'] as Map)['eventName'] ==
          'purchase_completed_client'),
      hasLength(1),
    );
  });

  test('an active Experiment stamps conversions as v2 and keeps v1 otherwise',
      () async {
    const experiment = MosaicExperimentAttribution(
      experimentId: 'experiment_checkout',
      experimentVersionId: 'experiment_version_checkout_1',
      experimentVariantId: 'variant_control',
      experimentAllocationVersion: 'allocation_checkout_1',
    );
    const presentation = MosaicAnalyticsPresentationContext(
      placementRequestId: 'placement_request_1',
      paywallPresentationId: 'presentation_1',
      attribution: MosaicAnalyticsAttribution(
        paywallId: 'paywall_1',
        paywallVersionId: 'paywall_version_1',
      ),
      providerId: 'app_store',
      experiment: experiment,
    );
    const unattributed = MosaicAnalyticsPresentationContext(
      placementRequestId: 'placement_request_2',
      paywallPresentationId: 'presentation_2',
      attribution: MosaicAnalyticsAttribution(
        paywallId: 'paywall_1',
        paywallVersionId: 'paywall_version_1',
      ),
      providerId: 'app_store',
    );

    // Conversion attribution carries the tuple; Product attribution never does,
    // because `product_unavailable` forbids it.
    expect(presentation.forConversion('product_1').experiment, experiment);
    expect(presentation.forProduct('product_1').experiment, isNull);
    expect(unattributed.forConversion('product_1').experiment, isNull);

    final storage = MosaicMemoryAnalyticsStorage();
    final transport = _RecordingTransport();
    final runtime = _runtime(
      storage,
      MosaicIdentityController(
        storage: MosaicMemoryIdentityStorage(),
        namespace: 'd' * 64,
      ),
      _Clock(DateTime.utc(2026, 7, 26, 12)),
      transport,
    );
    await runtime.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );

    Future<bool> conversion(
      MosaicAnalyticsPresentationContext context,
      MosaicAnalyticsEventName name,
      Map<String, Object?> payload,
    ) =>
        runtime.record(
          name: name,
          correlation: context.correlation(purchaseAttemptId: 'attempt_1'),
          attribution: context.forConversion('product_1'),
          payload: payload,
        );

    expect(
      await conversion(
        presentation,
        MosaicAnalyticsEventName.purchaseCompletedClient,
        const <String, Object?>{
          'outcome': 'purchased',
          'durationMs': 5,
          'observedEntitlementKeys': <String>[],
        },
      ),
      isTrue,
    );
    expect(
      await runtime.record(
        name: MosaicAnalyticsEventName.productSelected,
        correlation: presentation.correlation(),
        attribution: presentation.forConversion('product_1'),
        payload: const <String, Object?>{'source': 'user'},
      ),
      isTrue,
    );
    expect(
      await conversion(
        unattributed,
        MosaicAnalyticsEventName.purchaseCompletedClient,
        const <String, Object?>{
          'outcome': 'purchased',
          'durationMs': 5,
          'observedEntitlementKeys': <String>[],
        },
      ),
      isTrue,
    );

    // The attributed events must survive a restart: they are persisted as v2
    // documents and reconstructed through the v2 decoder.
    final reconstructed = _runtime(
      storage,
      MosaicIdentityController(
        storage: MosaicMemoryIdentityStorage(),
        namespace: 'd' * 64,
      ),
      _Clock(DateTime.utc(2026, 7, 26, 12)),
      transport,
    );
    await reconstructed.setCollection(
      environment:
          const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
    );
    expect((await reconstructed.diagnostics()).queuedEvents, 3);

    // Versions are never mixed inside one batch, so the attributed events are
    // delivered as v2 and the unattributed one as v1.
    while (await reconstructed.flush() is MosaicAnalyticsFlushCompleted) {}
    expect(transport.experimentBatches, hasLength(1));
    expect(transport.batches, hasLength(1));
    final attributed = transport.experimentBatches.single.events;
    expect(attributed, hasLength(2));
    for (final event in attributed) {
      expect(event['eventSchemaVersion'], '2', reason: '${event['eventName']}');
      expect(
        (event['attribution']! as Map)['experimentVariantId'],
        'variant_control',
      );
    }
    expect(
      attributed.map((event) => event['eventName']).toSet(),
      <String>{'purchase_completed_client', 'product_selected'},
    );
    final plain = transport.batches.single.events.single;
    expect(plain.eventSchemaVersion, '1');
    expect(plain.attribution.experiment, isNull);
    expect(plain.toJson().containsKey('experimentId'), isFalse);
  });

  test('Experiment attribution is all-or-none and conversion-only', () {
    Map<String, Object?> attributed(
      String eventName,
      Map<String, Object?> attribution,
    ) =>
        <String, Object?>{
          'eventId': 'event_1',
          'eventSchemaVersion': '2',
          'eventName': eventName,
          'occurredAt': '2026-07-26T12:00:00.000Z',
          'queuedAt': '2026-07-26T12:00:00.000Z',
          'authority': 'client_observed',
          'identity': <String, Object?>{
            'installationId': 'installation_1',
            'generation': 1,
          },
          'sessionId': 'session_1',
          'context': <String, Object?>{
            'platform': 'ios',
            'sdkFamily': 'flutter',
            'sdkVersion': '0.2.0-dev.11',
          },
          'correlation': <String, Object?>{
            'paywallPresentationId': 'presentation_1',
          },
          'attribution': attribution,
          'payload': <String, Object?>{'source': 'user'},
        };
    const complete = <String, Object?>{
      'paywallId': 'paywall_1',
      'paywallVersionId': 'paywall_version_1',
      'mosaicProductId': 'product_1',
      'experimentId': 'experiment_1',
      'experimentVersionId': 'experiment_version_1',
      'experimentVariantId': 'variant_1',
      'experimentAllocationVersion': 'allocation_1',
    };
    expect(
      MosaicAnalyticsEvent.fromJson(attributed('product_selected', complete))
          .attribution
          .experiment
          ?.experimentVariantId,
      'variant_1',
    );

    // A partial tuple cannot be interpreted, so the document is rejected.
    final partial = Map<String, Object?>.from(complete)
      ..remove('experimentVariantId');
    expect(
      () => MosaicAnalyticsEvent.fromJson(
        attributed('product_selected', partial),
      ),
      throwsFormatException,
    );

    // The tuple is forbidden on every event that is not a conversion event.
    expect(
      () => MosaicAnalyticsEvent.fromJson(
        attributed('paywall_dismissed', complete),
      ),
      throwsFormatException,
    );

    // A v1 event may never carry the tuple, and a v2 event must carry it.
    final asV1 = attributed('product_selected', complete)
      ..['eventSchemaVersion'] = '1';
    expect(() => MosaicAnalyticsEvent.fromJson(asV1), throwsFormatException);
    final withoutTuple = attributed('product_selected', <String, Object?>{
      'paywallId': 'paywall_1',
      'paywallVersionId': 'paywall_version_1',
      'mosaicProductId': 'product_1',
    });
    expect(
      () => MosaicAnalyticsEvent.fromJson(withoutTuple),
      throwsFormatException,
    );
  });

  test('disposal and delivery survive an unavailable analytics storage',
      () async {
    final storage = _UnavailableAnalyticsStorage();
    final identity = MosaicIdentityController(
      storage: MosaicMemoryIdentityStorage(),
      namespace: 'b' * 64,
    );
    final clock = _Clock(DateTime.utc(2026, 7, 26, 12));
    final runtime = _runtime(storage, identity, clock, _FailingTransport());
    await runtime.setCollection(
      environment: const MosaicAnalyticsEnvironmentSettings(
        collectionEnabled: true,
      ),
    );
    expect(
      await runtime.record(
        name: MosaicAnalyticsEventName.purchaseCompletedClient,
        correlation: const MosaicAnalyticsCorrelation(
          purchaseAttemptId: 'purchase_attempt_1',
        ),
        attribution: const MosaicAnalyticsAttribution(
          mosaicProductId: 'product_1',
          providerId: 'app_store',
        ),
        payload: const <String, Object?>{
          'outcome': 'purchased',
          'durationMs': 10,
          'observedEntitlementKeys': <String>[],
        },
      ),
      isTrue,
    );

    // Backgrounding flushes without awaiting. A storage failure must not become
    // an uncaught zone error, which would crash the host application.
    runtime.didChangeAppLifecycleState(AppLifecycleState.paused);
    await pumpEventQueue();

    await expectLater(runtime.disposeRuntime(), completes);
    final diagnostics = await runtime.diagnostics();
    expect(diagnostics.lastSafeCode, isNotNull);
    expect(storage.writeAttempts, greaterThan(0));
  });

  test('identity survives a failed write and a later load recovers', () async {
    final storage = _UnavailableIdentityStorage();
    final controller = MosaicIdentityController(
      storage: storage,
      namespace: 'c' * 64,
    );
    final created = await controller.load();
    expect(created.installationId, startsWith('installation_'));
    expect(controller.lastSafeCode, mosaicIdentityStorageUnavailableCode);

    // A failed persistence attempt must not poison later resolution.
    final identified = await controller.identify('user_1');
    expect(identified.userId, 'user_1');
    expect(await controller.load(), same(identified));

    storage.available = true;
    final recovered = MosaicIdentityController(
      storage: storage,
      namespace: 'c' * 64,
    );
    final restored = await recovered.load();
    expect(restored.installationId, startsWith('installation_'));
    expect(recovered.lastSafeCode, isNull);
    expect(storage.source, isNotNull);
  });
}

MosaicAnalyticsRuntime _runtime(
  MosaicAnalyticsStorage storage,
  MosaicIdentityController identity,
  _Clock clock,
  MosaicAnalyticsTransport transport,
) =>
    MosaicAnalyticsRuntime(
      namespace: 'a' * 64,
      identityController: identity,
      context:
          const MosaicAnalyticsContext(platform: 'ios', sdkVersion: '0.6.0'),
      transport: transport,
      storage: storage,
      clock: clock.call,
      random: () => 0,
    );

final class _Clock {
  _Clock(this.value);
  DateTime value;
  DateTime call() => value;
  void advance(Duration duration) => value = value.add(duration);
}

final class _AcceptingTransport
    implements MosaicAnalyticsTransport, MosaicExperimentAnalyticsTransport {
  @override
  Future<MosaicAnalyticsIngestionResponse> send(
          MosaicAnalyticsBatch batch) async =>
      MosaicAnalyticsIngestionResponse(
        batchId: batch.batchId,
        receivedAt: batch.sentAt,
        results: batch.events
            .map((event) => MosaicAnalyticsIngestionResult(
                  eventId: event.eventId,
                  status: MosaicAnalyticsIngestionStatus.accepted,
                ))
            .toList(),
      );

  @override
  Future<MosaicAnalyticsIngestionResponse> sendExperiment(
          MosaicExperimentAnalyticsBatch batch) async =>
      MosaicAnalyticsIngestionResponse(
        batchId: batch.batchId,
        receivedAt: batch.sentAt,
        results: batch.events
            .map((event) => MosaicAnalyticsIngestionResult(
                  eventId: event['eventId']! as String,
                  status: MosaicAnalyticsIngestionStatus.accepted,
                ))
            .toList(),
      );
}

final class _PartialTransport implements MosaicAnalyticsTransport {
  @override
  Future<MosaicAnalyticsIngestionResponse> send(
          MosaicAnalyticsBatch batch) async =>
      MosaicAnalyticsIngestionResponse(
        batchId: batch.batchId,
        receivedAt: batch.sentAt,
        results: <MosaicAnalyticsIngestionResult>[
          MosaicAnalyticsIngestionResult(
            eventId: batch.events[0].eventId,
            status: MosaicAnalyticsIngestionStatus.accepted,
          ),
          MosaicAnalyticsIngestionResult(
            eventId: batch.events[1].eventId,
            status: MosaicAnalyticsIngestionStatus.permanentlyRejected,
            code: 'event_schema_invalid',
          ),
          MosaicAnalyticsIngestionResult(
            eventId: batch.events[2].eventId,
            status: MosaicAnalyticsIngestionStatus.retryable,
            code: 'storage_temporarily_unavailable',
            retryAfter: const Duration(seconds: 10),
          ),
        ],
      );
}

final class _FailingTransport implements MosaicAnalyticsTransport {
  @override
  Future<MosaicAnalyticsIngestionResponse> send(
          MosaicAnalyticsBatch batch) async =>
      throw const SocketException('offline');
}

final class _UnknownCodeTransport implements MosaicAnalyticsTransport {
  @override
  Future<MosaicAnalyticsIngestionResponse> send(
          MosaicAnalyticsBatch batch) async =>
      MosaicAnalyticsIngestionResponse(
        batchId: batch.batchId,
        receivedAt: batch.sentAt,
        results: <MosaicAnalyticsIngestionResult>[
          MosaicAnalyticsIngestionResult(
            eventId: batch.events[0].eventId,
            status: MosaicAnalyticsIngestionStatus.accepted,
          ),
          MosaicAnalyticsIngestionResult(
            eventId: batch.events[1].eventId,
            status: MosaicAnalyticsIngestionStatus.permanentlyRejected,
            code: 'future_rejection_code',
          ),
        ],
      );
}

/// Storage that is never writable, modelling a full or permission-denied
/// application-private directory.
final class _UnavailableAnalyticsStorage implements MosaicAnalyticsStorage {
  int writeAttempts = 0;

  @override
  Future<String?> read(String namespace) async => null;

  @override
  Future<void> write(String namespace, String source) async {
    writeAttempts++;
    throw const FileSystemException('Analytics storage is unavailable.');
  }

  @override
  Future<void> clear(String namespace) async =>
      throw const FileSystemException('Analytics storage is unavailable.');
}

final class _UnavailableIdentityStorage implements MosaicIdentityStorage {
  bool available = false;
  String? source;

  @override
  Future<String?> read(String namespace) async {
    if (!available) {
      throw const FileSystemException('Identity storage is unavailable.');
    }
    return source;
  }

  @override
  Future<void> write(String namespace, String source) async {
    if (!available) {
      throw const FileSystemException('Identity storage is unavailable.');
    }
    this.source = source;
  }
}

/// Transport that retains the exact batches it was asked to deliver, so a test
/// can assert that v1 and v2 events are never mixed inside one batch.
final class _RecordingTransport
    implements MosaicAnalyticsTransport, MosaicExperimentAnalyticsTransport {
  final List<MosaicAnalyticsBatch> batches = <MosaicAnalyticsBatch>[];
  final List<MosaicExperimentAnalyticsBatch> experimentBatches =
      <MosaicExperimentAnalyticsBatch>[];

  @override
  Future<MosaicAnalyticsIngestionResponse> send(
      MosaicAnalyticsBatch batch) async {
    batches.add(batch);
    return MosaicAnalyticsIngestionResponse(
      batchId: batch.batchId,
      receivedAt: batch.sentAt,
      results: batch.events
          .map((event) => MosaicAnalyticsIngestionResult(
                eventId: event.eventId,
                status: MosaicAnalyticsIngestionStatus.accepted,
              ))
          .toList(),
    );
  }

  @override
  Future<MosaicAnalyticsIngestionResponse> sendExperiment(
      MosaicExperimentAnalyticsBatch batch) async {
    experimentBatches.add(batch);
    return MosaicAnalyticsIngestionResponse(
      batchId: batch.batchId,
      receivedAt: batch.sentAt,
      results: batch.events
          .map((event) => MosaicAnalyticsIngestionResult(
                eventId: event['eventId']! as String,
                status: MosaicAnalyticsIngestionStatus.accepted,
              ))
          .toList(),
    );
  }
}
