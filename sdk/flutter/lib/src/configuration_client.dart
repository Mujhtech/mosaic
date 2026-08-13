import 'dart:async';
import 'dart:isolate';

import 'commerce_configuration.dart';
import 'commerce_configuration_transport.dart';
import 'configuration_cache.dart';
import 'configuration_delivery.dart';
import 'configuration_transport.dart';
import 'placement_decision.dart';
import 'presentation.dart';
import 'protocol.dart';

typedef MosaicBundledConfigurationLoader = Future<String?> Function();
typedef MosaicCommerceConfigurationLoader = Future<String?> Function(
  MosaicConfigurationRelease release,
);
typedef MosaicAcceptedConfigurationCallback = void Function(
  MosaicAcceptedConfiguration configuration,
);

enum MosaicConfigurationSource { remote, cache, bundledFallback }

final class MosaicAcceptedConfiguration {
  MosaicAcceptedConfiguration({
    required this.envelope,
    required this.source,
    this.etag,
    this.commerceEnvelope,
    this.commerceSource,
    this.commerceEtag,
    this.trustedServerTime,
    this.localReceiptTime,
  })  : _trustedAtConstruction = trustedServerTime == null ||
                localReceiptTime == null
            ? null
            : trustedServerTime.toUtc().add(
                  DateTime.now().toUtc().difference(localReceiptTime.toUtc()),
                ),
        _trustedElapsed = Stopwatch()..start();

  final MosaicConfigurationDeliveryEnvelope envelope;
  final MosaicConfigurationSource source;
  final String? etag;
  final MosaicCommerceConfigurationEnvelope? commerceEnvelope;
  final String? commerceSource;
  final String? commerceEtag;
  final DateTime? trustedServerTime;
  final DateTime? localReceiptTime;
  final DateTime? _trustedAtConstruction;
  final Stopwatch _trustedElapsed;

  /// Conservative in-process trusted time. Cached and bundled snapshots do
  /// not manufacture a new server-time anchor after restart.
  DateTime? get trustedNow {
    final trusted = _trustedAtConstruction;
    final received = localReceiptTime;
    if (trusted == null ||
        received == null ||
        DateTime.now().toUtc().difference(received).isNegative ||
        DateTime.now().toUtc().difference(received) > const Duration(days: 7)) {
      return null;
    }
    return trusted.add(_trustedElapsed.elapsed);
  }
}

sealed class MosaicConfigurationLoadResult {
  const MosaicConfigurationLoadResult();
}

final class MosaicConfigurationReady extends MosaicConfigurationLoadResult {
  const MosaicConfigurationReady(this.configuration);

  final MosaicAcceptedConfiguration configuration;
}

final class MosaicConfigurationUnavailable
    extends MosaicConfigurationLoadResult {
  const MosaicConfigurationUnavailable({required this.diagnosticCode});

  final String diagnosticCode;
}

sealed class MosaicConfigurationRefreshResult {
  const MosaicConfigurationRefreshResult();
}

final class MosaicConfigurationUpdated
    extends MosaicConfigurationRefreshResult {
  const MosaicConfigurationUpdated(this.configuration);

  final MosaicAcceptedConfiguration configuration;
}

final class MosaicConfigurationNotModified
    extends MosaicConfigurationRefreshResult {
  const MosaicConfigurationNotModified(this.configuration);

  final MosaicAcceptedConfiguration configuration;
}

final class MosaicConfigurationRetained
    extends MosaicConfigurationRefreshResult {
  const MosaicConfigurationRetained({
    required this.configuration,
    required this.diagnosticCode,
  });

  final MosaicAcceptedConfiguration configuration;
  final String diagnosticCode;
}

final class MosaicConfigurationRefreshUnavailable
    extends MosaicConfigurationRefreshResult {
  const MosaicConfigurationRefreshUnavailable({required this.diagnosticCode});

  final String diagnosticCode;
}

