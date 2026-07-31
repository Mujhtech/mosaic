import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';

import 'analytics_event.dart';
import 'experiment_analytics.dart';
import 'placement_identity.dart';
import 'sha256.dart';

const int mosaicAnalyticsMaximumQueueEvents = 1000;
const int mosaicAnalyticsMaximumQueueBytes = 2 * 1024 * 1024;
const int mosaicAnalyticsMaximumAttempts = 10;
const Duration mosaicAnalyticsEventExpiry = Duration(days: 7);
const Duration mosaicAnalyticsSessionInactivity = Duration(minutes: 30);

/// Safe diagnostic code reported when analytics persistence is unavailable.
/// Queued events stay in memory; delivery and purchasing continue unaffected.
const String mosaicAnalyticsStorageUnavailableCode =
    'analytics.storage_unavailable';

typedef MosaicAnalyticsClock = DateTime Function();
typedef MosaicAnalyticsRandom = double Function();

final class MosaicAnalyticsEnvironmentSettings {
  const MosaicAnalyticsEnvironmentSettings({
    required this.collectionEnabled,
  });
  final bool collectionEnabled;
}

final class MosaicAnalyticsDiagnostics {
  const MosaicAnalyticsDiagnostics({
    required this.collectionEnabled,
    required this.queuedEvents,
    required this.queuedBytes,
    required this.droppedEvents,
    required this.expiredEvents,
    required this.permanentlyRejectedEvents,
    required this.retryableEvents,
    required this.attemptsExhaustedEvents,
    this.lastSafeCode,
    this.lastFlushAt,
  });
  final bool collectionEnabled;
  final int queuedEvents;
  final int queuedBytes;
  final int droppedEvents;
  final int expiredEvents;
  final int permanentlyRejectedEvents;
  final int retryableEvents;
  final int attemptsExhaustedEvents;
  final String? lastSafeCode;
  final DateTime? lastFlushAt;
}

sealed class MosaicAnalyticsFlushResult {
  const MosaicAnalyticsFlushResult();
}

final class MosaicAnalyticsFlushDisabled extends MosaicAnalyticsFlushResult {
  const MosaicAnalyticsFlushDisabled();
}

final class MosaicAnalyticsFlushEmpty extends MosaicAnalyticsFlushResult {
  const MosaicAnalyticsFlushEmpty();
}

final class MosaicAnalyticsFlushCompleted extends MosaicAnalyticsFlushResult {
  const MosaicAnalyticsFlushCompleted({
    required this.sent,
    required this.removed,
    required this.retained,
  });
  final int sent;
  final int removed;
  final int retained;
}

final class MosaicAnalyticsFlushDeferred extends MosaicAnalyticsFlushResult {
  const MosaicAnalyticsFlushDeferred({required this.safeCode});
  final String safeCode;
}

abstract interface class MosaicAnalyticsTransport {
  Future<MosaicAnalyticsIngestionResponse> send(MosaicAnalyticsBatch batch);
}

final class MosaicIoAnalyticsTransport
    implements MosaicAnalyticsTransport, MosaicExperimentAnalyticsTransport {
  const MosaicIoAnalyticsTransport({
    required this.baseUrl,
    required this.publicSdkKey,
    this.timeout = const Duration(seconds: 5),
  });
  final Uri baseUrl;
  final String publicSdkKey;
  final Duration timeout;

  @override
  Future<MosaicAnalyticsIngestionResponse> send(MosaicAnalyticsBatch batch) =>
      _send(batch.encode(), mosaicAnalyticsEventContractVersion);

  @override
  Future<MosaicAnalyticsIngestionResponse> sendExperiment(
          MosaicExperimentAnalyticsBatch batch) =>
      _send(batch.encode(), mosaicAnalyticsEventContractVersionV2);

  Future<MosaicAnalyticsIngestionResponse> _send(
    String encoded,
    String contractVersion,
  ) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final endpoint = baseUrl.resolve('/v1/sdk/events/batch');
      final request = await client.postUrl(endpoint).timeout(timeout);
      request.headers
        ..set(HttpHeaders.authorizationHeader, 'Bearer $publicSdkKey')
        ..contentType = ContentType.json;
      request.write(encoded);
      final response = await request.close().timeout(timeout);
      final body = await utf8.decoder.bind(response).join().timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException('Analytics ingestion unavailable.', uri: endpoint);
      }
      return MosaicAnalyticsIngestionResponse.decode(
        body,
        contractVersion: contractVersion,
      );
    } finally {
      client.close(force: true);
    }
  }
}

