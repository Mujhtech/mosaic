import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';

import 'commerce_configuration.dart';
import 'presentation.dart';
import 'protocol.dart';
import 'sha256.dart';
import 'transaction_observation_transport.dart';

/// Billing Ingestion Contract version this subsystem speaks. A response
/// declaring any other version is not decoded.
const String mosaicBillingIngestionContractVersion = '1';

/// A device cannot legitimately hold more pending purchase references than
/// this. The cap bounds a hostile or defective provider adapter.
const int mosaicTransactionObservationMaximumQueueLength = 128;
const int mosaicTransactionObservationMaximumQueueBytes = 256 * 1024;
const int mosaicTransactionObservationMaximumAttempts = 10;

/// Longer than the analytics event expiry: a purchase reference is worth more
/// than a behavioural event, and Store Notifications remain the timely path.
const Duration mosaicTransactionObservationRetention = Duration(days: 14);

/// Bounded ring of already-acknowledged submission identifiers, persisted with
/// the queue so a re-observed purchase is not resubmitted after a restart.
const int mosaicTransactionObservationAcknowledgedLength = 256;

const String mosaicTransactionObservationStorageUnavailableCode =
    'transactions.storage_unavailable';
const String mosaicTransactionObservationQueueOverflowCode =
    'transactions.queue_overflow';
const String mosaicTransactionObservationQueueRejectedCode =
    'transactions.queue_rejected';
const String mosaicTransactionObservationReferenceRejectedCode =
    'transactions.reference_rejected';
const String mosaicTransactionObservationIncompleteCode =
    'transactions.observation_incomplete';
const String mosaicTransactionObservationDeliveryUnavailableCode =
    'transactions.delivery_unavailable';

typedef MosaicTransactionObservationClock = DateTime Function();

/// Host opt-in for the Transaction Observation handoff.
///
/// A Transaction Observation is a trigger for server-side validation and is
/// never evidence that a transaction is authentic. Nothing in this subsystem
/// reports, implies, or can be read as a validated, verified, or confirmed
/// purchase, and no local purchase result is re-labelled by it.
///
/// Absent from [Mosaic.configure], the subsystem is never constructed: nothing
/// is observed, queued, persisted, or submitted.
final class MosaicTransactionObservationSettings {
  const MosaicTransactionObservationSettings({
    this.hostEnabled = true,
    this.submitOnPurchase = true,
    this.submitOnProviderUpdate = true,
  });

  /// Host kill switch, mirroring `analyticsHostEnabled`. Turning it off clears
  /// the queue and deletes the persisted document.
  final bool hostEnabled;

  /// Observe the purchase result the renderer received.
  final bool submitOnPurchase;

  /// Observe asynchronous Commerce Provider updates, which also cover renewals
  /// and out-of-band purchases replayed by the store.
  final bool submitOnProviderUpdate;
}

/// Discriminator for a provider reference, matching the frozen Billing
/// Ingestion Contract v1 `referenceKind` vocabulary exactly.
enum MosaicTransactionReferenceKind {
  appStoreTransactionId('app_store_transaction_id'),
  googlePlayTokenDigest('google_play_token_digest'),
  googlePlayOrderId('google_play_order_id');

  const MosaicTransactionReferenceKind(this.wireValue);

  final String wireValue;

  static MosaicTransactionReferenceKind? tryParse(String? value) {
    for (final kind in values) {
      if (kind.wireValue == value) return kind;
    }
    return null;
  }
}

final RegExp _appStoreTransactionIdPattern = RegExp(r'^[0-9]{1,24}$');
final RegExp _googlePlayTokenDigestPattern = RegExp(r'^[a-f0-9]{64}$');
final RegExp _googlePlayOrderIdPattern =
    RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]*$');

/// The prefix the iOS adapter uses for its local safe reference. The wire value
/// is the raw decimal StoreKit transaction identifier, so the prefix is removed
/// at this decoding boundary rather than anywhere else in the SDK.
const String _appStoreLocalReferencePrefix = 'storekit_';

/// A provider reference that has been structurally proven safe to submit.
///
/// Construction is the only way to obtain one, and it enforces the contract
/// pattern for the declared kind. An Apple JWS representation, a raw Google
/// Play purchase token, a device-verification value, and any credential-shaped
/// string all fail these patterns, so a credential cannot reach the wire even
/// if a custom Commerce Provider supplies one by mistake.
final class MosaicTransactionReference {
  const MosaicTransactionReference._(this.kind, this.value);

  /// Raw decimal App Store transaction identifier. The value is carried as a
  /// string end to end: `Transaction.id` is a `UInt64` and overflows a Dart
  /// `int` on the web and a signed 64-bit integer above `2^63-1`.
  factory MosaicTransactionReference.appStoreTransactionId(String value) {
    final normalized = value.startsWith(_appStoreLocalReferencePrefix)
        ? value.substring(_appStoreLocalReferencePrefix.length)
        : value;
    if (!_appStoreTransactionIdPattern.hasMatch(normalized)) {
      throw FormatException(
        'An App Store transaction reference must be 1-24 decimal digits.',
      );
    }
    return MosaicTransactionReference._(
      MosaicTransactionReferenceKind.appStoreTransactionId,
      normalized,
    );
  }

