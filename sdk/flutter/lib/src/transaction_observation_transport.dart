import 'dart:convert';
import 'dart:io';

import 'transaction_observation.dart';

/// Delivery boundary for one Transaction Observation.
///
/// It is an interface so hosts and tests can inject delivery without the
/// runtime depending on `dart:io`, and so the queue can be exercised without a
/// network.
/// Header carrying the current Customer Access Token alongside a Transaction
/// Observation.
///
/// This is the evidence rung that binds an identified user's purchase to their
/// Billing Customer server-side. Without it a validated purchase can only
/// anchor to a purchase-anchored customer, and the identified user is
/// associated later or not at all.
const String mosaicCustomerTokenHeader = 'Mosaic-Customer-Token';

/// Supplies the currently held Customer Access Token at send time, or `null`.
///
/// It is deliberately synchronous and non-minting. Observation delivery is
/// fire-and-forget and runs on a retry schedule, so a resolver that could mint
/// would turn a backend outage into a token-request storm. An absent or expired
/// token simply omits the header, which is a valid anonymous submission.
typedef MosaicCustomerTokenHeaderResolver = String? Function();

abstract interface class MosaicTransactionObservationTransport {
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  );
}

/// Submits to the public SDK observation endpoint.
///
/// The only credential it carries is the environment-scoped public SDK key,
/// exactly as analytics ingestion does. No Store Server Credential, App Store
/// key, Google service-account key, or shared secret exists anywhere in the
/// SDK, and none can be configured into it.
final class MosaicIoTransactionObservationTransport
    implements MosaicTransactionObservationTransport {
  const MosaicIoTransactionObservationTransport({
    required this.baseUrl,
    required this.publicSdkKey,
    this.timeout = const Duration(seconds: 5),
    this.customerToken,
  });

  final Uri baseUrl;
  final String publicSdkKey;
  final Duration timeout;

  /// Resolved at send time, never at enqueue time: a queued observation must
  /// not carry a credential, and a token minted after the purchase still binds
  /// it. The token is never persisted with the queue and never logged.
  final MosaicCustomerTokenHeaderResolver? customerToken;

  static const String path = '/v1/sdk/billing/observations';

  @override
  Future<MosaicTransactionObservationSubmission> submit(
    MosaicTransactionObservation observation,
  ) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final endpoint = baseUrl.resolve(path);
      final request = await client.postUrl(endpoint).timeout(timeout);
      request.headers
        ..set(HttpHeaders.authorizationHeader, 'Bearer $publicSdkKey')
        ..contentType = ContentType.json;
      // Transport-level, per the transport-is-not-contract precedent: the
      // Billing Ingestion v1 observation record is unchanged.
      final token = _currentCustomerToken();
      if (token != null) {
        request.headers.set(mosaicCustomerTokenHeader, token);
      }
      request.write(jsonEncode(observation.toJson()));
      final response = await request.close().timeout(timeout);
      final body = await utf8.decoder.bind(response).join().timeout(timeout);
      return decodeSubmission(
        statusCode: response.statusCode,
        body: body,
        retryAfterHeader: response.headers.value('retry-after'),
        submissionId: observation.submissionId,
      );
    } finally {
      client.close(force: true);
    }
  }

  /// Reads the held token without minting one and without letting a host
  /// resolver that throws become a failed submission.
  String? _currentCustomerToken() {
    try {
      final value = customerToken?.call();
      return value == null || value.isEmpty ? null : value;
    } on Object {
      return null;
    }
  }

  /// Maps one HTTP answer onto the sealed submission result.
  ///
  /// The body is the Billing Ingestion Contract v1 observation submission
  /// result record, envelope and all. It is decoded strictly: an unexpected
  /// contract version, record type, or status is not guessed at, because the
  /// outcome vocabulary is closed and no member of it means validated.
  ///
  /// Exposed for tests so the classification rules that decide whether a
  /// record is retried, dropped, or retained are exercised without a socket.
  static MosaicTransactionObservationSubmission decodeSubmission({
    required int statusCode,
    required String body,
    required String submissionId,
    String? retryAfterHeader,
  }) {
    final headerRetryAfter = _retryAfter(retryAfterHeader);
    if (statusCode == 408 ||
        statusCode == 429 ||
        (statusCode >= 500 && statusCode < 600)) {
      return MosaicTransactionObservationRetryableFailure(
        safeCode: statusCode == 429
            ? 'transactions.delivery_throttled'
            : mosaicTransactionObservationDeliveryUnavailableCode,
        retryAfter: headerRetryAfter,
      );
    }
    if (statusCode < 200 || statusCode >= 300) {
      // The endpoint rejected the document itself. Resending it unchanged
      // cannot succeed, so the queue drains instead of storming a public
      // endpoint forever.
      return MosaicTransactionObservationPermanentlyRejected(
        submissionId: submissionId,
        safeCode: 'transactions.submission_rejected',
      );
    }
    // An undecodable success body is retained and retried under the bounded
    // attempt limit rather than being read as either acceptance or rejection.
    const undecodable = MosaicTransactionObservationRetryableFailure(
      safeCode: 'transactions.response_malformed',
    );
    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      return undecodable;
    }
    if (decoded is! Map) return undecodable;
    final envelope = decoded.cast<String, Object?>();
    if (envelope['billingIngestionContractVersion'] !=
            mosaicBillingIngestionContractVersion ||
        envelope['recordType'] != 'observationSubmissionResult') {
      return undecodable;
    }
    final record = envelope['payload'];
    if (record is! Map) return undecodable;
    final payload = record.cast<String, Object?>();
    final acknowledged = payload['submissionId'];
    if (acknowledged is! String ||
        acknowledged.isEmpty ||
        acknowledged.length > 128) {
      return undecodable;
    }
    final code = payload['code'];
    final safeCode = code is String && code.isNotEmpty && code.length <= 96
        ? code
        : 'transactions.submission_rejected';
    final retryAfterSeconds = payload['retryAfterSeconds'];
    final retryAfter = retryAfterSeconds is int &&
            retryAfterSeconds >= 1 &&
            retryAfterSeconds <= 86400
        ? Duration(seconds: retryAfterSeconds)
        : headerRetryAfter;
    return switch (payload['status']) {
      'accepted_for_validation' =>
        MosaicTransactionObservationAcceptedForValidation(
          submissionId: acknowledged,
        ),
      'duplicate' =>
        MosaicTransactionObservationDuplicate(submissionId: acknowledged),
      'permanently_rejected' => MosaicTransactionObservationPermanentlyRejected(
          submissionId: acknowledged,
          safeCode: safeCode,
        ),
      'retryable_failure' => MosaicTransactionObservationRetryableFailure(
          safeCode: safeCode,
          retryAfter: retryAfter,
        ),
      _ => undecodable,
    };
  }

  static Duration? _retryAfter(String? value) {
    if (value == null) return null;
    final seconds = int.tryParse(value.trim());
    if (seconds == null || seconds < 1 || seconds > 86400) return null;
    return Duration(seconds: seconds);
  }
}