abstract interface class MosaicAnalyticsStorage {
  Future<String?> read(String namespace);
  Future<void> write(String namespace, String source);
  Future<void> clear(String namespace);
}

final class MosaicMemoryAnalyticsStorage implements MosaicAnalyticsStorage {
  String? source;
  @override
  Future<String?> read(String namespace) async => source;
  @override
  Future<void> write(String namespace, String source) async =>
      this.source = source;
  @override
  Future<void> clear(String namespace) async => source = null;
}

typedef MosaicAnalyticsDirectoryProvider = Future<Directory> Function();
Future<Directory> _analyticsDirectory() => getApplicationCacheDirectory();

/// Atomic app-private storage in the platform cache directory, which is
/// excluded from device backups on supported Flutter platforms.
final class MosaicFileAnalyticsStorage implements MosaicAnalyticsStorage {
  const MosaicFileAnalyticsStorage({
    MosaicAnalyticsDirectoryProvider directoryProvider = _analyticsDirectory,
  }) : _directoryProvider = directoryProvider;
  final MosaicAnalyticsDirectoryProvider _directoryProvider;

  @override
  Future<String?> read(String namespace) async {
    final file = await _file(namespace);
    if (!await file.exists()) return null;
    if ((await file.stat()).size >
        mosaicAnalyticsMaximumQueueBytes + 256 * 1024) {
      throw const FormatException('Analytics queue exceeds its storage limit.');
    }
    return file.readAsString();
  }

  @override
  Future<void> write(String namespace, String source) async {
    final target = await _file(namespace);
    await target.parent.create(recursive: true);
    final temporary =
        File('${target.path}.tmp-${DateTime.now().microsecondsSinceEpoch}');
    try {
      await temporary.writeAsString(source, flush: true);
      await temporary.rename(target.path);
    } on Object {
      if (await temporary.exists()) await temporary.delete();
      rethrow;
    }
  }

  @override
  Future<void> clear(String namespace) async {
    final file = await _file(namespace);
    if (await file.exists()) await file.delete();
  }

  Future<File> _file(String namespace) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(namespace))
      throw ArgumentError.value(namespace, 'namespace');
    final directory = await _directoryProvider();
    return File('${directory.path}/mosaic/analytics-$namespace.json');
  }
}

final class _QueuedAnalyticsEvent {
  _QueuedAnalyticsEvent(
      {required this.event,
      required this.encoded,
      this.attempts = 0,
      this.notBefore})
      : experimentEvent = null;
  _QueuedAnalyticsEvent.experiment({
    required Map<String, Object?> event,
    required this.encoded,
    this.attempts = 0,
    this.notBefore,
  })  : event = null,
        experimentEvent = Map.unmodifiable(event);
  final MosaicAnalyticsEvent? event;
  final Map<String, Object?>? experimentEvent;
  final String encoded;
  int attempts;
  DateTime? notBefore;
  int get bytes => utf8.encode(encoded).length;
  bool get isExperiment => experimentEvent != null;
  String get eventId =>
      event?.eventId ?? experimentEvent!['eventId']! as String;
  DateTime get occurredAt =>
      event?.occurredAt ??
      DateTime.parse(experimentEvent!['occurredAt']! as String).toUtc();
  MosaicAnalyticsEventPriority get priority {
    final normal = event;
    if (normal != null) return normal.name.priority;
    final name = experimentEvent!['eventName'];
    return switch (name) {
      'experiment_assigned' ||
      'experiment_assignment_failed' =>
        MosaicAnalyticsEventPriority.low,
      'experiment_exposed' ||
      'experiment_fallback_presented' =>
        MosaicAnalyticsEventPriority.presentation,
      // An attributed conversion event keeps the priority of its shared event
      // name, so overflow eviction still protects purchase outcomes.
      _ => _sharedEventPriority(name) ?? MosaicAnalyticsEventPriority.low,
    };
  }

