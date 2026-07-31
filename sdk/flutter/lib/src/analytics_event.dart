import 'dart:convert';

const String mosaicAnalyticsEventContractVersion = '1';
const String mosaicAnalyticsEventSchemaVersion = '1';
const int mosaicAnalyticsMaximumEventBytes = 32 * 1024;
const int mosaicAnalyticsMaximumBatchBytes = 512 * 1024;
const int mosaicAnalyticsMaximumSendBatchSize = 50;

final class MosaicAnalyticsCapabilityReport {
  MosaicAnalyticsCapabilityReport()
      : supportedEventNames = Set.unmodifiable(
          MosaicAnalyticsEventName.values.map((event) => event.wireValue),
        );

  final String contractVersion = mosaicAnalyticsEventContractVersion;
  final String eventSchemaVersion = mosaicAnalyticsEventSchemaVersion;
  final Set<String> supportedEventNames;
  final int maximumSendBatchSize = mosaicAnalyticsMaximumSendBatchSize;
  final int maximumEventBytes = mosaicAnalyticsMaximumEventBytes;
  final int maximumBatchBytes = mosaicAnalyticsMaximumBatchBytes;
}

enum MosaicAnalyticsEventName {
  placementRequested('placement_requested'),
  placementPaywallSelected('placement_paywall_selected'),
  placementNoPaywall('placement_no_paywall'),
  placementFallbackUsed('placement_fallback_used'),
  placementUnavailable('placement_unavailable'),
  placementEvaluationFailed('placement_evaluation_failed'),
  paywallPresented('paywall_presented'),
  paywallDismissed('paywall_dismissed'),
  paywallActionSelected('paywall_action_selected'),
  paywallRenderFailed('paywall_render_failed'),
  productLoadStarted('product_load_started'),
  productLoadCompleted('product_load_completed'),
  productLoadFailed('product_load_failed'),
  productUnavailable('product_unavailable'),
  productSelected('product_selected'),
  purchaseStarted('purchase_started'),
  purchaseCompletedClient('purchase_completed_client'),
  purchaseCompletedProvider('purchase_completed_provider'),
  purchasePending('purchase_pending'),
  purchaseDeferred('purchase_deferred'),
  purchaseCancelled('purchase_cancelled'),
  purchaseFailed('purchase_failed'),
  restoreStarted('restore_started'),
  restoreCompleted('restore_completed'),
  restoreNothingFound('restore_nothing_found'),
  restoreCancelled('restore_cancelled'),
  restoreFailed('restore_failed');

  const MosaicAnalyticsEventName(this.wireValue);
  final String wireValue;

  static MosaicAnalyticsEventName parse(Object? value) => values.firstWhere(
        (item) => item.wireValue == value,
        orElse: () => throw const FormatException('Unsupported event name.'),
      );
}

enum MosaicAnalyticsEventPriority { low, decision, presentation, outcome }

extension MosaicAnalyticsEventPriorityValue on MosaicAnalyticsEventName {
  MosaicAnalyticsEventPriority get priority => switch (this) {
        MosaicAnalyticsEventName.placementRequested ||
        MosaicAnalyticsEventName.productLoadStarted ||
        MosaicAnalyticsEventName.productLoadCompleted ||
        MosaicAnalyticsEventName.productLoadFailed ||
        MosaicAnalyticsEventName.paywallActionSelected =>
          MosaicAnalyticsEventPriority.low,
        MosaicAnalyticsEventName.placementPaywallSelected ||
        MosaicAnalyticsEventName.placementNoPaywall ||
        MosaicAnalyticsEventName.placementFallbackUsed ||
        MosaicAnalyticsEventName.placementUnavailable ||
        MosaicAnalyticsEventName.placementEvaluationFailed ||
        MosaicAnalyticsEventName.productUnavailable ||
        MosaicAnalyticsEventName.productSelected =>
          MosaicAnalyticsEventPriority.decision,
        MosaicAnalyticsEventName.paywallPresented ||
        MosaicAnalyticsEventName.paywallDismissed ||
        MosaicAnalyticsEventName.paywallRenderFailed =>
          MosaicAnalyticsEventPriority.presentation,
        _ => MosaicAnalyticsEventPriority.outcome,
      };
}

final class MosaicAnalyticsIdentity {
  const MosaicAnalyticsIdentity({
    required this.installationId,
    required this.generation,
    this.applicationUserId,
  });
  final String installationId;
  final String? applicationUserId;
  final int generation;

  Map<String, Object> toJson() => <String, Object>{
        'installationId': installationId,
        if (applicationUserId != null) 'applicationUserId': applicationUserId!,
        'generation': generation,
      };
}

final class MosaicAnalyticsContext {
  const MosaicAnalyticsContext({
    required this.platform,
    required this.sdkVersion,
    this.sdkFamily = 'flutter',
    this.operatingSystemVersion,
    this.applicationVersion,
    this.locale,
    this.configurationDeliveryVersion,
    this.commerceProviderContractVersion,
  });
  final String platform;
  final String sdkFamily;
  final String sdkVersion;
  final String? operatingSystemVersion;
  final String? applicationVersion;
  final String? locale;
  final String? configurationDeliveryVersion;
  final String? commerceProviderContractVersion;

  Map<String, Object> toJson() => <String, Object>{
        'platform': platform,
        'sdkFamily': sdkFamily,
        'sdkVersion': sdkVersion,
        if (operatingSystemVersion != null)
          'operatingSystemVersion': operatingSystemVersion!,
        if (applicationVersion != null)
          'applicationVersion': applicationVersion!,
        if (locale != null) 'locale': locale!,
        if (configurationDeliveryVersion != null)
          'configurationDeliveryVersion': configurationDeliveryVersion!,
        if (commerceProviderContractVersion != null)
          'commerceProviderContractVersion': commerceProviderContractVersion!,
      };
}

