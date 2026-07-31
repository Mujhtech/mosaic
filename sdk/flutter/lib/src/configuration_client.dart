import 'dart:async';
import 'dart:isolate';

import 'configuration_cache.dart';
import 'configuration_delivery.dart';
import 'configuration_transport.dart';
import 'presentation.dart';
import 'protocol.dart';

typedef MosaicBundledConfigurationLoader = Future<String?> Function();

enum MosaicConfigurationSource { remote, cache, bundledFallback }

final class MosaicAcceptedConfiguration {
  const MosaicAcceptedConfiguration({
    required this.envelope,
    required this.source,
    this.etag,
  });

  final MosaicConfigurationDeliveryEnvelope envelope;
  final MosaicConfigurationSource source;
  final String? etag;
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
        'supportedPaywallProtocols': <Map<String, Object?>>[
          <String, Object?>{
            'version': mosaicProtocolVersion,
            'capabilities': <Map<String, String>>[
              for (final capability
                  in mosaicProtocolV02Capabilities.toList()..sort())
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
    this.bundledFallbackLoader,
    this.onDiagnostic,
  }) : cacheNamespace =
            mosaicConfigurationCacheNamespace(baseUrl, publicSdkKey);

  final Uri baseUrl;
  final String publicSdkKey;
  final String? applicationVersion;
  final MosaicConfigurationTransport transport;
  final MosaicConfigurationCache cache;
  final Duration timeout;
  final MosaicBundledConfigurationLoader? bundledFallbackLoader;
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
        final configuration = MosaicAcceptedConfiguration(
          envelope: envelope,
          source: MosaicConfigurationSource.cache,
          etag: record.etag,
        );
        _accepted = configuration;
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
      final configuration = MosaicAcceptedConfiguration(
        envelope: envelope,
        source: MosaicConfigurationSource.bundledFallback,
      );
      _accepted = configuration;
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
    } on Object {
      return _retainOrUnavailable('configuration.refresh.releaseRejected');
    }
    try {
      await cache.write(
        cacheNamespace,
        MosaicConfigurationCacheEntry(
          etag: response.etag,
          releaseSource: response.source,
        ),
      );
    } on Object {
      return _retainOrUnavailable('configuration.cache.writeFailed');
    }
    final configuration = MosaicAcceptedConfiguration(
      envelope: envelope,
      source: MosaicConfigurationSource.remote,
      etag: response.etag,
    );
    _accepted = configuration;
    return MosaicConfigurationUpdated(configuration);
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
