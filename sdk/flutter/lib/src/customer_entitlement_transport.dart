import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'customer_entitlements.dart';
import 'protocol.dart';

/// Header carrying the Environment-scoped public SDK key.
///
/// Contract-owned and final: the public key says which application is asking,
/// the customer token in `Authorization: Bearer` says which customer is read,
/// and neither substitutes for the other.
const String mosaicCustomerSdkKeyHeader = 'Mosaic-SDK-Key';

final class MosaicCustomerEntitlementSyncRequest {
  const MosaicCustomerEntitlementSyncRequest({
    required this.baseUrl,
    required this.publicSdkKey,
    required this.customerToken,
    required this.timeout,
    required this.correlationId,
    this.applicationId,
    this.platform,
    this.applicationVersion,
    this.knownAuthorityEpoch,
    this.knownSnapshotVersion,
    this.knownSnapshotAuthorityDigest,
    this.entityTag,
    this.requestedEntitlementKeys = const <String>[],
  });

  final Uri baseUrl;
  final String publicSdkKey;

  /// The opaque Customer Access Token. It is presented and then forgotten: it
  /// is never logged, stored, or included in a diagnostic.
  final String customerToken;
  final Duration timeout;
  final String correlationId;
  final String? applicationId;
  final String? platform;
  final String? applicationVersion;
  final int? knownAuthorityEpoch;

  final int? knownSnapshotVersion;

  /// Integrity identity of the retained authority-bound snapshot. This is
  /// verification input only; the server still derives customer and scope
  /// from authentication.
  final String? knownSnapshotAuthorityDigest;

  /// Contract form, without the HTTP quoting.
  final String? entityTag;
  final List<String> requestedEntitlementKeys;
}

sealed class MosaicCustomerEntitlementSyncResponse {
  const MosaicCustomerEntitlementSyncResponse();
}

final class MosaicCustomerEntitlementSyncReceived
    extends MosaicCustomerEntitlementSyncResponse {
  const MosaicCustomerEntitlementSyncReceived({
    required this.source,
    this.entityTag,
    this.serverTime,
  });

  final String source;
  final String? entityTag;
  final DateTime? serverTime;
}

/// A bodyless `304`. The cache is preserved and trusted time may be
/// re-anchored, but the freshness window does **not** move: no contract-pinned
/// carrier for refreshed windows exists in a bodyless response, and inferring
/// one from unpinned headers would let a proxy extend offline access.
///
/// The sliding mechanism is the `200` carrying the canonical `snapshotUnchanged`
/// record, whose refreshed windows are part of the contract.
final class MosaicCustomerEntitlementSyncNotModified
    extends MosaicCustomerEntitlementSyncResponse {
  const MosaicCustomerEntitlementSyncNotModified({
    this.entityTag,
    this.serverTime,
  });

  final String? entityTag;
  final DateTime? serverTime;
}

/// The token was refused. Expired, revoked, unknown, and wrong-audience are
/// deliberately indistinguishable, so the caller's only correct response is one
/// forced token refresh and one retry.
final class MosaicCustomerEntitlementSyncUnauthorized
    extends MosaicCustomerEntitlementSyncResponse {
  const MosaicCustomerEntitlementSyncUnauthorized();
}

final class MosaicCustomerEntitlementSyncFailed
    extends MosaicCustomerEntitlementSyncResponse {
  const MosaicCustomerEntitlementSyncFailed({
    required this.diagnosticCode,
    this.retryAfterSeconds,
  });

  final String diagnosticCode;
  final int? retryAfterSeconds;
}

abstract interface class MosaicCustomerEntitlementTransport {
  Future<MosaicCustomerEntitlementSyncResponse> sync(
    MosaicCustomerEntitlementSyncRequest request,
  );
}

typedef MosaicCustomerEntitlementHttpClientFactory = HttpClient Function();

HttpClient _newHttpClient() => HttpClient();

/// The canonical `entitlementSyncRequest` envelope.
///
/// Contract negotiation lives in this body rather than in a header, so the
/// request is sent with a body even though it is a read: a bodyless request
/// could not state which contract versions the caller can read, and the server
/// answers `snapshotUnchanged` only when it is told which version the caller
/// already holds.
Map<String, Object?> mosaicEncodeEntitlementSyncRequest(
  MosaicCustomerEntitlementSyncRequest request,
) {
  final applicationId = request.applicationId;
  final platform = request.platform;
  final applicationVersion = request.applicationVersion;
  if (applicationId == null || platform == null || applicationVersion == null) {
    throw StateError('Entitlement v2 request metadata is incomplete.');
  }
  return <String, Object?>{
    'authoritativeEntitlementContractVersion':
        mosaicAuthoritativeEntitlementContractVersion,
    'recordType': 'entitlementSyncRequest',
    'payload': <String, Object?>{
      if (request.knownAuthorityEpoch != null)
        'knownAuthorityEpoch': request.knownAuthorityEpoch,
      if (request.knownSnapshotVersion != null)
        'knownSnapshotVersion': request.knownSnapshotVersion,
      if (request.knownSnapshotAuthorityDigest != null)
        'knownSnapshotAuthorityDigest': request.knownSnapshotAuthorityDigest,
      'request': <String, Object?>{
        'applicationId': applicationId,
        'platform': platform,
        'appVersion': applicationVersion,
        'sdkVersion': mosaicFlutterSdkVersion,
        'supportedContractVersions': <String>[
          mosaicAuthoritativeEntitlementContractVersion,
        ],
        'capabilities': mosaicCustomerAuthorityCapabilities,
      },
    },
  };
}