  static MosaicAnalyticsEventPriority? _sharedEventPriority(Object? name) {
    try {
      return MosaicAnalyticsEventName.parse(name).priority;
    } on FormatException {
      return null;
    }
  }

  Map<String, Object?> toJson() => {
        'event': jsonDecode(encoded),
        'attempts': attempts,
        if (notBefore != null) 'notBefore': mosaicAnalyticsTimestamp(notBefore!)
      };
}

final class MosaicAnalyticsRuntime
    with WidgetsBindingObserver
    implements MosaicExperimentAnalyticsSink {
  static final Map<String, ({MosaicAnalyticsRuntime runtime, int references})>
      _shared = <String, ({MosaicAnalyticsRuntime runtime, int references})>{};

  static MosaicAnalyticsRuntime acquire({
    required String namespace,
    required MosaicIdentityController identityController,
    required MosaicAnalyticsContext context,
    required MosaicAnalyticsTransport transport,
    required MosaicAnalyticsStorage storage,
    required bool environmentEnabled,
    required bool hostEnabled,
  }) {
    final existing = _shared[namespace];
    if (existing != null) {
      existing.runtime
        .._environmentEnabled = environmentEnabled
        .._hostEnabled = hostEnabled;
      _shared[namespace] = (
        runtime: existing.runtime,
        references: existing.references + 1,
      );
      return existing.runtime;
    }
    final runtime = MosaicAnalyticsRuntime(
      namespace: namespace,
      identityController: identityController,
      context: context,
      transport: transport,
      storage: storage,
      environmentEnabled: environmentEnabled,
      hostEnabled: hostEnabled,
    );
    _shared[namespace] = (runtime: runtime, references: 1);
    return runtime;
  }

  MosaicAnalyticsRuntime({
    required this.namespace,
    required this.identityController,
    required this.context,
    required this.transport,
    this.storage = const MosaicFileAnalyticsStorage(),
    this.clock = _systemClock,
    bool environmentEnabled = false,
    bool hostEnabled = true,
    MosaicAnalyticsRandom? random,
  })  : _environmentEnabled = environmentEnabled,
        _hostEnabled = hostEnabled,
        _random = random ?? Random.secure().nextDouble;

  final String namespace;
  final MosaicIdentityController identityController;
  final MosaicAnalyticsContext context;
  final MosaicAnalyticsTransport transport;
  final MosaicAnalyticsStorage storage;
  final MosaicAnalyticsClock clock;
  final MosaicAnalyticsRandom _random;
  final List<_QueuedAnalyticsEvent> _queue = [];
  Future<void> _mutations = Future.value();
  Future<MosaicAnalyticsFlushResult>? _flush;
  bool _loaded = false;
  bool _environmentEnabled;
  bool _hostEnabled;
  bool _disposed = false;
  bool _observingLifecycle = false;
  String? _sessionId;
  DateTime? _lastActivityAt;
  int _dropped = 0,
      _expired = 0,
      _permanent = 0,
      _retryable = 0,
      _exhausted = 0;
  String? _lastSafeCode;
  DateTime? _lastFlushAt;

  bool get collectionEnabled =>
      _environmentEnabled && _hostEnabled && !_disposed;

  Future<void> initialize() => _serialize(() async {
        if (_loaded) return;
        await _restore();
        _loaded = true;
        _observeLifecycleIfAvailable();
        if (!collectionEnabled) {
          _queue.clear();
          _sessionId = null;
          _lastActivityAt = null;
          await _clearStorageSafely();
        }
      });

  Future<void> setCollection(
          {required MosaicAnalyticsEnvironmentSettings environment,
          bool hostEnabled = true}) =>
      _serialize(() async {
        final wasEnabled = collectionEnabled;
        _environmentEnabled = environment.collectionEnabled;
        _hostEnabled = hostEnabled;
        await _ensureLoaded();
        if (!collectionEnabled) {
          _queue.clear();
          _sessionId = null;
          _lastActivityAt = null;
          await _clearStorageSafely();
        } else {
          if (!wasEnabled) {
            _sessionId = null;
            _lastActivityAt = null;
          }
          await _persistSafely();
        }
      });

  Future<bool> record({
    required MosaicAnalyticsEventName name,
    required MosaicAnalyticsCorrelation correlation,
    required MosaicAnalyticsAttribution attribution,
    required Map<String, Object?> payload,
    DateTime? occurredAt,
  }) async {
    var accepted = false;
    await _serialize(() async {
      await _ensureLoaded();
      if (!collectionEnabled) return;
      final now = (occurredAt ?? clock()).toUtc();
      final identity = await identityController.load();
      final session = _activeSession(now);
      final event = MosaicAnalyticsEvent(
        eventId: _newId('event'),
        name: name,
        occurredAt: now,
        queuedAt: clock().toUtc(),
        identity: MosaicAnalyticsIdentity(
          installationId: identity.installationId,
          applicationUserId: identity.userId,
          generation: identity.generation,
        ),
        sessionId: session,
        context: context,
        correlation: correlation,
        attribution: attribution,
        payload: payload,
      );
      final encoded = event.encode();
      // An event carrying Experiment attribution is an Analytics Event v2
      // document and must be delivered in a v2 batch. Versions are never mixed
      // inside one batch.
      final queued = event.attribution.experiment == null
          ? _QueuedAnalyticsEvent(event: event, encoded: encoded)
          : _QueuedAnalyticsEvent.experiment(
              event: event.toJson(),
              encoded: encoded,
            );
      _dropExpired(clock().toUtc());
      _makeRoom(queued);
      if (_queue.length >= mosaicAnalyticsMaximumQueueEvents ||
          _queueBytes + queued.bytes > mosaicAnalyticsMaximumQueueBytes) {
        _dropped++;
        _lastSafeCode = 'analytics.queue_overflow';
        await _persistSafely();
        return;
      }
      _queue.add(queued);
      accepted = true;
      await _persistSafely();
    });
    if (accepted && _queue.length >= 50) _flushInBackground();
    return accepted;
  }

  @override
  Future<void> enqueue(Map<String, Object?> draft) => _serialize(() async {
        await _ensureLoaded();
        if (!collectionEnabled) return;
        final now = clock().toUtc();
        final identity = await identityController.load();
        final event = Map<String, Object?>.from(draft)
          ..['eventSchemaVersion'] = '2'
          ..['queuedAt'] = mosaicAnalyticsTimestamp(now)
          ..['identity'] = MosaicAnalyticsIdentity(
            installationId: identity.installationId,
            applicationUserId: identity.userId,
            generation: identity.generation,
          ).toJson()
          ..['sessionId'] = _activeSession(now)
          ..['context'] = context.toJson();
        final validated = mosaicDecodeExperimentAnalyticsEvent(event);
        final encoded = jsonEncode(validated);
        final queued = _QueuedAnalyticsEvent.experiment(
          event: validated,
          encoded: encoded,
        );
        _dropExpired(now);
        _makeRoom(queued);
        if (_queue.length >= mosaicAnalyticsMaximumQueueEvents ||
            _queueBytes + queued.bytes > mosaicAnalyticsMaximumQueueBytes) {
          _dropped++;
          _lastSafeCode = 'analytics.queue_overflow';
          await _persistSafely();
          return;
        }
        _queue.add(queued);
        await _persistSafely();
      });

  Future<MosaicAnalyticsFlushResult> flush() =>
      _flush ??= _performFlush().whenComplete(() => _flush = null);

  Future<MosaicAnalyticsFlushResult> _performFlush() async {
    MosaicAnalyticsBatch? batch;
    MosaicExperimentAnalyticsBatch? experimentBatch;
    List<_QueuedAnalyticsEvent> sent = const [];
    await _serialize(() async {
      await _ensureLoaded();
      if (!collectionEnabled) return;
      final now = clock().toUtc();
      _dropExpired(now);
      final eligible = _queue
          .where((e) => e.notBefore == null || !e.notBefore!.isAfter(now))
          .toList();
      final selected = <_QueuedAnalyticsEvent>[];
      final experiment = eligible.isEmpty ? null : eligible.first.isExperiment;
      for (final item in eligible
          .where((item) => item.isExperiment == experiment)
          .take(mosaicAnalyticsMaximumSendBatchSize)) {
        final encoded = experiment == true
            ? MosaicExperimentAnalyticsBatch(
                batchId: _newId('batch'),
                sentAt: now,
                events: [
                  ...selected.map((e) => e.experimentEvent!),
                  item.experimentEvent!,
                ],
              ).encode()
            : MosaicAnalyticsBatch(
                batchId: _newId('batch'),
                sentAt: now,
                events: [
                  ...selected.map((e) => e.event!),
                  item.event!,
                ],
              ).encode();
        if (utf8.encode(encoded).length > mosaicAnalyticsMaximumBatchBytes) {
          break;
        }
        selected.add(item);
      }
      if (selected.isNotEmpty) {
        sent = selected;
        if (experiment == true) {
          experimentBatch = MosaicExperimentAnalyticsBatch(
            batchId: _newId('batch'),
            sentAt: now,
            events: selected.map((e) => e.experimentEvent!),
          );
        } else {
          batch = MosaicAnalyticsBatch(
            batchId: _newId('batch'),
            sentAt: now,
            events: selected.map((e) => e.event!),
          );
        }
      }
      await _persistSafely();
    });
    if (!collectionEnabled) return const MosaicAnalyticsFlushDisabled();
    if (batch == null && experimentBatch == null) {
      return const MosaicAnalyticsFlushEmpty();
    }
    MosaicAnalyticsIngestionResponse response;
    try {
      if (experimentBatch case final value?) {
        final experimentTransport = transport;
        if (experimentTransport is! MosaicExperimentAnalyticsTransport) {
          throw const FormatException('Analytics v2 transport unavailable.');
        }
        response =
            await (experimentTransport as MosaicExperimentAnalyticsTransport)
                .sendExperiment(value);
      } else {
        response = await transport.send(batch!);
      }
    } on Object {
      await _retainAfterFailure(sent, 'analytics.delivery_unavailable');
      return const MosaicAnalyticsFlushDeferred(
          safeCode: 'analytics.delivery_unavailable');
    }
    final sentBatchId = experimentBatch?.batchId ?? batch!.batchId;
    var malformed = response.batchId != sentBatchId ||
        response.results.length != sent.length;
    final ids = sent.map((e) => e.eventId).toSet();
    malformed = malformed ||
        response.results.map((e) => e.eventId).toSet().length != sent.length ||
        response.results
            .any((e) => !ids.contains(e.eventId) || !e.isContractValid);
    if (malformed) {
      await _retainAfterFailure(sent, 'analytics.acknowledgement_malformed');
      return const MosaicAnalyticsFlushDeferred(
          safeCode: 'analytics.acknowledgement_malformed');
    }
    var removed = 0, retained = 0;
    await _serialize(() async {
      final byId = {
        for (final result in response.results) result.eventId: result
      };
      for (final item in sent) {
        final result = byId[item.eventId]!;
        switch (result.status) {
          case MosaicAnalyticsIngestionStatus.accepted:
          case MosaicAnalyticsIngestionStatus.duplicate:
            if (_queue.remove(item)) removed++;
          case MosaicAnalyticsIngestionStatus.permanentlyRejected:
            if (_queue.remove(item)) {
              removed++;
              _permanent++;
              _lastSafeCode = result.code;
            }
          case MosaicAnalyticsIngestionStatus.retryable:
            _retryable++;
            _lastSafeCode = result.code;
            _scheduleRetry(item, explicit: result.retryAfter);
            retained++;
        }
      }
      _lastFlushAt = clock().toUtc();
      await _persistSafely();
    });
    return MosaicAnalyticsFlushCompleted(
        sent: sent.length, removed: removed, retained: retained);
  }

  Future<void> _retainAfterFailure(
          List<_QueuedAnalyticsEvent> sent, String code) =>
      _serialize(() async {
        _lastSafeCode = code;
        _retryable += sent.length;
        for (final item in sent) {
          _scheduleRetry(item);
        }
        await _persistSafely();
      });
  void _scheduleRetry(_QueuedAnalyticsEvent item, {Duration? explicit}) {
    if (!_queue.contains(item)) return;
    item.attempts++;
    if (item.attempts >= mosaicAnalyticsMaximumAttempts) {
      _queue.remove(item);
      _exhausted++;
      return;
    }
    final exponent = 1 << (item.attempts - 1).clamp(0, 8);
    final ceiling = min(300, exponent);
    final delay = explicit ??
        Duration(
          milliseconds: (1000 + _random() * (ceiling * 1000 - 1000)).round(),
        );
    item.notBefore = clock().toUtc().add(delay);
  }

  Future<MosaicAnalyticsDiagnostics> diagnostics() async {
    await initialize();
    await _mutations;
    return MosaicAnalyticsDiagnostics(
        collectionEnabled: collectionEnabled,
        queuedEvents: _queue.length,
        queuedBytes: _queueBytes,
        droppedEvents: _dropped,
        expiredEvents: _expired,
        permanentlyRejectedEvents: _permanent,
        retryableEvents: _retryable,
        attemptsExhaustedEvents: _exhausted,
        lastSafeCode: _lastSafeCode,
        lastFlushAt: _lastFlushAt);
  }

  Future<void> identityDidChange({required bool effectiveUserChange}) =>
      _serialize(() async {
        if (effectiveUserChange) {
          _sessionId = null;
          _lastActivityAt = null;
        }
        await _persistSafely();
      });

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.detached) _flushInBackground();
    if (state == AppLifecycleState.resumed) _flushInBackground();
  }

  Future<void> disposeRuntime() => _serialize(() async {
        if (_disposed) return;
        _disposed = true;
        if (_observingLifecycle) WidgetsBinding.instance.removeObserver(this);
        await _persistSafely();
      });

  Future<void> release() async {
    final shared = _shared[namespace];
    if (shared == null || !identical(shared.runtime, this)) {
      await disposeRuntime();
      return;
    }
    if (shared.references > 1) {
      _shared[namespace] = (
        runtime: this,
        references: shared.references - 1,
      );
      return;
    }
    _shared.remove(namespace);
    await disposeRuntime();
  }

  String _activeSession(DateTime now) {
    if (_sessionId == null ||
        _lastActivityAt == null ||
        now.difference(_lastActivityAt!) >= mosaicAnalyticsSessionInactivity ||
        now.isBefore(_lastActivityAt!)) _sessionId = _newId('session');
    _lastActivityAt = now;
    return _sessionId!;
  }

  int get _queueBytes => _queue.fold(0, (sum, item) => sum + item.bytes);
  void _dropExpired(DateTime now) {
    final before = _queue.length;
    _queue.removeWhere(
        (e) => now.difference(e.occurredAt) > mosaicAnalyticsEventExpiry);
    _expired += before - _queue.length;
  }

  void _makeRoom(_QueuedAnalyticsEvent incoming) {
    while (_queue.isNotEmpty &&
        (_queue.length >= mosaicAnalyticsMaximumQueueEvents ||
            _queueBytes + incoming.bytes > mosaicAnalyticsMaximumQueueBytes)) {
      for (final priority in MosaicAnalyticsEventPriority.values) {
        final index = _queue.indexWhere((e) => e.priority == priority);
        if (index >= 0) {
          _queue.removeAt(index);
          _dropped++;
          break;
        }
      }
    }
  }

  Future<void> _restore() async {
    try {
      final source = await storage.read(namespace);
      if (source == null) return;
      final raw = jsonDecode(source);
      if (raw is! Map || raw['version'] != 1) throw const FormatException();
      final json = raw.cast<String, Object?>();
      final items = json['events'];
      if (items is! List) throw const FormatException();
      for (final value in items) {
        if (value is! Map) throw const FormatException();
        final item = value.cast<String, Object?>();
        final eventValue = item['event'];
        if (eventValue is! Map) throw const FormatException();
        final eventJson = eventValue.cast<String, Object?>();
        final attempts = item['attempts'];
        if (attempts is! int ||
            attempts < 0 ||
            attempts >= mosaicAnalyticsMaximumAttempts) continue;
        final notBefore = item['notBefore'] == null
            ? null
            : DateTime.parse(item['notBefore'] as String).toUtc();
        if (eventJson['eventSchemaVersion'] == '2') {
          final validated = mosaicDecodeExperimentAnalyticsEvent(eventJson);
          final encoded = jsonEncode(validated);
          _queue.add(_QueuedAnalyticsEvent.experiment(
            event: validated,
            encoded: encoded,
            attempts: attempts,
            notBefore: notBefore,
          ));
        } else {
          final event = MosaicAnalyticsEvent.fromJson(eventJson);
          _queue.add(_QueuedAnalyticsEvent(
            event: event,
            encoded: event.encode(),
            attempts: attempts,
            notBefore: notBefore,
          ));
        }
      }
      _sessionId = json['sessionId'] as String?;
      _lastActivityAt = json['lastActivityAt'] == null
          ? null
          : DateTime.parse(json['lastActivityAt'] as String).toUtc();
      _dropped = json['dropped'] as int? ?? 0;
      _expired = json['expired'] as int? ?? 0;
      _permanent = json['permanent'] as int? ?? 0;
      _retryable = json['retryable'] as int? ?? 0;
      _exhausted = json['exhausted'] as int? ?? 0;
      _lastSafeCode = json['lastSafeCode'] as String?;
      _dropExpired(clock().toUtc());
      while (_queue.length > mosaicAnalyticsMaximumQueueEvents ||
          _queueBytes > mosaicAnalyticsMaximumQueueBytes) {
        _queue.removeAt(0);
        _dropped++;
      }
    } on Object {
      _queue.clear();
      await _clearStorageSafely();
      _lastSafeCode = 'analytics.queue_rejected';
    }
  }

  /// Persists the queue, degrading to a diagnostic safe code when the injected
  /// storage fails. Analytics persistence must never surface as a host-app
  /// error, and must never block rendering or purchasing.
  Future<void> _persistSafely() async {
    try {
      await _persist();
    } on Object {
      _lastSafeCode = mosaicAnalyticsStorageUnavailableCode;
    }
  }

  Future<void> _clearStorageSafely() async {
    try {
      await storage.clear(namespace);
    } on Object {
      _lastSafeCode = mosaicAnalyticsStorageUnavailableCode;
    }
  }

  /// Starts a delivery attempt without awaiting it. Failures are recorded as
  /// safe diagnostics rather than escaping as uncaught zone errors.
  void _flushInBackground() {
    unawaited(flush().then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {
        _lastSafeCode = mosaicAnalyticsStorageUnavailableCode;
      },
    ));
  }

  Future<void> _persist() => storage.write(
      namespace,
      jsonEncode({
        'version': 1,
        'events': _queue.map((e) => e.toJson()).toList(),
        'sessionId': _sessionId,
        'lastActivityAt': _lastActivityAt == null
            ? null
            : mosaicAnalyticsTimestamp(_lastActivityAt!),
        'dropped': _dropped,
        'expired': _expired,
        'permanent': _permanent,
        'retryable': _retryable,
        'exhausted': _exhausted,
        'lastSafeCode': _lastSafeCode
      }));
  Future<void> _ensureLoaded() async {
    if (!_loaded) {
      await _restore();
      _loaded = true;
      _observeLifecycleIfAvailable();
      if (!collectionEnabled) {
        _queue.clear();
        _sessionId = null;
        _lastActivityAt = null;
        await _clearStorageSafely();
      }
    }
  }

  Future<void> _serialize(Future<void> Function() action) {
    final completer = Completer<void>();
    _mutations = _mutations.then((_) async {
      try {
        await action();
        completer.complete();
      } catch (e, s) {
        completer.completeError(e, s);
      }
    });
    return completer.future;
  }

  void _observeLifecycleIfAvailable() {
    if (_observingLifecycle) return;
    try {
      WidgetsBinding.instance.addObserver(this);
      _observingLifecycle = true;
    } on FlutterError {
      // Pure Dart hosts may initialize analytics before Flutter bindings.
    }
  }

  String _newId(String prefix) => mosaicAnalyticsId(prefix);
}