  /// SHA-256 over the UTF-8 bytes of the Google Play purchase token, lowercase
  /// hexadecimal and unprefixed. The digest is computed by the Android adapter;
  /// the raw purchase token never enters the Dart heap or this contract.
  factory MosaicTransactionReference.googlePlayTokenDigest(String value) {
    if (!_googlePlayTokenDigestPattern.hasMatch(value)) {
      throw FormatException(
        'A Google Play token digest must be 64 lowercase hexadecimal digits.',
      );
    }
    return MosaicTransactionReference._(
      MosaicTransactionReferenceKind.googlePlayTokenDigest,
      value,
    );
  }

  final MosaicTransactionReferenceKind kind;
  final String value;

  /// Derives the reference kind from the Store Platform, exactly as the
  /// contract's platform/reference alignment rule requires, and returns `null`
  /// when the value cannot be carried safely. A `null` result is a dropped
  /// observation, never a submitted one.
  static MosaicTransactionReference? tryFor(
    MosaicStorePlatform storePlatform,
    String? value,
  ) {
    if (value == null) return null;
    final trimmed = value.trim();
    if (trimmed.isEmpty || trimmed.length > 128) return null;
    try {
      return switch (storePlatform) {
        MosaicStorePlatform.ios =>
          MosaicTransactionReference.appStoreTransactionId(trimmed),
        MosaicStorePlatform.android =>
          MosaicTransactionReference.googlePlayTokenDigest(trimmed),
      };
    } on FormatException {
      return null;
    }
  }

  /// Validates an optional Google Play order reference. It is a join handle
  /// only and is never part of the deduplication key, because a promotional
  /// purchase has no order identifier.
  static String? tryOrderReference(
    MosaicStorePlatform storePlatform,
    String? value,
  ) {
    if (value == null || storePlatform != MosaicStorePlatform.android) {
      return null;
    }
    final trimmed = value.trim();
    if (trimmed.isEmpty ||
        trimmed.length > 128 ||
        !_googlePlayOrderIdPattern.hasMatch(trimmed)) {
      return null;
    }
    return trimmed;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MosaicTransactionReference &&
          kind == other.kind &&
          value == other.value;

  @override
  int get hashCode => Object.hash(kind, value);
}

/// SDK context on an observation, mirroring the Analytics Event context
/// vocabulary. It carries no Organization, Project, Environment, or
/// Application identity: tenant scope is derived from the authenticated key.
final class MosaicTransactionObservationContext {
  const MosaicTransactionObservationContext({
    required this.platform,
    this.sdkVersion = mosaicFlutterSdkVersion,
    this.applicationVersion,
    this.operatingSystemVersion,
  });

  /// `ios` or `android`. The contract's platform vocabulary is closed.
  final String platform;

  /// Always this package's version. `sdkFamily` is always `flutter`.
  final String sdkVersion;
  final String? applicationVersion;
  final String? operatingSystemVersion;

  Map<String, Object?> toJson() => <String, Object?>{
        'platform': platform,
        'sdkFamily': 'flutter',
        'sdkVersion': sdkVersion,
        if (_version(operatingSystemVersion, _osVersionPattern) != null)
          'operatingSystemVersion': operatingSystemVersion!.trim(),
        if (_version(applicationVersion, _versionPattern) != null)
          'applicationVersion': applicationVersion!.trim(),
      };

  static MosaicTransactionObservationContext fromJson(
    Map<String, Object?> json,
  ) {
    final platform = json['platform'];
    final sdkVersion = json['sdkVersion'];
    if ((platform != 'ios' && platform != 'android') ||
        json['sdkFamily'] != 'flutter' ||
        sdkVersion is! String) {
      throw const FormatException('Invalid observation context.');
    }
    return MosaicTransactionObservationContext(
      platform: platform! as String,
      sdkVersion: sdkVersion,
      applicationVersion: json['applicationVersion'] as String?,
      operatingSystemVersion: json['operatingSystemVersion'] as String?,
    );
  }

  static String? _version(String? value, RegExp pattern) {
    if (value == null) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty || trimmed.length > 64 || !pattern.hasMatch(trimmed)
        ? null
        : trimmed;
  }
}

/// Correlation to Analytics Event 1/2 using the existing opaque handles only.
/// No new cross-contract identifier is introduced.
final class MosaicTransactionObservationCorrelation {
  const MosaicTransactionObservationCorrelation({
    this.purchaseAttemptId,
    this.providerOperationId,
    this.providerUpdateId,
  });

  final String? purchaseAttemptId;
  final String? providerOperationId;
  final String? providerUpdateId;

  bool get isEmpty => toJson().isEmpty;

  Map<String, Object?> toJson() => <String, Object?>{
        if (_identifier(purchaseAttemptId) case final value?)
          'purchaseAttemptId': value,
        if (_identifier(providerOperationId) case final value?)
          'providerOperationId': value,
        if (_identifier(providerUpdateId) case final value?)
          'providerUpdateId': value,
      };

  static MosaicTransactionObservationCorrelation fromJson(
    Map<String, Object?> json,
  ) =>
      MosaicTransactionObservationCorrelation(
        purchaseAttemptId: json['purchaseAttemptId'] as String?,
        providerOperationId: json['providerOperationId'] as String?,
        providerUpdateId: json['providerUpdateId'] as String?,
      );
}

/// One untrusted client report that a provider transaction may exist.
///
/// It is a `clientTransactionObservation` record of Billing Ingestion Contract
/// 1. It carries no receipt, no signed payload, no purchase token, no
/// credential, no price, no entitlement assertion, no tenant identity, no
/// Store Environment assertion, and no subject reference. Its
/// `sourceAuthority` is always `client_observation`: a client observation can
/// only trigger validation, never author a fact.
final class MosaicTransactionObservation {
  MosaicTransactionObservation({
    required String providerId,
    required this.storePlatform,
    required this.reference,
    required this.observedAt,
    required this.context,
    this.providerOrderReference,
    this.correlation = const MosaicTransactionObservationCorrelation(),
    String? claimedMosaicProductId,
    String? observationId,
  })  : providerId = _requiredIdentifier(providerId, 'providerId'),
        claimedMosaicProductId = _identifier(claimedMosaicProductId),
        submissionId = _submissionId(reference),
        observationId = observationId ?? _newObservationId();

