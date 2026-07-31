import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'configuration_cache.dart';
import 'configuration_delivery.dart';
import 'protocol.dart';

final class MosaicConfigurationRequest {
  const MosaicConfigurationRequest({
    required this.baseUrl,
    required this.publicSdkKey,
    required this.timeout,
    this.applicationVersion,
    this.etag,
  });

  final Uri baseUrl;
  final String publicSdkKey;
  final Duration timeout;
  final String? applicationVersion;
  final String? etag;
}

sealed class MosaicConfigurationResponse {
  const MosaicConfigurationResponse();
}

final class MosaicConfigurationUpdatedResponse
    extends MosaicConfigurationResponse {
  const MosaicConfigurationUpdatedResponse({
    required this.source,
    required this.etag,
  });

  final String source;
  final String etag;
}

final class MosaicConfigurationNotModifiedResponse
    extends MosaicConfigurationResponse {
  const MosaicConfigurationNotModifiedResponse();
}

final class MosaicConfigurationFailedResponse
    extends MosaicConfigurationResponse {
  const MosaicConfigurationFailedResponse({required this.diagnosticCode});

  final String diagnosticCode;
}

abstract interface class MosaicConfigurationTransport {
  Future<MosaicConfigurationResponse> fetch(MosaicConfigurationRequest request);
}

typedef MosaicHttpClientFactory = HttpClient Function();

HttpClient _newHttpClient() => HttpClient();

final String mosaicPaywallCapabilitiesHeaderValue =
    mosaicProtocolV02Capabilities
        .map((capability) => '$capability@$mosaicProtocolVersion')
        .join(',');

/// Native HTTP transport for the Environment-scoped public SDK endpoint.
final class MosaicIoConfigurationTransport
    implements MosaicConfigurationTransport {
  const MosaicIoConfigurationTransport({
    MosaicHttpClientFactory clientFactory = _newHttpClient,
  }) : _clientFactory = clientFactory;

  final MosaicHttpClientFactory _clientFactory;

  @override
  Future<MosaicConfigurationResponse> fetch(
    MosaicConfigurationRequest request,
  ) async {
    final client = _clientFactory()
      ..connectionTimeout = request.timeout
      ..autoUncompress = true;
    try {
      final operation = _fetch(client, request);
      return await operation.timeout(request.timeout);
    } on TimeoutException {
      return const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.timeout',
      );
    } on Object {
      return const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.networkFailed',
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<MosaicConfigurationResponse> _fetch(
    HttpClient client,
    MosaicConfigurationRequest request,
  ) async {
    final endpoint = _configurationEndpoint(request.baseUrl);
    final outgoing = await client.getUrl(endpoint);
    outgoing
      ..followRedirects = false
      ..headers.set(
          HttpHeaders.authorizationHeader, 'Bearer ${request.publicSdkKey}')
      ..headers.set(HttpHeaders.acceptHeader, _deliveryContentType)
      ..headers.set(HttpHeaders.acceptEncodingHeader, 'gzip')
      ..headers.set('Mosaic-SDK-Platform', 'flutter')
      ..headers.set('Mosaic-SDK-Version', mosaicFlutterSdkVersion)
      ..headers.set(
        'Mosaic-Configuration-Versions',
        mosaicConfigurationDeliveryVersion,
      )
      ..headers.set('Mosaic-Paywall-Protocol-Versions', mosaicProtocolVersion)
      ..headers.set(
        'Mosaic-Paywall-Capabilities',
        mosaicPaywallCapabilitiesHeaderValue,
      );
    if (request.applicationVersion case final version?) {
      outgoing.headers.set('Mosaic-App-Version', version);
    }
    if (request.etag case final etag?) {
      outgoing.headers.set(HttpHeaders.ifNoneMatchHeader, etag);
    }

    final response = await outgoing.close();
    if (response.isRedirect) {
      return const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.redirectRejected',
      );
    }
    if (response.statusCode == HttpStatus.notModified) {
      return const MosaicConfigurationNotModifiedResponse();
    }
    if (response.statusCode != HttpStatus.ok) {
      return MosaicConfigurationFailedResponse(
        diagnosticCode: switch (response.statusCode) {
          HttpStatus.unauthorized ||
          HttpStatus.forbidden =>
            'configuration.refresh.unauthorized',
          HttpStatus.tooManyRequests => 'configuration.refresh.rateLimited',
          _ => 'configuration.refresh.httpFailed',
        },
      );
    }
    final etag = response.headers.value(HttpHeaders.etagHeader);
    if (etag == null || !mosaicIsStrongEtag(etag)) {
      return const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.invalidEtag',
      );
    }
    final contentType = response.headers.contentType;
    if (contentType == null ||
        contentType.mimeType != 'application/vnd.mosaic.configuration+json' ||
        contentType.parameters['version'] !=
            mosaicConfigurationDeliveryVersion) {
      return const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.invalidContentType',
      );
    }
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > mosaicMaximumConfigurationBytes) {
        return const MosaicConfigurationFailedResponse(
          diagnosticCode: 'configuration.refresh.responseTooLarge',
        );
      }
    }
    final String source;
    try {
      source = utf8.decode(bytes);
    } on FormatException {
      return const MosaicConfigurationFailedResponse(
        diagnosticCode: 'configuration.refresh.invalidEncoding',
      );
    }
    return MosaicConfigurationUpdatedResponse(source: source, etag: etag);
  }
}

Uri _configurationEndpoint(Uri baseUrl) {
  final path = baseUrl.path.endsWith('/') ? baseUrl.path : '${baseUrl.path}/';
  return baseUrl.replace(path: path).resolve('v1/sdk/configuration');
}

const String _deliveryContentType =
    'application/vnd.mosaic.configuration+json;version=1';