DateTime _systemClock() => DateTime.now().toUtc();
String mosaicAnalyticsNamespace(Uri baseUrl, String publicSdkKey) =>
    mosaicSha256String('${baseUrl.toString()}\n$publicSdkKey\nanalytics-v1');

String mosaicAnalyticsId(String prefix) {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  return '${prefix}_${bytes.map((e) => e.toRadixString(16).padLeft(2, '0')).join()}';
}

/// Immutable hosted-presentation correlation captured before rendering.
final class MosaicAnalyticsPresentationContext {
  const MosaicAnalyticsPresentationContext({
    required this.placementRequestId,
    required this.paywallPresentationId,
    required this.attribution,
    this.providerId,
    this.providerProductMappingIds = const <String, String>{},
    this.experiment,
  });
  final String placementRequestId;
  final String paywallPresentationId;
  final MosaicAnalyticsAttribution attribution;
  final String? providerId;
  final Map<String, String> providerProductMappingIds;

  /// The Experiment Variant this presentation is attributed to, when the SDK
  /// also emits a statistical exposure for it. Conversion events must carry it:
  /// Experiment results join conversions to exposures solely on this tuple.
  final MosaicExperimentAttribution? experiment;

  MosaicAnalyticsCorrelation correlation({
    String? productLoadAttemptId,
    String? purchaseAttemptId,
    String? restoreAttemptId,
    String? providerOperationId,
  }) =>
      MosaicAnalyticsCorrelation(
        placementRequestId: placementRequestId,
        paywallPresentationId: paywallPresentationId,
        productLoadAttemptId: productLoadAttemptId,
        purchaseAttemptId: purchaseAttemptId,
        restoreAttemptId: restoreAttemptId,
        providerOperationId: providerOperationId,
      );