  MosaicTransactionObservation._({
    required this.observationId,
    required this.submissionId,
    required this.providerId,
    required this.storePlatform,
    required this.reference,
    required this.observedAt,
    required this.context,
    required this.providerOrderReference,
    required this.correlation,
    required this.claimedMosaicProductId,
  });

  /// Identity of this record, generated once and persisted, so every delivery
  /// attempt reports the same observation.
  final String observationId;

  /// Deterministic idempotency key. It is derived only from the reference kind
  /// and value, so the renderer path and the provider-update path produce the
  /// identical key for one purchase, and a retry after an ambiguous timeout is
  /// answered `duplicate` instead of creating a second record. It is never
  /// derived from a timestamp, price, Product, or subject.
  final String submissionId;
  final String providerId;
  final MosaicStorePlatform storePlatform;
  final MosaicTransactionReference reference;
  final DateTime observedAt;
  final MosaicTransactionObservationContext context;
  final String? providerOrderReference;
  final MosaicTransactionObservationCorrelation correlation;

  /// A claim only. The server resolves the Mosaic Product independently; a
  /// mismatch is a diagnostic and never an override.
  final String? claimedMosaicProductId;

  static String _submissionId(MosaicTransactionReference reference) =>
      'observation_'
      '${mosaicSha256String('mosaic-transaction-observation-v1'
          '|${reference.kind.wireValue}|${reference.value}')}';

  static String _newObservationId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return 'observation_'
        '${bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
  }

  /// The canonical Billing Ingestion Contract 1 observation record.
  Map<String, Object?> toJson() => <String, Object?>{
        'billingIngestionContractVersion':
            mosaicBillingIngestionContractVersion,
        'recordType': 'clientTransactionObservation',
        'payload': <String, Object?>{
          'observationId': observationId,
          'submissionId': submissionId,
          'providerId': providerId,
          'storePlatform': mosaicStorePlatformWireValue(storePlatform),
          'transactionReference': <String, Object?>{
            'referenceKind': reference.kind.wireValue,
            'value': reference.value,
          },
          // The alignment rule forbids an order reference on an Apple record.
          if (providerOrderReference != null &&
              storePlatform == MosaicStorePlatform.android)
            'providerOrderReference': <String, Object?>{
              'referenceKind':
                  MosaicTransactionReferenceKind.googlePlayOrderId.wireValue,
              'value': providerOrderReference,
            },
          'observedAt': mosaicTransactionObservationTimestamp(observedAt),
          'sourceAuthority': 'client_observation',
          'context': context.toJson(),
          if (!correlation.isEmpty) 'correlation': correlation.toJson(),
          if (claimedMosaicProductId != null)
            'claimedMosaicProductId': claimedMosaicProductId,
        },
      };

  /// Re-validates a persisted record. A tampered or corrupted queue file
  /// cannot smuggle a credential-shaped value back onto the wire, because the
  /// reference is reconstructed through the same structural check.
  static MosaicTransactionObservation fromJson(Map<String, Object?> json) {
    if (json['billingIngestionContractVersion'] !=
            mosaicBillingIngestionContractVersion ||
        json['recordType'] != 'clientTransactionObservation') {
      throw const FormatException('Unsupported observation record.');
    }
    final record = json['payload'];
    final contextValue = record is Map ? record['context'] : null;
    if (record is! Map || contextValue is! Map) {
      throw const FormatException('Invalid persisted observation.');
    }
    final payload = record.cast<String, Object?>();
    if (payload['sourceAuthority'] != 'client_observation') {
      throw const FormatException('Unsupported source authority.');
    }
    final storePlatform =
        mosaicStorePlatformFromWireValue(payload['storePlatform']);
    final referenceValue = payload['transactionReference'];
    final observedAt = payload['observedAt'];
    if (storePlatform == null ||
        referenceValue is! Map ||
        observedAt is! String) {
      throw const FormatException('Invalid persisted observation.');
    }
    final referenceRecord = referenceValue.cast<String, Object?>();
    final value = referenceRecord['value'];
    if (value is! String) {
      throw const FormatException('Invalid transaction reference.');
    }
    final reference = switch (MosaicTransactionReferenceKind.tryParse(
      referenceRecord['referenceKind'] as String?,
    )) {
      MosaicTransactionReferenceKind.appStoreTransactionId =>
        MosaicTransactionReference.appStoreTransactionId(value),
      MosaicTransactionReferenceKind.googlePlayTokenDigest =>
        MosaicTransactionReference.googlePlayTokenDigest(value),
      _ => throw const FormatException('Unsupported reference kind.'),
    };
    if (MosaicTransactionReference.tryFor(storePlatform, value) == null) {
      throw const FormatException('Reference does not match the platform.');
    }
    final submissionId = payload['submissionId'];
    final observationId = _identifier(payload['observationId'] as String?);
    if (submissionId is! String ||
        submissionId != _submissionId(reference) ||
        observationId == null) {
      throw const FormatException('Invalid observation identifiers.');
    }
    final order = payload['providerOrderReference'];
    final orderValue = order is Map ? order['value'] : null;
    if (order != null &&
        (orderValue is! String ||
            !_googlePlayOrderIdPattern.hasMatch(orderValue) ||
            storePlatform != MosaicStorePlatform.android)) {
      throw const FormatException('Invalid order reference.');
    }
    final correlation = payload['correlation'];
    return MosaicTransactionObservation._(
      observationId: observationId,
      submissionId: submissionId,
      providerId: _requiredIdentifier(
        payload['providerId'] as String?,
        'providerId',
      ),
      storePlatform: storePlatform,
      reference: reference,
      observedAt: DateTime.parse(observedAt).toUtc(),
      context: MosaicTransactionObservationContext.fromJson(
        contextValue.cast<String, Object?>(),
      ),
      providerOrderReference: orderValue as String?,
      correlation: correlation is Map
          ? MosaicTransactionObservationCorrelation.fromJson(
              correlation.cast<String, Object?>(),
            )
          : const MosaicTransactionObservationCorrelation(),
      claimedMosaicProductId:
          _identifier(payload['claimedMosaicProductId'] as String?),
    );
  }
}

