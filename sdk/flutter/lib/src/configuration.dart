import 'package:flutter/foundation.dart';

import 'commerce.dart';
import 'commerce_configuration.dart';
import 'commerce_configuration_transport.dart';
import 'configuration_cache.dart';
import 'configuration_client.dart';
import 'configuration_transport.dart';
import 'presentation.dart';

/// Immutable settings captured when a Mosaic client is configured.
final class MosaicConfiguration {
  MosaicConfiguration({
    String? publicSdkKey,
    String? apiKey,
    Uri? baseUrl,
    Uri? endpoint,
    String? applicationVersion,
    String? applicationId,
    MosaicStorePlatform? storePlatform,
    this.requestTimeout = const Duration(seconds: 5),
  })  : publicSdkKey = _validateKey(publicSdkKey ?? apiKey),
        baseUrl = _validateBaseUrl(baseUrl ?? endpoint),
        applicationVersion = _validateApplicationVersion(applicationVersion),
        applicationId = applicationId == null
            ? null
            : _validateApplicationId(applicationId),
        storePlatform = storePlatform {
    if (requestTimeout <= Duration.zero ||
        requestTimeout > const Duration(seconds: 30)) {
      throw const MosaicConfigurationException(
        'requestTimeout must be between zero and 30 seconds.',
      );
    }
  }

  /// Environment-scoped public SDK key supplied by the host application.
  final String publicSdkKey;

  /// Compatibility alias for clients configured before hosted delivery.
  String get apiKey => publicSdkKey;

  /// Hosted or self-hosted Mosaic base URL.
  final Uri? baseUrl;

  /// Compatibility alias for the original configuration API.
  Uri? get endpoint => baseUrl;

  final String? applicationVersion;
  final String? applicationId;
  final MosaicStorePlatform? storePlatform;
  final Duration requestTimeout;

  static String _validateKey(String? value) {
    final normalized = value?.trim() ?? '';
    if (normalized.isEmpty) {
      throw const MosaicConfigurationException(
        'publicSdkKey must not be empty.',
      );
    }
    return normalized;
  }

  static Uri? _validateBaseUrl(Uri? value) {
    if (value == null) return null;
    final validScheme = value.scheme == 'https' ||
        value.scheme == 'http' && _isLocalDevelopmentHost(value.host);
    if (!validScheme ||
        value.host.isEmpty ||
        value.userInfo.isNotEmpty ||
        value.hasQuery ||
        value.hasFragment) {
      throw const MosaicConfigurationException(
        'baseUrl must be HTTPS, or local-development HTTP, without credentials, query, or fragment.',
      );
    }
    return value;
  }

  static String? _validateApplicationVersion(String? value) {
    if (value == null) return null;
    if (value.isEmpty ||
        value.length > 64 ||
        value.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
      throw const MosaicConfigurationException(
        'applicationVersion is invalid.',
      );
    }
    return value;
  }

  static String _validateApplicationId(String value) {
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$').hasMatch(value)) {
      throw const MosaicConfigurationException(
        'applicationId is invalid.',
      );
    }
    return value;
  }

  static bool _isLocalDevelopmentHost(String host) {
    final normalized = host.toLowerCase();
    if (normalized == 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized == '::1') {
      return true;
    }
    final octets = normalized.split('.').map(int.tryParse).toList();
    if (octets.length != 4 || octets.any((value) => value == null)) {
      return false;
    }
    final values = octets.cast<int>();
    if (values.any((value) => value < 0 || value > 255)) return false;
    return values[0] == 127 ||
        values[0] == 10 ||
        values[0] == 192 && values[1] == 168 ||
        values[0] == 172 && values[1] >= 16 && values[1] <= 31;
  }
}

/// An isolated Mosaic SDK client with cache-first hosted configuration state.
final class Mosaic extends ChangeNotifier {
  Mosaic._({
    required this.configuration,
    required this.purchaseProvider,
    required MosaicConfigurationClient? configurationClient,
  }) : _configurationClient = configurationClient;