final class MosaicConfigurationCapabilityRequest {
  const MosaicConfigurationCapabilityRequest({this.applicationVersion});

  final String? applicationVersion;

  Map<String, Object?> toJson() => <String, Object?>{
        'platform': 'flutter',
        'sdkVersion': mosaicFlutterSdkVersion,
        'supportedConfigurationDeliveryVersions': const <String>[
          mosaicConfigurationDeliveryVersion,
        ],
        'supportedPlacementDecisionContracts': const <String>[
          mosaicPlacementDecisionVersion,
        ],
        'supportedDecisionFeatures': (mosaicDecisionFeatures.toList()..sort()),
        'supportedBucketingAlgorithms': const <String>[
          mosaicRolloutAlgorithm,
        ],
        'supportedExperimentAssignmentContracts': const <String>['1'],
        'supportedExperimentFeatures': const <String>[
          'allocation.ranges',
          'assignment.installation',
          'assignment.identified_user',
          'assignment.identified_user_or_installation',
          'fallback.normal_placement',
          'group.mutual_exclusion',
          'override.qa',
          'schedule.trusted_server_time',
        ],
        'supportedExperimentBucketingAlgorithms': const <String>[
          'experiment_sha256_length_prefixed_v1',
          'experiment_group_sha256_length_prefixed_v1',
        ],
        'supportedExperimentSchedulePolicies': const <String>[
          'trusted_server_time_v1',
        ],
        'supportedPaywallProtocols': <Map<String, Object?>>[
          <String, Object?>{
            'version': mosaicProtocolVersion,
            'capabilities': <Map<String, String>>[
              for (final capability
                  in mosaicProtocolCapabilities.toList()..sort())
                <String, String>{
                  'name': capability,
                  'version': mosaicProtocolVersion,
                },
            ],
          },
        ],
        if (applicationVersion != null)
          'applicationVersion': applicationVersion!,
      };
}

/// Cache-first hosted configuration state machine.
///
/// Presentation reads [accepted] and never performs networking. Manual
/// refreshes coalesce and replace state only after complete validation and an
/// atomic cache commit.
final class MosaicConfigurationClient {
  MosaicConfigurationClient({
    required this.baseUrl,
    required this.publicSdkKey,
    required this.transport,
    required this.cache,
    required this.timeout,
    this.applicationVersion,
    this.applicationId,
    this.storePlatform,
    this.bundledFallbackLoader,
    this.commerceConfigurationLoader,
    this.commerceConfigurationTransport,
    this.bundledCommerceConfigurationLoader,
    this.onAcceptedConfiguration,
    this.onDiagnostic,
  }) : cacheNamespace =
            mosaicConfigurationCacheNamespace(baseUrl, publicSdkKey) {
    if ((commerceConfigurationLoader != null ||
            commerceConfigurationTransport != null ||
            bundledCommerceConfigurationLoader != null) &&
        (applicationId == null || storePlatform == null)) {
      throw ArgumentError(
        'applicationId and storePlatform are required for Commerce Configuration.',
      );
    }
    if (commerceConfigurationLoader != null &&
        commerceConfigurationTransport != null) {
      throw ArgumentError(
        'Use either a Commerce Configuration loader or transport, not both.',
      );
    }
  }

  final Uri baseUrl;
  final String publicSdkKey;
  final String? applicationVersion;
  final String? applicationId;
  final MosaicStorePlatform? storePlatform;
  final MosaicConfigurationTransport transport;
  final MosaicConfigurationCache cache;
  final Duration timeout;
  final MosaicBundledConfigurationLoader? bundledFallbackLoader;
  final MosaicCommerceConfigurationLoader? commerceConfigurationLoader;
  final MosaicCommerceConfigurationTransport? commerceConfigurationTransport;
  final MosaicCommerceConfigurationLoader? bundledCommerceConfigurationLoader;
  final MosaicAcceptedConfigurationCallback? onAcceptedConfiguration;
  final MosaicDiagnosticCallback? onDiagnostic;
  final String cacheNamespace;