/// Opaque store platform vocabulary. No StoreKit, Play Billing, or Flutter
/// type name appears anywhere in the contract.
String mosaicStorePlatformWireValue(MosaicStorePlatform value) =>
    switch (value) {
      MosaicStorePlatform.ios => 'apple_app_store',
      MosaicStorePlatform.android => 'google_play',
    };

MosaicStorePlatform? mosaicStorePlatformFromWireValue(Object? value) =>
    switch (value) {
      'apple_app_store' => MosaicStorePlatform.ios,
      'google_play' => MosaicStorePlatform.android,
      _ => null,
    };

final RegExp _identifierPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]*$');
final RegExp _versionPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9.+_-]*$');
final RegExp _osVersionPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9.+_ -]*$');

/// Returns the value only when it satisfies the contract's `identifier`
/// shape. Anything else is dropped rather than sent.
String? _identifier(String? value) {
  if (value == null) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ||
          trimmed.length > 128 ||
          !_identifierPattern.hasMatch(trimmed)
      ? null
      : trimmed;
}

String _requiredIdentifier(String? value, String field) {
  final identifier = _identifier(value);
  if (identifier == null) {
    throw FormatException('$field is not a valid identifier.');
  }
  return identifier;
}

/// The synchronous answer to submitting one observation.
///
/// There is deliberately no member meaning validated, verified, confirmed, or
/// entitled: the store has not been consulted when this result is produced.
sealed class MosaicTransactionObservationSubmission {
  const MosaicTransactionObservationSubmission();
}

/// The observation is well formed and queued for validation. Nothing more. A
/// reader must never grant access or unlock content on this result.
final class MosaicTransactionObservationAcceptedForValidation
    extends MosaicTransactionObservationSubmission {
  const MosaicTransactionObservationAcceptedForValidation({
    required this.submissionId,
  });

  final String submissionId;
}

final class MosaicTransactionObservationDuplicate
    extends MosaicTransactionObservationSubmission {
  const MosaicTransactionObservationDuplicate({required this.submissionId});

  final String submissionId;
}

final class MosaicTransactionObservationPermanentlyRejected
    extends MosaicTransactionObservationSubmission {
  const MosaicTransactionObservationPermanentlyRejected({
    required this.submissionId,
    required this.safeCode,
  });

  final String submissionId;

  /// Stable machine-readable code. Raw provider or server error text never
  /// reaches this field.
  final String safeCode;
}

final class MosaicTransactionObservationRetryableFailure
    extends MosaicTransactionObservationSubmission {
  const MosaicTransactionObservationRetryableFailure({
    required this.safeCode,
    this.retryAfter,
  });

  final String safeCode;
  final Duration? retryAfter;
}

sealed class MosaicTransactionObservationFlushResult {
  const MosaicTransactionObservationFlushResult();
}

final class MosaicTransactionObservationFlushDisabled
    extends MosaicTransactionObservationFlushResult {
  const MosaicTransactionObservationFlushDisabled();
}

final class MosaicTransactionObservationFlushEmpty
    extends MosaicTransactionObservationFlushResult {
  const MosaicTransactionObservationFlushEmpty();
}

final class MosaicTransactionObservationFlushCompleted
    extends MosaicTransactionObservationFlushResult {
  const MosaicTransactionObservationFlushCompleted({
    required this.sent,
    required this.removed,
    required this.retained,
  });

  final int sent;
  final int removed;
  final int retained;
}

final class MosaicTransactionObservationFlushDeferred
    extends MosaicTransactionObservationFlushResult {
  const MosaicTransactionObservationFlushDeferred({required this.safeCode});

  final String safeCode;
}

final class MosaicTransactionObservationDiagnostics {
  const MosaicTransactionObservationDiagnostics({
    required this.enabled,
    required this.queued,
    required this.queuedBytes,
    required this.deduplicated,
    required this.dropped,
    required this.expired,
    required this.rejectedReferences,
    required this.incomplete,
    required this.permanentlyRejected,
    required this.retryable,
    required this.attemptsExhausted,
    this.lastSafeCode,
    this.lastSubmittedAt,
  });

  final bool enabled;
  final int queued;
  final int queuedBytes;
  final int deduplicated;
  final int dropped;
  final int expired;
  final int rejectedReferences;