  /// Attribution for a conversion event: Product attribution plus the
  /// Experiment tuple when this presentation is attributed to a Variant. Only
  /// the conversion events named by the v1-to-v2 migration contract may use it.
  MosaicAnalyticsAttribution forConversion(String mosaicProductId) =>
      MosaicAnalyticsAttribution(
        configurationReleaseId: attribution.configurationReleaseId,
        placementId: attribution.placementId,
        placementRuleSetId: attribution.placementRuleSetId,
        placementRuleSetVersion: attribution.placementRuleSetVersion,
        winningRuleId: attribution.winningRuleId,
        paywallId: attribution.paywallId,
        paywallVersionId: attribution.paywallVersionId,
        mosaicProductId: mosaicProductId,
        providerId: providerId,
        providerProductMappingId: providerProductMappingIds[mosaicProductId],
        experiment: experiment,
      );

  /// Product attribution without Experiment attribution, for the Product events
  /// that forbid the tuple.
  MosaicAnalyticsAttribution forProduct(String mosaicProductId) =>
      MosaicAnalyticsAttribution(
        configurationReleaseId: attribution.configurationReleaseId,
        placementId: attribution.placementId,
        placementRuleSetId: attribution.placementRuleSetId,
        placementRuleSetVersion: attribution.placementRuleSetVersion,
        winningRuleId: attribution.winningRuleId,
        paywallId: attribution.paywallId,
        paywallVersionId: attribution.paywallVersionId,
        mosaicProductId: mosaicProductId,
        providerId: providerId,
        providerProductMappingId: providerProductMappingIds[mosaicProductId],
      );
}