  MosaicAcceptedConfiguration? _accepted;
  Future<MosaicConfigurationLoadResult>? _loadOperation;
  Future<MosaicConfigurationRefreshResult>? _refreshOperation;

  MosaicAcceptedConfiguration? get accepted => _accepted;

  MosaicConfigurationCapabilityRequest get capabilityRequest =>
      MosaicConfigurationCapabilityRequest(
        applicationVersion: applicationVersion,
      );

  Future<MosaicConfigurationLoadResult> load() {
    final accepted = _accepted;
    if (accepted != null) {
      return Future<MosaicConfigurationLoadResult>.value(
        MosaicConfigurationReady(accepted),
      );
    }
    return _loadOperation ??= _load().whenComplete(() {
      _loadOperation = null;
    });
  }

  Future<MosaicConfigurationLoadResult> _load() async {
    try {
      final record = await cache.read(cacheNamespace);
      if (record != null) {
        final envelope = await _decode(record.releaseSource);
        final commerceEnvelope = await _decodeCommerceIfRequired(
          record.commerceConfigurationSource,
          envelope.release,
          required: _requiresRemoteCommerce,
        );
        final commerceEtag = _validatedCommerceEtag(
          record.commerceConfigurationEtag,
          commerceEnvelope,
        );
        final configuration = MosaicAcceptedConfiguration(
          envelope: envelope,
          source: MosaicConfigurationSource.cache,
          etag: record.etag,
          commerceEnvelope: commerceEnvelope,
          commerceSource: record.commerceConfigurationSource,
          commerceEtag: commerceEtag,
          trustedServerTime: record.trustedServerTime,
          localReceiptTime: record.localReceiptTime,
        );
        _accept(configuration);
        return MosaicConfigurationReady(configuration);
      }
    } on Object {
      _diagnose(
        'configuration.cache.rejected',
        'The cached configuration was unavailable or invalid.',
      );
    }
    return _loadBundle();
  }

  Future<MosaicConfigurationLoadResult> _loadBundle() async {
    final loader = bundledFallbackLoader;
    if (loader == null) {
      return _unavailable('configuration.bundledFallback.missing');
    }
    try {
      final source = await loader();
      if (source == null) {
        return _unavailable('configuration.bundledFallback.missing');
      }
      final envelope = await _decode(source);
      final commerceSource =
          await bundledCommerceConfigurationLoader?.call(envelope.release);
      final commerceEnvelope = await _decodeCommerceIfRequired(
        commerceSource,
        envelope.release,
        required: bundledCommerceConfigurationLoader != null,
      );
      final configuration = MosaicAcceptedConfiguration(
        envelope: envelope,
        source: MosaicConfigurationSource.bundledFallback,
        commerceEnvelope: commerceEnvelope,
        commerceSource: commerceSource,
      );
      _accept(configuration);
      return MosaicConfigurationReady(configuration);
    } on Object {
      return _unavailable('configuration.bundledFallback.rejected');
    }
  }

  MosaicConfigurationUnavailable _unavailable(String code) {
    _diagnose(
      code,
      'No valid Mosaic configuration is available.',
      severity: MosaicDiagnosticSeverity.error,
    );
    return MosaicConfigurationUnavailable(diagnosticCode: code);
  }

  Future<MosaicConfigurationRefreshResult> refresh() {
    return _refreshOperation ??= _refresh().whenComplete(() {
      _refreshOperation = null;
    });
  }

  Future<MosaicConfigurationRefreshResult> _refresh() async {
    await load();
    final response = await transport.fetch(
      MosaicConfigurationRequest(
        baseUrl: baseUrl,
        publicSdkKey: publicSdkKey,
        applicationVersion: applicationVersion,
        timeout: timeout,
        etag: _accepted?.etag,
      ),
    );
    switch (response) {
      case MosaicConfigurationUpdatedResponse():
        return _acceptRemote(response);
      case MosaicConfigurationNotModifiedResponse():
        return _notModified();
      case MosaicConfigurationFailedResponse():
        return _retainOrUnavailable(response.diagnosticCode);
    }
  }