final class MosaicAnalyticsCorrelation {
  const MosaicAnalyticsCorrelation({
    this.placementRequestId,
    this.paywallPresentationId,
    this.productLoadAttemptId,
    this.purchaseAttemptId,
    this.restoreAttemptId,
    this.providerOperationId,
    this.providerUpdateId,
  });
  final String? placementRequestId;
  final String? paywallPresentationId;
  final String? productLoadAttemptId;
  final String? purchaseAttemptId;
  final String? restoreAttemptId;
  final String? providerOperationId;
  final String? providerUpdateId;

  Map<String, Object> toJson() => <String, Object>{
        if (placementRequestId != null)
          'placementRequestId': placementRequestId!,
        if (paywallPresentationId != null)
          'paywallPresentationId': paywallPresentationId!,
        if (productLoadAttemptId != null)
          'productLoadAttemptId': productLoadAttemptId!,
        if (purchaseAttemptId != null) 'purchaseAttemptId': purchaseAttemptId!,
        if (restoreAttemptId != null) 'restoreAttemptId': restoreAttemptId!,
        if (providerOperationId != null)
          'providerOperationId': providerOperationId!,
        if (providerUpdateId != null) 'providerUpdateId': providerUpdateId!,
      };
}

final class MosaicAnalyticsAttribution {
  const MosaicAnalyticsAttribution({
    this.configurationReleaseId,
    this.placementId,
    this.placementRuleSetId,
    this.placementRuleSetVersion,
    this.winningRuleId,
    this.paywallId,
    this.paywallVersionId,
    this.mosaicProductId,
    this.planId,
    this.providerId,
    this.providerProductMappingId,
  });
  final String? configurationReleaseId;
  final String? placementId;
  final String? placementRuleSetId;
  final int? placementRuleSetVersion;
  final String? winningRuleId;
  final String? paywallId;
  final String? paywallVersionId;
  final String? mosaicProductId;
  final String? planId;
  final String? providerId;
  final String? providerProductMappingId;

  Map<String, Object> toJson() => <String, Object>{
        if (configurationReleaseId != null)
          'configurationReleaseId': configurationReleaseId!,
        if (placementId != null) 'placementId': placementId!,
        if (placementRuleSetId != null)
          'placementRuleSetId': placementRuleSetId!,
        if (placementRuleSetVersion != null)
          'placementRuleSetVersion': placementRuleSetVersion!,
        if (winningRuleId != null) 'winningRuleId': winningRuleId!,
        if (paywallId != null) 'paywallId': paywallId!,
        if (paywallVersionId != null) 'paywallVersionId': paywallVersionId!,
        if (mosaicProductId != null) 'mosaicProductId': mosaicProductId!,
        if (planId != null) 'planId': planId!,
        if (providerId != null) 'providerId': providerId!,
        if (providerProductMappingId != null)
          'providerProductMappingId': providerProductMappingId!,
      };
}

/// Immutable Analytics Event Contract v1 record.
final class MosaicAnalyticsEvent {
  MosaicAnalyticsEvent({
    required this.eventId,
    required this.name,
    required DateTime occurredAt,
    required DateTime queuedAt,
    required this.correlation,
    required this.attribution,
    required Map<String, Object?> payload,
    this.identity,
    this.sessionId,
    this.context,
    this.authority = 'client_observed',
  })  : occurredAt = occurredAt.toUtc(),
        queuedAt = queuedAt.toUtc(),
        payload = Map.unmodifiable(payload) {
    _validate();
  }

  final String eventId;
  final MosaicAnalyticsEventName name;
  final DateTime occurredAt;
  final DateTime queuedAt;
  final String authority;
  final MosaicAnalyticsIdentity? identity;
  final String? sessionId;
  final MosaicAnalyticsContext? context;
  final MosaicAnalyticsCorrelation correlation;
  final MosaicAnalyticsAttribution attribution;
  final Map<String, Object?> payload;

  Map<String, Object?> toJson() => <String, Object?>{
        'eventId': eventId,
        'eventSchemaVersion': mosaicAnalyticsEventSchemaVersion,
        'eventName': name.wireValue,
        'occurredAt': mosaicAnalyticsTimestamp(occurredAt),
        'queuedAt': mosaicAnalyticsTimestamp(queuedAt),
        'authority': authority,
        if (identity != null) 'identity': identity!.toJson(),
        if (sessionId != null) 'sessionId': sessionId,
        if (context != null) 'context': context!.toJson(),
        'correlation': correlation.toJson(),
        'attribution': attribution.toJson(),
        'payload': payload,
      };

  String encode() => jsonEncode(toJson());

  factory MosaicAnalyticsEvent.decode(String source) {
    final value = jsonDecode(source);
    if (value is! Map) throw const FormatException('Expected event object.');
    return MosaicAnalyticsEvent.fromJson(value.cast<String, Object?>());
  }