  /// Observations dropped because a required contract field, most often the
  /// Commerce Provider identity, was not in scope.
  final int incomplete;
  final int permanentlyRejected;
  final int retryable;
  final int attemptsExhausted;
  final String? lastSafeCode;
  final DateTime? lastSubmittedAt;
}

/// The renderer's only view of this subsystem.
///
/// The single method returns `void` by design: a billing handoff can never be
/// awaited from, block, or alter a purchase flow.
abstract interface class MosaicTransactionObservationSink {
  void observePurchaseResult({
    required String? providerId,
    required String? transactionReference,
    String? providerOrderReference,
    String? mosaicProductId,
    String? purchaseAttemptId,
  });
}

abstract interface class MosaicTransactionObservationStorage {
  Future<String?> read(String namespace);
  Future<void> write(String namespace, String source);
  Future<void> clear(String namespace);
}

final class MosaicMemoryTransactionObservationStorage
    implements MosaicTransactionObservationStorage {
  String? source;

  @override
  Future<String?> read(String namespace) async => source;

  @override
  Future<void> write(String namespace, String source) async =>
      this.source = source;

  @override
  Future<void> clear(String namespace) async => source = null;
}

typedef MosaicTransactionObservationDirectoryProvider = Future<Directory>
    Function();

Future<Directory> _observationDirectory() => getApplicationSupportDirectory();

/// Atomic app-private storage in the application support directory.
///
/// Analytics deliberately uses the cache directory, which the operating system
/// may evict. A lost observation is a lost revenue signal, so this queue lives
/// in support storage instead.
final class MosaicFileTransactionObservationStorage
    implements MosaicTransactionObservationStorage {
  const MosaicFileTransactionObservationStorage({
    MosaicTransactionObservationDirectoryProvider directoryProvider =
        _observationDirectory,
  }) : _directoryProvider = directoryProvider;

  final MosaicTransactionObservationDirectoryProvider _directoryProvider;

  @override
  Future<String?> read(String namespace) async {
    final file = await _file(namespace);
    if (!await file.exists()) return null;
    if ((await file.stat()).size >
        mosaicTransactionObservationMaximumQueueBytes + 64 * 1024) {
      throw const FormatException(
        'Transaction observation queue exceeds its storage limit.',
      );
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
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(namespace)) {
      throw ArgumentError.value(namespace, 'namespace');
    }
    final directory = await _directoryProvider();
    return File('${directory.path}/mosaic/transactions-$namespace.json');
  }
}

String mosaicTransactionObservationNamespace(
        Uri baseUrl, String publicSdkKey) =>
    mosaicSha256String(
      '${baseUrl.toString()}\n$publicSdkKey\ntransaction-observations-v1',
    );

/// UTC timestamp in the contract's `utcTimestamp` shape. Deliberately local to
/// this subsystem so Billing Ingestion does not inherit another contract's
/// formatting lifecycle.
String mosaicTransactionObservationTimestamp(DateTime value) {
  final utc = value.toUtc();
  String two(int value) => value.toString().padLeft(2, '0');
  String three(int value) => value.toString().padLeft(3, '0');
  return '${utc.year.toString().padLeft(4, '0')}-${two(utc.month)}-'
      '${two(utc.day)}T${two(utc.hour)}:${two(utc.minute)}:'
      '${two(utc.second)}.${three(utc.millisecond)}Z';
}

final class _QueuedObservation {
  _QueuedObservation({
    required this.observation,
    required this.encoded,
    this.attempts = 0,
    this.notBefore,
  });

  final MosaicTransactionObservation observation;
  final String encoded;
  int attempts;
  DateTime? notBefore;

  int get bytes => utf8.encode(encoded).length;

  Map<String, Object?> toJson() => <String, Object?>{
        'observation': jsonDecode(encoded),
        'attempts': attempts,
        if (notBefore != null)
          'notBefore': mosaicTransactionObservationTimestamp(notBefore!),
      };
}