  Future<MosaicConfigurationRefreshResult> _acceptRemote(
    MosaicConfigurationUpdatedResponse response,
  ) async {
    final MosaicConfigurationDeliveryEnvelope envelope;
    final String? commerceSource;
    final String? commerceEtag;
    final MosaicCommerceConfigurationEnvelope? commerceEnvelope;
    try {
      envelope = await _decode(response.source);
      final current = _accepted;
      if (current != null &&
          current.source != MosaicConfigurationSource.bundledFallback &&
          current.envelope.release.environment.id !=
              envelope.release.environment.id) {
        throw const MosaicConfigurationDeliveryException(
          'The release belongs to another Environment.',
        );
      }
      if (current != null &&
          current.source != MosaicConfigurationSource.bundledFallback &&
          envelope.release.number < current.envelope.release.number) {
        throw const MosaicConfigurationDeliveryException(
          'The release is older than the last accepted release.',
        );
      }
      final commerce = await _loadRemoteCommerce(envelope.release, current);
      commerceSource = commerce.source;
      commerceEtag = commerce.etag;
      commerceEnvelope = commerce.envelope;
    } on Object {
      return _retainOrUnavailable(
        'configuration.refresh.releaseOrCommerceRejected',
      );
    }
    // A release's publish time is an authoring fact, not an observation of the
    // current server clock. Substituting it would anchor countdowns, freshness,
    // and QA windows to a moment that may be days old while presenting it as
    // trusted, so an absent server time yields no anchor.
    final serverTime = response.serverTime;
    try {
      final receivedAt = DateTime.now().toUtc();
      if (serverTime == null) {
        _diagnose(
          'configuration.serverTime.absent',
          'The configuration response carried no server time; time-dependent '
              'behaviour runs without a trusted clock.',
        );
      }
      await cache.write(
        cacheNamespace,
        MosaicConfigurationCacheEntry(
          etag: response.etag,
          releaseSource: response.source,
          commerceConfigurationSource: commerceSource,
          commerceConfigurationEtag: commerceEtag,
          trustedServerTime: serverTime,
          localReceiptTime: receivedAt,
        ),
      );
    } on Object {
      return _retainOrUnavailable('configuration.cache.writeFailed');
    }
    final configuration = MosaicAcceptedConfiguration(
      envelope: envelope,
      source: MosaicConfigurationSource.remote,
      etag: response.etag,
      commerceEnvelope: commerceEnvelope,
      commerceSource: commerceSource,
      commerceEtag: commerceEtag,
      trustedServerTime: serverTime,
      localReceiptTime: DateTime.now().toUtc(),
    );
    _accept(configuration);
    return MosaicConfigurationUpdated(configuration);
  }

  Future<MosaicCommerceConfigurationEnvelope?> _decodeCommerceIfRequired(
    String? source,
    MosaicConfigurationRelease release, {
    required bool required,
  }) async {
    if (source == null) {
      if (required) {
        throw const MosaicCommerceConfigurationException(
          'The release-associated commerce configuration is missing.',
        );
      }
      return null;
    }
    if (applicationId == null || storePlatform == null) {
      return null;
    }
    return _decodeCommerce(
      source,
      release,
      applicationId!,
      storePlatform!,
    );
  }

  bool get _requiresRemoteCommerce =>
      commerceConfigurationLoader != null ||
      commerceConfigurationTransport != null;