  factory MosaicAnalyticsEvent.fromJson(Map<String, Object?> json) {
    _closed(json, const <String>{
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
    });
    if (json['eventSchemaVersion'] != '1')
      throw const FormatException('Unsupported event schema.');
    Map<String, Object?> object(String key) {
      final value = json[key];
      if (value is! Map) throw FormatException('$key must be an object.');
      return value.cast<String, Object?>();
    }

    final identityJson = json['identity'];
    final contextJson = json['context'];
    final event = MosaicAnalyticsEvent(
      eventId: _identifier(json['eventId'], 'eventId'),
      name: MosaicAnalyticsEventName.parse(json['eventName']),
      occurredAt: _timestamp(json['occurredAt'], 'occurredAt'),
      queuedAt: _timestamp(json['queuedAt'], 'queuedAt'),
      authority: _string(json['authority'], 'authority'),
      identity: identityJson == null ? null : _decodeIdentity(identityJson),
      sessionId: json['sessionId'] == null
          ? null
          : _identifier(json['sessionId'], 'sessionId'),
      context: contextJson == null ? null : _decodeContext(contextJson),
      correlation: _decodeCorrelation(object('correlation')),
      attribution: _decodeAttribution(object('attribution')),
      payload: object('payload'),
    );
    return event;
  }

  void _validate() {
    _identifier(eventId, 'eventId');
    if (authority != 'client_observed' &&
        authority != 'trusted_server' &&
        authority != 'provider_confirmed') {
      throw const FormatException('Invalid authority.');
    }
    if (name == MosaicAnalyticsEventName.purchaseCompletedProvider &&
        authority == 'client_observed') {
      throw const FormatException(
          'Public SDK authority cannot confirm provider events.');
    }
    if (authority == 'client_observed' &&
        (identity == null || sessionId == null || context == null)) {
      throw const FormatException(
          'Client events require identity, session, and context.');
    }
    final identityValue = identity;
    if (identityValue != null) {
      _identifier(identityValue.installationId, 'installationId');
      if (identityValue.applicationUserId case final user?) {
        if (user.isEmpty ||
            user.length > 256 ||
            user.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
          throw const FormatException('Invalid application user identity.');
        }
      }
      if (identityValue.generation < 0 ||
          identityValue.generation > 9007199254740991) {
        throw const FormatException('Invalid identity generation.');
      }
    }
    if (sessionId case final session?) _identifier(session, 'sessionId');
    _validateContext(context);
    for (final entry in correlation.toJson().entries) {
      _identifier(entry.value, entry.key);
    }
    for (final entry in attribution.toJson().entries) {
      if (entry.key == 'placementRuleSetVersion') {
        final value = entry.value;
        if (value is! int || value < 1 || value > 9007199254740991) {
          throw const FormatException('Invalid Rule Set version.');
        }
      } else {
        _identifier(entry.value, entry.key);
      }
    }
    _validateEventRelationships(name, correlation, attribution);
    _validatePayload(name, payload);
    if (utf8.encode(jsonEncode(toJson())).length >
        mosaicAnalyticsMaximumEventBytes) {
      throw const FormatException('Event exceeds 32 KiB.');
    }
  }
}

final class MosaicAnalyticsBatch {
  MosaicAnalyticsBatch(
      {required this.batchId,
      required DateTime sentAt,
      required Iterable<MosaicAnalyticsEvent> events})
      : sentAt = sentAt.toUtc(),
        events = List.unmodifiable(events) {
    if (this.events.isEmpty ||
        this.events.length > 100 ||
        this.events.map((e) => e.eventId).toSet().length !=
            this.events.length) {
      throw const FormatException('Invalid analytics batch event set.');
    }
    if (utf8.encode(encode()).length > mosaicAnalyticsMaximumBatchBytes) {
      throw const FormatException('Analytics batch exceeds 512 KiB.');
    }
  }
  final String batchId;
  final DateTime sentAt;
  final List<MosaicAnalyticsEvent> events;
  Map<String, Object> toJson() => <String, Object>{
        'analyticsEventContractVersion': '1',
        'batchId': _identifier(batchId, 'batchId'),
        'sentAt': mosaicAnalyticsTimestamp(sentAt),
        'events': events.map((e) => e.toJson()).toList(growable: false),
      };
  String encode() => jsonEncode(toJson());

  factory MosaicAnalyticsBatch.decode(String source) {
    final value = jsonDecode(source);
    if (value is! Map) throw const FormatException('Expected batch object.');
    final json = value.cast<String, Object?>();
    _closed(json, const <String>{
      'analyticsEventContractVersion',
      'batchId',
      'sentAt',
      'events',
    });
    if (json['analyticsEventContractVersion'] != '1') {
      throw const FormatException('Unsupported analytics batch version.');
    }
    final values = json['events'];
    if (values is! List) throw const FormatException('Invalid batch events.');
    return MosaicAnalyticsBatch(
      batchId: _identifier(json['batchId'], 'batchId'),
      sentAt: _timestamp(json['sentAt'], 'sentAt'),
      events: values.map((value) {
        if (value is! Map) throw const FormatException('Invalid batch event.');
        return MosaicAnalyticsEvent.fromJson(value.cast<String, Object?>());
      }),
    );
  }
}

enum MosaicAnalyticsIngestionStatus {
  accepted,
  duplicate,
  permanentlyRejected,
  retryable
}

const Set<String> _mosaicAnalyticsPermanentIngestionCodes = <String>{
  'event_schema_invalid',
  'unsupported_event_schema',
  'unsupported_event_name',
  'unknown_field',
  'invalid_identifier',
  'invalid_timestamp',
  'occurred_at_too_far_future',
  'event_expired',
  'event_too_large',
  'batch_event_limit_exceeded',
  'duplicate_event_id_in_batch',
  'authority_not_allowed',
  'tenant_field_forbidden',
  'attribution_not_found',
  'attribution_scope_mismatch',
  'event_id_conflict',
  'sensitive_value_rejected',
};