/// Native HTTP transport for `/v1/sdk/billing/entitlements`.
final class MosaicIoCustomerEntitlementTransport
    implements MosaicCustomerEntitlementTransport {
  const MosaicIoCustomerEntitlementTransport({
    MosaicCustomerEntitlementHttpClientFactory clientFactory = _newHttpClient,
  }) : _clientFactory = clientFactory;

  final MosaicCustomerEntitlementHttpClientFactory _clientFactory;

  @override
  Future<MosaicCustomerEntitlementSyncResponse> sync(
    MosaicCustomerEntitlementSyncRequest request,
  ) async {
    final client = _clientFactory()
      ..connectionTimeout = request.timeout
      ..autoUncompress = true;
    try {
      return await _sync(client, request).timeout(request.timeout);
    } on TimeoutException {
      return const MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: 'entitlements.sync.timeout',
      );
    } on Object {
      return const MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: 'entitlements.sync.networkFailed',
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<MosaicCustomerEntitlementSyncResponse> _sync(
    HttpClient client,
    MosaicCustomerEntitlementSyncRequest request,
  ) async {
    final outgoing = await client.postUrl(_endpoint(request.baseUrl));
    outgoing
      // A redirect on an authenticated read is a request to present a bearer
      // token to a host the SDK never chose.
      ..followRedirects = false
      ..headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer ${request.customerToken}',
      )
      ..headers.set(mosaicCustomerSdkKeyHeader, request.publicSdkKey)
      ..headers.set(HttpHeaders.acceptHeader, 'application/json')
      ..headers.set(HttpHeaders.acceptEncodingHeader, 'gzip')
      ..headers.contentType = ContentType.json
      ..headers.set('Mosaic-SDK-Platform', 'flutter')
      ..headers.set('Mosaic-SDK-Version', mosaicFlutterSdkVersion);
    if (request.applicationVersion case final appVersion?) {
      outgoing.headers.set('Mosaic-App-Version', appVersion);
    }
    outgoing.write(jsonEncode(mosaicEncodeEntitlementSyncRequest(request)));

    final response = await outgoing.close();
    if (response.isRedirect) {
      return const MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: 'entitlements.sync.redirectRejected',
      );
    }
    final serverTime = _serverTime(response);
    final entityTag = _entityTag(response);

    if (response.statusCode == HttpStatus.notModified) {
      return MosaicCustomerEntitlementSyncNotModified(
        entityTag: entityTag,
        serverTime: serverTime,
      );
    }
    if (response.statusCode == HttpStatus.unauthorized) {
      return const MosaicCustomerEntitlementSyncUnauthorized();
    }
    if (response.statusCode != HttpStatus.ok) {
      return MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: switch (response.statusCode) {
          HttpStatus.forbidden => 'entitlements.sync.forbidden',
          HttpStatus.notAcceptable => 'entitlements.sync.contractUnsupported',
          HttpStatus.tooManyRequests => 'entitlements.sync.rateLimited',
          _ => 'entitlements.sync.httpFailed',
        },
        retryAfterSeconds:
            int.tryParse(response.headers.value('Retry-After') ?? ''),
      );
    }
    final contentType = response.headers.contentType;
    if (contentType == null || contentType.mimeType != 'application/json') {
      // A captive portal answering with HTML is the common case, and it must
      // never be parsed as an entitlement document.
      return const MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: 'entitlements.sync.invalidContentType',
      );
    }
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > mosaicCustomerEntitlementMaximumRecordBytes) {
        return const MosaicCustomerEntitlementSyncFailed(
          diagnosticCode: 'entitlements.sync.responseTooLarge',
        );
      }
    }
    final String source;
    try {
      source = utf8.decode(bytes);
    } on FormatException {
      return const MosaicCustomerEntitlementSyncFailed(
        diagnosticCode: 'entitlements.sync.invalidEncoding',
      );
    }
    return MosaicCustomerEntitlementSyncReceived(
      source: source,
      entityTag: entityTag,
      serverTime: serverTime,
    );
  }

  DateTime? _serverTime(HttpClientResponse response) {
    final value = response.headers.value(HttpHeaders.dateHeader);
    if (value == null) return null;
    try {
      return HttpDate.parse(value).toUtc();
    } on FormatException {
      return null;
    }
  }

  String? _entityTag(HttpClientResponse response) {
    final value = response.headers.value(HttpHeaders.etagHeader);
    if (value == null || value.length < 2 || !value.startsWith('"')) {
      return null;
    }
    return value.substring(1, value.length - 1);
  }
}

Uri _endpoint(Uri baseUrl) {
  final path = baseUrl.path.endsWith('/') ? baseUrl.path : '${baseUrl.path}/';
  return baseUrl.replace(path: path).resolve('v1/sdk/billing/entitlements');
}
