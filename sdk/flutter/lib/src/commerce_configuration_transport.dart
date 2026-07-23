import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'commerce_configuration.dart';
import 'configuration_delivery.dart';
import 'configuration_transport.dart';
import 'protocol.dart';

const String mosaicCommerceProviderContractVersion = '1';
const String mosaicCommerceConfigurationContentType =
    'application/vnd.mosaic.commerce-configuration+json;version=1';

final class MosaicRetainedCommerceConfiguration {
  const MosaicRetainedCommerceConfiguration({
    required this.source,
    required this.etag,
  });

  final String source;
  final String etag;
}

final class MosaicCommerceConfigurationRequest {
  const MosaicCommerceConfigurationRequest({
    required this.release,
    this.retained,
  });

  final MosaicConfigurationRelease release;
  final MosaicRetainedCommerceConfiguration? retained;
}

sealed class MosaicCommerceConfigurationResponse {
  const MosaicCommerceConfigurationResponse();
}

final class MosaicCommerceConfigurationUpdatedResponse
    extends MosaicCommerceConfigurationResponse {
  const MosaicCommerceConfigurationUpdatedResponse({
    required this.source,
    required this.etag,
  });

  final String source;
  final String etag;
}

final class MosaicCommerceConfigurationNotModifiedResponse
    extends MosaicCommerceConfigurationResponse {
  const MosaicCommerceConfigurationNotModifiedResponse();
}

final class MosaicCommerceConfigurationFailedResponse
    extends MosaicCommerceConfigurationResponse {
  const MosaicCommerceConfigurationFailedResponse();
}

abstract interface class MosaicCommerceConfigurationTransport {
  Future<MosaicCommerceConfigurationResponse> fetch(
    MosaicCommerceConfigurationRequest request,
  );
}

/// Default hosted transport for the frozen Commerce Configuration v1 route.
final class MosaicIoCommerceConfigurationLoader
    implements MosaicCommerceConfigurationTransport {
  const MosaicIoCommerceConfigurationLoader({
    required this.baseUrl,
    required this.publicSdkKey,
    required this.applicationId,
    required this.storePlatform,
    required this.timeout,
    MosaicHttpClientFactory clientFactory = _newCommerceHttpClient,
  }) : _clientFactory = clientFactory;

  final Uri baseUrl;
  final String publicSdkKey;
  final String applicationId;
  final MosaicStorePlatform storePlatform;
  final Duration timeout;
  final MosaicHttpClientFactory _clientFactory;

  @override
  Future<MosaicCommerceConfigurationResponse> fetch(
    MosaicCommerceConfigurationRequest request,
  ) async {
    final client = _clientFactory()
      ..connectionTimeout = timeout
      ..autoUncompress = true;
    try {
      return await _fetch(client, request).timeout(timeout);
    } on Object {
      return const MosaicCommerceConfigurationFailedResponse();
    } finally {
      client.close(force: true);
    }
  }

  Future<MosaicCommerceConfigurationResponse> _fetch(
    HttpClient client,
    MosaicCommerceConfigurationRequest request,
  ) async {
    final retained = _validatedRetained(request);
    final path = baseUrl.path.endsWith('/') ? baseUrl.path : '${baseUrl.path}/';
    final endpoint = baseUrl
        .replace(path: path)
        .resolve('v1/sdk/commerce-configuration')
        .replace(queryParameters: <String, String>{
      'applicationId': applicationId,
    });
    final httpRequest = await client.getUrl(endpoint);
    httpRequest
      ..followRedirects = false
      ..headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer $publicSdkKey',
      )
      ..headers
          .set(HttpHeaders.acceptHeader, mosaicCommerceConfigurationContentType)
      ..headers.set(HttpHeaders.acceptEncodingHeader, 'gzip')
      ..headers.set('Mosaic-SDK-Platform', 'flutter')
      ..headers.set('Mosaic-SDK-Version', mosaicFlutterSdkVersion)
      ..headers.set(
        'Mosaic-Commerce-Configuration-Versions',
        mosaicCommerceConfigurationVersion,
      )
      ..headers.set(
        'Mosaic-Commerce-Provider-Contract-Versions',
        mosaicCommerceProviderContractVersion,
      );
    if (retained != null) {
      httpRequest.headers.set(HttpHeaders.ifNoneMatchHeader, retained.etag);
    }
    final response = await httpRequest.close();
    if (response.isRedirect) {
      return const MosaicCommerceConfigurationFailedResponse();
    }
    if (response.statusCode == HttpStatus.notModified) {
      final responseEtag = response.headers.value(HttpHeaders.etagHeader);
      final responseReleaseId =
          response.headers.value('Mosaic-Configuration-Release-Id');
      return retained == null ||
              responseEtag != retained.etag ||
              responseReleaseId != request.release.id
          ? const MosaicCommerceConfigurationFailedResponse()
          : const MosaicCommerceConfigurationNotModifiedResponse();
    }
    if (response.statusCode != HttpStatus.ok ||
        response.headers.value(HttpHeaders.contentTypeHeader) !=
            mosaicCommerceConfigurationContentType ||
        response.headers.value('Mosaic-Configuration-Release-Id') !=
            request.release.id) {
      return const MosaicCommerceConfigurationFailedResponse();
    }
    final etag = response.headers.value(HttpHeaders.etagHeader);
    if (etag == null || !_isCommerceEtag(etag)) {
      return const MosaicCommerceConfigurationFailedResponse();
    }
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > mosaicMaximumCommerceConfigurationBytes) {
        return const MosaicCommerceConfigurationFailedResponse();
      }
    }
    final String source;
    try {
      source = utf8.decode(bytes);
    } on FormatException {
      return const MosaicCommerceConfigurationFailedResponse();
    }
    final envelope = _decode(source, request.release);
    if (envelope == null ||
        etag != '"${envelope.configuration.contentDigest}"') {
      return const MosaicCommerceConfigurationFailedResponse();
    }
    return MosaicCommerceConfigurationUpdatedResponse(
      source: source,
      etag: etag,
    );
  }

  MosaicRetainedCommerceConfiguration? _validatedRetained(
    MosaicCommerceConfigurationRequest request,
  ) {
    final retained = request.retained;
    if (retained == null || !_isCommerceEtag(retained.etag)) return null;
    final envelope = _decode(retained.source, request.release);
    if (envelope == null ||
        retained.etag != '"${envelope.configuration.contentDigest}"') {
      return null;
    }
    return retained;
  }

  MosaicCommerceConfigurationEnvelope? _decode(
    String source,
    MosaicConfigurationRelease release,
  ) {
    try {
      return const MosaicCommerceConfigurationDecoder().decode(
        source,
        expectedRelease: release,
        expectedApplicationId: applicationId,
        expectedStorePlatform: storePlatform,
      );
    } on Object {
      return null;
    }
  }
}

bool _isCommerceEtag(String value) =>
    RegExp(r'^"sha256:[a-f0-9]{64}"$').hasMatch(value);

HttpClient _newCommerceHttpClient() => HttpClient();
