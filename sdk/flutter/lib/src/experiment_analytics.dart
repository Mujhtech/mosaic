import 'dart:convert';

import 'analytics.dart';
import 'analytics_event.dart';
import 'experiment_assignment.dart';

enum MosaicExperimentAnalyticsEventName {
  assigned('experiment_assigned'),
  exposed('experiment_exposed'),
  fallbackPresented('experiment_fallback_presented'),
  assignmentFailed('experiment_assignment_failed');

  const MosaicExperimentAnalyticsEventName(this.wireValue);
  final String wireValue;
}

/// Nonblocking boundary used by the presentation host to enqueue Experiment
/// events. The host never awaits delivery, so a queueing failure can never
/// block rendering or purchasing.
abstract interface class MosaicExperimentAnalyticsSink {
  Future<void> enqueue(Map<String, Object?> event);
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
    'eventSchemaVersion': mosaicAnalyticsEventSchemaVersion,
    'eventName': name.wireValue,
    'occurredAt': mosaicAnalyticsTimestamp(DateTime.now().toUtc()),
    'queuedAt': mosaicAnalyticsTimestamp(DateTime.now().toUtc()),
    'authority': 'client_observed',
    'correlation': correlation,
    'attribution': attribution,
    'payload': payload,
  };
  // Enforce the all-or-none tuple before the draft reaches a durable sink. The
  // envelope is completed and fully validated by the sink, which stamps the
  // identity, session, and context this builder cannot see.
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

/// Decodes an Experiment analytics event through the single shared event
/// codec, and requires the Experiment tuple the shared codec permits but does
/// not demand on a conversion event.
MosaicAnalyticsEvent mosaicDecodeExperimentAnalyticsEvent(Object? source) {
  if (source is! Map) throw const FormatException('Expected event object.');
  final event = MosaicAnalyticsEvent.fromJson(source.cast<String, Object?>());
  if (event.attribution.experiment == null) {
    throw const FormatException(
      'An Experiment analytics event must carry Experiment attribution.',
    );
  }
  return event;
}