const Set<String> _mosaicAnalyticsRetryableIngestionCodes = <String>{
  'rate_limited',
  'storage_temporarily_unavailable',
  'service_temporarily_unavailable',
  'ingestion_timeout',
};

final class MosaicAnalyticsIngestionResult {
  const MosaicAnalyticsIngestionResult(
      {required this.eventId,
      required this.status,
      this.code,
      this.retryAfter});
  final String eventId;
  final MosaicAnalyticsIngestionStatus status;
  final String? code;
  final Duration? retryAfter;

  bool get isContractValid => switch (status) {
        MosaicAnalyticsIngestionStatus.accepted ||
        MosaicAnalyticsIngestionStatus.duplicate =>
          code == null && retryAfter == null,
        MosaicAnalyticsIngestionStatus.permanentlyRejected =>
          _mosaicAnalyticsPermanentIngestionCodes.contains(code) &&
              retryAfter == null,
        MosaicAnalyticsIngestionStatus.retryable =>
          _mosaicAnalyticsRetryableIngestionCodes.contains(code) &&
              (retryAfter == null ||
                  retryAfter! >= const Duration(seconds: 1) &&
                      retryAfter! <= const Duration(seconds: 300)),
      };
}

final class MosaicAnalyticsIngestionResponse {
  const MosaicAnalyticsIngestionResponse(
      {required this.batchId, required this.receivedAt, required this.results});
  final String batchId;
  final DateTime receivedAt;
  final List<MosaicAnalyticsIngestionResult> results;

  factory MosaicAnalyticsIngestionResponse.decode(String source) {
    final value = jsonDecode(source);
    if (value is! Map) throw const FormatException('Expected response object.');
    final json = value.cast<String, Object?>();
    _closed(json, const {
      'analyticsEventContractVersion',
      'batchId',
      'receivedAt',
      'results'
    });
    if (json['analyticsEventContractVersion'] != '1')
      throw const FormatException('Unsupported response version.');
    final values = json['results'];
    if (values is! List || values.isEmpty || values.length > 100)
      throw const FormatException('Invalid results.');
    final results = values.map((raw) {
      if (raw is! Map) throw const FormatException('Invalid event result.');
      final item = raw.cast<String, Object?>();
      final status = switch (item['status']) {
        'accepted' => MosaicAnalyticsIngestionStatus.accepted,
        'duplicate' => MosaicAnalyticsIngestionStatus.duplicate,
        'permanently_rejected' =>
          MosaicAnalyticsIngestionStatus.permanentlyRejected,
        'retryable' => MosaicAnalyticsIngestionStatus.retryable,
        _ => throw const FormatException('Unknown ingestion status.'),
      };
      final allowed = status == MosaicAnalyticsIngestionStatus.accepted ||
              status == MosaicAnalyticsIngestionStatus.duplicate
          ? const {'eventId', 'status'}
          : status == MosaicAnalyticsIngestionStatus.permanentlyRejected
              ? const {'eventId', 'status', 'code'}
              : const {'eventId', 'status', 'code', 'retryAfterSeconds'};
      _closed(item, allowed);
      final code = item['code'];
      if ((status == MosaicAnalyticsIngestionStatus.permanentlyRejected ||
              status == MosaicAnalyticsIngestionStatus.retryable) &&
          code is! String) {
        throw const FormatException('Missing ingestion result code.');
      }
      if (status == MosaicAnalyticsIngestionStatus.permanentlyRejected &&
              !_mosaicAnalyticsPermanentIngestionCodes.contains(code) ||
          status == MosaicAnalyticsIngestionStatus.retryable &&
              !_mosaicAnalyticsRetryableIngestionCodes.contains(code)) {
        throw const FormatException('Unknown ingestion result code.');
      }
      final retry = item['retryAfterSeconds'];
      if (retry != null && (retry is! int || retry < 1 || retry > 300))
        throw const FormatException('Invalid retry delay.');
      return MosaicAnalyticsIngestionResult(
          eventId: _identifier(item['eventId'], 'eventId'),
          status: status,
          code: code as String?,
          retryAfter: retry == null ? null : Duration(seconds: retry as int));
    }).toList(growable: false);
    return MosaicAnalyticsIngestionResponse(
        batchId: _identifier(json['batchId'], 'batchId'),
        receivedAt: _timestamp(json['receivedAt'], 'receivedAt'),
        results: results);
  }
}

String mosaicAnalyticsTimestamp(DateTime value) {
  final utc = value.toUtc();
  String two(int value) => value.toString().padLeft(2, '0');
  String three(int value) => value.toString().padLeft(3, '0');
  return '${utc.year.toString().padLeft(4, '0')}-${two(utc.month)}-${two(utc.day)}T${two(utc.hour)}:${two(utc.minute)}:${two(utc.second)}.${three(utc.millisecond)}Z';
}

MosaicAnalyticsIdentity _decodeIdentity(Object value) {
  if (value is! Map) throw const FormatException('Invalid identity.');
  final json = value.cast<String, Object?>();
  _closed(json, const {'installationId', 'applicationUserId', 'generation'});
  final generation = json['generation'];
  if (generation is! int || generation < 0 || generation > 9007199254740991)
    throw const FormatException('Invalid identity generation.');
  return MosaicAnalyticsIdentity(
      installationId: _identifier(json['installationId'], 'installationId'),
      applicationUserId: json['applicationUserId'] == null
          ? null
          : _string(json['applicationUserId'], 'applicationUserId'),
      generation: generation);
}