  factory Mosaic.configure({
    String? publicSdkKey,
    String? apiKey,
    Uri? baseUrl,
    Uri? endpoint,
    String? applicationVersion,
    String? applicationId,
    MosaicStorePlatform? storePlatform,
    Duration requestTimeout = const Duration(seconds: 5),
    MosaicPurchaseProvider? purchaseProvider,
    Iterable<MosaicCommerceProviderFactory> commerceProviderFactories =
        const <MosaicCommerceProviderFactory>[],
    MosaicConfigurationTransport transport =
        const MosaicIoConfigurationTransport(),
    MosaicConfigurationCache cache = const MosaicFileConfigurationCache(),
    MosaicBundledConfigurationLoader? bundledFallbackLoader,
    MosaicCommerceConfigurationLoader? commerceConfigurationLoader,
    MosaicCommerceConfigurationTransport? commerceConfigurationTransport,
    MosaicCommerceConfigurationLoader? bundledCommerceConfigurationLoader,
    MosaicDiagnosticCallback? onDiagnostic,
  }) {
    final factories = commerceProviderFactories.toList(growable: false);
    final router = factories.isEmpty
        ? null
        : MosaicCommerceProviderRouter(
            factories: factories,
            fallbackProvider: purchaseProvider,
          );
    final resolvedPurchaseProvider = router ?? purchaseProvider;
    if (resolvedPurchaseProvider == null) {
      throw const MosaicConfigurationException(
        'A purchase Provider or commerce Provider factory is required.',
      );
    }
    final configuration = MosaicConfiguration(
      publicSdkKey: publicSdkKey,
      apiKey: apiKey,
      baseUrl: baseUrl,
      endpoint: endpoint,
      applicationVersion: applicationVersion,
      applicationId: applicationId,
      storePlatform: storePlatform,
      requestTimeout: requestTimeout,
    );
    final resolvedBaseUrl = configuration.baseUrl;
    final resolvedCommerceTransport = commerceConfigurationTransport ??
        (commerceConfigurationLoader == null &&
                resolvedBaseUrl != null &&
                configuration.applicationId != null &&
                configuration.storePlatform != null
            ? MosaicIoCommerceConfigurationLoader(
                baseUrl: resolvedBaseUrl,
                publicSdkKey: configuration.publicSdkKey,
                applicationId: configuration.applicationId!,
                storePlatform: configuration.storePlatform!,
                timeout: configuration.requestTimeout,
              )
            : null);
    return Mosaic._(
      configuration: configuration,
      purchaseProvider: resolvedPurchaseProvider,
      configurationClient: resolvedBaseUrl == null
          ? null
          : MosaicConfigurationClient(
              baseUrl: resolvedBaseUrl,
              publicSdkKey: configuration.publicSdkKey,
              applicationVersion: configuration.applicationVersion,
              applicationId: configuration.applicationId,
              storePlatform: configuration.storePlatform,
              transport: transport,
              cache: cache,
              timeout: configuration.requestTimeout,
              bundledFallbackLoader: bundledFallbackLoader,
              commerceConfigurationLoader: commerceConfigurationLoader,
              commerceConfigurationTransport: resolvedCommerceTransport,
              bundledCommerceConfigurationLoader:
                  bundledCommerceConfigurationLoader,
              onAcceptedConfiguration: router == null
                  ? null
                  : (accepted) {
                      final commerce = accepted.commerceEnvelope?.configuration;
                      if (commerce == null) {
                        router.deactivate();
                        return;
                      }
                      router.activate(
                        commerceConfiguration: commerce,
                        configurationRelease: accepted.envelope.release,
                      );
                    },
              onDiagnostic: onDiagnostic,
            ),
    );
  }

  final MosaicConfiguration configuration;
  final MosaicPurchaseProvider purchaseProvider;
  final MosaicConfigurationClient? _configurationClient;

  MosaicAcceptedConfiguration? get acceptedConfiguration =>
      _configurationClient?.accepted;

  MosaicCommerceConfiguration? get acceptedCommerceConfiguration =>
      acceptedConfiguration?.commerceEnvelope?.configuration;

  MosaicConfigurationCapabilityRequest get capabilityRequest =>
      MosaicConfigurationCapabilityRequest(
        applicationVersion: configuration.applicationVersion,
      );

  /// Loads the last-known-valid cache, then the bundled Delivery v1 fallback.
  /// This method never performs networking.
  Future<MosaicConfigurationLoadResult> loadConfiguration() async {
    final client = _configurationClient;
    if (client == null) {
      return const MosaicConfigurationUnavailable(
        diagnosticCode: 'configuration.baseUrl.missing',
      );
    }
    final previous = client.accepted;
    final result = await client.load();
    if (!identical(previous, client.accepted)) notifyListeners();
    return result;
  }

  /// Manually refreshes hosted configuration. Concurrent callers coalesce.
  Future<MosaicConfigurationRefreshResult> refreshConfiguration() async {
    final client = _configurationClient;
    if (client == null) {
      return const MosaicConfigurationRefreshUnavailable(
        diagnosticCode: 'configuration.baseUrl.missing',
      );
    }
    final previous = client.accepted;
    final result = await client.refresh();
    if (!identical(previous, client.accepted)) notifyListeners();
    return result;
  }
}

final class MosaicConfigurationException implements Exception {
  const MosaicConfigurationException(this.message);

  final String message;

  @override
  String toString() => 'MosaicConfigurationException: $message';
}
