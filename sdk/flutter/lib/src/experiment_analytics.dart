import 'dart:convert';

import 'analytics.dart';
import 'analytics_event.dart';
import 'experiment_assignment.dart';

const mosaicExperimentAnalyticsContractVersion = '2';

enum MosaicExperimentAnalyticsEventName {
  assigned('experiment_assigned'),
  exposed('experiment_exposed'),
  fallbackPresented('experiment_fallback_presented'),
  assignmentFailed('experiment_assignment_failed');

  const MosaicExperimentAnalyticsEventName(this.wireValue);
  final String wireValue;
}

/// Nonblocking boundary used by the presentation host to enqueue v2 events.
abstract interface class MosaicExperimentAnalyticsSink {
  Future<void> enqueue(Map<String, Object?> event);
}

final class MosaicExperimentAnalyticsBatch {
  MosaicExperimentAnalyticsBatch({
    required this.batchId,
    required this.sentAt,
    required Iterable<Map<String, Object?>> events,
  }) : events = List.unmodifiable(
          events.map((event) => Map<String, Object?>.unmodifiable(event)),
        );
  final String batchId;
  final DateTime sentAt;
  final List<Map<String, Object?>> events;
  Map<String, Object?> toJson() => {
        'analyticsEventContractVersion': '2',
        'batchId': batchId,
        'sentAt': sentAt.toUtc().toIso8601String(),
        'events': events,
      };
  String encode() => jsonEncode(toJson());
}

abstract interface class MosaicExperimentAnalyticsTransport {
  Future<MosaicAnalyticsIngestionResponse> sendExperiment(
      MosaicExperimentAnalyticsBatch batch);
}

final class MosaicMemoryExperimentAnalyticsSink
    implements MosaicExperimentAnalyticsSink {
  final List<Map<String, Object?>> events = [];
  @override
  Future<void> enqueue(Map<String, Object?> event) async {
    events.add(Map.unmodifiable(event));
  }
}

Map<String, Object?> mosaicExperimentAnalyticsEvent({
  required MosaicExperimentAnalyticsEventName name,
  required MosaicExperimentAssigned assigned,
  required String placementRequestId,
  String? paywallPresentationId,
  String? configurationReleaseId,
  String? placementId,
  String? paywallId,
  String? paywallVersionId,
  Map<String, Object?> payload = const {},
}) {
  final correlation = <String, Object?>{
    'placementRequestId': placementRequestId,
    if (paywallPresentationId != null)
      'paywallPresentationId': paywallPresentationId,
  };
  final attribution = <String, Object?>{
    if (configurationReleaseId != null)
      'configurationReleaseId': configurationReleaseId,
    if (placementId != null) 'placementId': placementId,
    if (paywallId != null) 'paywallId': paywallId,
    if (paywallVersionId != null) 'paywallVersionId': paywallVersionId,
    'experimentId': assigned.assignment.experimentId,
    'experimentVersionId': assigned.assignment.experimentVersionId,
    'experimentVariantId': assigned.variant.id,
    'experimentAllocationVersion': assigned.assignment.allocationVersion,
  };
  final event = <String, Object?>{
    'eventId': mosaicAnalyticsId('event'),
    'eventSchemaVersion': '2',
    'eventName': name.wireValue,
    'occurredAt': mosaicAnalyticsTimestamp(DateTime.now().toUtc()),
    'queuedAt': mosaicAnalyticsTimestamp(DateTime.now().toUtc()),
    'authority': 'client_observed',
    'correlation': correlation,
    'attribution': attribution,
    'payload': payload,
  };
  // Enforce the v2 all-or-none tuple before it reaches a durable sink.
  const tuple = {
    'experimentId',
    'experimentVersionId',
    'experimentVariantId',
    'experimentAllocationVersion',
  };
  if (!attribution.keys.toSet().containsAll(tuple) ||
      utf8.encode(jsonEncode(event)).length >
          mosaicAnalyticsMaximumEventBytes) {
    throw const FormatException('Invalid Experiment analytics event.');
  }
  return event;
}

Map<String, Object?> mosaicDecodeExperimentAnalyticsEvent(Object? source) {
  if (source is! Map) throw const FormatException('Expected v2 event object.');
  final event = source.cast<String, Object?>();
  const fields = {
    'eventId',
    'eventSchemaVersion',
    'eventName',
    'occurredAt',
    'queuedAt',
    'authority',
    'identity',
    'sessionId',
    'context',
    'correlation',
    'attribution',
    'payload',
  };
  if (event.keys.toSet().difference(fields).isNotEmpty ||
      !fields.every(event.containsKey) ||
      event['eventSchemaVersion'] != '2' ||
      event['authority'] != 'client_observed') {
    throw const FormatException('Invalid Analytics Event v2 envelope.');
  }
  final name = event['eventName'];
  if (!const {
    'experiment_assigned',
    'experiment_exposed',
    'experiment_fallback_presented',
    'experiment_assignment_failed',
  }.contains(name)) {
    throw const FormatException('Unsupported Experiment event.');
  }
  Map<String, Object?> object(String key) {
    final value = event[key];
    if (value is! Map) throw FormatException('$key must be an object.');
    return value.cast<String, Object?>();
  }

  final correlation = object('correlation');
  final attribution = object('attribution');
  final payload = object('payload');
  const tuple = {
    'experimentId',
    'experimentVersionId',
    'experimentVariantId',
    'experimentAllocationVersion',
  };
  if (!attribution.keys.toSet().containsAll(tuple) ||
      correlation['placementRequestId'] is! String ||
      (name == 'experiment_exposed' ||
              name == 'experiment_fallback_presented') &&
          correlation['paywallPresentationId'] is! String) {
    throw const FormatException('Invalid Experiment correlation.');
  }
  if (name == 'experiment_exposed' &&
      (attribution['paywallId'] is! String ||
          attribution['paywallVersionId'] is! String ||
          payload['productReadiness'] != 'ready' ||
          payload['providerCapability'] != 'accepted' ||
          payload['qaOverride'] == true)) {
    throw const FormatException('Invalid Experiment exposure.');
  }
  if (name == 'experiment_fallback_presented' &&
      (payload['reason'] is! String ||
          payload['presentedPaywallId'] is! String ||
          payload['presentedPaywallVersionId'] is! String)) {
    throw const FormatException('Invalid Experiment fallback.');
  }
  if (utf8.encode(jsonEncode(event)).length >
      mosaicAnalyticsMaximumEventBytes) {
    throw const FormatException('Experiment event exceeds 32 KiB.');
  }
  return Map.unmodifiable(event);
}