/// Durable, duplicate-safe queue for Transaction Observations.
///
/// It follows the per-subsystem store convention already established by
/// `MosaicExperimentAssignmentStore`: its own storage interface, its own
/// namespace, and its own consent switch. It is deliberately not the analytics
/// queue: the two contracts, retention policies, and legal bases are separate.
///
/// No method of this class can throw into the host application, block
/// rendering, or block purchasing.
final class MosaicTransactionObservationRuntime
    with WidgetsBindingObserver
    implements MosaicTransactionObservationSink {
  MosaicTransactionObservationRuntime({
    required this.namespace,
    required this.transport,
    required this.storePlatform,
    required this.context,
    this.settings = const MosaicTransactionObservationSettings(),
    this.storage = const MosaicFileTransactionObservationStorage(),
    this.clock = _systemClock,
    this.onDiagnostic,
    double Function()? random,
  })  : _hostEnabled = settings.hostEnabled,
        _random = random ?? Random.secure().nextDouble;

  final String namespace;
  final MosaicTransactionObservationTransport transport;
  final MosaicStorePlatform storePlatform;
  final MosaicTransactionObservationContext context;
  final MosaicTransactionObservationSettings settings;
  final MosaicTransactionObservationStorage storage;
  final MosaicTransactionObservationClock clock;

  /// Host channel for losses the queue cannot recover from. It never throws
  /// into the caller and is never used for ordinary delivery outcomes.
  final MosaicDiagnosticCallback? onDiagnostic;
  final double Function() _random;

  final List<_QueuedObservation> _queue = <_QueuedObservation>[];
  final List<String> _acknowledged = <String>[];
  Future<void> _mutations = Future<void>.value();
  Future<MosaicTransactionObservationFlushResult>? _flush;
  bool _loaded = false;
  bool _hostEnabled;
  bool _disposed = false;
  bool _observingLifecycle = false;
  int _deduplicated = 0,
      _dropped = 0,
      _expired = 0,
      _rejectedReferences = 0,
      _incomplete = 0,
      _permanent = 0,
      _retryable = 0,
      _exhausted = 0;
  String? _lastSafeCode;
  DateTime? _lastSubmittedAt;

  bool get collectionEnabled => _hostEnabled && !_disposed;

  Future<void> initialize() => _serialize(_ensureLoaded);

  /// Host consent switch. Turning collection off clears the queue and deletes
  /// the persisted document, so nothing survives a consent withdrawal.
  Future<void> setCollection({required bool hostEnabled}) =>
      _serialize(() async {
        _hostEnabled = hostEnabled;
        await _ensureLoaded();
        if (!collectionEnabled) await _clearEverything();
      });

  @override
  void observePurchaseResult({
    required String? providerId,
    required String? transactionReference,
    String? providerOrderReference,
    String? mosaicProductId,
    String? purchaseAttemptId,
  }) {
    if (!settings.submitOnPurchase) return;
    _observeInBackground(
      providerId: providerId,
      transactionReference: transactionReference,
      providerOrderReference: providerOrderReference,
      mosaicProductId: mosaicProductId,
      correlation: MosaicTransactionObservationCorrelation(
        purchaseAttemptId: purchaseAttemptId,
      ),
    );
  }

  /// Observes an asynchronous Commerce Provider update. Phase 9A observes a
  /// completed purchase only; every other outcome stays local.
  void observeProviderUpdate({
    required String? providerId,
    required String? transactionReference,
    String? providerOrderReference,
    String? mosaicProductId,
    String? providerOperationId,
    String? providerUpdateId,
    DateTime? observedAt,
  }) {
    if (!settings.submitOnProviderUpdate) return;
    _observeInBackground(
      providerId: providerId,
      transactionReference: transactionReference,
      providerOrderReference: providerOrderReference,
      mosaicProductId: mosaicProductId,
      correlation: MosaicTransactionObservationCorrelation(
        providerOperationId: providerOperationId,
        providerUpdateId: providerUpdateId,
      ),
      observedAt: observedAt,
    );
  }

  void _observeInBackground({
    required String? providerId,
    required String? transactionReference,
    String? providerOrderReference,
    String? mosaicProductId,
    MosaicTransactionObservationCorrelation correlation =
        const MosaicTransactionObservationCorrelation(),
    DateTime? observedAt,
  }) {
    unawaited(
      observe(
        providerId: providerId,
        transactionReference: transactionReference,
        providerOrderReference: providerOrderReference,
        mosaicProductId: mosaicProductId,
        correlation: correlation,
        observedAt: observedAt,
      ).then<void>(
        (_) {},
        onError: (Object _, StackTrace __) {
          _lastSafeCode = mosaicTransactionObservationStorageUnavailableCode;
        },
      ),
    );
  }

  /// Enqueues one observation and starts an unawaited delivery attempt.
  /// Returns whether a new record was queued; a duplicate returns `false`.
  Future<bool> observe({
    required String? providerId,
    required String? transactionReference,
    String? providerOrderReference,
    String? mosaicProductId,
    MosaicTransactionObservationCorrelation correlation =
        const MosaicTransactionObservationCorrelation(),
    DateTime? observedAt,
  }) async {
    var queued = false;
    await _serialize(() async {
      await _ensureLoaded();
      if (!collectionEnabled) return;
      // A provider that supplies no reference has nothing to observe. That is
      // ordinary, so it is not counted as a rejected reference.
      if (transactionReference == null) return;
      final reference = MosaicTransactionReference.tryFor(
        storePlatform,
        transactionReference,
      );
      if (reference == null) {
        // A JWS, a raw purchase token, a mock or preview reference, and any
        // other credential-shaped value land here and are never persisted.
        _rejectedReferences++;
        _lastSafeCode = mosaicTransactionObservationReferenceRejectedCode;
        await _persistSafely();
        return;
      }
      final now = clock().toUtc();
      // `providerId` is required by the observation contract. An observation
      // without one is dropped here rather than handed to the constructor as an
      // empty string that only its validation happens to reject.
      if (providerId == null) {
        _incomplete++;
        _lastSafeCode = mosaicTransactionObservationIncompleteCode;
        await _persistSafely();
        return;
      }
      final MosaicTransactionObservation observation;
      try {
        observation = MosaicTransactionObservation(
          providerId: providerId,
          storePlatform: storePlatform,
          reference: reference,
          observedAt: (observedAt ?? now).toUtc(),
          context: context,
          providerOrderReference: MosaicTransactionReference.tryOrderReference(
            storePlatform,
            providerOrderReference,
          ),
          correlation: correlation,
          claimedMosaicProductId: mosaicProductId,
        );
      } on FormatException {
        // The record is incomplete, most often because no Commerce Provider
        // identity was in scope. It is dropped rather than sent malformed.
        _incomplete++;
        _lastSafeCode = mosaicTransactionObservationIncompleteCode;
        await _persistSafely();
        return;
      }
      if (_acknowledged.contains(observation.submissionId) ||
          _queue.any(
            (item) => item.observation.submissionId == observation.submissionId,
          )) {
        _deduplicated++;
        return;
      }
      final item = _QueuedObservation(
        observation: observation,
        encoded: jsonEncode(observation.toJson()),
      );
      _dropExpired(now);
      if (_queue.length >= mosaicTransactionObservationMaximumQueueLength ||
          _queueBytes + item.bytes >
              mosaicTransactionObservationMaximumQueueBytes) {
        // First in, first out: the oldest reference is the one a Store
        // Notification has most likely already delivered server-side.
        _queue.removeAt(0);
        _dropped++;
        _lastSafeCode = mosaicTransactionObservationQueueOverflowCode;
      }
      _queue.add(item);
      queued = true;
      await _persistSafely();
    });
    if (queued) _flushInBackground();
    return queued;
  }

  Future<MosaicTransactionObservationFlushResult> flush() =>
      _flush ??= _performFlush().whenComplete(() => _flush = null);

  Future<MosaicTransactionObservationFlushResult> _performFlush() async {
    await _serialize(() async {
      await _ensureLoaded();
      if (collectionEnabled) _dropExpired(clock().toUtc());
      await _persistSafely();
    });
    if (!collectionEnabled) {
      return const MosaicTransactionObservationFlushDisabled();
    }
    var sent = 0, removed = 0, retained = 0;
    String? deferral;
    // One observation per request. Volume is tiny and per-record idempotency is
    // simpler and safer than batch-acknowledgement matching.
    while (true) {
      final item = _nextEligible();
      if (item == null) break;
      sent++;
      MosaicTransactionObservationSubmission result;
      try {
        result = await transport.submit(item.observation);
      } on Object {
        result = const MosaicTransactionObservationRetryableFailure(
          safeCode: mosaicTransactionObservationDeliveryUnavailableCode,
        );
      }
      var stop = false;
      await _serialize(() async {
        switch (result) {
          case MosaicTransactionObservationAcceptedForValidation(
                  :final submissionId
                ) ||
                MosaicTransactionObservationDuplicate(:final submissionId):
            if (submissionId != item.observation.submissionId) {
              _lastSafeCode = 'transactions.response_malformed';
              _scheduleRetry(item);
              retained++;
              stop = true;
              deferral = 'transactions.response_malformed';
              break;
            }
            if (_queue.remove(item)) removed++;
            _acknowledge(item.observation.submissionId);
          case MosaicTransactionObservationPermanentlyRejected(:final safeCode):
            if (_queue.remove(item)) {
              removed++;
              _permanent++;
              _lastSafeCode = safeCode;
              // Resubmitting the identical document cannot succeed, so the key
              // is remembered and the queue drains instead of retrying.
              _acknowledge(item.observation.submissionId);
            }
          case MosaicTransactionObservationRetryableFailure(
              :final safeCode,
              :final retryAfter
            ):
            _retryable++;
            _lastSafeCode = safeCode;
            deferral = safeCode;
            _scheduleRetry(item, explicit: retryAfter);
            retained++;
            // Back off the whole queue rather than hammering a saturated or
            // rate-limited endpoint with the remaining records.
            stop = true;
        }
        _lastSubmittedAt = clock().toUtc();
        await _persistSafely();
      });
      if (stop) break;
    }
    if (sent == 0) return const MosaicTransactionObservationFlushEmpty();
    if (deferral case final code?) {
      return MosaicTransactionObservationFlushDeferred(safeCode: code);
    }
    return MosaicTransactionObservationFlushCompleted(
      sent: sent,
      removed: removed,
      retained: retained,
    );
  }

  Future<MosaicTransactionObservationDiagnostics> diagnostics() async {
    await initialize();
    await _mutations;
    return MosaicTransactionObservationDiagnostics(
      enabled: collectionEnabled,
      queued: _queue.length,
      queuedBytes: _queueBytes,
      deduplicated: _deduplicated,
      dropped: _dropped,
      expired: _expired,
      rejectedReferences: _rejectedReferences,
      incomplete: _incomplete,
      permanentlyRejected: _permanent,
      retryable: _retryable,
      attemptsExhausted: _exhausted,
      lastSafeCode: _lastSafeCode,
      lastSubmittedAt: _lastSubmittedAt,
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // No background-execution machinery exists in Phase 9A. A record queued
    // just before termination is delivered on the next launch; Store
    // Notifications remain the authoritative and timely ingestion path.
    _flushInBackground();
  }

  Future<void> disposeRuntime() => _serialize(() async {
        if (_disposed) return;
        _disposed = true;
        if (_observingLifecycle) {
          WidgetsBinding.instance.removeObserver(this);
          _observingLifecycle = false;
        }
        await _persistSafely();
      });

  _QueuedObservation? _nextEligible() {
    final now = clock().toUtc();
    for (final item in _queue) {
      if (item.notBefore == null || !item.notBefore!.isAfter(now)) return item;
    }
    return null;
  }

  void _acknowledge(String submissionId) {
    _acknowledged.remove(submissionId);
    _acknowledged.add(submissionId);
    while (
        _acknowledged.length > mosaicTransactionObservationAcknowledgedLength) {
      _acknowledged.removeAt(0);
    }
  }

  void _scheduleRetry(_QueuedObservation item, {Duration? explicit}) {
    if (!_queue.contains(item)) return;
    item.attempts++;
    if (item.attempts >= mosaicTransactionObservationMaximumAttempts) {
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

  int get _queueBytes => _queue.fold(0, (sum, item) => sum + item.bytes);

  void _dropExpired(DateTime now) {
    final before = _queue.length;
    _queue.removeWhere(
      (item) =>
          now.difference(item.observation.observedAt) >
          mosaicTransactionObservationRetention,
    );
    _expired += before - _queue.length;
  }

  Future<void> _ensureLoaded() async {
    if (_loaded) return;
    await _restore();
    _loaded = true;
    _observeLifecycleIfAvailable();
    if (!collectionEnabled) await _clearEverything();
  }

  Future<void> _restore() async {
    try {
      final source = await storage.read(namespace);
      if (source == null) return;
      final raw = jsonDecode(source);
      if (raw is! Map || raw['version'] != 1) throw const FormatException('');
      final json = raw.cast<String, Object?>();
      final items = json['observations'];
      if (items is! List) throw const FormatException('');
      for (final value in items) {
        if (value is! Map) throw const FormatException('');
        final item = value.cast<String, Object?>();
        final document = item['observation'];
        if (document is! Map) throw const FormatException('');
        final attempts = item['attempts'];
        if (attempts is! int ||
            attempts < 0 ||
            attempts >= mosaicTransactionObservationMaximumAttempts) {
          continue;
        }
        final observation = MosaicTransactionObservation.fromJson(
          document.cast<String, Object?>(),
        );
        _queue.add(
          _QueuedObservation(
            observation: observation,
            encoded: jsonEncode(observation.toJson()),
            attempts: attempts,
            notBefore: item['notBefore'] == null
                ? null
                : DateTime.parse(item['notBefore']! as String).toUtc(),
          ),
        );
      }
      for (final value in json['acknowledged'] as List? ?? const <Object?>[]) {
        if (value is String && value.length <= 128) _acknowledged.add(value);
      }
      while (_acknowledged.length >
          mosaicTransactionObservationAcknowledgedLength) {
        _acknowledged.removeAt(0);
      }
      _deduplicated = json['deduplicated'] as int? ?? 0;
      _dropped = json['dropped'] as int? ?? 0;
      _expired = json['expired'] as int? ?? 0;
      _rejectedReferences = json['rejectedReferences'] as int? ?? 0;
      _incomplete = json['incomplete'] as int? ?? 0;
      _permanent = json['permanentlyRejected'] as int? ?? 0;
      _retryable = json['retryable'] as int? ?? 0;
      _exhausted = json['attemptsExhausted'] as int? ?? 0;
      _lastSafeCode = json['lastSafeCode'] as String?;
      _dropExpired(clock().toUtc());
      while (_queue.length > mosaicTransactionObservationMaximumQueueLength ||
          _queueBytes > mosaicTransactionObservationMaximumQueueBytes) {
        _queue.removeAt(0);
        _dropped++;
      }
    } on Object {
      // A corrupt document must never wedge the SDK, and must never be
      // partially trusted. Discarding it drops undelivered Transaction
      // Observations, so the loss is reported rather than left to be inferred
      // from `lastSafeCode`.
      final discarded = _queue.length;
      _queue.clear();
      _acknowledged.clear();
      await _clearStorageSafely();
      _lastSafeCode = mosaicTransactionObservationQueueRejectedCode;
      try {
        onDiagnostic?.call(
          MosaicDiagnostic(
            code: mosaicTransactionObservationQueueRejectedCode,
            message: 'The persisted Transaction Observation queue was '
                'unreadable and was discarded; $discarded restored '
                'observation(s) and any earlier unsent ones are lost.',
            severity: MosaicDiagnosticSeverity.error,
          ),
        );
      } on Object {
        // A host diagnostic handler must never break queue restoration.
      }
    }
  }

  Future<void> _clearEverything() async {
    _queue.clear();
    _acknowledged.clear();
    await _clearStorageSafely();
  }

  Future<void> _persistSafely() async {
    if (!collectionEnabled) return;
    try {
      await storage.write(
        namespace,
        jsonEncode(<String, Object?>{
          'version': 1,
          'observations': _queue.map((item) => item.toJson()).toList(),
          'acknowledged': _acknowledged,
          'deduplicated': _deduplicated,
          'dropped': _dropped,
          'expired': _expired,
          'rejectedReferences': _rejectedReferences,
          'incomplete': _incomplete,
          'permanentlyRejected': _permanent,
          'retryable': _retryable,
          'attemptsExhausted': _exhausted,
          'lastSafeCode': _lastSafeCode,
        }),
      );
    } on Object {
      _lastSafeCode = mosaicTransactionObservationStorageUnavailableCode;
    }
  }

  Future<void> _clearStorageSafely() async {
    try {
      await storage.clear(namespace);
    } on Object {
      _lastSafeCode = mosaicTransactionObservationStorageUnavailableCode;
    }
  }

  void _flushInBackground() {
    unawaited(
      flush().then<void>(
        (_) {},
        onError: (Object _, StackTrace __) {
          _lastSafeCode = mosaicTransactionObservationDeliveryUnavailableCode;
        },
      ),
    );
  }

  void _observeLifecycleIfAvailable() {
    if (_observingLifecycle) return;
    try {
      WidgetsBinding.instance.addObserver(this);
      _observingLifecycle = true;
    } on FlutterError {
      // A pure Dart host may configure before Flutter bindings initialize.
    }
  }

  Future<void> _serialize(Future<void> Function() action) {
    final completer = Completer<void>();
    _mutations = _mutations.then((_) async {
      try {
        await action();
        completer.complete();
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    });
    return completer.future;
  }
}

DateTime _systemClock() => DateTime.now().toUtc();