MosaicAnalyticsContext _decodeContext(Object value) {
  if (value is! Map) throw const FormatException('Invalid context.');
  final json = value.cast<String, Object?>();
  _closed(json, const {
    'platform',
    'sdkFamily',
    'sdkVersion',
    'operatingSystemVersion',
    'applicationVersion',
    'locale',
    'configurationDeliveryVersion',
    'commerceProviderContractVersion'
  });
  final sdkFamily = _string(json['sdkFamily'], 'sdkFamily');
  if (!const <String>{'flutter', 'ios', 'android'}.contains(sdkFamily)) {
    throw const FormatException('Invalid SDK family.');
  }
  return MosaicAnalyticsContext(
      platform: _string(json['platform'], 'platform'),
      sdkFamily: sdkFamily,
      sdkVersion: _string(json['sdkVersion'], 'sdkVersion'),
      operatingSystemVersion: json['operatingSystemVersion'] as String?,
      applicationVersion: json['applicationVersion'] as String?,
      locale: json['locale'] as String?,
      configurationDeliveryVersion:
          json['configurationDeliveryVersion'] as String?,
      commerceProviderContractVersion:
          json['commerceProviderContractVersion'] as String?);
}

MosaicAnalyticsCorrelation _decodeCorrelation(Map<String, Object?> j) {
  _closed(j, const {
    'placementRequestId',
    'paywallPresentationId',
    'productLoadAttemptId',
    'purchaseAttemptId',
    'restoreAttemptId',
    'providerOperationId',
    'providerUpdateId'
  });
  String? v(String k) => j[k] == null ? null : _identifier(j[k], k);
  return MosaicAnalyticsCorrelation(
      placementRequestId: v('placementRequestId'),
      paywallPresentationId: v('paywallPresentationId'),
      productLoadAttemptId: v('productLoadAttemptId'),
      purchaseAttemptId: v('purchaseAttemptId'),
      restoreAttemptId: v('restoreAttemptId'),
      providerOperationId: v('providerOperationId'),
      providerUpdateId: v('providerUpdateId'));
}

MosaicAnalyticsAttribution _decodeAttribution(Map<String, Object?> j) {
  _closed(j, const {
    'configurationReleaseId',
    'placementId',
    'placementRuleSetId',
    'placementRuleSetVersion',
    'winningRuleId',
    'paywallId',
    'paywallVersionId',
    'mosaicProductId',
    'planId',
    'providerId',
    'providerProductMappingId'
  });
  String? v(String k) => j[k] == null ? null : _identifier(j[k], k);
  final version = j['placementRuleSetVersion'];
  if (version != null && (version is! int || version < 1))
    throw const FormatException('Invalid Rule Set version.');
  return MosaicAnalyticsAttribution(
      configurationReleaseId: v('configurationReleaseId'),
      placementId: v('placementId'),
      placementRuleSetId: v('placementRuleSetId'),
      placementRuleSetVersion: version as int?,
      winningRuleId: v('winningRuleId'),
      paywallId: v('paywallId'),
      paywallVersionId: v('paywallVersionId'),
      mosaicProductId: v('mosaicProductId'),
      planId: v('planId'),
      providerId: v('providerId'),
      providerProductMappingId: v('providerProductMappingId'));
}