  Future<
      ({
        String? source,
        String? etag,
        MosaicCommerceConfigurationEnvelope? envelope,
      })> _loadRemoteCommerce(
    MosaicConfigurationRelease release,
    MosaicAcceptedConfiguration? current,
  ) async {
    final hostedTransport = commerceConfigurationTransport;
    if (hostedTransport == null) {
      final source = await commerceConfigurationLoader?.call(release);
      return (
        source: source,
        etag: null,
        envelope: await _decodeCommerceIfRequired(
          source,
          release,
          required: commerceConfigurationLoader != null,
        ),
      );
    }
    final retained = current != null &&
            current.envelope.release.id == release.id &&
            current.commerceSource != null &&
            current.commerceEtag != null
        ? MosaicRetainedCommerceConfiguration(
            source: current.commerceSource!,
            etag: current.commerceEtag!,
          )
        : null;
    final response = await hostedTransport.fetch(
      MosaicCommerceConfigurationRequest(
        release: release,
        retained: retained,
      ),
    );
    switch (response) {
      case MosaicCommerceConfigurationUpdatedResponse():
        final envelope = await _decodeCommerceIfRequired(
          response.source,
          release,
          required: true,
        );
        if (_validatedCommerceEtag(response.etag, envelope) == null) {
          throw const MosaicCommerceConfigurationException(
            'The Commerce Configuration ETag does not match its content.',
          );
        }
        return (
          source: response.source,
          etag: response.etag,
          envelope: envelope,
        );
      case MosaicCommerceConfigurationNotModifiedResponse():
        if (retained == null || current?.commerceEnvelope == null) {
          throw const MosaicCommerceConfigurationException(
            'A Commerce Configuration 304 has no valid retained pair.',
          );
        }
        return (
          source: retained.source,
          etag: retained.etag,
          envelope: current!.commerceEnvelope,
        );
      case MosaicCommerceConfigurationFailedResponse():
        throw const MosaicCommerceConfigurationException(
          'The Commerce Configuration request failed.',
        );
    }
  }

  String? _validatedCommerceEtag(
    String? etag,
    MosaicCommerceConfigurationEnvelope? envelope,
  ) {
    if (etag == null || envelope == null) return null;
    final expected = '"${envelope.configuration.contentDigest}"';
    return etag == expected ? etag : null;
  }

  void _accept(MosaicAcceptedConfiguration configuration) {
    _accepted = configuration;
    try {
      onAcceptedConfiguration?.call(configuration);
    } on Object {
      _diagnose(
        'commerce.provider.activationFailed',
        'The accepted commerce Provider could not be activated.',
        severity: MosaicDiagnosticSeverity.error,
      );
    }
  }

  MosaicConfigurationRefreshResult _notModified() {
    final accepted = _accepted;
    if (accepted == null || accepted.etag == null) {
      return _retainOrUnavailable('configuration.refresh.unexpected304');
    }
    return MosaicConfigurationNotModified(accepted);
  }

  MosaicConfigurationRefreshResult _retainOrUnavailable(String code) {
    final accepted = _accepted;
    _diagnose(code, 'The last accepted Mosaic configuration was preserved.');
    return accepted == null
        ? MosaicConfigurationRefreshUnavailable(diagnosticCode: code)
        : MosaicConfigurationRetained(
            configuration: accepted,
            diagnosticCode: code,
          );
  }

  void _diagnose(
    String code,
    String message, {
    MosaicDiagnosticSeverity severity = MosaicDiagnosticSeverity.warning,
  }) {
    onDiagnostic?.call(
      MosaicDiagnostic(code: code, message: message, severity: severity),
    );
  }
}

Future<MosaicConfigurationDeliveryEnvelope> _decode(String source) =>
    Isolate.run(
      () => const MosaicConfigurationDeliveryDecoder().decode(source),
    );

Future<MosaicCommerceConfigurationEnvelope> _decodeCommerce(
  String source,
  MosaicConfigurationRelease release,
  String applicationId,
  MosaicStorePlatform storePlatform,
) =>
    Isolate.run(
      () => const MosaicCommerceConfigurationDecoder().decode(
        source,
        expectedRelease: release,
        expectedApplicationId: applicationId,
        expectedStorePlatform: storePlatform,
      ),
    );
