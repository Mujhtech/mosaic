import 'commerce.dart';

/// Immutable settings captured when a Mosaic client is configured.
final class MosaicConfiguration {
  MosaicConfiguration({required String apiKey, Uri? endpoint})
      : apiKey = _validateApiKey(apiKey),
        endpoint = _validateEndpoint(endpoint);

  /// Public SDK key supplied by the host application.
  final String apiKey;

  /// Optional endpoint override for local development or self-hosting.
  ///
  /// Phase 0 deliberately does not select a hosted production URL.
  final Uri? endpoint;

  static String _validateApiKey(String value) {
    final normalized = value.trim();
    if (normalized.isEmpty) {
      throw const MosaicConfigurationException('apiKey must not be empty.');
    }
    return normalized;
  }

  static Uri? _validateEndpoint(Uri? value) {
    if (value == null) {
      return null;
    }
    if ((value.scheme != 'http' && value.scheme != 'https') ||
        value.host.isEmpty) {
      throw const MosaicConfigurationException(
        'endpoint must be an absolute HTTP or HTTPS URI.',
      );
    }
    return value;
  }
}

/// A configured Mosaic SDK handle.
///
/// Networking, caching, placements, and rendering are intentionally deferred
/// beyond Phase 0.
final class Mosaic {
  const Mosaic._({
    required this.configuration,
    required this.purchaseProvider,
  });

  /// Creates an isolated configured client without installing global state.
  factory Mosaic.configure({
    required String apiKey,
    required MosaicPurchaseProvider purchaseProvider,
    Uri? endpoint,
  }) {
    return Mosaic._(
      configuration: MosaicConfiguration(apiKey: apiKey, endpoint: endpoint),
      purchaseProvider: purchaseProvider,
    );
  }

  final MosaicConfiguration configuration;
  final MosaicPurchaseProvider purchaseProvider;
}

final class MosaicConfigurationException implements Exception {
  const MosaicConfigurationException(this.message);

  final String message;

  @override
  String toString() => 'MosaicConfigurationException: $message';
}