void _validatePayload(
    MosaicAnalyticsEventName name, Map<String, Object?> payload) {
  const specs =
      <MosaicAnalyticsEventName, ({Set<String> required, Set<String> allowed})>{
    MosaicAnalyticsEventName.placementRequested: (
      required: {'decisionContractVersion'},
      allowed: {'decisionContractVersion'}
    ),
    MosaicAnalyticsEventName.placementPaywallSelected: (
      required: {'finalOutcome', 'decisionContractVersion'},
      allowed: {
        'finalOutcome',
        'decisionContractVersion',
        'assignmentKeyType',
        'bucketingAlgorithm',
        'rolloutBucket'
      }
    ),
    MosaicAnalyticsEventName.placementNoPaywall: (
      required: {'finalOutcome', 'decisionContractVersion'},
      allowed: {
        'finalOutcome',
        'decisionContractVersion',
        'assignmentKeyType',
        'bucketingAlgorithm',
        'rolloutBucket'
      }
    ),
    MosaicAnalyticsEventName.placementFallbackUsed: (
      required: {'trigger', 'fallbackKey', 'finalOutcome'},
      allowed: {'trigger', 'fallbackKey', 'finalOutcome', 'diagnosticCode'}
    ),
    MosaicAnalyticsEventName.placementUnavailable: (
      required: {'reason'},
      allowed: {'reason', 'diagnosticCode'}
    ),
    MosaicAnalyticsEventName.placementEvaluationFailed: (
      required: {'diagnosticCode', 'retryable'},
      allowed: {'diagnosticCode', 'retryable'}
    ),
    MosaicAnalyticsEventName.paywallPresented: (required: {}, allowed: {}),
    MosaicAnalyticsEventName.paywallDismissed: (
      required: {'reason'},
      allowed: {'reason'}
    ),
    MosaicAnalyticsEventName.paywallActionSelected: (
      required: {'action'},
      allowed: {'action', 'componentId'}
    ),
    MosaicAnalyticsEventName.paywallRenderFailed: (
      required: {'diagnosticCode', 'retryable'},
      allowed: {'diagnosticCode', 'retryable'}
    ),
    MosaicAnalyticsEventName.productLoadStarted: (
      required: {'requestedProductCount'},
      allowed: {'requestedProductCount'}
    ),
    MosaicAnalyticsEventName.productLoadCompleted: (
      required: {
        'availableProductCount',
        'unavailableProductCount',
        'durationMs'
      },
      allowed: {
        'availableProductCount',
        'unavailableProductCount',
        'durationMs'
      }
    ),
    MosaicAnalyticsEventName.productLoadFailed: (
      required: {
        'requestedProductCount',
        'durationMs',
        'diagnosticCode',
        'retryable'
      },
      allowed: {
        'requestedProductCount',
        'durationMs',
        'diagnosticCode',
        'retryable'
      }
    ),
    MosaicAnalyticsEventName.productUnavailable: (
      required: {'reason'},
      allowed: {'reason', 'diagnosticCode'}
    ),
    MosaicAnalyticsEventName.productSelected: (
      required: {'source'},
      allowed: {'source'}
    ),
    MosaicAnalyticsEventName.purchaseStarted: (required: {}, allowed: {}),
    MosaicAnalyticsEventName.purchaseCompletedClient: (
      required: {'outcome', 'durationMs', 'observedEntitlementKeys'},
      allowed: {
        'outcome',
        'durationMs',
        'observedEntitlementKeys',
        'providerResultCode'
      }
    ),
    MosaicAnalyticsEventName.purchaseCompletedProvider: (
      required: {'confirmationSource', 'activeEntitlementKeys'},
      allowed: {
        'confirmationSource',
        'activeEntitlementKeys',
        'linkedClientEventId'
      }
    ),
    MosaicAnalyticsEventName.purchasePending: (
      required: {'durationMs'},
      allowed: {'durationMs', 'providerResultCode'}
    ),
    MosaicAnalyticsEventName.purchaseDeferred: (
      required: {'durationMs'},
      allowed: {'durationMs', 'providerResultCode'}
    ),
    MosaicAnalyticsEventName.purchaseCancelled: (
      required: {'durationMs'},
      allowed: {'durationMs', 'providerResultCode'}
    ),
    MosaicAnalyticsEventName.purchaseFailed: (
      required: {'durationMs', 'diagnosticCode', 'retryable'},
      allowed: {'durationMs', 'diagnosticCode', 'retryable'}
    ),
    MosaicAnalyticsEventName.restoreStarted: (
      required: {'providerId'},
      allowed: {'providerId'}
    ),
    MosaicAnalyticsEventName.restoreCompleted: (
      required: {
        'providerId',
        'durationMs',
        'restoredProductIds',
        'observedEntitlementKeys'
      },
      allowed: {
        'providerId',
        'durationMs',
        'restoredProductIds',
        'observedEntitlementKeys'
      }
    ),
    MosaicAnalyticsEventName.restoreNothingFound: (
      required: {'providerId', 'durationMs'},
      allowed: {'providerId', 'durationMs', 'providerResultCode'}
    ),
    MosaicAnalyticsEventName.restoreCancelled: (
      required: {'providerId', 'durationMs'},
      allowed: {'providerId', 'durationMs', 'providerResultCode'}
    ),
    MosaicAnalyticsEventName.restoreFailed: (
      required: {'providerId', 'durationMs', 'diagnosticCode', 'retryable'},
      allowed: {'providerId', 'durationMs', 'diagnosticCode', 'retryable'}
    ),
  };
  final spec = specs[name]!;
  _closed(payload, spec.allowed);
  if (!payload.keys.toSet().containsAll(spec.required))
    throw const FormatException('Missing required payload field.');
  void oneOf(String key, Set<String> values) {
    final value = payload[key];
    if (value != null && (value is! String || !values.contains(value))) {
      throw FormatException('Invalid $key.');
    }
  }

  oneOf('finalOutcome', const {'paywall', 'no_paywall', 'unavailable'});
  oneOf('assignmentKeyType', const {'installation', 'identified_user'});
  oneOf('trigger', const {
    'configuration_incompatible',
    'content_unavailable',
    'commerce_unavailable',
    'product_unavailable',
    'product_unknown',
    'provider_unavailable',
    'entitlement_unknown',
    'unsafe_rendering',
  });
  oneOf(
      'reason',
      switch (name) {
        MosaicAnalyticsEventName.paywallDismissed => const {
            'user',
            'system',
            'purchase_completed',
            'host_application',
            'unknown'
          },
        MosaicAnalyticsEventName.productUnavailable => const {
            'mapping_missing',
            'mapping_invalid',
            'product_not_found',
            'temporarily_unavailable',
            'provider_unavailable',
            'unsupported_product_type',
            'metadata_unavailable',
          },
        _ => const {
            'no_safe_decision',
            'configuration_incompatible',
            'content_unavailable',
            'commerce_unavailable',
          },
      });
  oneOf('action', const {
    'purchase',
    'restore',
    'close',
    'navigate_to',
    'navigate_back',
    'open_external_url',
  });
  oneOf('source', const {'default', 'user'});
  oneOf('outcome', const {'purchased', 'already_entitled'});
  oneOf('confirmationSource', const {
    'trusted_provider_integration',
    'trusted_server_endpoint',
    'accepted_adapter_source',
  });
  if (payload['decisionContractVersion'] != null &&
      payload['decisionContractVersion'] != '1') {
    throw const FormatException('Invalid decision Contract version.');
  }
  for (final key in const {
    'fallbackKey',
    'componentId',
    'bucketingAlgorithm',
    'providerId',
    'linkedClientEventId',
  }) {
    if (payload[key] != null) _identifier(payload[key], key);
  }
  if (payload['bucketingAlgorithm'] != null &&
      payload['bucketingAlgorithm'] != 'sha256_length_prefixed_v1') {
    throw const FormatException('Invalid bucketing algorithm.');
  }
  final bucket = payload['rolloutBucket'];
  if (bucket != null && (bucket is! int || bucket < 0 || bucket > 9999)) {
    throw const FormatException('Invalid rollout bucket.');
  }
  for (final key in const {'durationMs'}) {
    final v = payload[key];
    if (v != null && (v is! int || v < 0 || v > 86400000))
      throw const FormatException('Invalid duration.');
  }
  for (final key in const {
    'requestedProductCount',
    'availableProductCount',
    'unavailableProductCount'
  }) {
    final v = payload[key];
    if (v != null &&
        (v is! int ||
            v < 0 ||
            v > 64 ||
            (key == 'requestedProductCount' && v < 1)))
      throw const FormatException('Invalid Product count.');
  }
  for (final key in const {
    'observedEntitlementKeys',
    'activeEntitlementKeys',
    'restoredProductIds'
  }) {
    final v = payload[key];
    if (v != null &&
        (v is! List ||
            v.length > 64 ||
            v.toSet().length != v.length ||
            v.any((e) => !_identifierPattern.hasMatch(e is String ? e : ''))))
      throw const FormatException('Invalid identifier list.');
  }
  for (final key in const {'diagnosticCode', 'providerResultCode'}) {
    final v = payload[key];
    if (v != null &&
        (v is! String ||
            !RegExp(r'^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$').hasMatch(v) ||
            v.length > 96)) throw const FormatException('Invalid safe code.');
  }
  if (payload['retryable'] != null && payload['retryable'] is! bool)
    throw const FormatException('Invalid retryable value.');
}

