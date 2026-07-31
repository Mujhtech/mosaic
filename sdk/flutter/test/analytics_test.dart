import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Analytics Event Contract v1', () {
    test('decodes and exactly re-encodes every canonical event fixture', () {
      final root = Directory('../../protocol/fixtures/analytics-event/v1');
      final fixtures = root
          .listSync()
          .whereType<File>()
          .where((file) => file.path.endsWith('.json'))
          .where((file) => !file.path.contains('/invalid/'));
      expect(fixtures, isNotEmpty);
      for (final fixture in fixtures) {
        final original = jsonDecode(fixture.readAsStringSync());
        final decoded = MosaicAnalyticsEvent.decode(fixture.readAsStringSync());
        expect(decoded.toJson(), original, reason: fixture.path);
      }

      for (final batchFile in Directory('${root.path}/batches')
          .listSync()
          .whereType<File>()
          .where((file) => file.path.endsWith('.json'))) {
        final batch = MosaicAnalyticsBatch.decode(batchFile.readAsStringSync());
        expect(batch.toJson(), jsonDecode(batchFile.readAsStringSync()),
            reason: batchFile.path);
      }
      for (final file
          in Directory('${root.path}/responses').listSync().whereType<File>()) {
        expect(
          MosaicAnalyticsIngestionResponse.decode(file.readAsStringSync())
              .results,
          isNotEmpty,
          reason: file.path,
        );
      }
      final manifest = jsonDecode(File(
        '../../protocol/compatibility/analytics-event/v1.json',
      ).readAsStringSync()) as Map;
      final report = MosaicAnalyticsCapabilityReport();
      expect(report.contractVersion, manifest['analyticsEventContractVersion']);
      expect(report.supportedEventNames, hasLength(27));
      expect(
        report.maximumSendBatchSize,
        (manifest['limits'] as Map)['sdkMaxEventsPerBatch'],
      );
    });

    test('public event construction rejects provider-confirmed authority', () {
      final source = File(
        '../../protocol/fixtures/analytics-event/v1/purchase-completed-provider.json',
      ).readAsStringSync();
      final object = (jsonDecode(source) as Map).cast<String, Object?>()
        ..['authority'] = 'client_observed';
      expect(
        () => MosaicAnalyticsEvent.fromJson(object),
        throwsFormatException,
      );
    });

    test('rejects correlation and attribution from unrelated event stages', () {
      final source = File(
        '../../protocol/fixtures/analytics-event/v1/placement-request.json',
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

      final source = File(
        '../../protocol/fixtures/analytics-event/v1/placement-request.json',
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

final class _AcceptingTransport implements MosaicAnalyticsTransport {
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