void _validateContext(MosaicAnalyticsContext? context) {
  if (context == null) return;
  if (!const {'ios', 'android'}.contains(context.platform) ||
      !const {'flutter', 'ios', 'android'}.contains(context.sdkFamily)) {
    throw const FormatException('Invalid analytics platform context.');
  }
  final versionPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$');
  if (!versionPattern.hasMatch(context.sdkVersion) ||
      context.applicationVersion != null &&
          !versionPattern.hasMatch(context.applicationVersion!)) {
    throw const FormatException('Invalid analytics version context.');
  }
  if (context.configurationDeliveryVersion != null &&
          !const {'1', '2'}.contains(context.configurationDeliveryVersion) ||
      context.commerceProviderContractVersion != null &&
          !const {'1', '2'}.contains(context.commerceProviderContractVersion)) {
    throw const FormatException('Invalid analytics Contract context.');
  }
  if (context.locale != null &&
      !RegExp(r'^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$')
          .hasMatch(context.locale!)) {
    throw const FormatException('Invalid analytics locale.');
  }
}

void _validateEventRelationships(
  MosaicAnalyticsEventName name,
  MosaicAnalyticsCorrelation correlation,
  MosaicAnalyticsAttribution attribution,
) {
  final placement =
      correlation.placementRequestId != null && attribution.placementId != null;
  final presentation = correlation.paywallPresentationId != null;
  final paywall =
      attribution.paywallId != null && attribution.paywallVersionId != null;
  final load = correlation.productLoadAttemptId != null;
  final product = attribution.mosaicProductId != null;
  final purchase = correlation.purchaseAttemptId != null &&
      product &&
      attribution.providerId != null;
  final restore = correlation.restoreAttemptId != null;
  final valid = switch (name) {
    MosaicAnalyticsEventName.placementRequested ||
    MosaicAnalyticsEventName.placementNoPaywall ||
    MosaicAnalyticsEventName.placementFallbackUsed ||
    MosaicAnalyticsEventName.placementUnavailable ||
    MosaicAnalyticsEventName.placementEvaluationFailed =>
      placement,
    MosaicAnalyticsEventName.placementPaywallSelected => placement && paywall,
    MosaicAnalyticsEventName.paywallPresented => presentation && paywall,
    MosaicAnalyticsEventName.paywallDismissed ||
    MosaicAnalyticsEventName.paywallActionSelected =>
      presentation,
    MosaicAnalyticsEventName.productLoadStarted => load && presentation,
    MosaicAnalyticsEventName.productLoadCompleted ||
    MosaicAnalyticsEventName.productLoadFailed =>
      load,
    MosaicAnalyticsEventName.productUnavailable => load && product,
    MosaicAnalyticsEventName.productSelected =>
      presentation && paywall && product,
    MosaicAnalyticsEventName.purchaseStarted ||
    MosaicAnalyticsEventName.purchaseCompletedClient ||
    MosaicAnalyticsEventName.purchasePending ||
    MosaicAnalyticsEventName.purchaseDeferred ||
    MosaicAnalyticsEventName.purchaseCancelled ||
    MosaicAnalyticsEventName.purchaseFailed =>
      purchase,
    MosaicAnalyticsEventName.purchaseCompletedProvider =>
      (correlation.purchaseAttemptId != null ||
              correlation.providerOperationId != null ||
              correlation.providerUpdateId != null) &&
          product &&
          attribution.providerId != null,
    MosaicAnalyticsEventName.restoreStarted ||
    MosaicAnalyticsEventName.restoreCompleted ||
    MosaicAnalyticsEventName.restoreNothingFound ||
    MosaicAnalyticsEventName.restoreCancelled ||
    MosaicAnalyticsEventName.restoreFailed =>
      restore,
    MosaicAnalyticsEventName.paywallRenderFailed => true,
  };
  if (!valid) {
    throw const FormatException(
        'Missing required event correlation or attribution.');
  }

  const placementCorrelation = <String>{'placementRequestId'};
  const presentationCorrelation = <String>{
    'placementRequestId',
    'paywallPresentationId',
  };
  const loadCorrelation = <String>{
    ...presentationCorrelation,
    'productLoadAttemptId',
  };
  const purchaseCorrelation = <String>{
    ...presentationCorrelation,
    'purchaseAttemptId',
    'providerOperationId',
    'providerUpdateId',
  };
  const restoreCorrelation = <String>{
    ...presentationCorrelation,
    'restoreAttemptId',
    'providerOperationId',
    'providerUpdateId',
  };
  final allowedCorrelation = switch (name) {
    MosaicAnalyticsEventName.placementRequested ||
    MosaicAnalyticsEventName.placementPaywallSelected ||
    MosaicAnalyticsEventName.placementNoPaywall ||
    MosaicAnalyticsEventName.placementFallbackUsed ||
    MosaicAnalyticsEventName.placementUnavailable ||
    MosaicAnalyticsEventName.placementEvaluationFailed =>
      placementCorrelation,
    MosaicAnalyticsEventName.paywallPresented ||
    MosaicAnalyticsEventName.paywallDismissed ||
    MosaicAnalyticsEventName.paywallActionSelected ||
    MosaicAnalyticsEventName.paywallRenderFailed ||
    MosaicAnalyticsEventName.productSelected =>
      presentationCorrelation,
    MosaicAnalyticsEventName.productLoadStarted ||
    MosaicAnalyticsEventName.productLoadCompleted ||
    MosaicAnalyticsEventName.productLoadFailed ||
    MosaicAnalyticsEventName.productUnavailable =>
      loadCorrelation,
    MosaicAnalyticsEventName.purchaseStarted ||
    MosaicAnalyticsEventName.purchaseCompletedClient ||
    MosaicAnalyticsEventName.purchaseCompletedProvider ||
    MosaicAnalyticsEventName.purchasePending ||
    MosaicAnalyticsEventName.purchaseDeferred ||
    MosaicAnalyticsEventName.purchaseCancelled ||
    MosaicAnalyticsEventName.purchaseFailed =>
      purchaseCorrelation,
    MosaicAnalyticsEventName.restoreStarted ||
    MosaicAnalyticsEventName.restoreCompleted ||
    MosaicAnalyticsEventName.restoreNothingFound ||
    MosaicAnalyticsEventName.restoreCancelled ||
    MosaicAnalyticsEventName.restoreFailed =>
      restoreCorrelation,
  };
  if (!allowedCorrelation.containsAll(correlation.toJson().keys)) {
    throw const FormatException('Correlation is not valid for event type.');
  }

  const placementAttribution = <String>{
    'configurationReleaseId',
    'placementId',
    'placementRuleSetId',
    'placementRuleSetVersion',
    'winningRuleId',
  };
  const paywallAttribution = <String>{
    ...placementAttribution,
    'paywallId',
    'paywallVersionId',
  };
  const productAttribution = <String>{
    ...paywallAttribution,
    'mosaicProductId',
    'planId',
    'providerId',
    'providerProductMappingId',
  };
  final allowedAttribution = switch (name) {
    MosaicAnalyticsEventName.placementRequested ||
    MosaicAnalyticsEventName.placementNoPaywall ||
    MosaicAnalyticsEventName.placementUnavailable ||
    MosaicAnalyticsEventName.placementEvaluationFailed =>
      placementAttribution,
    MosaicAnalyticsEventName.placementPaywallSelected ||
    MosaicAnalyticsEventName.placementFallbackUsed ||
    MosaicAnalyticsEventName.paywallPresented ||
    MosaicAnalyticsEventName.paywallDismissed ||
    MosaicAnalyticsEventName.paywallActionSelected ||
    MosaicAnalyticsEventName.paywallRenderFailed ||
    MosaicAnalyticsEventName.productLoadStarted ||
    MosaicAnalyticsEventName.productLoadCompleted ||
    MosaicAnalyticsEventName.productLoadFailed ||
    MosaicAnalyticsEventName.restoreStarted ||
    MosaicAnalyticsEventName.restoreCompleted ||
    MosaicAnalyticsEventName.restoreNothingFound ||
    MosaicAnalyticsEventName.restoreCancelled ||
    MosaicAnalyticsEventName.restoreFailed =>
      paywallAttribution,
    MosaicAnalyticsEventName.productUnavailable ||
    MosaicAnalyticsEventName.productSelected ||
    MosaicAnalyticsEventName.purchaseStarted ||
    MosaicAnalyticsEventName.purchaseCompletedClient ||
    MosaicAnalyticsEventName.purchaseCompletedProvider ||
    MosaicAnalyticsEventName.purchasePending ||
    MosaicAnalyticsEventName.purchaseDeferred ||
    MosaicAnalyticsEventName.purchaseCancelled ||
    MosaicAnalyticsEventName.purchaseFailed =>
      productAttribution,
  };
  if (!allowedAttribution.containsAll(attribution.toJson().keys)) {
    throw const FormatException('Attribution is not valid for event type.');
  }
}

final RegExp _identifierPattern =
    RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
String _identifier(Object? value, String name) {
  if (value is! String || !_identifierPattern.hasMatch(value))
    throw FormatException('Invalid $name.');
  return value;
}

String _string(Object? value, String name) {
  if (value is! String || value.isEmpty)
    throw FormatException('Invalid $name.');
  return value;
}

DateTime _timestamp(Object? value, String name) {
  if (value is! String ||
      !RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$').hasMatch(value))
    throw FormatException('Invalid $name.');
  final parsed = DateTime.tryParse(value);
  if (parsed == null || !parsed.isUtc) throw FormatException('Invalid $name.');
  return parsed;
}

void _closed(Map<String, Object?> value, Set<String> allowed) {
  if (value.keys.any((key) => !allowed.contains(key)))
    throw const FormatException('Unknown field.');
}
